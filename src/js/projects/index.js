// ==============================================
// PROJECTS — Entry point
//
// initProjects() is called from main.js on DOMContentLoaded. It:
//   - subscribes to auth so visibility flips when a vp_admin / uni_staff
//     / dev signs in (or out)
//   - wires sub-nav buttons inside #pills-projects
//   - lazy-loads project + doc-type data on first tab show
//   - exposes openProjectsTab() so other modules / hash routing can jump in
// ==============================================

import { onAuthChange, userCanAccess, holdsMaster } from '../auth.js';
import { listProjects, listDocTypes, getSettings, listMyDocViews } from './api.js';
import {
  mountInbox, renderInbox, openProjectDetail, openDocumentDetail,
  setServerDocViews, migrateLocalSeenAtToServer, setInboxCustomerMode,
} from './inbox.js';
import { mountSendFlow, openCreateProject, openSendDocument } from './send.js';
import { mountSignFlow, openSignRequest } from './sign.js';
import { mountManage, renderManage } from './manage.js';
import { mountNotifications, refreshNotificationBell } from './notifications.js';

let initialised = false;
let initialDataLoaded = false;
let currentRole = null;
let currentUser = null;  // full user object — needed for permission check (post-0010)
let view = 'inbox';            // 'inbox' | 'manage'
let tabActive = false;
let cache = {
  projects: [],
  docTypes: [],
  settings: null,
};

/** Allowed to use the projects module?
 *  - dev / uni_staff: always (role default)
 *  - vp_admin: only if their permissions[] includes 'projects'
 *    (so only the อุปนายกฝ่ายบริหารองค์กร account opts in — the
 *    other 9 VPs see VS for their dept but not Projects). */
function isAllowed(user) {
  if (!user) return false;
  // Single source of truth: role defaults (uni_staff/sa_prof/dev) OR a
  // 'projects' grant via manual permissions[] OR the SAMO Team tree
  // (managedPermissions, migration 0081). Mirrors the admin-tab gate and
  // the projects-write RLS, so the tab, this module, and the DB agree.
  return userCanAccess('projects', user);
}

function setView(next) {
  view = next;
  // Admin shell wraps tab-projects.html in <section data-admin-pane="projects">,
  // not the legacy #pills-projects. The data attributes are unique to the
  // projects feature so we can match them at document scope.
  document.querySelectorAll('[data-projects-view]').forEach((b) =>
    b.classList.toggle('is-active', b.dataset.projectsView === next));
  document.querySelectorAll('[data-projects-pane]').forEach((p) =>
    p.classList.toggle('d-none', p.dataset.projectsPane !== next));
  if (next === 'inbox')  renderInbox({ projects: cache.projects, docTypes: cache.docTypes, settings: cache.settings, role: currentRole });
  if (next === 'manage') renderManage({ docTypes: cache.docTypes, settings: cache.settings, role: currentRole });
}

/** SAMO Team seat (users.managed_project_seats, migration 0086) → the role
 *  string the whole projects UI already branches on. The seat is ADDITIVE:
 *  a real role always wins, so the shared samomdkkuvpa / sastaff / saprof
 *  accounts are untouched.
 *
 *  Everything in this module (and inbox.js) keys off `currentRole`, so
 *  resolving the seat here — once — is what makes a tree-granted person a
 *  first-class actor instead of landing in a controls-less half-state. */
const SEAT_TO_ROLE = { vpa: 'vp_admin', staff: 'uni_staff', prof: 'sa_prof' };
// Precedence when someone holds several seats: the widest first.
// Since 0092 the resolver normally sends exactly ONE seat — an explicit pick
// replaces what the ตำแหน่ง would inherit, so this is no longer what decides a
// person's role. It only breaks a genuine tie: two team_members rows (two
// postings) naming different seats. Before 0092 an inherited `vpa` silently
// outranked an explicitly chosen `staff`, which is the bug that made a
// เจ้าหน้าที่คณะ grant open the sender's see-everything inbox.
const SEAT_ORDER = ['vpa', 'staff', 'prof'];

