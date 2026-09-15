// ==============================================
// HOUSE CENSUS — where every number on this screen comes from, and which
// population it counts.
//
// REPORTED, 2026-09-15: *"what do you mean นักศึกษาทั้งหมด 1,611, why in
// การตรวจสอบข้อมูลของนักศึกษา it shows 1,696 คน. does the ยังนำเข้าไม่ได้ 165 and
// ข้อมูลไม่ครบ 13 included in 1611 or 1696 or include in what."*
//
// Both numbers were CORRECT and the screen was still unreadable, which is the
// interesting part. ระบบบ้าน counts three different populations and showed
// totals from all three side by side, each labelled as if it were "everyone":
//
//   1,776  every person the roster file named      = students ∪ held
//   1,611  those it could place    (`students`)    ← "นักศึกษาทั้งหมด"
//     165  those it could not      (`student_import_unresolved`)
//   1,696  every human the system knows (`people`) ← "การตรวจสอบข้อมูล"
//          = 1,611 students + 85 ทีม SAMO members who are not students
//
// So 165 is NOT inside 1,611 (they have no student row) and NOT inside 1,696
// (they have no `people` row either — a held seat is a line from a file, not an
// account). And the 13 in ข้อมูลไม่ครบ is not a fourth group at all: it is the
// admin-owned SUBSET of those same 165. 13 + 152 = 165.
//
// A reader cannot be expected to derive that. When two totals on one screen
// count different things, the screen owes them the arithmetic — so this module
// computes the reconciliation and the UI prints it, instead of printing four
// bare numbers and hoping.
//
// PURE. No DOM, no network. Everything comes from what the pane already loaded,
// so this adds no query and cannot disagree with the tabs it explains.
// ==============================================

/** students say `sai_code`; a held row says `sai`. One accessor — same reason as gaps.js. */
const saiOf = (r) => r.sai_code || r.sai || '';
const has = (v) => typeof v === 'string' ? v.trim() !== '' : v != null && v !== '';

/** A ชื่อเล่น can arrive from the file or be typed by the person; either counts. */
const nickOf = (r) => r.nickname || r.nickname_self || r.nickname_imported || '';

/**
 * THE FIVE FIELDS THE OWNER NAMED — "ชื่อ, นามสกุล, ชื่อเล่น, รหัสนักศึกษา, สาย".
 *
 * Order is theirs, not alphabetical: it is the order the fields appear on a row,
 * which is the order somebody checking a person reads them in.
 */
export const FIELDS = [
  { key: 'first_name_th', label: 'ชื่อ', get: (r) => r.first_name_th },
  { key: 'last_name_th', label: 'นามสกุล', get: (r) => r.last_name_th },
  { key: 'nickname', label: 'ชื่อเล่น', get: nickOf, optional: true },
  { key: 'student_id', label: 'รหัสนักศึกษา', get: (r) => r.student_id },
  { key: 'sai', label: 'สาย', get: saiOf },
];

/**
 * @param {object} d
 * @param {object[]} d.students        rows from fetchStudents()
 * @param {object[]} d.held            rows from fetchUnresolved()
 * @param {number}   d.registryPeople  `people` from identity_check_summary() —
 *                                     the population การตรวจสอบข้อมูล counts
 */
export function computeCensus(d = {}) {
  const students = d.students || [];
  const held = (d.held || []).filter((h) => !h.resolved_at);

  // The split the ข้อมูลไม่ครบ tab already uses, recomputed from the same rule
  // so the two can never drift: a held row is self-claimable only with BOTH a
  // รหัสนักศึกษา and a ชื่อ, because that is the pair claim_my_student_seat
  // matches on.
  const heldSelf = held.filter((h) => has(h.student_id) && has(h.first_name_th));
  const heldAdmin = held.filter((h) => !has(h.student_id) || !has(h.first_name_th));

  const roster = students.length + held.length;
  const registry = Number(d.registryPeople || 0);
  // ⚠️ Derived by SUBTRACTION, so it is only meaningful when the registry count
  // actually arrived. `identity_check_summary()` is behind its own permission
  // and the pane tolerates it failing; a 0 there would otherwise render as
  // "-1,611 ทีม SAMO members", a confident wrong number. null = "not known".
  const teamOnly = registry ? Math.max(registry - students.length, 0) : null;

  return {
    roster,
    students: students.length,
    held: held.length,
    heldSelf: heldSelf.length,
    heldAdmin: heldAdmin.length,
    registry,
    teamOnly,
    fields: fieldHealth(students, held),
  };
}

/**
 * Per-field completeness, counted SEPARATELY for the two populations.
 *
 * ⛔ NOT SUMMED. Adding "3 students missing a ชื่อเล่น" to "9 held rows missing
 * one" produces 12 of nothing: the two groups are fixed by different people
 * through different screens, and one of them has no account to fix anything
 * with. Merging them is the same mistake the screen already made once at the
 * level of totals.
 */
export function fieldHealth(students = [], held = []) {
  return FIELDS.map((f) => {
    const inStudents = students.filter((r) => !has(f.get(r)));
    const inHeld = held.filter((r) => !has(f.get(r)));
    return {
      key: f.key,
      label: f.label,
      optional: !!f.optional,
      students: inStudents.length,
      held: inHeld.length,
      studentsTotal: students.length,
      heldTotal: held.length,
      ok: inStudents.length === 0 && inHeld.length === 0,
    };
  });
}
