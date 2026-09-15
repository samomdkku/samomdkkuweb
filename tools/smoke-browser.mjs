#!/usr/bin/env node
// ============================================================
// smoke-browser.mjs — load a DEPLOYED build in a real browser and assert the
// handful of things that, when broken, make the whole site useless.
//
//   node tools/smoke-browser.mjs https://samo.md.kku.ac.th
//   node tools/smoke-browser.mjs <preview-url> --expect-ribbon
//   npm run smoke:browser -- https://samo.md.kku.ac.th
//
// WHY A BROWSER AND NOT A `curl`. Every check here is invisible to a fetch of
// the HTML, and each one is a bug this repo has actually shipped:
//
//   · **The entry module never ran.** THE failure mode for this app. Bootstrap
//     comes from a CDN, so every menu still opens and the page looks alive
//     while ~90 inline `onclick="global()"` handlers are dead. A `curl` sees a
//     200 and correct HTML. Cause is any failed fetch of the entry bundle — a
//     >7-day-old cached HTML naming a pruned chunk, flaky wifi, an extension.
//   · **The boot watchdog firing on a HEALTHY load.** Its first version used a
//     bare 8s timer and shouted at people whose connection was merely slow.
//     "No warning bar on a good load" is a real regression check, and only a
//     browser can make it.
//   · **The env ribbon's polarity.** A preview must SAY it is not the live
//     site; production must not. Grepping cannot answer this — a grep for
//     "preview" hits an unrelated announcements button, and the ribbon is
//     appended by JS at runtime. The rendered DOM is the only instrument.
//   · **Horizontal overflow on a phone.** Most of this app's traffic.
//
// NO CREDENTIALS. It loads the site the way an anonymous visitor does, so it
// needs no key, no session and no secret — which is why it is safe to run
// anywhere, including on a public repo's CI. It therefore tests the LOGGED-OUT
// surface only; anything behind sign-in needs `skills/drive-the-browser.md`.
//
// PROVEN END TO END (2026-08-29): 9/9 against production, 9/9 against a live
// preview, 9/9 from CI on a throwaway PR where the job found the preview URL by
// itself — and falsified four ways (production asked for a ribbon fails, a
// preview asked for none fails, a non-app page fails both boot checks, exit
// code 1). A CI job that has never fired is not a guard.
//
// NO DEPENDENCIES. Chrome over CDP using Node's global WebSocket
// (`skills/drive-the-browser.md` §1). GitHub's ubuntu-latest runners ship
// Google Chrome, so this needs no install step.
// ============================================================
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

const args = process.argv.slice(2);
const URL_ = args.find((a) => !a.startsWith('--'));
const EXPECT_RIBBON = args.includes('--expect-ribbon');
const NO_RIBBON = args.includes('--expect-no-ribbon');

if (!URL_) {
  console.error('usage: node tools/smoke-browser.mjs <url> [--expect-ribbon|--expect-no-ribbon]');
  process.exit(2);
}

const CHROME = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
].find((p) => existsSync(p));

if (!CHROME) {
  console.error('no Chrome found — install Google Chrome or Chromium');
  process.exit(2);
}

// Random, not pid-derived: two concurrent local runs landed on the same
// port often enough to matter (pid % 100 collides once in 100).
const PORT = 9411 + Math.floor(Math.random() * 400);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass += 1; console.log('  PASS', name); }
  else { fail += 1; console.log('  FAIL', name, detail ? `— ${String(detail).slice(0, 200)}` : ''); }
};

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, '--no-first-run', '--no-sandbox',
  '--disable-gpu', '--disable-dev-shm-usage', '--hide-scrollbars',
  `--user-data-dir=/tmp/samo-smoke-${process.pid}`, 'about:blank',
], { stdio: 'ignore' });

async function wsUrl() {
  for (let i = 0; i < 80; i += 1) {
    try {
      const j = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
      if (j.webSocketDebuggerUrl) return j.webSocketDebuggerUrl;
    } catch { /* not up yet */ }
    await sleep(250);
  }
  throw new Error('Chrome did not expose a debugging port');
}

const ws = new WebSocket(await wsUrl());
await new Promise((r) => ws.addEventListener('open', r, { once: true }));

let id = 0;
const pending = new Map();
const consoleErrors = [];
const failedRequests = [];
const requestUrls = new Map();

