// org-sheet.js — the detail surface ภาพรวม opens when a ฝ่าย is tapped.
//
// TWO SHAPES, one element, chosen by width when it opens:
//
//   phone   a BOTTOM SHEET. Slides up from the edge, drags down to dismiss.
//   wider   a CARD that grows out of the tile that was tapped and shrinks back
//           into it on close.
//
// Both follow the same rule: a thing leaves the way it came. The card's origin
// is the tile, so the reader keeps their place on the map; the sheet's origin is
// the bottom edge, so a downward drag is the obvious way out.
//
// MOTION, and why it is CSS transitions rather than keyframes: a transition
// retargets from the CURRENT on-screen value, so closing a card mid-open, or
// letting go of a half-dragged sheet, never jumps. Keyframes restart from their
// first frame. The drag itself is 1:1 with the finger; on release the sheet
// projects where the flick was heading and either finishes the dismissal at the
// finger's speed or springs back.
//
// This module knows nothing about org data. org-chart.js hands it a title, a
// line of meta and HTML, and listens to clicks inside the body.

// The panel's curve lives in org-overview.css: cubic-bezier(0.32, 0.72, 0, 1).
// It starts at 0.72 / 0.32 = 2.25× its average speed.
// To hand a flick's velocity to the closing transition, the duration is chosen
// so that INITIAL speed equals the finger's: duration = distance × 2.25 / v.
const SPRING_START_RATIO = 0.72 / 0.32;
const OPEN_MS = 480;

let root = null;
let panel = null;
let scrim = null;
let bodyEl = null;
let titleEl = null;
let metaEl = null;
let grip = null;
let origin = null;       // the element the sheet grew out of
let state = 'closed';    // closed | open | closing
let closeTimer = 0;
let drag = null;
let bodyClick = null;
let bodyScroll = null;
let openedAt = 0;        // performance.now() at the last open — see the scrim guard

const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const isPhone = () => window.matchMedia?.('(max-width: 767.98px)').matches;

/** Exponential-decay projection — where a flick would come to rest
 *  (deceleration 0.998, the platform's normal scroll feel). */
function project(v) {
  const d = 0.998;
  return ((v / 1000) * d) / (1 - d);
}

/** The further past the edge, the less the sheet follows. */
function rubberband(over, dim) {
  const c = 0.55;
  return (over * dim * c) / (dim + c * Math.abs(over));
}

function ensure() {
  if (root) return;
  root = document.createElement('div');
  root.className = 'orgs';
  root.hidden = true;
  root.innerHTML = `
    <div class="orgs-scrim" data-orgs-close></div>
    <section class="orgs-panel" role="dialog" aria-modal="true" aria-labelledby="orgsTitle" tabindex="-1">
      <header class="orgs-head">
        <span class="orgs-grip" aria-hidden="true"></span>
        <div class="orgs-heading">
          <h2 class="orgs-title" id="orgsTitle"></h2>
          <p class="orgs-meta"></p>
        </div>
        <button type="button" class="orgs-close" data-orgs-close aria-label="ปิด">
          <i class="bi bi-x-lg" aria-hidden="true"></i>
        </button>
      </header>
      <div class="orgs-body"></div>
    </section>`;
  document.body.appendChild(root);
  panel = root.querySelector('.orgs-panel');
  scrim = root.querySelector('.orgs-scrim');
  bodyEl = root.querySelector('.orgs-body');
  titleEl = root.querySelector('.orgs-title');
  metaEl = root.querySelector('.orgs-meta');
  grip = root.querySelector('.orgs-head');

  bodyEl.addEventListener('scroll', () => { if (bodyScroll) bodyScroll(bodyEl); }, { passive: true });

  root.addEventListener('click', (e) => {
    // A DOUBLE-TAP on a tile: the first tap opens the sheet, and the scrim is
    // now on top of where the finger is, so the second tap landed on it and
    // closed what had just opened — a flash, read as "it does not work". A
    // scrim tap inside the double-tap window is that second tap, not a request
    // to leave. The ✕ button is never guarded.
    if (e.target.closest('.orgs-scrim') && performance.now() - openedAt < 400) return;
    if (e.target.closest('[data-orgs-close]')) { closeOrgSheet(); return; }
    if (bodyClick && bodyEl.contains(e.target)) bodyClick(e);
  });

  document.addEventListener('keydown', (e) => {
    if (state !== 'open') return;
    if (e.key === 'Escape') { closeOrgSheet(); return; }
    if (e.key === 'Tab') trapTab(e);
  });

  // The app routes by URL. Leaving the page must not leave a sheet over the
  // next one with the page's scroll still locked.
  window.addEventListener('popstate', () => { if (state !== 'closed') finish(); });

  wireDrag();
}

