// ==============================================
// SHOP API — Supabase CRUD via dbRest()
//
// We bypass supabase-js for the same reason PR / VS modules do: the
// client occasionally enters a state where the next call hangs, and
// silent-success on RLS-blocked writes is documented elsewhere (see
// .claude/rules/mistakes.md). Every write here uses
// `prefer: 'return=representation'` and checks `data.length > 0` so an
// RLS denial surfaces as an error instead of looking like success.
// ==============================================

import { dbRest } from '../db.js';
import { genOrderId } from './data.js';
import { deleteShopFile } from './uploads.js';

// ---- Products ----------------------------------------------------------

export async function listProducts({ activeOnly = true } = {}) {
  const filter = activeOnly ? '&is_active=eq.true' : '';
  const { data, error } = await dbRest(
    `/shop_products?select=*${filter}&order=added_at.desc`,
  );
  if (error) throw new Error(error.message || 'โหลดสินค้าไม่สำเร็จ');
  return data || [];
}

/** Reserved-stock map across ALL products at once — one RPC call instead
 *  of one per product. Shape:
 *    { "p-shirt-id": { "S-red": 3, "M-blue": 1 }, ... }
 *  Powers the buyer-side "available = max(0, stock - reserved)" view.
 *  Falls back to {} on any error (e.g. migration 0030 not applied) so
 *  the UI gracefully degrades to the legacy raw-stock display. */
export async function fetchReservedMatrixAll() {
  const { data, error } = await dbRest('/rpc/shop_reserved_matrix_all', {
    method: 'POST',
    body: {},
  });
  if (error) {
    if (error.status === 404 || /shop_reserved_matrix_all/i.test(error.message || '')) {
      if (!window.__samoWarnedReservedRpc) {
        window.__samoWarnedReservedRpc = true;
        console.warn('[shop] shop_reserved_matrix_all RPC missing — apply migration 0030 for reservation-aware stock display.');
      }
      return {};
    }
    console.warn('[shop] reserved matrix fetch failed:', error.message);
    return {};
  }
  return data && typeof data === 'object' ? data : {};
}

/** Atomic order creation — locks product rows, validates available stock
 *  under the lock, then inserts header + items in one transaction. The
 *  legacy 2-step createOrder() below is kept as a fallback for envs
 *  that haven't applied migration 0030. Returns the new order row
 *  (re-read after insert so callers get the same shape as before). */
function mapOrderItems(items) {
  return (items || []).map((it) => ({
    product_id:  it.productId,
    size:        it.size || 'F',
    color:       it.color || 'default',
    fit:         it.fit || 'unisex',
    qty:         Number(it.qty) || 1,
    unit_price:  Number(it.price) || 0,
  }));
}

/**
 * place_shop_order's refusal → what the buyer reads. ONE home for both RPC
 * paths (they had a copy each). Always Thai: a code the buyer cannot act on
 * ("ID_GENERATION_FAILED", a Postgres message) becomes "try again", with the
 * code kept in brackets so a screenshot still tells the team which one.
 */
export function placeOrderErrorMessage(msg = '') {
  if (/OUT_OF_STOCK/.test(msg)) return 'สินค้าหมดสต็อกแล้ว กรุณารีเฟรชหน้าและลองอีกครั้ง';
  // 0199/0202's refusals. Each names what the buyer can do about it.
  if (/PRODUCT_UNAVAILABLE/.test(msg)) return 'สินค้าบางชิ้นในตะกร้าปิดขายหรือหมดแล้ว กรุณาลบออกจากตะกร้าแล้วลองอีกครั้ง';
  if (/SIZE_UNAVAILABLE/.test(msg)) return 'ไซส์ของสินค้าบางชิ้นในตะกร้าไม่มีขายแล้ว กรุณาลบแล้วเลือกไซส์ใหม่';
  if (/COLOR_UNAVAILABLE/.test(msg)) return 'สีของสินค้าบางชิ้นในตะกร้าไม่มีขายแล้ว กรุณาลบแล้วเลือกสีใหม่';
  if (/NOT_YOUR_ORDER/.test(msg)) return 'กรุณาเข้าสู่ระบบใหม่อีกครั้ง แล้วสั่งซื้ออีกครั้ง';
  if (/NO_SLIP/.test(msg)) return 'กรุณาแนบสลิปก่อนสั่งซื้อ';
  if (/BAD_SLIP_URL/.test(msg)) return 'อัปโหลดสลิปไม่สมบูรณ์ กรุณาเลือกสลิปใหม่แล้วลองอีกครั้ง';
  if (/EMPTY_ORDER|INVALID_QTY/.test(msg)) return 'จำนวนสินค้าในตะกร้าไม่ถูกต้อง กรุณาตรวจตะกร้าแล้วลองอีกครั้ง';
  const code = String(msg).trim().slice(0, 80);
  return 'สั่งซื้อไม่สำเร็จ กรุณาลองอีกครั้ง' + (code ? ` (${code})` : '');
}

/** A write whose outcome is UNKNOWN: no answer at all (timeout, dropped
 *  connection), or a gateway 5xx — which can arrive after the database has
 *  committed. Neither may be reported as "it failed". */
export function isAmbiguousFailure(error) {
  return error?.status == null || Number(error.status) >= 500;
}

/** The caller's own order carrying this slip URL, or null. A slip URL is
 *  unique to one upload, so this identifies the order one attempt created. */
export async function findMyOrderBySlip(buyerId, slipUrl) {
  if (!buyerId || !slipUrl) return null;
  const { data, error } = await dbRest(
    `/shop_orders?buyer_id=eq.${encodeURIComponent(buyerId)}`
    + `&slip_url=eq.${encodeURIComponent(slipUrl)}&select=${ORDER_FIELDS}&limit=1`);
  if (error) throw new Error(error.message || 'lookup failed');
  return (data && data[0]) || null;
}

