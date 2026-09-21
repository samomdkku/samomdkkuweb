// ==============================================
// SHOP CHECKOUT — Order summary + PromptPay QR + slip upload
//
// Slip uploads land in Drive at `Shop/Slips/<YYYY-MM>/<orderId>_*`.
// The order id only exists after `createOrder` succeeds, so the rename
// flow is: upload with a temporary filename → create order → done. The
// stored filename includes the buyer id + timestamp so it stays unique
// even before the order id is known.
// ==============================================

import { escHtml, safeUrl } from '../utils.js';
import { getUser } from '../auth.js';
import { thb, getDefaultQr, findQr, findPickupLocation } from './data.js';
import { getCart, cartSubtotal, clearCart, addItem } from './state.js';
import { getSettings, placeShopOrder } from './api.js';
import { uploadShopFile, slipFolderForNow, SLIP_MAX_EDGE } from './uploads.js';
import { getProductMap, ensureProductsLoaded } from './cart.js';
import { showShopToast } from './products.js';

let onAfterPlace = () => {};
let onBack = () => {};
let settingsCache = null;

const state = {
  // Since migration 0057 a cart can span multiple PromptPay accounts, so
  // slips are per account group, keyed by the group key (a QR id or
  // 'default'). One order is placed per group.
  slipFiles: {},        // key → File
  slipPreviews: {},     // key → data-URL preview string
  buyerNote: '',
  buyerName: '',
  buyerEmail: '',
  buyerPhone: '',
  // WHOSE contact is currently sitting in the three fields above. This state is
  // module-scope and the account switcher does NOT reload the page, so without
  // it a switch left the PREVIOUS person's name/email/phone in the form — see
  // applyBuyerPrefill().
  prefillUid: null,
  agree: false,
};

/**
 * Fill the buyer contact fields from the signed-in profile.
 *
 * TWO RULES, and they are different on purpose:
 *
 * 1. WHEN THE ACCOUNT CHANGES, overwrite all three. The old guard was
 *    `if (!state.buyerEmail) state.buyerEmail = user.email` — which never
 *    overwrites — and this module's state outlives an in-place account switch
 *    (account-switch.js does not reload). So switching accounts and opening
 *    checkout showed the PREVIOUS person's email, and the recap above the
 *    confirm button then asked the buyer to approve it. Placing that order
 *    stores a stranger's address as the only channel staff have.
 *    This is the documented "module-scope caches make an in-place account
 *    switch show two accounts at once" class (docs/mistakes/app-state.md).
 *
 * 2. WITHIN ONE ACCOUNT, only fill what is EMPTY. Typed edits must survive the
 *    re-render that every slip upload triggers, and the fields are deliberately
 *    blanked after a successful order so the next one prefills again.
 *
 * Exported for `checkout-prefill.test.js`: the difference between these two
 * rules is invisible until someone switches accounts, which is exactly the kind
 * of thing nobody re-tests by hand.
 */
export function applyBuyerPrefill(state_, user) {
  if (!user) return state_;
  if (state_.prefillUid !== user.id) {
    state_.prefillUid   = user.id;
    state_.buyerName    = user.name  || '';
    state_.buyerEmail   = user.email || '';
    state_.buyerPhone   = user.phone || '';
    return state_;
  }
  if (!state_.buyerName)  state_.buyerName  = user.name  || '';
  if (!state_.buyerEmail) state_.buyerEmail = user.email || '';
  if (!state_.buyerPhone) state_.buyerPhone = user.phone || '';
  return state_;
}

// ── Account grouping (split-by-account checkout, migration 0057) ────────

/** The PromptPay account a product routes to. Returns { key, qr } where
 *  key is a stable group key ('default' or the QR id as a string) and qr
 *  is the display collector { name, id, qr, instructions }. A product with
 *  no promptpay_qr_id (or one pointing at a missing QR) falls back to the
 *  default account (the is_default QR row, or the legacy shop_settings QR
 *  when no QR list exists yet). */
