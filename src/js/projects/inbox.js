// ==============================================
// PROJECTS INBOX — two-level drill-down
//
// Level 1 (grid):    one card per โครงการ, scannable like Google Drive.
//                    Filter chips + search + per-card "X ของฉัน" badge.
// Level 2 (detail):  click a project → breadcrumb back, project header
//                    with actions, list of its หนังสือ as compact cards.
//                    Click a doc card → expand inline with the 4-step
//                    stepper + files + actions + timeline.
//
// Both roles see the same shape; only the action buttons inside the
// expanded doc differ.
// ==============================================

import { escHtml, safeUrl } from '../utils.js';
import { getUser } from '../auth.js';
import {
  getProject,
  getDocument,
  deleteProject,
  updateProject,
  appendDocTimeline,
  updateDocument,
  deleteDocument,
  listFiles,
  createFile,
  deleteFile,
  listMyDocViews,
  upsertMyDocView,
  bulkUpsertMyDocViews,
  appendSignTimeline,
  updateSignRequest,
  deleteSignRequest,
  getMyProjectPrefs,
  saveMyProjectDefaultFY,
} from './api.js';
import {
  DOC_STATUS_META,
  DOC_PATH_ORDER,
  SIGN_STATUS_META,
  fmtDate,
  fmtDateTime,
  fmtRelative,
  fmtBytes,
  buildDocFolderPath,
  buildProjectFolderPath,
} from './data.js';
import { uploadProjectFile, deleteProjectFolder, deleteProjectFile, getProjectFolderInfo, getProjectFileData } from './uploads.js';
import { notifyUniStaff, notifyVpAdmin, notifyProf } from './notify.js';
// esign.js (with pdf.js + pdf-lib, ~1.4 MB) is lazy-loaded on demand so
// the heavy PDF libs never ship in the main bundle / public mirror.
import { openProjectPrompt, openProjectConfirm } from './ui-prompt.js';
import { showProjectQrModal } from './qr.js';
import {
  projectFiscalYear,
  isFiscalYearMoved,
  deriveFiscalYearBE,
  fiscalYearOptions,
  moveTargetYears,
  resolveDefaultFY,
  isValidDefaultFY,
  DEFAULT_FY_ALL,
  DEFAULT_FY_CURRENT,
} from './fiscal-year.js';

// ---------- module state ----------

let onChanged = () => {};
let onAddDocumentCb = null;
let onCreateProjectCb = null;
let onSendToProfCb = null;   // open the "ส่งให้อาจารย์ลงนาม" picker modal

let cache = { projects: [], docTypes: [], settings: null, role: null };

// Customer-mirror mode. When true:
//   - markDocSeen() is a no-op (the customer has no identity to persist
//     seenAt against — every visit is "fresh")
//   - the comment button + chevron-only mutation paths are suppressed
//     in click handlers (defence-in-depth on top of CSS hiding)
//   - the renderer suppresses copy-link / comment / file-add buttons
//     that aren't relevant for an anonymous read-only viewer.
// Set via setInboxCustomerMode() from index.js mountCustomerProjects().
let customerMode = false;
export function setInboxCustomerMode(on) { customerMode = !!on; }

let level    = 'grid';     // 'grid' | 'detail'
let selectedProjectId = null;
let expandedDocs = new Set();   // doc ids expanded inside the detail view
// Per-doc seenAt frozen at the moment the user expanded the doc.
// Renders of the expanded body use this frozen value so the unread
// banner / "ใหม่" pill / is-unread row don't vanish the instant the
// user opens the doc (the click handler also calls markDocSeen
// to persist the "I've seen it" state for the grid + doc card; without
// the freeze, that write would clear the highlights the user opened
// the หนังสือ to read).
let expandedDocsSeenAt = new Map();   // docId -> ms-since-epoch frozen at expand
let filterKind = 'all';    // 'all' | 'mine' | 'notified' | 'waiting' | 'done'
let searchQ    = '';
let filterFY   = 'all';    // 'all' | '<4-digit BE year>' — ปีงบประมาณ (Thai fiscal year)
// The viewer's SAVED default (project_user_prefs.default_fiscal_year, 0165):
// 'all' | 'current' | '<4-digit BE year>'. null until the first load resolves
// it; an absent row stays 'all', which is what the inbox did before 0165.
let defaultFYPref = DEFAULT_FY_ALL;
// The default is applied ONCE PER ACCOUNT, not on every render — otherwise
// every repaint would yank the dropdown back and the user could never pick
// a different year for the session they are in. Keyed by uid rather than a
// bare boolean because this app switches accounts IN PLACE, and a module-scope
// flag is exactly how a previous account's state survives that switch
// (docs/mistakes/app-state.md).
let fyDefaultAppliedFor = null;
// 'grid' = original card grid; 'list' = compact one-row-per-project list.
// Persisted per browser so the user's preference sticks across sessions.
let viewMode = (() => {
  try {
    const v = localStorage.getItem('projects.viewMode');
    // Default to the compact list (only honour an explicit 'grid' choice).
    return v === 'grid' ? 'grid' : 'list';
  } catch { return 'list'; }
})();

// Deferred actions, applied at the end of render()
let scrollDocId = null;

// ---------- helpers: next-actor / "is mine" ----------

/** Is this โครงการ / หนังสือ published to the public mirror? (0114)
 *
 *  Single reader of the flag so the SQL default (`true`) has exactly one
 *  mirror in JS: a row that predates the column, or a payload that didn't
 *  select it, reads as SHOWN — the behaviour the public site had before
 *  the flag existed. Note this is a LABEL, not a gate: what the public can
 *  actually read is decided by RLS (projects_read_public /
 *  project_documents_read_public / project_files_read_public), so a hidden
 *  row never reaches the customer bundle at all. */
export function isShownPublicly(row) {
  return row?.is_public !== false;
}

function nextOwner(doc) {
  switch (doc.status) {
    case 'sent':        return 'uni_staff';
    case 'received':    return 'uni_staff';
    case 'in_progress': return 'uni_staff';
    case 'returned':    return 'vp_admin';
    default:            return null;
  }
}

/** Does this หนังสือ carry a PENDING signing request addressed to the
 *  current professor? This is the prof's "action required" signal — the
 *  analogue of uni_staff's status='sent' and vp_admin's status='returned'.
 *  Persists until he accepts/rejects (the request leaves 'pending'). */
function docPendingSignForProf(doc) {
  // Any pending request counts — อาจารย์ is one shared role, so the desk's
  // queue is the professor's queue (0095). Matches prof_can_see_document().
  return Array.isArray(doc?.sign_requests)
    && doc.sign_requests.some((r) => r.status === 'pending');
}

function isMine(doc, role) {
  if (role === 'sa_prof') return docPendingSignForProf(doc);
  const o = nextOwner(doc);
  if (!o) return false;
  if (role === 'dev') return true;
  return o === role;
}

/** Project-level rollup used by the grid: which bucket does this project fall in? */
function projectBucket(p, role) {
  const docs = p.documents || [];
  if (docs.length === 0) return 'empty';
  // The professor's lifecycle is the SIGN-REQUEST status, not doc.status —
  // a หนังสือ may be 'completed' in the sastaff↔vpa workflow yet still be
  // pending his signature. mine = any pending request to him; else done.
  if (role === 'sa_prof') {
    return docs.some((d) => docPendingSignForProf(d)) ? 'mine' : 'done';
  }
  const active = docs.filter((d) => d.status !== 'completed');
  if (active.length === 0) return 'done';
  const hasMine = active.some((d) => isMine(d, role));
  if (hasMine) return 'mine';
  return 'waiting';
}

/** Base project set after the ปีงบประมาณ filter — the OUTERMOST filter, so
 *  both the chip counts and the grid see the same fiscal-year-scoped set
 *  (a selected year with 0 "mine" reads as "cleared", not "no year").
 *
 *  The year comes from projectFiscalYear() — the override a vpa/staff actor
 *  set, else the derivation from created_at — so a โครงการ moved to another
 *  ปีงบ moves in the FILTER, the CHIP COUNTS and the GRID together. */
function projectsInSelectedFY() {
  if (filterFY === 'all') return cache.projects;
  return cache.projects.filter((p) => String(projectFiscalYear(p)) === filterFY);
}

/** Counts for the level-1 filter chips, computed once per render(). */
function projectBucketCounts(role) {
  const c = { mine: 0, notified: 0, waiting: 0, done: 0, all: 0 };
  for (const p of projectsInSelectedFY()) {
    c.all += 1;
    const b = projectBucket(p, role);
    if (b === 'mine') c.mine += 1;
    else if (b === 'waiting') c.waiting += 1;
    else if (b === 'done') c.done += 1;
    if (projectIsNotified(p, role)) c.notified += 1;
  }
  return c;
}

/** Does this doc carry any unseen incoming event for the viewer?
 *  Incoming = any action from the OTHER side that the viewer's per-doc
 *  seenAt predates. Powers the doc-card "อัปเดต" pill, the inbox grid
 *  badge, and the project-level notified state.
 *
 *  "Other side" here means: filter out events the viewer themself did
 *  (e.role === role). A new file added by the VPA while uni_staff is
 *  in "received" status counts — same goes for the status changes that
 *  used to be invisible until you drilled in.
 *
 *  Cleared by: any user action on the doc (markDocSeen) or expanding
 *  the doc (markDocSeen). */
function docHasUnseen(doc, role) {
  const tl = doc.timeline || [];
  const seenAt = getDocSeenAt(doc.id);
  const wanted = INCOMING_ACTIONS[role] || new Set();
  for (const e of tl) {
    if (e.role === role) continue;
    if (!wanted.has(e.action)) continue;
    const ts = Math.max(
      Date.parse(e.at) || 0,
      e.edited_at ? (Date.parse(e.edited_at) || 0) : 0,
    );
    if (ts > seenAt) return true;
  }
  return false;
}

/** Same as docHasUnseen but ignores the action already represented by
 *  the status "X ใหม่"/"X ตีกลับ" badge — so a comment or file added on a
 *  sent หนังสือ still surfaces as an อัปเดต instead of being swallowed by
 *  the new-doc count. Drives both the project-grid blue badge and the
 *  doc-card blue pill.
 *
 *  Optional `seenAtOverride` lets the doc-card head use the SAME frozen
 *  pre-expand seenAt the banner uses, so the blue pill stays visible
 *  while the user is reading the comment that triggered it. Without the
 *  override, expanding the หนังสือ calls markDocSeen → live seenAt jumps
 *  to "now" → the pill vanishes the same render the banner appears,
 *  producing the inconsistent "banner says new but the head doesn't"
 *  the user flagged. */
function docHasUnseenBeyondStatusBadge(doc, role, seenAtOverride) {
  const tl = doc.timeline || [];
  const seenAt = seenAtOverride != null ? seenAtOverride : getDocSeenAt(doc.id);
  const wanted = INCOMING_ACTIONS[role] || new Set();
  const alreadyBadged = role === 'uni_staff' && doc.status === 'sent' ? 'sent'
                      : role === 'vp_admin'  && doc.status === 'returned' ? 'returned'
                      : null;
  for (const e of tl) {
    if (e.role === role) continue;
    if (!wanted.has(e.action)) continue;
    if (alreadyBadged && e.action === alreadyBadged) continue;
    const ts = Math.max(
      Date.parse(e.at) || 0,
      e.edited_at ? (Date.parse(e.edited_at) || 0) : 0,
    );
    if (ts > seenAt) return true;
  }
  return false;
}

function projectHasUnseen(p, role) {
  return (p.documents || []).some((d) => docHasUnseen(d, role));
}

/** "ได้รับแจ้งเตือน" — projects with a NEW event for the current viewer.
 *  Combines "action required" status (sent for uni_staff, returned for
 *  vp_admin) with the seenAt-based unseen-activity check so a file
 *  upload while status='received' still lights the project up. */
function projectIsNotified(p, role) {
  const docs = p.documents || [];
  const baseStatus = role === 'uni_staff'
    ? docs.some((d) => d.status === 'sent')
    : role === 'vp_admin'
    ? docs.some((d) => d.status === 'returned')
    : role === 'dev'
    ? docs.some((d) => d.status === 'sent' || d.status === 'returned')
    : role === 'sa_prof'
    ? docs.some((d) => docPendingSignForProf(d))
    : false;
  return baseStatus || projectHasUnseen(p, role);
}

function updateViewToggleUI() {
  const wrap = document.getElementById('projectsViewToggle');
  if (!wrap) return;
  wrap.querySelectorAll('[data-projects-view-mode]').forEach((b) => {
    b.classList.toggle('is-active', b.dataset.projectsViewMode === viewMode);
  });
}

function lastActivityTime(p) {
  let t = new Date(p.updated_at || p.created_at).getTime() || 0;
  for (const d of (p.documents || [])) {
    const dt = new Date(d.updated_at || d.sent_at || d.created_at).getTime() || 0;
    if (dt > t) t = dt;
  }
  return t;
}

// Sort-key for the inbox: timestamp of the most recent action by the
// OTHER party — i.e. an "incoming" event from the viewer's perspective.
// Slack/Gmail/Linear convention: someone else's action bumps the item;
// your own action does NOT. If we used lastActivityTime, clicking
// "รับเรื่อง" / "ตีกลับ" would yank the project to the top — disorienting
// when the user is acting through a list. Falls back to project.created_at
// so a brand-new project (no other-side activity yet) doesn't sink to
// time-zero.
// Anything the OTHER role can do that should surface as "incoming" to
// the viewer. Used both for the inbox sort ordering (lastIncoming-
// ActivityTime) and the new docHasUnseen / banner logic. uni_staff's
// list includes `returned` so a VPA-initiated revert into returned
// surfaces; both lists include `file_deleted` so a delete by the other
// side counts as activity worth re-flashing.
const INCOMING_ACTIONS = {
  // Both internal seats now upload files (sastaff has parity with vpa), so
  // each must see the OTHER's file ops as incoming. Both also see the
  // professor's sign decisions (sign_accepted / sign_rejected, appended to
  // the doc timeline so the inbox highlight + banner pick them up).
  uni_staff: new Set(['sent', 'file_added', 'file_replaced', 'file_deleted', 'returned', 'comment',
                       'sign_accepted', 'sign_rejected', 'signed_file']),
  vp_admin:  new Set(['received', 'in_progress', 'completed', 'returned', 'comment',
                       'file_added', 'file_replaced', 'file_deleted',
                       'sign_accepted', 'sign_rejected', 'signed_file']),
  dev:       new Set(['sent', 'received', 'in_progress', 'completed', 'returned',
                       'file_added', 'file_replaced', 'file_deleted', 'comment',
                       'sign_accepted', 'sign_rejected', 'signed_file']),
  // The professor tracks file changes AND comments on a หนังสือ shown to him
  // (he's now part of the comment thread). The sastaff↔vpa status churn
  // (received / in_progress / completed) is still noise to him. A NEW signing
  // request itself surfaces via the permanent actionRequiredOn pill, not here
  // (it's a sign_requests event, not a doc timeline event).
  sa_prof:   new Set(['file_added', 'file_replaced', 'file_deleted', 'comment']),
};
function lastIncomingActivityTime(p, role) {
  const wanted = INCOMING_ACTIONS[role] || new Set();
  let t = 0;
  for (const d of (p.documents || [])) {
    for (const e of (d.timeline || [])) {
      if (e.role === role) continue;             // skip the viewer's own actions
      if (!wanted.has(e.action)) continue;
      const dt = new Date(e.at).getTime() || 0;
      if (dt > t) t = dt;
    }
    // Initial 'sent' for uni_staff often pre-dates timeline entries — bring
    // sent_at into play so a brand-new doc still sorts toward the top of
    // its bucket.
    if (role === 'uni_staff' || role === 'dev') {
      const sentAt = new Date(d.sent_at || 0).getTime() || 0;
      if (sentAt > t) t = sentAt;
    }
  }
  if (t === 0) t = new Date(p.created_at || 0).getTime() || 0;
  return t;
}

/** Open or close the inline-expanded หนังสือ. Captures the pre-expand
 *  seenAt so the unread highlights inside the body persist for the
 *  duration of the user's reading session, while the localStorage
 *  write still happens immediately so the outer grid/card pills clear.
 *  Releasing on collapse means re-expanding (without a fresh comment
 *  arriving) shows no highlight — matching "they already read it". */
function toggleDocExpansion(docId) {
  if (expandedDocs.has(docId)) {
    expandedDocs.delete(docId);
    expandedDocsSeenAt.delete(docId);
  } else {
    expandedDocsSeenAt.set(docId, getDocSeenAt(docId));
    expandedDocs.add(docId);
    markDocSeen(docId);
  }
}

// ---------- mounting ----------

export function mountInbox({ onChanged: changed, onAddDocument, onCreateProject, onSendToProf }) {
  if (typeof changed === 'function') onChanged = changed;
  if (typeof onAddDocument === 'function') onAddDocumentCb = onAddDocument;
  if (typeof onCreateProject === 'function') onCreateProjectCb = onCreateProject;
  if (typeof onSendToProf === 'function') onSendToProfCb = onSendToProf;

  // Adaptive FAB — primary add action depends on the current level.
  document.getElementById('projectsCreateFab')?.addEventListener('click', () => {
    if (level === 'detail' && selectedProjectId) {
      const p = cache.projects.find((x) => x.id === selectedProjectId);
      if (p && onAddDocumentCb) { onAddDocumentCb(p); return; }
    }
    if (onCreateProjectCb) onCreateProjectCb();
  });

  document.getElementById('projectsFilterRow')?.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-projects-filter]');
    if (!chip) return;
    filterKind = chip.dataset.projectsFilter;
    render();
  });

  document.getElementById('projectsSearchInput')?.addEventListener('input', (e) => {
    searchQ = (e.target.value || '').toLowerCase().trim();
    render();
  });

  document.getElementById('projectsFiscalYear')?.addEventListener('change', (e) => {
    filterFY = e.target.value || 'all';
    render();
  });

  document.getElementById('projectsFyDefaultBtn')?.addEventListener('click', () => {
    openFiscalYearDefaultPicker();
  });

  document.getElementById('projectsViewToggle')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-projects-view-mode]');
    if (!btn) return;
    const next = btn.dataset.projectsViewMode;
    if (next !== 'grid' && next !== 'list') return;
    if (next === viewMode) return;
    viewMode = next;
    try { localStorage.setItem('projects.viewMode', viewMode); } catch {}
    updateViewToggleUI();
    render();
  });
  updateViewToggleUI();

  document.getElementById('projectsBackToGrid')?.addEventListener('click', () => {
    level = 'grid';
    selectedProjectId = null;
    expandedDocs.clear();
    expandedDocsSeenAt.clear();
    history.replaceState(null, '', '#projects');
    render();
  });

  // Delegated handlers — one for clicks, one for change (file inputs)
  const inbox = document.querySelector('[data-projects-pane="inbox"]');
  inbox?.addEventListener('click', onInboxClick);
  inbox?.addEventListener('change', onInboxChange);
}

// ---------- public renderers (entry points) ----------

export function renderInbox(next) {
  cache = { ...cache, ...next };
  render();
  // Fire-and-forget: the inbox paints immediately on ทุกปีงบ and re-paints
  // on the viewer's saved ปีงบ default a moment later. Awaiting it here
  // would make every data refresh wait on a preference read.
  applyDefaultFiscalYear();
}

export function openProjectDetail(projectId) {
  selectedProjectId = projectId;
  level = 'detail';
  render();
}

export async function openDocumentDetail(documentId) {
  let found = null;
  for (const p of cache.projects) {
    const d = (p.documents || []).find((x) => x.id === documentId);
    if (d) { found = { doc: d, project: p }; break; }
  }
  if (!found) {
    const doc = await getDocument(documentId).catch(() => null);
    if (!doc) return;
    const project = await getProject(doc.project_id).catch(() => null);
    if (project) found = { doc, project };
  }
  if (!found) return;
  selectedProjectId = found.project.id;
  level = 'detail';
  // Freeze the pre-expand seenAt the same way the click handler does
  // so the deep-link path also shows the comment banner + ใหม่ pill
  // for everything that was new at the time the link was opened.
  if (!expandedDocs.has(documentId)) {
    expandedDocsSeenAt.set(documentId, getDocSeenAt(documentId));
    expandedDocs.add(documentId);
    markDocSeen(documentId);
  }
  scrollDocId = documentId;
  render();
}

// ---------- main render ----------

function render() {
  const gridRoot   = document.getElementById('projectsLevelGrid');
  const detailRoot = document.getElementById('projectsLevelDetail');
  if (!gridRoot || !detailRoot) return;

  updateFab();

  if (level === 'grid') {
    gridRoot.classList.remove('d-none');
    detailRoot.classList.add('d-none');
    renderFiscalYearOptions();
    renderFilterChips();
    renderGrid();
  } else {
    gridRoot.classList.add('d-none');
    detailRoot.classList.remove('d-none');
    renderDetail();
    // Lazy-load files for any expanded doc
    expandedDocs.forEach((docId) => {
      if (document.getElementById(`projectsFilesList-${docId}`)) loadFilesForDoc(docId);
    });
    if (scrollDocId) {
      requestAnimationFrame(() => {
        const t = document.querySelector(`[data-projects-doc-id="${cssEsc(scrollDocId)}"]`);
        if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' });
        scrollDocId = null;
      });
    }
  }
}

