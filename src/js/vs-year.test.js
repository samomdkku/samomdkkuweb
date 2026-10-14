import { describe, it, expect } from 'vitest';
import { ALL_YEARS, vsTicketMatchesYearFilter } from './vs-year.js';
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
    expect(vsTicketMatchesYearFilter(2568, 'fixed', ALL_YEARS)).toBe(true);
    expect(vsTicketMatchesYearFilter(2568, null, ALL_YEARS)).toBe(true);
    expect(vsTicketMatchesYearFilter(null, null, ALL_YEARS)).toBe(true);
  });

  it('an OPEN ticket (no resolution yet) carries over into any specific year view', () => {
    expect(vsTicketMatchesYearFilter(2568, null, 2569)).toBe(true);
    expect(vsTicketMatchesYearFilter(2569, null, 2569)).toBe(true);
  });

  it('a CLOSED ticket from a different year is hidden by a specific year view', () => {
    expect(vsTicketMatchesYearFilter(2568, 'fixed', 2569)).toBe(false);
  });

  it('a CLOSED ticket from the selected year is shown', () => {
    expect(vsTicketMatchesYearFilter(2569, 'fixed', 2569)).toBe(true);
  });

  it('a null samoYearBe (should not happen post-backfill) fails OPEN — always visible', () => {
    expect(vsTicketMatchesYearFilter(null, 'fixed', 2569)).toBe(true);
  });

  it('handles string years from a <select>.value and a stored smallint alike', () => {
    expect(vsTicketMatchesYearFilter('2569', 'fixed', 2569)).toBe(true);
    expect(vsTicketMatchesYearFilter(2569, 'fixed', '2569')).toBe(true);
  });

  it('every resolution value (fixed/forwarded/wont_do/duplicate) counts as closed, not just "fixed"', () => {
    for (const r of ['fixed', 'forwarded', 'wont_do', 'duplicate']) {
      expect(vsTicketMatchesYearFilter(2568, r, 2569)).toBe(false);
    }
  });
});
