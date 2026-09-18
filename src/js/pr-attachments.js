// ==============================================
// PR ATTACHMENTS — the one reading of pr_tickets.file_url
// ==============================================
//
// `file_url` is a newline-joined blob written by pr-form.js, holding two
// kinds of line and nothing else:
//
//   https://drive.google.com/...        an image the form uploaded to Drive
//   ลิงก์เสริม: https://...             a link the submitter PASTED
//
// It can also be null, '-', or the legacy literal 'ไม่มีไฟล์แนบ' (9 rows
// from the Sheets import) — all meaning "nothing attached".
//
// This module exists because that reading was written TWICE — once in
// pr-staff.js (the ฝ่าย PR dashboard) and once in pr-tracking.js (what the
// submitter sees) — and the two drifted: the staff copy gated the whole
// block on `file_url.startsWith('http')`, so a ticket whose ONLY attachment
// was a pasted link (57 of 247 live tickets, 23%) rendered
// "ไม่มีไฟล์แนบ (No file)" to the staff who had to open it, while Discord
// showed the link and the submitter's own tracking page showed it too.
//
// Parsing AND the button row live here; the views pass only spacing.

import { escHtml, safeUrl } from './utils.js';

/**
 * Split a `pr_tickets.file_url` blob into the attachments it holds.
 *
 * @param {string|null|undefined} fileUrl
 * @returns {{kind:'image'|'link', url:string, index:number}[]}
 *   `index` is the 1-based position WITHIN the kind, so "ภาพที่ 2" stays
 *   correct no matter what order the lines arrive in (the array position
 *   used to supply that number, which only happened to be right because
 *   the form writes every image before the link).
 */
export function parsePrAttachments(fileUrl) {
  const raw = String(fileUrl == null ? '' : fileUrl);
  const items = [];
  let images = 0;
  let links = 0;
  raw.split('\n').forEach((line) => {
    const s = line.trim();
    if (!s) return;
    if (/^https?:\/\//i.test(s)) {
      items.push({ kind: 'image', url: s, index: ++images });
      return;
    }
    if (s.startsWith('ลิงก์เสริม:')) {
      const url = s.slice('ลิงก์เสริม:'.length).trim();
      if (url) items.push({ kind: 'link', url, index: ++links });
    }
  });
  return items;
}

/** True when a ticket carries nothing to look at. */
export function hasPrAttachments(fileUrl) {
  return parsePrAttachments(fileUrl).length > 0;
}

/**
 * Render the attachment row both PR views show. One function so the two
 * can no longer disagree about what is attached.
 *
 * @param {string|null|undefined} fileUrl
 * @param {{extraClass?: string}} [opts] extra classes for each button /
 *   the empty-state chip (the tracking card needs `mt-2` for the spacing
 *   its surrounding markup does not provide).
 * @returns {string} HTML
 */
export function renderPrAttachments(fileUrl, { extraClass = '' } = {}) {
  const items = parsePrAttachments(fileUrl);
  if (items.length === 0) {
    return `<span class="text-muted small border px-2 py-1 rounded bg-light ${extraClass} d-inline-block">`
      + '<i class="bi bi-file-earmark-x"></i> ไม่มีไฟล์แนบ (No file)</span>';
  }
  return items.map((it) => {
    const style = it.kind === 'image'
      ? { cls: 'btn-outline-primary', icon: 'bi-image', label: `ภาพที่ ${it.index}` }
      : { cls: 'btn-outline-dark', icon: 'bi-link-45deg', label: 'ลิงก์ Google Drive' };
    return `<a href="${escHtml(safeUrl(it.url))}" target="_blank" rel="noopener noreferrer"`
      + ` class="btn btn-sm ${style.cls} me-2 ${extraClass}">`
      + `<i class="bi ${style.icon}"></i> ${escHtml(style.label)}</a>`;
  }).join('');
}
