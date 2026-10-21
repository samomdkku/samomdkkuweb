// ==============================================
// SHOP ADMIN — Stock (fast at-a-glance size × colour editor). Split out
// of admin.js (task 19 — maintainability).
// ==============================================

import { escHtml } from '../utils.js';
import { dbRest } from '../db.js';
import { STOCK_STATUSES, STOCK_STATUS_META, stockKey, totalStock, takesPreorderSlot } from './data.js';
import { listProducts, listAllOrders, applyProductProductionStatus } from './api.js';
import { showShopToast } from './products.js';
import { state, setOrders } from './admin.js';
import { renderOrdersTable, modalOrder, reloadModalOrderFromServer } from './admin-orders.js';
import { maybeConfirmCascade } from './admin-products.js';

// ---------------------------------------------------------------------
// Stock — fast at-a-glance editor
//
// Each product is a card with image + name + total-stock pill + status,
// and an inline size×color grid where each cell has +/- buttons and a
// direct-input number. Empty = unspecified, 0 = OOS, ≤3 yellow, ≥1 green.
// "บันทึก" per card writes only stock_matrix + stock_status (not image).
// ---------------------------------------------------------------------
export async function refreshStock() {
  try {
    // Pull products AND orders — the per-product sales summary in the
    // stock card uses the orders list to count "reserved" / "delivered"
    // / "outstanding" so admin can size the next production run without
    // doing the math by hand.
    const [products, orders] = await Promise.all([
      listProducts({ activeOnly: false }),
      (!state.orders || state.orders.length === 0)
        ? listAllOrders().catch(() => [])
        : Promise.resolve(state.orders),
    ]);
    state.products = products;
    if (orders && orders.length) setOrders(orders);
    // Keep only UNSAVED edits for products that still exist. An untouched
    // entry is just a copy of old numbers: kept, it showed stale stock and,
    // after one + on any cell, saved that whole stale grid back.
    for (const [id, edit] of Array.from(state.stockEdits.entries())) {
      if (!edit.dirty || !state.products.find((p) => p.id === id)) state.stockEdits.delete(id);
    }
    renderStock();
  } catch (e) {
    showShopToast(`โหลดสินค้าล้มเหลว: ${e.message || e}`, 'error');
  }
}

// Order-level statuses that consume stock — uploaded slip onward, until
// the order completes. A cancelled order frees its qty from the reserved
// bucket. (A per-item 'issue' / มีปัญหา does NOT free stock — its order
// stays 'paid', so it keeps counting here.)
const RESERVED_STATUSES = new Set(['review', 'paid', 'produce', 'ready', 'done']);

/** Aggregate the order qty for a product across the orders cache,
 *  bucketed so admin can read the per-product stock-vs-demand state
 *  at a glance:
 *    reserved    = qty in any happy-path status (RESERVED_STATUSES)
 *    delivered   = qty in 'done' specifically
 *    outstanding = reserved - delivered (paid-for, not yet picked up) */
function computeProductSales(productId) {
  const orders = Array.isArray(state.orders) ? state.orders : [];
  // PREORDER (0209): the grid is the size of the production run, so every
  // preorder item counts until its order is cancelled — delivered too.
  // `taken` is what the headline subtracts from the grid.
  if (state.products.find((x) => x.id === productId)?.is_presale) {
    let taken = 0, delivered = 0;
    for (const o of orders) {
      for (const it of (o.items || [])) {
        if (it.product_id !== productId || !takesPreorderSlot(o, it)) continue;
        const q = Number(it.qty) || 0;
        taken += q;
        if (o.status === 'done' || it.item_status === 'done') delivered += q;
      }
    }
    return { reserved: taken, delivered, outstanding: taken - delivered, taken, preorder: true };
  }
  let reserved = 0, delivered = 0;
  for (const o of orders) {
    if (!RESERVED_STATUSES.has(o.status)) continue;
    for (const it of (o.items || [])) {
      if (it.product_id !== productId) continue;
      // Preorder is made-to-order — it doesn't reserve finite stock
      // (matches migration 0038's reserved-matrix predicate).
      if (it.is_preorder) continue;
      const q = Number(it.qty) || 0;
      reserved += q;
      if (o.status === 'done') delivered += q;
    }
  }
  return { reserved, delivered, outstanding: reserved - delivered, taken: reserved - delivered, preorder: false };
}

/** Same accounting, but bucketed per variant (size + color). Returns
 *  a Map keyed by `${productId}|${size}|${color}` → qty so the stock
 *  matrix render can lookup in O(1). Items missing size default to 'F';
 *  missing color defaults to 'default' — matches stockKey(). */