ws.addEventListener('message', (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
  if (msg.method === 'Runtime.exceptionThrown') {
    consoleErrors.push(msg.params.exceptionDetails?.text
      || msg.params.exceptionDetails?.exception?.description || 'exception');
  }
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
    consoleErrors.push(msg.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
  }
  // A failed fetch of the ENTRY BUNDLE is the cause of the dead-page bug, and
  // it is silent in the console on some browsers. Watch the network directly.
  if (msg.method === 'Network.loadingFailed') {
    const url = requestUrls.get(msg.params.requestId) || '';
    failedRequests.push({ url, type: msg.params.type, why: msg.params.errorText });
  }
  if (msg.method === 'Network.requestWillBeSent') {
    requestUrls.set(msg.params.requestId, msg.params.request.url);
  }
});

const send = (method, params = {}, sessionId) => new Promise((res) => {
  const i = (id += 1);
  pending.set(i, res);
  ws.send(JSON.stringify({ id: i, method, params, ...(sessionId ? { sessionId } : {}) }));
});

const { result: { targetId } } = await send('Target.createTarget', { url: 'about:blank' });
const { result: { sessionId } } = await send('Target.attachToTarget', { targetId, flatten: true });
await send('Page.enable', {}, sessionId);
await send('Runtime.enable', {}, sessionId);
await send('Network.enable', {}, sessionId);

const evalJs = async (expression) => {
  const r = await send('Runtime.evaluate',
    { expression, awaitPromise: true, returnByValue: true }, sessionId);
  return r.result?.result?.value;
};

console.log(`\nsmoke: ${URL_}\n`);

// Phone first — it is most of this app's traffic, and the width where layout
// faults actually appear.
await send('Emulation.setDeviceMetricsOverride',
  { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }, sessionId);
await send('Page.navigate', { url: URL_ }, sessionId);

// Wait for the ENTRY MODULE, not for a timer. `window.__samoBooted` is the same
// signal the in-page watchdog uses, so this asks the page's own question.
let booted = false;
for (let i = 0; i < 60 && !booted; i += 1) {
  booted = (await evalJs('window.__samoBooted === true')) === true;
  if (!booted) await sleep(500);
}
await sleep(1500);   // let the watchdog's own timer have its chance to fire

const probe = await evalJs(`(() => ({
  booted: window.__samoBooted === true,
  title: document.title,
  bootFailBar: !!document.getElementById('samoBootFail'),
  ribbon: (document.querySelector('.samo-env-ribbon') || {}).textContent || null,
  scrollW: document.documentElement.scrollWidth,
  clientW: document.documentElement.clientWidth,
  visibleText: (document.body.innerText || '').trim().length,
  handlers: ['samoSignOut', 'goToAbout', 'navigateTo', 'activateTab']
    .filter((n) => typeof window[n] === 'function'),
  inlineOnclicks: document.querySelectorAll('[onclick]').length,
}))()`);

// 1. THE headline check: the module graph ran. Everything inline depends on it.
check('the entry module ran (window.__samoBooted)', probe.booted === true,
  'the page will look alive and every inline onclick will be dead');

// 2. The inline handlers those onclicks call actually exist.
check(`window-bound handlers exist (${probe.handlers.length}/4)`,
  probe.handlers.length === 4,
  `missing: ${['samoSignOut', 'goToAbout', 'navigateTo', 'activateTab'].filter((n) => !probe.handlers.includes(n)).join(', ')}`);

// 3. The watchdog must NOT accuse a HEALTHY load. Its first version did — a
//    bare 8s timer that shouted at anyone on a slow connection.
//
//    ⚠️ Only meaningful when the page actually booted. Asserting it
//    unconditionally printed "the watchdog fired on a page that booted — it is
//    crying wolf again" over a page that had NOT booted, where the watchdog was
//    doing exactly its job. A diagnostic that names the wrong culprit sends the
//    reader to the wrong file; this repo has paid for that shape more than once.
if (probe.booted) {
  check('no boot-failure bar on a healthy load', probe.bootFailBar === false,
    'the watchdog fired on a page that booted — it is crying wolf again');
} else {
  console.log('  n/a   boot-failure bar — the page did not boot, so the bar is CORRECT'
    + ` (present: ${probe.bootFailBar})`);
}

// 4. Something was actually painted.
check('the page rendered real content', probe.visibleText > 200,
  `only ${probe.visibleText} characters of visible text`);

// 5. No horizontal scroll at 390px.
check('no horizontal overflow at 390px', probe.scrollW <= probe.clientW + 1,
  `scrollWidth ${probe.scrollW} > clientWidth ${probe.clientW}`);

// 6. The ribbon says which world this is — only when asked.
if (EXPECT_RIBBON) {
  check('a non-production build says so on the page', Boolean(probe.ribbon),
    'no .samo-env-ribbon — a developer cannot tell this from the live site');
} else if (NO_RIBBON) {
  check('production paints NO env ribbon', probe.ribbon === null,
    `ribbon present: ${probe.ribbon}`);
}

