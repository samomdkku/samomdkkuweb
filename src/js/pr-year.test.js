import { describe, it, expect } from 'vitest';
import {
  ALL_YEARS, isPastYearView, ticketMatchesYearFilter, buildPrTicketsCsv, prCsvFilename,
} from './pr-year.js';

describe('isPastYearView', () => {
  it('ทุกปี is never a lock', () => {
    expect(isPastYearView(ALL_YEARS, 2569)).toBe(false);
  });
  it('the current year is never a lock', () => {
    expect(isPastYearView(2569, 2569)).toBe(false);
  });
  it('a year older than current locks the view', () => {
    expect(isPastYearView(2568, 2569)).toBe(true);
  });
  it('a year NEWER than current (a seeded future term) does not lock — only the past is read-only', () => {
    expect(isPastYearView(2570, 2569)).toBe(false);
  });
  it('fails OPEN (no lock) when the current year is not known yet', () => {
    expect(isPastYearView(2568, null)).toBe(false);
  });
  it('handles string years from a <select>.value', () => {
    expect(isPastYearView('2568', 2569)).toBe(true);
    expect(isPastYearView('2569', 2569)).toBe(false);
  });
});

describe('ticketMatchesYearFilter', () => {
  it('ทุกปี matches everything', () => {
    expect(ticketMatchesYearFilter(2568, ALL_YEARS)).toBe(true);
    expect(ticketMatchesYearFilter(null, ALL_YEARS)).toBe(true);
  });
  it('a ticket with no resolved year is never hidden by a specific-year filter', () => {
    expect(ticketMatchesYearFilter(null, 2569)).toBe(true);
    expect(ticketMatchesYearFilter(undefined, 2569)).toBe(true);
  });
  it('matches only the selected year otherwise', () => {
    expect(ticketMatchesYearFilter(2569, 2569)).toBe(true);
    expect(ticketMatchesYearFilter(2568, 2569)).toBe(false);
  });
  it('compares numerically, not by string identity', () => {
    expect(ticketMatchesYearFilter('2569', 2569)).toBe(true);
  });
});

describe('buildPrTicketsCsv', () => {
  const base = {
    id: 'PR-000001', samoYearBe: 2569, timestampIso: '2026-05-22T10:00:00Z',
    dept: 'ฝ่ายดิจิทัลและสื่อสารองค์กร', contentName: 'โพสต์ประชาสัมพันธ์',
    jobType: 'New content', platforms: 'Facebook, Instagram', otherPlatforms: '',
    otherPlatformReason: '', postingChannel: 'เพจคณะ', publishDateIso: '2026-05-23T09:00:00Z',
    deadline: 'ปกติ', rushReason: '', projectAccount: '-', copostWith: '-',
    submitter: 'guest@kkumail.com', status: 'โพสต์เรียบร้อย (เสร็จสิ้น)', assignees: ['เอ', 'บี'],
    attachmentCount: 2, brief: 'บรีฟงาน', caption: 'แคปชั่น',
  };

  it('starts with a UTF-8 BOM so Excel renders Thai correctly', () => {
    expect(buildPrTicketsCsv([base]).charCodeAt(0)).toBe(0xFEFF);
  });

  it('has a header row naming every column, and one data row per ticket', () => {
    const csv = buildPrTicketsCsv([base, { ...base, id: 'PR-000002' }]);
    const lines = csv.slice(1).split('\r\n');
    expect(lines[0]).toContain('ticket_id');
    expect(lines[0]).toContain('samo_year_be');
    expect(lines.length).toBe(3); // header + 2 tickets
  });

  it('joins an array field (assignees) with a separator, not [object Object]', () => {
    const csv = buildPrTicketsCsv([base]);
    expect(csv).toContain('เอ; บี');
  });

  it('guards a formula-shaped field so Excel does not execute it', () => {
    const csv = buildPrTicketsCsv([{ ...base, brief: '=HYPERLINK("https://evil.example")' }]);
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).not.toMatch(/[^']="HYPERLINK/);
  });

  it('empty list still produces a valid header-only CSV', () => {
    const csv = buildPrTicketsCsv([]);
    expect(csv.slice(1).split('\r\n').length).toBe(1);
  });
});

describe('prCsvFilename', () => {
  it('names a specific year', () => {
    expect(prCsvFilename(2569, '2026-10-14-0100')).toBe('samo-pr-tickets-ปี-2569-2026-10-14-0100.csv');
  });
  it('names ทุกปี distinctly from any real year', () => {
    expect(prCsvFilename(ALL_YEARS, '2026-10-14-0100')).toBe('samo-pr-tickets-all-years-2026-10-14-0100.csv');
  });
});
