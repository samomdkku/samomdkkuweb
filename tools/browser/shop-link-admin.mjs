// ============================================================
// shop-link-admin.mjs — a shop admin adds a Students-initiative product
// (0274) through the REAL product form, signed in, against samo-dev, and the
// row that lands in the database is read back.
//
//   1. registers a throwaway username account and grants it `samoshop`;
//   2. /admin/#shop → สินค้า → เพิ่มสินค้า; picking Students initiative shows
//      the link fields and hides stock / sizes / PromptPay / pickup / preorder;
//      picking MD brings them back (both ways); สมาคมสิทธิ์เก่า is not offered;
//   3. an http:// link is refused by the form before any write;
//   4. a https link + button text saves; the DB row is source 'student' with
//      that link and label, not a preorder;
//   5. it is absent from the สต็อก tab;
//   6. ALWAYS deletes the product and the account in a finally.
//
// RUN (needs `npm run dev` on :5174 — samo-dev — and Chrome):
//   node tools/browser/shop-link-admin.mjs
// ============================================================
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadEnv, resolveTarget, runSql } from '../env-lib.mjs';

const DEV_URL = process.env.DEV_URL || 'http://localhost:5174';
const OUT = process.env.OUT || mkdtempSync(join(tmpdir(), 'shop-link-admin-'));
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9352;
const USER = `claudelink${Date.now().toString(36)}`;
const PASS = `t-${Math.random().toString(36).slice(2)}-Aa1`;
const PID = `probe-linkadm-${Date.now().toString(36)}`;
const URL_ = 'https://forms.gle/probeAdminLink';

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
console.error(`→ database: ${devTarget.ref} (${devTarget.label}) · app: ${DEV_URL} · out: ${OUT}`);