export async function placeShopOrder(payload) {
  const items = mapOrderItems(payload.items);
  const slips = payload.slipUrl
    ? [{ url: payload.slipUrl, at: payload.slipUploadedAt || new Date().toISOString() }]
    : [];
  // Phase-2 RPC (0034): per-item preorder snapshot + item_status, plus
  // buyer_phone + slips[] handled atomically inside the transaction.
  const { data, error } = await dbRest('/rpc/place_shop_order', {
    method: 'POST',
    // 15 s (the default) is short for a phone on campus wifi, and a timeout
    // here is the WORST failure: the order may be saved with the answer lost.
    timeout: 45000,
    body: {
      p_buyer_id:         payload.buyerId,
      p_buyer_label:      payload.buyerLabel || null,
      p_buyer_name:       payload.buyerName || null,
      p_buyer_email:      payload.buyerEmail || null,
      p_buyer_phone:      payload.buyerPhone || null,
      p_buyer_note:       payload.buyerNote || null,
      p_pickup_location:  payload.pickupLocation || null,
      p_slip_url:         payload.slipUrl || null,
      p_slip_uploaded_at: payload.slipUploadedAt || null,
      p_slips:            slips,
      p_items:            items,
      p_fee:              Number(payload.fee) || 0,
    },
  });
  if (error) {
    const msg = error.message || '';
    // No HTTP status = the request never got an answer (timeout, dropped
    // connection). The order may have been saved; say so, and let the caller
    // check (checkout's placeShopOrderOrFindIt) before offering a retry.
    if (isAmbiguousFailure(error)) {
      const err = new Error('การเชื่อมต่อขาดระหว่างสั่งซื้อ ระบบไม่แน่ใจว่าบันทึกแล้วหรือยัง '
        + 'กรุณาเปิดหน้า "คำสั่งซื้อของฉัน" ตรวจก่อนสั่งซ้ำ');
      err.ambiguous = true;
      throw err;
    }
    // 0034 not applied → the new (phone/slips) signature isn't found.
    // Fall back to the pre-0034 RPC + post-create enrichment, which in
    // turn falls back to legacy direct-insert if 0030 is also missing.
    if (error.status === 404 || /place_shop_order/i.test(msg)) {
      if (!window.__samoWarnedPlaceOrderRpc34) {
        window.__samoWarnedPlaceOrderRpc34 = true;
        console.warn('[shop] place_shop_order (0034 signature) missing — apply migration 0034. Using pre-0034 path.');
      }
      return placeShopOrderPre34(payload);
    }
    throw new Error(placeOrderErrorMessage(msg));
  }
  const orderId = typeof data === 'string' ? data : (Array.isArray(data) ? data[0] : data);
  if (!orderId) throw new Error('สั่งซื้อไม่สำเร็จ (ไม่ได้รับรหัสคำสั่งซื้อ)');
  const idEsc = encodeURIComponent(orderId);
  const { data: rows } = await dbRest(`/shop_orders?id=eq.${idEsc}&select=*`);
  return (rows && rows[0]) || { id: orderId };
}

/** Pre-0034 fallback: the 0030 atomic RPC (no phone/slips params) plus a
 *  follow-up owner PATCH to stamp phone + seed slips[]. Degrades again to
 *  legacy direct-insert if 0030 is also missing. */
async function placeShopOrderPre34(payload) {
  const items = mapOrderItems(payload.items);
  const { data, error } = await dbRest('/rpc/place_shop_order', {
    method: 'POST',
    body: {
      p_buyer_id:         payload.buyerId,
      p_buyer_label:      payload.buyerLabel || null,
      p_buyer_name:       payload.buyerName || null,
      p_buyer_email:      payload.buyerEmail || null,
      p_buyer_note:       payload.buyerNote || null,
      p_pickup_location:  payload.pickupLocation || null,
      p_slip_url:         payload.slipUrl || null,
      p_slip_uploaded_at: payload.slipUploadedAt || null,
      p_items:            items,
      p_fee:              Number(payload.fee) || 0,
    },
  });
  if (error) {
    const msg = error.message || '';
    if (error.status === 404 || /place_shop_order/i.test(msg)) {
      if (!window.__samoWarnedPlaceOrderRpc) {
        window.__samoWarnedPlaceOrderRpc = true;
        console.warn('[shop] place_shop_order RPC missing — apply migration 0030 for atomic stock checks. Using legacy direct-insert.');
      }
      return createOrder(payload);
    }
    throw new Error(placeOrderErrorMessage(msg));
  }
  const orderId = typeof data === 'string' ? data : (Array.isArray(data) ? data[0] : data);
  if (!orderId) throw new Error('สั่งซื้อไม่สำเร็จ (ไม่ได้รับรหัสคำสั่งซื้อ)');
  const enriched = await enrichNewOrder(orderId, payload);
  if (enriched) return enriched;
  const idEsc = encodeURIComponent(orderId);
  const { data: rows } = await dbRest(`/shop_orders?id=eq.${idEsc}&select=*`);
  return (rows && rows[0]) || { id: orderId };
}

/** Phase-1 enrichment after the atomic place_shop_order RPC: persist
 *  buyer_phone and seed the slips[] array. The 0030 RPC predates both
 *  columns, and changing its signature would 404 the whole call on
 *  envs that haven't applied migration 0034 — so we stamp them in a
 *  follow-up owner PATCH instead (RLS shop_orders_update_self_early
 *  allows it while the order is pending/review). Best-effort: a failure
 *  never undoes a successfully placed order. Returns the patched row, or
 *  null if nothing to stamp / the columns aren't deployed yet. */
async function enrichNewOrder(orderId, payload) {
  const patch = {};
  if (payload.buyerPhone) patch.buyer_phone = payload.buyerPhone;
  if (payload.slipUrl) {
    patch.slips = [{ url: payload.slipUrl, at: payload.slipUploadedAt || new Date().toISOString() }];
  }
  if (Object.keys(patch).length === 0) return null;
  const idEsc = encodeURIComponent(orderId);
  const { data, error } = await dbRest(
    `/shop_orders?id=eq.${idEsc}&select=*`,
    { method: 'PATCH', body: patch, prefer: 'return=representation' },
  );
  if (error) {
    // 0033 not applied yet → buyer_phone / slips missing. Warn once and
    // carry on; the order itself is already placed.
    if (/buyer_phone|slips|pgrst204/i.test(error.message || '')) {
      if (!window.__samoWarnedOrderPhoneSlips) {
        window.__samoWarnedOrderPhoneSlips = true;
        console.warn('[shop] buyer_phone/slips missing — apply migration 0033 to persist phone + multi-slip.');
      }
      return null;
    }
    console.warn('[shop] order enrichment PATCH failed:', error.message);
    return null;
  }
  return (Array.isArray(data) && data[0]) || null;
}

/** Admin-only: create an order on a buyer's behalf (walk-in / phone).
 *  Reuses the atomic place_shop_order RPC (SECURITY DEFINER, so it
 *  bypasses RLS for the insert and stamps per-item is_preorder +
 *  item_status). buyer_id is null — the order is admin-visible only. The
 *  pre-0034 / legacy fallback inside placeShopOrder inserts directly,
 *  which is why migration 0035 grants admin a shop_orders insert policy. */
export async function adminCreateOrder({ buyerName, buyerPhone, buyerEmail, buyerNote, items, code }) {
  return placeShopOrder({
    buyerId:        null,
    buyerLabel:     buyerName || 'ลูกค้า (admin สร้าง)',
    buyerName:      buyerName || null,
    buyerEmail:     buyerEmail || null,
    buyerPhone:     buyerPhone || null,
    buyerNote:      buyerNote || null,
    items,
    fee:            0,
    slipUrl:        null,
    slipUploadedAt: null,
    pickupLocation: null,
    code:           code || '',
  });
}