function trapTab(e) {
  const f = [...panel.querySelectorAll('button, [href], input, [tabindex]:not([tabindex="-1"])')]
    .filter((el) => !el.closest('[hidden]') && el.offsetParent !== null);
  if (!f.length) { e.preventDefault(); panel.focus(); return; }
  const first = f[0];
  const last = f[f.length - 1];
  if (e.shiftKey && (document.activeElement === first || document.activeElement === panel)) {
    e.preventDefault(); last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault(); first.focus();
  }
}

function lockScroll(on) {
  const html = document.documentElement;
  if (on) {
    // Hiding the scrollbar widens the page; pad by its width so nothing behind
    // the scrim shifts sideways.
    const gap = window.innerWidth - html.clientWidth;
    html.classList.add('orgs-lock');
    if (gap > 0) html.style.paddingRight = `${gap}px`;
  } else {
    html.classList.remove('orgs-lock');
    html.style.paddingRight = '';
  }
}

/** The transform that puts the panel exactly over `origin` — the card mode's
 *  start and end state. Uniform scale (text distorted on one axis reads as a
 *  glitch); the panel is still transparent at that size, so only its motion
 *  shows. Null when there is nothing on screen to grow from. */
function originTransform() {
  if (!origin?.isConnected) return null;
  const r = origin.getBoundingClientRect();
  if (!r.width || r.bottom < 0 || r.top > window.innerHeight) return null;
  const prev = panel.style.transform;
  panel.style.transform = 'none';
  const p = panel.getBoundingClientRect();
  panel.style.transform = prev;
  const s = Math.max(0.15, Math.min(1, r.width / p.width));
  const dx = (r.left + r.width / 2) - (p.left + p.width / 2);
  const dy = (r.top + r.height / 2) - (p.top + p.height / 2);
  return `translate(${dx}px, ${dy}px) scale(${s})`;
}

function hiddenTransform() {
  if (reduced()) return 'none';
  if (root.dataset.mode === 'sheet') return 'translateY(100%)';
  return originTransform() || 'translateY(12px) scale(0.96)';
}

/**
 * @param title  the ฝ่าย name
 * @param meta   one line under it
 * @param tint   CSS colour for the rail, or null
 * @param html   the body
 * @param from   the element tapped — the card grows from it and focus returns
 *               to it on close
 */
export function openOrgSheet({ title, meta, tint, html, from }) {
  ensure();
  clearTimeout(closeTimer);
  origin = from || document.activeElement;
  titleEl.textContent = title || '';
  metaEl.textContent = meta || '';
  metaEl.hidden = !meta;
  root.style.setProperty('--org-tint', tint || 'var(--brand-primary)');
  bodyEl.innerHTML = html;
  bodyEl.scrollTop = 0;

  // Re-opened while still closing: retarget from wherever it is now.
  const resume = state === 'closing';
  if (!resume) {
    root.dataset.mode = isPhone() ? 'sheet' : 'card';
    root.hidden = false;
    lockScroll(true);
    panel.style.transition = 'none';
    scrim.style.transition = 'none';
    panel.style.transform = hiddenTransform();
    panel.style.opacity = root.dataset.mode === 'card' ? '0' : '1';
    scrim.style.opacity = '0';
    panel.getBoundingClientRect();   // commit the start frame
  }
  panel.style.transition = '';
  scrim.style.transition = '';
  panel.style.transitionDuration = '';
  root.classList.add('is-open');
  panel.style.transform = '';
  panel.style.opacity = '';
  scrim.style.opacity = '';
  state = 'open';
  openedAt = performance.now();
  panel.focus({ preventScroll: true });
}

