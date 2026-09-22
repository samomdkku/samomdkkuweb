// ============================================================
// dept-page-admin.js — the screen where a ฝ่าย edits its OWN page.
//
// THE POINT OF IT. Before 0177, ฝ่าย page content was a hardcoded object and
// every change was a commit plus a deploy by the owner. This is the half that
// removes the owner from that loop: the ฝ่าย adds a card or writes HTML, saves,
// and the page is live. No branch, no pull request, no deploy.
//
// WHAT IT DOES NOT DECIDE. Which ฝ่าย you may edit is not a question this file
// answers — `current_user_dept_page_scope()` does, in the database, and RLS
// enforces it on every write. The picker below is populated from the same
// scope, so the UI cannot offer a ฝ่าย the database would refuse. That
// direction matters: UNDER-showing relative to RLS is safe, the reverse is a
// button that throws.
//
// ⛔ HTML IS NEVER PREVIEWED WITH innerHTML. The preview is the same sandboxed
// srcdoc frame the live page uses (dept-content.js), so what the editor sees is
// what a visitor sees, under the same isolation. Rendering the draft into the
// admin DOM "just to preview it" would hand the whole admin session to whatever
// the editor pasted — and it is the natural shortcut, which is why it is
// called out here and guarded in dept-content.test.js.
// ============================================================

import { dbRest } from './db.js';
import { escHtml } from './utils.js';
import { DEPT_OPTIONS, deptLabel } from '../data/depts.js';
import { renderDeptContent, watchDeptHtmlHeights } from './dept-content.js';
import { restErrorMessage } from './rest-error.js';
import { uploadImageToDrive } from './uploads.js';
import { downscaleImage } from './image-resize.js';
// The SAME cleanup ทีม SAMO and ข้อมูลของฉัน use, not a second implementation.
// `photo_reference_count()` already counts dept_content.cover_url and
// .video_url — migration 0178 added them the day ฝ่าย covers shipped — so it
// answers correctly for these two columns without any further change.
import { deleteTeamPhotoIfUnused, photoToRetire } from './team/api.js';
// The visual editor (the spike). This import is the small wrapper; GrapesJS
// itself is loaded inside it, on first open, so it never enters a bundle
// anybody downloads before pressing the button.
import { openVisualEditor } from './dept-visual-editor.js';
import { holdInMemory } from './read-file.js';

/** One Thai sentence for a failed call. `restErrorMessage` takes the RAW
 *  response, not the parsed object dbRest hands back, so the unwrapping happens
 *  here rather than four times at the call sites — and the raw JSON body never
 *  reaches a person, which is the rule rest-error.js exists to hold.  */
const errMsg = (error, fallback) =>
  `${fallback}: ${restErrorMessage(error?.status ?? 0, error?.raw || '')}`;

const SELECT = 'id,dept,kind,position,visible,title,eyebrow,description,href,'
  + 'cover_url,video_url,cta,html,updated_at';

let state = { dept: null, rows: [], busy: false };

/** The ฝ่าย this account may edit. `null` scope (every ฝ่าย) is the blanket
 *  grant; otherwise exactly the granted list, in the site's own page order. */
export function editableDepts(user) {
  if (!user) return [];
  const blanket = user.role === 'dev' || user.role === 'vp_admin'
    || (user.permissions || []).includes('master')
    || (user.managedPermissions || []).includes('master')
    || (user.permissions || []).includes('dept_pages')
    || (user.managedPermissions || []).includes('dept_pages');
  if (blanket) return DEPT_OPTIONS.slice();
  const mine = new Set(user.managedDeptPages || []);
  return DEPT_OPTIONS.filter((d) => mine.has(d.value));
}

async function load(dept) {
  const { data, error } = await dbRest(
    `/dept_content?dept=eq.${encodeURIComponent(dept)}&select=${SELECT}&order=position.asc,created_at.asc`);
  if (error) return { rows: [], error };
  return { rows: Array.isArray(data) ? data : [], error: null };
}

/**
 * What each kind is CALLED and how its chip looks, in one place (0179).
 *
 * Named for what a ฝ่าย sees on the page, not for the value in the column:
 * "หัวข้อ", not "section". The chip colour is the only thing that makes a list
 * of twenty rows scannable, which is the job Moodle's per-type icons do on the
 * page the owner pointed at.
 *
 * ⛔ A kind missing from here still renders — `KIND_META[r.kind] ?? CARD` — so
 * adding a kind to the DDL and forgetting this file gives a mislabelled row,
 * never a broken editor. dept-content.test.js fails if the two lists disagree.
 */
