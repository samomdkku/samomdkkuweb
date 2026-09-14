// ==============================================
// clean-csv.test.js — the handover cleaner and the REAL importer, end to end.
//
// WHAT THIS EXISTS TO CATCH, and why no source assertion could.
// `tools/clean-house-csv.mjs` splits a handover file into the rows that can
// become students and the rows that cannot. Both halves have to reach the
// importer, and only one of them looks like the file you would upload:
//
//   • `record_unresolved_rows` (0188) REPLACES the held list with whatever the
//     uploaded file could not address. Upload the clean half alone and the held
//     list is CLEARED — every held seat gone, and with it every student's
//     ability to claim their own, since `claim_my_student_seat` reads that table.
//   • `diffAgainstExisting` counts a SKIPPED line as the file mentioning that
//     person. Drop the skipped lines and anyone who already claimed a seat is
//     stamped `missing_since` on the next import — marked absent from a file
//     that names them.
//
// Neither failure is visible in the cleaner's source, in its report, or in a
// successful-looking import: the run says "นำเข้าเรียบร้อยแล้ว" either way. So
// this feeds the artefact a real person uploads to the real parser and asserts
// what comes out — including the CONTROL that the clean half alone holds nobody,
// which is the mistake this file is here to keep from being made again.
// ==============================================
import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseStudentsCsv, toUnresolvedRow, diffAgainstExisting } from './io.js';

const ROOT = join(import.meta.dirname, '..', '..', '..');

// A handover file in the REAL shape: two tables side by side (the สายรหัส
// roster in columns 0-8, ฝ่ายวิชาการ's own database in 10-14), รุ่น as a block
// heading on the first row of each cohort rather than per-row data.
//
// Every row here is a shape the 2026-09-14 file actually contained: a clean
// one, one with no address, one with no address AND no รหัส, a row with nothing
// but a สาย on it, and two people sharing one address.
const COLS = 15;
const row = (cells) => {
  const r = new Array(COLS).fill('');
  Object.entries(cells).forEach(([i, v]) => { r[i] = v; });
  return r.join(',');
};
const RAW = [
  'รหัสนักศึกษา,ชื่อ,นามสกุล,ชื่อเล่น,Email,สาขา,สาย,สถานะ,รุ่น,,รหัส,ชื่อ,นามสกุล,ชื่อเล่น,Email',
  row({ 0: '643070001-1', 1: 'กอ', 2: 'หนึ่ง', 3: 'เอ', 4: 'kor.o@kkumail.com', 5: 'MD', 6: '001', 8: 'MD49' }),
  row({ 0: '643070002-9', 1: 'ขอ', 2: 'สอง', 3: 'บี', 4: '', 5: 'MD', 6: '002' }),
  row({ 1: '', 6: '003' }),
  row({ 0: '653070003-7', 1: 'คอ', 2: 'สาม', 4: 'kor.s@kkumail.com', 5: 'MD', 6: '004', 8: 'MD50' }),
  row({ 1: 'งอ', 2: 'สี่', 5: 'MD', 6: '005' }),
  row({ 0: '653070006-0', 1: 'จอ', 2: 'ห้า', 4: 'same.one@kkumail.com', 5: 'MD', 6: '006' }),
  row({ 0: '653070007-8', 1: 'ฉอ', 2: 'หก', 4: 'same.one@kkumail.com', 5: 'MD', 6: '007' }),
].join('\n') + '\n';

let dir, base, importCsv, cleanCsv, pendingCsv;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'house-csv-'));
  base = join(dir, 'handover');
  writeFileSync(`${base}.csv`, RAW, 'utf8');
  // The REAL tool, run the way a person runs it. A reimplementation here would
  // be a second opinion about what the file contains, which is the drift class
  // this repo pays for most.
  execFileSync('node', [join(ROOT, 'tools', 'clean-house-csv.mjs'), `${base}.csv`],
    { encoding: 'utf8' });
  importCsv = readFileSync(`${base}.import.csv`, 'utf8');
  cleanCsv = readFileSync(`${base}.clean.csv`, 'utf8');
  pendingCsv = readFileSync(`${base}.pending.csv`, 'utf8');
});

const dataLines = (csv) => csv.trim().split('\n').slice(1);

