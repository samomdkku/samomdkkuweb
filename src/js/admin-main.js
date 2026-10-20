// ==============================================
// ADMIN-MAIN.JS — entry point for the operator app at /admin/
// Mirrors src/js/main.js but only imports admin-only modules.
// Same Supabase auth, same dbRest helpers, same modals.
// Shares the auth session with the public app (supabase-js
// persists in localStorage on the same origin).
// ==============================================

import { ADMIN_FEATURES } from './team-vocab.js';
import { mountEnvRibbon } from './env-ribbon.js';
import { enterHouseWorkspace } from './house/index.js';
import { enterClaudeWorkspace } from './claude/index.js';
import { initDeptPageAdmin } from './dept-page-admin.js';
// ปีการศึกษา — every ชั้นปี in the admin app is computed against it (0141/0145).
import { primeAcademicYear } from './house/api.js';
import { startBuildCheck } from './build-check.js';
startBuildCheck();   // run before anything else — see build-check.js header

import { initModalStack } from './modal-stack.js';
import { initTheme } from './theme.js';
initModalStack();  // stacked modals (crop over member editor, picker over member editor)
initTheme();       // light / dark / device — the head script already applied it; this wires the switch
import { QUILL_TOOLBAR } from './config.js';
import { uploadImageToDrive } from './uploads.js';

// Auth (shared with public)
import { initAuth, onAuthChange, signOut as samoSignOut, getUser as authGetUser, userCanAccess, authReady, hasPersistedSession } from './auth.js';
import { mountAccountSwitch, openSwitcher as openAccountSwitcher } from './account-switch.js';
import { mountSigninModal } from './signin-modal.js';
import { initProfileModal, openProfileModal } from './profile.js';
import { copyText } from './utils.js';
import { askConfirm } from './confirm-modal.js';

// Announcements / Creator
import { initAnnouncements, loadAnnouncements, publishAnnouncement, cancelEdit, setCreatorMode, editAnnouncement, deleteEditingAnnouncement, renderAnnouncementOrderList, saveAnnouncementOrder, togglePinAnnouncement, toggleArchiveAnnouncement, archiveAnnouncements, setManageStatusFilter, getManageStatusFilter, getLoadedAnnouncements } from './announcements.js';

// PR Staff
import { fetchPRStaffTickets, filterPRStaffTickets, enterPRStaffDashboard, openPRStaffModal, submitPRStaffAction, deletePRStaffAction, openManageAgentsModal, addNewAgent, removeAgent, addPRStaffAssignee, removePRStaffAssignee, onPrStaffYearChange, togglePrPastYearOverride, exportPRStaffTicketsCsv } from './pr-staff.js';

// VS Staff
import { fetchStaffTickets, enterVSStaffDashboard, openStaffModalByIndex, pickRequestedVsDept, submitStaffAction, deleteCurrentVSTicket, setVsKanbanHideEmpty, toggleKanbanDups, onVsStaffSearch, onVsStaffYearChange, openVsCategoryManager, vsCatAdd, openVsTagManager, vsTagAdd, vsToggleStaffTag } from './vs-staff.js';

// Shop admin
import { initShop, openShopAdmin, openShopAdminOrder } from './shop/index.js';

// Projects
import { initProjects, enterProjectsWorkspace } from './projects/index.js';

// SAMO Team (org tree)
import { initTeam, enterTeamWorkspace, showTeamMode } from './team/index.js';
import { fetchCurrentSamoYear, SAMO_YEAR_CHANGED } from './samo-year.js';
// The ONE ตำแหน่งของฉัน card — same component the public /me page renders.
import { loadMySeat, renderMySeat } from './my-seat.js';
import { initAnalytics, trackTab } from './analytics.js';
import { initAnalyticsDashboard, enterAnalytics } from './analytics-dashboard.js';

// The boot watchdog in index.html is a CLASSIC script, so it runs even when
// this module does not. Clearing its flag here is what tells it the app is
// alive; if it is never cleared, the reader gets a "โหลดใหม่" bar instead of
// a page whose menus open and whose buttons all silently do nothing.
// Set after the imports, so a module that fails to LOAD ITS DEPENDENCIES is
// still reported as not booted.
try { window.__samoBooted = true; } catch { /* nothing to tell */ }

// ==============================================
// QUILL — creator only (no VS form in admin)
// ==============================================

const Size = Quill.import('attributors/style/size');
Size.whitelist = ['10px', '12px', '13px', '14px', '15px', '16px', '18px', '20px', '24px', '32px'];
Quill.register(Size, true);

function makeQuillImageHandler(quillRef) {
  return function imageHandler() {
    const quill = quillRef();
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.click();
    input.onchange = async () => {
      const file = input.files && input.files[0];
      if (!file) return;
      const range = quill.getSelection(true);
      quill.insertText(range.index, 'กำลังอัปโหลดรูป…', { italic: true, color: '#94a3b8' });
      const placeholderLength = 'กำลังอัปโหลดรูป…'.length;
      try {
        const url = await uploadImageToDrive(file);
        quill.deleteText(range.index, placeholderLength);
        quill.insertEmbed(range.index, 'image', url, 'user');
        quill.setSelection(range.index + 1);
      } catch (err) {
        quill.deleteText(range.index, placeholderLength);
        alert('อัปโหลดรูปไม่สำเร็จ: ' + (err.message || err));
      }
    };
  };
}

let creatorQuillRef = null;
const creatorQuill = new Quill('#creatorQuillEditor', {
  theme: 'snow',
  placeholder: 'เขียนรายละเอียดประกาศของคุณที่นี่...',
  modules: {
    toolbar: {
      container: QUILL_TOOLBAR,
      handlers: { image: makeQuillImageHandler(() => creatorQuillRef) },
    },
  },
});
creatorQuillRef = creatorQuill;

initAnnouncements(creatorQuill);

// ==============================================
// CREATOR HELPERS — needed by tab-creator.html onclick handlers
// ==============================================

// --------------------------------------------------
// Cover-image cropper (3:4, Cropper.js)
//
// Pick a file → open the modal with Cropper.js, lock the crop box to
// 3:4 → user pans/zooms → "ใช้รูปนี้" → canvas.toBlob → upload.
// "ยกเลิก" leaves the existing cover untouched.
// --------------------------------------------------

let _activeCropper = null;
let _pendingCropFileName = 'cover.jpg';

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = () => reject(new Error('อ่านไฟล์ไม่สำเร็จ'));
    reader.readAsDataURL(file);
  });
}

