import { describe, it, expect } from 'vitest';
import { advisorHouseModel } from './my-advisor-house.js';
import { summarizeMe } from '../me-page.js';

// A fixed "now" so ชั้นปี is stable: 2569 intake = ปี 1 in academic year 2569.
const NOW = new Date('2026-11-01T00:00:00Z');

const payload = () => ({
  advisor: { id: 'a1', full_name: 'อ.หนึ่ง' },
  advisor_ids: ['a1'],
  sai_codes: ['A1'],
  houses: [{ id: 3, name: 'บ้านสาม', color: '#123456' }],
  sais: [
    { code: 'A1', house_id: 3 }, { code: 'A2', house_id: 3 }, { code: 'A3', house_id: 3 },
  ],
  advisors: [
    { id: 'a1', full_name: 'อ.หนึ่ง', sai_advisors: [{ sai_code: 'A1', role: 'primary' }, { sai_code: 'A3', role: 'primary' }] },
    { id: 'a2', full_name: 'อ.สอง', sai_advisors: [{ sai_code: 'A2', role: 'primary' }] },
  ],
  students: [
    { id: 's1', full_name: 'นศ หนึ่ง', student_id: '693000001-1', sai_code: 'A1', cohort_year: 2569 },
    { id: 's2', full_name: 'นศ สอง', student_id: '683000002-2', sai_code: 'A2', cohort_year: 2568, nickname: 'บี' },
    { id: 's3', full_name: 'นศ จบ', student_id: '583000003-3', sai_code: 'A1', cohort_year: 2558 },
  ],
});

describe('advisorHouseModel', () => {
  it('is null for anyone who is not an อาจารย์', () => {
    expect(advisorHouseModel(null)).toBeNull();
    expect(advisorHouseModel({ advisor: null })).toBeNull();
  });

  it('สายที่ดูแล lists the อาจารย์ own สาย only, even one with nobody in it', () => {
    const m = advisorHouseModel(payload(), { scope: 'mine' }, NOW);
    expect(m.mineCodes).toEqual(['A1', 'A3']);
    expect(m.roster.groups.map((g) => g.key)).toEqual(['A1', 'A3']);
    expect(m.roster.groups[0].students.map((s) => s.id)).toEqual(['s1']); // graduate hidden
    expect(m.mineN).toBe(1);
  });

  it('ทั้งบ้าน adds the other อาจารย์ สาย in the same บ้าน', () => {
    const m = advisorHouseModel(payload(), { scope: 'house' }, NOW);
    expect(m.roster.groups.map((g) => g.key)).toEqual(['A1', 'A2', 'A3']);
    expect(m.houseN).toBe(2);
    expect(m.ownersBySai.get('A2')).toEqual(['อ.สอง']);
  });

  it('graduates appear only when asked for, and search matches nickname', () => {
    expect(advisorHouseModel(payload(), { showGrad: true }, NOW).roster.groups[0].students)
      .toHaveLength(2);
    expect(advisorHouseModel(payload(), { scope: 'house', q: 'บี' }, NOW).roster.groups
      .flatMap((g) => g.students.map((s) => s.id))).toEqual(['s2']);
    expect(advisorHouseModel(payload(), {}, NOW).gradN).toBe(1);
  });
});

describe('summarizeMe — อาจารย์', () => {
  it('names the role and the บ้าน', () => {
    const { line } = summarizeMe({ advisor: payload() });
    expect(line).toBe('อาจารย์ประจำบ้าน · บ้านสาม');
  });
  it('says nothing about it for everyone else', () => {
    expect(summarizeMe({ fallback: 'x' }).line).toBe('x');
  });
});
