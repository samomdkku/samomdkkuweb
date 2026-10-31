// ==============================================
// SHOP ADMIN — Products (catalogue editor: pricing, variants, pictures,
// stock-matrix fields). Split out of admin.js (task 19 — maintainability).
// ==============================================

import { escHtml, safeUrl } from '../utils.js';
import {
  thb, findSource, SHOP_SOURCES, slugify, sanitizeOrderCode,
  STOCK_STATUSES, STOCK_STATUS_META, stockKey, totalStock, priceRange,
  getShopTypes, getPromptpayQrs, getPickupLocations,
  productImages, pictureAt, imageBase, CONFIRM_PICK_OVER, activeStock,
} from './data.js';
import { downscaleImage, decode } from '../image-resize.js';
import { askConfirm } from '../confirm-modal.js';
import {
  listProducts, upsertProduct, deleteProduct, archiveProduct, applyProductProductionStatus,
} from './api.js';
import { uploadShopFile, deleteShopFile } from './uploads.js';
import { holdInMemory } from '../read-file.js';
import { showShopToast } from './products.js';
import { state } from './admin.js';
import { trashImageIfUnused } from './admin-image-cleanup.js';

// ---------------------------------------------------------------------
// Products — drop fit, add stock_status, add stock matrix editor
// ---------------------------------------------------------------------
export function blankProduct() {
  // Default type = first real (non-'all') entry of the managed list, so a
  // new product picks a type that actually exists.
  const firstType = getShopTypes().find((t) => t.id !== 'all')?.id || 'apparel-shirt';
  return {
    id: '',
    name: '',
    sub: '',
    description: '',
    type: firstType,
    source: 'md',
    price: 0,
    sizes: ['S', 'M', 'L', 'XL'],
    colors: [{ id: 'black', label: 'ดำ', hex: '#1a1a1a' }],
    fits: ['unisex'],
    hue: 220,
    image_url: '',
    is_new: true,
    is_presale: false,
    presale_note: '',
    popularity: 0,
    is_active: true,
    stock_status: 'available',
    stock_matrix: {},
    preorder_stock_matrix: {},
    price_by_size: {},
    preorder_price_by_size: {},
    promptpay_qr_id: null,
    pickup_location_id: null,
    _images: [],
  };
}

export async function refreshProducts() {
  try {
    state.products = await listProducts({ activeOnly: false });
    renderProductsTable();
    collectProductEditorState();
    renderProductEditor();
  } catch (e) { showShopToast(`โหลดสินค้าล้มเหลว: ${e.message || e}`, 'error'); }
}

function renderProductsTable() {
  const tbody = document.getElementById('shopAdminProductsTbody');
  if (!tbody) return;
  if (state.products.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted py-4">ยังไม่มีสินค้า</td></tr>`;
    return;
  }
  tbody.innerHTML = state.products.map((p) => {
    const stockSum = totalStock(activeStock(p));
    return `
    <tr>
      <td>
        <div class="d-flex gap-2 align-items-center">
          <div style="width:28px; height:36px; border-radius:4px; flex:0 0 auto; ${miniStyle(p)}"></div>
          <div>
            <div style="font-weight:600;">${escHtml(p.name)}</div>
            <div class="small text-muted">${escHtml(p.sub || '')}</div>
          </div>
        </div>
      </td>
      <td>
        <span class="product-source" data-src="${escHtml(p.source)}">
          <span class="src-dot"></span> ${escHtml(findSource(p.source)?.label || p.source)}
        </span>
      </td>
      <td class="text-nowrap">
        <b>${(() => { const r = priceRange(p); return r.min === r.max ? `฿${thb(r.min)}` : `฿${thb(r.min)}–${thb(r.max)}`; })()}</b>
        ${(p.is_presale && p.preorder_price != null && Number(p.preorder_price) !== Number(p.price))
          ? `<span class="text-muted small text-decoration-line-through ms-1">฿${thb(p.price)}</span>`
          : ''}
      </td>
      <td>
        <span class="small text-muted">${(p.sizes || []).length} × ${(p.colors || []).length}</span>
        ${stockSum !== null ? `<div class="small">รวม ${stockSum} ชิ้น</div>` : '<div class="small text-muted">ไม่ระบุ</div>'}
      </td>
      <td>
        ${p.is_active
          ? `<span class="badge bg-success-subtle text-success border border-success-subtle">เปิดขาย</span>`
          : `<span class="badge bg-secondary-subtle text-secondary border">ปิด</span>`}
        ${p.is_presale ? `<span class="badge bg-warning-subtle text-warning border ms-1">Preorder</span>` : ''}
        ${p.stock_status && p.stock_status !== 'available'
          ? `<span class="badge ${STOCK_STATUS_META[p.stock_status]?.badgeCls || ''} ms-1">${escHtml(STOCK_STATUS_META[p.stock_status]?.label || p.stock_status)}</span>`
          : ''}
      </td>
      <td>
        <button class="btn btn-sm btn-ghost" data-product-edit="${escHtml(p.id)}"><i class="bi bi-pencil"></i></button>
        <button class="btn btn-sm btn-ghost text-danger" data-product-delete="${escHtml(p.id)}"><i class="bi bi-trash3"></i></button>
      </td>
    </tr>`;
  }).join('');

  tbody.querySelectorAll('[data-product-edit]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const p = state.products.find((x) => x.id === btn.dataset.productEdit);
      if (p) { releasePreviews(state.productEditor); state.productEditor = { ...p, _images: null, stock_matrix: { ...(p.stock_matrix || {}) }, preorder_stock_matrix: { ...(p.preorder_stock_matrix || {}) } }; renderProductEditor(); }
    });
  });
  tbody.querySelectorAll('[data-product-delete]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const pid = btn.dataset.productDelete;
      if (!await askConfirm({ title: `ลบสินค้า ${pid}?`, yes: 'ลบ' })) return;
      const images = productImages(state.products.find((x) => x.id === pid)).map((x) => x.url);
      try {
        await deleteProduct(pid);
        state.products = state.products.filter((x) => x.id !== pid);
        images.forEach((u) => trashImageIfUnused(u));
        showShopToast('ลบสินค้าแล้ว', 'success');
        refreshProducts();
      } catch (e) {
        // Product has order history → can't hard-delete. Offer to archive
        // (hide from shop) instead, which keeps the order records intact.
        if (e.code === 'PRODUCT_HAS_ORDERS') {
          if (await askConfirm({ title: 'ลบถาวรไม่ได้ — ปิดการขายแทนไหม?',
            body: 'สินค้านี้มีประวัติการสั่งซื้อ จึงลบถาวรไม่ได้ (เพื่อรักษาบันทึกคำสั่งซื้อเดิม) ถ้าปิดการขาย สินค้าจะถูกซ่อนจากหน้าร้าน แต่ยังเห็นและเปิดขายใหม่ได้ในแอดมิน',
            yes: 'ปิดการขาย', danger: false })) {
            try {
              await archiveProduct(pid);
              showShopToast('ปิดการขายแล้ว (ซ่อนจากหน้าร้าน)', 'success');
              refreshProducts();
            } catch (e2) { showShopToast(`ปิดการขายไม่สำเร็จ: ${e2.message || e2}`, 'error'); }
          }
          return;
        }
        showShopToast(`ลบไม่สำเร็จ: ${e.message || e}`, 'error');
      }
    });
  });
}

