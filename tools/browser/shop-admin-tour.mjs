#!/usr/bin/env node
// ============================================================
// shop-admin-tour.mjs — screenshot the SAMO Shop admin tabs SIGNED IN, at a
// desktop and a phone width, in headless Chrome against the local dev server
// on samo-dev. Read-only on the shop: it clicks tabs and looks.
//
// WHY. The shop admin needs a signed-in `samoshop` account, so a layout change
// there is otherwise "not driven" (HANDOFF §18b). Built 2026-10-15 with the
// ยอดขาย tab; the pattern is shop-admin-strip.mjs's.
//
//   1. registers a throwaway username account and grants it `samoshop`;
//   2. opens /admin/#shop and, for each tab in TABS (default: every tab),
//      screenshots it at 1280 and 390 px to $OUT/<tab>-<width>.png;
//      the sales tab is also captured with its first product row expanded;
//   3. prints console errors and any horizontal page overflow per shot;
//   4. ALWAYS deletes the account (auth + users) in a finally.
//
// RUN (needs `npm run dev` on :5174 — samo-dev — and Chrome):
//   node tools/browser/shop-admin-tour.mjs
//   TABS=sales,orders OUT=/tmp/x node tools/browser/shop-admin-tour.mjs
// Credentials: SUPABASE_DEV_URL + SUPABASE_DEV_ACCESS_TOKEN from .env.local.
// ============================================================
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadEnv, resolveTarget, runSql } from '../env-lib.mjs';

const DEV_URL = process.env.DEV_URL || 'http://localhost:5174';
const OUT = process.env.OUT || mkdtempSync(join(tmpdir(), 'shop-tour-'));
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9341;
const USER = `claudetour${Date.now().toString(36)}`;
const PASS = `t-${Math.random().toString(36).slice(2)}-Aa1`;
const WIDTHS = [1280, 390];

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