/**
 * The seats `master` implies — the JS half of a rule the DATABASE already had.
 *
 * `current_user_project_seats()` (migration 0111) reads:
 *     when current_user_has_permission('master') then array['vpa','staff','prof']
 * so at the DB a master holder is a project actor, is a prof, and passes every
 * projects RLS policy. This module never learned that, and read the RAW
 * `managed_project_seats` column instead — which the ทีม SAMO editor stores as
 * NULL for a master row. Result: role resolved to 'user', every
 * `[data-projects-role]` block hid, `projectsRoleHint` went blank, and the tab
 * opened onto nothing. Measured 2026-08-18: 36 of 41 master holders were in
 * that state, and the 5 that worked only did so because a parent ตำแหน่ง
 * happened to carry a seat — which is why it looked intermittent.
 *
 * It is a FLOOR, not an override: an explicitly stored seat still wins. The
 * seat names a DESK (ผู้ส่ง / เจ้าหน้าที่ / อาจารย์ — three sides of one
 * transaction), not an amount of access, and there is no "all three" desk to
 * draw. So master supplies access; the stored seat, when there is one, still
 * says which screen. Under-showing relative to RLS is safe; the reverse is not.
 */
const MASTER_SEATS = ['vpa', 'staff', 'prof'];

export function projectSeatRole(user) {
  const role = user?.role || null;
  if (role && role !== 'user') return role;
  let seats = Array.isArray(user?.managedProjectSeats) ? user.managedProjectSeats : [];
  if (!seats.some((s) => SEAT_ORDER.includes(s)) && holdsMaster(user)) seats = MASTER_SEATS;
  const seat = SEAT_ORDER.find((s) => seats.includes(s));
  return seat ? SEAT_TO_ROLE[seat] : role;
}

function applyRoleVisibility(user) {
  currentUser = user;
  const role = projectSeatRole(user);
  currentRole = role;
  const allowed = isAllowed(user);
  document.getElementById('navProjectsItem')?.classList.toggle('d-none', !allowed);
  document.getElementById('mobileProjectsItem')?.classList.toggle('d-none', !allowed);
  document.getElementById('navProjectsBell')?.classList.toggle('d-none', !allowed);
  document.getElementById('navProjectsBellMobile')?.classList.toggle('d-none', !allowed);

  // The "เจ้าหน้าที่" section heading inside the avatar dropdown and the
  // mobile offcanvas should appear when ANY staff-only item is visible.
  // Recompute here too because projects role-resolution runs independently
  // of the global auth subscriber in main.js.
  const showStaffSection = allowed
    || !document.getElementById('navAdminItem')?.classList.contains('d-none');
  document.getElementById('navStaffSection')?.classList.toggle('d-none', !showStaffSection);
  document.getElementById('mobileStaffSection')?.classList.toggle('d-none', !showStaffSection);

  // Inside the tab: the "send new" button is vp_admin/dev only; manage stays
  // for both (so uni_staff can adjust her own labels later if needed — but
  // settings RLS still blocks her from saving, the UI just shows read-only).
  document.querySelectorAll('[data-projects-role="vp_admin"]').forEach((el) => {
    const ok = role === 'vp_admin' || role === 'dev';
    el.classList.toggle('d-none', !ok);
  });
  document.querySelectorAll('[data-projects-role="uni_staff"]').forEach((el) => {
    const ok = role === 'uni_staff' || role === 'dev';
    el.classList.toggle('d-none', !ok);
  });
  // sa_prof must be toggled too, not just the two above: these elements carry no
  // d-none in the markup, so an UNHANDLED role attribute leaves the element
  // visible to everyone rather than hiding it.
  document.querySelectorAll('[data-projects-role="sa_prof"]').forEach((el) => {
    const ok = role === 'sa_prof' || role === 'dev';
    el.classList.toggle('d-none', !ok);
  });

  // Page title / hint: differs by role
  const hint = document.getElementById('projectsRoleHint');
  if (hint) {
    if (role === 'vp_admin') hint.textContent = 'ส่งหนังสือโครงการให้เจ้าหน้าที่ และติดตามสถานะ';
    else if (role === 'uni_staff') hint.textContent = 'รับเรื่อง / อัปเดตสถานะหนังสือโครงการจาก SAMO';
    else if (role === 'sa_prof') hint.textContent = 'หนังสือที่ส่งมาให้อาจารย์ลงนาม — ยอมรับ(ลงนาม) หรือส่งกลับ';
    else if (role === 'dev') hint.textContent = 'Dev — เห็นทั้งสองด้านของระบบส่งหนังสือ';
    else hint.textContent = '';
  }

  // Auth-gate inside the tab (visible to non-actors)
  const gate = document.getElementById('projectsAuthGate');
  if (gate) gate.classList.toggle('d-none', allowed);
  const body = document.getElementById('projectsBody');
  if (body) body.classList.toggle('d-none', !allowed);
}

