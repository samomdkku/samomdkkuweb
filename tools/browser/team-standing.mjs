// ============================================================
// tools/browser/team-standing.mjs — the ประจำปี | ถาวร switch (0272), in a
// real browser against samo-dev.
//
// What it proves, in order:
//   1. ถาวร hides the year bar, says what ถาวร means, and offers เพิ่มกลุ่ม;
//   2. a group added there is ถาวร in the database and hidden from เกี่ยวกับเรา,
//      and it is NOT drawn on the ประจำปี side;
//   3. a person added with a gmail address is saved, and the row says
//      ยังไม่เคยเข้าระบบ (nobody has signed in with it);
//   4. an address with a comma is refused on save (the …@kku,ail.com typo);
//   5. the pin moves the group back to ประจำปี (row gone from the ถาวร list);
//   5b. a ถาวร group made ELSEWHERE (another tab / the database) while this
//      tab sits on ประจำปี arrives by live sync on the ถาวร side, never as a
//      yearly ฝ่าย (0273 — the "SAMOWEB FOUNDER MD50" report);
//   6. 390px phone on ถาวร: no sideways scroll; no console errors.
//   ALWAYS deletes the group (its member cascades) and the account.
//
// RUN (needs `npm run dev` on :5174 — it uses samo-dev — and Chrome):
//   node tools/browser/team-standing.mjs
// ============================================================
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadEnv, resolveTarget, runSql } from '../env-lib.mjs';

