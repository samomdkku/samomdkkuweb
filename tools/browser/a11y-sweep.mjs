#!/usr/bin/env node
// ============================================================
// a11y-sweep.mjs — task 17's accessibility + friction sweep. Loads every
// PUBLIC route and the main ADMIN panes at 390px (phone) and 1280px
// (desktop), SIGNED OUT and SIGNED IN, in headless Chrome against the local
// dev server on samo-dev (it REFUSES any other project).
//
// Per page, it checks:
//   - axe-core violations (resultTypes: ['violations']), grouped by rule id,
//     with impact and node count — injected ONCE via
//     Page.addScriptToEvaluateOnNewDocument so it is present after every
//     navigation, never re-fetched;
//   - horizontal overflow (document.documentElement.scrollWidth > innerWidth);
//   - console errors + uncaught exceptions (CDP listeners, reset per route);
//   - tap targets under 44px (WCAG 2.5.5/2.5.8) for PRIMARY actions — visible,
//     enabled buttons/links/form controls, excluding plain inline text links
//     inside running prose (a nav button is a primary action; a word in a
//     paragraph that happens to be a link is not);
//   - a focus-visible SAMPLE — the first N interactive elements on the page
//     get a real focus indicator (computed outline or box-shadow actually
//     changes between blurred and focused). A full walk of every element on
//     every route would make this tool impractical to run; N is generous
//     enough to catch a systemic "outline: none with nothing else" bug,
//     which is never isolated to one element.
//
// Separately — not generalizable per-route — it opens the few KNOWN modals
// reachable from a public page (sign-in) and checks: opening moves focus
// INSIDE the modal, Tab does not escape it, and closing returns focus to
// the element that opened it. See mistakes.md class 7, "a closed Bootstrap
// modal is display:none" and class 4's "modal trapping and returning focus".
//
// WHAT THIS TOOL CANNOT DO IN AN AGENT SANDBOX WITH NO CHROME BINARY: run.
// It is written for the owner (or a session with a real Chrome/Chromium) to
// execute — see tools/browser/shop-checkout-navigate-away.mjs, written the
// same way in an earlier task this same queue ("written, never run — no
// Chrome/network in this sandbox"). Static review only here; every selector
// below is checked by hand against the current markup, not by running it.
//
// RUN (needs `npm run dev` on :5174 — samo-dev — and Chrome or Chromium):
//   node tools/browser/a11y-sweep.mjs
//   OUT=/tmp/x CHROME=/usr/bin/chromium node tools/browser/a11y-sweep.mjs
//
// samo-dev holds an UNMASKED copy of real student data (decision D1) — this
// script never prints row contents, only counts, rule ids and CSS selectors.
// Any throwaway account it creates is ALWAYS deleted in a finally.
// ============================================================
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadEnv, resolveTarget, runSql } from '../env-lib.mjs';

const DEV_URL = process.env.DEV_URL || 'http://localhost:5174';
const OUT = process.env.OUT || mkdtempSync(join(tmpdir(), 'a11y-sweep-'));
const CHROME = process.env.CHROME || '/usr/bin/google-chrome';
const PORT = Number(process.env.PORT || 9346);
const USER = `claudea11y${Date.now().toString(36)}`;
const PASS = `t-${Math.random().toString(36).slice(2)}-Aa1`;

const loaded = loadEnv();
const devTarget = resolveTarget({
  ...loaded,
  env: { ...loaded.env, VITE_SUPABASE_URL: loaded.fileEnv.SUPABASE_DEV_URL, SUPABASE_ACCESS_TOKEN: loaded.fileEnv.SUPABASE_DEV_ACCESS_TOKEN },
});
if (!devTarget.isDev || !devTarget.token) {
  console.error(`refusing: the database target is "${devTarget.label}", not samo-dev`);
  process.exit(1);
}
console.error(`→ project: ${devTarget.ref} (${devTarget.label}) · app: ${DEV_URL} · out: ${OUT}`);
const sql = async (q) => JSON.parse(await runSql(q, devTarget));
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;
mkdirSync(OUT, { recursive: true });

