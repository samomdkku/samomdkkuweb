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
// Since 2026-10-31 the rollover buttons live on the main admin's ปี SAMO page
// (samo-year-admin.js), calling one helper each in team/api.js; Passport admin
// keeps only a link. Both pages are swept for direct writes.
const read = (f) => stripComments(readFileSync(join(ROOT, f), 'utf8'));
const API = read('src/js/team/api.js');
const PAGES = {
  'passport/js/admin-page.js': read('passport/js/admin-page.js'),
  'src/js/samo-year-admin.js': read('src/js/samo-year-admin.js'),
  'src/js/team/api.js': API,
};

/** The body of one `export async function <name>(…) { … }` in team/api.js. */
function bodyOf(name) {
  const start = API.search(new RegExp(`export async function ${name}\\(`));
  expect(start, `${name} not found in team/api.js — was it renamed?`).toBeGreaterThan(-1);
  const end = API.indexOf('\n}', start);
  expect(end, `${name}: could not find the end of the function`).toBeGreaterThan(start);
  return API.slice(start, end);
}

const HANDLERS = { passportStartVara: 'start_vara', passportStartSeason: 'start_season', passportSaveSchedule: 'set_season_schedule' };

describe('the browser never writes a วาระ / season row', () => {
  it('found every handler (a sweep that finds nothing must prove it looked)', () => {
    for (const n of Object.keys(HANDLERS)) expect(bodyOf(n).length).toBeGreaterThan(120);
  });

  for (const [name, rpc] of Object.entries(HANDLERS)) {
    it(`${name} is one call to passport.${rpc}`, () => {
      const body = bodyOf(name);
      expect(body).toContain(`'/rpc/${rpc}'`);
      expect(body).toContain('PP_RPC');                       // the passport schema, not public
      expect(body.match(/dbRest\(/g) || []).toHaveLength(1);
    });
  }

  it('the ปี SAMO page reaches them through those helpers', () => {
    const page = PAGES['src/js/samo-year-admin.js'];
    for (const n of Object.keys(HANDLERS)) expect(page).toContain(`await ${n}(`);
  });

  it('Passport admin no longer carries a rollover of its own', () => {
    const pp = PAGES['passport/js/admin-page.js'];
    for (const rpc of Object.values(HANDLERS)) expect(pp).not.toContain(`rpc('${rpc}'`);
  });

  it('no code in either page inserts, updates or deletes samo_years / samo_seasons', () => {
    // cleanAllData's wipe() is the one deliberate exception: it deletes EVERY
    // row of every table by name, so there is nothing left open to mis-file.
    for (const [file, src] of Object.entries(PAGES)) {
      const writes = [
        ...(src.match(/from\('samo_(years|seasons)'\)\s*\.(insert|update|delete|upsert)\(/g) || []),
        ...(src.match(/dbRest\(\s*['`]\/samo_(years|seasons)[^)]*method:\s*['"](POST|PATCH|DELETE)/g) || []),
      ];
      expect(writes, [
        `${file}: a rollover is writing samo_years / samo_seasons from the browser again.`,
        'Several round-trips reopen the window with nothing open, and a failed step',
        'leaves it half-done. Use the RPC (one transaction) — passport.start_season /',
        'start_vara.',
      ].join('\n')).toEqual([]);
    }
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
