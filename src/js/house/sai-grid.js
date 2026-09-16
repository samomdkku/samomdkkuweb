// ==============================================
// สาย GRID — one รุ่น at a time, laid out the way a year admin actually files
// their students: by สาย, not as a flat list.
//
// REQUESTED (owner, 2026-09-15): "like how the file has it — e.g. MD50 list
// from สาย 001, 002… and highlight in colour what information is missing.
// Like this สาย has nobody, data missing, error etc." Spec'd in
// docs/HOUSE-YEAR-HANDOVER.md §(d) before this file was written.
//
// PURE. No DOM, no network, no clock. Reuses `groupOccupantsByCohort` from
// ./gaps.js (the SAME per-รุ่น, per-สาย grouping the ข้อมูลไม่ครบ audit
// computes) and `FIELDS`/`has` from ./census.js (the SAME per-field
// completeness rule ความครบของข้อมูลรายช่อง counts) — this module invents no
// new definition of "complete" or "which รุ่น a person is in", per
// `.claude/rules/mistakes.md` class 6 (two implementations of one rule drift).
//
// STATE PRIORITY, one per cell, WORST WINS when a สาย has more than one
// occupant — reusing gaps.js's OWN two-tone split of a held row rather than
// inventing a third interpretation of it:
//   held_admin  (gaps.js `held_admin`, tone `act`)   — no รหัส or no ชื่อ in
//               the file; nobody but an admin can supply what's missing.
//   held_self   (gaps.js `held_self`, tone `tell`)   — has รหัส AND ชื่อ; the
//               person can self-claim by signing in. Less severe than
//               held_admin ON PURPOSE — gaps.js already colours these two
//               groups differently and this grid must not collapse them into
//               one, which would make a self-fixable row look as urgent as
//               one nobody but an admin can touch.
//   incomplete  (a `students` row with a blank FIELDS entry — noSai/noName/
//               noNick etc.), tone `watch`.
//   ok          every FIELDS entry present, no tone (healthy default).
//   empty       no occupant at all claims this สาย — tone `setup`, exactly
//               `gaps.js`'s own `sai_empty` guard: computed from
//               [...students, ...held], never `students` alone, so a held
//               row (real person, missing only an address) never reads as a
//               hole. See gaps.js's own comment on this — a warning that
//               fires on the healthy case is worse than none.
//
// AVOIDING THE 2026-09-15 DEFECT (docs/mistakes/frontend-ui.md, "a label
// claims something about every case it covers"; the label audit in
// docs/state/agent-notes/2026-09-15-label-audit.md found three more sites of
// the same shape). Every state name here is named for what the code CHECKED,
// not for an inferred cause:
//   - "held" cells say "ไม่มี kkumail" (literally true of every row in the
//     held table — that IS the split criterion `student_import_unresolved`
//     uses) rather than "ไม่มีรหัสนักศึกษาในไฟล์" (only true of the
//     held_admin subset — Finding 1/2/3 of the audit).
//   - the `missing` list on each occupant is a PER-ROW check (`FIELDS`
//     filtered by `!has(...)` on THAT row), never a group-level claim, so
//     naming the exact fields is safe — it is what was tested, for that one
//     row, not a generalisation over a population that can't support it.
//   - "ว่าง" (empty) is never asserted as "ไม่เคยส่งมาเลย" (never sent) —
//     the grid cannot see the file, only the database, so it says only that
//     no occupant currently claims the สาย.
// ==============================================
import { FIELDS, has } from './census.js';
import { groupOccupantsByCohort } from './gaps.js';
import { houseOf } from './fields.js';

export const CELL = {
  empty: 'empty',
  ok: 'ok',
  incomplete: 'incomplete',
  heldSelf: 'held_self',
  heldAdmin: 'held_admin',
};

// Worst-first. A สาย with more than one occupant takes the worst state any of
// them is in — the DUPLICATE flag (below) is what tells a reader there is
// more than one person to look at, so no information is lost by collapsing.
const SEVERITY = [CELL.heldAdmin, CELL.heldSelf, CELL.incomplete, CELL.ok];

const saiOf = (r) => r.sai_code || r.sai || '';
const personName = (r) => [r.first_name_th, r.last_name_th].filter(Boolean).join(' ').trim();

function occupantsByCohortAndSai(d) {
  const held = (d.held || []).filter((h) => !h.resolved_at);
  const heldSet = new Set(held);
  const occupants = [...(d.students || []), ...held];
  const byCohort = groupOccupantsByCohort(occupants);
  return { byCohort, heldSet };
}

/** Every รุ่น label that has at least one occupant with a สาย — the picker's
 *  options. Sorted so MD49 < MD50 < MD51, matching cohortLabel()'s own
 *  zero-padded-year shape. */
export function listGridCohorts(d = {}) {
  const { byCohort } = occupantsByCohortAndSai(d);
  return [...byCohort.keys()].sort();
}

/**
 * @param {object} d        the same {students, held} shape gaps.js/census.js take
 * @param {string} cohort   a รุ่น label from listGridCohorts(), e.g. "MD50"
 * @returns {{cohort:string, max:number, cells:object[]}} cells run 001..max,
 *   `cells` is empty when the รุ่น has no occupant at all (nothing to grid).
 */
export function computeSaiGrid(d = {}, cohort) {
  const { byCohort, heldSet } = occupantsByCohortAndSai(d);
  const rows = byCohort.get(cohort) || [];
  if (!rows.length) return { cohort, max: 0, cells: [] };

  const bySai = new Map();
  for (const r of rows) {
    const n = Number(saiOf(r));
    if (!Number.isFinite(n) || n <= 0) continue;
    if (!bySai.has(n)) bySai.set(n, []);
    bySai.get(n).push(r);
  }
  if (!bySai.size) return { cohort, max: 0, cells: [] };
  const max = Math.max(...bySai.keys());

  const cells = [];
  for (let n = 1; n <= max; n += 1) {
    const sai = String(n).padStart(3, '0');
    const occs = bySai.get(n) || [];
    if (!occs.length) {
      cells.push({ sai, house: houseOf(sai), state: CELL.empty, duplicate: false, occupants: [] });
      continue;
    }
    const occupants = occs.map((r) => {
      const isHeld = heldSet.has(r);
      const missing = FIELDS.filter((f) => !has(f.get(r))).map((f) => f.label);
      let state;
      if (isHeld) state = (!r.student_id || !r.first_name_th) ? CELL.heldAdmin : CELL.heldSelf;
      else state = missing.length ? CELL.incomplete : CELL.ok;
      return { name: personName(r) || r.kkumail || '(ไม่มีชื่อ)', isHeld, missing, state };
    });
    const worst = SEVERITY.find((s) => occupants.some((o) => o.state === s)) || CELL.ok;
    cells.push({ sai, house: houseOf(sai), state: worst, duplicate: occs.length > 1, occupants });
  }
  return { cohort, max, cells };
}
