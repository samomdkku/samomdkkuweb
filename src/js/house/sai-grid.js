// ==============================================
// สาย GRID — one รุ่น at a time, laid out the way a year admin actually files
// their students: by สาย, not as a flat list.
//
// REQUESTED (owner, 2026-09-15): "like how the file has it — e.g. MD50 list
// from สาย 001, 002… and highlight in colour what information is missing.
// Like this สาย has nobody, data missing, error etc." Spec'd in
// docs/HOUSE-YEAR-HANDOVER.md §(d) before this file was written.
//
// PURE. No DOM, no network, no clock. Reuses `groupOccupantsByCohort`,
// `splitHeld` AND `groupBySaiNumber` from ./gaps.js (the SAME per-รุ่น/per-สาย
// grouping, the SAME held-row admin/self split, and the SAME numeric-สาย
// grouping the ข้อมูลไม่ครบ audit's `sai_gap`/`sai_shared` pair computes —
// IMPORTED calls, not paraphrased predicates, per `.claude/rules/mistakes.md`
// class 6: a second copy of `!student_id || !first_name_th` sat here uncalled
// for one commit, agreeing with `splitHeld` only because nobody had changed
// either copy yet, and this module's own `bySai` map was a THIRD re-typing of
// gaps.js's grouping loop before `groupBySaiNumber` was pulled out to close
// it) and `FIELDS`/`has` from ./census.js (the SAME per-field completeness
// rule ความครบของข้อมูลรายช่อง counts) — this module invents no new
// definition of "complete" or "which รุ่น a person is in".
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
//   empty       no occupant at all claims this สาย, WITHIN the รุ่น's own
//               1..max range — tone `setup`. ⚠️ This is `gaps.js`'s `sai_gap`
//               concept (a hole in one รุ่น's OWN numbering), NOT its
//               `sai_empty` group — that one reads the separate `sais` table
//               (a flat code registry with no cohort column, shared across
//               every รุ่น) and is a different question this grid has no data
//               to ask, since `computeSaiGrid()` is never handed `d.sais`.
//               Computed from [...students, ...held], never `students`
//               alone, so a held row (real person, missing only an address)
//               never reads as a hole. See gaps.js's own comment on this — a
//               warning that fires on the healthy case is worse than none.
//   (duplicate, a separate flag below, is the same population `sai_gap`'s
//   sibling `sai_shared` flags: more than one occupant on one รุ่น's สาย.)
//
// AVOIDING THE 2026-09-15 DEFECT (docs/mistakes/frontend-ui.md, "a label
// claims something about every case it covers"). ⚠️ A label audit that found
// three more sites of this shape exists ONLY on the unmerged sibling branch
// `agent/2026-09-15-real-run` (`docs/state/agent-notes/2026-09-15-label-audit.md`)
// — it 404s on this branch; do not go looking for it here
// (docs/HOUSE-YEAR-HANDOVER.md §d and docs/state/agent-notes/2026-09-16-notes.md
// both note the same gap). Every state name here is named for what the code
// CHECKED, not for an inferred cause:
//   - "held" cells say "ไม่มี kkumail" (literally true of every row in the
//     held table — that IS the split criterion `student_import_unresolved`
//     uses) rather than "ไม่มีรหัสนักศึกษาในไฟล์" (only true of the
//     held_admin subset).
//   - the `missing` list on each occupant is a PER-ROW check (`FIELDS`
//     filtered by `!has(...)` on THAT row), never a group-level claim, so
//     naming the exact fields is safe — it is what was tested, for that one
//     row, not a generalisation over a population that can't support it.
//   - "ว่าง" (empty) is never asserted as "ไม่เคยส่งมาเลย" (never sent) —
//     the grid cannot see the file, only the database, so it says only that
//     no occupant currently claims the สาย.
// ==============================================
import { FIELDS, has } from './census.js';
import { groupOccupantsByCohort, splitHeld, groupBySaiNumber } from './gaps.js';
import { houseOf } from './fields.js';
import { isAnsweredEmpty, followUpLabel } from './follow-up.js';

export const CELL = {
  empty: 'empty',
  ok: 'ok',
  incomplete: 'incomplete',
  heldSelf: 'held_self',
  heldAdmin: 'held_admin',
  // Nobody is on this สาย AND a closed held row says why (ลาออก / ไม่มีคนนี้
  // จริง, 0217). Not a hole: it is the one empty cell somebody has ANSWERED.
  answered: 'answered',
};

// Worst-first. A สาย with more than one occupant takes the worst state any of
// them is in — the DUPLICATE flag (below) is what tells a reader there is
// more than one person to look at, so no information is lost by collapsing.
const SEVERITY = [CELL.heldAdmin, CELL.heldSelf, CELL.incomplete, CELL.ok];

const personName = (r) => [r.first_name_th, r.last_name_th].filter(Boolean).join(' ').trim();

function occupantsByCohortAndSai(d) {
  const held = (d.held || []).filter((h) => !h.resolved_at);
  const heldSet = new Set(held);
  // IMPORTED, not re-derived — see the file header. Object identity is
  // preserved from `held` through `groupOccupantsByCohort`, so membership in
  // this set (not a re-run of the predicate) is what tells a held occupant
  // apart from a held_self one below.
  const heldAdminSet = new Set(splitHeld(held).heldAdmin);
  const occupants = [...(d.students || []), ...held];
  const byCohort = groupOccupantsByCohort(occupants);
  // Closed rows whose answer explains an empty สาย — kept APART from the
  // occupants, so a ลาออก person never makes a สาย look shared with whoever
  // sits there now.
  const answeredByCohort = groupOccupantsByCohort((d.held || []).filter(isAnsweredEmpty));
  return { byCohort, heldSet, heldAdminSet, answeredByCohort };
}

