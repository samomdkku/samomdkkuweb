// ==============================================
// MAIN.JS — Entry Point
// Initializes all modules, Quill editors, and
// attaches exported functions to window for
// inline onclick handlers in HTML.
// ==============================================

// main.css is loaded via a parser-blocking <link> tag in index.html (not
// imported here) so the styles arrive in the first paint, not after the JS
// module evaluates. Eliminates the dev-mode FOUC.
import { startBuildCheck } from './build-check.js';
startBuildCheck();   // run before anything else — see build-check.js header

import { initModalStack } from './modal-stack.js';
initModalStack();  // stacked modals (crop over member editor, picker over member editor)
import { QUILL_TOOLBAR } from './config.js';
import { uploadImageToDrive } from './uploads.js';

// --- Module Imports ---
import { initAuth, onAuthChange, signOut as samoSignOut, getUser as authGetUser, userCanAccess, holdsMaster } from './auth.js';
import { mountAccountSwitch, openSwitcher as openAccountSwitcher } from './account-switch.js';
import { mountSigninModal } from './signin-modal.js';
import { initProfileModal, openProfileModal } from './profile.js';
import { loadAnnouncements, viewAnnouncement, closeArticleView, getViewingAnnouncementId, deleteCurrentAnnouncement } from './announcements.js';
import { initPrAuth, handlePrGoogleLogin, logoutGoogle, forceShowGoogleAuth, togglePrAccountFields } from './pr-auth.js';
import { initPrForm, togglePrMode, updateFormVisibility, toggleProjectFormatCopost, toggleOtherPlatformReason, applyDateRules, syncPublishDate } from './pr-form.js';
import { trackPRTicket, refreshPRTicketDashboard, loadPRHistory, openPRTicketDetail, logoutPRTrack } from './pr-tracking.js';
import { initVsForm, initVsConsent, toggleVitalSoundMode, toggleVsAccountFields, verifyAccount, toggleEmergency, setIsAccountVerified } from './vs-form.js';
import { trackWithTicketId, loginToViewHistory, submitUserRemark, openTicketDetail, logoutTrack } from './vs-tracking.js';
import { initVsBoard, vsBoardSearch, vsBoardSetSort, vsBoardCat, vsBoardOpen, vsBoardBack, vsBoardMeToo, vsPostComment, openBoardProblem } from './vs-board.js';
import { initVsRoute, vsSetRoute } from './vs-route.js';
import { initShop } from './shop/index.js';
import { initDepartments } from './departments.js';
import { initLauncher } from './launcher.js';
import { initOrgChart, enterOrgChart } from './org-chart.js';
import { showMySeat, renderMySeat, clearMySeatCache, loadMySeat } from './my-seat.js';
import { renderDiscordCard, readDiscordOutcome } from './discord-link.js';
import { showMyHouse, renderMyHouse, clearMyHouseCache } from './house/my-house.js';
// ปีการศึกษา is an admin-set value (0141); every ชั้นปี on the page derives from
// it, so it is fetched once before anything that renders one.
import { primeAcademicYear } from './house/api.js';
import {
  showIdentityCheck, renderIdentityCheck, clearIdentityCheckCache,
} from './identity-check.js';
// The one list of "which grants open /admin/". Shared with admin-main.js
// canUseAdmin() so the navbar link and the door it opens cannot drift.
import { ADMIN_FEATURES } from './team-vocab.js';
import { initProjectsView } from './projects-view.js';
import { mountGoldenPeriodCalendar } from './golden-period.js';
import { mountToolFrame, embedSlugFromPath } from './tool-frame.js';
import { TOOLS } from '../data/tools.js';
import { mountEnvRibbon } from './env-ribbon.js';
import { initAnalytics } from './analytics.js';
import { initHomeStats } from './home-stats.js';
import { initDevActivity } from './dev-activity.js';
import { initChangelog } from './changelog.js';
import { copyText } from './utils.js';

// The boot watchdog in index.html is a CLASSIC script, so it runs even when
// this module does not. Clearing its flag here is what tells it the app is
// alive; if it is never cleared, the reader gets a "โหลดใหม่" bar instead of
// a page whose menus open and whose buttons all silently do nothing.
// Set after the imports, so a module that fails to LOAD ITS DEPENDENCIES is
// still reported as not booted.
try { window.__samoBooted = true; } catch { /* nothing to tell */ }

// ==============================================
// QUILL SETUP
// ==============================================

const Size = Quill.import('attributors/style/size');
Size.whitelist = ['10px', '12px', '13px', '14px', '15px', '16px', '18px', '20px', '24px', '32px'];
Quill.register(Size, true);

// Custom image handler: when the user clicks the image icon in the toolbar,
// open a file picker, upload the image to Drive, then insert the returned URL
// at the cursor. This bypasses Quill's default base64 embedding which would
// otherwise inflate the announcement HTML to MB and break the POST.
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
      // Insert a placeholder while uploading
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

let vsQuillRef = null;

// The public app only initialises Quill for the VS form. The creator
// (announcement-writing) Quill lives in the admin app (admin-main.js)
// since /admin/ is where staff publish.
const vsQuill = new Quill('#vsQuillEditor', {
  theme: 'snow',
  placeholder: 'อธิบายปัญหา หรือข้อเสนอแนะที่นี่... (รองรับการแนบภาพ/ลิงก์)',
  modules: {
    toolbar: {
      container: QUILL_TOOLBAR,
      handlers: { image: makeQuillImageHandler(() => vsQuillRef) },
    },
  },
});
vsQuillRef = vsQuill;

