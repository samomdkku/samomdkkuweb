// ============================================================
// census.test.js — the arithmetic the ระบบบ้าน overview promises its reader.
//
// The screen used to print 1,611 · 1,696 · 165 · 13 side by side with no stated
// relationship, and the owner asked the only sensible question: which total is
// each one inside? These pin the answers so the panel cannot drift back into
// four unrelated numbers.
// ============================================================

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { computeCensus, fieldHealth, FIELDS } from './census.js';

const INDEX_SRC = readFileSync(new URL('./index.js', import.meta.url), 'utf8');

/** The real 2026-09-14 shape, measured from production on 2026-09-15. */
const student = (over = {}) => ({
  first_name_th: 'ก', last_name_th: 'ข', nickname_imported: 'เอ',
  student_id: '673070001-1', sai_code: '001', ...over,
});
const heldRow = (over = {}) => ({
  first_name_th: 'ค', last_name_th: 'ง', nickname_imported: 'บี',
  student_id: '673070002-2', sai_code: '002', resolved_at: null, ...over,
});

const REAL = {
  students: [
    ...Array.from({ length: 1585 }, () => student()),
    ...Array.from({ length: 26 }, () => student({ nickname_imported: '' })),
  ],
  held: [
    ...Array.from({ length: 152 }, () => heldRow()),
    ...Array.from({ length: 11 }, () => heldRow({ student_id: '' })),
    ...Array.from({ length: 2 }, () => heldRow({ student_id: '', first_name_th: '', last_name_th: '' })),
  ],
  registryPeople: 1696,
};

describe('the ระบบบ้าน census', () => {
  it('reproduces the numbers the owner was looking at', () => {
    const c = computeCensus(REAL);
    expect(c.students).toBe(1611);
    expect(c.held).toBe(165);
    expect(c.heldSelf).toBe(152);
    expect(c.heldAdmin).toBe(13);
    expect(c.registry).toBe(1696);
    expect(c.teamOnly).toBe(85);
    expect(c.roster).toBe(1776);
  });

  // THE PROPERTY THE SCREEN PROMISES. Every one of these was a question the
  // owner had to ask, and each is now arithmetic a reader can check.
  it('⛔ every group adds up to a total that is actually shown', () => {
    const c = computeCensus(REAL);
    expect(c.heldSelf + c.heldAdmin, 'ข้อมูลไม่ครบ(13) + เจ้าตัวทำได้(152) must BE the held 165 — '
      + 'they are one population split by who can fix it, not two groups').toBe(c.held);
    expect(c.students + c.held, 'นักศึกษาทั้งหมด + ยังนำเข้าไม่ได้ must be the whole roster')
      .toBe(c.roster);
    expect(c.students + c.teamOnly, 'the registry การตรวจสอบข้อมูล counts must be students + '
      + 'ทีม SAMO-only people; if this drifts the two totals on screen stop reconciling')
      .toBe(c.registry);
  });

  it('⛔ the held are OUTSIDE both headline totals — the owner\'s actual question', () => {
    const c = computeCensus(REAL);
    expect(c.held).toBeGreaterThan(0);
    // A held row has no students row and no people row: it is a line from a
    // file, not an account. So it cannot be inside either headline number.
    expect(c.students, 'ยังนำเข้าไม่ได้ must NOT be inside นักศึกษาทั้งหมด').toBe(1611);
    expect(c.registry, 'ยังนำเข้าไม่ได้ must NOT be inside the registry count').toBe(1696);
    expect(c.students + c.held).not.toBe(c.registry);
  });

  it('does not invent a ทีม SAMO count when the registry total did not load', () => {
    // identity_check_summary() is behind its own permission and the pane
    // tolerates it failing. Subtracting from 0 would render "-1,611 ทีม SAMO
    // members" — a confident wrong number, which is worse than a blank.
    expect(computeCensus({ ...REAL, registryPeople: 0 }).teamOnly).toBeNull();
    expect(computeCensus({ ...REAL, registryPeople: undefined }).teamOnly).toBeNull();
  });

  it('counts a ชื่อเล่น from any of its three spellings', () => {
    for (const key of ['nickname', 'nickname_self', 'nickname_imported']) {
      const rows = [student({ nickname_imported: '', [key]: 'ชื่อเล่น' })];
      const nick = fieldHealth(rows, []).find((f) => f.key === 'nickname');
      expect(nick.students, `${key} was not read as a ชื่อเล่น`).toBe(0);
    }
  });

  it('reads สาย from either spelling — students say sai_code, held rows say sai', () => {
    expect(fieldHealth([student({ sai_code: '', sai: '007' })], []).find((f) => f.key === 'sai').students).toBe(0);
    expect(fieldHealth([], [heldRow({ sai_code: '', sai: '007' })]).find((f) => f.key === 'sai').held).toBe(0);
  });

  // ⛔ THE ANTI-DOUBLE-COUNT RULE, which is the whole complaint.
  it('⛔ never merges the two populations into one per-field number', () => {
    const f = fieldHealth(REAL.students, REAL.held);
    const nick = f.find((x) => x.key === 'nickname');
    expect(nick.students).toBe(26);
    expect(nick.held).toBe(0);
    // The shape must keep them apart. A single `count` here would be the same
    // mistake the totals made: two groups, different owners, different screens.
    expect(nick).not.toHaveProperty('count');
    expect(nick.studentsTotal).toBe(1611);
    expect(nick.heldTotal).toBe(165);
    const sid = f.find((x) => x.key === 'student_id');
    expect(sid.students).toBe(0);
    expect(sid.held, 'the 13 with no รหัส are HELD rows, never students').toBe(13);
  });

  it('covers exactly the five fields the owner named, in their order', () => {
    expect(FIELDS.map((f) => f.label)).toEqual(['ชื่อ', 'นามสกุล', 'ชื่อเล่น', 'รหัสนักศึกษา', 'สาย']);
  });

  it('says nothing is wrong when nothing is', () => {
    const f = fieldHealth([student()], [heldRow()]);
    expect(f.every((x) => x.ok)).toBe(true);
  });
});


