#!/usr/bin/env node
// ============================================================
// accounts-dashboard.mjs — drive the บัญชีผู้ใช้ dashboard (0211) for real,
// SIGNED IN as a master, in headless Chrome, against the local dev server on
// samo-dev. Shape copied from shop-admin-strip.mjs.
//
// WHAT IT DOES, all on samo-dev (it REFUSES any other project):
//   1. registers a throwaway username account through the app's own
//      registerWithPassword (0234 installed production's auth.users triggers
//      on samo-dev, so the public.users row is created by the trigger — this
//      only grants it `master`, public.users.permissions);
//   2. opens /admin/#accounts and reads the RENDERED page: tiles, charts,
//      checks, rows — and that the account count on screen is the database's;
//   3. LIVE: moves its own last_sign_in_at in the database and waits for the
//      page to notice by itself (no reload, no click);
//   4. opens a row's detail; screenshots desktop + a 390px phone, and checks
//      the phone page does not scroll sideways;
//   5. ALWAYS deletes the account (auth + users), in a finally.
//
// RUN (needs `npm run dev` on :5174 — it uses samo-dev — and Chrome):
//   node tools/browser/accounts-dashboard.mjs
//   DEV_URL=http://localhost:5199 OUT=/tmp/x node tools/browser/accounts-dashboard.mjs
// ============================================================
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadEnv, resolveTarget, runSql } from '../env-lib.mjs';

const DEV_URL = process.env.DEV_URL || 'http://localhost:5174';
const OUT = process.env.OUT || mkdtempSync(join(tmpdir(), 'accounts-dash-'));
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9339;
const USER = `claudetest${Date.now().toString(36)}`;
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
console.error(`→ database: ${devTarget.ref} (${devTarget.label}) · app: ${DEV_URL} · out: ${OUT}`);
const sql = async (q) => JSON.parse(await runSql(q, devTarget));
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;

