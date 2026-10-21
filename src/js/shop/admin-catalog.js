// ==============================================
// SHOP ADMIN — PromptPay QR settings + catalog-config managers (product
// types, pickup locations, PromptPay accounts; migration 0057). Split out
// of admin.js (task 19 — maintainability).
// ==============================================

import { escHtml, safeUrl } from '../utils.js';
import { slugify, setPromptpayQrs } from './data.js';
import { askConfirm } from '../confirm-modal.js';
import {
  getSettings, saveSettings,
  listProductTypes, upsertProductType, deleteProductType,
  listPromptpayQrs, upsertPromptpayQr, deletePromptpayQr, setDefaultQr,
  listPickupLocations, upsertPickupLocation, deletePickupLocation,
} from './api.js';
import { uploadShopFile, deleteShopFile } from './uploads.js';
import { showShopToast } from './products.js';
import { invalidateSettingsCache } from './checkout.js';
import { state, refreshCatalogConfig } from './admin.js';

// ---------------------------------------------------------------------
// QR settings
// ---------------------------------------------------------------------
export async function loadSettingsIntoForm() {
  try {
    state.settings = await getSettings();
  } catch (e) { showShopToast(`โหลดการตั้งค่าล้มเหลว: ${e.message || e}`, 'error'); return; }
  const s = state.settings || {};
  setVal('shopAdminQRName', s.promptpay_name);
  setVal('shopAdminQRId', s.promptpay_id);
  setVal('shopAdminQRInstructions', s.instructions);
  setVal('shopAdminQRContactGmail', s.contact_gmail);
  setVal('shopAdminQRContactInstagram', s.contact_instagram);
  const preview = document.getElementById('shopAdminQRPreview');
  if (preview) {
    if (s.promptpay_qr_url) {
      preview.innerHTML = `<img src="${safeUrl(s.promptpay_qr_url)}" alt="PromptPay QR" />`;
    } else {
      preview.innerHTML = `<div class="text-center"><i class="bi bi-qr-code fs-1 text-muted"></i><div class="mt-1">ยังไม่ได้อัปโหลด</div></div>`;
    }
  }
}

function setVal(id, v) { const el = document.getElementById(id); if (el) el.value = v || ''; }

export async function onQRFileChosen(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) { showShopToast('ไฟล์ใหญ่เกิน 5 MB', 'warn'); return; }
  const ext = (file.name.match(/\.(\w+)$/)?.[1] || 'png').toLowerCase();
  const fileName = `promptpay_${Date.now()}.${ext}`;
  try {
    const url = await uploadShopFile(file, 'Shop/QR', { fileName });
    const patch = { promptpay_qr_url: url };
    await saveSettings(patch);
    invalidateSettingsCache();
    state.settings = { ...(state.settings || {}), ...patch };
    const preview = document.getElementById('shopAdminQRPreview');
    if (preview) preview.innerHTML = `<img src="${safeUrl(url)}" alt="PromptPay QR" />`;
    showShopToast('อัปโหลด QR สำเร็จ', 'success');
  } catch (err) {
    showShopToast(`อัปโหลด QR ล้มเหลว: ${err.message || err}`, 'error');
  } finally {
    e.target.value = '';
  }
}

export async function saveSettingsForm() {
  const patch = {
    promptpay_name: document.getElementById('shopAdminQRName')?.value || '',
    promptpay_id: document.getElementById('shopAdminQRId')?.value || '',
    instructions: document.getElementById('shopAdminQRInstructions')?.value || '',
    contact_gmail: document.getElementById('shopAdminQRContactGmail')?.value || '',
    contact_instagram: document.getElementById('shopAdminQRContactInstagram')?.value || '',
  };
  try {
    await saveSettings(patch);
    invalidateSettingsCache();
    state.settings = { ...(state.settings || {}), ...patch };
    showShopToast('บันทึกการตั้งค่าแล้ว', 'success');
  } catch (e) { showShopToast(`บันทึกล้มเหลว: ${e.message || e}`, 'error'); }
}