/** Reflect the current level on the FAB so its icon + aria-label tell
 *  the user what tapping it will do. Role-visibility itself is handled
 *  by applyRoleVisibility() in index.js via the data-projects-role attr. */
function updateFab() {
  const fab = document.getElementById('projectsCreateFab');
  if (!fab) return;
  if (level === 'detail' && selectedProjectId) {
    fab.innerHTML = '<i class="bi bi-file-earmark-plus"></i>';
    fab.setAttribute('aria-label', 'เพิ่มหนังสือในโครงการนี้');
    fab.setAttribute('title', 'เพิ่มหนังสือ');
  } else {
    fab.innerHTML = '<i class="bi bi-folder-plus"></i>';
    fab.setAttribute('aria-label', 'สร้างโครงการใหม่');
    fab.setAttribute('title', 'สร้างโครงการใหม่');
  }
}

// ---------- Level 1: filter chips + project grid ----------

/** Populate the ปีงบประมาณ dropdown. Options are data-driven so the list grows
 *  by itself each budget year — plus the CURRENT year and the year the
 *  viewer's own default resolves to, which is what keeps "ปีงบปัจจุบัน" from
 *  snapping back to ทุกปีงบ on 1 ต.ค. before the first โครงการ of that year
 *  exists (fiscalYearOptions() owns that rule). */
function renderFiscalYearOptions() {
  const sel = document.getElementById('projectsFiscalYear');
  if (!sel) return;
  const years = fiscalYearOptions(cache.projects, { defaultFY: defaultFYPref });
  // Drop a now-stale selection (e.g. the year's last project was deleted).
  if (filterFY !== 'all' && !years.includes(filterFY)) filterFY = 'all';
  sel.innerHTML = ['<option value="all">ทุกปีงบ</option>']
    .concat(years.map((y) => `<option value="${y}">ปีงบ ${y}</option>`))
    .join('');
  sel.value = filterFY;
  renderFiscalYearDefaultBtn();
}

/** The pin beside the ปีงบ dropdown. Filled when what is on screen IS the
 *  saved default, hollow when it is a one-off pick — so the control says
 *  which of the two states you are in before you open it. */
function renderFiscalYearDefaultBtn() {
  const btn = document.getElementById('projectsFyDefaultBtn');
  if (!btn) return;
  // customerMode has no account, so it has nothing to save a default to.
  btn.classList.toggle('d-none', customerMode || !getUser()?.id);
  const isDefault = filterFY === resolveDefaultFY(defaultFYPref);
  btn.classList.toggle('is-set', isDefault);
  btn.innerHTML = `<i class="bi bi-pin-angle${isDefault ? '-fill' : ''}"></i>`;
  btn.title = defaultFYPref === DEFAULT_FY_CURRENT
    ? 'ค่าเริ่มต้น: ปีงบปัจจุบัน (อัตโนมัติ) — กดเพื่อเปลี่ยน'
    : defaultFYPref === DEFAULT_FY_ALL
    ? 'ค่าเริ่มต้น: ทุกปีงบ — กดเพื่อเปลี่ยน'
    : `ค่าเริ่มต้น: ปีงบ ${defaultFYPref} — กดเพื่อเปลี่ยน`;
  btn.setAttribute('aria-label', btn.title);
}

/** Load the viewer's saved default and apply it — ONCE per mount, before the
 *  first grid paint. Everything here is best-effort: a failed read leaves
 *  'all', the behaviour the inbox had before 0165. */
export async function applyDefaultFiscalYear() {
  if (customerMode) return;
  const uid = getUser()?.id;
  if (!uid || fyDefaultAppliedFor === uid) return;
  fyDefaultAppliedFor = uid;
  const row = await getMyProjectPrefs(uid).catch(() => null);
  const pref = row?.default_fiscal_year;
  defaultFYPref = isValidDefaultFY(pref) ? pref : DEFAULT_FY_ALL;
  // Assign UNCONDITIONALLY, including the 'all' case. An early return there
  // reset `defaultFYPref` for the new account but left `filterFY` holding the
  // PREVIOUS account's year — half a reset, which is the shape that makes an
  // in-place account switch show two accounts at once. The admin shell happens
  // to hard-reload on a switch today (swapAccountReload), so this was not
  // reachable; a half-done guard that depends on an unrelated module's reload
  // is not a guard.
  filterFY = resolveDefaultFY(defaultFYPref);
  render();
}

/** "ตั้งค่าเริ่มต้น" — pick which ปีงบ this account opens on. Offered to every
 *  seat (ผู้ส่งหนังสือ / เจ้าหน้าที่คณะ / อาจารย์): it is a view preference,
 *  not a permission, and each of them opens this inbox. */
async function openFiscalYearDefaultPicker() {
  const uid = getUser()?.id;
  if (!uid) return;
  const years = fiscalYearOptions(cache.projects, { defaultFY: defaultFYPref });
  const options = [
    { value: DEFAULT_FY_ALL,     label: 'ทุกปีงบ' },
    { value: DEFAULT_FY_CURRENT, label: `ปีงบปัจจุบัน (อัตโนมัติ) — ตอนนี้คือ ${resolveDefaultFY(DEFAULT_FY_CURRENT)}` },
    ...years.map((y) => ({ value: y, label: `ปีงบ ${y}` })),
  ];
  const res = await openProjectPrompt({
    title: 'ปีงบเริ่มต้นของหน้านี้',
    hideText: true,
    selectLabel: 'เปิดหน้านี้ทุกครั้ง ให้แสดงปีงบ',
    selectOptions: options,
    selectInitial: defaultFYPref,
    hint: 'เลือก "ปีงบปัจจุบัน (อัตโนมัติ)" ระบบจะเปลี่ยนปีงบให้เองทุกวันที่ 1 ตุลาคม',
    okLabel: 'บันทึก',
  });
  const picked = res && typeof res === 'object' ? res.select : null;
  if (!picked || picked === defaultFYPref) return;
  try {
    await saveMyProjectDefaultFY(uid, picked);
  } catch (err) {
    window.alert(err?.message || 'บันทึกค่าเริ่มต้นไม่สำเร็จ');
    return;
  }
  defaultFYPref = picked;
  filterFY = resolveDefaultFY(defaultFYPref);
  render();
}

function renderFilterChips() {
  const row = document.getElementById('projectsFilterRow');
  if (!row) return;
  const c = projectBucketCounts(cache.role);
  // Role-aware "waiting" label — clarifies *who* the project is waiting on.
  const role = cache.role;
  const waitLabel = role === 'uni_staff' ? 'รอ SAMO'
                  : role === 'vp_admin'  ? 'รอเจ้าหน้าที่'
                  : customerMode         ? 'กำลังดำเนินการ'
                  : 'รออีกฝ่าย';
  // The customer mirror has no per-user identity, so "ของฉัน" and
  // "ได้รับแจ้งเตือน" are always 0 and meaningless — show only the
  // status-oriented chips that make sense for a read-only viewer.
  const chips = customerMode ? [
    { id: 'all',      label: 'ทั้งหมด',         count: c.all,      cls: 'is-all'  },
    { id: 'waiting',  label: waitLabel,         count: c.waiting,  cls: 'is-wait' },
    { id: 'done',     label: 'เสร็จสิ้น',        count: c.done,     cls: 'is-done' },
  ] : [
    { id: 'all',      label: 'ทั้งหมด',         count: c.all,      cls: 'is-all'  },
    { id: 'mine',     label: 'ของฉัน',          count: c.mine,     cls: 'is-mine' },
    { id: 'notified', label: 'ได้รับแจ้งเตือน',  count: c.notified, cls: 'is-notif' },
    { id: 'waiting',  label: waitLabel,         count: c.waiting,  cls: 'is-wait' },
    { id: 'done',     label: 'เสร็จสิ้น',        count: c.done,     cls: 'is-done' },
  ];
  row.innerHTML = chips.map((k) => `
    <button type="button" class="projects-chip ${k.cls} ${k.id === filterKind ? 'is-active' : ''}"
      data-projects-filter="${k.id}">
      <span>${escHtml(k.label)}</span>
      <span class="projects-chip-count">${k.count}</span>
    </button>
  `).join('');
}

function renderGrid() {
  const grid  = document.getElementById('projectsGrid');
  const empty = document.getElementById('projectsGridEmpty');
  if (!grid) return;

  let rows = projectsInSelectedFY().slice();
  // Filter by bucket / notification state
  const role = cache.role;
  if (filterKind === 'mine')         rows = rows.filter((p) => projectBucket(p, role) === 'mine');
  else if (filterKind === 'notified') rows = rows.filter((p) => projectIsNotified(p, role));
  else if (filterKind === 'waiting') rows = rows.filter((p) => projectBucket(p, role) === 'waiting');
  else if (filterKind === 'done')    rows = rows.filter((p) => projectBucket(p, role) === 'done');
  // Search
  if (searchQ) {
    rows = rows.filter((p) =>
      (p.name || '').toLowerCase().includes(searchQ)
      || (p.id   || '').toLowerCase().includes(searchQ)
      || (p.description || '').toLowerCase().includes(searchQ)
    );
  }
  // Sort (3-level, Gmail Inbox / Linear Inbox pattern):
  //   1. Bucket — needs-action ("mine") first, then waiting, then done.
  //   2. Notified items first WITHIN bucket — so a new incoming event
  //      surfaces to the top even when 100 projects share the bucket.
  //      Clearing the notification (e.g. uni_staff clicks "รับเรื่อง"
  //      on the only sent doc) moves the project DOWN into the
  //      non-notified subgroup of the same bucket; the bucket itself
  //      doesn't change unless the bucket-defining state did.
  //   3. Incoming-activity time desc — recent other-side action first.
  //      Uses INCOMING-only timestamps so your own clicks don't yank
  //      a project around; only fresh other-side activity bumps it.
  const bucketRank = { mine: 0, waiting: 1, done: 2, empty: 3 };
  rows.sort((a, b) => {
    const ra = bucketRank[projectBucket(a, role)] ?? 9;
    const rb = bucketRank[projectBucket(b, role)] ?? 9;
    if (ra !== rb) return ra - rb;
    const na = projectIsNotified(a, role) ? 0 : 1;
    const nb = projectIsNotified(b, role) ? 0 : 1;
    if (na !== nb) return na - nb;
    return lastIncomingActivityTime(b, role) - lastIncomingActivityTime(a, role);
  });

  if (rows.length === 0) {
    grid.innerHTML = '';
    if (empty) {
      // Friendly per-filter empty copy. The default static HTML covers
      // "no projects at all yet"; here we override for the filtered case
      // so an empty "ต้องทำ" reads as a positive ("งานเคลียร์แล้ว"),
      // not a confusing "no projects exist."
      const role = cache.role;
      const map = {
        // Per-role copy. A two-way `uni_staff ? … : …` silently gave อาจารย์ the
        // vp_admin wording ("ไม่มีหนังสือถูกตีกลับให้แก้"), which is meaningless
        // for them — their "ต้องทำ" bucket is รอลงนาม (isMine → docPendingSignForProf).
        mine: role === 'uni_staff'
          ? { icon: 'bi-check2-circle', title: 'ไม่มีงานค้าง', hint: 'งานทั้งหมดเคลียร์แล้ว' }
          : role === 'sa_prof'
          ? { icon: 'bi-check2-circle', title: 'ไม่มีหนังสือรอลงนาม', hint: 'ลงนามครบแล้วในขณะนี้' }
          : { icon: 'bi-check2-circle', title: 'ไม่มีรายการที่ต้องแก้', hint: 'ไม่มีหนังสือถูกตีกลับให้แก้ในขณะนี้' },
        waiting: role === 'uni_staff'
          ? { icon: 'bi-hourglass-split', title: 'ไม่มีรายการรอ SAMO', hint: '' }
          : role === 'sa_prof'
          ? { icon: 'bi-hourglass-split', title: 'ไม่มีรายการรอเจ้าหน้าที่คณะ', hint: '' }
          : { icon: 'bi-hourglass-split', title: 'ไม่มีรายการรอเจ้าหน้าที่', hint: '' },
        done: { icon: 'bi-archive', title: 'ยังไม่มีโครงการที่เสร็จสิ้น', hint: '' },
        all:  null,
      };
      // A selected fiscal year with NO projects at all takes priority — the
      // bucket/search copy ("งานเคลียร์แล้ว") would misread the emptiness.
      const fyEmpty = filterFY !== 'all' && projectsInSelectedFY().length === 0;
      const m = (searchQ ? null : map[filterKind]);
      if (fyEmpty) {
        empty.innerHTML = `
          <i class="bi bi-calendar-x"></i>
          <h4>ไม่มีโครงการในปีงบ ${escHtml(filterFY)}</h4>
          <p class="small text-muted mb-0">ลองเลือกปีงบอื่น หรือ "ทุกปีงบ"</p>
        `;
      } else if (m) {
        empty.innerHTML = `
          <i class="bi ${m.icon}"></i>
          <h4>${escHtml(m.title)}</h4>
          ${m.hint ? `<p class="small text-muted mb-0">${escHtml(m.hint)}</p>` : ''}
        `;
      } else if (searchQ) {
        empty.innerHTML = `
          <i class="bi bi-search"></i>
          <h4>ไม่พบโครงการที่ตรงกับคำค้น</h4>
          <p class="small text-muted mb-0">ลองคำอื่น หรือล้างช่องค้นหา</p>
        `;
      }
      empty.classList.remove('d-none');
    }
    return;
  }
  empty?.classList.add('d-none');
  // Container class drives layout (CSS grid vs compact list). Items
  // share the same data-projects-open-project attribute and click
  // handler so navigation works identically in both modes.
  grid.classList.toggle('projects-grid',  viewMode === 'grid');
  grid.classList.toggle('projects-list',  viewMode === 'list');
  const renderer = viewMode === 'list' ? renderProjectListRow : renderProjectCard;
  grid.innerHTML = rows.map(renderer).join('');
}

/** The ปีงบประมาณ chip the inbox shows on a โครงการ — ONE function, used by
 *  BOTH the card and the list row.
 *
 *  Why a helper and not two copies of the markup: a card and a list row of
 *  the SAME โครงการ answering differently is mistakes class 6 by
 *  construction, and this repo has paid for that shape more than once. The
 *  year comes from projectFiscalYear(), the same function the ปีงบ filter
 *  and the detail header ask, so "which year does this show" and "which
 *  year does the filter put it in" cannot drift apart.
 *
 *  Quiet by default and ORANGE when a human moved it: the routine case
 *  restates the created_at, the moved case is a fact about the row that the
 *  date does not tell you — and it stays visible even when the filter is
 *  already pinned to that year. §3e in fiscal-year.test.js is the ratchet.
 */
function fyChipHtml(p) {
  const year = projectFiscalYear(p);
  if (year == null) return '';
  // The PUBLIC mirror renders these same rows (index.js enterCustomerView →
  // renderInbox), and "ย้ายเอง" is internal bookkeeping: it answers a question
  // only the two desks have. A student gets the year, plainly.
  const moved = !customerMode && isFiscalYearMoved(p);
  const title = moved
    ? `ย้ายมาที่ปีงบ ${year} เอง (วันที่สร้างอยู่ในปีงบ ${deriveFiscalYearBE(p.created_at)})`
    : 'ปีงบประมาณตามวันที่สร้างโครงการ';
  return `<span class="projects-fy-mini${moved ? ' is-moved' : ''}" title="${escHtml(title)}"
    ><i class="bi bi-calendar3"></i>ปีงบ ${year}${moved ? ' · ย้ายเอง' : ''}</span>`;
}

// Compact one-row-per-project layout for the list view. Same data
// surface as the card; the click target wraps the whole row.
function renderProjectListRow(p) {
  const role = cache.role;
  const docs = p.documents || [];
  const total    = docs.length;
  const sent     = docs.filter((d) => d.status === 'sent').length;
  const returned = docs.filter((d) => d.status === 'returned').length;
  // Any incoming activity (comment / file op / non-status change by the
  // other side) since last seen. Excludes the status-defining action so
  // the "X ใหม่"/"X ตีกลับ" badge and the blue "X อัปเดต" badge don't
  // double-count the same event — but a comment / file op on a sent
  // หนังสือ DOES surface, because it's a separate update on top of the
  // already-badged status.
  const unseenDocs = docs.filter((d) => docHasUnseenBeyondStatusBadge(d, role)).length;
  const pendingSign = docs.filter((d) => docPendingSignForProf(d)).length;
  const bucket = projectBucket(p, role);
  const lastTouch = lastActivityTime(p);

  const badges = [];
  if ((role === 'uni_staff' || role === 'dev') && sent > 0) {
    badges.push(`<span class="projects-list-badge is-new" title="หนังสือใหม่ ยังไม่ได้รับเรื่อง">${sent} ใหม่</span>`);
  }
  if (role === 'vp_admin' && returned > 0) {
    badges.push(`<span class="projects-list-badge is-return" title="หนังสือถูกตีกลับ">${returned} ตีกลับ</span>`);
  }
  if (role === 'sa_prof' && pendingSign > 0) {
    badges.push(`<span class="projects-list-badge is-new" title="หนังสือที่รอลงนาม">${pendingSign} รอลงนาม</span>`);
  }
  if (unseenDocs > 0) {
    badges.push(`<span class="projects-list-badge is-comment" title="มีอัปเดตที่ยังไม่ได้เปิดดู">${unseenDocs} อัปเดต</span>`);
  }
  if (!isShownPublicly(p)) {
    badges.push(`<span class="projects-list-badge is-hidden" title="ไม่แสดงบนเว็บสาธารณะ"><i class="bi bi-eye-slash-fill me-1"></i>ซ่อน</span>`);
  }
  const badge = badges.join(' ');

  return `
    <button type="button" class="projects-list-row is-bucket-${bucket}" data-projects-open-project="${escHtml(p.id)}">
      <span class="projects-list-icon"><i class="bi bi-folder2-open"></i></span>
      <span class="projects-list-name-wrap">
        <span class="projects-list-name-line">
          <span class="projects-list-name">${escHtml(p.name)}</span>
          <span class="projects-list-id">${escHtml(p.id)}</span>
          ${fyChipHtml(p)}
        </span>
        ${p.description ? `<span class="projects-list-desc">${escHtml(p.description)}</span>` : ''}
      </span>
      <span class="projects-list-badge-wrap">${badge}</span>
      <span class="projects-list-count"><i class="bi bi-journal-text me-1"></i>${total}</span>
      <span class="projects-list-time">${escHtml(fmtRelative(lastTouch))}</span>
    </button>
  `;
}

function renderProjectCard(p) {
  const role = cache.role;
  const docs = p.documents || [];
  const total    = docs.length;
  const sent     = docs.filter((d) => d.status === 'sent').length;
  const returned = docs.filter((d) => d.status === 'returned').length;
  // See renderProjectListRow for the exclusion rules — same logic, just
  // a richer card layout.
  const unseenDocs = docs.filter((d) => docHasUnseenBeyondStatusBadge(d, role)).length;
  const pendingSign = docs.filter((d) => docPendingSignForProf(d)).length;
  const bucket = projectBucket(p, role);
  const lastTouch = lastActivityTime(p);

  // Stack one attention badge per signal so the user can tell at a
  // glance whether a project carries action-required work (sent /
  // returned / รอลงนาม) or just informational updates (อัปเดต).
  const parts = [];
  if ((role === 'uni_staff' || role === 'dev') && sent > 0) {
    parts.push(`<span class="projects-card-attn-badge is-new" title="หนังสือใหม่ ยังไม่ได้รับเรื่อง">
      <i class="bi bi-bell-fill"></i> ${sent} ใหม่
    </span>`);
  }
  if ((role === 'vp_admin' || role === 'dev') && returned > 0) {
    parts.push(`<span class="projects-card-attn-badge is-return" title="หนังสือถูกตีกลับ ต้องแก้ไข">
      <i class="bi bi-arrow-counterclockwise"></i> ${returned} ตีกลับ
    </span>`);
  }
  if (role === 'sa_prof' && pendingSign > 0) {
    parts.push(`<span class="projects-card-attn-badge is-new" title="หนังสือที่รอลงนาม">
      <i class="bi bi-pen-fill"></i> ${pendingSign} รอลงนาม
    </span>`);
  }
  if (unseenDocs > 0) {
    parts.push(`<span class="projects-card-attn-badge is-comment" title="มีอัปเดตที่ยังไม่ได้เปิดดู">
      <i class="bi bi-bell"></i> ${unseenDocs} อัปเดต
    </span>`);
  }
  if (!isShownPublicly(p)) {
    parts.push(`<span class="projects-card-attn-badge is-hidden" title="ไม่แสดงบนเว็บสาธารณะ">
      <i class="bi bi-eye-slash-fill"></i> ซ่อน
    </span>`);
  }
  const badge = parts.join(' ');

  return `
    <button type="button" class="projects-card-grid is-bucket-${bucket}" data-projects-open-project="${escHtml(p.id)}">
      <div class="projects-card-head">
        <span class="projects-card-icon"><i class="bi bi-folder2-open"></i></span>
        <div class="projects-card-title-wrap">
          <div class="projects-card-name">${escHtml(p.name)}</div>
          <div class="projects-card-id">${escHtml(p.id)}</div>
        </div>
        ${badge}
      </div>
      <div class="projects-card-desc">${escHtml(p.description || '')}</div>
      <div class="projects-card-foot">
        <span class="projects-card-foot-stat"><i class="bi bi-journal-text me-1"></i>${total} หนังสือ</span>
        ${fyChipHtml(p)}
        <span class="projects-card-last"><i class="bi bi-clock-history me-1"></i>${escHtml(fmtRelative(lastTouch))}</span>
      </div>
    </button>
  `;
}

