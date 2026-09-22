#!/usr/bin/env node
// ============================================================
// shop-admin-strip.mjs — drive the SAMO Shop admin PICTURE STRIP for real,
// SIGNED IN, in headless Chrome, against the local dev server on samo-dev.
//
// WHY THIS EXISTS. The admin panel needs a signed-in shop admin, so the first
// gallery build shipped with its admin half "not driven" — and a cold review
// found the strip had NO CSS on /admin/ (its rules sat in a stylesheet only
// the storefront loads). Behaviour checks alone would not have seen that; this
// tool drives the real page AND screenshots it. Built 2026-09-22.
//
// WHAT IT DOES, all on samo-dev (it REFUSES any other project):
//   1. registers a throwaway username account through the app's own
//      registerWithPassword, and gives it `samoshop` (public.users.permissions);
//   2. opens /admin/#shop → สินค้า → เพิ่มสินค้าใหม่, adds a colour, picks 3
//      pictures, reorders, tags one, saves; reopens, removes one, saves;
//   3. EVERY Apps Script request is INTERCEPTED (CDP Fetch) and answered
//      locally — nothing reaches the production Drive (GAS_API_URL is the live
//      one even in dev);
//   4. prints each step's result, the intercepted upload/delete calls and any
//      console error; screenshots the strip to $OUT/strip.png;
//   5. ALWAYS deletes the test product and the account (auth + users), in a
//      finally, and prints what is left (must be 0).
//
// RUN (needs `npm run dev` on :5174 — it uses samo-dev — and Chrome):
//   npm run dev &                         # or: npx vite --port 5174
//   node tools/browser/shop-admin-strip.mjs
//   DEV_URL=http://localhost:5199 OUT=/tmp/x node tools/browser/shop-admin-strip.mjs
// Credentials: SUPABASE_DEV_URL + SUPABASE_DEV_ACCESS_TOKEN from .env.local
// (the dev PAT — migration-tier, owner laptop; .claude/rules/security.md).
// ============================================================
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadEnv, resolveTarget, runSql } from '../env-lib.mjs';

const DEV_URL = process.env.DEV_URL || 'http://localhost:5174';
const OUT = process.env.OUT || mkdtempSync(join(tmpdir(), 'shop-admin-'));
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9338;
const USER = `claudetest${Date.now().toString(36)}`;
const PASS = `t-${Math.random().toString(36).slice(2)}-Aa1`;
// Real public lh3 pictures (downloaded as the files to pick, and handed back as
// the "uploaded" URLs so the saved gallery renders).
const POOL = ['15FVJRgNTQNsR-I_sgWl90mN5dcZSJolq', '1qrReAfEOTvaQ2FnqIpPkSq-sI-kggVjX', '1aPvuvmJxd9_yge6zYvvahG5UcdMucKRc'];

// ── samo-dev ONLY ────────────────────────────────────────────────────────────
const loaded = loadEnv();
const devTarget = resolveTarget({
  ...loaded,
  env: { ...loaded.env, VITE_SUPABASE_URL: loaded.fileEnv.SUPABASE_DEV_URL, SUPABASE_ACCESS_TOKEN: loaded.fileEnv.SUPABASE_DEV_ACCESS_TOKEN },
});
if (!devTarget.isDev || !devTarget.token) {
  console.error(`refusing: the database target is "${devTarget.label}", not samo-dev (need SUPABASE_DEV_URL + SUPABASE_DEV_ACCESS_TOKEN)`);
  process.exit(1);
}
console.error(`→ database: ${devTarget.ref} (${devTarget.label}) · app: ${DEV_URL} · out: ${OUT}`);
const sql = async (q) => JSON.parse(await runSql(q, devTarget));
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;

mkdirSync(OUT, { recursive: true });
for (const id of POOL) {
  const r = await fetch(`https://lh3.googleusercontent.com/d/${id}=w900`, { referrerPolicy: 'no-referrer' });
  writeFileSync(join(OUT, `${id}.png`), Buffer.from(await r.arrayBuffer()));
}