// =====================================================================
// CATALOG CONFIG MANAGERS (migration 0057)
//   - Product types   → #shopAdminTypesHost  (catalog pane)
//   - Pickup locations → #shopAdminPickupHost (catalog pane)
//   - PromptPay QRs    → #shopAdminQrListHost (qr pane)
// Each is a small render-then-rewire card following the batch-editor
// pattern. refreshCatalogConfig() (above) reloads the lists into both
// admin state and the shared data.js caches after every mutation.
// =====================================================================

export async function refreshCatalog() {
  await refreshCatalogConfig();
  renderTypesManager();
  renderPickupManager();
}

/** Parse to an integer, preserving a legitimate 0 (unlike `Number(x) || d`,
 *  which would coerce 0 to the default). Falls back to `d` for empty/NaN. */
function intOr(v, d) {
  // Blank means "the default", not 0 — Number('') is 0.
  if (v == null || String(v).trim() === '') return d;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : d;
}

// ---- Product types ---------------------------------------------------

function renderTypesManager() {
  const host = document.getElementById('shopAdminTypesHost');
  if (!host) return;
  const rows = state.productTypes || [];
  const ed = state.typeEditor;
  host.innerHTML = `
    <div class="d-flex justify-content-between align-items-center mb-2">
      <h5 class="mb-0"><i class="bi bi-tags me-2 text-accent"></i>ประเภทสินค้า</h5>
      <button class="btn btn-shop btn-sm" data-type-add><i class="bi bi-plus-lg me-1"></i> เพิ่มประเภท</button>
    </div>
    ${ed ? typeEditorHtml(ed) : ''}
    <ul class="list-group">
      ${rows.length === 0 ? '<li class="list-group-item text-muted small">ยังไม่มีประเภท — กด "เพิ่มประเภท"</li>' :
        rows.map((t) => `
        <li class="list-group-item d-flex align-items-center gap-3" data-type-row="${escHtml(t.id)}">
          <i class="bi ${escHtml(t.icon || 'bi-tag')}"></i>
          <div class="flex-grow-1">
            <div style="font-weight:600;">${escHtml(t.label)}</div>
            <div class="small text-muted font-mono">${escHtml(t.id)}</div>
          </div>
          ${t.is_active
            ? '<span class="badge bg-success-subtle text-success border border-success-subtle">เปิด</span>'
            : '<span class="badge bg-secondary-subtle text-secondary border">ปิด</span>'}
          <button class="btn btn-sm btn-ghost" data-type-edit="${escHtml(t.id)}"><i class="bi bi-pencil"></i></button>
          <button class="btn btn-sm btn-ghost text-danger" data-type-del="${escHtml(t.id)}"><i class="bi bi-trash3"></i></button>
        </li>`).join('')}
    </ul>`;

  host.querySelector('[data-type-add]')?.addEventListener('click', () => {
    state.typeEditor = { id: '', label: '', icon: 'bi-tag', sort_order: (rows.length + 1) * 10, is_active: true, _new: true };
    renderTypesManager();
  });
  host.querySelectorAll('[data-type-edit]').forEach((b) => b.addEventListener('click', () => {
    const t = rows.find((x) => x.id === b.dataset.typeEdit);
    if (t) { state.typeEditor = { ...t, _new: false }; renderTypesManager(); }
  }));
  host.querySelectorAll('[data-type-del]').forEach((b) => b.addEventListener('click', () => onTypeDelete(b.dataset.typeDel)));
  if (ed) wireTypeEditor();
}

