import { describe, it, expect } from 'vitest';
import {
  SID_RE, normalizeStudentId, normalizeYear, normalizeMajor, majorKey,
  normalizeIdentityFields, YEARS, studentIdChecksumOk,
} from './fields.js';

describe('studentIdChecksumOk', () => {
  // Synthetic ids — this repo is public. 6+5 weighted 10 and 9, 1 weighted 2:
  // 60+45+2 = 107, so the check digit is (10 - 7) % 10 = 3. 659999999 sums to
  // 420, so its check digit is 0 — and the `-9` fixture above FAILS this, which
  // is why the checksum is a separate question from the shape.
  it('accepts an id whose check digit agrees', () => {
    expect(studentIdChecksumOk('650000001-3')).toBe(true);
    expect(studentIdChecksumOk('6599999990')).toBe(true);
  });

  it('catches a single wrong digit and a swapped neighbour pair', () => {
    expect(studentIdChecksumOk('650000001-4')).toBe(false);
    expect(studentIdChecksumOk('650000010-3')).toBe(false);
    expect(studentIdChecksumOk('659999999-9')).toBe(false);
  });

  it('says null, not false, when there is nothing to check', () => {
    expect(studentIdChecksumOk('')).toBe(null);
    expect(studentIdChecksumOk('65000001-3')).toBe(null);
    expect(studentIdChecksumOk(undefined)).toBe(null);
  });

  it('reads Thai numerals like normalizeStudentId does', () => {
    expect(studentIdChecksumOk('๖๕๐๐๐๐๐๐๑-๓')).toBe(true);
  });
});

describe('normalizeStudentId', () => {
  it('keeps the canonical dashed form', () => {
    expect(normalizeStudentId('659999999-9')).toEqual({ value: '659999999-9', ok: true });
  });

  it('adds the dash to a bare 10-digit id', () => {
    expect(normalizeStudentId('6599999999')).toEqual({ value: '659999999-9', ok: true });
  });

  it('survives spaces, stray dashes and Thai numerals', () => {
    expect(normalizeStudentId('  659999999 - 9 ').value).toBe('659999999-9');
    expect(normalizeStudentId('659-999-999-9').value).toBe('659999999-9');
    expect(normalizeStudentId('๖๕๙๙๙๙๙๙๙๙').value).toBe('659999999-9');
  });

  it('strips a stray Thai vowel mark — a real live row reads "ุ693070229-1"', () => {
    expect(normalizeStudentId('ุ693070229-1')).toEqual({ value: '693070229-1', ok: true });
  });

  it('refuses a wrong digit count instead of guessing where the dash goes', () => {
    // The other live bad row. 9 digits could be a missing digit anywhere.
    expect(normalizeStudentId('66666666-2')).toEqual({ value: '66666666-2', ok: false });
    expect(normalizeStudentId('12345').ok).toBe(false);
    expect(normalizeStudentId('65999999990').ok).toBe(false);
  });

  it('keeps what the human typed when it cannot be read', () => {
    // Never null-for-nonempty: silently blanking is worse than storing it unparsed.
    expect(normalizeStudentId('ไม่ทราบ')).toEqual({ value: 'ไม่ทราบ', ok: false });
  });

  it('treats empty as empty, not as an error', () => {
    expect(normalizeStudentId('')).toEqual({ value: null, ok: true });
    expect(normalizeStudentId('   ')).toEqual({ value: null, ok: true });
    expect(normalizeStudentId(null)).toEqual({ value: null, ok: true });
    expect(normalizeStudentId(undefined)).toEqual({ value: null, ok: true });
  });

  it('every ok result matches the canonical shape', () => {
    for (const raw of ['6599999999', '659999999-9', '๖๕๙๙๙๙๙๙๙๙', 'ุ693070229-1']) {
      expect(SID_RE.test(normalizeStudentId(raw).value)).toBe(true);
    }
  });
});

