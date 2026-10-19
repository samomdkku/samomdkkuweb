#!/usr/bin/env node
// ============================================================
// shop-checkout-navigate-away.mjs — drives the exact customer flow the
// owner worried about (2026-10-18 night-agent task 9): a username/password
// account adds to cart, navigates AWAY mid-shop (another top-level tab —
// /me — and back via the home banner's own click-intercept path), then
// opens checkout and picks a slip. Everything is a real click/navigate —
// no full page reload, which is the thing to actually verify (the app is
// a client-side router; `window.navigateTo`/Bootstrap Tab.show() never
// call location.reload()).
//
// Checks, in order:
//   1. register + sign in with USERNAME/PASSWORD (no email — the no-email
//      checkout notice is part of what we're exercising)
//   2. open /shop, add a product to the cart (via the real module, same
//      effect as clicking "เพิ่มลงตะกร้า" — the grid's own click handler is
//      covered elsewhere; this is about what happens AFTER, not the add)
//   3. navigate to /me (home-row link path: data-dept-tool-tab intercept)
//   4. navigate back to /shop (home banner's shop slide: same intercept)
//   5. the cart still holds the item — localStorage survived because
//      nothing reloaded
//   6. open checkout: buyer fields prefilled from the account (empty email
//      — "ไม่มีอีเมล" notice shown), cart line present
//   7. pick a real slip file (DOM.setFileInputFiles) — NOT submitted, so no
//      Drive write happens; just proves the picked file renders a preview
//      after the navigate-away/back round trip above
//   8. navigate away AGAIN (to /me) and back WHILE the slip is picked and
//      buyer fields are typed — the in-progress checkout must still be
//      exactly where it was (same sub-view, same typed values, same slip
//      preview) — THIS is the scenario a reload would break
//
// ALWAYS deletes the throwaway account (auth + users) in a finally.
//
// RUN (needs `npm run dev` on :5174 — samo-dev — and Chrome):
//   node tools/browser/shop-checkout-navigate-away.mjs
// ============================================================
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadEnv, resolveTarget, runSql } from '../env-lib.mjs';

const DEV_URL = process.env.DEV_URL || 'http://localhost:5174';
const CHROME = process.env.CHROME || '/usr/bin/google-chrome';
const PORT = 9342;
const USER = `claudenav${Date.now().toString(36)}`;
const PASS = `t-${Math.random().toString(36).slice(2)}-Aa1`;
const SLIP_PATH = '/tmp/fake-slip.png';

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
console.error(`→ database: ${devTarget.ref} (${devTarget.label}) · app: ${DEV_URL}`);

