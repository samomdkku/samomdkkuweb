// proof-targeting.test.js — a proof must run against the database it was SENT
// to, and must be able to run with no `.env.local` at all.
//
// WHAT THIS IS FOR. On 2026-08-29, `VITE_SUPABASE_URL=$SUPABASE_DEV_URL
// npm run proofs` — the targeting documented in db-query.mjs's own header —
// sent the 17 `.sql` proofs to samo-dev and `proj0092-seat-parity.mjs` +
// `grant0093-reads.mjs` to PRODUCTION, and printed ONE GREEN SUMMARY over the
// mixture. Both files parsed `.env.local` themselves, so `process.env` never
// reached them. The sibling that had already been fixed (db-query.mjs) records
// the same bug in its header; the fix was never carried to the others.
//
// Two implementations of one rule drift (class 6), and this one drifted in the
// dangerous direction: the mixed run LOOKED clean.
//
// `run-proofs.mjs` now reads each proof's own `→ project:` announcement back
// and fails any proof that answered from the wrong database — that is the
// mechanism, and it catches a proof nobody has written yet. These tests are the
// cheap ratchet underneath it:
//
//   1. no proof reads `.env.local` directly — it goes through env-lib, which
//      lets `process.env` win and treats the file as optional;
//   2. env-lib really does tolerate the file's absence (CI has none — without
//      this, 21 of 23 proofs failed a CI-shaped run holding valid credentials);
//   3. the runner's ref check reads a REAL announcement, not a hopeful regex.
//
// The subject is derived from run-proofs.mjs's own PROOFS list rather than
// re-listed here, so a proof added there is covered the day it is added — never
// write a guard from the same list the code came from.
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('../../', import.meta.url).pathname;
const RUNNER = readFileSync(join(ROOT, 'tools/run-proofs.mjs'), 'utf8');

