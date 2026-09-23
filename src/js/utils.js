// ==============================================
// UTILS — Shared Helper Functions
// ==============================================

const THAI_DIGITS = '๐๑๒๓๔๕๖๗๘๙';

/**
 * Thai numerals → Arabic. Someone WILL paste `๕` or `๐๑๗`, and a silent reject
 * there looks like the field refusing a perfectly good answer.
 *
 * Lives here because it had grown three copies — team/fields.js (รหัสนักศึกษา,
 * ชั้นปี), house/fields.js (สายรหัส) and study-year.js — for one four-line rule.
 * Three copies of a rule is how this repo's most expensive bug class starts;
 * a fourth was the moment to stop.
 */
export function arabicDigits(s) {
  return String(s ?? '').replace(/[๐-๙]/g, (d) => String(THAI_DIGITS.indexOf(d)));
}

/**
 * Format a date value to Thai-style dd/MM/yyyy HH:mm:ss
 * Returns the input as-is if it's already formatted or unparseable.
 */
export function formatThaiDate(dateVal) {
  if (!dateVal) return '-';
  if (typeof dateVal === 'string' && dateVal.includes('/')) return dateVal;
  try {
    const d = new Date(dateVal);
    if (isNaN(d.getTime())) return String(dateVal);
    const pad = (n) => n.toString().padStart(2, '0');
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  } catch (e) {
    return String(dateVal);
  }
}

// ==============================================
// VS remark visibility ladder (migration 0096)
// ==============================================
// Each remark entry carries a `vis` naming the widest audience that may read
// it. The rungs are ordered — each includes the one above it:
//
//   staff  → เจ้าหน้าที่ only            (what `internal: true` used to mean)
//   ticket → + this ticket's submitter   ← the default for a plain remark
//   thread → + every submitter in the duplicate group
//   public → + the public board (anyone, signed in or not)
//
// This is a MIRROR of public.vs_remark_vis() in 0096 — the server is the
// boundary (a submitter cannot write anything above `ticket`; the
// vs_tickets_self_update_guard trigger rejects it). Keep the two in step.

export const VS_REMARK_VIS = {
  staff:  { label: 'เฉพาะเจ้าหน้าที่',       short: 'เจ้าหน้าที่', icon: 'bi-lock-fill' },
  ticket: { label: 'ผู้แจ้งเรื่องนี้',        short: 'ผู้แจ้ง',     icon: 'bi-person-fill' },
  thread: { label: 'ทุกคนในกลุ่มเรื่องซ้ำ',   short: 'กลุ่มเรื่องซ้ำ', icon: 'bi-diagram-3-fill' },
  public: { label: 'สาธารณะ (กระดานปัญหา)',  short: 'สาธารณะ',    icon: 'bi-megaphone-fill' },
};

// The truthy set for the legacy `internal` flag. Must match public.vs_remark_vis(),
// which compares `lower(e ->> 'internal')` against exactly these — jsonb `->>`
// stringifies, so a numeric 1 arrives as '1'. A differential test over both
// implementations lives in tools/vs-remark-vis-mirror.mjs; it caught 't' / '1'
// / 1 being accepted by the SQL and rejected here.
const LEGACY_INTERNAL_TRUE = ['true', 't', '1'];

/** Normalize any remark entry — legacy or 0096-era — to one ladder rung.
 *  Legacy `internal: true` reads as 'staff'; a missing `vis` reads as
 *  'ticket'. Never throws on a malformed value (the array is client-written). */
export function remarkVis(rem) {
  const v = rem && rem.vis;
  if (v === 'staff' || v === 'ticket' || v === 'thread' || v === 'public') return v;
  const legacy = rem && rem.internal;
  if (legacy === true) return 'staff';
  if (legacy != null && LEGACY_INTERNAL_TRUE.includes(String(legacy).toLowerCase())) return 'staff';
  return 'ticket';
}

/**
 * Render a timeline of remarks/logs into a container element.
 * @param {string} containerId - DOM element ID for the timeline container
 * @param {Array} remarks - Array of remark objects {type, by, time, text, vis?, from_thread?}
 * @param {string} ticketDate - Date string of ticket creation
 * @param {{showVis?: boolean}} [opts] - showVis: label each entry's audience
 *        (staff views only — a submitter must not be told a note was withheld).
 */