// ---------- Level 2: project detail (breadcrumb + header + doc list) ----------

function renderDetail() {
  const root = document.getElementById('projectsDetailRoot');
  if (!root) return;
  const project = cache.projects.find((p) => p.id === selectedProjectId);
  if (!project) {
    root.innerHTML = `<div class="projects-empty"><i class="bi bi-folder-x"></i><h4>ไม่พบโครงการ</h4></div>`;
    return;
  }
  const docs = (project.documents || []).slice()
    .sort((a, b) => new Date(b.sent_at || b.updated_at || b.created_at) - new Date(a.sent_at || a.updated_at || a.created_at));
  const role = cache.role;
  const canManage = role === 'vp_admin' || role === 'dev';
  // Moving a โครงการ between ปีงบประมาณ is BOTH desks' job, not just the
  // sender's: the ผู้ส่งหนังสือ (vpa) sends it, and the เจ้าหน้าที่คณะ
  // (staff) is the one who knows which budget year the faculty actually
  // booked it against. This is the same audience the DB already allows —
  // `projects_update` is current_user_is_project_actor() — so the button
  // and the policy agree instead of one of them being decorative.
  const canMoveFY = role === 'vp_admin' || role === 'uni_staff' || role === 'dev';
  const projFY = projectFiscalYear(project);
  const fyMoved = isFiscalYearMoved(project);
  // Public-mirror visibility (0114). `is_public` defaults to true, so a row
  // written before the column existed reads as shown — matching what the
  // public site did before this feature.
  const projShown = isShownPublicly(project);
  const hiddenDocs = docs.filter((d) => !isShownPublicly(d)).length;

  root.innerHTML = `
    <header class="projects-detail-head">
      <div class="projects-detail-id">
        <button type="button" class="projects-detail-id-copy"
          data-copy="${escHtml(project.id)}"
          title="คลิกเพื่อคัดลอกรหัสโครงการ">
          <span class="projects-detail-id-code">${escHtml(project.id)}</span>
          <i class="bi bi-clipboard"></i>
        </button>
        <span class="text-muted"> · ${escHtml(fmtDate(project.created_at))}</span>
      </div>
      <h2 class="projects-detail-title">${escHtml(project.name)}</h2>
      ${project.description ? `<p class="projects-detail-desc">${escHtml(project.description)}</p>` : ''}
      <div class="projects-detail-meta">
        <span class="text-muted small">หนังสือทั้งหมด ${docs.length} ฉบับ</span>
        ${projFY != null ? `<span class="projects-fy-pill${fyMoved ? ' is-moved' : ''}"
          title="${fyMoved
            ? `ย้ายมาที่ปีงบ ${projFY} เอง (วันที่สร้างอยู่ในปีงบ ${deriveFiscalYearBE(project.created_at)})`
            : 'ปีงบประมาณตามวันที่สร้างโครงการ'}"><i class="bi bi-calendar3 me-1"></i>ปีงบ ${projFY}${fyMoved ? ' · ย้ายเอง' : ''}</span>` : ''}
        ${!projShown
          ? `<span class="projects-hidden-pill" title="โครงการนี้ไม่แสดงบนเว็บสาธารณะ"><i class="bi bi-eye-slash-fill me-1"></i>ซ่อนจากเว็บสาธารณะ</span>`
          : ''}
        ${projShown && hiddenDocs > 0
          ? `<span class="projects-hidden-pill is-partial" title="หนังสือบางฉบับถูกซ่อนจากเว็บสาธารณะ"><i class="bi bi-eye-slash me-1"></i>ซ่อน ${hiddenDocs} ฉบับ</span>`
          : ''}
      </div>
      ${!projShown ? `
        <div class="projects-hidden-note">
          <i class="bi bi-info-circle me-1"></i>
          ขณะนี้ทั้งโครงการและหนังสือทุกฉบับในนี้ไม่ปรากฏบนเว็บสาธารณะ —
          เจ้าหน้าที่ที่ล็อกอินยังเห็นตามปกติ
        </div>` : ''}
      <div class="projects-detail-actions">
        ${canManage ? `<button type="button" class="btn btn-sm btn-primary-soft" data-projects-add-doc="${escHtml(project.id)}">
          <i class="bi bi-plus-lg me-1"></i> เพิ่มหนังสือ
        </button>` : ''}
        ${canManage ? `<button type="button" class="btn btn-sm ${projShown ? 'btn-ghost' : 'btn-warning-soft'}"
          data-projects-toggle-public="${escHtml(project.id)}" data-next="${projShown ? '0' : '1'}"
          title="${projShown ? 'ซ่อนโครงการนี้จากเว็บสาธารณะ' : 'แสดงโครงการนี้บนเว็บสาธารณะ'}">
          <i class="bi bi-${projShown ? 'eye-slash' : 'eye'} me-1"></i> ${projShown ? 'ซ่อนจากเว็บ' : 'แสดงบนเว็บ'}
        </button>` : ''}
        ${canManage ? `<button type="button" class="btn btn-sm btn-ghost" data-projects-edit-project="${escHtml(project.id)}" title="แก้ไขชื่อ / รายละเอียดโครงการ">
          <i class="bi bi-pencil me-1"></i> แก้ไขโครงการ
        </button>` : ''}
        ${canMoveFY ? `<button type="button" class="btn btn-sm btn-ghost" data-projects-move-fy="${escHtml(project.id)}" title="ย้ายโครงการนี้ไปปีงบประมาณอื่น">
          <i class="bi bi-calendar3 me-1"></i> ย้ายปีงบ
        </button>` : ''}
        <button type="button" class="btn btn-sm btn-ghost" data-copy="${escHtml(project.id)}" title="คัดลอกรหัสโครงการ">
          <i class="bi bi-clipboard me-1"></i> คัดลอกรหัส
        </button>
        <button type="button" class="btn btn-sm btn-ghost" data-projects-copy-project="${escHtml(project.id)}" title="คัดลอกลิงก์โครงการ">
          <i class="bi bi-link-45deg me-1"></i> คัดลอกลิงก์
        </button>
        <button type="button" class="btn btn-sm btn-ghost" data-projects-qr-project="${escHtml(project.id)}" title="QR ของโฟลเดอร์ Drive โครงการนี้">
          <i class="bi bi-qr-code me-1"></i> QR โฟลเดอร์
        </button>
        ${canManage ? `
          <button type="button" class="btn btn-sm btn-ghost text-danger ms-auto"
            data-projects-delete-project="${escHtml(project.id)}"
            title="ลบโครงการนี้พร้อมหนังสือทั้งหมด">
            <i class="bi bi-trash me-1"></i> ลบโครงการ
          </button>
        ` : ''}
      </div>
    </header>

    <div class="projects-doc-list">
      ${docs.length === 0
        ? `<div class="projects-empty small"><i class="bi bi-inbox"></i><h4>ยังไม่มีหนังสือในโครงการนี้</h4>${canManage ? `<p>กด "เพิ่มหนังสือ" ด้านบนเพื่อส่งหนังสือฉบับแรก</p>` : ''}</div>`
        : docs.map((d) => renderDocCard(d, project)).join('')}
    </div>
  `;
}

function renderDocCard(doc, project) {
  const m = DOC_STATUS_META[doc.status] || DOC_STATUS_META.sent;
  const type = (cache.docTypes || []).find((t) => t.id === doc.type_id);
  const isOpen = expandedDocs.has(doc.id);
  // While expanded, use the SAME frozen pre-expand seenAt the comment
  // banner / "ใหม่" pill / is-unread row inside the body use — otherwise
  // markDocSeen (fired on the expand click) clears the head badge the
  // same render the banner appears, so the user sees the banner saying
  // "คอมเมนต์ใหม่" but no matching blue indicator on the หนังสือ head.
  const seenAtForHead = expandedDocsSeenAt.has(doc.id)
    ? expandedDocsSeenAt.get(doc.id)
    : undefined;
  // Two independent attention signals, rendered with distinct colors so
  // the user can tell at a glance which kind needs their eye:
  //   1. Action required by status — uni_staff + status=sent (ต้อง
  //      รับเรื่อง), vp_admin + status=returned (ต้องแก้ไข). Yellow pill.
  //      Persists until the user changes status.
  //   2. Informational activity from the other side BEYOND the status
  //      action that signal #1 already represents — comments, file ops,
  //      mid-flight status changes. Blue pill. Cleared by expanding the
  //      doc OR taking any action on it.
  // A new comment on a sent หนังสือ shows BOTH pills (yellow "must act"
  // + blue "and there's a comment too"), which is exactly the case the
  // user flagged as missing the blue indicator before this change.
  const needsActionRequired   = actionRequiredOn(doc, cache.role);
  const hasActivityBeyondStat = docHasUnseenBeyondStatusBadge(doc, cache.role, seenAtForHead);
  const needsAck = needsActionRequired || hasActivityBeyondStat;
  const mineDot = needsAck ? '<span class="projects-row-mine-dot" title="ต้องดำเนินการ"></span>' : '';
  const hasUpdate = needsAck;
  const statusPill = needsActionRequired
    ? (cache.role === 'sa_prof'
        ? `<span class="projects-doc-update-pill"><i class="bi bi-pen-fill me-1"></i>ต้องลงนาม</span>`
        : `<span class="projects-doc-update-pill"><i class="bi bi-bell-fill me-1"></i>อัปเดต</span>`)
    : '';
  const activityPill = hasActivityBeyondStat
    ? `<span class="projects-doc-update-pill is-comment" title="มีอัปเดต / คอมเมนต์ใหม่"><i class="bi bi-chat-left-dots-fill me-1"></i>อัปเดต</span>`
    : '';
  const updateBadge = `${statusPill}${activityPill}`;

  return `
    <article class="projects-doc-card ${isOpen ? 'is-open' : ''} ${hasUpdate ? 'has-update' : ''}" data-projects-doc-id="${escHtml(doc.id)}">
      <header class="projects-doc-card-head" data-projects-doc-toggle="${escHtml(doc.id)}">
        ${mineDot}
        <span class="projects-doc-seq-mini">#${doc.sequence_no || 1}</span>
        <div class="projects-doc-card-title-wrap">
          <div class="projects-doc-card-title">${escHtml(doc.title)}</div>
          <div class="projects-doc-card-sub">
            <span class="projects-type-pill">${escHtml(type?.label_th || doc.type_id)}</span>
            <span class="projects-cell-mono d-none d-md-inline">${escHtml(doc.id)}</span>
            ${!isShownPublicly(doc)
              ? `<span class="projects-hidden-pill" title="หนังสือฉบับนี้ไม่แสดงบนเว็บสาธารณะ"><i class="bi bi-eye-slash-fill me-1"></i>ซ่อน</span>`
              : !isShownPublicly(project)
              // Its own flag says "show", but the โครงการ above it is hidden —
              // say so on the row, or the list reads as if this one is live.
              ? `<span class="projects-hidden-pill is-partial" title="โครงการนี้ถูกซ่อน หนังสือฉบับนี้จึงไม่แสดงบนเว็บสาธารณะ"><i class="bi bi-eye-slash me-1"></i>ไม่แสดง (ทั้งโครงการถูกซ่อน)</span>`
              : ''}
          </div>
        </div>
        ${updateBadge}
        <span class="projects-status-pill ${m.cls}"><i class="bi ${m.icon} me-1"></i>${escHtml(m.label)}</span>
        <span class="projects-doc-card-time text-muted small">${escHtml(fmtRelative(doc.updated_at || doc.created_at))}</span>
        <button type="button" class="projects-doc-card-copy" aria-label="คัดลอกลิงก์หนังสือ" title="คัดลอกลิงก์หนังสือ"
          data-projects-copy-doc="${escHtml(doc.id)}" data-project-id="${escHtml(project.id)}">
          <i class="bi bi-link-45deg"></i>
        </button>
        <button type="button" class="projects-row-expand" aria-label="ขยาย/ย่อ" aria-expanded="${isOpen}">
          <i class="bi bi-chevron-${isOpen ? 'up' : 'down'}"></i>
        </button>
      </header>
      ${isOpen ? `<div class="projects-doc-card-body">${renderDocExpand(doc, project)}</div>` : ''}
    </article>
  `;
}

function renderDocExpand(doc, project) {
  const stepIndex = DOC_PATH_ORDER.indexOf(doc.status);
  const isReturned  = doc.status === 'returned';
  const isCompleted = doc.status === 'completed';
  const role = cache.role;
  const isVp  = role === 'vp_admin' || role === 'dev';
  const isUni = role === 'uni_staff' || role === 'dev';
  const isProf = role === 'sa_prof';
  // File add/replace/remove is now allowed for BOTH vp_admin and uni_staff
  // (sastaff file-op parity — RLS widened in 0050). The professor never
  // manages the doc's general files; he only uploads signed output via the
  // sign section.
  const canManageFiles = isVp || isUni;
  const tlSorted = (doc.timeline || []).slice().sort((a, b) => new Date(b.at) - new Date(a.at));
  // Freeze seenAt for the duration of the expansion — see expandedDocsSeenAt
  // declaration. Falls back to the live localStorage value if we somehow
  // got here without going through the expand handler (e.g. a renderer
  // re-runs after the Map was cleared).
  const seenAtForExpansion = expandedDocsSeenAt.has(doc.id)
    ? expandedDocsSeenAt.get(doc.id)
    : getDocSeenAt(doc.id);

  // Build a single "revert status" dropdown so completed/in-flight docs
  // can be sent back to any earlier step. Both vp_admin and uni_staff
  // can revert — staff who closed by mistake shouldn't need a dev to
  // re-open. Includes 'returned' as an off-path target so VPA can flag
  // a closed/completed หนังสือ back as needing fixes without the
  // dedicated "ส่งกลับให้แก้" button (which is only visible from
  // certain states).
  const revertTargets = [...DOC_PATH_ORDER, 'returned'].filter((s) => s !== doc.status);
  const revertMenu = (isVp || isUni) ? `
      <div class="dropdown d-inline-block">
        <button type="button" class="btn btn-sm btn-ghost dropdown-toggle"
          data-bs-toggle="dropdown" aria-expanded="false">
          <i class="bi bi-arrow-counterclockwise me-1"></i>ย้อนสถานะ
        </button>
        <ul class="dropdown-menu">
          ${revertTargets.map((s) => {
            const meta = DOC_STATUS_META[s];
            return `<li><button type="button" class="dropdown-item"
                       data-projects-doc-status="${s}" data-doc-id="${escHtml(doc.id)}" data-revert="1">
                       <i class="bi ${meta.icon} me-2"></i>${escHtml(meta.label)}
                     </button></li>`;
          }).join('')}
        </ul>
      </div>` : '';

  return `
    ${renderReturnContextBanner(doc, role)}
    ${renderRecentUpdateBanner(doc, role, seenAtForExpansion)}
    ${renderCommentBanner(doc, role, seenAtForExpansion)}

    ${renderProgressBar(stepIndex, isReturned)}

    ${doc.note ? `<div class="projects-doc-note"><i class="bi bi-chat-square-quote me-1"></i>${escHtml(doc.note)}</div>` : ''}

    <div class="projects-doc-files" data-projects-files-for="${escHtml(doc.id)}">
      <div class="projects-files-head">
        <span><i class="bi bi-paperclip me-1"></i>ไฟล์แนบ</span>
        ${canManageFiles ? `<label class="btn btn-sm btn-primary-soft">
          <i class="bi bi-cloud-upload me-1"></i>เพิ่มไฟล์
          <input type="file" hidden multiple data-projects-add-files="${escHtml(doc.id)}" />
        </label>` : ''}
      </div>
      <div class="projects-files-list" id="projectsFilesList-${escHtml(doc.id)}">
        <div class="text-muted small py-2"><span class="spinner-border spinner-border-sm me-2"></span>กำลังโหลดไฟล์…</div>
      </div>
    </div>

    <div class="projects-sign-section" data-projects-sign-for="${escHtml(doc.id)}"></div>

    ${renderCommentsList(doc, role, seenAtForExpansion)}

    <div class="projects-doc-actions">
      ${(isVp && isReturned) ? `<button type="button" class="btn btn-sm btn-primary-soft" data-projects-doc-resend data-doc-id="${escHtml(doc.id)}">
        <i class="bi bi-arrow-clockwise me-1"></i>หนังสือใหม่
      </button>` : ''}
      ${(isUni && !isCompleted) ? `
        ${doc.status === 'sent' ? `<button type="button" class="btn btn-sm btn-primary-soft" data-projects-doc-status="received" data-doc-id="${escHtml(doc.id)}"><i class="bi bi-inbox me-1"></i>รับเรื่อง</button>` : ''}
        ${(['received','sent'].includes(doc.status)) ? `<button type="button" class="btn btn-sm btn-warning-soft" data-projects-doc-status="in_progress" data-doc-id="${escHtml(doc.id)}"><i class="bi bi-arrow-repeat me-1"></i>กำลังดำเนินการ</button>` : ''}
        ${(['sent','received','in_progress','returned'].includes(doc.status)) ? `<button type="button" class="btn btn-sm btn-success-soft" data-projects-doc-status="completed" data-doc-id="${escHtml(doc.id)}"><i class="bi bi-check-circle me-1"></i>เสร็จสิ้น</button>` : ''}
        ${(['sent','received','in_progress'].includes(doc.status)) ? `<button type="button" class="btn btn-sm btn-danger-soft" data-projects-doc-return data-doc-id="${escHtml(doc.id)}"><i class="bi bi-arrow-counterclockwise me-1"></i>ส่งกลับให้แก้</button>` : ''}
      ` : ''}
      ${(isVp || isUni || isProf) ? `<button type="button" class="btn btn-sm btn-ghost" data-projects-doc-comment data-doc-id="${escHtml(doc.id)}"><i class="bi bi-chat-left-text me-1"></i>คอมเมนต์</button>` : ''}
      ${isUni ? `<button type="button" class="btn btn-sm btn-teal-soft" data-projects-send-sign data-doc-id="${escHtml(doc.id)}"><i class="bi bi-pen me-1"></i>ส่งให้อาจารย์ลงนาม</button>` : ''}
      ${revertMenu}
      ${isVp ? (() => {
        // Public-mirror visibility for this ONE หนังสือ (0114). While the
        // parent โครงการ is hidden nothing here is public whatever this says,
        // so the button explains that instead of pretending to publish.
        const docShown  = isShownPublicly(doc);
        const projShown = isShownPublicly(project);
        const title = !projShown
          ? 'โครงการนี้ถูกซ่อนอยู่ — หนังสือทุกฉบับจึงไม่แสดงบนเว็บสาธารณะ'
          : (docShown ? 'ซ่อนหนังสือฉบับนี้จากเว็บสาธารณะ' : 'แสดงหนังสือฉบับนี้บนเว็บสาธารณะ');
        return `<button type="button" class="btn btn-sm ${docShown ? 'btn-ghost' : 'btn-warning-soft'}"
          data-projects-doc-public data-doc-id="${escHtml(doc.id)}" data-next="${docShown ? '0' : '1'}"
          title="${escHtml(title)}">
          <i class="bi bi-${docShown ? 'eye-slash' : 'eye'} me-1"></i>${docShown ? 'ซ่อนจากเว็บ' : 'แสดงบนเว็บ'}
        </button>`;
      })() : ''}
      ${isVp ? `<button type="button" class="btn btn-sm btn-ghost" data-projects-doc-edit data-doc-id="${escHtml(doc.id)}" title="แก้ไขชื่อ / โน้ตหนังสือ"><i class="bi bi-pencil me-1"></i>แก้ไข</button>` : ''}
      ${isVp ? `<button type="button" class="btn btn-sm btn-ghost text-danger ms-auto" data-projects-doc-delete data-doc-id="${escHtml(doc.id)}"><i class="bi bi-trash me-1"></i>ลบ</button>` : ''}
    </div>

    ${tlSorted.length ? renderTimeline(tlSorted, doc) : ''}
  `;
}

/** Status that demands user action — distinct from the seenAt-based
 *  "unseen activity" check. Persists until the user changes status,
 *  so the loud red/orange pill on the doc card keeps screaming until
 *  it's actually addressed (clicking through doesn't clear it). */
function actionRequiredOn(doc, role) {
  if (role === 'uni_staff') return doc.status === 'sent';
  if (role === 'vp_admin')  return doc.status === 'returned';
  if (role === 'sa_prof')   return docPendingSignForProf(doc);
  if (role === 'dev')       return doc.status === 'sent' || doc.status === 'returned';
  return false;
}

// Map a timeline action to its display label / icon for the update
// banner. The banner is a chronological "since you last opened…" list,
// so we cover every incoming action class. Comments deliberately have
// their own banner (renderCommentBanner) and are excluded here.
const ACTION_LABEL = {
  sent:          'หนังสือใหม่',
  received:      'รับเรื่องแล้ว',
  in_progress:   'กำลังดำเนินการ',
  completed:     'เสร็จสิ้น',
  returned:      'ตีกลับเพื่อแก้ไข',
  file_added:    'เพิ่มไฟล์',
  file_replaced: 'แทนที่ไฟล์',
  file_deleted:  'ลบไฟล์',
  sign_accepted: 'อาจารย์ลงนาม/อนุมัติ',
  sign_rejected: 'อาจารย์ส่งกลับ',
  signed_file:   'อาจารย์ลงนามไฟล์',
};
const ACTION_ICON = {
  sent:          'bi-send',
  received:      'bi-inbox',
  in_progress:   'bi-arrow-repeat',
  completed:     'bi-check-circle',
  returned:      'bi-arrow-counterclockwise',
  file_added:    'bi-cloud-plus-fill',
  file_replaced: 'bi-arrow-repeat',
  file_deleted:  'bi-x-circle',
  sign_accepted: 'bi-patch-check',
  sign_rejected: 'bi-x-octagon',
  signed_file:   'bi-pen',
};

// ---- return / resend timeline helpers (item: persistent ส่งกลับ context) ----

/** Most-recent timestamp (ms) of a given timeline action, or 0. */
function lastActionTs(tl, action) {
  let ts = 0;
  for (const e of tl || []) {
    if (e.action === action) ts = Math.max(ts, Date.parse(e.at) || 0);
  }
  return ts;
}

/** A หนังสือ is a RESEND (vpa fixed + sent again) when its latest `sent`
 *  happened AFTER a `returned` — distinguishes it from a first-time send. */
function isResendDoc(tl) {
  const lastSent = lastActionTs(tl, 'sent');
  const lastReturned = lastActionTs(tl, 'returned');
  return lastReturned > 0 && lastSent > lastReturned;
}

/** Note of the most-recent entry for an action (skips the boilerplate
 *  'ส่งหนังสือ' that createDocument stamps on the first send). */
function latestActionNote(tl, action) {
  let best = null, ts = -1;
  for (const e of tl || []) {
    if (e.action !== action) continue;
    const t = Date.parse(e.at) || 0;
    if (t >= ts) { ts = t; best = e; }
  }
  const note = (best?.note || '').trim();
  return note === 'ส่งหนังสือ' ? '' : note;
}

/** Human summary of vpa's file ops since `sinceTs` (counts add/replace/delete
 *  operations) — consolidated into the single resend notification + banner so
 *  sastaff isn't pinged per-edit during the ส่งกลับ phase. '' when nothing. */
function summarizeFileOpsSince(tl, sinceTs) {
  let added = 0, replaced = 0, deleted = 0;
  for (const e of tl || []) {
    if ((Date.parse(e.at) || 0) <= sinceTs) continue;
    if (e.action === 'file_added') added++;
    else if (e.action === 'file_replaced') replaced++;
    else if (e.action === 'file_deleted') deleted++;
  }
  const parts = [];
  if (added)    parts.push(`เพิ่ม ${added}`);
  if (replaced) parts.push(`แทนที่ ${replaced}`);
  if (deleted)  parts.push(`ลบ ${deleted}`);
  return parts.length ? `ไฟล์ที่เปลี่ยน: ${parts.join(', ')}` : '';
}

/**
 * PERSISTENT ส่งกลับ context banner — unlike the seenAt banners below, this
 * one is keyed off STATUS, so it keeps showing until the recipient acts:
 *  - vp_admin, status=returned: the reason sastaff sent it back, shown until
 *    vpa ส่งใหม่ (status leaves returned).
 *  - uni_staff, status=sent AND this is a resend: vpa's "what I changed"
 *    summary, shown until sastaff changes status (รับเรื่อง / …).
 * The matching "ใหม่" highlight on the files vpa changed is handled in
 * loadFilesForDoc (persistIds), with the same status-based clear.
 */
function renderReturnContextBanner(doc, role) {
  const tl = doc.timeline || [];
  if ((role === 'vp_admin' || role === 'dev') && doc.status === 'returned') {
    const reason = (doc.return_reason || latestActionNote(tl, 'returned') || '').trim();
    return `
      <div class="projects-update-banner is-return projects-context-banner">
        <ul class="projects-update-list">
          <li class="projects-update-line">
            <i class="bi bi-arrow-counterclockwise"></i>
            <span class="projects-update-line-label">เจ้าหน้าที่ส่งกลับให้แก้ไข</span>
            ${reason ? `<span class="projects-update-line-note">${escHtml(reason)}</span>` : ''}
          </li>
        </ul>
      </div>`;
  }
  if ((role === 'uni_staff' || role === 'dev') && doc.status === 'sent' && isResendDoc(tl)) {
    const summary = latestActionNote(tl, 'sent');
    const fileSummary = summarizeFileOpsSince(tl, lastActionTs(tl, 'returned'));
    return `
      <div class="projects-update-banner is-update projects-context-banner">
        <ul class="projects-update-list">
          <li class="projects-update-line">
            <i class="bi bi-arrow-clockwise"></i>
            <span class="projects-update-line-label">SAMO แก้ไขและส่งใหม่</span>
            ${summary ? `<span class="projects-update-line-note">${escHtml(summary)}</span>` : ''}
          </li>
          ${fileSummary ? `<li class="projects-update-line">
            <i class="bi bi-paperclip"></i>
            <span class="projects-update-line-note">${escHtml(fileSummary)}</span>
          </li>` : ''}
        </ul>
      </div>`;
  }
  return '';
}

/**
 * "ตั้งแต่คุณเข้าครั้งล่าสุด" banner. Lists every incoming action that
 * happened after the viewer's last seenAt — sent, file ops, status
 * changes by the other side, reverts. Cleared by expanding the doc
 * (markDocSeen at expand time) or by any user action on the doc.
 *
 * Comments are deliberately excluded — they have a dedicated banner
 * (renderCommentBanner) with edit-aware re-surfacing semantics.
 *
 * Replaces the old shouldShowUpdateBanner / STATUS_CLEARING_ACTIONS
 * model, which hid file updates whenever the doc wasn't in 'sent'
 * status. uni_staff now sees a file upload by VPA regardless of
 * whether they've already received the doc.
 */
function renderRecentUpdateBanner(doc, role, seenAtOverride) {
  const tl = doc.timeline || [];
  const seenAt = seenAtOverride != null ? seenAtOverride : getDocSeenAt(doc.id);
  const wanted = INCOMING_ACTIONS[role] || new Set();
  // These are surfaced by the PERSISTENT context banner instead (and clear on
  // status change, not on view) — drop them here so they don't show twice.
  const ctxReturned = (role === 'vp_admin' || role === 'dev') && doc.status === 'returned';
  const ctxResend   = (role === 'uni_staff' || role === 'dev') && doc.status === 'sent' && isResendDoc(tl);
  const cuts = [];
  for (const e of tl) {
    if (e.role === role) continue;
    if (e.action === 'comment') continue;        // own banner
    if (ctxReturned && e.action === 'returned') continue;
    if (ctxResend   && e.action === 'sent') continue;
    if (!wanted.has(e.action)) continue;
    const ts = Math.max(
      Date.parse(e.at) || 0,
      e.edited_at ? (Date.parse(e.edited_at) || 0) : 0,
    );
    if (ts <= seenAt) continue;
    cuts.push(e);
  }
  if (cuts.length === 0) return '';

  // Visual tone: returned-into-the-viewer's-court reads as "warning"
  // (red-ish); everything else as a generic "new activity" blue.
  const hasReturnIncoming = cuts.some((e) => e.action === 'returned');
  const headerCls = hasReturnIncoming ? 'is-return' : 'is-update';
  const lines = cuts.map((e) => {
    const label = ACTION_LABEL[e.action] || e.action;
    const icon  = ACTION_ICON[e.action]  || 'bi-dot';
    // Suppress the boilerplate "ส่งหนังสือ" note that createDocument
    // stamps on the initial sent entry — it duplicates the label and
    // makes the banner read "หนังสือใหม่ ส่งหนังสือ". A real user-
    // written resend summary still shows.
    const note = (e.action === 'sent' && (e.note || '').trim() === 'ส่งหนังสือ')
      ? ''
      : (e.note || '');
    return `
      <li class="projects-update-line">
        <i class="bi ${icon}"></i>
        <span class="projects-update-line-label">${escHtml(label)}</span>
        ${note ? `<span class="projects-update-line-note">${escHtml(note)}</span>` : ''}
        <span class="projects-update-line-time">${escHtml(fmtRelative(e.at))}</span>
      </li>
    `;
  }).join('');

  return `
    <div class="projects-update-banner ${headerCls}">
      <ul class="projects-update-list">${lines}</ul>
    </div>
  `;
}

/**
 * Comment-update banner. Separate from the status banner because its
 * clear semantics are different: a new comment from the other side
 * should disappear from the top the moment the receiver OPENS the
 * หนังสือ to read it (markDocSeen()) — NOT only when status
 * changes. Matches Gmail/Linear "unread message" behaviour.
 */
function renderCommentBanner(doc, role, seenAtOverride) {
  // Customer mirror is a pure read-only view with no identity to track
  // "seen" against — every comment would otherwise read as "new" (seenAt
  // is always 0) and flash the banner. Suppress entirely. The recent-
  // update banner is already empty for 'customer' (no INCOMING_ACTIONS
  // entry), so this is the only banner that needs an explicit guard.
  if (customerMode) return '';
  const tl = doc.timeline || [];
  const seenAt = seenAtOverride != null ? seenAtOverride : getDocSeenAt(doc.id);
  // A comment is "new to me" when its creation OR last-edit timestamp
  // is after my last open. That way an edit by the sender re-surfaces
  // the comment for the reader until they reopen the หนังสือ.
  const effectiveTs = (e) => {
    const a = Date.parse(e.at) || 0;
    const b = e.edited_at ? (Date.parse(e.edited_at) || 0) : 0;
    return Math.max(a, b);
  };
  const unread = tl
    .filter((e) => e.action === 'comment' && e.role !== role && effectiveTs(e) > seenAt)
    .sort((a, b) => effectiveTs(b) - effectiveTs(a));   // newest first
  if (unread.length === 0) return '';
  const lines = unread.map((e) => {
    const wasEdited = !!e.edited_at && (Date.parse(e.edited_at) || 0) > (Date.parse(e.at) || 0);
    const label = wasEdited ? 'คอมเมนต์ถูกแก้ไข' : 'คอมเมนต์ใหม่';
    const shownAt = wasEdited ? e.edited_at : e.at;
    return `
      <li class="projects-update-line">
        <i class="bi ${wasEdited ? 'bi-pencil-square' : 'bi-chat-left-text'}"></i>
        <span class="projects-update-line-label">${escHtml(label)}</span>
        ${e.note ? `<span class="projects-update-line-note">${escHtml(e.note)}</span>` : ''}
        <span class="projects-update-line-time">${escHtml(fmtRelative(shownAt))}</span>
      </li>
    `;
  }).join('');
  return `
    <div class="projects-update-banner is-comment">
      <ul class="projects-update-list">${lines}</ul>
    </div>
  `;
}

function renderProgressBar(stepIndex, isReturned) {
  const steps = ['ส่งแล้ว', 'รับเรื่อง', 'ดำเนินการ', 'เสร็จสิ้น'];
  const wrapCls = isReturned ? 'is-returned-overlay' : '';
  const visualIdx = isReturned ? 0 : stepIndex;
  return `
    <div class="projects-progress ${wrapCls}">
      ${steps.map((label, i) => `
        <div class="projects-step ${i <= visualIdx ? 'is-done' : ''} ${i === visualIdx ? 'is-current' : ''}">
          <div class="projects-step-dot">${i < visualIdx ? '<i class="bi bi-check"></i>' : (i + 1)}</div>
          <div class="projects-step-label">${escHtml(label)}</div>
          ${i === 0 && isReturned ? '<div class="projects-step-overlay"><i class="bi bi-arrow-counterclockwise"></i> ตีกลับ</div>' : ''}
        </div>
      `).join('<div class="projects-step-bar"></div>')}
    </div>
  `;
}

// ---------- comments list (Slack/Linear-style inline thread) ----------

// ===== seenAt storage =====
//
// Source of truth is the server-side public.project_doc_views table
// (migration 0031). The map below is hydrated from that table at
// inbox load (setServerDocViews) and is the FIRST thing every
// getDocSeenAt() consults.
//
// localStorage stays as a write-through cache so:
//   - the UI doesn't wait on a round-trip after every action
//   - the inbox renders something sensible on a flaky network
//   - pre-migration environments degrade gracefully
//
// The localStorage key is now per-user — multi-account-same-device
// would otherwise share a single map across accounts. The legacy
// un-keyed key ("projects.commentsSeenAt") is read once on first
// hydrate and migrated up to the server via legacyLocalStorageMap().
const LEGACY_DOC_SEEN_KEY = 'projects.commentsSeenAt';
// Bump the suffix whenever the first-run rule changes: the OLD code set this
// sentinel even when it wrote zero rows, so anyone who had already opened the
// tab would skip the new BASELINE branch forever and keep staring at a full
// screen of "อัปเดต". A new key re-runs the (idempotent, upsert-based) pass
// exactly once more per device+user.
const BULK_MIGRATED_SENTINEL_KEY = 'projects.docViewsBulkMigrated.v2';

function userScopedKey(userId) {
  return userId ? `projects.docSeenAt.${userId}` : LEGACY_DOC_SEEN_KEY;
}

// In-memory mirror of public.project_doc_views for the current user,
// keyed by document_id. Populated by setServerDocViews().
let serverSeenAt = new Map();   // docId → ISO string

function readLocalSeenMap(userId) {
  try {
    const raw = localStorage.getItem(userScopedKey(userId));
    if (!raw) return {};
    const map = JSON.parse(raw);
    return (map && typeof map === 'object') ? map : {};
  } catch { return {}; }
}

function writeLocalSeenMap(userId, map) {
  try { localStorage.setItem(userScopedKey(userId), JSON.stringify(map)); } catch {}
}

/** Called by index.js after listMyDocViews resolves. Wipes the in-
 *  memory mirror (so account switches don't leak the previous user's
 *  state) and replaces it with the freshly-fetched rows. */
export function setServerDocViews(rows) {
  serverSeenAt = new Map();
  for (const r of (rows || [])) {
    if (r?.document_id && r?.seen_at) serverSeenAt.set(r.document_id, r.seen_at);
  }
}

/** First-run seen-state setup for a (device, user) pair. Two jobs, one
 *  bulk upsert, gated by a single sentinel in localStorage:
 *
 *  1. MIGRATE — an existing user upgrading: take whatever's in
 *     localStorage (including the legacy un-keyed map) and push it up so
 *     their other devices stop re-flagging events they already ack'd.
 *
 *  2. BASELINE — a user with NO seen history anywhere (no server rows, no
 *     local map): mark everything currently visible as seen right now, so
 *     they start caught-up instead of facing a backlog of "อัปเดต" pills
 *     for activity that predates their access. This is what a newly
 *     seat-granted person hits: seen-state is per-user, so the shared
 *     samomdkkuvpa account looks clean only because it has been reading
 *     these documents for months. Joining an inbox should not mean
 *     inheriting a year of unread.
 *
 *  The distinction matters: baselining someone who ALREADY has server
 *  rows would mark their genuinely-unread documents as read, so it is
 *  gated on serverSeenAt being completely empty. */
/** Decide which project_doc_views rows to write on a user's first run.
 *  Pure — no storage, no network — so the MIGRATE vs BASELINE rule can be
 *  tested directly. See migrateLocalSeenAtToServer for the why.
 *
 *  The upsert uses `resolution=merge-duplicates`, which OVERWRITES seen_at —
 *  so a local value older than the server's would roll the user's read state
 *  BACKWARDS and re-flag documents they had already read. Local entries are
 *  therefore only emitted when they are strictly newer than the server's.
 *  That also makes the pass safe to re-run when the sentinel key is bumped.
 *
 *  @param {object}  a
 *  @param {string}  a.userId
 *  @param {Map<string,string>} a.local    docId → ISO seenAt recovered from localStorage
 *  @param {string[]} a.knownDocIds        docs currently visible (FK must resolve)
 *  @param {Map<string,string>} [a.server] docId → ISO seenAt already on the server
 *  @param {string}  [a.now]               injectable clock
 *  @returns {{user_id:string, document_id:string, seen_at:string}[]}
 */
export function planSeenAtRows({ userId, local, knownDocIds, server = null, now = null }) {
  if (!userId) return [];
  const validIds = new Set(knownDocIds || []);
  const srv = server || new Map();
  const rows = [];
  for (const [docId, seenAt] of (local || new Map()).entries()) {
    if (validIds.size > 0 && !validIds.has(docId)) continue;
    const known = srv.get(docId);
    // Never move a seen_at backwards (merge-duplicates would overwrite).
    if (known && !(Date.parse(seenAt) > Date.parse(known))) continue;
    rows.push({ user_id: userId, document_id: docId, seen_at: seenAt });
  }
  if (rows.length > 0) return rows;                 // MIGRATE
  if (srv.size > 0) return [];                      // established reader — leave alone
  const ts = now || new Date().toISOString();       // BASELINE: joined caught-up
  return [...validIds].map((docId) => ({ user_id: userId, document_id: docId, seen_at: ts }));
}

export async function migrateLocalSeenAtToServer(userId, knownDocIds) {
  if (!userId) return;
  const sentinelKey = `${BULK_MIGRATED_SENTINEL_KEY}.${userId}`;
  try { if (localStorage.getItem(sentinelKey)) return; } catch {}

  const merged = new Map();
  // Legacy un-keyed map (everything written before this commit)
  try {
    const legacyRaw = localStorage.getItem(LEGACY_DOC_SEEN_KEY);
    if (legacyRaw) {
      const m = JSON.parse(legacyRaw);
      if (m && typeof m === 'object') {
        for (const [k, v] of Object.entries(m)) {
          if (k && typeof v === 'string') merged.set(k, v);
        }
      }
    }
  } catch {}
  // Per-user map (only present on installs that already upgraded once
  // and saved while signed in as this user)
  const scoped = readLocalSeenMap(userId);
  for (const [k, v] of Object.entries(scoped)) {
    if (!k || typeof v !== 'string') continue;
    const prev = merged.get(k);
    if (!prev || new Date(v) > new Date(prev)) merged.set(k, v);
  }

  const rows = planSeenAtRows({
    userId,
    local: merged,
    knownDocIds,
    server: serverSeenAt,
  });

  if (rows.length === 0) {
    try { localStorage.setItem(sentinelKey, '1'); } catch {}
    return false;
  }
  const { error } = await bulkUpsertMyDocViews(rows);
  if (error) return false;
  // Mirror into the in-memory map so the next render sees them
  for (const r of rows) serverSeenAt.set(r.document_id, r.seen_at);
  try { localStorage.setItem(sentinelKey, '1'); } catch {}
  // Caller re-renders: this runs AFTER the first paint, so without it a new
  // reader still sees one screenful of "อัปเดต" pills until they reload.
  return true;
}

/** Read the per-doc "last seen" timestamp. Server-synced value wins;
 *  falls back to user-scoped localStorage, then to the legacy un-keyed
 *  map for users who haven't gone through the bulk migration yet, then
 *  to 0. */
function getDocSeenAt(docId) {
  const fromServer = serverSeenAt.get(docId);
  if (fromServer) return Date.parse(fromServer) || 0;
  const user = getUser();
  const scoped = readLocalSeenMap(user?.id);
  const fromScoped = scoped[docId];
  if (fromScoped) return Date.parse(fromScoped) || 0;
  // Legacy un-keyed map — only consulted while the bulk migration
  // sentinel hasn't been set yet for this user.
  try {
    const raw = localStorage.getItem(LEGACY_DOC_SEEN_KEY);
    if (raw) {
      const map = JSON.parse(raw);
      const v = map?.[docId];
      if (v) return Date.parse(v) || 0;
    }
  } catch {}
  return 0;
}

/** Persist that the user has seen everything on this doc as of now.
 *  Three-layer write:
 *    1. serverSeenAt (in-memory) — so this render reads it back
 *    2. user-scoped localStorage — fast cache + offline resilience
 *    3. project_doc_views upsert (async, fire-and-forget) — cross-
 *       device sync. Other devices will see this seen_at on their
 *       next inbox load. */
function markDocSeen(docId) {
  if (customerMode) return;     // anonymous customer view — nothing to persist
  const now = new Date().toISOString();
  serverSeenAt.set(docId, now);
  const user = getUser();
  const map = readLocalSeenMap(user?.id);
  map[docId] = now;
  writeLocalSeenMap(user?.id, map);
  if (user?.id) {
    upsertMyDocView(user.id, docId, now).catch(() => {});
  }
}

/** Mark seen AND drop the frozen pre-expand seenAt, so highlights clear
 *  immediately on the next render instead of lingering for the reading
 *  session. Used after the professor acts (sign / accept / reject) — once
 *  he's engaged a file, its "ใหม่" / "อัปเดต" highlight should be gone. */
function markDocSeenAndClear(docId) {
  expandedDocsSeenAt.delete(docId);
  markDocSeen(docId);
}

function renderCommentsList(doc, role, seenAtOverride) {
  const comments = (doc.timeline || []).filter((e) => e.action === 'comment');
  if (comments.length === 0) return '';
  const seenAt = seenAtOverride != null ? seenAtOverride : getDocSeenAt(doc.id);
  // Sort newest-first so unread items sit at the top of the thread —
  // matches the "inbox" pattern (latest activity surfaces first) and
  // means the reader's eye lands on the unread comment without
  // scrolling.
  const ordered = comments.slice().sort((a, b) => new Date(b.at) - new Date(a.at));
  // A comment is "unread to me" if its creation OR last-edit time is
  // after my last open — so the sender editing a comment also re-
  // surfaces it as unread to the reader, until they open the
  // หนังสือ again (markDocSeen).
  const effectiveTs = (c) => Math.max(
    Date.parse(c.at) || 0,
    c.edited_at ? (Date.parse(c.edited_at) || 0) : 0,
  );
  // In the customer mirror there's no per-user seenAt, so treat every
  // comment as already-read: no "ใหม่" pills, no is-unread rows, no
  // unread count. The customer just sees the thread, not "what changed".
  const unreadCount = customerMode ? 0 : ordered.filter((c) =>
    c.role !== role && effectiveTs(c) > seenAt
  ).length;
  // <details> follows the same collapse pattern as the timeline so the
  // expanded หนังสือ stays scannable when a thread runs long. Default
  // open when there are unread comments OR the thread is short enough
  // that hiding it would just hide useful context (≤2 items).
  const openByDefault = unreadCount > 0 || comments.length <= 2;
  const user = getUser();
  const myId = user?.id || null;
  return `
    <details class="projects-comments" ${openByDefault ? 'open' : ''}>
      <summary class="projects-comments-head">
        <span class="projects-comments-title">
          <i class="bi bi-chat-square-text me-1"></i>คอมเมนต์ (${comments.length})
        </span>
        ${unreadCount > 0 ? `<span class="projects-comments-unread">${unreadCount} ใหม่</span>` : ''}
        <i class="bi bi-chevron-down projects-comments-chev" aria-hidden="true"></i>
      </summary>
      <ul class="projects-comments-list">
        ${ordered.map((c) => {
          const isUnread = !customerMode && c.role !== role && effectiveTs(c) > seenAt;
          const isMineComment = canManageComment(c, myId, role);
          const editedBadge = c.edited_at
            ? `<span class="projects-comment-edited" title="${escHtml(fmtDateTime(c.edited_at))}">แก้ไขแล้ว</span>`
            : '';
          return `
            <li class="projects-comment ${isUnread ? 'is-unread' : ''}" data-comment-at="${escHtml(c.at)}">
              <div class="projects-comment-meta">
                <span class="projects-tl-role ${escHtml(c.role || '')}">${escHtml(roleLabel(c.role))}</span>
                <span class="projects-comment-time">${escHtml(fmtRelative(c.at))}</span>
                ${editedBadge}
                ${isUnread ? '<span class="projects-comment-new-pill">ใหม่</span>' : ''}
                ${isMineComment ? `
                  <span class="projects-comment-actions">
                    <button type="button" class="projects-comment-btn" data-projects-comment-edit="${escHtml(c.at)}" data-doc-id="${escHtml(doc.id)}" aria-label="แก้ไขคอมเมนต์" title="แก้ไข">
                      <i class="bi bi-pencil"></i>
                    </button>
                    <button type="button" class="projects-comment-btn text-danger" data-projects-comment-delete="${escHtml(c.at)}" data-doc-id="${escHtml(doc.id)}" aria-label="ลบคอมเมนต์" title="ลบ">
                      <i class="bi bi-trash"></i>
                    </button>
                  </span>
                ` : ''}
              </div>
              <div class="projects-comment-body">${escHtml(c.note || '')}</div>
            </li>
          `;
        }).join('')}
      </ul>
    </details>
  `;
}

/** May this viewer edit or delete this comment?
 *
 *  `by` carries the auth user id (see the appendDocTimeline calls). The ROLE
 *  fallback is for an entry with no `by` at all — the write is
 *  `by: user?.id || null`, so a comment saved while the session was half
 *  loaded would be stranded FOREVER without it: nobody matches null. The
 *  surrounding comment used to promise that fallback while the code only had
 *  `c.by === myId`; this is the promise, implemented.
 *
 *  Deliberately `!c.by` and NOT "by does not resolve to a live account". A uid
 *  naming somebody else is not mine, and the browser cannot tell a deleted
 *  account from a stranger — that case is a data repair (migration 0166, where
 *  the shared-login purge left 298 timeline uids naming deleted accounts and
 *  42 of 43 comments lost these controls), never a UI guess.
 *
 *  Exported for comment-ownership.test.js: the rule reads as four one-line
 *  branches and every one of them was wrong at some point.
 */
export function canManageComment(comment, myId, role) {
  if (!myId) return false;              // no session → no controls at all
  if (role === 'dev') return true;
  if (comment?.by) return comment.by === myId;
  return !!comment?.role && comment.role === role;
}

function renderTimeline(tl, doc) {
  return `
    <details class="projects-doc-timeline" ${tl.length <= 2 ? 'open' : ''}>
      <summary>
        <span class="projects-doc-timeline-title">ประวัติการดำเนินการ (${tl.length})</span>
        <i class="bi bi-chevron-down projects-doc-timeline-chev" aria-hidden="true"></i>
      </summary>
      <ol>
        ${tl.map((entry) => {
          // 'sent' rows render the doc reference on a sub-line (matches
          // the banner pattern) and suppress the boilerplate
          // "ส่งหนังสือ" stored note — that string is a fallback from
          // createDocument and would duplicate the action label.
          const isSent = entry.action === 'sent';
          const docRef = isSent && doc?.sequence_no
            ? `หนังสือใหม่ #${doc.sequence_no}${doc.title ? ` "${doc.title}"` : ''}`
            : '';
          const note = (isSent && (entry.note || '').trim() === 'ส่งหนังสือ')
            ? ''
            : (entry.note || '');
          return `
            <li>
              <span class="text-muted small">${escHtml(fmtDateTime(entry.at))}</span>
              ${entry.role ? `<span class="projects-tl-role ${escHtml(entry.role)}">${escHtml(roleLabel(entry.role))}</span>` : ''}
              <span class="projects-tl-action">${escHtml(actionLabel(entry.action))}</span>
              ${docRef ? `<div class="projects-tl-note">${escHtml(docRef)}</div>` : ''}
              ${note ? `<div class="projects-tl-note">${escHtml(note)}</div>` : ''}
            </li>
          `;
        }).join('')}
      </ol>
    </details>
  `;
}

function roleLabel(r) {
  if (r === 'vp_admin')  return 'SAMO VP';
  if (r === 'uni_staff') return 'เจ้าหน้าที่';
  if (r === 'sa_prof')   return 'อาจารย์';
  if (r === 'dev')       return 'Dev';
  return r || '';
}

function actionLabel(a) {
  switch (a) {
    case 'sent':         return 'ส่งหนังสือใหม่';
    case 'received':     return 'รับเรื่อง';
    case 'in_progress':  return 'เริ่มดำเนินการ';
    case 'returned':     return 'ส่งกลับเพื่อแก้';
    case 'completed':    return 'ปิดเรื่อง';
    case 'comment':      return 'คอมเมนต์';
    case 'file_added':   return 'เพิ่มไฟล์';
    case 'file_replaced':return 'แทนที่ไฟล์';
    case 'file_deleted': return 'ลบไฟล์';
    case 'sign_accepted':return 'ลงนามแล้ว / อนุมัติ';
    case 'sign_rejected':return 'ส่งกลับเพื่อแก้ไข';
    case 'signed_file':  return 'แนบไฟล์ที่ลงนาม';
    case 'draft':        return 'บันทึกร่าง';
    default:             return a || '';
  }
}

// ---------- delegated event handlers ----------

function onInboxClick(e) {
  // Level 1: open project card
  const openCard = e.target.closest('[data-projects-open-project]');
  if (openCard) {
    selectedProjectId = openCard.dataset.projectsOpenProject;
    level = 'detail';
    history.replaceState(null, '', `#projects/${selectedProjectId}`);
    render();
    return;
  }

  // Level 2 / detail: doc toggle
  const docToggle = e.target.closest('[data-projects-doc-toggle]');
  if (docToggle && !e.target.closest('button, a, input, label, .dropdown-menu')) {
    toggleDocExpansion(docToggle.dataset.projectsDocToggle);
    render();
    return;
  }
  // (The chevron button itself bubbles here too — the if-guard above excludes
  //  it. Special-case: the .projects-row-expand button intentionally toggles.)
  const expandBtn = e.target.closest('.projects-row-expand');
  if (expandBtn) {
    const card = expandBtn.closest('[data-projects-doc-id]');
    if (card) {
      toggleDocExpansion(card.dataset.projectsDocId);
      render();
    }
    return;
  }

  // Project actions
  const addBtn = e.target.closest('[data-projects-add-doc]');
  if (addBtn) {
    const project = cache.projects.find((p) => p.id === addBtn.dataset.projectsAddDoc);
    if (project && onAddDocumentCb) onAddDocumentCb(project);
    return;
  }
  const copyProj = e.target.closest('[data-projects-copy-project]');
  if (copyProj) {
    copyToClipboard(`${window.location.origin}${window.location.pathname}#projects/${copyProj.dataset.projectsCopyProject}`, copyProj);
    return;
  }
  const qrProj = e.target.closest('[data-projects-qr-project]');
  if (qrProj) {
    const project = cache.projects.find((p) => p.id === qrProj.dataset.projectsQrProject);
    if (project) showProjectQrModal(project);
    return;
  }
  const copyDoc = e.target.closest('[data-projects-copy-doc]');
  if (copyDoc) {
    const pid = copyDoc.dataset.projectId;
    const did = copyDoc.dataset.projectsCopyDoc;
    copyToClipboard(`${window.location.origin}${window.location.pathname}#projects/${pid}/doc/${did}`, copyDoc);
    return;
  }
  const delProj = e.target.closest('[data-projects-delete-project]');
  if (delProj) {
    onDeleteProject(delProj.dataset.projectsDeleteProject);
    return;
  }
  const editProj = e.target.closest('[data-projects-edit-project]');
  if (editProj) {
    onEditProject(editProj.dataset.projectsEditProject);
    return;
  }
  const pubProj = e.target.closest('[data-projects-toggle-public]');
  if (pubProj) {
    onToggleProjectPublic(pubProj);
    return;
  }
  const moveFyProj = e.target.closest('[data-projects-move-fy]');
  if (moveFyProj) {
    onMoveProjectFiscalYear(moveFyProj.dataset.projectsMoveFy);
    return;
  }

  // Doc actions
  const statusBtn = e.target.closest('[data-projects-doc-status]');
  if (statusBtn) { onDocStatusClick(statusBtn); return; }
  const returnBtn = e.target.closest('[data-projects-doc-return]');
  if (returnBtn) { onDocReturnClick(returnBtn); return; }
  const resendBtn = e.target.closest('[data-projects-doc-resend]');
  if (resendBtn) { onDocResendClick(resendBtn); return; }
  const cmtBtn = e.target.closest('[data-projects-doc-comment]');
  if (cmtBtn) { onDocCommentClick(cmtBtn); return; }
  const delBtn = e.target.closest('[data-projects-doc-delete]');
  if (delBtn) { onDocDeleteClick(delBtn); return; }
  const editDocBtn = e.target.closest('[data-projects-doc-edit]');
  if (editDocBtn) { onDocEditClick(editDocBtn); return; }
  const pubDocBtn = e.target.closest('[data-projects-doc-public]');
  if (pubDocBtn) { onDocTogglePublicClick(pubDocBtn); return; }
  const delFileBtn = e.target.closest('[data-projects-delete-file]');
  if (delFileBtn) {
    const docId = delFileBtn.closest('[data-projects-files-for]')?.dataset.projectsFilesFor;
    onDeleteFileClick(delFileBtn, docId);
    return;
  }
  const cmtEditBtn = e.target.closest('[data-projects-comment-edit]');
  if (cmtEditBtn) { onCommentEditClick(cmtEditBtn); return; }
  const cmtDelBtn = e.target.closest('[data-projects-comment-delete]');
  if (cmtDelBtn) { onCommentDeleteClick(cmtDelBtn); return; }

  // Professor signing workflow
  const sendSign = e.target.closest('[data-projects-send-sign]');
  if (sendSign) { onSendSignClick(sendSign); return; }
  const signEsign = e.target.closest('[data-sign-esign]');
  if (signEsign) { onSignEsignClick(signEsign); return; }
  const signAccept = e.target.closest('[data-sign-accept]');
  if (signAccept) { onSignAcceptClick(signAccept); return; }
  const signReject = e.target.closest('[data-sign-reject]');
  if (signReject) { onSignRejectClick(signReject); return; }
  const signCancel = e.target.closest('[data-sign-cancel]');
  if (signCancel) { onSignCancelClick(signCancel); return; }
}

