// ==============================================
// UPLOADS — Image upload helper (Google Drive via GAS)
//
// Why Drive (not Supabase Storage):
//   Drive gives 2 TB on the personal account that owns the prform GAS;
//   Supabase Storage free tier caps at 1 GB. For image-heavy PR
//   submissions and announcement covers, Drive is the better fit.
//
// Wire-up: the upload still uses the GAS uploadPRFile action — that
// endpoint is the only thing the GAS deployment is still used for
// (everything else now talks to Supabase directly).
// ==============================================

import { GAS_API_URL } from './config.js';
import { postGAS } from './gas-post.js';
import { downscaleImage } from './image-resize.js';
import { currentAccessToken } from './db.js';

function readAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * Upload an image File to Drive via GAS and return its public-thumbnail URL.
 *
 * The base64-via-JSON shape exists because Apps Script doesn't accept
 * multipart/form-data; we have to base64-encode the bytes into the JSON
 * body. Fine for files up to ~30 MB; bigger ones should use the manual
 * "lay your link" path on the form.
 */
export async function uploadImageToDrive(file) {
  if (!file) throw new Error('No file');
  const base64 = await readAsDataURL(file);
  // postGAS, not res.json(): Google sometimes answers /exec with an HTML page
  // instead of running the script, and this is the path a student is watching.
  const result = await postGAS(GAS_API_URL, {
    action: 'uploadPRFile',
    fileName: file.name,
    mimeType: file.type,
    fileData: base64,
  });
  if (!result.success || !result.fileUrl) {
    throw new Error(result.message || 'อัปโหลดไม่สำเร็จ');
  }
  return convertDriveUrl(result.fileUrl);
}

