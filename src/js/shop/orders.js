// ==============================================
// SHOP ORDERS — My Orders view
//
// Shows the signed-in user's orders with a timeline + filter chips.
// Pickup callout + contact-fallback appear for orders in 'ready' state.
// ==============================================

import { escHtml, safeUrl, orderIdChipHtml } from '../utils.js';
import { getUser } from '../auth.js';
import {
  thb, fmtDateTime, STAGES_ORDER, STAGES_META, statusMetaFor, batchDateEntries,
  rollupOrderStage, ITEM_STAGES_ORDER, itemStatusMeta,
} from './data.js';
import { listMyOrders, listActiveBatches, getSettings, addOrderSlip, removeOrderSlip, updateOrderContact, getOrder } from './api.js';
import { ensureProductsLoaded, getProductMap } from './cart.js';
import { uploadShopFile, deleteShopFile, slipFolderForNow, SLIP_MAX_EDGE, prepareSlip } from './uploads.js';
import { showShopToast } from './products.js';
import { showOrderQrModal } from './qr.js';

const state = {
  orders: [],
  batches: [],
  contact: { gmail: '', instagram: '' },
  filter: 'all',
  loaded: false,
};

// Customer orders view has no filter chips — most users have a
// handful of orders and scroll-to-find is faster than tap-to-filter.
// The state.filter field is kept so external callers (sub-nav badges)
// don't break, but render() always shows everything.

export async function mountOrdersView() {
  // Re-upload slip flow for slip_mismatch orders. Delegated to the
  // orders-list container so the handler survives every re-render.
  const list = document.getElementById('shopOrdersList');
  // "Show QR" button → opens the customer QR modal for that order.
  if (list && !list.dataset.qrBound) {
    list.dataset.qrBound = '1';
    list.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-show-qr]');
      if (!btn) return;
      e.preventDefault();
      const o = state.orders.find((x) => x.id === btn.dataset.showQr);
      if (o) showOrderQrModal(o);
    });
  }
  // Inline contact correction. Delegated to the list so it survives re-renders,
  // and INLINE rather than a dialog: this repo forbids native prompt() (it is
  // silently suppressed by Chrome after a few uses, which made buttons look
  // dead), and a whole modal for two fields the card is already showing is more
  // ceremony than the edit deserves.
  if (list && !list.dataset.contactBound) {
    list.dataset.contactBound = '1';
    list.addEventListener('click', async (e) => {
      const openBtn = e.target.closest('[data-edit-contact]');
      if (openBtn) {
        const o = state.orders.find((x) => x.id === openBtn.dataset.editContact);
        if (o) openContactEditor(openBtn.closest('.order-contact'), o);
        return;
      }
      const cancel = e.target.closest('[data-contact-cancel]');
      if (cancel) { render(); return; }
      const save = e.target.closest('[data-contact-save]');
      if (!save) return;
      const wrap = save.closest('.order-contact');
      const id = save.dataset.contactSave;
      const email = wrap.querySelector('[data-contact-email]')?.value || '';
      const phone = wrap.querySelector('[data-contact-phone]')?.value || '';
      if (!email.trim() || !phone.trim()) {
        showShopToast('กรอกอีเมลและเบอร์โทรศัพท์ให้ครบ', 'warn');
        return;
      }
      save.disabled = true;
      const original = save.textContent;
      save.textContent = 'กำลังบันทึก...';
      try {
        const row = await updateOrderContact(id, { email, phone });
        const o = state.orders.find((x) => x.id === id);
        if (o) { o.buyer_email = row.buyer_email; o.buyer_phone = row.buyer_phone; }
        showShopToast('บันทึกข้อมูลติดต่อแล้ว', 'success');
        render();
      } catch (err) {
        showShopToast(err.message || 'บันทึกไม่สำเร็จ', 'warn');
        save.disabled = false;
        save.textContent = original;
      }
    });
  }

  if (list && !list.dataset.reuploadBound) {
    list.dataset.reuploadBound = '1';
    list.addEventListener('click', async (e) => {
      const addBtn = e.target.closest('[data-add-slip-order]');
      if (addBtn) {
        const orderId = addBtn.dataset.addSlipOrder;
        const input = list.querySelector(`input[data-slip-file="${CSS.escape(orderId)}"]`);
        input?.click();
        return;
      }
      const rmBtn = e.target.closest('[data-remove-slip]');
      if (rmBtn) {
        e.preventDefault();
        await handleSlipRemove(rmBtn.dataset.removeSlipOrder, rmBtn.dataset.removeSlip, rmBtn);
      }
    });
    list.addEventListener('change', async (e) => {
      const input = e.target.closest('input[data-slip-file]');
      if (!input) return;
      const orderId = input.dataset.slipFile;
      const file = input.files && input.files[0];
      input.value = '';
      if (!file) return;
      await handleSlipAdd(orderId, file);
    });
  }
}