export function renderProductEditor() {
  const host = document.getElementById('shopAdminProductEditor');
  if (!host) return;
  if (!state.productEditor) { host.innerHTML = ''; return; }
  const p = state.productEditor;
  host.innerHTML = `
    <div class="admin-detail-card mb-3" style="border:1.5px solid var(--shop-300);">
      <h5 class="text-accent"><i class="bi bi-pencil-square me-1"></i> ${p.id ? 'แก้ไขสินค้า' : 'เพิ่มสินค้าใหม่'}</h5>
      <div class="row g-3">
        <div class="col-md-3">
          <label class="small text-muted mb-1">รหัสสินค้า (id ภายใน)</label>
          <input id="shopProdId" class="form-control font-mono" value="${escHtml(p.id || p._typedId || '')}" ${p.id ? 'disabled' : ''} placeholder="auto-generate ถ้าว่าง" />
          ${p.id ? '<div class="form-text">id ภายในแก้ไขไม่ได้ (เป็นกุญแจที่คำสั่งซื้อเก่าอ้างถึง)</div>' : ''}
        </div>
        <div class="col-md-2">
          <label class="small text-muted mb-1">รหัสนำหน้า Order</label>
          <input id="shopProdCode" class="form-control font-mono text-uppercase" maxlength="5"
            value="${escHtml(p.code || '')}" placeholder="SH" />
          <div class="form-text">ใช้นำหน้า Order ID เช่น "SH" → SH1234</div>
        </div>
        <div class="col-md-7">
          <label class="small text-muted mb-1">ชื่อสินค้า</label>
          <input id="shopProdName" class="form-control" value="${escHtml(p.name)}" />
        </div>
        <div class="col-md-6">
          <label class="small text-muted mb-1">คำบรรยายย่อ</label>
          <input id="shopProdSub" class="form-control" value="${escHtml(p.sub || '')}" />
        </div>
        <div class="col-md-3">
          <label class="small text-muted mb-1">ราคา (บาท)</label>
          <input id="shopProdPrice" type="number" min="0" class="form-control" value="${Number(p.price) || 0}" />
          <div class="form-text">ราคาเมื่อสินค้าพร้อมส่ง</div>
        </div>
        <div class="col-md-3">
          <label class="small text-muted mb-1">ราคา Preorder (บาท)</label>
          <input id="shopProdPreorderPrice" type="number" min="0" class="form-control"
                 value="${p.preorder_price == null ? '' : Number(p.preorder_price)}"
                 placeholder="ใช้ราคาเดียวกัน" />
          <div class="form-text">แสดงเมื่อ Preorder ติ๊ก — ปล่อยว่างเพื่อใช้ราคาปกติ</div>
        </div>
        <div class="col-md-3">
          <label class="small text-muted mb-1">โทนสีพื้นหลังเมื่อไม่มีรูป (0–360)</label>
          <div class="input-group">
            <span class="input-group-text shop-hue-swatch" id="shopProdHueSwatch"
              style="background: hsl(${Number(p.hue) || 220} 30% 90%);"></span>
            <input id="shopProdHue" type="number" min="0" max="360" class="form-control"
              value="${Number(p.hue) || 220}" />
          </div>
          <div class="form-text">เลื่อนค่าเพื่อปรับพื้นหลังลายพราง (placeholder) ของสินค้านี้</div>
        </div>
        <div class="col-md-4">
          <label class="small text-muted mb-1">แหล่งที่มา</label>
          <select id="shopProdSource" class="form-select">
            ${SHOP_SOURCES.filter((s) => s.id !== 'all').map((s) =>
              `<option value="${s.id}" ${p.source === s.id ? 'selected' : ''}>${escHtml(s.label)}</option>`).join('')}
          </select>
        </div>
        <div class="col-md-4">
          <label class="small text-muted mb-1">ประเภท</label>
          <select id="shopProdType" class="form-select">
            ${getShopTypes().filter((t) => t.id !== 'all').map((t) =>
              `<option value="${t.id}" ${p.type === t.id ? 'selected' : ''}>${escHtml(t.label)}</option>`).join('')}
          </select>
        </div>
        <div class="col-md-4">
          <label class="small text-muted mb-1">สถานะสต็อก</label>
          <select id="shopProdStockStatus" class="form-select">
            ${STOCK_STATUSES.map((s) =>
              `<option value="${s}" ${p.stock_status === s ? 'selected' : ''}>${escHtml(STOCK_STATUS_META[s]?.label || s)}</option>`).join('')}
          </select>
        </div>
        <div class="col-md-6">
          <label class="small text-muted mb-1">บัญชี PromptPay รับเงิน</label>
          <select id="shopProdQr" class="form-select">
            <option value="" ${p.promptpay_qr_id == null ? 'selected' : ''}>ค่าเริ่มต้น (บัญชีหลัก)</option>
            ${getPromptpayQrs().map((q) =>
              `<option value="${q.id}" ${String(p.promptpay_qr_id) === String(q.id) ? 'selected' : ''}>${escHtml(q.label || q.promptpay_name || ('บัญชี #' + q.id))}${q.is_default ? ' — ค่าเริ่มต้น' : ''}${q.is_active ? '' : ' (ปิด)'}</option>`).join('')}
          </select>
          <div class="form-text">ตะกร้าที่มีสินค้าหลายบัญชีจะถูกแยกเป็นหลายคำสั่งซื้อตอน checkout</div>
        </div>
        <div class="col-md-6">
          <label class="small text-muted mb-1">สถานที่รับสินค้า (แสดงให้ลูกค้าตอนซื้อ)</label>
          <select id="shopProdPickup" class="form-select">
            <option value="" ${p.pickup_location_id == null ? 'selected' : ''}>ไม่ระบุ</option>
            ${getPickupLocations().map((l) =>
              `<option value="${l.id}" ${String(p.pickup_location_id) === String(l.id) ? 'selected' : ''}>${escHtml(l.label || ('สถานที่ #' + l.id))}${l.is_active ? '' : ' (ปิด)'}</option>`).join('')}
          </select>
        </div>
        <div class="col-12">
          <div class="p-3 rounded" style="background: var(--shop-50, #f0f7f1); border: 1px solid var(--shop-100, #d6e9da);">
            <label class="small fw-bold mb-1">สถานะผลิตสินค้านี้ (กระทบกับคำสั่งซื้อ)</label>
            <select id="shopProdProductionStatus" class="form-select mb-2" style="max-width:280px;">
              <option value="pending"   ${(p._prodStatusDraft || p.production_status || 'pending') === 'pending' ? 'selected' : ''}>ยังไม่ผลิต — ไม่ขยับคำสั่งซื้อ</option>
              <option value="produced"  ${(p._prodStatusDraft || p.production_status) === 'produced'  ? 'selected' : ''}>สินค้าผลิตเสร็จแล้ว — ย้าย "ยืนยันการชำระเงิน" → "ผลิตเสร็จ"</option>
              <option value="announced" ${(p._prodStatusDraft || p.production_status) === 'announced' ? 'selected' : ''}>ประกาศรอบรับสินค้า — ย้ายต่อไป "ประกาศแล้ว"</option>
            </select>
            <div class="form-text mb-0">
              เลือก "สินค้าผลิตเสร็จแล้ว" จะย้ายเฉพาะคำสั่งซื้อสถานะ "ยืนยันการชำระเงิน". เลือก "ประกาศรอบรับสินค้า" จะย้ายทั้ง "ยืนยันการชำระเงิน" และ "สินค้าผลิตเสร็จแล้ว".
              คำสั่งซื้อที่อยู่ในสถานะปัญหา (สลิปไม่ถูกต้อง · ยกเลิก) จะไม่ถูกแตะ.
            </div>
          </div>
        </div>
        <div class="col-md-6">
          <label class="small text-muted mb-1">ไซส์ (คั่นด้วยจุลภาค — เช่น S,M,L,XL หรือ F สำหรับ free-size)</label>
          <input id="shopProdSizes" class="form-control" value="${escHtml((p.sizes || []).join(','))}" />
        </div>
        <div class="col-md-6">
          <label class="small text-muted mb-1">สี (เพิ่มได้ตามต้องการ — ปล่อยว่างถ้าสินค้านี้ไม่มีตัวเลือกสี)</label>
          <div id="shopProdColorsList" class="d-flex flex-column gap-2">${colorPickerRowsHtml(p.colors)}</div>
          <button type="button" class="btn btn-ghost btn-sm mt-1" id="shopProdColorsAdd">
            <i class="bi bi-plus-lg me-1"></i> เพิ่มสี
          </button>
        </div>
        <div class="col-12">
          <label class="small text-muted mb-1">รายละเอียด</label>
          <textarea id="shopProdDesc" class="form-control shop-autogrow" rows="3">${escHtml(p.description || '')}</textarea>
        </div>
        <div class="col-12">
          <label class="small text-muted mb-1 d-flex justify-content-between gap-2">
            <span>รูปสินค้า · ลากหรือกด ◀ ▶ เพื่อเรียง · รูปแรก = รูปปก · เลือกสีให้รูปได้</span>
            <span id="shopProdImgCount"></span>
          </label>
          <div class="shop-img-strip" id="shopProdImages"></div>
          <div class="form-text" id="shopProdImgNote"></div>
        </div>
        <div class="col-md-6 d-flex align-items-end gap-3 flex-wrap">
          <div class="form-check">
            <input id="shopProdIsNew" class="form-check-input" type="checkbox" ${p.is_new ? 'checked' : ''} />
            <label for="shopProdIsNew" class="form-check-label">NEW</label>
          </div>
          <div class="form-check">
            <input id="shopProdIsPresale" class="form-check-input" type="checkbox" ${p.is_presale ? 'checked' : ''} />
            <label for="shopProdIsPresale" class="form-check-label">Preorder</label>
          </div>
          <div class="form-check">
            <input id="shopProdIsActive" class="form-check-input" type="checkbox" ${p.is_active ? 'checked' : ''} />
            <label for="shopProdIsActive" class="form-check-label">เปิดขาย</label>
          </div>
        </div>
        <div class="col-12">
          <label class="small text-muted mb-1">หมายเหตุ Preorder</label>
          <input id="shopProdPresaleNote" class="form-control" value="${escHtml(p.presale_note || '')}" placeholder="เช่น ผลิตเสร็จ 20 มิ.ย. 2026" />
        </div>
        <div class="col-12">
          <label class="small text-muted mb-1">ราคาต่อไซส์ (ไม่บังคับ)</label>
          <div id="shopProdSizePrices">${sizePricesHtml(p)}</div>
          <div class="small text-muted mt-1">
            เว้นว่าง = ใช้ราคาด้านบน · ราคา Preorder ใช้ตอนติ๊ก Preorder เท่านั้น ถ้าเว้นว่างจะใช้ราคา Preorder ด้านบน
            (ถ้าไม่ได้ตั้งไว้ จะใช้ราคาปกติของไซส์นั้น)
          </div>
        </div>
        <div class="col-12">
          <label class="small text-muted mb-1">สต็อกพร้อมส่ง (ต่อไซส์ × สี) — ใช้เมื่อไม่ได้ติ๊ก Preorder</label>
          <div id="shopProdStockMatrix">${stockMatrixHtml(p, 'stock_matrix')}</div>
          <div class="small text-muted mt-1">
            ตั้งค่า "0" สำหรับตัวเลือกที่หมด — เว้นว่างไว้แปลว่ายังไม่ระบุ
          </div>
        </div>
        <div class="col-12">
          <label class="small text-muted mb-1">จำนวนรับ Preorder (ต่อไซส์ × สี) — ใช้เมื่อติ๊ก Preorder</label>
          <div id="shopProdPreorderStockMatrix">${stockMatrixHtml(p, 'preorder_stock_matrix')}</div>
          <div class="small text-muted mt-1">
            นับลดลงทุกครั้งที่มีคนสั่ง ยกเลิกออเดอร์แล้วคืนจำนวน — เว้นว่างทั้งตาราง = รับไม่จำกัด
            · สองตารางแยกกัน สลับติ๊ก Preorder แล้วตัวเลขของอีกตารางไม่เปลี่ยน
          </div>
        </div>
      </div>
      <div class="d-flex justify-content-end gap-2 mt-3">
        <button type="button" class="btn btn-ghost" id="shopProdCancel">ยกเลิก</button>
        <button type="button" class="btn btn-shop" id="shopProdSave">
          <i class="bi bi-save me-1"></i> บันทึก
        </button>
      </div>
    </div>`;

  wireImageStrip(p);

  // Re-render the matrix when sizes change so admin can dial in stock
  // immediately after editing variants. Color rows handle their own
  // refresh below via the colors-list delegated handler.
  document.getElementById('shopProdSizes')?.addEventListener('change', refreshMatrixOnly);
  // Stock typed HERE is sent on save; untouched, the editor's copy (taken when
  // it opened) is NOT — the สต็อก tab or another admin may have changed it since.
  document.getElementById('shopProdStockMatrix')?.addEventListener('input', () => { p._stockTouched = true; });
  document.getElementById('shopProdPreorderStockMatrix')?.addEventListener('input', () => { p._preorderStockTouched = true; });

  // Live hue swatch
  const hueInput = document.getElementById('shopProdHue');
  const hueSwatch = document.getElementById('shopProdHueSwatch');
  hueInput?.addEventListener('input', () => {
    const h = Math.max(0, Math.min(360, Number(hueInput.value) || 0));
    if (hueSwatch) hueSwatch.style.background = `hsl(${h} 30% 90%)`;
  });

  // Colors: add row, remove row, label/hex changes → refresh matrix.
  document.getElementById('shopProdColorsAdd')?.addEventListener('click', () => {
    const list = document.getElementById('shopProdColorsList');
    if (!list) return;
    const idx = list.children.length;
    list.insertAdjacentHTML('beforeend', colorPickerRowHtml({ id: '', label: '', hex: '#cccccc' }, idx));
    refreshMatrixOnly();
  });
  const colorsList = document.getElementById('shopProdColorsList');
  if (colorsList) {
    colorsList.addEventListener('click', (ev) => {
      const removeBtn = ev.target.closest('[data-color-remove]');
      if (!removeBtn) return;
      removeBtn.closest('.shop-color-row')?.remove();
      refreshMatrixOnly();
    });
    colorsList.addEventListener('input', refreshMatrixOnly);
  }

  document.getElementById('shopProdCancel')?.addEventListener('click', () => { releasePreviews(state.productEditor); state.productEditor = null; renderProductEditor(); });
  document.getElementById('shopProdSave')?.addEventListener('click', saveProductForm);
}

