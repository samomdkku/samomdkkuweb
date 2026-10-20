// ==============================================
// ชั้นปี / รุ่น — the ONE implementation, for the WHOLE app.
//
// WHY THIS FILE EXISTS, AND WHY IT IS NOT IN house/ ANY MORE.
//
// It used to live in `src/js/house/fields.js`, because ระบบบ้าน was the only
// system that computed a ชั้นปี. ทีม SAMO STORED one instead, in
// `team_members.year`, and the two answers drifted apart exactly as that file's
// own comment predicted they would:
//
//   "team_members.year is still that column (399 rows, and nothing anywhere in
//    this repo has ever bumped it — verified by grep, so every August all 399
//    quietly become last year's answer)."
//
// Reported, one August later: "i've tested changing my student id to
// 603070316-0 — it shows ชั้นปี 5 on main web, จบแล้ว in ระบบบ้าน (ปี10), ปี5 in
// teamsamo. the data become not syncing". Nine members were showing a ชั้นปี
// exactly one year behind the truth and nobody could have noticed, because the
// only place the two answers appear side by side is one person's own card.
//
// A rule that two systems need does not belong inside one of them. Living under
// `house/` is what made "ทีม SAMO should use this too" read as a layering
// violation rather than as the obvious thing — so the rule moved up, and
// `house/fields.js` re-exports it so no caller had to change.
//
// ---------------------------------------------------------------------------
// THE RULE
//
//   ชั้นปี = ปีการศึกษา − ปีที่เข้า + 1 + year_offset
//
// ปีที่เข้า is read off the รหัสนักศึกษา and re-derived whenever the รหัส moves
// (0128 for students, 0145 for the registry). ปีการศึกษา is an admin-set value
// (0141). `year_offset` is a DIFFERENCE — ลาพัก / เรียนซ้ำ / จบช้า — set once by
// the person and correct in every later year without maintenance.
//
// "SHOULD CHANGING รหัสนักศึกษา CHANGE ชั้นปี?" — asked by the owner, whose
// instinct was no. Yes, it must: the รหัส is where ปีที่เข้า comes from, so a
// corrected รหัส and an unchanged ชั้นปี would leave the record asserting that
// someone who entered in 2560 is in their fifth year in 2569. What must NOT be
// recomputed is the part that is genuinely about the person, and that is exactly
// what `year_offset` is. The instinct is right; the offset is what satisfies it.
//
// THERE IS DELIBERATELY NO SQL TWIN. Nothing server-side gates on ชั้นปี, so SQL
// stores the ingredients and this does the arithmetic — one implementation of
// one rule, which is the class this repo has paid for most.
// ==============================================

import { arabicDigits } from './utils.js';

/** The faculty's intake count, not a year: ปีที่เข้า 2565 is MD50, 2564 is MD49.
 *  One epoch constant, one prefix, spelled once. MDI and RT students entering
 *  the same year carry the same intake label; if that ever needs to differ, it
 *  differs HERE and nowhere else. */
export const COHORT_EPOCH = 2515;
export const COHORT_PREFIX = 'MD';

/** Where the clock WOULD put the rollover. The fallback below, and the value the
 *  ระบบบ้าน admin page compares the stored setting against. */
export const ACADEMIC_YEAR_ROLLOVER_MONTH = 8;

/**
 * ปีการศึกษา is an ADMIN-SET value (migration 0141), primed once at boot.
 *
 * 0131 made it a constant derived from the clock, arguing that "a setting
 * somebody must change every August is a setting that is forgotten every
 * August". The owner overruled it, and the counter-argument is stronger: the
 * promotion is not a calendar event. It does not happen at midnight on 1
 * สิงหาคม, the date varies, and a system that advances 1,800 people on a date
 * the faculty did not pick is confidently wrong for the weeks in between while
 * looking exactly like it is working. A stale answer is visible to whoever has
 * to fix it; a wrong one is not.
 *
 * The forgotten-setting risk is answered rather than traded away: the ระบบบ้าน
 * admin page shows the value beside what the clock would have said, and says
 * when they differ (`academic_year_status()`). It reminds; it never acts.
 *
 * NULL until `setAcademicYear` has been called, and the clock is the fallback —
 * so a failed fetch degrades to exactly the pre-0141 behaviour rather than to a
 * blank ชั้นปี on every card.
 */