/** Every รุ่น label that has at least one occupant with a สาย — the picker's
 *  options. Sorted so MD49 < MD50 < MD51, matching cohortLabel()'s own
 *  zero-padded-year shape. */
export function listGridCohorts(d = {}) {
  const { byCohort } = occupantsByCohortAndSai(d);
  return [...byCohort.keys()].sort();
}

/**
 * The highest สาย ANY รุ่น reaches. Owner, 2026-10-13: "if md50 max at 200,
 * md49 max at 300, it should show 300 for all" — every รุ่น is drawn on the
 * same 001..N board, so a รุ่น whose numbering stops early SHOWS the สาย it has
 * nobody on, instead of the board silently ending where its last person is.
 */
export function gridMaxAcrossCohorts(d = {}) {
  const { byCohort, answeredByCohort } = occupantsByCohortAndSai(d);
  let max = 0;
  for (const rows of [...byCohort.values(), ...answeredByCohort.values()]) {
    for (const n of groupBySaiNumber(rows).keys()) if (n > max) max = n;
  }
  return max;
}

/**
 * What a person TYPED into the รุ่น box → a label from `cohorts`, or null.
 * Accepts `MD50`, `md50`, `md 50`, `50` and the พ.ศ. it entered, `2565`.
 * Only ever answers with a label that exists, so a half-typed `5` is null
 * (the grid keeps what it was showing) rather than a guess.
 */
export function matchCohortInput(text, cohorts = []) {
  const t = String(text ?? '').trim().toUpperCase().replace(/\s+/g, '');
  if (!t) return null;
  if (cohorts.includes(t)) return t;
  const n = t.replace(/^MD/, '');
  if (!/^\d+$/.test(n)) return null;
  const md = n.length === 4 ? `MD${Number(n) - 2515}` : `MD${n}`;
  return cohorts.includes(md) ? md : null;
}

/**
 * @param {object} d        the same {students, held} shape gaps.js/census.js take
 * @param {string} cohort   a รุ่น label from listGridCohorts(), e.g. "MD50"
 * @param {{max?:number}} [opts]  draw at least to this สาย (gridMaxAcrossCohorts)
 * @returns {{cohort:string, max:number, ownMax:number, cells:object[]}} cells
 *   run 001..max, `cells` is empty when the รุ่น has no occupant at all (nothing
 *   to grid). `ownMax` is this รุ่น's own last occupied สาย.
 */
export function computeSaiGrid(d = {}, cohort, { max: atLeast = 0 } = {}) {
  const { byCohort, heldSet, heldAdminSet, answeredByCohort } = occupantsByCohortAndSai(d);
  const rows = byCohort.get(cohort) || [];
  const answeredBySai = groupBySaiNumber(answeredByCohort.get(cohort) || []);
  const answeredOn = (n) => (answeredBySai.get(n) || []).map((r) => ({
    name: personName(r), label: followUpLabel(r.follow_up),
    notes: [...new Set([r.note, r.file_note].map((v) => String(v ?? '').trim()).filter(Boolean))],
  }));
  if (!rows.length) return { cohort, max: 0, ownMax: 0, cells: [] };

  // IMPORTED, not re-derived — see the file header: the same grouping
  // gaps.js's own sai_gap/sai_shared audit uses, so "nobody here" and
  // "more than one here" can never silently disagree with that panel.
  const bySai = groupBySaiNumber(rows);
  if (!bySai.size) return { cohort, max: 0, ownMax: 0, cells: [] };
  const ownMax = Math.max(...bySai.keys());
  const max = Math.max(ownMax, atLeast);

  const cells = [];
  for (let n = 1; n <= max; n += 1) {
    const sai = String(n).padStart(3, '0');
    const occs = bySai.get(n) || [];
    if (!occs.length) {
      const answered = answeredOn(n);
      cells.push({
        sai, house: houseOf(sai), state: answered.length ? CELL.answered : CELL.empty,
        duplicate: false, occupants: [], answered,
      });
      continue;
    }
    const occupants = occs.map((r) => {
      const isHeld = heldSet.has(r);
      const missing = FIELDS.filter((f) => !has(f.get(r))).map((f) => f.label);
      let state;
      if (isHeld) state = heldAdminSet.has(r) ? CELL.heldAdmin : CELL.heldSelf;
      else state = missing.length ? CELL.incomplete : CELL.ok;
      // What a person SAID about this row — the admin/ฝ่าย remark (`note`,
      // e.g. "ติดต่อไม่ได้") and what the source file carried (`file_note`).
      // Only held rows have them today; read generically so a student-side
      // note shows the day one exists.
      const notes = [...new Set([r.note, r.file_note].map((v) => String(v ?? '').trim()).filter(Boolean))];
      return {
        name: personName(r) || r.kkumail || '(ไม่มีชื่อ)', isHeld, missing, state, notes,
        followUp: isHeld ? followUpLabel(r.follow_up) : '',
      };
    });
    const worst = SEVERITY.find((s) => occupants.some((o) => o.state === s)) || CELL.ok;
    cells.push({
      sai, house: houseOf(sai), state: worst, duplicate: occs.length > 1, occupants, answered: answeredOn(n),
    });
  }
  return { cohort, max, ownMax, cells };
}
