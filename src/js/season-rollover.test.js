// ============================================================
// season-rollover.test.js — a วาระ / season rollover leaves no gap.
//
// passport.stamp_scan files every scan under a season, and a moment with NO open
// season (or a วาระ with none of its own) mis-files or refuses scans silently.
// Both rollover buttons once did exactly that: they ended the current row from
// the browser, THEN created its replacement, four round-trips apart — and if the
// create failed, nothing was open at all until a human noticed (fixed
// 2026-09-04 by reordering, guarded here since).
//
// 0245 (2026-10-23) removed the window instead of narrowing it: the browser no
// longer writes samo_years / samo_seasons at all. Every rollover is ONE
// database call — start_vara, start_season, the automatic
// apply_season_schedule, start_samo_year — inside one transaction, where "create
// then end" cannot be observed half-done by any reader. So the property is now:
//
//   1. no handler in the admin page writes those tables directly, and
//   2. inside each rollover FUNCTION, the replacement is created before the
//      old row is ended, and the closing update excludes the row it made.
//
// Rule and reasoning: docs/INVARIANTS.md, "Never leave a GAP between two วาระ
// or two seasons".
// ============================================================

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from './strip-comments.js';

const ROOT = new URL('../../', import.meta.url).pathname;
const SRC = stripComments(readFileSync(join(ROOT, 'passport/js/admin-page.js'), 'utf8'));

/** The body of one `window.<name> = async (…) => { … }` handler. */
function bodyOf(name) {
  const start = SRC.search(new RegExp(`window\\.${name} = async \\([^)]*\\) =>`));
  expect(start, `${name} not found in admin-page.js — was it renamed?`).toBeGreaterThan(-1);
  const end = SRC.indexOf('\n};', start);
  expect(end, `${name}: could not find the end of the handler`).toBeGreaterThan(start);
  return SRC.slice(start, end);
}

const HANDLERS = { startNewYear: 'start_vara', switchQuarter: 'start_season', saveSchedule: 'set_season_schedule' };

describe('the browser never writes a วาระ / season row', () => {
  it('found every handler (a sweep that finds nothing must prove it looked)', () => {
    for (const n of Object.keys(HANDLERS)) expect(bodyOf(n).length).toBeGreaterThan(150);
  });

  for (const [name, rpc] of Object.entries(HANDLERS)) {
    it(`${name} is one call to passport.${rpc}`, () => {
      expect(bodyOf(name)).toContain(`adminDb.rpc('${rpc}'`);
    });
  }

  it('no code in the admin page inserts, updates or deletes samo_years / samo_seasons', () => {
    // cleanAllData's wipe() is the one deliberate exception: it deletes EVERY
    // row of every table by name, so there is nothing left open to mis-file.
    const writes = SRC.match(/from\('samo_(years|seasons)'\)\s*\.(insert|update|delete|upsert)\(/g) || [];
    expect(writes, [
      'A rollover is writing samo_years / samo_seasons from the browser again.',
      'Several round-trips reopen the window with nothing open, and a failed step',
      'leaves it half-done. Use the RPC (one transaction) — passport.start_season /',
      'start_vara.',
    ].join('\n')).toEqual([]);
  });
});

/** Every SQL function in the migrations that opens a season, as its LAST
 *  definition (a later migration replaces an earlier one). */
function rolloverFunctions() {
  const dir = join(ROOT, 'supabase/migrations');
  const out = new Map();
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
    const sql = readFileSync(join(dir, f), 'utf8');
    const re = /create or replace function ([\w.]+)\s*\([\s\S]*?\$fn\$;/gi;   // a body ends at its FIRST `$fn$;`
    let m;
    while ((m = re.exec(sql))) {
      const body = m[0];
      if (/insert into passport\.samo_seasons/i.test(body)) out.set(m[1].toLowerCase(), { file: f, body });
    }
  }
  return out;
}

// The CLOSING update — `set ended_at = <instant>`. Not `= null`: that is a
// quarter being REOPENED (start_season going back), which closes nothing.
const CLOSE = /update passport\.samo_seasons\s+set ended_at\s*=\s*(?!null\b)\S/i;

describe('inside each rollover function: create, THEN end', () => {
  const fns = rolloverFunctions();

  it('finds the four rollover functions (control: the sweep can see them)', () => {
    for (const n of ['passport.apply_season_schedule', 'passport.start_season',
      'passport.start_vara', 'public.start_samo_year']) {
      expect(fns.has(n), `${n} not found in supabase/migrations`).toBe(true);
    }
  });

  for (const [name, { file, body }] of fns) {
    it(`${name} (${file}) creates its season before ending the open one`, () => {
      const createAt = body.search(/insert into passport\.samo_seasons/i);
      const endAt = body.search(CLOSE);
      expect(endAt, `${name}: never ends the open season`).toBeGreaterThan(-1);
      expect(createAt, `${name}: ends the open season BEFORE creating the new one`).toBeLessThan(endAt);
    });

    it(`${name} excludes the season it opened from the closing update`, () => {
      const close = body.slice(body.search(CLOSE));
      expect(close.slice(0, 200), `${name}: the closing update would also end the season it just opened`)
        .toMatch(/id <> /);
    });
  }
});