function typeEditorHtml(ed) {
  return `
    <div class="admin-detail-card mb-3" style="border:1.5px solid var(--shop-300);">
      <div class="row g-2">
        <div class="col-md-5">
          <label class="small text-muted mb-1">ชื่อประเภท</label>
          <input id="shopTypeLabel" class="form-control" value="${escHtml(ed.label)}" />
        </div>
        <div class="col-md-4">
          <label class="small text-muted mb-1">ไอคอน (bootstrap-icon)</label>
          <div class="input-group">
            <span class="input-group-text"><i class="bi ${escHtml(ed.icon || 'bi-tag')}" id="shopTypeIconPreview"></i></span>
            <input id="shopTypeIcon" class="form-control font-mono" value="${escHtml(ed.icon || 'bi-tag')}" placeholder="bi-tag" />
          </div>
          <div class="form-text">ดูรายชื่อที่ icons.getbootstrap.com</div>
        </div>
        <div class="col-md-3">
          <label class="small text-muted mb-1">ลำดับ</label>
          <input id="shopTypeSort" type="number" class="form-control" value="${Number(ed.sort_order) || 100}" />
        </div>
        <div class="col-12">
          <div class="form-check">
            <input id="shopTypeActive" class="form-check-input" type="checkbox" ${ed.is_active ? 'checked' : ''} />
            <label for="shopTypeActive" class="form-check-label">เปิดใช้งาน (แสดงเป็นตัวกรองให้ลูกค้า)</label>
          </div>
        </div>
      </div>
      <div class="d-flex justify-content-end gap-2 mt-2">
        <button class="btn btn-ghost btn-sm" data-type-cancel>ยกเลิก</button>
        <button class="btn btn-shop btn-sm" data-type-save><i class="bi bi-save me-1"></i> บันทึก</button>
      </div>
    </div>`;
}

function wireTypeEditor() {
  const icon = document.getElementById('shopTypeIcon');
  const prev = document.getElementById('shopTypeIconPreview');
  icon?.addEventListener('input', () => { if (prev) prev.className = `bi ${icon.value.trim() || 'bi-tag'}`; });
  document.querySelector('[data-type-cancel]')?.addEventListener('click', () => { state.typeEditor = null; renderTypesManager(); });
  document.querySelector('[data-type-save]')?.addEventListener('click', onTypeSave);
}

async function onTypeSave() {
  const ed = state.typeEditor;
  if (!ed) return;
  const label = document.getElementById('shopTypeLabel')?.value.trim() || '';
  if (!label) { showShopToast('กรอกชื่อประเภทก่อน', 'warn'); return; }
  // New rows get a slug id derived from the label; existing rows keep theirs
  // (the id is what products reference).
  let id = ed._new ? slugify(label) : ed.id;
  if (ed._new && state.productTypes.some((t) => t.id === id)) id = `${id}-${Math.floor(Math.random() * 999)}`;
  const row = {
    id,
    label,
    icon: document.getElementById('shopTypeIcon')?.value.trim() || 'bi-tag',
    sort_order: intOr(document.getElementById('shopTypeSort')?.value, 100),
    is_active: !!document.getElementById('shopTypeActive')?.checked,
  };
  try {
    await upsertProductType(row);
    showShopToast('บันทึกประเภทแล้ว', 'success');
    state.typeEditor = null;
    await refreshCatalog();
  } catch (e) { showShopToast(`บันทึกล้มเหลว: ${e.message || e}`, 'error'); }
}

async function onTypeDelete(id) {
  const inUse = (state.products || []).filter((p) => p.type === id).length;
  const warn = inUse > 0
    ? `มีสินค้า ${inUse} รายการใช้ประเภทนี้อยู่ — สินค้าจะยังอยู่ แต่จะแสดงรหัสประเภทแทนชื่อ`
    : '';
  if (!await askConfirm({ title: `ลบประเภท "${id}"?`, body: warn, yes: 'ลบ' })) return;
  try {
    await deleteProductType(id);
    showShopToast('ลบประเภทแล้ว', 'success');
    await refreshCatalog();
  } catch (e) { showShopToast(`ลบล้มเหลว: ${e.message || e}`, 'error'); }
}

// ---- Pickup locations ------------------------------------------------