/** The project tables are world-readable (migration 0032 powers the public
 *  customer mirror via `*_read_public using(true)`), so RLS can't narrow the
 *  professor's inbox. But `project_sign_requests` has NO public policy — its
 *  RLS only returns the prof his OWN requests — so a doc's embedded
 *  `sign_requests` is non-empty for the prof ONLY when it was sent to him.
 *  Scope his inbox to those docs/projects at the query layer. (For all other
 *  roles this is a pass-through.) */
function scopeProjectsForRole(projects) {
  if (currentRole !== 'sa_prof') return projects;
  // อาจารย์ is ONE shared role (0095): a seat holder sees the professor's desk,
  // not a private one, so the filter is "was this sent for signature at all?"
  // rather than "is it addressed to my uid?". Still far narrower than an actor —
  // หนังสือ never sent to อาจารย์ stay invisible. RLS agrees (prof_can_see_*).
  return (projects || [])
    .map((p) => ({
      ...p,
      documents: (p.documents || []).filter((d) =>
        Array.isArray(d.sign_requests) && d.sign_requests.length > 0),
    }))
    .filter((p) => (p.documents || []).length > 0);
}

let loadInFlight = null;
async function loadInitialData() {
  // Single-flight: enterProjectsWorkspace() (sidebar) and
  // openProjectsTab() (notification jump) can both kick a first load at
  // nearly the same instant in the admin shell. Without this guard the
  // second caller starts a duplicate fetch because initialDataLoaded is
  // only flipped true after the first await resolves.
  if (loadInFlight) return loadInFlight;
  loadInFlight = loadInitialDataInner();
  try { return await loadInFlight; }
  finally { loadInFlight = null; }
}

async function loadInitialDataInner() {
  if (!isAllowed(currentUser)) return;
  try {
    // docViews join the in-flight load so the inbox renders with the
    // server-synced seenAt baked in — no second pass / re-flash.
    const [projects, docTypes, settings, docViews] = await Promise.all([
      listProjects().catch(() => []),
      listDocTypes({ activeOnly: false }).catch(() => []),
      getSettings().catch(() => null),
      currentUser?.id ? listMyDocViews(currentUser.id).catch(() => []) : Promise.resolve([]),
    ]);
    cache.projects = scopeProjectsForRole(projects || []);
    cache.docTypes = docTypes || [];
    cache.settings = settings;
    setServerDocViews(docViews);
    initialDataLoaded = true;
    if (view === 'inbox')  renderInbox({ projects: cache.projects, docTypes: cache.docTypes, settings: cache.settings, role: currentRole });
    if (view === 'manage') renderManage({ docTypes: cache.docTypes, settings: cache.settings, role: currentRole });
    refreshNotificationBell();
    // One-shot: push any legacy localStorage seenAt up to the server so
    // this user's other devices stop showing "many notifications" for
    // events they already ack'd here. Filtered to docs they can see so
    // the FK constraint resolves. Runs at most once per (user, device)
    // via a sentinel in localStorage.
    if (currentUser?.id) {
      const knownIds = [];
      for (const p of cache.projects) {
        for (const d of (p.documents || [])) knownIds.push(d.id);
      }
      migrateLocalSeenAtToServer(currentUser.id, knownIds)
        .then((changed) => {
          // It resolves after the first paint, so repaint when it actually
          // wrote seenAt rows — otherwise a first-time reader stares at a
          // screen of "อัปเดต" pills that are already marked seen server-side.
          if (!changed) return;
          if (view === 'inbox') renderInbox({ projects: cache.projects, docTypes: cache.docTypes, settings: cache.settings, role: currentRole });
        })
        .catch((err) => console.warn('[projects] seenAt bulk migration failed:', err?.message || err));
    }
  } catch (e) {
    console.error('[projects] initial data load failed:', e);
  }
}

