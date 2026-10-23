#!/usr/bin/env node
// ============================================================
// passport-depts.mjs — drive Passport admin → จัดการรายชื่อฝ่าย (0247) for real,
// SIGNED IN as a master, in headless Chrome, against the local dev server on
// samo-dev. Shape copied from passport-quarters.mjs.
//
//   1. the create form's ฝ่าย select is filled from the database (no
//      hand-typed options), in the admins' order;
//   2. the ฝ่าย screen lists every ฝ่าย with its ทีม SAMO link and usage;
//   3. "เพิ่มฝ่ายจาก ทีม SAMO": search "ร่วมผลิต", pick ฝ่าย รพ. ร่วมผลิต — it is
//      saved (REALLY, on samo-dev), appears on the screen AND in the create
//      form at once; "เพิ่มฝ่ายย่อย" offers its own hospitals FIRST, adds one,
//      and the create form's ฝ่ายย่อย select shows it;
//   4. 390px, no sideways scroll; no console errors; ALWAYS deletes what it
//      added and the account.
//
// RUN (needs `npm run dev` on :5174 — it uses samo-dev — and Chrome):
//   node tools/browser/passport-depts.mjs
// ============================================================
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadEnv, resolveTarget, runSql } from '../env-lib.mjs';

const DEV_URL = process.env.DEV_URL || 'http://localhost:5174';
const OUT = process.env.OUT || mkdtempSync(join(tmpdir(), 'passport-depts-'));
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9353;
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
  `--user-data-dir=${mkdtempSync(join(tmpdir(), 'passport-depts-chrome-'))}`], { stdio: 'ignore' });
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
  const waitFor = async (expr, secs = 40) => {
    for (let i = 0; i < secs; i += 1) { if (await ev(`return !!(${expr});`) === true) return true; await sleep(1000); }
    return false;
  };
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false });

  // 1. account + grant
  await send('Page.navigate', { url: `${DEV_URL}/` }); await sleep(6000);
  const uid = await ev(`const a = await import('/src/js/auth.js'); await a.registerWithPassword(${JSON.stringify(USER)}, ${JSON.stringify(PASS)});
    await a.signOut().catch(()=>{}); await a.signInWithPassword(${JSON.stringify(USER)}, ${JSON.stringify(PASS)}); await new Promise(r=>setTimeout(r,1500)); return a.getUser()?.id || 'no user';`);
  say('throwaway account', uid, /^[0-9a-f-]{36}$/.test(uid || ''));
  // samo-dev has the auth.users triggers since 0234, so the row may already
  // exist — and users_self_update_guard refuses a permissions change from
  // anyone but staff. Off around the fixture write only, as the SQL proofs do.
  await sql(`alter table public.users disable trigger users_self_update_guard;
             insert into public.users (id, username, email, role, method, permissions) values (${lit(uid)}, ${lit(USER)}, ${lit(`${USER}@samomdkku.app`)}, 'user', 'password', array['master'])
             on conflict (id) do update set permissions = excluded.permissions;
             alter table public.users enable trigger users_self_update_guard;`);
  await send('Page.navigate', { url: `${DEV_URL}/` }); await sleep(4000);
  await ev(`const a = await import('/src/js/auth.js'); await a.signOut().catch(()=>{}); await a.signInWithPassword(${JSON.stringify(USER)}, ${JSON.stringify(PASS)}); await new Promise(r=>setTimeout(r,2000)); return 1;`);

  // 2. the admin page, against the database
  const [db] = await sql(`select (select count(*) from passport.departments where active)::int n,
      (select string_agg(name, '|' order by sort_order, id) from passport.departments where active) names,
      (select id from public.team_nodes where name = 'ฝ่าย รพ. ร่วมผลิต' and parent_id is null limit 1) rp`);
  await send('Page.navigate', { url: `${DEV_URL}/passport/html/admin.html` });
  const painted = await waitFor(`getComputedStyle(document.getElementById('admin-content')).display !== 'none' && document.querySelectorAll('#act-department option').length > 1`, 60);
  say('the admin page opened signed in, ฝ่าย select filled', painted, painted);
  // ⚠️ page-side code is a TEMPLATE LITERAL: no regex escapes in it (see passport-quarters.mjs)
  await ev(`window.__dialogs = []; window.alert = (m) => { window.__dialogs.push(String(m)); };
    window.confirm = (m) => { window.__dialogs.push(String(m)); return true; }; return 1;`);
  say('a ทีม SAMO node named ฝ่าย รพ. ร่วมผลิต exists on samo-dev', db.rp, !!db.rp);

  const form = await ev(`return [...document.querySelectorAll('#act-department option')].filter(o => o.value).map(o => o.textContent).join('|');`);
  say('the create form offers the database list, in its order', `${form.split('|').length} ฝ่าย`, form === db.names);

  // 3. the ฝ่าย screen
  const scr = JSON.parse(await ev(`await window.openDepts(); await new Promise(r => setTimeout(r, 2500));
    return JSON.stringify({ cards: document.querySelectorAll('#depts-list .dept-card').length,
      linked: [...document.querySelectorAll('#depts-list .dept-card > .dept-row .dept-link')].filter(x => !x.classList.contains('is-unlinked')).length,
      usage: document.querySelector('#depts-list .dept-usage')?.textContent || '' });`));
  say('the screen lists every ฝ่าย', `${scr.cards} cards`, scr.cards >= db.n);
  say('…each with its ทีม SAMO link and usage', `${scr.linked} linked · "${scr.usage}"`, scr.linked >= 10 && /กิจกรรม \d+/.test(scr.usage));
  await shot('depts-screen.png');

  const add = JSON.parse(await ev(`window.addDeptFromTeam(); await new Promise(r => setTimeout(r, 300));
    const q = document.getElementById('node-picker-q'); q.value = 'ร่วมผลิต'; q.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 300));
    const first = document.querySelector('#node-picker-list [data-node]');
    const name = first?.querySelector('.node-pick-name')?.textContent;
    first?.click(); await new Promise(r => setTimeout(r, 3000));
    return JSON.stringify({ name, status: document.getElementById('depts-status').textContent,
      card: [...document.querySelectorAll('#depts-list .dept-card .dept-name')].some(i => i.value === 'ฝ่าย รพ. ร่วมผลิต'),
      inForm: [...document.querySelectorAll('#act-department option')].some(o => o.textContent === 'ฝ่าย รพ. ร่วมผลิต') });`));
  say('searching "ร่วมผลิต" offers ฝ่าย รพ. ร่วมผลิต first', add.name, add.name === 'ฝ่าย รพ. ร่วมผลิต');
  say('picking it saves and says so', add.status, /เพิ่มฝ่าย/.test(add.status));
  say('…it is on the screen AND in the create form at once', `card ${add.card} · form ${add.inForm}`, add.card && add.inForm);

  const sub = JSON.parse(await ev(`const card = [...document.querySelectorAll('#depts-list .dept-card')].find(c => c.querySelector('.dept-name').value === 'ฝ่าย รพ. ร่วมผลิต');
    card.querySelector('[data-act="add-sub"]').click(); await new Promise(r => setTimeout(r, 300));
    const opts = [...document.querySelectorAll('#node-picker-list [data-node]')].slice(0, 3).map(b => b.querySelector('.node-pick-name').textContent);
    const k = [...document.querySelectorAll('#node-picker-list [data-node]')].find(b => b.querySelector('.node-pick-name').textContent === 'รพ. ขอนแก่น');
    k?.click(); await new Promise(r => setTimeout(r, 3000));
    const id = [...document.querySelectorAll('#act-department option')].find(o => o.textContent === 'ฝ่าย รพ. ร่วมผลิต')?.value;
    const sel = document.getElementById('act-department'); sel.value = id; sel.dispatchEvent(new Event('change'));
    return JSON.stringify({ opts, subs: [...document.querySelectorAll('#act-sub-department option')].filter(o => o.value).map(o => o.textContent) });`));
  say('"เพิ่มฝ่ายย่อย" offers that ฝ่าย\'s own hospitals first', sub.opts.join(' | '), sub.opts.slice(0, 3).every((n) => /^รพ\./.test(n)));
  say('…and the create form\'s ฝ่ายย่อย select shows the one added', sub.subs.join(' | '), sub.subs.includes('รพ. ขอนแก่น'));
  await shot('depts-added.png');

  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await sleep(1500);
  const sw = JSON.parse(await ev(`window.scrollTo(0,0); return JSON.stringify({ sw: document.documentElement.scrollWidth, w: window.innerWidth });`));
  say('phone: no sideways scroll', `${sw.sw} ≤ ${sw.w}`, sw.sw <= sw.w);
  await shot('phone-depts.png');

  say('console errors', errs.length ? errs.join(' | ') : 'none', errs.length === 0);
} catch (e) {
  say('run', e.message, false);
} finally {
  try {
    // what step 3 really saved on samo-dev
    await sql(`delete from passport.sub_departments where department_id in (select id from passport.departments where name = 'ฝ่าย รพ. ร่วมผลิต');
               delete from passport.departments where name = 'ฝ่าย รพ. ร่วมผลิต';`).catch((e) => console.log(`cleanup (ฝ่าย) FAILED: ${e.message}`));
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