export async function upsertProduct(row) {
  if (!row || !row.id) throw new Error('product.id required');
  // Upsert with on_conflict so the same call works for create and update.
  const send = async (body) => dbRest(
    `/shop_products?on_conflict=id`,
    { method: 'POST', body, prefer: 'return=representation,resolution=merge-duplicates' },
  );
  let { data, error } = await send(row);
  // Pre-0029 fallback: preorder_price column not deployed yet. Strip
  // and retry so admin can still save the rest of the form. One-time
  // console warning so the missing migration is visible without
  // spamming on every save.
  if (error && error.status === 400 && /preorder_price/i.test(error.message || '')) {
    if (!window.__samoWarnedPreorderPriceCol) {
      window.__samoWarnedPreorderPriceCol = true;
      console.warn('[shop] preorder_price column missing — apply migration 0029_shop_preorder_price.sql to enable separate preorder pricing.');
    }
    const { preorder_price: _omit, ...rest } = row;
    ({ data, error } = await send(rest));
  }
  // Pre-0057 fallback: promptpay_qr_id / pickup_location_id not deployed yet.
  if (error && error.status === 400 && /promptpay_qr_id|pickup_location_id/i.test(error.message || '')) {
    warnMissing('shop_products.promptpay_qr_id/pickup_location_id', '0057_shop_catalog_config.sql');
    const { promptpay_qr_id: _q, pickup_location_id: _l, ...rest } = row;
    ({ data, error } = await send(rest));
  }
  if (error) throw new Error(error.message || 'บันทึกสินค้าไม่สำเร็จ');
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('บันทึกสินค้าไม่สำเร็จ (RLS หรือสิทธิ์ไม่พอ)');
  }
  return data[0];
}

/** Set a product's production status (pending / produced / announced)
 *  and cascade to every eligible happy-path order. Returns the RPC's
 *  summary row { updated_product, moved_to_produce, moved_to_ready }. */
export async function applyProductProductionStatus(productId, status) {
  const { data, error } = await dbRest('/rpc/apply_product_production_status', {
    method: 'POST',
    body: { p_product_id: productId, p_status: status },
  });
  if (error) {
    // Pre-0024 fallback: column / RPC missing → flip the field only,
    // skip the cascade (so admin can at least record intent until they
    // apply the migration).
    if (error.status === 404 || /apply_product_production_status/i.test(error.message || '')) {
      if (!window.__samoWarnedProdStatusRpc) {
        window.__samoWarnedProdStatusRpc = true;
        console.warn('[shop] apply_product_production_status RPC missing — apply migration 0024.');
      }
      throw new Error('ยังไม่ได้ติดตั้ง migration 0024 — กรุณาเรียก admin');
    }
    throw new Error(error.message || 'อัปเดตสถานะผลิตไม่สำเร็จ');
  }
  const row = Array.isArray(data) && data.length > 0 ? data[0] : null;
  return row || { updated_product: true, moved_to_produce: 0, moved_to_ready: 0 };
}

export async function deleteProduct(id) {
  const idEsc = encodeURIComponent(id);
  const { data, error } = await dbRest(
    `/shop_products?id=eq.${idEsc}`,
    { method: 'DELETE', prefer: 'return=representation' },
  );
  if (error) {
    // shop_order_items.product_id references shop_products(id) ON DELETE
    // RESTRICT (0003 schema): a product that appears in any order can't be
    // hard-deleted without destroying order history. PostgREST surfaces this
    // as Postgres error 23503. Throw a typed error so the caller can offer to
    // archive (is_active = false) instead — the FK guard makes the failed
    // DELETE a no-op, so nothing is half-deleted.
    if (/23503|shop_order_items_product_id_fkey/.test(error.message || '')) {
      const e = new Error('สินค้านี้มีประวัติการสั่งซื้อ จึงลบถาวรไม่ได้');
      e.code = 'PRODUCT_HAS_ORDERS';
      throw e;
    }
    throw new Error(error.message || 'ลบสินค้าไม่สำเร็จ');
  }
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('ลบสินค้าไม่สำเร็จ (RLS หรือไม่มีแถวที่ตรง id)');
  }
  return true;
}

// Archive (hide from the shop) instead of deleting — for products that have
// order history and so can't be hard-deleted. Sets is_active = false: the
// product disappears from public reads (shop_products_read = is_active OR
// admin) while staying visible to admins and keeping every order's FK intact.
// Same RLS as delete (shop_products_write_admin `for all`), so no auth change.
export async function archiveProduct(id) {
  const idEsc = encodeURIComponent(id);
  const { data, error } = await dbRest(
    `/shop_products?id=eq.${idEsc}`,
    { method: 'PATCH', body: { is_active: false }, prefer: 'return=representation' },
  );
  if (error) throw new Error(error.message || 'ปิดการขายไม่สำเร็จ');
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('ปิดการขายไม่สำเร็จ (RLS หรือไม่พบรายการ)');
  }
  return true;
}

// ---- Orders ------------------------------------------------------------

const ORDER_FIELDS = '*,items:shop_order_items(*)';

export async function listMyOrders(buyerId) {
  if (!buyerId) return [];
  const idEsc = encodeURIComponent(buyerId);
  const { data, error } = await dbRest(
    `/shop_orders?select=${ORDER_FIELDS}&buyer_id=eq.${idEsc}&order=placed_at.desc`,
  );
  if (error) throw new Error(error.message || 'โหลดคำสั่งซื้อไม่สำเร็จ');
  return data || [];
}

/** Every order, in pages. PostgREST caps one response (1,000 rows by
 *  default) WITHOUT saying so — past it the oldest orders fell off the admin
 *  table, counts, CSV and stock numbers, and a pickup scan of one said "not
 *  found". `id` breaks placed_at ties so no row straddles two pages. */
export async function listAllOrders() {
  const PAGE = 1000;
  const all = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await dbRest(
      `/shop_orders?select=${ORDER_FIELDS}&order=placed_at.desc,id.asc&limit=${PAGE}&offset=${offset}`,
    );
    if (error) throw new Error(error.message || 'โหลดคำสั่งซื้อไม่สำเร็จ');
    all.push(...(data || []));
    if (!data || data.length < PAGE) return all;
  }
}

export async function getOrder(id) {
  const idEsc = encodeURIComponent(id);
  const { data, error } = await dbRest(
    `/shop_orders?select=${ORDER_FIELDS}&id=eq.${idEsc}`,
  );
  if (error) throw new Error(error.message || 'โหลดคำสั่งซื้อไม่สำเร็จ');
  return (data && data[0]) || null;
}

/**
 * Create a new order header + items in two REST calls. On insert collision
 * (id already exists, ~1/100k) we retry with a fresh id once.
 *
 * @param {{
 *   buyerId: string, buyerLabel: string,
 *   items: Array<{productId,size,color,fit,qty,price}>,
 *   subtotal: number, fee?: number,
 *   slipUrl: string, slipUploadedAt: string,
 *   pickupLocation: string, buyerNote: string,
 * }} payload
 */