// ── routes ──────────────────────────────────────────────────────────────────
// Mirrors PATH_ROUTES in src/js/main.js. Dynamic routes (/news/<id>,
// /tools/<slug>) are OUT OF SCOPE — each depends on content that may not
// exist on samo-dev, and the static pages they share a renderer with
// (/news, /tools) already exercise the same components.
const PUBLIC_ROUTES = [
  ['/', 'home'],
  ['/news', 'announcements'],
  ['/pr', 'pr form'],
  ['/vssound', 'vitalsound'],
  ['/shop', 'shop'],
  ['/tools', 'tools'],
  ['/tools/golden-period', 'golden period'],
  ['/departments', 'departments'],
  ['/team', 'about/team'],
  ['/projects-view', 'projects view'],
  ['/updates', 'updates'],
  ['/me', 'me'],
];

// data-admin-side values from SECTION_META in src/js/admin-main.js. All of
// them — a sweep is cheap, and there is no owner-authored "main panes"
// shortlist to narrow it to (checked HANDOFF + STATE.md, 2026-10-20).
const ADMIN_PANES = [
  'landing', 'pr', 'vs', 'shop', 'projects', 'creator', 'order',
  'team', 'house', 'analytics', 'claude', 'discordbot', 'accounts', 'deptpage',
];

const WIDTHS = [
  { width: 390, height: 844, deviceScaleFactor: 2, mobile: true, label: '390px' },
  { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false, label: '1280px' },
];

// ── probe code injected into the page on every navigation ──────────────────
// Kept as a plain string (not a function) because it is evaluated through
// Page.addScriptToEvaluateOnNewDocument, which runs BEFORE any page script —
// axe-core must be present before axe.run() is ever called, including on the
// very first paint of the very first route.
const PROBE_SRC = `
window.__a11y = {
  overflow() {
    return document.documentElement.scrollWidth > window.innerWidth + 1;
  },
  // Primary actions = things a student would actually tap: buttons, links,
  // and form controls that are VISIBLE (a non-zero box) and not inert. A
  // plain <a> inside running prose (a <p>, <li>, <small> with no button-ish
  // class/role) is excluded — WCAG target-size applies to CONTROLS, and
  // counting every inline citation link would make this check meaningless
  // noise on the announcement/about pages.
  tapTargets() {
    const sel = 'button, .btn, a.nav-link, a.dropdown-item, [role="button"], ' +
      'input[type="submit"], input[type="button"], input[type="checkbox"], ' +
      'input[type="radio"], a[data-bs-target], a[data-dept-tool-tab]';
    const out = [];
    document.querySelectorAll(sel).forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return; // hidden/collapsed — not a tap-target bug
      if (getComputedStyle(el).visibility === 'hidden') return;
      if (Math.min(r.width, r.height) < 44) {
        out.push({
          tag: el.tagName.toLowerCase(),
          cls: (el.className || '').toString().slice(0, 60),
          w: Math.round(r.width), h: Math.round(r.height),
          text: (el.textContent || el.getAttribute('aria-label') || el.getAttribute('title') || '').trim().slice(0, 30),
        });
      }
    });
    return out;
  },
  // Spot-checks the first N interactive elements: focus it, read the
  // computed outline/box-shadow, blur it, read again — flagged only when
  // NEITHER changes (i.e. there is no focus indicator AT ALL, not merely a
  // subtle one this probe can't judge).
  async focusVisibleSample(n = 25) {
    const els = [...document.querySelectorAll(
      'button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    )].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && !el.disabled;
    }).slice(0, n);
    const active = document.activeElement;
    const missing = [];
    for (const el of els) {
      el.focus({ preventScroll: true });
      const focused = getComputedStyle(el);
      const focusedSig = focused.outlineStyle + focused.outlineWidth + focused.boxShadow;
      el.blur();
      const blurred = getComputedStyle(el);
      const blurredSig = blurred.outlineStyle + blurred.outlineWidth + blurred.boxShadow;
      if (focusedSig === blurredSig) {
        missing.push({ tag: el.tagName.toLowerCase(), cls: (el.className || '').toString().slice(0, 60) });
      }
    }
    if (active && active.focus) active.focus({ preventScroll: true });
    return { checked: els.length, missing };
  },
};
`;
// Modal focus-trap is DELIBERATELY NOT in PROBE_SRC above, unlike every other
// check. A page-level `el.dispatchEvent(new KeyboardEvent('keydown', {key:
// 'Tab'}))` is synthetic — the browser does not run its native "move focus to
// the next tabbable element" default action for a script-dispatched event,
// only for a REAL key press. Bootstrap's own focus trap only intercepts the
// EDGE case (wrapping at the first/last element); every tab press in between
// relies on the browser's native traversal. A synthetic dispatch would leave
// `document.activeElement` unchanged on every iteration, and "focus never
// left the modal" would read as a PASS whether or not a trap exists at all —
// exactly mistakes.md's "a probe that only asserts X cannot tell a working
// guard from a broken one". Real Tab presses need CDP's Input domain, which
// only the driver (not in-page script) can call — see checkModalFocusTrap
// below.

