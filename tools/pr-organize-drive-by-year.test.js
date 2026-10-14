import { describe, it, expect } from 'vitest';
import { buildMovePlan } from './pr-organize-drive-by-year.mjs';

describe('buildMovePlan', () => {
  it('plans one entry per Drive image attachment, tagged with the ticket\'s year', () => {
    const rows = [
      { id: 'PR-1', samo_year_be: 2569, file_url: 'https://drive.google.com/file/d/AAA/view\nhttps://lh3.googleusercontent.com/d/BBB=w1200' },
    ];
    const plan = buildMovePlan(rows);
    expect(plan).toEqual([
      { ticketId: 'PR-1', year: 2569, url: 'https://drive.google.com/file/d/AAA/view' },
      { ticketId: 'PR-1', year: 2569, url: 'https://lh3.googleusercontent.com/d/BBB=w1200' },
    ]);
  });

  it('skips a ticket with no resolved samo_year_be — nowhere to file it yet', () => {
    const rows = [{ id: 'PR-2', samo_year_be: null, file_url: 'https://drive.google.com/file/d/CCC/view' }];
    expect(buildMovePlan(rows)).toEqual([]);
  });

  it('skips a pasted ลิงก์เสริม — never a file this account necessarily owns', () => {
    const rows = [{ id: 'PR-3', samo_year_be: 2569, file_url: 'ลิงก์เสริม: https://drive.google.com/file/d/DDD/view' }];
    expect(buildMovePlan(rows)).toEqual([]);
  });

  it('skips an image URL that is not a Drive/googleusercontent host', () => {
    const rows = [{ id: 'PR-4', samo_year_be: 2569, file_url: 'https://example.com/not-drive.png' }];
    expect(buildMovePlan(rows)).toEqual([]);
  });

  it('skips a ticket with no attachments, and the legacy "no file" literal', () => {
    const rows = [
      { id: 'PR-5', samo_year_be: 2569, file_url: null },
      { id: 'PR-6', samo_year_be: 2569, file_url: 'ไม่มีไฟล์แนบ' },
    ];
    expect(buildMovePlan(rows)).toEqual([]);
  });

  it('handles multiple tickets across different years', () => {
    const rows = [
      { id: 'PR-7', samo_year_be: 2568, file_url: 'https://drive.google.com/file/d/E/view' },
      { id: 'PR-8', samo_year_be: 2569, file_url: 'https://drive.google.com/file/d/F/view' },
    ];
    const plan = buildMovePlan(rows);
    expect(plan.map((p) => p.year)).toEqual([2568, 2569]);
  });

  it('tolerates an empty/undefined row list', () => {
    expect(buildMovePlan([])).toEqual([]);
    expect(buildMovePlan(undefined)).toEqual([]);
  });
});
