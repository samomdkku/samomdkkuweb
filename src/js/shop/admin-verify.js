// ==============================================
// SHOP ADMIN — Verify queue (slip review, one order at a time). Split out
// of admin.js (task 19 — maintainability).
// ==============================================

import { escHtml, safeUrl, orderIdChipHtml } from '../utils.js';
import { thb, fmtDateTime, STAGES_META, colorLabelFor, imageBase } from './data.js';
import { updateOrderStatus } from './api.js';
import { showShopToast } from './products.js';
import { reviewQueue, slipSentAt, waitedLabel, isOverdue } from './order-facts.js';
import { state } from './admin.js';
import { openOrderModal, orderSlipList, refreshOrders } from './admin-orders.js';

// ---------------------------------------------------------------------
// Verify queue (one-at-a-time review)
// ---------------------------------------------------------------------
/** A slip picture at a width. lh3 sizes it server-side; the slip goes
 *  straight to Google, never through the VM's /img cache — a bank slip is
 *  not something to keep a copy of on our disk. */
export function slipSrc(url, w) {
  const base = imageBase(url);
  // -rj: lh3 otherwise returns the master's format, and a phone-screenshot
  // slip is a PNG — ~1 MB at 1600px for every slip the queue shows.
  return /lh3\.googleusercontent\.com/.test(base) ? `${base}=w${w}-rj` : base;
}

/** The slip queue: one order at a time, oldest slip first. The slip is big
 *  and the amount it must show sits right beside it — the whole job is
 *  comparing those two. Keys: A อนุมัติ · R สลิปไม่ถูกต้อง · ← → เลื่อน. */
