// ==============================================
// SHOP GALLERY — a product's pictures in the product popup.
//
// docs/SHOP-GALLERY.md §4. A horizontal scroll-snap track: swiping is the
// browser's own touch scrolling, not gesture code of ours (none of the
// pointercancel bugs frontend-ui.md records). Thumbnails under it (dots on a
// narrow phone), ◀ ▶ on desktop, ← → when focused. A tap on a picture opens
// the lightbox. `galleryGoTo` is how the colour swatches jump to a colour's
// picture — they never HIDE the others (SHOP-GALLERY §1).
//
// Every picture is fetched with NO referrer: lh3 refuses a request carrying
// some Referers (measured 2026-09-22: from localhost it answers with a body
// Chrome blocks as ERR_BLOCKED_BY_ORB; from samo.md.kku.ac.th it serves). The
// passport's certificate loader does the same (lh3 throttles on Referer).
//
// Everything is rebuilt per open on nodes this render made, so no listener
// outlives its product (frontend-ui.md: one listener per re-render).
// ==============================================

import { escHtml, safeUrl } from '../utils.js';
import { pictureAt, productImages, imageAlt } from './data.js';
import { openLightbox } from './lightbox.js';

/** Above this many pictures a phone shows "3 / 12" instead of a dot each: the
 *  limit went away in 0205, and 20 dots across a phone are unreadable. */
export const DOTS_MAX = 8;

/**
 * Render the gallery for `product` into `host`, starting at picture `start`.
 * `overlayHtml` (the NEW / PREORDER / หมด ribbons) sits over the picture.
 */