function computeVariantReservedMap() {
  // One map per TABLE (0210), whatever the product is set to right now, so a
  // card can show both tables with their own numbers:
  //   in-stock table — non-preorder items of a reserving order (0038);
  //   preorder table — preorder items until their order is cancelled (0209).
  const orders = Array.isArray(state.orders) ? state.orders : [];
  const out = { stock_matrix: new Map(), preorder_stock_matrix: new Map() };
  for (const o of orders) {
    for (const it of (o.items || [])) {
      let into = null;
      if (it.is_preorder) { if (takesPreorderSlot(o, it)) into = out.preorder_stock_matrix; }
      else if (RESERVED_STATUSES.has(o.status)) into = out.stock_matrix;
      if (!into) continue;
      const size  = it.size  || 'F';
      const color = it.color || 'default';
      const key = `${it.product_id}|${size}|${color}`;
      into.set(key, (into.get(key) || 0) + (Number(it.qty) || 0));
    }
  }
  return out;
}

/** Production-status dropdown handler on the stock card. Same
 *  confirmation + RPC + toast pattern the product editor uses. */
async function onStockProductionStatusChange(sel) {
  const productId = sel.dataset.stockProductionSel;
  const p = state.products.find((x) => x.id === productId);
  if (!p) return;
  const previous = p.production_status || 'pending';
  const next = sel.value;
  if (next === previous) return;
  const confirmed = await maybeConfirmCascade(next);
  if (!confirmed) {
    // Revert the picker — user backed out of the cascade dialog.
    sel.value = previous;
    return;
  }
  sel.disabled = true;
  try {
    const r = await applyProductProductionStatus(productId, next);
    p.production_status = next;
    const moved = (r.moved_to_produce || 0) + (r.moved_to_ready || 0);
    if (moved > 0) {
      showShopToast(`เปลี่ยนสถานะ + ย้าย ${moved} คำสั่งซื้อแล้ว`, 'success');
    } else {
      showShopToast('เปลี่ยนสถานะแล้ว', 'success');
    }
    // Refresh orders so the per-product sales summary + per-item
    // progress (item_status cascaded by the RPC) reflect the moves.
    setOrders(await listAllOrders().catch(() => state.orders));
    renderStock();
    renderOrdersTable();
    if (modalOrder) await reloadModalOrderFromServer();
  } catch (e) {
    showShopToast(`สถานะผลิตอัปเดตไม่สำเร็จ: ${e.message || e}`, 'error');
    sel.value = previous;
  } finally {
    sel.disabled = false;
  }
}

function getStockEditState(p) {
  let edit = state.stockEdits.get(p.id);
  if (!edit) {
    // Both tables (0210). `touched` = the tables this card changed; only
    // those are saved, so an untouched table is never written back stale.
    edit = {
      matrices: {
        stock_matrix: { ...(p.stock_matrix || {}) },
        preorder_stock_matrix: { ...(p.preorder_stock_matrix || {}) },
      },
      touched: new Set(),
      status: p.stock_status || 'available',
      dirty: false,
    };
    state.stockEdits.set(p.id, edit);
  }
  return edit;
}

export function renderStock() {
  const host = document.getElementById('shopAdminStockHost');
  if (!host) return;
  const q = state.stockSearch;
  let list = state.products.slice();
  if (q) list = list.filter((p) => `${p.name} ${p.sub || ''} ${p.id}`.toLowerCase().includes(q));

  if (list.length === 0) {
    host.innerHTML = `<div class="empty-state"><i class="bi bi-search"></i><h4>ไม่พบสินค้า</h4></div>`;
    return;
  }

  // Precompute reserved-per-variant once for the whole tab so we don't
  // walk state.orders per cell. Re-used in stockCardHtml for the per-
  // cell badge + the "available" computation.
  const reservedMap = computeVariantReservedMap();
  host.innerHTML = list.map((p) => stockCardHtml(p, reservedMap)).join('');

  host.querySelectorAll('[data-stock-cell]').forEach((input) => {
    // `input` only syncs state + enables Save — it MUST NOT re-render,
    // or the focused field is destroyed and the mobile keyboard dismisses
    // after a single keystroke. We deliberately don't re-render on blur
    // either: doing so eats the subsequent Save-button tap on touch. The
    // derived numbers (พร้อมขาย / เหลือ / จอง) refresh on the next natural
    // render — Save, the +/- step buttons, or a tab switch.
    input.addEventListener('input', () => onStockCellInput(input));
  });
  host.querySelectorAll('[data-stock-step]').forEach((btn) => {
    btn.addEventListener('click', () => stepStock(btn));
  });
  host.querySelectorAll('[data-stock-status-sel]').forEach((sel) => {
    sel.addEventListener('change', () => {
      const p = state.products.find((x) => x.id === sel.dataset.stockStatusSel);
      if (!p) return;
      const edit = getStockEditState(p);
      edit.status = sel.value;
      edit.dirty = true;
      renderStock();
    });
  });
  host.querySelectorAll('[data-stock-production-sel]').forEach((sel) => {
    sel.addEventListener('change', () => onStockProductionStatusChange(sel));
  });
  host.querySelectorAll('[data-stock-save]').forEach((btn) => {
    btn.addEventListener('click', () => saveStock(btn.dataset.stockSave));
  });
  host.querySelectorAll('[data-stock-cancel]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.stockEdits.delete(btn.dataset.stockCancel);
      renderStock();
    });
  });
}

