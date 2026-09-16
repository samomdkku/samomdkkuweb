// ==============================================
// house-year-sheets.test.js — the year-admin CSV shape, pinned against
// fixtures. No database: this only proves what buildYearSheets()/toCsv() do
// with rows shaped like the ones tools/house-year-sheets.mjs fetches.
// ==============================================
import { describe, it, expect } from 'vitest';
import { buildYearSheets, toCsv, HEADER } from './house-year-sheets.mjs';

// MD49 = 2564, MD50 = 2565 (COHORT_EPOCH 2515 — src/js/study-year.js).
const student = (extra = {}) => ({
  student_id: '659999999-9', first_name_th: 'สมชาย', last_name_th: 'ใจดี',
  nickname: 'ชาย', sai_code: '005', cohort_year: 2565, kkumail: 'somchai@kkumail.com',
  ...extra,
});
const heldRow = (extra = {}) => ({
  id: 'h1', student_id: null, first_name_th: null, last_name_th: null,
  sai: '010', cohort_year: 2565, resolved_at: null,
  ...extra,
});

describe('buildYearSheets — placement', () => {
  it('a normal student row lands in its รุ่น tab as ปกติ, with kkumail shown', () => {
    const { sheets } = buildYearSheets({ students: [student()], held: [] });
    expect([...sheets.keys()]).toEqual(['MD50']);
    const [row] = sheets.get('MD50');
    expect(row.status).toBe('ปกติ');
    expect(row.kkumail).toBe('somchai@kkumail.com');
    expect(row.studentId).toBe('659999999-9');
    expect(row.house).toBe('5'); // last digit of สาย 005
  });

  it('a held row with no รหัสนักศึกษา or ชื่อ is heldAdmin, never shows kkumail', () => {
    const held = heldRow({ id: 'h1' });
    const { sheets } = buildYearSheets({ students: [], held: [held] });
    const [row] = sheets.get('MD50');
    expect(row.status).toBe('ค้างนำเข้า (ไม่มี kkumail)');
    expect(row.kkumail).toBe('');
    expect(row.studentId).toBe('');
  });

  it('a held row with both รหัสนักศึกษา and ชื่อ is heldSelf, distinct wording', () => {
    const held = heldRow({ id: 'h2', student_id: '659888888-8', first_name_th: 'สมหญิง' });
    const { sheets } = buildYearSheets({ students: [], held: [held] });
    const [row] = sheets.get('MD50');
    expect(row.status).toBe('ยืนยันตัวตนเองได้แล้ว รอเข้าระบบ');
    expect(row.kkumail).toBe('');
  });

  // A held row's only nickname source is `nickname_imported` (the file's own
  // column, per 0188 — held rows have no `nickname`/`nickname_self`, those are
  // self-service fields on `students`). §a's whole justification for asking a
  // year admin at all is "they know their own รุ่น's people by face and by
  // ชื่อเล่น" — a query that forgets to select it silently blanks the one
  // column that makes the sheet legible for exactly the held rows it exists to
  // help with. Caught live tonight (the CLI's SQL omitted it); this pins it at
  // the fixture level, the layer that DOES run without a database.
  it("a held row's ชื่อเล่น comes from nickname_imported, the same accessor FIELDS uses everywhere else", () => {
    const held = heldRow({
      id: 'h5', student_id: '659888888-8', first_name_th: 'สมหญิง', nickname_imported: 'หญิง',
    });
    const { sheets } = buildYearSheets({ students: [], held: [held] });
    expect(sheets.get('MD50')[0].nickname).toBe('หญิง');
  });

  it('resolved held rows are excluded — they are no longer held', () => {
    const held = heldRow({ id: 'h3', resolved_at: '2026-09-01T00:00:00Z' });
    const { sheets, unplaced } = buildYearSheets({ students: [], held: [held] });
    expect(sheets.size).toBe(0);
    expect(unplaced).toEqual([]);
  });

  it('a held row with neither รหัสนักศึกษา nor cohort_year cannot be placed — it is unplaced, not dropped', () => {
    const held = heldRow({ id: 'h4', cohort_year: null });
    const { sheets, unplaced } = buildYearSheets({ students: [], held: [held] });
    expect(sheets.size).toBe(0);
    expect(unplaced).toHaveLength(1);
    expect(unplaced[0].status).toBe('ค้างนำเข้า (ไม่มี kkumail)');
  });

  it('splits students across รุ่น into separate tabs', () => {
    const { sheets } = buildYearSheets({
      students: [student({ cohort_year: 2564, student_id: '649999999-9' }), student({ cohort_year: 2565 })],
      held: [],
    });
    expect([...sheets.keys()].sort()).toEqual(['MD49', 'MD50']);
  });

  it('sorts a tab by สาย ascending, blank สาย last', () => {
    const s1 = student({ sai_code: '020', student_id: '659999999-9', last_name_th: 'ก' });
    const s2 = student({ sai_code: '003', student_id: '659999998-8', last_name_th: 'ข' });
    const s3 = student({ sai_code: '', student_id: '659999997-7', last_name_th: 'ค' });
    const { sheets } = buildYearSheets({ students: [s1, s2, s3], held: [] });
    const rows = sheets.get('MD50');
    expect(rows.map((r) => r.sai)).toEqual(['003', '020', '']);
  });
});

describe('buildYearSheets — blank-cell rule', () => {
  it('column 9 (หมายเหตุ) is always blank on generation — it is filled in later, not by this tool', () => {
    const { sheets } = buildYearSheets({ students: [student()], held: [] });
    expect(sheets.get('MD50')[0].note).toBe('');
  });

  it('a student missing ชื่อเล่น gets a blank cell, not a placeholder string', () => {
    const s = student({ nickname: null, nickname_self: null, nickname_imported: null });
    const { sheets } = buildYearSheets({ students: [s], held: [] });
    expect(sheets.get('MD50')[0].nickname).toBe('');
  });

  it('an unresolvable สาย (not 3 digits) yields a blank บ้าน, not a wrong guess', () => {
    const s = student({ sai_code: '' });
    const { sheets } = buildYearSheets({ students: [s], held: [] });
    expect(sheets.get('MD50')[0].house).toBe('');
  });
});

describe('CSV shape', () => {
  it('header matches the nine columns of HOUSE-YEAR-HANDOVER.md §b, in order', () => {
    expect(HEADER).toEqual([
      'รหัสนักศึกษา', 'ชื่อ (จากระบบ)', 'นามสกุล (จากระบบ)', 'ชื่อเล่น',
      'สาย', 'บ้าน', 'สถานะ', 'kkumail (ถ้ามีในระบบ)', 'หมายเหตุ (เขียนที่นี่ได้)',
    ]);
  });

  it('renders one header line plus one line per row, comma-joined', () => {
    const { sheets } = buildYearSheets({ students: [student()], held: [] });
    const csv = toCsv(sheets.get('MD50'));
    const lines = csv.trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe(HEADER.join(','));
    expect(lines[1]).toBe('659999999-9,สมชาย,ใจดี,ชาย,005,5,ปกติ,somchai@kkumail.com,');
  });

  it('quotes a cell that contains a comma, and escapes an embedded quote', () => {
    const s = student({ last_name_th: 'ใจดี, มีสุข "เก่ง"' });
    const { sheets } = buildYearSheets({ students: [s], held: [] });
    const csv = toCsv(sheets.get('MD50'));
    expect(csv).toContain('"ใจดี, มีสุข ""เก่ง"""');
  });
});