// ── Product pictures editor (docs/SHOP-GALLERY.md §3) ─────────────────────
// p._images: [{ url?, w, h, color, file?, preview? }] — a saved picture has a
// `url`; a picked one has a `file` (bytes held in memory, already shrunk) and a
// blob `preview`. Nothing reaches Drive until SAVE (upload-on-save), and a
// removed saved picture is trashed only after the save, only if unused.

let _imgSortable = null;
/** Release the blob previews of a picture list (cancel / save / switch). */
export function releasePreviews(p) {
  for (const im of (Array.isArray(p?._images) ? p._images : [])) {
    if (im.preview) { URL.revokeObjectURL(im.preview); im.preview = null; }
  }
}

function ensureImages(p) {
  if (!Array.isArray(p._images)) p._images = productImages(p).map((x) => ({ ...x }));
  return p._images;
}

function renderImageStrip(p) {
  const host = document.getElementById('shopProdImages');
  if (!host || state.productEditor !== p) return;
  const imgs = ensureImages(p);
  const colors = Array.isArray(p.colors) ? p.colors.filter((c) => c && c.id) : [];
  p._stripColorsKey = JSON.stringify((p.colors || []).map((c) => [c.id, c.label]));
  const known = new Set(colors.map((c) => c.id));
  const src = (im) => (im.preview && im.preview.startsWith('blob:')
    ? escHtml(im.preview)                      // minted by this page; safeUrl would drop blob:
    : safeUrl(pictureAt(im.url, 240)));
  host.innerHTML = imgs.map((im, i) => `
    <div class="shop-img-tile" data-img-idx="${i}">
      ${i === 0 ? '<span class="shop-img-cover">ปก</span>' : ''}
      ${im.file ? '<span class="shop-img-new">ใหม่</span>' : ''}
      <img src="${src(im)}" alt="" draggable="false" />
      <select class="form-select form-select-sm" data-img-color="${i}" aria-label="สีของรูปที่ ${i + 1}">
        <option value="">ทุกสี</option>
        ${colors.map((c) => `<option value="${escHtml(c.id)}" ${im.color === c.id ? 'selected' : ''}>${escHtml(c.label || c.id)}</option>`).join('')}
      </select>
      <div class="shop-img-actions">
        <button type="button" class="btn btn-ghost btn-sm" data-img-move="${i}" data-dir="-1" ${i === 0 ? 'disabled' : ''} aria-label="เลื่อนไปทางซ้าย">◀</button>
        <button type="button" class="btn btn-ghost btn-sm" data-img-move="${i}" data-dir="1" ${i === imgs.length - 1 ? 'disabled' : ''} aria-label="เลื่อนไปทางขวา">▶</button>
        <button type="button" class="btn btn-ghost btn-sm text-danger" data-img-remove="${i}" aria-label="ลบรูปที่ ${i + 1}">✕</button>
      </div>
    </div>`).join('') + `
    <label class="shop-img-add">
      <i class="bi bi-plus-lg"></i><span>เพิ่มรูป</span>
      <input type="file" accept="image/*" multiple hidden data-img-add />
    </label>`;
  const count = document.getElementById('shopProdImgCount');
  if (count) count.textContent = `${imgs.length} รูป`;
  const note = document.getElementById('shopProdImgNote');
  if (note) {
    const orphan = imgs.some((im) => im.color && !known.has(im.color));
    const pending = imgs.filter((im) => im.file).length;
    note.textContent = [
      pending ? `รูปใหม่ ${pending} รูปจะอัปโหลดตอนกดบันทึก` : '',
      orphan ? 'บางรูปติดสีที่ลบไปแล้ว — จะถือเป็น "ทุกสี"' : '',
    ].filter(Boolean).join(' · ');
  }
}

