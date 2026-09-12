// ==============================================
// discord-report.test.js — the phase-2 report CANNOT write to Discord.
//
// docs/DISCORD-ROLE-SYNC.md phase 2 is "report-only", and phase 3 is the one
// allowed to apply. That boundary is worth exactly as much as the thing
// enforcing it: a comment saying "read only" is lost to a bad merge, a
// copy-paste from the phase-3 file, or a helpful refactor that adds a `method`
// parameter "for later".
//
// So this asserts the PROPERTY — no HTTP verb but GET leaves this file — rather
// than reviewing the six call sites that exist today. A list of call sites
// cannot see the seventh (.claude/rules/mistakes.md class 7).
// ==============================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..');
const SRC = readFileSync(join(ROOT, 'tools', 'discord-report.mjs'), 'utf8');

/** A fetch that is not a plain GET, or any Discord mutation verb. */
const WRITES = /method\s*:\s*['"`](POST|PUT|PATCH|DELETE)|\.(post|put|patch|delete)\s*\(/i;

describe('the Discord report is read-only, by construction', () => {
  it('read the file at all — a sweep must prove it looked', () => {
    expect(SRC.length).toBeGreaterThan(2000);
    expect(SRC).toContain('discord.com/api');
    expect(SRC).toContain('--report');
  });

  // The CONTROL. Without it a regex that matches nothing reports a clean sweep
  // for ever, and this test becomes decoration.
  it('its detector would catch a write', () => {
    expect(WRITES.test(`fetch(x, { method: 'PATCH' })`)).toBe(true);
    expect(WRITES.test(`fetch(x, { method: "DELETE" })`)).toBe(true);
    expect(WRITES.test(`await api.put('/roles')`)).toBe(true);
    expect(WRITES.test(`fetch(x, { headers: h })`)).toBe(false);
  });

  it('contains no write to Discord', () => {
    expect(WRITES.test(SRC),
      'tools/discord-report.mjs has gained a write. Phase 2 writes NOTHING — '
      + 'if this is phase 3 work, it belongs in its own file with the '
      + 'blast-radius cap, not here.').toBe(false);
  });

  // Every Discord call goes through one helper, so "it only GETs" is checkable
  // by reading one function instead of trusting a grep over the whole file.
  it('routes every Discord call through the single GET helper', () => {
    const direct = [...SRC.matchAll(/fetch\(/g)].length;
    expect(direct, 'more than one fetch() means the single-door claim is false')
      .toBe(1);
  });

  // It must refuse rather than improvise when the token is absent — and must
  // NOT suggest copying it to the machine running the report, which is the
  // move that leaked this credential three times.
  it('tells you to move the DUMP, never the token', () => {
    expect(SRC).toMatch(/DISCORD_TOKEN is not set/);
    expect(SRC).toMatch(/must not be copied there/);
  });
});
