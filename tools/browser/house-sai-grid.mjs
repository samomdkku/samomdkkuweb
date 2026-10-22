#!/usr/bin/env node
// ============================================================
// house-sai-grid.mjs — drive ระบบบ้าน → นักศึกษา → ผังตามสาย for real, SIGNED
// IN as a master, in headless Chrome, against the local dev server on
// samo-dev. Shape copied from accounts-dashboard.mjs.
//
// WHAT IT CHECKS (owner, 2026-10-13): a รุ่น can be PICKED (a button per รุ่น)
// or TYPED (`50`, `md50`); every รุ่น is drawn to the SAME last สาย; and what
// the ฝ่าย said about a held row ("ติดต่อไม่ได้") is printed ON the cell.
//
// It CREATES one held row carrying an answer on samo-dev and deletes it in a
// finally, with the throwaway account.
//
//   node tools/browser/house-sai-grid.mjs        # needs `npm run dev` on :5174
// ============================================================
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadEnv, resolveTarget, runSql } from '../env-lib.mjs';

const DEV_URL = process.env.DEV_URL || 'http://localhost:5174';
const OUT = process.env.OUT || mkdtempSync(join(tmpdir(), 'house-grid-'));
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9341;
const USER = `claudetest${Date.now().toString(36)}`;
const PASS = `t-${Math.random().toString(36).slice(2)}-Aa1`;
const PROBE_NOTE = 'house-sai-grid probe — ไม่ใช่ข้อมูลจริง';

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
  `--user-data-dir=${mkdtempSync(join(tmpdir(), 'house-grid-chrome-'))}`], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws; let id = 0; const pend = {}; const errs = []; let failed = 0; let planted = null;
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

  // 0. CREATE the subject rather than search for one: samo-dev may hold no open
  // held row at all, and a scenario that needs live data that can run out goes
  // red for reasons that are not the subject (mistakes.md class 7). A held row
  // on the busiest รุ่น's first สาย, removed again in the finally.
  [planted] = await sql(`
    with c as (select cohort_year, min(sai_code) sai from public.students
                where cohort_year is not null and sai_code is not null
                group by cohort_year order by count(*) desc limit 1),
    b as (insert into public.student_import_batches (file_name, row_count)
          values ('house-sai-grid-probe.csv', 0) returning id),
    h as (insert into public.student_import_unresolved
            (batch_id, first_name_th, last_name_th, sai_code, cohort_year, reason, follow_up, note)
          select b.id, 'ทดสอบ', 'probe', c.sai, c.cohort_year, 'no_kkumail_no_student_id', 'unreachable', ${lit(PROBE_NOTE)}
            from b, c
          -- A SECOND รุ่น with one person on the LOWEST seeded สาย, so "every รุ่น is drawn to
          -- the same last สาย" compares two boards, not one (samo-dev may hold
          -- a single รุ่น).
          union all
          select b.id, 'ทดสอบ', 'probe2', (select min(code) from public.sais), c.cohort_year + 1, 'no_kkumail_no_student_id', null, null
            from b, c
          returning id::text, batch_id::text, cohort_year, sai_code, follow_up)
    select * from h order by follow_up nulls last`);
  say('a planted held row', planted ? `MD${planted.cohort_year - 2515} สาย ${planted.sai_code}` : 'none', !!planted);

  // 1. account + grant
  await send('Page.navigate', { url: `${DEV_URL}/` }); await sleep(6000);
  const uid = await ev(`const a = await import('/src/js/auth.js'); await a.registerWithPassword(${JSON.stringify(USER)}, ${JSON.stringify(PASS)});
    await a.signOut().catch(()=>{}); await a.signInWithPassword(${JSON.stringify(USER)}, ${JSON.stringify(PASS)}); await new Promise(r=>setTimeout(r,1500)); return a.getUser()?.id || 'no user';`);
  say('throwaway account', uid, /^[0-9a-f-]{36}$/.test(uid || ''));
  await sql(`begin;
    -- samo-dev now creates the users row at sign-up, so this is an UPDATE, and
    -- users_self_update_guard refuses a permissions change from a caller with
    -- no staff JWT — the superuser included. Test setup, so triggers off for
    -- this one transaction only.
    set local session_replication_role = replica;
    insert into public.users (id, username, email, role, method, permissions) values (${lit(uid)}, ${lit(USER)}, ${lit(`${USER}@samomdkku.app`)}, 'user', 'password', array['master'])
             on conflict (id) do update set permissions = excluded.permissions;
             commit;`);
  await send('Page.navigate', { url: `${DEV_URL}/` }); await sleep(4000);
  await ev(`const a = await import('/src/js/auth.js'); await a.signOut().catch(()=>{}); await a.signInWithPassword(${JSON.stringify(USER)}, ${JSON.stringify(PASS)}); await new Promise(r=>setTimeout(r,2000)); return 1;`);

  // 2. ระบบบ้าน → นักศึกษา → ผังตามสาย
  await send('Page.navigate', { url: `${DEV_URL}/admin/#house` });
  let ready = null;
  for (let i = 0; i < 60 && !ready; i += 1) {
    await sleep(1000);
    ready = await ev(`const b = document.querySelector('[data-house-mode="students"]'); return b && !b.closest('.d-none') ? 'ok' : null;`);
  }
  say('ระบบบ้าน opened', ready || 'no', ready === 'ok');
  await ev(`document.querySelector('[data-house-mode="students"]').click(); await new Promise(r=>setTimeout(r,1500));
    document.querySelector('[data-house-students-view="grid"]').click(); await new Promise(r=>setTimeout(r,1500)); return 1;`);

  const g = JSON.parse(await ev(`const chips = [...document.querySelectorAll('#houseSaiGridChips [data-sai-grid-cohort]')].map(b => b.dataset.saiGridCohort);
    const sizes = {};
    for (const c of chips) {
      document.querySelector('[data-sai-grid-cohort="' + c + '"]').click(); await new Promise(r=>setTimeout(r,250));
      sizes[c] = document.querySelectorAll('#houseSaiGridCells .sai-cell').length;
    }
    return JSON.stringify({ chips, sizes, legend: document.getElementById('houseSaiGridLegend').textContent });`));
  say('one button per รุ่น (incl. the planted second รุ่น)', g.chips.join(' '), g.chips.length >= 2);
  const sizes = [...new Set(Object.values(g.sizes))];
  say('every รุ่น drawn to the SAME last สาย', JSON.stringify(g.sizes), sizes.length === 1 && sizes[0] > 0);
  say('legend names the answered state', /ฝ่ายแจ้งเหตุผลแล้ว/.test(g.legend), /ฝ่ายแจ้งเหตุผลแล้ว/.test(g.legend));

  const md = `MD${planted.cohort_year - 2515}`;
  const t = JSON.parse(await ev(`const box = document.getElementById('houseSaiGridYear');
    box.focus(); box.value = ${JSON.stringify(String(planted.cohort_year - 2515))}; box.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r=>setTimeout(r,300));
    const active = document.querySelector('#houseSaiGridChips .btn-success')?.dataset.saiGridCohort;
    box.value = 'md' + ${JSON.stringify(String(planted.cohort_year - 2515))}; box.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r=>setTimeout(r,300));
    const active2 = document.querySelector('#houseSaiGridChips .btn-success')?.dataset.saiGridCohort;
    box.blur(); await new Promise(r=>setTimeout(r,300));
    const cell = [...document.querySelectorAll('#houseSaiGridCells .sai-cell')]
      .find(c => c.querySelector('.fw-semibold')?.textContent.trim() === ${JSON.stringify(planted.sai_code)});
    return JSON.stringify({ active, active2, notes: [...(cell?.querySelectorAll('.sai-cell-note') || [])].map(n => n.textContent.trim()),
      noteVisible: cell ? getComputedStyle(cell.querySelector('.sai-cell-note') || cell).display !== 'none' : false });`));
  say(`typing "${planted.cohort_year - 2515}" picks ${md}`, t.active, t.active === md);
  say(`typing "md${planted.cohort_year - 2515}" picks ${md}`, t.active2, t.active2 === md);
  say('the ฝ่าย\'s answer is printed on the cell', JSON.stringify(t.notes),
    t.notes.some((n) => n.includes('ติดต่อไม่ได้')) && t.notes.some((n) => n.includes('probe')) && t.noteVisible);
  await shot('grid-desktop.png');

  // ยังนำเข้าไม่ได้: record ลาออก on the planted row through the pane's own
  // controls and the in-page confirm, read the DATABASE, then reopen it.
  const pick = async (act, setup) => ev(`${setup}
    document.querySelector('tr[data-held-id="${planted.id}"] [data-held-act="${act}"]').click();
    await new Promise(r=>setTimeout(r,600));
    document.querySelector('[data-confirm-yes]')?.click();
    await new Promise(r=>setTimeout(r,3500)); return 1;`);
  await ev(`document.querySelector('[data-house-mode="held"]').click(); await new Promise(r=>setTimeout(r,2000)); return 1;`);
  const rowThere = await ev(`return !!document.querySelector('tr[data-held-id="${planted.id}"]');`);
  say('the planted row is in ยังนำเข้าไม่ได้, showing its answer', rowThere, rowThere === true);
  await pick('follow', `const sel = document.querySelector('tr[data-held-id="${planted.id}"] [data-held-follow]'); sel.value = 'left';`);
  const [afterLeft] = await sql(`select follow_up, resolved_how, resolved_at is not null as closed
    from public.student_import_unresolved where id = ${lit(planted.id)}`);
  say('ลาออก through the pane closes the row in the database', JSON.stringify(afterLeft),
    afterLeft.follow_up === 'left' && afterLeft.resolved_how === 'dismissed' && afterLeft.closed);
  await ev(`const cb = document.getElementById('houseHeldShowDone'); if (!cb.checked) cb.click(); await new Promise(r=>setTimeout(r,800)); return 1;`);
  await pick('reopen', '');
  const [afterOpen] = await sql(`select follow_up, resolved_at is not null as closed
    from public.student_import_unresolved where id = ${lit(planted.id)}`);
  say('เปิดใหม่ through the pane reopens it and clears the answer', JSON.stringify(afterOpen),
    afterOpen.follow_up === null && afterOpen.closed === false);

  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await sleep(1200);
  const sw = JSON.parse(await ev(`return JSON.stringify({ sw: document.documentElement.scrollWidth, w: window.innerWidth });`));
  say('phone: no sideways scroll', `${sw.sw} ≤ ${sw.w}`, sw.sw <= sw.w);
  await shot('grid-phone.png', false);

  say('console errors', errs.length ? errs.join(' | ') : 'none', errs.length === 0);
} catch (e) {
  say('run', e.message, false);
} finally {
  try {
    if (planted) {
      await sql(`delete from public.student_import_unresolved where batch_id = ${lit(planted.batch_id)};
        delete from public.student_import_batches where id = ${lit(planted.batch_id)};`);
    }
    const left = await sql(`delete from public.users where username = ${lit(USER)};
      delete from auth.users where email = ${lit(`${USER}@samomdkku.app`)};
      select (select count(*) from auth.users where email = ${lit(`${USER}@samomdkku.app`)}) accounts,
             (select count(*) from public.student_import_unresolved where last_name_th like 'probe%') probes;`);
    console.log(`cleanup: ${JSON.stringify(left)}`);
  } catch (e) { console.log(`cleanup FAILED: ${e.message}`); }
  try { ws?.close(); } catch {}
  chrome.kill();
  console.log(`\n${failed ? `${failed} FAILED` : 'all passed'} · screenshots: ${OUT}`);
  process.exit(failed ? 1 : 0);
}