export function renderVerifyQueue() {
  const host = document.getElementById('shopAdminVerifyHost');
  if (!host) return;
  const queue = reviewQueue(state.orders);
  if (queue.length === 0) {
    host.innerHTML = `
      <div class="empty-state">
        <i class="bi bi-check2-all"></i>
        <h4>ไม่มีสลิปรอตรวจ</h4>
        <p>ตรวจครบแล้ว — สลิปใหม่จะเข้ามาที่นี่ และแท็บนี้จะขึ้นตัวเลขบอก</p>
      </div>`;
    return;
  }
  const idx = Math.max(0, Math.min(state.verifyIdx, queue.length - 1));
  if (idx !== state.verifyIdx || state.verifyOrderId !== queue[idx].id) state.verifySlip = 0;
  state.verifyIdx = idx;
  const current = queue[idx];
  state.verifyOrderId = current.id;
  const items = (Array.isArray(current.items) ? current.items : []).filter(Boolean);
  const slips = orderSlipList(current).slice().reverse();   // newest first: the one just sent
  const slipI = Math.max(0, Math.min(state.verifySlip || 0, slips.length - 1));
  const slip = slips[slipI];
  const sentAt = slipSentAt(current);
  const late = isOverdue(sentAt);
  const productMap = new Map((state.products || []).map((p) => [p.id, p]));

  host.innerHTML = `
    <div class="verify-head">
      <div>
        <h5 class="font-prompt mb-0" style="font-weight:700;">ตรวจสลิป</h5>
        <p class="text-muted mb-0 small">รายการ ${idx + 1} จาก ${queue.length} · เรียงจากส่งสลิปก่อน</p>
      </div>
      <div class="d-flex gap-2">
        <button class="btn btn-ghost btn-sm" id="shopVerifyPrev" ${idx === 0 ? 'disabled' : ''} aria-label="ก่อนหน้า">
          <i class="bi bi-chevron-left"></i><span class="d-none d-sm-inline"> ก่อนหน้า</span>
        </button>
        <button class="btn btn-ghost btn-sm" id="shopVerifyNext" ${idx >= queue.length - 1 ? 'disabled' : ''} aria-label="ถัดไป">
          <span class="d-none d-sm-inline">ถัดไป </span><i class="bi bi-chevron-right"></i>
        </button>
      </div>
    </div>

    <div class="verify-card">
      <div class="verify-slip">
        ${slip ? `
          <a class="verify-slip-frame" href="${safeUrl(slip.url)}" target="_blank" rel="noreferrer" title="เปิดสลิปขนาดเต็ม">
            <img src="${safeUrl(slipSrc(slip.url, 1600))}" alt="สลิปของคำสั่งซื้อ ${escHtml(current.id)}" />
            <span class="verify-slip-open"><i class="bi bi-arrows-fullscreen"></i> ขนาดเต็ม</span>
          </a>
          ${slips.length > 1 ? `
            <div class="verify-slip-strip" role="group" aria-label="สลิปทั้งหมด ${slips.length} รูป">
              ${slips.map((sl, i) => `
                <button type="button" class="verify-slip-pick ${i === slipI ? 'is-active' : ''}" data-verify-slip="${i}"
                        aria-pressed="${i === slipI}" aria-label="สลิปรูปที่ ${slips.length - i}${sl.at ? ` ส่งเมื่อ ${escHtml(fmtDateTime(sl.at))}` : ''}">
                  <img src="${safeUrl(slipSrc(sl.url, 200))}" alt="" />
                  <span>${i === 0 ? 'ล่าสุด' : escHtml(sl.at ? fmtDateTime(sl.at) : `รูปที่ ${slips.length - i}`)}</span>
                </button>`).join('')}
            </div>` : ''}
        ` : `
          <div class="verify-slip-frame is-empty"><i class="bi bi-x-octagon"></i><span>ไม่พบไฟล์สลิป</span></div>`}
      </div>

      <div class="verify-facts">
        <div class="verify-amount">
          <span class="verify-amount-label">ยอดที่ต้องโอน</span>
          <span class="verify-amount-value">฿${thb(current.total)}</span>
          <span class="verify-amount-hint">ตรวจว่ายอดและชื่อบัญชีปลายทางในสลิปตรงกัน</span>
        </div>

        <dl class="verify-meta">
          <dt>คำสั่งซื้อ</dt>
          <dd>${orderIdChipHtml(current.id)}
            <button type="button" class="btn btn-link btn-sm p-0 ms-2" data-verify-open>ดูรายละเอียดทั้งหมด</button></dd>
          <dt>ลูกค้า</dt>
          <dd><b>${escHtml(current.buyer_name || current.buyer_label || '—')}</b>
            ${current.buyer_email ? `<div class="small text-muted">${escHtml(current.buyer_email)}</div>` : ''}
            ${current.buyer_phone ? `<div class="small"><a href="tel:${escHtml(String(current.buyer_phone).replace(/[^0-9+]/g, ''))}">${escHtml(current.buyer_phone)}</a></div>` : ''}</dd>
          <dt>สั่งเมื่อ</dt>
          <dd>${fmtDateTime(current.placed_at)}</dd>
          <dt>ส่งสลิป</dt>
          <dd>${sentAt ? fmtDateTime(sentAt) : '—'}
            ${sentAt ? `<span class="verify-wait ${late ? 'is-late' : ''}">รอมา ${waitedLabel(sentAt)}</span>` : ''}
            ${slips.length > 1 ? `<div class="small text-muted">ส่งมาทั้งหมด ${slips.length} รูป</div>` : ''}</dd>
          ${current.customer_note || current.admin_note ? `
          <dt>หมายเหตุ</dt>
          <dd class="small">${current.admin_note ? `<div><span class="text-muted">ภายใน:</span> ${escHtml(current.admin_note)}</div>` : ''}${current.customer_note ? `<div><span class="text-muted">ถึงลูกค้า:</span> ${escHtml(current.customer_note)}</div>` : ''}</dd>` : ''}
        </dl>

        <div class="verify-items">
          ${items.map((it) => {
            const p = productMap.get(it.product_id);
            const variant = [it.size && it.size !== 'F' ? `ไซส์ ${it.size}` : '', colorLabelFor(p, it.color)].filter(Boolean).join(' · ');
            return `
            <div class="verify-item">
              <span>${escHtml(p?.name || it.product_id || '(สินค้าถูกลบ)')}${variant ? ` <span class="text-muted">${escHtml(variant)}</span>` : ''} <span class="text-muted">× ${Number(it.qty) || 0}</span></span>
              <span>฿${thb((Number(it.unit_price) || 0) * (Number(it.qty) || 0))}</span>
            </div>`;
          }).join('')}
        </div>

        <div class="verify-actions">
          <button class="btn btn-success" id="shopVerifyApprove">
            <i class="bi bi-check2-circle me-1"></i> อนุมัติ <kbd>A</kbd>
          </button>
          <button class="btn btn-outline-warning" id="shopVerifyReject">
            <i class="bi bi-exclamation-triangle me-1"></i> สลิปไม่ถูกต้อง <kbd>R</kbd>
          </button>
        </div>
        <p class="verify-keys">คีย์ลัด: <kbd>A</kbd> อนุมัติ · <kbd>R</kbd> สลิปไม่ถูกต้อง · <kbd>←</kbd> <kbd>→</kbd> เลื่อน · ตัดสินแล้วไปรายการถัดไปเอง</p>
      </div>
    </div>`;

  document.getElementById('shopVerifyPrev')?.addEventListener('click', () => { state.verifyIdx = Math.max(0, idx - 1); renderVerifyQueue(); });
  document.getElementById('shopVerifyNext')?.addEventListener('click', () => { state.verifyIdx = Math.min(queue.length - 1, idx + 1); renderVerifyQueue(); });
  host.querySelectorAll('[data-verify-slip]').forEach((b) => b.addEventListener('click', () => {
    state.verifySlip = Number(b.dataset.verifySlip) || 0;
    renderVerifyQueue();
  }));
  host.querySelector('[data-verify-open]')?.addEventListener('click', () => openOrderModal(current.id));
  // One decision per render: both buttons lock on the first click (a double
  // click appended the timeline entry twice), and the write only lands if the
  // order is still the version on screen (expectUpdatedAt). The decided order
  // leaves the queue, so the same index is the next one.
  const decide = async (next, okMsg, tone) => {
    ['shopVerifyApprove', 'shopVerifyReject'].forEach((id) => {
      const b = document.getElementById(id); if (b) b.disabled = true;
    });
    try {
      await updateOrderStatus(current.id, next, {
        label: STAGES_META[next].label, expectUpdatedAt: current.updated_at,
      });
      showShopToast(okMsg, tone);
    } catch (e) { showShopToast(`ล้มเหลว: ${e.message || e}`, 'error'); }
    await refreshOrders().catch(() => {});
    renderVerifyQueue();
  };
  document.getElementById('shopVerifyApprove')?.addEventListener('click',
    () => decide('paid', `อนุมัติ ${current.id} แล้ว — ย้ายไป "ชำระแล้ว"`, 'success'));
  document.getElementById('shopVerifyReject')?.addEventListener('click',
    () => decide('slip_mismatch', `${current.id}: แจ้งสลิปไม่ถูกต้อง — ลูกค้าจะอัปโหลดสลิปใหม่ได้`, 'warn'));
}

