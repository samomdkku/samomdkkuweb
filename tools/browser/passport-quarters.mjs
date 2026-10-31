#!/usr/bin/env node
// ============================================================
// passport-quarters.mjs — drive the Passport admin's event-date field (0267)
// and the link to where its quarter controls moved
// for real, SIGNED IN as a master, in headless Chrome, against the local dev
// server on samo-dev. Shape copied from year-page.mjs.
//
//   1. registers a throwaway username account and gives it `master`;
//   2. /passport/html/admin.html: the create form REQUIRES an event date
//      (defaulted to today, Thai time); the hint under it is
//      activity_date_info()'s answer — today's quarter, a closed quarter said
//      to be closed, the two-month window; the tick box reveals the end date
//      with the default filled and bounded;
//   3. creating an activity sends event_date + scan_until_set and NO quarter
//      (the database decides) — the insert is INTERCEPTED, nothing is written;
//   4. the quarter controls are GONE from here (moved to /admin/#years
//      2026-10-31 — driven by year-page.mjs): only a link to that page is left,
//      and the data wipe sits folded at the end of the activities;
//   5. 390px phone, no sideways scroll; no console errors; ALWAYS deletes the account.
//
// RUN (needs `npm run dev` on :5174 — it uses samo-dev — and Chrome):
//   node tools/browser/passport-quarters.mjs
// ============================================================
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadEnv, resolveTarget, runSql } from '../env-lib.mjs';