export async function createOrder(payload) {
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    // Order id prefix = first cart item's product.code (set by admin
    // in the product editor). Falls back to "SH" inside genOrderId
    // when nothing usable is supplied.
    const id = genOrderId(payload.code);
    const now = new Date().toISOString();
    const subtotal = Number(payload.subtotal) || 0;
    const fee = Number(payload.fee) || 0;
    const orderRow = {
      id,
      buyer_id: payload.buyerId,
      buyer_label: payload.buyerLabel || null,
      // buyer_name / buyer_email arrived in migration 0026. If the
      // migration isn't applied yet PostgREST errors PGRST204; the
      // retry below strips these and re-sends.
      ...(payload.buyerName  ? { buyer_name:  payload.buyerName  } : {}),
      ...(payload.buyerEmail ? { buyer_email: payload.buyerEmail } : {}),
      ...(payload.buyerPhone ? { buyer_phone: payload.buyerPhone } : {}),
      status: payload.slipUrl ? 'review' : 'pending',
      subtotal,
      fee,
      total: subtotal + fee,
      slip_url: payload.slipUrl || null,
      slip_uploaded_at: payload.slipUploadedAt || null,
      ...(payload.slipUrl
        ? { slips: [{ url: payload.slipUrl, at: payload.slipUploadedAt || now }] }
        : {}),
      pickup_location: payload.pickupLocation || null,
      buyer_note: payload.buyerNote || null,
      timeline: [
        { stage: 'pending', at: now, label: 'รอชำระเงิน' },
        ...(payload.slipUrl ? [{ stage: 'review', at: now, label: 'ส่งสลิปแล้ว — รอตรวจ' }] : []),
      ],
      placed_at: now,
    };
    let { data: orderData, error: orderErr } = await dbRest(
      '/shop_orders',
      { method: 'POST', body: orderRow, prefer: 'return=representation' },
    );
    if (orderErr) {
      const msg = (orderErr.message || '').toLowerCase();
      // Migration 0026/0033 not applied → buyer_name / buyer_email /
      // buyer_phone / slips missing. Drop them and retry once so the
      // order can still be placed.
      if (/buyer_(name|email|phone)|slips/.test(msg) || /pgrst204/.test(msg)) {
        if (!window.__samoWarnedBuyerContact) {
          window.__samoWarnedBuyerContact = true;
          console.warn('[shop] buyer contact/slips columns missing — apply migrations 0026 + 0033 to persist checkout contact + multi-slip.');
        }
        const { buyer_name, buyer_email, buyer_phone, slips, ...slim } = orderRow;
        ({ data: orderData, error: orderErr } = await dbRest(
          '/shop_orders',
          { method: 'POST', body: slim, prefer: 'return=representation' },
        ));
      }
    }
    if (orderErr) {
      // Unique violation? retry with a new id.
      const msg = (orderErr.message || '').toLowerCase();
      if (msg.includes('duplicate') || msg.includes('unique')) { lastErr = orderErr; continue; }
      throw new Error(orderErr.message || 'สร้างคำสั่งซื้อไม่สำเร็จ');
    }
    if (!Array.isArray(orderData) || orderData.length === 0) {
      throw new Error('สร้างคำสั่งซื้อไม่สำเร็จ (RLS หรือสิทธิ์ไม่พอ)');
    }

    // Items
    const itemRows = (payload.items || []).map((it) => ({
      order_id: id,
      product_id: it.productId,
      size: it.size || 'F',
      color: it.color || null,
      fit: it.fit || 'unisex',
      qty: Number(it.qty) || 1,
      unit_price: Number(it.price) || 0,
    }));
    if (itemRows.length) {
      const { data: itemData, error: itemErr } = await dbRest(
        '/shop_order_items',
        { method: 'POST', body: itemRows, prefer: 'return=representation' },
      );
      if (itemErr) {
        // Roll back the order header so we don't leave an orphan.
        await dbRest(`/shop_orders?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => {});
        throw new Error(itemErr.message || 'บันทึกรายการสินค้าไม่สำเร็จ');
      }
      if (!Array.isArray(itemData) || itemData.length !== itemRows.length) {
        await dbRest(`/shop_orders?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => {});
        throw new Error('บันทึกรายการสินค้าไม่สำเร็จ');
      }
    }
    return orderData[0];
  }
  throw new Error(lastErr?.message || 'สร้างคำสั่งซื้อไม่สำเร็จ (เลขซ้ำ)');
}

/**
 * Update an order's status (and append a timeline entry). Admin-only by RLS.
 */
export const ORDER_CHANGED_MESSAGE = 'คำสั่งซื้อนี้เปลี่ยนไปแล้ว (มีสลิปใหม่หรือ admin คนอื่นจัดการแล้ว) — โหลดใหม่แล้วตรวจอีกครั้ง';

/** `extra.expectUpdatedAt`: write ONLY if the order is still exactly the one
 *  the admin was looking at. The verify queue approves from a list loaded
 *  earlier; without this, "อนุมัติ" overwrote another admin's decision, or
 *  approved an order whose buyer had since added a different slip. */
export async function updateOrderStatus(id, nextStatus, extra = {}) {
  const current = await getOrder(id);
  if (!current) throw new Error('ไม่พบคำสั่งซื้อ');
  if (extra.expectUpdatedAt && current.updated_at !== extra.expectUpdatedAt) {
    throw new Error(ORDER_CHANGED_MESSAGE);
  }
  const now = new Date().toISOString();
  const timeline = Array.isArray(current.timeline) ? current.timeline.slice() : [];
  timeline.push({
    stage: nextStatus,
    at: now,
    label: extra.label || nextStatus,
    by: extra.by || 'admin',
  });
  const idEsc = encodeURIComponent(id);
  const guard = extra.expectUpdatedAt
    ? `&updated_at=eq.${encodeURIComponent(extra.expectUpdatedAt)}` : '';
  const { data, error } = await dbRest(
    `/shop_orders?id=eq.${idEsc}${guard}`,
    {
      method: 'PATCH',
      body: {
        status: nextStatus,
        timeline,
        ...(extra.pickupBatchId !== undefined ? { pickup_batch_id: extra.pickupBatchId } : {}),
        ...(extra.adminNote !== undefined ? { admin_note: extra.adminNote } : {}),
        ...(extra.cancelReason !== undefined ? { cancel_reason: extra.cancelReason } : {}),
      },
      prefer: 'return=representation',
    },
  );
  if (error) throw new Error(error.message || 'อัปเดตสถานะไม่สำเร็จ');
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error(guard ? ORDER_CHANGED_MESSAGE : 'อัปเดตสถานะไม่สำเร็จ (RLS หรือสิทธิ์ไม่พอ)');
  }
  return data[0];
}

/** Admin-only: hard-delete an order, and trash the attached slip image
 *  from Drive in the same flow. RLS policy `shop_orders_delete_admin`
 *  from 0003 gates the row delete to shop admins.
 *
 *  Order of operations:
 *    1. Fetch the order to capture slip_url (we lose it after delete).
 *    2. DELETE the row (the authoritative state change).
 *    3. Trash the Drive file via the GAS proxy. Best-effort — a Drive
 *       blip here MUST NOT roll back the order delete, because the row
 *       is already gone and re-creating it is hard. The slip file would
 *       just orphan until manual cleanup.
 *  Drive uses "trash" (30-day undo) instead of purge — easier to recover
 *  if an admin deletes the wrong order. */