export const KIND_META = {
  section: { label: 'หัวข้อ',   icon: 'bi-type-h2',        cls: 'dpa-kind--section' },
  card:    { label: 'การ์ด',    icon: 'bi-card-heading',   cls: 'dpa-kind--card' },
  text:    { label: 'ข้อความ',  icon: 'bi-text-paragraph', cls: 'dpa-kind--text' },
  html:    { label: 'HTML',     icon: 'bi-code-slash',     cls: 'dpa-kind--html' },
};

function rowEditor(r) {
  const meta = KIND_META[r.kind] || KIND_META.card;
  return `
  <div class="dpa-row${r.visible === false ? ' dpa-hidden' : ''}" data-dpa-row="${escHtml(r.id)}">
    <div class="dpa-row-head">
      <span class="dpa-kind ${meta.cls}"><i class="bi ${meta.icon}"></i> ${escHtml(meta.label)}</span>
      <!-- The badge already says HTML, so repeating it in the title read
           "HTML บล็อก HTML" on screen. An html row shows its own title if the
           ฝ่าย gave it one, and otherwise nothing. -->
      <span class="dpa-title">${escHtml(r.title || '')}</span>
      <!-- Hidden is now the state a row is BORN in, so it cannot be signalled by
           opacity and a button label alone — a ฝ่าย who adds a card, does not
           find it in the preview beside them, and has no word for why, concludes
           the feature is broken. Say it. -->
      ${r.visible === false ? '<span class="dpa-draft">ยังไม่แสดง</span>' : ''}
      <span class="dpa-spacer"></span>
      <button type="button" class="btn btn-sm btn-outline-secondary" data-dpa-move="up"   title="เลื่อนขึ้น"><i class="bi bi-arrow-up"></i></button>
      <button type="button" class="btn btn-sm btn-outline-secondary" data-dpa-move="down" title="เลื่อนลง"><i class="bi bi-arrow-down"></i></button>
      <button type="button" class="btn btn-sm btn-outline-secondary" data-dpa-toggle>${r.visible === false ? 'แสดง' : 'ซ่อน'}</button>
      <button type="button" class="btn btn-sm btn-outline-danger" data-dpa-delete>ลบ</button>
    </div>
    ${r.kind === 'section' ? `
      <div class="row g-2 mt-1">
        <div class="col-12"><label class="form-label small">หัวข้อกลุ่ม</label>
          <input class="form-control" data-dpa-field="title" value="${escHtml(r.title || '')}" placeholder="เช่น คู่มือสำหรับน้องปี 1"></div>
        <div class="col-12"><label class="form-label small">คำอธิบายใต้หัวข้อ (ไม่ใส่ก็ได้)</label>
          <input class="form-control" data-dpa-field="description" value="${escHtml(r.description || '')}"></div>
      </div>
      <p class="form-text">ทุกอย่างที่อยู่ใต้หัวข้อนี้จะถูกจัดเป็นกลุ่มเดียวกัน จนกว่าจะเจอหัวข้อถัดไป</p>`
    : r.kind === 'text' ? `
      <label class="form-label small mt-2">ข้อความ</label>
      <textarea class="form-control" rows="4" data-dpa-field="description"
        placeholder="พิมพ์ได้เลย ขึ้นบรรทัดใหม่ได้">${escHtml(r.description || '')}</textarea>
      <p class="form-text">ขึ้นบรรทัดใหม่ได้ตามที่พิมพ์ ไม่ต้องใส่แท็ก HTML</p>`
    : r.kind === 'html' ? `
      <div class="d-flex align-items-center gap-2 mt-2">
        <label class="form-label small mb-0">HTML ของฝ่าย</label>
        <span class="flex-grow-1"></span>
        <button type="button" class="btn btn-sm btn-primary" data-dpa-visual>
          <i class="bi bi-columns-gap"></i> แก้แบบเห็นภาพ
        </button>
      </div>
      <textarea class="form-control font-monospace dpa-html" rows="10" data-dpa-field="html">${escHtml(r.html || '')}</textarea>
      <p class="form-text">
        เขียน HTML/CSS/JavaScript ได้ตามต้องการ หน้านี้ถูกกันออกจากระบบหลัก
        จึงอ่านข้อมูลผู้ใช้หรือฐานข้อมูลไม่ได้ และใช้ localStorage ไม่ได้
      </p>` : `
      <div class="row g-2 mt-1">
        <div class="col-12 col-md-3"><label class="form-label small">ป้ายเล็ก</label>
          <input class="form-control" data-dpa-field="eyebrow" value="${escHtml(r.eyebrow || '')}" placeholder="Guidebook"></div>
        <div class="col-12 col-md-9"><label class="form-label small">หัวข้อ</label>
          <input class="form-control" data-dpa-field="title" value="${escHtml(r.title || '')}"></div>
        <div class="col-12"><label class="form-label small">คำอธิบาย</label>
          <textarea class="form-control" rows="2" data-dpa-field="description">${escHtml(r.description || '')}</textarea></div>
        <div class="col-12 col-md-8"><label class="form-label small">ลิงก์</label>
          <input class="form-control" data-dpa-field="href" value="${escHtml(r.href || '')}" placeholder="https://…"></div>
        <div class="col-12 col-md-4"><label class="form-label small">ข้อความปุ่ม</label>
          <input class="form-control" data-dpa-field="cta" value="${escHtml(r.cta || '')}" placeholder="เปิดลิงก์"></div>
        ${mediaField(r, 'cover_url', 'รูปปก')}
        ${mediaField(r, 'video_url', 'วิดีโอ')}
      </div>`}
  </div>`;
}

