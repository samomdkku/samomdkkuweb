#!/usr/bin/env node
// ============================================================
// house-advisor-page.mjs — drive ระบบบ้าน → อาจารย์ for real, SIGNED IN as a
// master, in headless Chrome, against the local dev server on samo-dev. Shape
// copied from house-sai-grid.mjs.
//
// WHAT IT CHECKS (owner, 2026-10-21): an อาจารย์'s page shows their phone as a
// tap-to-call link; สายที่ดูแล | ทั้งบ้าน switches between their own สาย and
// every นักศึกษา in their บ้าน (each สาย head saying whose it is); อาจารย์ร่วมบ้าน
// lists the others in the บ้าน and a tap opens that page; the editor reads,
// changes and clears the phone in the DATABASE; 390px has no sideways scroll.
//
// It CREATES two อาจารย์, a phone and two นักศึกษา on samo-dev — invented
// names and a number that is not anybody's — and deletes them in a finally,
// with the throwaway account. It never touches a real phone: real ones are
// never loaded into samo-dev (memory advisor-phones-sensitive).
//
//   node tools/browser/house-advisor-page.mjs        # needs `npm run dev` on :5174
// ============================================================
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadEnv, resolveTarget, runSql } from '../env-lib.mjs';

const DEV_URL = process.env.DEV_URL || 'http://localhost:5174';
const OUT = process.env.OUT || mkdtempSync(join(tmpdir(), 'house-advisor-'));
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9343;
const USER = `claudetest${Date.now().toString(36)}`;
const PASS = `t-${Math.random().toString(36).slice(2)}-Aa1`;
// บ้าน 7, on สาย codes nothing real uses.
const MINE = '907';
const MATE = '927';
const ME = { first: 'อ. ทดสอบหน้าอาจารย์', last: 'probe' };
const OTHER = { first: 'อ. ทดสอบร่วมบ้าน', last: 'probe' };
const PHONE = '0899990243';

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
  `--user-data-dir=${mkdtempSync(join(tmpdir(), 'house-advisor-chrome-'))}`], { stdio: 'ignore' });
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

  // 0. the subjects — created, never searched for (mistakes.md class 7).
  [planted] = await sql(`
    with s as (insert into public.sais (code) values (${lit(MINE)}), (${lit(MATE)})
                 on conflict (code) do nothing returning code),
    a as (insert into public.advisors (first_name_th, last_name_th, dept)
          values (${lit(ME.first)}, ${lit(ME.last)}, 'probe'), (${lit(OTHER.first)}, ${lit(OTHER.last)}, 'probe')
          returning id, first_name_th),
    l as (insert into public.sai_advisors (sai_code, advisor_id)
          select case when first_name_th = ${lit(ME.first)} then ${lit(MINE)} else ${lit(MATE)} end, id from a
          returning 1),
    p as (insert into public.advisor_phones (advisor_id, phone)
          select id, ${lit(PHONE)} from a where first_name_th = ${lit(ME.first)} returning 1),
    t as (insert into public.students (kkumail, first_name_th, last_name_th, sai_code, cohort_year)
          values ('probe.mine-hadv@kkumail.com', 'ทดสอบในสาย', 'probe', ${lit(MINE)}, 2568),
                 ('probe.mate-hadv@kkumail.com', 'ทดสอบในบ้าน', 'probe', ${lit(MATE)}, 2568)
          returning 1)
    select (select json_agg(code) from s) as sais_created,
           (select id::text from a where first_name_th = ${lit(ME.first)}) as me,
           (select id::text from a where first_name_th = ${lit(OTHER.first)}) as mate,
           (select count(*) from l) + (select count(*) from p) + (select count(*) from t) as rows`);
  say('planted 2 อาจารย์, a phone and 2 นักศึกษา', JSON.stringify(planted), planted?.me && planted?.mate && planted.rows === 5);

  // 1. account + grant (master folds into house)
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

  // 2. ระบบบ้าน → อาจารย์ → the planted อาจารย์
  await send('Page.navigate', { url: `${DEV_URL}/admin/#house` });
  let ready = null;
  for (let i = 0; i < 60 && !ready; i += 1) {
    await sleep(1000);
    ready = await ev(`const b = document.querySelector('[data-house-mode="advisors"]'); return b && !b.closest('.d-none') ? 'ok' : null;`);
  }
  say('ระบบบ้าน opened', ready || 'no', ready === 'ok');
  const opened = await ev(`document.querySelector('[data-house-mode="advisors"]').click(); await new Promise(r=>setTimeout(r,1200));
    const card = document.querySelector('[data-advisor="${planted.me}"]'); if (!card) return 'no card';
    card.click(); await new Promise(r=>setTimeout(r,800));
    return document.querySelector('#hadvHero .hadv-title')?.textContent.trim();`);
  say('the อาจารย์ page opens', opened, opened === `${ME.first} ${ME.last}`);

  // 3. the phone, as a link a phone can dial
  const tel = JSON.parse(await ev(`const a = document.querySelector('#hadvHero a[href^="tel:"]');
    return JSON.stringify({ href: a?.getAttribute('href'), text: a?.textContent.trim() });`));
  say('the phone is a tap-to-call link', JSON.stringify(tel), tel.href === `tel:${PHONE}` && tel.text === '089-999-0243');

  // 4. สายที่ดูแล vs ทั้งบ้าน
  const names = `[...document.querySelectorAll('#hadvGroups .hadv-row .hadv-name')].map(n => n.textContent.trim())`;
  const mine = JSON.parse(await ev(`return JSON.stringify(${names});`));
  say('สายที่ดูแล: only their own สาย', JSON.stringify(mine),
    mine.some((n) => n.startsWith('ทดสอบในสาย')) && !mine.some((n) => n.startsWith('ทดสอบในบ้าน')));
  const house = JSON.parse(await ev(`document.querySelector('[data-hadv-scope="house"]').click(); await new Promise(r=>setTimeout(r,500));
    const heads = Object.fromEntries([...document.querySelectorAll('#hadvGroups .hadv-group')].map(g => [
      g.querySelector('.hadv-group-title')?.textContent.trim(), g.querySelector('.hadv-owner')?.textContent.trim()]));
    return JSON.stringify({ rows: ${names}, heads, checked: document.querySelector('[data-hadv-scope="house"]').getAttribute('aria-checked') });`));
  say('ทั้งบ้าน: the whole บ้าน, theirs included', JSON.stringify(house.rows),
    house.rows.some((n) => n.startsWith('ทดสอบในสาย')) && house.rows.some((n) => n.startsWith('ทดสอบในบ้าน')) && house.checked === 'true');
  say('each สาย head says whose it is', JSON.stringify({ [MINE]: house.heads[`สาย ${MINE}`], [MATE]: house.heads[`สาย ${MATE}`] }),
    house.heads[`สาย ${MINE}`] === 'สายที่ดูแล' && house.heads[`สาย ${MATE}`] === `${OTHER.first} ${OTHER.last}`);
  await shot('advisor-house-desktop.png');

  // 5. phone width, on the busiest view
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await sleep(1200);
  const sw = JSON.parse(await ev(`return JSON.stringify({ sw: document.documentElement.scrollWidth, w: window.innerWidth });`));
  say('phone: no sideways scroll', `${sw.sw} ≤ ${sw.w}`, sw.sw <= sw.w);
  await shot('advisor-house-phone.png');
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false });

  // 6. อาจารย์ร่วมบ้าน → a tap opens that page
  const mate = JSON.parse(await ev(`const m = [...document.querySelectorAll('#hadvMates [data-mate]')];
    const btn = m.find(b => b.dataset.mate === '${planted.mate}');
    const self = m.some(b => b.dataset.mate === '${planted.me}');
    btn?.click(); await new Promise(r=>setTimeout(r,800));
    return JSON.stringify({ listed: !!btn, self, title: document.querySelector('#hadvHero .hadv-title')?.textContent.trim(),
      scope: document.querySelector('[data-hadv-scope="mine"]').getAttribute('aria-checked') });`));
  say('อาจารย์ร่วมบ้าน lists the other, never themself', JSON.stringify({ listed: mate.listed, self: mate.self }), mate.listed && !mate.self);
  say('a tap opens their page, back on สายที่ดูแล', `${mate.title} · mine=${mate.scope}`,
    mate.title === `${OTHER.first} ${OTHER.last}` && mate.scope === 'true');

  // 7. the editor reads, changes and clears the phone — read back from the DATABASE
  // From the mate's page, its อาจารย์ร่วมบ้าน leads back; once there, it is a no-op.
  const edit = async (value) => ev(`document.querySelector('[data-mate="${planted.me}"]')?.click(); await new Promise(r=>setTimeout(r,600));
    document.querySelector('#hadvHero [data-hadv-act="edit"]').click(); await new Promise(r=>setTimeout(r,800));
    const before = document.getElementById('haPhone').value;
    ${value === null ? '' : `document.getElementById('haPhone').value = ${JSON.stringify(value)};`}
    document.getElementById('houseAdvisorForm').requestSubmit(); await new Promise(r=>setTimeout(r,3000));
    return before;`);
  const shown = await edit('043-123456');
  say('the editor shows the stored phone', shown, shown === '089-999-0243');
  const [changed] = await sql(`select phone from public.advisor_phones where advisor_id = ${lit(planted.me)}`);
  say('changing it stores digits only', changed?.phone, changed?.phone === '043123456');
  await edit('');
  const [cleared] = await sql(`select count(*)::int n from public.advisor_phones where advisor_id = ${lit(planted.me)}`);
  say('clearing it deletes the row', cleared.n, cleared.n === 0);
  const telGone = await ev(`return !document.querySelector('#hadvHero a[href^="tel:"]');`);
  say('… and the page stops showing a number', telGone, telGone === true);

  say('console errors', errs.length ? errs.join(' | ') : 'none', errs.length === 0);
} catch (e) {
  say('run', e.message, false);
} finally {
  try {
    const left = await sql(`
      delete from public.students where kkumail like 'probe.%-hadv@kkumail.com';
      delete from public.people where kkumail like 'probe.%-hadv@kkumail.com';
      delete from public.advisors where last_name_th = 'probe' and first_name_th in (${lit(ME.first)}, ${lit(OTHER.first)});
      delete from public.sais s where s.code = any (array[${(planted?.sais_created || []).map(lit).join(',') || "''"}]::text[])
        and not exists (select 1 from public.students t where t.sai_code = s.code);
      delete from public.users where username = ${lit(USER)};
      delete from auth.users where email = ${lit(`${USER}@samomdkku.app`)};
      select (select count(*) from auth.users where email = ${lit(`${USER}@samomdkku.app`)}) accounts,
             (select count(*) from public.advisors where last_name_th = 'probe') advisors,
             (select count(*) from public.students where kkumail like 'probe.%-hadv@kkumail.com') students;`);
    console.log(`cleanup: ${JSON.stringify(left)}`);
  } catch (e) { console.log(`cleanup FAILED: ${e.message}`); }
  try { ws?.close(); } catch {}
  chrome.kill();
  console.log(`\n${failed ? `${failed} FAILED` : 'all passed'} · screenshots: ${OUT}`);
  process.exit(failed ? 1 : 0);
}
