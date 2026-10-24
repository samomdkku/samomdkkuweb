// schedule.test.js — the transcribed timetable is internally consistent, and
// the date maths matches the PDF's own header row.
import { describe, it, expect } from 'vitest';
import { ROTATION_2570 as R } from '../../data/rotation-2570.js';
import { groupTimetable, weekMonday, weekFriday, weekOf, thDate, thRange, weeksLabel, blockIndexOfWeek } from './schedule.js';

describe('rotation-2570 data', () => {
  it('six blocks tile the 48 weeks with no gap or overlap', () => {
    let next = 1;
    for (const b of R.blocks) { expect(b.startWeek).toBe(next); next += b.weeks; }
    expect(next - 1).toBe(R.weeks);
  });

  it('every unit fills exactly one block', () => {
    for (const [key, u] of Object.entries(R.units)) {
      expect(u.courses.reduce((n, c) => n + c.weeks, 0), key).toBe(8);
    }
  });

  it('every group takes every unit exactly once, with a section per course', () => {
    const units = Object.keys(R.units).sort();
    for (const [g, plan] of Object.entries(R.groups)) {
      expect(plan.map(([u]) => u).sort(), g).toEqual(units);
      for (const [u, secs] of plan) {
        expect(secs.length, `${g} ${u}`).toBe(R.units[u].courses.length);
        for (const s of secs) expect([1, 2]).toContain(s);
      }
    }
  });

  it('in every block, each unit is taken by exactly one group (the PDF is a rotation)', () => {
    for (let i = 0; i < R.blocks.length; i++) {
      const inBlock = Object.values(R.groups).map((plan) => plan[i][0]).sort();
      expect(inBlock).toEqual(Object.keys(R.units).sort());
    }
  });
});

describe('dates', () => {
  it('matches the PDF header: week 1 = 26–30 เม.ย., week 9 = 21 มิ.ย., week 48 ends 24 มี.ค.', () => {
    expect(thDate(weekMonday(R, 1))).toBe('26 เม.ย.');
    expect(thDate(weekFriday(R, 1))).toBe('30 เม.ย.');
    expect(thDate(weekMonday(R, 9))).toBe('21 มิ.ย.');
    expect(thDate(weekMonday(R, 33))).toBe('6 ธ.ค.');
    expect(thDate(weekMonday(R, 41))).toBe('31 ม.ค.');
    expect(thDate(weekFriday(R, 48), { withYear: true })).toBe('24 มี.ค. 71');
  });

  it('a group timetable: group A starts with Surgery III, Theory weeks 1–2', () => {
    const t = groupTimetable(R, 'A');
    expect(t).toHaveLength(6);
    expect(t[0].unit.name).toBe('Surgery III');
    expect(t[0].courses[0]).toMatchObject({ code: 'MD 756 107', startWeek: 1, endWeek: 2, section: 1, approx: false });
    expect(thRange(t[0].courses[0].start, t[0].courses[0].end)).toBe('26 เม.ย. – 7 พ.ค.');
    expect(thRange(t[0].start, t[0].end)).toBe('26 เม.ย. – 18 มิ.ย.');
  });

  it('a half-week boundary is marked approximate and stays inside the block', () => {
    const ob = groupTimetable(R, 'E')[0];
    expect(ob.unit.short).toBe('OB-GYN');
    expect(ob.courses[0].approx).toBe(true);
    expect(ob.courses[2].approx).toBe(false);
    expect(ob.courses[2].end.getTime()).toBe(ob.end.getTime());
    expect(ob.courses[0].end.getTime()).toBeLessThan(ob.courses[1].start.getTime());
  });

  it('weekOf / blockIndexOfWeek', () => {
    expect(weekOf(R, new Date(2026, 9, 24))).toBe(0);
    expect(weekOf(R, new Date(2027, 3, 26))).toBe(1);
    expect(weekOf(R, new Date(2027, 5, 21))).toBe(9);
    expect(weekOf(R, new Date(2028, 5, 1))).toBe(49);
    expect(blockIndexOfWeek(R, 9)).toBe(1);
    expect(blockIndexOfWeek(R, 0)).toBe(-1);
  });

  it('weeksLabel', () => {
    expect(weeksLabel(2.5)).toBe('2½');
    expect(weeksLabel(0.5)).toBe('½');
    expect(weeksLabel(4)).toBe('4');
  });
});