describe('normalizeYear', () => {
  it('reads the ways people actually write it', () => {
    for (const raw of ['5', ' 5 ', 'ปี5', 'ปี 5', 'ชั้นปีที่ 5', '๕', '5/2569']) {
      expect(normalizeYear(raw).value).toBe('5');
      expect(normalizeYear(raw).ok).toBe(true);
    }
  });

  it('accepts 1 through 6 — MD is a six-year programme', () => {
    for (const y of YEARS) expect(normalizeYear(y).value).toBe(y);
  });

  it('DROPS an out-of-range or unreadable year, and says what it refused', () => {
    // Unlike รหัสนักศึกษา, there is no legitimate value outside 1–6 to preserve,
    // and the CSV column is full of `-` meaning blank — keeping that verbatim
    // would print `-` as somebody's ชั้นปี.
    expect(normalizeYear('7')).toEqual({ value: null, ok: false, raw: '7' });
    expect(normalizeYear('0')).toEqual({ value: null, ok: false, raw: '0' });
    expect(normalizeYear('-')).toEqual({ value: null, ok: false, raw: '-' });
    expect(normalizeYear('จบแล้ว')).toEqual({ value: null, ok: false, raw: 'จบแล้ว' });
  });

  it('treats empty as empty', () => {
    expect(normalizeYear('')).toEqual({ value: null, ok: true, raw: '' });
    expect(normalizeYear(null)).toEqual({ value: null, ok: true, raw: '' });
  });
});

describe('normalizeMajor', () => {
  const known = ['MD', 'MDI', 'RT'];

  it('snaps case and punctuation variants onto the vocabulary', () => {
    for (const raw of ['md', 'MD', 'M.D.', ' m d ']) {
      expect(normalizeMajor(raw, known)).toEqual({ value: 'MD', ok: true });
    }
  });

  it('does not confuse MD with MDI', () => {
    expect(normalizeMajor('mdi', known).value).toBe('MDI');
    expect(normalizeMajor('md', known).value).toBe('MD');
  });

  it('keeps an unknown code verbatim rather than blanking it', () => {
    expect(normalizeMajor('PT', known)).toEqual({ value: 'PT', ok: false });
  });

  it('is empty-safe and vocabulary-empty-safe', () => {
    expect(normalizeMajor('', known)).toEqual({ value: null, ok: true });
    expect(normalizeMajor('MD', [])).toEqual({ value: 'MD', ok: false });
    expect(normalizeMajor('MD')).toEqual({ value: 'MD', ok: false });
  });

  it('majorKey ignores case and punctuation only — not Thai text', () => {
    expect(majorKey('M.D.')).toBe(majorKey('md'));
    expect(majorKey('แพทย์')).toBe('แพทย์');
  });
});

describe('normalizeIdentityFields', () => {
  const known = ['MD', 'RT'];

  it('normalises all three and reports nothing when they are readable', () => {
    const out = normalizeIdentityFields(
      { student_id: '6599999999', year: 'ปี 5', major: 'md' }, known,
    );
    expect(out.student_id).toBe('659999999-9');
    expect(out.major).toBe('MD');
    // NO `year` in the result (0145): ชั้นปี is derived from the รหัส above, so
    // handing a caller one to store is the bug this removed.
    expect('year' in out).toBe(false);
    expect(out.problems).toEqual([]);
    expect(out.problemFor('student_id')).toBeNull();
  });

  it('names each unreadable field and quotes what was typed', () => {
    const out = normalizeIdentityFields(
      { student_id: '66666666-2', year: '9', major: 'PT' }, known,
    );
    expect(out.problems.map((p) => p.field).sort())
      .toEqual(['major', 'student_id', 'year']);
    expect(out.problemFor('student_id').message).toContain('66666666-2');
    expect(out.problemFor('major').message).toContain('PT');
    // An unreadable ชั้นปี is still REPORTED — a file or a form carrying `ปี 9`
    // is worth saying out loud — it is simply never returned as a value to
    // write. Report and drop, not report and store.
    expect(out.problemFor('year').message).toContain('9');
    expect('year' in out).toBe(false);
  });

  it('an all-empty record is not a problem — most rows are incomplete', () => {
    const out = normalizeIdentityFields({}, known);
    expect(out).toMatchObject({ student_id: null, major: null, problems: [] });
  });
});