function resolveQrForProduct(p) {
  const assigned = p && p.promptpay_qr_id != null ? findQr(p.promptpay_qr_id) : null;
  const row = assigned || getDefaultQr();
  if (row) {
    return {
      key: String(row.id),
      qr: {
        name: row.promptpay_name || 'ผู้รับเงิน SAMO',
        id: row.promptpay_id || '—',
        qr: row.qr_url || '',
        // Per-QR instructions override; fall back to the global settings text.
        instructions: row.instructions || settingsCache?.instructions || '',
      },
    };
  }
  // No QR list at all (pre-0057) → legacy single shop_settings QR.
  return {
    key: 'default',
    qr: {
      name: settingsCache?.promptpay_name || 'ผู้รับเงิน SAMO',
      id: settingsCache?.promptpay_id || '—',
      qr: settingsCache?.promptpay_qr_url || '',
      instructions: settingsCache?.instructions || '',
    },
  };
}

/** Partition the cart into account groups, preserving cart order.
 *  Returns [{ key, qr, items, subtotal }]. */
function buildGroups(cart, products) {
  const order = [];
  const byKey = new Map();
  for (const it of cart) {
    const { key, qr } = resolveQrForProduct(products[it.productId]);
    if (!byKey.has(key)) {
      byKey.set(key, { key, qr, items: [], subtotal: 0 });
      order.push(key);
    }
    const g = byKey.get(key);
    g.items.push(it);
    g.subtotal += (Number(it.price) || 0) * (Number(it.qty) || 0);
  }
  return order.map((k) => byKey.get(k));
}

/** Every group has a slip (or dev-skip lets it through). */
function groupsSatisfied(groups, devSkip) {
  return groups.every((g) => devSkip || state.slipFiles[g.key]);
}

export function setCheckoutNavigators({ goShop, afterPlace }) {
  onBack = goShop || onBack;
  onAfterPlace = afterPlace || onAfterPlace;
}

export async function mountCheckout() {
  const back = document.getElementById('shopCheckoutBack');
  if (back) back.addEventListener('click', () => onBack());
}

/** Show the checkout view (called by index.js when sub-nav switches). */
export async function renderCheckout() {
  const user = getUser();
  const gate = document.getElementById('shopCheckoutAuthGate');
  const body = document.getElementById('shopCheckoutBody');
  if (!gate || !body) return;

  if (!user) {
    gate.classList.remove('d-none');
    body.classList.add('d-none');
    return;
  }
  gate.classList.add('d-none');
  body.classList.remove('d-none');

  await ensureProductsLoaded();
  if (!settingsCache) {
    try { settingsCache = await getSettings(); } catch { settingsCache = null; }
  }
  applyBuyerPrefill(state, user);
  body.innerHTML = renderHtml();
  wireEvents();
}

/** An anonymous (username/password) account has NO email — auth.js stores '' for
 *  the synthetic one — so the prefill above leaves this required field blank and
 *  the buyer meets a validation error with no explanation of why their account
 *  did not fill it in. It is not a block: they can type any address. But the
 *  order's only contact channel is what goes in this box, so say both things —
 *  what to type, and the one-tap way to stop having to. */
function noEmailOnAccount() {
  const u = getUser();
  return !!u && !u.email;
}