const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${mkdtempSync(join(tmpdir(), 'shop-tour-chrome-'))}`], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws; let id = 0; const pend = {}; const errs = []; let failed = 0;

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
  const size = (w) => send('Emulation.setDeviceMetricsOverride', { width: w, height: w < 600 ? 844 : 900, deviceScaleFactor: w < 600 ? 2 : 1, mobile: w < 600 });
  await send('Runtime.enable'); await send('Page.enable');
  await size(1280);

  await send('Page.navigate', { url: `${DEV_URL}/` }); await sleep(6000);
  const uid = await ev(`const a = await import('/src/js/auth.js'); await a.registerWithPassword(${JSON.stringify(USER)}, ${JSON.stringify(PASS)});
    await a.signOut().catch(()=>{}); await a.signInWithPassword(${JSON.stringify(USER)}, ${JSON.stringify(PASS)}); await new Promise(r=>setTimeout(r,1500)); return a.getUser()?.id || 'no user';`);
  if (!/^[0-9a-f-]{36}$/.test(uid)) throw new Error(`register failed: ${uid}`);
  await sql(`insert into public.users (id, username, email, role, permissions) values (${lit(uid)}, ${lit(USER)}, ${lit(`${USER}@samomdkku.app`)}, 'user', array['samoshop'])
             on conflict (id) do update set permissions = excluded.permissions;`);
  await send('Page.navigate', { url: `${DEV_URL}/` }); await sleep(4000);
  await ev(`const a = await import('/src/js/auth.js'); await a.signOut().catch(()=>{}); await a.signInWithPassword(${JSON.stringify(USER)}, ${JSON.stringify(PASS)}); await new Promise(r=>setTimeout(r,2000)); return 1;`);
  await send('Page.navigate', { url: `${DEV_URL}/admin/#shop` }); await sleep(9000);

  const all = JSON.parse(await ev(`return JSON.stringify([...document.querySelectorAll('#shopAdminTabs [data-shop-admin-tab]')].map(b=>b.dataset.shopAdminTab));`) || '[]');
  const tabs = process.env.TABS ? process.env.TABS.split(',') : all;
  console.log(`tabs: ${all.join(', ')}`);

  const shot = async (name) => {
    const { result } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    writeFileSync(join(OUT, `${name}.png`), Buffer.from(result.data, 'base64'));
    const over = await ev(`return document.documentElement.scrollWidth - document.documentElement.clientWidth;`);
    if (over > 0) failed += 1;
    console.log(`${over > 0 ? '✗' : '✓'} ${name}.png${over > 0 ? ` — page scrolls sideways by ${over}px` : ''}`);
  };

  for (const w of WIDTHS) {
    await size(w); await sleep(800);
    for (const t of tabs) {
      const ok = await ev(`const b=document.querySelector('[data-shop-admin-tab="${t}"]'); if(!b) return false; b.click(); await new Promise(r=>setTimeout(r,2500)); window.scrollTo(0,0); return true;`);
      if (!ok) { console.log(`✗ no tab ${t}`); failed += 1; continue; }
      await shot(`${t}-${w}`);
      if (t === 'orders' && process.env.MODAL) {
        // The order detail popup — where most of an admin's day happens.
        const opened = await ev(`const r=document.querySelector('#shopAdminOrdersTbody tr[data-order-id]'); if(!r) return false; r.click(); await new Promise(r=>setTimeout(r,1500)); return !!document.querySelector('.modal.show');`);
        if (opened) {
          await shot(`order-modal-${w}`);
          await ev(`document.querySelector('.modal.show [data-bs-dismiss="modal"]')?.click(); await new Promise(r=>setTimeout(r,600)); return 1;`);
        }
      }
      if (t === 'verify' && w === WIDTHS[0]) {
        // The keys, WITHOUT deciding anything: a capture listener on BOTH
        // decision buttons records the click and stops it before the app's own
        // handler (which writes) can run. ⚠️ On 2026-10-15 only approve was
        // trapped; with the bug deliberately restored, R on another page
        // clicked the real reject and wrote SH9349 to slip_mismatch on
        // samo-dev (repaired by hand). Every button a key can reach is trapped.
        const keys = JSON.parse(await ev(`
          const btn = document.getElementById('shopVerifyApprove');
          const rej = document.getElementById('shopVerifyReject');
          if (!btn || !rej) return JSON.stringify({ skipped: 'queue empty' });
          let hits = 0; let rejects = 0;
          const trap = (e) => { hits += 1; e.stopImmediatePropagation(); e.preventDefault(); };
          const trapR = (e) => { rejects += 1; e.stopImmediatePropagation(); e.preventDefault(); };
          btn.addEventListener('click', trap, true);
          rej.addEventListener('click', trapR, true);
          const press = (key, target = document.body) => target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
          press('a'); const viaA = hits;
          const box = document.createElement('input'); document.body.appendChild(box); box.focus();
          press('a', box); const whileTyping = hits - viaA; box.remove();
          press('ฟ'); const viaThai = hits - viaA - whileTyping;
          press('a', document.body); document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true }));
          // Leave the shop for another admin page: the queue is still in the
          // DOM, hidden by an ANCESTOR — the keys must be dead there.
          const other = [...document.querySelectorAll('[data-admin-side]')].find((b) => b.dataset.adminSide !== 'shop' && b.offsetParent);
          let elsewhere = null;
          if (other) {
            other.click(); await new Promise(r=>setTimeout(r,800));
            const before = hits + rejects; press('a'); press('r'); elsewhere = hits + rejects - before;
            document.querySelector('[data-admin-side="shop"]')?.click(); await new Promise(r=>setTimeout(r,2500));
          }
          btn.removeEventListener('click', trap, true);
          rej.removeEventListener('click', trapR, true);
          return JSON.stringify({ viaA, whileTyping, viaThai, total: hits, rejects, elsewhere, otherPage: other?.dataset.adminSide || null });`) || '{}');
        const ok = keys.skipped || (keys.viaA === 1 && keys.whileTyping === 0 && keys.viaThai === 1 && keys.total === 3 && keys.rejects === 0 && keys.elsewhere === 0);
        if (!ok) failed += 1;
        console.log(`${ok ? '✓' : '✗'} slip-queue keys: ${JSON.stringify(keys)}`);
      }
      if (t === 'sales') {
        const opened = await ev(`const r=document.querySelector('[data-sales-toggle]'); if(!r) return false; if (r.getAttribute('aria-expanded') !== 'true') r.click(); await new Promise(r=>setTimeout(r,400)); return true;`);
        if (opened) {
          await shot(`sales-expanded-${w}`);
          // The same grid in baht: revenue per size, per colour, per cell.
          const money = await ev(`const b=document.querySelector('[data-sales-cell-metric="revenue"]'); if(!b) return 'no toggle (single variant)';
            if (b.getAttribute('aria-pressed') !== 'true') b.click(); await new Promise(r=>setTimeout(r,300));
            return document.querySelector('.sales-matrix.is-money tfoot .is-total')?.textContent.trim() || 'no money grid';`);
          console.log(`  grid in baht, total cell: ${money}`);
          if (/^no money/.test(String(money))) failed += 1;
          await shot(`sales-expanded-money-${w}`);
        }
        if (process.env.FIXTURE) {
          // samo-dev holds a handful of old orders; production's shape (3
          // products, ~45 orders a day or two apart over three weeks, per-size
          // colours) is drawn from IN-PAGE data — nothing is written anywhere.
          const fx = await ev(`const m = await import('/src/js/shop/admin-sales.js');
            const day = 864e5, now = Date.now(); let n = 0;
            const products = [
              { id:'polo', name:'Sleep Deprived Caffeine Boosted POLO', source:'md', is_active:true, sizes:['XS','S','M','L','XL','2XL'], colors:[{id:'cream-green',label:'ครีมเขียว',hex:'#cfe3b8'}] },
              { id:'pants', name:'กางเกงช้างลายน้องอุ่นใจ', source:'md', is_active:false, sizes:['F','XL','XXL'], colors:[{id:'black',label:'ดำ',hex:'#222'},{id:'navy',label:'กรม',hex:'#1d2a55'},{id:'green',label:'เขียว',hex:'#3d7a4a'},{id:'red',label:'แดง',hex:'#b33'}] },
              { id:'mdi', name:'เสื้อPOLO MDI2026 COLLECTION', source:'mdi', is_active:true, sizes:['M'], colors:[] } ];
            const pick = (a) => a[Math.floor(Math.random()*a.length)];
            const orders = Array.from({length:45}, (_, i) => { const p = i%3===0 ? products[0] : products[1];
              const items = [{ id:++n, product_id:p.id, product_source:'md', qty: 1 + (i%5===0), unit_price: p.id==='polo'?299:209,
                size: pick(p.sizes), color: pick(p.colors).id, is_preorder:true, item_status: pick(['paid','paid','produce','done']) }];
              return { id:'F'+i, status: i>41 ? 'review' : 'paid', placed_at: new Date(now - Math.floor(Math.random()*23)*day).toISOString(),
                buyer_id:'b'+(i%41), items, total: items[0].qty*items[0].unit_price }; });
            m.renderSales(orders, products); await new Promise(r=>setTimeout(r,500));
            return document.querySelector('.sales-hero-value')?.textContent || 'no hero';`);
          console.log(`  fixture rendered: ${fx}`);
          if (!/^฿/.test(String(fx))) failed += 1;
          await shot(`sales-fixture-${w}`);
          // No expanded shot: a row click is handled by the PAGE's module
          // instance (vite serves this import as a second one), which redraws
          // its own data over the fixture.
        }
        if (w === WIDTHS[0] && !process.env.FIXTURE) {
          // Behaviour, not just pixels: the period filter, the chart's
          // keyboard readout, and the jump to one product's orders.
          const checks = JSON.parse(await ev(`
            const out = {};
            const kpi = () => document.querySelector('.sales-hero-value')?.textContent.trim();
            const before = kpi();
            document.querySelector('[data-sales-period="7d"]').click(); await new Promise(r=>setTimeout(r,300));
            out.period = document.querySelector('[data-sales-period="7d"]').getAttribute('aria-pressed') === 'true';
            out.kpiChangedOrEmpty = kpi() !== before || !!document.querySelector('.sales-empty');
            document.querySelector('[data-sales-period="all"]').click(); await new Promise(r=>setTimeout(r,300));
            out.kpiBack = kpi() === before;
            const plot = document.querySelector('.sales-plot');
            if (plot) { plot.focus(); plot.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
              const tip = document.querySelector('.sales-tip'); out.tip = !tip.hidden && tip.textContent.trim().length > 0; out.tipText = tip.textContent.trim().slice(0, 60); }
            const jump = document.querySelector('[data-sales-orders]');
            if (jump) { jump.click(); await new Promise(r=>setTimeout(r,2500));
              out.jumpedTab = document.querySelector('#shopAdminTabs .is-active')?.dataset.shopAdminTab;
              out.productFacet = document.getElementById('shopAdminOrdersProductBadge')?.textContent?.trim() || null;
              document.querySelector('[data-shop-admin-tab="sales"]').click(); await new Promise(r=>setTimeout(r,2000)); }
            return JSON.stringify(out);`) || '{}');
          const ok = checks.period && checks.kpiChangedOrEmpty && checks.kpiBack && checks.tip !== false && (!('jumpedTab' in checks) || checks.jumpedTab === 'orders');
          if (!ok) failed += 1;
          console.log(`${ok ? '✓' : '✗'} sales behaviour: ${JSON.stringify(checks)}`);
        }
      }
    }
  }
  if (errs.length) { failed += 1; console.log(`✗ console errors:\n  ${[...new Set(errs)].join('\n  ')}`); }
} catch (e) {
  failed += 1; console.log(`✗ ${e.message}`);
} finally {
  try {
    const [left] = await sql(`delete from public.users where username = ${lit(USER)};
      delete from auth.users where email = ${lit(`${USER}@samomdkku.app`)};
      select (select count(*) from auth.users where email = ${lit(`${USER}@samomdkku.app`)}) accounts;`);
    console.log(`${Number(left.accounts) === 0 ? '✓' : '✗'} cleanup: ${JSON.stringify(left)}`);
  } catch (e) { failed += 1; console.log(`✗ cleanup FAILED — remove ${USER} by hand: ${e.message}`); }
  try { ws?.close(); } catch { /* noop */ }
  chrome.kill();
  console.log(`\n${failed ? `${failed} FAILED` : 'all passed'} · screenshots: ${OUT}`);
  process.exit(failed ? 1 : 0);
}