/** Swap the contact row for its editor, in place. */
function openContactEditor(wrap, o) {
  if (!wrap) return;
  wrap.innerHTML = `
    <div class="order-contact-form">
      <div class="oc-title">แก้ไขช่องทางติดต่อ</div>
      <label class="oc-label" for="ocEmail-${escHtml(o.id)}">อีเมล</label>
      <input class="form-control form-control-sm" id="ocEmail-${escHtml(o.id)}" type="email"
             data-contact-email value="${escHtml(o.buyer_email || '')}" autocomplete="email" />
      <label class="oc-label" for="ocPhone-${escHtml(o.id)}">เบอร์โทรศัพท์</label>
      <input class="form-control form-control-sm" id="ocPhone-${escHtml(o.id)}" type="tel"
             data-contact-phone value="${escHtml(o.buyer_phone || '')}" autocomplete="tel" inputmode="tel" />
      <div class="oc-actions">
        <button type="button" class="btn btn-sm btn-shop" data-contact-save="${escHtml(o.id)}">บันทึก</button>
        <button type="button" class="btn btn-sm btn-link" data-contact-cancel>ยกเลิก</button>
      </div>
    </div>`;
  wrap.querySelector('[data-contact-email]')?.focus();
}

/** Read the order's slips as an array of { url, at }, folding in the
 *  legacy single slip when the array is empty. Mirrors api.js. */
function orderSlips(o) {
  const arr = Array.isArray(o?.slips) ? o.slips.slice() : [];
  if (arr.length === 0 && o?.slip_url) {
    arr.push({ url: o.slip_url, at: o.slip_uploaded_at || o.placed_at || null });
  }
  return arr.filter((s) => s && s.url);
}

async function handleSlipAdd(orderId, picked) {
  let file;
  try {
    file = await prepareSlip(picked);   // copy, check it opens, shrink — at pick time
  } catch (err) {
    showShopToast(err.message, 'error');
    return;
  }
  const user = getUser();
  if (!user) { showShopToast('กรุณาเข้าสู่ระบบก่อน', 'warn'); return; }
  const btn = document.querySelector(`[data-add-slip-order="${CSS.escape(orderId)}"]`);
  const originalHTML = btn?.innerHTML;
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>กำลังอัปโหลด…';
  }
  let slipUrl = null;
  try {
    const ext = (file.name.match(/\.(\w+)$/)?.[1] || 'jpg').toLowerCase();
    const slipName = `${user.id}_${Date.now()}.${ext}`;
    const folder = slipFolderForNow(new Date());
    slipUrl = await uploadShopFile(file, folder, { fileName: slipName, maxEdge: SLIP_MAX_EDGE });
    await addOrderSlip(orderId, slipUrl);
    showShopToast('เพิ่มสลิปแล้ว — รอ admin ตรวจสอบ', 'success');
    await renderOrdersView();
  } catch (err) {
    console.error('[shop/orders] add slip failed:', err);
    // Uploaded but not attached (the order moved on, or the write was refused):
    // that file is a public picture of a bank slip nothing points at. Trash it.
    // Not on a dropped connection — the slip may have been attached after all.
    // Unsure (dropped / 5xx): trash only after a re-read shows it NOT attached.
    if (slipUrl) {
      const attached = err?.ambiguous
        ? await getOrder(orderId).then((o) => (o?.slips || []).some((x) => x?.url === slipUrl) || o?.slip_url === slipUrl)
          .catch(() => true)          // cannot tell → keep it
        : false;
      if (!attached) deleteShopFile(slipUrl);
    }
    showShopToast(`ส่งสลิปไม่สำเร็จ: ${err.message || err}`, 'error');
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalHTML || '<i class="bi bi-cloud-upload me-1"></i> เพิ่มสลิป';
    }
    // The order may have moved on (paid) — show its real state, not a stale button.
    renderOrdersView().catch(() => {});
  }
}