let currentAcademicYear = null;

/** Prime from `get_academic_year()`. Idempotent; ignores a non-numeric value. */
export function setAcademicYear(year) {
  const n = Number(year);
  if (Number.isFinite(n) && n > 2400) currentAcademicYear = n;
}

/** The ปีการศึกษา in พ.ศ. `now` is injectable so the tests can stand at a date
 *  rather than asserting against whenever they happen to run — and so the
 *  fallback path stays testable. */
export function academicYear(now = new Date()) {
  if (currentAcademicYear !== null) return currentAcademicYear;
  const be = now.getFullYear() + 543;
  return now.getMonth() + 1 >= ACADEMIC_YEAR_ROLLOVER_MONTH ? be : be - 1;
}

/**
 * ปีที่เข้า (พ.ศ.) from the first two digits of รหัสนักศึกษา.
 *
 * Mirrors `public.cohort_from_student_id`, INCLUDING its 2540–2580 window — 0118
 * tightened that because 2500+99 was inside the original bound, so a malformed
 * รหัส produced a confident "ปี 1". Out of range returns null, which renders as
 * no รุ่น rather than a plausible wrong one.
 */
export function cohortFromStudentId(sid) {
  const digits = arabicDigits(sid).replace(/\D/g, '');
  if (digits.length < 2) return null;
  const year = 2500 + Number(digits.slice(0, 2));
  return year >= 2540 && year <= 2580 ? year : null;
}

/**
 * รุ่น (MD50) from ปีที่เข้า — the only cohort vocabulary this app has.
 *
 * WHY รุ่น IS STORED AND ชั้นปี IS NOT. รุ่น is a FACT about the person, fixed at
 * admission and readable straight off the รหัสนักศึกษา, so it needs no clock, no
 * override and no maintenance. ชั้นปี needs a "current academic year" to subtract
 * from and silently rots without one.
 */
export function cohortLabel({ cohort_year: cohort, student_id: sid } = {}) {
  const c = cohort || cohortFromStudentId(sid);
  if (!c) return null;
  const n = Number(c) - COHORT_EPOCH;
  return n >= 1 ? `${COHORT_PREFIX}${n}` : null;
}

/**
 * The raw ชั้นปี number. May be > 6 or < 1 — the caller decides how to read
 * that; see studyYearLabel.
 *
 * @param {{cohort_year?:number, student_id?:string, year_offset?:number}} rec
 * @returns {number|null} null when there is no ปีที่เข้า to count from, which is
 *   the honest answer for a shared department account, an อาจารย์ with a ทีม SAMO
 *   posting, or a row whose รหัสนักศึกษา has not been filled in yet.
 */
export function studyYear({ cohort_year: cohort, student_id: sid, year_offset: off } = {},
  now = new Date()) {
  const c = cohort || cohortFromStudentId(sid);
  if (!c) return null;
  return academicYear(now) - Number(c) + 1 + (Number(off) || 0);
}

/**
 * ชั้นปี as a person reads it.
 *
 * Out-of-range is rendered, not clamped: `year_offset` is deliberately unbounded
 * (0131), so the guard against an absurd value belongs here, at the one place
 * that turns a number into words. Above ปี 6 the honest word is "จบแล้ว" — which
 * also makes a graduation signal fall out of the arithmetic with no `status`
 * column to keep current (0120 dropped that one).
 */
export function studyYearLabel(rec, now = new Date()) {
  const n = studyYear(rec, now);
  if (n === null || n < 1) return null;
  return n > 6 ? 'จบแล้ว' : `ปี ${n}`;
}

