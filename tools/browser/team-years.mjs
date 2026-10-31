#!/usr/bin/env node
// ============================================================
// team-years.mjs — prepare NEXT year's ทีม SAMO in advance (0271), SIGNED IN
// as a master, in headless Chrome, against the local dev server on samo-dev.
// Replaces the 0270 run of the same name: ทีมแต่ละปี is gone, and the year
// is picked once, from the chips above the pane (like ระบบบ้าน's MD49 … MD54).
//
// WHAT IT DOES, all on samo-dev (it REFUSES any other project), on the
// throwaway year 2686 (below every proof's sentinel range):
//   1. registers a throwaway username account and gives it `master`;
//   2. ทีม SAMO opens on the CURRENT year chip; + adds 2686, which is
//      "ยังไม่เตรียม" and offers คัดลอกจากทีมตอนนี้ / เริ่มจากว่าง;
//   3. คัดลอกจากทีมตอนนี้ — the draft holds every live ตำแหน่ง and person, the
//      editor paints it, and the head says "เหมือนทีมตอนนี้ทุกอย่าง";
//   4. เพิ่มฝ่าย in 2686 writes team_draft_nodes and NOT team_nodes, and a
//      permission given in 2686 changes the draft row, not the live one —
//      the summary line then counts both;
//   5. the current chip shows the live tree again, without the new ฝ่าย;
//   6. แสดงบนหน้าเกี่ยวกับเรา → the PUBLIC page lists "ทีมปี 2686" with the
//      new ฝ่าย, and still opens on the current year;
//   7. a past year (if samo-dev has one) opens its archive list, no tree;
//   8. 390px phone on 2686: no sideways scroll; no console errors.
//   It does NOT press the switch — that rewrites samo-dev's live tree; the
//   apply is proved in SQL by tools/team0271-prepared-year.sql.
//   ALWAYS deletes year 2686 (its draft cascades) and the account.
//
// RUN (needs `npm run dev` on :5174 — it uses samo-dev — and Chrome):
//   node tools/browser/team-years.mjs
// ============================================================
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadEnv, resolveTarget, runSql } from '../env-lib.mjs';