function dataUrlToDimensions(dataUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

function destroyActiveCropper() {
  if (_activeCropper) {
    try { _activeCropper.destroy(); } catch { /* noop */ }
    _activeCropper = null;
  }
}

window.onCreatorThumbPicked = async (event) => {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  _pendingCropFileName = file.name || 'cover.jpg';

  const hint = document.getElementById('creatorThumbHint');
  const cropImg = document.getElementById('creatorCropperImage');
  const cropHint = document.getElementById('creatorCropperHint');
  const modalEl = document.getElementById('creatorCropperModal');

  if (hint) hint.innerHTML = '';

  let dataUrl;
  try {
    dataUrl = await fileToDataUrl(file);
  } catch (err) {
    alert((err && err.message) || 'อ่านไฟล์ไม่สำเร็จ');
    event.target.value = '';
    return;
  }

  const dims = await dataUrlToDimensions(dataUrl);
  if (cropHint && dims) {
    let warning = '';
    if (dims.width < 1536) {
      warning = ` <span class="text-warning"><i class="bi bi-info-circle"></i> รูปต้นฉบับกว้าง ${dims.width}px (แนะนำ ≥1536px) — ลองภาพใหญ่กว่านี้เพื่อความคมชัด</span>`;
    }
    cropHint.innerHTML = `ลากเพื่อจัดวางส่วนสำคัญของภาพ — กรอบล็อกที่สัดส่วน 3:4 อัตโนมัติ.${warning}`;
  }

  destroyActiveCropper();
  if (cropImg) cropImg.src = dataUrl;

  // Open the modal; init Cropper.js after `shown.bs.modal` so the
  // image element is laid out with real dimensions.
  if (!modalEl || !window.bootstrap) {
    alert('ไม่สามารถเปิดหน้าตัดรูปได้');
    event.target.value = '';
    return;
  }
  const modal = window.bootstrap.Modal.getOrCreateInstance(modalEl);
  modalEl.addEventListener('shown.bs.modal', () => {
    if (!window.Cropper || !cropImg) return;
    _activeCropper = new window.Cropper(cropImg, {
      aspectRatio: 3 / 4,
      viewMode: 1,        // restrict crop box to within the canvas
      autoCropArea: 1,    // start with the largest 3:4 fit
      background: false,
      movable: true,
      zoomable: true,
      scalable: false,
      rotatable: false,
      responsive: true,
      checkOrientation: false,
    });
  }, { once: true });
  modalEl.addEventListener('hidden.bs.modal', () => {
    destroyActiveCropper();
    if (cropImg) cropImg.src = '';
  }, { once: true });
  modal.show();
  // Reset the file input so re-selecting the same file still fires change.
  event.target.value = '';
};

// Confirm button inside the cropper modal — extract the cropped canvas,
// turn it into a JPEG blob, upload, then write the resulting URL into
// the creator form.
async function confirmCropAndUpload() {
  if (!_activeCropper) return;
  const preview = document.getElementById('creatorThumbPreview');
  const clearBtn = document.getElementById('creatorThumbClearBtn');
  const urlInput = document.getElementById('creatorThumbUrl');
  const confirmBtn = document.getElementById('creatorCropperConfirm');
  const modalEl = document.getElementById('creatorCropperModal');

  // Output a max-1536×2048 canvas (3:4, ≈3MP) — good print/retina quality
  // but keeps the upload size reasonable.
  const canvas = _activeCropper.getCroppedCanvas({
    maxWidth: 1536,
    maxHeight: 2048,
    imageSmoothingEnabled: true,
    imageSmoothingQuality: 'high',
  });
  if (!canvas) {
    alert('ตัดภาพไม่สำเร็จ ลองอีกครั้ง');
    return;
  }

  if (confirmBtn) {
    confirmBtn.disabled = true;
    confirmBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>กำลังอัปโหลด…';
  }
  if (preview) preview.innerHTML = '<div class="text-center"><div class="spinner-border spinner-border-sm text-secondary"></div><div class="small text-muted mt-2">กำลังอัปโหลด…</div></div>';

  try {
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('แปลงภาพไม่สำเร็จ'))), 'image/jpeg', 0.9);
    });
    const fileForUpload = new File([blob], _pendingCropFileName.replace(/\.(png|webp|gif|bmp)$/i, '.jpg') || 'cover.jpg', { type: 'image/jpeg' });
    const url = await uploadImageToDrive(fileForUpload);
    if (urlInput) urlInput.value = url;
    if (preview) preview.innerHTML = `<img src="${url}" alt="thumbnail">`;
    if (clearBtn) clearBtn.classList.remove('d-none');
    // Hint slot below the preview: confirm it's the cropped 3:4.
    const hint = document.getElementById('creatorThumbHint');
    if (hint) hint.innerHTML = `<i class="bi bi-check-circle me-1 text-success"></i>ตัดกรอบ 3:4 เรียบร้อย (${canvas.width}×${canvas.height})`;

    if (modalEl && window.bootstrap) {
      window.bootstrap.Modal.getOrCreateInstance(modalEl).hide();
    }
  } catch (err) {
    if (preview) preview.innerHTML = '<i class="bi bi-exclamation-triangle text-danger fs-3"></i><span class="text-danger small mt-2">อัปโหลดล้มเหลว</span>';
    alert('อัปโหลดรูปปกไม่สำเร็จ: ' + (err.message || err));
  } finally {
    if (confirmBtn) {
      confirmBtn.disabled = false;
      confirmBtn.innerHTML = '<i class="bi bi-check-lg me-1"></i>ใช้รูปนี้';
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('creatorCropperConfirm')
    ?.addEventListener('click', confirmCropAndUpload);
});

window.clearCreatorThumb = () => {
  const preview = document.getElementById('creatorThumbPreview');
  const urlInput = document.getElementById('creatorThumbUrl');
  const clearBtn = document.getElementById('creatorThumbClearBtn');
  if (preview) preview.innerHTML = '<i class="bi bi-image fs-1"></i><span class="text-muted small mt-2">ยังไม่ได้เลือกรูปปก</span>';
  if (urlInput) urlInput.value = '';
  if (clearBtn) clearBtn.classList.add('d-none');
};

// Window-exposed handlers used by inline onclick=""
window.samoSignOut = samoSignOut;
window.samoOpenProfile = openProfileModal;
// Multi-account chooser (Gmail-style). Particularly handy for staff
// who jump between dev / vp_admin / uni_staff seats during testing.
window.samoSwitchAccount = () => openAccountSwitcher();

// Announcements (creator side)
window.loadAnnouncements = loadAnnouncements;
window.publishAnnouncement = publishAnnouncement;
window.cancelEdit = cancelEdit;
window.setCreatorMode = setCreatorMode;
// Stub: viewAnnouncement is public-only; from admin we navigate to the
// public reader. (Could also surface a preview-modal here later.)
window.viewAnnouncement = (id) => {
  if (id) location.href = '/#article/' + encodeURIComponent(id);
  else location.href = '/';
};
// Edit from inside the admin creator: looks up the post by the viewer's
// current id and fills the form. Public site's "edit" button on the
// article reader navigates here as /admin/#creator/{id};
// tryCreatorDeepLink picks that up on entry.
window.editCurrentAnnouncement = () => editAnnouncement();
// Delete the article currently loaded into the editor form. Wired to
// the in-form "ลบประกาศนี้" button (visible only when editing).
window.deleteEditingAnnouncement = deleteEditingAnnouncement;
// Public-reader's delete button isn't reachable inside admin (no
// article reader here), but keep a no-op so any stray HTML reference
// doesn't ReferenceError.
window.deleteCurrentAnnouncement = () => {};