export function renderTimeline(containerId, remarks, ticketDate, opts = {}) {
  const container = document.getElementById(containerId);
  container.innerHTML = '';

  // Initial ticket creation entry
  container.insertAdjacentHTML('beforeend', `
    <div class="mb-4 position-relative">
      <span class="position-absolute top-0 start-0 translate-middle p-2 bg-pink-custom border border-light rounded-circle" style="left:-1.5rem!important; background-color:var(--pink-500)!important;"></span>
      <div class="text-muted small">${ticketDate}</div>
      <div class="fw-bold">ระบบ</div>
      <div class="tl-log rounded p-2 mt-1 small">📨 สร้าง Ticket เรียบร้อย — รอผู้ดูแลรับเรื่อง</div>
    </div>
  `);

  if (!remarks || remarks.length === 0) return;

  remarks.forEach((rem) => {
    const isUser = rem.by === 'ผู้แจ้งปัญหา' || rem.by === 'User' || rem.by === 'ผู้ส่งงาน';
    const isLog = rem.type === 'log';
    // Legacy VS remarks stored the staff dashboard's internal "all depts"
    // filter value as the actor ("__all__"). Render it as a human label;
    // new writes use a real actor label (vs-staff staffActorLabel).
    const by = rem.by === '__all__' ? 'เจ้าหน้าที่' : rem.by;

    const dotColor = isLog ? '#94a3b8' : isUser ? '#22c55e' : '#3b82f6';
    const boxClass = isLog ? 'tl-log' : isUser ? 'tl-remark-user' : 'tl-remark-staff';
    const icon = isLog ? '🔧' : isUser ? '💬' : '📝';
    // Escape rem.by / rem.text — both come from user input (staff or
    // submitter typing into remark/comment textareas) and end up in
    // innerHTML.
    const label = isLog
      ? `<span class="badge bg-secondary fw-normal">${escHtml(by)}</span>`
      : `<span class="fw-bold">${escHtml(by)}</span>`;

    // 0096 — provenance + audience chips.
    // `from_thread` is set by vs_thread_remarks(): the note was written on a
    // SIBLING ticket in this duplicate group. Say so, or a submitter reads a
    // note about someone else's report as being about theirs.
    const vis = remarkVis(rem);
    const meta = VS_REMARK_VIS[vis];
    const threadChip = rem.from_thread
      ? '<span class="tl-chip is-thread"><i class="bi bi-diagram-3 me-1"></i>จากเรื่องที่เกี่ยวข้อง</span>'
      : '';
    // Audience chip is staff-only: telling a submitter "this one is
    // เฉพาะเจ้าหน้าที่" would advertise the existence of notes they can't read.
    const visChip = opts.showVis && meta
      ? `<span class="tl-chip is-vis-${vis}"><i class="bi ${meta.icon} me-1"></i>${escHtml(meta.short)}</span>`
      : '';

    container.insertAdjacentHTML('beforeend', `
      <div class="mb-4 position-relative">
        <span class="position-absolute top-0 start-0 translate-middle p-2 border border-light rounded-circle" style="left:-1.5rem!important; background-color:${dotColor}!important;"></span>
        <div class="text-muted small">${escHtml(rem.time)}</div>
        <div>${label}${threadChip}${visChip}</div>
        <div class="${boxClass} rounded p-2 mt-1 small">${icon} ${escHtml(rem.text)}</div>
      </div>
    `);
  });
}

/**
 * Decode a Google Identity Services JWT token to extract the payload.
 * Throws a descriptive error rather than the cryptic indexing crashes
 * the naïve implementation gave on malformed input.
 */
export function decodeJwtResponse(token) {
  if (typeof token !== 'string') throw new Error('JWT must be a string');
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Malformed JWT (expected 3 segments)');
  try {
    let base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    base64 += Array((4 - (base64.length % 4)) % 4 + 1).join('=');
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
    return JSON.parse(jsonPayload);
  } catch (e) {
    throw new Error('JWT decode failed: ' + (e.message || e));
  }
}

/**
 * Escape user-supplied strings before interpolation into innerHTML.
 * Use for non-content fields (title, department, snippet) where the
 * value is plain text. Don't use for Quill-produced HTML content.
 */