async function handleSlipRemove(orderId, slipUrl, btn) {
  if (!orderId || !slipUrl) return;
  if (btn) { btn.disabled = true; btn.classList.add('disabled'); }
  try {
    await removeOrderSlip(orderId, slipUrl);
    showShopToast('ลบสลิปแล้ว', 'success');
    await renderOrdersView();
  } catch (err) {
    console.error('[shop/orders] remove slip failed:', err);
    showShopToast(`ลบสลิปไม่สำเร็จ: ${err.message || err}`, 'error');
    if (btn) { btn.disabled = false; btn.classList.remove('disabled'); }
  }
}

/** Show / refresh. Called when the orders sub-nav is activated. */
export async function renderOrdersView() {
  const user = getUser();
  const gate = document.getElementById('shopOrdersAuthGate');
  if (!user) {
    if (gate) gate.classList.remove('d-none');
    document.getElementById('shopOrdersList').innerHTML = '';
    document.getElementById('shopOrdersFilterRow').innerHTML = '';
    document.getElementById('shopOrdersEmpty')?.classList.add('d-none');
    document.getElementById('shopOrdersReadyCount')?.classList.add('d-none');
    return;
  }
  if (gate) gate.classList.add('d-none');

  await ensureProductsLoaded();
  try {
    const [orders, batches, settings] = await Promise.all([
      listMyOrders(user.id),
      listActiveBatches().catch(() => []),
      getSettings().catch(() => null),
    ]);
    state.orders = orders;
    state.batches = batches || [];
    if (settings) {
      state.contact = {
        gmail: settings.contact_gmail || '',
        instagram: settings.contact_instagram || '',
      };
    }
    state.loaded = true;
    render();
  } catch (e) {
    console.error('[shop/orders] load failed:', e);
    document.getElementById('shopOrdersList').innerHTML =
      `<div class="text-danger small p-3">โหลดคำสั่งซื้อล้มเหลว: ${escHtml(e.message || e)}</div>`;
  }
}

/** Render just the ready-count pill in the sub-nav (called by index.js after load). */
export function refreshReadyCountBadge() {
  const badge = document.getElementById('shopOrdersReadyCount');
  if (!badge) return;
  const ready = state.orders.filter((o) => hasReadyItem(o)).length;
  badge.textContent = String(ready);
  badge.classList.toggle('d-none', ready === 0);
}

function render() {
  const row = document.getElementById('shopOrdersFilterRow');
  const list = document.getElementById('shopOrdersList');
  const empty = document.getElementById('shopOrdersEmpty');
  if (!list || !empty) return;

  // Drop the filter chip row entirely (per UX request).
  if (row) row.innerHTML = '';

  empty.classList.toggle('d-none', state.orders.length > 0);
  list.innerHTML = state.orders.map(orderCardHtml).join('');

  refreshReadyCountBadge();
}

