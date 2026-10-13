// ==============================================
// THEME — light / dark / follow the device (2026-10-13).
//
// The head script in BOTH entry HTMLs (`data-samo="theme"`) applies the saved
// choice BEFORE first paint, so a dark-mode visitor never sees a white flash.
// This module owns everything after that: the switch, saving the choice, and
// following the device live while the choice is "auto". The colours
// themselves are tokens — src/css/theme.css.
//
// ⛔ THE STORAGE KEY AND THE ATTRIBUTES ARE SHARED WITH THE HEAD SCRIPTS —
// theme-head.test.js asserts both entries use exactly THEME_KEY and set the
// same attributes, so the two halves cannot drift (mistakes class 6).
// ==============================================

export const THEME_KEY = 'samo.theme';
export const MODES = [
  { value: 'auto', label: 'ตามอุปกรณ์', icon: 'bi-circle-half' },
  { value: 'light', label: 'สว่าง', icon: 'bi-sun' },
  { value: 'dark', label: 'มืด', icon: 'bi-moon-stars' },
];

const media = () => (typeof window !== 'undefined' && window.matchMedia
  ? window.matchMedia('(prefers-color-scheme: dark)') : null);

export function savedMode() {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === 'light' || v === 'dark' ? v : 'auto';
  } catch { return 'auto'; }
}

/** Dark mode is BUILT but DORMANT (owner, 2026-10-13: "not polish enough …
 *  the web should still show light"). While false: no switch is rendered (the
 *  [data-theme-switch] slots were removed), "auto" means light, and only a
 *  hand-set samo.theme = 'dark' previews it. Turning it on = this flag, the
 *  head scripts in both entries, and the switch slots — HANDOFF §21. */
export const DARK_FOLLOWS_DEVICE = false;

/** PURE. The theme a mode resolves to on a device that prefers `deviceDark`. */
export function resolveTheme(mode, deviceDark) {
  if (mode === 'light' || mode === 'dark') return mode;
  return DARK_FOLLOWS_DEVICE && deviceDark ? 'dark' : 'light';
}

function apply(mode, { animate = false } = {}) {
  const root = document.documentElement;
  const theme = resolveTheme(mode, !!media()?.matches);
  if (animate) {
    root.classList.add('theme-switching');
    setTimeout(() => root.classList.remove('theme-switching'), 300);
  }
  root.dataset.theme = theme;
  root.dataset.themeMode = mode;
  root.setAttribute('data-bs-theme', theme);
  // The browser chrome (Safari's tab bar, Android's status bar) follows too.
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => {
    m.setAttribute('content', theme === 'dark' ? '#0b0f16' : '#ffffff');
  });
  paintSwitches();
}

export function setThemeMode(mode) {
  try {
    if (mode === 'auto') localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, mode);
  } catch { /* private mode: the choice lasts this page only */ }
  apply(mode, { animate: true });
}

function menuHtml(mode) {
  const cur = MODES.find((m) => m.value === mode) || MODES[0];
  return `
    <button type="button" class="theme-switch-btn dropdown-toggle" data-bs-toggle="dropdown"
      aria-expanded="false" aria-label="ธีม: ${cur.label}" title="ธีม: ${cur.label}">
      <i class="bi ${cur.icon}" aria-hidden="true"></i>
    </button>
    <ul class="dropdown-menu dropdown-menu-end shadow-sm" role="menu">
      <li class="dropdown-header small">ธีม</li>
      ${MODES.map((m) => `
        <li><button type="button" class="dropdown-item" role="menuitemradio"
          aria-checked="${m.value === mode}" data-theme-mode="${m.value}">
          <i class="bi ${m.icon}" aria-hidden="true"></i>${m.label}<i class="bi bi-check2" aria-hidden="true"></i>
        </button></li>`).join('')}
    </ul>`;
}

function segmentedHtml(mode) {
  return `
    <div class="theme-segmented" role="radiogroup" aria-label="ธีม">
      ${MODES.map((m) => `
        <button type="button" role="radio" aria-checked="${m.value === mode}" data-theme-mode="${m.value}">
          <i class="bi ${m.icon}" aria-hidden="true"></i><span>${m.label}</span>
        </button>`).join('')}
    </div>`;
}

function paintSwitches() {
  const mode = document.documentElement.dataset.themeMode || savedMode();
  document.querySelectorAll('[data-theme-switch]').forEach((el) => {
    const kind = el.dataset.themeSwitch === 'segmented' ? 'segmented' : 'menu';
    el.classList.add('theme-switch');
    if (kind === 'menu') el.classList.add('dropdown');
    el.innerHTML = kind === 'segmented' ? segmentedHtml(mode) : menuHtml(mode);
  });
}

let wired = false;
export function initTheme() {
  apply(savedMode());
  if (wired) return;
  wired = true;
  // ONE delegated listener for every switch on the page, whatever repaints.
  // pointerdown would be quicker feedback, but a menu item must commit on
  // click so a scroll that starts on it does not change the theme.
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-theme-switch] [data-theme-mode]');
    if (!btn) return;
    setThemeMode(btn.dataset.themeMode);
  });
  // "auto" follows the device live — e.g. iOS switching to dark at sunset.
  media()?.addEventListener?.('change', () => {
    if (savedMode() === 'auto') apply('auto', { animate: true });
  });
}