export function renderGallery(host, product, { start = 0, overlayHtml = '' } = {}) {
  if (!host) return;
  const imgs = productImages(product);
  const n = imgs.length;
  host.classList.add('pg');
  host.style.background = '';

  if (!n) {
    // No picture: the product's stripe, as the card shows.
    const h = Number(product?.hue) || 220;
    host.innerHTML = `<div class="pg-stage">${overlayHtml}<div class="pg-empty"
      style="background: repeating-linear-gradient(135deg, hsl(${h} 30% 96%) 0 6px, hsl(${h} 28% 90%) 6px 12px);"></div></div>`;
    return;
  }

  // What shows while the sharp picture loads, instead of the stage's blank
  // blue: for the cover, the grid card's own picture (same URL, so already in
  // the browser's cache — the buyer just tapped it); for the others their
  // small thumbnail, so a swipe never lands on nothing.
  const placeholder = (im, i) => `background: center / cover no-repeat url('${safeUrl(pictureAt(im.url, i === 0 ? 600 : 200))}')`;
  const slide = (im, i) => `
    <button type="button" class="pg-slide" data-pg-open="${i}"
            aria-label="ดูรูปใหญ่ — ${escHtml(imageAlt(product, im, i, n))}">
      <img src="${safeUrl(pictureAt(im.url, 1200))}"
           srcset="${safeUrl(pictureAt(im.url, 600))} 600w, ${safeUrl(pictureAt(im.url, 1200))} 1200w"
           sizes="(min-width: 768px) 380px, 92vw"
           alt="${escHtml(imageAlt(product, im, i, n))}" style="${escHtml(placeholder(im, i))}"
           ${i === start ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async" draggable="false" referrerpolicy="no-referrer" />
    </button>`;

  host.innerHTML = `
    <div class="pg-stage">
      <div class="pg-track" tabindex="0" role="region" aria-roledescription="carousel"
           aria-label="รูปสินค้า ${n} รูป">${imgs.map(slide).join('')}</div>
      ${overlayHtml}
      ${n > 1 ? `
        <button type="button" class="pg-nav pg-prev" data-pg-step="-1" aria-label="รูปก่อนหน้า"><i class="bi bi-chevron-left"></i></button>
        <button type="button" class="pg-nav pg-next" data-pg-step="1" aria-label="รูปถัดไป"><i class="bi bi-chevron-right"></i></button>
        ${n > DOTS_MAX
          ? `<div class="pg-count" aria-hidden="true"><span data-pg-count>1</span> / ${n}</div>`
          : `<div class="pg-dots" aria-hidden="true">${imgs.map((_, i) => `<span data-pg-dot="${i}"></span>`).join('')}</div>`}` : ''}
      <span class="pg-zoom-hint" aria-hidden="true"><i class="bi bi-arrows-fullscreen"></i></span>
    </div>
    ${n > 1 ? `<div class="pg-thumbs">${imgs.map((im, i) => `
      <button type="button" class="pg-thumb" data-pg-go="${i}" aria-label="รูปที่ ${i + 1}">
        <img src="${safeUrl(pictureAt(im.url, 200))}" alt="" loading="lazy" decoding="async" draggable="false" referrerpolicy="no-referrer" />
      </button>`).join('')}</div>` : ''}`;

  const track = host.querySelector('.pg-track');
  const current = () => Math.round(track.scrollLeft / Math.max(1, track.clientWidth));
  const mark = () => {
    const i = current();
    host.querySelectorAll('[data-pg-go]').forEach((b) => {
      const on = Number(b.dataset.pgGo) === i;
      b.classList.toggle('is-active', on);
      if (on) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current');
    });
    host.querySelectorAll('[data-pg-dot]').forEach((d) => d.classList.toggle('is-active', Number(d.dataset.pgDot) === i));
    const count = host.querySelector('[data-pg-count]');
    if (count) count.textContent = String(i + 1);
    const prev = host.querySelector('.pg-prev');
    const next = host.querySelector('.pg-next');
    if (prev) prev.disabled = i <= 0;
    if (next) next.disabled = i >= n - 1;
  };
  let raf = 0;
  track.addEventListener('scroll', () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(mark);
  }, { passive: true });
  track.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      goTo(host, current() + (e.key === 'ArrowRight' ? 1 : -1));
    }
  });
  host.querySelector('.pg-stage').addEventListener('click', (e) => {
    const step = e.target.closest('[data-pg-step]');
    if (step) { goTo(host, current() + Number(step.dataset.pgStep)); return; }
    const opener = e.target.closest('[data-pg-open]');
    if (opener) {
      openLightbox(product, Number(opener.dataset.pgOpen), { appendTo: host.closest('.modal') || undefined });
    }
  });
  host.querySelector('.pg-thumbs')?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-pg-go]');
    if (b) goTo(host, Number(b.dataset.pgGo));
  });

  // The start picture, placed BEFORE the first frame anyone sees. The popup is
  // still hidden here (width 0), so a scroll now lands on 0; placing it on
  // Bootstrap's `shown` (the old way) came after the fade, so the buyer
  // watched the cover scroll away to their colour. A ResizeObserver fires
  // after the layout that gives the track its width and before that frame is
  // painted — the popup's first visible frame is already on the right picture.
  const place = () => { track.scrollTo({ left: start * track.clientWidth, behavior: 'instant' }); mark(); };
  if (track.clientWidth || typeof ResizeObserver !== 'function') place();
  else {
    const ro = new ResizeObserver(() => {
      if (!track.clientWidth) return;
      ro.disconnect();
      place();
    });
    ro.observe(track);
  }
  mark();
}

function goTo(host, i, { instant = false } = {}) {
  const track = host.querySelector('.pg-track');
  if (!track) return;
  const n = track.children.length;
  const to = Math.max(0, Math.min(n - 1, i));
  track.scrollTo({ left: to * track.clientWidth, behavior: instant ? 'instant' : 'smooth' });
}

/** Jump to picture `i` (used by the colour swatches). A no-op for -1. */
export function galleryGoTo(host, i, { instant = false } = {}) {
  if (i == null || i < 0) return;
  goTo(host, i, { instant });
}
