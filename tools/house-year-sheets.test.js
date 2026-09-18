// ==============================================
// house-year-sheets.test.js — the year-admin CSV shape, pinned against
// fixtures. No database: this only proves what buildYearSheets()/toCsv() do
// with rows shaped like the ones tools/house-year-sheets.mjs fetches.
// ==============================================
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { buildYearSheets, toCsv, HEADER, priorityOf, PRIORITY, buildSaiIssues, SAI_HEADER } from './house-year-sheets.mjs';

const SOURCE = readFileSync(new URL('./house-year-sheets.mjs', import.meta.url), 'utf8');

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

  // The fixture test above pins the ACCESSOR — it cannot pin the SQL that puts
  // `nickname_imported` on the row in the first place, because a fixture
  // already carries the field by hand. That is exactly how the original bug
  // hid: this suite was green with the CLI's SELECT missing the column.
  // Reintroducing that regression here and re-running confirmed it — 14/14
  // still green — before this test was added. A source-text check is a
  // review, not a proof (mistakes.md class 7), but it is strictly more than
  // the fixture test alone, which caught nothing.
  it("main()'s held-population SELECT names nickname_imported", () => {
    const heldSelect = SOURCE.match(/from public\.student_import_unresolved`\)/);
    expect(heldSelect).not.toBeNull();
    const selectBlock = SOURCE.slice(0, heldSelect.index);
    const lastSelectStart = selectBlock.lastIndexOf('ask(`select');
    expect(selectBlock.slice(lastSelectStart)).toContain('nickname_imported');
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

describe('ปัญหาที่พบ — the error half, not the empty-cell half', () => {
  it('names both people when two share a สาย, each on their own row', () => {
    // บ้าน is the LAST DIGIT of สาย, so a duplicate puts at least one of them
    // in the wrong บ้าน. Same grouping computeGaps's own audit uses.
    const a = student({ student_id: '659999991-1', first_name_th: 'ก', last_name_th: 'หนึ่ง', sai_code: '011' });
    const b = student({ student_id: '659999992-2', first_name_th: 'ข', last_name_th: 'สอง', sai_code: '011' });
    const { sheets } = buildYearSheets({ students: [a, b], held: [] });
    // Found by NAME, not by index: the rows are สาย-then-นามสกุล ordered and
    // Thai collation decides which of the two comes first, which is not what
    // this test is about.
    const rows = sheets.get('MD50');
    const one = rows.find((r) => r.lastName === 'หนึ่ง');
    const two = rows.find((r) => r.lastName === 'สอง');
    expect(one.problems[0]).toContain('สาย 011 ซ้ำกับ');
    expect(one.problems[0]).toContain('ข สอง');
    expect(two.problems[0]).toContain('ก หนึ่ง');
    // an error outranks a merely-optional gap
    expect(priorityOf(one)).toBe(PRIORITY.high);
  });

  it('says nothing about a สาย only one person is on', () => {
    const { sheets } = buildYearSheets({ students: [student()], held: [] });
    expect(sheets.get('MD50')[0].problems).toEqual([]);
  });

  it('flags a person the newest file dropped', () => {
    const s = student({ missing_since: '2026-09-14' });
    const { sheets } = buildYearSheets({ students: [s], held: [] });
    expect(sheets.get('MD50')[0].problems).toEqual(['หายจากไฟล์รายชื่อล่าสุด']);
  });

  it('does NOT put a รุ่น-level skipped สาย on anybody\'s row', () => {
    // "nobody is on สาย 007" is a fact about a รุ่น. Writing it on the nearest
    // person accuses them of something no arithmetic tested — computeGaps
    // reports it per รุ่น and that stays its job.
    const a = student({ student_id: '659999991-1', sai_code: '001' });
    const b = student({ student_id: '659999992-2', sai_code: '009' });
    const { sheets } = buildYearSheets({ students: [a, b], held: [] });
    for (const r of sheets.get('MD50')) expect(r.problems).toEqual([]);
  });
});

describe("_สายมีปัญหา — the faults a person's row cannot hold", () => {
  it('lists a สาย nobody is on, with the รุ่น it is missing from', () => {
    // A hole can only be seen by counting a whole รุ่น at once, and it has no
    // person to hang on — which is why it is a file and not a column.
    const a = student({ student_id: '659999991-1', sai_code: '001' });
    const b = student({ student_id: '659999992-2', sai_code: '003' });
    const rows = buildSaiIssues({ students: [a, b], held: [] });
    const hole = rows.find((r) => r[2] === 'ไม่มีใครอยู่สายนี้');
    expect(hole[0]).toBe('MD50');
    expect(hole[1]).toBe('002');
  });

  it('lists a shared สาย with both names', () => {
    const a = student({ student_id: '659999991-1', first_name_th: 'ก', last_name_th: 'หนึ่ง', sai_code: '001' });
    const b = student({ student_id: '659999992-2', first_name_th: 'ข', last_name_th: 'สอง', sai_code: '001' });
    const rows = buildSaiIssues({ students: [a, b], held: [] });
    const dup = rows.find((r) => String(r[2]).startsWith('สายซ้ำ'));
    expect(dup[1]).toBe('001');
    expect(dup[3]).toContain('ก หนึ่ง');
    expect(dup[3]).toContain('ข สอง');
  });

  it('a held row OCCUPIES its สาย, so it is not a hole', () => {
    // Counting only `students` made the 165 held people read as 165 holes and
    // flagged every รุ่น — a warning that fires on the healthy case.
    const a = student({ student_id: '659999991-1', sai_code: '001' });
    const heldOn2 = { student_id: '659999992-2', first_name_th: 'ข', last_name_th: 'สอง', sai_code: '002', cohort_year: 2565 };
    const b = student({ student_id: '659999993-3', sai_code: '003' });
    const rows = buildSaiIssues({ students: [a, b], held: [heldOn2] });
    expect(rows.filter((r) => r[2] === 'ไม่มีใครอยู่สายนี้')).toEqual([]);
  });

  it('says nothing at all about a complete รุ่น', () => {
    const a = student({ student_id: '659999991-1', sai_code: '001' });
    const b = student({ student_id: '659999992-2', sai_code: '002' });
    expect(buildSaiIssues({ students: [a, b], held: [] })).toEqual([]);
  });

  it('has the four columns the file writes', () => {
    expect(SAI_HEADER).toEqual(['รุ่น', 'สาย', 'ปัญหา', 'รายละเอียด']);
  });
});

describe('CSV shape', () => {
  it('header matches HOUSE-YEAR-HANDOVER.md §b plus the handover columns', () => {
    // §b specified nine columns. ข้อมูลที่ขาด was added when the sheet's PURPOSE
    // was stated out loud — it goes to another team to FILL IN, and a row that
    // does not name what is missing makes that team re-derive the question.
    expect(HEADER).toEqual([
      'รหัสนักศึกษา', 'ชื่อ (จากระบบ)', 'นามสกุล (จากระบบ)', 'ชื่อเล่น',
      'สาย', 'บ้าน', 'สถานะ', 'ความสำคัญ', 'ข้อมูลที่ขาด', 'ปัญหาที่พบ',
      'kkumail (ถ้ามีในระบบ)', 'หมายเหตุ (เขียนที่นี่ได้)',
    ]);
  });

  it('ข้อมูลที่ขาด names every empty field, by census.js\'s own predicate', () => {
    const s = student({ first_name_th: '', nickname: '', nickname_self: '', nickname_imported: '', sai_code: '   ' });
    const { sheets } = buildYearSheets({ students: [s], held: [] });
    const row = sheets.get('MD50')[0];
    // ชื่อเล่น is optional in the ข้อมูลครบแค่ไหน panel and says so here too;
    // a whitespace-only สาย counts as empty, which is exactly why `has()` is
    // imported rather than re-typed as a truthiness check.
    expect(row.missing).toEqual(['ชื่อ', 'ชื่อเล่น (ไม่บังคับ)', 'สาย']);
  });

  it('a complete row names nothing as missing', () => {
    const { sheets } = buildYearSheets({ students: [student()], held: [] });
    expect(sheets.get('MD50')[0].missing).toEqual([]);
    expect(priorityOf(sheets.get('MD50')[0])).toBe(PRIORITY.low);
  });

  it('names kkumail on EVERY held row, self-claimable included', () => {
    // The owner's decision, 2026-09-18: "waiting for them to selfclaim seems
    // bad, I want to get data from other team as much as possible". Every held
    // row lacks a kkumail — that is what held MEANS — and an address collected
    // from another team imports them today instead of whenever they next sign
    // in. สถานะ still says which ones COULD have closed it themselves.
    const selfClaimable = { student_id: '669999999-9', first_name_th: 'ก', last_name_th: 'ข', sai: '007', cohort_year: 2566 };
    const adminOnly = { student_id: '', first_name_th: 'ค', last_name_th: 'ง', sai: '008', cohort_year: 2566 };
    const { sheets } = buildYearSheets({ students: [], held: [selfClaimable, adminOnly] });
    const rows = sheets.get('MD51');
    const self = rows.find((r) => r.lastName === 'ข');
    const admin = rows.find((r) => r.lastName === 'ง');
    expect(self.missing).toContain('kkumail');
    expect(admin.missing).toContain('kkumail');
    // and both are worth chasing, which is the point of the change
    expect(priorityOf(self)).toBe(PRIORITY.high);
    expect(priorityOf(admin)).toBe(PRIORITY.high);
  });

  it('renders one header line plus one line per row, comma-joined', () => {
    const { sheets } = buildYearSheets({ students: [student()], held: [] });
    const csv = toCsv(sheets.get('MD50'));
    const lines = csv.trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe(HEADER.join(','));
    expect(lines[1]).toBe('659999999-9,สมชาย,ใจดี,ชาย,005,5,ปกติ,ต่ำ,,,somchai@kkumail.com,');
  });

  it('quotes a cell that contains a comma, and escapes an embedded quote', () => {
    const s = student({ last_name_th: 'ใจดี, มีสุข "เก่ง"' });
    const { sheets } = buildYearSheets({ students: [s], held: [] });
    const csv = toCsv(sheets.get('MD50'));
    expect(csv).toContain('"ใจดี, มีสุข ""เก่ง"""');
  });
});