/** Wired once per editor render, on the strip CONTAINER (it survives strip
 *  re-renders, which replace only its children) — so no listener piles up. */
function wireImageStrip(p) {
  const host = document.getElementById('shopProdImages');
  if (!host) return;
  renderImageStrip(p);
  host.addEventListener('change', async (e) => {
    const sel = e.target.closest('[data-img-color]');
    if (sel) { ensureImages(p)[Number(sel.dataset.imgColor)].color = sel.value || null; return; }
    const input = e.target.closest('[data-img-add]');
    if (input) await addPickedImages(p, Array.from(input.files || []));
  });
  host.addEventListener('click', (e) => {
    const mv = e.target.closest('[data-img-move]');
    const rm = e.target.closest('[data-img-remove]');
    const imgs = ensureImages(p);
    if (mv) {
      const i = Number(mv.dataset.imgMove); const j = i + Number(mv.dataset.dir);
      if (j < 0 || j >= imgs.length) return;
      [imgs[i], imgs[j]] = [imgs[j], imgs[i]];
      renderImageStrip(p);
    } else if (rm) {
      const [gone] = imgs.splice(Number(rm.dataset.imgRemove), 1);
      if (gone?.preview) URL.revokeObjectURL(gone.preview);
      renderImageStrip(p);
    }
  });
  if (window.Sortable) {
    try { _imgSortable?.destroy(); } catch { /* its container is gone — fine */ }
    _imgSortable = window.Sortable.create(host, {
      draggable: '.shop-img-tile',
      filter: 'select, button',
      preventOnFilter: false,
      animation: 150,
      onEnd: () => {
        const imgs = ensureImages(p);
        const order = Array.from(host.querySelectorAll('.shop-img-tile')).map((t) => Number(t.dataset.imgIdx));
        p._images = order.map((i) => imgs[i]);
        renderImageStrip(p);
      },
    });
  }
}