/** A slip whose file will not load (deleted, unshared, offline) showed its
 *  alt text squeezed into a 38px sliver. `error` does not bubble, so one
 *  capture listener catches every slip picture the admin draws — the queue,
 *  the popup, the strip — and puts a plain message in its place. The link
 *  around it still opens the original. */
export function wireSlipImageFallback() {
  document.addEventListener('error', (e) => {
    const img = e.target;
    if (!(img instanceof HTMLImageElement)) return;
    const box = img.closest('.slip-thumb, .verify-slip-frame, .verify-slip-pick');
    if (!box || box.classList.contains('is-broken')) return;
    box.classList.add('is-broken');
    const note = document.createElement('span');
    note.className = 'slip-broken-note';
    note.textContent = box.classList.contains('verify-slip-pick') ? 'โหลดไม่ได้' : 'โหลดรูปสลิปไม่ได้ — กดเพื่อเปิดไฟล์ต้นฉบับ';
    img.replaceWith(note);
  }, true);
}

/** The slip queue's keys. Only while that pane is on screen, nothing is
 *  being typed, no dialog is open and no modifier is held — a stray "a" in a
 *  note must never approve a slip. Keys click the real buttons, so the
 *  one-decision lock applies to them too. */
export function wireVerifyKeys() {
  document.addEventListener('keydown', (e) => {
    if (state.tab !== 'verify' || e.defaultPrevented || e.repeat) return;
    if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
    // VISIBLE, not "no d-none on two elements": leaving the shop for another
    // admin page hides an ANCESTOR (the admin pane), and the keys stayed live
    // there — an "a" on ระบบบ้าน approved a slip nobody was looking at.
    const pane = document.querySelector('#adminShopSection [data-shop-admin-pane="verify"]');
    if (!pane || pane.getClientRects().length === 0) return;
    if (document.querySelector('.modal.show')) return;
    const t = e.target;
    if (t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    const id = { a: 'shopVerifyApprove', r: 'shopVerifyReject', ArrowLeft: 'shopVerifyPrev', ArrowRight: 'shopVerifyNext' }[
      e.key.length === 1 ? e.key.toLowerCase() : e.key];
    // Thai keyboard layout: the A and R keys type ฟ and พ.
    const thai = { 'ฟ': 'shopVerifyApprove', 'พ': 'shopVerifyReject' }[e.key];
    const btn = document.getElementById(id || thai || '');
    if (!btn || btn.disabled) return;
    e.preventDefault();
    btn.click();
  });
}