/** @param velocity px/s downward at release, from a drag — the closing motion
 *  starts at that speed so letting go has no seam. */
export function closeOrgSheet({ velocity = 0 } = {}) {
  if (state !== 'open') return;
  state = 'closing';
  root.classList.remove('is-open');
  const target = hiddenTransform();
  if (velocity > 0 && root.dataset.mode === 'sheet' && !reduced()) {
    // How far it has already been dragged: the panel's resting top is the
    // viewport bottom less its height.
    const cur = panel.getBoundingClientRect().top - (window.innerHeight - panel.offsetHeight);
    const left = Math.max(0, panel.offsetHeight - cur);
    const s = Math.min(0.5, Math.max(0.16, (left * SPRING_START_RATIO) / velocity));
    panel.style.transitionDuration = `${s}s, 0.2s`;
  }
  panel.style.transform = target;
  if (root.dataset.mode === 'card') panel.style.opacity = '0';
  scrim.style.opacity = '0';
  closeTimer = setTimeout(finish, OPEN_MS);
}

function finish() {
  clearTimeout(closeTimer);
  state = 'closed';
  root.classList.remove('is-open');
  root.hidden = true;
  bodyEl.innerHTML = '';
  panel.style.transform = '';
  panel.style.opacity = '';
  panel.style.transitionDuration = '';
  scrim.style.opacity = '';
  lockScroll(false);
  if (origin?.isConnected) origin.focus({ preventScroll: true });
  origin = null;
}

export function isOrgSheetOpen() { return state === 'open'; }

/** One delegated listener for the body — org-chart.js uses it for the ฝ่าย
 *  disclosures inside, which the sheet itself knows nothing about. */
export function onOrgSheetClick(fn) { bodyClick = fn; }

/** One scroll listener for the body, (bodyEl) → void — org-chart.js uses it so
 *  the jump row follows the reader. */
export function onOrgSheetScroll(fn) { bodyScroll = fn; }

// ── drag to dismiss (bottom-sheet shape only) ──────────────────────────────
//
// From the header, where nothing scrolls: the body is a scroll area, and a
// drag that might be a scroll or might be a dismissal is a guess this does not
// need to make — the header is a large, obvious target with the grip on it.
function wireDrag() {
  grip.addEventListener('pointerdown', (e) => {
    if (root.dataset.mode !== 'sheet' || state !== 'open' || e.button !== 0) return;
    if (e.target.closest('button')) return;
    drag = {
      id: e.pointerId, y0: e.clientY, h: panel.offsetHeight, dy: 0,
      pts: [{ y: e.clientY, t: e.timeStamp }],
    };
    grip.setPointerCapture(e.pointerId);
    panel.style.transition = 'none';
    scrim.style.transition = 'none';
  });

  grip.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const raw = e.clientY - drag.y0;
    drag.dy = raw >= 0 ? raw : -rubberband(-raw, drag.h);
    panel.style.transform = `translateY(${drag.dy}px)`;
    scrim.style.opacity = String(1 - Math.max(0, Math.min(1, drag.dy / drag.h)));
    drag.pts.push({ y: e.clientY, t: e.timeStamp });
    while (drag.pts.length > 2 && e.timeStamp - drag.pts[0].t > 100) drag.pts.shift();
  });

  const end = (e, cancelled) => {
    if (!drag || e.pointerId !== drag.id) return;
    const { pts, dy, h } = drag;
    drag = null;
    panel.style.transition = '';
    scrim.style.transition = '';
    const a = pts[0];
    const b = pts[pts.length - 1];
    const v = b.t > a.t ? ((b.y - a.y) / (b.t - a.t)) * 1000 : 0;
    // Decide by where the motion was HEADING, not where the finger stopped: a
    // short fast flick dismisses, a long slow drag that comes back does not.
    if (!cancelled && dy > 0 && dy + project(v) > h * 0.45) {
      closeOrgSheet({ velocity: Math.max(v, 1) });
    } else {
      panel.style.transform = '';
      scrim.style.opacity = '';
    }
  };
  grip.addEventListener('pointerup', (e) => end(e, false));
  // A cancel (the OS took the gesture) is never a dismissal.
  grip.addEventListener('pointercancel', (e) => end(e, true));
}