/** Public: re-read everything and re-render. Called after any write action.
 *  Optional { projectId, documentId } auto-opens that item in the detail
 *  pane — used after the create/send flow so the user lands on the thing
 *  they just made instead of an empty state. */
export async function reloadProjects(focus = {}) {
  const [projects, docTypes, settings, docViews] = await Promise.all([
    listProjects().catch(() => cache.projects),
    listDocTypes({ activeOnly: false }).catch(() => cache.docTypes),
    getSettings().catch(() => cache.settings),
    currentUser?.id ? listMyDocViews(currentUser.id).catch(() => null) : Promise.resolve(null),
  ]);
  cache = { projects: scopeProjectsForRole(projects), docTypes, settings };
  // Only repopulate from server when the fetch actually succeeded —
  // a transient failure shouldn't blow away the in-memory map and
  // re-flash every highlight.
  if (Array.isArray(docViews)) setServerDocViews(docViews);
  if (view === 'inbox')  renderInbox({ projects: cache.projects, docTypes: cache.docTypes, settings: cache.settings, role: currentRole });
  if (view === 'manage') renderManage({ docTypes: cache.docTypes, settings: cache.settings, role: currentRole });
  refreshNotificationBell();
  if (focus.documentId)      openDocumentDetail(focus.documentId);
  else if (focus.projectId)  openProjectDetail(focus.projectId);
}

export function getCachedDocTypes() { return cache.docTypes; }
export function getCachedProjects() { return cache.projects; }
export function getCachedSettings() { return cache.settings; }

function activateProjectsTab() {
  if (typeof window.activateTab === 'function') {
    window.activateTab('pills-projects-tab');
  } else {
    document.getElementById('pills-projects-tab')?.click();
  }
}

/** Public: jump to the projects tab and (optionally) open a specific item.
 *  Works from BOTH shells:
 *   - public SPA: routes through the Bootstrap pill tablist.
 *   - admin app: there are no Bootstrap tabs — section switching is driven
 *     by showAdminSide() (exposed as window.openAdminSection). Clicking a
 *     หนังสือโครงการ notification while parked on another admin section
 *     (ภาพรวม, PR, Shop, …) previously did nothing visible because
 *     activateProjectsTab() targets a tab button that doesn't exist there.
 *     Detect the admin shell and switch the section first. */
export async function openProjectsTab({ projectId, documentId } = {}) {
  const inAdminShell = !!document.getElementById('adminSideNav');
  if (inAdminShell && typeof window.openAdminSection === 'function') {
    window.openAdminSection('projects');   // shows the pane + calls enterProjectsWorkspace()
  } else {
    activateProjectsTab();
  }
  tabActive = true;
  setView('inbox');
  if (!initialDataLoaded) await loadInitialData();
  if (documentId) openDocumentDetail(documentId);
  else if (projectId) openProjectDetail(projectId);
}

/** Public: entry-point used by the admin app's sidebar. Same as
 *  openProjectsTab() but skips the Bootstrap-tab activation (admin
 *  doesn't use Bootstrap tabs — the sidebar drives section switching
 *  directly via showAdminSide). Ensures loadInitialData runs so the
 *  inbox isn't blank on first open. */
export async function enterProjectsWorkspace() {
  tabActive = true;
  setView('inbox');
  if (!initialDataLoaded) await loadInitialData();
}