/** The proof filenames the runner actually executes, read from its own list. */
function proofFiles() {
  const start = RUNNER.indexOf('const PROOFS = [');
  expect(start, 'PROOFS is gone from run-proofs.mjs — was it renamed?').toBeGreaterThan(-1);
  const block = RUNNER.slice(start, RUNNER.indexOf('\n];', start));
  return [...block.matchAll(/\[\s*'([^']+\.(?:sql|mjs))'/g)].map((m) => m[1]);
}

/** The names the runner will SKIP in --dev, from the same source. */
function nonDb() {
  const m = RUNNER.match(/const NON_DB = new Set\(\[([^\]]*)\]\)/);
  expect(m, 'NON_DB is gone from run-proofs.mjs').not.toBe(null);
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

describe('every proof runs against the database it was sent to', () => {
  it('the runner names proofs that exist', () => {
    const files = proofFiles();
    expect(files.length, 'no proofs parsed out of PROOFS').toBeGreaterThan(20);
    for (const f of files) {
      expect(existsSync(join(ROOT, 'tools', f)), `PROOFS names tools/${f}, which does not exist`)
        .toBe(true);
    }
  });

  it('no proof parses .env.local itself', () => {
    // Reading the file directly is exactly how a proof stops honouring an
    // override: `process.env` never gets a chance to win. Going through
    // env-lib (or db-query.mjs, which does) is what makes --dev mean anything.
    const offenders = [];
    const skip = new Set(nonDb());
    for (const f of proofFiles()) {
      if (!f.endsWith('.mjs')) continue;                 // .sql runs via db-query
      // The NON_DB proofs ask GitHub and Cloudflare; they hold no database
      // credential and correctly have no target to announce. Asserting this
      // over them made the guard fire on the healthy case, which is how a
      // guard gets suppressed and then protects nothing.
      if (skip.has(f)) continue;
      const src = readFileSync(join(ROOT, 'tools', f), 'utf8');
      const readsLocal = /readFileSync\(\s*new URL\(\s*'\.\.\/\.env\.local'/.test(src);
      const viaLib = /from '\.\/env-lib\.mjs'/.test(src);
      const viaDbQuery = /db-query\.mjs/.test(src);
      if (readsLocal && !viaLib) offenders.push(f);
      expect(viaLib || viaDbQuery, `tools/${f} reaches the database without env-lib or db-query.mjs`)
        .toBe(true);
    }
    expect(offenders, 'these proofs parse .env.local directly, so --dev cannot redirect them')
      .toEqual([]);
  });

  it('the skip list names proofs the runner actually has', () => {
    const files = new Set(proofFiles());
    for (const n of nonDb()) {
      expect(files.has(n), `NON_DB names ${n}, which is not in PROOFS — the skip is dead`).toBe(true);
    }
    // A skip list that grew to cover everything would make --dev vacuous.
    expect(nonDb().length).toBeLessThan(proofFiles().length / 2);
  });

  it('a proof that answers from the wrong project is FAILED, not passed', () => {
    // The property, read off the runner's source: the ref comparison must
    // produce FAIL, and a missing announcement must produce UNKNOWN. Both were
    // falsified for real by reintroducing the bug (see the write-up).
    // EVERY announcement, not just the first — a proof that queried dev then
    // production would otherwise pass on its opening line.
    expect(RUNNER, 'the runner checks only one announcement').toMatch(/matchAll\(/);
    expect(RUNNER).toMatch(/wrong\.length/);
    expect(RUNNER).toMatch(/state: 'FAIL', detail: `ran against \$\{wrong\.join/);
    expect(RUNNER).toMatch(/state: 'UNKNOWN', detail: 'did not announce which project it queried'/);
  });
});

describe('env-lib is usable where there is no .env.local', () => {
  it('announces on stderr, because stdout is parsed as JSON', async () => {
    const lib = readFileSync(join(ROOT, 'tools/env-lib.mjs'), 'utf8');
    expect(lib, 'announceTarget must not write to stdout — run-proofs JSON.parses it')
      .toMatch(/console\.error\(`→ project:/);
    expect(lib).not.toMatch(/console\.log\(`→ project:/);
  });

  it('treats .env.local as optional and lets process.env win', async () => {
    const { loadEnv, resolveTarget } = await import('../../tools/env-lib.mjs');
    const { env } = loadEnv();
    // Whatever is on disk, an explicit process.env value must be what resolves.
    const before = process.env.VITE_SUPABASE_URL;
    process.env.VITE_SUPABASE_URL = 'https://zzzguardtest.supabase.co';
    try {
      expect(resolveTarget().ref, 'process.env did not override .env.local').toBe('zzzguardtest');
      expect(resolveTarget().isProd, 'an unknown ref was labelled PRODUCTION').toBe(false);
    } finally {
      if (before === undefined) delete process.env.VITE_SUPABASE_URL;
      else process.env.VITE_SUPABASE_URL = before;
    }
    expect(env, 'loadEnv returned nothing at all').toBeTypeOf('object');
  });

  it('a dev-only checkout (default project = samo-dev) is labelled samo-dev, not PRODUCTION', () => {
    // The night agent's clone: samo-dev is its default and its only project.
    return import('../../tools/env-lib.mjs').then(({ resolveTarget }) => {
      const url = 'https://devonlyref.supabase.co';
      const t = resolveTarget({
        env: { VITE_SUPABASE_URL: url, SUPABASE_DEV_URL: url, SUPABASE_ACCESS_TOKEN: 'x' },
        fileEnv: { VITE_SUPABASE_URL: url, SUPABASE_DEV_URL: url },
      });
      expect(t.isDev).toBe(true);
      expect(t.isProd).toBe(false);
      expect(t.label).toBe('samo-dev');
      // CONTROL: the laptop shape still says PRODUCTION for the production ref.
      const p = resolveTarget({
        env: { VITE_SUPABASE_URL: 'https://prodref.supabase.co', SUPABASE_DEV_URL: url },
        fileEnv: { VITE_SUPABASE_URL: 'https://prodref.supabase.co', SUPABASE_DEV_URL: url },
      });
      expect(p.label).toBe('PRODUCTION');
    });
  });

  it('the runner refuses --dev when it does not resolve to samo-dev', () => {
    // A SUPABASE_DEV_URL pointing at production would otherwise run the whole
    // suite against live data under a label saying "samo-dev".
    expect(RUNNER).toMatch(/wantDev && !TARGET\.isDev/);
    expect(RUNNER).toMatch(/which is not samo-dev/);
  });
});