function paint(root) {
  const list = root.querySelector('#dpaRows');
  const preview = root.querySelector('#dpaPreview');
  if (!list) return;
  if (!state.rows.length) {
    list.innerHTML = '<p class="text-muted mb-0">ยังไม่มีเนื้อหา กดปุ่มด้านบนเพื่อเพิ่ม</p>';
  } else {
    list.innerHTML = state.rows.map(rowEditor).join('');
  }
  if (preview) {
    // `renderDeptContent` drops hidden rows, which is correct — this preview is
    // the PUBLIC page. But "หน้านี้จะว่าง" beside a list of rows the ฝ่าย just
    // wrote reads as data loss, when the true answer is that none of them is
    // published yet. Two different emptinesses, two different sentences.
    const hasDrafts = state.rows.some((r) => r.visible === false);
    const emptyMsg = hasDrafts
      ? '<p class="text-muted mb-0">ยังไม่มีอะไรขึ้นหน้าเว็บ — เนื้อหาที่เพิ่มไว้ยังไม่แสดง '
        + 'กดปุ่ม "แสดง" ที่รายการทางซ้ายเมื่อพร้อม</p>'
      : '<p class="text-muted mb-0">หน้านี้จะว่าง</p>';
    preview.innerHTML = renderDeptContent(rowsForPreview()) || emptyMsg;
    watchDeptHtmlHeights();
  }
}

function say(root, msg, ok = false) {
  const el = root.querySelector('#dpaStatus');
  if (!el) return;
  el.textContent = msg || '';
  el.className = `dpa-status small ${ok ? 'text-success' : 'text-danger'}`;
}

/**
 * FILES PICKED BUT NOT YET UPLOADED, keyed `<rowId>:<field>`.
 *
 * ⛔ NOTHING IS UPLOADED WHEN A FILE IS PICKED. This repo has already paid for
 * the other order, on the ทีม SAMO portrait: *"when there's already a picture of
 * me uploaded on teamsamo and i press upload files, and upload it without
 * pressing the นำรูปออก, the drive now store both files"*. Uploading on pick
 * makes every intermediate choice a real Drive file while only the last one is
 * ever referenced, and the delete path cannot reach the strays — it trashes the
 * file the row POINTS AT, which is precisely the one that is not an orphan.
 *
 * So the bytes leave the browser in `save()` and nowhere else. Cancelling costs
 * nothing, re-picking costs nothing, and the only unreferenced file possible is
 * one whose save failed mid-flight.
 *
 * It is a Map rather than a field on the row because `paint()` replaces the
 * whole list's innerHTML — anything parked in the DOM is destroyed by the next
 * repaint, and a repaint happens on every keystroke-free redraw.
 */
const pending = new Map();

const pendingKey = (id, field) => `${id}:${field}`;

/** Drop every pick for one row, or all of them, releasing the blob URLs behind
 *  them. A blob URL revoked late is a leak the browser holds for the life of
 *  the document. */