function renderPickupManager() {
  const host = document.getElementById('shopAdminPickupHost');
  if (!host) return;
  const rows = state.pickupLocations || [];
  const ed = state.pickupEditor;
  host.innerHTML = `
    <div class="d-flex justify-content-between align-items-center mb-2">
      <h5 class="mb-0"><i class="bi bi-geo-alt me-2 text-accent"></i>สถานที่รับสินค้า</h5>
      <button class="btn btn-shop btn-sm" data-pickup-add><i class="bi bi-plus-lg me-1"></i> เพิ่มสถานที่</button>
    </div>
    ${ed ? pickupEditorHtml(ed) : ''}
    <ul class="list-group">
      ${rows.length === 0 ? '<li class="list-group-item text-muted small">ยังไม่มีสถานที่ — กด "เพิ่มสถานที่"</li>' :
        rows.map((l) => `
        <li class="list-group-item d-flex align-items-start gap-3" data-pickup-row="${escHtml(l.id)}">
          <i class="bi bi-geo-alt mt-1"></i>
          <div class="flex-grow-1">
            <div style="font-weight:600;">${escHtml(l.label)}</div>
            ${l.detail ? `<div class="small text-muted" style="white-space:pre-wrap;">${escHtml(l.detail)}</div>` : ''}
          </div>
          ${l.is_active
            ? '<span class="badge bg-success-subtle text-success border border-success-subtle">เปิด</span>'
            : '<span class="badge bg-secondary-subtle text-secondary border">ปิด</span>'}
          <button class="btn btn-sm btn-ghost" data-pickup-edit="${escHtml(l.id)}"><i class="bi bi-pencil"></i></button>
          <button class="btn btn-sm btn-ghost text-danger" data-pickup-del="${escHtml(l.id)}"><i class="bi bi-trash3"></i></button>
        </li>`).join('')}
    </ul>`;

  host.querySelector('[data-pickup-add]')?.addEventListener('click', () => {
    state.pickupEditor = { id: null, label: '', detail: '', sort_order: (rows.length + 1) * 10, is_active: true };
    renderPickupManager();
  });
  host.querySelectorAll('[data-pickup-edit]').forEach((b) => b.addEventListener('click', () => {
    const l = rows.find((x) => String(x.id) === b.dataset.pickupEdit);
    if (l) { state.pickupEditor = { ...l }; renderPickupManager(); }
  }));
  host.querySelectorAll('[data-pickup-del]').forEach((b) => b.addEventListener('click', () => onPickupDelete(b.dataset.pickupDel)));
  if (ed) {
    document.querySelector('[data-pickup-cancel]')?.addEventListener('click', () => { state.pickupEditor = null; renderPickupManager(); });
    document.querySelector('[data-pickup-save]')?.addEventListener('click', onPickupSave);
  }
}

function pickupEditorHtml(ed) {
  return `
    <div class="admin-detail-card mb-3" style="border:1.5px solid var(--shop-300);">
      <div class="row g-2">
        <div class="col-md-6">
          <label class="small text-muted mb-1">ชื่อสถานที่ (สั้น)</label>
          <input id="shopPickupLabel" class="form-control" value="${escHtml(ed.label)}" placeholder="เช่น ห้อง SAMO คณะแพทย์" />
        </div>
        <div class="col-md-6">
          <label class="small text-muted mb-1">ลำดับ</label>
          <input id="shopPickupSort" type="number" class="form-control" value="${Number(ed.sort_order) || 100}" />
        </div>
        <div class="col-12">
          <label class="small text-muted mb-1">รายละเอียด / วิธีเดินทาง (ไม่บังคับ)</label>
          <textarea id="shopPickupDetail" class="form-control shop-autogrow" rows="2">${escHtml(ed.detail || '')}</textarea>
        </div>
        <div class="col-12">
          <div class="form-check">
            <input id="shopPickupActive" class="form-check-input" type="checkbox" ${ed.is_active ? 'checked' : ''} />
            <label for="shopPickupActive" class="form-check-label">เปิดใช้งาน</label>
          </div>
        </div>
      </div>
      <div class="d-flex justify-content-end gap-2 mt-2">
        <button class="btn btn-ghost btn-sm" data-pickup-cancel>ยกเลิก</button>
        <button class="btn btn-shop btn-sm" data-pickup-save><i class="bi bi-save me-1"></i> บันทึก</button>
      </div>
    </div>`;
}