const PROFILE = mkdtempSync(join(tmpdir(), 'shop-link-admin-chrome-'));
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
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false });

  await send('Page.navigate', { url: `${DEV_URL}/` }); await sleep(6000);
  const uid = await ev(`const a = await import('/src/js/auth.js'); await a.registerWithPassword(${JSON.stringify(USER)}, ${JSON.stringify(PASS)});
    await a.signOut().catch(()=>{}); await a.signInWithPassword(${JSON.stringify(USER)}, ${JSON.stringify(PASS)}); await new Promise(r=>setTimeout(r,1500)); return a.getUser()?.id || 'no user';`);
  if (!/^[0-9a-f-]{36}$/.test(uid)) throw new Error(`register failed: ${uid}`);
  // users_self_update_guard refuses a permissions change from the Management
  // API superuser (auth.uid() is null). Same escape hatch as dev-grants.mjs —
  // acceptable only because this tool refuses any project but samo-dev above.
  await sql(`set session_replication_role = 'replica';
    update public.users set permissions = array['samoshop'] where id = ${lit(uid)};`);
  await send('Page.navigate', { url: `${DEV_URL}/` }); await sleep(4000);
  await ev(`const a = await import('/src/js/auth.js'); await a.signOut().catch(()=>{}); await a.signInWithPassword(${JSON.stringify(USER)}, ${JSON.stringify(PASS)}); await new Promise(r=>setTimeout(r,2000)); return 1;`);
  await send('Page.navigate', { url: `${DEV_URL}/admin/#shop` }); await sleep(9000);

  await ev(`document.querySelector('[data-shop-admin-tab="products"]').click(); await new Promise(r=>setTimeout(r,2000));
    document.getElementById('shopAdminProductsNew').click(); await new Promise(r=>setTimeout(r,800)); return 1;`);
  const formState = () => ev(`const vis = (el) => el && el.offsetParent !== null;
    return JSON.stringify({ link: [...document.querySelectorAll('[data-link-only]')].every(vis),
      shop: [...document.querySelectorAll('[data-shop-only]')].filter(vis).length,
      shopTotal: document.querySelectorAll('[data-shop-only]').length,
      options: [...document.querySelectorAll('#shopProdSource option')].map(o => o.value) });`).then(JSON.parse);
  const setSource = (v) => ev(`const s = document.getElementById('shopProdSource'); s.value = '${v}'; s.dispatchEvent(new Event('change', { bubbles: true })); await new Promise(r=>setTimeout(r,300)); return 1;`);

  const f0 = await formState();
  say('the source picker offers Students initiative, not สมาคมสิทธิ์เก่า', f0.options.join(','), f0.options.includes('student') && !f0.options.includes('sittikao'));
  await setSource('student');
  const f1 = await formState();
  say('Students initiative: link fields shown, shop-only sections hidden', `link ${f1.link}, shop-only visible ${f1.shop}/${f1.shopTotal}`, f1.link && f1.shop === 0 && f1.shopTotal >= 8);
  const { result: shotA } = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(OUT, 'admin-form-student.png'), Buffer.from(shotA.data, 'base64'));
  await setSource('md');
  const f2 = await formState();
  say('…and MD brings them back', `link ${f2.link}, shop-only visible ${f2.shop}/${f2.shopTotal}`, !f2.link && f2.shop === f2.shopTotal);
  await setSource('student');

  const fill = (url) => ev(`const set = (id, v) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
    set('shopProdId', '${PID}'); set('shopProdName', 'ทดสอบลิงก์จากหน้าแอดมิน'); set('shopProdDesc', 'รายละเอียด');
    set('shopProdExternalUrl', '${url}'); set('shopProdExternalLabel', 'ไปที่ฟอร์ม');
    document.getElementById('shopProdIsActive').checked = true; return 1;`);
  await fill('http://example.org/form');
  await ev(`document.getElementById('shopProdSave').click(); await new Promise(r=>setTimeout(r,2500)); return 1;`);
  const [n0] = await sql(`select count(*)::int n from public.shop_products where id = ${lit(PID)}`);
  say('an http:// link is refused before any write', `${n0.n} rows`, n0.n === 0);

  await fill(URL_);
  await ev(`document.getElementById('shopProdSave').click(); await new Promise(r=>setTimeout(r,4000)); return 1;`);
  const [row] = await sql(`select source, external_url, external_label, is_presale, is_active from public.shop_products where id = ${lit(PID)}`);
  say('saved: source student, the link and the button text, not a preorder', JSON.stringify(row || null),
    row?.source === 'student' && row.external_url === URL_ && row.external_label === 'ไปที่ฟอร์ม' && row.is_presale === false);

  const inStock = await ev(`document.querySelector('[data-shop-admin-tab="stock"]').click(); await new Promise(r=>setTimeout(r,2500));
    const h = document.getElementById('shopAdminStockHost')?.innerHTML || '';
    return JSON.stringify({ link: h.includes('${PID}'), control: h.includes('data-stock-save="p-dev-302"') });`).then(JSON.parse);
  // CONTROL: an ordinary samo-dev product IS there — an empty tab cannot pass.
  say('it is not in the สต็อก tab (control: an ordinary product is)', JSON.stringify(inStock), inStock.link === false && inStock.control === true);
  say('console errors', errs.length ? errs.join(' | ') : 'none', errs.length === 0);
} catch (e) {
  failed += 1;
  console.log(`✗ the run stopped: ${e.message}`);
} finally {
  try {
    const [left] = await sql(`delete from public.shop_products where id = ${lit(PID)};
      delete from public.users where username = ${lit(USER)};
      delete from auth.users where email = ${lit(`${USER}@samomdkku.app`)};
      select (select count(*) from auth.users where email = ${lit(`${USER}@samomdkku.app`)}) accounts,
             (select count(*) from public.shop_products where id = ${lit(PID)}) products;`);
    const ok = Number(left.accounts) === 0 && Number(left.products) === 0;
    if (!ok) failed += 1;
    console.log(`${ok ? '✓' : '✗'} cleanup: ${JSON.stringify(left)}`);
  } catch (e) { failed += 1; console.log(`✗ cleanup FAILED — remove ${USER} and ${PID} by hand: ${e.message}`); }
  try { ws?.close(); } catch { /* closing */ }
  chrome.kill();
  await sleep(500);
  try { rmSync(PROFILE, { recursive: true, force: true }); } catch { /* best effort */ }
}
console.log(failed ? `${failed} FAILED · screenshots: ${OUT}` : `all passed · screenshots: ${OUT}`);
process.exit(failed ? 1 : 0);
