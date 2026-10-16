// ============================================================
// home-hero.js — the home page's banner carousel and tool rail.
//
// THE CAROUSEL is a native scroll-snap track, not a transform we animate by
// hand. On a phone that is the whole point: the finger drives the browser's own
// scroller, so tracking is 1:1, momentum is the platform's, and nothing here can
// add latency to it. What JS adds is only what the scroller cannot do:
//   - autoplay, whose clock IS the progress bar in the active dot (a CSS
//     animation — pausing it is `animation-play-state`, and its `animationend`
//     advances the slide, so the bar and the move can never disagree);
//   - a mouse drag on desktop (a mouse cannot swipe a scroller), released with
//     Apple's momentum projection so a flick lands on the NEXT slide and a slow
//     drag settles back;
//   - pausing whenever someone is engaged: pointer down, hover, keyboard focus,
//     the page hidden, the banner scrolled away, or the pause button.
// prefers-reduced-motion: no autoplay at all, and every jump is instant.
//
// ⚠️ `pointerdown` on a scroll surface is the start of EVERY gesture it
// supports (docs/mistakes/frontend-ui.md, the iPad booking report), so nothing
// is armed by it but a pause, and `pointercancel` — what the browser fires when
// it takes a touch over to scroll — clears it.
//
// THE RAIL renders from the tool registry (src/data/tools.js → homeRailTools),
// through the same card renderer as the launcher and the ฝ่าย pages. A tile
// navigates through the document-level handler in departments.js, so there is
// no second copy of "how a tool opens".
// ============================================================

import { homeRailTools } from '../data/tools.js';
import { renderToolCard } from './tool-card.js';

/** How long one slide stays before autoplay moves on. CSS reads it as --hero-ms. */
export const AUTOPLAY_MS = 6500;

/** Apple's momentum projection (WWDC 2018, Designing Fluid Interfaces): how far
 *  a release at `v` px/s carries before it stops. Exponential decay, not v²/2a. */
export function project(v, decelerationRate = 0.998) {
  return ((v / 1000) * decelerationRate) / (1 - decelerationRate);
}

/** Above this release speed (px/s) a drag is a FLICK: it pages in the
 *  direction the pointer was moving, however short the drag was. */
export const FLICK_PX_S = 300;

/** Which slide a mouse drag released at scroll offset `pos` with scroll
 *  velocity `v` (px/s) lands on. Apple's rule: commit-or-reverse is decided by
 *  the velocity's SIGN at release — a quick 100 px flick pages, and a drag that
 *  ends moving back reverses. Only a slow release is decided by position, from
 *  the momentum-PROJECTED endpoint. Never more than one slide from where the
 *  drag began. (Projection alone was not enough: a real 120 px / 0.8 px-ms
 *  flick projected to 1.54 slides and rounded back home — measured, prod.) */
export function landingIndex({ pos, v, width, from, count }) {
  if (!(width > 0) || count < 1) return 0;
  const clamp = (i) => Math.max(0, Math.min(count - 1, i));
  if (Math.abs(v) >= FLICK_PX_S) {
    // Judged against the drag's OWN direction: moving with it commits to the
    // next slide; moving against it reverses to the slide it started on.
    const dir = Math.sign(pos - from * width) || Math.sign(v);
    return clamp(Math.sign(v) === dir ? from + dir : from);
  }
  const raw = Math.round((pos + project(v)) / width);
  return clamp(Math.max(from - 1, Math.min(from + 1, raw)));
}

/** i modulo n, always non-negative: next from the last slide is the first. */
export const wrapIndex = (i, n) => (n > 0 ? ((i % n) + n) % n : 0);

/** Pointer velocity (px/s) from a short history of {x, t}; 0 when too short. */
export function velocityOf(hist) {
  if (!hist || hist.length < 2) return 0;
  const a = hist[0];
  const b = hist[hist.length - 1];
  const dt = b.t - a.t;
  return dt > 0 ? ((b.x - a.x) / dt) * 1000 : 0;
}