function clearPending(id = null) {
  for (const [k, v] of pending) {
    if (id && !k.startsWith(`${id}:`)) continue;
    URL.revokeObjectURL(v.previewUrl);
    pending.delete(k);
  }
}

/**
 * The rows as the PREVIEW should show them — pending picks applied.
 *
 * Without this, choosing a cover changes nothing in the preview beside you
 * until after a save, which reads as "the button did not work". Same failure
 * the draft badge was added for: a state the person cannot see is a state they
 * assume is broken.
 */
function rowsForPreview() {
  if (!pending.size) return state.rows;
  return state.rows.map((r) => {
    const patch = {};
    for (const field of MEDIA_FIELDS) {
      const p = pending.get(pendingKey(r.id, field));
      if (p) patch[field] = p.previewUrl;
    }
    return Object.keys(patch).length ? { ...r, ...patch } : r;
  });
}

/** The two columns that hold an uploaded file, and what each accepts. */
const MEDIA_FIELDS = ['cover_url', 'video_url'];
const MEDIA_ACCEPT = { cover_url: 'image/*', video_url: 'video/*' };

/**
 * One media field: a text box that still takes a pasted URL, plus a file picker.
 *
 * The text box stays on purpose. A ฝ่าย that already has a Drive link should not
 * have to re-upload, and it is the only way to point at something this app did
 * not upload. The picker is the addition, not the replacement.
 */
function mediaField(r, field, label) {
  const p = pending.get(pendingKey(r.id, field));
  const value = r[field] || '';
  return `
    <div class="col-12 col-md-6">
      <label class="form-label small">${escHtml(label)}</label>
      <div class="dpa-media">
        <input class="form-control" data-dpa-field="${field}" value="${escHtml(value)}"
               placeholder="วางลิงก์ หรือกดเลือกไฟล์">
        <button type="button" class="btn btn-outline-secondary btn-sm dpa-pick"
                data-dpa-pick="${field}"><i class="bi bi-upload"></i> เลือกไฟล์</button>
        <input type="file" class="d-none" accept="${MEDIA_ACCEPT[field]}"
               data-dpa-file="${field}">
      </div>
      ${p ? `<p class="form-text dpa-pending">
               <i class="bi bi-clock-history"></i>
               เลือกไว้แล้ว: ${escHtml(p.file.name)} — ยังไม่อัปโหลด กดบันทึกเพื่ออัปโหลด
             </p>` : ''}
    </div>`;
}

/** Collect what the form holds for one row. */
function readRow(el) {
  const patch = {};
  for (const f of el.querySelectorAll('[data-dpa-field]')) {
    patch[f.dataset.dpaField] = f.value.trim() === '' ? null : f.value;
  }
  return patch;
}

/**
 * Upload whatever was picked for one row.
 *
 * @returns the fields to merge into the patch, or `null` if an upload failed —
 *          which is NOT the same as `{}`. A caller that cannot tell "nothing to
 *          upload" from "the upload failed" writes the row anyway, and the row
 *          then points at the OLD file while the person was told it saved.
 */
async function uploadPending(root, id) {
  const out = {};
  for (const field of MEDIA_FIELDS) {
    const p = pending.get(pendingKey(id, field));
    if (!p) continue;
    try {
      say(root, `กำลังอัปโหลด ${p.file.name}…`, true);
      // Downscaled first, and only images — a camera original is ~2.3 MB, which
      // becomes a ~3.1 MB base64 POST through Apps Script for a picture never
      // shown above about 1200px. downscaleImage returns the ORIGINAL whenever
      // it cannot beat it, so a video or an already-small file passes through.
      const file = /^image\//.test(p.file.type)
        ? await downscaleImage(p.file, { maxEdge: 2000, quality: 0.9 })
        : p.file;
      out[field] = await uploadImageToDrive(file);
    } catch (err) {
      say(root, `อัปโหลด ${p.file.name} ไม่สำเร็จ: ${err?.message || 'ลองอีกครั้ง'}`);
      return null;
    }
  }
  return out;
}