// 7. OUR assets must load. A THIRD PARTY's must not fail the build.
//
// ⚠️ THIS CHECK USED TO BE THE WHOLE ORIGIN. That made a CI gate whose red
// depended on jsDelivr, cdn.quilljs.com and fonts.googleapis.com all being
// reachable from a GitHub runner at that moment — a warning that fires on the
// healthy case, which this repo has already paid for twice and which this very
// file's header cites. A third-party hiccup is now REPORTED, not failed: it is
// worth seeing (Bootstrap failing to load is a real, visible degradation) but
// it is not evidence that the change under test is broken.
const ourOrigin = new URL(URL_).origin;
const isOurs = (f) => !f.url || f.url.startsWith(ourOrigin) || f.url.startsWith('/');
const fmt = (f) => `${f.type}: ${f.why} ${f.url}`.trim();
const relevant = failedRequests.filter((f) => /Script|Stylesheet|Document/i.test(f.type));
const ours = relevant.filter(isOurs);
const theirs = relevant.filter((f) => !isOurs(f));

check('none of OUR scripts or stylesheets failed to load', ours.length === 0,
  ours.map(fmt).join(' | '));
if (theirs.length) {
  console.log(`  note  ${theirs.length} third-party asset(s) failed — not counted as a failure:`);
  for (const f of theirs.slice(0, 4)) console.log(`          ${fmt(f)}`);
}

// Console errors get the same treatment for the same reason: a CDN 404 or a
// blocked font logs an error that says nothing about this change.
const ourErrors = consoleErrors.filter((e) => !/cdn\.|fonts\.googleapis|googletagmanager|gstatic/i.test(e));
check('no uncaught errors from our own code', ourErrors.length === 0,
  ourErrors.slice(0, 3).join(' | '));
if (consoleErrors.length > ourErrors.length) {
  console.log(`  note  ${consoleErrors.length - ourErrors.length} third-party console error(s), not counted`);
}

