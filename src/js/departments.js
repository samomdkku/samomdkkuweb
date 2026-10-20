// ==============================================
// DEPARTMENTS — `ฝ่าย` tab drill-down
//
// Level 1 (grid): 10 dept cards, copied verbatim (icon/color/text) from
//                 the original "Our Departments" section that used to
//                 live inside tab-about.html.
// Level 2 (detail): per-ฝ่าย tool list. Tools reuse the .launcher-tool
//                 component so visual consistency carries over from
//                 the เครื่องมือ tab.
//
// TOOLS LIVE IN src/data/tools.js, not here. This file holds only what is
// specific to the ฝ่าย PAGE and cannot change without a deploy: title, icon,
// colour. The tool list used to be duplicated by hand into tab-tools.html;
// both now render from the registry (docs/DEPT-TOOLS.md §2).
//
// ⛔ THE CARDS ARE NOT HERE ANY MORE (0177). Guidebooks, links, covers and a
// ฝ่าย's own HTML are ROWS in public.dept_content, edited in the app by the
// ฝ่าย itself — dept-content.js. Do not add a `cards:` array back: that is the
// hardcoding §12 of DEPT-TOOLS predicted would have to be undone, and it was.
// ==============================================

import { escHtml } from './utils.js';
import { toolsForDept } from '../data/tools.js';
import { DEPT_DEFS } from '../data/depts.js';
import { renderToolCards } from './tool-card.js';
import { loadDeptContent, renderDeptContent, watchDeptHtmlHeights } from './dept-content.js';



let activeDept = null;

/**
 * Paint one ฝ่าย's own content, and say something honest when it is empty or
 * unreachable.
 *
 * ⚠️ The result is dropped if the reader has moved on. `showDept` is called
 * again the moment they tap another ฝ่าย, and without this check a slow
 * response for ฝ่าย A lands in ฝ่าย B's page — the classic out-of-order paint.
 */
/** The note a ฝ่าย page shows when it has NOTHING yet — no tool in the
 *  registry and no content of its own. Before 2026-10-13 every ฝ่าย with a
 *  card had at least one tool, so this case could not happen; the six ฝ่าย
 *  added then have neither, and a bare header reads exactly like a page that
 *  failed to load. Exported for the test. */
export function emptyDeptNote(toolCount, contentHtml) {
  if (toolCount > 0 || contentHtml) return '';
  return '<p class="text-muted small mb-0 text-center">ฝ่ายนี้ยังไม่ได้ลงข้อมูลในหน้านี้</p>';
}

async function paintDeptContent(deptKey, toolCount = 0) {
  const root = document.getElementById('deptsDetailCards');
  if (!root) return;
  root.innerHTML = '';
  root.classList.add('d-none');
  const { rows, error } = await loadDeptContent(deptKey);
  if (activeDept !== deptKey) return;
  if (error) {
    // Say it, rather than showing a page that looks simply empty. An empty
    // ฝ่าย page and a broken request are indistinguishable to a reader, and
    // only one of them is worth telling anyone about.
    root.innerHTML = '<p class="text-muted small mb-0">โหลดเนื้อหาของฝ่ายไม่สำเร็จ ลองรีเฟรชอีกครั้ง</p>';
    root.classList.remove('d-none');
    return;
  }
  const html = renderDeptContent(rows);
  if (!html) {
    const note = emptyDeptNote(toolCount, html);
    if (note) { root.innerHTML = note; root.classList.remove('d-none'); }
    return;
  }
  root.innerHTML = html;
  root.classList.remove('d-none');
  watchDeptHtmlHeights();
}