function orderCardHtml(o) {
  const items = Array.isArray(o.items) ? o.items : [];
  const total = items.reduce((s, it) => s + (Number(it.unit_price) || 0) * (Number(it.qty) || 0), 0) + (Number(o.fee) || 0);
  const totalQty = items.reduce((s, it) => s + (Number(it.qty) || 0), 0);
  const batch = o.pickup_batch_id ? state.batches.find((b) => b.id === o.pickup_batch_id) : null;
  const products = getProductMap();

  return `
    <div class="order-card" data-status="${escHtml(o.status)}">
      <div class="order-head">
        <div class="d-flex flex-column">
          <span class="order-id">${orderIdChipHtml(o.id)}</span>
          <span class="order-date">สั่งเมื่อ ${fmtDateTime(o.placed_at)}</span>
        </div>
        ${statusPillHtml(o)}
      </div>

      ${o.customer_note ? `
        <div class="order-customer-note">
          <i class="bi bi-chat-left-text"></i>
          <div>
            <div class="ocn-title">หมายเหตุจากเจ้าหน้าที่</div>
            <div class="ocn-body">${escHtml(o.customer_note)}</div>
          </div>
        </div>` : ''}

      ${itemsProgressHtml(o, products)}

      <div class="d-flex justify-content-between align-items-center mt-3 flex-wrap gap-2">
        <div class="d-flex flex-wrap gap-3 align-items-center">
          <span class="text-muted small">${totalQty} ชิ้น</span>
          <button type="button" class="btn btn-link p-0 small text-decoration-none"
                  data-show-qr="${escHtml(o.id)}">
            <i class="bi bi-qr-code me-1"></i> แสดง QR
          </button>
          ${(() => {
            const slips = orderSlips(o);
            if (!slips.length) return '';
            const latest = slips[slips.length - 1];
            return `
            <a href="${safeUrl(latest.url)}" target="_blank" rel="noreferrer" class="small text-decoration-none">
              <i class="bi bi-receipt me-1"></i> ดูสลิปที่ส่ง${slips.length > 1 ? ` (${slips.length})` : ''}
            </a>`;
          })()}
          ${o.cancel_reason ? `<span class="small text-danger"><i class="bi bi-info-circle me-1"></i>${escHtml(o.cancel_reason)}</span>` : ''}
        </div>
        <span style="font-weight:700; font-size:1.05rem; font-family:Prompt;">
          รวม ฿${thb(total)}
        </span>
      </div>

      ${hasReadyItem(o) && batch ? `
        <div class="order-pickup-callout">
          <i class="bi bi-box-seam"></i>
          <div>
            <div class="opc-title">พร้อมรับสินค้าแล้ว · ${escHtml(batch.location)}</div>
            <div class="opc-dates">
              ${batchDateEntries(batch).map((e) => `
                <span class="opc-date">
                  ${escHtml(e.date)}${e.hours ? ` · <span class="opc-date-time">${escHtml(e.hours)}</span>` : ''}
                </span>`).join('')}
            </div>
          </div>
          <i class="bi bi-arrow-right-circle fs-4 text-success"></i>
        </div>` : ''}

      ${(hasReadyItem(o) && (state.contact.gmail || state.contact.instagram)) ? `
        <div class="contact-fallback">
          <i class="bi bi-info-circle text-warning fs-5"></i>
          <div class="flex-grow-1">
            <div style="font-weight:600; color:var(--shop-ink-900);">มารับไม่ทันทุกวัน?</div>
            <div class="small text-muted">ทักมาที่ช่องทางต่อไปนี้เพื่อนัดรับเพิ่มได้</div>
          </div>
          <div class="cf-icons">
            ${state.contact.gmail ? `<a href="${safeUrl('mailto:' + state.contact.gmail)}"><i class="bi bi-envelope"></i> Gmail</a>` : ''}
            ${state.contact.instagram ? `<a href="${safeUrl('https://instagram.com/' + state.contact.instagram.replace(/^@/, ''))}" target="_blank" rel="noreferrer"><i class="bi bi-instagram"></i> ${escHtml(state.contact.instagram)}</a>` : ''}
          </div>
        </div>` : ''}

      ${contactRowHtml(o)}

      ${reuploadCalloutHtml(o)}
    </div>`;
}

