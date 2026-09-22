// ==============================================
// SHOP LIGHTBOX — tap a product picture, see it full-screen, pinch to zoom.
//
// PhotoSwipe 5, loaded with a dynamic import on the FIRST tap (CLAUDE.md:
// dynamic import only). A buyer who never taps downloads none of it. Pinch,
// double-tap zoom, pan limits, swipe between pictures and swipe-down to close
// are PhotoSwipe's — hand-written touch code is what docs/mistakes/frontend-ui.md
// keeps paying for. Design: docs/SHOP-GALLERY.md §5.
//
// The popup it opens from is a Bootstrap MODAL, which shapes three choices:
//   · appended INSIDE the modal element — outside it, the modal's focus trap
//     pulls focus back and the viewer's buttons lose the keyboard;
//   · Esc is taken at window CAPTURE while open — otherwise the modal sees the
//     same keypress and closes too, and the buyer loses the product;
//   · the phone's BACK button closes the viewer (a history entry of its own),
//     because that is what people press to leave a full-screen picture.
// ==============================================

import { pictureAt, productImages, imageAlt } from './data.js';

let pswpLoad = null;
function loadPhotoSwipe() {
  if (!pswpLoad) {
    pswpLoad = Promise.all([import('photoswipe'), import('photoswipe/style.css')])
      .then(([m]) => m.default)
      .catch((e) => { pswpLoad = null; throw e; });
  }
  return pswpLoad;
}

/** The size PhotoSwipe needs to animate without a jump. Stored at upload; a
 *  picture from before 0203 has none, so it is measured once by loading it. */
function measure(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.referrerPolicy = 'no-referrer';   // see gallery.js — lh3 and Referer
    img.onload = () => resolve({ w: img.naturalWidth || 1200, h: img.naturalHeight || 1500 });
    img.onerror = () => resolve({ w: 1200, h: 1500 });
    img.src = src;
  });
}

const ZOOM_W = 2400;
let open = null;   // the live PhotoSwipe, while one is showing

export async function openLightbox(product, index = 0, { appendTo } = {}) {
  // Claimed BEFORE any await: the chunk load and the size probe take a moment,
  // and a second tap in that window opened a second viewer (and a second
  // history entry).
  if (open) return;
  open = 'pending';
  try {
    await show(product, index, appendTo);
  } catch (e) {
    console.warn('[shop/lightbox] could not open:', e?.message || e);
    if (open === 'pending') open = null;
  }
}

async function show(product, index, appendTo) {
  const imgs = productImages(product);
  if (!imgs.length) { open = null; return; }
  const start = Math.max(0, Math.min(index, imgs.length - 1));
  let PhotoSwipe;
  try {
    PhotoSwipe = await loadPhotoSwipe();
  } catch (e) {
    // Offline or blocked: open the picture itself rather than doing nothing.
    open = null;
    console.warn('[shop/lightbox] load failed:', e?.message || e);
    window.open(pictureAt(imgs[start]?.url, ZOOM_W), '_blank', 'noopener');
    return;
  }
  // Only the picture being opened is measured up front (it is the one the
  // buyer waits for). The others open at a placeholder size and take their
  // real one when they load — measuring all of them first downloaded every
  // picture at full size before anything appeared.
  const dataSource = imgs.map((im, i) => ({
    src: pictureAt(im.url, ZOOM_W),
    width: im.w || 1600, height: im.h || 2000, _measured: !!(im.w && im.h),
    alt: imageAlt(product, im, i, imgs.length),
  }));
  if (!dataSource[start]._measured) {
    const { w, h } = await measure(dataSource[start].src);
    Object.assign(dataSource[start], { width: w, height: h, _measured: true });
  }
  // The popup it belongs to was closed while this loaded: do not open a
  // viewer inside a hidden modal, where it would still take Esc and Back.
  if (appendTo && appendTo.classList.contains('modal') && !appendTo.classList.contains('show')) {
    open = null;
    return;
  }

  const pswp = new PhotoSwipe({
    dataSource,
    index: start,
    appendToEl: appendTo || document.body,
    bgOpacity: 0.94,
    showHideAnimationType: 'fade',
    closeTitle: 'ปิด',
    zoomTitle: 'ซูม',
    arrowPrevTitle: 'รูปก่อนหน้า',
    arrowNextTitle: 'รูปถัดไป',
    errorMsg: 'โหลดรูปไม่สำเร็จ',
    indexIndicatorSep: ' / ',
  });
  open = pswp;
  // PhotoSwipe makes its own <img>; this fires before it gets a src.
  pswp.on('contentLoadImage', ({ content }) => {
    if (content?.element) content.element.referrerPolicy = 'no-referrer';
  });
  // A placeholder-sized picture takes its real size once it has loaded.
  pswp.on('loadComplete', ({ content, slide }) => {
    const d = content?.data;
    const el = content?.element;
    if (!d || d._measured || !el?.naturalWidth) return;
    d.width = el.naturalWidth; d.height = el.naturalHeight; d._measured = true;
    if (slide) pswp.refreshSlideContent(slide.index);
  });

  const onKey = (e) => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    e.preventDefault();
    pswp.close();
  };
  // Back button: a history entry of our own; back closes the viewer. Closing
  // it any other way (✕, swipe, Esc) removes that entry again.
  let closedByBack = false;
  const onPop = () => { closedByBack = true; pswp.close(); };
  const cleanup = () => {
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('popstate', onPop);
    if (!closedByBack && history.state?.samoLightbox) history.back();
    open = null;
  };
  pswp.on('destroy', cleanup);
  window.addEventListener('keydown', onKey, true);
  history.pushState({ samoLightbox: true }, '');
  window.addEventListener('popstate', onPop);
  try {
    pswp.init();
  } catch (e) {
    cleanup();       // listeners, the history entry and `open` — nothing left stuck
    throw e;
  }
}