function renderHtml() {
  const cart = getCart();
  const subtotal = cartSubtotal();
  const itemsTotal = cart.reduce((s, it) => s + (Number(it.qty) || 0), 0);
  const products = getProductMap();
  // Dev accounts can test the full checkout without a real slip — the
  // upload is optional and the placeOrder path tolerates a null slipUrl.
  const devSkip = getUser()?.role === 'dev';

  if (cart.length === 0) {
    return `
      <div class="empty-state">
        <i class="bi bi-bag"></i>
        <h4>ยังไม่มีสินค้าในตะกร้า</h4>
        <p>กลับไปเลือกสินค้าก่อนนะ</p>
        <button class="btn btn-shop mt-3" id="shopCheckoutBackToShop">กลับไปร้าน</button>
      </div>`;
  }

  const groups = buildGroups(cart, products);
  const split = groups.length > 1;

  return `
    <div>
      <div class="checkout-panel mb-3">
        <h4><span class="step-num">1</span> ข้อมูลผู้สั่ง</h4>
        <div class="row g-2">
          <div class="col-md-6">
            <label class="form-label small fw-bold mb-1" for="shopBuyerName">ชื่อ – นามสกุล <span class="req-star" aria-hidden="true">*</span></label>
            <input type="text" class="form-control" id="shopBuyerName"
                   value="${escHtml(state.buyerName)}" autocomplete="name" required maxlength="80" />
          </div>
          <div class="col-md-6">
            <label class="form-label small fw-bold mb-1" for="shopBuyerEmail">อีเมล <span class="req-star" aria-hidden="true">*</span></label>
            <input type="email" class="form-control" id="shopBuyerEmail"
                   value="${escHtml(state.buyerEmail)}" autocomplete="email" required />
            ${noEmailOnAccount() ? `
              <div class="form-text small mt-1">
                บัญชีนี้ไม่มีอีเมล (เข้าสู่ระบบด้วยชื่อผู้ใช้) กรอกอีเมลที่ติดต่อได้จริง
                หรือ<button type="button" class="btn btn-link btn-sm p-0 align-baseline"
                  data-bs-toggle="modal" data-bs-target="#signinModal">เข้าสู่ระบบด้วย Google</button>
                เพื่อให้กรอกให้อัตโนมัติ
              </div>` : ''}
          </div>
          <div class="col-md-6">
            <label class="form-label small fw-bold mb-1" for="shopBuyerPhone">เบอร์โทรศัพท์ <span class="req-star" aria-hidden="true">*</span></label>
            <input type="tel" class="form-control" id="shopBuyerPhone"
                   value="${escHtml(state.buyerPhone)}" autocomplete="tel" inputmode="tel"
                   placeholder="08x-xxx-xxxx" required maxlength="20" />
          </div>
        </div>
        <div class="form-text small mt-2">
          <i class="bi bi-info-circle me-1"></i>ใช้สำหรับติดต่อกลับเรื่องสลิป/วันรับสินค้า เปลี่ยนได้ตามต้องการ
        </div>
      </div>

      <div class="checkout-panel mb-3">
        <h4><span class="step-num">2</span> ตรวจสอบรายการ</h4>
        ${cart.map((it, i) => {
          const p = products[it.productId];
          const name = p?.name || it.productId;
          const colors = Array.isArray(p?.colors) ? p.colors : [];
          const colorLabel = colors.find((c) => c.id === it.color)?.label || it.color || '';
          const variantParts = [
            ...(it.size && it.size !== 'F' ? [`ไซส์ ${it.size}`] : []),
            ...(colors.length > 1 && colorLabel ? [colorLabel] : []),
            `จำนวน ${it.qty}`,
          ];
          const pickup = findPickupLocation(p?.pickup_location_id);
          return `
            <div class="d-flex gap-3 align-items-center py-2"
                 style="border-bottom: ${i < cart.length - 1 ? '1px solid var(--shop-ink-100, #ebecee)' : 'none'};">
              <div style="width:36px; height:48px; border-radius:6px; flex:0 0 auto;
                          ${miniThumbStyle(p)}"></div>
              <div class="flex-grow-1">
                <div style="font-weight:600;">${escHtml(name)}</div>
                <div class="small text-muted">${escHtml(variantParts.join(' · '))}</div>
                ${pickup ? `<div class="small text-muted"><i class="bi bi-geo-alt me-1"></i>รับที่: ${escHtml(pickup.label)}</div>` : ''}
              </div>
              <div style="font-weight:700;">฿${thb(it.price * it.qty)}</div>
            </div>`;
        }).join('')}
      </div>
    </div>

    <div>
      <div class="checkout-panel mb-3">
        <h4 style="font-size:1rem; margin-bottom:.5rem;">
          <span class="step-num">3</span> ชำระเงิน
          ${devSkip ? '<span class="badge bg-warning-subtle text-warning border border-warning-subtle ms-2" style="font-size:.7rem;">DEV: สลิปไม่จำเป็น</span>' : ''}
        </h4>
        ${split ? `<div class="alert alert-info small py-2 mb-3">
          <i class="bi bi-info-circle me-1"></i>
          สินค้าในตะกร้าใช้บัญชีรับเงินต่างกัน — กรุณาโอนแยกตามแต่ละบัญชีด้านล่าง และแนบสลิปของแต่ละบัญชี
          (จะแยกเป็น ${groups.length} คำสั่งซื้อ)
        </div>` : ''}
        ${groups.map((g, gi) => renderGroupCard(g, gi, split, devSkip)).join('')}
      </div>

      <div class="checkout-panel">
        <h4 style="font-size:1rem; margin-bottom:.75rem;">สรุปคำสั่งซื้อ</h4>
        <div class="summary-line">
          <span>${itemsTotal} ชิ้น</span>
          <span>฿${thb(subtotal)}</span>
        </div>
        ${split ? groups.map((g) => `
          <div class="summary-line small">
            <span class="text-muted">โอนบัญชี ${escHtml(g.qr.name)}</span>
            <span>฿${thb(g.subtotal)}</span>
          </div>`).join('') : ''}
        <div class="summary-line small text-muted" style="font-size:.78rem;">
          <span style="line-height:1.4;">
            <i class="bi bi-info-circle me-1"></i>
            admin จะประกาศวันเวลาสถานที่รับสินค้าและส่งอีเมลแจ้งเตือนอีกครั้ง
          </span>
        </div>
        <div class="summary-line grand">
          <span>ยอดที่ต้องโอนรวม</span>
          <span class="amount">฿${thb(subtotal)}</span>
        </div>
        <!-- CONTACT RECAP — the last thing read before committing.
             The buyer typed these three fields in step 1, three scroll-screens
             up, and by the time they have chosen products, scanned a QR and
             uploaded a slip, whether the address was right is out of working
             memory. This is not decoration: the ORDER's email is the only
             channel staff have for slip problems and pickup, and it is not
             verified anywhere — an account signed in with Google can still have
             typed over the prefill. Showing it back at the moment of commitment
             is what catches a typo, and it is the reason the shop does not need
             to restrict WHO may sign in.
             Live-updated by the field listeners in wireEvents(); never
             re-rendered, because a re-render on keystroke would drop focus. -->
        <div class="checkout-recap" id="shopContactRecap">
          <div class="checkout-recap-head">
            <span>เราจะติดต่อกลับที่</span>
            <button type="button" class="checkout-recap-edit" id="shopRecapEdit">แก้ไข</button>
          </div>
          <div class="checkout-recap-row">
            <i class="bi bi-envelope" aria-hidden="true"></i>
            <span id="shopRecapEmail"></span>
          </div>
          <div class="checkout-recap-row">
            <i class="bi bi-telephone" aria-hidden="true"></i>
            <span id="shopRecapPhone"></span>
          </div>
        </div>
        <div class="form-check mt-3">
          <input id="shopCheckoutAgree" class="form-check-input" type="checkbox" ${state.agree ? 'checked' : ''} />
          <label class="form-check-label small" for="shopCheckoutAgree">
            ข้าพเจ้าได้ตรวจสอบรายการและจำนวนเงินก่อนโอนแล้ว ยอมรับนโยบายการคืน/ยกเลิกของ SAMO Shop <span class="req-star" aria-hidden="true">*</span>
          </label>
        </div>
        <button type="button" class="btn btn-shop w-100 mt-3" id="shopPlaceOrderBtn"
                ${(!groupsSatisfied(groups, devSkip) || !state.agree) ? 'disabled' : ''}>
          <i class="bi bi-send-check me-1"></i> ${devSkip && !groupsSatisfied(groups, false) ? 'สั่งซื้อ (โหมด dev)' : 'ส่งสลิป & สั่งซื้อ'}
        </button>
        <div class="small text-muted mt-2 text-center ${(groupsSatisfied(groups, false) || devSkip) ? 'd-none' : ''}">
          <i class="bi bi-info-circle me-1"></i> อัปโหลดสลิป${split ? 'ของทุกบัญชี' : ''}ก่อนจึงจะกดสั่งซื้อได้
        </div>
      </div>
    </div>`;
}