mkdirSync(OUT, { recursive: true });
const axeSrc = readFileSync(new URL('../../node_modules/axe-core/axe.min.js', import.meta.url), 'utf8');
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${mkdtempSync(join(tmpdir(), 'a11y-sweep-chrome-'))}`], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws; let id = 0; const pend = {}; let errs = []; let failed = 0;
const results = [];
const say = (label, v, ok = true) => { if (!ok) failed += 1; console.log(`${ok ? '✓' : '✗'} ${label}: ${v}`); };
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pend[i] = res; ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (e) => (await send('Runtime.evaluate', { expression: `(async()=>{try{${e}}catch(err){return 'ERR '+err.message}})()`, awaitPromise: true, returnByValue: true })).result?.value;
const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }); writeFileSync(join(OUT, name), Buffer.from(r.data, 'base64')); };
// A REAL Tab key press via CDP's Input domain — not a page-level synthetic
// DOM event (see the long comment above PROBE_SRC for why that would make
// the trap check pass vacuously). windowsVirtualKeyCode 9 = Tab; Chrome needs
// both rawKeyDown and keyUp for the native "move focus" default action to run.
const pressTab = async () => {
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', windowsVirtualKeyCode: 9, code: 'Tab', key: 'Tab' });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 9, code: 'Tab', key: 'Tab' });
};

// Opens a modal via its trigger, checks focus moved IN, that 30 REAL Tab
// presses never move focus outside it (Escape has no native browser default
// action to replicate, so a synthetic dispatch for THAT key is fine — only
// Tab's native focus traversal needed the Input domain), then closes it and
// checks focus RETURNED to the trigger.
async function checkModalFocusTrap(triggerSel, modalId) {
  const opened = JSON.parse(await ev(`
    const t = document.querySelector(${JSON.stringify(triggerSel)});
    if (!t) return JSON.stringify({ skipped: 'trigger not found' });
    t.click();
    await new Promise((r) => setTimeout(r, 700));
    const m = document.getElementById(${JSON.stringify(modalId)});
    if (!m || !m.classList.contains('show')) return JSON.stringify({ skipped: 'modal did not open' });
    return JSON.stringify({ insideOnOpen: m.contains(document.activeElement) });
  `) || '{}');
  if (opened.skipped) return opened;
  let stayedInside = true;
  for (let i = 0; i < 30; i += 1) {
    await pressTab();
    await sleep(60);
    const inside = await ev(`return document.getElementById(${JSON.stringify(modalId)})?.contains(document.activeElement) ?? false;`);
    if (!inside) { stayedInside = false; break; }
  }
  await ev(`document.getElementById(${JSON.stringify(modalId)})?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); return 1;`);
  await sleep(600);
  const after = JSON.parse(await ev(`
    const m = document.getElementById(${JSON.stringify(modalId)});
    const t = document.querySelector(${JSON.stringify(triggerSel)});
    return JSON.stringify({ closed: !m || !m.classList.contains('show'), focusReturned: document.activeElement === t });
  `) || '{}');
  return { insideOnOpen: opened.insideOnOpen, stayedInside, closed: after.closed, focusReturned: after.focusReturned };
}

// One page run: navigate, settle, run every check, collect console errors
// since the LAST reset (done right before Page.navigate below).
async function sweepRoute(path, label, { signedIn, widthLabel, screenshot }) {
  errs = [];
  await send('Page.navigate', { url: `${DEV_URL}${path}` });
  // Boot (first load compiles the whole SPA in Vite) + the route's own lazy
  // imports (d3/Quill/shop) — generous and polled, never a bare sleep for
  // the FIRST page; subsequent same-session navigations settle faster but
  // get the same budget for simplicity and because a flaky slow one is worse
  // than a sweep that takes longer.
  let booted = false;
  for (let i = 0; i < 40 && !booted; i += 1) {
    await sleep(500);
    booted = await ev(`return !!window.__samoBooted;`);
  }
  await sleep(1500); // the route's own content paint, after boot
  const raw = await ev(`
    const v = await window.axe.run(document, { resultTypes: ['violations'] });
    const violations = v.violations.map((x) => ({ id: x.id, impact: x.impact, help: x.help, nodes: x.nodes.length }));
    const overflow = window.__a11y.overflow();
    const tap = window.__a11y.tapTargets();
    const focus = await window.__a11y.focusVisibleSample();
    return JSON.stringify({ violations, overflow, tap, focus, booted: window.__samoBooted });
  `);
  let parsed;
  try { parsed = JSON.parse(raw); } catch { parsed = { parseError: raw }; }
  const record = {
    path, label, signedIn, width: widthLabel,
    booted, violations: parsed.violations || [], overflow: parsed.overflow,
    tapTargetsUnder44: (parsed.tap || []).length, tapSample: (parsed.tap || []).slice(0, 5),
    focusMissing: parsed.focus?.missing?.length ?? null, focusChecked: parsed.focus?.checked ?? 0,
    consoleErrors: [...errs],
  };
  results.push(record);
  say(`${label} [${widthLabel}] ${signedIn ? 'signed-in' : 'signed-out'}`,
    `booted=${booted} violations=${record.violations.length} overflow=${record.overflow} tapUnder44=${record.tapTargetsUnder44} focusMissing=${record.focusMissing}/${record.focusChecked} consoleErrors=${record.consoleErrors.length}`,
    booted);
  if (screenshot) await shot(`${label.replace(/[^a-z0-9-]+/gi, '-')}-${widthLabel}-${signedIn ? 'in' : 'out'}.png`);
}

async function sweepAdminPane(side, { widthLabel }) {
  errs = [];
  await send('Page.navigate', { url: `${DEV_URL}/admin/#${side}` });
  let painted = false;
  for (let i = 0; i < 40 && !painted; i += 1) {
    await sleep(500);
    painted = await ev(`return !document.getElementById('adminAppRoot')?.classList.contains('d-none')
      && !!document.querySelector('#adminSideNav [data-admin-side="${side}"]');`);
  }
  await sleep(1500);
  const raw = await ev(`
    const v = await window.axe.run(document, { resultTypes: ['violations'] });
    const violations = v.violations.map((x) => ({ id: x.id, impact: x.impact, help: x.help, nodes: x.nodes.length }));
    const overflow = window.__a11y.overflow();
    const tap = window.__a11y.tapTargets();
    const focus = await window.__a11y.focusVisibleSample();
    const sideVisible = !document.querySelector('#adminSideNav [data-admin-side="${side}"]')?.classList.contains('d-none');
    const paneOpen = !document.querySelector('[data-admin-pane="${side === 'pr' || side === 'vs' || side === 'shop' ? 'admin' : side}"]')?.classList.contains('d-none');
    return JSON.stringify({ violations, overflow, tap, focus, sideVisible, paneOpen });
  `);
  let parsed;
  try { parsed = JSON.parse(raw); } catch { parsed = { parseError: raw }; }
  const record = {
    path: `/admin/#${side}`, label: `admin:${side}`, signedIn: true, width: widthLabel,
    painted, sideVisible: parsed.sideVisible, paneOpen: parsed.paneOpen,
    violations: parsed.violations || [], overflow: parsed.overflow,
    tapTargetsUnder44: (parsed.tap || []).length, tapSample: (parsed.tap || []).slice(0, 5),
    focusMissing: parsed.focus?.missing?.length ?? null, focusChecked: parsed.focus?.checked ?? 0,
    consoleErrors: [...errs],
  };
  results.push(record);
  say(`admin:${side} [${widthLabel}]`,
    `painted=${painted} side=${record.sideVisible} pane=${record.paneOpen} violations=${record.violations.length} overflow=${record.overflow} tapUnder44=${record.tapTargetsUnder44} focusMissing=${record.focusMissing}/${record.focusChecked}`,
    painted && record.sideVisible !== false);
}

