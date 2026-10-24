#!/usr/bin/env node
// ============================================================
// home-hero.mjs — drive the HOME banner carousel and tool rail in headless
// Chrome, on a desktop width and an emulated phone, and screenshot both.
//
// No database and no sign-in: the home page is public. Point it at the dev
// server or at production — it only reads.
//
// What it asserts (each line ✓/✗, exit 1 on any ✗):
//   - three slides; the rail leads with SAMO Shop · จองห้องสโม · PR Form ·
//     หนังสือโครงการ · VitalSound and ends with ดูทั้งหมด
//   - the next arrow / a dot / a MOUSE drag+flick / a TOUCH swipe each land on
//     the slide they should, exactly snapped
//   - autoplay moves on by itself, and does NOT while paused
//   - tapping a rail tile opens its tab; no console error on the way
//
// RUN:  npm run dev &   then   node tools/browser/home-hero.mjs
//       URL=https://samo.md.kku.ac.th/ OUT=/tmp/x node tools/browser/home-hero.mjs
// ============================================================
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const URL_ = process.env.URL || 'http://localhost:5174/';
const OUT = process.env.OUT || mkdtempSync(join(tmpdir(), 'home-hero-'));
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9341;
mkdirSync(OUT, { recursive: true });

const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${mkdtempSync(join(tmpdir(), 'home-hero-chrome-'))}`], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws; let id = 0; const pend = {}; const errs = []; let failed = 0;
const say = (label, v, ok = true) => { if (!ok) failed += 1; console.log(`${ok ? '✓' : '✗'} ${label}: ${v}`); };
const send = (method, params = {}) => new Promise((res, rej) => {
  const i = ++id; pend[i] = { res, rej }; ws.send(JSON.stringify({ id: i, method, params }));
});
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: `(async()=>{try{${expr}}catch(e){return 'ERR '+e.stack}})()`, awaitPromise: true, returnByValue: true });
  return r.result?.value;
};
const shot = async (name) => {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(OUT, name), Buffer.from(r.data, 'base64'));
};
const state = () => ev(`const t=document.querySelector('#homeHero .hero-track');
  const a=[...document.querySelectorAll('#homeHero .hero-dot')].findIndex(d=>d.classList.contains('is-active'));
  return {left:t.scrollLeft, w:t.clientWidth, active:a, paused:document.getElementById('homeHero').hasAttribute('data-paused')};`);
const settled = async () => { await sleep(900); return state(); };
const snappedTo = (s) => (s.w ? s.left / s.w : NaN);

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
    if (d.id && pend[d.id]) { (d.error ? pend[d.id].rej(new Error(d.error.message)) : pend[d.id].res(d.result)); delete pend[d.id]; }
    if (d.method === 'Runtime.exceptionThrown') errs.push(d.params.exceptionDetails?.exception?.description || d.params.exceptionDetails?.text);
    if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') errs.push(d.params.args.map((a) => a.value ?? a.description).join(' '));
  };
  await send('Runtime.enable');
  await send('Page.enable');

  for (const view of [
    { name: 'desktop', width: 1280, height: 900, mobile: false, touch: false },
    { name: 'phone', width: 390, height: 844, mobile: true, touch: true },
  ]) {
    console.log(`\n── ${view.name} ${view.width}px`);
    await send('Emulation.setDeviceMetricsOverride', { width: view.width, height: view.height, deviceScaleFactor: 2, mobile: view.mobile });
    await send('Emulation.setTouchEmulationEnabled', view.touch ? { enabled: true, maxTouchPoints: 5 } : { enabled: false });
    await send('Page.navigate', { url: URL_ });
    // Wait for the page's OWN boot signal, not a fixed sleep: a cold dev
    // server can take longer than any guess, and a check that runs before the
    // app has started reports "no slides, no tiles" — a false red.
    for (let t = 0; t < 60; t += 1) {
      if (await ev(`return !!window.__samoBooted && document.querySelectorAll('#homeRailTrack .launcher-tool').length > 0`)) break;
      await sleep(250);
    }
    await sleep(1200); // announcements fill the ประกาศ slide after boot

    const info = await ev(`return {
      slides: document.querySelectorAll('#homeHero .hero-slide').length,
      dots: document.querySelectorAll('#homeHero .hero-dot').length,
      rail: [...document.querySelectorAll('#homeRailTrack .launcher-tool-name')].map(n=>n.textContent.trim()),
      railOverflows: (()=>{const t=document.getElementById('homeRailTrack');return t.scrollWidth>t.clientWidth})(),
      pageOverflowX: document.documentElement.scrollWidth > innerWidth,
      newsLatest: document.querySelector('.hero-news-latest')?.hidden === false ? document.querySelector('.hero-news-title').textContent : '(hidden)',
    };`);
    say('slides / dots', `${info.slides} / ${info.dots}`, info.slides === 4 && info.dots === 4);
    const lead = ['SAMO Shop', 'SAMO Booking', 'PR Form', 'SAMO Project', 'VitalSound'];
    say('rail leads with', info.rail.slice(0, 5).join(' · '), JSON.stringify(info.rail.slice(0, 5)) === JSON.stringify(lead));
    say('rail ends with', info.rail.at(-1), info.rail.at(-1) === 'ดูทั้งหมด');
    say('rail scrolls sideways', info.railOverflows, info.railOverflows);
    say('no horizontal PAGE scroll', !info.pageOverflowX, !info.pageOverflowX);
    say('news slide headline', info.newsLatest, true);
    await shot(`${view.name}-1.png`);

    // Hover/press holds would skew the next checks — move the mouse away.
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: view.height - 5 });

    if (!view.touch) {
      await ev(`document.querySelector('#homeHero .hero-next').click(); return 1`);
      let s = await settled();
      say('next arrow → slide 2, snapped', `active=${s.active} pos=${snappedTo(s).toFixed(3)}`, s.active === 1 && Math.abs(snappedTo(s) - 1) < 0.01);
      await shot(`${view.name}-2-shop.png`);
      await ev(`document.querySelectorAll('#homeHero .hero-dot')[2].click(); return 1`);
      s = await settled();
      say('dot 3 → slide 3', `active=${s.active} pos=${snappedTo(s).toFixed(3)}`, s.active === 2 && Math.abs(snappedTo(s) - 2) < 0.01);
      await shot(`${view.name}-3-news.png`);

      // A quick mouse FLICK right-to-left of ~120px from slide 3 → back to... it is the last
      // slide, so flick LEFT-to-right to go back to slide 2.
      const box = await ev(`const r=document.querySelector('#homeHero .hero-track').getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}`);
      const y = box.y + box.h / 2; let x = box.x + box.w * 0.3;
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
      for (let k = 0; k < 6; k += 1) { x += 20; await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'left', buttons: 1 }); await sleep(12); }
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
      s = await settled();
      say('mouse flick (120px, fast) → slide 2', `active=${s.active} pos=${snappedTo(s).toFixed(3)}`, s.active === 1 && Math.abs(snappedTo(s) - 1) < 0.01);
      const tab = await ev(`return document.querySelector('.tab-pane.active')?.id`);
      say('a drag over a slide link does not open it', tab, tab === 'pills-home');

      // A drag whose moves were all coalesced away: down here, up 140px right,
      // no move in between. Must still move a slide — and must NOT open the link.
      await ev(`document.querySelectorAll('#homeHero .hero-dot')[2].click(); return 1`);
      await settled();
      x = box.x + box.w * 0.3;
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x + 140, y, button: 'left', clickCount: 1 });
      s = await settled();
      const tab2 = await ev(`return document.querySelector('.tab-pane.active')?.id`);
      say('drag with no move event → slide 2, link not opened', `active=${s.active} tab=${tab2}`, s.active === 1 && tab2 === 'pills-home');
      if (tab2 !== 'pills-home') { await ev(`activateTab('pills-home-tab'); return 1`); await sleep(500); }

      // Keyboard: focus on a slide's link, then → . Focus must follow to the new
      // slide, never stay on the one that just went aria-hidden.
      await ev(`document.querySelectorAll('#homeHero .hero-dot')[1].click(); return 1`);
      await settled();
      await ev(`document.querySelector('#homeHero .hero-slide--shop .hero-link').focus(); return 1`);
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 });
      s = await settled();
      const foc = await ev(`const a = document.activeElement; const sl = a.closest('.hero-slide');
        return { onHidden: sl ? sl.getAttribute('aria-hidden') === 'true' : false, inNews: !!a.closest('.hero-slide--news') }`);
      say('→ with focus on a slide: slide 3, focus followed', `active=${s.active} ${JSON.stringify(foc)}`, s.active === 2 && foc.inNews && !foc.onHidden);
      await ev(`document.activeElement.blur(); document.querySelectorAll('#homeHero .hero-dot')[1].click(); return 1`);
      await settled();

      // A slow short drag settles back.
      x = box.x + box.w * 0.5;
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
      for (let k = 0; k < 8; k += 1) { x -= 10; await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'left', buttons: 1 }); await sleep(60); }
      await sleep(200);
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
      s = await settled();
      say('slow 80px drag → settles back on slide 2', `active=${s.active} pos=${snappedTo(s).toFixed(3)}`, s.active === 1 && Math.abs(snappedTo(s) - 1) < 0.01);
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: view.height - 5 });
    } else {
      // A real touch swipe through the browser's own scroller.
      const box = await ev(`const r=document.querySelector('#homeHero .hero-track').getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}`);
      await send('Input.synthesizeScrollGesture', { x: Math.round(box.x + box.w * 0.8), y: Math.round(box.y + box.h / 2), xDistance: -Math.round(box.w * 0.6), yDistance: 0, gestureSourceType: 'touch', speed: 1600 });
      let s = await settled();
      say('touch swipe → slide 2, snapped', `active=${s.active} pos=${snappedTo(s).toFixed(3)}`, s.active === 1 && Math.abs(snappedTo(s) - 1) < 0.02);
      await shot(`${view.name}-2-shop.png`);
      await send('Input.synthesizeScrollGesture', { x: Math.round(box.x + box.w * 0.8), y: Math.round(box.y + box.h / 2), xDistance: -Math.round(box.w * 0.6), yDistance: 0, gestureSourceType: 'touch', speed: 1600 });
      s = await settled();
      say('touch swipe → slide 3', `active=${s.active}`, s.active === 2);
      await shot(`${view.name}-3-news.png`);
      // Rail swipe
      const rb = await ev(`const r=document.getElementById('homeRailTrack').getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}`);
      await send('Input.synthesizeScrollGesture', { x: Math.round(rb.x + rb.w * 0.8), y: Math.round(rb.y + rb.h / 2), xDistance: -200, yDistance: 0, gestureSourceType: 'touch', speed: 1200 });
      await sleep(600);
      const rl = await ev(`return document.getElementById('homeRailTrack').scrollLeft`);
      say('touch swipe scrolls the rail', rl, rl > 50);
      await ev(`document.getElementById('homeRailTrack').scrollLeft=0; return 1`);
    }

    // Autoplay: from wherever it is, it should move on within one period.
    let s0 = await state();
    await sleep(7300);
    let s1 = await state();
    say('autoplay moves on by itself', `${s0.active} → ${s1.active} (held=${s1.paused})`, s1.active === (s0.active + 1) % 4);
    await ev(`document.querySelector('#homeHero .hero-pause').click(); return 1`);
    s0 = await state();
    await sleep(7300);
    s1 = await state();
    say('paused: stays put', `${s0.active} → ${s1.active}`, s1.active === s0.active && s1.paused);
    await ev(`document.querySelector('#homeHero .hero-pause').click(); return 1`);

    await ev(`window.scrollTo(0,0); return 1`);
    await shot(`${view.name}-top.png`);
    // ⌘/Ctrl-click on an in-app LINK is the browser's (new tab) — the app must
    // not cancel it; a plain click is the app's. Read on window, which runs
    // after the app's document handler; the probe then cancels it itself so
    // nothing actually opens.
    const mod = await ev(`const a = document.querySelector('#homeHero .hero-slide--shop .hero-link');
      const seen = []; const spy = (e) => { seen.push(e.defaultPrevented); e.preventDefault(); };
      window.addEventListener('click', spy);
      a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, metaKey: true }));
      a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true }));
      window.removeEventListener('click', spy);
      return { modifiedLeftToBrowser: seen[0] === false && seen[1] === false,
        pane: [...document.querySelectorAll('.tab-pane.active')].find(p=>p.id.startsWith('pills-'))?.id }`);
    say('⌘/Ctrl-click on a slide link is left to the browser (new tab)', JSON.stringify(mod), mod.modifiedLeftToBrowser && mod.pane === 'pills-home');
    // Tap a rail tile → its tab opens.
    await ev(`[...document.querySelectorAll('#homeRailTrack .launcher-tool')].find(e=>e.textContent.includes('PR Form')).click(); return 1`);
    await sleep(800);
    const pane = await ev(`return document.querySelector('.tab-pane.active')?.id + ' ' + location.pathname`);
    say('rail tile "PR Form" opens its tab', pane, /pills-pr\b/.test(pane));
  }
  // Every OTHER page that draws a registry tool card: the launcher, a ฝ่าย page
  // whose tool uses the ฝ่าย logo, and the admin app (which imports the same
  // modules). Colours and logos changed in the registry reach all of them.
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 2, mobile: false });
  const base = URL_.replace(/\/$/, '');
  await send('Page.navigate', { url: `${base}/tools` }); await sleep(4000);
  const tools = await ev(`const cards = [...document.querySelectorAll('#launcherGridPublic .launcher-tool')];
    const bad = cards.filter(c => { const i = c.querySelector('.launcher-tool-icon'); const r = i.getBoundingClientRect();
      return !r.width || getComputedStyle(i).backgroundColor === 'rgba(0, 0, 0, 0)' && !i.querySelector('img'); }).length;
    const logos = cards.filter(c => c.querySelector('.launcher-tool-icon--logo img')).map(c => c.querySelector('img').naturalWidth);
    return { n: cards.length, bad, logos }`);
  say('/tools: every card has a painted icon, both ฝ่าย logos loaded', JSON.stringify(tools), tools.n > 8 && tools.bad === 0 && tools.logos.length === 2 && tools.logos.every((w) => w > 0));
  await shot('tools.png');
  await send('Page.navigate', { url: `${base}/departments#dept/media` }); await sleep(4000);
  const dept = await ev(`const img = document.querySelector('#pills-departments .launcher-tool-icon--logo img');
    return { logo: !!img, loaded: img ? img.naturalWidth > 0 : false }`);
  say('ฝ่าย media page: its tool shows the ฝ่าย logo', JSON.stringify(dept), dept.logo && dept.loaded);
  await send('Page.navigate', { url: `${base}/admin/` }); await sleep(5000);
  const admin = await ev(`return { booted: document.readyState, body: document.body.innerText.length > 50 }`);
  say('/admin/ loads (it imports the same modules)', JSON.stringify(admin), admin.body);

  say('console errors', errs.length ? errs.join(' | ') : 'none', errs.length === 0);
} catch (e) {
  failed += 1;
  console.log(`✗ driver error: ${e.stack || e}`);
} finally {
  try { ws?.close(); } catch { /* */ }
  chrome.kill();
  console.log(`\nscreenshots: ${OUT}`);
  process.exit(failed ? 1 : 0);
}