/** One PromptPay account card: QR + amount + per-account slip drop. */
function renderGroupCard(g, gi, split, devSkip) {
  const { key, qr, subtotal } = g;
  const file = state.slipFiles[key];
  const preview = state.slipPreviews[key];
  return `
    <div class="qr-card mb-3" data-qr-group="${escHtml(key)}">
      ${split ? `<div class="qr-label" style="font-weight:700; color:var(--shop-ink-900);">บัญชีที่ ${gi + 1}</div>` : ''}
      <div class="qr-img">
        ${qr.qr
          ? `<img src="${safeUrl(qr.qr)}" alt="PromptPay QR" />`
          : promptpayPlaceholderSvg(200)}
      </div>
      <div class="qr-label">PromptPay</div>
      <div class="qr-name">${escHtml(qr.name)}</div>
      <div class="qr-label font-mono">${escHtml(qr.id)}</div>
      <div class="qr-amount"><span class="baht">฿</span>${thb(subtotal)}</div>
      <button type="button" class="qr-copy" data-copy-amount="${subtotal}">
        <i class="bi bi-clipboard me-1"></i> คัดลอกจำนวนเงิน
      </button>
      ${qr.instructions ? `
        <hr/>
        <div class="text-start small text-muted" style="white-space:pre-wrap;">${escHtml(qr.instructions)}</div>` : ''}
      <div class="mt-3 text-start">
        <div class="small fw-bold mb-1">
          อัปโหลดสลิปบัญชีนี้ ${devSkip ? '' : '<span class="req-star" aria-hidden="true">*</span>'}
        </div>
        <div class="slip-drop ${file ? 'is-filled' : ''}" data-slip-drop="${escHtml(key)}">
          ${file ? `
            <i class="bi bi-check2-circle"></i>
            <div class="slip-filename">${escHtml(file.name)}</div>
            <div class="slip-hint">คลิกเพื่อเปลี่ยนไฟล์อื่น</div>
            ${preview ? `
              <img src="${preview}" alt="slip preview" class="mt-2 rounded"
                style="max-height:160px; max-width:100%; object-fit:contain;" />` : ''}` : `
            <i class="bi bi-cloud-upload"></i>
            <div class="mt-2" style="font-weight:600; color:var(--shop-ink-900);">
              ลากสลิปมาวาง หรือคลิกเพื่อเลือกไฟล์
            </div>
            <div class="slip-hint">รองรับไฟล์ภาพ jpg / png · ไม่เกิน 5 MB</div>`}
          <input type="file" accept="image/*" hidden data-slip-file="${escHtml(key)}" />
        </div>
      </div>
    </div>`;
}