try {
  for (let i = 0; i < 30 && !ws; i += 1) {
    try {
      const t = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
      ws = new WebSocket(t.webSocketDebuggerUrl);
    } catch { await sleep(300); }
  }
  await new Promise((r) => { ws.onopen = r; });
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (pend[d.id]) { pend[d.id](d.result); delete pend[d.id]; }
    if (d.method === 'Runtime.exceptionThrown') errs.push(d.params.exceptionDetails?.exception?.description?.split('\n')[0]);
    if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') errs.push(d.params.args.map((a) => a.value || a.description).join(' ').slice(0, 200));
  };
  await send('Runtime.enable'); await send('Page.enable');
  // axe + the probe BEFORE any page script, every navigation — never
  // re-injected per-route (see header comment).
  await send('Page.addScriptToEvaluateOnNewDocument', { source: axeSrc + '\n' + PROBE_SRC });

  // ── SIGNED OUT — every public route, both widths ─────────────────────────
  for (const metrics of WIDTHS) {
    await send('Emulation.setDeviceMetricsOverride', metrics);
    for (const [path, label] of PUBLIC_ROUTES) {
      await sweepRoute(path, label, { signedIn: false, widthLabel: metrics.label, screenshot: metrics.width === 390 });
    }
  }

  // ── admin root, signed out (the gate screen) ─────────────────────────────
  for (const metrics of WIDTHS) {
    await send('Emulation.setDeviceMetricsOverride', metrics);
    errs = [];
    await send('Page.navigate', { url: `${DEV_URL}/admin/` });
    await sleep(4000);
    const raw = await ev(`
      const v = await window.axe.run(document, { resultTypes: ['violations'] });
      return JSON.stringify({ violations: v.violations.map((x) => ({ id: x.id, impact: x.impact })), gate: !document.getElementById('adminAuthGate')?.classList.contains('d-none') });
    `);
    let parsed; try { parsed = JSON.parse(raw); } catch { parsed = {}; }
    results.push({ path: '/admin/', label: 'admin gate', signedIn: false, width: metrics.label, violations: parsed.violations || [], consoleErrors: [...errs] });
    say(`admin gate [${metrics.label}]`, `shown=${parsed.gate} violations=${(parsed.violations || []).length}`, parsed.gate === true);
  }

  // ── sign-in modal focus trap, signed out, desktop ────────────────────────
  await send('Emulation.setDeviceMetricsOverride', WIDTHS[1]);
  await send('Page.navigate', { url: `${DEV_URL}/` }); await sleep(4000);
  const signinTrap = await checkModalFocusTrap('[data-bs-target="#signinModal"]', 'signinModal');
  say('sign-in modal: focus trap + return', JSON.stringify(signinTrap),
    signinTrap.insideOnOpen && signinTrap.stayedInside && signinTrap.closed && signinTrap.focusReturned);

  // ── throwaway account, signed in ──────────────────────────────────────────
  const uid = await ev(`const a = await import('/src/js/auth.js'); await a.registerWithPassword(${JSON.stringify(USER)}, ${JSON.stringify(PASS)}); await new Promise(r=>setTimeout(r,1500)); return a.getUser()?.id || 'no user';`);
  say('throwaway account', uid, /^[0-9a-f-]{36}$/.test(uid || ''));
  if (!/^[0-9a-f-]{36}$/.test(uid || '')) throw new Error(`register failed: ${uid}`);
  // master folds every admin desk — see master-grants-all-project-seats; it
  // is the ONLY grant that reaches every ADMIN_PANES entry with one account.
  await sql(`update public.users set permissions = array['master'] where id = ${lit(uid)};`);
  await send('Page.navigate', { url: `${DEV_URL}/` }); await sleep(4000);
  await ev(`const a = await import('/src/js/auth.js'); await a.signOut().catch(()=>{}); await a.signInWithPassword(${JSON.stringify(USER)}, ${JSON.stringify(PASS)}); await new Promise(r=>setTimeout(r,2000)); return 1;`);

  // ── SIGNED IN — every public route, both widths ──────────────────────────
  for (const metrics of WIDTHS) {
    await send('Emulation.setDeviceMetricsOverride', metrics);
    for (const [path, label] of PUBLIC_ROUTES) {
      await sweepRoute(path, label, { signedIn: true, widthLabel: metrics.label, screenshot: false });
    }
  }

  // ── ADMIN PANES, signed in as master, both widths ────────────────────────
  for (const metrics of WIDTHS) {
    await send('Emulation.setDeviceMetricsOverride', metrics);
    for (const side of ADMIN_PANES) {
      await sweepAdminPane(side, { widthLabel: metrics.label });
    }
  }

  // ── summary: violations by rule, across every page just swept ────────────
  const byRule = new Map();
  for (const r of results) {
    for (const v of r.violations || []) {
      const k = v.id;
      if (!byRule.has(k)) byRule.set(k, { impact: v.impact, help: v.help, routes: new Set(), nodes: 0 });
      const e = byRule.get(k);
      e.routes.add(`${r.label}[${r.width}]${r.signedIn ? '+in' : ''}`);
      e.nodes += v.nodes;
    }
  }
  console.log('\n── violations by rule ──');
  for (const [rule, e] of [...byRule.entries()].sort((a, b) => b[1].nodes - a[1].nodes)) {
    console.log(`${rule} (${e.impact}) — ${e.nodes} node(s) across ${e.routes.size} route(s): ${[...e.routes].join(', ')}`);
  }
  console.log(`\ntotal distinct rules violated: ${byRule.size}`);
  writeFileSync(join(OUT, 'results.json'), JSON.stringify(results, null, 2));
  console.log(`\nfull results: ${join(OUT, 'results.json')}`);

  say('console errors across the whole sweep', results.reduce((n, r) => n + (r.consoleErrors?.length || 0), 0),
    results.every((r) => !r.consoleErrors || r.consoleErrors.length === 0));
} catch (e) {
  failed += 1;
  console.log(`✗ driver error: ${e.stack || e}`);
} finally {
  try {
    const [left] = await sql(`delete from public.users where username = ${lit(USER)};
      delete from auth.users where email = ${lit(`${USER}@samomdkku.app`)};
      select (select count(*) from auth.users where email = ${lit(`${USER}@samomdkku.app`)}) accounts;`);
    say('cleanup: accounts left', left?.accounts ?? '?', String(left?.accounts) === '0');
  } catch (e) { failed += 1; console.log(`✗ cleanup FAILED — remove ${USER} by hand: ${e.message}`); }
  try { ws?.close(); } catch { /* */ }
  chrome.kill();
  console.log(`\n${failed ? `${failed} FAILED` : 'all passed'} · screenshots + results.json: ${OUT}`);
  process.exit(failed ? 1 : 0);
}
