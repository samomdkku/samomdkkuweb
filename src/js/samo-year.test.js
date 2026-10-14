import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  MIN_SAMO_YEAR, MAX_SAMO_YEAR, isValidSamoYear, currentSamoYear, samoYearOptionsHtml,
} from './samo-year.js';

const SQL_0219 = readFileSync(
  new URL('../../supabase/migrations/0219_one_samo_year_for_every_system.sql', import.meta.url), 'utf8',
);
const SQL_0104 = readFileSync(
  new URL('../../supabase/migrations/0104_team_terms_and_archive.sql', import.meta.url), 'utf8',
);

describe('samo-year.js mirrors the database — three homes, one number', () => {
  it('start_team_term refuses the same bounds the JS constants use', () => {
    const m = SQL_0219.match(/p_year < (\d+) or p_year > (\d+)/);
    expect(m, "start_team_term's bad-year guard must exist and be parseable").toBeTruthy();
    expect(Number(m[1])).toBe(MIN_SAMO_YEAR);
    expect(Number(m[2])).toBe(MAX_SAMO_YEAR);
  });

  it('team_terms_year_range (0104) agrees with the same bounds', () => {
    const m = SQL_0104.match(/check \(year between (\d+) and (\d+)\)/);
    expect(m, 'team_terms_year_range must exist and be parseable').toBeTruthy();
    expect(Number(m[1])).toBe(MIN_SAMO_YEAR);
    expect(Number(m[2])).toBe(MAX_SAMO_YEAR);
  });

  it('current_samo_year() reads is_current — the same predicate the JS twin uses', () => {
    expect(SQL_0219).toMatch(/select year from public\.team_terms where is_current/);
  });
});

describe('isValidSamoYear', () => {
  it('accepts the documented range, inclusive', () => {
    expect(isValidSamoYear(MIN_SAMO_YEAR)).toBe(true);
    expect(isValidSamoYear(MAX_SAMO_YEAR)).toBe(true);
    expect(isValidSamoYear(2569)).toBe(true);
  });
  it('rejects outside it, and anything unreadable', () => {
    expect(isValidSamoYear(MIN_SAMO_YEAR - 1)).toBe(false);
    expect(isValidSamoYear(MAX_SAMO_YEAR + 1)).toBe(false);
    expect(isValidSamoYear(null)).toBe(false);
    expect(isValidSamoYear('ปีนี้')).toBe(false);
    expect(isValidSamoYear(2569.5)).toBe(false);
  });
});

describe('currentSamoYear', () => {
  it('finds the row marked is_current', () => {
    expect(currentSamoYear([{ year: 2569, is_current: true }, { year: 2570, is_current: false }])).toBe(2569);
  });
  it('returns null rather than guessing when nothing is current', () => {
    expect(currentSamoYear([{ year: 2569, is_current: false }])).toBe(null);
    expect(currentSamoYear([])).toBe(null);
    expect(currentSamoYear(null)).toBe(null);
    expect(currentSamoYear(undefined)).toBe(null);
  });
});

describe('samoYearOptionsHtml', () => {
  const years = [
    { year: 2569, is_current: true },
    { year: 2570, is_current: false },
    { year: 2568, is_current: false, label: 'ปีก่อนหน้า' },
  ];

  it('orders newest year first', () => {
    const order = [...samoYearOptionsHtml(years, null).matchAll(/value="(\d+)"/g)].map((m) => m[1]);
    expect(order).toEqual(['2570', '2569', '2568']);
  });

  it('marks the requested year selected, and only that one', () => {
    const html = samoYearOptionsHtml(years, 2569);
    expect(html).toMatch(/<option value="2569" selected>/);
    expect(html).not.toMatch(/<option value="2570" selected>/);
    expect(html).not.toMatch(/<option value="2568" selected>/);
  });

  it('labels the current year, and a term with a label', () => {
    const html = samoYearOptionsHtml(years, null);
    expect(html).toContain('2569 (ปีปัจจุบัน)');
    expect(html).toContain('2568 — ปีก่อนหน้า');
  });

  it('escapes a free-text label so it cannot inject markup', () => {
    const html = samoYearOptionsHtml([{ year: 2569, label: '<img onerror=alert(1)>' }], null);
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });

  it('selects nothing when `current` matches no offered year', () => {
    expect(samoYearOptionsHtml(years, 1900)).not.toContain('selected');
  });
});