function miniThumbStyle(p) {
  if (p?.image_url) {
    return `background-image: url('${escHtml(p.image_url)}'); background-size: cover; background-position: center;`;
  }
  const h = Number(p?.hue) || 220;
  return `background: repeating-linear-gradient(135deg, hsl(${h} 30% 96%) 0 4px, hsl(${h} 28% 90%) 4px 8px);`;
}

function wireEvents() {
  document.getElementById('shopCheckoutBackToShop')?.addEventListener('click', () => onBack());

  const note = document.getElementById('shopCheckoutNote');
  if (note) note.addEventListener('input', () => { state.buyerNote = note.value; });

  const buyerName  = document.getElementById('shopBuyerName');
  const buyerEmail = document.getElementById('shopBuyerEmail');
  const buyerPhone = document.getElementById('shopBuyerPhone');
  if (buyerName)  buyerName.addEventListener('input',  () => { state.buyerName  = buyerName.value;  });
  if (buyerEmail) buyerEmail.addEventListener('input', () => { state.buyerEmail = buyerEmail.value; syncRecap(); });
  if (buyerPhone) buyerPhone.addEventListener('input', () => { state.buyerPhone = buyerPhone.value; syncRecap(); });
  syncRecap();

  // แก้ไข on the recap sends the reader back to the fields it is showing —
  // scrolled AND focused. A link that only scrolls leaves them hunting for
  // which of three boxes to fix.
  document.getElementById('shopRecapEdit')?.addEventListener('click', () => {
    const target = document.getElementById('shopBuyerEmail');
    target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    target?.focus({ preventScroll: true });
  });

  // Per-account slip drops (one card per PromptPay group). Each drop/input
  // carries its group key in data-slip-drop / data-slip-file.
  document.querySelectorAll('[data-slip-drop]').forEach((drop) => {
    const key = drop.dataset.slipDrop;
    const input = drop.querySelector('[data-slip-file]');
    drop.addEventListener('click', () => input?.click());
    drop.addEventListener('dragover', (e) => e.preventDefault());
    drop.addEventListener('drop', (e) => {
      e.preventDefault();
      const f = e.dataTransfer.files?.[0];
      if (f) onSlipChosen(f, key);
    });
    input?.addEventListener('change', () => {
      const f = input.files?.[0];
      if (f) onSlipChosen(f, key);
    });
  });

  const agree = document.getElementById('shopCheckoutAgree');
  if (agree) {
    agree.addEventListener('change', () => {
      state.agree = agree.checked;
      // toggle the place button without a full re-render
      const place = document.getElementById('shopPlaceOrderBtn');
      const devSkip = getUser()?.role === 'dev';
      const groups = buildGroups(getCart(), getProductMap());
      if (place) place.disabled = !groupsSatisfied(groups, devSkip) || !state.agree;
    });
  }

  // Per-group "copy amount" buttons.
  document.querySelectorAll('[data-copy-amount]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(String(btn.dataset.copyAmount));
        showShopToast('คัดลอกจำนวนเงินแล้ว', 'success');
      } catch { showShopToast('คัดลอกไม่สำเร็จ — ลองทำเอง', 'warn'); }
    });
  });

  document.getElementById('shopPlaceOrderBtn')?.addEventListener('click', placeOrder);
}