const STOCK_TABLES = {
  stock_matrix: {
    label: 'สต็อกพร้อมส่ง', when: 'ใช้เมื่อไม่ได้ติ๊ก Preorder',
    hint: 'ช่อง = ของในคลัง · ใต้ช่อง = พร้อมขาย (คลัง − จอง) · ติดลบ = ขายเกิน',
  },
  preorder_stock_matrix: {
    label: 'จำนวนรับ Preorder', when: 'ใช้เมื่อติ๊ก Preorder',
    hint: 'ช่อง = จำนวนที่เปิดรับ · ใต้ช่อง = รับได้อีก (เปิดรับ − สั่งแล้ว) · ยกเลิกออเดอร์ = คืนจำนวน · เว้นว่างทั้งตาราง = รับไม่จำกัด',
  },
};

function stockCardHtml(p, reservedMaps = {}) {
  const edit = getStockEditState(p);
  const active = p.is_presale ? 'preorder_stock_matrix' : 'stock_matrix';
  const total = totalStock(edit.matrices[active]);
  const statusMeta = STOCK_STATUS_META[edit.status] || STOCK_STATUS_META.available;
  const sales = computeProductSales(p.id);
  const prod = p.production_status || 'pending';
  return `
    <div class="stock-card ${edit.dirty ? 'is-dirty' : ''}">
      <div class="stock-card-head">
        <div class="stock-card-thumb" style="${stockThumbStyle(p)}"></div>
        <div class="flex-grow-1" style="min-width:0;">
          <div class="d-flex align-items-center gap-2 flex-wrap">
            <h5 class="mb-0 font-prompt" style="font-weight:700;">${escHtml(p.name)}</h5>
            <span class="badge ${statusMeta.badgeCls}">${escHtml(statusMeta.label)}</span>
            ${edit.dirty ? '<span class="badge bg-warning-subtle text-warning border">มีการแก้ไขที่ยังไม่บันทึก</span>' : ''}
          </div>
          <div class="small text-muted">${escHtml(p.sub || '')}</div>
        </div>
        <div class="d-flex flex-column align-items-end gap-1" style="min-width:160px;">
          ${total === null ? `
            <span class="stock-total is-unset">— ยังไม่ตั้งสต็อก —</span>
          ` : (() => {
            const available = total - sales.taken;
            const cls = available < 0 ? 'is-over'
              : available === 0 ? 'is-zero'
              : available <= 5 ? 'is-low'
              : 'is-ok';
            return `<span class="stock-available-headline ${cls}">
              ${sales.preorder ? 'รับพรีออเดอร์ได้อีก' : 'พร้อมขาย'} <b>${available}</b> ชิ้น
            </span>`;
          })()}
          <select class="form-select form-select-sm" data-stock-status-sel="${escHtml(p.id)}" style="max-width:200px;">
            ${STOCK_STATUSES.map((s) =>
              `<option value="${s}" ${edit.status === s ? 'selected' : ''}>${escHtml(STOCK_STATUS_META[s]?.label || s)}</option>`).join('')}
          </select>
        </div>
      </div>

      <!-- Compact secondary line: the supporting numbers behind the
           "พร้อมขาย" headline. Lets admin see at a glance whether the
           number went down because of recent orders or shipments. -->
      ${total !== null ? `
        <div class="stock-sales-summary small text-muted mb-2">
          ${sales.preorder ? `
          เปิดรับพรีออเดอร์ <b>${total}</b>
          · สั่งแล้ว <b>${sales.taken}</b>
          · ส่งมอบแล้ว <b>${sales.delivered}</b>
          <span class="text-muted small ms-1">(ยกเลิกออเดอร์ = คืนจำนวน)</span>
          ` : `
          ในคลังรวม <b>${total}</b>
          · ลูกค้าจองอยู่ <b>${sales.outstanding}</b>${sales.outstanding > 0 ? `<span class="text-muted small ms-1">(ยังไม่ส่งมอบ)</span>` : ''}
          · ส่งมอบแล้ว <b>${sales.delivered}</b>
          `}
        </div>
      ` : ''}

      <!-- Production-status cascade — same control as the product
           editor. The detailed explanation lives in the product editor;
           here we keep just the dropdown so admin can flip it quickly.
           A small (i) tooltip hints at the cascade behaviour without
           the full paragraph. -->
      <div class="d-flex align-items-center gap-2 mb-2">
        <label class="small fw-semibold mb-0 me-1">สถานะผลิต:</label>
        <select class="form-select form-select-sm" data-stock-production-sel="${escHtml(p.id)}" style="max-width:280px;">
          <option value="pending"   ${prod === 'pending'   ? 'selected' : ''}>ยังไม่ผลิต</option>
          <option value="produced"  ${prod === 'produced'  ? 'selected' : ''}>ผลิตเสร็จแล้ว</option>
          <option value="announced" ${prod === 'announced' ? 'selected' : ''}>ประกาศรับสินค้า</option>
        </select>
        <i class="bi bi-info-circle text-muted" tabindex="0"
           title='"ผลิตเสร็จแล้ว" ย้ายออเดอร์ "ยืนยันชำระเงิน" → "ผลิตเสร็จ" / "ประกาศรับสินค้า" ย้ายต่อไป "ประกาศแล้ว" / สถานะปัญหาไม่ถูกแตะ'></i>
      </div>
      ${[active, active === 'stock_matrix' ? 'preorder_stock_matrix' : 'stock_matrix']
        .map((field) => stockGridHtml(p, edit, field, reservedMaps[field] || new Map(), field === active)).join('')}
      <div class="stock-card-foot">
        <div></div>
        <div class="d-flex gap-2">
          ${edit.dirty ? `<button class="btn btn-ghost btn-sm" data-stock-cancel="${escHtml(p.id)}">ยกเลิก</button>` : ''}
          <button class="btn btn-shop btn-sm ${edit.dirty ? '' : 'disabled'}" data-stock-save="${escHtml(p.id)}" ${edit.dirty ? '' : 'disabled'}>
            <i class="bi bi-save me-1"></i> บันทึก
          </button>
        </div>
      </div>
    </div>`;
}

