#!/usr/bin/env node
// ============================================================
// projects-ui.mjs — SEE หนังสือโครงการ (the admin workspace) as the sender desk,
// in light AND dark, at desktop / iPad landscape / iPad portrait / phone.
//
// Built 2026-10-13 for "improve the หนังสือโครงการ ui across computer, ipad,
// mobile" + dark mode. Same recipe as shop-admin-strip.mjs
// (skills/drive-the-browser.md §4b/§11):
//   1. a throwaway username account on samo-dev, granted `master`
//      (public.users.permissions — survives the login sync; master folds into
//      every project seat, so the workspace renders as the vpa desk);
//   2. signed in through the app's own auth module;
//   3. /admin/#projects at each width × theme: the grid, the list, and the first
//      โครงการ's detail — screenshots + a horizontal-overflow check + console
//      errors;
//   4. every Apps Script call answered locally (GAS is the LIVE endpoint even
//      in dev) — nothing is written anywhere;
//   5. the account deleted in a finally, and what is left printed (must be 0).
// It REFUSES any database but samo-dev. Read-only otherwise.
//
//   npm run dev            # :5174, samo-dev — must be running
//   node tools/browser/projects-ui.mjs            # OUT=<dir> to keep the PNGs
//   WIDTHS=390 THEMES=dark node tools/browser/projects-ui.mjs
// ============================================================
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadEnv, resolveTarget, runSql } from '../env-lib.mjs';

const DEV_URL = process.env.DEV_URL || 'http://localhost:5174';
const OUT = process.env.OUT || mkdtempSync(join(tmpdir(), 'projects-ui-'));
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9339;
const USER = `claudetest${Date.now().toString(36)}`;
const PASS = `t-${Math.random().toString(36).slice(2)}-Aa1`;
const WIDTHS = (process.env.WIDTHS || '1440,1024,820,390').split(',').map(Number);
const THEMES = (process.env.THEMES || 'light,dark').split(',');
const VIEWS = (process.env.VIEWS || 'grid,list,detail').split(',');

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
  `--user-data-dir=${mkdtempSync(join(tmpdir(), 'projects-ui-chrome-'))}`], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws; let id = 0; const pend = {}; const errs = []; const gas = []; let failed = 0;
const say = (label, v, ok = true) => { if (!ok) failed += 1; console.log(`${ok ? '✓' : '✗'} ${label}: ${v}`); };

