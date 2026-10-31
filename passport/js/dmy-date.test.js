// The dd/mm/yyyy date field's parsing (dmy-date.js). The owner asked for the
// event date and the QR end date to read day-first whatever the browser's
// locale; what reaches the database must still be YYYY-MM-DD.
import { describe, it, expect } from 'vitest';
import { dmyToIso, isoToDmy } from './dmy-date.js';

describe('dd/mm/yyyy ↔ YYYY-MM-DD', () => {
  it('shows a stored day day-first', () => {
    expect(isoToDmy('2026-10-31')).toBe('31/10/2026');
    expect(isoToDmy('')).toBe('');
  });
  it('reads day-first, never month-first', () => {
    expect(dmyToIso('31/10/2026')).toBe('2026-10-31');
    expect(dmyToIso('1/3/2027')).toBe('2027-03-01');      // 1 มี.ค., not 3 ม.ค.
    expect(dmyToIso('10/31/2026')).toBeNull();            // US order is refused, not guessed
  });
  it('accepts the other separators, bare digits and a พ.ศ. year', () => {
    expect(dmyToIso('31-10-2026')).toBe('2026-10-31');
    expect(dmyToIso('31.10.2026')).toBe('2026-10-31');
    expect(dmyToIso('31102026')).toBe('2026-10-31');
    expect(dmyToIso('31/10/2569')).toBe('2026-10-31');
  });
  it('refuses a day that does not exist', () => {
    expect(dmyToIso('31/02/2026')).toBeNull();
    expect(dmyToIso('29/02/2027')).toBeNull();
    expect(dmyToIso('29/02/2028')).toBe('2028-02-29');
    expect(dmyToIso('0/10/2026')).toBeNull();
    expect(dmyToIso('31/10/26')).toBeNull();
  });
  it('round-trips', () => {
    for (const iso of ['2026-01-01', '2026-12-31', '2027-02-28']) expect(dmyToIso(isoToDmy(iso))).toBe(iso);
  });
});
