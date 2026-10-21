// ==============================================
// SHOP ADMIN — Batches (pickup-round announcements). Split out of
// admin.js (task 19 — maintainability).
// ==============================================

import { escHtml, safeUrl } from '../utils.js';
import { batchDateEntries } from './data.js';
import { listAllBatches, listProducts, upsertBatch, closeBatch } from './api.js';
import { uploadShopFile, deleteShopFile } from './uploads.js';
import { holdInMemory } from '../read-file.js';
import { convertDriveUrl } from '../uploads.js';
import { showShopToast } from './products.js';
import { state } from './admin.js';
import { trashImageIfUnused } from './admin-image-cleanup.js';

// ---------------------------------------------------------------------
// Batches — multi-date with per-date hours; edit anytime
// ---------------------------------------------------------------------
export function blankBatch() {
  return {
    id: null,
    title: '',
    location: '',
    dates_full: [{ date: '', hours: '' }],
    product_ids: [],
    note: '',
    is_active: true,
  };
}

export async function refreshBatches() {
  try {
    const [batches, products] = await Promise.all([listAllBatches(), listProducts({ activeOnly: false })]);
    state.batches = batches;
    state.products = products;
    renderBatches();
  } catch (e) {
    showShopToast(`โหลดประกาศล้มเหลว: ${e.message || e}`, 'error');
  }
}

export function renderBatches() {
  const creator = document.getElementById('shopAdminBatchesCreator');
  const list = document.getElementById('shopAdminBatchesList');
  if (!creator || !list) return;

  creator.innerHTML = state.batchEditor ? batchEditorHtml(state.batchEditor) : '';
  if (state.batchEditor) wireBatchEditor();

  const active = state.batches.filter((b) => b.is_active);
  const closed = state.batches.filter((b) => !b.is_active);
  list.innerHTML = `
    <h6 class="text-muted text-uppercase small mt-3">ประกาศที่ใช้งานอยู่</h6>
    ${active.length === 0 ? '<div class="text-muted small">— ไม่มี —</div>' : active.map((b) => batchCardHtml(b, true)).join('')}
    ${closed.length ? `
      <h6 class="text-muted text-uppercase small mt-4">ประกาศก่อนหน้า</h6>
      ${closed.map((b) => batchCardHtml(b, false)).join('')}` : ''}`;

  list.querySelectorAll('[data-batch-edit]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = Number(btn.dataset.batchEdit);
      const b = state.batches.find((x) => x.id === id);
      if (!b) return;
      state.batchEditor = {
        ...b,
        dates_full: batchDateEntries(b).length ? batchDateEntries(b) : [{ date: '', hours: '' }],
      };
      renderBatches();
    });
  });
  list.querySelectorAll('[data-batch-close]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await closeBatch(Number(btn.dataset.batchClose));
        showShopToast('ปิดประกาศแล้ว', 'success');
        refreshBatches();
      } catch (e) { showShopToast(`ปิดประกาศล้มเหลว: ${e.message || e}`, 'error'); }
    });
  });
  list.querySelectorAll('[data-batch-reopen]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await upsertBatch({ id: Number(btn.dataset.batchReopen), is_active: true });
        showShopToast('เปิดประกาศอีกครั้งแล้ว', 'success');
        refreshBatches();
      } catch (e) { showShopToast(`เปิดประกาศล้มเหลว: ${e.message || e}`, 'error'); }
    });
  });
}

