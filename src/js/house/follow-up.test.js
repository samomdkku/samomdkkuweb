import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { FOLLOW_UP, CLOSING, followUpFromText, isAnsweredEmpty } from './follow-up.js';

const SQL = readFileSync(new URL('../../../supabase/migrations/0217_what_the_data_team_found_out.sql', import.meta.url), 'utf8');

describe('FOLLOW_UP mirrors the database (0217)', () => {
  // The check constraint and the JS map are two homes of one list; this is the
  // differential test that keeps them one (mistakes.md class 6).
  it('the check constraint allows exactly these statuses', () => {
    const m = SQL.match(/check \(follow_up in \(([^)]*)\)\)/);
    const allowed = m[1].match(/'([a-z_]+)'/g).map((s) => s.slice(1, -1));
    expect(allowed.sort()).toEqual(Object.keys(FOLLOW_UP).sort());
  });

  it('the statuses that close a row are the ones the RPC and the constraint close', () => {
    const rpc = SQL.match(/v_close boolean := p_status in \(([^)]*)\)/)[1].match(/'([a-z_]+)'/g).map((s) => s.slice(1, -1));
    const constraint = SQL.match(/follow_up not in \(([^)]*)\) or resolved_at is not null/)[1]
      .match(/'([a-z_]+)'/g).map((s) => s.slice(1, -1));
    expect(rpc.sort()).toEqual([...CLOSING].sort());
    expect(constraint.sort()).toEqual([...CLOSING].sort());
  });
});

describe('followUpFromText', () => {
  it('reads the four remarks the 2026-10-13 answer used', () => {
    expect(followUpFromText('ติดต่อไม่ได้')).toBe('unreachable');
    expect(followUpFromText('คาดว่าลาออกแล้ว')).toBe('maybe_left');
    expect(followUpFromText('ลาออก')).toBe('left');
    expect(followUpFromText('เลขนี้ไม่มีตัวตน')).toBe('no_person');
  });

  it('a GUESS never reads as the fact it contains', () => {
    // "คาดว่าลาออก" contains "ลาออก" — tested first, or a guess closes a seat.
    expect(followUpFromText('คาดว่า ลาออก แล้วค่ะ')).toBe('maybe_left');
    expect(followUpFromText('น่าจะลาออก')).toBe('maybe_left');
  });

  it('anything else is not guessed at', () => {
    expect(followUpFromText('')).toBe(null);
    expect(followUpFromText('ซ้ำชั้น')).toBe(null);
    expect(followUpFromText(undefined)).toBe(null);
  });
});

describe('isAnsweredEmpty', () => {
  it('only a CLOSED row with a closing answer explains an empty สาย', () => {
    expect(isAnsweredEmpty({ resolved_at: 'x', follow_up: 'left' })).toBe(true);
    expect(isAnsweredEmpty({ resolved_at: 'x', follow_up: 'no_person' })).toBe(true);
    expect(isAnsweredEmpty({ resolved_at: null, follow_up: 'unreachable' })).toBe(false);
    expect(isAnsweredEmpty({ resolved_at: 'x', follow_up: null })).toBe(false);
  });
});