// 8. Desktop too — one width proves nothing about the other.
await send('Emulation.setDeviceMetricsOverride',
  { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);
await sleep(800);
const wide = await evalJs('({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth })');
check('no horizontal overflow at 1280px', wide.s <= wide.c + 1, `${wide.s} > ${wide.c}`);

// 9. A ฝ่าย TOOL FRAME, on the DEPLOYED build. docs/DEPT-TOOLS.md §3.
//
// Three things no unit test can answer, because all three are properties of a
// real cross-origin frame in a real layout engine:
//
//   · the sandbox that SHIPPED — the unit test asserts the renderer's output,
//     this asserts the attribute a browser actually parsed out of the bundle;
//   · the height channel completed — a postMessage crossed an opaque origin
//     and the host released its CSS floor. In jsdom there is no frame at all;
//   · **the reported height does not follow the FRAME.** The first version of
//     the starter reported `documentElement.scrollHeight`, which inside a
//     frame is the frame's own height — so it measured the container in order
//     to size the container, could never shrink, and left ~160px of dead space
//     under short content. Nothing on the DOM side could see it; opening the
//     page could. The property is that the same tool reports the SAME height
//     at two viewport heights, and it is falsifiable in one line.
//
// The slug comes from the registry, never typed here: a hardcoded subject that
// rots is one of this repo's named guard failures.
const { embedTools } = await import('../src/data/tools.js');
const embed = embedTools()[0];
if (!embed) {
  console.log('  note  no kind:\'embed\' tools in the registry — frame checks skipped');
} else {
  const frameUrl = `${URL_.replace(/\/$/, '')}/tools/${embed.slug}`;
  const measure = async (h) => {
    await send('Emulation.setDeviceMetricsOverride',
      { width: 1280, height: h, deviceScaleFactor: 1, mobile: false }, sessionId);
    await send('Page.navigate', { url: frameUrl }, sessionId);
    await sleep(3000);
    return evalJs(`(() => {
      const f = document.getElementById('toolFrame');
      if (!f) return null;
      return {
        sandbox: f.getAttribute('sandbox') || '',
        src: f.getAttribute('src'),
        height: Math.round(f.getBoundingClientRect().height),
        floorReleased: f.style.minHeight === '0' || f.style.minHeight === '0px',
      };
    })()`);
  };

  const tall = await measure(900);
  check(`the tool frame rendered at /tools/${embed.slug}`, tall !== null,
    'no #toolFrame in the DOM — the embed route did not reach the frame host');

  if (tall) {
    check('the SHIPPED frame has no allow-same-origin', !tall.sandbox.includes('allow-same-origin'),
      `sandbox="${tall.sandbox}" — the frame is back on the site's origin and can `
      + 'read the session, the parent DOM and cookies. That word is the whole model');
    check('the frame is sandboxed at all', tall.sandbox.includes('allow-scripts'),
      `sandbox="${tall.sandbox}"`);
    check('the height channel crossed the opaque origin', tall.floorReleased === true,
      'the host never released its CSS floor, so no usable height message arrived — '
      + 'the tool is stuck at 70vh and scrolls internally');

    const short = await measure(400);
    check('the reported height follows the CONTENT, not the frame',
      short !== null && short.height === tall.height,
      `${tall.height}px in a 900px viewport but ${short?.height}px in a 400px one — `
      + 'the tool is measuring documentElement (which IS the frame) instead of body');
  }
}

// ── THE ADMIN ENTRY ────────────────────────────────────────────────────────
//
// ⚠️ ADDED 2026-09-02 AFTER NOTICING NOTHING COVERED IT. Everything above loads
// the PUBLIC entry. The admin entry is a separate bundle — 537 KB, most of this
// app's code — and no browser check touched it, so a module-level throw there
// would have been invisible to every guard in the repo: `npm test` runs in
// jsdom with no bundle, `npm run build` only proves it COMPILES, and grepping
// the served file only proves a string is present.
//
// That gap was found the day a static import was added to `dept-page-admin.js`
// and the honest answer to "did you load the page?" was no.
//
// It is checked SIGNED OUT, which is the point: the entry module must parse and
// run before the sign-in gate can render, so a boot failure shows up here
// without any credential. If the module throws, `__samoBooted` stays false and
// the gate never appears — the "dead and animated" page this repo has shipped
// before, where Bootstrap's CDN keeps the menus opening while every handler is
// gone.
{
  const adminUrl = `${URL_.replace(/\/$/, '')}/admin/`;
  await send('Emulation.setDeviceMetricsOverride',
    { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);
  await send('Page.navigate', { url: adminUrl }, sessionId);
  await sleep(6000);
  const admin = await evalJs(`(() => ({
    booted: !!window.__samoBooted,
    gate: !!document.querySelector('#authGate, #signinModal'),
    overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
  }))()`);
  check('the ADMIN entry module ran (window.__samoBooted)',
    admin !== null && admin.booted === true,
    'the admin bundle did not finish executing — signed out or not, a page whose '
    + 'entry module threw is dead while Bootstrap keeps it looking alive');
  check('the admin sign-in gate rendered', admin !== null && admin.gate === true,
    'no gate and no session: the shell booted but painted nothing to act on');
  check('no horizontal overflow on the admin shell',
    admin !== null && admin.overflow === false);
}

// ── THE PASSPORT ADMIN'S IMAGE-UPLOAD CONTROLS ──────────────────────────────
// Reported 2026-09-15: "the upload badge image button of samopassport is gone."
// It had been gone since the 2026-09-04 merge, and NOTHING could see it:
// `npm test` passed, `npm run build` passed, the HTML was byte-correct and the
// string "⬆️ Upload" was still in the shipped bundle. The button is INJECTED by
// wireUpload(), which returned early because the Drive endpoint came only from
// `VITE_GAS_UPLOAD_URL` — a gitignored value that did not survive the merge, in
// a directory vite was also using as its envDir. `import.meta.env` compiled to
// `{}` and three fields lost their control at once.
//
// So the instrument has to be the RENDERED DOM of the DEPLOYED build. This runs
// SIGNED OUT on purpose: init() wires the uploads at page load, before the login
// gate decides anything, so the buttons are assertable with no credential.
// Falsified against production on the day of the fix: 0 buttons there, 3 on the
// fixed build, same script.
{
  const passportAdmin = `${URL_.replace(/\/$/, '')}/passport/html/admin.html`;
  await send('Page.navigate', { url: passportAdmin }, sessionId);
  await sleep(6000);
  const pa = await evalJs(`(() => ({
    fields: [...document.querySelectorAll('.upload-row input[type=url]')].map(i => i.id).sort(),
    buttons: document.querySelectorAll('button.upload-btn').length,
  }))()`);
  const want = ['act-badge-url', 'cert-bg-url', 'edit-badge-url'];
  check(`the passport admin has its ⬆️ Upload controls (${pa ? pa.buttons : '?'}/3)`,
    pa !== null && pa.buttons === 3 && JSON.stringify(pa.fields) === JSON.stringify(want),
    'wireUpload() painted nothing: the badge and certificate image fields have no '
    + 'upload button, so an admin can only paste a Drive link by hand. Almost '
    + 'always means the Drive endpoint did not resolve — see passport/js/upload.js.');
}

console.log(`\n${pass} passed, ${fail} failed  (${URL_})`);
ws.close();
chrome.kill();
process.exit(fail === 0 ? 0 : 1);