const DEV_URL = process.env.DEV_URL || 'http://localhost:5174';
const OUT = process.env.OUT || mkdtempSync(join(tmpdir(), 'team-standing-'));
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9349;
const USER = `claudetest${Date.now().toString(36)}`;
const PASS = `t-${Math.random().toString(36).slice(2)}-Aa1`;
const GROUP = `กลุ่มถาวรทดสอบ ${Date.now().toString(36)}`;
const MAIL = `proof0272.${Date.now().toString(36)}@gmail.com`;
// Made by "another editor" (straight into the database) while this tab is open.
// REPORTED 2026-11-01: "SAMOWEB FOUNDER MD50" landed public on เกี่ยวกับเรา —
// a tab that had loaded BEFORE a group was marked ถาวร kept drawing it under
// ประจำปี, because live sync carried the node but not the ถาวร list.
const REMOTE = `กลุ่มถาวรจากอีกแท็บ ${Date.now().toString(36)}`;

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
const PROFILE = mkdtempSync(join(tmpdir(), 'team-standing-chrome-'));
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

  // 1. account + grant (master)
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

  await send('Page.navigate', { url: `${DEV_URL}/admin/` });
  await waitFor(`typeof window.openTeamMode === 'function'`, 60);
  await ev(`window.openAdminSection?.('team'); return 1;`);
  await waitFor(`document.querySelector('#teamYearBar .btn-success[data-team-year]') && document.querySelectorAll('#teamTree [data-node-id]').length > 0`, 60);
  // Never let a native dialog block the page: record alerts instead.
  await ev(`window.__alerts = []; window.alert = (m) => window.__alerts.push(String(m)); return 1;`);
  const navLabel = await ev(`return document.querySelector('[data-admin-side="team"] span')?.textContent || '';`);
  say('the nav item is called ทีมและสิทธิ์', navLabel, navLabel === 'ทีมและสิทธิ์');

  // 2. ถาวร
  const yearBarShown = `(document.getElementById('teamYearBar').offsetParent !== null)`;
  await ev(`document.querySelector('[data-team-section="standing"]').click(); return 1;`);
  await sleep(1200);
  const s1 = JSON.parse(await ev(`return JSON.stringify({ bar: ${yearBarShown},
    cap: document.getElementById('teamSectionCaption').textContent,
    add: document.getElementById('teamAddRootLabel').textContent,
    selected: document.querySelector('[data-team-section="standing"]').getAttribute('aria-selected') });`));
  say('ถาวร hides the year bar', s1.bar, s1.bar === false);
  say('…says what it means, and offers เพิ่มกลุ่ม', `${s1.add} · ${s1.cap.slice(0, 40)}…`, s1.add === 'เพิ่มกลุ่ม' && /ทุกปี/.test(s1.cap) && s1.selected === 'true');
  await shot('standing-empty.png', false);

  await ev(`document.getElementById('teamAddRoot').click(); await new Promise(r => setTimeout(r, 800));
    document.getElementById('teamNodeName').value = ${JSON.stringify(GROUP)};
    document.querySelector('[data-team-modal-save="teamNodeModal"]').click(); await new Promise(r => setTimeout(r, 3000)); return 1;`);
  const [g1] = await sql(`select n.id, n.is_public, (select count(*) from public.team_standing_groups g where g.node_id = n.id) standing
      from public.team_nodes n where n.name = ${lit(GROUP)}`);
  say('เพิ่มกลุ่ม on ถาวร writes a ถาวร group, hidden from เกี่ยวกับเรา', `standing ${g1?.standing} · public ${g1?.is_public}`, Number(g1?.standing) === 1 && g1?.is_public === false);
  const inTree = `document.getElementById('teamTree').innerText.includes(${JSON.stringify(GROUP)})`;
  const onStanding = await waitFor(inTree, 10);
  say('…and the ถาวร tree draws it', onStanding, onStanding);

  // 3. a gmail person
  await ev(`document.querySelector('#teamTree .team-node[data-node-id="${g1.id}"] [data-act="add-member"]').click();
    await new Promise(r => setTimeout(r, 900));
    document.getElementById('teamMemberFirstName').value = 'ทดสอบ';
    document.getElementById('teamMemberLastName').value = 'ถาวร';
    document.getElementById('teamMemberEmail').value = 'proof0272@kku,ail.com';
    document.querySelector('[data-team-modal-save="teamMemberModal"]').click(); await new Promise(r => setTimeout(r, 1500)); return 1;`);
  const typo = JSON.parse(await ev(`return JSON.stringify({ alerts: window.__alerts.slice(),
    open: document.getElementById('teamMemberModal').classList.contains('show') });`));
  const [t0] = await sql(`select count(*) n from public.team_members where node_id = ${lit(g1.id)}`);
  say('an address with a comma is refused on save', `${typo.alerts.join(' / ').slice(0, 60)} · saved ${t0.n}`,
    /ใช้เข้าสู่ระบบไม่ได้/.test(typo.alerts.join(' ')) && Number(t0.n) === 0 && typo.open);
  const label = await ev(`return document.querySelector('label[for="teamMemberEmail"]').textContent.trim();`);
  say('…and the box is labelled อีเมลที่ใช้เข้าระบบ', label, label === 'อีเมลที่ใช้เข้าระบบ');
  await ev(`document.getElementById('teamMemberEmail').value = ${JSON.stringify(MAIL)};
    document.querySelector('[data-team-modal-save="teamMemberModal"]').click(); await new Promise(r => setTimeout(r, 3000)); return 1;`);
  const [t1] = await sql(`select count(*) n, max(kkumail) mail from public.team_members where node_id = ${lit(g1.id)}`);
  say('the gmail address is saved', `${t1.n} · ${t1.mail}`, Number(t1.n) === 1 && t1.mail === MAIL);
  // The sign-in map loads with the tree; reload the tab so the row has it.
  await send('Page.navigate', { url: `${DEV_URL}/admin/` });
  await waitFor(`typeof window.openTeamMode === 'function'`, 60);
  await ev(`window.openAdminSection?.('team'); return 1;`);
  await waitFor(`document.querySelectorAll('#teamTree [data-node-id]').length > 0`, 60);
  await ev(`document.querySelector('[data-team-section="standing"]').click(); return 1;`);
  await waitFor(inTree, 20);
  await ev(`const li = document.querySelector('#teamTree .team-node[data-node-id="${g1.id}"]');
    li.querySelector('.team-node-body')?.classList.remove('d-none'); return 1;`);
  const tag = await ev(`return document.querySelector('#teamTree .team-node[data-node-id="${g1.id}"] .team-tag-signin')?.textContent || '';`);
  say('…and the row says nobody has signed in with it', tag, tag === 'ยังไม่เคยเข้าระบบ');
  await shot('standing.png', false);

  // 4. ประจำปี does not draw it
  await ev(`document.querySelector('[data-team-section="year"]').click(); return 1;`);
  await sleep(1200);
  const y1 = JSON.parse(await ev(`return JSON.stringify({ bar: ${yearBarShown}, has: ${inTree},
    nodes: document.querySelectorAll('#teamTree [data-node-id]').length });`));
  say('ประจำปี shows the year bar and NOT the ถาวร group', `bar ${y1.bar} · drawn ${y1.has} · ${y1.nodes} nodes`, y1.bar && !y1.has && y1.nodes > 0);

  // 5. the pin moves it back
  await ev(`document.querySelector('[data-team-section="standing"]').click(); await new Promise(r => setTimeout(r, 800));
    document.querySelector('#teamTree .team-node[data-node-id="${g1.id}"] [data-act="unmark-standing"]').click();
    await new Promise(r => setTimeout(r, 900));
    document.querySelector('[data-confirm-yes]').click(); await new Promise(r => setTimeout(r, 2500)); return 1;`);
  const [g2] = await sql(`select count(*) n from public.team_standing_groups where node_id = ${lit(g1.id)}`);
  const gone = await ev(`return !${inTree};`);
  say('the pin moves the group back to ประจำปี', `standing rows ${g2.n} · off the ถาวร list ${gone}`, Number(g2.n) === 0 && gone === true);
  // …and back again, so the phone check has something to draw.
  await ev(`document.querySelector('[data-team-section="year"]').click(); await new Promise(r => setTimeout(r, 800));
    document.querySelector('#teamTree .team-node[data-node-id="${g1.id}"] [data-act="mark-standing"]').click();
    await new Promise(r => setTimeout(r, 900));
    document.querySelector('[data-confirm-yes]').click(); await new Promise(r => setTimeout(r, 2500));
    document.querySelector('[data-team-section="standing"]').click(); await new Promise(r => setTimeout(r, 800)); return 1;`);
  const [g3] = await sql(`select count(*) n from public.team_standing_groups where node_id = ${lit(g1.id)}`);
  say('…and the other pin moves it to ถาวร again', g3.n, Number(g3.n) === 1);

  // 5b. a ถาวร group made ELSEWHERE while this tab sits on ประจำปี
  await ev(`document.querySelector('[data-team-section="year"]').click(); return 1;`);
  await sleep(4000); // let the live-sync channel finish joining
  await sql(`with n as (insert into public.team_nodes (name, kind, parent_id, position, is_public)
               values (${lit(REMOTE)}, 'division', null, 999, true) returning id)
             insert into public.team_standing_groups (node_id) select id from n;`);
  const remoteIn = `document.getElementById('teamTree').innerText.includes(${JSON.stringify(REMOTE)})`;
  await sleep(6000);
  const r1 = await ev(`return ${remoteIn};`);
  say('a ถาวร group made in another tab is NOT drawn under ประจำปี', `drawn ${r1}`, r1 === false);
  await ev(`document.querySelector('[data-team-section="standing"]').click(); await new Promise(r => setTimeout(r, 800)); return 1;`);
  const r2 = await ev(`return ${remoteIn};`);
  say('…and appears under ถาวร without a reload', `drawn ${r2}`, r2 === true);

  // 6. phone
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await sleep(1500);
  const sw = JSON.parse(await ev(`window.scrollTo(0,0); return JSON.stringify({ sw: document.documentElement.scrollWidth, w: window.innerWidth });`));
  say('phone, ถาวร open: no sideways scroll', `${sw.sw} ≤ ${sw.w}`, sw.sw <= sw.w);
  await shot('phone.png', false);

  say('console errors', errs.length ? errs.join(' | ') : 'none', errs.length === 0);
} catch (e) {
  say('run', e.message, false);
} finally {
  try {
    const left = await sql(`delete from public.team_nodes where name in (${lit(GROUP)}, ${lit(REMOTE)});
      delete from public.users where username = ${lit(USER)};
      delete from auth.users where email = ${lit(`${USER}@samomdkku.app`)};
      select (select count(*) from auth.users where email = ${lit(`${USER}@samomdkku.app`)}) accounts,
             (select count(*) from public.team_nodes where name = ${lit(GROUP)}) groups,
             (select count(*) from public.team_members where kkumail = ${lit(MAIL)}) members;`);
    console.log(`cleanup: ${JSON.stringify(left)}`);
  } catch (e) { console.log(`cleanup FAILED: ${e.message}`); }
  try { ws?.close(); } catch {}
  chrome.kill();
  await sleep(500);
  try { rmSync(PROFILE, { recursive: true, force: true }); } catch { /* best effort */ }
  console.log(`\n${failed ? `${failed} FAILED` : 'all passed'} · screenshots: ${OUT}`);
  process.exit(failed ? 1 : 0);
}