function onInboxChange(e) {
  const addFiles = e.target.closest('[data-projects-add-files]');
  if (addFiles) { onDocAddFiles(e, addFiles.dataset.projectsAddFiles); return; }
  const replace = e.target.closest('[data-replace-for-file]');
  if (replace) {
    const docId = replace.closest('[data-projects-files-for]')?.dataset.projectsFilesFor;
    onReplaceFile(e, replace.dataset.replaceForFile, docId);
    return;
  }
  const signReup = e.target.closest('[data-sign-reupload]');
  if (signReup) { onSignReupload(e); return; }
}

// ---------- project actions ----------

/** Move a โครงการ to another ปีงบประมาณ.
 *
 *  WHY THIS EXISTS. The ปีงบ is derived from `created_at`, and that is right
 *  almost always and wrong exactly when it matters: a ผู้ส่งหนังสือ sends a
 *  โครงการ in ก.ย. 2569 and the faculty books it against ปีงบ 2570. The
 *  office's answer is the one people search by, so a human has to be able to
 *  say it.
 *
 *  Setting it back to "ตามวันที่สร้าง" writes NULL, not the derived number —
 *  a stored copy of an expression stops tracking that expression forever
 *  (0128), so "no opinion" has to stay expressible.
 */
async function onMoveProjectFiscalYear(projectId) {
  const p = cache.projects.find((x) => x.id === projectId);
  if (!p) return;
  const derived = deriveFiscalYearBE(p.created_at);
  const current = projectFiscalYear(p);
  const options = [
    { value: 'auto', label: `ตามวันที่สร้าง (อัตโนมัติ)${derived != null ? ` — ปีงบ ${derived}` : ''}` },
    ...moveTargetYears(p, cache.projects).map((y) => ({ value: y, label: `ปีงบ ${y}` })),
  ];
  const res = await openProjectPrompt({
    title: 'ย้ายปีงบประมาณ',
    hideText: true,
    selectLabel: `ย้าย "${p.name || projectId}" ไปที่`,
    selectOptions: options,
    selectInitial: isFiscalYearMoved(p) ? String(current) : 'auto',
    hint: 'ใช้เมื่อหนังสือถูกส่งในปีงบหนึ่ง แต่คณะลงเป็นอีกปีงบหนึ่ง — มีผลกับตัวกรองปีงบและการค้นหา',
    okLabel: 'ย้าย',
  });
  const picked = res && typeof res === 'object' ? res.select : null;
  if (!picked) return;
  const next = picked === 'auto' ? null : Number(picked);
  // Compare against what is STORED, not against what is displayed: picking
  // the year the date already implies is a real change when an override is
  // currently pinning the project somewhere else.
  const stored = Number.isFinite(Number(p.fiscal_year_be)) ? Number(p.fiscal_year_be) : null;
  if (next === stored) return;
  try {
    await updateProject(projectId, { fiscal_year_be: next });
    // If the viewer is filtered to a year the project just left, it would
    // vanish from under them with no explanation when they go back. Follow it.
    //
    // Follow the year the project ENDS UP IN, not the value written. Clearing
    // the override writes NULL, and the first version of this line skipped the
    // follow whenever `next == null` — so picking "ตามวันที่สร้าง" on a project
    // whose date implies a DIFFERENT year did exactly the disappearing act the
    // line exists to prevent. The stored value and the resulting year are two
    // different questions.
    //
    // Asked through projectFiscalYear(), the SAME function the grid filter
    // uses, so "where will it show up" and "where does the filter put it"
    // cannot answer differently — a second local derivation here is how the
    // two would drift.
    const resulting = projectFiscalYear({ ...p, fiscal_year_be: next });
    if (filterFY !== 'all' && resulting != null && String(resulting) !== filterFY) {
      filterFY = String(resulting);
    }
    onChanged();
  } catch (e) {
    window.alert(e?.message || 'ย้ายปีงบประมาณไม่สำเร็จ');
  }
}