export async function deleteOrder(id) {
  const idEsc = encodeURIComponent(id);
  const existing = await getOrder(id);
  // EVERY slip, not just the newest: an order can carry several (a second
  // transfer, a clearer re-take), and each is a public image of a bank slip.
  const slipUrls = [...new Set(normalizeSlips(existing).map((s) => s.url))];
  const { data, error } = await dbRest(
    `/shop_orders?id=eq.${idEsc}`,
    { method: 'DELETE', prefer: 'return=representation' },
  );
  if (error) throw new Error(error.message || 'ลบคำสั่งซื้อไม่สำเร็จ');
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('ลบไม่สำเร็จ — ไม่พบคำสั่งซื้อหรือคุณไม่มีสิทธิ์ลบ');
  }
  // Fire-and-forget slip trash. Caller doesn't await it; we still log
  // a warning if it fails so admin can spot orphans in Drive later.
  for (const slipUrl of slipUrls) {
    deleteShopFile(slipUrl).then((ok) => {
      if (!ok) console.warn('[shop/api] order', id, 'deleted but slip not trashed:', slipUrl);
    });
  }
  return true;
}

/** Normalise an order's slips into an array of { url, at }, folding the
 *  legacy single slip_url in when the array is still empty (orders placed
 *  before migration 0033, or pre-enrichment). */
function normalizeSlips(order) {
  const arr = Array.isArray(order?.slips) ? order.slips.slice() : [];
  if (arr.length === 0 && order?.slip_url) {
    arr.push({ url: order.slip_url, at: order.slip_uploaded_at || order.placed_at || null });
  }
  return arr.filter((s) => s && s.url);
}

/** Buyer-facing: ADD a slip to a pending/review/slip_mismatch order.
 *  Appends to the slips[] array, mirrors slip_url to the newest, and
 *  sends the order back to 'review' so it reappears in the admin verify
 *  queue. Multiple slips are kept — we no longer trash the prior one. */
/** Buyer-facing: correct the CONTACT on your own order.
 *
 *  Only `buyer_email` and `buyer_phone` are sent, and the database agrees:
 *  `shop_orders_self_update_guard` whitelists exactly these two contact columns
 *  for a buyer self-update (migration 0150 added the email; the phone was
 *  already there), and the RLS policy limits it to pending / review /
 *  slip_mismatch. Sending anything else here raises P0001 rather than silently
 *  writing — which is the point of the guard.
 *
 *  `return=representation` + a length check, because PostgREST answers an
 *  RLS-blocked UPDATE with 0 rows and NO error — reporting success on an empty
 *  array is the silent-failure shape this repo has paid for repeatedly. */
export async function updateOrderContact(id, { email, phone }) {
  const idEsc = encodeURIComponent(id);
  const body = {};
  if (email !== undefined) body.buyer_email = (email || '').trim().toLowerCase() || null;
  if (phone !== undefined) body.buyer_phone = (phone || '').trim() || null;
  const { data, error } = await dbRest(
    `/shop_orders?id=eq.${idEsc}`,
    { method: 'PATCH', body, prefer: 'return=representation' },
  );
  if (error) throw new Error(error.message || 'บันทึกข้อมูลติดต่อไม่สำเร็จ');
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('บันทึกไม่สำเร็จ — แก้ไขได้เฉพาะคำสั่งซื้อที่ยังไม่ได้ตรวจสลิป');
  }
  return data[0];
}

/** Statuses in which a buyer may still change their slips (RLS agrees). */
const BUYER_SLIP_STATUSES = ['pending', 'review', 'slip_mismatch'];
export const SLIP_LOCKED_MESSAGE = 'คำสั่งซื้อนี้ตรวจสลิปแล้ว แก้ไขสลิปไม่ได้ กรุณาโหลดหน้าใหม่';

/**
 * Buyer slip edits read the order, change the slips array, and write it back.
 * Two of those at once (a phone and a laptop, two taps) used to overwrite one
 * another. The PATCH is now conditional on `updated_at` still being what was
 * read; on a miss the edit is re-built from a fresh read, once.
 * `build(current)` returns the PATCH body.
 */
async function patchOwnOrderSlips(id, build) {
  const idEsc = encodeURIComponent(id);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const current = await getOrder(id);
    if (!current) throw new Error('ไม่พบคำสั่งซื้อ');
    if (!BUYER_SLIP_STATUSES.includes(current.status)) throw new Error(SLIP_LOCKED_MESSAGE);
    const { data, error } = await dbRest(
      `/shop_orders?id=eq.${idEsc}&updated_at=eq.${encodeURIComponent(current.updated_at)}`,
      { method: 'PATCH', body: build(current), prefer: 'return=representation' },
    );
    if (error) {
      const err = new Error(isAmbiguousFailure(error)
        ? 'การเชื่อมต่อขาด กรุณาโหลดหน้าใหม่เพื่อตรวจว่าบันทึกแล้วหรือยัง'
        : (error.message || 'บันทึกไม่สำเร็จ'));
      err.ambiguous = isAmbiguousFailure(error);
      throw err;
    }
    if (Array.isArray(data) && data.length) return data[0];
    // 0 rows: changed since we read it (or no longer ours to change) — re-read.
  }
  throw new Error(SLIP_LOCKED_MESSAGE);
}

export async function addOrderSlip(id, slipUrl) {
  return patchOwnOrderSlips(id, (current) => {
    const now = new Date().toISOString();
    const slips = normalizeSlips(current);
    slips.push({ url: slipUrl, at: now });
    const timeline = Array.isArray(current.timeline) ? current.timeline.slice() : [];
    timeline.push({ stage: 'review', at: now, label: 'ส่งสลิปแล้ว — รอตรวจ' });
    return { slips, slip_url: slipUrl, slip_uploaded_at: now, status: 'review', timeline };
  });
}

/** Buyer-facing: REMOVE one slip (by url) from a pending/review/
 *  slip_mismatch order. slip_url is re-pointed to the newest remaining
 *  slip (or null). If no slips remain, the order drops back to 'pending'
 *  so it leaves the verify queue. The removed file is trashed from Drive
 *  (best-effort). */
export async function removeOrderSlip(id, slipUrl) {
  const row = await patchOwnOrderSlips(id, (current) => {
    const now = new Date().toISOString();
    const remaining = normalizeSlips(current).filter((s) => s.url !== slipUrl);
    const latest = remaining.length ? remaining[remaining.length - 1] : null;
    const body = {
      slips: remaining,
      slip_url: latest ? latest.url : null,
      slip_uploaded_at: latest ? latest.at : null,
    };
    if (remaining.length === 0 && ['review', 'slip_mismatch'].includes(current.status)) {
      body.status = 'pending';
      const timeline = Array.isArray(current.timeline) ? current.timeline.slice() : [];
      timeline.push({ stage: 'pending', at: now, label: 'ลบสลิปแล้ว — รอชำระเงิน' });
      body.timeline = timeline;
    }
    return body;
  });
  if (slipUrl) {
    deleteShopFile(slipUrl).then((ok) => {
      if (!ok) console.warn('[shop/api] order', id, 'slip removed but not trashed:', slipUrl);
    });
  }
  return row;
}