async function onPickupSave() {
  const ed = state.pickupEditor;
  if (!ed) return;
  const label = document.getElementById('shopPickupLabel')?.value.trim() || '';
  if (!label) { showShopToast('กรอกชื่อสถานที่ก่อน', 'warn'); return; }
  const row = {
    ...(ed.id != null ? { id: ed.id } : {}),
    label,
    detail: document.getElementById('shopPickupDetail')?.value.trim() || '',
    sort_order: intOr(document.getElementById('shopPickupSort')?.value, 100),
    is_active: !!document.getElementById('shopPickupActive')?.checked,
  };
  try {
    await upsertPickupLocation(row);
    showShopToast('บันทึกสถานที่แล้ว', 'success');
    state.pickupEditor = null;
    await refreshCatalog();
  } catch (e) { showShopToast(`บันทึกล้มเหลว: ${e.message || e}`, 'error'); }
}

async function onPickupDelete(id) {
  const inUse = (state.products || []).filter((p) => String(p.pickup_location_id) === String(id)).length;
  const warn = inUse > 0 ? `มีสินค้า ${inUse} รายการใช้สถานที่นี้ — จะถูกตั้งกลับเป็น "ไม่ระบุ"` : '';
  if (!await askConfirm({ title: 'ลบสถานที่นี้?', body: warn, yes: 'ลบ' })) return;
  try {
    await deletePickupLocation(id);
    showShopToast('ลบสถานที่แล้ว', 'success');
    await refreshCatalog();
  } catch (e) { showShopToast(`ลบล้มเหลว: ${e.message || e}`, 'error'); }
}

// ---- PromptPay QR list -----------------------------------------------

export async function refreshQrList() {
  const qrs = await listPromptpayQrs({ activeOnly: false }).catch(() => []);
  state.promptpayQrs = qrs;
  setPromptpayQrs(qrs);
  renderQrList();
}

function renderQrList() {
  const host = document.getElementById('shopAdminQrListHost');
  if (!host) return;
  const rows = state.promptpayQrs || [];
  const ed = state.qrEditor;
  host.innerHTML = `
    <div class="d-flex justify-content-between align-items-center mb-2">
      <h5 class="mb-0"><i class="bi bi-wallet2 me-2 text-accent"></i>บัญชี PromptPay</h5>
      <button class="btn btn-shop btn-sm" data-qr-add><i class="bi bi-plus-lg me-1"></i> เพิ่มบัญชี</button>
    </div>
    <p class="text-muted small">สินค้าแต่ละชิ้นเลือกบัญชีได้ในหน้าแก้ไขสินค้า — สินค้าที่ไม่ได้เลือกจะใช้ "บัญชีเริ่มต้น"</p>
    ${ed ? qrEditorHtml(ed) : ''}
    <ul class="list-group">
      ${rows.length === 0 ? '<li class="list-group-item text-muted small">ยังไม่มีบัญชี — กด "เพิ่มบัญชี"</li>' :
        rows.map((q) => `
        <li class="list-group-item d-flex align-items-center gap-3" data-qr-row="${escHtml(q.id)}">
          <div style="width:44px;height:44px;flex:0 0 auto;border-radius:6px;overflow:hidden;background:#f4f5f7;display:flex;align-items:center;justify-content:center;">
            ${q.qr_url ? `<img src="${safeUrl(q.qr_url)}" alt="" style="width:100%;height:100%;object-fit:cover;" />` : '<i class="bi bi-qr-code text-muted"></i>'}
          </div>
          <div class="flex-grow-1">
            <div style="font-weight:600;">${escHtml(q.label || q.promptpay_name || ('บัญชี #' + q.id))}
              ${q.is_default ? '<span class="badge bg-primary-subtle text-primary border border-primary-subtle ms-1">เริ่มต้น</span>' : ''}
              ${q.is_active ? '' : '<span class="badge bg-secondary-subtle text-secondary border ms-1">ปิด</span>'}
            </div>
            <div class="small text-muted">${escHtml(q.promptpay_name || '')} · <span class="font-mono">${escHtml(q.promptpay_id || '—')}</span></div>
          </div>
          ${q.is_default ? '' : `<button class="btn btn-sm btn-ghost" data-qr-default="${escHtml(q.id)}" title="ตั้งเป็นค่าเริ่มต้น"><i class="bi bi-star"></i></button>`}
          <button class="btn btn-sm btn-ghost" data-qr-edit="${escHtml(q.id)}"><i class="bi bi-pencil"></i></button>
          <button class="btn btn-sm btn-ghost text-danger" data-qr-del="${escHtml(q.id)}"><i class="bi bi-trash3"></i></button>
        </li>`).join('')}
    </ul>`;

  host.querySelector('[data-qr-add]')?.addEventListener('click', () => {
    state.qrEditor = { id: null, label: '', promptpay_name: '', promptpay_id: '', qr_url: '', instructions: '', is_active: true, sort_order: (rows.length + 1) * 10 };
    renderQrList();
  });
  host.querySelectorAll('[data-qr-edit]').forEach((b) => b.addEventListener('click', () => {
    const q = rows.find((x) => String(x.id) === b.dataset.qrEdit);
    if (q) { state.qrEditor = { ...q }; renderQrList(); }
  }));
  host.querySelectorAll('[data-qr-default]').forEach((b) => b.addEventListener('click', () => onQrSetDefault(b.dataset.qrDefault)));
  host.querySelectorAll('[data-qr-del]').forEach((b) => b.addEventListener('click', () => onQrDelete(b.dataset.qrDel)));
  if (ed) wireQrEditor();
}