/**
 * The same "จบแล้ว" test as `studyYearLabel`, as a boolean a caller can FILTER
 * on — e.g. the ระบบบ้าน roster default-hiding a graduated รุ่น.
 *
 * DELIBERATELY NOT A STORED COLUMN. The design this answers
 * (`docs/YEAR-ROLLOVER.md` § ระบบบ้าน) first proposed `students.graduated_at`,
 * set once by a yearly job. Rejected: a stored flag is exactly the "fill once,
 * never correct" shape `.claude/rules/mistakes.md` class 6 warns about — it
 * would need its OWN re-derivation whenever `year_offset` changes (a ลาพัก
 * correction un-graduating someone, or the reverse) or whenever an admin moves
 * ปีการศึกษา back by mistake (edge case in the same doc). `studyYear` already
 * recomputes live from `academicYear()` with no clock and no maintenance —
 * this is that same computation with nothing new to keep in step, so the
 * rollover needs no code change and no migration next year either.
 *
 * @returns {boolean} false for a row with no resolvable ปีที่เข้า — "cannot
 *   place" is not the same claim as "graduated".
 */
export function isGraduated(rec, now = new Date()) {
  const n = studyYear(rec, now);
  return n !== null && n > 6;
}

/**
 * The record to COMPUTE FROM while a รหัสนักศึกษา is being edited.
 *
 * ⚠️ THIS IS 0128 WEARING A CLIENT-SIDE COSTUME, AND EVERY FORM THAT SHOWS A
 * ชั้นปี BESIDE AN EDITABLE รหัส NEEDS IT. `studyYear` reads
 * `cohort_year || cohortFromStudentId(student_id)` — the stored cohort WINS. So
 * feeding it a record whose `cohort_year` came from the OLD รหัส makes the
 * corrected one invisible: the box does not move as you type, and worse, an
 * offset saved in that state is measured against the wrong base and quietly
 * means something else.
 *
 * That is exactly the failure the owner reported on the server side — "เปลี่ยน
 * รหัสนักศึกษาเป็น 59… หรือ 64… แล้วรุ่นไม่เปลี่ยนตาม" — where `cohort_year` was
 * filled once and never re-derived (0128, and 0145 for the registry). The
 * database re-derives now; a form that keeps handing it the stale copy puts the
 * bug back on the screen.
 *
 * THE RULE: the stored cohort is only trustworthy while the รหัส it was derived
 * FROM is unchanged. Once the box differs, the typed รหัส is the only input.
 * (Keeping the stored cohort for an UNCHANGED รหัส matters: a member with no
 * รหัส at all may still have a ปีที่เข้า, converted from their old stored ชั้นปี
 * by 0145's backfill, and dropping it would blank their ชั้นปี.)
 *
 * @param {object} stored    the row as the server last returned it
 * @param {string} typedSid  the รหัสนักศึกษา currently in the box
 */
export function yearBasis(stored, typedSid) {
  const typed = String(typedSid ?? '').trim();
  const was = String(stored?.student_id ?? '').trim();
  if (typed === was) return { ...stored };
  return {
    student_id: typed,
    // The offset travels: it is a difference, and "one year behind my รุ่น" means
    // the same thing against either base. The COHORT does not.
    year_offset: stored?.year_offset ?? null,
  };
}

/**
 * Turn a ชั้นปี a HUMAN PICKED into the offset to store.
 *
 * The chooser shows real years (1–6) because that is what people think in; what
 * it saves is the gap between the pick and the computation. Picking exactly the
 * computed year stores null — "no adjustment" — rather than 0, so `self_edited`
 * never claims an edit that no reader could see.
 *
 * @returns {number|null} the offset, or null for "exactly as computed".
 */
export function offsetForPickedYear(rec, picked, now = new Date()) {
  const base = studyYear({ ...rec, year_offset: 0 }, now);
  const want = Number(picked);
  if (base === null || !Number.isFinite(want)) return null;
  const diff = want - base;
  return diff === 0 ? null : diff;
}