function batchCardHtml(b, isActive) {
  const entries = batchDateEntries(b);
  return `
    <div class="batch-card" ${isActive ? '' : 'style="opacity:.75;"'}>
      <div>
        <div class="b-name">${escHtml(b.title)} ${isActive ? '' : '<span class="badge bg-secondary-subtle text-secondary border ms-1">ปิดแล้ว</span>'}</div>
        <div class="b-meta mt-1">
          ${b.location ? `<i class="bi bi-geo-alt me-1"></i> ${escHtml(b.location)}` : ''}
        </div>
        ${entries.length ? `
          <div class="b-meta mt-1">
            ${entries.map((e) => `
              <span class="b-date-chip">
                <i class="bi bi-calendar3"></i> ${escHtml(e.date)}${e.hours ? ` <span class="opacity-75">· ${escHtml(e.hours)}</span>` : ''}
              </span>`).join('')}
          </div>` : ''}
        ${(b.product_ids || []).length ? `
          <div class="b-meta mt-1">
            <i class="bi bi-tag me-1"></i> ${(b.product_ids || []).map((pid) => escHtml(productName(pid))).join(', ')}
          </div>` : ''}
        ${b.note ? `<div class="b-meta mt-1"><i class="bi bi-info-circle me-1"></i>${escHtml(b.note)}</div>` : ''}
      </div>
      <div class="d-flex flex-column gap-2">
        <button class="btn btn-ghost btn-sm" data-batch-edit="${b.id}">
          <i class="bi bi-pencil me-1"></i> แก้ไข
        </button>
        ${isActive
          ? `<button class="btn btn-outline-danger btn-sm" data-batch-close="${b.id}"><i class="bi bi-archive me-1"></i> ปิดประกาศ</button>`
          : `<button class="btn btn-outline-success btn-sm" data-batch-reopen="${b.id}"><i class="bi bi-arrow-counterclockwise me-1"></i> เปิดอีกครั้ง</button>`}
      </div>
    </div>`;
}

function productName(id) {
  return state.products.find((p) => p.id === id)?.name || id;
}

function batchEditorHtml(b) {
  return `
    <div class="admin-detail-card mb-3" style="border:1.5px solid var(--shop-300);">
      <h5 class="text-accent"><i class="bi bi-megaphone me-1"></i> ${b.id ? 'แก้ไข' : 'สร้าง'}ประกาศการรับสินค้า</h5>
      <div class="row g-3">
        <div class="col-md-6">
          <label class="small text-muted mb-1">สินค้าที่ผลิตเสร็จ (เลือกได้มากกว่าหนึ่ง)</label>
          <select id="shopBatchProducts" class="form-select" multiple size="5">
            ${state.products.map((p) => `<option value="${escHtml(p.id)}" ${(b.product_ids || []).includes(p.id) ? 'selected' : ''}>${escHtml(p.name)}</option>`).join('')}
          </select>
        </div>
        <div class="col-md-6">
          <label class="small text-muted mb-1">หัวเรื่องประกาศ</label>
          <input id="shopBatchTitle" class="form-control" value="${escHtml(b.title)}"
            placeholder="เช่น เสื้อ RT69 รอบที่ 1 ผลิตเสร็จแล้ว!" />
        </div>
        <div class="col-md-6">
          <label class="small text-muted mb-1">จุดรับ</label>
          <input id="shopBatchLocation" class="form-control" value="${escHtml(b.location || '')}" placeholder="เช่น ห้องสโมสรนักศึกษาฯ ชั้น 1" />
        </div>
        <div class="col-md-6">
          <label class="small text-muted mb-1">รูปบนการ์ดประกาศ (ไม่บังคับ)</label>
          <div class="d-flex gap-3 align-items-center flex-wrap">
            ${batchImagePreview(b)}
            <label class="btn btn-ghost btn-sm mb-0">
              <i class="bi bi-image me-1"></i> ${b.image_url || b._imageFile ? 'เปลี่ยนรูป' : 'เลือกรูป'}
              <input id="shopBatchImageFile" type="file" accept="image/*" hidden />
            </label>
            ${b.image_url || b._imageFile ? `<button type="button" class="btn btn-ghost btn-sm text-danger" id="shopBatchImageRemove">
              <i class="bi bi-x-lg me-1"></i> เอารูปออก</button>` : ''}
          </div>
          <div class="form-text">ไม่ใส่ก็ได้ — ระบบจะใช้รูปของสินค้าที่เลือกไว้ด้านบน${b._imageFile ? ' · รูปใหม่จะอัปโหลดตอนกดบันทึก' : ''}</div>
        </div>
        <div class="col-md-6 d-flex align-items-end">
          <div class="form-check">
            <input id="shopBatchActive" class="form-check-input" type="checkbox" ${b.is_active ? 'checked' : ''} />
            <label for="shopBatchActive" class="form-check-label">เปิดแสดงในหน้าร้าน</label>
          </div>
        </div>
        <div class="col-12">
          <label class="small text-muted mb-1">วันที่และเวลารับ (เพิ่มได้หลายวัน แต่ละวันมีเวลาแยก)</label>
          <div id="shopBatchDateRows" class="d-flex flex-column gap-2">
            ${b.dates_full.map((e, i) => batchDateRowHtml(e, i)).join('')}
          </div>
          <button type="button" class="btn btn-ghost btn-sm mt-2" id="shopBatchAddDate">
            <i class="bi bi-plus-lg"></i> เพิ่มวัน
          </button>
        </div>
        <div class="col-12">
          <label class="small text-muted mb-1">หมายเหตุ (ไม่บังคับ)</label>
          <textarea id="shopBatchNote" class="form-control shop-autogrow" rows="2" placeholder="เช่น กรุณานำบัตรนักศึกษามาด้วย">${escHtml(b.note || '')}</textarea>
        </div>
      </div>
      <div class="d-flex justify-content-end gap-2 mt-3">
        <button type="button" class="btn btn-ghost" id="shopBatchCancel">ยกเลิก</button>
        <button type="button" class="btn btn-shop" id="shopBatchSave">
          <i class="bi bi-megaphone me-1"></i> ${b.id ? 'บันทึก' : 'ประกาศ'}
        </button>
      </div>
    </div>`;
}

