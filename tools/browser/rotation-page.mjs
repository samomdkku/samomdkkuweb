#!/usr/bin/env node
// ============================================================
// rotation-page.mjs — drive /rotation "แลก Rotation" SIGNED IN, in headless
// Chrome, against the local dev server on samo-dev: a real request and a real
// accept between two accounts, through the page's own buttons, on phone, iPad
// and desktop widths.
//
// WHAT IT DOES, all on samo-dev (it REFUSES any other project):
//   1. registers two throwaway username accounts;
//   2. points two roster rows of the SAME gender in DIFFERENT groups at them
//      (their real kkumails are saved and put back), opens the round;
//   3. A asks B through "ขอแลก" + the confirm sheet; B sees it in
//      "คำขอถึงคุณ", accepts through the sheet; asserts the groups swapped and
//      A's page updated WITHOUT a reload (realtime or the poll);
//   4. screenshots every view at 390, 820 and 1440 px;
//   5. ALWAYS restores: groups, kkumails, the round's switches, the rows the
//      run wrote, and deletes both accounts.
//
// RUN (needs `npm run dev` on :5174 and Chrome; the roster imported on
// samo-dev with tools/rotation-import.mjs --dev --commit):
//   node tools/browser/rotation-page.mjs
//   OUT=/tmp/x node tools/browser/rotation-page.mjs
// ============================================================
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadEnv, resolveTarget, runSql } from '../env-lib.mjs';

const DEV_URL = process.env.DEV_URL || 'http://localhost:5174';
const OUT = process.env.OUT || mkdtempSync(join(tmpdir(), 'rotation-page-'));
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9345;
const ROUND = 'y6-2570';
const stamp = Date.now().toString(36);
const A = { user: `claudeA${stamp}`, pass: `t-${Math.random().toString(36).slice(2)}-Aa1` };
const B = { user: `claudeB${stamp}`, pass: `t-${Math.random().toString(36).slice(2)}-Aa1` };

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

