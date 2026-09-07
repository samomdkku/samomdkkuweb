// ==============================================
// The migration replay must test the migrations, not the tool running them.
//
// The first real run reported `0153` broken — a migration that has been live in
// production for weeks. It creates `temp table _flatten on commit drop` and
// uses it three statements later. `tools/apply-migration.mjs` POSTs a whole
// file as ONE query, so the file is one transaction; psql's default autocommit
// makes every STATEMENT a transaction, which dropped the temp table
// immediately. The instrument disagreed with the path it was meant to check,
// and it was about to condemn 27 healthy migrations.
// ==============================================
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { isHostedUrl, classify } from '../../tools/replay-migrations.mjs';
import { stripComments } from './strip-comments.js';

const ROOT = join(import.meta.dirname, '..', '..');
const SRC = stripComments(readFileSync(join(ROOT, 'tools/replay-migrations.mjs'), 'utf8'));

describe('the replay applies a file the way the real applier does', () => {
  it('one transaction per file — a temp table must survive to the last statement', () => {
    expect(SRC, 'psql runs in autocommit without this, so every statement is its '
      + 'own transaction and `on commit drop` fires immediately — 0153 is the '
      + 'migration that proves it').toContain('--single-transaction');
  });

  it('no migration needs to run OUTSIDE a transaction — the assumption above', () => {
    // If someone adds `create index concurrently`, --single-transaction starts
    // failing that file and this test says why before the CI log has to.
    const dir = join(ROOT, 'supabase/migrations');
    const offenders = readdirSync(dir)
      .filter((f) => f.endsWith('.sql'))
      .filter((f) => /concurrently|^\s*vacuum|create database|alter system/im
        .test(stripComments(readFileSync(join(dir, f), 'utf8'))));
    expect(offenders, 'these cannot run inside a transaction block, so the replay '
      + 'needs a per-file exception for them').toEqual([]);
  });
});

describe('it cannot be pointed at a real database', () => {
  // Its first act is dropping the public schema.
  it('refuses a hosted host', () => {
    expect(isHostedUrl('postgresql://postgres:x@db.abcdef.supabase.co:5432/postgres')).toBe(true);
    expect(isHostedUrl('postgresql://u:p@mydb.abc.eu-west-1.rds.amazonaws.com/db')).toBe(true);
  });

  it('control: allows the throwaway CI database, or the guard is just "no"', () => {
    expect(isHostedUrl('postgresql://postgres:postgres@localhost:5432/postgres')).toBe(false);
    expect(isHostedUrl('postgresql://postgres@127.0.0.1:5432/postgres')).toBe(false);
  });
});

describe('a migration that REFUSES is not a migration that BROKE', () => {
  // 0166 backfills timelines then checks its work: `if events < 300 then raise`.
  // An empty database has 0, so it refuses — correctly, and that says nothing
  // about the schema. The discriminator is the SQLSTATE, never a list of file
  // names: a name list rots on the first rename and quietly covers real
  // failures (`.claude/rules/mistakes.md` class 7 — an exemption that outlives
  // its reason).
  it('P0001 is a human raising an exception on purpose', () => {
    expect(classify('psql:0166.sql:157: ERROR:  P0001: 0166: only 0 timeline events left').refused)
      .toBe(true);
  });

  it('control: a broken statement is NOT waved through', () => {
    // If these ever came back `refused: true`, the replay would be green while
    // the schema was broken — the exact failure this file exists to prevent.
    expect(classify('ERROR:  42703: column "x" does not exist').refused).toBe(false);
    expect(classify('ERROR:  42P01: relation "_flatten" does not exist').refused).toBe(false);
    expect(classify('ERROR:  42601: syntax error at or near ";"').refused).toBe(false);
    expect(classify('some error with no sqlstate at all').refused).toBe(false);
  });

  it('the SQLSTATE is actually asked for — verbose, or every error looks alike', () => {
    expect(SRC, 'without VERBOSITY=verbose psql prints no SQLSTATE, so classify() '
      + 'sees nothing and every refusal is treated as a break').toContain('VERBOSITY=verbose');
  });
});
