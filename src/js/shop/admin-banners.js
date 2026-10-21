// ==============================================
// SHOP ADMIN — Banners (hero carousel for the shop landing). Split out of
// admin.js (task 19 — maintainability).
// ==============================================

import { escHtml, safeUrl } from '../utils.js';
import { bannerLinkTarget } from './data.js';
import {
  listShopBanners, createShopBanner, updateShopBanner, deleteShopBanner, reorderShopBanners,
} from './api.js';
import { uploadShopFile, deleteShopFile } from './uploads.js';
import { convertDriveUrl } from '../uploads.js';
import { askConfirm } from '../confirm-modal.js';
import { showShopToast } from './products.js';
import { state } from './admin.js';
import { trashImageIfUnused } from './admin-image-cleanup.js';

// =====================================================================
// BANNERS — admin-curated hero carousel for the shop landing
// =====================================================================

let _bannerSortable = null;

export async function refreshBanners() {
  const list = document.getElementById('shopAdminBannersList');
  if (!list) return;
  try {
    const banners = await listShopBanners({ activeOnly: false });
    state.banners = banners;
    renderBannerList();
  } catch (e) {
    list.innerHTML = `<li class="list-group-item text-danger small">โหลดล้มเหลว: ${escHtml(e.message || e)}</li>`;
  }
}

function renderBannerList() {
  const list = document.getElementById('shopAdminBannersList');
  if (!list) return;
  const placement = state.bannerPlacement || 'launch';
  // Reflect the active placement on the toggle.
  document.querySelectorAll('#shopAdminBannerPlacement [data-banner-placement]')
    .forEach((b) => b.classList.toggle('active', b.dataset.bannerPlacement === placement));
  const items = (state.banners || []).filter((b) => (b.placement || 'launch') === placement);
  if (items.length === 0) {
    const hint = placement === 'announcement'
      ? 'ยังไม่มีแบนเนอร์ประกาศ — กด "เพิ่มแบนเนอร์" เพื่อเริ่มต้น'
      : 'ยังไม่มีแบนเนอร์เปิดตัว — กด "เพิ่มแบนเนอร์" เพื่อเริ่มต้น';
    list.innerHTML = `<li class="list-group-item text-muted small">${hint}</li>`;
    if (_bannerSortable) { try { _bannerSortable.destroy(); } catch { /* noop */ } _bannerSortable = null; }
    return;
  }
  list.innerHTML = items.map((b) => `
    <li class="list-group-item d-flex align-items-center gap-3 flex-wrap" data-banner-id="${escHtml(b.id)}">
      <span class="banner-handle" style="cursor:grab;" aria-label="ลากเพื่อจัดเรียง">
        <i class="bi bi-grip-vertical fs-5 text-muted"></i>
      </span>
      <img src="${safeUrl(convertDriveUrl(b.image_url))}" alt=""
        style="width:120px; aspect-ratio:21/9; object-fit:cover; border-radius:6px; flex-shrink:0; background:#f5f5f5;">
      <div class="flex-grow-1" style="min-width:200px;">
        <input class="form-control form-control-sm banner-caption mb-1"
          placeholder="ข้อความบนแบนเนอร์ (ไม่บังคับ)"
          value="${escHtml(b.caption || '')}" data-banner-id="${escHtml(b.id)}" />
        <input class="form-control form-control-sm banner-link"
          placeholder="ลิงก์เมื่อกด (ไม่บังคับ — เช่น /shop หรือ URL ภายนอก)"
          value="${escHtml(b.link_url || '')}" data-banner-id="${escHtml(b.id)}" />
      </div>
      <div class="form-check form-switch flex-shrink-0" title="${b.is_active ? 'กำลังแสดงในหน้าร้าน' : 'ซ่อนอยู่'}">
        <input class="form-check-input banner-active" type="checkbox"
          ${b.is_active ? 'checked' : ''} data-banner-id="${escHtml(b.id)}">
        <label class="form-check-label small text-muted">${b.is_active ? 'แสดง' : 'ซ่อน'}</label>
      </div>
      <button class="btn btn-sm btn-outline-danger banner-delete" data-banner-id="${escHtml(b.id)}"
        aria-label="ลบแบนเนอร์">
        <i class="bi bi-trash3"></i>
      </button>
    </li>
  `).join('');

  // SortableJS — re-create on each render so the new <li>s are picked up.
  if (_bannerSortable) { try { _bannerSortable.destroy(); } catch { /* noop */ } _bannerSortable = null; }
  if (window.Sortable) {
    _bannerSortable = window.Sortable.create(list, {
      handle: '.banner-handle',
      animation: 150,
      onEnd: async () => {
        // The <li> rows only — its caption/link/toggle/delete controls carry the
        // same attribute, and matching them sent five PATCHes per banner.
        const ids = Array.from(list.querySelectorAll(':scope > li[data-banner-id]'))
          .map((li) => li.dataset.bannerId)
          .filter(Boolean);
        try {
          await reorderShopBanners(ids);
          await refreshBanners();
          showShopToast('จัดเรียงแบนเนอร์แล้ว', 'success');
        } catch (e) {
          showShopToast(`จัดเรียงล้มเหลว: ${e.message || e}`, 'error');
        }
      },
    });
  }
}

