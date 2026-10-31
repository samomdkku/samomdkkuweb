#!/usr/bin/env node
// ============================================================
// team-years.mjs — build a ทีม SAMO year by hand and see it on เกี่ยวกับเรา
// (0270), SIGNED IN as a master, in headless Chrome, against the local dev
// server on samo-dev. Shape copied from year-page.mjs.
//
// WHAT IT DOES, all on samo-dev (it REFUSES any other project), on the
// throwaway year 2686 (below every proof's sentinel range):
//   1. registers a throwaway username account and gives it `master`;
//   2. ทีม SAMO → ทีมแต่ละปี: adds 2686 "คัดลอกผังตอนนี้" and reads the editor
//      against the database (every ตำแหน่ง listed, the count line, hidden);
//   3. adds a ฝ่าย, a typed person (the form stays open and focused for the
//      next name), and a CURRENT member by name — who must bring their photo;
//   4. moves the typed person; the ตำแหน่ง move list leaves out the
//      ตำแหน่ง's own descendants;
//   5. shows the year — then the PUBLIC page lists a "ทีมปี 2686" button
//      that shows the hand-added ฝ่าย and person, and still opens on the
//      current year;
//   6. deletes the ฝ่าย (the confirm names what goes with it), hides the year;
//   7. 390px phone with the editor open: no sideways scroll; no console errors.
//   ALWAYS deletes year 2686 and the account.
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
const DIV = 'ฝ่ายทดสอบเบราว์เซอร์';
const TYPED = 'คนทดสอบ เบราว์เซอร์';

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
  // Answer the app-drawn confirm (confirm-modal.js); returns its title + body.
  const answer = (yes) => `await new Promise(r => setTimeout(r, 600));
    const m = document.getElementById('appConfirmModal');
    const title = m.querySelector('[data-confirm-title]').textContent, body = m.querySelector('[data-confirm-body]').textContent;
    m.querySelector('[data-confirm-${yes ? 'yes' : 'no'}]').click();
    await new Promise(r => setTimeout(r, 1500));`;
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

  // 2. add 2686 from the live tree
  const [live] = await sql(`with recursive l as (
      select id from public.team_nodes where parent_id is null and is_public
      union all select c.id from public.team_nodes c join l on c.parent_id = l.id where c.is_public)
    select (select count(*) from l) nodes, (select count(*) from public.team_members m join l on l.id = m.node_id) members,
           public.current_samo_year() cy`);
  const [withPhoto] = await sql(`with recursive l as (
      select id from public.team_nodes where parent_id is null and is_public
      union all select c.id from public.team_nodes c join l on c.parent_id = l.id where c.is_public)
    select m.id, m.full_name, m.photo_url from public.team_members m join l on l.id = m.node_id
     where m.photo_url is not null and btrim(m.full_name) <> ''
       and (select count(*) from public.team_members x where btrim(x.full_name) = btrim(m.full_name)) = 1
     order by m.id limit 1`);
  await send('Page.navigate', { url: `${DEV_URL}/admin/` });
  await waitFor(`typeof window.openTeamMode === 'function'`, 60);
  await ev(`window.openAdminSection?.('team'); await new Promise(r => setTimeout(r, 1500)); window.openTeamMode('years'); return 1;`);
  const pane = await waitFor(`document.querySelector('#teamTermsPane .team-terms-list')`, 40);
  say('ทีมแต่ละปี painted', pane, pane);
  await ev(`document.getElementById('teamTermNewYear').value = '${Y}'; document.getElementById('teamTermStart').value = 'live';
    document.getElementById('teamTermAddForm').requestSubmit(); return 1;`);
  const opened = await waitFor(`document.querySelectorAll('#teamTermBody .team-arc-group').length > 0`, 60);
  const ed = JSON.parse(await ev(`return JSON.stringify({ groups: document.querySelectorAll('#teamTermBody .team-arc-group').length,
      rows: document.querySelectorAll('#teamTermBody .team-arc-row').length,
      count: document.querySelector('.team-arc-count')?.textContent, status: document.getElementById('teamTermsStatus').textContent,
      badge: document.querySelector('.team-term.is-open .team-term-badges')?.textContent.replace(/\\s+/g, ' ').trim() });`));
  const [d1] = await sql(`select (select published_at is null from public.team_terms where year = ${Y}) hidden,
      (select count(*) from public.team_archive_nodes where year = ${Y}) nodes,
      (select count(*) from public.team_archive_members where year = ${Y}) members`);
  say('2686 added from the live tree and its editor opened', `${opened} · ${ed.status}`, opened && /เพิ่มปี 2686 แล้ว/.test(ed.status));
  say('…the database copied every public ตำแหน่ง and person', `${d1.nodes}/${live.nodes} · ${d1.members}/${live.members}`,
    Number(d1.nodes) === Number(live.nodes) && Number(d1.members) === Number(live.members));
  say('…the editor lists EVERY ตำแหน่ง (empty ones too) and every person', `${ed.groups} groups · ${ed.rows} rows · "${ed.count}"`,
    ed.groups === Number(d1.nodes) && ed.rows === Number(d1.members));
  say('…and it is not shown yet', `${d1.hidden} · ${ed.badge}`, d1.hidden === true && /ยังไม่แสดง/.test(ed.badge));

  // 3. a ฝ่าย, a typed person, a current member by name
  await ev(`document.querySelector('[data-an-add-node=""]').click(); await new Promise(r => setTimeout(r, 400));
    const f = document.querySelector('[data-add-node-form=""]'); f.elements.name.value = ${JSON.stringify(DIV)}; f.elements.kind.value = 'division';
    f.requestSubmit(); return 1;`);
  await waitFor(`[...document.querySelectorAll('[data-an-name]')].some(i => i.value === ${JSON.stringify(DIV)})`, 20);
  const [div] = await sql(`select id, kind, parent_id from public.team_archive_nodes where year = ${Y} and name = ${lit(DIV)}`);
  say('เพิ่มฝ่าย writes a top-level ฝ่าย', JSON.stringify(div || null), div && div.kind === 'division' && div.parent_id === null);
  const typed = JSON.parse(await ev(`document.querySelector('[data-am-add="${div?.id}"]').click(); await new Promise(r => setTimeout(r, 400));
    const f = document.querySelector('[data-add-member-form="${div?.id}"]'); f.elements.name.value = ${JSON.stringify(TYPED)}; f.elements.nickname.value = 'ทด';
    f.requestSubmit(); await new Promise(r => setTimeout(r, 2500));
    const a = document.activeElement;
    return JSON.stringify({ focus: a?.name === 'name' && !!a.closest('[data-add-member-form="${div?.id}"]'), status: document.getElementById('teamTermsStatus').textContent });`));
  const [tp] = await sql(`select id, nickname, photo_url, src_member_id from public.team_archive_members where year = ${Y} and full_name = ${lit(TYPED)}`);
  say('a typed person is added with their ชื่อเล่น and no identity', JSON.stringify(tp || null), tp && tp.nickname === 'ทด' && !tp.src_member_id && !tp.photo_url);
  say('…and the form stays open with the cursor on the next name', `${typed.focus} · ${typed.status}`, typed.focus);
  if (withPhoto) {
    await ev(`const f = document.querySelector('[data-add-member-form="${div?.id}"]'); f.elements.name.value = ${JSON.stringify(withPhoto.full_name)};
      f.requestSubmit(); await new Promise(r => setTimeout(r, 2500)); return 1;`);
    const [cm] = await sql(`select photo_url, src_member_id from public.team_archive_members
      where year = ${Y} and node_id = ${lit(div.id)} and full_name = ${lit(withPhoto.full_name)}`);
    say('a CURRENT member typed by name brings their photo and the src link', JSON.stringify(cm ? { photo: !!cm.photo_url, src: cm.src_member_id === withPhoto.id } : null),
      cm && cm.photo_url === withPhoto.photo_url && cm.src_member_id === withPhoto.id);
  } else {
    say('a CURRENT member with a unique name and a photo exists on samo-dev', 'none — skipped', false);
  }

  // 4. moves
  const [target] = await sql(`select id from public.team_archive_nodes where year = ${Y} and kind = 'role' order by position, name limit 1`);
  await ev(`document.querySelector('[data-am-move="${tp?.id}"]').click(); await new Promise(r => setTimeout(r, 300));
    const s = document.querySelector('[data-move-target="${tp?.id}"]'); s.value = '${target.id}'; s.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 2000)); return 1;`);
  const [moved] = await sql(`select node_id from public.team_archive_members where id = ${lit(tp?.id)}`);
  say('ย้าย moves a person to another ตำแหน่ง', moved?.node_id === target.id, moved?.node_id === target.id);
  const [parent] = await sql(`select p.id, (select array_agg(c.id) from public.team_archive_nodes c where c.parent_id = p.id) kids
      from public.team_archive_nodes p where p.year = ${Y} and p.parent_id is null
       and exists (select 1 from public.team_archive_nodes c where c.parent_id = p.id) order by p.position limit 1`);
  const opts = JSON.parse(await ev(`document.querySelector('[data-an-move="${parent.id}"]').click(); await new Promise(r => setTimeout(r, 300));
    const s = document.querySelector('[data-move-target="${parent.id}"]'); const v = [...s.options].map(o => o.value);
    document.querySelector('[data-move-cancel]').click(); return JSON.stringify(v);`));
  const kids = parent.kids || [];
  say('a ตำแหน่ง\'s move list leaves out itself and its descendants', `${opts.length} options, ${kids.length} children excluded`,
    !opts.includes(parent.id) && kids.every((k) => !opts.includes(k)) && opts.includes(''));
  await shot('editor.png', false);

  // 5. show → the public page
  await ev(`document.querySelector('[data-term-shown="${Y}"]').click(); await new Promise(r => setTimeout(r, 2500)); return 1;`);
  const [d2] = await sql(`select published_at is not null shown from public.team_terms where year = ${Y}`);
  say('แสดงบนหน้าเกี่ยวกับเรา publishes the year as it stands', d2.shown, d2.shown === true);
  await send('Page.navigate', { url: `${DEV_URL}/about` });
  const chips = await waitFor(`[...document.querySelectorAll('#orgYears [data-year]')].length > 1`, 40);
  const pub = JSON.parse(await ev(`const b = [...document.querySelectorAll('#orgYears [data-year]')];
    return JSON.stringify({ labels: b.map(x => x.textContent.trim()), active: document.querySelector('#orgYears .is-active')?.dataset.year });`));
  say('เกี่ยวกับเรา lists a "ทีมปี 2686" button', pub.labels.join(' · '), chips && pub.labels.includes(`ทีมปี ${Y}`));
  say('…and still opens on the current year', `${pub.active} vs ${live.cy}`, String(pub.active) === String(live.cy));
  const shown = JSON.parse(await ev(`document.querySelector('#orgYears [data-year="${Y}"]').click(); await new Promise(r => setTimeout(r, 3000));
    const t = document.getElementById('orgBody').innerText;
    return JSON.stringify({ div: t.includes(${JSON.stringify(DIV)}), active: document.querySelector('#orgYears .is-active')?.dataset.year });`));
  say('…which shows the hand-added ฝ่าย', `${shown.div} · active ${shown.active}`, shown.div && shown.active === String(Y));
  const person = await ev(`const card = [...document.querySelectorAll('[data-org-open]')].find(c => c.textContent.includes(${JSON.stringify(DIV)}));
    if (!card) return 'no card'; card.click(); await new Promise(r => setTimeout(r, 1500));
    return document.body.innerText.includes(${JSON.stringify(withPhoto?.full_name || TYPED)}) ? 'yes' : 'no';`);
  say('…and the people in it', person, person === 'yes');
  await shot('public.png', false);

  // 6. delete the ฝ่าย, hide the year
  await send('Page.navigate', { url: `${DEV_URL}/admin/` });
  await waitFor(`typeof window.openTeamMode === 'function'`, 60);
  await ev(`window.openAdminSection?.('team'); await new Promise(r => setTimeout(r, 1500)); window.openTeamMode('years'); return 1;`);
  await waitFor(`document.querySelector('[data-term-edit="${Y}"]')`, 40);
  await ev(`document.querySelector('[data-term-edit="${Y}"]').click(); return 1;`);
  await waitFor(`document.querySelector('[data-an-delete="${div?.id}"]')`, 40);
  const del = JSON.parse(await ev(`document.querySelector('[data-an-delete="${div?.id}"]').click(); ${answer(true)} return JSON.stringify({ title, body });`));
  const [d3] = await sql(`select count(*) n from public.team_archive_nodes where id = ${lit(div?.id)}`);
  say('ลบ ฝ่าย asks, naming who goes with it', del.body.slice(0, 90), /รายชื่อ \d+ คน/.test(del.body) || /ผังสด/.test(del.body));
  say('…and removes it', d3.n, Number(d3.n) === 0);
  const hide = JSON.parse(await ev(`document.querySelector('[data-term-shown="${Y}"]').click(); ${answer(true)} return JSON.stringify({ title });`));
  const [d4] = await sql(`select published_at is null hidden from public.team_terms where year = ${Y}`);
  say('ซ่อน asks, then hides the year', `${hide.title} · ${d4.hidden}`, d4.hidden === true);

  // 7. phone
  await ev(`document.querySelector('[data-term-edit="${Y}"]')?.click(); return 1;`);
  await sleep(500);
  if (!(await ev(`return !!document.getElementById('teamTermBody');`))) await ev(`document.querySelector('[data-term-edit="${Y}"]')?.click(); return 1;`);
  await waitFor(`document.querySelectorAll('#teamTermBody .team-arc-group').length > 0`, 30);
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await sleep(1500);
  const sw = JSON.parse(await ev(`window.scrollTo(0,0); return JSON.stringify({ sw: document.documentElement.scrollWidth, w: window.innerWidth });`));
  say('phone, editor open: no sideways scroll', `${sw.sw} ≤ ${sw.w}`, sw.sw <= sw.w);
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
             (select count(*) from public.team_terms where year = ${Y}) years;`);
    console.log(`cleanup: ${JSON.stringify(left)}`);
  } catch (e) { console.log(`cleanup FAILED: ${e.message}`); }
  try { ws?.close(); } catch {}
  chrome.kill();
  await sleep(500);
  try { rmSync(PROFILE, { recursive: true, force: true }); } catch { /* best effort */ }
  console.log(`\n${failed ? `${failed} FAILED` : 'all passed'} · screenshots: ${OUT}`);
  process.exit(failed ? 1 : 0);
}
