// ==============================================
// PROJECTS SAMO DEPTS — ฝ่ายสโม tags on a โครงการ (migration 0212).
//
// The allowed values are VS_DEPTS (../team-vocab.js) — the SAME list the VS
// desk already filters by, not a second taxonomy (mistakes class 6). The SQL
// side (0212's set_project_samo_depts) carries its own copy of this list;
// samo-depts.test.js parses that migration and asserts it EQUALS SAMO_DEPT_
// VALUES, so the two cannot drift apart silently.
//
// Filtering logic lives here, pure and tested, so the admin inbox, the
// public mirror and every card/list renderer ask the SAME function — a card
// and a list row answering the filter differently is the recurring bug this
// repo keeps a class for (mistakes class 6).
// ==============================================
import { VS_DEPTS, VS_DEPT_LABEL } from '../team-vocab.js';

export const SAMO_DEPT_VALUES = VS_DEPTS.map((d) => d.value);

/** The tags a โครงการ carries, normalised to an array (never null/undefined,
 *  never holding an empty string — old rows written before this column
 *  existed default to '{}', and a direct PATCH could in principle smuggle
 *  one in). */
export function projectSamoDepts(project) {
  return Array.isArray(project?.samo_depts) ? project.samo_depts.filter(Boolean) : [];
}

/** Does this โครงการ match the selected ฝ่ายสโม filter?
 *  An EMPTY selection means "no filter" — every โครงการ matches, including
 *  one carrying no tags at all. A non-empty selection is OR across the
 *  selected values: a โครงการ tagged with ANY of them matches; one with no
 *  tags, or only tags outside the selection, does not. */
export function projectMatchesSamoDepts(project, selected) {
  if (!Array.isArray(selected) || selected.length === 0) return true;
  const depts = projectSamoDepts(project);
  if (depts.length === 0) return false;
  return depts.some((d) => selected.includes(d));
}

/** Display label for one tag value. An unknown value (old data, or a ฝ่าย
 *  renamed/removed from VS_DEPTS since the tag was set) falls back to the
 *  raw value instead of disappearing — a tag a human set must keep
 *  rendering even after the list it came from changes underneath it. */
export function samoDeptLabel(value) {
  return VS_DEPT_LABEL[value] || value;
}
