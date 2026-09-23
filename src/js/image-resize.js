// ==============================================
// IMAGE-RESIZE — downscale + re-encode a picked File before it goes to Drive.
//
// WHY: portraits come off the camera at 4800x3200 / 2.3 MB. uploadImageToDrive()
// base64-encodes the bytes into a JSON body (Apps Script cannot take multipart),
// which inflates them by 33% — so an untouched original is a ~3.1 MB POST through
// GAS on every upload, for an image that is never displayed above ~1200px.
//
// WHAT WE KEEP: 2400px on the long edge. That is deliberately generous — it is
// 2x the largest derivative the page ever requests (a =w1200 lightbox), so the
// stored master is never the thing limiting sharpness on a retina screen. It is
// NOT what the browser downloads: lh3 resizes on its side, and a portrait card
// fetches =w520-h693-c-rw at ~38 KB regardless of how big the master is. The
// master size only costs Drive space (~600 KB each; 401 members ≈ 240 MB/year
// against a 2 TB quota) and upload time.
//
// RESAMPLING: a single drawImage() from 4800px to 2400px aliases badly in some
// browsers — it point-samples rather than averaging, which turns hair and fabric
// into noise. drawStepped() halves the image repeatedly instead, averaging 2x2
// blocks each pass, then does the last partial step exactly.
// ==============================================

const DEFAULTS = {
  maxEdge: 2400,
  // 0.9 is above the point where WebP artifacts show on skin tones and hair
  // detail — the two things a portrait is judged on.
  quality: 0.9,
  mime: 'image/webp',
};

/**
 * Decode a File into something drawable.
 *
 * NOTE createImageBitmap's `resizeWidth`/`resizeQuality` options are NOT used:
 * choosing a target needs the source dimensions, which are only known after
 * decoding, so a resize-on-decode would need a second decode to be worth it.
 * drawStepped below does the resampling instead — passing `resizeWidth:
 * undefined` (an earlier version of this file) is a no-op that reads like a
 * working fast path.
 */
export async function decode(file) {
  if (typeof createImageBitmap === 'function') {
    // `imageOrientation: 'from-image'` is NOT optional. The <img> fallback below
    // honours EXIF automatically, so without this the two paths disagree and a
    // phone photo (iOS writes orientation 6 for a portrait hold) comes out
    // sideways on browsers whose createImageBitmap default is still 'none'.
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { /* fall through */ }
    try { return await createImageBitmap(file); } catch { /* fall through */ }
  }
  const url = URL.createObjectURL(file);
  try {
    return await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('ไม่สามารถอ่านไฟล์รูปได้'));
      img.src = url;
    });
  } finally {
    // Revoking immediately is safe: the decode has already completed above.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

/** Halve repeatedly until one more halving would overshoot, then do the last
 *  step exactly. Each pass averages 2x2 pixels, which is what keeps hair and
 *  fabric from turning into noise on a 2x downscale. */
export function drawStepped(src, srcW, srcH, outW, outH) {
  let curW = srcW;
  let curH = srcH;
  let cur = src;
  while (curW / 2 >= outW && curH / 2 >= outH) {
    const half = document.createElement('canvas');
    half.width = Math.max(1, Math.round(curW / 2));
    half.height = Math.max(1, Math.round(curH / 2));
    const hctx = half.getContext('2d');
    hctx.imageSmoothingEnabled = true;
    hctx.imageSmoothingQuality = 'high';
    hctx.drawImage(cur, 0, 0, half.width, half.height);
    cur = half;
    curW = half.width;
    curH = half.height;
  }
  const out = document.createElement('canvas');
  out.width = outW;
  out.height = outH;
  const ctx = out.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(cur, 0, 0, outW, outH);
  return out;
}

/** `canvas` flattened onto white — for an encoder with no alpha channel. */
function onWhite(canvas) {
  const out = document.createElement('canvas');
  out.width = canvas.width;
  out.height = canvas.height;
  const ctx = out.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(canvas, 0, 0);
  return out;
}

function toBlob(canvas, mime, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, mime, quality));
}

/** Compute the output box. Never upscales — a small source stays its own size. */
export function fitWithin(w, h, maxEdge) {
  if (!w || !h) return { w: 0, h: 0, scaled: false };
  const long = Math.max(w, h);
  if (long <= maxEdge) return { w, h, scaled: false };
  const k = maxEdge / long;
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)), scaled: true };
}

/**
 * Downscale + re-encode an image File.
 *
 * Returns a File (so it still carries a name + type for the GAS upload). Falls
 * back to the ORIGINAL file whenever the pipeline cannot beat it — a source
 * that is already small, a browser with no WebP encoder that also fails JPEG, or
 * a re-encode that came out larger than what we started with. Never returns
 * something worse than the input.
 */
export async function downscaleImage(file, opts = {}) {
  const { maxEdge, quality, mime } = { ...DEFAULTS, ...opts };
  if (!file || !/^image\//.test(file.type)) return file;
  // Animated GIFs and SVGs lose their point when rasterised to one frame.
  if (/gif|svg/.test(file.type)) return file;

  let bmp;
  try {
    bmp = await decode(file);
  } catch {
    return file; // unreadable by canvas — let the upload try the original
  }

  const srcW = bmp.width || bmp.naturalWidth;
  const srcH = bmp.height || bmp.naturalHeight;
  const box = fitWithin(srcW, srcH, maxEdge);
  if (!box.w) { bmp.close?.(); return file; }

  // Already small AND already an efficient format: nothing to gain.
  if (!box.scaled && (file.type === mime || file.size < 300 * 1024)) {
    bmp.close?.();
    return file;
  }

  let blob = null;
  try {
    const canvas = drawStepped(bmp, srcW, srcH, box.w, box.h);
    blob = await toBlob(canvas, mime, quality);
    // An unsupported mime does NOT come back null: the spec says encode PNG
    // instead, and Safari (every iOS browser) cannot encode WebP. That PNG was
    // bigger than the photo, so the size check below kept the ORIGINAL — the
    // shop's gallery went up as 2 MB PNGs (docs/mistakes/frontend-ui.md).
    // Some old Android WebViews do return null. Either way: JPEG, on white,
    // because JPEG has no alpha and a transparent pixel would come out black.
    if (!blob || blob.type !== mime) blob = await toBlob(onWhite(canvas), 'image/jpeg', 0.92);
  } catch {
    return file;
  } finally {
    bmp.close?.();
  }

  if (!blob || blob.size >= file.size) return file;

  const ext = blob.type === 'image/webp' ? 'webp' : 'jpg';
  const base = String(file.name || 'photo').replace(/\.[^.]+$/, '') || 'photo';
  return new File([blob], `${base}.${ext}`, { type: blob.type, lastModified: Date.now() });
}