describe('the file a person uploads', () => {
  it('carries every line of the handover, not just the usable half', () => {
    expect(dataLines(importCsv).length)
      .toBe(dataLines(cleanCsv).length + dataLines(pendingCsv).length);
  });

  it('the real importer keeps the clean rows and HOLDS the rest', () => {
    const r = parseStudentsCsv(importCsv, ['MD']);
    expect(r.fatal).toBe(null);
    expect(r.rows.length).toBe(dataLines(cleanCsv).length);
    expect(r.skipped.length).toBe(dataLines(pendingCsv).length);
  });

  // THE CONTROL, and the whole reason `.import.csv` exists. If this ever starts
  // holding people, the two files have become interchangeable and the assertion
  // above stopped meaning anything.
  it('uploading .clean.csv instead would hold NOBODY', () => {
    const r = parseStudentsCsv(cleanCsv, ['MD']);
    expect(r.rows.length).toBe(dataLines(cleanCsv).length);
    expect(r.skipped.length).toBe(0);
  });

  it('nobody is dropped — every held person keeps their รหัส, ชื่อ and สาย', () => {
    const held = parseStudentsCsv(importCsv, ['MD']).skipped.map(toUnresolvedRow);
    const pendingSids = dataLines(pendingCsv)
      .map((l) => l.split(',')[0]).filter(Boolean);
    const heldSids = held.map((h) => h.student_id).filter(Boolean);
    expect(heldSids.sort()).toEqual(pendingSids.sort());
    const one = held.find((h) => h.student_id === '643070002-9');
    expect(one).toMatchObject({ first_name_th: 'ขอ', sai_code: '002', reason: 'no_kkumail' });
    // The row with nobody on it, and the person with no รหัส, are different
    // things: one can never be resolved by anybody, the other by a human who
    // knows them. 0188 stores that difference and it starts here.
    //
    // ⚠️ THE COST OF BLANKING A DUPLICATED ADDRESS, asserted so it is a decision
    // and not a surprise: both holders are held as `no_kkumail`, because by the
    // time io.js reads the file the address is gone. `reason` is an evidence
    // column, and for these two rows it now describes the file AFTER the
    // cleaner rather than as it arrived. That is the price of not letting line
    // order decide who owns a login, and it is paid where it can be recovered —
    // §3 of the report names both people and the address they shared. If a
    // future file needs the distinction in the DATABASE, the channel is
    // toUnresolvedRow() + record_unresolved_rows(), not the upload file.
    expect(held.map((h) => h.reason).sort()).toEqual(
      ['empty_row', 'no_kkumail', 'no_kkumail',
        'no_kkumail', 'no_kkumail_no_student_id'].sort());
  });

  it('a line number in the report is the same line number in the database', () => {
    const held = parseStudentsCsv(importCsv, ['MD']).skipped.map(toUnresolvedRow);
    const pendingByLine = new Map(dataLines(pendingCsv).map((l) => {
      const c = l.split(',');
      return [Number(c[7]), c[0]];          // source_line → student_id
    }));
    held.forEach((h) => {
      expect(pendingByLine.has(h.source_line)).toBe(true);
      expect(pendingByLine.get(h.source_line) || '').toBe(h.student_id || '');
    });
  });

  // A duplicate address is two people and one login. The cleaner refuses to pick
  // by line order; blanking BOTH is how that refusal survives the upload. If the
  // upload file kept the address, io.js would import the first line and hold the
  // second — quietly making the call the cleaner declined to make.
  it('neither holder of a duplicated address is imported', () => {
    const r = parseStudentsCsv(importCsv, ['MD']);
    expect(r.rows.some((x) => x.kkumail === 'same.one@kkumail.com')).toBe(false);
    expect(r.skipped.filter((x) => ['653070006-0', '653070007-8']
      .includes(x.student_id)).length).toBe(2);
  });

  // A held line is the file NAMING somebody it could not address — the opposite
  // of the file omitting them. Upload the clean half and this person, who
  // claimed their seat with their own address, is flagged as gone.
  it('a student who claimed a held seat is not flagged missing', () => {
    const claimed = [{
      id: 'u1', kkumail: 'khor.song@kkumail.com', student_id: '643070002-9',
      first_name_th: 'ขอ', last_name_th: 'สอง', sai_code: '002', self_edited: [],
    }];
    const full = parseStudentsCsv(importCsv, ['MD']);
    expect(diffAgainstExisting(full.rows, claimed, full.presentColumns, full.skipped)
      .missing.length).toBe(0);
    const half = parseStudentsCsv(cleanCsv, ['MD']);
    expect(diffAgainstExisting(half.rows, claimed, half.presentColumns, half.skipped)
      .missing.length).toBe(1);
  });
});
