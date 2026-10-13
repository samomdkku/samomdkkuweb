// ==============================================
// PROJECTS SAMO DEPTS — ฝ่ายสโม tags on a โครงการ (0212, list changed 0215).
//
// The allowed values are the 12 ฝ่าย of หน้าฝ่าย — DEPT_DEFS keys
// (../../data/depts.js: office, admin, … hospital), shown by their titles.
// NOT VS_DEPTS: that is VitalSound's routing list of DESKS (นายกสโม, SE,
// อุปนายกฝ่าย…), which 0212 borrowed and the owner rejected (2026-10-13,
// "it shouldn't have SE"). The SQL side's one copy is public.samo_dept_keys()
// (0215); samo-depts.test.js parses it and asserts it EQUALS DEPT_KEYS.
//
// Filtering logic lives here, pure and tested, so the admin inbox, the
// public mirror and every card/list renderer ask the SAME function — a card
// and a list row answering the filter differently is the recurring bug this
// repo keeps a class for (mistakes class 6).
// ==============================================
import { DEPT_OPTIONS, DEPT_DEFS, deptLabel } from '../../data/depts.js';

/** `[{ value: key, label: title }]`, in หน้าฝ่าย's order — what every chip
 *  row and filter menu in the projects module draws. */
export const SAMO_DEPT_OPTIONS = DEPT_OPTIONS;
export const SAMO_DEPT_VALUES = SAMO_DEPT_OPTIONS.map((d) => d.value);

/** The tags a โครงการ carries, normalised to an array (never null/undefined,
 *  never holding an empty string — old rows written before this column
 *  existed default to '{}', and a direct PATCH could in principle smuggle
 *  one in). */
export function projectSamoDepts(project) {
  return Array.isArray(project?.samo_depts) ? project.samo_depts.filter(Boolean) : [];
}

/** The filter value meaning "no ฝ่าย yet" — never a stored tag (it is not a
 *  DEPT_DEFS key, and samo_dept_keys() would refuse it). */
export const UNTAGGED = '__untagged__';

/** Does this โครงการ match the selected ฝ่ายสโม filter?
 *  An EMPTY selection means "no filter" — every โครงการ matches. A non-empty
 *  selection is OR across what is selected: a ฝ่าย matches a โครงการ tagged
 *  with it, and UNTAGGED matches a โครงการ with no tag at all — so "show what
 *  still needs a ฝ่าย" is one tick, and can be combined with a ฝ่าย. */
export function projectMatchesSamoDepts(project, selected) {
  if (!Array.isArray(selected) || selected.length === 0) return true;
  const depts = projectSamoDepts(project);
  if (depts.length === 0) return selected.includes(UNTAGGED);
  return depts.some((d) => selected.includes(d));
}

/** Display label for one tag value — the ฝ่าย's title. An unknown value
 *  (a key retired since the tag was set) falls back to the raw value instead
 *  of disappearing: a tag a human set must keep rendering. */
export function samoDeptLabel(value) {
  return deptLabel(value);
}

/** Tags a โครงการ carries that are NOT a current ฝ่าย key. The editor
 *  draws a removable chip for each: with no chip, a stale value could never
 *  leave the array, and every later toggle would send it back to an RPC that
 *  refuses unknown values — locking the tags. */
export function staleSamoDepts(project) {
  return projectSamoDepts(project).filter((d) => !SAMO_DEPT_VALUES.includes(d));
}

/** The ฝ่าย's colour token (`--dept-…`, the one its หน้าฝ่าย header uses), or
 *  null for a key that is not a ฝ่าย — the chip then falls back to neutral. */
export function samoDeptColorVar(value) {
  return DEPT_DEFS[value]?.colorVar || null;
}
