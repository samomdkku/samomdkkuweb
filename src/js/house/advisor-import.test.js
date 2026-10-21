// ============================================================
// advisor-import.test.js — the อาจารย์ sheet becomes อาจารย์, สาย and phones.
// Every name and number here is invented; the real sheet never enters the repo.
// ============================================================
import { describe, it, expect } from 'vitest';
import {
  parseAdvisorSheet, normalizePhone, formatPhone, rankPrefix,
} from './advisor-import.js';

const HEAD = ['ลงท้ายด้วยเลข', 'สายรหัส', 'ตำแหน่ง', 'ชื่อ', 'สกุล', 'เบอร์โทรศัพท์', 'สาขาวิชา'];
const sheet = (...rows) => [HEAD, ...rows];

describe('normalizePhone — one number, however it was typed', () => {
  it('stores digits only, whatever separators were used', () => {
    for (const typed of ['081-234-5678', '0812345678', '081 234 5678', '081-2345678']) {
      expect(normalizePhone(typed)).toEqual({ value: '0812345678', ok: true });
    }
  });
  it('+66 and 66 are the same number with the 0 put back', () => {
    expect(normalizePhone('+66 81 234 5678').value).toBe('0812345678');
    expect(normalizePhone('66812345678').value).toBe('0812345678');
  });
  it('a 9-digit landline is a number too', () => {
    expect(normalizePhone('043-123456')).toEqual({ value: '043123456', ok: true });
  });
  it('no number is fine; a number that cannot be one is refused, not trimmed', () => {
    expect(normalizePhone('')).toEqual({ value: null, ok: true });
    expect(normalizePhone(null)).toEqual({ value: null, ok: true });
    expect(normalizePhone('081-234').ok).toBe(false);
    expect(normalizePhone('1812345678').ok).toBe(false);       // no leading 0
    expect(normalizePhone('08123456789').ok).toBe(false);      // 11 digits
  });
});

describe('formatPhone — display only', () => {
  it('formats mobile, Bangkok and provincial numbers', () => {
    expect(formatPhone('0812345678')).toBe('081-234-5678');
    expect(formatPhone('021234567')).toBe('02-123-4567');
    expect(formatPhone('043123456')).toBe('043-123-456');
  });
  it('a stored number round-trips through the normaliser', () => {
    for (const d of ['0812345678', '021234567', '043123456']) {
      expect(normalizePhone(formatPhone(d)).value).toBe(d);
    }
  });
});

describe('rankPrefix', () => {
  it('turns each written-out rank into the prefix a person would type', () => {
    expect(rankPrefix('ศาสตราจารย์')).toBe('ศ.');
    expect(rankPrefix('รองศาสตราจารย์')).toBe('รศ.');
    expect(rankPrefix('ผู้ช่วยศาสตราจารย์')).toBe('ผศ.');
    expect(rankPrefix('อาจารย์')).toBe('อ.');
  });
  it('a mark typed twice is the same word', () => {
    expect(rankPrefix('อาจารย์์')).toBe('อ.');
    expect(rankPrefix('ผู้้ช่วยศาสตราจารย์')).toBe('ผศ.');
  });
  it('no rank is no prefix; an unknown rank is not guessed', () => {
    expect(rankPrefix('')).toBe('');
    expect(rankPrefix('ศาสตราจารย์เกียรติคุณ')).toBeNull();
  });
});

