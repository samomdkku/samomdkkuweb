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
  if (open) return;
  const imgs = productImages(product);
  if (!imgs.length) return;
  let PhotoSwipe;
  try {
    PhotoSwipe = await loadPhotoSwipe();
  } catch (e) {
    // Offline or blocked: open the picture itself rather than doing nothing.
    console.warn('[shop/lightbox] load failed:', e?.message || e);
    window.open(pictureAt(imgs[index]?.url, ZOOM_W), '_blank', 'noopener');
    return;
  }
  const dataSource = await Promise.all(imgs.map(async (im, i) => {
    const src = pictureAt(im.url, ZOOM_W);
    const { w, h } = im.w && im.h ? { w: im.w, h: im.h } : await measure(src);
    return { src, width: w, height: h, alt: imageAlt(product, im, i, imgs.length) };
  }));

  const pswp = new PhotoSwipe({
    dataSource,
    index: Math.max(0, Math.min(index, dataSource.length - 1)),
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

  const onKey = (e) => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    e.preventDefault();
    pswp.close();
  };
  window.addEventListener('keydown', onKey, true);

  // Back button: a history entry of our own; back closes the viewer. Closing
  // it any other way (✕, swipe, Esc) removes that entry again.
  history.pushState({ samoLightbox: true }, '');
  let closedByBack = false;
  const onPop = () => { closedByBack = true; pswp.close(); };
  window.addEventListener('popstate', onPop);

  pswp.on('destroy', () => {
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('popstate', onPop);
    if (!closedByBack && history.state?.samoLightbox) history.back();
    open = null;
  });
  pswp.init();
}