try {
  for (let i = 0; i < 30 && !ws; i += 1) {
    try {
      const t = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
      ws = new WebSocket(t.webSocketDebuggerUrl);
    } catch { await sleep(300); }
  }
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
  ws.onmessage = async (m) => {
    const d = JSON.parse(m.data);
    if (pend[d.id]) { pend[d.id](d); delete pend[d.id]; }
    if (d.method === 'Runtime.exceptionThrown') errs.push(d.params.exceptionDetails?.exception?.description?.split('\n')[0]);
    if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') errs.push(d.params.args.map((a) => a.value || a.description).join(' ').slice(0, 200));
    if (d.method === 'Fetch.requestPaused') {
      const body = d.params.request.postData || '';
      gas.push((body.match(/"action":"(\w+)"/) || [])[1] || '?');
      await send('Fetch.fulfillRequest', { requestId: d.params.requestId, responseCode: 200,
        responseHeaders: [{ name: 'Content-Type', value: 'application/json' }, { name: 'Access-Control-Allow-Origin', value: '*' }],
        body: Buffer.from(JSON.stringify({ success: true, files: [] })).toString('base64') });
    }
  };
  await new Promise((r) => { ws.onopen = r; });
  const ev = async (e) => (await send('Runtime.evaluate', { expression: `(async()=>{try{${e}}catch(err){return 'ERR '+err.message}})()`, awaitPromise: true, returnByValue: true })).result?.result?.value;
  await send('Runtime.enable'); await send('Page.enable');
  await send('Fetch.enable', { patterns: [{ urlPattern: '*script.google.com*', requestStage: 'Request' }] });
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false });

  // 1. account + grant
  await send('Page.navigate', { url: `${DEV_URL}/` }); await sleep(6000);
  const uid = await ev(`const a = await import('/src/js/auth.js'); await a.registerWithPassword(${JSON.stringify(USER)}, ${JSON.stringify(PASS)});
    await a.signOut().catch(()=>{}); await a.signInWithPassword(${JSON.stringify(USER)}, ${JSON.stringify(PASS)}); await new Promise(r=>setTimeout(r,1500)); return a.getUser()?.id || 'no user';`);
  if (!/^[0-9a-f-]{36}$/.test(uid)) throw new Error(`register failed: ${uid}`);
  await sql(`update public.users set permissions = array['master'] where id = ${lit(uid)};`);
  say('account', `${USER} (master on samo-dev)`);
  await send('Page.navigate', { url: `${DEV_URL}/` }); await sleep(4000);
  await ev(`const a = await import('/src/js/auth.js'); await a.signOut().catch(()=>{}); await a.signInWithPassword(${JSON.stringify(USER)}, ${JSON.stringify(PASS)}); await new Promise(r=>setTimeout(r,2000)); return 1;`);

  // 2. every width × theme × view
  for (const theme of THEMES) {
    for (const w of WIDTHS) {
      errs.length = 0;
      await send('Emulation.setDeviceMetricsOverride', { width: w, height: w <= 430 ? 860 : (w <= 1024 ? 1180 : 900), deviceScaleFactor: 1, mobile: w <= 430 });
      await ev(`localStorage.setItem('samo.theme', '${theme}'); return 1`);
      await send('Page.navigate', { url: `${DEV_URL}/admin/` }); await sleep(8000);
      // Open it the way a person does — the sidebar (the #hash is read before
      // the session has restored, so it lands on the overview).
      const into = await ev(`const b = document.querySelector('.workspace-side-item[data-admin-side="projects"]');
        if (!b || b.classList.contains('d-none')) return 'no sidebar item'; b.click(); await new Promise(r=>setTimeout(r,5000));
        return document.querySelector('[data-admin-pane="projects"]')?.classList.contains('d-none') ? 'pane hidden' : 'ok';`);
      if (into !== 'ok') { say(`${theme} ${w} open หนังสือโครงการ`, into, false); continue; }
      // On a phone the sidebar is a drawer — close it if opening left it up.
      await ev(`document.getElementById('adminSidebarBackdrop')?.click(); return 1`); await sleep(400);
      for (const view of VIEWS) {
        if (view === 'grid' || view === 'list') {
          await ev(`localStorage.setItem('projects.viewMode','${view}'); document.querySelector('[data-projects-view-mode="${view}"]')?.click(); await new Promise(r=>setTimeout(r,700)); return 1`);
        } else {
          const opened = await ev(`const c = document.querySelector('#projectsGrid [data-projects-open-project]'); if (!c) return 'no card'; c.click(); await new Promise(r=>setTimeout(r,2500)); return 'ok'`);
          if (opened !== 'ok') { say(`${theme} ${w} detail`, opened, false); continue; }
        }
        const m = await ev(`return JSON.stringify({ overflowX: document.documentElement.scrollWidth > innerWidth, sw: document.documentElement.scrollWidth, cards: [...document.querySelectorAll('#projectsGrid > *')].filter(e => e.getClientRects().length).length })`);
        const shot = await send('Page.captureScreenshot', {});
        writeFileSync(join(OUT, `${theme}-${w}-${view}.png`), Buffer.from(shot.result.data, 'base64'));
        const r = JSON.parse(m || '{}');
        say(`${theme} ${w} ${view}`, `cards=${r.cards} overflowX=${r.overflowX}${r.overflowX ? ` (${r.sw}px)` : ''}`, !r.overflowX);
        if (view === 'detail') await ev(`history.back(); await new Promise(r=>setTimeout(r,1200)); return 1`);
      }
      if (errs.length) say(`${theme} ${w} console`, [...new Set(errs)].slice(0, 3).join(' | '), false);
    }
  }
  if (gas.length) console.log(`  (Apps Script calls answered locally: ${[...new Set(gas)].join(', ')})`);
} catch (e) {
  failed += 1; console.log(`✗ ${e.message}`);
} finally {
  try {
    const [left] = await sql(`delete from public.users where username = ${lit(USER)};
      delete from auth.users where email = ${lit(`${USER}@samomdkku.app`)};
      select (select count(*) from public.users where username = ${lit(USER)}) + (select count(*) from auth.users where email = ${lit(`${USER}@samomdkku.app`)}) as accounts;`);
    say('cleanup (left behind)', JSON.stringify(left), Number(left.accounts) === 0);
  } catch (e) { failed += 1; console.log(`✗ cleanup FAILED — remove ${USER} by hand: ${e.message}`); }
  try { ws?.close(); } catch { /* */ }
  chrome.kill();
  console.log(`\nscreenshots: ${OUT}`);
  process.exit(failed ? 1 : 0);
}
