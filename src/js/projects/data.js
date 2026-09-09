// ==============================================
// PROJECTS DATA — constants + pure helpers
//
// No DOM, no fetch — lookup tables, status metadata, id generators,
// formatters used across the module. Safe to unit-test.
// ==============================================

export const PROJECT_STATUSES = ['open', 'in_progress', 'completed', 'cancelled'];

export const PROJECT_STATUS_META = {
  open:         { label: 'เปิดรับ',       cls: 'is-open',     icon: 'bi-folder2-open' },
  in_progress:  { label: 'กำลังดำเนินการ', cls: 'is-progress', icon: 'bi-arrow-repeat' },
  completed:    { label: 'เสร็จสิ้น',     cls: 'is-done',     icon: 'bi-check-circle' },
  cancelled:    { label: 'ยกเลิก',        cls: 'is-cancel',   icon: 'bi-x-circle' },
};

// Doc statuses — ordered for the 4-step progress visualisation.
// 'returned' is off-path (handled separately in UI).
export const DOC_PATH_ORDER = ['sent', 'received', 'in_progress', 'completed'];

export const DOC_STATUS_META = {
  draft:       { label: 'ฉบับร่าง',         cls: 'is-draft',    icon: 'bi-pencil' },
  sent:        { label: 'ส่งแล้ว',          cls: 'is-sent',     icon: 'bi-send' },
  received:    { label: 'รับเรื่องแล้ว',    cls: 'is-received', icon: 'bi-inbox' },
  in_progress: { label: 'กำลังดำเนินการ',  cls: 'is-progress', icon: 'bi-arrow-repeat' },
  returned:    { label: 'ส่งกลับเพื่อแก้ไข', cls: 'is-returned', icon: 'bi-arrow-counterclockwise' },
  completed:   { label: 'เสร็จสิ้น',        cls: 'is-completed', icon: 'bi-check-circle' },
};

// Professor signing-request statuses (sastaff → saprof).
export const SIGN_STATUS_META = {
  pending:  { label: 'รอลงนาม',   cls: 'is-pending',  icon: 'bi-hourglass-split' },
  // "accepted" is an APPROVAL, and attaching a signed file is optional
  // (inbox.js onSignAcceptClick). Labelling it ลงนามแล้ว claimed a signature
  // that may not exist — three หนังสือ shipped อนุมัติแล้ว with an unsigned PDF
  // and nothing downstream had a reason to look. Whether a signature EXISTS is
  // a per-file fact, so the request-level chip states only what it knows.
  accepted: { label: 'อนุมัติแล้ว', cls: 'is-accepted', icon: 'bi-patch-check' },
  rejected: { label: 'ปฏิเสธ',    cls: 'is-rejected', icon: 'bi-x-octagon' },
};

export const NOTIFY_KIND_META = {
  sent:           { icon: 'bi-send',                   cls: 'is-info' },
  // bi-send-arrow-up-fill landed after 1.10.5 so it renders as empty in
  // the offcanvas — use bi-arrow-clockwise (round-trip / redo) which has
  // been in bootstrap-icons since 1.0 and reads cleanly as "sent again".
  resent:         { icon: 'bi-arrow-clockwise',        cls: 'is-warn' },
  received:       { icon: 'bi-inbox',                  cls: 'is-info' },
  status:         { icon: 'bi-arrow-repeat',           cls: 'is-info' },
  returned:       { icon: 'bi-arrow-counterclockwise', cls: 'is-warn' },
  comment:        { icon: 'bi-chat-left-text',         cls: 'is-info' },
  file_added:     { icon: 'bi-cloud-plus-fill',        cls: 'is-info' },
  file_replaced:  { icon: 'bi-arrow-repeat',           cls: 'is-info' },
  file_deleted:   { icon: 'bi-trash',                  cls: 'is-warn' },
  completed:      { icon: 'bi-check-circle',           cls: 'is-ok' },
  // Professor signing workflow
  sign_requested: { icon: 'bi-pen',                    cls: 'is-info' },
  sign_accepted:  { icon: 'bi-patch-check',            cls: 'is-ok' },
  sign_rejected:  { icon: 'bi-x-octagon',              cls: 'is-warn' },
};

// ---- Formatters ----

const THAI_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
                     'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

export function fmtDate(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '-';
  return `${d.getDate()} ${THAI_MONTHS[d.getMonth()]} ${((d.getFullYear() + 543)).toString().slice(-2)}`;
}

export function fmtDateTime(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '-';
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${fmtDate(iso)} · ${hh}:${mm}`;
}

export function fmtRelative(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '-';
  const diff = Date.now() - d.getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 60)     return 'เมื่อสักครู่';
  if (sec < 3600)   return `${Math.floor(sec / 60)} นาทีที่แล้ว`;
  if (sec < 86400)  return `${Math.floor(sec / 3600)} ชั่วโมงที่แล้ว`;
  if (sec < 604800) return `${Math.floor(sec / 86400)} วันที่แล้ว`;
  return fmtDate(iso);
}

export function fmtBytes(n) {
  const b = Number(n) || 0;
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(1)} MB`;
  return `${(b / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

// ---- ID generators ----

// Short alphanumeric tail — base36 uppercase, no length/timestamp padding.
// Trades the embedded creation date (which lived in the old `PRJ-YYMM-…`
// / `DOC-YYMMDD-HHMM-…` formats) for a much shorter, easier-to-recognise
// code. Created-at lives on the row already; the ID exists only for
// human reference and copy-paste, so date inside it was redundant. DB
// uniqueness is enforced via the primary key + the retry loop in
// api.js createProject / createDocument.
function randAlnum(len) {
  let out = '';
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 32 chars, no 0/O/1/I/L
  for (let i = 0; i < len; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

/** PRJ-XXXX (4-char alphanumeric tail). */
export function genProjectId() {
  return `PRJ-${randAlnum(4)}`;
}

/** DOC-XXXXX (5-char alphanumeric tail). */
export function genDocumentId() {
  return `DOC-${randAlnum(5)}`;
}

/** SGN-XXXXX (5-char alphanumeric tail) — professor signing request. */
export function genSignRequestId() {
  return `SGN-${randAlnum(5)}`;
}

/** Slug for Drive folder names — keeps Thai Unicode, strips other chars. */
export function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9฀-๿]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'item';
}

/** Build a logical Drive path for a document folder. The path uses the
 *  HUMAN-READABLE NAME first, then the code as a suffix — matches the
 *  user's "ชื่อโครงการ_PRJ-XXXX / ชื่อหนังสือ_DOC-XXXXX" expectation.
 *
 *  GAS walks these paths via a by-code match (not by exact name), so a
 *  folder created with a stale name still resolves and auto-renames to
 *  the current desiredName. That means a project / doc rename in the
 *  app propagates to Drive on the next upload, QR, or rename hook,
 *  even though the path string itself is regenerated from scratch
 *  every time. Callers therefore pass CURRENT names, not whatever was
 *  stored on `doc.drive_folder` historically. */
export function buildDocFolderPath(projectId, projectName, documentId, docTitle) {
  const projectSeg = `${slugify(projectName)}_${projectId}`;
  const docSeg = `${slugify(docTitle)}_${documentId}`;
  return `Projects/${projectSeg}/${docSeg}`;
}

/** Build a logical Drive path for a project's top-level folder. Same
 *  name-first / code-suffix convention as buildDocFolderPath. */
export function buildProjectFolderPath(projectId, projectName) {
  return `Projects/${slugify(projectName)}_${projectId}`;
}