function qrEditorHtml(ed) {
  return `
    <div class="admin-detail-card mb-3" style="border:1.5px solid var(--shop-300);">
      <div class="row g-2">
        <div class="col-md-6">
          <label class="small text-muted mb-1">ชื่อบัญชี (สำหรับแอดมิน)</label>
          <input id="shopQrLabel" class="form-control" value="${escHtml(ed.label || '')}" placeholder="เช่น บัญชี MD" />
        </div>
        <div class="col-md-6">
          <label class="small text-muted mb-1">ชื่อผู้รับเงิน (แสดงให้ลูกค้า)</label>
          <input id="shopQrName" class="form-control" value="${escHtml(ed.promptpay_name || '')}" />
        </div>
        <div class="col-md-6">
          <label class="small text-muted mb-1">PromptPay (เบอร์ / เลขผู้เสียภาษี)</label>
          <input id="shopQrId" class="form-control font-mono" value="${escHtml(ed.promptpay_id || '')}" />
        </div>
        <div class="col-md-6">
          <label class="small text-muted mb-1">รูป QR</label>
          <div class="d-flex gap-2 align-items-center">
            <div style="width:64px;height:64px;flex:0 0 auto;border-radius:6px;overflow:hidden;background:#f4f5f7;display:flex;align-items:center;justify-content:center;" id="shopQrPreview">
              ${ed.qr_url ? `<img src="${safeUrl(ed.qr_url)}" alt="" style="width:100%;height:100%;object-fit:cover;" />` : '<i class="bi bi-qr-code text-muted fs-4"></i>'}
            </div>
            <label class="btn btn-ghost btn-sm mb-0">
              <i class="bi bi-cloud-upload me-1"></i> ${ed.qr_url ? 'เปลี่ยนรูป' : 'อัปโหลด'}
              <input id="shopQrFile" type="file" accept="image/*" hidden />
            </label>
          </div>
        </div>
        <div class="col-12">
          <label class="small text-muted mb-1">คำสั่งเฉพาะบัญชีนี้ (ไม่บังคับ — ว่าง = ใช้ข้อความรวมด้านล่าง)</label>
          <textarea id="shopQrInstructions" class="form-control shop-autogrow" rows="2">${escHtml(ed.instructions || '')}</textarea>
        </div>
        <div class="col-12">
          <div class="form-check">
            <input id="shopQrActive" class="form-check-input" type="checkbox" ${ed.is_active ? 'checked' : ''} />
            <label for="shopQrActive" class="form-check-label">เปิดใช้งาน</label>
          </div>
        </div>
      </div>
      <div class="d-flex justify-content-end gap-2 mt-2">
        <button class="btn btn-ghost btn-sm" data-qr-cancel>ยกเลิก</button>
        <button class="btn btn-shop btn-sm" data-qr-save><i class="bi bi-save me-1"></i> บันทึก</button>
      </div>
    </div>`;
}