// PR Staff
window.fetchPRStaffTickets = fetchPRStaffTickets;
window.filterPRStaffTickets = filterPRStaffTickets;
window.openPRStaffModal = openPRStaffModal;
window.submitPRStaffAction = submitPRStaffAction;
window.deletePRStaffAction = deletePRStaffAction;
window.openManageAgentsModal = openManageAgentsModal;
window.addNewAgent = addNewAgent;
window.removeAgent = removeAgent;
window.addPRStaffAssignee = addPRStaffAssignee;
window.removePRStaffAssignee = removePRStaffAssignee;
window.onPrStaffYearChange = onPrStaffYearChange;
window.togglePrPastYearOverride = togglePrPastYearOverride;
window.exportPRStaffTicketsCsv = exportPRStaffTicketsCsv;

// VS Staff
window.fetchStaffTickets = fetchStaffTickets;
window.openStaffModalByIndex = openStaffModalByIndex;
window.submitStaffAction = submitStaffAction;
window.deleteCurrentVSTicket = deleteCurrentVSTicket;
window.setVsKanbanHideEmpty = setVsKanbanHideEmpty;
window.toggleKanbanDups = toggleKanbanDups;
window.pickRequestedVsDept = pickRequestedVsDept;
window.onVsStaffSearch = onVsStaffSearch;
window.onVsStaffYearChange = onVsStaffYearChange;
window.openVsCategoryManager = openVsCategoryManager;
window.vsCatAdd = vsCatAdd;
window.openVsTagManager = openVsTagManager;
window.vsTagAdd = vsTagAdd;
window.vsToggleStaffTag = vsToggleStaffTag;
window.onVSAdminRoleChange = async () => { await enterVSStaffDashboard(); };
// (per-VP summary chips removed; the dropdown filter is the single
// source of truth now and drives both list + kanban views.)

// ==============================================
// SIDEBAR SECTION SWITCHING
// ==============================================

// data-admin-side="landing|pr|vs|shop|projects|creator"
// Section panes carry data-admin-pane="landing|admin|projects|creator".
// pr/vs/shop all use the "admin" pane and additionally call
// openAdminSection(which) to drive the legacy adminXSection toggles.

const SECTION_META = {
  landing:  { pane: 'landing',  title: 'ภาพรวม Admin',     sub: 'เลือกระบบที่ต้องการจัดการจากเมนูซ้าย' },
  pr:       { pane: 'admin',    title: 'PR Management',    sub: 'จัดการคำขอประชาสัมพันธ์' },
  vs:       { pane: 'admin',    title: 'VitalSound',       sub: 'ติดตามและตอบกลับการแจ้งปัญหา' },
  shop:     { pane: 'admin',    title: 'SAMO Shop',        sub: 'คำสั่งซื้อ ตรวจสลิป สินค้า' },
  projects: { pane: 'projects', title: 'หนังสือโครงการ',   sub: 'ส่ง / รับ / ติดตามหนังสือโครงการ' },
  creator:  { pane: 'creator',  title: 'เขียนประกาศ',       sub: 'สร้างและเผยแพร่ประกาศลงบอร์ดสาธารณะ' },
  order:    { pane: 'order',    title: 'ลำดับการแสดงประกาศ', sub: 'จัดเรียงลำดับ ปักหมุดโพสต์เด่น และแก้ไขประกาศ' },
  years:    { pane: 'years',     title: 'ปี SAMO',           sub: 'ปีที่ทุกระบบนับงานใหม่ การส่งต่อให้ทีมใหม่ และปีการศึกษา' },
  team:     { pane: 'team',     title: 'ทีม SAMO',          sub: 'จัดการโครงสร้างตำแหน่งและสมาชิกในองค์กร' },
  house:    { pane: 'house',    title: 'ระบบบ้าน',           sub: 'บ้าน สายรหัส อาจารย์ที่ปรึกษา และข้อมูลนักศึกษา' },
  analytics:{ pane: 'analytics',title: 'สถิติการใช้งาน',    sub: 'ภาพรวมผู้ใช้งาน การเติบโต และกิจกรรมบนพอร์ทัล' },
  claude:   { pane: 'claude',   title: 'จองโควตา Claude',   sub: 'จองช่วงเวลาใช้งาน Claude ของสโม' },
  discordbot: { pane: 'discordbot', title: 'บอท Discord',     sub: 'สถานะ และเปิด/ปิดบอทที่จัด role และชื่อใน Discord ตามทีม SAMO' },
  accounts: { pane: 'accounts', title: 'บัญชีผู้ใช้',         sub: 'ทุกบัญชีในฐานข้อมูล วิธีเข้าสู่ระบบ อีเมล ระบบที่อยู่ และจุดผิดปกติ — อัปเดตสด' },
  deptpage: { pane: 'deptpage', title: 'หน้าฝ่าย',           sub: 'แก้เนื้อหาหน้าฝ่ายของคุณเอง เผยแพร่ทันทีโดยไม่ต้องรอไอที' },
};

/** Hard-reload after an account switch, dropping the hash on the way out.
 *  The hash is a deep link into a section (`#projects/PRJ-XXXX`) that the NEW
 *  account may not be allowed to open, so we land on the admin root and let the
 *  normal gate decide. location.replace keeps the switch out of the back
 *  history — going "back" into a page rendered for the previous account is
 *  exactly the confusion this is fixing. */
function swapAccountReload() {
  try {
    window.location.replace(window.location.pathname + window.location.search);
  } catch {
    window.location.reload();
  }
}

/**
 * ข้อมูลของฉัน on the admin landing.
 *
 * MOVED HERE from a sixth mode inside the ทีม SAMO tab. Two things were wrong
 * with that home: the card is not org-tree management, and it was reachable
 * only by an account that both HELD the `team` grant and thought to look under
 * it — so an admin whose grants are `pr` and `samoshop` could not see or fix
 * their own row at all from /admin/.
 *
 * Deliberately thin, exactly as the ทีม SAMO version was: the markup, the
 * findings, the self-edit round trip and the photo upload all live in
 * ../my-seat.js and are the same code the public /me page runs. A second
 * implementation is what this repo means by "two implementations of one rule
 * drift"; the only thing this function decides is where it goes.
 *
 * An account with no posting in the tree gets NO block — not an empty card and
 * not an explanation. That is the common case for a shared department account,
 * and a permanent "you have no ตำแหน่ง" notice on the first screen of the admin
 * app is noise for the people it is true of.
 */
async function paintAdminMySeat() {
  const block = document.getElementById('adminMeBlock');
  const host = document.getElementById('adminMySeat');
  if (!block || !host) return;
  const uid = authGetUser()?.id || null;
  const seat = uid ? await loadMySeat(uid) : null;
  block.classList.toggle('d-none', !seat);
  renderMySeat(host, seat, { compact: true });
}

/**
 * The current ปี SAMO in the top bar, on every admin page.
 *
 * The value every system stamps new work with used to be visible only inside
 * ทีม SAMO → ปีการศึกษา; an admin filing a PR or reading the shop's ยอดขาย had
 * no way to see which year it was going under. A button into /admin/#years for
 * an account that may open that page, a plain label (disabled) for the rest.
 * Re-painted on SAMO_YEAR_CHANGED, so a switch on the ปี page shows here at
 * once.
 */