const DEV_URL = process.env.DEV_URL || 'http://localhost:5174';
const OUT = process.env.OUT || mkdtempSync(join(tmpdir(), 'team-years-'));
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9348;
const USER = `claudetest${Date.now().toString(36)}`;
const PASS = `t-${Math.random().toString(36).slice(2)}-Aa1`;
const Y = 2686;
const DIV = 'ฝ่ายทดสอบปีหน้า';

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
const PROFILE = mkdtempSync(join(tmpdir(), 'team-years-chrome-'));
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${PROFILE}`], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws; let id = 0; const pend = {}; const errs = []; let failed = 0;
const say = (label, v, ok = true) => { if (!ok) failed += 1; console.log(`${ok ? '✓' : '✗'} ${label}: ${v}`); };

try {
  await sql(`delete from public.team_terms where year = ${Y};`);
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
  const chipOf = (y) => `document.querySelector('#teamYearBar [data-team-year="${y}"]')`;
  const headText = `document.getElementById('teamYearHead').innerText.replace(/\\s+/g, ' ')`;
  const treeShown = `(document.getElementById('teamTree').offsetParent !== null)`;
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false });

  // 1. account + grant
  await send('Page.navigate', { url: `${DEV_URL}/` }); await sleep(6000);
  const uid = await ev(`const a = await import('/src/js/auth.js'); await a.registerWithPassword(${JSON.stringify(USER)}, ${JSON.stringify(PASS)});
    await a.signOut().catch(()=>{}); await a.signInWithPassword(${JSON.stringify(USER)}, ${JSON.stringify(PASS)}); await new Promise(r=>setTimeout(r,1500)); return a.getUser()?.id || 'no user';`);
  say('throwaway account', uid, /^[0-9a-f-]{36}$/.test(uid || ''));
  await sql(`alter table public.users disable trigger users_self_update_guard;
             insert into public.users (id, username, email, role, method, permissions) values (${lit(uid)}, ${lit(USER)}, ${lit(`${USER}@samomdkku.app`)}, 'user', 'password', array['master'])
             on conflict (id) do update set permissions = excluded.permissions;
             alter table public.users enable trigger users_self_update_guard;`);
  await send('Page.navigate', { url: `${DEV_URL}/` }); await sleep(4000);
  await ev(`const a = await import('/src/js/auth.js'); await a.signOut().catch(()=>{}); await a.signInWithPassword(${JSON.stringify(USER)}, ${JSON.stringify(PASS)}); await new Promise(r=>setTimeout(r,2000)); return 1;`);

  const [live] = await sql(`select (select count(*) from public.team_nodes) nodes, (select count(*) from public.team_members) members,
    public.current_samo_year() cy, (select max(year) from public.team_terms where year < public.current_samo_year()) past`);

  // 2. the year bar, then + 2686
  await send('Page.navigate', { url: `${DEV_URL}/admin/` });
  await waitFor(`typeof window.openTeamMode === 'function'`, 60);
  await ev(`window.openAdminSection?.('team'); return 1;`);
  const bar = await waitFor(`document.querySelector('#teamYearBar .btn-success[data-team-year]')`, 40);
  const b0 = JSON.parse(await ev(`const on = document.querySelector('#teamYearBar .btn-success[data-team-year]');
    return JSON.stringify({ year: on?.dataset.teamYear, sub: on?.querySelector('.team-year-sub')?.textContent,
      years: !!document.querySelector('.team-mode-btn[data-team-mode="years"]') });`));
  say('ทีม SAMO opens on the CURRENT year chip', `${b0.year} · ${b0.sub}`, bar && String(b0.year) === String(live.cy) && b0.sub === 'ปัจจุบัน');
  say('…and there is no ทีมแต่ละปี tab any more', b0.years, b0.years === false);
  await ev(`document.querySelector('[data-team-year-add]').click(); await new Promise(r => setTimeout(r, 300));
    const f = document.querySelector('[data-team-year-addform]'); f.elements.year.value = '${Y}'; f.requestSubmit(); return 1;`);
  const added = await waitFor(`${chipOf(Y)}?.classList.contains('btn-success') && document.querySelector('[data-team-year-start="live"]')`, 40);
  const b1 = JSON.parse(await ev(`return JSON.stringify({ sub: ${chipOf(Y)}?.querySelector('.team-year-sub')?.textContent, tree: ${treeShown} });`));
  say('+ adds 2686, selected, "ยังไม่เตรียม" with the two ways to start', `${added} · ${b1.sub}`, added && b1.sub === 'ยังไม่เตรียม');
  say('…and no tree is drawn for a year nobody prepared', b1.tree, b1.tree === false);
  await shot('unprepared.png', false);

  // 3. copy from the live tree
  await ev(`document.querySelector('[data-team-year-start="live"]').click(); return 1;`);
  const copied = await waitFor(`${chipOf(Y)}?.querySelector('.team-year-sub')?.textContent === 'เตรียมไว้' && document.querySelector('.team-year-summary')`, 60);
  const [d1] = await sql(`select (select count(*) from public.team_draft_nodes where term_year = ${Y}) nodes,
      (select count(*) from public.team_draft_members where term_year = ${Y}) members`);
  say('คัดลอกจากทีมตอนนี้ copies every ตำแหน่ง and person into the draft', `${d1.nodes}/${live.nodes} · ${d1.members}/${live.members}`,
    copied && Number(d1.nodes) === Number(live.nodes) && Number(d1.members) === Number(live.members));
  await waitFor(`${treeShown} && document.querySelectorAll('#teamTree [data-node-id]').length > 0`, 30);
  const t1 = JSON.parse(await ev(`return JSON.stringify({ nodes: document.querySelectorAll('#teamTree [data-node-id]').length,
    summary: document.querySelector('.team-year-summary')?.textContent, head: ${headText} });`));
  say('…the editor paints the draft', `${t1.nodes} nodes on screen`, t1.nodes > 0);
  say('…and the head says nothing changes yet', t1.summary, t1.summary === 'เหมือนทีมตอนนี้ทุกอย่าง' && /ใช้จริงเมื่อเริ่มปี SAMO 2686/.test(t1.head));

  // 4. a ฝ่าย and a permission, in 2686 only
  await ev(`document.getElementById('teamAddRoot').click(); await new Promise(r => setTimeout(r, 800));
    document.getElementById('teamNodeName').value = ${JSON.stringify(DIV)};
    document.querySelector('[data-team-modal-save="teamNodeModal"]').click(); await new Promise(r => setTimeout(r, 2500)); return 1;`);
  const [d2] = await sql(`select (select count(*) from public.team_draft_nodes where term_year = ${Y} and name = ${lit(DIV)}) draft,
      (select count(*) from public.team_nodes where name = ${lit(DIV)}) live`);
  say('เพิ่มฝ่าย in 2686 writes the draft, not the live tree', `draft ${d2.draft} · live ${d2.live}`, Number(d2.draft) === 1 && Number(d2.live) === 0);
  const [m] = await sql(`select id, permissions from public.team_draft_members where term_year = ${Y}
      and not ('shop' = any(permissions)) and coalesce(full_name,'') <> '' order by id limit 1`);
  const perm = m ? await ev(`const api = await import('/src/js/team/api.js');
    if (api.treeDraftYear() !== ${Y}) return 'tree is on ' + api.treeDraftYear();
    await api.updateMember(${JSON.stringify(m.id)}, { permissions: [...${JSON.stringify(m.permissions || [])}, 'shop'] });
    (await import('/src/js/team/year-bar.js')).refreshYearSummary(); await new Promise(r => setTimeout(r, 2000)); return 'ok';`) : 'no member';
  const [d3] = await sql(`select (select 'shop' = any(permissions) from public.team_draft_members where term_year = ${Y} and id = ${lit(m?.id)}) draft,
      (select 'shop' = any(permissions) from public.team_members where id = ${lit(m?.id)}) live`);
  say('a permission given in 2686 changes the draft row only', `${perm} · draft ${d3.draft} · live ${d3.live}`, perm === 'ok' && d3.draft === true && d3.live !== true);
  const s2 = await ev(`return document.querySelector('.team-year-summary')?.textContent || '';`);
  say('…and the summary line counts both', s2, /ตำแหน่งใหม่ 1/.test(s2) && /1 คนเปลี่ยนตำแหน่งหรือสิทธิ์/.test(s2));
  await shot('draft.png', false);

  // 5. back to the current year
  await ev(`${chipOf(live.cy)}.click(); return 1;`);
  const back = await waitFor(`${treeShown} && document.querySelectorAll('#teamTree [data-node-id]').length > 0 && !document.getElementById('teamTree').innerText.includes(${JSON.stringify(DIV)})`, 30);
  say('the current chip shows the live tree again, without the new ฝ่าย', back, back);

  // 6. show 2686 → the public page
  await ev(`${chipOf(Y)}.click(); await new Promise(r => setTimeout(r, 2000)); document.querySelector('[data-team-year-shown="${Y}"]').click();
    await new Promise(r => setTimeout(r, 2500)); return 1;`);
  const [d4] = await sql(`select published_at is not null shown from public.team_terms where year = ${Y}`);
  say('แสดงบนหน้าเกี่ยวกับเรา shows the prepared year', d4.shown, d4.shown === true);
  await send('Page.navigate', { url: `${DEV_URL}/about` });
  const chips = await waitFor(`[...document.querySelectorAll('#orgYears [data-year]')].length > 1`, 40);
  const pub = JSON.parse(await ev(`const b = [...document.querySelectorAll('#orgYears [data-year]')];
    return JSON.stringify({ labels: b.map(x => x.textContent.trim()), active: document.querySelector('#orgYears .is-active')?.dataset.year });`));
  say('เกี่ยวกับเรา lists a "ทีมปี 2686" button', pub.labels.join(' · '), chips && pub.labels.includes(`ทีมปี ${Y}`));
  say('…and still opens on the current year', `${pub.active} vs ${live.cy}`, String(pub.active) === String(live.cy));
  const shown = JSON.parse(await ev(`document.querySelector('#orgYears [data-year="${Y}"]').click(); await new Promise(r => setTimeout(r, 3000));
    return JSON.stringify({ div: document.getElementById('orgBody').innerText.includes(${JSON.stringify(DIV)}) });`));
  say('…which shows the ฝ่าย added to the prepared year', shown.div, shown.div);
  await shot('public.png', false);

  // 7. a past year
  await send('Page.navigate', { url: `${DEV_URL}/admin/` });
  await waitFor(`typeof window.openTeamMode === 'function'`, 60);
  await ev(`window.openAdminSection?.('team'); return 1;`);
  await waitFor(`${chipOf(live.cy)}`, 40);
  if (live.past) {
    await ev(`${chipOf(live.past)}.click(); return 1;`);
    const arc = await waitFor(`!document.getElementById('teamTermsPane').classList.contains('d-none') && !${treeShown}`, 30);
    const h = await ev(`return ${headText};`);
    say(`a past year (${live.past}) opens its list, not the tree, and grants nothing`, h.slice(0, 90), arc && /ไม่ให้สิทธิ์ใคร/.test(h));
  } else {
    say('a past year exists on samo-dev', 'none — skipped', true);
  }

  // 8. phone
  await ev(`${chipOf(Y)}.click(); return 1;`);
  await waitFor(`${treeShown} && document.querySelectorAll('#teamTree [data-node-id]').length > 0`, 30);
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await sleep(1500);
  const sw = JSON.parse(await ev(`window.scrollTo(0,0); return JSON.stringify({ sw: document.documentElement.scrollWidth, w: window.innerWidth });`));
  say('phone, 2686 open: no sideways scroll', `${sw.sw} ≤ ${sw.w}`, sw.sw <= sw.w);
  await shot('phone.png', false);

  say('console errors', errs.length ? errs.join(' | ') : 'none', errs.length === 0);
} catch (e) {
  say('run', e.message, false);
} finally {
  try {
    const left = await sql(`delete from public.team_terms where year = ${Y};
      delete from public.users where username = ${lit(USER)};
      delete from auth.users where email = ${lit(`${USER}@samomdkku.app`)};
      select (select count(*) from auth.users where email = ${lit(`${USER}@samomdkku.app`)}) accounts,
             (select count(*) from public.team_terms where year = ${Y}) years,
             (select count(*) from public.team_draft_nodes where term_year = ${Y}) drafts,
             (select count(*) from public.team_nodes where name = ${lit(DIV)}) live_div;`);
    console.log(`cleanup: ${JSON.stringify(left)}`);
  } catch (e) { console.log(`cleanup FAILED: ${e.message}`); }
  try { ws?.close(); } catch {}
  chrome.kill();
  await sleep(500);
  try { rmSync(PROFILE, { recursive: true, force: true }); } catch { /* best effort */ }
  console.log(`\n${failed ? `${failed} FAILED` : 'all passed'} · screenshots: ${OUT}`);
  process.exit(failed ? 1 : 0);
}