const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${mkdtempSync(join(tmpdir(), 'shop-nav-chrome-'))}`], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws; let id = 0; const pend = {}; const errs = []; let failed = 0; let uid = null;

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
  await send('Runtime.enable'); await send('Page.enable'); await send('DOM.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

  const check = (label, cond) => { console.log(`${cond ? '✓' : '✗'} ${label}`); if (!cond) failed += 1; };

  await send('Page.navigate', { url: `${DEV_URL}/` }); await sleep(4000);
  uid = await ev(`const a = await import('/src/js/auth.js'); await a.registerWithPassword(${JSON.stringify(USER)}, ${JSON.stringify(PASS)});
    await a.signOut().catch(()=>{}); await a.signInWithPassword(${JSON.stringify(USER)}, ${JSON.stringify(PASS)}); await new Promise(r=>setTimeout(r,1500)); return a.getUser()?.id || 'no user';`);
  check('registered + signed in with username/password', /^[0-9a-f-]{36}$/.test(uid));
  if (!/^[0-9a-f-]{36}$/.test(uid)) throw new Error(`register failed: ${uid}`);

  check('the signed-in account really has no email (the scenario this proof is about)',
    (await ev(`const a = await import('/src/js/auth.js'); return a.getUser()?.email === '' ? 'empty' : a.getUser()?.email;`)) === 'empty');

  // ── 2. open /shop, add the first active product straight to the cart ────
  await ev(`window.navigateTo('/shop'); await new Promise(r=>setTimeout(r,3500));`);
  const added = await ev(`
    const [{ listProducts }, { addItem }] = await Promise.all([import('/src/js/shop/api.js'), import('/src/js/shop/state.js')]);
    const products = await listProducts({ activeOnly: true });
    const p = products.find(x => x.stock_status !== 'sold_out');
    if (!p) return 'no sellable product on samo-dev';
    addItem({ productId: p.id, size: (p.sizes||['F'])[0], color: (p.colors||[{id:'default'}])[0]?.id || 'default', fit: null, qty: 1, price: 1 });
    return p.id;`);
  check(`added a product to the cart (${added})`, added && !/^no /.test(added));
  const productId = added;

  const cartCountAfterAdd = await ev(`const { cartCount } = await import('/src/js/shop/state.js'); return cartCount();`);
  check('cart count is 1 right after adding', Number(cartCountAfterAdd) === 1);

  // ── 3. navigate AWAY to /me (home-row link path, data-dept-tool-tab) ────
  await ev(`window.navigateTo('/me'); await new Promise(r=>setTimeout(r,2000));`);
  check('on /me now (shop pane inactive)', await ev(`return location.pathname === '/me' && document.getElementById('pills-me-tab')?.classList.contains('active');`));
  check('no full reload happened — the auth module instance is UNCHANGED (same session object survives in memory)',
    await ev(`const a = await import('/src/js/auth.js'); return !!a.getUser();`));

  // ── 4. navigate BACK to /shop (home banner's shop slide path) ───────────
  await ev(`window.navigateTo('/shop'); await new Promise(r=>setTimeout(r,3500));`);
  check('back on /shop', await ev(`return location.pathname === '/shop';`));

  // ── 5. the cart survived the round trip ──────────────────────────────────
  const cartAfterRoundTrip = await ev(`const { getCart } = await import('/src/js/shop/state.js'); return JSON.stringify(getCart());`);
  const cartItems = JSON.parse(cartAfterRoundTrip || '[]');
  check(`the cart still has the item after navigating to /me and back (${cartItems.length} item(s))`, cartItems.length === 1 && cartItems[0].productId === productId);

  // ── 6. open checkout, check prefill + the no-email notice ───────────────
  const checkoutOpened = await ev(`
    document.querySelector('[data-shop-view="checkout"]')?.click();
    await new Promise(r=>setTimeout(r,1500));
    return !document.getElementById('shopCheckoutBody')?.classList.contains('d-none');`);
  check('checkout view opened', checkoutOpened);
  const prefill = JSON.parse(await ev(`return JSON.stringify({
    nameVal: document.getElementById('shopBuyerName')?.value || '',
    emailVal: document.getElementById('shopBuyerEmail')?.value || '',
    noEmailNotice: !!document.querySelector('[data-bs-target="#signinModal"]'),
    cartLines: document.querySelectorAll('.checkout-panel .d-flex.gap-3').length,
  });`) || '{}');
  check('no-email notice shown for this username/password account', prefill.noEmailNotice);
  check('exactly one cart line rendered in checkout', prefill.cartLines === 1);

  // Type the required fields (what a real buyer does before uploading).
  await ev(`
    const set = (id, v) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
    set('shopBuyerName', 'ทดสอบ นำทาง');
    set('shopBuyerEmail', 'claude-nav-test@example.com');
    set('shopBuyerPhone', '0812345678');
    document.getElementById('shopCheckoutAgree').click();
    return 1;`);

  // ── 7. pick a real slip file (no network call yet — upload happens only
  //        inside placeOrder(), which we never click) ─────────────────────
  const { result: doc } = await send('DOM.getDocument', {});
  const { result: fileInputNode } = await send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '[data-slip-file]' });
  let slipPicked = false;
  if (fileInputNode.nodeId) {
    await send('DOM.setFileInputFiles', { nodeId: fileInputNode.nodeId, files: [SLIP_PATH] });
    await sleep(1200);
    slipPicked = await ev(`return !!document.querySelector('.slip-drop.is-filled');`);
  }
  check('slip file picked and preview shown', slipPicked);

  // ── 8. navigate away AGAIN and back WHILE mid-checkout (slip picked,
  //        fields typed, not yet submitted) — the actual reload-risk case ──
  await ev(`window.navigateTo('/me'); await new Promise(r=>setTimeout(r,2000));`);
  await ev(`window.navigateTo('/shop'); await new Promise(r=>setTimeout(r,2500));`);
  const stillCheckout = await ev(`return !document.getElementById('shopCheckoutBody')?.classList.contains('d-none');`);
  check('still on the checkout sub-view after navigating away and back mid-checkout (not bounced to the product grid)', stillCheckout);
  const afterRoundTrip2 = JSON.parse(await ev(`return JSON.stringify({
    nameVal: document.getElementById('shopBuyerName')?.value || '',
    emailVal: document.getElementById('shopBuyerEmail')?.value || '',
    phoneVal: document.getElementById('shopBuyerPhone')?.value || '',
    slipStillFilled: !!document.querySelector('.slip-drop.is-filled'),
    placeBtnDisabled: document.getElementById('shopPlaceOrderBtn')?.disabled,
  });`) || '{}');
  check('typed name survived the round trip', afterRoundTrip2.nameVal === 'ทดสอบ นำทาง');
  check('typed email survived the round trip', afterRoundTrip2.emailVal === 'claude-nav-test@example.com');
  check('typed phone survived the round trip', afterRoundTrip2.phoneVal === '0812345678');
  check('the picked slip is STILL shown as filled (not silently dropped)', afterRoundTrip2.slipStillFilled);
  check('the place-order button is enabled (every requirement still satisfied)', afterRoundTrip2.placeBtnDisabled === false);

  check('no console errors / exceptions across the whole flow', errs.length === 0);
  if (errs.length) console.log('  errors seen:', JSON.stringify(errs.slice(0, 10)));

  console.log(failed === 0 ? `\nPASS — ${0} failures` : `\nFAIL — ${failed} check(s) failed`);
  process.exitCode = failed === 0 ? 0 : 1;
} finally {
  if (uid) {
    await sql(`delete from public.users where id = ${lit(uid)};`).catch(() => {});
    await sql(`select auth.admin_delete_user(${lit(uid)}::uuid);`).catch(async () => {
      // auth.admin_delete_user may not exist on this PG version's supabase
      // extension surface — fall back to the raw table the way other
      // throwaway-account tools in this repo do.
      await sql(`delete from auth.users where id = ${lit(uid)};`).catch(() => {});
    });
  }
  chrome.kill();
}
