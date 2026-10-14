// ==============================================
// PROJECTS QR — per-project Drive folder QR
//
// One button per project (in the detail header) opens a Bootstrap modal
// showing a QR that encodes the project's Drive folder URL. The folder
// lives at `Projects/<projectId>_<slug>/` and already nests one
// subfolder per หนังสือ, each with its own file attachments — exactly
// the organisation a scanner expects to land on.
//
// First-time generation lazily creates the folder via GAS so a brand-
// new project (no files uploaded yet) still has a usable QR. The GAS
// action also re-asserts ANYONE_WITH_LINK view sharing on every call,
// so a folder accidentally locked down via Drive UI auto-recovers the
// next time someone generates the QR.
// ==============================================

import QRCode from 'qrcode';
import { escHtml, copyText } from '../utils.js';
import { buildProjectFolderPath, projectDriveYear } from './data.js';
import { getProjectFolderInfo } from './uploads.js';
import { cacheProjectFolder } from './api.js';

// Cache: projectId → { folderUrl, folderId } — folders are stable per
// project, so a second open of the same project's QR shouldn't re-hit
// GAS. Cleared when the page reloads (not persistent).
const folderInfoCache = new Map();

function setStatus(el, html) {
  if (el) el.innerHTML = html;
}

async function renderQrInto(el, url) {
  if (!el) return;
  // SVG so it scales crisply for both display + the download path
  // (PNG fallback for the download button is generated via toDataURL).
  const svg = await QRCode.toString(url, {
    type: 'svg',
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 240,
    color: { dark: '#0d1a14', light: '#ffffff' },
  });
  el.innerHTML = svg;
}

/** Wire the modal handlers + render the QR for `project`. Re-entrant —
 *  re-opening with a different project replaces the previous state. */
export async function showProjectQrModal(project) {
  const modalEl = document.getElementById('projectQrModal');
  if (!modalEl || !project?.id) return;
  if (!window.bootstrap) return;

  const nameEl = document.getElementById('projectQrProjectName');
  const idEl   = document.getElementById('projectQrProjectId');
  const imgEl  = document.getElementById('projectQrImage');
  const openBtn = document.getElementById('projectQrOpenBtn');
  const copyBtn = document.getElementById('projectQrCopyBtn');
  const downloadBtn = document.getElementById('projectQrDownloadBtn');

  if (nameEl) nameEl.textContent = project.name || '';
  if (idEl)   idEl.textContent   = project.id;
  if (openBtn) { openBtn.removeAttribute('href'); openBtn.setAttribute('aria-disabled', 'true'); }
  if (copyBtn) copyBtn.disabled = true;
  if (downloadBtn) downloadBtn.disabled = true;
  setStatus(imgEl, '<div class="spinner-border text-muted" role="status"></div>');

  const inst = window.bootstrap.Modal.getOrCreateInstance(modalEl);
  inst.show();

  // Resolve the folder URL with the FEWEST possible GAS calls:
  //   1. in-memory cache (this page session)
  //   2. DB-cached column on the project row (migration 0039) — survives
  //      reloads + works across devices/users with zero GAS
  //   3. GAS round-trip (first time only) → then persist to (2)
  // The Drive folder ID/URL is stable across renames, and sharing was
  // already enabled when it was first cached, so the cached paths never
  // need to re-hit GAS.
  let info = folderInfoCache.get(project.id);
  if (!info && project.drive_folder_url) {
    info = { folderUrl: project.drive_folder_url, folderId: project.drive_folder_id || null };
    folderInfoCache.set(project.id, info);
  }
  if (!info) {
    try {
      const folderPath = buildProjectFolderPath(project.id, project.name, projectDriveYear(project));
      // share:true → GAS sets ANYONE_WITH_LINK+VIEW so a scanned QR
      // resolves into a browsable folder for the recipient.
      info = await getProjectFolderInfo(folderPath, { share: true });
      folderInfoCache.set(project.id, info);
      // Persist so future opens (any device/session) skip GAS entirely.
      // Best-effort (anon customers can't write); also mirror onto the
      // in-memory project object so a re-open before the next data reload
      // hits the cached path too.
      cacheProjectFolder(project.id, info);
      project.drive_folder_url = info.folderUrl;
      project.drive_folder_id = info.folderId;
    } catch (e) {
      setStatus(imgEl, `<div class="text-danger small">${escHtml(e.message || 'หา URL โฟลเดอร์ไม่สำเร็จ')}</div>`);
      return;
    }
  }

  try {
    await renderQrInto(imgEl, info.folderUrl);
  } catch (e) {
    setStatus(imgEl, '<div class="text-danger small">สร้าง QR ไม่สำเร็จ</div>');
    console.error('[projects/qr] render failed:', e);
    return;
  }

  if (openBtn) {
    openBtn.setAttribute('href', info.folderUrl);
    openBtn.removeAttribute('aria-disabled');
  }
  if (copyBtn) {
    copyBtn.disabled = false;
    copyBtn.onclick = async () => {
      const ok = await copyText(info.folderUrl);
      const prev = copyBtn.innerHTML;
      copyBtn.innerHTML = ok
        ? '<i class="bi bi-check2 me-1"></i> คัดลอกแล้ว'
        : '<i class="bi bi-x me-1"></i> คัดลอกไม่สำเร็จ';
      setTimeout(() => { copyBtn.innerHTML = prev; }, 1500);
    };
  }
  if (downloadBtn) {
    downloadBtn.disabled = false;
    downloadBtn.onclick = async () => {
      try {
        // PNG download — phones save PNG more reliably than SVG and the
        // resolution is high enough for a clean print.
        const dataUrl = await QRCode.toDataURL(info.folderUrl, {
          errorCorrectionLevel: 'M',
          margin: 2,
          width: 512,
          color: { dark: '#0d1a14', light: '#ffffff' },
        });
        const a = document.createElement('a');
        a.href = dataUrl;
        a.download = `qr-${project.id}.png`;
        document.body.appendChild(a);
        a.click();
        a.remove();
      } catch (e) {
        console.error('[projects/qr] download failed:', e);
        alert('บันทึก QR ไม่สำเร็จ');
      }
    };
  }
}
