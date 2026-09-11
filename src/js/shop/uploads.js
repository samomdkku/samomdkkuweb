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

function readAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = (e) => resolve(e.target.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

/**
 * Upload `file` to Drive into the nested folder `folderPath` (must start
 * with `Shop/`). Returns the Drive thumbnail URL safe to embed
 * directly in an <img>.
 *
 * @param {File} file
 * @param {string} folderPath  e.g. 'Shop/Slips/2026-05'
 * @param {{ fileName?: string }} [opts]  override the stored filename
 */
export async function uploadShopFile(file, folderPath, opts = {}) {
  if (!file) throw new Error('No file');
  if (!folderPath || typeof folderPath !== 'string') {
    throw new Error('folderPath is required');
  }
  if (!folderPath.startsWith('Shop')) {
    throw new Error('folderPath must start with Shop');
  }
  const base64 = await readAsDataURL(file);
  // postGAS, not res.json(): a payment slip is the least re-creatable thing a
  // student uploads here.
  const result = await postGAS(GAS_API_URL, {
    action: 'uploadShopFile',
    folderPath,
    fileName: opts.fileName || file.name,
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

/** Build the monthly partition path for slip uploads. */
export function slipFolderForNow(now = new Date()) {
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  return `Shop/Slips/${yyyy}-${mm}`;
}