async function save(root) {
  if (state.busy) return;
  state.busy = true;
  say(root, 'กำลังบันทึก…', true);
  try {
    for (const el of root.querySelectorAll('[data-dpa-row]')) {
      const id = el.dataset.dpaRow;
      const row = state.rows.find((r) => r.id === id);
      if (!row) continue;
      const patch = { ...readRow(el), position: row.position, visible: row.visible };
      // THE ONLY PLACE BYTES LEAVE THE BROWSER. Runs before the PATCH so a
      // failed upload stops the save instead of writing a row that points at
      // nothing, and so the message lands while the person is still looking at
      // the editor.
      const uploaded = await uploadPending(root, id);
      if (uploaded === null) { state.busy = false; return; }
      Object.assign(patch, uploaded);
      // ⚠️ EVERY UPDATE ASKS FOR THE ROW BACK. A refused PATCH answers 204 with
      // no body, so without `return=representation` + a length check this would
      // report "บันทึกแล้ว" for a write RLS threw away — the shape 0167 shipped.
      const { data, error } = await dbRest(
        `/dept_content?id=eq.${encodeURIComponent(id)}`,
        { method: 'PATCH', body: patch, prefer: 'return=representation' },
      );
      if (error) { say(root, errMsg(error, 'บันทึกไม่สำเร็จ')); state.busy = false; return; }
      if (!Array.isArray(data) || data.length === 0) {
        say(root, 'บันทึกไม่สำเร็จ: ไม่มีสิทธิ์แก้เนื้อหาของฝ่ายนี้');
        state.busy = false; return;
      }
      // ── THE FILE THIS ONE REPLACED ──────────────────────────────────────
      // A ฝ่าย who swaps a cover reasonably believes the old image is gone. It
      // is not: a Drive upload is shared "anyone with the link" for ever, so
      // leaving it is a privacy defect before it is a storage one. Same fault,
      // same fix, as my-seat.js's "when i เปลี่ยนรูป … there is still the old
      // picture of me".
      //
      // AFTER the write is confirmed, never before — retiring first would trash
      // the live file if the PATCH were then refused. photoToRetire returns null
      // when the column is unchanged, and the count is server-side and keeps the
      // file on any answer that is not a definite zero.
      for (const field of MEDIA_FIELDS) {
        const retire = photoToRetire(row[field], patch, field);
        if (retire) deleteTeamPhotoIfUnused(retire);
      }
      // Consumed only once THIS row's write came back. Clearing at the end of
      // the loop would throw away picks that are already in Drive if a later
      // row is refused, and the person would have to pick them again.
      clearPending(id);
    }
    say(root, 'บันทึกแล้ว หน้าฝ่ายอัปเดตทันที', true);
    await refresh(root);
  } finally { state.busy = false; }
}

async function refresh(root) {
  const { rows, error } = await load(state.dept);
  if (error) { say(root, errMsg(error, 'โหลดเนื้อหาไม่สำเร็จ')); return; }
  state.rows = rows;
  paint(root);
}

/**
 * A NEW ROW IS A DRAFT. `dept_content.visible` defaults to `true` in the DDL,
 * so the first version of this created every card PUBLIC — it was on the ฝ่าย's
 * public page the instant the button was pressed, carrying the placeholder
 * title `หัวข้อใหม่`, no link and no cover. That really happened: one such card
 * stood on the live ฝ่ายดิจิทัล page.
 *
 * Every other authoring surface in this app drafts first (ประกาศ, หนังสือ), and
 * the whole premise of หน้าฝ่าย is that a ฝ่าย builds their page over several
 * sittings without asking IT. A default that publishes each sitting's
 * half-finished state contradicts the feature it belongs to.
 *
 * ⚠️ The column default stays `true` ON PURPOSE. It is what an INSERT from
 * anywhere else means, and flipping it would silently hide rows a future
 * importer or migration creates. The draft rule belongs to the BUTTON a person
 * presses, so it is stated here, explicitly, in the row this button writes.
 */
/**
 * What a NEW row of each kind starts as.
 *
 * Every one must satisfy `dept_content_has_body` (0177/0179) — a row that
 * carries nothing its kind renders is refused by the database, and the refusal
 * would surface as "เพิ่มไม่สำเร็จ" with no hint that the fault is here.
 */
const NEW_ROW = {
  section: { title: 'หัวข้อใหม่' },
  card:    { title: 'หัวข้อใหม่' },
  text:    { description: 'พิมพ์ข้อความของฝ่ายที่นี่' },
  html:    { html: '<p>เขียนเนื้อหาของฝ่ายที่นี่</p>' },
};

