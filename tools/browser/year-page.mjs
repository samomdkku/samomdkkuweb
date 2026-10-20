#!/usr/bin/env node
// ============================================================
// year-page.mjs — drive the ปี admin page (/admin/#years, 0242) for real,
// SIGNED IN as a master, in headless Chrome, against the local dev server on
// samo-dev. Shape copied from accounts-dashboard.mjs.
//
// WHAT IT DOES, all on samo-dev (it REFUSES any other project):
//   1. registers a throwaway username account and gives it `master`;
//   2. opens /admin/#years and reads the RENDERED page against the database:
//      the hero year = current_samo_year(), the ปีการศึกษา tile = the stored
//      value (and never "2,569"), Passport's open วาระ, the top-bar chip;
//   3. step 3: types a year and checks the button, the suggested Passport
//      name and the "what changes" list follow it;
//   4. presses เริ่มปี SAMO with fetch INTERCEPTED for /rpc/start_samo_year —
//      asserts the confirm names Passport, then the exact payload sent, and
//      answers with a canned reply, so NOTHING IS WRITTEN (the database half is
//      proved by tools/year0242-start-samo-year.sql); cancels the ปีการศึกษา
//      dialog the same way;
//   5. ทีม SAMO → ทีมแต่ละปี has no ตั้งเป็นปีปัจจุบัน and links here; ระบบบ้าน
//      links here; 390px phone, no sideways scroll; ALWAYS deletes the account.
//
// RUN (needs `npm run dev` on :5174 — it uses samo-dev — and Chrome):
//   node tools/browser/year-page.mjs
// ============================================================
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadEnv, resolveTarget, runSql } from '../env-lib.mjs';

const DEV_URL = process.env.DEV_URL || 'http://localhost:5174';
const OUT = process.env.OUT || mkdtempSync(join(tmpdir(), 'year-page-'));
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
console.error(`→ database: ${devTarget.ref} (${devTarget.label}) · app: ${DEV_URL} · out: ${OUT}`);
const sql = async (q) => JSON.parse(await runSql(q, devTarget));
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;