async function onEditProject(projectId) {
  const p = cache.projects.find((x) => x.id === projectId);
  if (!p) return;
  // Sequence: name first (mandatory), then description (optional).
  // Cancelling the name prompt abandons the whole flow; cancelling
  // the description prompt keeps the prior description.
  const newName = await openProjectPrompt({
    title: 'แก้ไขชื่อโครงการ',
    label: 'ชื่อโครงการ',
    placeholder: 'เช่น โครงการสานสัมพันธ์น้องพี่',
    initial: p.name || '',
    okLabel: 'ถัดไป',
    required: true,
  });
  if (newName == null) return;
  const newDesc = await openProjectPrompt({
    title: 'แก้ไขรายละเอียดโครงการ',
    label: 'รายละเอียด (ปล่อยว่างได้)',
    placeholder: 'สรุปสั้นๆ ว่าโครงการเกี่ยวกับอะไร',
    initial: p.description || '',
    okLabel: 'บันทึก',
  });
  // newDesc null = user cancelled the desc step; treat as "keep old".
  const description = newDesc == null ? (p.description || '') : newDesc;
  const noChange = newName === (p.name || '') && description === (p.description || '');
  if (noChange) return;
  const nameChanged = newName !== (p.name || '');
  try {
    await updateProject(projectId, { name: newName, description: description || null });
    onChanged();
    // Push the rename through to Drive — fire-and-forget so a Drive
    // hiccup doesn't block the UI. GAS finds the existing folder by
    // PRJ-code and renames it to the new desiredName from the path;
    // creates the folder if it didn't exist yet (cheap, harmless).
    // No-op when only the description changed.
    if (nameChanged) {
      const newPath = buildProjectFolderPath(projectId, newName);
      getProjectFolderInfo(newPath).catch((err) =>
        console.warn('[projects] Drive project rename failed:', newPath, err?.message || err));
    }
  } catch (e) {
    alert(e.message || 'แก้ไขโครงการไม่สำเร็จ');
  }
}

/** Show / hide one โครงการ on the public /projects-view mirror (0114).
 *  Hiding takes every หนังสือ and file under it off the public site too, so
 *  it asks first; showing is the reversal and does not. */
async function onToggleProjectPublic(btn) {
  const projectId = btn.dataset.projectsTogglePublic;
  const next = btn.dataset.next === '1';
  const p = cache.projects.find((x) => x.id === projectId);
  if (!p) return;
  if (!next) {
    const docCount = (p.documents || []).length;
    const ok = await openProjectConfirm({
      title: 'ซ่อนโครงการนี้จากเว็บสาธารณะ?',
      body: `"${p.name}" และหนังสือทั้งหมด ${docCount} ฉบับในโครงการนี้จะไม่ปรากฏบนเว็บสาธารณะ `
          + 'เจ้าหน้าที่ที่ล็อกอินยังเห็นและทำงานได้ตามปกติ — เปิดกลับได้ทุกเมื่อ',
      okLabel: 'ซ่อนจากเว็บ',
    });
    if (!ok) return;
  }
  btn.disabled = true;
  try {
    await updateProject(projectId, { is_public: next });
    onChanged();
  } catch (e) {
    alert(e.message || 'เปลี่ยนการแสดงผลไม่สำเร็จ');
  } finally {
    btn.disabled = false;
  }
}

/** Show / hide ONE หนังสือ. No confirm — it is one row, instantly reversible,
 *  and the button label already says which direction it goes. */
async function onDocTogglePublicClick(btn) {
  const docId = btn.dataset.docId;
  const next  = btn.dataset.next === '1';
  const found = findDocById(docId);
  if (!found) return;
  btn.disabled = true;
  try {
    await updateDocument(docId, { is_public: next });
    onChanged();
  } catch (e) {
    alert(e.message || 'เปลี่ยนการแสดงผลไม่สำเร็จ');
  } finally {
    btn.disabled = false;
  }
}

async function onDeleteProject(projectId) {
  const p = cache.projects.find((x) => x.id === projectId);
  if (!p) return;
  const ok = await openProjectConfirm({
    title: 'ลบโครงการ?',
    body: `โครงการ "${p.name}" และหนังสือทั้งหมดในนี้จะถูกลบ การกระทำนี้ย้อนกลับไม่ได้`,
    okLabel: 'ลบโครงการ',
  });
  if (!ok) return;
  // Snapshot the Drive folders BEFORE the DB row is gone — once we
  // delete, we lose `doc.drive_folder`. Use a Set to dedupe. The
  // project's parent folder is included so we trash everything in one
  // GAS call (cascades inside Drive).
  const driveFolders = new Set();
  driveFolders.add(buildProjectFolderPath(p.id, p.name));
  for (const d of (p.documents || [])) {
    if (d.drive_folder) driveFolders.add(d.drive_folder);
  }
  try {
    await deleteProject(projectId);
    if (selectedProjectId === projectId) {
      selectedProjectId = null;
      level = 'grid';
      history.replaceState(null, '', '#projects');
    }
    onChanged();
    // Fire-and-forget Drive cleanup. The DB row is the source of
    // truth; if Drive fails we log and let the 30-day Trash auto-
    // purge handle it. Don't await — the user shouldn't wait for
    // Drive when the row is already gone.
    driveFolders.forEach((path) => {
      deleteProjectFolder(path).catch((e) =>
        console.warn('[projects] Drive folder trash failed:', path, e?.message || e));
    });
  } catch (e) { alert(e.message || 'ลบไม่สำเร็จ'); }
}

