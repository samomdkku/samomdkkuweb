#!/usr/bin/env node
// ============================================================
// house-details.mjs — the ระบบบ้าน "fill in everything" flow (0268), signed in,
// in headless Chrome against the local dev server on samo-dev.
//
//   1. a throwaway username account, its users.email set to a made-up
//      @kkumail.com address (the claim reads public.users.email);
//   2. /me: an MD48 รหัส opens the details form with the out-of-range note and
//      sends NO claim; filling it in shows the receipt with what was sent;
//   3. an MD54 รหัส the file does not hold: the server's one miss sentence, the
//      form opens; the receipt's แก้ไข reopens it with the values;
//   4. ALWAYS deletes the account and its request in a finally.
//
// RUN (needs `npm run dev` on :5174 and Chrome):  node tools/browser/house-details.mjs
// ============================================================
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadEnv, resolveTarget, runSql } from '../env-lib.mjs';

const DEV_URL = process.env.DEV_URL || 'http://localhost:5174';
const OUT = process.env.OUT || mkdtempSync(join(tmpdir(), 'house-details-'));
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9346;
const USER = `claudetest${Date.now().toString(36)}`;
const PASS = `t-${Math.random().toString(36).slice(2)}-Aa1`;
const MAIL = `${USER}@kkumail.com`;

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

