#!/usr/bin/env node
// ============================================================
// me-page.mjs — drive /me "ข้อมูลของฉัน" SIGNED IN, in headless Chrome,
// against the local dev server on samo-dev, desktop and phone.
//
// WHAT IT DOES, all on samo-dev (it REFUSES any other project):
//   1. registers a throwaway username account through the app's own
//      registerWithPassword;
//   2. asserts every way in reaches /me — the home account row, the avatar
//      menu, the phone top bar's avatar, the drawer's user strip, a Discord
//      link return (/#discord=…) — and that signed out, /me asks to sign in;
//   3. paints the cards with a SYNTHETIC ทีม SAMO + ระบบบ้าน record (through
//      the real renderers — no real student's data) to screenshot the full
//      page, and checks the home row's "needs you" flag both ways;
//   4. ALWAYS deletes the account (auth + users) in a finally.
//
// RUN (needs `npm run dev` on :5174 and Chrome):
//   node tools/browser/me-page.mjs
//   OUT=/tmp/x node tools/browser/me-page.mjs
// Credentials: SUPABASE_DEV_URL + SUPABASE_DEV_ACCESS_TOKEN from .env.local.
// ============================================================
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadEnv, resolveTarget, runSql } from '../env-lib.mjs';

const DEV_URL = process.env.DEV_URL || 'http://localhost:5174';
const OUT = process.env.OUT || mkdtempSync(join(tmpdir(), 'me-page-'));
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9344;
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
const sql = async (q) => JSON.parse(await runSql(q, devTarget));
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;
mkdirSync(OUT, { recursive: true });

// A made-up person, painted through the real renderers. Shapes follow
// my-seat.js (postings) and house/my-house.js (student record).
const FAKE_SEAT = {
  name: 'ทดสอบ ระบบดี', nickname: 'เทส', permissions: ['pr', 'creator'],
  postings: [{ member_id: 'x', node_id: 'n', node: 'หัวหน้าฝ่าย', path: ['ฝ่ายดิจิทัล'],
    full_name: 'ทดสอบ ระบบดี', first_name: 'ทดสอบ', last_name: 'ระบบดี', nickname: 'เทส',
    student_id: '663070000-0', major: 'แพทยศาสตร์', kkumail: 'test@kkumail.com', photo_url: '' }],
};
const FAKE_HOUSE = {
  full_name: 'ทดสอบ ระบบดี', nickname: 'เทส', student_id: '663070000-0', kkumail: 'test@kkumail.com',
  house_id: 3, house_name: 'บ้านทดสอบ', house_color: '#2e7d32', sai: 143, cohort: 'MD53', requests: [], advisors: [],
};