/** Picked files → held, shrunk, measured — at pick time (read-file.js). */
async function addPickedImages(p, files) {
  if (!files.length) return;
  // No limit (0205) — but a pick this large is usually a whole folder dragged by
  // accident, and each picture is an upload on save. Ask once; any answer goes.
  if (files.length > CONFIRM_PICK_OVER
      && !await askConfirm({ title: `เพิ่มรูปทั้งหมด ${files.length} รูปใช่ไหม?`, body: 'แต่ละรูปจะอัปโหลดตอนกดบันทึก', yes: 'เพิ่ม', danger: false })) return;
  const note = document.getElementById('shopProdImgNote');
  if (note) note.textContent = 'กำลังเตรียมรูป…';
  p._preparing = (p._preparing || 0) + 1;   // saveProductForm waits for this
  const ready = [];
  // Copy EVERY file's bytes first, then shrink: shrinking one takes seconds,
  // and the phone may revoke the next file's handle meanwhile (read-file.js).
  const heldAll = await Promise.all(files.map((f) => holdInMemory(f).then((h) => ({ f, h }), (err) => ({ f, err }))));
  for (const { f, h: held, err: holdErr } of heldAll) {
    try {
      if (holdErr) throw holdErr;
      const small = await downscaleImage(held, { maxEdge: PRODUCT_IMAGE_EDGE, quality: 0.9 });
      const bmp = await decode(small);
      const w = bmp.width || bmp.naturalWidth; const h = bmp.height || bmp.naturalHeight;
      bmp.close?.();
      ready.push({ file: small, preview: URL.createObjectURL(small), w, h, color: null });
    } catch (err) {
      showShopToast(`${f.name}: ${err?.message || 'เปิดรูปนี้ไม่ได้'}`, 'error');
    }
  }
  p._preparing -= 1;
  if (state.productEditor !== p) {
    ready.forEach((x) => URL.revokeObjectURL(x.preview));
    showShopToast('เปลี่ยนสินค้าที่แก้ไขไปแล้ว — รูปที่เลือกไม่ได้ถูกใส่ กรุณาเลือกใหม่', 'warn');
    return;
  }
  ensureImages(p).push(...ready);
  renderImageStrip(p);
}

/** The long edge a product picture is stored at: zoom can only show pixels
 *  that were stored (the first picture was 1200 px — SHOP-GALLERY §0). */