function applyHashRoute() {
  const hash = window.location.hash || '';
  // #projects, #projects/PRJ-..., #projects/PRJ-.../doc/DOC-...
  if (!/^#projects(\/|$)/.test(hash)) return;
  const parts = hash.replace(/^#projects\/?/, '').split('/');
  // ['PRJ-K3X7', 'doc', 'DOC-AB2KX']
  if (parts[0] && parts[0] !== '') {
    const projectId = parts[0];
    const documentId = parts[1] === 'doc' ? parts[2] : null;
    openProjectsTab({ projectId, documentId });
  } else {
    openProjectsTab();
  }
}

export function initProjects() {
  if (initialised) return;
  initialised = true;

  // Sub-nav — delegate at document level so the click works from any
  // access point (inline subnav in tab-projects.html, future sidebar
  // items, etc.). `[data-projects-view]` is unique to this feature.
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-projects-view]');
    if (!btn) return;
    setView(btn.dataset.projectsView);
  });

  // Create-project header button (always opens the create flow).
  // The FAB is wired inside mountInbox() so its action can flip with the
  // current view (grid → create project; detail → add doc to that project).
  document.getElementById('projectsCreateBtn')?.addEventListener('click', () => openCreateProject());

  mountInbox({
    onChanged: reloadProjects,
    onAddDocument: (project) => openSendDocument({ project }),
    onCreateProject: () => openCreateProject(),
    onSendToProf: ({ doc, project }) => openSignRequest({ doc, project }),
  });
  mountSendFlow({ onCreated: reloadProjects });
  mountSignFlow({ onSent: (focus) => reloadProjects(focus) });
  mountManage({ onChanged: reloadProjects });
  mountNotifications({ onJump: ({ projectId, documentId }) => openProjectsTab({ projectId, documentId }) });

  // Auth subscriber. Track the previous user id so we can detect a
  // genuine account switch (not just a token refresh that re-fires
  // the same user) and wipe the in-memory doc-views map — otherwise
  // account B inherits account A's "I've seen this" flags on the
  // same browser.
  let lastUserId = null;
  onAuthChange((user) => {
    applyRoleVisibility(user);
    const switched = !!user && user.id !== lastUserId;
    lastUserId = user?.id || null;
    if (switched) {
      // Drop the previous user's seenAt mirror before any render runs.
      // loadInitialData below will repopulate it from the new user's
      // project_doc_views rows.
      setServerDocViews([]);
      initialDataLoaded = false;
    }
    if (isAllowed(user) && tabActive && !initialDataLoaded) {
      loadInitialData();
    }
    if (!user) {
      cache = { projects: [], docTypes: [], settings: null };
      initialDataLoaded = false;
      setServerDocViews([]);
    }
  });

  // Lazy first load on tab show
  document.addEventListener('shown.bs.tab', async (e) => {
    if (e.target?.id === 'pills-projects-tab') {
      tabActive = true;
      if (!initialDataLoaded) {
        const grid = document.getElementById('projectsGrid');
        if (grid && grid.childElementCount === 0) {
          grid.innerHTML = `<div class="text-center text-muted py-5"><div class="spinner-border spinner-border-sm me-2"></div>กำลังโหลด…</div>`;
        }
        await loadInitialData();
      }
    } else {
      tabActive = false;
    }
  });

  // Hash routing — deep-link into a specific project / document
  window.addEventListener('hashchange', applyHashRoute);
  // Apply once on load too, in case the page is opened with a hash already.
  if (/^#projects(\/|$)/.test(window.location.hash || '')) {
    // Defer until DOMContentLoaded path has wired everything
    setTimeout(applyHashRoute, 0);
  }

  // bfcache restore (`event.persisted === true`): iOS / iPadOS Safari
  // restores the WHOLE page from memory when the user switches back
  // to the tab, so cache.projects is whatever was in memory when they
  // left. A new comment / file added by the other side while we were
  // backgrounded is invisible until the user does something that
  // happens to refetch — and "the highlights don't show" is exactly
  // how that looks. Force a fresh fetch on every bfcache restore.
  window.addEventListener('pageshow', (e) => {
    if (!e.persisted) return;
    if (!isAllowed(currentUser)) return;
    reloadProjects().catch((err) =>
      console.warn('[projects] pageshow reload failed:', err?.message || err));
  });
}

