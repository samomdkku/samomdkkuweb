// ============================================================
// advisor-roster.test.js — "every นักศึกษา under this อาจารย์", grouped.
// ============================================================
import { describe, it, expect } from 'vitest';
import {
  advisorSaiCodes, matchAdvisors, advisorRoster, yearKey, yearText,
  YEAR_GRAD, YEAR_UNKNOWN,
} from './advisor-roster.js';

// 2026-10-20 is in ปีการศึกษา 2569 (rollover is August), so cohort 2569 = ปี 1.
const NOW = new Date('2026-10-20T12:00:00Z');
const st = (id, sai, cohort, over = {}) => ({
  id, sai_code: sai, cohort_year: cohort, student_id: '', full_name: id, ...over,
});
const adv = (id, name, codes, over = {}) => ({
  id, full_name: name, email: null, dept: null,
  sai_advisors: codes.map((c) => ({ sai_code: c })), ...over,
});

describe('matchAdvisors', () => {
  const list = [adv('a', 'อ.สมชาย', []), adv('b', 'อ.สมชายศรี', []),
    adv('c', 'อ.วิไล', [], { email: 'wilai@kku.ac.th', dept: 'กุมารเวชศาสตร์' })];

  it('an exact name means that one person, not every name containing it', () => {
    expect(matchAdvisors(list, 'อ.สมชาย').map((a) => a.id)).toEqual(['a']);
  });
  it('a partial name narrows by substring', () => {
    expect(matchAdvisors(list, 'สมชาย').map((a) => a.id)).toEqual(['a', 'b']);
  });
  it('matches on email and ภาควิชา too', () => {
    expect(matchAdvisors(list, 'wilai').map((a) => a.id)).toEqual(['c']);
    expect(matchAdvisors(list, 'กุมาร').map((a) => a.id)).toEqual(['c']);
  });
  it('an empty box matches nobody (the roster stays a table)', () => {
    expect(matchAdvisors(list, '  ')).toEqual([]);
  });
});

describe('yearKey', () => {
  it('buckets 1–6, graduated, and no-cohort', () => {
    expect(yearKey(st('x', '001', 2569), NOW)).toBe(1);
    expect(yearKey(st('x', '001', 2564), NOW)).toBe(6);
    expect(yearKey(st('x', '001', 2563), NOW)).toBe(YEAR_GRAD);
    expect(yearKey(st('x', '001', null), NOW)).toBe(YEAR_UNKNOWN);
    expect(yearText(st('x', '001', 2563), NOW)).toBe('จบแล้ว');
    expect(yearText(st('x', '001', 2567), NOW)).toBe('ปี 3');
    expect(yearText(st('x', '001', null), NOW)).toBe('ไม่ทราบชั้นปี');
  });
  it('honours year_offset (ลาพัก / เรียนซ้ำ)', () => {
    expect(yearKey(st('x', '001', 2566, { year_offset: -1 }), NOW)).toBe(3);
  });
});

describe('advisorRoster', () => {
  const a = adv('a', 'อ.ก', ['200', '100']);
  const students = [
    st('p6', '100', 2564), st('p1', '100', 2569), st('q3', '200', 2567),
    st('other', '300', 2569), st('nocohort', '200', null),
  ];

  it('includes only students of the สาย the อาจารย์ looks after', () => {
    const r = advisorRoster(a, students, 'sai', NOW);
    expect(r.total).toBe(4);
    expect(r.codes).toEqual(['100', '200']);
  });

  it('by สาย: every สาย gets a group, youngest first inside it', () => {
    const r = advisorRoster(a, students, 'sai', NOW);
    expect(r.groups.map((g) => g.key)).toEqual(['100', '200']);
    expect(r.groups[0].students.map((s) => s.id)).toEqual(['p1', 'p6']);
    expect(r.groups[1].students.map((s) => s.id)).toEqual(['q3', 'nocohort']);
  });

  it('by สาย: a สาย with nobody on screen is still listed, empty', () => {
    const r = advisorRoster(adv('b', 'อ.ข', ['100', '999']), students, 'sai', NOW);
    expect(r.groups.find((g) => g.key === '999').students).toEqual([]);
  });

  it('by ชั้นปี: ordered 1→6, then the rows with no ชั้นปี — nobody dropped', () => {
    const r = advisorRoster(a, students, 'year', NOW);
    expect(r.groups.map((g) => g.key)).toEqual([1, 3, 6, YEAR_UNKNOWN]);
    expect(r.groups.map((g) => g.label)).toEqual(['ปี 1', 'ปี 3', 'ปี 6', 'ไม่ทราบชั้นปี']);
    expect(r.groups.flatMap((g) => g.students).length).toBe(r.total);
  });

  it('an อาจารย์ with no สาย has no students and no groups', () => {
    const r = advisorRoster(adv('z', 'อ.ซ', []), students, 'sai', NOW);
    expect(r).toEqual({ codes: [], total: 0, groups: [] });
  });

  it('advisorSaiCodes dedupes and sorts', () => {
    expect(advisorSaiCodes(adv('d', 'x', ['300', '100', '300']))).toEqual(['100', '300']);
  });
});