/** The contact staff will actually use for this order, shown on the order and
 *  editable while the order is still early.
 *
 *  WHY IT IS HERE. The email on an order is TYPED at checkout and verified
 *  nowhere — a Google account prefills it but the field stays editable, and a
 *  username/password account has nothing to prefill. So the one channel staff
 *  have for a slip problem or a pickup announcement can be a typo, and today the
 *  buyer's only remedy was to ask an admin. `shop_orders_self_update_guard`
 *  already let them fix the PHONE; migration 0150 added the email to the same
 *  whitelist, which is what makes this button possible.
 *
 *  This is also the answer to "should the shop force Google sign-in": the
 *  problem is a reachable contact ON THE ORDER, not the login method — so it is
 *  fixed on the order. */
const CONTACT_EDITABLE = new Set(['pending', 'review', 'slip_mismatch']);

function contactRowHtml(o) {
  const email = (o.buyer_email || '').trim();
  const phone = (o.buyer_phone || '').trim();
  const editable = CONTACT_EDITABLE.has(o.status);
  // An order with NEITHER still shows the row while it is editable — hiding it
  // would leave the one case that most needs fixing with no way to fix it.
  // (None exist today; orders created before 0026/0033 added these columns, or
  // by an admin on someone's behalf, are how one appears.)
  if (!email && !phone && !editable) return '';
  return `
    <div class="order-contact">
      <div class="order-contact-body">
        <div class="oc-title">ช่องทางติดต่อของคำสั่งซื้อนี้</div>
        <div class="oc-lines">
          ${email ? `<span><i class="bi bi-envelope"></i> ${escHtml(email)}</span>` : ''}
          ${phone ? `<span><i class="bi bi-telephone"></i> ${escHtml(phone)}</span>` : ''}
          ${!email && !phone ? '<span class="oc-empty">ยังไม่มีช่องทางติดต่อ</span>' : ''}
        </div>
      </div>
      ${editable
        ? `<button type="button" class="oc-edit" data-edit-contact="${escHtml(o.id)}">${email || phone ? 'แก้ไข' : 'เพิ่ม'}</button>`
        : ''}
    </div>`;
}

/** Show a "change/upload slip" affordance any time the customer's
 *  slip is still actionable — i.e. before the admin has verified it
 *  (pending = no slip yet, review = sent but not yet verified) and
 *  when the admin has explicitly rejected it (slip_mismatch). Once
 *  the order moves to paid/produce/ready/done/cancel etc., we hide
 *  this so a paid order can't be confused by a late "new slip".
 *
 *  This is the standard Thai e-commerce slip pattern — Shopee/Lazada/
 *  bank-transfer storefronts all let buyers replace the slip until
 *  the seller marks it OK. */
const REUPLOAD_ALLOWED = new Set(['pending', 'review', 'slip_mismatch']);