function batchDateRowHtml(entry, idx) {
  return `
    <div class="batch-date-row d-flex gap-2 align-items-center" data-batch-row="${idx}">
      <div class="input-group input-group-sm" style="max-width:220px;">
        <span class="input-group-text bg-white"><i class="bi bi-calendar3"></i></span>
        <input type="text" class="form-control" data-batch-date-idx="${idx}" value="${escHtml(entry.date)}" placeholder="เช่น 27 พ.ค." />
      </div>
      <div class="input-group input-group-sm" style="max-width:220px;">
        <span class="input-group-text bg-white"><i class="bi bi-clock"></i></span>
        <input type="text" class="form-control" data-batch-hours-idx="${idx}" value="${escHtml(entry.hours)}" placeholder="เช่น 10:00–17:00 น." />
      </div>
      <button type="button" class="btn btn-ghost btn-sm text-danger" data-batch-remove-row="${idx}" title="ลบวันนี้">
        <i class="bi bi-trash3"></i>
      </button>
    </div>`;
}

/** Preview for the announcement picture: the file picked but not yet saved
 *  (a local blob URL), else the saved one, else what the storefront will fall
 *  back to — the first chosen product that has a picture — so the admin sees
 *  what customers will see. */
function batchImagePreview(b) {
  const style = 'width:96px; height:72px; object-fit:cover; border-radius:8px; border:1px solid var(--shop-ink-100, #ebecee);';
  // A blob: URL this page minted itself (createObjectURL) — safeUrl() allows
  // only http(s)/mailto/tel and would turn it into '#', so it is escaped, not
  // filtered.
  if (b._imagePreview && b._imagePreview.startsWith('blob:')) return `<img src="${escHtml(b._imagePreview)}" alt="" style="${style}" />`;
  if (b.image_url) return `<img src="${safeUrl(convertDriveUrl(b.image_url))}" alt="" style="${style}" />`;
  const p = (state.products || []).find((x) => (b.product_ids || []).includes(x.id) && x.image_url);
  if (p) return `<img src="${safeUrl(convertDriveUrl(p.image_url))}" alt="" style="${style} opacity:.6;" title="ใช้รูปสินค้าแทน" />`;
  return '';
}