const DEV_URL = process.env.DEV_URL || 'http://localhost:5174';
const OUT = process.env.OUT || mkdtempSync(join(tmpdir(), 'passport-quarters-'));
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9351;
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
// ~150 MB per run; deleted at the end so repeated runs cannot fill the disk.
const PROFILE = mkdtempSync(join(tmpdir(), 'passport-quarters-chrome-'));
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${PROFILE}`], { stdio: 'ignore' });
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
  const [db] = await sql(`select passport.schedule_at() ->> 'quarter' q,
      (now() at time zone 'Asia/Bangkok')::date::text today,
      (lower(passport._quarter_days((passport.schedule_at() ->> 'vara_year')::int, (passport.schedule_at() ->> 'quarter')::int)) - 1)::text prev_last,
      (select id from passport.samo_years where ended_at is null order by started_at desc limit 1) yid,
      (select json_agg(json_build_object('m', q1_month, 'd', q1_day)) from passport.season_schedule) s1,
      (select q1_month || '/' || q1_day || ',' || q2_month || '/' || q2_day || ',' || q3_month || '/' || q3_day || ',' || q4_month || '/' || q4_day from passport.season_schedule) sched`);
  await send('Page.navigate', { url: `${DEV_URL}/passport/html/admin.html` });
  const painted = await waitFor(`getComputedStyle(document.getElementById('admin-content')).display !== 'none' && document.getElementById('act-event-date-hint').textContent.includes('คะแนนนับเข้า')`, 60);
  say('the admin page opened signed in, the date hint answered', painted, painted);
  if (!painted) {
    // Say WHY, from the page's own state, rather than leaving a blank screenshot.
    // A module that never LOADED throws no Runtime exception — import the client
    // the way the page does and report what fails (the /passport/@vite/client
    // fallback bug, vite.config.js spaFallback, looked exactly like "not signed in").
    console.log('  diag:', await ev(`let imp = 'ok';
      try { await import('/passport/js/app.js'); } catch (e) { imp = e.message.slice(0, 120); }
      const vc = await fetch('/passport/@vite/client');
      return JSON.stringify({ session: Object.keys(localStorage).some(k => /^sb-.*-auth-token$/.test(k)),
        importClient: imp, viteClient: vc.status + ' ' + vc.headers.get('content-type'),
        login: getComputedStyle(document.getElementById('admin-login-section')).display });`));
  }
  // ⚠️ Code inside ev(`…`) is a TEMPLATE LITERAL: a regex escape like \\d or \\? loses
  // its backslash there and the page receives a syntax error. Use string tests.
  // dialogs would block the CDP session — record them instead
  await ev(`window.__dialogs = []; window.alert = (m) => { window.__dialogs.push(String(m)); };
    window.confirm = (m) => { window.__dialogs.push(String(m)); return true; }; return 1;`);

  const f0 = JSON.parse(await ev(`const d = document.getElementById('act-event-date');
    return JSON.stringify({ required: d.required, value: d.value, hint: document.getElementById('act-event-date-hint').textContent,
      wrap: getComputedStyle(document.getElementById('act-scan-until-wrap')).display,
      picker: !!document.getElementById('act-quarter') });`));
  say('the date is REQUIRED and defaults to today (Thai time)', `required ${f0.required} · ${f0.value} vs ${db.today}`, f0.required && f0.value === db.today);
  say('the hint names today\'s quarter and the two-month window', f0.hint, f0.hint.includes(`คะแนนนับเข้า Q${db.q}`) && f0.hint.includes('QR สแกนได้'));
  say('there is no quarter picker any more; the end date is hidden', `picker ${f0.picker} · wrap ${f0.wrap}`, !f0.picker && f0.wrap === 'none');

  const f1 = JSON.parse(await ev(`const d = document.getElementById('act-event-date'); d.value = ${JSON.stringify(db.prev_last)};
    d.dispatchEvent(new Event('change')); await new Promise(r => setTimeout(r, 2500));
    return JSON.stringify({ hint: document.getElementById('act-event-date-hint').textContent });`));
  say('a day of the previous (closed) quarter is filed there, and said to be closed', f1.hint, f1.hint.includes('ปิดไปแล้ว'));

  const f2 = JSON.parse(await ev(`const d = document.getElementById('act-event-date'); d.value = ${JSON.stringify(db.today)};
    d.dispatchEvent(new Event('change')); await new Promise(r => setTimeout(r, 2500));
    const c = document.getElementById('act-scan-until-set'); c.checked = true; c.dispatchEvent(new Event('change'));
    const u = document.getElementById('act-scan-until');
    return JSON.stringify({ wrap: getComputedStyle(document.getElementById('act-scan-until-wrap')).display, v: u.value, min: u.min, max: u.max, req: u.required });`));
  const [win] = await sql(`select ((date ${lit(db.today)} + interval '2 months')::date)::text def, (date ${lit(db.today)} + 366)::text mx`);
  say('the tick box reveals the end date, defaulted to +2 months and bounded', JSON.stringify(f2),
    f2.wrap !== 'none' && f2.v === win.def && f2.min === db.today && f2.max === win.mx && f2.req);
  await ev(`const c = document.getElementById('act-scan-until-set'); c.checked = false; c.dispatchEvent(new Event('change')); return 1;`);

  // dd/mm/yyyy whatever the browser locale (this Chrome is en-US, which draws a
  // native date input month-first): the visible box, typing, the US order refused.
  const dm = JSON.parse(await ev(`const t = document.getElementById('act-event-date-text');
    const d = document.getElementById('act-event-date');
    const shown = t.value;
    const ex = d.value.split('-'); const want = ex[2] + '/' + ex[1] + '/' + ex[0];
    t.value = '01/03/2027'; t.dispatchEvent(new Event('input'));
    const typed = d.value;
    t.value = '10/31/2026'; t.dispatchEvent(new Event('input'));
    const usValid = t.checkValidity(); const usMsg = t.validationMessage;
    t.value = want; t.dispatchEvent(new Event('input')); t.dispatchEvent(new Event('blur'));
    const c = document.getElementById('act-scan-until-set'); c.checked = true; c.dispatchEvent(new Event('change'));
    await new Promise(r => setTimeout(r, 50));
    const ut = document.getElementById('act-scan-until-text'); const uv = document.getElementById('act-scan-until').value;
    const until = { shown: ut.value, iso: uv, req: ut.required, dis: ut.disabled };
    c.checked = false; c.dispatchEvent(new Event('change'));
    await new Promise(r => setTimeout(r, 50));
    until.disAfter = ut.disabled;
    const pr = document.querySelector('#act-event-date').getBoundingClientRect();
    const tr = t.getBoundingClientRect();
    return JSON.stringify({ shown, want, typed, usValid, usMsg, back: d.value, until,
      overlay: pr.width > 30 && pr.right <= tr.right + 1 && pr.left >= tr.left,
      label: document.querySelector('label[for="act-event-date-text"]') !== null });`));
  say('the event date READS dd/mm/yyyy in an en-US browser', `${dm.shown} (want ${dm.want})`, dm.shown === dm.want);
  say('typing 01/03/2027 means 1 มี.ค., not 3 ม.ค.', dm.typed, dm.typed === '2027-03-01');
  say('month-first 10/31/2026 is refused, not guessed', `${dm.usValid} · ${dm.usMsg}`, dm.usValid === false);
  say('the QR end date reads dd/mm/yyyy too, required only while ticked', JSON.stringify(dm.until),
    dm.until.shown === dm.until.iso.split('-').reverse().join('/') && dm.until.req && !dm.until.dis && dm.until.disAfter);
  say('the calendar picker sits over the icon, inside the box; the label names the box', `overlay ${dm.overlay} · label ${dm.label}`, dm.overlay && dm.label);

  const blocked = await ev(`document.getElementById('act-name').value = 'harness'; document.getElementById('act-km').value = '5';
    const d = document.getElementById('act-event-date'); const keep = d.value; d.value = '';
    const ok = document.getElementById('activity-form').checkValidity(); d.value = keep; return ok;`);
  say('an empty date cannot be submitted', `form valid: ${blocked}`, blocked === false);
  await shot('admin-create.png', false);

  // 3. create, intercepted — the refusal makes the page console.error() the
  // 400 it got; that one is OURS, so errors logged during this step are dropped.
  const errsBefore = errs.length;
  const made = JSON.parse(await ev(`const calls = []; const orig = window.fetch;
    window.fetch = async (u, o = {}) => { const url = String(u.url || u);
      if (url.split('?')[0].endsWith('/rest/v1/activities') && (o.method || 'GET') === 'POST') {
        calls.push(JSON.parse(o.body)); return new Response('{"message":"intercepted"}', { status: 400, headers: { 'Content-Type': 'application/json' } }); }
      return orig(u, o); };
    document.getElementById('activity-form').requestSubmit(); await new Promise(r => setTimeout(r, 1500));
    window.fetch = orig; return JSON.stringify({ calls, dialogs: window.__dialogs.splice(0) });`));
  errs.length = errsBefore;
  const row = Array.isArray(made.calls[0]) ? made.calls[0][0] : made.calls[0];
  say('create sends the date and the default window — and NO quarter (the database decides)',
    JSON.stringify(row && { event_date: row.event_date, scan_until_set: row.scan_until_set, quarter: row.quarter, samo_year_id: row.samo_year_id }),
    made.calls.length === 1 && row && row.event_date === db.today && row.scan_until_set === false
      && !('quarter' in row) && !('samo_year_id' in row) && !('scan_until' in row));
  const [noAct] = await sql(`select count(*)::int n from passport.activities where name = 'harness'`);
  say('…and nothing was written (intercepted)', noAct.n, noAct.n === 0);

  const badges = await ev(`return document.querySelectorAll('#activities-list .q-badge').length + '/' + document.querySelectorAll('#activities-list .activity-card').length;`);
  say('every activity card names its quarter', badges, /^(\d+)\/\1$/.test(badges) && !badges.startsWith('0/'));
  const windows = await ev(`return document.querySelectorAll('#activities-list .activity-card-window').length + '/' + document.querySelectorAll('#activities-list .activity-card').length;`);
  say('…and when its QR scans', windows, /^(\d+)\/\1$/.test(windows) && !windows.startsWith('0/'));

  // 4. the season screen moved to the ปี SAMO page; only a link is left
  const gone = JSON.parse(await ev(`const l = document.getElementById('seasons-link');
    const dz = document.getElementById('danger-zone');
    return JSON.stringify({ href: l?.getAttribute('href'), text: l?.textContent.trim(),
      screen: !!document.getElementById('seasons-section'), fn: typeof window.openSeasons,
      dz: dz ? dz.tagName + (dz.open ? ':open' : ':closed') + ':' + !!dz.closest('#manage-section') : 'none' });`));
  say('the quarter controls are gone; a link to the ปี SAMO page is left', JSON.stringify(gone),
    gone.href === '/admin/#years' && !gone.screen && gone.fn === 'undefined');
  say('the data wipe is folded at the end of the activities', gone.dz, gone.dz === 'DETAILS:closed:true');

  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await sleep(1500);
  const sw = JSON.parse(await ev(`window.scrollTo(0,0); return JSON.stringify({ sw: document.documentElement.scrollWidth, w: window.innerWidth });`));
  say('phone: no sideways scroll', `${sw.sw} ≤ ${sw.w}`, sw.sw <= sw.w);
  await shot('phone-admin.png');

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
  await sleep(500);
  try { rmSync(PROFILE, { recursive: true, force: true }); } catch { /* best effort */ }
  console.log(`\n${failed ? `${failed} FAILED` : 'all passed'} · screenshots: ${OUT}`);
  process.exit(failed ? 1 : 0);
}