// ---------- doc actions ----------

function findDocById(docId) {
  for (const p of cache.projects) {
    const d = (p.documents || []).find((x) => x.id === docId);
    if (d) return { doc: d, project: p };
  }
  return null;
}

async function onDocStatusClick(btn) {
  const docId = btn.dataset.docId;
  const next  = btn.dataset.projectsDocStatus;
  const isRevert = btn.dataset.revert === '1';
  const found = findDocById(docId);
  if (!found) return;
  const { project, doc: docCached } = found;
  const user = getUser();
  const role = cache.role;
  // If vpa is leaving the ส่งกลับ phase via the revert menu (not the dedicated
  // ส่งใหม่ button), fold the consolidated file-change summary into the
  // notification so the held-back changes aren't silently dropped.
  const leavingReturned = docCached?.status === 'returned' && next !== 'returned';
  const exitFileSummary = leavingReturned
    ? summarizeFileOpsSince(docCached.timeline, lastActionTs(docCached.timeline, 'returned'))
    : '';
  // Reverts get an explicit "ย้อนสถานะ" prefix so the timeline doesn't
  // read like a normal forward action — important when an in-flight
  // หนังสือ is rolled back from completed/in_progress to an earlier step.
  const baseNote = ({
    sent:        'ส่งหนังสือ',
    received:    'รับเรื่องแล้ว',
    in_progress: 'เริ่มดำเนินการ',
    completed:   'เสร็จสิ้น — ปิดเรื่อง',
    returned:    'ส่งกลับเพื่อแก้',
  })[next] || `เปลี่ยนสถานะเป็น ${next}`;
  const note = isRevert ? `ย้อนสถานะกลับเป็น "${baseNote}"` : baseNote;
  // Closing a หนังสือ whose signing request was APPROVED but never got a signed
  // file is how the three ICEM / HYROX / ประดับช่อ หนังสือ shipped: อนุมัติแล้ว
  // at 03:02, closed เสร็จสิ้น at 07:42, nobody told. This is the last gate
  // before the หนังสือ leaves the workflow, so it is the right place to ask.
  if (next === 'completed' && !isRevert) {
    const accepted = (docCached?.sign_requests || []).filter((r) => r.status === 'accepted');
    if (accepted.length > 0) {
      let unsigned = [];
      try {
        const files = await listFiles(docId, { includeSuperseded: false });
        const signedReqIds = new Set(files.filter((f) => f.is_signed)
          .map((f) => String(f.sign_request_id)));
        unsigned = accepted.filter((r) => !signedReqIds.has(String(r.id)));
      } catch { unsigned = []; }   // a failed lookup must not invent a warning
      if (unsigned.length > 0) {
        const ok = await openProjectConfirm({
          title: 'ปิดเรื่องทั้งที่ยังไม่มีไฟล์ลงนาม?',
          body: 'อาจารย์อนุมัติหนังสือนี้แล้ว แต่ยังไม่มีไฟล์ที่ลงนามแนบอยู่ในระบบ '
              + 'หากปิดเรื่องตอนนี้ หนังสือจะเสร็จสิ้นโดยไม่มีฉบับลงนาม',
          okLabel: 'ปิดเรื่อง',
          okVariant: 'warning',
        });
        if (!ok) return;
      }
    }
  }
  const patch = { status: next };
  // Stamp received_at on the forward path only; on revert we leave the
  // historical timestamps alone so the audit trail in `timeline` is the
  // single source of truth for "when did this happen".
  if (next === 'received'  && !isRevert) patch.received_at  = new Date().toISOString();
  if (next === 'completed' && !isRevert) patch.completed_at = new Date().toISOString();
  // Reverting OFF completed clears the closed-at stamp.
  if (isRevert && next !== 'completed') patch.completed_at = null;
  // Reverting INTO returned should also clear any stale completed_at.
  if (next === 'returned') patch.completed_at = null;
  try {
    await appendDocTimeline(docId, {
      by: user?.id || null,
      role,
      action: next,
      note,
    }, patch);
    const doc = await getDocument(docId).catch(() => null);
    const docRef = doc
      ? `(หนังสือ #${doc.sequence_no || ''} "${doc.title || ''}")`
      : '';
    // Acting on the doc = "I've seen what's there". Clears the "อัปเดต"
    // pill on the next render even if the viewer never explicitly
    // expanded the card. Re-render IMMEDIATELY so the status flips in
    // the UI without waiting on the notify fan-out — Discord is
    // serialised + spaced ~6s (see notify.js queueDiscord), so awaiting
    // it here made every status/comment click feel sluggish.
    markDocSeen(docId);
    onChanged();
    // Notify is best-effort and out-of-band — fire-and-forget.
    if (role === 'uni_staff') {
      notifyVpAdmin({
        kind: next === 'completed' ? 'completed' : 'status',
        project, document: doc,
        body: `${note} ${docRef}`.trim(),
      }).catch(() => {});
    } else if (role === 'vp_admin' && (isRevert || leavingReturned)) {
      notifyUniStaff({
        kind: 'status',
        project, document: doc,
        body: `SAMO ${note} ${docRef}`.trim() + (exitFileSummary ? `\n${exitFileSummary}` : ''),
        subject: `[MDKKU SAMO] อัปเดตสถานะหนังสือ — ${project.name}`,
      }).catch(() => {});
    }
  } catch (e) { alert(e.message || 'อัปเดตสถานะไม่สำเร็จ'); }
}

async function onDocReturnClick(btn) {
  const docId = btn.dataset.docId;
  const found = findDocById(docId);
  if (!found) return;
  const { project, doc: docCached } = found;
  const reason = await openProjectPrompt({
    title: 'ส่งกลับให้ SAMO แก้ไข',
    label: 'เหตุผลที่ส่งกลับ',
    placeholder: 'อธิบายสั้นๆ ว่าต้องการให้แก้ส่วนใด',
    okLabel: 'ส่งกลับ',
    required: true,
  });
  if (!reason) return;
  const user = getUser();
  try {
    await appendDocTimeline(docId, {
      by: user?.id || null,
      role: cache.role,
      action: 'returned',
      note: reason,
    }, { status: 'returned', return_reason: reason });
    const doc = await getDocument(docId).catch(() => null);
    const docRef = `#${docCached.sequence_no || ''} "${docCached.title || ''}"`;
    markDocSeen(docId);
    onChanged();
    notifyVpAdmin({
      kind: 'returned',
      project, document: doc,
      body: `ส่งกลับเพื่อแก้ไข ${docRef}: ${reason}`,
      title: `ส่งกลับ — ${doc?.title || ''}`,
    }).catch(() => {});
  } catch (e) { alert(e.message || 'ส่งกลับไม่สำเร็จ'); }
}

async function onDocResendClick(btn) {
  const docId = btn.dataset.docId;
  const found = findDocById(docId);
  if (!found) return;
  const { project, doc: docCached } = found;
  const summary = await openProjectPrompt({
    title: 'หนังสือใหม่ (หลังแก้ไข)',
    label: 'สรุปสิ่งที่แก้ไข / เปลี่ยนแปลง',
    placeholder: 'แจ้งเจ้าหน้าที่ว่าแก้ส่วนใดไปบ้าง',
    okLabel: 'ส่งใหม่',
  });
  if (summary === null) return;   // cancelled
  const note = summary || 'ส่งใหม่หลังตีกลับ (ไม่ได้ระบุการเปลี่ยนแปลง)';
  const user = getUser();
  // Consolidate every file change vpa made during the ส่งกลับ phase (which
  // were intentionally NOT notified one-by-one — see fanFileOp) into this
  // single ส่งใหม่ notification so sastaff learns of them all at once.
  const fileSummary = summarizeFileOpsSince(
    docCached.timeline, lastActionTs(docCached.timeline, 'returned'));
  try {
    await appendDocTimeline(docId, {
      by: user?.id || null,
      role: cache.role,
      action: 'sent',
      note,
    }, { status: 'sent', return_reason: null });
    const doc = await getDocument(docId).catch(() => null);
    const docRef = `#${docCached.sequence_no || ''} "${docCached.title || ''}"`;
    markDocSeen(docId);
    onChanged();
    notifyUniStaff({
      kind: 'resent',
      project, document: doc,
      body: `หนังสือใหม่ ${docRef}: ${note}${fileSummary ? `\n${fileSummary}` : ''}`,
      subject: `[MDKKU SAMO] หนังสือใหม่ — ${project.name}`,
    }).catch(() => {});
  } catch (e) { alert(e.message || 'ส่งใหม่ไม่สำเร็จ'); }
}

/** Seats a comment from `role` could be addressed to, given whether the
 *  professor is on this หนังสือ. Drives the "แจ้งเตือนถึง" picker. */
function commentTargetSeats(role, docCached) {
  const seats = [];
  if (role !== 'vp_admin') seats.push({ value: 'vp_admin',  label: 'SAMO VP' });
  if (role !== 'uni_staff') seats.push({ value: 'uni_staff', label: 'เจ้าหน้าที่' });
  if (role !== 'sa_prof' && docHasSignRequest(docCached)) seats.push({ value: 'sa_prof', label: 'อาจารย์' });
  if (role === 'sa_prof') {
    // prof can only ever reach the two internal seats (already added above).
  }
  return seats;
}

async function onDocCommentClick(btn) {
  const docId = btn.dataset.docId;
  const found = findDocById(docId);
  if (!found) return;
  const { project, doc: docCached } = found;
  const seats = commentTargetSeats(cache.role, docCached);
  // Default = notify everyone ("ทุกคน"); the user can narrow to one seat.
  const selectOptions = seats.length > 1
    ? [{ value: 'all', label: 'ทุกคน' }, ...seats]
    : null;
  const res = await openProjectPrompt({
    title: 'คอมเมนต์',
    label: 'ข้อความคอมเมนต์',
    placeholder: 'พิมพ์คอมเมนต์ / โน้ตเพิ่มเติม',
    okLabel: 'ส่งคอมเมนต์',
    required: true,
    selectLabel: 'แจ้งเตือนถึง',
    selectOptions,
    selectInitial: 'all',
  });
  if (!res) return;
  const text = selectOptions ? (res.text || '').trim() : res;
  const notify = selectOptions ? (res.select || 'all') : 'all';
  if (!text) return;
  const user = getUser();
  try {
    await appendDocTimeline(docId, {
      by: user?.id || null,
      role: cache.role,
      action: 'comment',
      note: text,
      notify,   // 'all' | seat role — who the author chose to ping
    });
    const doc = await getDocument(docId).catch(() => null);
    const docRef = `หนังสือ #${docCached.sequence_no || ''} "${docCached.title || ''}"`;
    const body = `${docRef}\nคอมเมนต์ใหม่: ${text}`;
    // The author has obviously "seen" their own comment.
    markDocSeen(docId);
    onChanged();
    fanComment({ role: cache.role, project, document: doc, body, docCached, notify });
  } catch (e) { alert(e.message || 'บันทึกคอมเมนต์ไม่สำเร็จ'); }
}

/** Fan a comment out to the OTHER project seats, honouring the author's
 *  "แจ้งเตือนถึง" choice (`notify`: 'all' or a single seat role). Fire-and-
 *  forget. The professor is included only when the doc was shown to him. */
function fanComment({ role, project, document, body, docCached, notify = 'all' }) {
  const tasks = [];
  const subj = `[MDKKU SAMO] คอมเมนต์ใหม่ — ${project?.name || ''}`;
  const profSubj = `[MDKKU SAMO] คอมเมนต์จากอาจารย์ — ${project?.name || ''}`;
  const title = `คอมเมนต์ใหม่ — ${document?.title || ''}`;
  const want = (seat) => notify === 'all' || notify === seat;
  const profOnDoc = role !== 'sa_prof' && docHasSignRequest(docCached);

  if (want('vp_admin') && role !== 'vp_admin') {
    tasks.push(notifyVpAdmin({ kind: 'comment', project, document, body,
      title: role === 'sa_prof' ? `คอมเมนต์จากอาจารย์ — ${document?.title || ''}` : title }));
  }
  if (want('uni_staff') && role !== 'uni_staff') {
    tasks.push(notifyUniStaff({ kind: 'comment', project, document, body,
      subject: role === 'sa_prof' ? profSubj : subj }));
  }
  if (want('sa_prof') && profOnDoc) {
    tasks.push(notifyProf({ kind: 'comment', project, document, body, subject: subj }));
  }
  Promise.allSettled(tasks);
}

// ---------- comment edit / delete (own-comment only) ----------

async function onCommentEditClick(btn) {
  const docId = btn.dataset.docId;
  const at = btn.dataset.projectsCommentEdit;
  const found = findDocById(docId);
  if (!found) return;
  const { doc, project } = found;
  const entry = (doc.timeline || []).find((e) => e.action === 'comment' && e.at === at);
  if (!entry) return;
  const user = getUser();
  if (!user) return;
  // Author guard, with dev override. The corresponding UI guard hides
  // the button, but a stale render could still race so we re-check.
  if (entry.by !== user.id && user.role !== 'dev') return;
  const next = await openProjectPrompt({
    title: 'แก้ไขคอมเมนต์',
    label: 'ข้อความใหม่',
    placeholder: 'พิมพ์ข้อความใหม่',
    initial: entry.note || '',
    okLabel: 'บันทึก',
    required: true,
  });
  if (next == null || next === (entry.note || '').trim()) return;
  // Build the patched timeline; everything else on the doc stays put.
  const newTimeline = (doc.timeline || []).map((e) =>
    (e.action === 'comment' && e.at === at)
      ? { ...e, note: next, edited_at: new Date().toISOString() }
      : e
  );
  try {
    await updateDocument(docId, { timeline: newTimeline });
    // Notify the other side that the comment changed so the bell +
    // the inline comment-banner re-surface it. Renders identically
    // to a "new comment" — same kind, same body shape — and the
    // comment row carries an edited_at that the unread tracker uses
    // to re-light the highlight until the receiver opens the doc.
    const docRef = `หนังสือ #${doc.sequence_no || ''} "${doc.title || ''}"`;
    const body = `${docRef}\nคอมเมนต์ถูกแก้ไข: ${next}`;
    // Author has obviously "seen" their own edit.
    markDocSeen(docId);
    onChanged();
    fanComment({ role: cache.role, project, document: doc, body, docCached: doc, notify: entry.notify || 'all' });
  } catch (err) {
    alert(err.message || 'แก้ไขคอมเมนต์ไม่สำเร็จ');
  }
}

async function onCommentDeleteClick(btn) {
  const docId = btn.dataset.docId;
  const at = btn.dataset.projectsCommentDelete;
  const found = findDocById(docId);
  if (!found) return;
  const { doc } = found;
  const entry = (doc.timeline || []).find((e) => e.action === 'comment' && e.at === at);
  if (!entry) return;
  const user = getUser();
  if (!user) return;
  if (entry.by !== user.id && user.role !== 'dev') return;
  const ok = await openProjectConfirm({
    title: 'ลบคอมเมนต์?',
    body: 'คอมเมนต์นี้จะถูกลบออกจากประวัติของหนังสือ การกระทำนี้ย้อนกลับไม่ได้',
    okLabel: 'ลบ',
  });
  if (!ok) return;
  const newTimeline = (doc.timeline || []).filter((e) =>
    !(e.action === 'comment' && e.at === at)
  );
  try {
    await updateDocument(docId, { timeline: newTimeline });
    markDocSeen(docId);
    onChanged();
  } catch (err) {
    alert(err.message || 'ลบคอมเมนต์ไม่สำเร็จ');
  }
}

async function onDocEditClick(btn) {
  const docId = btn.dataset.docId;
  const found = findDocById(docId);
  if (!found) return;
  const { doc } = found;
  const newTitle = await openProjectPrompt({
    title: 'แก้ไขชื่อหนังสือ',
    label: 'ชื่อหนังสือ',
    placeholder: 'เช่น ขออนุมัติงบโครงการ ครั้งที่ 1',
    initial: doc.title || '',
    okLabel: 'ถัดไป',
    required: true,
  });
  if (newTitle == null) return;
  const newNote = await openProjectPrompt({
    title: 'แก้ไขโน้ตหนังสือ',
    label: 'โน้ตถึงผู้รับ (ปล่อยว่างได้)',
    placeholder: 'ข้อความสั้นๆ เพิ่มเติม',
    initial: doc.note || '',
    okLabel: 'บันทึก',
  });
  const note = newNote == null ? (doc.note || '') : newNote;
  const noChange = newTitle === (doc.title || '') && note === (doc.note || '');
  if (noChange) return;
  const titleChanged = newTitle !== (doc.title || '');
  try {
    await updateDocument(docId, { title: newTitle, note: note || null });
    onChanged();
    // Same self-healing rename as project edit, but at the doc level.
    // GAS walks Projects/<project>/<doc>, finds the doc folder by
    // DOC-code, and renames it to match the new title. Fire-and-forget.
    if (titleChanged) {
      const newPath = buildDocFolderPath(found.project.id, found.project.name, docId, newTitle);
      getProjectFolderInfo(newPath).catch((err) =>
        console.warn('[projects] Drive doc rename failed:', newPath, err?.message || err));
    }
  } catch (e) {
    alert(e.message || 'แก้ไขหนังสือไม่สำเร็จ');
  }
}

async function onDocDeleteClick(btn) {
  const docId = btn.dataset.docId;
  const ok = await openProjectConfirm({
    title: 'ลบหนังสือฉบับนี้?',
    body: 'หนังสือและไฟล์แนบทั้งหมดจะถูกลบ การกระทำนี้ย้อนกลับไม่ได้',
    okLabel: 'ลบ',
  });
  if (!ok) return;
  // Snapshot doc's drive folder BEFORE the row is deleted. Recompute
  // from the CURRENT title rather than trusting doc.drive_folder — GAS
  // resolves by code (DOC-XXXXX) so a rename in the app since the
  // stored path was written still resolves to the actual folder.
  const found = findDocById(docId);
  const driveFolder = found
    ? buildDocFolderPath(found.project.id, found.project.name, docId, found.doc.title)
    : null;
  try {
    await deleteDocument(docId);
    expandedDocs.delete(docId);
    expandedDocsSeenAt.delete(docId);
    onChanged();
    if (driveFolder) {
      // Fire-and-forget — Drive Trash is reversible for 30 days, and
      // the DB row is already gone so the user shouldn't see an error.
      deleteProjectFolder(driveFolder).catch((e) =>
        console.warn('[projects] Drive folder trash failed:', driveFolder, e?.message || e));
    }
  } catch (e) { alert(e.message || 'ลบไม่สำเร็จ'); }
}

/** Whether a หนังสือ has been shown to the professor (any sign request
 *  exists for it). Used to decide whether file ops also ping the prof. */
function docHasSignRequest(doc) {
  return Array.isArray(doc?.sign_requests) && doc.sign_requests.length > 0;
}

/** Fan a file add/replace/remove out to the OTHER internal seat — so
 *  vp_admin and uni_staff each learn of the other's file ops (the original
 *  notify was one-way vpa→sastaff) — PLUS the professor when the หนังสือ
 *  has been shown to him for signing. Fire-and-forget: never awaited on a
 *  click's render path (mistakes.md — serialised side-channels block the
 *  re-render). */
function fanFileOp({ role, project, document, kind, body, subject, title }) {
  const tasks = [];
  // EXCEPTION: while a หนังสือ is in the ส่งกลับ phase (status=returned, vpa
  // is fixing), DON'T ping sastaff on each vpa file edit — those changes are
  // consolidated into the single ส่งใหม่ notification (onDocResendClick). In
  // any other status (sent/received/in_progress) sastaff IS notified per edit
  // so they don't miss a mid-flight file change. The reverse direction
  // (sastaff→vpa) and the prof are unaffected.
  const batchingToUni = (role === 'vp_admin' || role === 'dev') && document?.status === 'returned';
  if ((role === 'vp_admin' || role === 'dev') && !batchingToUni) {
    tasks.push(notifyUniStaff({ kind, project, document, body, subject }));
  }
  if (role === 'uni_staff' || role === 'dev') {
    tasks.push(notifyVpAdmin({ kind, project, document, body, title }));
  }
  if (docHasSignRequest(document)) {
    tasks.push(notifyProf({ kind, project, document, body, subject }));
  }
  return Promise.allSettled(tasks);
}