const reduceMotion = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export function initHomeHero() {
  const root = document.getElementById('homeHero');
  if (!root || root.dataset.wired) return;
  root.dataset.wired = '1';

  const track = root.querySelector('.hero-track');
  const dotsBox = root.querySelector('.hero-dots');
  const pauseBtn = root.querySelector('.hero-pause');
  const slides = [...track.querySelectorAll(':scope > .hero-slide')];
  const n = slides.length;
  if (!n) return;

  root.style.setProperty('--hero-ms', `${AUTOPLAY_MS}ms`);
  dotsBox.innerHTML = slides.map((_, i) =>
    `<button type="button" class="hero-dot" data-hero-dot="${i}" aria-label="สไลด์ที่ ${i + 1} จาก ${n}"><span class="hero-dot-fill"></span></button>`,
  ).join('');
  const dots = [...dotsBox.children];

  let index = -1;
  let seeking = null;      // a programmatic scroll is under way to this slide
  let drag = null;         // a live MOUSE drag
  let suppressClick = false;
  let idleTimer = 0;
  const holds = new Set(); // every reason autoplay is held right now

  const width = () => track.clientWidth || 1;
  const nearest = () => Math.max(0, Math.min(n - 1, Math.round(track.scrollLeft / width())));

  const syncHold = () => root.toggleAttribute('data-paused', holds.size > 0);
  const hold = (why) => { holds.add(why); syncHold(); };
  const release = (why) => { holds.delete(why); syncHold(); };

  const syncStatic = () => root.classList.toggle('is-static', reduceMotion());

  function restartProgress() {
    const fill = dots[index]?.firstElementChild;
    if (!fill) return;
    fill.style.animation = 'none';
    void fill.offsetWidth; // flush, so the next line starts the bar from zero
    fill.style.animation = '';
  }

  function setIndex(i) {
    if (i === index) return;
    index = i;
    slides.forEach((s, k) => {
      const on = k === i;
      s.setAttribute('aria-hidden', on ? 'false' : 'true');
      // An off-screen slide must not take Tab focus: a focused control the
      // reader cannot see is a trap. Not `inert` — a touch that starts on the
      // half-visible neighbour mid-swipe must still scroll the track.
      s.querySelectorAll('a, button').forEach((el) => { el.tabIndex = on ? 0 : -1; });
    });
    dots.forEach((d, k) => {
      d.classList.toggle('is-active', k === i);
      if (k === i) d.setAttribute('aria-current', 'true');
      else d.removeAttribute('aria-current');
    });
    restartProgress();
  }

  function go(i, { smooth = true } = {}) {
    const target = wrapIndex(i, n);
    seeking = target;
    setIndex(target); // the dot answers on the press, not when the scroll ends
    track.scrollTo({ left: target * width(), behavior: smooth && !reduceMotion() ? 'smooth' : 'auto' });
    scheduleIdle();
  }

  function scheduleIdle() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      seeking = null;
      if (drag) return;
      track.style.scrollSnapType = '';
      setIndex(nearest());
    }, 160);
  }

  track.addEventListener('scroll', () => {
    scheduleIdle();
    if (seeking === null && !drag) setIndex(nearest());
  }, { passive: true });

  // Autoplay: the active dot's fill animation is the clock.
  dotsBox.addEventListener('animationend', (e) => {
    if (e.animationName !== 'hero-progress') return;
    if (!dots[index]?.contains(e.target)) return;
    if (holds.size || reduceMotion()) return;
    go(index + 1);
  });

  dotsBox.addEventListener('click', (e) => {
    const dot = e.target.closest('[data-hero-dot]');
    if (dot) go(Number(dot.dataset.heroDot));
  });
  root.querySelector('.hero-prev')?.addEventListener('click', () => go(index - 1));
  root.querySelector('.hero-next')?.addEventListener('click', () => go(index + 1));

  pauseBtn?.addEventListener('click', () => {
    const paused = !holds.has('user');
    if (paused) hold('user'); else release('user');
    pauseBtn.setAttribute('aria-pressed', paused ? 'true' : 'false');
    pauseBtn.setAttribute('aria-label', paused ? 'เล่นสไลด์อัตโนมัติต่อ' : 'หยุดเลื่อนสไลด์อัตโนมัติ');
    pauseBtn.querySelector('i').className = `bi ${paused ? 'bi-play-fill' : 'bi-pause-fill'}`;
  });

  root.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    if (e.target.closest('input, textarea, select')) return;
    e.preventDefault();
    go(index + (e.key === 'ArrowRight' ? 1 : -1));
  });

  // Engagement holds. Hover is a mouse-only idea; keyboard focus holds only
  // when it is VISIBLE focus — a mouse click on ▶ focuses the button, and
  // holding on that would make "play" do nothing.
  root.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') hold('hover'); });
  root.addEventListener('pointerleave', () => release('hover'));
  const focusVisible = (el) => { try { return el.matches(':focus-visible'); } catch { return false; } };
  root.addEventListener('focusin', (e) => { if (focusVisible(e.target)) hold('focus'); });
  root.addEventListener('focusout', (e) => { if (!root.contains(e.relatedTarget)) release('focus'); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) hold('hidden'); else release('hidden');
  });
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) release('offscreen'); else hold('offscreen');
    }, { threshold: 0.5 }).observe(root);
  }

  // Touch and pen: the browser scrolls. All we do is hold autoplay while a
  // finger is down, and let go when it lifts OR the browser takes it over.
  track.addEventListener('pointerdown', (e) => {
    hold('press');
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    seeking = null;
    drag = { id: e.pointerId, x0: e.clientX, s0: track.scrollLeft, from: index, moved: false,
      hist: [{ x: e.clientX, t: e.timeStamp }] };
  });

  window.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x0;
    if (!drag.moved) {
      if (Math.abs(dx) < 6) return; // a click is not a drag
      drag.moved = true;
      // Capture only now: capturing on pointerdown retargets the CLICK to the
      // track and every link in a slide would stop working.
      try { track.setPointerCapture(drag.id); } catch { /* pointer already gone */ }
      track.style.scrollSnapType = 'none'; // snap would fight a 1:1 drag
      root.classList.add('is-dragging');
    }
    track.scrollLeft = drag.s0 - dx;
    drag.hist.push({ x: e.clientX, t: e.timeStamp });
    while (drag.hist.length > 2 && e.timeStamp - drag.hist[0].t > 100) drag.hist.shift();
  });

  const endPointer = (e) => {
    release('press');
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    root.classList.remove('is-dragging');
    // A press-drag-release fast enough that the browser coalesced every move
    // away arrives as down → up with no move between. Judged by where the
    // pointer ended, not by whether a move event happened to be delivered —
    // otherwise it reads as a CLICK and opens the link under the mouse.
    if (!d.moved && e.type === 'pointerup' && Math.abs(e.clientX - d.x0) >= 6) {
      d.moved = true;
      track.scrollLeft = d.s0 - (e.clientX - d.x0);
      d.hist.push({ x: e.clientX, t: e.timeStamp });
    }
    if (!d.moved) return;
    suppressClick = true;
    setTimeout(() => { suppressClick = false; }, 0);
    // Scroll moves opposite to the pointer, so its velocity is the negative.
    const target = landingIndex({ pos: track.scrollLeft, v: -velocityOf(d.hist), width: width(), from: d.from, count: n });
    go(target); // snap is restored once the smooth scroll goes idle
  };
  window.addEventListener('pointerup', endPointer);
  window.addEventListener('pointercancel', endPointer);
  track.addEventListener('click', (e) => {
    if (!suppressClick) return;
    e.preventDefault();
    e.stopPropagation();
    suppressClick = false;
  }, true);
  track.addEventListener('dragstart', (e) => e.preventDefault());

  // A width change (rotation, a resized window) must keep the SAME slide in
  // view — a scroll offset in px means a different slide at a different width.
  if ('ResizeObserver' in window) {
    let lastW = width();
    new ResizeObserver(() => {
      const w = width();
      if (w === lastW || index < 0) return;
      lastW = w;
      seeking = index;
      track.scrollTo({ left: index * w, behavior: 'auto' });
      scheduleIdle();
    }).observe(track);
  }

  const mq = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  mq?.addEventListener?.('change', syncStatic);
  syncStatic();
  if (document.hidden) hold('hidden');
  setIndex(0);
}