const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${mkdtempSync(join(tmpdir(), 'rotation-chrome-'))}`], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws; let id = 0; const pend = {}; const errs = []; let failed = 0;
const say = (label, v, ok = true) => { if (!ok) failed += 1; console.log(`${ok ? '✓' : '✗'} ${label}: ${v}`); };
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pend[i] = res; ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (e) => (await send('Runtime.evaluate', { expression: `(async()=>{try{${e}}catch(err){return 'ERR '+err.message}})()`, awaitPromise: true, returnByValue: true })).result?.value;
const shot = async (name, full = true) => { const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: full }); writeFileSync(join(OUT, name), Buffer.from(r.data, 'base64')); };
const size = (w, h, mobile) => send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile });
const signInAs = (who) => ev(`const a = await import('/src/js/auth.js'); await a.signOut().catch(()=>{}); await a.signInWithPassword(${JSON.stringify(who.user)}, ${JSON.stringify(who.pass)}); await new Promise(r=>setTimeout(r,2500)); return a.getUser()?.id || 'no user';`);
const register = (who) => ev(`const a = await import('/src/js/auth.js'); await a.signOut().catch(()=>{}); await a.registerWithPassword(${JSON.stringify(who.user)}, ${JSON.stringify(who.pass)}); await new Promise(r=>setTimeout(r,1500)); return a.getUser()?.id || 'no user';`);
const view = (v) => ev(`document.querySelector('#rotRoot .rot-seg-btn[data-rot-view="${v}"]').click(); await new Promise(r=>setTimeout(r,300)); return 1`);
const sheetYes = () => ev(`await new Promise(r=>setTimeout(r,700)); document.querySelector('#rotSheet [data-rot-sheet-yes]').click(); await new Promise(r=>setTimeout(r,2500)); return 1`);

let saved = null;
let roundBefore = null;
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
  await size(390, 844, true);

  // ── signed out ────────────────────────────────────────────────────────────
  await send('Page.navigate', { url: `${DEV_URL}/rotation` }); await sleep(5000);
  const out = await ev(`return { pane: document.getElementById('pills-rotation').classList.contains('active'),
    gate: document.getElementById('rotGate').textContent.replace(/\\s+/g,' ').trim().slice(0,60) }`);
  say('signed out: /rotation asks to sign in', JSON.stringify(out), out.pane && /เข้าสู่ระบบ/.test(out.gate));
  await shot('phone-signed-out.png', false);

  // ── accounts + the roster rows they stand in for ─────────────────────────
  for (const who of [A, B]) {
    who.uid = await register(who);
    if (!/^[0-9a-f-]{36}$/.test(who.uid)) throw new Error(`register failed: ${who.uid}`);
  }
  const emails = await sql(`select id::text, lower(email) email from public.users where id in (${lit(A.uid)}, ${lit(B.uid)})`);
  A.email = emails.find((e) => e.id === A.uid).email;
  B.email = emails.find((e) => e.id === B.uid).email;
  const [pair] = await sql(`
    select a.id a_id, a.kkumail a_mail, a.current_group a_group, a.person_id::text a_person,
           b.id b_id, b.kkumail b_mail, b.current_group b_group, b.person_id::text b_person
      from public.rotation_students a join public.rotation_students b
        on b.round_id = a.round_id and b.gender = a.gender and b.current_group <> a.current_group
     where a.round_id = ${lit(ROUND)} and a.current_group = 'A' and b.current_group = 'C' and a.gender = 'M'
     order by a.student_id, b.student_id limit 1`);
  if (!pair) throw new Error('no roster pair on samo-dev — run tools/rotation-import.mjs --dev --commit first');
  saved = pair;
  [roundBefore] = await sql(`select published, swaps_open, swaps_close_at, gpa_rule from public.rotation_rounds where id = ${lit(ROUND)}`);
  // person_id is cleared for the run so the match is by the probe's email only
  // (a real person's account must not be the one that matches).
  await sql(`update public.rotation_students set kkumail = ${lit(A.email)}, person_id = null where id = ${lit(pair.a_id)};
    update public.rotation_students set kkumail = ${lit(B.email)}, person_id = null where id = ${lit(pair.b_id)};
    update public.rotation_rounds set published = true, swaps_open = true, swaps_close_at = null, gpa_rule = 'off' where id = ${lit(ROUND)};
    select 1`);
  say('two probes stand in for a same-gender pair', `${pair.a_group} ↔ ${pair.b_group}`);

  // ── A asks B (phone) ──────────────────────────────────────────────────────
  await signInAs(A);
  await send('Page.navigate', { url: `${DEV_URL}/rotation` }); await sleep(5000);
  const meA = await ev(`return document.querySelector('.rot-me-group-letter')?.textContent`);
  say('A sees their group', meA, meA === pair.a_group);
  await shot('phone-mine.png');
  await view('groups');
  await shot('phone-groups.png');
  await ev(`document.querySelector('#rotRoot [data-rot-act="jump-group"][data-group="${pair.b_group}"]').click(); await new Promise(r=>setTimeout(r,600)); return 1`);
  await shot('phone-group-open.png', false);
  const asked = await ev(`const b = document.querySelector('#rotRoot [data-rot-act="ask"][data-id="${pair.b_id}"]'); if (!b) return 'no ask button'; b.click(); return 'ok'`);
  say('A: "ขอแลก" is on B\'s row', asked, asked === 'ok');
  await sleep(800);
  await shot('phone-sheet-ask.png', false);
  await sheetYes();
  const outA = await ev(`return document.getElementById('rotInbox').textContent.replace(/\\s+/g,' ').trim().slice(0,120)`);
  say('A: the ask is listed under คำขอของคุณ', outA, /คำขอของคุณ/.test(outA));

  // ── B accepts (iPad) ──────────────────────────────────────────────────────
  await size(820, 1180, true);
  await signInAs(B);
  await send('Page.navigate', { url: `${DEV_URL}/rotation` }); await sleep(5000);
  const inB = await ev(`return document.getElementById('rotInbox').textContent.replace(/\\s+/g,' ').trim().slice(0,160)`);
  say('B: the ask arrives under คำขอถึงคุณ', inB, /คำขอถึงคุณ/.test(inB));
  await shot('ipad-mine-incoming.png');
  await ev(`document.querySelector('#rotInbox [data-rot-act="accept"]').click(); return 1`);
  await sleep(800);
  await shot('ipad-sheet-accept.png', false);
  await sheetYes();
  const meB = await ev(`return document.querySelector('.rot-me-group-letter')?.textContent`);
  say('B is now in A\'s old group', meB, meB === pair.a_group);
  const [db] = await sql(`select (select current_group from public.rotation_students where id = ${lit(pair.a_id)}) a,
                                 (select current_group from public.rotation_students where id = ${lit(pair.b_id)}) b`);
  say('database agrees: swapped', `${db.a}/${db.b}`, db.a === pair.b_group && db.b === pair.a_group);
  await view('feed');
  await shot('ipad-feed.png');

  // ── desktop, as A, without navigating: the page must catch up by itself ──
  await size(1440, 900, false);
  await signInAs(A);
  await send('Page.navigate', { url: `${DEV_URL}/rotation` }); await sleep(5000);
  const meA2 = await ev(`return document.querySelector('.rot-me-group-letter')?.textContent`);
  say('A (desktop) now in B\'s old group', meA2, meA2 === pair.b_group);
  await shot('desktop-mine.png');
  await view('groups');
  await shot('desktop-groups.png');
  // Live: move A by hand in the DB (as an admin would) and wait for the page.
  await sql(`update public.rotation_students set current_group = ${lit(pair.a_group)} where id = ${lit(pair.a_id)};
             insert into public.rotation_events (round_id) values (${lit(ROUND)}); select 1`);
  let live = null;
  for (let i = 0; i < 70 && live !== pair.a_group; i += 1) {
    await sleep(1000);
    live = await ev(`return document.querySelector('.rot-me-group-letter')?.textContent`);
  }
  const how = await ev(`return document.querySelector('.rot-live-dot')?.textContent.trim()`);
  say('A\'s open page follows a change it did not make', `${live} (${how})`, live === pair.a_group);
  await view('mine');
  await shot('desktop-after-live.png');

  say('no page errors', errs.length ? errs.join(' | ') : 'none', errs.length === 0);
} catch (e) {
  failed += 1;
  console.log('✗ run aborted:', e.message);
} finally {
  try {
    if (saved) {
      await sql(`
        delete from public.rotation_moves where student_id in (${lit(saved.a_id)}, ${lit(saved.b_id)});
        delete from public.rotation_requests where requester_id in (${lit(saved.a_id)}, ${lit(saved.b_id)})
                                               or target_id in (${lit(saved.a_id)}, ${lit(saved.b_id)});
        update public.rotation_students set current_group = ${lit(saved.a_group)}, kkumail = ${saved.a_mail ? lit(saved.a_mail) : 'null'},
               person_id = ${saved.a_person ? lit(saved.a_person) : 'null'} where id = ${lit(saved.a_id)};
        update public.rotation_students set current_group = ${lit(saved.b_group)}, kkumail = ${saved.b_mail ? lit(saved.b_mail) : 'null'},
               person_id = ${saved.b_person ? lit(saved.b_person) : 'null'} where id = ${lit(saved.b_id)};
        select 1`);
    }
    if (roundBefore) {
      await sql(`update public.rotation_rounds set published = ${roundBefore.published}, swaps_open = ${roundBefore.swaps_open},
        swaps_close_at = ${roundBefore.swaps_close_at ? lit(roundBefore.swaps_close_at) : 'null'}, gpa_rule = ${lit(roundBefore.gpa_rule)}
        where id = ${lit(ROUND)}; select 1`);
    }
    for (const who of [A, B]) {
      await sql(`delete from public.users where username = ${lit(who.user)};
        delete from auth.users where email = ${lit(`${who.user.toLowerCase()}@samomdkku.app`)}; select 1`);
    }
    const [left] = await sql(`select (select count(*) from auth.users where email like 'claude_%${stamp}@samomdkku.app') accounts,
      (select count(*) from public.rotation_students where round_id = ${lit(ROUND)} and current_group <> original_group) moved`);
    say('cleaned up (accounts, moved students on samo-dev)', JSON.stringify(left), Number(left.accounts) === 0);
  } catch (e) { failed += 1; console.log('✗ cleanup failed:', e.message); }
  chrome.kill();
  console.log(`\nscreenshots: ${OUT}`);
  process.exit(failed ? 1 : 0);
}