/** Admin-only: set ONE line item's fulfilment status (paid / produce /
 *  ready / done / issue) and append an item_timeline entry.
 *  shop_order_items_write_admin (0003) gates the write. Returns the
 *  updated item row. */
export async function setOrderItemStatus(itemId, status, { label, currentTimeline } = {}) {
  const now = new Date().toISOString();
  const timeline = Array.isArray(currentTimeline) ? currentTimeline.slice() : [];
  timeline.push({ stage: status, at: now, label: label || status, by: 'admin' });
  const idEsc = encodeURIComponent(itemId);
  const { data, error } = await dbRest(
    `/shop_order_items?id=eq.${idEsc}`,
    {
      method: 'PATCH',
      body: { item_status: status, item_timeline: timeline },
      prefer: 'return=representation',
    },
  );
  if (error) {
    if (/item_status|item_timeline|pgrst204/i.test(error.message || '')) {
      throw new Error('ยังไม่ได้ติดตั้ง migration 0033 — กรุณาเรียก admin');
    }
    throw new Error(error.message || 'อัปเดตสถานะสินค้าไม่สำเร็จ');
  }
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('อัปเดตสถานะสินค้าไม่สำเร็จ (RLS หรือไม่พบรายการ)');
  }
  return data[0];
}

/** Admin-only: add a line item to an existing order. Stock is "reflected"
 *  automatically because the reserved-matrix aggregates derive from
 *  shop_order_items — no separate stock write needed. Caller should then
 *  recomputeOrderTotals(). */
export async function addOrderItem(orderId, item) {
  const row = {
    order_id:   orderId,
    product_id: item.productId,
    size:       item.size || 'F',
    color:      item.color || 'default',
    fit:        item.fit || 'unisex',
    qty:        Number(item.qty) || 1,
    unit_price: Number(item.unitPrice) || 0,
    is_preorder: !!item.isPreorder,
    item_status: item.itemStatus || 'paid',
  };
  const { data, error } = await dbRest('/shop_order_items', {
    method: 'POST', body: row, prefer: 'return=representation',
  });
  if (error) throw new Error(error.message || 'เพิ่มสินค้าไม่สำเร็จ');
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('เพิ่มสินค้าไม่สำเร็จ (RLS หรือสิทธิ์ไม่พอ)');
  }
  return data[0];
}

/** Admin-only: edit a line item (qty / size / color / unit_price /
 *  is_preorder). */
export async function updateOrderItem(itemId, patch) {
  const body = {};
  if (patch.qty != null)         body.qty = Number(patch.qty);
  if (patch.size != null)        body.size = patch.size;
  if (patch.color != null)       body.color = patch.color;
  if (patch.unit_price != null)  body.unit_price = Number(patch.unit_price);
  if (patch.is_preorder != null) body.is_preorder = !!patch.is_preorder;
  const idEsc = encodeURIComponent(itemId);
  const { data, error } = await dbRest(
    `/shop_order_items?id=eq.${idEsc}`,
    { method: 'PATCH', body, prefer: 'return=representation' },
  );
  if (error) throw new Error(error.message || 'แก้ไขสินค้าไม่สำเร็จ');
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('แก้ไขสินค้าไม่สำเร็จ (RLS หรือไม่พบรายการ)');
  }
  return data[0];
}

/** Admin-only: remove a line item from an order. */
export async function removeOrderItem(itemId) {
  const idEsc = encodeURIComponent(itemId);
  const { data, error } = await dbRest(
    `/shop_order_items?id=eq.${idEsc}`,
    { method: 'DELETE', prefer: 'return=representation' },
  );
  if (error) throw new Error(error.message || 'ลบสินค้าไม่สำเร็จ');
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('ลบสินค้าไม่สำเร็จ (RLS หรือไม่พบรายการ)');
  }
  return true;
}

/** Recompute + persist an order's subtotal/total from its current items
 *  (+ existing fee). Call after any add/edit/remove of line items. */
export async function recomputeOrderTotals(orderId) {
  const order = await getOrder(orderId);
  if (!order) throw new Error('ไม่พบคำสั่งซื้อ');
  const items = Array.isArray(order.items) ? order.items : [];
  const subtotal = items.reduce(
    (s, it) => s + (Number(it.unit_price) || 0) * (Number(it.qty) || 0), 0);
  const fee = Number(order.fee) || 0;
  const total = subtotal + fee;
  const idEsc = encodeURIComponent(orderId);
  const { data, error } = await dbRest(
    `/shop_orders?id=eq.${idEsc}`,
    { method: 'PATCH', body: { subtotal, total }, prefer: 'return=representation' },
  );
  if (error) throw new Error(error.message || 'อัปเดตยอดรวมไม่สำเร็จ');
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('อัปเดตยอดรวมไม่สำเร็จ (RLS หรือสิทธิ์ไม่พอ)');
  }
  return { subtotal, total };
}

// ---- Pickup batches ----------------------------------------------------

export async function listActiveBatches() {
  const { data, error } = await dbRest(
    '/shop_pickup_batches?select=*&is_active=eq.true&order=created_at.desc',
  );
  if (error) throw new Error(error.message || 'โหลดประกาศไม่สำเร็จ');
  return data || [];
}

export async function listAllBatches() {
  const { data, error } = await dbRest(
    '/shop_pickup_batches?select=*&order=created_at.desc',
  );
  if (error) throw new Error(error.message || 'โหลดประกาศไม่สำเร็จ');
  return data || [];
}

export async function upsertBatch(row) {
  const isUpdate = row.id != null;
  const body = { ...row };
  const path = isUpdate
    ? `/shop_pickup_batches?id=eq.${encodeURIComponent(row.id)}`
    : '/shop_pickup_batches';
  const method = isUpdate ? 'PATCH' : 'POST';
  if (!isUpdate) delete body.id;
  const { data, error } = await dbRest(path, {
    method,
    body,
    prefer: 'return=representation',
  });
  if (error) throw new Error(error.message || 'บันทึกประกาศไม่สำเร็จ');
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('บันทึกประกาศไม่สำเร็จ (RLS หรือสิทธิ์ไม่พอ)');
  }
  return data[0];
}

export async function closeBatch(id) {
  return upsertBatch({ id, is_active: false });
}

// ---- Shop banners (admin-curated landing carousel) ---------------------

/** Public-readable list of banners. activeOnly defaults to true — the
 *  customer-facing carousel hides retired banners; the admin tab passes
 *  false to manage everything. */