/** Paint the recap from state. An empty field says so in its own words rather
 *  than showing a blank line — a blank reads as "nothing needed here", which is
 *  the opposite of true for a required contact. */
function syncRecap() {
  const set = (id, value, missing) => {
    const el = document.getElementById(id);
    if (!el) return;
    const v = (value || '').trim();
    el.textContent = v || missing;
    el.classList.toggle('is-missing', !v);
  };
  set('shopRecapEmail', state.buyerEmail, 'ยังไม่ได้กรอกอีเมล');
  set('shopRecapPhone', state.buyerPhone, 'ยังไม่ได้กรอกเบอร์โทรศัพท์');
}

function onSlipChosen(file, key) {
  if (file.size > 5 * 1024 * 1024) {
    showShopToast('ไฟล์ใหญ่เกิน 5 MB', 'warn');
    return;
  }
  state.slipFiles[key] = file;
  const reader = new FileReader();
  reader.onload = (e) => { state.slipPreviews[key] = e.target.result; renderCheckout(); };
  reader.readAsDataURL(file);
}

async function placeOrder() {
  const user = getUser();
  if (!user) { showShopToast('กรุณาเข้าสู่ระบบก่อน', 'warn'); return; }
  const devSkip = user.role === 'dev';
  const buyerName  = (state.buyerName  || '').trim();
  const buyerEmail = (state.buyerEmail || '').trim().toLowerCase();
  const buyerPhone = (state.buyerPhone || '').trim();
  if (!buyerName)  { showShopToast('กรุณากรอกชื่อผู้สั่ง', 'warn');
    document.getElementById('shopBuyerName')?.focus(); return; }
  if (!buyerEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(buyerEmail)) {
    showShopToast('กรุณากรอกอีเมลให้ถูกต้อง', 'warn');
    document.getElementById('shopBuyerEmail')?.focus(); return;
  }
  // Thai mobile / landline — 9-10 digits once non-digits are stripped.
  const phoneDigits = buyerPhone.replace(/\D/g, '');
  if (phoneDigits.length < 9 || phoneDigits.length > 10) {
    showShopToast('กรุณากรอกเบอร์โทรศัพท์ให้ถูกต้อง', 'warn');
    document.getElementById('shopBuyerPhone')?.focus(); return;
  }
  if (!state.agree)   { showShopToast('กรุณายอมรับเงื่อนไข', 'warn'); return; }
  const cart = getCart();
  if (cart.length === 0) { showShopToast('ตะกร้าว่าง', 'warn'); return; }
  const products = getProductMap();
  const groups = buildGroups(cart, products);
  if (!groupsSatisfied(groups, devSkip)) {
    showShopToast(groups.length > 1 ? 'อัปโหลดสลิปของทุกบัญชีก่อน' : 'อัปโหลดสลิปก่อน', 'warn');
    return;
  }

  const place = document.getElementById('shopPlaceOrderBtn');
  const originalLabel = place?.innerHTML;
  if (place) {
    place.disabled = true;
    place.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>กำลังบันทึกคำสั่งซื้อ…';
  }

  // One order per account group. Placed sequentially — each order is
  // committed independently, so on a mid-way failure the already-placed
  // orders stand and we drop only their items from the cart so a retry
  // can't double-charge them.
  const placedOrders = [];
  let failure = null;
  try {
    for (let gi = 0; gi < groups.length; gi++) {
      const g = groups[gi];
      if (place) {
        place.innerHTML = `<span class="spinner-border spinner-border-sm me-2"></span>`
          + (groups.length > 1 ? `กำลังบันทึกบัญชี ${gi + 1}/${groups.length}…` : 'กำลังบันทึกคำสั่งซื้อ…');
      }
      let slipUrl = null;
      let slipUploadedAt = null;
      const slipFile = state.slipFiles[g.key];
      if (slipFile) {
        const ext = (slipFile.name.match(/\.(\w+)$/)?.[1] || 'jpg').toLowerCase();
        const slipName = `${user.id}_${Date.now()}_${gi}.${ext}`;
        const folder = slipFolderForNow(new Date());
        slipUrl = await uploadShopFile(slipFile, folder, { fileName: slipName, maxEdge: SLIP_MAX_EDGE });
        slipUploadedAt = new Date().toISOString();
      }
      // Order-id prefix from the group's first product (falls back to "SH"
      // in the RPC when product.code is missing / pre-0023).
      const firstProduct = products[g.items[0].productId] || null;
      const order = await placeShopOrder({
        buyerId: user.id,
        buyerLabel: buyerName || user.name || user.username || user.email || '',
        buyerName,
        buyerEmail,
        buyerPhone,
        items: g.items,
        subtotal: g.subtotal,
        fee: 0,
        slipUrl,
        slipUploadedAt,
        pickupLocation: null,
        buyerNote: state.buyerNote,
        code: firstProduct?.code || '',
      });
      placedOrders.push({ order, key: g.key });
    }
  } catch (e) {
    console.error('[shop/checkout] placeOrder failed:', e);
    failure = e;
  }

  const placedKeys = new Set(placedOrders.map((p) => p.key));

  if (placedOrders.length === groups.length && !failure) {
    // All groups placed.
    clearCart();
    state.slipFiles = {};
    state.slipPreviews = {};
    state.buyerNote = '';
    state.buyerName = '';
    state.buyerEmail = '';
    state.buyerPhone = '';
    state.agree = false;
    const msg = placedOrders.length > 1
      ? `สั่งซื้อสำเร็จ ${placedOrders.length} รายการ — รอ admin ตรวจสอบสลิป`
      : `สั่งซื้อ ${placedOrders[0].order.id} สำเร็จ — รอ admin ตรวจสอบสลิป`;
    showShopToast(msg, 'success');
    onAfterPlace(placedOrders[0].order);
    return;
  }

  // Partial / total failure. Keep any committed orders, rebuild the cart
  // from the still-unplaced groups, and clear their spent slips.
  const remaining = groups.filter((g) => !placedKeys.has(g.key));
  clearCart();
  for (const g of remaining) for (const it of g.items) addItem(it);
  for (const key of placedKeys) { delete state.slipFiles[key]; delete state.slipPreviews[key]; }
  if (placedOrders.length > 0) {
    showShopToast(
      `บันทึกได้ ${placedOrders.length} บัญชีแล้ว แต่บัญชีที่เหลือล้มเหลว: ${failure?.message || failure}. ` +
      `รายการที่เหลืออยู่ในตะกร้า ลองสั่งใหม่อีกครั้ง`, 'error');
  } else {
    showShopToast(`สั่งซื้อไม่สำเร็จ: ${failure?.message || failure}`, 'error');
  }
  if (place) {
    place.disabled = false;
    place.innerHTML = originalLabel || 'ส่งสลิป & สั่งซื้อ';
  }
  renderCheckout();
}