async function onDocAddFiles(e, docId) {
  const input = e.target;
  const files = Array.from(input.files || []);
  if (files.length === 0) return;
  const found = findDocById(docId);
  if (!found) return;
  const { doc, project } = found;
  // Always recompute the path from the CURRENT names so a rename in
  // the app since the last upload self-heals on Drive (GAS finds the
  // folder by PRJ-/DOC- code regardless of the slug). doc.drive_folder
  // stays around for backwards compatibility but is no longer used as
  // a source of truth.
  const folder = buildDocFolderPath(project.id, project.name, doc.id, doc.title);
  const user = getUser();
  try {
    showFilesBusy(docId, 'กำลังอัปโหลด…');
    for (const f of files) {
      const uploaded = await uploadProjectFile(f, folder);
      await createFileOrUndo({
        document_id: docId,
        file_name: f.name,
        drive_file_id: uploaded.fileId,
        drive_view_url: uploaded.url,
        mime_type: uploaded.mimeType,
        size_bytes: uploaded.sizeBytes,
        uploaded_by: user?.id || null,
      }, uploaded.url);
    }
    await appendDocTimeline(docId, {
      by: user?.id || null,
      role: cache.role,
      action: 'file_added',
      note: `เพิ่มไฟล์ ${files.length} ไฟล์`,
    });
    markDocSeen(docId);
    onChanged();
    fanFileOp({
      role: cache.role, project, document: doc,
      kind: 'file_added',
      body: `เพิ่มไฟล์ใหม่ ${files.length} ไฟล์ในหนังสือ "${doc.title}"`,
      subject: `[MDKKU SAMO] ไฟล์ใหม่ใน ${project.name}`,
      title: `ไฟล์ใหม่ — ${doc.title || ''}`,
    }).catch(() => {});
  } catch (err) {
    alert(err.message || 'อัปโหลดไม่สำเร็จ');
  } finally {
    input.value = '';
  }
}

async function onDeleteFileClick(btn, docId) {
  if (!docId) return;
  const fileId   = btn.dataset.projectsDeleteFile;
  const fileName = btn.dataset.fileName || 'ไฟล์นี้';
  const fileUrl  = btn.dataset.fileUrl  || '';
  const ok = await openProjectConfirm({
    title: 'ลบไฟล์แนบ?',
    body: `ลบไฟล์ "${fileName}" ออกจากหนังสือฉบับนี้? การกระทำนี้ย้อนกลับไม่ได้ (ไฟล์ใน Drive จะถูกย้ายไปถังขยะ)`,
    okLabel: 'ลบไฟล์',
  });
  if (!ok) return;
  const user = getUser();
  try {
    showFilesBusy(docId, 'กำลังลบไฟล์…');
    await deleteFile(fileId);
    // Best-effort Drive trash; the DB row is the source of truth so a
    // Drive failure shouldn't block the UI.
    if (fileUrl) {
      deleteProjectFile(fileUrl).catch((e) =>
        console.warn('[projects] Drive file trash failed:', fileUrl, e?.message || e));
    }
    await appendDocTimeline(docId, {
      by: user?.id || null,
      role: cache.role,
      action: 'file_deleted',
      note: `ลบไฟล์ "${fileName}"`,
    });
    markDocSeen(docId);
    onChanged();
    const found = findDocById(docId);
    if (found) {
      fanFileOp({
        role: cache.role, project: found.project, document: found.doc,
        kind: 'file_deleted',
        body: `ลบไฟล์ "${fileName}" ออกจากหนังสือ "${found.doc.title}"`,
        subject: `[MDKKU SAMO] ลบไฟล์ — ${found.project.name}`,
        title: `ลบไฟล์ — ${found.doc.title || ''}`,
      }).catch(() => {});
    }
  } catch (err) {
    alert(err.message || 'ลบไฟล์ไม่สำเร็จ');
    // Refresh the file list to clear the busy state.
    loadFilesForDoc(docId);
  }
}

async function onReplaceFile(e, oldFileId, docId) {
  const input = e.target;
  const f = input.files?.[0];
  if (!f) return;
  const found = findDocById(docId);
  if (!found) return;
  const { doc, project } = found;
  // Same rationale as onDocAddFiles — recompute from current names so
  // GAS resolves the folder by code and self-heals after a rename.
  const folder = buildDocFolderPath(project.id, project.name, doc.id, doc.title);
  const user = getUser();
  // Snapshot the old file's Drive URL + filename BEFORE deleting the
  // DB row so we can trash it in Drive afterwards and write a useful
  // timeline note ("แทนที่ X → Y"). The DB row carries both fields,
  // and once gone we'd have to dig through Drive folder listings.
  let oldFileUrl = '';
  let oldFileName = '';
  try {
    const existing = await listFiles(docId, { includeSuperseded: false });
    const old = existing.find((x) => x.id === oldFileId);
    if (old) {
      oldFileUrl  = old.drive_view_url || '';
      oldFileName = old.file_name || '';
    }
  } catch {}
  try {
    showFilesBusy(docId, 'กำลังแทนที่ไฟล์…');
    const uploaded = await uploadProjectFile(f, folder);
    await createFileOrUndo({
      document_id: docId,
      file_name: f.name,
      drive_file_id: uploaded.fileId,
      drive_view_url: uploaded.url,
      mime_type: uploaded.mimeType,
      size_bytes: uploaded.sizeBytes,
      uploaded_by: user?.id || null,
    }, uploaded.url);
    // Replace = drop the old version entirely. The supersede/version-
    // history pattern looked nice but the UX cost (extra row, "v2"
    // label, "เวอร์ชันก่อนหน้า" disclosure) outweighed the audit
    // benefit for this app. Drive Trash keeps a 30-day undo window.
    await deleteFile(oldFileId).catch((err) =>
      console.warn('[projects] old file DB delete failed:', err?.message || err));
    if (oldFileUrl) {
      deleteProjectFile(oldFileUrl).catch((err) =>
        console.warn('[projects] old Drive file trash failed:', oldFileUrl, err?.message || err));
    }
    await appendDocTimeline(docId, {
      by: user?.id || null,
      role: cache.role,
      action: 'file_replaced',
      note: oldFileName
        ? `แทนที่ "${oldFileName}" → "${f.name}"`
        : `แทนที่ไฟล์เป็น "${f.name}"`,
    });
    markDocSeen(docId);
    onChanged();
    fanFileOp({
      role: cache.role, project, document: doc,
      kind: 'file_replaced',
      body: `แทนที่ไฟล์ในหนังสือ "${doc.title}" — ไฟล์ใหม่: ${f.name}`,
      subject: `[MDKKU SAMO] แทนที่ไฟล์ — ${project.name}`,
      title: `แทนที่ไฟล์ — ${doc.title || ''}`,
    }).catch(() => {});
  } catch (err) {
    alert(err.message || 'แทนที่ไฟล์ไม่สำเร็จ');
  } finally {
    input.value = '';
  }
}

// ---------- files (lazy load per expanded doc) ----------

async function loadFilesForDoc(docId) {
  const wrap = document.getElementById(`projectsFilesList-${docId}`);
  if (!wrap) return;
  try {
    // Replace now deletes the old row outright (no superseded_by), so
    // we only fetch active rows. Any legacy superseded rows from
    // before that change are intentionally hidden — they're dead UI.
    let files = await listFiles(docId, { includeSuperseded: false });
    const role = cache.role;
    const canManage = role === 'vp_admin' || role === 'uni_staff' || role === 'dev';
    // Files are world-readable (0032), so the professor's listFiles returns
    // the whole หนังสือ — including the private docx drafts. Scope HIS view
    // to only the files he was asked to sign (+ his own signed uploads),
    // mirroring the doc-level scoping in index.js scopeProjectsForRole.
    if (role === 'sa_prof') {
      // Every request on this หนังสือ, not just ones naming this uid (0095) —
      // but still only the REQUESTED + SIGNED files, never the private drafts.
      const reqs = (findDocById(docId)?.doc?.sign_requests || []);
      const allowed = new Set();
      reqs.forEach((r) => (r.file_ids || []).forEach((id) => allowed.add(String(id))));
      const reqIds = new Set(reqs.map((r) => String(r.id)));
      files = files.filter((f) =>
        allowed.has(String(f.id)) || (f.is_signed && reqIds.has(String(f.sign_request_id))));
    }
    // Files use the LAST STATUS-CLEARING ACTION timestamp, not the
    // seenAt marker. Reason: opening the หนังสือ to look should NOT
    // make the "ใหม่" pill on an attachment disappear — the user
    // hasn't committed to acting on the doc yet. Once they actually
    // click รับเรื่อง / ส่งกลับ / ดำเนินการ / completed, the file
    // pill clears too (lastActed bumps past file.uploaded_at).
    const doc = findDocById(docId)?.doc;
    const requests = doc?.sign_requests || [];
    const myId = getUser()?.id || null;
    // Freeze the pre-expand seenAt (same pattern as the doc body) so file
    // "ใหม่" pills persist while the user is reading and clear next open.
    const seenAtForFiles = expandedDocsSeenAt.has(docId)
      ? expandedDocsSeenAt.get(docId)
      : getDocSeenAt(docId);

    // PERSISTENT highlight set: when a returned หนังสือ has been ส่งใหม่,
    // the files vpa added/replaced during the fix stay flagged "ใหม่" for
    // sastaff until they change status (the user-requested exception to the
    // clear-on-view rule). Keyed off status, so รับเรื่อง clears it.
    const persistIds = new Set();
    if ((role === 'uni_staff' || role === 'dev') && doc?.status === 'sent'
        && isResendDoc(doc.timeline)) {
      const sinceTs = lastActionTs(doc.timeline, 'returned');
      files.forEach((f) => {
        if (f.is_signed) return;
        if (f.uploaded_by && f.uploaded_by === myId) return;
        if ((new Date(f.uploaded_at).getTime() || 0) > sinceTs) persistIds.add(String(f.id));
      });
    }

    // UNIFIED file list: each ORIGINAL file carries its own signing status
    // chip + its signed version nested right beneath it, so the reader never
    // has to cross-reference a separate "การลงนาม" section to learn what's
    // been signed.
    const originals = files.filter((f) => !f.is_signed);
    const signedFiles = files.filter((f) => f.is_signed);
    // Most-relevant request covering an original file (prefer pending, else
    // the most recent).
    const requestForFile = (fid) => {
      const reqs = requests.filter((r) => (r.file_ids || []).map(String).includes(String(fid)));
      if (reqs.length === 0) return null;
      reqs.sort((a, b) =>
        (a.status === 'pending' ? 0 : 1) - (b.status === 'pending' ? 0 : 1)
        || new Date(b.requested_at || b.created_at) - new Date(a.requested_at || a.created_at));
      return reqs[0];
    };
    // Signed outputs linked to a specific original (e-sign sets signs_file_id).
    const signedFor = (fid) => signedFiles.filter((s) => String(s.signs_file_id) === String(fid));

    if (originals.length === 0) {
      wrap.innerHTML = '<div class="text-muted small py-2">ยังไม่มีไฟล์แนบ</div>';
    } else {
      wrap.innerHTML = originals.map((f) => renderFileCard(f, {
        canManage,
        role,
        docId,
        myId,
        seenAt: seenAtForFiles,
        persistIds,
        request: requestForFile(f.id),
        signedVersions: signedFor(f.id),
      })).join('');
    }
    // Request-level bar: the sastaff note, the prof's accept/reject decision,
    // reject reason, reupload, actor cancel, and any signed uploads NOT tied
    // to a specific original (reupload path → signs_file_id null).
    renderSignSection(docId, files, seenAtForFiles);
  } catch (e) {
    wrap.innerHTML = `<div class="text-danger small py-2">โหลดไฟล์ไม่สำเร็จ: ${escHtml(e.message || e)}</div>`;
  }
}

/** Returns 'new' | null — whether the viewer should see a "ใหม่" pill on
 *  this file. A file is "new" to the viewer when SOMEONE ELSE uploaded it
 *  after the viewer last opened the หนังสือ. Two rules the user asked for:
 *    - never flag a file I uploaded myself (so sastaff's own upload isn't
 *      stuck "ใหม่" — only the other side sees it), and
 *    - clear on VIEW (seenAt), so opening the หนังสือ removes the pill. */
function fileNewnessForViewer(file, seenAt, myId, persistIds = null) {
  if (customerMode || !myId) return null;       // no identity → no "new" concept
  if (file.uploaded_by && file.uploaded_by === myId) return null;  // my own upload
  // Persistent highlight: files vpa changed during the ส่งกลับ phase stay
  // flagged for sastaff until they change status (NOT cleared by view).
  if (persistIds && persistIds.has(String(file.id))) return 'new';
  const uploaded = new Date(file.uploaded_at).getTime();
  if (isNaN(uploaded)) return null;
  return uploaded > (seenAt || 0) ? 'new' : null;
}

/** Unified attached-file card: the file itself, its inline signing-status
 *  chip, the professor's e-sign button (when a pending request covers it),
 *  the actor replace/delete controls, and any signed version(s) nested right
 *  beneath. Merges what used to be two cross-referenced sections (ไฟล์แนบ +
 *  การลงนาม) into one. */
function renderFileCard(f, { canManage, role, docId, myId, seenAt, persistIds, request, signedVersions }) {
  const ext = (f.file_name || '').split('.').pop()?.toLowerCase();
  const icon = iconForExt(ext);
  const isProf = role === 'sa_prof';
  // The prof can sign AND keep editing the signed file after อนุมัติ — so
  // sign/reupload stay available while pending OR accepted (not rejected).
  const canSign = isProf && request && (request.status === 'pending' || request.status === 'accepted');
  const hasSigned = signedVersions.length > 0;

  const newness = fileNewnessForViewer(f, seenAt, myId, persistIds);
  const newnessCls   = newness ? `is-${newness}` : '';
  const newnessBadge = newness === 'new'
    ? `<span class="projects-file-newness-pill is-new"><i class="bi bi-stars me-1"></i>ใหม่</span>`
    : '';

  // Signing-status chip ON the file (no cross-reference needed). A file that
  // has a signed version reads "ลงนามแล้ว" regardless of request status.
  let chip = '';
  if (hasSigned) {
    chip = `<span class="projects-file-sign-chip is-signed"><i class="bi bi-patch-check-fill me-1"></i>ลงนามแล้ว</span>`;
  } else if (request) {
    if (request.status === 'pending')       chip = `<span class="projects-file-sign-chip is-pending"><i class="bi bi-hourglass-split me-1"></i>รอลงนาม</span>`;
    // Accepted with NO signed version is the case that shipped three หนังสือ
    // reading "อนุมัติแล้ว" with a green tick over an unsigned PDF. Say the
    // missing half out loud — this chip is the only place a reader sees it.
    else if (request.status === 'accepted') chip = `<span class="projects-file-sign-chip is-unsigned"><i class="bi bi-exclamation-triangle me-1"></i>อนุมัติแล้ว · ยังไม่มีไฟล์ลงนาม</span>`;
    else if (request.status === 'rejected') chip = `<span class="projects-file-sign-chip is-rejected"><i class="bi bi-x-octagon me-1"></i>ตีกลับ</span>`;
  }

  // Prof sign controls, inline on the file. e-sign for PDFs; reupload (a
  // device-signed file) for anything. Both REPLACE the file's existing signed
  // version. Label flips to "แก้ไข" once a signed version already exists.
  const signLabel = hasSigned ? 'ลงนามใหม่' : 'ลงนาม';
  const reupLabel = hasSigned ? 'เปลี่ยนไฟล์ที่เซ็น' : 'อัปโหลดไฟล์ที่เซ็น';
  const profBtns = canSign ? `
      ${isPdfFile(f) ? `<button type="button" class="btn btn-sm btn-teal-soft" data-sign-esign data-sign-req="${escHtml(request.id)}" data-sign-file="${escHtml(f.id)}" data-doc-id="${escHtml(docId)}"><i class="bi bi-pen me-1"></i>${signLabel}</button>` : ''}
      <label class="btn btn-sm btn-primary-soft mb-0">
        <i class="bi bi-cloud-upload me-1"></i><span class="d-none d-md-inline">${reupLabel}</span>
        <input type="file" hidden data-sign-reupload="${escHtml(request.id)}" data-sign-file="${escHtml(f.id)}" data-doc-id="${escHtml(docId)}" />
      </label>` : '';

  const manageBtns = canManage ? `<label class="btn btn-sm btn-ghost">
        <i class="bi bi-arrow-repeat"></i><span class="d-none d-md-inline ms-1">แทนที่</span>
        <input type="file" hidden data-replace-for-file="${f.id}" />
      </label>
      <button type="button" class="btn btn-sm btn-ghost text-danger"
        data-projects-delete-file="${escHtml(f.id)}"
        data-file-name="${escHtml(f.file_name || '')}"
        data-file-url="${safeUrl(f.drive_view_url || '')}"
        aria-label="ลบไฟล์" title="ลบไฟล์">
        <i class="bi bi-trash"></i><span class="d-none d-md-inline ms-1">ลบ</span>
      </button>` : '';

  const signedRows = signedVersions.map((s) => {
    const sNew = fileNewnessForViewer(s, seenAt, myId);
    return `
    <div class="projects-file-signed-row">
      <i class="bi bi-patch-check-fill text-success"></i>
      <span class="projects-file-signed-label">ฉบับลงนาม</span>
      <a href="${safeUrl(s.drive_view_url)}" target="_blank" rel="noopener" class="projects-file-signed-name text-truncate">${escHtml(s.file_name)}</a>
      ${sNew ? `<span class="projects-file-newness-pill is-new"><i class="bi bi-stars me-1"></i>ใหม่</span>` : ''}
      <span class="projects-file-signed-meta">${escHtml(fmtDateTime(s.uploaded_at))}</span>
    </div>`;
  }).join('');

  return `
    <div class="projects-file-block ${hasSigned ? 'has-signed' : ''}">
      <div class="projects-file ${newnessCls}">
        <i class="bi ${icon} projects-file-icon"></i>
        <div class="projects-file-info">
          <div class="projects-file-name-row">
            <a href="${safeUrl(f.drive_view_url)}" target="_blank" rel="noopener" class="projects-file-name">${escHtml(f.file_name)}</a>
            ${newnessBadge}${chip}
          </div>
          <div class="projects-file-meta">
            <span>${escHtml(fmtBytes(f.size_bytes))}</span>
            <span>·</span>
            <span>${escHtml(fmtDateTime(f.uploaded_at))}</span>
          </div>
        </div>
        ${profBtns}
        ${manageBtns}
      </div>
      ${signedRows ? `<div class="projects-file-signed">${signedRows}</div>` : ''}
    </div>
  `;
}

function iconForExt(ext) {
  if (['pdf'].includes(ext)) return 'bi-file-earmark-pdf';
  if (['doc','docx'].includes(ext)) return 'bi-file-earmark-word';
  if (['xls','xlsx','csv'].includes(ext)) return 'bi-file-earmark-spreadsheet';
  if (['ppt','pptx'].includes(ext)) return 'bi-file-earmark-slides';
  if (['png','jpg','jpeg','webp','gif'].includes(ext)) return 'bi-file-earmark-image';
  if (['zip','rar','7z'].includes(ext)) return 'bi-file-earmark-zip';
  return 'bi-file-earmark';
}

function showFilesBusy(docId, msg) {
  const wrap = document.getElementById(`projectsFilesList-${docId}`);
  if (wrap) wrap.innerHTML = `<div class="text-muted small py-2"><span class="spinner-border spinner-border-sm me-2"></span>${escHtml(msg)}</div>`;
}

// ---------- professor signing (sastaff → saprof) ----------

function isPdfFile(f) {
  const ext = (f.file_name || '').split('.').pop()?.toLowerCase();
  return ext === 'pdf' || /pdf/i.test(f.mime_type || '');
}

/** Render the "การลงนามของอาจารย์" section inside an expanded หนังสือ. Called
 *  from loadFilesForDoc with the freshly-fetched file rows so request file
 *  names + signed outputs resolve to real files. For actors it's a
 *  read-only progress view; for the professor (pending requests) it carries
 *  the e-sign / reupload / accept / reject actions. */