const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${mkdtempSync(join(tmpdir(), 'me-page-chrome-'))}`], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws; let id = 0; const pend = {}; const errs = []; let failed = 0;
const say = (label, v, ok = true) => { if (!ok) failed += 1; console.log(`${ok ? '✓' : '✗'} ${label}: ${v}`); };
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pend[i] = res; ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (e) => (await send('Runtime.evaluate', { expression: `(async()=>{try{${e}}catch(err){return 'ERR '+err.message}})()`, awaitPromise: true, returnByValue: true })).result?.value;
const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: !name.startsWith('phone') }); writeFileSync(join(OUT, name), Buffer.from(r.data, 'base64')); };
// The TOP-LEVEL pane only: tabs nest (the PR tab has its own .tab-pane.active
// inside it), and the first match in document order is not the page.
const where = () => ev(`return location.pathname + ' ' + ([...document.querySelectorAll('.tab-pane.active')].find(p=>p.id.startsWith('pills-'))?.id || '-')`);
const signIn = () => ev(`const a = await import('/src/js/auth.js'); await a.signOut().catch(()=>{}); await a.signInWithPassword(${JSON.stringify(USER)}, ${JSON.stringify(PASS)}); await new Promise(r=>setTimeout(r,2500)); return a.getUser()?.id || 'no user';`);

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
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1000, deviceScaleFactor: 2, mobile: false });

  // ── signed out ────────────────────────────────────────────────────────────
  await send('Page.navigate', { url: `${DEV_URL}/me` }); await sleep(4500);
  const out = await ev(`return { pane: document.getElementById('pills-me').classList.contains('active') ? 'pills-me' : 'other',
    prompt: !document.getElementById('meSignedOut').hidden, body: document.getElementById('meSignedIn').hidden,
    row: !document.getElementById('homeAuthSignedIn').classList.contains('d-none') }`);
  say('signed out, /me asks to sign in', JSON.stringify(out), out.pane === 'pills-me' && out.prompt && out.body && !out.row);
  await shot('desktop-signed-out.png');

  // ── account ───────────────────────────────────────────────────────────────
  const uid = await ev(`const a = await import('/src/js/auth.js'); await a.registerWithPassword(${JSON.stringify(USER)}, ${JSON.stringify(PASS)}); await new Promise(r=>setTimeout(r,1500)); return a.getUser()?.id || 'no user';`);
  if (!/^[0-9a-f-]{36}$/.test(uid)) throw new Error(`register failed: ${uid}`);
  say('throwaway account', `${USER} on samo-dev`);

  await send('Page.navigate', { url: `${DEV_URL}/` }); await sleep(3000);
  await signIn();
  await sleep(1500);
  const home = await ev(`const r = document.getElementById('homeAuthSignedIn');
    return { shown: !r.classList.contains('d-none'), name: document.getElementById('homeUserName').textContent,
      sub: document.getElementById('homeUserDept').textContent, flag: !document.getElementById('homeMeAlert').hidden,
      oldCards: !!document.querySelector('#pills-home #homeMySeat, #pills-home #homeMyHouse, #pills-home .myseat-card') }`);
  say('home: account row, no personal cards on home', JSON.stringify(home), home.shown && home.name === USER && !home.oldCards);
  await ev(`window.scrollTo(0,0); return 1`);
  await shot('desktop-home-signed-in.png');

  // way in 1 — the home row
  await ev(`document.getElementById('homeAuthSignedIn').click(); return 1`); await sleep(900);
  let w = await where();
  say('home row → /me', w, w === '/me pills-me');
  const me = await ev(`return { body: !document.getElementById('meSignedIn').hidden, prompt: !document.getElementById('meSignedOut').hidden,
    who: document.getElementById('meAccountWho').textContent.trim(), house: !document.getElementById('meMyHouse').hidden,
    houseText: document.getElementById('meMyHouse').textContent.replace(/\\s+/g,' ').trim().slice(0, 80) }`);
  say('/me signed in: body, account line, ระบบบ้าน claim card', JSON.stringify(me), me.body && !me.prompt && me.who.includes(USER) && me.house);
  await shot('desktop-me-real.png');

  // Opening /me DIRECTLY while signed in must never flash the sign-in prompt
  // (the first auth callback fires before the session is restored). Watched
  // from the first byte with a MutationObserver, not sampled.
  const { identifier } = await send('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.__promptFlashed = false;
    new MutationObserver(() => { const el = document.getElementById('meSignedOut');
      if (el && !el.hidden && getComputedStyle(el).display !== 'none') window.__promptFlashed = true; })
      .observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['hidden'] });` });
  await send('Page.navigate', { url: `${DEV_URL}/me` }); await sleep(4000);
  const flash = await ev(`return { flashed: window.__promptFlashed, body: !document.getElementById('meSignedIn').hidden }`);
  say('signed in, /me opened directly: no sign-in prompt flash', JSON.stringify(flash), flash.flashed === false && flash.body);
  await send('Page.removeScriptToEvaluateOnNewDocument', { identifier });

  // way in 2 — the avatar menu
  await ev(`activateTab('pills-home-tab'); return 1`); await sleep(500);
  await ev(`document.querySelector('#navAuthSignedIn .dropdown-toggle').click(); await new Promise(r=>setTimeout(r,300));
    [...document.querySelectorAll('#navAuthSignedIn .dropdown-item')].find(b=>b.textContent.includes('ข้อมูลของฉัน')).click(); return 1`);
  await sleep(800);
  w = await where();
  say('avatar menu "ข้อมูลของฉัน" → /me', w, w === '/me pills-me');

  // the full page, through the real renderers with a synthetic person
  await ev(`const s = await import('/src/js/my-seat.js'); const h = await import('/src/js/house/my-house.js');
    const seatEl = document.getElementById('meMySeat'); s.renderMySeat(seatEl, ${JSON.stringify(FAKE_SEAT)});
    const slot = seatEl.querySelector('[data-profile-slot="house"]'); h.renderMyHouse(slot, ${JSON.stringify(FAKE_HOUSE)}, { mode: 'section' });
    const hh = document.getElementById('meMyHouse'); hh.hidden = true; hh.innerHTML = ''; return 1`);
  await sleep(400);
  await ev(`window.scrollTo(0,0); return 1`);
  await shot('desktop-me-full.png');

  // the home row's summary + flag, both ways, from the real functions
  const sum = await ev(`const m = await import('/src/js/me-page.js');
    const ok = { conflicts: [], confirmed_at: '2026-01-01' };
    const a = m.summarizeMe({ seat: ${JSON.stringify(FAKE_SEAT)}, house: ${JSON.stringify(FAKE_HOUSE)}, identity: ok });
    const settled = m.summarizeMe({ seat: null, house: ${JSON.stringify(FAKE_HOUSE)}, identity: ok });
    const b = m.summarizeMe({ seat: null, house: ${JSON.stringify(FAKE_HOUSE)}, identity: { conflicts: [], confirmed_at: null } });
    m.paintHomeMe({ name: 'ทดสอบ ระบบดี' }, b); return { a, settled, b }`);
  say('summary: ตำแหน่ง + บ้าน; flag for the seat card\'s own gap (no photo)', JSON.stringify(sum.a), sum.a.line.includes('หัวหน้าฝ่าย') && sum.a.line.includes('บ้านทดสอบ') && sum.a.needsYou);
  say('summary: settled record → no flag', JSON.stringify(sum.settled), sum.settled.line === 'บ้านทดสอบ' && !sum.settled.needsYou);
  say('summary: flag raised for an unconfirmed record', JSON.stringify(sum.b), sum.b.needsYou === true);
  await ev(`activateTab('pills-home-tab'); window.scrollTo(0,0); return 1`); await sleep(500);
  await shot('desktop-home-flag.png');

  // Discord return lands on /me. From about:blank: the real return is a full
  // load from discord.com, and / → /#discord=… would be a same-page hash change.
  await send('Page.navigate', { url: 'about:blank' }); await sleep(300);
  await send('Page.navigate', { url: `${DEV_URL}/#discord=cancelled` }); await sleep(4500);
  w = await where();
  const consumed = await ev(`return !/discord=/.test(location.hash)`);
  say('Discord link return /#discord=… → /me, outcome read', `${w} consumed=${consumed}`, w === '/me pills-me' && consumed);

  // ── phone ─────────────────────────────────────────────────────────────────
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send('Page.navigate', { url: `${DEV_URL}/` }); await sleep(4500);
  const bar = await ev(`const b = document.getElementById('navAuthSignedInMobile'); const r = b.getBoundingClientRect();
    return { visible: getComputedStyle(b).display !== 'none' && r.width > 0, w: Math.round(r.width), label: b.getAttribute('aria-label'),
      initial: document.getElementById('navUserInitialMobile').textContent, overflowX: document.documentElement.scrollWidth > innerWidth }`);
  say('phone top bar: avatar (not Logout)', JSON.stringify(bar), bar.visible && bar.label === 'ข้อมูลของฉัน' && !bar.overflowX);
  await shot('phone-home.png');
  await ev(`document.getElementById('navAuthSignedInMobile').click(); return 1`); await sleep(900);
  w = await where();
  say('phone avatar → /me', w, w === '/me pills-me');
  await shot('phone-me.png');
  await ev(`activateTab('pills-home-tab'); return 1`); await sleep(500);
  await ev(`document.querySelector('[data-bs-target="#mobileMenu"]').click(); await new Promise(r=>setTimeout(r,700));
    document.getElementById('mobileAuthSignedIn').click(); return 1`);
  await sleep(1200);
  w = await where();
  const drawer = await ev(`return document.getElementById('mobileMenu').classList.contains('show')`);
  say('drawer user strip → /me, drawer closed', `${w} drawerOpen=${drawer}`, w === '/me pills-me' && !drawer);

  // sign out from /me
  await ev(`window.scrollTo(0, document.body.scrollHeight); return 1`); await sleep(300);
  await shot('phone-me-bottom.png');
  await ev(`[...document.querySelectorAll('#pills-me .me-row')].find(b=>b.textContent.includes('ออกจากระบบ')).click(); return 1`);
  await sleep(2000);
  const after = await ev(`return { prompt: !document.getElementById('meSignedOut').hidden, body: document.getElementById('meSignedIn').hidden,
    seatEmpty: !document.getElementById('meMySeat').innerHTML.trim(), houseEmpty: !document.getElementById('meMyHouse').innerHTML.trim() }`);
  say('ออกจากระบบ on /me → sign-in prompt, nothing of the old account left', JSON.stringify(after), after.prompt && after.body && after.seatEmpty && after.houseEmpty);

  say('console errors', errs.length ? errs.join(' | ') : 'none', errs.length === 0);
} catch (e) {
  failed += 1;
  console.log(`✗ driver error: ${e.stack || e}`);
} finally {
  try {
    const [left] = await sql(`delete from public.users where username = ${lit(USER)};
      delete from auth.users where email = ${lit(`${USER}@samomdkku.app`)};
      select (select count(*) from auth.users where email = ${lit(`${USER}@samomdkku.app`)}) accounts;`);
    say('cleanup: accounts left', left?.accounts ?? '?', String(left?.accounts) === '0');
  } catch (e) { failed += 1; console.log(`✗ cleanup FAILED — remove ${USER} by hand: ${e.message}`); }
  try { ws?.close(); } catch { /* */ }
  chrome.kill();
  console.log(`\nscreenshots: ${OUT}`);
  process.exit(failed ? 1 : 0);
}