// ==============================================
// INITIALIZE MODULES
// ==============================================

initVsForm(vsQuill);
// PDPA consent gate for the Vital Sound report form. Wires the popup's
// ยินยอม / ไม่ยินยอม buttons; the popup is triggered on every send attempt
// from inside vs-form.js (handleVsFormSubmit), not on tab view.
initVsConsent();
// PUBLIC Problem board (lazy-loads on first show; primes now if it's the
// default-visible mode of the active VitalSound tab).
initVsBoard();
// Sub-state routing inside the VS tab (#track/VS-XXXX, #problem/VS-XXXX, …)
// so a reload comes back to the ticket you were reading. window.vsSetRoute has
// to exist before any VS view renders — the writers call it through window to
// avoid an import cycle.
window.vsSetRoute = vsSetRoute;
initVsRoute();

// ==============================================
// ATTACH FUNCTIONS TO WINDOW
// (Required for inline onclick="" handlers in HTML)
// ==============================================

// Announcements (read-only on public site)
window.loadAnnouncements = loadAnnouncements;
window.viewAnnouncement = viewAnnouncement;
window.closeArticleView = closeArticleView;
// Staff who click "edit" on a public article jump to /admin/ with the
// article id so admin can pre-populate the editor form (admin-main.js
// parses the hash and calls editAnnouncement(id) on load).
window.editCurrentAnnouncement = () => {
  const id = getViewingAnnouncementId();
  location.href = id ? `/admin/#creator/${encodeURIComponent(id)}` : '/admin/#creator';
};
// Delete happens inline on the public reader — no point hopping to admin
// for a single confirm + delete + reload.
window.deleteCurrentAnnouncement = deleteCurrentAnnouncement;

// Global Auth
window.samoSignOut = samoSignOut;
window.samoOpenProfile = openProfileModal;
// One-tap account switch: opens a Gmail-style chooser of saved
// accounts when at least one is remembered, else falls through to
// "sign out + open sign-in modal" so first-time users still get a
// useful action.
window.samoSwitchAccount = () => openAccountSwitcher();

// Admin / projects handlers no longer live in the public bundle —
// they're in /admin/. If something on the public site references them
// (e.g. a hardcoded onclick), redirect to /admin/.
window.showAdminLanding = () => { location.href = '/admin/'; };
window.openAdminSection = (which) => { location.href = '/admin/#' + which; };
window.openManageAgentsModal = () => { location.href = '/admin/#pr'; };

// VS track: load the signed-in user's own history.
//
// This used to synthesize a (username, password) pair into #trackUsername /
// #trackPassword for the GAS-era lookup. Both inputs were removed with the
// signed-in/signed-out split, and since 0096 the read is get_my_vs_tickets(),
// which resolves "which tickets are mine" from auth.uid() SERVER-side — a
// client-supplied identity is neither needed nor trusted. So the wrapper is
// just a signed-in check now; loginToViewHistory() surfaces its own errors.
window.loadVSHistoryFromAuth = () => {
  if (!authGetUser()) return;
  loginToViewHistory();
};

window.trackWithTicketIdFromAuth = () => {
  const input = document.getElementById('trackTicketIdAuth');
  const fallback = document.getElementById('trackTicketId');
  if (input && fallback) fallback.value = input.value;
  trackWithTicketId();
};