function reuploadCalloutHtml(o) {
  if (!REUPLOAD_ALLOWED.has(o.status)) return '';
  const isReject = o.status === 'slip_mismatch';
  const slips = orderSlips(o);
  const hasSlip = slips.length > 0;
  const headline = isReject
    ? 'สลิปไม่ถูกต้อง'
    : hasSlip
      ? 'สลิปที่ส่ง — เพิ่ม/ลบได้จนกว่า admin จะตรวจ'
      : 'ยังไม่ได้ส่งสลิป';
  const body = isReject
    ? 'admin ตรวจสอบแล้วพบว่าสลิปไม่ตรงกับยอดที่สั่ง โปรดอัปโหลดสลิปที่ถูกต้องอีกครั้ง'
    : hasSlip
      ? 'แนบได้มากกว่าหนึ่งใบ — ลบใบที่ไม่ต้องการหรือเพิ่มใบใหม่ได้ก่อน admin ยืนยัน'
      : 'อัปโหลดสลิปการโอนเพื่อให้ admin ตรวจสอบ';
  const bg = isReject
    ? 'background:#fff8e1; border:1px solid #fbcf73;'
    : 'background:#f4f7fb; border:1px solid #dfe5ee;';
  const icon = isReject ? 'bi-exclamation-triangle text-warning' : 'bi-info-circle text-primary';
  const thumbs = slips.map((s) => `
    <div class="slip-chip">
      <a href="${safeUrl(s.url)}" target="_blank" rel="noreferrer" title="ดูสลิป">
        <i class="bi bi-receipt"></i> สลิป
      </a>
      <button type="button" class="slip-chip-x" title="ลบสลิปนี้"
              data-remove-slip="${escHtml(s.url)}" data-remove-slip-order="${escHtml(o.id)}">
        <i class="bi bi-x"></i>
      </button>
    </div>`).join('');
  return `
    <div class="slip-manager" style="${bg}">
      <div class="d-flex align-items-start gap-2">
        <i class="bi ${icon} fs-5"></i>
        <div class="flex-grow-1">
          <div style="font-weight:600; color:var(--shop-ink-900);">${escHtml(headline)}</div>
          <div class="small text-muted">${escHtml(body)}</div>
        </div>
      </div>
      ${hasSlip ? `<div class="slip-chip-row">${thumbs}</div>` : ''}
      <div class="d-flex justify-content-end mt-2">
        <button type="button" class="btn btn-sm ${isReject ? 'btn-warning' : 'btn-outline-primary'}"
                data-add-slip-order="${escHtml(o.id)}">
          <i class="bi bi-cloud-upload me-1"></i> ${hasSlip ? 'เพิ่มสลิป' : 'อัปโหลดสลิป'}
        </button>
        <input type="file" accept="image/*" class="d-none" data-slip-file="${escHtml(o.id)}" />
      </div>
    </div>`;
}

function statusPillHtml(order) {
  const meta = statusMetaFor(order);
  const status = rollupOrderStage(order);
  return `
    <span class="status-pill" data-status="${escHtml(status)}">
      <span class="pulse"></span>
      <i class="bi ${escHtml(meta.icon)}"></i>
      <span>${escHtml(meta.label)}</span>
    </span>`;
}

/** True when at least one line item is ready for pickup — drives the
 *  pickup callout + contact fallback even on partial orders where the
 *  overall rollup is still "in production". */
function hasReadyItem(o) {
  if (rollupOrderStage(o) === 'ready') return true;
  const items = Array.isArray(o?.items) ? o.items : [];
  return items.some((it) => (it.item_status || 'paid') === 'ready');
}

// Progress section. Two modes:
//   * Pre-paid (pending/review), off-path, or legacy whole-order
//     (produce/ready/done set before the Hybrid migration) → one
//     order-level track + a plain item list.
//   * Hybrid 'paid' order → one progress block PER item, so products
//     that aren't produced at the same time show different progress.
function itemsProgressHtml(o, products) {
  const status = o?.status || 'pending';
  if (status !== 'paid') {
    return `
      ${progressTrackHtml(o)}
      ${plainItemsRowHtml(o, products)}`;
  }
  const items = Array.isArray(o.items) ? o.items : [];
  if (!items.length) return progressTrackHtml(o);
  return `
    <div class="order-item-blocks">
      ${items.map((it) => itemBlockHtml(it, products)).join('')}
    </div>`;
}

function plainItemsRowHtml(o, products) {
  const items = Array.isArray(o.items) ? o.items : [];
  return `
    <div class="order-items-row">
      ${items.map((it) => {
        const p = products[it.product_id];
        const variant = variantLabel(p, it);
        return `
          <div class="order-mini">
            <div class="om-thumb" style="${miniThumbStyle(p)}"></div>
            <span>${escHtml(p?.name || it.product_id)}</span>
            ${it.is_preorder ? '<span class="preorder-tag">พรีออเดอร์</span>' : ''}
            ${variant ? `<span class="text-muted small">(${escHtml(variant)})</span>` : ''}
            <span class="om-qty">× ${it.qty}</span>
          </div>`;
      }).join('')}
    </div>`;
}

