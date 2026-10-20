// ==============================================
// HOUSE FIELD RULES — pure, shared, no DOM and no network.
//
// Mirrors src/js/team/fields.js in spirit: the canonical form of every field is
// decided ONCE, here, and every writer (the CSV importer, the admin form, the
// student's own edit) normalises through it.
//
// WHAT CANONICAL MEANS
//   • สายรหัส — exactly THREE digits, zero-padded: '001', '017', '100'.
//     The house is its LAST DIGIT. Nothing here ever derives a สายรหัส from a
//     รหัสนักศึกษา: it is the university's own อาจารย์ที่ปรึกษา assignment, handed
//     out at random, and inventing one would put a real student in a wrong house.
//   • รหัสนักศึกษา — '659999999-9', same rule as ทีม SAMO. Re-exported from
//     team/fields.js rather than reimplemented, because two implementations of
//     one rule is the bug class this repo pays for most.
//   • สาขา — 'MD' / 'MDI' / 'RT', matched case- and punctuation-insensitively.
//
// THE FAILURE THIS MODULE EXISTS TO CATCH
// Excel and Sheets silently strip leading zeros from a numeric-looking column,
// so '001' arrives as '1' and '017' as '17'. Read one row at a time that is
// invisible — '1' is a perfectly valid-looking สาย. It is only visible ACROSS
// the file: a healthy file has every สาย the same width. `auditSaiWidths()`
// below is therefore a FILE-level check. It WARNS rather than refuses: stripping
// only ever removes LEADING zeros, so left-padding restores the value exactly and
// the house — the last digit — is invariant under it. What is NOT recoverable is
// a zero that was ADDED: a blank numeric cell comes back as `0`, and `000` is
// refused outright by normalizeSai for that reason.
// ==============================================

import { normalizeStudentId, majorKey } from '../team/fields.js';
import { arabicDigits } from '../utils.js';
// ชั้นปี / รุ่น MOVED OUT (0145). It used to be defined here, and ทีม SAMO stored
// its own answer in `team_members.year` rather than importing a rule that lived
// under `house/` — so the two drifted, exactly as the comment that used to sit
// at line 208 of this file predicted. It is now `src/js/study-year.js`, one
// level up, where a rule two systems need belongs. Re-exported so no caller had
// to change; new code should import from study-year.js directly.
import {
  COHORT_EPOCH, COHORT_PREFIX, ACADEMIC_YEAR_ROLLOVER_MONTH,
  setAcademicYear, academicYear, cohortFromStudentId, cohortLabel,
  studyYear, studyYearLabel, isGraduated, offsetForPickedYear,
} from '../study-year.js';

export { normalizeStudentId, majorKey };
export {
  COHORT_EPOCH, COHORT_PREFIX, ACADEMIC_YEAR_ROLLOVER_MONTH,
  setAcademicYear, academicYear, cohortFromStudentId, cohortLabel,
  studyYear, studyYearLabel, isGraduated, offsetForPickedYear,
};

/** Canonical สายรหัส shape and the example shown to a human. */
export const SAI_RE = /^\d{3}$/;
export const SAI_PLACEHOLDER = '017';
export const SAI_HINT = 'สายรหัส 3 หลัก เช่น 001 017 100 (เติมศูนย์ข้างหน้าให้ครบ 3 หลัก)';

/** How many houses there are. Fixed by the rule (one per digit), not a setting. */
export const HOUSE_COUNT = 10;


/**
 * Canonicalise a สายรหัส to three digits.
 *
 * @returns {{ value: string|null, ok: boolean, padded: boolean, raw: string }}
 *   `padded` is true when we ADDED leading zeros — the caller uses it to tell
 *   the difference between a file that was written correctly and one Excel got
 *   to. A single padded row is fine; a file where SOME rows needed padding and
 *   others did not is the disaster, and that is `auditSaiWidths`'s job.
 *
 * 1–3 digits are accepted and padded. 4+ digits are NOT — we would have to
 * guess which end to cut, and guessing puts someone in the wrong house.
 */
export function normalizeSai(raw) {
  const rawStr = String(raw ?? '').trim();
  if (!rawStr) return { value: null, ok: true, padded: false, raw: '' };
  const digits = arabicDigits(rawStr).replace(/\D/g, '');
  if (!digits || digits.length > 3) {
    return { value: rawStr, ok: false, padded: false, raw: rawStr };
  }
  const value = digits.padStart(3, '0');
  // `000` is not a สายรหัส — the range is 001–999 — and it is exactly what a
  // spreadsheet puts in an EMPTY numeric cell. Accepting it would file a student
  // into บ้าน 0 under a สาย the university does not have, silently, from a blank.
  // This is the same Excel-mangles-the-สาย-column failure `auditSaiWidths` exists
  // for, arriving from the other direction: not a zero stripped off, a zero
  // added. บ้าน 0 loses nothing — it is fed by 010, 020, … 100.
  if (value === '000') return { value: rawStr, ok: false, padded: false, raw: rawStr };
  return {
    value,
    ok: true,
    padded: digits.length < 3,
    raw: rawStr,
  };
}

/**
 * The house a สายรหัส belongs to: its last digit.
 *
 * ⚠️ THE DATABASE IS THE AUTHORITY. `sais.house_id` is a GENERATED STORED column
 * computed by exactly this rule, and every READ path takes the house from that
 * column. This function exists only so the import PREVIEW can show which house a
 * row will land in before anything is written. `house-fields.test.js` pins it
 * against the same 001..100 partition the migration asserts, so the two cannot
 * drift — but if they ever disagree, the column wins.
 *
 * @returns {number|null} 0–9, or null when the code is not canonical.
 */
