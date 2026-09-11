// ==============================================
// PROJECTS UPLOADS — Drive uploads via GAS uploadProjectFile
//
// Mirrors src/js/shop/uploads.js. Each call posts the file as base64
// to GAS with a logical folder path under `Projects/...`. GAS walks
// the path lazily, creating any missing folders.
// ==============================================

import { GAS_API_URL } from '../config.js';
import { postGAS } from '../gas-post.js';
import { currentAccessToken } from '../db.js';

function readAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = (e) => resolve(e.target.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

/**
 * Upload `file` to Drive into `folderPath` (must start with `Projects/`).
 * Returns { url, fileId, mimeType, sizeBytes }. `url` is Drive's viewer
 * URL (`/file/d/<id>/view`) — opens PDFs/images inline and prompts
 * "Open with Google Docs" for Office docs. Don't rewrite to the thumbnail
 * form here; that's only useful for images embedded via <img>.
 *
 * @param {File} file
 * @param {string} folderPath e.g. 'Projects/PRJ-K3X7_kickoff/DOC-AB2KX_project'
 * @param {{ fileName?: string }} [opts]
 */
export async function uploadProjectFile(file, folderPath, opts = {}) {
  if (!file) throw new Error('No file');
  if (!folderPath || typeof folderPath !== 'string') {
    throw new Error('folderPath is required');
  }
  if (!folderPath.startsWith('Projects')) {
    throw new Error('folderPath must start with Projects');
  }
  const base64 = await readAsDataURL(file);
  // postGAS, not res.json(): this is the หนังสือโครงการ path, where a refused
  // reply already cost three signed PDFs once (0181). An HTML page from Google
  // must not reach an อาจารย์ as a JSON syntax error.
  const result = await postGAS(GAS_API_URL, {
    action: 'uploadProjectFile',
    folderPath,
    fileName: opts.fileName || file.name,
    mimeType: file.type,
    fileData: base64,
  });
  if (!result.success || !result.fileUrl) {
    throw new Error(result.message || 'อัปโหลดไฟล์ไม่สำเร็จ');
  }
  return {
    url: result.fileUrl,
    fileId: result.fileId || null,
    mimeType: result.mimeType || file.type || null,
    sizeBytes: result.sizeBytes || file.size || null,
  };
}

/**
 * Fetch a Drive file's raw bytes (base64) by its Drive file id. Used by
 * the in-browser e-sign flow: the browser CANNOT fetch the bytes directly
 * from a Drive viewer URL (CORS), so we round-trip through GAS the same way
 * uploads do. Returns { base64, mimeType, fileName, sizeBytes }.
 *
 * `base64` is the bare base64 string (no data: prefix).
 */
export async function getProjectFileData(driveFileId) {
  if (!driveFileId) throw new Error('driveFileId is required');
  const result = await postGAS(GAS_API_URL, { action: 'getProjectFileData', fileId: driveFileId })
    .catch((e) => ({ success: false, message: e.message }));
  if (!result.success || !result.base64) {
    throw new Error(result.message || 'โหลดไฟล์จาก Drive ไม่สำเร็จ');
  }
  return {
    base64:    result.base64,
    mimeType:  result.mimeType || 'application/octet-stream',
    fileName:  result.fileName || 'file',
    sizeBytes: result.sizeBytes || null,
  };
}

/**
 * Trash a single Drive file (by viewer URL) that lives under `Projects/`.
 * Mirrors deleteShopFile in src/js/shop/uploads.js — same pattern, just
 * scoped to the Projects/ tree on the GAS side.
 *
 * Fire-and-forget by convention: the DB row is the source of truth, so
 * a Drive-side failure logs but doesn't surface. Returns true on success
 * and false on failure / missing helper.
 */
export async function deleteProjectFile(fileUrl) {
  if (!fileUrl) return true;
  try {
    const result = await postGAS(GAS_API_URL, {
      action: 'deleteProjectFile', fileUrl, accessToken: currentAccessToken(),
    });
    if (!result.success) {
      console.warn('[projects/uploads] deleteProjectFile failed:', result.message);
      return false;
    }
    return true;
  } catch (e) {
    console.warn('[projects/uploads] deleteProjectFile failed:', e);
    return false;
  }
}

/**
 * Resolve the Drive folder URL for a logical `Projects/...` path,
 * creating the folder if it doesn't exist yet. On the GAS side, the
 * walker self-renames stale folders to the current desiredName from
 * the path (by-code matching), so this call doubles as the rename
 * hook fired after a project / doc title edit.
 *
 * @param {string} folderPath e.g. `Projects/<slug>_PRJ-XXXX[/<slug>_DOC-XXXXX]`
 * @param {{ share?: boolean }} [opts] — `share:true` asks GAS to set
 *  ANYONE_WITH_LINK + VIEW on the folder (for the QR flow). Default
 *  false so the silent rename hook on edit doesn't accidentally make
 *  every renamed folder public.
 */
export async function getProjectFolderInfo(folderPath, opts = {}) {
  if (!folderPath || typeof folderPath !== 'string') {
    throw new Error('folderPath is required');
  }
  if (!folderPath.startsWith('Projects/')) {
    throw new Error('folderPath must start with Projects/');
  }
  const body = {
    action: 'getProjectFolderInfo',
    folderPath,
    share: opts.share === true,
  };
  const result = await postGAS(GAS_API_URL, body)
    .catch((e) => ({ success: false, message: e.message }));
  if (!result.success || !result.folderUrl) {
    throw new Error(result.message || 'หา URL โฟลเดอร์ไม่สำเร็จ');
  }
  return {
    folderId:   result.folderId   || null,
    folderUrl:  result.folderUrl,
    folderName: result.folderName || null,
  };
}

/**
 * Trash a folder (and everything inside) under `Projects/...` via GAS.
 * Used by the project-tracking delete flows so the Drive side doesn't
 * orphan when a โครงการ or หนังสือ is deleted in the DB.
 *
 * Fire-and-forget from the caller's perspective: a Drive failure must
 * not block the DB delete or surface a scary error to the user — the
 * row is the source of truth, and Drive Trash auto-purges after 30
 * days anyway. Caller catches and logs; this helper still throws on
 * failure so the caller can choose to log.
 */
export async function deleteProjectFolder(folderPath) {
  if (!folderPath || typeof folderPath !== 'string') {
    throw new Error('folderPath is required');
  }
  if (!folderPath.startsWith('Projects')) {
    throw new Error('folderPath must start with Projects');
  }
  const result = await postGAS(GAS_API_URL, {
    action: 'deleteProjectFolder', folderPath, accessToken: currentAccessToken(),
  }).catch((e) => ({ success: false, message: e.message }));
  if (!result.success) throw new Error(result.message || 'ลบโฟลเดอร์ใน Drive ไม่สำเร็จ');
  return result;
}
