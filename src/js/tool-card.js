// ============================================================
// tool-card.js — ONE renderer for a tool card, used by both consumers.
//
// The ฝ่าย detail page (departments.js) and the searchable launcher
// (launcher.js) draw the same `.launcher-tool` component. Rendering it twice
// would have re-created, in markup, exactly the duplication that
// src/data/tools.js just removed from the data — so there is one function and
// both call it.
//
// It always emits `data-name` and `data-cats`, even on the ฝ่าย page where
// nothing filters. They are inert there, and the alternative — a `forLauncher`
// flag — is two renderers wearing one name.
//
// NAVIGATION. In-app targets get `data-dept-tool-tab` / `data-dept-tool-path`,
// which a delegated listener on `document` (initDepartments) turns into
// activateTab / navigateTo. That listener is document-level, so it serves the
// launcher too.
//
// ⚠️ A `path` tool KEEPS its href. The delegated handler calls preventDefault,
// so the href never navigates — it is there so middle-click, "open in new tab"
// and "copy link" behave like real links. Dropping it silently breaks all
// three, which is why `tools-registry.test.js` asserts it.
// ============================================================

import { escHtml } from './utils.js';
import { toolTarget, toolPath } from '../data/tools.js';
import { DEPT_DEFS } from '../data/depts.js';

/** The ฝ่าย's own logo when the entry asks for it — from depts.js, its one home. */
const deptLogoOf = (tool) => (tool.deptLogo ? DEPT_DEFS[tool.dept]?.logo || null : null);

/** The inner content — identical for every kind. */
function cardInner(tool) {
  const arrow = tool.kind === 'external' ? 'bi-box-arrow-up-right' : 'bi-arrow-right';
  const logo = deptLogoOf(tool);
  const icon = logo
    ? `<span class="launcher-tool-icon launcher-tool-icon--logo"><img src="${escHtml(logo)}" alt="" loading="lazy" draggable="false" /></span>`
    : `<span class="launcher-tool-icon"><i class="bi ${escHtml(tool.icon)}"></i></span>`;
  return `
    ${icon}
    <span class="launcher-tool-body">
      <span class="launcher-tool-name">${escHtml(tool.name)}</span>
      <span class="launcher-tool-desc">${escHtml(tool.desc)}</span>
    </span>
    <i class="bi ${arrow} launcher-tool-arrow" aria-hidden="true"></i>
  `;
}

/**
 * One tool card as an HTML string.
 * @param {object} tool an entry from src/data/tools.js
 */
export function renderToolCard(tool) {
  const inner = cardInner(tool);
  // The visible name is searched separately by applyLauncherFilters, but it is
  // repeated here so a single lowercased haystack answers every query the
  // hand-written markup used to answer.
  const search = `${tool.keywords || ''} ${tool.name}`.trim().toLowerCase();
  const attrs = [
    `class="launcher-tool"`,
    `style="--tool-color: ${escHtml(tool.color || 'var(--brand-primary)')};${
      tool.ink ? ` --tool-ink: ${escHtml(tool.ink)};` : ''}"`,
    `data-name="${escHtml(search)}"`,
    `data-cats="${escHtml(tool.cats || 'public')}"`,
    tool.roles ? `data-roles="${escHtml(tool.roles)}"` : '',
  ].filter(Boolean).join(' ');

  if (tool.kind === 'external') {
    return `<a ${attrs} href="${escHtml(tool.href)}" target="_blank" rel="noopener">${inner}</a>`;
  }
  // An embed is a path tool whose path is derived from its slug — same card,
  // same in-app navigation, no second branch to keep in step.
  const path = toolPath(tool);
  if (path) {
    return `<a ${attrs} href="${escHtml(path)}"
              data-dept-tool-path="${escHtml(path)}">${inner}</a>`;
  }
  return `<button type="button" ${attrs}
             data-dept-tool-tab="${escHtml(tool.tabId)}">${inner}</button>`;
}

/** Render a list of tools into a container, or leave it untouched if absent. */
export function renderToolCards(root, tools) {
  if (!root) return;
  root.innerHTML = tools.map(renderToolCard).join('');
}

export { toolTarget };