const PROFILE = mkdtempSync(join(tmpdir(), 'house-details-chrome-'));
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${PROFILE}`], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws; let id = 0; const pend = {}; const errs = []; let failed = 0;
const say = (label, v, ok = true) => { if (!ok) failed += 1; console.log(`${ok ? '✓' : '✗'} ${label}: ${v}`); };
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pend[i] = res; ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (e) => (await send('Runtime.evaluate', { expression: `(async()=>{try{${e}}catch(err){return 'ERR '+err.message}})()`, awaitPromise: true, returnByValue: true })).result?.value;
const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }); writeFileSync(join(OUT, name), Buffer.from(r.data, 'base64')); };
const card = () => ev(`const c = document.getElementById('meMyHouse'); const f = c.querySelector('[data-house-form="details"]');
  return { form: !!f && !f.hidden, note: f?.querySelector('[data-house-details-note]')?.textContent.trim() || '',
    claimStatus: c.querySelector('[data-house-form="claim"] [role="status"]')?.textContent.trim() || '',
    receipt: (c.querySelector('[data-house-receipt]:not([hidden])')?.textContent || '').replace(/\\s+/g,' ').trim() }`);
// A รหัส with a valid KKU check digit, from the app's own checker.
const validSid = (prefix) => ev(`const f = await import('/src/js/team/fields.js');
  for (let d = 0; d < 10; d += 1) { const s = '${prefix}-' + d; if (f.studentIdChecksumOk(s) !== false) return s; } return 'none';`);
const fill = (vals) => ev(`const f = document.querySelector('#meMyHouse [data-house-form="details"]');
  for (const [k, v] of Object.entries(${JSON.stringify(vals)})) { const el = f.querySelector('[name="'+k+'"]'); el.value = v; }
  f.requestSubmit(); await new Promise(r=>setTimeout(r,2500)); return 1`);
const claim = (sid, first) => ev(`const f = document.querySelector('#meMyHouse [data-house-form="claim"]');
  f.querySelector('[name="student_id"]').value = ${JSON.stringify(sid)}; f.querySelector('[name="first_name"]').value = ${JSON.stringify(first)};
  f.requestSubmit(); await new Promise(r=>setTimeout(r,2500)); return 1`);

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
  await send('Emulation.setDeviceMetricsOverride', { width: 420, height: 900, deviceScaleFactor: 2, mobile: true });

  await send('Page.navigate', { url: `${DEV_URL}/` }); await sleep(4000);
  const uid = await ev(`const a = await import('/src/js/auth.js'); await a.registerWithPassword(${JSON.stringify(USER)}, ${JSON.stringify(PASS)}); await new Promise(r=>setTimeout(r,1500)); return a.getUser()?.id || 'no user';`);
  if (!/^[0-9a-f-]{36}$/.test(uid)) throw new Error(`register failed: ${uid}`);
  await sql(`update public.users set email = ${lit(MAIL)} where id = ${lit(uid)}`);
  say('throwaway account with a made-up kkumail', MAIL);

  await send('Page.navigate', { url: `${DEV_URL}/me` }); await sleep(4500);

  // ── MD48: outside — no claim, the form + the note ─────────────────────────
  const md48 = await validSid('630000001');
  await claim(md48, 'ทดสอบ');
  let c = await card();
  say('MD48 opens the details form', JSON.stringify(c.form), c.form);
  say('…with the out-of-range note naming the รุ่น and CONTACT through VitalSound',
    c.note.slice(0, 90), /MD48/.test(c.note) && /ติดต่อ/.test(c.note) && /VitalSound/.test(c.note));
  let [row] = await sql(`select count(*)::int n from public.house_help_requests where kkumail = ${lit(MAIL)}`);
  say('…and sent NO claim (no request yet)', row.n, row.n === 0);
  await shot('1-md48-form.png');
  await fill({ last_name: 'ระบบดี', nickname: 'เทส', sai_code: '7' });
  c = await card();
  say('sending shows the receipt with what was sent, สาย padded', c.receipt.slice(0, 140), /สาย 007/.test(c.receipt) && /ระบบดี/.test(c.receipt) && !c.form);
  [row] = await sql(`select typed_sai_code, typed_last_name, (details_at is not null) d from public.house_help_requests where kkumail = ${lit(MAIL)}`);
  say('…stored on the request', JSON.stringify(row), row?.typed_sai_code === '007' && row?.d === true);
  await shot('2-md48-receipt.png');

  // ── แก้ไข reopens with the values ─────────────────────────────────────────
  await ev(`document.querySelector('#meMyHouse [data-house-details-edit]').click(); await new Promise(r=>setTimeout(r,500)); return 1`);
  const vals = await ev(`const f = document.querySelector('#meMyHouse [data-house-form="details"]');
    return { open: !f.hidden, sai: f.querySelector('[name="sai_code"]').value, last: f.querySelector('[name="last_name"]').value }`);
  say('แก้ไขข้อมูลที่ส่ง reopens the form with the values', JSON.stringify(vals), vals.open && vals.sai === '007' && vals.last === 'ระบบดี');

  // ── MD54 not in the file: the server's sentence, the form ─────────────────
  await sql(`delete from public.house_help_requests where kkumail = ${lit(MAIL)}`);
  await send('Page.navigate', { url: `${DEV_URL}/me` }); await sleep(4500);
  const md54 = await validSid('670009991');
  await claim(md54, 'ไม่มีในไฟล์');
  c = await card();
  say('an in-range miss opens the form', JSON.stringify(c.form), c.form);
  say('…under the server\'s one miss sentence (sheet, หัวหน้าชั้นปี)', c.note.slice(0, 90), /หัวหน้าชั้นปี/.test(c.note) && /sheet/.test(c.note));
  await shot('3-md54-miss.png');
  await fill({ last_name: 'นามสกุล', sai_code: '142' });
  c = await card();
  say('…and the receipt asks the class head to fill the sheet', c.receipt.slice(0, 160), /สาย 142/.test(c.receipt) && /sheet/.test(c.receipt));
  await shot('4-md54-receipt.png');

  say('no page errors', errs.length ? errs.join(' | ') : 'none', errs.length === 0);
  console.log(`screenshots: ${OUT}`);
} catch (e) {
  failed += 1; console.log(`✗ aborted: ${e.message}`);
} finally {
  try {
    const [left] = await sql(`delete from public.house_help_requests where kkumail = ${lit(MAIL)};
      delete from public.users where username = ${lit(USER)};
      delete from auth.users where email = ${lit(`${USER}@samomdkku.app`)};
      select (select count(*) from auth.users where email = ${lit(`${USER}@samomdkku.app`)})
           + (select count(*) from public.house_help_requests where kkumail = ${lit(MAIL)}) leftover;`);
    say('cleanup: rows left', left?.leftover ?? '?', String(left?.leftover) === '0');
  } catch (e) { failed += 1; console.log(`✗ cleanup FAILED — remove ${USER} by hand: ${e.message}`); }
  try { ws?.close(); } catch { /* */ }
  chrome.kill();
  try { rmSync(PROFILE, { recursive: true, force: true }); } catch { /* */ }
  console.log(failed ? `${failed} FAILED` : 'ALL PASSED');
  process.exit(failed ? 1 : 0);
}