export function wireBanners() {
  document.getElementById('shopAdminBannerAdd')?.addEventListener('click', () => {
    document.getElementById('shopAdminBannerFile')?.click();
  });
  document.getElementById('shopAdminBannerFile')?.addEventListener('change', onBannerFilePicked);
  // Placement toggle: switch which banner set (launch / announcement)
  // is being managed. Re-renders from the already-loaded state.banners.
  document.getElementById('shopAdminBannerPlacement')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-banner-placement]');
    if (!btn) return;
    const next = btn.dataset.bannerPlacement;
    if (next === state.bannerPlacement) return;
    state.bannerPlacement = next;
    renderBannerList();
  });
  const list = document.getElementById('shopAdminBannersList');
  if (!list) return;
  list.addEventListener('click', (e) => {
    const del = e.target.closest('.banner-delete');
    if (del) onBannerDelete(del.dataset.bannerId);
  });
  list.addEventListener('change', (e) => {
    const sw = e.target.closest('.banner-active');
    if (sw) onBannerActiveToggle(sw.dataset.bannerId, sw.checked);
  });
  // Save caption / link on blur to avoid a PATCH-per-keystroke.
  list.addEventListener('blur', (e) => {
    const cap = e.target.closest?.('.banner-caption');
    if (cap) onBannerCaptionChange(cap.dataset.bannerId, cap.value);
    const lnk = e.target.closest?.('.banner-link');
    if (lnk) onBannerLinkChange(lnk.dataset.bannerId, lnk.value);
  }, true);
}

async function onBannerFilePicked(e) {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const addBtn = document.getElementById('shopAdminBannerAdd');
  const originalLabel = addBtn?.innerHTML;
  if (addBtn) {
    addBtn.disabled = true;
    addBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>กำลังอัปโหลด…';
  }
  try {
    const ext = (file.name.match(/\.(\w+)$/)?.[1] || 'jpg').toLowerCase();
    const fileName = `banner_${Date.now()}.${ext}`;
    const imageUrl = await uploadShopFile(file, 'Shop/Banners', { fileName });
    const placement = state.bannerPlacement || 'launch';
    // display_order is per-placement — only count banners in this set.
    const maxOrder = (state.banners || [])
      .filter((b) => (b.placement || 'launch') === placement)
      .reduce((m, b) => Math.max(m, b.display_order || 0), -1);
    await createShopBanner({
      image_url: imageUrl,
      display_order: maxOrder + 1,
      is_active: true,
      placement,
    });
    await refreshBanners();
    showShopToast('เพิ่มแบนเนอร์แล้ว', 'success');
  } catch (err) {
    showShopToast(`อัปโหลดล้มเหลว: ${err.message || err}`, 'error');
  } finally {
    if (addBtn) {
      addBtn.disabled = false;
      addBtn.innerHTML = originalLabel || '<i class="bi bi-plus-lg me-1"></i> เพิ่มแบนเนอร์';
    }
  }
}


async function onBannerDelete(id) {
  if (!await askConfirm({ title: 'ลบแบนเนอร์นี้?', yes: 'ลบ' })) return;
  const image = (state.banners || []).find((x) => x.id === id)?.image_url;
  try {
    await deleteShopBanner(id);
    state.banners = (state.banners || []).filter((x) => x.id !== id);
    trashImageIfUnused(image);
    await refreshBanners();
    showShopToast('ลบแล้ว', 'success');
  } catch (e) {
    showShopToast(`ลบล้มเหลว: ${e.message || e}`, 'error');
  }
}

async function onBannerActiveToggle(id, active) {
  try {
    await updateShopBanner(id, { is_active: active });
    const b = (state.banners || []).find((x) => x.id === id);
    if (b) b.is_active = active;
    // Re-render to update the "แสดง"/"ซ่อน" label
    renderBannerList();
  } catch (e) {
    showShopToast(`อัปเดตล้มเหลว: ${e.message || e}`, 'error');
    refreshBanners();
  }
}

async function onBannerCaptionChange(id, caption) {
  const b = (state.banners || []).find((x) => x.id === id);
  if (!b || (b.caption || '') === caption) return;
  try {
    await updateShopBanner(id, { caption: caption || null });
    b.caption = caption;
  } catch (e) { showShopToast(`บันทึกแคปชั่นล้มเหลว: ${e.message || e}`, 'error'); }
}

async function onBannerLinkChange(id, link) {
  const b = (state.banners || []).find((x) => x.id === id);
  if (!b || (b.link_url || '') === link) return;
  if (link && !bannerLinkTarget(link)) {
    showShopToast('ลิงก์ต้องขึ้นต้นด้วย https:// หรือ / (หน้าในเว็บนี้)', 'warn');
    return;
  }
  try {
    await updateShopBanner(id, { link_url: link || null });
    b.link_url = link;
  } catch (e) { showShopToast(`บันทึกลิงก์ล้มเหลว: ${e.message || e}`, 'error'); }
}