let yearChipWired = false;
async function paintYearChip(user) {
  const chip = document.getElementById('adminYearChip');
  const val = document.getElementById('adminYearChipValue');
  if (!chip || !val) return;
  const canOpen = sideAllowed(SIDE_FEATURE.years, user);
  chip.disabled = !canOpen;
  chip.classList.toggle('is-link', canOpen);
  if (!yearChipWired) {
    yearChipWired = true;
    chip.addEventListener('click', () => showAdminSide('years'));
    window.addEventListener(SAMO_YEAR_CHANGED, () => paintYearChip(authGetUser()));
  }
  const y = await fetchCurrentSamoYear();
  val.textContent = y == null ? '' : String(y);
  chip.setAttribute('aria-label', y == null ? 'ปี SAMO' : `ปี SAMO ปัจจุบัน ${y}${canOpen ? ' — เปิดหน้าปี SAMO' : ''}`);
  chip.classList.toggle('d-none', y == null);
}

/**
 * May the signed-in account open this section?
 *
 * The sidebar hides what you cannot use, and the click delegate skips a hidden
 * button — but the HASH was never checked. `/admin/#vs` typed (or bookmarked, or
 * followed from an old link) by an admin whose only grant is `team` ran
 * `enterVSStaffDashboard()` and painted the VitalSound workspace with no sidebar
 * entry to leave by. RLS keeps the ROWS empty, so this was never a data leak —
 * it is a pane that lies about what the account can do, which is the same shape
 * as "a live-looking ลบ button that 42501s" in the mistakes log.
 *
 * Defined so an UNKNOWN section is allowed: `showAdminSide` already falls back
 * to the landing pane for those, and failing closed here would be a second,
 * silent place to maintain the section list.
 */
function canOpenSection(which) {
  return sideAllowed(SIDE_FEATURE[which], authGetUser());
}

/** A SIDE_FEATURE value: null = always, a key, or a LIST of keys any one of
 *  which opens it (ปี SAMO: team_edit OR house). One reader, used by both the
 *  route gate above and the sidebar/landing visibility loop, so a list cannot
 *  be honoured by one and read as a single key by the other. */
function sideAllowed(feature, user) {
  if (feature == null) return true;
  if (Array.isArray(feature)) return feature.some((f) => userCanAccess(f, user));
  return userCanAccess(feature, user);
}

