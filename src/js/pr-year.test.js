import { describe, it, expect } from 'vitest';
import {
  ALL_YEARS, isPastYearView, isPastYearTicket, ticketMatchesYearFilter, buildPrTicketsCsv, prCsvFilename,
  PR_DONE_STATUS,
} from './pr-year.js';

const DONE = PR_DONE_STATUS;

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

describe('isPastYearTicket', () => {
  it('locks a ticket older than the current year', () => {
    expect(isPastYearTicket(2568, 2569, DONE)).toBe(true);
  });
  it('does not lock the current year', () => {
    expect(isPastYearTicket(2569, 2569, DONE)).toBe(false);
  });
  it('does not lock a ticket with no resolved year', () => {
    expect(isPastYearTicket(null, 2569, DONE)).toBe(false);
    expect(isPastYearTicket(undefined, 2569, DONE)).toBe(false);
  });
  it('fails open when the current year is not known yet', () => {
    expect(isPastYearTicket(2568, null, DONE)).toBe(false);
  });
  it('is independent of ANY filter sentinel — it only ever sees a real ticket year', () => {
    // Regression: the lock used to be read off the dashboard's <select>
    // filter (isPastYearView), which meant switching the filter to "ทุกปี"
    // (or to the current year) unlocked editing on EVERY past-year ticket
    // underneath it — browsing broadly disarmed the guard entirely. This
    // function takes the ticket's OWN year, so no filter value can do that.
    expect(isPastYearTicket(2568, 2569, DONE)).toBe(true);
  });
});

describe('ticketMatchesYearFilter', () => {
  it('ทุกปี matches everything', () => {
    expect(ticketMatchesYearFilter(2568, ALL_YEARS, DONE)).toBe(true);
    expect(ticketMatchesYearFilter(null, ALL_YEARS, DONE)).toBe(true);
  });
  it('a ticket with no resolved year is never hidden by a specific-year filter', () => {
    expect(ticketMatchesYearFilter(null, 2569, DONE)).toBe(true);
    expect(ticketMatchesYearFilter(undefined, 2569, DONE)).toBe(true);
  });
  it('matches only the selected year otherwise', () => {
    expect(ticketMatchesYearFilter(2569, 2569, DONE)).toBe(true);
    expect(ticketMatchesYearFilter(2568, 2569, DONE)).toBe(false);
  });
  it('compares numerically, not by string identity', () => {
    expect(ticketMatchesYearFilter('2569', 2569, DONE)).toBe(true);
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

describe('open tickets carry over (review 2026-10-14)', () => {
  it('an UNFINISHED past-year ticket is never hidden by a specific-year filter', () => {
    expect(ticketMatchesYearFilter(2568, 2569, 'รอ PR รับเรื่อง')).toBe(true);
    expect(ticketMatchesYearFilter(2568, 2569, 'กำลังแก้ไขงาน')).toBe(true);
  });
  it('a FINISHED past-year ticket is hidden, in its legacy spelling too', () => {
    expect(ticketMatchesYearFilter(2568, 2569, DONE)).toBe(false);
    expect(ticketMatchesYearFilter(2568, 2569, 'เสร็จสิ้น')).toBe(false);
  });
  it('an UNFINISHED past-year ticket is not locked — it is the new team\'s work', () => {
    expect(isPastYearTicket(2568, 2569, 'PR รับเรื่อง')).toBe(false);
  });
  it('a FINISHED past-year ticket is locked', () => {
    expect(isPastYearTicket(2568, 2569, DONE)).toBe(true);
  });
});