/** One table of a stock card. The table in use comes first and full colour;
 *  the other is dimmed but stays editable, with its own เหลือ / จอง. */
function stockGridHtml(p, edit, field, reservedMap, isActive) {
  const meta = STOCK_TABLES[field];
  const matrix = edit.matrices[field];
  const sizes = (p.sizes && p.sizes.length) ? p.sizes : ['F'];
  const colors = (p.colors && p.colors.length) ? p.colors : [{ id: 'default', label: 'มาตรฐาน', hex: '#ccc' }];
  const cell = (k) => `${escHtml(p.id)}|${field}|${escHtml(k)}`;
  return `
      <div class="stock-table ${isActive ? 'is-active' : 'is-inactive'}">
        <div class="small fw-semibold mb-1 ${isActive ? '' : 'text-muted'}" style="padding: 0 1rem;">
          ตาราง: ${meta.label}
          <span class="badge ${isActive ? 'bg-success-subtle text-success' : 'bg-light text-muted'} border ms-1">${isActive ? 'ใช้อยู่ตอนนี้' : meta.when}</span>
        </div>
        <div class="stock-grid">
          <table class="stock-grid-table">
            <thead>
              <tr>
                <th></th>
                ${sizes.map((s) => `<th>${escHtml(s)}</th>`).join('')}
              </tr>
            </thead>
            <tbody>
              ${colors.map((c) => `
                <tr>
                  <th>
                    <span class="stock-color-swatch" style="background:${escHtml(c.hex || '#ccc')};"></span>
                    ${escHtml(c.label || c.id)}
                  </th>
                  ${sizes.map((s) => {
                    const k = stockKey(s, c.id);
                    const v = matrix[k];
                    // Taken from THIS table by live orders; cancelling frees it.
                    const reserved = reservedMap.get(`${p.id}|${s}|${c.id}`) || 0;
                    // Null when nothing is typed. Negative = over-sold.
                    const available = typeof v === 'number' ? v - reserved : null;
                    const wrapCls = v === undefined ? 'is-unset'
                      : v === 0 ? 'is-zero'
                      : v <= 3 ? 'is-low'
                      : 'is-ok';
                    const overSold = available !== null && available < 0;
                    return `
                      <td class="stock-cell-td">
                        <div class="stock-cell-wrap ${wrapCls} ${overSold ? 'is-over' : ''}">
                          <button type="button" class="stock-step" data-stock-step="${cell(k)}|-1" title="ลด 1">−</button>
                          <input class="stock-cell" data-stock-cell="${cell(k)}" inputmode="numeric"
                                 value="${v === undefined ? '' : Number(v)}" placeholder="–" />
                          <button type="button" class="stock-step" data-stock-step="${cell(k)}|+1" title="เพิ่ม 1">+</button>
                        </div>
                        ${available !== null ? `
                          <div class="stock-cell-avail ${overSold ? 'is-over' : available === 0 ? 'is-zero' : available <= 3 ? 'is-low' : 'is-ok'}">
                            เหลือ ${available}
                          </div>` : ''}
                        ${reserved > 0 ? `<div class="stock-cell-reserved">จอง ${reserved}</div>` : ''}
                      </td>`;
                  }).join('')}
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
        <div class="small text-muted mb-2" style="padding: .25rem 1rem 0;">
          <i class="bi bi-info-circle me-1"></i>${meta.hint}
        </div>
      </div>`;
}

function stockThumbStyle(p) {
  if (p?.image_url) return `background-image: url('${escHtml(p.image_url)}'); background-size: cover; background-position: center;`;
  const h = Number(p?.hue) || 220;
  return `background: repeating-linear-gradient(135deg, hsl(${h} 30% 96%) 0 4px, hsl(${h} 28% 90%) 4px 8px);`;
}

/** Live keystroke handler — updates the pending edit + enables Save
 *  WITHOUT re-rendering, so the focused input (and the mobile keyboard)
 *  survive. The full derived-number refresh happens on blur (`change`). */
function onStockCellInput(input) {
  const [pid, field, key] = input.dataset.stockCell.split('|');
  const p = state.products.find((x) => x.id === pid);
  if (!p || !STOCK_TABLES[field]) return;
  const edit = getStockEditState(p);
  const raw = input.value.trim();
  if (raw === '') { delete edit.matrices[field][key]; }
  else {
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) return;
    edit.matrices[field][key] = Math.floor(n);
  }
  edit.touched.add(field);
  edit.dirty = true;
  // Enable Save + flag the card dirty in place (no re-render → no focus loss).
  input.closest('.stock-card')?.classList.add('is-dirty');
  const save = document.querySelector(`[data-stock-save="${CSS.escape(pid)}"]`);
  if (save) { save.classList.remove('disabled'); save.removeAttribute('disabled'); }
}

function stepStock(btn) {
  const [pid, field, key, deltaStr] = btn.dataset.stockStep.split('|');
  const p = state.products.find((x) => x.id === pid);
  if (!p || !STOCK_TABLES[field]) return;
  const edit = getStockEditState(p);
  const cur = edit.matrices[field][key];
  const delta = Number(deltaStr);
  const next = Math.max(0, (typeof cur === 'number' ? cur : 0) + delta);
  edit.matrices[field][key] = next;
  edit.touched.add(field);
  edit.dirty = true;
  renderStock();
}

async function saveStock(productId) {
  const p = state.products.find((x) => x.id === productId);
  if (!p) return;
  const edit = state.stockEdits.get(productId);
  if (!edit || !edit.dirty) return;
  try {
    const { data, error } = await dbRest(
      `/shop_products?id=eq.${encodeURIComponent(productId)}`,
      {
        method: 'PATCH',
        body: {
          stock_status: edit.status,
          ...Object.fromEntries([...edit.touched].map((f) => [f, edit.matrices[f]])),
        },
        prefer: 'return=representation',
      },
    );
    if (error) throw new Error(error.message || 'บันทึกล้มเหลว');
    if (!Array.isArray(data) || data.length === 0) {
      throw new Error('บันทึกล้มเหลว (RLS หรือสิทธิ์ไม่พอ)');
    }
    // Reflect into local cache + clear dirty flag
    for (const f of edit.touched) p[f] = edit.matrices[f];
    p.stock_status = edit.status;
    state.stockEdits.delete(productId);
    showShopToast(`บันทึก "${p.name}" แล้ว`, 'success');
    renderStock();
  } catch (e) {
    showShopToast(`บันทึกล้มเหลว: ${e.message || e}`, 'error');
  }
}