function showAdminSide(which) {
  if (!canOpenSection(which)) which = 'landing';
  const meta = SECTION_META[which] || SECTION_META.landing;

  // Drop any editor popup state — a section switch always lands on a real
  // pane, never the floating editor overlay.
  document.getElementById('creatorPane')?.classList.remove('editor-overlay');
  document.body.classList.remove('editor-overlay-open');

  // Mark sidebar item active
  document.querySelectorAll('#adminSideNav [data-admin-side]').forEach((btn) => {
    btn.classList.toggle('is-active', btn.dataset.adminSide === which);
  });

  // Show only the target pane
  document.querySelectorAll('[data-admin-pane]').forEach((p) => {
    p.classList.toggle('d-none', p.dataset.adminPane !== meta.pane);
  });

  // Top-bar title + subtitle
  const t = document.getElementById('adminTopTitle');
  const s = document.getElementById('adminTopSub');
  if (t) t.textContent = meta.title;
  if (s) s.textContent = meta.sub;

  // Trigger the legacy admin sub-section toggle for PR/VS/Shop
  if (which === 'pr' || which === 'vs' || which === 'shop') {
    document.getElementById('adminPRSection')?.classList.toggle('d-none', which !== 'pr');
    document.getElementById('adminVSSection')?.classList.toggle('d-none', which !== 'vs');
    document.getElementById('adminShopSection')?.classList.toggle('d-none', which !== 'shop');
    if (which === 'pr')   enterPRStaffDashboard();
    else if (which === 'vs')  enterVSStaffDashboard();
    else if (which === 'shop') openShopAdmin();
  }

  // Projects' lazy first-load was wired to Bootstrap's shown.bs.tab in
  // the public app. Admin uses the sidebar directly, so we have to
  // trigger the load explicitly here — otherwise the inbox is blank
  // until the user creates a project (which calls reloadProjects).
  if (which === 'projects') {
    enterProjectsWorkspace();
  }

  // Creator: lazy-load the announcement list + attach SortableJS so the
  // reorder panel works. Idempotent — re-entry rerenders + reattaches.
  if (which === 'creator') {
    enterCreator();
  }

  // Announcement order/pin list — its own section.
  if (which === 'order') {
    enterAnnouncementOrder();
  }

  // ปี SAMO: dynamic import — nothing of it in the entry bundle. The user is
  // passed because the page renders read-only halves from the same gates.
  if (which === 'years') {
    import('./samo-year-admin.js').then((m) => m.enterSamoYear(authGetUser()))
      .catch((e) => console.warn('[admin] ปี SAMO page failed to load:', e?.message || e));
  }

  // SAMO Team: lazy-load the org tree on first entry; idempotent thereafter.
  if (which === 'team') {
    enterTeamWorkspace();
  }

  // ระบบบ้าน: same lazy-on-entry shape as ทีม SAMO.
  if (which === 'house') {
    enterHouseWorkspace();
  }

  // Usage analytics: lazy-load the dashboard payload on entry.
  if (which === 'analytics') {
    enterAnalytics();
  }

  // จองโควตา Claude (0154): same lazy-on-entry shape as ทีม SAMO / ระบบบ้าน.
  if (which === 'claude') {
    enterClaudeWorkspace();
  }

  // บอท Discord (0208): a dynamic import — nothing of it in the entry bundle.
  if (which === 'discordbot') {
    import('./discord-bot-admin.js').then((m) => m.enterDiscordBot())
      .catch((e) => console.warn('[admin] discord bot panel failed to load:', e?.message || e));
  }

  // บัญชีผู้ใช้ (0211): dynamic import, same as the bot panel.
  if (which === 'accounts') {
    import('./accounts/admin.js').then((m) => m.enterAccounts())
      .catch((e) => console.warn('[admin] accounts dashboard failed to load:', e?.message || e));
  }

  // หน้าฝ่าย (0177): same lazy-on-entry shape. Mounted with the CURRENT user
  // because the ฝ่าย picker is built from their grant — reading it once at boot
  // would show the previous account's ฝ่าย after a switch.
  if (which === 'deptpage') {
    initDeptPageAdmin(authGetUser());
  }

  // ข้อมูลของฉัน, on the landing.
  if (which === 'landing') {
    paintAdminMySeat();
  }

  // Record the section switch for the "top tabs" usage breakdown.
  trackTab(`admin:${which}`);

  // Mirror in the URL hash so admin sub-pages are bookmarkable. Only
  // rewrite if the existing hash doesn't already point at this section
  // (so deep links like `#projects/PRJ-XXXX/doc/DOC-Y` survive). For
  // landing, clear the hash entirely.
  if (which === 'landing') {
    if (location.hash !== '') history.replaceState(null, '', location.pathname);
  } else {
    const cur = location.hash.replace(/^#/, '');
    const first = cur.split('/')[0];
    if (first !== which) history.replaceState(null, '', location.pathname + '#' + which);
  }
}

let _orderSortableAttached = false;
let initialSectionApplied = false;
// The account this page instance booted with. Every feature module in the admin
// shell holds module-scope caches (projects cache + seenAt map, shop state,
// VS/PR lists, team tree, analytics) keyed to nothing — they were written for a
// page that serves ONE account for its lifetime. The account switcher swaps the
// session in place, so those caches survive into the next account and the user
// sees a mix of both. Rather than teach every module to reset (and re-learn it
// for every module added later), a switch does a hard reload: one line, and
// impossible to forget. See swapAccountReload() below.
let bootUserId = null;
// Flipped true once auth has settled (session restored OR confirmed absent).
// Until then, a persisted-but-still-loading session keeps the boot spinner
// up instead of flashing the sign-in gate. See the onAuthChange handler.
let authSettled = false;
// Writer pane (เขียนประกาศ). Just ensure announcements are loaded so
// editAnnouncement(id) deep-links / the order section's pencil can resolve
// the post against the in-memory cache.
async function enterCreator() {
  // เขียนประกาศ is the "new post" page — start clean. (Deep-link edits via
  // `#creator/{id}` call editAnnouncement() right after this, re-filling it.)
  cancelEdit();
  try {
    // 'all': an admin opening เขียนประกาศ fresh does not need this, but
    // tryCreatorDeepLink() below reuses enterCreator's load — and a
    // #creator/{id} deep link to an ARCHIVED post must still resolve (0232
    // added the archive toggle; before it nothing could become archived, so
    // this case never existed).
    await loadAnnouncements('all');
  } catch (e) {
    console.warn('[admin-main] creator: loadAnnouncements failed:', e?.message || e);
  }
}

// Order pane (ลำดับการแสดงประกาศ) — its own admin section below เขียนประกาศ.
// Renders the drag-reorder + pin list and attaches SortableJS once.
async function enterAnnouncementOrder() {
  const listEl = document.getElementById('announcementsOrderList');
  if (!listEl) return;
  wireAnnouncementManageFilter();
  try {
    await loadAnnouncements(getManageStatusFilter());
  } catch (e) {
    console.warn('[admin-main] order: loadAnnouncements failed:', e?.message || e);
  }
  renderAnnouncementOrderList(listEl);
  // Attach SortableJS once. Re-renders replace the <li> elements but
  // SortableJS works off the parent <ul> so it picks up new children.
  if (!_orderSortableAttached && window.Sortable) {
    window.Sortable.create(listEl, {
      handle: '.order-card-handle',
      draggable: '.order-card',
      animation: 150,
      ghostClass: 'sortable-ghost',
      chosenClass: 'sortable-chosen',
      onEnd: async () => {
        const ids = Array.from(listEl.querySelectorAll('.order-card'))
          .map((el) => el.dataset.id);
        await saveAnnouncementOrder(ids);
        // saveAnnouncementOrder reloads announcements; re-render the cards.
        renderAnnouncementOrderList(listEl);
      },
    });
    _orderSortableAttached = true;
  }
}

// Open the announcement editor as a popup overlay (used when editing from the
// manage cards). The editor lives in the creator pane; we float it on top of
// whatever section is active instead of switching to it.
function openEditorOverlay() {
  const pane = document.getElementById('creatorPane');
  if (!pane) return;
  pane.classList.remove('d-none');
  pane.classList.add('editor-overlay');
  document.body.classList.add('editor-overlay-open');
  pane.scrollTop = 0;
}

// Close the editor popup + reset the form. Hides the creator pane again unless
// the creator section is itself active (inline edit via `#creator/{id}` deep
// link), in which case it stays as a normal page.
window.closeAnnouncementEditor = () => {
  const pane = document.getElementById('creatorPane');
  if (pane) {
    pane.classList.remove('editor-overlay');
    const activeSection = location.hash.replace(/^#/, '').split('/')[0];
    if (activeSection !== 'creator') pane.classList.add('d-none');
  }
  document.body.classList.remove('editor-overlay-open');
  cancelEdit();
};

// Publish / delete finished — close the popup (if open) and refresh the
// manage cards so order + pin state reflect the change.
document.addEventListener('announcement:changed', () => {
  const pane = document.getElementById('creatorPane');
  if (pane?.classList.contains('editor-overlay')) window.closeAnnouncementEditor();
  const listEl = document.getElementById('announcementsOrderList');
  if (listEl) renderAnnouncementOrderList(listEl);
});

// Exposed for clicking a manage card. Fill the editor form with that post and
// float it as a popup overlay (instead of redirecting to the เขียนประกาศ pane).
window.editAnnouncementById = (id) => {
  editAnnouncement(id);
  openEditorOverlay();
};

// Exposed for the pin chip on each manage card. togglePinAnnouncement reloads
// announcements; re-render the cards so the new pin state shows.
window.togglePinAnnouncement = async (id) => {
  const ok = await togglePinAnnouncement(id);
  if (ok) renderAnnouncementOrderList(document.getElementById('announcementsOrderList'));
};

// Exposed for the เก็บเข้าคลัง/เผยแพร่อีกครั้ง button on each manage card
// (0232). toggleArchiveAnnouncement reloads under the manage pane's OWN
// status filter, so an archived card disappears from "เผยแพร่อยู่" and a
// restored one disappears from "เก็บเข้าคลัง" — same reload shape as pin.
window.toggleArchiveAnnouncement = async (id) => {
  const ok = await toggleArchiveAnnouncement(id);
  if (ok) renderAnnouncementOrderList(document.getElementById('announcementsOrderList'));
};

/**
 * The manage pane's status filter (ทั้งหมด/เผยแพร่อยู่/เก็บเข้าคลัง) +
 * "เก็บประกาศเก่าเข้าคลังทั้งหมด" bulk action (docs/YEAR-ROLLOVER.md §
 * Announcements: "archive-by-year control for admins"). MANUAL, never
 * automatic — the design doc left the choice between scheduled/manual to
 * whichever task built this; automatic archival at a ทีม SAMO handover risks
 * surprising an admin mid-term with posts vanishing from a page they did not
 * touch, so every archive here is a button a person presses.
 */
let announcementFilterWired = false;
function wireAnnouncementManageFilter() {
  const sel = document.getElementById('announcementStatusFilter');
  const bulkBtn = document.getElementById('announcementBulkArchive');
  const bulkYear = document.getElementById('announcementBulkArchiveYear');
  if (sel) sel.value = getManageStatusFilter();
  if (announcementFilterWired) return;
  announcementFilterWired = true;
  sel?.addEventListener('change', async () => {
    setManageStatusFilter(sel.value);
    const listEl = document.getElementById('announcementsOrderList');
    try {
      await loadAnnouncements(sel.value);
    } catch (e) {
      console.warn('[admin-main] announcement filter reload failed:', e?.message || e);
    }
    renderAnnouncementOrderList(listEl);
  });
  bulkBtn?.addEventListener('click', async () => {
    const raw = String(bulkYear?.value || '').trim();
    // Number('') is 0, which IS finite — so an empty box used to report "no
    // announcements before พ.ศ. 0" instead of asking for a year.
    if (!/^\d{4}$/.test(raw)) { alert('พิมพ์ปี พ.ศ. 4 หลักก่อนกดเก็บเข้าคลัง'); return; }
    const year = Number(raw);
    // ค.ศ. boundary from the พ.ศ. year typed: everything CREATED before 1
    // มกราคม of that พ.ศ. year. Simple date arithmetic, no RPC — the design
    // doc's "a scheduled job at start_team_term time" was explicitly left as
    // EITHER scheduled or manual; this is the manual half, scoped by a typed
    // year rather than auto-reading team_terms.started_at, so an admin
    // reviewing old announcements chooses the cutoff instead of it being
    // silently decided by whenever the current team happened to take over.
    const cutoffCe = year - 543;
    const cutoff = new Date(Date.UTC(cutoffCe, 0, 1));
    // Fetch the approved set explicitly — the manage pane's CURRENT filter
    // may be showing เก็บเข้าคลัง/ทั้งหมด at the moment this button is
    // pressed, and only an approved post can be archived.
    const listEl = document.getElementById('announcementsOrderList');
    // EVERY exit reloads under the manage pane's own filter and repaints —
    // returning with the 'approved' set loaded while archived cards are on
    // screen left a click on one of them finding nothing.
    try {
      await loadAnnouncements('approved');
      const targets = getLoadedAnnouncements().filter((p) =>
        p.status === 'approved' && p.createdAtIso && new Date(p.createdAtIso) < cutoff);
      if (!targets.length) { alert(`ไม่มีประกาศที่เผยแพร่อยู่ซึ่งสร้างก่อนปี พ.ศ. ${year}`); return; }
      const ok = await askConfirm({
        title: `เก็บประกาศ ${targets.length} รายการที่สร้างก่อนปี พ.ศ. ${year} เข้าคลัง?`,
        body: 'ประกาศที่เก็บเข้าคลังจะหายจากหน้าแรกทันที — เผยแพร่อีกครั้งได้ทีละรายการ',
        yes: 'เก็บเข้าคลัง',
      });
      if (!ok) return;
      // ONE write: toggling one by one reloaded under the manage filter after
      // each, so under เก็บเข้าคลัง the rest dropped out and silently stayed.
      const n = await archiveAnnouncements(targets.map((p) => p.id));
      if (n !== targets.length) {
        alert(`เก็บเข้าคลังได้ ${n} จาก ${targets.length} รายการ — บัญชีนี้อาจไม่มีสิทธิ์ “เขียนประกาศ” กับบางรายการ`);
      }
    } catch (e) {
      alert('เก็บเข้าคลังไม่สำเร็จ: ' + (e?.message || e));
    } finally {
      try {
        await loadAnnouncements(getManageStatusFilter());
      } catch (e) {
        console.warn('[admin-main] bulk archive reload failed:', e?.message || e);
      }
      renderAnnouncementOrderList(listEl);
    }
  });
}

/** Handle `#creator/{id}` deep-link: navigate to the creator pane and
 *  pre-populate the form with that article. Returns true if it routed,
 *  false to let the caller fall back to the section-only behavior. */
async function tryCreatorDeepLink(hash) {
  const m = /^creator\/([^/]+)$/.exec(hash);
  if (!m) return false;
  // Same gate the hash router applies (canOpenSection): report "not routed" so
  // the caller lands on the section fallback rather than opening the editor for
  // an account that may not publish.
  if (!canOpenSection('creator')) return false;
  const id = decodeURIComponent(m[1]);
  showAdminSide('creator');
  try {
    await loadAnnouncements('all'); // an archived post must still resolve (0232)
    const ok = editAnnouncement(id);
    if (!ok) {
      console.warn('[admin-main] /creator/' + id + ' — article not found in loaded list');
    }
  } catch (e) {
    console.warn('[admin-main] creator deep-link load failed:', e?.message || e);
  }
  return true;
}

// Public function — sidebar buttons and legacy onclicks call these.
window.openAdminSection = (which) => showAdminSide(which);
// ทีม SAMO at a given mode ('team' | 'years' …) — the ปี SAMO page links into
// จัดการทีม and ทีมแต่ละปี. Through showAdminSide, so the route gate applies.
window.openTeamMode = (m) => {
  showAdminSide('team');
  if (document.querySelector('#adminSideNav [data-admin-side="team"].is-active')) showTeamMode(m);
};
window.showAdminLanding = () => showAdminSide('landing');

// ==============================================
// AUTH GATE + BOOT
// ==============================================

const BOOT_GATE   = () => document.getElementById('adminBootGate');
const AUTH_GATE   = () => document.getElementById('adminAuthGate');
const APP_ROOT    = () => document.getElementById('adminAppRoot');

function showBoot()    { BOOT_GATE()?.classList.remove('d-none'); AUTH_GATE()?.classList.add('d-none'); APP_ROOT()?.classList.add('d-none'); }
function showAuthGate(){ BOOT_GATE()?.classList.add('d-none');   AUTH_GATE()?.classList.remove('d-none'); APP_ROOT()?.classList.add('d-none'); }
function showApp()     { BOOT_GATE()?.classList.add('d-none');   AUTH_GATE()?.classList.add('d-none');   APP_ROOT()?.classList.remove('d-none'); }

const STAFF_ROLES = ['pr_staff', 'vs_staff', 'shop_admin', 'vp_admin', 'uni_staff', 'sa_prof', 'dev'];

// Admin-app feature keys. Holding ANY of these — via a staff role default,
// manual permissions[], or the SAMO Team tree managed_permissions[] (0081) —
// is enough to enter the admin app. Without this, a plain role:'user' account
// that the org tree grants e.g. 'pr' gets bounced to the sign-in gate.
function canUseAdmin(user) {
  if (!user) return false;
  if (STAFF_ROLES.includes(user.role)) return true;
  return ADMIN_FEATURES.some((f) => userCanAccess(f, user));
}

// Features the admin sidebar / landing surfaces. Keyed by data-admin-side.
// Each value is the permission key passed to userCanAccess().
const SIDE_FEATURE = {
  landing:  null,         // landing is always available when signed in as staff
  pr:       'pr',
  vs:       'vs',
  shop:     'samoshop',
  projects: 'projects',
  creator:  'creator',
  order:    'creator',   // same gate as เขียนประกาศ — announcement management
  // ปี SAMO — either half opens the page: team_edit is start_team_term's own
  // gate (0224), house is set_academic_year's (0141). Each half renders
  // read-only for an account holding only the other (samo-year-admin.js).
  years:    ['team_edit', 'house'],
  team:     'team',
  house:    'house',
  claude:   'claude',    // จองโควตา Claude (0154)
  discordbot: 'discord_bot', // บอท Discord (0208)
  // บัญชีผู้ใช้ (0211). `master` itself, not a feature key: the page maps every
  // account's email to what it holds, which only master may see (the RPC asks
  // current_user_has_permission('master'), the same test holdsMaster() makes).
  accounts: 'master',
  // หน้าฝ่าย (0177). `userCanAccess` answers true for the BLANKET permission
  // and, separately, for a per-ฝ่าย scope — a scoped editor holds no
  // permission key at all, so gating on the key alone would hide their own
  // page from them while the database happily let them write it.
  deptpage: 'dept_pages',
  analytics: null,       // usage stats — any admin-dashboard user (0102 widened
                         // analytics_overview to current_user_has_any_grant() to match)
};

function roleLabel(role) {
  if (role === 'pr_staff')   return 'PR Staff';
  if (role === 'vs_staff')   return 'VS Staff';
  if (role === 'shop_admin') return 'Shop Admin';
  if (role === 'vp_admin')   return 'VP-Admin';
  if (role === 'uni_staff')  return 'Uni Staff';
  if (role === 'sa_prof')    return 'อาจารย์';
  if (role === 'dev')        return 'Dev';
  return '';
}

// Sidebar toggle — one button, two modes:
//   ≥768px: collapse the sidebar to icon-only and persist in localStorage
//   <768px: open/close the sidebar drawer (full overlay with backdrop)
// Defined at module scope so initBeforeDom (below) can call it after the
// DOM resolves but before auth resolves.
const SIDEBAR_COLLAPSED_KEY = 'samoAdminSidebarCollapsed';
const isMobileViewport = () => window.matchMedia('(max-width: 767.98px)').matches;

function initSidebarToggle() {
  const toggle    = document.getElementById('adminSidebarToggle');
  const backdrop  = document.getElementById('adminSidebarBackdrop');
  const sideNav   = document.getElementById('adminSideNav');

  // Restore desktop-collapsed state (mobile drawer always starts closed).
  // With NO saved choice, an iPad in portrait (768–1023px) starts on the icon
  // rail: the full 260px sidebar left the content ~560px and squeezed every
  // workspace into a phone layout beside it (2026-10-13). The toggle still
  // expands it, and that choice is saved like any other.
  const savedCollapsed = localStorage.getItem(SIDEBAR_COLLAPSED_KEY);
  const tabletPortrait = window.matchMedia('(min-width: 768px) and (max-width: 1023.98px)').matches;
  if (savedCollapsed === '1' || (savedCollapsed === null && tabletPortrait)) {
    document.body.classList.add('workspace-sidebar-collapsed');
  }

  toggle?.addEventListener('click', () => {
    if (isMobileViewport()) {
      const next = !document.body.classList.contains('workspace-sidebar-open');
      document.body.classList.toggle('workspace-sidebar-open', next);
      toggle.setAttribute('aria-expanded', String(next));
    } else {
      const next = !document.body.classList.contains('workspace-sidebar-collapsed');
      document.body.classList.toggle('workspace-sidebar-collapsed', next);
      // aria-expanded: collapsed = false, expanded = true
      toggle.setAttribute('aria-expanded', String(!next));
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? '1' : '0');
    }
  });

  // Backdrop click closes the mobile drawer
  backdrop?.addEventListener('click', () => {
    document.body.classList.remove('workspace-sidebar-open');
    toggle?.setAttribute('aria-expanded', 'false');
  });

  // Clicking any sidebar item on mobile closes the drawer (consistent with
  // most SaaS apps — selection should commit + collapse, not just commit).
  // Covers both section buttons (data-admin-side) and external links
  // (anchors that open in a new tab).
  sideNav?.addEventListener('click', (e) => {
    if (!isMobileViewport()) return;
    if (e.target.closest('.workspace-side-item')) {
      document.body.classList.remove('workspace-sidebar-open');
      toggle?.setAttribute('aria-expanded', 'false');
    }
  });

  // If the viewport crosses the breakpoint while the drawer is open
  // (rotation, resizing devtools), reset the drawer state — the
  // collapsed-icon mode and the drawer mode shouldn't ever coexist.
  window.matchMedia('(max-width: 767.98px)').addEventListener('change', (ev) => {
    if (!ev.matches) document.body.classList.remove('workspace-sidebar-open');
  });
}

document.addEventListener('DOMContentLoaded', () => {
  initSidebarToggle();
  initAnalytics('admin');
  initAnalyticsDashboard();

  // ปีการศึกษา, once, for the WHOLE admin app (0141/0145). It used to be primed
  // only when the ระบบบ้าน section opened, which was fine while ระบบบ้าน was the
  // only pane that computed a ชั้นปี. ทีม SAMO computes one now, so an admin who
  // opens /admin/#team without ever touching ระบบบ้าน would have been reading
  // every ชั้นปี off the CLOCK fallback instead of the value the faculty set —
  // agreeing with it by luck today, and silently wrong for the weeks around the
  // promotion, which is the exact failure 0141 chose an admin-set value to avoid.
  primeAcademicYear();

  // Wire the gated sign-in button
  document.getElementById('adminSignInBtn')?.addEventListener('click', () => {
    const modalEl = document.getElementById('signinModal');
    if (modalEl && window.bootstrap) window.bootstrap.Modal.getOrCreateInstance(modalEl).show();
  });

  // Sidebar click delegation — every [data-admin-side] button routes
  // through showAdminSide(). Single listener so adding sidebar items
  // later just means adding a button (no extra wiring).
  document.getElementById('adminSideNav')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-admin-side]');
    if (!btn || btn.classList.contains('d-none')) return;
    showAdminSide(btn.dataset.adminSide);
  });

  // Landing-card click delegation — same idea for the big cards on the
  // overview pane. They already have inline onclick="openAdminSection(...)"
  // which is wired below, so this just exists as a fallback safety net.

  // Allow the boot gate to time out so users aren't stuck on the spinner
  // if Supabase is slow / unreachable. Show a "slow load" message rather
  // than the access-denied UI — a staff user on a slow network would
  // otherwise read "เฉพาะเจ้าหน้าที่" right before the dashboard pops in.
  const bootTimeout = setTimeout(() => {
    if (!APP_ROOT()?.classList.contains('d-none')) return;
    const gate = BOOT_GATE();
    if (gate && !gate.classList.contains('d-none')) {
      const sub = gate.querySelector('.small');
      if (sub) sub.textContent = 'โหลดช้ากว่าปกติ — ลองรีเฟรชหากค้างนาน';
    }
  }, 4000);

  onAuthChange((user) => {
    const role = user?.role || null;

    // A DIFFERENT account is now signed in on the same page instance — reload
    // so every module boots clean. Only fires when we had a real account
    // before: null → user is an ordinary first sign-in with nothing stale to
    // clear, and a token refresh re-fires with the SAME id (which must not
    // reload, or a refresh would nuke the user's place every 25 minutes).
    if (user?.id && bootUserId && user.id !== bootUserId) {
      swapAccountReload();
      return;
    }
    if (user?.id) bootUserId = user.id;

    if (!user) {
      // The FIRST onAuthChange fire is synchronous on subscribe — it
      // happens before initAuth() has restored the session from storage,
      // so currentUser is null even for a signed-in user. If a session
      // token is persisted and auth hasn't settled yet, stay on the boot
      // spinner rather than flashing the sign-in gate. On slow mobile
      // connections that flash was reading as "logged out — log in again
      // on every refresh" (the bug report); iPad/desktop settle fast
      // enough that it was never visible there. authReady (below) shows
      // the gate for real if the persisted token turns out stale.
      if (!authSettled && hasPersistedSession()) return;
      clearTimeout(bootTimeout);
      // Reset so the next sign-in re-applies initial routing for the
      // new user (whose role and accessible panes may differ).
      initialSectionApplied = false;
      showAuthGate();
      return;
    }
    if (!canUseAdmin(user)) {
      clearTimeout(bootTimeout);
      initialSectionApplied = false;
      showAuthGate();
      return;
    }

    clearTimeout(bootTimeout);
    showApp();

    // Sidebar identity
    const pic  = document.getElementById('adminUserPic');
    const name = document.getElementById('adminUserName');
    const sub  = document.getElementById('adminUserRole');
    if (pic)  pic.src = user.picture || '';
    if (name) name.textContent = user.name || user.username || '';
    if (sub)  sub.textContent  = roleLabel(role) || user.department || 'ทีม SAMO';

    // Feature-gate sidebar + landing items: a node is visible if its
    // data-admin-side / data-admin-pane feature is granted to the user
    // (via role default OR permissions array). Legacy data-role-only
    // attributes are honoured too — kept for backward compatibility,
    // but new gates should use data-admin-side which userCanAccess() owns.
    document.querySelectorAll('[data-admin-side]').forEach((el) => {
      // An element whose key is NOT in SIDE_FEATURE stays hidden — the route
      // gate may allow an unknown section (it falls back to landing), but a
      // visible entry nobody gates is how a card shows to everyone.
      const which = el.dataset.adminSide;
      const ok = Object.prototype.hasOwnProperty.call(SIDE_FEATURE, which) && sideAllowed(SIDE_FEATURE[which], user);
      el.classList.toggle('d-none', !ok);
    });
    paintYearChip(user);
    // Landing cards: each col carries data-admin-side too (or fall back
    // to the legacy data-role-only).
    document.querySelectorAll('[data-role-only]').forEach((el) => {
      // If the element ALSO has data-admin-side, skip — that path
      // already handled it above with the permission-aware check.
      if (el.hasAttribute('data-admin-side')) return;
      const allowed = el.getAttribute('data-role-only').split(/\s+/);
      el.classList.toggle('d-none', !allowed.includes(role));
    });

    // Initial section: read hash, else default landing. Run ONCE per
    // session — subsequent onAuthChange fires (token refresh, tab
    // re-focus) must NOT yank the user back to landing or wipe out a
    // deep-link like `#projects/PRJ-XXXX`. The closure flag below
    // (initialSectionApplied) lives in the module scope so the bound
    // subscriber sees it across fires.
    //
    // Hash matching is done on the FIRST SEGMENT only so deep links
    // (`#projects/PRJ-XXXX`, `#projects/PRJ-X/doc/DOC-Y`, `#creator/<id>`)
    // resolve to the right section. Sub-routes are then re-applied by
    // each module's own hash listener (e.g. projects/index.js's
    // applyHashRoute on hashchange + initial mount).
    if (!initialSectionApplied) {
      initialSectionApplied = true;
      // /admin/?scan=<id> has its own onAuthChange subscriber (below)
      // that routes to 'shop' and opens the order modal. If we route
      // here too, the tryCreatorDeepLink().then() resolves AFTER that
      // sync route and clobbers shop back to landing — user sees the
      // order modal floating on top of the ภาพรวม Admin landing
      // pane instead of the orders table. Skip routing for the scan
      // path and let the scan subscriber own it.
      const hasScan = new URLSearchParams(window.location.search).get('scan');
      if (!hasScan) {
        const rawHash = location.hash.replace(/^#/, '');
        const first   = rawHash.split('/')[0];
        tryCreatorDeepLink(rawHash).then((routed) => {
          if (routed) return;
          showAdminSide(SECTION_META[first] ? first : 'landing');
        });
      }
    }

    // Auto-close the sign-in modal once a staff session lands
    const modalEl = document.getElementById('signinModal');
    if (modalEl && window.bootstrap) {
      const inst = window.bootstrap.Modal.getInstance(modalEl);
      if (inst) inst.hide();
    }
  });

  // Auth has settled (session restored or confirmed absent). Mark it so
  // the onAuthChange boot-stay above stops suppressing the gate, and if
  // there's still no staff user, show the sign-in gate now.
  authReady.then(() => {
    authSettled = true;
    const u = authGetUser();
    if (!canUseAdmin(u)) {
      clearTimeout(bootTimeout);
      showAuthGate();
    }
  });
  // Safety net: if initAuth() ever wedges (e.g. a token refresh hangs on
  // a flaky mobile network so authReady never resolves), don't trap the
  // user on the boot spinner forever — fall through to the sign-in gate
  // after a generous wait so they can re-authenticate manually.
  setTimeout(() => {
    if (authSettled) return;
    authSettled = true;
    if (!authGetUser()) { clearTimeout(bootTimeout); showAuthGate(); }
  }, 9000);

  initAuth();
  initProfileModal();
  mountAccountSwitch();
  mountSigninModal();
  initShop();
  initProjects();
  initTeam();

  // Deep-link: /admin/?scan=<orderId> jumps to that order's detail.
  // Waits for the first signed-in state — if signed-out, the global
  // sign-in gate kicks in and we resolve as soon as that completes.
  // onAuthChange fires synchronously on subscribe, so guard against
  // double-invocation with a done flag.
  const scanId = new URLSearchParams(window.location.search).get('scan');
  if (scanId) {
    let done = false;
    onAuthChange((u) => {
      if (done || !u) return;
      // An account with no samoshop grant gets nothing here rather than the
      // orders workspace with an empty modal on top of it. `done` stays false so
      // a later fire (the account switcher, a permission sync) can still route.
      if (!userCanAccess('samoshop', u)) return;
      done = true;
      showAdminSide('shop');
      openShopAdminOrder(scanId);
      const url = new URL(window.location.href);
      url.searchParams.delete('scan');
      window.history.replaceState({}, '', url.toString());
    });
  }

  // Global "copy to clipboard" delegate — mirrors main.js so admin
  // surfaces (order id chips, etc.) can use [data-copy] markup.
  // stopPropagation is critical here: the orders table delegates a
  // row-click that opens the detail modal, and the copy chip is
  // INSIDE the row — without the stop, tapping copy would also pop
  // the modal.
  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-copy]');
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    const ok = await copyText(btn.dataset.copy);
    if (!ok) return;
    const icon = btn.querySelector('i');
    if (icon) {
      const prev = icon.className;
      icon.className = 'bi bi-check2';
      setTimeout(() => { icon.className = prev; }, 1200);
    }
  });
});

// Non-production marker. Last import wins nothing here — it only needs a body.
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountEnvRibbon, { once: true });
else mountEnvRibbon();