// Decorative placeholder QR when no admin-uploaded image exists yet.
// Matches the design's stub — fixed grid with three corner finders so it
// reads as a QR at a glance.
function promptpayPlaceholderSvg(size) {
  const cells = 21;
  const cs = size / cells;
  let s = 9;
  const cells2 = [];
  for (let i = 0; i < cells * cells; i++) {
    s = (s * 9301 + 49297) % 233280;
    cells2.push(s / 233280 > 0.47);
  }
  const inBox = (x, y, cx, cy) => x >= cx && x < cx + 7 && y >= cy && y < cy + 7;
  const finder = (x, y) => inBox(x, y, 0, 0) || inBox(x, y, cells - 7, 0) || inBox(x, y, 0, cells - 7);
  let rects = '';
  cells2.forEach((on, i) => {
    const x = i % cells, y = Math.floor(i / cells);
    if (finder(x, y) || !on) return;
    rects += `<rect x="${(x * cs + .5).toFixed(2)}" y="${(y * cs + .5).toFixed(2)}" width="${(cs - 1).toFixed(2)}" height="${(cs - 1).toFixed(2)}" fill="#0d1a14"/>`;
  });
  const finders = [[0,0],[cells-7,0],[0,cells-7]].map(([fx, fy]) => `
    <g transform="translate(${fx * cs} ${fy * cs})">
      <rect width="${cs * 7}" height="${cs * 7}" fill="#0d1a14"/>
      <rect x="${cs}" y="${cs}" width="${cs * 5}" height="${cs * 5}" fill="#fff"/>
      <rect x="${cs * 2}" y="${cs * 2}" width="${cs * 3}" height="${cs * 3}" fill="#0d1a14"/>
    </g>`).join('');
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-label="PromptPay QR (placeholder)" role="img">
    <rect width="${size}" height="${size}" fill="#fff"/>
    ${rects}${finders}
    <g transform="translate(${size/2 - cs*2.2} ${size/2 - cs*1.2})">
      <rect width="${cs*4.4}" height="${cs*2.4}" rx="${cs*.3}" fill="#fff" stroke="#0d1a14" stroke-width="${cs*.18}"/>
      <text x="${cs*2.2}" y="${cs*1.6}" text-anchor="middle" font-family="Prompt, sans-serif" font-weight="700"
            font-size="${cs*1.3}" fill="#0066ad">pp</text>
    </g>
  </svg>`;
}

/** Force settings re-fetch (admin saved a new QR). */
export function invalidateSettingsCache() { settingsCache = null; }