/** Strip the characters Drive/Finder dislike in a filename, keep Thai intact. */
function safeFileName(s, fallback) {
  const out = String(s || '')
    .replace(/[/\\?%*:|"<>#]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  return out || fallback;
}

/**
 * Upload a ทีม SAMO member portrait, filed under
 *   Team/<ปีการศึกษา>/<ฝ่าย>/<ลำดับ>-<ชื่อ-สกุล>.webp
 *
 * Two things happen before the bytes leave the browser:
 *   1. downscaleImage() caps the long edge at 2400px and re-encodes to WebP.
 *      A camera original is ~4800px / 2.3 MB, which becomes a 3.1 MB base64
 *      POST through Apps Script for an image never shown above ~1200px.
 *   2. the file gets a human-readable name. Purely so the Drive folder can be
 *      browsed by a person — the app always addresses the photo by file id.
 *
 * FALLBACK: `uploadTeamFile` is a new GAS action. Until the Apps Script project
 * is redeployed the live /exec returns "Unknown action", and we fall back to the
 * old uploadPRFile so the admin is never blocked — but we report it, because the
 * fallback silently drops the file into PR/ with no folder
 * structure, which is the exact thing this function exists to fix.
 */
export async function uploadTeamPhoto(file, { year, dept, order, name } = {}) {
  if (!file) throw new Error('No file');
  const small = await downscaleImage(file, { maxEdge: 2400, quality: 0.9 });
  const ext = small.type === 'image/webp' ? 'webp' : 'jpg';
  const seq = String(order ?? 0).padStart(2, '0');
  const fileName = `${seq}-${safeFileName(name, 'member')}.${ext}`;
  const folderPath = [
    'Team',
    safeFileName(year, 'unsorted'),
    safeFileName(dept, 'ทั่วไป'),
  ].join('/');

  const base64 = await readAsDataURL(small);
  // A JSON success:false still comes back verbatim, which the "Unknown action"
  // fallback below depends on — postGAS only retries a NON-JSON reply.
  const post = (body) => postGAS(GAS_API_URL, body);

  let result = await post({
    action: 'uploadTeamFile',
    folderPath,
    fileName,
    mimeType: small.type,
    fileData: base64,
  });

  let organised = true;
  if (!result.success && /unknown action/i.test(result.message || '')) {
    organised = false;
    result = await post({
      action: 'uploadPRFile',
      fileName,
      mimeType: small.type,
      fileData: base64,
    });
  }

  if (!result.success || !result.fileUrl) {
    throw new Error(result.message || 'อัปโหลดไม่สำเร็จ');
  }
  return { url: convertDriveUrl(result.fileUrl), organised, folderPath, fileName };
}

/**
 * Best-effort trash of a ทีม SAMO portrait in Drive.
 *
 * Mirrors `deleteShopFile` / `deleteProjectFile`; Team simply never had one, so
 * every replaced, cleared or deleted portrait stayed in Drive — publicly shared
 * — forever. Returns false rather than throwing: a Drive blip must never block
 * the database write that already succeeded.
 *
 * DO NOT call this directly on a photo the DB might still reference. Use
 * `deleteTeamPhotoIfUnused()` in `team/api.js`, which counts references first —
 * `publish_team_term` copies `photo_url` into `team_archive_members`, so a live
 * portrait and an archived year's card are the SAME Drive file.
 */
export async function deleteTeamFile(fileUrl) {
  if (!fileUrl) return true;
  try {
    // Parity with deleteShopFile / deleteProjectFile. The GAS session gate is
    // currently REVERTED (it needed an OAuth scope the owner had not granted —
    // mistakes.md), so accessToken is ignored server-side today; sending it means
    // Team is not the one endpoint that breaks if the gate is restored.
    const result = await postGAS(GAS_API_URL, {
      action: 'deleteTeamFile', fileUrl, accessToken: currentAccessToken(),
    });
    if (!result.success) {
      // Includes the "Unknown action" case while the Apps Script project is
      // still on the previous version — say so instead of failing silently.
      console.warn('[uploads] deleteTeamFile failed:', result.message);
      return false;
    }
    return true;
  } catch (e) {
    console.warn('[uploads] deleteTeamFile failed:', e);
    return false;
  }
}

/**
 * Best-effort trash of a file under `PR` in Drive.
 *
 * `uploadPRFile` is the OLDEST upload path here and was the only one with no
 * counterpart, so every announcement cover, every image pasted into an article
 * body and every replaced PR attachment stayed in Drive — shared "anyone with
 * the link" — forever. A cover swapped because the first one was wrong was
 * still publicly readable.
 *
 * Returns false rather than throwing: this always runs AFTER the database write
 * it follows, and a Drive blip must never turn a save that landed into an error
 * the user sees.
 *
 * ⚠️ Only ever call this on a URL nothing points at any more. There is no
 * server-side reference count for the PR tree (unlike portraits, which have
 * `photo_reference_count`), so the CALLER owns that check — see
 * `retirePrFiles()` in announcements.js for the pattern: diff the old set
 * against the new one and only trash what is in neither.
 */
export async function deletePRFile(fileUrl) {
  if (!fileUrl) return true;
  try {
    const result = await postGAS(GAS_API_URL, {
      action: 'deletePRFile', fileUrl, accessToken: currentAccessToken(),
    });
    if (!result.success) {
      // Includes the "Unknown action" case while the Apps Script project is
      // still on the previous version — say so instead of failing silently.
      console.warn('[uploads] deletePRFile failed:', result.message);
      return false;
    }
    return true;
  } catch (e) {
    console.warn('[uploads] deletePRFile failed:', e);
    return false;
  }
}

/**
 * Every Drive file URL an HTML fragment points at.
 *
 * An announcement body is rich text with images pasted into it, so "which files
 * does this article use" is a question about its HTML, not about a column. Both
 * URL shapes the app ever stores are matched: the `lh3.googleusercontent.com/d/<id>`
 * CDN form this app writes, and the `drive.google.com/.../<id>` viewer form that
 * older bodies and hand-pasted links still carry.
 *
 * Returns a Set of Drive FILE IDS, not URLs — the same file appears as
 * `=w1200`, `=w600` and a bare `/view` depending on when and how it was
 * inserted, and comparing URL strings would call two spellings of one file two
 * different files. That mistake deletes a picture the article still shows.
 */
export function driveIdsInHtml(html) {
  const out = new Set();
  const s = String(html || '');
  const patterns = [
    /lh3\.googleusercontent\.com\/d\/([a-zA-Z0-9_-]+)/g,
    /drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/g,
    /drive\.google\.com\/[^"'\s]*[?&]id=([a-zA-Z0-9_-]+)/g,
  ];
  for (const re of patterns) {
    let m = re.exec(s);
    while (m) { out.add(m[1]); m = re.exec(s); }
  }
  return out;
}

/** The Drive file id inside a single URL, or null. Same shapes as above. */
export function driveIdOf(url) {
  const ids = driveIdsInHtml(url);
  return ids.size === 1 ? [...ids][0] : (ids.size ? [...ids][0] : null);
}

/**
 * Drive's default share URL is the viewer page (`/file/d/<id>/view`),
 * which doesn't embed in <img>. Rewrite to a directly-embeddable URL.
 *
 * We emit the `lh3.googleusercontent.com/d/<id>=w<size>` CDN form, NOT
 * `drive.google.com/thumbnail?id=<id>` — the latter 302-redirects to
 * googleusercontent and that redirect FAILS TO LOAD on iOS Safari (iPad),
 * so ประกาศ / SAMO Shop images never appeared there. The lh3 URL is the
 * direct CDN endpoint (no redirect, correct Content-Type) and renders on
 * iOS Safari as well as desktop. `=w<size>` also caps the decoded pixels
 * (1200px is plenty for any card/banner) which keeps a grid of images
 * under iOS Safari's per-page image-memory budget. Both forms still
 * require the file to be shared "anyone with the link".
 *
 * This function is also applied at RENDER time (not just on upload), so it
 * must convert the legacy `drive.google.com/thumbnail?id=<id>&sz=...` URLs
 * already stored in the DB — hence the `?id=`/`&id=` match handles them too.
 */
export function convertDriveUrl(url, size = 1200) {
  if (!url) return url;
  // Supabase Storage URLs (from legacy rows when we briefly tried that) and
  // already-lh3 URLs pass through unchanged.
  if (url.includes('supabase.co/storage')) return url;
  if (url.includes('googleusercontent.com/d/')) return url;
  // The trailing slash on /file/d/<id>/ is optional in Drive's share URLs —
  // make it optional in the regex too. The second pattern catches
  // ?id=... / &id=... / open?id=... / uc?id=... / thumbnail?id=... forms.
  const m = url.match(/\/file\/d\/([^/?#]+)/) || url.match(/[?&]id=([^&]+)/);
  if (m && m[1]) return `https://lh3.googleusercontent.com/d/${m[1]}=w${size}`;
  return url;
}

// ============================================================
// PORTRAIT DELIVERY — lh3 option strings for the ทีม SAMO photo grid
//
// lh3 is not a dumb file host; it is an image CDN and the option suffix after
// `=` drives it. Measured against a live Drive file (a 1078x1284 source):
//
//   =w320               320px JPEG   28.6 KB
//   =w320-rw            320px WebP   16.9 KB   (-41%)
//   =w520-h694-c-rw     520x694 WebP 37.6 KB   exact 3:4, cropped server-side
//   =w1040-rw          1040px WebP   77.6 KB   what CSS-cropping to 3:4 costs
//   (no option)        1078px JPEG  208.2 KB
//
// So the two wins are `-rw` (WebP) and `-c` (crop at the CDN instead of
// downloading pixels the card throws away). A 3:2 studio portrait rendered in a
// 3:4 card discards ~45% of the frame; making Google do that crop halves the
// bytes on the single most image-heavy page in the app.
//
// `-c` crops from the CENTRE, which is why photo_focus exists: 'top'/'bottom'
// members opt out of the server crop and get CSS object-position instead,
// trading the bytes for a head that isn't sliced off.
// ============================================================

/** Extract the Drive file id, or null for anything that isn't a Drive URL. */
function driveId(url) {
  if (!url) return null;
  const m = String(url).match(/googleusercontent\.com\/d\/([^=/?#]+)/)
    || String(url).match(/\/file\/d\/([^/?#]+)/)
    || String(url).match(/[?&]id=([^&]+)/);
  return m && m[1] ? m[1] : null;
}

/** height / width of the two shapes a portrait is shown in. The big card is 3:4;
 *  the avatar in the tree is a circle, i.e. a square crop. Exported so the CSS
 *  aspect-ratio and the requested crop can be checked against one shared number. */
export const PORTRAIT_RATIO = 4 / 3;
export const AVATAR_RATIO = 1;

/**
 * `src` for one portrait at a given CSS width.
 *
 * focus 'center' (or null) → server-cropped to exactly `ratio`.
 * focus 'top' / 'bottom'   → uncropped; the caller applies object-position.
 *
 * Non-Drive URLs (a pasted link, a legacy Supabase Storage URL) pass through
 * untouched rather than getting a meaningless suffix appended.
 */
export function portraitSrc(url, width, focus = 'center', ratio = PORTRAIT_RATIO) {
  const id = driveId(url);
  if (!id) return url || '';
  const w = Math.max(1, Math.round(width));
  if (focus === 'top' || focus === 'bottom') {
    return `https://lh3.googleusercontent.com/d/${id}=w${w}-rw`;
  }
  return `https://lh3.googleusercontent.com/d/${id}=w${w}-h${Math.round(w * ratio)}-c-rw`;
}

/**
 * `srcset` for the same portrait across device pixel ratios.
 *
 * Paired with a `sizes` attribute the browser picks ONE — it does not download
 * all of them. Without this the 44px avatar in the tree would be handed the same
 * 520px file as the big card, 400 times over.
 */
export function portraitSrcSet(url, widths, focus = 'center', ratio = PORTRAIT_RATIO) {
  if (!driveId(url)) return '';
  return widths.map((w) => `${portraitSrc(url, w, focus, ratio)} ${Math.round(w)}w`).join(', ');
}

/** Full-frame, uncropped, for a click-to-enlarge view. */
export function portraitFullSrc(url, width = 1200) {
  const id = driveId(url);
  if (!id) return url || '';
  return `https://lh3.googleusercontent.com/d/${id}=w${Math.round(width)}-rw`;
}

/** photo_focus token → CSS object-position. The DB constrains the column to
 *  these three values; this map is the only thing that turns one into CSS, so a
 *  value that somehow got past the constraint still cannot reach a stylesheet. */
export function focusToObjectPosition(focus) {
  if (focus === 'top') return '50% 12%';
  if (focus === 'bottom') return '50% 85%';
  return '50% 50%';
}