const PRODUCT_IMAGE_EDGE = 2400;
/** The pause between two picture uploads in one save (see saveProductForm). */
const UPLOAD_GAP_MS = 500;

function refreshMatrixOnly() {
  const p = state.productEditor;
  if (!p) return;
  // Keep what was typed in the per-size price table AND the stock grid across
  // the re-render (stock used to reset to the saved numbers on every size or
  // colour keystroke).
  Object.assign(p, readSizePrices());
  p.stock_matrix = readStockMatrix('stock_matrix');
  p.preorder_stock_matrix = readStockMatrix('preorder_stock_matrix');
  // pull live values, replace in-memory + re-render only the matrix area
  p.sizes  = (document.getElementById('shopProdSizes')?.value || '').split(',').map((s) => s.trim()).filter(Boolean);
  // Read colors from the row picker (replaces the old JSON textarea).
  // readColorRows returns [] when the list isn't rendered yet — safe.
  p.colors = readColorRows();
  const host = document.getElementById('shopProdStockMatrix');
  if (host) host.innerHTML = stockMatrixHtml(p, 'stock_matrix');
  const preHost = document.getElementById('shopProdPreorderStockMatrix');
  if (preHost) preHost.innerHTML = stockMatrixHtml(p, 'preorder_stock_matrix');
  const prices = document.getElementById('shopProdSizePrices');
  if (prices) prices.innerHTML = sizePricesHtml(p);
  // Its colour menus list p.colors — re-render only when THAT changed: this
  // runs on the sizes field's change, which fires on blur, i.e. at mousedown
  // on a strip button, and replacing the strip there swallowed the click.
  const key = JSON.stringify((p.colors || []).map((c) => [c.id, c.label]));
  if (key !== p._stripColorsKey) renderImageStrip(p);
}

/** Per-size price table (0199): one row per size, a normal and a preorder
 *  price. Blank = the product-wide price applies — exactly the fallback
 *  public.shop_unit_price() uses, so what is typed here is what is charged. */
function sizePricesHtml(p) {
  const sizes = (p.sizes && p.sizes.length) ? p.sizes : ['F'];
  const reg = p.price_by_size || {};
  const pre = p.preorder_price_by_size || {};
  const val = (m, s) => (m[s] == null ? '' : Number(m[s]));
  return `
    <div class="stock-matrix">
      <table class="stock-matrix-table">
        <thead><tr><th>ไซส์</th><th>ราคาปกติ (บาท)</th><th>ราคา Preorder (บาท)</th></tr></thead>
        <tbody>
          ${sizes.map((s) => `
            <tr>
              <th>${escHtml(s === 'F' ? 'Free size' : s)}</th>
              <td><input type="number" min="0" step="1" class="form-control form-control-sm"
                   data-size-price="${escHtml(s)}" value="${val(reg, s)}" placeholder="ราคาด้านบน" /></td>
              <td><input type="number" min="0" step="1" class="form-control form-control-sm"
                   data-size-preorder-price="${escHtml(s)}" value="${val(pre, s)}" placeholder="ราคา Preorder ด้านบน" /></td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

/** Read the per-size table into { price_by_size, preorder_price_by_size }.
 *  Only sizes the product still HAS are kept, so removing a size from the
 *  list also removes its price. Blank / invalid → no entry (base applies). */
function readSizePrices() {
  const out = { price_by_size: {}, preorder_price_by_size: {} };
  const read = (attr, into) => document.querySelectorAll(`[${attr}]`).forEach((el) => {
    const raw = String(el.value || '').trim();
    if (raw === '') return;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) return;
    into[el.getAttribute(attr)] = Math.round(n);
  });
  read('data-size-price', out.price_by_size);
  read('data-size-preorder-price', out.preorder_price_by_size);
  return out;
}

/** One size × colour table of the editor. `field` is the column it edits:
 *  'stock_matrix' (in stock) or 'preorder_stock_matrix' (0210). */