function wireQrEditor() {
  document.getElementById('shopQrFile')?.addEventListener('change', onQrEditorFileChosen);
  document.querySelector('[data-qr-cancel]')?.addEventListener('click', () => { state.qrEditor = null; renderQrList(); });
  document.querySelector('[data-qr-save]')?.addEventListener('click', onQrSave);
}

async function onQrEditorFileChosen(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) { showShopToast('ไฟล์ใหญ่เกิน 5 MB', 'warn'); return; }
  const ext = (file.name.match(/\.(\w+)$/)?.[1] || 'png').toLowerCase();
  // The account this image was picked FOR. The upload takes seconds; if the
  // admin opens another account meanwhile, writing to "whatever editor is open
  // now" put account A's QR on account B — and B's buyers paid A.
  const ed = state.qrEditor;
  if (!ed) return;
  try {
    const url = await uploadShopFile(file, 'Shop/QR', { fileName: `promptpay_${Date.now()}.${ext}` });
    if (state.qrEditor !== ed) {
      deleteShopFile(url);
      showShopToast('เปลี่ยนบัญชีที่แก้ไขไปแล้ว — รูป QR นี้ไม่ได้ถูกใส่ กรุณาเลือกใหม่', 'warn');
      return;
    }
    ed.qr_url = url;
    const prev = document.getElementById('shopQrPreview');
    if (prev) prev.innerHTML = `<img src="${safeUrl(url)}" alt="" style="width:100%;height:100%;object-fit:cover;" />`;
    showShopToast('อัปโหลด QR สำเร็จ', 'success');
  } catch (err) {
    showShopToast(`อัปโหลดล้มเหลว: ${err.message || err}`, 'error');
  } finally { e.target.value = ''; }
}

async function onQrSave() {
  const ed = state.qrEditor;
  if (!ed) return;
  const name = document.getElementById('shopQrName')?.value.trim() || '';
  const ppId = document.getElementById('shopQrId')?.value.trim() || '';
  if (!name && !ppId) { showShopToast('กรอกชื่อผู้รับเงินหรือเลข PromptPay อย่างน้อยหนึ่งอย่าง', 'warn'); return; }
  const row = {
    ...(ed.id != null ? { id: ed.id } : {}),
    label: document.getElementById('shopQrLabel')?.value.trim() || '',
    promptpay_name: name,
    promptpay_id: ppId,
    qr_url: ed.qr_url || null,
    instructions: document.getElementById('shopQrInstructions')?.value.trim() || '',
    is_active: !!document.getElementById('shopQrActive')?.checked,
    sort_order: intOr(ed.sort_order, 100),
  };
  try {
    await upsertPromptpayQr(row);
    showShopToast('บันทึกบัญชีแล้ว', 'success');
    state.qrEditor = null;
    await refreshQrList();
    setPromptpayQrs(state.promptpayQrs);
  } catch (e) { showShopToast(`บันทึกล้มเหลว: ${e.message || e}`, 'error'); }
}

async function onQrSetDefault(id) {
  try {
    await setDefaultQr(id);
    showShopToast('ตั้งเป็นบัญชีเริ่มต้นแล้ว', 'success');
    await refreshQrList();
  } catch (e) { showShopToast(`ล้มเหลว: ${e.message || e}`, 'error'); }
}

async function onQrDelete(id) {
  const q = (state.promptpayQrs || []).find((x) => String(x.id) === String(id));
  if (q?.is_default) { showShopToast('ตั้งบัญชีอื่นเป็นค่าเริ่มต้นก่อนจึงจะลบได้', 'warn'); return; }
  const inUse = (state.products || []).filter((p) => String(p.promptpay_qr_id) === String(id)).length;
  const warn = inUse > 0 ? `มีสินค้า ${inUse} รายการใช้บัญชีนี้ — จะถูกตั้งกลับเป็นบัญชีเริ่มต้น` : '';
  if (!await askConfirm({ title: 'ลบบัญชีนี้?', body: warn, yes: 'ลบ' })) return;
  try {
    await deletePromptpayQr(id);
    showShopToast('ลบบัญชีแล้ว', 'success');
    await refreshQrList();
  } catch (e) { showShopToast(`ลบล้มเหลว: ${e.message || e}`, 'error'); }
}