async function addRow(root, kind) {
  const seed = NEW_ROW[kind];
  if (!seed) return;
  const max = state.rows.reduce((m, r) => Math.max(m, r.position || 0), 0);
  const body = { dept: state.dept, kind, position: max + 10, visible: false, ...seed };
  const { data, error } = await dbRest('/dept_content',
    { method: 'POST', body, prefer: 'return=representation' });
  if (error) { say(root, errMsg(error, 'เพิ่มไม่สำเร็จ')); return; }
  if (!Array.isArray(data) || !data.length) {
    say(root, 'เพิ่มไม่สำเร็จ: ไม่มีสิทธิ์แก้เนื้อหาของฝ่ายนี้'); return;
  }
  await refresh(root);
}

async function removeRow(root, id) {
  // return=representation on a DELETE too: RLS refuses by matching zero rows,
  // never by erroring, so "it worked" and "you may not" are the same 204.
  const { data, error } = await dbRest(`/dept_content?id=eq.${encodeURIComponent(id)}`,
    { method: 'DELETE', prefer: 'return=representation' });
  if (error) { say(root, errMsg(error, 'ลบไม่สำเร็จ')); return; }
  if (!Array.isArray(data) || data.length === 0) {
    say(root, 'ลบไม่สำเร็จ: ไม่มีสิทธิ์แก้เนื้อหาของฝ่ายนี้'); return;
  }
  // Deleting the row orphans its media too. `data[0]` is the row as it was —
  // `return=representation` on a DELETE hands back what was removed, which is
  // the only place the URLs still exist by this point.
  for (const field of MEDIA_FIELDS) {
    // The row is gone, so nothing here can be pointing at it any more: an
    // unconditional retire, still gated by the server-side reference count in
    // case another ฝ่าย's row shares the file.
    if (data[0]?.[field]) deleteTeamPhotoIfUnused(data[0][field]);
  }
  clearPending(id);
  await refresh(root);
}

/** @returns {Promise<boolean>} whether the write actually landed. */
async function patchRow(root, id, patch, reload = true) {
  const { data, error } = await dbRest(`/dept_content?id=eq.${encodeURIComponent(id)}`,
    { method: 'PATCH', body: patch, prefer: 'return=representation' });
  if (error) { say(root, errMsg(error, 'บันทึกไม่สำเร็จ')); return false; }
  if (!Array.isArray(data) || data.length === 0) {
    say(root, 'บันทึกไม่สำเร็จ: ไม่มีสิทธิ์แก้เนื้อหาของฝ่ายนี้'); return false;
  }
  if (reload) await refresh(root);
  return true;
}

/** Swap two rows' positions. Reordering by rewriting BOTH keeps the numbers
 *  meaningful instead of drifting into ties that sort unpredictably. */
async function move(root, id, dir) {
  const i = state.rows.findIndex((r) => r.id === id);
  const j = dir === 'up' ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= state.rows.length) return;
  const a = state.rows[i], b = state.rows[j];
  const pa = a.position, pb = b.position;
  // A swap is TWO writes and it must not half-happen. If the first is refused
  // — a revoked grant, a dropped connection — firing the second anyway leaves
  // both rows on one position, which then sorts by created_at and looks like
  // the reorder silently did the wrong thing. Stop, and let the message stand.
  const first = await patchRow(root, a.id, { position: pb === pa ? pb + (dir === 'up' ? -1 : 1) : pb }, false);
  if (!first) { await refresh(root); return; }
  await patchRow(root, b.id, { position: pa });
}

