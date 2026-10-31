// node-kind.js — what a `team_nodes.kind` may be, and what it MEANS.
//
// TWO kinds, not three. The admin used to offer ฝ่าย (division) / แผนก
// (department) / ตำแหน่ง (role), and the middle one never earned its place:
// every one of the 78 rows that carried it was a CONTAINER named "ฝ่าย …"
// (measured 2026-08-15 — the four exceptions, "รพ. ขอนแก่น" and friends, are
// containers too), it differed from a ฝ่าย only in the icon, and no code
// anywhere branched on it. A vocabulary word that nothing reads is a word that
// only creates disagreement about which one to pick.
//
// So: a node is either a UNIT (ฝ่าย) or a SEAT (ตำแหน่ง), and that distinction
// now CARRIES WEIGHT — the public chart orders siblings by it and the
// "แสดงถึง" rungs are defined in terms of it. See org-rung.js `orderChildren`.
//
// `department` is still ACCEPTED on read and folded into ฝ่าย. Migration 0151
// rewrote every live and archived row, but a browser holding the previous
// bundle, an export file taken before it, and any hand-edited import can all
// still say `department` — and a kind this code cannot classify would sort and
// expand as a ตำแหน่ง, i.e. wrongly. Read is lenient, write is normalised.

/** The only kinds a writer may store. Anything else is legacy input. */
export const NODE_KINDS = ['division', 'role'];

/** ฝ่าย — a unit that contains other things. Lenient: folds the retired
 *  `department` in, so old data still reads as the unit it always was. */
export function isDivision(kind) {
  return kind === 'division' || kind === 'department';
}

/** What to WRITE. Anything not recognisably a ฝ่าย is a ตำแหน่ง, which is also
 *  the column's own default. */
export function normalizeKind(kind) {
  return isDivision(kind) ? 'division' : 'role';
}