export async function listShopBanners({ activeOnly = true, placement = null } = {}) {
  const params = ['select=*', 'order=display_order.asc,created_at.desc'];
  if (activeOnly) params.push('is_active=eq.true');
  // placement filter (migration 0037). Omitted = all placements, so the
  // customer fetch can partition client-side in one round-trip.
  if (placement) params.push(`placement=eq.${encodeURIComponent(placement)}`);
  const { data, error } = await dbRest(`/shop_banners?${params.join('&')}`);
  if (error) {
    // Pre-0019/0037: table or placement column missing. Treat as "no
    // banners" so the carousel just falls back to its product fallback.
    if (error.status === 404 || error.status === 400 || /shop_banners|placement/i.test(error.message || '')) {
      if (!window.__samoWarnedBanners) {
        window.__samoWarnedBanners = true;
        console.warn('[shop] shop_banners missing — apply migration 0019_shop_banners.sql.');
      }
      return [];
    }
    throw new Error(error.message || 'โหลดแบนเนอร์ไม่สำเร็จ');
  }
  return data || [];
}

export async function createShopBanner(row) {
  const { data, error } = await dbRest('/shop_banners', {
    method: 'POST', body: row, prefer: 'return=representation',
  });
  if (error) throw new Error(error.message || 'เพิ่มแบนเนอร์ไม่สำเร็จ');
  return Array.isArray(data) ? data[0] : data;
}

export async function updateShopBanner(id, patch) {
  const idEsc = encodeURIComponent(id);
  const { data, error } = await dbRest(
    `/shop_banners?id=eq.${idEsc}`,
    { method: 'PATCH', body: patch, prefer: 'return=representation' },
  );
  if (error) throw new Error(error.message || 'อัปเดตแบนเนอร์ไม่สำเร็จ');
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('ไม่พบแบนเนอร์หรือคุณไม่มีสิทธิ์แก้ไข');
  }
  return data[0];
}

export async function deleteShopBanner(id) {
  const idEsc = encodeURIComponent(id);
  const { data, error } = await dbRest(
    `/shop_banners?id=eq.${idEsc}`,
    { method: 'DELETE', prefer: 'return=representation' },
  );
  if (error) throw new Error(error.message || 'ลบแบนเนอร์ไม่สำเร็จ');
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('ไม่พบแบนเนอร์หรือคุณไม่มีสิทธิ์ลบ');
  }
  return true;
}

/** Persist a new ordering. orderedIds[0] is the topmost (display_order=0).
 *  PATCH-per-row; for ~10 banners this is fast enough. */
export async function reorderShopBanners(orderedIds) {
  for (let i = 0; i < orderedIds.length; i += 1) {
    await updateShopBanner(orderedIds[i], { display_order: i });
  }
}

// ---- Pickup records (delivery checklist) -------------------------------

export async function listPickupRecordsForOrder(orderId) {
  const idEsc = encodeURIComponent(orderId);
  const { data, error } = await dbRest(
    `/shop_pickup_records?select=*&order_id=eq.${idEsc}&order=created_at.asc`,
  );
  if (error) throw new Error(error.message || 'โหลดบันทึกการรับสินค้าไม่สำเร็จ');
  return data || [];
}

export async function listPickupRecords({ orderIds } = {}) {
  let q = '/shop_pickup_records?select=*&order=created_at.desc';
  if (Array.isArray(orderIds) && orderIds.length) {
    const inList = orderIds.map((id) => `"${id}"`).join(',');
    q += `&order_id=in.(${encodeURIComponent(inList)})`;
  }
  const { data, error } = await dbRest(q);
  if (error) throw new Error(error.message || 'โหลดบันทึกการรับสินค้าไม่สำเร็จ');
  return data || [];
}

/**
 * Insert (or upsert by order_item_id) a pickup record. If the item was
 * already marked picked-up we merge the new fields (e.g. an issue logged
 * later). Caller passes `recipient_name`, optional `issue_type`/`issue_note`,
 * and admin uid.
 */
export async function upsertPickupRecord(row) {
  if (!row || !row.order_id || !row.order_item_id) {
    throw new Error('order_id + order_item_id required');
  }
  const { data, error } = await dbRest(
    `/shop_pickup_records?on_conflict=order_item_id`,
    {
      method: 'POST',
      body: row,
      prefer: 'return=representation,resolution=merge-duplicates',
    },
  );
  if (error) throw new Error(error.message || 'บันทึกการรับสินค้าไม่สำเร็จ');
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('บันทึกการรับสินค้าไม่สำเร็จ (RLS หรือสิทธิ์ไม่พอ)');
  }
  return data[0];
}

export async function resolvePickupIssue(id, resolution) {
  const idEsc = encodeURIComponent(id);
  const { data, error } = await dbRest(
    `/shop_pickup_records?id=eq.${idEsc}`,
    {
      method: 'PATCH',
      body: { resolution, resolved_at: new Date().toISOString() },
      prefer: 'return=representation',
    },
  );
  if (error) throw new Error(error.message || 'บันทึกการแก้ไขไม่สำเร็จ');
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('บันทึกการแก้ไขไม่สำเร็จ');
  }
  return data[0];
}

export async function deletePickupRecord(id) {
  const idEsc = encodeURIComponent(id);
  const { data, error } = await dbRest(
    `/shop_pickup_records?id=eq.${idEsc}`,
    { method: 'DELETE', prefer: 'return=representation' },
  );
  if (error) throw new Error(error.message || 'ลบบันทึกไม่สำเร็จ');
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('ลบบันทึกไม่สำเร็จ');
  }
  return true;
}

// ---- Settings ----------------------------------------------------------

export async function getSettings() {
  const { data, error } = await dbRest('/shop_settings?id=eq.1&select=*');
  if (error) throw new Error(error.message || 'โหลดการตั้งค่าไม่สำเร็จ');
  return (data && data[0]) || null;
}

export async function saveSettings(patch) {
  const { data, error } = await dbRest(
    '/shop_settings?id=eq.1',
    { method: 'PATCH', body: patch, prefer: 'return=representation' },
  );
  if (error) throw new Error(error.message || 'บันทึกการตั้งค่าไม่สำเร็จ');
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('บันทึกการตั้งค่าไม่สำเร็จ (RLS หรือสิทธิ์ไม่พอ)');
  }
  return data[0];
}

// ---- Product types (migration 0057) ------------------------------------
// Was the static SHOP_TYPES array; now admin-managed. `type` on a product
// stays loose text, so a type row is a picker source, not an FK target.

export async function listProductTypes({ activeOnly = false } = {}) {
  const filter = activeOnly ? '&is_active=eq.true' : '';
  const { data, error } = await dbRest(
    `/shop_product_types?select=*${filter}&order=sort_order.asc,label.asc`,
  );
  if (error) {
    // Pre-0057: table missing. Callers fall back to the built-in SHOP_TYPES.
    if (error.status === 404 || error.status === 400 || /shop_product_types/i.test(error.message || '')) {
      warnMissing('shop_product_types', '0057_shop_catalog_config.sql');
      return [];
    }
    throw new Error(error.message || 'โหลดประเภทสินค้าไม่สำเร็จ');
  }
  return data || [];
}