function showDept(deptKey) {
  const def = DEPT_DEFS[deptKey];
  if (!def) return;
  activeDept = deptKey;
  const grid = document.getElementById('deptsLevelGrid');
  const detail = document.getElementById('deptsLevelDetail');
  if (!grid || !detail) return;
  grid.classList.add('d-none');
  detail.classList.remove('d-none');

  const header = document.getElementById('deptsDetailHeader');
  if (header) {
    header.style.setProperty('--dept-color', `var(${def.colorVar})`);
  }
  const eyebrow = document.getElementById('deptsDetailEyebrow');
  if (eyebrow) eyebrow.textContent = def.eyebrow;
  const titleEl = document.getElementById('deptsDetailTitle');
  if (titleEl) {
    const mark = def.logo
      ? `<img class="dept-title-logo me-2" src="${escHtml(def.logo)}" alt="">`
      : `<i class="bi ${escHtml(def.icon)} me-2" style="color: var(${escHtml(def.colorVar)});"></i>`;
    titleEl.innerHTML = `${mark}${escHtml(def.title)}`;
  }
  const lead = document.getElementById('deptsDetailLead');
  if (lead) lead.textContent = `เครื่องมือของ${def.title}`;

  const tools = toolsForDept(deptKey);
  renderToolCards(document.getElementById('deptsDetailTools'), tools);

  // The ฝ่าย's OWN content — cards and HTML blocks they edit themselves
  // (0177). Loaded per open rather than at boot: most visitors never open a
  // ฝ่าย page, and a request for content nobody is looking at is a request
  // this app should not make.
  paintDeptContent(deptKey, tools.length);

  // Hash sync — so refresh + share work.
  if (location.hash !== `#dept/${deptKey}`) {
    history.pushState(null, '', `/departments#dept/${deptKey}`);
  }

  window.scrollTo({ top: 0, behavior: 'auto' });
}

function backToGrid() {
  activeDept = null;
  const grid = document.getElementById('deptsLevelGrid');
  const detail = document.getElementById('deptsLevelDetail');
  if (grid && detail) {
    grid.classList.remove('d-none');
    detail.classList.add('d-none');
  }
  if (location.hash.startsWith('#dept/')) {
    history.pushState(null, '', '/departments');
  }
  window.scrollTo({ top: 0, behavior: 'auto' });
}

export function initDepartments() {
  document.addEventListener('click', (e) => {
    const open = e.target.closest('[data-dept-open]');
    if (open) {
      e.preventDefault();
      showDept(open.dataset.deptOpen);
      return;
    }
    if (e.target.closest('#deptsBackToGrid')) {
      e.preventDefault();
      backToGrid();
      return;
    }
    // A modified click on a real LINK (⌘/Ctrl = new tab, Shift = new window,
    // Alt = download) is the browser's to handle — the href is kept on these
    // anchors precisely so that works. Cancelling it opened nothing new and
    // just switched the current page. ⛔ BOTH attributes appear on real links:
    // tool-card.js renders tab tools as <button>, but tab-home.html's banner
    // and /me links are <a href data-dept-tool-tab> — removing that half as
    // "dead" (2026-10-19) broke ⌘-click on /shop, /news and /me.
    // departments-modified-click.test.js reads the markup to keep it honest.
    const modified = e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0;
    if (modified && e.target.closest('a[href][data-dept-tool-tab], a[href][data-dept-tool-path]')) return;
    const tabBtn = e.target.closest('[data-dept-tool-tab]');
    if (tabBtn) {
      e.preventDefault();
      if (typeof window.activateTab === 'function') {
        window.activateTab(tabBtn.dataset.deptToolTab);
      }
      return;
    }
    const pathLink = e.target.closest('[data-dept-tool-path]');
    if (pathLink) {
      e.preventDefault();
      if (typeof window.navigateTo === 'function') {
        window.navigateTo(pathLink.dataset.deptToolPath);
      } else {
        location.href = pathLink.dataset.deptToolPath;
      }
    }
  });

  // Resolve #dept/<key> on first tab show + on hashchange while the
  // ฝ่าย tab is active — supports refresh / direct-link / back-button.
  const applyHash = () => {
    const m = (location.hash || '').match(/^#dept\/(\w+)/);
    if (m) showDept(m[1]); else if (activeDept) backToGrid();
  };
  document.addEventListener('shown.bs.tab', (e) => {
    if (e.target?.id === 'pills-departments-tab') applyHash();
  });
  window.addEventListener('hashchange', () => {
    const departmentsPane = document.getElementById('pills-departments');
    if (departmentsPane?.classList.contains('active')) applyHash();
  });

  // First-load: if URL is /departments#dept/admin (deep-link from somewhere
  // else), open the dept after the path-router activates the tab.
  queueMicrotask(() => {
    if (document.getElementById('pills-departments')?.classList.contains('active')) applyHash();
  });
}