export function initDeptPageAdmin(user) {
  const root = document.querySelector('[data-admin-pane="deptpage"]');
  if (!root) return;
  const picker = root.querySelector('#dpaDept');
  const mine = editableDepts(user);
  if (picker) {
    picker.innerHTML = mine.map((d) => `<option value="${escHtml(d.value)}">${escHtml(d.label)}</option>`).join('');
    picker.disabled = mine.length <= 1;
  }
  const only = root.querySelector('#dpaOnly');
  if (only) {
    // Say WHICH ฝ่าย this account is for, rather than making the single-item
    // dropdown look like a choice that failed to offer alternatives.
    only.textContent = mine.length === 1 ? `คุณดูแลหน้า${deptLabel(mine[0].value)}` : '';
  }
  if (!mine.length) {
    root.querySelector('#dpaBody')?.classList.add('d-none');
    say(root, 'บัญชีนี้ยังไม่ได้รับสิทธิ์แก้หน้าฝ่ายใด — ขอสิทธิ์ได้ที่ ทีม SAMO');
    return;
  }
  state.dept = mine[0].value;
  refresh(root);

  if (root.dataset.dpaWired === '1') return;
  root.dataset.dpaWired = '1';

  picker?.addEventListener('change', () => { clearPending(); state.dept = picker.value; refresh(root); });
  root.querySelector('#dpaAddSection')?.addEventListener('click', () => addRow(root, 'section'));
  root.querySelector('#dpaAddCard')?.addEventListener('click', () => addRow(root, 'card'));
  root.querySelector('#dpaAddText')?.addEventListener('click', () => addRow(root, 'text'));
  root.querySelector('#dpaAddHtml')?.addEventListener('click', () => addRow(root, 'html'));
  root.querySelector('#dpaSave')?.addEventListener('click', () => save(root));

  // A pick, delegated for the same reason. Nothing is uploaded here — the file
  // is parked in `pending` and the bytes leave only in save(). See that map's
  // comment for the Drive orphans the other order produced.
  root.addEventListener('change', async (e) => {
    const input = e.target.closest('[data-dpa-file]');
    if (!input) return;
    const rowEl = input.closest('[data-dpa-row]');
    const picked = input.files?.[0];
    if (!rowEl || !picked) return;
    const id = rowEl.dataset.dpaRow;
    const field = input.dataset.dpaFile;
    // Park the BYTES, not the handle: save() may run long after the pick, and
    // a phone can refuse to read the original by then (read-file.js).
    let file;
    try { file = await holdInMemory(picked); } catch (err) {
      input.value = '';
      say(root, err.message);
      return;
    }
    // Replacing an earlier pick for the same field must release the old blob.
    const prev = pending.get(pendingKey(id, field));
    if (prev) URL.revokeObjectURL(prev.previewUrl);
    pending.set(pendingKey(id, field), { file, previewUrl: URL.createObjectURL(file) });
    // The input is inside the markup paint() is about to replace, so clearing
    // it matters only for the case where it is not — picking the SAME file
    // twice otherwise fires no change event at all.
    input.value = '';
    paint(root);
    say(root, 'เลือกไฟล์แล้ว — กดบันทึกเพื่ออัปโหลด', true);
  });

  // Delegated, so it keeps working across every repaint. A listener per row is
  // this repo's listener-accumulation bug (docs/mistakes/frontend-ui.md).
  root.addEventListener('click', (e) => {
    const rowEl = e.target.closest('[data-dpa-row]');
    if (!rowEl) return;
    const id = rowEl.dataset.dpaRow;
    const row = state.rows.find((r) => r.id === id);
    // "เลือกไฟล์" opens the hidden file input for the SAME field, found within
    // this row — not by id, because every row carries a field with that name.
    const pick = e.target.closest('[data-dpa-pick]');
    if (pick) {
      rowEl.querySelector(`[data-dpa-file="${pick.dataset.dpaPick}"]`)?.click();
      return;
    }
    // The visual editor writes into the TEXTAREA and stops. It performs no
    // database write of its own: the existing บันทึก path persists it, so this
    // whole feature adds no second way for a row to be saved.
    if (e.target.closest('[data-dpa-visual]')) {
      openVisualEditor(rowEl.querySelector('[data-dpa-field="html"]')?.value || '')
        .then((html) => {
          if (html == null) return;
          const ta = rowEl.querySelector('[data-dpa-field="html"]');
          if (ta) ta.value = html;
          // Repaint so the preview beside them shows it immediately, then say
          // what is still owed — the row is edited, not yet saved.
          const row = state.rows.find((r) => r.id === id);
          if (row) row.html = html;
          paint(root);
          say(root, 'แก้เรียบร้อย — กดบันทึกเพื่อให้ขึ้นหน้าเว็บ', true);
        })
        .catch((err) => say(root, `เปิดตัวแก้แบบเห็นภาพไม่สำเร็จ: ${err?.message || ''}`));
      return;
    }
    if (e.target.closest('[data-dpa-delete]')) {
      if (!window.confirm('ลบเนื้อหานี้ออกจากหน้าฝ่าย?')) return;
      removeRow(root, id);
    } else if (e.target.closest('[data-dpa-toggle]')) {
      patchRow(root, id, { visible: !(row?.visible !== false) });
    } else {
      const mv = e.target.closest('[data-dpa-move]');
      if (mv) move(root, id, mv.dataset.dpaMove);
    }
  });
}