const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${mkdtempSync(join(tmpdir(), 'shop-admin-chrome-'))}`], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws; let id = 0; const pend = {}; const errs = []; const gas = []; let up = 0; let failed = 0;
const say = (label, v, ok = true) => { if (!ok) failed += 1; console.log(`${ok ? '✓' : '✗'} ${label}: ${v}`); };

try {
  for (let i = 0; i < 30 && !ws; i += 1) {
    try {
      const t = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
      ws = new WebSocket(t.webSocketDebuggerUrl);
    } catch { await sleep(300); }
  }
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
  ws.onmessage = async (m) => {
    const d = JSON.parse(m.data);
    if (pend[d.id]) { pend[d.id](d); delete pend[d.id]; }
    if (d.method === 'Runtime.exceptionThrown') errs.push(d.params.exceptionDetails?.exception?.description?.split('\n')[0]);
    if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') errs.push(d.params.args.map((a) => a.value || a.description).join(' ').slice(0, 200));
    if (d.method === 'Fetch.requestPaused') {
      const body = d.params.request.postData || '';
      const action = (body.match(/"action":"(\w+)"/) || [])[1] || '?';
      let resp = { success: true };
      if (action === 'uploadShopFile') { resp = { success: true, fileUrl: `https://drive.google.com/file/d/${POOL[up % POOL.length]}/view` }; gas.push(`upload #${++up} (${Math.round(body.length / 1024)} KB)`); }
      else if (action === 'deleteShopFile') gas.push(`DELETE ${(body.match(/"fileUrl":"([^"]+)"/) || [])[1]}`);
      else gas.push(`other: ${action}`);
      await send('Fetch.fulfillRequest', { requestId: d.params.requestId, responseCode: 200,
        responseHeaders: [{ name: 'Content-Type', value: 'application/json' }, { name: 'Access-Control-Allow-Origin', value: '*' }],
        body: Buffer.from(JSON.stringify(resp)).toString('base64') });
    }
  };
  await new Promise((r) => { ws.onopen = r; });
  const ev = async (e) => (await send('Runtime.evaluate', { expression: `(async()=>{try{${e}}catch(err){return 'ERR '+err.message}})()`, awaitPromise: true, returnByValue: true })).result?.result?.value;
  await send('Runtime.enable'); await send('DOM.enable'); await send('Page.enable');
  await send('Fetch.enable', { patterns: [{ urlPattern: '*script.google.com*', requestStage: 'Request' }] });
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false });

  // 1. account + grant
  await send('Page.navigate', { url: `${DEV_URL}/` }); await sleep(6000);
  const uid = await ev(`const a = await import('/src/js/auth.js'); await a.registerWithPassword(${JSON.stringify(USER)}, ${JSON.stringify(PASS)});
    await a.signOut().catch(()=>{}); await a.signInWithPassword(${JSON.stringify(USER)}, ${JSON.stringify(PASS)}); await new Promise(r=>setTimeout(r,1500)); return a.getUser()?.id || 'no user';`);
  if (!/^[0-9a-f-]{36}$/.test(uid)) throw new Error(`register failed: ${uid}`);
  await sql(`insert into public.users (id, username, email, role, permissions) values (${lit(uid)}, ${lit(USER)}, ${lit(`${USER}@samomdkku.app`)}, 'user', array['samoshop'])
             on conflict (id) do update set permissions = excluded.permissions;`);
  say('account', `${USER} (samoshop on samo-dev)`);

  // 2. the strip
  await send('Page.navigate', { url: `${DEV_URL}/` }); await sleep(4000);
  await ev(`const a = await import('/src/js/auth.js'); await a.signOut().catch(()=>{}); await a.signInWithPassword(${JSON.stringify(USER)}, ${JSON.stringify(PASS)}); await new Promise(r=>setTimeout(r,2000)); return 1;`);
  await send('Page.navigate', { url: `${DEV_URL}/admin/#shop` }); await sleep(9000);
  const opened = await ev(`document.querySelector('[data-shop-admin-tab="products"]').click(); await new Promise(r=>setTimeout(r,2500));
    document.getElementById('shopAdminProductsNew').click(); await new Promise(r=>setTimeout(r,800));
    document.getElementById('shopProdName').value = 'CLAUDE-TEST gallery ' + Date.now();
    document.getElementById('shopProdPrice').value = '100'; document.getElementById('shopProdSizes').value = 'M';
    document.getElementById('shopProdColorsAdd').click();   // the template already has 'black'
    const rows = document.querySelectorAll('#shopProdColorsList .shop-color-row');
    rows[rows.length-1].querySelector('[data-color-label]').value = 'แดง'; rows[rows.length-1].querySelector('[data-color-id]').value = 'red';
    rows[rows.length-1].querySelector('[data-color-label]').dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r=>setTimeout(r,400)); return !!document.querySelector('#shopProdImages [data-img-add]');`);
  say('editor open with a picture strip', opened, opened === true);
  const doc = await send('DOM.getDocument', { depth: -1 });
  const q = await send('DOM.querySelector', { nodeId: doc.result.root.nodeId, selector: '#shopProdImages [data-img-add]' });
  await send('DOM.setFileInputFiles', { nodeId: q.result.nodeId, files: POOL.map((p) => join(OUT, `${p}.png`)) });
  await sleep(4000);
  const picked = JSON.parse(await ev(`const tiles=[...document.querySelectorAll('#shopProdImages .shop-img-tile')];
    return JSON.stringify({ tiles: tiles.length, cover: !!tiles[0]?.querySelector('.shop-img-cover'), loaded: tiles.every(t=>t.querySelector('img').naturalWidth>0),
      styled: tiles[0] ? getComputedStyle(tiles[0]).width : null, menus: tiles.map(t=>t.querySelectorAll('option').length) });`));
  say('pick 3', JSON.stringify(picked), picked.tiles === 3 && picked.cover && picked.loaded && picked.styled === '116px' && picked.menus.every((n) => n === 3));
  const moved = JSON.parse(await ev(`const src=()=>[...document.querySelectorAll('#shopProdImages .shop-img-tile img')].map(i=>i.src);
    const b=src(); document.querySelector('#shopProdImages [data-img-move="0"][data-dir="1"]').click(); await new Promise(r=>setTimeout(r,300)); const a=src();
    const sel=document.querySelector('#shopProdImages [data-img-color="2"]'); sel.value='red'; sel.dispatchEvent(new Event('change',{bubbles:true}));
    return JSON.stringify({ swapped: b[0]===a[1] && b[1]===a[0] });`));
  say('reorder + colour tag', JSON.stringify(moved), moved.swapped);
  await ev(`document.getElementById('shopProdImages').scrollIntoView({block:'center'}); await new Promise(r=>setTimeout(r,500)); return 1;`);
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(OUT, 'strip.png'), Buffer.from(shot.result.data, 'base64'));
  await ev(`document.getElementById('shopProdSave').click(); await new Promise(r=>setTimeout(r,9000)); return 1;`);
  say('save uploads 3', gas.filter((g) => g.startsWith('upload')).length, gas.filter((g) => g.startsWith('upload')).length === 3);
  const [row] = await sql(`select image_url, images from public.shop_products where name like 'CLAUDE-TEST%' limit 1;`);
  say('saved: 3 pictures, cover derived, tag kept', row ? `${row.images.length} · ${row.image_url?.slice(-20)} · ${row.images.map((x) => x.color).join(',')}` : 'NO ROW',
    !!row && row.images.length === 3 && row.image_url === `${row.images[0].url}=w1200` && row.images[2].color === 'red');
  const again = JSON.parse(await ev(`const b=[...document.querySelectorAll('[data-product-edit]')].find(x=>/CLAUDE-TEST/.test(x.closest('tr')?.textContent||''));
    b.click(); await new Promise(r=>setTimeout(r,1200)); const n=document.querySelectorAll('#shopProdImages .shop-img-tile').length;
    document.querySelector('#shopProdImages [data-img-remove="1"]').click(); await new Promise(r=>setTimeout(r,300));
    document.getElementById('shopProdSave').click(); await new Promise(r=>setTimeout(r,9000)); return JSON.stringify({ reopened: n });`));
  const deletes = gas.filter((g) => g.startsWith('DELETE'));
  say('reopen + remove 1 + save', `${again.reopened} tiles, ${deletes.length} delete: ${deletes.join(' ')}`, again.reopened === 3 && deletes.length === 1);
  say('console errors', errs.length ? errs.join(' | ') : 'none', errs.length === 0);
} catch (e) {
  failed += 1;
  console.log(`✗ run aborted: ${e.message}`);
} finally {
  // 5. ALWAYS clean up samo-dev
  try {
    const [left] = await sql(`delete from public.shop_products where name like 'CLAUDE-TEST%';
      delete from public.users where username = ${lit(USER)};
      delete from auth.users where email = ${lit(`${USER}@samomdkku.app`)};
      select (select count(*) from public.shop_products where name like 'CLAUDE-TEST%') products,
             (select count(*) from auth.users where email = ${lit(`${USER}@samomdkku.app`)}) accounts;`);
    say('cleanup (left behind)', JSON.stringify(left), Number(left.products) === 0 && Number(left.accounts) === 0);
  } catch (e) { failed += 1; console.log(`✗ cleanup FAILED — remove ${USER} and CLAUDE-TEST products by hand: ${e.message}`); }
  try { ws?.close(); } catch { /* noop */ }
  chrome.kill();
  console.log(`\n${failed ? `${failed} FAILED` : 'all passed'} · screenshot: ${join(OUT, 'strip.png')}`);
  process.exit(failed ? 1 : 0);
}