export async function upsertProductType(row) {
  if (!row || !row.id) throw new Error('type.id required');
  const { data, error } = await dbRest(
    '/shop_product_types?on_conflict=id',
    { method: 'POST', body: row, prefer: 'return=representation,resolution=merge-duplicates' },
  );
  if (error) throw new Error(error.message || 'บันทึกประเภทสินค้าไม่สำเร็จ');
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('บันทึกประเภทสินค้าไม่สำเร็จ (RLS หรือสิทธิ์ไม่พอ)');
  }
  return data[0];
}

// `return=representation` + a length check on every DELETE: an RLS-blocked
// DELETE returns 204 with zero rows and no error, so `if (error)` alone reports
// success and the row reappears on reload (mistakes.md, "silent-success on
// RLS-blocked deletes"). deleteProduct/deleteBanner above already do this.
export async function deleteProductType(id) {
  const { data, error } = await dbRest(
    `/shop_product_types?id=eq.${encodeURIComponent(id)}`,
    { method: 'DELETE', prefer: 'return=representation' },
  );
  if (error) throw new Error(error.message || 'ลบประเภทสินค้าไม่สำเร็จ');
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('ลบประเภทสินค้าไม่สำเร็จ — ไม่พบรายการ หรือคุณไม่มีสิทธิ์ลบ');
  }
  return true;
}

// ---- PromptPay QRs (migration 0057) ------------------------------------
// A managed list of PromptPay accounts. A product with null promptpay_qr_id
// falls back to the single is_default row.

export async function listPromptpayQrs({ activeOnly = false } = {}) {
  const filter = activeOnly ? '&is_active=eq.true' : '';
  const { data, error } = await dbRest(
    `/shop_promptpay_qrs?select=*${filter}&order=is_default.desc,sort_order.asc,id.asc`,
  );
  if (error) {
    if (error.status === 404 || error.status === 400 || /shop_promptpay_qrs/i.test(error.message || '')) {
      warnMissing('shop_promptpay_qrs', '0057_shop_catalog_config.sql');
      return [];
    }
    throw new Error(error.message || 'โหลดบัญชี PromptPay ไม่สำเร็จ');
  }
  return data || [];
}

export async function upsertPromptpayQr(row) {
  const isUpdate = row.id != null;
  const body = { ...row };
  if (!isUpdate) delete body.id;
  const path = isUpdate
    ? `/shop_promptpay_qrs?id=eq.${encodeURIComponent(row.id)}`
    : '/shop_promptpay_qrs';
  const { data, error } = await dbRest(path, {
    method: isUpdate ? 'PATCH' : 'POST',
    body,
    prefer: 'return=representation',
  });
  if (error) throw new Error(error.message || 'บันทึกบัญชี PromptPay ไม่สำเร็จ');
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('บันทึกบัญชี PromptPay ไม่สำเร็จ (RLS หรือสิทธิ์ไม่พอ)');
  }
  return data[0];
}

export async function deletePromptpayQr(id) {
  const { data, error } = await dbRest(
    `/shop_promptpay_qrs?id=eq.${encodeURIComponent(id)}`,
    { method: 'DELETE', prefer: 'return=representation' },
  );
  if (error) throw new Error(error.message || 'ลบบัญชี PromptPay ไม่สำเร็จ');
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('ลบบัญชี PromptPay ไม่สำเร็จ — ไม่พบรายการ หรือคุณไม่มีสิทธิ์ลบ');
  }
  return true;
}

/** Make one QR the default. Clears is_default on all others first (the
 *  partial unique index allows only one true), then sets this one. */
export async function setDefaultQr(id) {
  // Clear any existing default(s).
  const clear = await dbRest(
    '/shop_promptpay_qrs?is_default=eq.true',
    { method: 'PATCH', body: { is_default: false } },
  );
  if (clear.error) throw new Error(clear.error.message || 'ตั้งค่าเริ่มต้นไม่สำเร็จ');
  const { data, error } = await dbRest(
    `/shop_promptpay_qrs?id=eq.${encodeURIComponent(id)}`,
    { method: 'PATCH', body: { is_default: true }, prefer: 'return=representation' },
  );
  if (error) throw new Error(error.message || 'ตั้งค่าเริ่มต้นไม่สำเร็จ');
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('ตั้งค่าเริ่มต้นไม่สำเร็จ (RLS หรือสิทธิ์ไม่พอ)');
  }
  return data[0];
}

// ---- Pickup locations (migration 0057) ---------------------------------

export async function listPickupLocations({ activeOnly = false } = {}) {
  const filter = activeOnly ? '&is_active=eq.true' : '';
  const { data, error } = await dbRest(
    `/shop_pickup_locations?select=*${filter}&order=sort_order.asc,label.asc`,
  );
  if (error) {
    if (error.status === 404 || error.status === 400 || /shop_pickup_locations/i.test(error.message || '')) {
      warnMissing('shop_pickup_locations', '0057_shop_catalog_config.sql');
      return [];
    }
    throw new Error(error.message || 'โหลดสถานที่รับสินค้าไม่สำเร็จ');
  }
  return data || [];
}

export async function upsertPickupLocation(row) {
  const isUpdate = row.id != null;
  const body = { ...row };
  if (!isUpdate) delete body.id;
  const path = isUpdate
    ? `/shop_pickup_locations?id=eq.${encodeURIComponent(row.id)}`
    : '/shop_pickup_locations';
  const { data, error } = await dbRest(path, {
    method: isUpdate ? 'PATCH' : 'POST',
    body,
    prefer: 'return=representation',
  });
  if (error) throw new Error(error.message || 'บันทึกสถานที่รับสินค้าไม่สำเร็จ');
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('บันทึกสถานที่รับสินค้าไม่สำเร็จ (RLS หรือสิทธิ์ไม่พอ)');
  }
  return data[0];
}

export async function deletePickupLocation(id) {
  const { data, error } = await dbRest(
    `/shop_pickup_locations?id=eq.${encodeURIComponent(id)}`,
    { method: 'DELETE', prefer: 'return=representation' },
  );
  if (error) throw new Error(error.message || 'ลบสถานที่รับสินค้าไม่สำเร็จ');
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('ลบสถานที่รับสินค้าไม่สำเร็จ — ไม่พบรายการ หรือคุณไม่มีสิทธิ์ลบ');
  }
  return true;
}

/** One-time console warning that a catalog-config table is missing (the
 *  0057 migration hasn't been applied). Keeps the shop working on the old
 *  hardcoded defaults instead of hard-failing. */
function warnMissing(table, migration) {
  const key = `__samoWarned_${table}`;
  if (window[key]) return;
  window[key] = true;
  console.warn(`[shop] ${table} missing — apply migration ${migration} to enable catalog config.`);
}
