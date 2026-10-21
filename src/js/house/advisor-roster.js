// ==============================================
// advisor-roster.js — "show me every นักศึกษา under this อาจารย์", as data.
//
// REQUESTED (owner, 2026-10-20): an อาจารย์ wants to pick an อาจารย์ by name —
// typed, not hunted for in a tab — and see all of their นักศึกษา, organised.
//
// WHO IS "UNDER" AN อาจารย์ IS NOT STORED. An อาจารย์ looks after สาย
// (`sai_advisors`), and a student belongs to a สาย (`students.sai_code`), so the
// answer is the join and nothing else. There is deliberately no advisor_id on a
// student: a second copy would drift the first time a สาย changed hands
// (mistakes.md class 6).
//
// ALSO (owner, 2026-10-21): the same page shows the whole บ้าน — every นักศึกษา
// in it, and the อาจารย์ร่วมบ้าน — with the บ้าน read from the caller's
// `houseOfSai` (the database column), never decided here.
//
// PURE. No DOM, no Supabase — index.js renders what this returns, and
// advisor-roster.test.js pins the grouping.
// ==============================================
import { studyYear, studyYearLabel } from '../study-year.js';

/** The สาย codes an อาจารย์ looks after, sorted, from the nested link rows
 *  `fetchAdvisors()` already loads. */
export function advisorSaiCodes(advisor) {
  return [...new Set((advisor?.sai_advisors || []).map((l) => l.sai_code).filter(Boolean))].sort();
}

/**
 * The อาจารย์ a typed query means.
 *
 * An EXACT name wins outright, so picking "อ.สมชาย" from the suggestion list
 * does not also pull in "อ.สมชายศรี" — and clicking an อาจารย์ elsewhere, which
 * fills the box with their full name, lands on that one person. Anything else
 * is a substring over name / email / ภาควิชา, the same rule the other roster
 * boxes use, so a half-typed name narrows rather than failing.
 */
export function matchAdvisors(advisors, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return [];
  const list = advisors || [];
  const exact = list.filter((a) => String(a.full_name || '').trim().toLowerCase() === q);
  if (exact.length) return exact;
  return list.filter((a) => [a.full_name, a.email, a.dept]
    .some((v) => String(v || '').toLowerCase().includes(q)));
}

/**
 * A ชั้นปี bucket. `studyYearLabel` turns the same number into words; this turns
 * it into something to GROUP and ORDER by: 1–6, then จบแล้ว, then the rows with
 * no รหัส/รุ่น to count from (which are real people, never dropped).
 */
export const YEAR_GRAD = 'grad';
export const YEAR_UNKNOWN = 'unknown';

export function yearKey(student, now = new Date()) {
  const n = studyYear(student, now);
  if (n === null || n < 1) return YEAR_UNKNOWN;
  return n > 6 ? YEAR_GRAD : n;
}

const YEAR_ORDER = (k) => (k === YEAR_GRAD ? 7 : k === YEAR_UNKNOWN ? 8 : k);

/** ชั้นปี in words, for a row or a group. ALWAYS studyYearLabel() — the one
 *  place a number becomes "ปี 3" / "จบแล้ว" (study-year.test.js ratchets it);
 *  this only adds the word for "nothing to count from". */
export function yearText(student, now = new Date()) {
  return studyYearLabel(student, now) || 'ไม่ทราบชั้นปี';
}

/** Youngest first inside a สาย — the order a สาย is read in (น้อง → พี่) — then
 *  by รหัส, then by name, so two people in one year never swap between paints. */
function byYearThenId(now) {
  return (a, b) => (YEAR_ORDER(yearKey(a, now)) - YEAR_ORDER(yearKey(b, now)))
    || String(a.student_id || '').localeCompare(String(b.student_id || ''))
    || String(a.full_name || '').localeCompare(String(b.full_name || ''), 'th');
}