// ==============================================
// CUSTOMER MIRROR — public read-only view
//
// Mounts the projects module against the public site's
// tab-projects-view pane, in role='customer'. Reuses the same
// renderers; the action buttons hide themselves because every
// `isVp` / `isUni` check returns false for 'customer'. The inbox
// is also put into "customerMode" so markDocSeen no-ops (anon has
// no identity to persist seenAt against).
//
// We intentionally DON'T call mountSendFlow / mountManage /
// mountNotifications — none of them apply to an anonymous reader.
// Hash routing (#projects/PRJ-… → drill in) IS wired so the dept
// page can deep-link to a specific หนังสือโครงการ.
// ==============================================
let customerInitialised = false;

export async function mountCustomerProjects() {
  if (customerInitialised) {
    // Tab re-shown after first mount — just refresh from cache.
    await reloadProjects().catch(() => {});
    return;
  }
  customerInitialised = true;

  // Tell the inbox module it's running in customer mode so
  // markDocSeen no-ops and the comment button hides.
  setInboxCustomerMode(true);
  currentRole = 'customer';

  // Inbox sub-nav + filter row are wired by mountInbox; the
  // create-project button and FAB exist in the customer markup
  // intentionally hidden via CSS (data-projects-role="vp_admin")
  // so the role-visibility loop keeps them invisible.
  mountInbox({
    onChanged: reloadProjects,
    onAddDocument: () => {},          // no-op: customer can't add docs
    onCreateProject: () => {},         // no-op: customer can't create
  });

  // Initial data load — same path as the admin entry, just with
  // currentRole hardcoded to 'customer'. listMyDocViews is skipped
  // because there's no user.id, and project_settings is NOT fetched:
  // since 0115 it is staff-only (it carries the officer's real email).
  // Nothing on this path consumed it — the only reader was inbox.js's
  // ownerLabel(), which had zero call sites AND read `uni_label` /
  // `vp_label`, keys that do not exist on that row. Both are gone now.
  try {
    const [projects, docTypes] = await Promise.all([
      listProjects().catch(() => []),
      listDocTypes({ activeOnly: false }).catch(() => []),
    ]);
    cache = { projects: projects || [], docTypes: docTypes || [], settings: null };
    renderInbox({
      projects: cache.projects, docTypes: cache.docTypes,
      settings: cache.settings, role: currentRole,
    });
  } catch (e) {
    console.error('[projects/customer] initial data load failed:', e);
  }

  // Sub-nav delegate so clicking a project card / doc card works
  // (inbox.js does this via the inbox pane data attribute).
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-projects-view]');
    if (!btn) return;
    // customer view only has 'inbox' — no manage. The button shouldn't
    // exist in tab-projects-view.html, but defensive guard anyway.
    if (btn.dataset.projectsView !== 'inbox') return;
  });

  // Deep-link support: /projects-view#projects/PRJ-XYZ →
  // open that project's detail. Same hash space as admin's
  // routing for parity, but only triggers from this tab.
  const applyCustomerHash = () => {
    const hash = window.location.hash || '';
    const m = hash.match(/^#projects\/([^/]+)(?:\/doc\/(.+))?$/);
    if (!m) return;
    const projectId = m[1];
    const documentId = m[2] || null;
    if (documentId) openDocumentDetail(documentId);
    else if (projectId) openProjectDetail(projectId);
  };
  window.addEventListener('hashchange', () => {
    if (document.getElementById('pills-projects-view')?.classList.contains('active')) {
      applyCustomerHash();
    }
  });
  document.addEventListener('shown.bs.tab', (e) => {
    if (e.target?.id === 'pills-projects-view-tab') {
      applyCustomerHash();
      // Fresh fetch when re-entering the tab — same logic as the
      // admin pageshow handler. Cheap; the data isn't large.
      reloadProjects().catch(() => {});
    }
  });

  // Initial deep-link resolution. If the user landed directly on
  // /projects-view#projects/PRJ-X the tab was activated BEFORE our
  // shown.bs.tab handler was registered above (the path router
  // runs first), so apply it once here after the data is loaded.
  applyCustomerHash();
}