function itemBlockHtml(it, products) {
  const p = products[it.product_id];
  const variant = variantLabel(p, it);
  return `
    <div class="order-item-block">
      <div class="oib-head">
        <div class="om-thumb" style="${miniThumbStyle(p)}"></div>
        <div class="oib-info">
          <div class="oib-name">
            ${escHtml(p?.name || it.product_id)}
            ${it.is_preorder ? '<span class="preorder-tag">พรีออเดอร์</span>' : ''}
          </div>
          ${variant ? `<div class="text-muted small">${escHtml(variant)}</div>` : ''}
        </div>
        <span class="om-qty">× ${it.qty}</span>
      </div>
      ${itemProgressTrackHtml(it.item_status || 'paid')}
    </div>`;
}

function itemProgressTrackHtml(istatus) {
  const off = OFF_PATH_TRACKS[istatus];
  if (off) {
    return `
      <div class="progress-track item-track" style="grid-template-columns: 1fr;">
        <div class="progress-step ${off.cls}"><span class="pdot"></span>${escHtml(off.text)}</div>
      </div>`;
  }
  const currentIdx = ITEM_STAGES_ORDER.indexOf(istatus);
  return `
    <div class="progress-track item-track">
      ${ITEM_STAGES_ORDER.map((stage, i) => {
        const cls = i < currentIdx ? 'is-done' : i === currentIdx ? 'is-current' : '';
        return `<div class="progress-step ${cls}"><span class="pdot"></span>${escHtml(itemStatusMeta(stage).label)}</div>`;
      }).join('')}
    </div>`;
}

// Off-path single-line track. Text falls back to the canonical label
// from STAGES_META so customer / admin / filter stay in sync — only
// list overrides here when a longer phrasing reads better on the card.
const OFF_PATH_TRACKS = {
  cancel:         { cls: 'is-cancel',  text: 'คำสั่งซื้อถูกยกเลิก' },
  slip_mismatch:  { cls: 'is-cancel',  text: 'สลิปไม่ตรงกับยอด — รอการแก้ไข' },
  issue:          { cls: 'is-cancel',  text: 'มีปัญหา — โปรดติดต่อเจ้าหน้าที่' },
};

function progressTrackHtml(order) {
  const status = order?.status || 'pending';
  const off = OFF_PATH_TRACKS[status];
  if (off) {
    return `
      <div class="progress-track" style="grid-template-columns: 1fr;">
        <div class="progress-step ${off.cls}"><span class="pdot"></span>${escHtml(off.text)}</div>
      </div>`;
  }
  const currentIdx = STAGES_ORDER.indexOf(status);
  return `
    <div class="progress-track">
      ${STAGES_ORDER.map((stage, i) => {
        const cls = i < currentIdx ? 'is-done' : i === currentIdx ? 'is-current' : '';
        return `<div class="progress-step ${cls}"><span class="pdot"></span>${escHtml(STAGES_META[stage].label)}</div>`;
      }).join('')}
    </div>`;
}

/** Human-readable "ไซส์ · สี" for an order line. Maps the stored colour
 *  id back to its label via the product's colour list (falls back to the
 *  raw id). Returns '' when there's nothing meaningful to show (free-size,
 *  no colour). */
function variantLabel(p, it) {
  const parts = [];
  if (it.size && it.size !== 'F') parts.push(it.size);
  const colorId = it.color && it.color !== 'default' ? it.color : '';
  if (colorId) {
    const colors = Array.isArray(p?.colors) ? p.colors : [];
    const match = colors.find((c) => c && (c.id === colorId || c.label === colorId));
    parts.push(match?.label || colorId);
  }
  return parts.join(' · ');
}

function miniThumbStyle(p) {
  if (p?.image_url) {
    return `background-image: url('${escHtml(p.image_url)}'); background-size: cover; background-position: center;`;
  }
  const h = Number(p?.hue) || 220;
  return `background: repeating-linear-gradient(135deg, hsl(${h} 30% 96%) 0 4px, hsl(${h} 28% 90%) 4px 8px);`;
}
