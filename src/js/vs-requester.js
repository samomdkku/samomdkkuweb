// ==============================================
// VS REQUESTER — the one reading of who reported it and where they asked
//                the ticket to go
// ==============================================
//
// Three columns the VS form collects and, until this module, NOTHING on the
// web read:
//
//   display_name   the name (or นามแฝง) the reporter typed — optional
//   year           their ชั้นปี — optional
//   requested_dept the ฝ่าย they asked the report to reach
//
// `requested_dept` is the load-bearing one. Non-emergency reports route to SE
// FIRST BY DESIGN — SE reads it and forwards — so `target_dept` is 'SE' on
// every new ticket and the reporter's own choice survives in `requested_dept`
// alone. The Discord embed has always printed it with an instruction aimed at
// SE ("SE กรุณาพิจารณาและโอนย้ายหากเหมาะสม", functions/_discord.js), while the
// dashboard SE actually works in never showed it: 16 of 72 live tickets named
// a ฝ่าย, one was CLOSED at SE without ever reaching it, one landed at a
// different ฝ่าย than the one asked for.
//
// In the GAS era the reader was the Google Sheet — column K, commented
// "เพื่อให้ SE รู้ว่าต้องส่งต่อไปไหน". The Supabase move carried the column
// across and replaced the Sheet with a dashboard that never learned the field.
// Same shape as the PR ลิงก์เสริม bug (`docs/mistakes/frontend-ui.md`), so the
// rule and the reading live in ONE module that both the board and the modal
// ask, rather than in each of them.

import { escHtml } from './utils.js';

/** The value the form submits for "ไม่แน่ใจ (ให้ทีม SE ช่วยพิจารณา)". It is a
 *  real answer — "I don't know" — not a missing one. */
export const VS_TRIAGE_DEPT = 'SE';

const BLANK_NAMES = new Set(['', '-', 'anonymous']);

/**
 * Read a vs_tickets row's reporter fields.
 *
 * @param {object} t a raw `vs_tickets` row (the staff cache holds `select=*`)
 * @returns {{name: string|null, year: string|null, requestedDept: string|null,
 *            state: 'none'|'pending'|'matched'}}
 *
 * `state` is what a renderer branches on, and it has THREE values on purpose —
 * a callout this module can turn ON has to be turned OFF by every other
 * outcome, not just by the absence of a row:
 *   none     — the reporter did not name a ฝ่าย (or chose ไม่แน่ใจ)
 *   pending  — they named one and the ticket is NOT there yet
 *   matched  — they named one and the ticket has reached it
 */
export function vsRequester(t = {}) {
  const rawName = String(t.display_name ?? '').trim();
  const name = BLANK_NAMES.has(rawName.toLowerCase()) ? null : rawName;

  const rawYear = String(t.year ?? '').trim();
  const year = (rawYear === '' || rawYear === '-') ? null : rawYear;

  const rawDept = String(t.requested_dept ?? '').trim();
  const requestedDept = (rawDept === '' || rawDept === VS_TRIAGE_DEPT) ? null : rawDept;

  let state = 'none';
  if (requestedDept) {
    state = requestedDept === String(t.target_dept ?? '').trim() ? 'matched' : 'pending';
  }
  return { name, year, requestedDept, state };
}

/** Short one-line identity for a card or a header. Null when the reporter
 *  gave neither — the VS form promises they MAY stay anonymous, so "no name"
 *  is an ordinary outcome and must not render an empty label.
 *
 *  ⚠️ THE ชั้นปี IS A SNAPSHOT, and it is labelled as one. `vs_tickets.year` is
 *  what the reporter typed the day they reported; it is never re-derived, so a
 *  ticket from July says "3" about someone who may now be in ปี 4. Everywhere
 *  else in this app a ชั้นปี on screen comes from `studyYearLabel()`, which
 *  computes it from รหัสนักศึกษา — that cannot work here, because a VS reporter
 *  may be anonymous and there is no รหัส to compute from. So the qualifier
 *  carries the honesty the derivation carries elsewhere, and
 *  `study-year.test.js` exempts this file BY NAME on that condition, with
 *  `vs-requester.test.js` asserting the qualifier is still there. */
export const YEAR_QUALIFIER = '(ตอนที่แจ้ง)';

export function vsRequesterLine(t = {}) {
  const { name, year } = vsRequester(t);
  if (!name && !year) return null;
  const parts = [];
  if (name) parts.push(name);
  if (year) parts.push(`ชั้นปี ${year} ${YEAR_QUALIFIER}`);
  return parts.join(' · ');
}

/**
 * The reporter block for the staff modal. Every `state` renders something:
 * silence would be indistinguishable from the bug this replaces.
 *
 * @param {object} t raw row
 * @returns {string} HTML
 */
export function renderVsRequesterBlock(t = {}) {
  const { requestedDept, state } = vsRequester(t);
  const who = vsRequesterLine(t);

  const identity = who
    ? `<span class="vs-req-who"><i class="bi bi-person"></i> ผู้แจ้ง: ${escHtml(who)}</span>`
    : '<span class="vs-req-who is-anon"><i class="bi bi-person"></i> ผู้แจ้งไม่ระบุตัวตน</span>';

  let routing;
  if (state === 'pending') {
    // The only actionable one. The button fills the transfer select; it does
    // NOT transfer — SE still reviews and presses บันทึก, which is the whole
    // point of routing through SE.
    routing = `
      <div class="vs-req-callout is-pending">
        <i class="bi bi-signpost-split-fill"></i>
        <div>
          <div class="vs-req-callout-title">ผู้แจ้งขอให้ส่งถึง: ${escHtml(requestedDept)}</div>
          <div class="vs-req-callout-sub">ยังไม่ได้ส่งไปฝ่ายนี้ — SE พิจารณาแล้วเลือกได้ในช่องโอนย้ายฝ่าย</div>
        </div>
        <button type="button" class="btn btn-sm btn-outline-dark vs-req-pick"
          onclick="pickRequestedVsDept()">เลือกฝ่ายนี้</button>
      </div>`;
  } else if (state === 'matched') {
    routing = `
      <div class="vs-req-callout is-matched">
        <i class="bi bi-check-circle-fill"></i>
        <div class="vs-req-callout-title">ส่งถึงฝ่ายที่ผู้แจ้งขอแล้ว: ${escHtml(requestedDept)}</div>
      </div>`;
  } else {
    routing = `
      <div class="vs-req-callout is-none">
        <i class="bi bi-question-circle"></i>
        <div class="vs-req-callout-title">ผู้แจ้งไม่ได้ระบุฝ่าย — เลือก "ไม่แน่ใจ (ให้ทีม SE ช่วยพิจารณา)"</div>
      </div>`;
  }

  return `<div class="vs-req-identity">${identity}</div>${routing}`;
}

/** Board chip — only the actionable state earns one, so a card stays quiet
 *  once the ticket is where it was asked to go. `short` is the board's own
 *  dept abbreviation (the chip has a card's width, the title has the full
 *  name). */
export function renderVsRequestedChip(t = {}, { short = (s) => s } = {}) {
  const { requestedDept, state } = vsRequester(t);
  if (state !== 'pending') return '';
  return `<span class="vs-kanban-card-req" title="ผู้แจ้งขอให้ส่งถึง ${escHtml(requestedDept)}">`
    + `<i class="bi bi-signpost-split"></i> ขอ: ${escHtml(short(requestedDept))}</span>`;
}