function wireBatchEditor() {
  const b = state.batchEditor;
  // PICKED, not uploaded: the upload happens in the save handler, so a picture
  // chosen and then abandoned never becomes an orphan in Drive
  // (upload-on-save — the cleanup cannot reach a file nothing references).
  document.getElementById('shopBatchImageFile')?.addEventListener('change', async (e) => {
    const picked = e.target.files?.[0];
    if (!picked) return;
    if (picked.size > 8 * 1024 * 1024) { showShopToast('ไฟล์ใหญ่เกิน 8 MB', 'warn'); return; }
    // The bytes, not the handle — the upload waits for save (read-file.js).
    let f;
    try { f = await holdInMemory(picked); } catch (err) { showShopToast(err.message, 'error'); return; }
    if (state.batchEditor !== b) {
      showShopToast('เปลี่ยนประกาศที่แก้ไขไปแล้ว — รูปนี้ไม่ได้ถูกใส่ กรุณาเลือกใหม่', 'warn');
      return;
    }
    collectBatchEditorState();
    if (b._imagePreview) URL.revokeObjectURL(b._imagePreview);
    b._imageFile = f;
    b._imagePreview = URL.createObjectURL(f);
    renderBatches();
  });
  document.getElementById('shopBatchImageRemove')?.addEventListener('click', () => {
    collectBatchEditorState();
    if (b._imagePreview) URL.revokeObjectURL(b._imagePreview);
    b._imageFile = null; b._imagePreview = null; b.image_url = '';
    renderBatches();
  });
  document.getElementById('shopBatchCancel')?.addEventListener('click', () => { state.batchEditor = null; renderBatches(); });
  document.getElementById('shopBatchAddDate')?.addEventListener('click', () => {
    collectBatchEditorState();
    b.dates_full.push({ date: '', hours: '' });
    renderBatches();
  });
  document.querySelectorAll('[data-batch-remove-row]').forEach((btn) => {
    btn.addEventListener('click', () => {
      collectBatchEditorState();
      const i = Number(btn.dataset.batchRemoveRow);
      b.dates_full.splice(i, 1);
      if (b.dates_full.length === 0) b.dates_full.push({ date: '', hours: '' });
      renderBatches();
    });
  });
  document.getElementById('shopBatchSave')?.addEventListener('click', async () => {
    collectBatchEditorState();
    if (!b.title) { showShopToast('กรุณากรอกหัวเรื่อง', 'warn'); return; }
    const cleanDates = b.dates_full.filter((e) => e.date.trim());
    if (cleanDates.length === 0) { showShopToast('กรุณาระบุวันรับอย่างน้อย 1 วัน', 'warn'); return; }
    const payload = {
      id: b.id,
      title: b.title,
      location: b.location,
      dates_full: cleanDates,
      // Legacy mirror for older readers — single dates[] without hours per item.
      dates: cleanDates.map((e) => e.date),
      hours: cleanDates[0]?.hours || '',
      product_ids: b.product_ids,
      note: b.note,
      is_active: b.is_active,
      image_url: b.image_url || null,
    };
    // The picture this row is about to stop pointing at, for the cleanup below.
    const prev = String(state.batches.find((x) => x.id === b.id)?.image_url || '').trim();
    const btn = document.getElementById('shopBatchSave');
    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>กำลังบันทึก…'; }
    let uploadedNow = null;   // see saveProductForm: trashed if the write fails
    try {
      if (b._imageFile) {
        const ext = (b._imageFile.name.match(/\.(\w+)$/)?.[1] || 'jpg').toLowerCase();
        payload.image_url = await uploadShopFile(b._imageFile, 'Shop/Batches',
          { fileName: `batch_${Date.now()}.${ext}`, maxEdge: 2000 });
        uploadedNow = payload.image_url;
      }
      await upsertBatch(payload);
      uploadedNow = null;
      // Trash the replaced picture AFTER the write, and only if nothing else
      // still shows it — another announcement, or a product.
      if (prev && prev !== (payload.image_url || '')) trashImageIfUnused(prev);
      if (b._imagePreview) URL.revokeObjectURL(b._imagePreview);
      showShopToast('บันทึกประกาศแล้ว', 'success');
      state.batchEditor = null;
      refreshBatches();
    } catch (e) {
      if (uploadedNow) deleteShopFile(uploadedNow).catch(() => {});
      showShopToast(`บันทึกล้มเหลว: ${e.message || e}`, 'error');
      if (btn) { btn.disabled = false; btn.innerHTML = `<i class="bi bi-megaphone me-1"></i> ${b.id ? 'บันทึก' : 'ประกาศ'}`; }
    }
  });
}

function collectBatchEditorState() {
  const b = state.batchEditor;
  if (!b) return;
  b.title = document.getElementById('shopBatchTitle')?.value.trim() || '';
  b.location = document.getElementById('shopBatchLocation')?.value.trim() || '';
  b.note = document.getElementById('shopBatchNote')?.value.trim() || '';
  b.is_active = !!document.getElementById('shopBatchActive')?.checked;
  const ms = document.getElementById('shopBatchProducts');
  b.product_ids = ms ? Array.from(ms.selectedOptions).map((o) => o.value) : [];
  const newDates = [];
  b.dates_full.forEach((_, i) => {
    const d = document.querySelector(`[data-batch-date-idx="${i}"]`)?.value || '';
    const h = document.querySelector(`[data-batch-hours-idx="${i}"]`)?.value || '';
    newDates.push({ date: d.trim(), hours: h.trim() });
  });
  b.dates_full = newDates.length ? newDates : [{ date: '', hours: '' }];
}

