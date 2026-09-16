// ==============================================
// sai-grid.test.js — the นักศึกษา-tab สาย grid, per รุ่น.
//
// Same fixture shapes as gaps.test.js on purpose: this module reuses
// gaps.js's own grouping, so a fixture that exercises one exercises the other.
// ==============================================
import { describe, it, expect } from 'vitest';
import { computeSaiGrid, listGridCohorts, CELL } from './sai-grid.js';
import { splitHeld } from './gaps.js';

const YEAR = { MD49: 2564, MD50: 2565, MD51: 2566 };
const student = (sai, cohort, extra = {}) => ({
  id: `s${sai}${cohort}`, kkumail: `x${sai}.${cohort}@kkumail.com`,
  student_id: `${cohort - 1900}30700${sai}-1`,
  first_name_th: 'ก', last_name_th: 'ข', nickname: 'ค',
  major: 'MD', sai_code: String(sai).padStart(3, '0'), cohort_year: cohort,
  ...extra,
});
const heldRow = (sai, extra = {}) => ({
  id: `h${sai}`, sai: String(sai).padStart(3, '0'),
  student_id: '653070001-1', first_name_th: 'ง', last_name_th: 'จ',
  cohort_year: YEAR.MD50, reason: 'no_kkumail', resolved_at: null, ...extra,
});
const full = (n, cohort) => Array.from({ length: n }, (_, i) => student(i + 1, cohort));
const bySai = (grid, sai) => grid.cells.find((c) => c.sai === sai);

describe('listGridCohorts', () => {
  it('lists every รุ่น that has at least one occupant with a สาย, sorted', () => {
    const cohorts = listGridCohorts({ students: [...full(2, YEAR.MD51), ...full(2, YEAR.MD49)] });
    expect(cohorts).toEqual(['MD49', 'MD51']);
  });

  it('is empty for a system with no placed occupant', () => {
    expect(listGridCohorts({})).toEqual([]);
    expect(listGridCohorts({ students: [student(1, YEAR.MD49, { sai_code: null })] })).toEqual([]);
  });
});

describe('computeSaiGrid — the healthy shape', () => {
  it('a complete รุ่น reports every cell "ok", none held, none duplicate', () => {
    const grid = computeSaiGrid({ students: full(5, YEAR.MD49) }, 'MD49');
    expect(grid.max).toBe(5);
    expect(grid.cells).toHaveLength(5);
    expect(grid.cells.every((c) => c.state === CELL.ok)).toBe(true);
    expect(grid.cells.every((c) => !c.duplicate)).toBe(true);
  });

  it('an unknown or empty รุ่น returns no cells, not a grid full of "empty"', () => {
    expect(computeSaiGrid({ students: full(3, YEAR.MD49) }, 'MD99')).toEqual({
      cohort: 'MD99', max: 0, cells: [],
    });
    expect(computeSaiGrid({}, 'MD49')).toEqual({ cohort: 'MD49', max: 0, cells: [] });
  });
});

describe('the "nobody here" state', () => {
  it('a สาย with no student AND no held row is "empty"', () => {
    const students = full(5, YEAR.MD50).filter((s) => s.sai_code !== '003');
    const grid = computeSaiGrid({ students }, 'MD50');
    expect(bySai(grid, '003').state).toBe(CELL.empty);
    expect(bySai(grid, '003').occupants).toEqual([]);
  });

  // ⛔ THE REGRESSION gaps.js already guards against, one level up: a held row
  // OCCUPIES its สาย. If the grid checked `students` alone it would paint a
  // real (if address-less) person's สาย as "nobody here".
  it('a held row on an otherwise-empty สาย is NOT "empty"', () => {
    const students = full(5, YEAR.MD50).filter((s) => s.sai_code !== '003');
    const grid = computeSaiGrid({ students, held: [heldRow(3)] }, 'MD50');
    expect(bySai(grid, '003').state).not.toBe(CELL.empty);
    expect(bySai(grid, '003').occupants).toHaveLength(1);
  });
});

