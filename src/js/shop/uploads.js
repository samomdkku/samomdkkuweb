// ==============================================
// SHOP UPLOADS — Drive uploads via GAS, organised by folderPath
//
// Delegates to the `uploadShopFile` action added in appscript/prform.gs.
// Each caller passes a logical folder path under `Shop/...`; GAS
// walks/creates the nested folders lazily so the 2 TB Drive stays tidy
// enough to browse manually.
//
// Examples:
//   uploadShopFile(file, 'Shop/Slips/2026-05')
//   uploadShopFile(file, 'Shop/Products/p-rt69-tshirt')
//   uploadShopFile(file, 'Shop/QR')
// ==============================================

import { GAS_API_URL } from '../config.js';
import { postGAS } from '../gas-post.js';
import { currentAccessToken } from '../db.js';
import { convertDriveUrl } from '../uploads.js';
import { downscaleImage } from '../image-resize.js';
import { readAsDataURL } from '../read-file.js';


/**
 * Upload `file` to Drive into the nested folder `folderPath` (must start
 * with `Shop/`). Returns the Drive thumbnail URL safe to embed
 * directly in an <img>.
 *
 * @param {File} file
 * @param {string} folderPath  e.g. 'Shop/Slips/2026-05'
 * @param {{ fileName?: string, maxEdge?: number }} [opts]  override the
 *   stored filename; `maxEdge` downscales + re-encodes an image first (the
 *   extension of `fileName` is corrected to match what is actually sent)
 */
export async function uploadShopFile(file, folderPath, opts = {}) {
  if (!file) throw new Error('No file');
  if (!folderPath || typeof folderPath !== 'string') {
    throw new Error('folderPath is required');
  }
  if (!folderPath.startsWith('Shop')) {
    throw new Error('folderPath must start with Shop');
  }
  let fileName = opts.fileName || file.name;
  if (opts.maxEdge) {
    const small = await downscaleImage(file, { maxEdge: opts.maxEdge, quality: 0.85 });
    if (small !== file) {
      file = small;
      fileName = fileName.replace(/\.[^.]+$/, '') + '.' + (file.type === 'image/webp' ? 'webp' : 'jpg');
    }
  }
  const base64 = await readAsDataURL(file);
  // postGAS, not res.json(): a payment slip is the least re-creatable thing a
  // student uploads here.
  const result = await postGAS(GAS_API_URL, {
    action: 'uploadShopFile',
    folderPath,
    fileName,
    mimeType: file.type,
    fileData: base64,
  });
  if (!result.success || !result.fileUrl) {
    throw new Error(result.message || 'อัปโหลดไม่สำเร็จ');
  }
  return convertDriveUrl(result.fileUrl);
}

/** Best-effort trash of a Drive file by URL. Used when admin deletes
 *  an order to avoid orphaning the slip image in Drive. Returns true
 *  on success, false on failure (we don't want to block the order
 *  delete on a Drive blip). */
export async function deleteShopFile(fileUrl) {
  if (!fileUrl) return true;
  try {
    const result = await postGAS(GAS_API_URL, {
      action: 'deleteShopFile', fileUrl, accessToken: currentAccessToken(),
    });
    if (!result.success) {
      console.warn('[shop/uploads] deleteShopFile failed:', result.message);
      return false;
    }
    return true;
  } catch (e) {
    console.warn('[shop/uploads] deleteShopFile failed:', e);
    return false;
  }
}

/** Long edge a payment slip is stored at. A phone screenshot is ~1179x2556 PNG,
 *  2-3 MB, and base64 through Apps Script makes it ~33% bigger again — measured
 *  on 2026-09-21 as a full minute for ONE slip, long enough that "เพิ่มสลิป"
 *  read as broken. 2000px keeps every digit of a bank slip legible for the
 *  staff who check the amount, at a few hundred KB. */
export const SLIP_MAX_EDGE = 2000;

/** Build the monthly partition path for slip uploads. */
export function slipFolderForNow(now = new Date()) {
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  return `Shop/Slips/${yyyy}-${mm}`;
}