/** Fill the ประกาศ slide with the newest post: its title, and its cover when it
 *  has a real one. `post` null = no posts, which leaves the slide's own copy. */
export function setHeroNews(post, cover) {
  const slide = document.getElementById('heroNewsSlide');
  if (!slide) return;
  const latest = slide.querySelector('.hero-news-latest');
  const title = slide.querySelector('.hero-news-title');
  const media = slide.querySelector('.hero-news-media');
  const img = media?.querySelector('img');
  if (!post) {
    if (latest) latest.hidden = true;
    if (media) media.hidden = true;
    return;
  }
  if (title) title.textContent = post.title || '';
  if (latest) latest.hidden = !post.title;
  if (img && cover) {
    img.onerror = () => { media.hidden = true; slide.classList.remove('has-cover'); };
    img.src = cover;
    media.hidden = false;
    slide.classList.add('has-cover');
  } else if (media) {
    media.hidden = true;
    slide.classList.remove('has-cover');
  }
}

/** The "every tool" tile that ends the rail — a tab target like any other, so
 *  it opens through the same handler and renderer as the tiles before it. */
const ALL_TOOLS_TILE = {
  slug: 'all-tools',
  kind: 'tab',
  tabId: 'pills-tools-tab',
  name: 'เครื่องมือทั้งหมด',
  desc: 'ค้นหาเครื่องมือของทุกฝ่ายในที่เดียว',
  icon: 'bi-grid-3x3-gap-fill',
  color: 'var(--ink-700)',
};

export function initHomeRail() {
  const rail = document.getElementById('homeRail');
  const track = document.getElementById('homeRailTrack');
  if (!rail || !track || rail.dataset.wired) return;
  rail.dataset.wired = '1';

  const tiles = homeRailTools().map((t) => ({ ...t, name: t.short || t.name }));
  track.innerHTML = [...tiles, ALL_TOOLS_TILE].map(renderToolCard).join('');

  const prev = rail.querySelector('.home-rail-prev');
  const next = rail.querySelector('.home-rail-next');
  const syncEdges = () => {
    const max = track.scrollWidth - track.clientWidth;
    const atStart = track.scrollLeft <= 2;
    const atEnd = track.scrollLeft >= max - 2;
    rail.classList.toggle('at-start', atStart);
    rail.classList.toggle('at-end', atEnd);
    if (prev) prev.disabled = atStart;
    if (next) next.disabled = atEnd;
  };
  const page = (dir) => track.scrollBy({
    left: dir * Math.max(160, track.clientWidth * 0.8),
    behavior: reduceMotion() ? 'auto' : 'smooth',
  });
  prev?.addEventListener('click', () => page(-1));
  next?.addEventListener('click', () => page(1));
  track.addEventListener('scroll', syncEdges, { passive: true });
  if ('ResizeObserver' in window) new ResizeObserver(syncEdges).observe(track);
  syncEdges();
}