describe('parseAdvisorSheet', () => {
  it('one line is one อาจารย์ with every สาย on it, zero-padded', () => {
    const r = parseAdvisorSheet(sheet(['0', '10/110/210', 'รองศาสตราจารย์', 'สมมติ', 'ทดสอบ', '081-234-5678', 'สาขาวิชาสมมติ']));
    expect(r.problems).toEqual([]);
    expect(r.advisors).toEqual([{
      first_name_th: 'รศ. สมมติ', last_name_th: 'ทดสอบ', dept: 'สาขาวิชาสมมติ',
      phone: '0812345678', sai_codes: ['010', '110', '210'], lines: [2],
    }]);
  });

  it('the บ้าน is written once per block and carried down', () => {
    const r = parseAdvisorSheet(sheet(
      ['1', '1', 'อาจารย์', 'ก', 'หนึ่ง', '', ''],
      ['', '11/111', 'อาจารย์', 'ข', 'สอง', '', ''],
      ['2', '2', 'อาจารย์', 'ค', 'สาม', '', ''],
    ));
    expect(r.problems).toEqual([]);
    expect(r.advisors.map((a) => a.sai_codes)).toEqual([['001'], ['011', '111'], ['002']]);
  });

  it('a สาย in the wrong บ้าน is REFUSED, never corrected — the rest of the line still lands', () => {
    const r = parseAdvisorSheet(sheet(['3', '63/136/263', 'อาจารย์', 'ง', 'สี่', '', '']));
    expect(r.advisors[0].sai_codes).toEqual(['063', '263']);
    expect(r.problems).toHaveLength(1);
    expect(r.problems[0]).toMatchObject({ line: 2 });
    expect(r.problems[0].message).toContain('136');
  });

  it('the same person on two lines is ONE อาจารย์ holding both lines’ สาย', () => {
    const r = parseAdvisorSheet(sheet(
      ['5', '5/105', 'อาจารย์', 'จ', 'ห้า', '0812345678', 'สาขาวิชาสมมติ'],
      ['8', '8/108', 'อาจารย์', 'จ', 'ห้า', '081-234-5678', 'สาขาวิชาสมมติ'],
    ));
    expect(r.problems).toEqual([]);
    expect(r.advisors).toHaveLength(1);
    expect(r.advisors[0].sai_codes).toEqual(['005', '008', '105', '108']);
    expect(r.advisors[0].lines).toEqual([2, 3]);
  });

  it('two lines for one name that disagree on the phone say so, and keep the first', () => {
    const r = parseAdvisorSheet(sheet(
      ['5', '5', 'อาจารย์', 'จ', 'ห้า', '0811111111', ''],
      ['8', '8', 'อาจารย์', 'จ', 'ห้า', '0822222222', ''],
    ));
    expect(r.advisors[0].phone).toBe('0811111111');
    expect(r.problems.map((p) => p.line)).toEqual([3]);
  });

  it('a สาย listed twice on one line is kept once and reported', () => {
    const r = parseAdvisorSheet(sheet(['4', '94/94', 'อาจารย์', 'ฉ', 'หก', '', '']));
    expect(r.advisors[0].sai_codes).toEqual(['094']);
    expect(r.problems).toHaveLength(1);
  });

  it('a bad phone keeps the อาจารย์ and drops only the number', () => {
    const r = parseAdvisorSheet(sheet(['7', '7', 'อาจารย์', 'ช', 'เจ็ด', '081-234', '']));
    expect(r.advisors[0].phone).toBeNull();
    expect(r.problems).toHaveLength(1);
  });

  it('an unknown rank skips the line rather than inventing a title', () => {
    const r = parseAdvisorSheet(sheet(['7', '7', 'ศาสตราจารย์เกียรติคุณ', 'ซ', 'แปด', '', '']));
    expect(r.advisors).toEqual([]);
    expect(r.problems).toHaveLength(1);
  });

  it('blank lines vanish; a line with สาย but no name is reported', () => {
    const r = parseAdvisorSheet(sheet(['', '', '', '', '', '', ''], ['9', '9', 'อาจารย์', '', 'ไม่มีชื่อ', '', '']));
    expect(r.advisors).toEqual([]);
    expect(r.problems).toEqual([{ line: 3, message: expect.stringContaining('ไม่มีชื่อ') }]);
  });

  it('columns are found by header, in any order; a missing one is fatal', () => {
    const r = parseAdvisorSheet([
      ['ชื่อ', 'สกุล', 'สาขาวิชา', 'เบอร์โทรศัพท์', 'ตำแหน่ง', 'สายรหัส', ' ลงท้ายด้วยเลข '],
      ['ฌ', 'เก้า', '', '', 'อาจารย์', '9', '9'],
    ]);
    expect(r.advisors[0].sai_codes).toEqual(['009']);
    expect(parseAdvisorSheet([HEAD.slice(0, 5)]).fatal).toContain('เบอร์โทรศัพท์');
  });
});