export function houseOf(saiCode) {
  const s = String(saiCode ?? '').trim();
  if (!SAI_RE.test(s)) return null;
  return Number(s[s.length - 1]);
}

/**
 * Why a สายรหัส was refused, in words a person can act on.
 *
 * `normalizeSai` returns a boolean; every caller that shows a message was
 * spelling its own, and they had drifted — an all-zero value produced
 * "ต้องเป็นตัวเลขไม่เกิน 3 หลัก", which is both wrong (it IS three digits) and
 * unhelpful (the real cause is an empty cell a spreadsheet filled in).
 */
export function saiProblem(raw) {
  const n = normalizeSai(raw);
  if (n.ok) return null;
  const digits = arabicDigits(String(raw ?? '').trim()).replace(/\D/g, '');
  if (digits && /^0+$/.test(digits)) {
    return 'สายรหัส 000 ไม่มีอยู่จริง — สายเริ่มที่ 001 '
      + '(ค่านี้มักเกิดจากช่องว่างที่โปรแกรมตารางเติมเลข 0 ให้)';
  }
  if (digits.length > 3) return 'สายรหัสยาวเกิน 3 หลัก';
  return 'สายรหัสต้องเป็นตัวเลข 1–3 หลัก เช่น 7 หรือ 007';
}

/** A colour safe to interpolate into a `style` attribute. escHtml stops the
 *  attribute being broken out of, but not `#fff;background:url(…)` — and
 *  `houses.color` is written through the API, not only by the `<input
 *  type="color">` that normally sets it. Anything that is not a plain hex colour
 *  falls back to the caller's default. */
export function safeColor(c, fallback = null) {
  const v = String(c ?? '').trim();
  return /^#[0-9a-fA-F]{3,8}$/.test(v) ? v : fallback;
}

/** Display name for a house that may not have been named yet. */
export function houseLabel(id, name) {
  const n = String(name ?? '').trim();
  if (n) return n;
  return Number.isInteger(id) ? `บ้าน ${id}` : 'ยังไม่มีบ้าน';
}

/**
 * FILE-LEVEL leading-zero audit.
 *
 * Returns the distinct widths of the RAW (un-padded) สาย values. A healthy file
 * has exactly one width. More than one means Excel ate the zeros off some rows
 * and not others — which left-padding undoes exactly, so this reports rather than
 * refuses. It is still worth saying out loud: a file that went through a
 * spreadsheet may have been damaged in columns where the damage is NOT
 * reversible.
 *
 * @param {string[]} rawValues the สาย column exactly as it came out of the file
 */
export function auditSaiWidths(rawValues) {
  const widths = new Map();          // width -> count
  let blank = 0;
  for (const v of rawValues) {
    const digits = arabicDigits(String(v ?? '').trim()).replace(/\D/g, '');
    if (!digits) { blank += 1; continue; }
    widths.set(digits.length, (widths.get(digits.length) || 0) + 1);
  }
  const list = [...widths.entries()].sort((a, b) => a[0] - b[0])
    .map(([width, count]) => ({ width, count }));
  return {
    widths: list,
    blank,
    consistent: list.length <= 1,
    // The specific, recognisable shape of the Excel failure: a mix that includes
    // values SHORTER than three digits.
    looksLikeStrippedZeros: list.length > 1 && list.some((w) => w.width < 3),
  };
}


/** Snap a สาขา onto the managed vocabulary. Unknown values are KEPT, not
 *  dropped — silently blanking a field on import is worse than flagging it. */
export function normalizeMajor(raw, known = []) {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) return { value: null, ok: true };
  const key = majorKey(trimmed);
  const hit = known.find((k) => majorKey(k) === key);
  if (hit) return { value: hit, ok: true };
  return { value: trimmed, ok: false };
}

/** Collapse runs of whitespace, strip the invisible ones that arrive with every
 *  copy-paste out of Word (NBSP U+00A0, zero-width U+200B/FEFF). */
export function cleanSpace(s) {
  return String(s ?? '')
    .replace(/[ ​﻿]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Values that mean "blank" but arrive as text. The spec asks for empty cells;
 *  this catches the files that ignore it, because storing '-' as a nickname
 *  puts a dash on a real person's card. */
const BLANKISH = new Set(['-', '–', '—', 'n/a', 'na', 'null', 'none', 'ไม่มี', 'ยังไม่ทราบ', '']);
export function blankish(s) {
  return BLANKISH.has(cleanSpace(s).toLowerCase());
}

/** Normalise a cell that should be empty when it has no content. */
export function cleanCell(s) {
  const v = cleanSpace(s);
  return blankish(v) ? null : v;
}

/** kkumail: lowercase, trimmed, and it must look like an address. */
export function normalizeKkumail(raw) {
  const v = cleanSpace(raw).toLowerCase();
  if (!v) return { value: null, ok: false, reason: 'ไม่มีอีเมล' };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) {
    return { value: v, ok: false, reason: 'รูปแบบอีเมลไม่ถูกต้อง' };
  }
  return { value: v, ok: true };
}

/** Full name from the two columns the spec asks for. */
export function joinName(first, last) {
  return cleanSpace(`${cleanSpace(first)} ${cleanSpace(last)}`);
}
