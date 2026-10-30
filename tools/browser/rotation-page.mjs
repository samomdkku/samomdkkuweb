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
//   3. A writes a contact + GPA, then asks B through "ขอแลก" + the confirm
//      sheet; B sees it in the offers banner at the top (with A's contact,
//      never A's GPA — 0251), accepts through the sheet; asserts the groups
//      swapped, the feed draws the pair, and A's page updated WITHOUT a
//      reload (realtime or the poll);
//   4. iPad landscape: the left column scrolls with the page (no inner scroll
//      hiding "คำขอของคุณ"); the "อยู่กลุ่มนี้" switch on and off;
//   5. โหมดทดลอง: three pretend offers at once, accept one, the rest close,
//      staying blocks offers, leave — the real board comes back untouched;
//   5. screenshots every view at 390, 820 and 1440 px;
//   6. ALWAYS restores: groups, kkumails, contact/GPA, the round's switches,
//      the rows the run wrote, and deletes both accounts.
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
let runStart = null;
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
    select a.id a_id, a.kkumail a_mail, a.current_group a_group, a.person_id::text a_person, a.contact a_contact, a.gpa::text a_gpa,
           b.id b_id, b.kkumail b_mail, b.current_group b_group, b.person_id::text b_person, b.contact b_contact, b.gpa::text b_gpa
      from public.rotation_students a join public.rotation_students b
        on b.round_id = a.round_id and b.gender = a.gender and b.current_group <> a.current_group
     where a.round_id = ${lit(ROUND)} and a.current_group = 'A' and b.current_group = 'C' and a.gender = 'M'
     order by a.student_id, b.student_id limit 1`);
  if (!pair) throw new Error('no roster pair on samo-dev — run tools/rotation-import.mjs --dev --commit first');
  saved = pair;
  // Every GPA write is logged (0261) and the 4th is refused (0262), so a run
  // that leaves its own two log rows behind (the save + the restore) makes the
  // NEXT run's save the 3rd edit, which opens a warning instead of saving.
  // Cleanup deletes this run's rows, found by this instant.
  [{ t: runStart }] = await sql(`select now()::text t`);
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
  const saved1 = await ev(`const f = document.querySelector('#rotMe [data-rot-form="profile"]');
    f.elements.contact.value = 'LINE: probe-${stamp}'; f.elements.gpa.value = '3.41';
    f.querySelector('[type=submit]').click(); await new Promise(r=>setTimeout(r,2500));
    return document.getElementById('rotToast').textContent`);
  const [cg] = await sql(`select contact, gpa::text gpa from public.rotation_students where id = ${lit(pair.a_id)}`);
  say('A saves contact + GPA in one go', `${saved1} → ${cg.contact} / ${cg.gpa}`, cg.contact === `LINE: probe-${stamp}` && cg.gpa === '3.41');
  const guide = await ev(`return !!document.querySelector('#rotGuide .rot-step') && document.querySelectorAll('#rotGuide .rot-step.is-done').length`);
  say('the guide is shown and ticks step 2 after saving', String(guide), guide === 2);
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
  const inB = await ev(`return document.getElementById('rotAlert').hidden ? 'HIDDEN' : document.getElementById('rotAlert').textContent.replace(/\\s+/g,' ').trim().slice(0,200)`);
  say('B: the ask arrives in the banner at the top, with A\'s contact', inB, /ขอแลกกับคุณ/.test(inB) && inB.includes(`probe-${stamp}`));
  const gpaLeak = await ev(`const r = await (await import('/src/js/db.js')).dbRest('/rpc/rotation_board', { method: 'POST', body: { p_round: '${ROUND}' } });
    const t = JSON.stringify(r.data); return (t.includes('3.41') || (r.data.students || []).some((s) => 'gpa' in s)) + '/' + (r.data.students || []).length`);
  say('B\'s board carries nobody\'s GPA (0251)', gpaLeak, /^false\/\d+$/.test(gpaLeak) && !gpaLeak.endsWith('/0'));
  await shot('ipad-mine-incoming.png');
  await ev(`document.querySelector('#rotAlert [data-rot-act="accept"]').click(); return 1`);
  await sleep(800);
  await shot('ipad-sheet-accept.png', false);
  await sheetYes();
  const meB = await ev(`return document.querySelector('.rot-me-group-letter')?.textContent`);
  say('B is now in A\'s old group', meB, meB === pair.a_group);
  const [db] = await sql(`select (select current_group from public.rotation_students where id = ${lit(pair.a_id)}) a,
                                 (select current_group from public.rotation_students where id = ${lit(pair.b_id)}) b`);
  say('database agrees: swapped', `${db.a}/${db.b}`, db.a === pair.b_group && db.b === pair.a_group);
  await view('feed');
  const pairs = await ev(`return document.querySelectorAll('#rotViewFeed .rot-pair').length`);
  say('the feed draws the swap as a pair', String(pairs), pairs >= 1);
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

  // ── 0265: a classmate's kkumail through the API, as a signed-in student ──
  const [fem] = await sql(`select id::text from public.rotation_students where round_id = ${lit(ROUND)} and gender = 'F' limit 1`);
  const mail = await ev(`const { dbRest } = await import('/src/js/db.js');
    const one = async (id) => (await dbRest('/rpc/rotation_contact_email', { method: 'POST', body: { p_round: '${ROUND}', p_student: id } })).data;
    const b = await one('${pair.b_id}'); const f = await one('${fem.id}');
    return (b?.kkumail === ${JSON.stringify(B.email)}) + '/' + (f?.reason || JSON.stringify(f))`);
  say('0265: A reads same-gender B\'s kkumail, not a woman\'s', mail, mail === 'true/not_eligible');

  // ── a failed background read: keep the board, say so, back off, recover ──
  await ev(`window.__realFetch = window.fetch; window.__boardTries = 0;
    window.fetch = (u, o) => { if (String(u).includes('/rpc/rotation_board')) { window.__boardTries += 1; return Promise.reject(new TypeError('probe: offline')); }
                               return window.__realFetch(u, o); };
    document.dispatchEvent(new Event('visibilitychange')); await new Promise(r=>setTimeout(r,1500)); return 1`);
  const staleNow = await ev(`return !!document.querySelector('#rotStatus .rot-pill.is-stale') + '/' + document.getElementById('rotMain').hidden
    + '/' + document.querySelector('.rot-me-group-letter')?.textContent`);
  say('board read fails: the old board stays and the status says so', staleNow, staleNow === `true/false/${pair.a_group}`);
  await shot('desktop-stale.png', false);
  await sleep(20000);
  const tries = await ev(`return window.__boardTries`);
  // backoff: the trigger + ~3 s + ~9 s (+ ~21 s at the edge) — the old fixed 2–4 s timer made 6–10
  say('… and backs off: board reads in 21 s while failing', String(tries), tries >= 2 && tries <= 4);
  await ev(`window.fetch = window.__realFetch; document.dispatchEvent(new Event('visibilitychange')); await new Promise(r=>setTimeout(r,2500)); return 1`);
  const healed = await ev(`return !!document.querySelector('#rotStatus .rot-pill.is-stale') + '/' + !!document.querySelector('#rotStatus .rot-live-dot')`);
  say('… and the warning goes once a read succeeds', healed, healed === 'false/true');
  errs.length = 0;   // the probe's own rejected fetches are not page bugs

  // ── iPad landscape: one page scroll, nothing hidden inside the left column ─
  await size(1180, 820, true);
  await send('Page.reload'); await sleep(5000);
  const side = await ev(`const el = document.querySelector('#rotRoot .rot-side'); const cs = getComputedStyle(el);
    const order = [...el.children].filter((c) => !c.hidden && c.innerHTML.trim()).map((c) => c.id).join(',');
    return cs.overflowY + '/' + cs.position + '/' + order`);
  say('iPad landscape: left column has no inner scroll; me first', side, /^visible\/static\/rotMe/.test(side));
  await shot('ipad-landscape.png', false);
  // "ฉันอยากอยู่กลุ่มนี้" on, then off
  await ev(`const t = document.querySelector('#rotMe [data-rot-input="stay"]'); t.click(); await new Promise(r=>setTimeout(r,2500)); return 1`);
  const [st1] = await sql(`select staying from public.rotation_students where id = ${lit(pair.a_id)}`);
  const tag = await ev(`return !!document.querySelector('#rotMe .rot-tag.is-stay')`);
  say('the stay switch saves and shows "อยู่กลุ่มนี้"', `${st1.staying}/${tag}`, st1.staying === true && tag === true);
  await shot('ipad-landscape-staying.png', false);
  await ev(`document.querySelector('#rotMe [data-rot-input="stay"]').click(); await new Promise(r=>setTimeout(r,2500)); return 1`);
  const [st2] = await sql(`select staying from public.rotation_students where id = ${lit(pair.a_id)}`);
  say('… and switches back off', String(st2.staying), st2.staying === false);

  // ── โหมดทดลอง (phone): be the one who gets several offers ──────────────
  await size(390, 844, true);
  const realGroup = await ev(`return document.querySelector('.rot-me-group-letter')?.textContent`);
  const countWrites = async () => (await sql(`select (select count(*) from public.rotation_requests where round_id = ${lit(ROUND)})
      + (select count(*) from public.rotation_moves where round_id = ${lit(ROUND)})
      + (select count(*) from public.rotation_chains where round_id = ${lit(ROUND)})
      + (select count(*) from public.rotation_wishes w join public.rotation_students s on s.id = w.student_id where s.round_id = ${lit(ROUND)}) n`))[0].n;
  const writesBefore = await countWrites();
  await ev(`document.getElementById('rotPracticeBtn').click(); await new Promise(r=>setTimeout(r,800)); return 1`);
  // the off-criteria sheet fills in the classmate's KKU Mail (0265; practice answers with a pretend one)
  await view('groups');
  const offMail = await ev(`const b = document.querySelector('#rotViewGroups [data-rot-act="ask-off-criteria"]'); if (!b) return 'no off-criteria button';
    b.click(); await new Promise(r=>setTimeout(r,900));
    const t = document.querySelector('#rotSheet [data-rot-mail]')?.textContent || 'no mail line';
    document.querySelector('#rotSheet [data-bs-dismiss="modal"]').click(); await new Promise(r=>setTimeout(r,600)); return t`);
  say('off-criteria sheet shows the classmate\'s KKU Mail', offMail, /@kkumail\.com$/.test(offMail));
  await view('mine');
  await ev(`document.querySelector('#rotPractice [data-scene="many_ask_me"]').click(); await new Promise(r=>setTimeout(r,800)); return 1`);
  const offers = await ev(`return document.querySelectorAll('#rotAlert .rot-offer').length`);
  say('practice: three offers at once in the banner', String(offers), offers === 3);
  await send('Runtime.evaluate', { expression: 'window.scrollTo(0,0)' });
  await shot('phone-practice-offers.png');
  await ev(`document.querySelectorAll('#rotAlert [data-rot-act="accept"]')[1].click(); return 1`);
  await sleep(800);
  await shot('phone-practice-sheet.png', false);
  await sheetYes();
  const after = await ev(`return document.getElementById('rotAlert').hidden + '/' + document.querySelector('.rot-me-group-letter')?.textContent`);
  say('practice: accepting one closes the others and moves you', after, after.startsWith('true/') && !after.endsWith(`/${realGroup}`));
  await sleep(6500);   // let the highlight of OUR swap fade (FLASH_MS) so only theirs is counted
  await ev(`document.querySelector('#rotPractice [data-scene="others_swap"]').click(); await new Promise(r=>setTimeout(r,900)); return 1`);
  const flashing = await ev(`return document.querySelectorAll('#rotViewGroups .rot-member.is-flash').length`);
  say('practice: two others swap → both rows flash in หาคนแลก', String(flashing), flashing === 2);
  await shot('phone-practice-groups.png');

  // แลกต่อเนื่อง (0255) in practice: be asked to fill a leg, say yes, the others say yes
  await ev(`document.querySelector('#rotPractice [data-scene="chain_needs_me"]').click(); await new Promise(r=>setTimeout(r,800)); return 1`);
  const chainOffer = await ev(`return document.querySelectorAll('#rotAlert .rot-offer.is-chain').length`);
  say('practice chain: a chain offer appears in the banner', String(chainOffer), chainOffer === 1);
  await send('Runtime.evaluate', { expression: 'window.scrollTo(0,0)' });
  await shot('phone-practice-chain-offer.png', false);
  const g0 = await ev(`return document.querySelector('.rot-me-group-letter')?.textContent`);
  await ev(`document.querySelector('#rotAlert [data-rot-act="chain-yes"]').click(); return 1`);
  await sleep(800);
  await shot('phone-practice-chain-sheet.png', false);
  await sheetYes();
  const committed = await ev(`return document.querySelectorAll('#rotInbox .rot-ask.is-chain').length + '/' + document.querySelector('.rot-me-group-letter')?.textContent`);
  say('practice chain: a yes is a commitment — listed in my asks, nobody moved', committed, committed === `1/${g0}`);
  await ev(`document.querySelector('#rotPractice [data-scene="chain_others_yes"]').click(); await new Promise(r=>setTimeout(r,900)); return 1`);
  const g1 = await ev(`return document.querySelector('.rot-me-group-letter')?.textContent`);
  say('practice chain: the last yes moves all three (me included)', `${g0} → ${g1}`, !!g1 && g1 !== g0);
  await ev(`document.querySelector('#rotRoot .rot-seg-btn[data-rot-view="groups"]').click(); await new Promise(r=>setTimeout(r,400)); return 1`);
  const cyc = await ev(`return document.querySelectorAll('#rotViewGroups .rot-pair.is-chain').length`);
  say('practice chain: แลกล่าสุด draws the 3-person cycle', String(cyc), cyc >= 1);
  // the route finder: pick a group, see routes, start one
  await ev(`document.querySelector('#rotViewGroups [data-rot-act="route"]').click(); await new Promise(r=>setTimeout(r,400)); return 1`);
  const routes = await ev(`return document.querySelectorAll('#rotViewGroups .rot-route-item').length`);
  say('route finder: routes through a middle group are listed', String(routes), routes >= 1);
  await ev(`document.querySelector('#rotViewGroups .rot-route').scrollIntoView(); return 1`);
  await shot('phone-practice-route.png', false);
  await ev(`document.querySelector('#rotViewGroups [data-rot-act="chain-ask"]').click(); return 1`);
  await sleep(800);
  await sheetYes();
  const started = await ev(`return document.querySelectorAll('#rotInbox .rot-ask.is-chain').length`);
  say('route finder: starting a chain lists it under my asks', String(started), started === 1);
  await ev(`document.querySelector('#rotMe [data-rot-act="wish"]').click(); await new Promise(r=>setTimeout(r,800)); return 1`);
  const wish = await ev(`return document.querySelector('#rotMe [data-rot-act="wish"][aria-pressed="true"]') ? 'on' : 'off'`);
  say('wishes: a chip toggles and stays on after the re-read', wish, wish === 'on');

  await ev(`document.querySelector('#rotMe [data-rot-input="stay"]').click(); await new Promise(r=>setTimeout(r,800)); return 1`);
  await sheetYes();   // the chain started above is an open ask, so staying asks to confirm first
  const stayChain = await ev(`return document.querySelectorAll('#rotInbox .rot-ask.is-chain').length`);
  say('practice: staying cancels my own chain', String(stayChain), stayChain === 0);
  const blocked = await ev(`document.querySelector('#rotPractice [data-scene="one_asks_me"]').click(); await new Promise(r=>setTimeout(r,500));
    return document.getElementById('rotToast').dataset.tone + '/' + document.getElementById('rotAlert').hidden`);
  say('practice: while staying, nobody can send you an offer', blocked, blocked === 'error/true');
  await ev(`document.querySelector('#rotPractice [data-rot-act="practice-stop"]').click(); await new Promise(r=>setTimeout(r,3000)); return 1`);
  const back = await ev(`return document.getElementById('rotPractice').hidden + '/' + document.querySelector('.rot-me-group-letter')?.textContent`);
  say('leaving practice brings the real board back unchanged', back, back === `true/${realGroup}`);
  const writesAfter = await countWrites();
  say('practice wrote nothing to the database', `${writesBefore} → ${writesAfter}`, String(writesBefore) === String(writesAfter));

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
               person_id = ${saved.a_person ? lit(saved.a_person) : 'null'},
               contact = ${saved.a_contact ? lit(saved.a_contact) : 'null'}, gpa = ${saved.a_gpa ? lit(saved.a_gpa) : 'null'}, staying = false, staying_at = null where id = ${lit(saved.a_id)};
        update public.rotation_students set current_group = ${lit(saved.b_group)}, kkumail = ${saved.b_mail ? lit(saved.b_mail) : 'null'},
               person_id = ${saved.b_person ? lit(saved.b_person) : 'null'},
               contact = ${saved.b_contact ? lit(saved.b_contact) : 'null'}, gpa = ${saved.b_gpa ? lit(saved.b_gpa) : 'null'}, staying = false, staying_at = null where id = ${lit(saved.b_id)};
        delete from public.rotation_gpa_audit where student_id in (${lit(saved.a_id)}, ${lit(saved.b_id)})
                                                and changed_at >= ${lit(runStart)};
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
      (select count(*) from public.rotation_students where round_id = ${lit(ROUND)} and current_group <> original_group) moved,
      (select count(*) from public.rotation_gpa_audit where ${saved ? `student_id in (${lit(saved.a_id)}, ${lit(saved.b_id)}) and changed_at >= ${lit(runStart || 'infinity')}` : 'false'}) gpa_log`);
    say('cleaned up (accounts, moved students, GPA log on samo-dev)', JSON.stringify(left), Number(left.accounts) === 0 && Number(left.gpa_log) === 0);
  } catch (e) { failed += 1; console.log('✗ cleanup failed:', e.message); }
  chrome.kill();
  console.log(`\nscreenshots: ${OUT}`);
  process.exit(failed ? 1 : 0);
}