// About Us: activate the about tab (hidden tab button — reachable only via
// footer / mobile offcanvas links) and scroll to the given section anchor.
// The CSS scroll-margin-top on .about-section keeps the heading clear of
// the sticky navbar.
window.goToAbout = (sectionId) => {
  const btn = document.getElementById('pills-about-tab');
  if (btn && window.bootstrap) window.bootstrap.Tab.getOrCreateInstance(btn).show();
  requestAnimationFrame(() => {
    const target = document.getElementById(sectionId);
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
};

// PR Auth
window.handlePrGoogleLogin = handlePrGoogleLogin;
window.logoutGoogle = logoutGoogle;
window.forceShowGoogleAuth = forceShowGoogleAuth;
window.togglePrAccountFields = togglePrAccountFields;

// PR Form
window.togglePrMode = togglePrMode;
window.toggleProjectFormatCopost = toggleProjectFormatCopost;
window.toggleOtherPlatformReason = toggleOtherPlatformReason;

// PR Tracking
window.trackPRTicket = trackPRTicket;
window.refreshPRTicketDashboard = refreshPRTicketDashboard;
window.loadPRHistory = loadPRHistory;
window.openPRTicketDetail = openPRTicketDetail;
window.logoutPRTrack = logoutPRTrack;

// PR Staff handlers moved to /admin/. Anything that still touches these
// (legacy modal triggers) jumps to the admin app.
window.fetchPRStaffTickets = () => { location.href = '/admin/#pr'; };
window.filterPRStaffTickets = () => {};
window.openPRStaffModal = () => { location.href = '/admin/#pr'; };
window.submitPRStaffAction = () => {};
window.deletePRStaffAction = () => {};
window.addNewAgent = () => {};
window.removeAgent = () => {};
window.addPRStaffAssignee = () => {};
window.removePRStaffAssignee = () => {};

// VS Form (PUBLIC — visitor submits a problem report)
window.toggleVitalSoundMode = toggleVitalSoundMode;
window.toggleVsAccountFields = toggleVsAccountFields;
window.verifyAccount = verifyAccount;
window.toggleEmergency = toggleEmergency;

// VS Tracking (PUBLIC — visitor checks status of their own ticket)
window.trackWithTicketId = trackWithTicketId;
window.loginToViewHistory = loginToViewHistory;
window.submitUserRemark = submitUserRemark;
window.openTicketDetail = openTicketDetail;
window.logoutTrack = logoutTrack;

// VS public Problem board (PUBLIC — browse/me-too/comment)
window.vsBoardSearch = vsBoardSearch;
window.vsBoardSetSort = vsBoardSetSort;
window.vsBoardCat = vsBoardCat;
window.vsBoardOpen = vsBoardOpen;
window.vsBoardBack = vsBoardBack;
window.vsOpenBoardProblem = openBoardProblem;
window.vsBoardMeToo = vsBoardMeToo;
window.vsPostComment = vsPostComment;

// VS Staff handlers moved to /admin/.
window.fetchStaffTickets = () => { location.href = '/admin/#vs'; };
window.openStaffModalByIndex = () => { location.href = '/admin/#vs'; };
window.submitStaffAction = () => {};
window.onVSAdminRoleChange = () => {};

// ==============================================
// DOM CONTENT LOADED
// ==============================================

// Close the mobile offcanvas whenever the user actions any control inside it
// (pill tab switch, modal trigger, anchor link). We close in JS rather than
// using data-bs-dismiss because that doesn't reliably fire when combined with
// other data-bs-* attributes — and our tab switches use onclick now.
document.addEventListener('click', (e) => {
  const trigger = e.target.closest('.offcanvas-body button, .offcanvas-body a.nav-link');
  if (!trigger) return;
  const offcanvasEl = trigger.closest('.offcanvas');
  if (!offcanvasEl) return;
  const inst = window.bootstrap?.Offcanvas.getOrCreateInstance(offcanvasEl);
  if (inst) inst.hide();
});

// Bootstrap's tab JS auto-opens (and keeps open) the parent dropdown when an
// inner tab activates — so clicking "PR Form" inside เครื่องมือ leaves the
// dropdown stuck open. Bootstrap does this by directly setting .show on the
// .dropdown-menu, bypassing the Dropdown API — so we strip it manually on
// both the menu and the toggle, and reset aria-expanded.
document.addEventListener('shown.bs.tab', (e) => {
  // The user-profile dropdown is the only dropdown left in the navbar.
  // Bootstrap's tab JS sometimes leaves .show stuck on a dropdown when an
  // inner tab activated it (legacy paths) — sweep it defensively so the
  // menu can't end up open-but-empty after a programmatic tab switch.
  document.querySelectorAll('.samo-navbar .dropdown-menu.show').forEach((menu) => {
    menu.classList.remove('show');
  });
  document.querySelectorAll('.samo-navbar .dropdown-toggle.show').forEach((toggle) => {
    toggle.classList.remove('show');
  });
  document.querySelectorAll('.samo-navbar [data-bs-toggle="dropdown"][aria-expanded="true"]').forEach((toggle) => {
    toggle.setAttribute('aria-expanded', 'false');
  });

  // Content-display tabs (about/tools/announcements) should start at the
  // top so the visitor sees the hero, not whatever scroll Y they were at
  // on the previous tab. App tabs (admin/projects) have their own hash
  // routing that scrolls to specific items — don't override those.
  if (e.target?.id === 'pills-about-tab'
      || e.target?.id === 'pills-tools-tab'
      || e.target?.id === 'pills-departments-tab'
      || e.target?.id === 'pills-projects-view-tab'
      || e.target?.id === 'pills-golden-period-tab'
      || e.target?.id === 'pills-tool-embed-tab'
      || e.target?.id === 'pills-announcements-tab') {
    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  // The Google Calendar embed is built the first time this tab opens, never at
  // page load — see golden-period.js.
  if (e.target?.id === 'pills-golden-period-tab') mountGoldenPeriodCalendar();

  // The org chart is one rpc and ~400 people of DOM; load it the first time the
  // about tab is opened (org chart now lives inside เกี่ยวกับเรา).
  if (e.target?.id === 'pills-about-tab') enterOrgChart();

  // URL sync — whenever a tab activates, mirror the path in the URL
  // so refresh / share / bookmark all work. Article tab keeps its
  // /news/{id} path (set explicitly by viewAnnouncement).
  // Use pushState (not replaceState) so the browser back-button can
  // unwind through tab navigation — previously, clicking a link from
  // home to /pr replaced the entry and back went all the way out of
  // the site.
  const target = e.target?.id;
  if (target !== 'pills-article-tab') {
    const want = tabToPath(target);
    if (want && location.pathname !== want) {
      history.pushState(null, '', want);
      // Start the new page at the TOP. Switching a Bootstrap pill only swaps
      // the pane; the window keeps whatever scroll offset the previous page
      // had — so "ดูอัปเดตทั้งหมด", which sits far down the home page, opened
      // /updates already scrolled into the middle of the release list (it
      // landed on v4.1.0). Only on a real path CHANGE: re-activating the tab
      // you are already on must not yank the reader back to the top, and the
      // article tab is excluded above because it manages its own deep links.
      // BACK/FORWARD is unaffected and must stay that way — popstate updates
      // location.pathname BEFORE applyPathRoute() activates the tab, so `want`
      // already equals it and this whole block is skipped, leaving the
      // browser's own scroll restoration to put the reader back where they
      // were. Moving the scroll outside this guard would break that.
      window.scrollTo({ top: 0, behavior: 'auto' });
    }
  }
});

// Activate a tab by the desktop tab button's ID. Used from places that
// aren't part of the main tablist (mobile offcanvas, home cards) — routing
// through the canonical tab button means Bootstrap sees the full tablist
// and correctly deactivates the previously-active pane.
window.activateTab = (tabBtnId) => {
  const btn = document.getElementById(tabBtnId);
  if (!btn || !window.bootstrap) return;
  window.bootstrap.Tab.getOrCreateInstance(btn).show();
};

// ==============================================
// URL ROUTING — path-based public-site routes.
//
// Each top-level page has a real path:
//   /         → home
//   /news     → ประกาศ archive
//   /news/{id}→ individual article
//   /pr       → PR form
//   /vssound  → VitalSound form
//   /shop     → ร้านค้า
//   /tools    → tools launcher
//   /about    → เกี่ยวกับเรา
//
// Cloudflare Pages serves /index.html for any of these via _redirects;
// the in-app router (below) reads location.pathname and activates the
// matching tab. The shown.bs.tab handler later in this file mirrors
// the active tab back into the URL so opening any tab gives a
// shareable, bookmarkable, refresh-safe URL.
// ==============================================

const PATH_ROUTES = [
  { path: '/',         tab: 'pills-home-tab' },
  { path: '/news',     tab: 'pills-announcements-tab' },
  { path: '/pr',       tab: 'pills-pr-tab' },
  { path: '/vssound',  tab: 'pills-vitalsound-tab' },
  { path: '/shop',     tab: 'pills-shop-tab' },
  { path: '/tools',    tab: 'pills-tools-tab' },
  { path: '/departments', tab: 'pills-departments-tab' },
  { path: '/team',     tab: 'pills-about-tab' },
  { path: '/projects-view', tab: 'pills-projects-view-tab' },
  { path: '/tools/golden-period', tab: 'pills-golden-period-tab' },
  { path: '/about',    tab: 'pills-about-tab' },
  { path: '/updates',  tab: 'pills-updates-tab' },
];

/** Open the release-notes page. Bound to window so the footer link and the
 *  version chip (both rendered outside any tab) can reach it. */
window.openUpdates = () => {
  if (window.navigateTo) window.navigateTo('/updates');
  else window.activateTab('pills-updates-tab');
};

function pathToTab(pathname) {
  // Normalise a trailing slash first. `/shop/` used to match NOTHING and fall
  // through to the landing tab — silently, so it read as "the link is broken".
  // Harmless for every existing route and load-bearing for nested ones like
  // /tools/golden-period, which people paste with a slash far more often.
  const p = pathname.length > 1 ? pathname.replace(/\/+$/, '') || '/' : pathname;
  const exact = PATH_ROUTES.find((r) => r.path === p);
  if (exact) return exact.tab;
  if (/^\/news\/.+/.test(p)) return 'pills-article-tab';
  // Every kind:'embed' tool shares ONE pane; the path says which tool.
  // The exact match above runs FIRST, so /tools/golden-period keeps its own
  // native pane — an embed can take that slug later without a router change.
  if (embedToolFor(p)) return 'pills-tool-embed-tab';
  return null;
}

/** The registry entry for an embed route, or null. The registry is the gate:
 *  a folder in public/embed/ with no entry here is not reachable, which is
 *  what makes CODEOWNERS on src/data/tools.js the review point (DEPT-TOOLS §8). */
function embedToolFor(pathname) {
  const slug = embedSlugFromPath(pathname);
  if (!slug) return null;
  return TOOLS.find((t) => t.kind === 'embed' && t.slug === slug) || null;
}

function tabToPath(tabBtnId) {
  const r = PATH_ROUTES.find((r) => r.tab === tabBtnId);
  return r ? r.path : null;
}

/** Public — navigate to a path and activate the matching tab.
 *  Useful for in-app links that want the new URL semantic
 *  without a full page reload. */
window.navigateTo = (pathname) => {
  const moved = location.pathname !== pathname;
  if (moved) {
    history.pushState(null, '', pathname);
  }
  applyPathRoute();
  // Start the new page at the TOP — and it has to be said HERE as well as in
  // the shown.bs.tab handler above, which is the bug this line fixes.
  //
  // That handler only scrolls when `location.pathname !== want`. This function
  // pushes the new path BEFORE activating the tab, so by the time the handler
  // runs the two are already equal and its guard is false. Result: every link
  // that went through navigateTo() — "ดูอัปเดตทั้งหมด" at the bottom of the home
  // page, the ฝ่าย tool links — kept the previous page's scroll offset and
  // dropped the reader into the middle of /updates. The tab-click path was fixed
  // and looked fixed; this path was never exercised. One rule, two code paths.
  //
  // Back/forward is unaffected: popstate calls applyPathRoute() directly, not
  // this function, so the browser's own scroll restoration still wins.
  if (moved) window.scrollTo({ top: 0, behavior: 'auto' });
};

function applyPathRoute() {
  // Article id in path takes precedence.
  const articleMatch = location.pathname.match(/^\/news\/(.+)/);
  if (articleMatch) {
    const id = decodeURIComponent(articleMatch[1]);
    if (typeof window.viewAnnouncement === 'function') window.viewAnnouncement(id);
    return;
  }
  const tab = pathToTab(location.pathname);
  if (tab) window.activateTab(tab);
  // Mount the frame HERE rather than on `shown.bs.tab`, because two embed
  // routes share one pane: going from /tools/a to /tools/b re-shows a tab that
  // is ALREADY active, and Bootstrap fires no shown event for that — the page
  // would keep showing tool A under tool B's URL. This function is the one
  // place every route change passes through (boot, navigateTo, popstate).
  const embed = embedToolFor(location.pathname);
  if (embed) mountToolFrame(embed);
}

// Back/forward — keep the active tab in sync with the path.
window.addEventListener('popstate', () => applyPathRoute());

// (Legacy exitWorkspace removed — admin app at /admin/ has its own
// "กลับสู่หน้าหลัก" link that hrefs to / directly.)

function roleLabel(role) {
  if (role === 'pr_staff')   return 'PR Staff';
  if (role === 'vs_staff')   return 'VS Staff';
  if (role === 'shop_admin') return 'Shop Admin';
  if (role === 'vp_admin')   return 'VP-Admin';
  if (role === 'uni_staff')  return 'Uni Staff';
  if (role === 'dev')        return 'Dev';
  return '';
}

function roleBadgeClass(role) {
  if (role === 'pr_staff')   return 'bg-warning text-dark';
  if (role === 'vs_staff')   return 'bg-info text-dark';
  if (role === 'shop_admin') return 'bg-orange-subtle text-warning border border-warning-subtle';
  if (role === 'vp_admin')   return 'bg-success';
  if (role === 'uni_staff')  return 'bg-primary';
  if (role === 'dev')        return 'bg-dark';
  return 'd-none';
}

// ==============================================
// TOOLS LAUNCHER — search + chip filter.
// Scales to 100+ tools because logic operates on data-* attributes;
// adding a new tool means dropping a button into tab-tools.html.
// ==============================================

let _launcherFilter = 'all';

window.setLauncherFilter = (cat) => {
  _launcherFilter = cat;
  document.querySelectorAll('.launcher-chip').forEach((chip) => {
    chip.classList.toggle('is-active', chip.dataset.filter === cat);
  });
  applyLauncherFilters();
};

window.filterLauncher = () => applyLauncherFilters();

window.resetLauncher = () => {
  const input = document.getElementById('launcherSearchInput');
  if (input) input.value = '';
  window.setLauncherFilter('all');
};

function applyLauncherFilters() {
  const q = (document.getElementById('launcherSearchInput')?.value || '').trim().toLowerCase();
  const cat = _launcherFilter;
  let visibleTotal = 0;

  document.querySelectorAll('.launcher-section').forEach((section) => {
    // role-gated sections (currently #launcherSectionStaff) keep their
    // d-none from auth gating; we only flip is-hidden for filter state.
    const tools = section.querySelectorAll('.launcher-tool');
    let visibleInSection = 0;

    tools.forEach((tool) => {
      // role-gated tools start hidden (d-none) until auth wakes them up.
      // Skip those entirely — keep them invisible regardless of filter.
      if (tool.classList.contains('d-none')) return;

      const cats = (tool.dataset.cats || '').split(/\s+/).filter(Boolean);
      const name = (tool.dataset.name || '').toLowerCase();

      const matchesCat = cat === 'all' || cats.includes(cat);
      const matchesQuery = !q || name.includes(q) || (tool.querySelector('.launcher-tool-name')?.textContent || '').toLowerCase().includes(q);

      const show = matchesCat && matchesQuery;
      tool.classList.toggle('is-hidden', !show);
      if (show) visibleInSection += 1;
    });

    section.classList.toggle('is-hidden', visibleInSection === 0);
    visibleTotal += visibleInSection;
  });

  document.getElementById('launcherEmpty')?.classList.toggle('d-none', visibleTotal > 0);
}

// Apply role-gated launcher visibility: each tool with data-roles="…" shows
// only when the current role is in the whitelist. Section visibility tracks
// "any visible tool inside" so an empty section disappears.
function applyLauncherRoleGating(role) {
  // Show the staff chip + section if the user has any data-roles tool they qualify for.
  let staffVisible = false;
  document.querySelectorAll('.launcher-tool[data-roles]').forEach((tool) => {
    const allowed = tool.dataset.roles.split(/\s+/).filter(Boolean);
    const ok = !!role && allowed.includes(role);
    tool.classList.toggle('d-none', !ok);
    if (ok && tool.closest('#launcherSectionStaff')) staffVisible = true;
  });
  document.getElementById('launcherSectionStaff')?.classList.toggle('d-none', !staffVisible);
  document.getElementById('launcherChipStaff')?.classList.toggle('d-none', !staffVisible);
  // Re-apply the current filter so visible counts stay correct.
  applyLauncherFilters();
}

// "/" keyboard shortcut focuses the launcher search when the tools tab is open.
document.addEventListener('keydown', (e) => {
  if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
  // Don't hijack while typing into an existing input/textarea/contenteditable.
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
  if (document.getElementById('pills-tools')?.classList.contains('active')) {
    const search = document.getElementById('launcherSearchInput');
    if (search) { e.preventDefault(); search.focus(); }
  }
});

// About sub-nav — highlight whichever section is currently in view.
// Triggered once after DOM load; observer is cheap to leave running.
function initAboutSubnav() {
  const links = document.querySelectorAll('.about-subnav-link[data-about-target]');
  if (!links.length) return;
  const sections = Array.from(links)
    .map((a) => document.getElementById(a.dataset.aboutTarget))
    .filter(Boolean);
  if (!sections.length) return;

  const linkFor = (id) => document.querySelector(`.about-subnav-link[data-about-target="${id}"]`);
  const setActive = (id) => {
    links.forEach((l) => l.classList.toggle('is-active', l.dataset.aboutTarget === id));
  };

  // Pick the section whose top is closest to (but past) the sub-nav baseline.
  // rootMargin pulls the activation line below the sticky nav.
  const observer = new IntersectionObserver(
    (entries) => {
      const visible = entries
        .filter((e) => e.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if (visible.length) setActive(visible[0].target.id);
    },
    { rootMargin: '-180px 0px -55% 0px', threshold: [0, 0.1, 0.5] },
  );
  sections.forEach((s) => observer.observe(s));

  // Clicking jumps via goToAbout which already calls scrollIntoView — but
  // visually pre-select so the highlight doesn't lag the scroll.
  links.forEach((a) => {
    a.addEventListener('click', () => setActive(a.dataset.aboutTarget));
  });
  // Mark `linkFor` as used for readers; intentionally no further wiring.
  void linkFor;
}

// (Project bell removed from the public navbar — it lives only in
// /admin/ now, since notifications are operator-facing.)

document.addEventListener('DOMContentLoaded', () => {
  // Load announcements
  loadAnnouncements();

  // Track previous auth identity so we can distinguish "real" auth
  // transitions (sign in / out / role change) from background events
  // like token refresh. Several UI side-effects only make sense on a
  // real transition — e.g. resetting the admin tab back to its
  // landing page would be wrong on a 25-min token refresh because it
  // would yank the user out of the kanban they were working in.
  let prevAuthKey = '__init__';

  // Subscribe navbar + home page + sign-in modal to global auth state.
  onAuthChange((user) => {
    const role = user?.role || null;
    // Identity-and-role fingerprint. Different value = real transition.
    const authKey = user ? `${user.id}|${role}` : '<signed-out>';
    const isTransition = authKey !== prevAuthKey;
    prevAuthKey = authKey;

    // Navbar (desktop)
    const navOut = document.getElementById('navAuthSignedOut');
    const navIn = document.getElementById('navAuthSignedIn');
    if (navOut && navIn) {
      navOut.classList.toggle('d-none', !!user);
      navIn.classList.toggle('d-none', !user);
      if (user) {
        const pic = document.getElementById('navUserPic');
        const name = document.getElementById('navUserName');
        const nameDropdown = document.getElementById('navUserNameDropdown');
        const dept = document.getElementById('navUserDept');
        const email = document.getElementById('navUserEmail');
        const roleBadge = document.getElementById('navUserRoleBadge');
        if (pic) pic.src = user.picture || '';
        if (name) name.textContent = user.name || user.username || '';
        if (nameDropdown) nameDropdown.textContent = user.name || user.username || '';
        if (dept) dept.textContent = user.department || (user.email ? '' : (user.username || ''));
        if (email) email.textContent = user.email || (user.method === 'password' ? `@${user.username}` : '');
        if (roleBadge) {
          const label = roleLabel(role);
          if (label) {
            roleBadge.textContent = label;
            roleBadge.className = `badge ms-1 ${roleBadgeClass(role)}`;
          } else {
            roleBadge.className = 'badge ms-1 d-none';
          }
        }
      }
    }

    // Mobile top-bar sign-in button — only shown signed-out (and only <lg
    // via its d-lg-none class). Replaces the home auth strip on mobile.
    document.getElementById('navAuthSignedOutMobile')?.classList.toggle('d-none', !!user);
    // Mobile top-bar sign-out button — mirror of the sign-in button, shown
    // only when signed in (and only <lg via its d-lg-none class).
    document.getElementById('navAuthSignedInMobile')?.classList.toggle('d-none', !user);

    // Mobile offcanvas: sign-in CTA (signed-out), user strip + sign-out (signed-in)
    document.getElementById('mobileAuthSignedOut')?.classList.toggle('d-none', !!user);
    document.getElementById('mobileAuthSignedIn')?.classList.toggle('d-none', !user);
    document.getElementById('mobileSignOutItem')?.classList.toggle('d-none', !user);
    if (user) {
      const mPic  = document.getElementById('mobileUserPic');
      const mName = document.getElementById('mobileUserName');
      const mDept = document.getElementById('mobileUserDept');
      if (mPic)  mPic.src = user.picture || '';
      if (mName) mName.textContent = user.name || user.username || '';
      if (mDept) mDept.textContent = user.department || roleLabel(role) || (user.email || `@${user.username || ''}`);
    }

    // Surface the "ไปยัง Admin Dashboard" link whenever the user has access to
    // ANY admin feature — role defaults, per-account permissions[] and ทีม SAMO
    // tree grants all count, because userCanAccess() reads all three.
    //
    // ADMIN_FEATURES, not a list spelled out here. The hand-written list this
    // replaced named five keys and predated the ทีม SAMO rungs, so a member
    // whose only grant was `team` (ดู) — which since 0110 is EVERY person with a
    // posting in the tree — could open /admin/ by typing the URL but was never
    // shown the door. That is the "a new access channel must be threaded through
    // every gate the old one used" class, and the fix is to stop having a second
    // list: admin-main.js canUseAdmin() imports the same array, so the door and
    // the doorman can no longer disagree. Guarded by a test in team-vocab.test.js.
    const canAccessAdmin = !!user && ADMIN_FEATURES.some((f) => userCanAccess(f, user));
    document.getElementById('navAdminLink')?.classList.toggle('d-none', !canAccessAdmin);
    document.getElementById('mobileAdminLink')?.classList.toggle('d-none', !canAccessAdmin);

    // Generic data-role-only — legacy hook, ROLE-based. Prefer data-perm-only
    // below for anything a ทีม SAMO grant can confer, or the grant works
    // everywhere except here.
    document.querySelectorAll('[data-role-only]').forEach((el) => {
      const allowed = el.getAttribute('data-role-only').split(/\s+/);
      el.classList.toggle('d-none', !role || !allowed.includes(role));
    });

    // Capability gate — one permission key per element, resolved by
    // userCanAccess() so role defaults, permissions[] and the ทีม SAMO tree all
    // count. Elements carry d-none in the markup, so an element whose key is
    // unknown stays HIDDEN (fails closed).
    document.querySelectorAll('[data-perm-only]').forEach((el) => {
      const feature = el.getAttribute('data-perm-only');
      el.classList.toggle('d-none', !userCanAccess(feature, user));
    });

    // Dev-only features (the "ไม่ส่งแจ้งเตือน Discord" toggle on the PR + VS
    // forms). Shown to the `dev` ROLE and to any `master` holder — master is the
    // ทุกระบบ key held by ฝ่าย IT, so it must carry the same maintenance
    // affordances the dev role does. `role === 'dev'` alone missed every master
    // account (they are role='user' with master in managed_permissions).
    document.querySelectorAll('.dev-only-feature').forEach((el) => {
      el.classList.toggle('d-none', role !== 'dev' && !holdsMaster(user));
    });

    // Home page
    const homeOut = document.getElementById('homeAuthSignedOut');
    const homeIn = document.getElementById('homeAuthSignedIn');
    if (homeOut && homeIn) {
      homeOut.classList.toggle('d-none', !!user);
      homeIn.classList.toggle('d-none', !user);
      if (user) {
        const homeName = document.getElementById('homeUserName');
        const homeDept = document.getElementById('homeUserDept');
        if (homeName) homeName.textContent = user.name || user.username || '';
        // No "ยังไม่ได้ระบุฝ่าย" fallback: for a ทีม SAMO member it was simply
        // WRONG (their ฝ่าย is in the org tree, not in users.department), and for
        // everyone else it is a nag about a field they cannot set from here. An
        // empty line is hidden outright; the ตำแหน่งของฉัน card below carries the
        // real answer for anyone who has one.
        const deptText = user.department || roleLabel(role) || '';
        if (homeDept) { homeDept.textContent = deptText; homeDept.hidden = !deptText; }
      }
    }

    // ตำแหน่งของฉันในทีม SAMO — under the greeting, so the answer to "what am I"
    // sits where the app already says hello. Async and best-effort: it paints
    // itself in when the lookup resolves and stays hidden for the (many) people
    // with no posting. Signing out clears the cache so the next account cannot
    // inherit the previous person's card.
    const seatHost = document.getElementById('homeMySeat');
    const houseHost = document.getElementById('homeMyHouse');
    if (user) {
      // ONE decision, taken once: does this person hold a ทีม SAMO posting?
      // REPORTED: the two cards "show similar information two times". They both
      // rendered ชื่อ, ชื่อเล่น, รหัสนักศึกษา, ชั้นปี and สาขา, each with its own
      // edit form writing its own table. 0132 made those one row in the
      // database; this makes them one block on the screen — the seat card keeps
      // the identity, and บ้านของฉัน shows only รุ่น / สายรหัส / บ้าน beneath it.
      //
      // FOUR CASES, all reachable:
      //   both      → seat card with identity, house card house-only
      //   team only → seat card only (a shared department account)
      //   house only→ house card only, carrying the identity (most students)
      //   neither   → nothing at all (an ordinary visitor)
      // ONE CARD when the person is in both. ระบบบ้าน paints itself into the
      // slot the seat card leaves for it, so there is one heading, one portrait
      // and one identity block — reported as "i thought it would be like one
      // card, isn't that better". It is: a person is one entity, and two
      // sibling cards make the reader do the joining.
      //
      // `afterRender` is not optional politeness. The seat card re-renders
      // itself on every save and that wipes the slot — "a shared render() that
      // repaints a pane another module owns", straight out of mistakes.md. The
      // hook is how the house section gets put back.
      // The Discord card lives in the seat card's other slot and is subject to
      // the same wipe: every save on ข้อมูลของฉัน re-renders the whole card. So
      // it is painted from the SAME hook as ระบบบ้าน rather than once at boot —
      // "a shared render() that repaints a pane another module owns".
      //
      // The OUTCOME is read once, at the top, because reading it CONSUMES it
      // from the URL: a repaint must not re-show "เชื่อมเรียบร้อย" every time
      // the person edits their nickname.
      const dOutcome = readDiscordOutcome();
      const paintDiscordInto = (seatEl) => {
        const slot = seatEl?.querySelector?.('[data-profile-slot="discord"]');
        if (slot) renderDiscordCard(slot, { outcome: dOutcome });
      };
      const paintHouseInto = (seatEl) => {
        paintDiscordInto(seatEl);
        const slot = seatEl?.querySelector?.('[data-profile-slot="house"]');
        if (slot) {
          houseHost.hidden = true;
          houseHost.innerHTML = '';
          showMyHouse(slot, user.id, { mode: 'section' });
        } else {
          // No seat (or no slot): the house card stands on its own, carrying
          // the identity itself. This is the ~1,800-student common case.
          showMyHouse(houseHost, user.id);
        }
      };
      // ตรวจสอบข้อมูล, above both cards. `afterResolve` repaints them because
      // taking the faculty's spelling REWRITES the record the cards are showing
      // — 0132's mirrors carry it to ระบบบ้าน and to ทีม SAMO, and a block that
      // updated itself while the identity below it still said the old name
      // would read as the save having failed.
      primeAcademicYear();
      clearIdentityCheckCache();
      showIdentityCheck(document.getElementById('homeIdentityCheck'), {
        afterResolve: () => {
          clearMySeatCache();
          clearMyHouseCache();
          showMySeat(seatHost, user.id, { afterRender: paintHouseInto });
        },
      });
      showMySeat(seatHost, user.id, { afterRender: paintHouseInto });
      // showMySeat renders NOTHING when there is no posting, so afterRender
      // never fires for a house-only person — paint them here.
      loadMySeat(user.id)
        .then((seat) => {
          // `account` lets renderMyHouse tell "signed out" from "signed in but
          // ระบบบ้าน has nothing for you" — the second used to render NOTHING,
          // which is how a gmail sign-in silently lost the whole feature.
          if (!(seat?.postings || []).length) {
            showMyHouse(houseHost, user.id, { signedIn: true, account: user.email });
          }
        })
        // A failed seat lookup must not cost the student their house card.
        .catch(() => showMyHouse(houseHost, user.id, { signedIn: true, account: user.email }));
    } else {
      clearMySeatCache();
      renderMySeat(seatHost, null);
      clearMyHouseCache();
      renderMyHouse(houseHost, null);
      // Signed out. The block asks a question about a specific person, so
      // leaving it painted would show the previous account's name to the next
      // one — the module-scope-cache-across-an-account-switch shape.
      clearIdentityCheckCache();
      renderIdentityCheck(document.getElementById('homeIdentityCheck'), null);
    }

    // PR form auth wrapper: hide whenever the user is signed in (the global
    // identity is enough — no need to ask again in the form). pr-auth.js
    // already keeps the hidden submitter inputs in sync.
    document.getElementById('prFormAuthWrapper')?.classList.toggle('d-none', !!user);

    // VS track section: swap signed-in/signed-out blocks
    const vsTrackIn = document.getElementById('vsTrackLoggedIn');
    const vsTrackOut = document.getElementById('vsTrackLoggedOut');
    if (vsTrackIn && vsTrackOut) {
      vsTrackIn.classList.toggle('d-none', !user);
      vsTrackOut.classList.toggle('d-none', !!user);
      if (user) {
        const display = user.email || user.username || '';
        const el = document.getElementById('vsTrackUserDisplay');
        if (el) el.textContent = display;
      }
    }

    // VS form auth wrapper. Visibility is idempotent (toggle every time)
    // but the input mutations below would clobber whatever the user is
    // typing if a token-refresh event fires mid-edit — so only run them
    // on a real transition.
    const vsWrapper = document.getElementById('vsFormAuthWrapper');
    if (vsWrapper) {
      vsWrapper.classList.toggle('d-none', !!user);
      if (isTransition) {
        if (user) {
          const vsLoginRadio = document.getElementById('vsAccLogin');
          const vsUser = document.getElementById('vsUsername');
          const vsPass = document.getElementById('vsPassword');
          const synthUser = user.email || (user.username ? `@${user.username}` : '');
          const synthPass = user.id || '';
          if (vsLoginRadio) vsLoginRadio.checked = true;
          if (vsUser) vsUser.value = synthUser;
          if (vsPass) vsPass.value = synthPass;
          setIsAccountVerified(true);
        } else {
          setIsAccountVerified(false);
          // Reset to guest mode so a signed-out user sees the default option.
          const vsGuestRadio = document.getElementById('vsAccGuest');
          if (vsGuestRadio) vsGuestRadio.checked = true;
        }
      }
    }

    // Auto-close sign-in modal — only on the transition to signed-in.
    // Without this guard, every token refresh would close the modal even
    // if the user had re-opened it for some reason.
    if (isTransition && user) {
      const modalEl = document.getElementById('signinModal');
      if (modalEl && window.bootstrap) {
        const inst = window.bootstrap.Modal.getInstance(modalEl);
        if (inst) inst.hide();
      }
    }
  });

  // PR form reflects global auth state into its own DOM
  initPrAuth();

  // Restore the Supabase auth session (it's persisted in localStorage by
  // the supabase-js client). Async, but we don't await — subscribers will
  // be notified when the session is ready.
  initAuth();
  initProfileModal();
  mountAccountSwitch();
  mountSigninModal();

  // Cookieless usage tracking + the landing-page "by the numbers" strip.
  initAnalytics('public');
  initHomeStats();
  // Both read bundled static data, so neither can fail on the network and
  // neither needs to wait for auth.
  initDevActivity();
  initChangelog();

  // Global "copy to clipboard" delegate: any [data-copy] element copies
  // its data-copy value when clicked. stopPropagation prevents the
  // chip's click from bubbling to a parent row-click handler — without
  // it, copying an order id on the admin table also opens the row's
  // detail modal, which the user does not expect.
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


  // Initialize PR form event listeners
  initPrForm();

  // Initialize the SAMO Shop tab (customer side). Wires sub-nav, cart
  // FAB, and lazy loaders.
  initShop();

  // Departments tab — grid drill-down to per-ฝ่าย tool list.
  initDepartments();
  initLauncher();
  initOrgChart();

  // Public read-only mirror of /admin/'s หนังสือโครงการ (customer view).
  // Mounts the projects module in role='customer' mode; lazy-loaded
  // when the user navigates to /projects-view.
  initProjectsView();

  // About-tab sticky sub-nav: highlight whichever section is in view.
  initAboutSubnav();

  // Apply the URL on first load — if the user lands on /pr or /news/{id}
  // directly, activate the right tab. Wrapped in a microtask so it runs
  // after the initial Bootstrap tab activation (default = home).
  queueMicrotask(applyPathRoute);
});

// Non-production marker. Last import wins nothing here — it only needs a body.
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountEnvRibbon, { once: true });
else mountEnvRibbon();