mkdirSync(OUT, { recursive: true });
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${mkdtempSync(join(tmpdir(), 'year-page-chrome-'))}`], { stdio: 'ignore' });
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

  // 2. the page, against the database
  const [db] = await sql(`select public.current_samo_year() cy,
      (select academic_year from public.house_settings limit 1) ay,
      (select name from passport.samo_years where ended_at is null order by started_at desc limit 1) pp`);
  await send('Page.navigate', { url: `${DEV_URL}/admin/#years` });
  const painted = await waitFor(`document.querySelector('#samoYearHost .sy-hero-year')`, 60);
  say('the page painted', painted, painted);
  await sleep(1500);   // the best-effort halves (Passport, ชั้นปี 6 count) land after the hero
  const page = JSON.parse(await ev(`const q = (s) => document.querySelector(s);
    return JSON.stringify({
      side: !q('#adminSideNav [data-admin-side="years"]').classList.contains('d-none'),
      card: !q('#adminLandingCards [data-admin-side="years"]').classList.contains('d-none'),
      title: q('#adminTopTitle').textContent,
      hero: q('.sy-hero-year').textContent.trim(),
      tiles: [...document.querySelectorAll('.sy-tile-v')].map((e) => e.textContent.trim()),
      acad: q('.sy-acad-v')?.textContent.trim(),
      steps: document.querySelectorAll('.sy-step').length,
      effects: document.querySelectorAll('.sy-effect').length,
      chip: q('#adminYearChipValue').textContent, chipShown: !q('#adminYearChip').classList.contains('d-none'),
      chipLink: q('#adminYearChip').classList.contains('is-link'),
      ppToggle: !!q('#syPpOn'), ppName: q('#syPpName')?.value, target: q('#syTarget')?.value,
      startOn: !q('#syStart')?.disabled,
      css: getComputedStyle(q('.sy-hero-year')).fontWeight,
      text: q('#samoYearHost').innerText,
    });`));
  say('sidebar entry + landing card visible to a master', `${page.side} · ${page.card}`, page.side && page.card);
  say('top bar title', page.title, page.title === 'ปี SAMO');
  say('hero year = current_samo_year()', `${page.hero} vs ${db.cy}`, page.hero === String(db.cy));
  say('ปีการศึกษา = house_settings, never "2,569"', `${page.acad} vs ${db.ay}`, page.acad === String(db.ay));
  say('no year anywhere on the page with a thousands comma', 'checked', !/\b2,5\d\d\b/.test(page.text));
  say('tiles: Passport วาระ · ปีการศึกษา · ปีงบ', page.tiles.join(' · '), page.tiles[0] === db.pp && page.tiles[1] === String(db.ay) && /^25\d\d$/.test(page.tiles[2]));
  say('three steps, six effects', `${page.steps} · ${page.effects}`, page.steps === 3 && page.effects === 6);
  say('top-bar chip shows the year and is a link for a master', `${page.chip} · link ${page.chipLink}`, page.chipShown && page.chip === String(db.cy) && page.chipLink);
  say('step 3 offers the next year, Passport on, a suggested name', `${page.target} · ${page.ppName}`, Number(page.target) > db.cy && page.ppToggle && !!page.ppName);
  say('the stylesheet reached /admin/ (computed)', page.css, page.css === '700');
  await shot('desktop.png');

  // 3. typing a year drives the button + the Passport name; an old year disables it
  const typed = JSON.parse(await ev(`const t = document.getElementById('syTarget');
    const set = (v) => { t.value = v; t.dispatchEvent(new Event('input', { bubbles: true })); };
    set(${db.cy}); const sameOff = document.getElementById('syStart').disabled, err = document.getElementById('syTargetErr').textContent;
    set(${db.cy + 3}); const label = document.getElementById('syStartLabel').textContent, nm = document.getElementById('syPpName').value;
    return JSON.stringify({ sameOff, err, label, nm, on: !document.getElementById('syStart').disabled });`));
  say('the current year cannot be "started" again', `${typed.sameOff} · ${typed.err}`, typed.sameOff && !!typed.err);
  say('the label and Passport name follow the typed year', `${typed.label} · ${typed.nm}`,
    typed.label.includes(String(db.cy + 3)) && typed.nm.endsWith(String((db.cy + 3) % 100).padStart(2, '0')) && typed.on);

  // 4. press it — intercepted, nothing written
  const press = JSON.parse(await ev(`window.__syCalls = [];
    const real = window.fetch;
    window.fetch = async (u, o) => {
      if (String(u).includes('/rpc/start_samo_year')) {
        window.__syCalls.push(JSON.parse(o.body));
        return new Response(JSON.stringify({ year: ${db.cy + 3}, previous_year: ${db.cy}, archived_outgoing: false,
          passport: { moved: true, name: 'X', season: 'Q1' } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return real(u, o);
    };
    document.getElementById('syStart').click();
    await new Promise(r => setTimeout(r, 600));
    const m = document.getElementById('appConfirmModal');
    const title = m.querySelector('[data-confirm-title]').textContent, body = m.querySelector('[data-confirm-body]').textContent;
    m.querySelector('[data-confirm-yes]').click();
    await new Promise(r => setTimeout(r, 1500));
    window.fetch = real;
    return JSON.stringify({ title, body, calls: window.__syCalls, status: document.getElementById('syStatus')?.textContent || '' });`));
  say('the confirm names the year', press.title, press.title.includes(String(db.cy + 3)));
  say('the confirm says Passport starts a new วาระ', press.body.slice(0, 160), /Passport เริ่มวาระ/.test(press.body));
  const c = press.calls[0] || {};
  say('ONE request, the exact payload', JSON.stringify(press.calls),
    press.calls.length === 1 && c.p_year === db.cy + 3 && /\d{2}$/.test(c.p_passport_name || '') && c.p_season_name === 'Q1');
  say('the outcome is said', press.status, /Passport เริ่ม/.test(press.status));
  const [after] = await sql('select public.current_samo_year() cy');
  say('…and nothing was written (intercepted)', after.cy, after.cy === db.cy);

  // ปีการศึกษา: the dialog carries the consequence; cancelled
  const acad = JSON.parse(await ev(`const b = document.querySelector('[data-sy-acad]'); if (!b) return JSON.stringify({ none: true });
    b.click(); await new Promise(r => setTimeout(r, 600));
    const m = document.getElementById('appConfirmModal');
    const t = m.querySelector('[data-confirm-title]').textContent, body = m.querySelector('[data-confirm-body]').textContent;
    m.querySelector('[data-confirm-no]').click(); await new Promise(r => setTimeout(r, 600));
    return JSON.stringify({ t, body });`));
  say('ปีการศึกษา button asks first, with the consequence', `${acad.t} — ${(acad.body || '').slice(0, 80)}`, /เลื่อนปีการศึกษาเป็น \d{4}\?/.test(acad.t || ''));
  const [ay2] = await sql('select academic_year from public.house_settings limit 1');
  say('…cancel changed nothing', ay2.academic_year, ay2.academic_year === db.ay);

  // 5. ทีม SAMO → ทีมแต่ละปี links here; ระบบบ้าน links here
  const team = JSON.parse(await ev(`window.openTeamMode('years'); await new Promise(r => setTimeout(r, 3000));
    const pane = document.getElementById('teamTermsPane');
    return JSON.stringify({ label: document.querySelector('.team-mode-btn[data-team-mode="years"]').textContent.trim(),
      active: document.querySelector('.team-mode-btn[data-team-mode="years"]').classList.contains('is-active'),
      setCurrent: pane.querySelectorAll('[data-term-current]').length, link: !!pane.querySelector('[data-term-goto-year]') });`));
  say('ทีม SAMO opens at ทีมแต่ละปี from the ปี page', `${team.label} · active ${team.active}`, team.label === 'ทีมแต่ละปี' && team.active);
  say('…which offers no ตั้งเป็นปีปัจจุบัน and links to ปี SAMO', `${team.setCurrent} · ${team.link}`, team.setCurrent === 0 && team.link);
  await shot('team-years.png', false);
  const back = await ev(`document.querySelector('[data-term-goto-year]').click(); await new Promise(r => setTimeout(r, 1500));
    return location.hash + ' ' + document.getElementById('adminTopTitle').textContent;`);
  say('…and the link comes back here', back, back === '#years ปี SAMO');

  // phone
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await sleep(1500);
  const sw = JSON.parse(await ev(`window.scrollTo(0,0); return JSON.stringify({ sw: document.documentElement.scrollWidth, w: window.innerWidth });`));
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
