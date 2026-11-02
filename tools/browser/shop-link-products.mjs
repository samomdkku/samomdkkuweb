// ============================================================
// shop-link-products.mjs — the storefront's แหล่งที่มา groups and the
// Students-initiative link products (0274), in a real browser against samo-dev.
//
// What it proves, in order:
//   1. the chips read ทั้งหมด · SAMO official · Students initiative, with no
//      สมาคมสิทธิ์เก่า; the ประเภท chips (admin-managed) are still there;
//   2. SAMO official opens MD · MDI · RT and hides the link product; MD narrows;
//   3. Students initiative shows ONLY the link product, its card saying
//      "สั่งผ่านลิงก์" and "ดูราคาที่ลิงก์" (price 0);
//   4. its window: the seller's link (new tab, noopener), the admin's button
//      text, pictures area — and NO cart, quantity or price row;
//   5. an ordinary product opened NEXT gets its cart back, link gone (both ways);
//   6. it is in Latest Drops (NEW ticked); 390px: no sideways scroll; no errors.
//   ALWAYS deletes the planted product. Nothing is ordered.
//
// RUN (needs `npm run dev` on :5174 — it uses samo-dev — and Chrome):
//   node tools/browser/shop-link-products.mjs
// ============================================================
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadEnv, resolveTarget, runSql } from '../env-lib.mjs';

const DEV_URL = process.env.DEV_URL || 'http://localhost:5174';
const OUT = process.env.OUT || mkdtempSync(join(tmpdir(), 'shop-link-'));
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9351;
const PID = `probe-link-${Date.now().toString(36)}`;
const URL_ = 'https://forms.gle/probeStudentsInitiative';

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
mkdirSync(OUT, { recursive: true });