function stockMatrixHtml(p, field) {
  const sizes = (p.sizes && p.sizes.length) ? p.sizes : ['F'];
  const colors = (p.colors && p.colors.length) ? p.colors : [{ id: 'default', label: 'มาตรฐาน', hex: '#ccc' }];
  const matrix = p[field] || {};
  return `
    <div class="stock-matrix">
      <table class="stock-matrix-table">
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
                return `<td>
                  <input type="number" min="0" class="form-control form-control-sm"
                    data-stock-field="${field}" data-stock-key="${escHtml(k)}"
                    value="${v === undefined || v === null ? '' : Number(v)}"
                    placeholder="-" />
                </td>`;
              }).join('')}
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

function readStockMatrix(field) {
  const matrix = {};
  document.querySelectorAll(`[data-stock-field="${field}"][data-stock-key]`).forEach((el) => {
    const k = el.dataset.stockKey;
    const raw = el.value.trim();
    if (raw === '') return;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) return;
    matrix[k] = Math.floor(n);
  });
  return matrix;
}

/** Every field of the product editor as it stands in the DOM. ONE reader for
 *  both saving and "collect before a re-render": the editor re-renders from
 *  state.productEditor (picking an image, changing sizes/colours, reloading
 *  products), and without collecting first everything typed since it opened —
 *  name, prices, stock numbers — was reset to the saved values. */
function readProductForm() {
  // Read color rows out of the picker UI. Each row contributes
  // { id, label, hex } — id falls back to a slug of the label so admin
  // doesn't have to think about it.
  const colors = readColorRows();
  return {
    code: sanitizeOrderCode(document.getElementById('shopProdCode')?.value || ''),
    name: document.getElementById('shopProdName')?.value.trim() || '',
    sub: document.getElementById('shopProdSub')?.value.trim() || null,
    description: document.getElementById('shopProdDesc')?.value || null,
    source: document.getElementById('shopProdSource')?.value || 'md',
    type: document.getElementById('shopProdType')?.value || 'apparel-shirt',
    // Whole baht: every price column is integer, and 199.5 used to come back
    // as a raw Postgres error.
    price: Math.max(0, Math.round(Number(document.getElementById('shopProdPrice')?.value) || 0)),
    preorder_price: (() => {
      const raw = document.getElementById('shopProdPreorderPrice')?.value;
      if (raw == null || String(raw).trim() === '') return null;
      const n = Number(raw);
      return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
    })(),
    hue: Math.max(0, Math.min(360, Number(document.getElementById('shopProdHue')?.value) || 220)),
    sizes: (document.getElementById('shopProdSizes')?.value || '').split(',').map((s) => s.trim()).filter(Boolean),
    fits: ['unisex'],
    colors,
    is_new: !!document.getElementById('shopProdIsNew')?.checked,
    is_presale: !!document.getElementById('shopProdIsPresale')?.checked,
    is_active: !!document.getElementById('shopProdIsActive')?.checked,
    stock_status: document.getElementById('shopProdStockStatus')?.value || 'available',
    stock_matrix: readStockMatrix('stock_matrix'),
    preorder_stock_matrix: readStockMatrix('preorder_stock_matrix'),
    ...(() => {
      // Drop entries for sizes no longer on the product.
      const sizes = (document.getElementById('shopProdSizes')?.value || '').split(',').map((x) => x.trim()).filter(Boolean);
      const keep = new Set(sizes.length ? sizes : ['F']);
      const { price_by_size, preorder_price_by_size } = readSizePrices();
      const only = (m) => Object.fromEntries(Object.entries(m).filter(([k]) => keep.has(k)));
      return { price_by_size: only(price_by_size), preorder_price_by_size: only(preorder_price_by_size) };
    })(),
    presale_note: document.getElementById('shopProdPresaleNote')?.value.trim() || null,
    // Catalog config (migration 0057). Empty select value → null (default
    // account / no pickup line).
    promptpay_qr_id: (() => { const v = document.getElementById('shopProdQr')?.value; return v ? Number(v) : null; })(),
    pickup_location_id: (() => { const v = document.getElementById('shopProdPickup')?.value; return v ? Number(v) : null; })(),
  };
}

/** Fold what is typed into state.productEditor. A no-op when the form is not
 *  on screen (it was never rendered, or has closed). */
function collectProductEditorState() {
  const p = state.productEditor;
  if (!p || !document.getElementById('shopProdName')) return;
  Object.assign(p, readProductForm());
  // A DRAFT, not production_status: save compares the dropdown with the SAVED
  // value to decide whether to cascade the change onto orders.
  const ps = document.getElementById('shopProdProductionStatus')?.value;
  if (ps) p._prodStatusDraft = ps;
  if (!p.id) p._typedId = document.getElementById('shopProdId')?.value || '';
}

async function saveProductForm() {
  const e = state.productEditor;
  if (!e) return;
  const name = document.getElementById('shopProdName')?.value.trim() || '';
  if (!name) { showShopToast('กรุณากรอกชื่อสินค้า', 'warn'); return; }
  if (e._preparing > 0) { showShopToast('กำลังเตรียมรูป — รอสักครู่แล้วกดบันทึกอีกครั้ง', 'warn'); return; }
  // Two colour rows with one id (the new-product template starts with 'black';
  // add another 'ดำ' and both slug to it) merge into ONE stock cell and one
  // picture tag, silently. Refuse, and name it.
  {
    const ids = readColorRows().map((c) => c.id);
    const dup = ids.find((id, i) => ids.indexOf(id) !== i);
    if (dup) { showShopToast(`มีสีที่รหัสซ้ำกัน: "${dup}" — ลบแถวที่ซ้ำ หรือใส่ id ให้ต่างกัน`, 'warn'); return; }
  }

  // A NEW product: the id typed in the form (it says "auto-generate ถ้าว่าง" —
  // it used to be ignored), else a generated one. Either way it must not be an
  // existing product's, because the save is an upsert and would overwrite it.
  let newProductIdTaken = false;
  const newProductId = (nm) => {
    const raw = (document.getElementById('shopProdId')?.value || '').trim();
    const typed = raw ? slugify(raw) : '';   // slugify('') is 'item', not ''
    const taken = new Set((state.products || []).map((x) => x.id));
    if (typed) { newProductIdTaken = taken.has(typed); return typed; }
    let id;
    do { id = `p-${slugify(nm)}-${Math.floor(Math.random() * 999)}`; } while (taken.has(id));
    return id;
  };
  const payload = {
    id: e.id || newProductId(name),
    ...readProductForm(),
    name,
    image_url: e.image_url || null,   // dropped before the write — the trigger derives it
  };
  if (e.id && !e._stockTouched) delete payload.stock_matrix;
  if (e.id && !e._preorderStockTouched) delete payload.preorder_stock_matrix;
  if (newProductIdTaken) {
    showShopToast(`มีสินค้ารหัส ${payload.id} อยู่แล้ว — ใช้รหัสอื่น หรือเว้นว่างให้ระบบสร้างให้`, 'warn');
    return;
  }

  const btn = document.getElementById('shopProdSave');
  const original = btn?.innerHTML;
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>กำลังบันทึก…'; }

  // The pictures the row is about to stop pointing at are trashed only AFTER
  // the write, and only if nothing else shows them (trashImageIfUnused).
  const prevUrls = productImages(e).map((x) => x.url);
  // Everything THIS attempt put in Drive; trashed if the write fails, so a
  // retry does not leave another public copy behind.
  let uploadedNow = [];
  try {
    const colorIds = new Set((payload.colors || []).map((c) => c.id));
    const list = ensureImages(e);
    const images = [];
    let uploads = 0;
    for (let k = 0; k < list.length; k += 1) {
      const im = list[k];
      let url = im.url;
      if (im.file) {
        // Paced (0205 made a product's pictures unlimited): Apps Script called
        // back-to-back starts answering with an HTML page and the upload fails
        // (memory: gas-is-an-unauthenticated-api). One gap per upload after the first.
        if (uploads++) await new Promise((ok) => setTimeout(ok, UPLOAD_GAP_MS));
        if (btn) btn.innerHTML = `<span class="spinner-border spinner-border-sm me-2"></span>กำลังอัปโหลดรูป ${k + 1}/${list.length}…`;
        const ext = ({ 'image/webp': 'webp', 'image/png': 'png', 'image/gif': 'gif', 'image/jpeg': 'jpg' })[im.file.type]
          || (im.file.name.match(/\.(\w+)$/)?.[1] || 'jpg').toLowerCase();
        url = imageBase(await uploadShopFile(im.file, `Shop/Products/${payload.id}`,
          { fileName: `${slugify(name)}_${Date.now()}_${k}.${ext}` }));
        uploadedNow.push(url);
      }
      images.push({ url, w: im.w || null, h: im.h || null,
        color: im.color && colorIds.has(im.color) ? im.color : null });
    }
    // image_url is the database's to derive (0203) — the cover is images[0].
    payload.images = images;
    delete payload.image_url;
    if (btn) btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>กำลังบันทึก…';
    await upsertProduct(payload);
    uploadedNow = [];
    const kept = new Set(images.map((x) => x.url));
    for (const u of prevUrls) if (!kept.has(u)) trashImageIfUnused(u);
    releasePreviews(e);

    // Production status cascade — only when the dropdown changed from
    // the original. The RPC owns the field + the order cascade so this
    // path doesn't have to coordinate two writes.
    const newProdStatus = document.getElementById('shopProdProductionStatus')?.value || 'pending';
    const oldProdStatus = e.production_status || 'pending';
    if (newProdStatus !== oldProdStatus) {
      const ok = await maybeConfirmCascade(newProdStatus);
      if (ok) {
        try {
          const r = await applyProductProductionStatus(payload.id, newProdStatus);
          const moved = (r.moved_to_produce || 0) + (r.moved_to_ready || 0);
          if (moved > 0) {
            showShopToast(`อัปเดต ${moved} คำสั่งซื้อตามสถานะผลิตใหม่`, 'success');
          }
        } catch (err) {
          showShopToast(`สถานะผลิตอัปเดตไม่สำเร็จ: ${err.message || err}`, 'warn');
        }
      }
    }

    showShopToast('บันทึกสินค้าแล้ว', 'success');
    state.productEditor = null;
    refreshProducts();
  } catch (err) {
    for (const u of uploadedNow) deleteShopFile(u).catch(() => {});
    showShopToast(`บันทึกล้มเหลว: ${err.message || err}`, 'error');
    if (btn) { btn.disabled = false; btn.innerHTML = original || 'บันทึก'; }
  }
}

/** Resolves true/false — ALWAYS a promise, so both callers' `await` reads it. */
export function maybeConfirmCascade(nextStatus) {
  if (nextStatus === 'pending') return Promise.resolve(true); // no cascade
  const msg = nextStatus === 'produced'
    ? 'จะย้ายคำสั่งซื้อสถานะ "ยืนยันการชำระเงิน" ที่มีสินค้านี้ทั้งหมดไปเป็น "สินค้าผลิตเสร็จแล้ว". ยืนยัน?'
    : 'จะย้ายคำสั่งซื้อสถานะ "ยืนยันการชำระเงิน" และ "สินค้าผลิตเสร็จแล้ว" ที่มีสินค้านี้ทั้งหมดไปเป็น "ประกาศแล้ว". ยืนยัน?';
  return askConfirm({ title: 'ย้ายสถานะคำสั่งซื้อที่มีสินค้านี้ด้วย?', body: msg.replace(/ ยืนยัน\?$/, ''), yes: 'ย้ายสถานะ', danger: false });
}

function miniStyle(p) {
  if (p?.image_url) return `background-image: url('${escHtml(p.image_url)}'); background-size: cover; background-position: center;`;
  const h = Number(p?.hue) || 220;
  return `background: repeating-linear-gradient(135deg, hsl(${h} 30% 96%) 0 4px, hsl(${h} 28% 90%) 4px 8px);`;
}


// =====================================================================
// PRODUCT EDITOR — color picker helpers
// =====================================================================

function colorPickerRowsHtml(colors) {
  const list = Array.isArray(colors) ? colors : [];
  if (list.length === 0) {
    return ''; // empty — admin adds rows via the "เพิ่มสี" button
  }
  return list.map((c, i) => colorPickerRowHtml(c, i)).join('');
}

function colorPickerRowHtml(c, i) {
  const id = String(c?.id || '');
  const label = String(c?.label || '');
  const hex = sanitizeHex(c?.hex) || '#cccccc';
  return `
    <div class="shop-color-row d-flex align-items-center gap-2" data-color-row="${i}">
      <input type="color" class="form-control form-control-color shop-color-row-hex"
        value="${escHtml(hex)}" data-color-hex title="เลือกสี" />
      <input type="text" class="form-control shop-color-row-label"
        value="${escHtml(label)}" placeholder="ชื่อสี (เช่น แดง, ขาว)" data-color-label />
      <input type="text" class="form-control font-mono shop-color-row-id"
        value="${escHtml(id)}" placeholder="id (ไม่บังคับ)" data-color-id
        style="max-width:110px;" />
      <button type="button" class="btn btn-ghost btn-sm" data-color-remove title="ลบสีนี้">
        <i class="bi bi-x-lg"></i>
      </button>
    </div>`;
}

function readColorRows() {
  const list = document.getElementById('shopProdColorsList');
  if (!list) return [];
  const rows = list.querySelectorAll('.shop-color-row');
  const out = [];
  rows.forEach((row) => {
    const hex = sanitizeHex(row.querySelector('[data-color-hex]')?.value) || '#cccccc';
    const label = (row.querySelector('[data-color-label]')?.value || '').trim();
    const rawId = (row.querySelector('[data-color-id]')?.value || '').trim();
    // Skip totally empty rows so accidental "add" doesn't leak.
    if (!label && !rawId) return;
    const id = rawId || slugify(label);
    out.push({ id, label: label || id, hex });
  });
  return out;
}

function sanitizeHex(s) {
  if (!s) return '';
  const v = String(s).trim().toLowerCase();
  return /^#[0-9a-f]{6}$/.test(v) ? v : '';
}