export function escHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Convert stored rich-text/HTML into clean plain text for snippets.
 * Strips tags AND decodes the common entities Quill/paste leaves behind —
 * a bare tag-strip keeps `&nbsp;` etc. as literal text, which then shows
 * verbatim after escHtml ("อยากให้หอแพทย์ 4&nbsp;&nbsp;เอาขนม…").
 * Collapses whitespace. Pass `max` to truncate with a real ellipsis
 * instead of a mid-word hard cut.
 */
export function stripHtmlToText(html, max) {
  let s = String(html == null ? '' : html)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => {
      const code = Number(n);
      return Number.isFinite(code) && code > 0 && code < 0x110000
        ? String.fromCodePoint(code) : ' ';
    })
    .replace(/\s+/g, ' ')
    .trim();
  if (max && s.length > max) s = `${s.slice(0, max).trimEnd()}…`;
  return s;
}

/**
 * Sanitize a URL for an href/src attribute or a CSS url('…'). Only allows
 * http(s), mailto, and tel schemes; returns '#' for anything else
 * (javascript:, data:, …).
 *
 * The result is SAFE TO INTERPOLATE BARE: the characters that can end an
 * attribute or a CSS string (quotes, <, >, backtick, whitespace, backslash)
 * are percent-encoded, which keeps the URL valid. This used to be a comment
 * saying "always pair with escHtml()" — 27 call sites did not, and a slip URL
 * is buyer-writable, so `https://x/"onerror="…` would have run in an admin's
 * browser (2026-09-22). Wrapping it in escHtml() as well is still harmless:
 * nothing it leaves is something escHtml changes except `&`, which the
 * browser decodes back.
 */
export function safeUrl(s) {
  const u = String(s == null ? '' : s).trim();
  if (/^https?:\/\//i.test(u) || /^mailto:/i.test(u) || /^tel:/i.test(u)) {
    // encodeURIComponent for correct UTF-8 (\s also matches U+00A0 / U+3000,
    // which a hand-built %XX got wrong); it leaves `'` alone, so that one is
    // spelled out.
    return u.replace(/["'<>`\s\\]/g,
      (c) => (c === "'" ? '%27' : encodeURIComponent(c)));
  }
  return '#';
}

/** Copy text to the clipboard. Returns true on success.
 *  Falls back to a hidden textarea trick if Clipboard API is unavailable
 *  (older mobile browsers, file:// pages). */
export async function copyText(text) {
  const value = String(text == null ? '' : text);
  if (!value) return false;
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch { /* fall through */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = value;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/** Render an order-id chip: monospaced code + a clipboard-copy button.
 *  Used in shop customer + admin views. Pairs with the global delegated
 *  `[data-copy]` handler set up in main.js / admin-main.js. */
export function orderIdChipHtml(id) {
  const safe = escHtml(id || '—');
  return `<span class="order-id-chip">
    <code>${safe}</code>
    <button type="button" class="btn btn-link btn-sm p-0 ms-1 order-id-copy"
            data-copy="${safe}" title="คัดลอกรหัสคำสั่งซื้อ" aria-label="คัดลอกรหัสคำสั่งซื้อ">
      <i class="bi bi-clipboard"></i>
    </button>
  </span>`;
}

// ---------------------------------------------------------------------------
// CSV FORMULA GUARD — one rule for every export (shop, ทีม SAMO, ระบบบ้าน).
//
// A cell that starts with = + - @ (or a tab / CR) is run as a FORMULA when the
// file is opened in Excel or Sheets, and several exported fields are typed by
// students themselves (ชื่อเล่น, bio, names). A leading apostrophe makes the
// spreadsheet show it as text. A plain number (`-1`, a year_offset) cannot be
// a formula and is left alone. The ทีม SAMO / ระบบบ้าน files are ROUND-TRIPPED
// (export → edit → import), so parseCsv takes the apostrophe off again with
// csvUnguard — or every re-import would store it.
// ---------------------------------------------------------------------------
const CSV_FORMULA_START = /^[=+\-@\t\r]/;
const CSV_PLAIN_NUMBER = /^[-+]?\d+(\.\d+)?$/;
export function csvGuard(v) {
  const s = v == null ? '' : String(v);
  return CSV_FORMULA_START.test(s) && !CSV_PLAIN_NUMBER.test(s) ? `'${s}` : s;
}
export function csvUnguard(s) {
  const t = String(s ?? '');
  return t.startsWith("'") && CSV_FORMULA_START.test(t.slice(1)) && !CSV_PLAIN_NUMBER.test(t.slice(1)) ? t.slice(1) : t;
}