/**
 * One อาจารย์'s นักศึกษา, grouped.
 *
 * `students` is whatever the caller has ALREADY filtered (the roster's other
 * boxes and the graduated switch still apply). Every สาย the อาจารย์ looks after
 * gets a group even when it is empty on screen — "this สาย has nobody" is part
 * of the answer, not a missing row.
 *
 * @param {object} advisor   a row from fetchAdvisors() (with sai_advisors)
 * @param {object[]} students
 * @param {'sai'|'year'} by
 * @returns {{ codes:string[], total:number,
 *             groups:{ key:string|number, students:object[] }[] }}
 */
export function advisorRoster(advisor, students, by = 'sai', now = new Date()) {
  return rosterOf(advisorSaiCodes(advisor), students, by, now);
}

/**
 * The บ้าน an อาจารย์ belongs to: the บ้าน of every สาย they look after.
 * Usually one; an อาจารย์ across two บ้าน belongs to both.
 *
 * `houseOfSai` is the CALLER's: index.js passes `saiHouse`, which reads the
 * database's generated `sais.house_id`. This module never decides a house
 * itself (fields.js — the column is the authority).
 */
export function advisorHouses(advisor, houseOfSai) {
  return [...new Set(advisorSaiCodes(advisor).map(houseOfSai))]
    .filter((h) => h !== null && h !== undefined)
    .sort((a, b) => a - b);
}

/**
 * อาจารย์ร่วมบ้าน: every OTHER อาจารย์ with a สาย in this อาจารย์'s บ้าน, each
 * with the สาย they hold THERE (a สาย of theirs in another บ้าน is not why they
 * are listed). Ordered by their first such สาย, the order the บ้าน is read in.
 */
export function houseMates(advisor, advisors, houseOfSai) {
  const houses = advisorHouses(advisor, houseOfSai);
  if (!houses.length) return [];
  return (advisors || [])
    .filter((o) => o && o.id !== advisor?.id)
    .map((o) => ({
      advisor: o,
      codes: advisorSaiCodes(o).filter((c) => houses.includes(houseOfSai(c))),
    }))
    .filter((m) => m.codes.length)
    .sort((x, y) => x.codes[0].localeCompare(y.codes[0])
      || String(x.advisor.full_name || '').localeCompare(String(y.advisor.full_name || ''), 'th'));
}

/**
 * Every นักศึกษา in this อาจารย์'s บ้าน, grouped like advisorRoster.
 *
 * The สาย listed are the บ้าน's สาย that HAVE someone — a นักศึกษา (from
 * `allStudents`, never the filtered `students`, so searching does not make a
 * สาย vanish) or an อาจารย์. A บ้าน has ~30 สาย codes and listing the empty,
 * unassigned ones would bury the people.
 */
export function houseRoster(advisor, advisors, students, houseOfSai, by = 'sai',
  now = new Date(), allStudents = students) {
  const houses = advisorHouses(advisor, houseOfSai);
  const inHouse = (c) => Boolean(c) && houses.includes(houseOfSai(c));
  const codes = [...new Set([
    ...(allStudents || []).map((s) => s.sai_code),
    ...(advisors || []).flatMap(advisorSaiCodes),
  ])].filter(inHouse).sort();
  return { ...rosterOf(codes, students, by, now), houses };
}

function rosterOf(codes, students, by, now) {
  const mine = (students || []).filter((s) => codes.includes(s.sai_code));
  const sorted = [...mine].sort(byYearThenId(now));

  if (by === 'year') {
    const map = new Map();
    for (const s of sorted) {
      const k = yearKey(s, now);
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(s);
    }
    // Within a year, สาย order — so the year view still reads in the same
    // sequence as the สาย view does.
    const groups = [...map.entries()]
      .sort(([a], [b]) => YEAR_ORDER(a) - YEAR_ORDER(b))
      .map(([key, rows]) => ({
        key,
        // Every row in a bucket shares one ชั้นปี, so its first row names it.
        label: yearText(rows[0], now),
        students: rows.sort((a, b) => String(a.sai_code).localeCompare(String(b.sai_code))
          || String(a.student_id || '').localeCompare(String(b.student_id || ''))),
      }));
    return { codes, total: mine.length, groups };
  }

  return {
    codes,
    total: mine.length,
    groups: codes.map((code) => ({
      key: code,
      students: sorted.filter((s) => s.sai_code === code),
    })),
  };
}