// ============================================================
// A LABEL CLAIMS SOMETHING ABOUT EVERY CASE IT COVERS (2026-09-15).
//
// REPORTED: *"but ธีรภัทร has been in the file รายชื่อ isn't it, including him in
// สมาชิกทีม SAMO ที่ไม่ได้อยู่ในไฟล์รายชื่อ won't it be misunderstood"*.
//
// It would, and the label was stating the opposite of the truth about him: his
// รหัส, สาย, รุ่น and ชื่อเล่น all came FROM that file — he is held, not absent.
// `teamOnly` is `registry - students`, which is "has an account but no house
// placement" and cannot distinguish "in the file but waiting" from "never in the
// file": a held row has no `people` row to subtract, so both land in the same
// number. The label had invented a cause the arithmetic never checked.
// ============================================================
describe('the census labels only claim what they count', () => {
  it('reads the renderer (a sweep that finds nothing must prove it looked)', () => {
    expect(INDEX_SRC).toContain('censusRow({');
    expect(INDEX_SRC).toContain('c.teamOnly');
  });

  it('⛔ the teamOnly line never claims the person is absent from the file', () => {
    const line = INDEX_SRC.split('\n').find((l) => l.includes('c.teamOnly'));
    expect(line, 'the teamOnly census row disappeared — re-point this guard').toBeTruthy();
    expect(line, [
      `teamOnly is labelled: ${line.trim()}`,
      '',
      'That number is `registry - students` — "has an account but no house',
      'placement". It CANNOT tell "in the file but still held" from "never in the',
      'file", because a held row has no people row to subtract. Saying ไฟล์ in this',
      'label asserts a cause the arithmetic never checked, and it was wrong about a',
      'real person: ธีรภัทร is IN the file, with a สาย, waiting only on a kkumail.',
      'Name the line for what it counts — no สาย, no บ้าน.',
    ].join('\n')).not.toContain('ไฟล์');
  });
});