mkdirSync(OUT, { recursive: true });
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${mkdtempSync(join(tmpdir(), 'accounts-dash-chrome-'))}`], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws; let id = 0; const pend = {}; const errs = []; let failed = 0;
const say = (label, v, ok = true) => { if (!ok) failed += 1; console.log(`${ok ? '✓' : '✗'} ${label}: ${v}`); };

try {
  for (let i = 0; i < 30 && !ws; i += 1) {
    try {
      const t = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
      ws = new WebSocket(t.webSocketDebuggerUrl);
    } catch { await sleep(300); }
  }
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (pend[d.id]) { pend[d.id](d); delete pend[d.id]; }
    if (d.method === 'Runtime.exceptionThrown') errs.push(d.params.exceptionDetails?.exception?.description?.split('\n')[0]);
    if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') errs.push(d.params.args.map((a) => a.value || a.description).join(' ').slice(0, 200));
  };
  await new Promise((r) => { ws.onopen = r; });
  const ev = async (e) => (await send('Runtime.evaluate', { expression: `(async()=>{try{${e}}catch(err){return 'ERR '+err.message}})()`, awaitPromise: true, returnByValue: true })).result?.result?.value;
  const shot = async (name, full = true) => {
    const { result } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: full });
    writeFileSync(join(OUT, name), Buffer.from(result.data, 'base64'));
  };
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false });

  // 1. account + grant
  await send('Page.navigate', { url: `${DEV_URL}/` }); await sleep(6000);
  const uid = await ev(`const a = await import('/src/js/auth.js'); await a.registerWithPassword(${JSON.stringify(USER)}, ${JSON.stringify(PASS)});
    await a.signOut().catch(()=>{}); await a.signInWithPassword(${JSON.stringify(USER)}, ${JSON.stringify(PASS)}); await new Promise(r=>setTimeout(r,1500)); return a.getUser()?.id || 'no user';`);
  say('throwaway account', uid, /^[0-9a-f-]{36}$/.test(uid || ''));
  await sql(`update public.users set permissions = array['master'] where id = ${lit(uid)};`);
  await send('Page.navigate', { url: `${DEV_URL}/` }); await sleep(4000);
  await ev(`const a = await import('/src/js/auth.js'); await a.signOut().catch(()=>{}); await a.signInWithPassword(${JSON.stringify(USER)}, ${JSON.stringify(PASS)}); await new Promise(r=>setTimeout(r,2000)); return 1;`);

  // 2. the page
  await send('Page.navigate', { url: `${DEV_URL}/admin/#accounts` });
  // Wait on the page's OWN signal (the first load compiles the whole admin
  // app in Vite), then for the dashboard's first paint — never a bare sleep.
  let ready = null;
  for (let i = 0; i < 60 && !ready; i += 1) {
    await sleep(1000);
    ready = await ev(`return document.querySelector('#acctKpis .acct-kpi') ? 'painted' : null;`);
  }
  if (!ready) {
    console.log('  page state:', await ev(`const a = await import('/src/js/auth.js'); const u = a.getUser();
      return JSON.stringify({ booted: window.__samoBooted, user: !!u, perms: u?.permissions, managed: u?.managedPermissions,
        gate: !document.getElementById('adminAuthGate')?.classList.contains('d-none'), hash: location.hash,
        msg: document.getElementById('acctMsg')?.textContent });`));
  }
  const [{ n: dbCount }] = await sql('select count(*)::int n from auth.users');
  const page = JSON.parse(await ev(`return JSON.stringify({
    pane: !document.querySelector('[data-admin-pane="accounts"]').classList.contains('d-none'),
    side: !document.querySelector('#adminSideNav [data-admin-side="accounts"]').classList.contains('d-none'),
    live: document.getElementById('acctLiveMain').textContent,
    dot: document.getElementById('acctLiveDot').className,
    total: document.querySelector('#acctKpis .acct-kpi-num')?.textContent,
    tiles: document.querySelectorAll('#acctKpis .acct-kpi').length,
    segs: document.querySelectorAll('#acctSignin .acct-seg, #acctDomain .acct-seg').length,
    sysRows: document.querySelectorAll('#acctSystems .acct-hrow').length,
    cols: document.querySelectorAll('#acctRecency .acct-col, #acctSignups .acct-col').length,
    roster: document.querySelectorAll('#acctRoster .acct-hrow').length,
    feed: document.querySelectorAll('#acctFeed li').length,
    checks: document.querySelectorAll('#acctChecks .acct-check').length,
    rows: document.querySelectorAll('#acctRows tr[data-open]').length,
    count: document.getElementById('acctCount').textContent,
    msg: document.getElementById('acctMsg').textContent,
    more: !!document.getElementById('acctMore'),
    selects: document.querySelectorAll('#acctFilterBar select').length,
    cssLive: getComputedStyle(document.querySelector('.acct-card')).borderRadius,
  });`));
  say('sidebar entry visible to a master', page.side, page.side);
  say('pane open', page.pane, page.pane);
  say('no error under the page', JSON.stringify(page.msg), !page.msg);
  say('the stylesheet reached /admin/ (computed, not the file)', page.cssLive, page.cssLive === '14px');
  say('total on screen = auth.users in the database', `${page.total} vs ${dbCount}`, Number(String(page.total).replace(/\D/g, '')) === dbCount);
  say('tiles · stacked segments · system rows · columns · roster · feed · checks',
    [page.tiles, page.segs, page.sysRows, page.cols, page.roster, page.feed, page.checks].join(' · '),
    page.tiles >= 6 && page.segs >= 2 && page.sysRows === 6 && page.cols > 6 && page.roster > 0 && page.feed > 0 && page.checks > 10);
  say('EVERY account painted, no paging', `${page.rows} rows · ${page.count}`, page.rows === dbCount && !page.more);
  say('live strip', `${page.live} [${page.dot}]`, /is-live/.test(page.dot));
  await shot('desktop.png');

  // filter by a chart segment, then by a check
  const filt = JSON.parse(await ev(`document.querySelector('#acctDomain .acct-legend-item[data-value="synthetic"]').click();
    await new Promise(r=>setTimeout(r,200));
    const a = document.getElementById('acctCount').textContent, chips = document.querySelectorAll('#acctFilters .acct-chip').length;
    document.querySelector('#acctFilters .acct-chip').click(); await new Promise(r=>setTimeout(r,200));
    return JSON.stringify({ a, chips, b: document.getElementById('acctCount').textContent });`));
  say('a legend click filters the list, its chip clears it', `${filt.a} → ${filt.b}`, filt.chips === 1 && filt.a !== filt.b);

  // dropdown filters + header sort
  const fs = JSON.parse(await ev(`const sel = document.querySelector('[data-filter-select="signin"]');
    sel.value = 'password'; sel.dispatchEvent(new Event('change', { bubbles: true })); await new Promise(r=>setTimeout(r,200));
    const rowsPw = document.querySelectorAll('#acctRows tr[data-open]').length, chip = document.querySelectorAll('#acctFilters .acct-chip').length;
    sel.value = ''; sel.dispatchEvent(new Event('change', { bubbles: true })); await new Promise(r=>setTimeout(r,200));
    const th = document.querySelector('th[data-sort-col="created"]'); th.click(); await new Promise(r=>setTimeout(r,200));
    const s1 = th.getAttribute('aria-sort'); th.click(); await new Promise(r=>setTimeout(r,200));
    return JSON.stringify({ rowsPw, chip, s1, s2: th.getAttribute('aria-sort'), sort: document.getElementById('acctSort').value,
      back: document.querySelectorAll('#acctRows tr[data-open]').length });`));
  say('filter dropdowns rendered', page.selects, page.selects >= 7);
  say('a dropdown filters and shows its chip', `${fs.rowsPw} rows · ${fs.chip} chip`, fs.rowsPw > 0 && fs.rowsPw < dbCount && fs.chip === 1);
  say('a header click sorts, a second flips it', `${fs.s1} → ${fs.s2} (${fs.sort})`, fs.s1 === 'descending' && fs.s2 === 'ascending' && fs.sort === 'created_asc');
  say('clearing the filter brings every row back', fs.back, fs.back === dbCount);

  // 3. LIVE — change the database, touch nothing on the page
  await sql(`update auth.users set last_sign_in_at = now() where id = ${lit(uid)};`);
  let seen = false;
  for (let i = 0; i < 25 && !seen; i += 1) {
    await sleep(1000);
    seen = await ev(`return !!document.querySelector('#acctRows tr.is-fresh, #acctFeed li.is-fresh');`);
  }
  say('a sign-in in the database shows up by itself (no reload)', seen ? 'yes' : 'not within 25 s', seen);

  // 4. detail
  const det = JSON.parse(await ev(`document.querySelector('#acctRows tr[data-open]').click(); await new Promise(r=>setTimeout(r,700));
    const m = document.getElementById('acctDetailModal');
    return JSON.stringify({ open: m.classList.contains('show'), onBody: m.parentElement === document.body,
      sections: m.querySelectorAll('.acct-detail-h').length, title: document.getElementById('acctDetailTitle').textContent });`));
  say('a row opens its detail', `${det.title} · ${det.sections} sections`, det.open && det.onBody && det.sections >= 4);
  await shot('detail.png', false);
  await ev(`window.bootstrap.Modal.getInstance(document.getElementById('acctDetailModal')).hide(); await new Promise(r=>setTimeout(r,500)); return 1;`);

  // phone
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await sleep(1200);
  const sw = JSON.parse(await ev(`return JSON.stringify({ sw: document.documentElement.scrollWidth, w: window.innerWidth });`));
  say('phone: no sideways scroll', `${sw.sw} ≤ ${sw.w}`, sw.sw <= sw.w);
  await shot('phone.png');

  say('console errors', errs.length ? errs.join(' | ') : 'none', errs.length === 0);
} catch (e) {
  say('run', e.message, false);
} finally {
  try {
    const left = await sql(`delete from public.users where username = ${lit(USER)};
      delete from auth.users where email = ${lit(`${USER}@samomdkku.app`)};
      select (select count(*) from auth.users where email = ${lit(`${USER}@samomdkku.app`)}) accounts;`);
    console.log(`cleanup: ${JSON.stringify(left)}`);
  } catch (e) { console.log(`cleanup FAILED: ${e.message}`); }
  try { ws?.close(); } catch {}
  chrome.kill();
  console.log(`\n${failed ? `${failed} FAILED` : 'all passed'} · screenshots: ${OUT}`);
  process.exit(failed ? 1 : 0);
}
