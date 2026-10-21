// ============================================================
// advisor-roster.test.js — "every นักศึกษา under this อาจารย์", grouped.
// ============================================================
import { describe, it, expect } from 'vitest';
import {
  advisorSaiCodes, matchAdvisors, advisorRoster, yearKey, yearText,
  YEAR_GRAD, YEAR_UNKNOWN, advisorHouses, houseMates, houseRoster,
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

// ── the whole บ้าน (2026-10-21) ─────────────────────────────────────────────

// The caller's rule. Deliberately NOT the last digit for สาย 999, so a test
// that passes because the module re-derived the บ้าน itself would fail here.
const HOUSE = (code) => (code === '999' ? 1 : Number(String(code).slice(-1)));

describe('advisorHouses', () => {
  it('is the บ้าน of every สาย the อาจารย์ looks after, from the caller', () => {
    expect(advisorHouses(adv('a', 'ก', ['013', '113', '213']), HOUSE)).toEqual([3]);
    expect(advisorHouses(adv('a', 'ก', ['013', '999']), HOUSE)).toEqual([1, 3]);
  });
  it('an อาจารย์ with no สาย has no บ้าน', () => {
    expect(advisorHouses(adv('a', 'ก', []), HOUSE)).toEqual([]);
  });
});

describe('houseMates — อาจารย์ร่วมบ้าน', () => {
  const me = adv('me', 'ฉัน', ['013', '113']);
  const all = [
    me,
    adv('b', 'ข', ['023', '123']),     // บ้าน 3
    adv('c', 'ค', ['014']),            // บ้าน 4 — not a mate
    adv('d', 'ง', ['003', '004']),     // one สาย in บ้าน 3, one in บ้าน 4
    adv('e', 'จ', ['113']),            // shares my own สาย
  ];
  const mates = houseMates(me, all, HOUSE);

  it('lists every OTHER อาจารย์ with a สาย in my บ้าน, never me', () => {
    expect(mates.map((m) => m.advisor.id).sort()).toEqual(['b', 'd', 'e']);
  });
  it('shows only the สาย they hold in MY บ้าน', () => {
    expect(mates.find((m) => m.advisor.id === 'd').codes).toEqual(['003']);
  });
  it('is ordered by their first สาย in the บ้าน', () => {
    expect(mates.map((m) => m.advisor.id)).toEqual(['d', 'b', 'e']);
  });
  it('an อาจารย์ with no สาย has no housemates', () => {
    expect(houseMates(adv('z', 'ซ', []), all, HOUSE)).toEqual([]);
  });
});

describe('houseRoster — every นักศึกษา in the บ้าน', () => {
  const me = adv('me', 'ฉัน', ['013']);
  const others = [adv('b', 'ข', ['023']), adv('c', 'ค', ['033'])];
  const people = [
    st('s1', '013', 2569), st('s2', '023', 2568), st('s3', '043', 2567),
    st('s4', '014', 2569),          // บ้าน 4
    st('s5', null, 2569),           // no สาย
  ];

  it('holds everyone whose สาย is in my บ้าน, and nobody else', () => {
    const r = houseRoster(me, [me, ...others], people, HOUSE, 'sai', NOW);
    expect(r.total).toBe(3);
    expect(r.groups.flatMap((g) => g.students.map((s) => s.id)).sort()).toEqual(['s1', 's2', 's3']);
  });
  it('lists a สาย that has an อาจารย์ but nobody yet, and not the empty unassigned ones', () => {
    const r = houseRoster(me, [me, ...others], people, HOUSE, 'sai', NOW);
    expect(r.codes).toEqual(['013', '023', '033', '043']);
    expect(r.groups.find((g) => g.key === '033').students).toEqual([]);
  });
  it('searching narrows the people, never the สาย list', () => {
    const r = houseRoster(me, [me, ...others], people.filter((s) => s.id === 's1'), HOUSE, 'sai', NOW, people);
    expect(r.codes).toEqual(['013', '023', '033', '043']);
    expect(r.total).toBe(1);
  });
  it('groups by ชั้นปี the same way the อาจารย์ view does', () => {
    const r = houseRoster(me, [me, ...others], people, HOUSE, 'year', NOW);
    expect(r.groups.map((g) => g.key)).toEqual([1, 2, 3]);
  });
  it('is a superset of my own สาย view', () => {
    const mine = advisorRoster(me, people, 'sai', NOW).groups.flatMap((g) => g.students);
    const house = houseRoster(me, [me, ...others], people, HOUSE, 'sai', NOW).groups.flatMap((g) => g.students);
    for (const s of mine) expect(house).toContain(s);
  });
});