function renderSignSection(docId, files, seenAt = 0) {
  const wrap = document.querySelector(`[data-projects-sign-for="${cssEsc(docId)}"]`);
  if (!wrap) return;
  const doc = findDocById(docId)?.doc;
  const requests = (doc?.sign_requests || []).slice().sort((a, b) =>
    new Date(b.requested_at || b.created_at) - new Date(a.requested_at || a.created_at));
  if (requests.length === 0) { wrap.innerHTML = ''; return; }

  const role = cache.role;
  const isProf = role === 'sa_prof';
  const canCancel = role === 'uni_staff' || role === 'dev';

  // "New update since I last opened" — drives the collapse default + the
  // "ใหม่" indicator, mirroring the comments thread. Frozen seenAt (passed
  // in) keeps it stable while reading and clears on next open.
  const myId = getUser()?.id || null;
  const signedFiles = files.filter((f) => f.is_signed);
  const tsAfter = (v) => v && (Date.parse(v) || 0) > seenAt;
  const hasUnseen = !customerMode && (
    requests.some((r) => {
      // a decision (prof accept/reject) the actor hasn't seen yet
      if (role !== 'sa_prof' && tsAfter(r.decided_at)) return true;
      // a freshly-arrived pending request the prof hasn't seen yet
      if (role === 'sa_prof' && r.status === 'pending'
          && tsAfter(r.requested_at || r.created_at) && r.requested_by !== myId) return true;
      // any request-scoped event after seenAt authored by someone else
      return (r.timeline || []).some((e) => tsAfter(e.at) && e.by !== myId);
    })
    || signedFiles.some((f) => (new Date(f.uploaded_at).getTime() || 0) > seenAt && f.uploaded_by !== myId)
  );
  const openByDefault = hasUnseen || requests.length <= 1;

  // The per-file signing status + signed versions now live INLINE in the file
  // list (renderFileCard). This bar only carries the REQUEST-level bits: the
  // sastaff note, the prof's accept/reject decision, the reject reason, the
  // reupload action, the actor cancel, and any signed uploads that aren't tied
  // to a specific original (reupload path → signs_file_id null).
  const cards = requests.map((r) => {
    const meta = SIGN_STATUS_META[r.status] || SIGN_STATUS_META.pending;
    const pending = r.status === 'pending';
    const looseSigned = files.filter((f) =>
      f.is_signed && String(f.sign_request_id) === String(r.id) && !f.signs_file_id);
    const nFiles = (r.file_ids || []).length;
    return `
      <div class="projects-sign-card ${meta.cls}">
        <div class="projects-sign-card-head">
          <span class="projects-sign-status ${meta.cls}"><i class="bi ${meta.icon} me-1"></i>${escHtml(meta.label)}</span>
          <span class="text-muted small ms-2">${nFiles} ไฟล์ · ${escHtml(fmtDateTime(r.requested_at || r.created_at))}</span>
        </div>
        ${r.note ? `<div class="projects-sign-note"><i class="bi bi-chat-square-quote me-1"></i>${escHtml(r.note)}</div>` : ''}
        ${looseSigned.length ? `
          <div class="projects-sign-files signed">
            <div class="projects-sign-files-label">ไฟล์ที่ลงนาม (อัปโหลด)</div>
            ${looseSigned.map((f) => `
              <div class="projects-sign-file">
                <i class="bi bi-patch-check-fill text-success me-1"></i>
                <a href="${safeUrl(f.drive_view_url)}" target="_blank" rel="noopener" class="text-truncate">${escHtml(f.file_name)}</a>
              </div>`).join('')}
          </div>` : ''}
        ${r.status === 'rejected' && r.reject_reason
          ? `<div class="projects-sign-reject"><i class="bi bi-exclamation-triangle me-1"></i>เหตุผลที่ส่งกลับ: ${escHtml(r.reject_reason)}</div>` : ''}
        ${(isProf && pending) ? `
          <div class="projects-sign-actions">
            <span class="text-muted small me-1">ลงนามรายไฟล์ด้านบน แล้วกด</span>
            <button type="button" class="btn btn-sm btn-success-soft" data-sign-accept data-sign-req="${escHtml(r.id)}" data-doc-id="${escHtml(docId)}"><i class="bi bi-check-circle me-1"></i>ยอมรับ (อนุมัติ)</button>
            <button type="button" class="btn btn-sm btn-danger-soft" data-sign-reject data-sign-req="${escHtml(r.id)}" data-doc-id="${escHtml(docId)}"><i class="bi bi-x-circle me-1"></i>ปฏิเสธ</button>
          </div>` : ''}
        ${(canCancel && pending) ? `
          <div class="projects-sign-actions">
            <button type="button" class="btn btn-sm btn-ghost text-danger" data-sign-cancel data-sign-req="${escHtml(r.id)}" data-doc-id="${escHtml(docId)}"><i class="bi bi-x-lg me-1"></i>ยกเลิกคำขอ</button>
          </div>` : ''}
      </div>`;
  });

  wrap.innerHTML = `
    <details class="projects-sign-collapse" ${openByDefault ? 'open' : ''}>
      <summary class="projects-sign-collapse-head">
        <span class="projects-sign-collapse-title"><i class="bi bi-pen me-1"></i>สถานะการลงนาม (${requests.length})</span>
        ${hasUnseen ? '<span class="projects-sign-collapse-new">ใหม่</span>' : ''}
        <i class="bi bi-chevron-down projects-sign-collapse-chev" aria-hidden="true"></i>
      </summary>
      <div class="projects-sign-collapse-body">${cards.join('')}</div>
    </details>`;
}

function onSendSignClick(btn) {
  const found = findDocById(btn.dataset.docId);
  if (!found || !onSendToProfCb) return;
  onSendToProfCb({ doc: found.doc, project: found.project });
}

/** Upload one signed file (esign Blob or reuploaded File) and record it as
 *  an is_signed project_files row tagged to the request. `signsFileId` links
 *  the signed output to the ORIGINAL file it signs (e-sign knows it; reupload
 *  leaves it null → shown at request level). */
/** Record an already-uploaded Drive file as a project_files row, and UNDO the
 *  Drive upload if the row is refused.
 *
 *  Drive is always written BEFORE the row, so without this a refused row leaves
 *  a PDF in Drive — shared ANYONE_WITH_LINK — that no screen in this app can
 *  see. That is what 0181 produced: three signed หนังสือ whose files sat in
 *  Drive for six days while every screen said ยังไม่ลงนาม, and the only way
 *  anyone found them was opening Drive by hand.
 *
 *  ONE HOME for the rule: all three upload paths (attach, replace, sign) go
 *  through it, because the hazard is in the ORDER, which they all share. */
async function createFileOrUndo(row, driveUrl) {
  try {
    return await createFile(row);
  } catch (err) {
    if (driveUrl) {
      await deleteProjectFile(driveUrl)
        .catch((e) => console.warn('[projects] orphan Drive cleanup failed:', e?.message || e));
    }
    throw err;
  }
}

async function uploadSignedFile({ doc, project, reqId, fileLike, user, signsFileId = null }) {
  const folder = buildDocFolderPath(project.id, project.name, doc.id, doc.title);
  const up = await uploadProjectFile(fileLike, folder);
  return createFileOrUndo({
    document_id: doc.id,
    file_name: fileLike.name,
    drive_file_id: up.fileId,
    drive_view_url: up.url,
    mime_type: up.mimeType,
    size_bytes: up.sizeBytes,
    uploaded_by: user?.id || null,
    sign_request_id: reqId,
    is_signed: true,
    signs_file_id: signsFileId,
  }, up.url);
}

/** Retire the PREVIOUS signed output(s) for one original file — this is what
 *  gives e-sign / reupload REPLACE semantics (re-signing edits rather than
 *  piling up duplicates). The prof may delete his own signed files (0053).
 *
 *  ⚠️ CALL THIS AFTER THE NEW FILE IS SAVED, NEVER BEFORE. Until 0181 both
 *  callers ran it first, so a re-sign deleted the existing signature — the row
 *  AND its Drive object — and a refused upload then left the หนังสือ with no
 *  signature at all. `exceptId` is the row uploadSignedFile just created: it
 *  carries the same signs_file_id, so without excluding it this would delete
 *  the replacement it was called to make room for.
 */
async function removeExistingSignedFor(docId, originalId, { exceptId = null } = {}) {
  if (!originalId) return 0;
  let removed = 0;
  try {
    const files = await listFiles(docId, { includeSuperseded: false });
    const existing = files.filter((s) => s.is_signed
      && String(s.signs_file_id) === String(originalId)
      && (exceptId == null || String(s.id) !== String(exceptId)));
    for (const s of existing) {
      // Count only what was actually retired. `removed` decides whether the log
      // line reads "ลงนามใหม่ (แทนที่ฉบับเดิม)", so incrementing on a FAILED
      // delete writes a history entry claiming a replacement that did not
      // happen — and the leftover row is still on screen contradicting it.
      const gone = await deleteFile(s.id).then(() => true).catch((err) => {
        console.warn('[projects] old signed delete failed:', err?.message || err);
        return false;
      });
      if (!gone) continue;
      if (s.drive_view_url) deleteProjectFile(s.drive_view_url).catch(() => {});
      removed++;
    }
  } catch (err) {
    console.warn('[projects] removeExistingSignedFor failed:', err?.message || err);
  }
  return removed;   // >0 → this was a re-sign / change (replaced a prior signed file)
}

/** Append a doc-level "ประวัติการดำเนินการ" log entry for a professor signing
 *  action — what หนังสือ (this doc), which original file, the produced signed
 *  file, the method, and whether it replaced an earlier signature. The doc
 *  timeline renders the date/time (fmtDateTime), so the log is timestamped. */
async function logSignToDoc({ doc, originalName, signedName, method, replaced }) {
  const user = getUser();
  const docRef = `หนังสือ #${doc.sequence_no || ''} "${doc.title || ''}"`.trim();
  const verb = replaced ? 'ลงนามใหม่ (แทนที่ฉบับเดิม)' : 'ลงนามไฟล์';
  const orig = originalName ? ` "${originalName}"` : '';
  const out  = signedName ? ` → "${signedName}"` : '';
  // Note: what หนังสือ, what file, the produced signed file, and the method.
  // The doc-timeline renderer stamps the date/time, so this is the full log.
  const note = `${docRef} — ${verb}${orig}${out} [${method}]`.replace(/ +/g, ' ').trim();
  await appendDocTimeline(doc.id, {
    by: user?.id || null, role: 'sa_prof', action: 'signed_file', note,
  }).catch((err) => console.warn('[projects] signed_file doc-timeline failed:', err?.message || err));
}

async function onSignEsignClick(btn) {
  const reqId = btn.dataset.signReq;
  const fileId = btn.dataset.signFile;
  const docId = btn.dataset.docId;
  const found = findDocById(docId);
  if (!found) return;
  const { doc, project } = found;
  let fileRow;
  try {
    const files = await listFiles(docId, { includeSuperseded: false });
    fileRow = files.find((f) => String(f.id) === String(fileId));
  } catch {}
  if (!fileRow || !fileRow.drive_file_id) { alert('ไม่พบไฟล์ต้นฉบับสำหรับลงนาม'); return; }
  const user = getUser();
  try {
    // signPdf opens the e-sign modal (loads bytes via GAS, lets the prof
    // draw + place a signature, embeds it with pdf-lib). Resolves to a
    // signed PDF Blob, or null if cancelled. Lazy-imported so the heavy
    // pdf.js + pdf-lib chunk only loads when the prof actually signs.
    const { signPdf } = await import('./esign.js');
    const signedBlob = await signPdf({ driveFileId: fileRow.drive_file_id, fileName: fileRow.file_name });
    if (!signedBlob) return;  // cancelled
    const base = (fileRow.file_name || 'document.pdf').replace(/\.pdf$/i, '');
    const signedName = `${base} (ลงนาม).pdf`;
    showFilesBusy(docId, 'กำลังบันทึกไฟล์ที่ลงนาม…');
    const signedFile = new File([signedBlob], signedName, { type: 'application/pdf' });
    // Save the new signature FIRST, retire the old one only once it has landed.
    const saved = await uploadSignedFile({ doc, project, reqId, fileLike: signedFile, user, signsFileId: fileRow.id });
    const replaced = await removeExistingSignedFor(docId, fileRow.id, { exceptId: saved?.id });
    await appendSignTimeline(reqId, {
      by: user?.id || null, role: 'sa_prof', action: 'signed_file',
      note: `ลงนามไฟล์ "${fileRow.file_name}" (e-sign)`,
    }).catch((err) => console.warn('[projects] sign-request timeline failed:', err?.message || err));
    // Timestamped doc-level log: which file the prof signed + the output.
    await logSignToDoc({ doc, originalName: fileRow.file_name, signedName, method: 'e-sign', replaced: replaced > 0 });
    markDocSeenAndClear(docId);
    onChanged();
  } catch (err) {
    alert(err.message || 'ลงนามไม่สำเร็จ');
    loadFilesForDoc(docId);
  }
}

async function onSignReupload(e) {
  const input = e.target;
  const reqId = input.dataset.signReupload;
  const fileId = input.dataset.signFile;   // the original this signs
  const docId = input.dataset.docId;
  const f = input.files?.[0];
  if (!f) { input.value = ''; return; }
  const found = findDocById(docId);
  if (!found) { input.value = ''; return; }
  const { doc, project } = found;
  const user = getUser();
  // Resolve the original file name (best-effort) so the log says which file
  // this signed upload covers.
  let originalName = '';
  if (fileId) {
    try {
      const files = await listFiles(docId, { includeSuperseded: false });
      originalName = files.find((x) => String(x.id) === String(fileId))?.file_name || '';
    } catch {}
  }
  try {
    showFilesBusy(docId, 'กำลังอัปโหลดไฟล์ที่ลงนาม…');
    // Save the new signature FIRST, retire the old one only once it has landed.
    const saved = await uploadSignedFile({ doc, project, reqId, fileLike: f, user, signsFileId: fileId ? Number(fileId) : null });
    const replaced = await removeExistingSignedFor(docId, fileId, { exceptId: saved?.id });
    await appendSignTimeline(reqId, {
      by: user?.id || null, role: 'sa_prof', action: 'signed_file',
      note: `อัปโหลดไฟล์ที่ลงนาม "${f.name}"`,
    }).catch((err) => console.warn('[projects] sign-request timeline failed:', err?.message || err));
    // Timestamped doc-level log: the original signed + the uploaded file.
    await logSignToDoc({ doc, originalName, signedName: f.name, method: 'อัปโหลด', replaced: replaced > 0 });
    markDocSeenAndClear(docId);
    onChanged();
  } catch (err) {
    alert(err.message || 'อัปโหลดไม่สำเร็จ');
    loadFilesForDoc(docId);
  } finally {
    input.value = '';
  }
}

/** Notify the requester (uni_staff) + VP-Admin of the professor's decision.
 *  Both are pinged — sastaff acts on it, and vpa "sees all progress". */
function notifySignDecision({ project, document, accepted, hasSigned, body }) {
  const kind = accepted ? 'sign_accepted' : 'sign_rejected';
  // `head` is the SUBJECT LINE and the VP-Admin notification title — the two
  // places staff read before deciding to close the หนังสือ. It used to be
  // derived from `accepted` while `body` was derived from `hasSigned`: two
  // claims about one event, from one function, disagreeing. For three หนังสือ
  // the subject said "อาจารย์ลงนามแล้ว" over an unsigned PDF, which is why
  // nobody downstream looked. Both halves now read the same fact.
  const head = accepted
    ? (hasSigned ? 'อาจารย์ลงนามแล้ว' : 'อาจารย์อนุมัติแล้ว (ยังไม่มีไฟล์ลงนาม)')
    : 'อาจารย์ส่งกลับ';
  notifyUniStaff({ kind, project, document, body, subject: `[MDKKU SAMO] ${head} — ${project?.name || ''}` }).catch(() => {});
  notifyVpAdmin({ kind, project, document, body, title: `${head} — ${document?.title || ''}` }).catch(() => {});
}

async function onSignAcceptClick(btn) {
  const reqId = btn.dataset.signReq;
  const docId = btn.dataset.docId;
  const found = findDocById(docId);
  if (!found) return;
  const { doc, project } = found;
  // Accepting is an APPROVAL — attaching a signed file (e-sign / reupload)
  // is optional, so don't BLOCK one without a file. But it is the unusual
  // case and it used to pass in silence: three หนังสือ were approved with no
  // signature, then labelled ลงนามแล้ว and closed เสร็จสิ้น by staff who had
  // no way to know. Ask once, and say what will be recorded.
  let hasSigned = false;
  let couldCheck = true;
  try {
    const files = await listFiles(docId, { includeSuperseded: false });
    hasSigned = files.some((f) => f.is_signed && String(f.sign_request_id) === String(reqId));
  } catch { couldCheck = false; }
  // Only ask when we actually KNOW there is no file. A failed lookup must not
  // accuse the professor of skipping a step he may well have completed.
  if (couldCheck && !hasSigned) {
    const ok = await openProjectConfirm({
      title: 'อนุมัติโดยยังไม่มีไฟล์ลงนาม?',
      body: 'หนังสือนี้จะถูกบันทึกว่า "อนุมัติแล้ว · ยังไม่มีไฟล์ลงนาม" '
          + 'และเจ้าหน้าที่จะเห็นข้อความนี้ หากต้องการแนบไฟล์ที่เซ็นแล้ว '
          + 'ให้กดยกเลิก แล้วใช้ปุ่ม "ลงนาม" หรือ "อัปโหลดไฟล์ที่เซ็น" ที่ไฟล์ด้านบนก่อน',
      okLabel: 'อนุมัติโดยไม่มีไฟล์',
      okVariant: 'warning',
    });
    if (!ok) return;
  }
  const user = getUser();
  try {
    await appendSignTimeline(reqId, {
      by: user?.id || null, role: 'sa_prof', action: 'accepted',
      note: hasSigned ? 'ยอมรับและลงนามแล้ว' : 'ยอมรับ (อนุมัติ)',
    }, { status: 'accepted', decided_at: new Date().toISOString() });
    // Also stamp the DOC timeline so sastaff/vpa get the inbox highlight +
    // banner on the โครงการ / หนังสือ (the request timeline alone isn't part
    // of the doc-level unseen-activity system). Prof may write doc.timeline
    // (migration 0051, column-guarded).
    await appendDocTimeline(docId, {
      by: user?.id || null, role: 'sa_prof', action: 'sign_accepted',
      // Role badge already renders "อาจารย์" + the action label says
      // "ลงนามแล้ว / อนุมัติ" — so the note just carries the หนังสือ reference
      // (avoids the old "อาจารย์ อาจารย์ลงนาม อาจารย์ลงนามแล้ว" triplication).
      note: `หนังสือ #${doc.sequence_no || ''} "${doc.title || ''}"`.trim(),
    }).catch((err) => console.warn('[projects] sign_accepted doc-timeline failed:', err?.message || err));
    markDocSeenAndClear(docId);
    onChanged();
    const docRef = `หนังสือ #${doc.sequence_no || ''} "${doc.title || ''}"`;
    notifySignDecision({
      project, document: doc, accepted: true, hasSigned,
      body: `${hasSigned ? 'อาจารย์ลงนามแล้ว' : 'อาจารย์อนุมัติแล้ว แต่ยังไม่มีไฟล์ลงนามแนบมา'} — ${docRef}`,
    });
  } catch (err) { alert(err.message || 'ยอมรับไม่สำเร็จ'); }
}

async function onSignRejectClick(btn) {
  const reqId = btn.dataset.signReq;
  const docId = btn.dataset.docId;
  const found = findDocById(docId);
  if (!found) return;
  const { doc, project } = found;
  const reason = await openProjectPrompt({
    title: 'ปฏิเสธการลงนาม',
    label: 'เหตุผลที่ส่งกลับให้เจ้าหน้าที่',
    placeholder: 'อธิบายสั้นๆ ว่าต้องแก้ส่วนใด',
    okLabel: 'ส่งกลับ',
    required: true,
  });
  if (!reason) return;
  const user = getUser();
  try {
    await appendSignTimeline(reqId, {
      by: user?.id || null, role: 'sa_prof', action: 'rejected', note: reason,
    }, { status: 'rejected', reject_reason: reason, decided_at: new Date().toISOString() });
    await appendDocTimeline(docId, {
      by: user?.id || null, role: 'sa_prof', action: 'sign_rejected',
      note: reason,
    }).catch((err) => console.warn('[projects] sign_rejected doc-timeline failed:', err?.message || err));
    markDocSeenAndClear(docId);
    onChanged();
    const docRef = `หนังสือ #${doc.sequence_no || ''} "${doc.title || ''}"`;
    notifySignDecision({ project, document: doc, accepted: false, body: `อาจารย์ส่งกลับเพื่อแก้ไข — ${docRef}: ${reason}` });
  } catch (err) { alert(err.message || 'ส่งกลับไม่สำเร็จ'); }
}

async function onSignCancelClick(btn) {
  const reqId = btn.dataset.signReq;
  const docId = btn.dataset.docId;
  const ok = await openProjectConfirm({
    title: 'ยกเลิกคำขอลงนาม?',
    body: 'คำขอลงนามนี้จะถูกยกเลิกและอาจารย์จะไม่เห็นอีก',
    okLabel: 'ยกเลิกคำขอ',
  });
  if (!ok) return;
  try {
    await deleteSignRequest(reqId);
    onChanged();
  } catch (err) { alert(err.message || 'ยกเลิกไม่สำเร็จ'); }
}

// ---------- utils ----------

async function copyToClipboard(url, srcEl) {
  try {
    await navigator.clipboard.writeText(url);
    flash(srcEl);
  } catch { window.prompt('คัดลอกลิงก์:', url); }
}

/** Lightweight "copied!" feedback: swap the leading icon to a check
 *  for a moment + add a transient tint class. We avoid replacing the
 *  button's HTML so an icon-only chip doesn't suddenly grow text
 *  ("คัดลอกแล้ว") and resize the surrounding row. `bi-check-lg` is
 *  guaranteed in bootstrap-icons 1.10.5 — earlier iterations used
 *  the -fill variants which simply rendered as empty squares. */
function flash(el) {
  if (!el) return;
  const icon = el.querySelector('i.bi');
  el.classList.add('is-copied');
  if (icon) {
    const orig = icon.className;
    icon.className = 'bi bi-check-lg';
    setTimeout(() => {
      icon.className = orig;
      el.classList.remove('is-copied');
    }, 1100);
  } else {
    setTimeout(() => el.classList.remove('is-copied'), 1100);
  }
}

function cssEsc(s) {
  if (window.CSS && CSS.escape) return CSS.escape(s);
  return String(s).replace(/["\\]/g, '\\$&');
}
