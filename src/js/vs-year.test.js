import { describe, it, expect } from 'vitest';
import { ALL_YEARS, DONE_STATUS, vsTicketMatchesYearFilter } from './vs-year.js';
import { ALL_YEARS as PR_ALL_YEARS } from './pr-year.js';
import { ALL_YEARS as SAMO_ALL_YEARS } from './samo-year.js';

describe('ALL_YEARS — one sentinel, re-exported, never redefined', () => {
  it('vs-year.js, pr-year.js and samo-year.js all point at the SAME value', () => {
    expect(ALL_YEARS).toBe(SAMO_ALL_YEARS);
    expect(PR_ALL_YEARS).toBe(SAMO_ALL_YEARS);
  });
});

describe('vsTicketMatchesYearFilter', () => {
  it('ทุกปี shows everything, open or closed, any year', () => {
    expect(vsTicketMatchesYearFilter(2568, DONE_STATUS, ALL_YEARS)).toBe(true);
    expect(vsTicketMatchesYearFilter(2568, 'รอ SE รับเรื่อง', ALL_YEARS)).toBe(true);
    expect(vsTicketMatchesYearFilter(null, null, ALL_YEARS)).toBe(true);
  });

  it('an OPEN ticket (status not เสร็จสิ้น) carries over into any specific year view', () => {
    expect(vsTicketMatchesYearFilter(2568, 'รอ SE รับเรื่อง', 2569)).toBe(true);
    expect(vsTicketMatchesYearFilter(2569, 'สโมกำลังดำเนินการ', 2569)).toBe(true);
  });

  it('a CLOSED ticket (status เสร็จสิ้น) from a different year is hidden by a specific year view', () => {
    expect(vsTicketMatchesYearFilter(2568, DONE_STATUS, 2569)).toBe(false);
  });

  it('a CLOSED ticket from the selected year is shown', () => {
    expect(vsTicketMatchesYearFilter(2569, DONE_STATUS, 2569)).toBe(true);
  });

  it('REGRESSION: a REOPENED ticket (status moved off เสร็จสิ้น) carries over even though `resolution` would still be stale non-null — status decides, never resolution', () => {
    // There is no `resolution` parameter any more — this test exists so a
    // future edit cannot silently reintroduce it as a second signal.
    expect(vsTicketMatchesYearFilter(2568, 'สโมกำลังดำเนินการ', 2569)).toBe(true);
  });

  it('a null samoYearBe (should not happen post-backfill) fails OPEN — always visible', () => {
    expect(vsTicketMatchesYearFilter(null, DONE_STATUS, 2569)).toBe(true);
  });

  it('handles string years from a <select>.value and a stored smallint alike', () => {
    expect(vsTicketMatchesYearFilter('2569', DONE_STATUS, 2569)).toBe(true);
    expect(vsTicketMatchesYearFilter(2569, DONE_STATUS, '2569')).toBe(true);
  });

  it('any non-เสร็จสิ้น status counts as open, not just the common ones', () => {
    for (const s of ['รอ SE รับเรื่อง', 'SE รับเรื่องแล้ว', 'กำลังติดต่อคณะ', 'ปฏิเสธ (ส่งคืน SE)']) {
      expect(vsTicketMatchesYearFilter(2568, s, 2569)).toBe(true);
    }
  });
});
