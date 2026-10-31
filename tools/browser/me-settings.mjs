#!/usr/bin/env node
// ============================================================
// me-settings.mjs — the บัญชี settings on /me (2026-10-31: จัดการบัญชี merged
// into ข้อมูลของฉัน), signed in, headless Chrome, local dev server, samo-dev.
//
//   1. a throwaway username account;
//   2. every row shows its value; a tap opens ONE editor, a second row closes
//      the first; Esc closes;
//   3. saving the name updates the row; a repaint while typing (any auth
//      change) does NOT wipe what is being typed;
//   4. the public page has no profile modal; the old samoOpenProfile lands on
//      /me's บัญชี; screenshots desktop + phone;
//   5. ALWAYS deletes the account in a finally.
//
// RUN (needs `npm run dev` on :5174 and Chrome):  node tools/browser/me-settings.mjs
// ============================================================
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadEnv, resolveTarget, runSql } from '../env-lib.mjs';

const DEV_URL = process.env.DEV_URL || 'http://localhost:5174';
const OUT = process.env.OUT || mkdtempSync(join(tmpdir(), 'me-settings-'));
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9347;
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
const sql = async (q) => JSON.parse(await runSql(q, devTarget));
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;
mkdirSync(OUT, { recursive: true });

const PROFILE = mkdtempSync(join(tmpdir(), 'me-settings-chrome-'));
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${PROFILE}`], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws; let id = 0; const pend = {}; const errs = []; let failed = 0;
const say = (label, v, ok = true) => { if (!ok) failed += 1; console.log(`${ok ? '✓' : '✗'} ${label}: ${v}`); };
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pend[i] = res; ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (e) => (await send('Runtime.evaluate', { expression: `(async()=>{try{${e}}catch(err){return 'ERR '+err.message}})()`, awaitPromise: true, returnByValue: true })).result?.value;
const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }); writeFileSync(join(OUT, name), Buffer.from(r.data, 'base64')); };
const rowState = () => ev(`return [...document.querySelectorAll('#meSettings .me-set')].filter(s => !s.classList.contains('d-none')).map(s => ({
  k: s.dataset.set || 'username', open: s.classList.contains('is-open'),
  value: s.querySelector('.me-row-value')?.textContent.trim() || '',
  inert: s.querySelector('.me-set-panel')?.inert ?? null,
  h: Math.round(s.querySelector('.me-set-panel')?.getBoundingClientRect().height ?? 0) }))`);
const tap = (k) => ev(`document.querySelector('#meSettings .me-set[data-set="${k}"] .me-set-row').click(); await new Promise(r=>setTimeout(r,450)); return 1`);

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
  };
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1000, deviceScaleFactor: 2, mobile: false });

  await send('Page.navigate', { url: `${DEV_URL}/` }); await sleep(4000);
  say('the public page has no profile modal (no duplicate ids)', 'absent',
    (await ev(`return !document.getElementById('profileModal')`)) === true);
  const uid = await ev(`const a = await import('/src/js/auth.js'); await a.registerWithPassword(${JSON.stringify(USER)}, ${JSON.stringify(PASS)}); await new Promise(r=>setTimeout(r,1500)); return a.getUser()?.id || 'no user';`);
  if (!/^[0-9a-f-]{36}$/.test(uid)) throw new Error(`register failed: ${uid}`);
  say('throwaway account', USER);

  // the old entry point → /me's บัญชี
  await ev(`samoOpenProfile(); await new Promise(r=>setTimeout(r,900)); return 1`);
  const where = await ev(`return location.pathname + ' ' + Math.round(document.getElementById('meAccount').getBoundingClientRect().top)`);
  say('samoOpenProfile() lands on /me at บัญชี', where, /^\/me /.test(where) && Number(where.split(' ')[1]) < 200);

  let rows = await rowState();
  say('every row shows its value, all closed and inert', JSON.stringify(rows.map((r) => `${r.k}=${r.value}`)),
    rows.length >= 6 && rows.every((r) => !r.open) && rows.filter((r) => r.inert !== null).every((r) => r.inert && r.h === 0)
    && (await ev(`return document.getElementById('profileUsername').textContent`)) === USER && rows.find((r) => r.k === 'password')?.value === 'ตั้งแล้ว');

  await tap('name');
  rows = await rowState();
  const nm = rows.find((r) => r.k === 'name');
  say('a tap opens the name editor (not inert, has height)', JSON.stringify(nm), nm.open && !nm.inert && nm.h > 40);
  say('…and focuses its field (desktop)', 'focused', (await ev(`return document.activeElement?.id`)) === 'profileName');
  await ev(`document.querySelector('#meAccount').scrollIntoView(); return 1`);
  await shot('desktop-name-open.png');

  await tap('phone');
  rows = await rowState();
  say('opening another row closes the first', JSON.stringify(rows.filter((r) => r.open).map((r) => r.k)),
    rows.filter((r) => r.open).map((r) => r.k).join() === 'phone');
  await ev(`document.getElementById('profilePhone').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await new Promise(r=>setTimeout(r,450)); return 1`);
  rows = await rowState();
  say('Esc closes it and focus returns to the row', `${rows.filter((r) => r.open).length} open`,
    rows.every((r) => !r.open) && (await ev(`return document.activeElement?.classList.contains('me-set-row')`)) === true);

  // save the name
  await tap('name');
  await ev(`const i = document.getElementById('profileName'); i.value = 'ทดสอบ ตั้งชื่อ'; i.dispatchEvent(new Event('input', { bubbles: true })); return 1`);
  await ev(`document.getElementById('profileNameSaveBtn').click(); await new Promise(r=>setTimeout(r,2500)); return 1`);
  rows = await rowState();
  const alertTxt = await ev(`return document.getElementById('profileNameAlert').textContent`);
  say('saving the name updates the row', `${rows.find((r) => r.k === 'name').value} / ${alertTxt}`,
    rows.find((r) => r.k === 'name').value === 'ทดสอบ ตั้งชื่อ' && /บันทึกชื่อแล้ว/.test(alertTxt));

  // a repaint while typing must not wipe the field
  await ev(`const i = document.getElementById('profileName'); i.value = 'กำลังพิมพ์อยู่'; i.dispatchEvent(new Event('input', { bubbles: true })); return 1`);
  await ev(`const a = await import('/src/js/auth.js'); await a.updatePhone('0812345678'); await new Promise(r=>setTimeout(r,800)); return 1`);
  const kept = await ev(`return document.getElementById('profileName').value + ' | ' + document.getElementById('profileNameSaveBtn').disabled`);
  rows = await rowState();
  say('a repaint mid-typing keeps the half-typed name (save still enabled)', kept, kept === 'กำลังพิมพ์อยู่ | false');
  say('…while the phone row picks up its new value', rows.find((r) => r.k === 'phone').value, rows.find((r) => r.k === 'phone').value === '0812345678');

  // phone
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send('Page.navigate', { url: `${DEV_URL}/me` }); await sleep(4000);
  await tap('password');
  const ph = await ev(`return { overflowX: document.documentElement.scrollWidth > innerWidth, focus: document.activeElement?.tagName }`);
  say('phone: opens, no horizontal scroll, no keyboard thrown up', JSON.stringify(ph), !ph.overflowX && ph.focus !== 'INPUT');
  const un = await ev(`const el = document.getElementById('profileUsername'); return { full: el.textContent, clipped: el.scrollWidth > el.clientWidth + 1 }`);
  say('phone: the username is shown whole, not clipped', JSON.stringify(un), un.full === USER && !un.clipped);
  await ev(`document.querySelector('#meAccount').scrollIntoView(); return 1`);
  await shot('phone-password-open.png');

  say('no page errors', errs.length ? errs.join(' | ') : 'none', errs.length === 0);
  console.log(`screenshots: ${OUT}`);
} catch (e) {
  failed += 1; console.log(`✗ aborted: ${e.message}`);
} finally {
  try {
    const [left] = await sql(`delete from public.users where username = ${lit(USER)};
      delete from auth.users where email = ${lit(`${USER}@samomdkku.app`)};
      select (select count(*) from auth.users where email = ${lit(`${USER}@samomdkku.app`)}) leftover;`);
    say('cleanup: rows left', left?.leftover ?? '?', String(left?.leftover) === '0');
  } catch (e) { failed += 1; console.log(`✗ cleanup FAILED — remove ${USER} by hand: ${e.message}`); }
  try { ws?.close(); } catch { /* */ }
  chrome.kill();
  try { rmSync(PROFILE, { recursive: true, force: true }); } catch { /* */ }
  console.log(failed ? `${failed} FAILED` : 'ALL PASSED');
  process.exit(failed ? 1 : 0);
}
