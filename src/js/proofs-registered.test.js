// ============================================================
// proofs-registered.test.js — every proof in tools/ is one `npm run proofs` runs.
//
// run-proofs.mjs already refuses to start when tools/ holds a .sql proof its
// PROOFS list does not name — but that guard fires only when somebody RUNS
// the proofs. year0242-start-samo-year.sql (2026-10-20) was proved by hand,
// committed unregistered, and from then on `npm run proofs` printed one ✗ line
// and ran nothing, for every proof, until a bug scan on 2026-10-22 tried it.
// The same check here fails at commit time instead (mistakes.md class 7: a
// guard nobody runs is not a guard).
//
// .sql only, as the runner does: tools/ is full of .mjs that are not proofs.
// ============================================================
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';

const TOOLS = new URL('../../tools/', import.meta.url);
const runner = readFileSync(new URL('run-proofs.mjs', TOOLS), 'utf8');
const listed = new Set([...runner.matchAll(/\[\s*'([\w-]+\.sql)'/g)].map((m) => m[1]));
const onDisk = readdirSync(TOOLS).filter((f) => f.endsWith('.sql'));

describe('live proofs are registered', () => {
  it('the instrument reads the list (control: an empty parse would pass anything)', () => {
    expect(listed.size).toBeGreaterThan(30);
    expect(listed.has('house0243-advisor-phones.sql')).toBe(true);
  });

  it('every .sql proof in tools/ is in PROOFS', () => {
    expect(onDisk.filter((f) => !listed.has(f))).toEqual([]);
  });

  it('every .sql in PROOFS exists in tools/', () => {
    expect([...listed].filter((f) => !onDisk.includes(f))).toEqual([]);
  });
});