describe('held rows split the same way gaps.js splits them', () => {
  it('a held row missing รหัส or ชื่อ is held_admin — nobody but an admin can fix it', () => {
    const grid = computeSaiGrid({ held: [heldRow(1, { student_id: null })] }, 'MD50');
    expect(bySai(grid, '001').state).toBe(CELL.heldAdmin);
    expect(bySai(grid, '001').occupants[0].isHeld).toBe(true);
  });

  it('a held row WITH both รหัส and ชื่อ is held_self — less severe, self-claimable', () => {
    const grid = computeSaiGrid({ held: [heldRow(1)] }, 'MD50');
    expect(bySai(grid, '001').state).toBe(CELL.heldSelf);
  });

  it('held_admin outranks held_self when both share a สาย (worst wins)', () => {
    const grid = computeSaiGrid({
      held: [heldRow(1, { id: 'a', student_id: null }), heldRow(1, { id: 'b' })],
    }, 'MD50');
    const cell = bySai(grid, '001');
    expect(cell.state).toBe(CELL.heldAdmin);
    expect(cell.duplicate).toBe(true);
    expect(cell.occupants).toHaveLength(2);
  });

  // ⛔ DIFFERENTIAL, not a hand-picked example: an earlier version of this file
  // reimplemented `!student_id || !first_name_th` inline instead of calling
  // `splitHeld()`, agreeing with it only by coincidence (both used plain
  // truthiness). This pins every held row's grid classification against
  // `splitHeld()`'s OWN output, so an import that quietly turns back into a
  // paraphrase — or a future change to `splitHeld()`'s predicate that this
  // file doesn't follow — shows up here, not just in gaps.test.js.
  it('classifies every held row exactly as splitHeld() does, not a re-derived copy', () => {
    const rows = [
      heldRow(1, { id: 'a' }),
      heldRow(2, { id: 'b', student_id: null }),
      heldRow(3, { id: 'c', first_name_th: '' }),
      heldRow(4, { id: 'd', student_id: '', first_name_th: '' }),
    ];
    const { heldAdmin } = splitHeld(rows);
    const adminIds = new Set(heldAdmin.map((r) => r.id));
    const grid = computeSaiGrid({ held: rows }, 'MD50');
    for (const r of rows) {
      const cell = bySai(grid, String(r.sai));
      const expected = adminIds.has(r.id) ? CELL.heldAdmin : CELL.heldSelf;
      expect(cell.state).toBe(expected);
    }
  });
});

describe('a completed student row vs one missing a field', () => {
  it('missing ชื่อเล่น alone is still "incomplete" — the grid counts the same FIELDS census.js does', () => {
    const grid = computeSaiGrid({ students: [student(1, YEAR.MD49, { nickname: null })] }, 'MD49');
    const cell = bySai(grid, '001');
    expect(cell.state).toBe(CELL.incomplete);
    expect(cell.occupants[0].missing).toEqual(['ชื่อเล่น']);
  });

  it('the missing list names every field actually absent on THAT row, not a guess', () => {
    const grid = computeSaiGrid({
      students: [student(1, YEAR.MD49, { first_name_th: '', last_name_th: '' })],
    }, 'MD49');
    expect(bySai(grid, '001').occupants[0].missing).toEqual(['ชื่อ', 'นามสกุล']);
  });

  it('incomplete outranks ok, but a held row outranks incomplete', () => {
    const students = [student(2, YEAR.MD49, { nickname: null })];
    const held = [heldRow(2, { student_id: null, cohort_year: YEAR.MD49 })];
    const grid = computeSaiGrid({ students, held }, 'MD49');
    expect(bySai(grid, '002').state).toBe(CELL.heldAdmin);
  });
});

describe('duplicates', () => {
  it('two students of the same รุ่น on one สาย are flagged duplicate, both kept', () => {
    const students = [...full(3, YEAR.MD49), student(2, YEAR.MD49, { id: 'dup', first_name_th: 'ฉ' })];
    const grid = computeSaiGrid({ students }, 'MD49');
    const cell = bySai(grid, '002');
    expect(cell.duplicate).toBe(true);
    expect(cell.occupants).toHaveLength(2);
  });

  it('the SAME สาย number in a DIFFERENT รุ่น is not a duplicate — สาย is per-รุ่น', () => {
    const students = [...full(3, YEAR.MD49), ...full(3, YEAR.MD50)];
    const md49 = computeSaiGrid({ students }, 'MD49');
    const md50 = computeSaiGrid({ students }, 'MD50');
    expect(md49.cells.every((c) => !c.duplicate)).toBe(true);
    expect(md50.cells.every((c) => !c.duplicate)).toBe(true);
  });
});

describe('house comes from the same rule as everywhere else', () => {
  it('a cell states the บ้าน its สาย maps to (last digit)', () => {
    const grid = computeSaiGrid({ students: full(7, YEAR.MD49) }, 'MD49');
    expect(bySai(grid, '007').house).toBe(7);
    expect(bySai(grid, '003').house).toBe(3);
  });
});