const PROFILE = mkdtempSync(join(tmpdir(), 'shop-link-chrome-'));
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${PROFILE}`], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws; let id = 0; const pend = {}; const errs = []; let failed = 0;
const say = (label, v, ok = true) => { if (!ok) failed += 1; console.log(`${ok ? '✓' : '✗'} ${label}: ${v}`); };

try {
  await sql(`insert into public.shop_products (id, name, sub, description, type, source, price, sizes, is_active, stock_status, is_new, external_url, external_label)
             values ('${PID}', 'ทดสอบ Students initiative', 'โครงการนักศึกษา', 'รายละเอียดจากผู้ขาย', 'apparel-shirt', 'student', 0, array['F'], true, 'available', true,
                     '${URL_}', 'สั่งผ่านฟอร์ม')`);

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
  // With a selector: just that element (plus a margin), wherever it is on the page.
  const shot = async (name, sel) => {
    let clip;
    if (sel) {
      const r = JSON.parse(await ev(`const r = document.querySelector('${sel}').getBoundingClientRect();
        return JSON.stringify({ x: Math.max(0, r.left + scrollX - 16), y: Math.max(0, r.top + scrollY - 16), width: r.width + 32, height: r.height + 32 });`));
      clip = { ...r, scale: 1 };
    }
    const { result } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: !!clip, ...(clip ? { clip } : {}) });
    writeFileSync(join(OUT, name), Buffer.from(result.data, 'base64'));
  };
  const waitFor = async (expr, secs = 40) => {
    for (let i = 0; i < secs; i += 1) { if (await ev(`return !!(${expr});`) === true) return true; await sleep(1000); }
    return false;
  };
  await send('Runtime.enable'); await send('Page.enable');
  // Nothing in this run may place an order or touch a cart server-side.
  await send('Network.enable');
  await send('Network.setBlockedURLs', { urls: ['*/rpc/place_shop_order*', '*/shop_orders*', '*/shop_order_items*'] });
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false });

  await send('Page.navigate', { url: `${DEV_URL}/` }); await sleep(5000);
  await ev(`window.navigateTo('/shop'); return 1;`);
  const loaded = await waitFor(`document.querySelector('#shopProductGrid [data-product-id="${PID}"]')`, 40);
  say('the planted link product is in the grid', loaded, loaded);

  // 1. the chips
  const chips = JSON.parse(await ev(`return JSON.stringify({
      src: [...document.querySelectorAll('#shopSourceChips .sf-source-top [data-source-id]')].map(b => b.textContent.trim()),
      types: document.querySelectorAll('#shopTypeChips [data-type-id]').length });`));
  say('แหล่งที่มา reads ทั้งหมด · SAMO official · Students initiative', chips.src.join(' · '),
    chips.src.join('|') === 'ทั้งหมด|SAMO official|Students initiative');
  say('…no สมาคมสิทธิ์เก่า', String(chips.src.some((t) => t.includes('สมาคม'))), !chips.src.some((t) => t.includes('สมาคม')));
  say('the ประเภท chips (admin-managed) are still there', chips.types, chips.types > 1);

  // A tray pill and a group pill can share an id (the tray's ทั้งหมด is the
  // group) — click the one on screen: the open tray's first, else the strip's.
  const pick = (sid) => ev(`const b = document.querySelector('#shopSourceChips .sf-source-sub.is-open [data-source-id="${sid}"]')
      || document.querySelector('#shopSourceChips .sf-source-top [data-source-id="${sid}"]');
    b.click(); await new Promise(r=>setTimeout(r,500));
    return JSON.stringify({ sub: [...document.querySelectorAll('#shopSourceChips .sf-source-sub.is-open .is-sub')].map(b => b.textContent.trim()),
      ids: [...document.querySelectorAll('#shopProductGrid [data-product-id]')].map(c => c.dataset.productId),
      srcs: [...document.querySelectorAll('#shopProductGrid .product-source')].map(s => s.dataset.src) });`).then(JSON.parse);

  // 2. SAMO official
  const off = await pick('official');
  say('SAMO official opens MD · MDI · RT', off.sub.join(' · '), off.sub.join('|') === 'ทั้งหมด|MD|MDI|RT');
  say('…and hides the link product', `${off.ids.length} products`, !off.ids.includes(PID) && off.ids.length > 0);
  // WHERE it opens (owner, 2026-11-02: it had jumped to after Students initiative).
  const geo = () => ev(`const r = (q) => document.querySelector(q).getBoundingClientRect();
    const o = r('#shopSourceChips .sf-source-top [data-source-id="official"]'), s = r('#shopSourceChips .sf-source-top [data-source-id="student"]'),
          t = r('#shopSourceChips .sf-source-sub.is-open .sf-source-sub-inner'), strip = r('#shopSourceChips .sf-source-top');
    return JSON.stringify({ o: [o.top, o.bottom, o.left], s: [s.top, s.bottom], t: [t.top, t.bottom, t.left], strip: [strip.top, strip.bottom] });`).then(JSON.parse);
  const g1 = await geo();
  say('desktop: the tray opens UNDER SAMO official and ABOVE Students initiative, indented',
    JSON.stringify(g1), g1.o[1] <= g1.t[0] + 1 && g1.t[1] <= g1.s[0] + 1 && g1.t[2] > g1.o[2]);
  await shot('official.png', '.sf-source-row');
  const mdOnly = await pick('md');
  say('MD narrows to MD products', [...new Set(mdOnly.srcs)].join(','), mdOnly.srcs.every((s) => s === 'md') && mdOnly.sub.length === 4);

  // 3. Students initiative
  const stu = await pick('student');
  say('Students initiative shows ONLY the link product', stu.ids.join(','), stu.ids.length === 1 && stu.ids[0] === PID);
  say('…and has no sub row', stu.sub.length, stu.sub.length === 0);
  const closed = await ev(`await new Promise(r=>setTimeout(r,500)); const t = document.querySelector('#shopSourceChips [data-tray="official"]');
    return JSON.stringify({ inert: t.hasAttribute('inert'), h: Math.round(t.getBoundingClientRect().height), exp: document.querySelector('#shopSourceChips [aria-expanded]').getAttribute('aria-expanded') });`).then(JSON.parse);
  say('…the closed tray takes no room, no tab stops, and says collapsed', JSON.stringify(closed), closed.inert && closed.h === 0 && closed.exp === 'false');
  const card = JSON.parse(await ev(`const c = document.querySelector('#shopProductGrid [data-product-id="${PID}"]');
    return JSON.stringify({ hint: c.querySelector('.product-stock-hint')?.textContent.trim(), price: c.querySelector('.product-price')?.textContent.trim(),
      label: c.querySelector('.product-source')?.textContent.trim() });`));
  say('the card says Students initiative, สั่งผ่านลิงก์ and ดูราคาที่ลิงก์', `${card.label} | ${card.hint} | ${card.price}`,
    card.label === 'Students initiative' && card.hint === 'สั่งผ่านลิงก์' && card.price === 'ดูราคาที่ลิงก์');
  await shot('students.png', '.sf-source-row');

  // 4. its window
  const modalState = () => ev(`await new Promise(r=>setTimeout(r,700));
    const v = (id) => { const el = document.getElementById(id); return !!el && !el.classList.contains('d-none') && el.offsetParent !== null; };
    const a = document.getElementById('shopProductModalExternal');
    return JSON.stringify({ title: document.getElementById('shopProductModalTitle')?.textContent.trim(),
      add: v('shopProductModalAdd'), qty: v('shopProductModalQtyGroup'), link: v('shopProductModalExternal'),
      price: v('shopProductModalPriceRow'), note: v('shopProductModalLinkNote'), hero: !!document.querySelector('#shopProductModalHero *'),
      href: a?.getAttribute('href'), target: a?.getAttribute('target'), rel: a?.getAttribute('rel'),
      label: document.getElementById('shopProductModalExternalLabel')?.textContent.trim() });`).then(JSON.parse);
  await ev(`document.querySelector('#shopProductGrid [data-product-id="${PID}"]').click(); return 1;`);
  const m1 = await modalState();
  say('link product: the seller\'s link, in a new tab, noopener', `${m1.href} ${m1.target} ${m1.rel}`,
    m1.link && m1.href === URL_ && m1.target === '_blank' && /noopener/.test(m1.rel || ''));
  say('…the admin\'s button text and the explanation', `${m1.label} | note ${m1.note}`, m1.label === 'สั่งผ่านฟอร์ม' && m1.note);
  say('…pictures, and NO cart, quantity or ฿0 price', `hero ${m1.hero} add ${m1.add} qty ${m1.qty} price ${m1.price}`,
    m1.hero && !m1.add && !m1.qty && !m1.price);
  await shot('link-modal.png');
  await ev(`window.bootstrap.Modal.getInstance(document.getElementById('shopProductModal'))?.hide(); await new Promise(r=>setTimeout(r,600)); return 1;`);

  // 5. an ordinary product NEXT
  await pick('all');
  const other = await ev(`return [...document.querySelectorAll('#shopProductGrid [data-product-id]')].map(c => c.dataset.productId).find(x => x !== '${PID}') || '';`);
  await ev(`document.querySelector('#shopProductGrid [data-product-id="${other}"]').click(); return 1;`);
  const m2 = await modalState();
  say('an ordinary product opened next gets its cart back, link gone', `add ${m2.add} qty ${m2.qty} price ${m2.price} link ${m2.link} note ${m2.note}`,
    m2.add && m2.qty && m2.price && !m2.link && !m2.note);
  await ev(`window.bootstrap.Modal.getInstance(document.getElementById('shopProductModal'))?.hide(); await new Promise(r=>setTimeout(r,600)); return 1;`);

  // 6. Latest Drops, phone, errors
  const drop = await ev(`const c = document.querySelector('#shopLaunchCarousel [data-product-id="${PID}"]'); return c ? c.querySelector('.sf-drop-price')?.textContent.trim() : 'absent';`);
  say('it is in Latest Drops (NEW ticked), price ดูราคาที่ลิงก์', drop, drop === 'ดูราคาที่ลิงก์');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await sleep(800);
  await pick('official');
  const g2 = await geo();
  say('phone: the groups stay on one strip and the tray opens as its own row below it',
    JSON.stringify(g2), Math.abs(g2.o[0] - g2.s[0]) < 2 && g2.t[0] >= g2.strip[1] - 1);
  const fit = await ev(`const t = document.querySelector('#shopSourceChips .sf-source-top'); return t.scrollWidth - t.clientWidth;`);
  say('phone: all three groups fit on the strip, none cut off', `${fit}px over`, fit <= 0);
  const wide = await ev(`return document.documentElement.scrollWidth - window.innerWidth;`);
  say('390px with SAMO official open: no sideways scroll', `${wide}px over`, wide <= 0);
  await shot('phone-official.png', '.sf-source-row');
  say('console errors', errs.length ? errs.join(' | ') : 'none', errs.length === 0);
} catch (e) {
  failed += 1;
  console.log(`✗ the run stopped: ${e.message}`);
} finally {
  try {
    const gone = await sql(`delete from public.shop_products where id = '${PID}' returning id`);
    console.error(`cleanup: deleted ${gone.length} planted product`);
  } catch (e) { console.error(`cleanup FAILED — delete shop_products id ${PID} by hand: ${e.message}`); failed += 1; }
  try { ws?.close(); } catch { /* closing */ }
  chrome.kill();
  await sleep(500);
  try { rmSync(PROFILE, { recursive: true, force: true }); } catch { /* best effort */ }
}
console.log(failed ? `${failed} FAILED · screenshots: ${OUT}` : `all passed · screenshots: ${OUT}`);
process.exit(failed ? 1 : 0);
