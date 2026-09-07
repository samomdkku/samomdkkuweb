#!/usr/bin/env node
// ============================================================
// replay-migrations.mjs — can this repo rebuild its own database?
//
//   DATABASE_URL=postgresql://... node tools/replay-migrations.mjs
//
// Applies every numbered migration, in order, onto an EMPTY database and stops
// at the first one that fails, naming it. CI runs it on a throwaway Postgres
// that is created and destroyed inside the job.
//
// ⛔ WHY THIS EXISTS. Until 2026-09-07 nobody had ever done this. Migrations
// were applied one at a time to a database that already held the previous 179,
// and `dev:refresh` builds samo-dev by COPYING production rather than replaying
// anything. So "the schema can be rebuilt from the repo" was a belief, not a
// fact — and it is the belief every recovery plan rests on.
//
// It also gives a contributor a way to be told their migration is broken
// without holding any credential: the database here is empty, local to the job,
// and gone when it ends. That is why it can run on a public repo's pull
// requests at all.
//
// ⛔ ONE TRANSACTION PER FILE, LIKE THE REAL APPLIER. Found by the first run,
// which stopped at 0153 reporting `relation "_flatten" does not exist` — a
// migration live in production for weeks. 0153 creates a `temp table _flatten
// on commit drop` and uses it three statements later. `apply-migration.mjs`
// POSTs the whole file as ONE query, so the file is one transaction and the
// temp table survives; psql in its default autocommit makes every STATEMENT a
// transaction, dropping the table the instant it was made. The migration was
// fine and the instrument was wrong — it was about to condemn 27 healthy
// migrations. `--single-transaction` makes the replay match the path it is
// meant to be testing. Safe because no migration uses `create index
// concurrently`, `vacuum` or anything else that cannot run inside a
// transaction block — `replay-migrations.test.js` keeps that true.
//
// ⛔ A DATA MIGRATION'S OWN ASSERTION IS NOT A SCHEMA FAILURE. 0166 backfills
// timelines and then checks its work: `if events < 300 then raise exception`.
// On an empty database there are 0, so it refuses — correctly. It is a data
// migration and this database has no data; that says nothing about the schema.
//
// The discriminator is NOT a list of file names, which would rot the first time
// one was renamed and would quietly cover a real failure. It is the SQLSTATE
// Postgres reports: **P0001 is `raise exception`** — a human deliberately
// refusing — while a missing column is 42703, a missing table 42P01, and so on.
// So: P0001 is reported as SKIPPED and the run continues; every other code is a
// failure and stops it. Skipped files are listed in full at the end, with what
// they said, because an exemption nobody reads is how a guard dies.
//
// ⛔ REFUSES TO RUN AGAINST ANYTHING THAT LOOKS REAL. Its first act is dropping
// the public schema. Pointed at a Supabase host by accident that is a
// catastrophe, so such a URL is rejected before a statement runs.
// ============================================================
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { listMigrationFiles } from './migrations-lib.mjs';

const ROOT = join(import.meta.dirname, '..');
const URL_ = process.env.DATABASE_URL;
const PSQL = process.env.PSQL_BIN || 'psql';

function die(msg, ...more) {
  console.error(`\n✗ ${msg}\n`);
  for (const l of more) console.error(`  ${l}`);
  console.error('');
  process.exit(1);
}

/**
 * Did the migration REFUSE (a deliberate `raise exception`, SQLSTATE P0001), or
 * did it BREAK? Exported so the distinction can be tested without a database.
 */
export function classify(stderr) {
  const m = /ERROR:\s+([0-9A-Z]{5}):/.exec(String(stderr));
  const code = m ? m[1] : null;
  return { code, refused: code === 'P0001' };
}

/** A deny that costs nothing and one day saves everything. Exported to be tested. */
export function isHostedUrl(url) {
  return /supabase\.(co|com)|amazonaws|\.rds\./i.test(String(url));
}

function psql(args) {
  // --single-transaction: see the header. This is the difference between
  // testing the migrations and testing psql's autocommit.
  // VERBOSITY=verbose puts the SQLSTATE in the message, which is what tells a
  // deliberate refusal apart from a broken statement. Without it both are
  // just the word ERROR.
  return execFileSync(PSQL, [URL_, '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose',
    '-q', '--single-transaction', ...args], {
    encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 1 << 28,
  });
}

function main() {
  if (!URL_) die('DATABASE_URL is not set.', 'This wants a throwaway Postgres, not a real one.');
  if (isHostedUrl(URL_)) {
    die('REFUSING: DATABASE_URL points at what looks like a hosted database.',
      'This script DROPS THE PUBLIC SCHEMA. It is for an empty throwaway only.');
  }

  const files = listMigrationFiles();
  if (!files.length) die('no migrations found — nothing to replay.');

  console.log(`\n  Replaying ${files.length} migrations onto an empty database.\n`);

  // Start from nothing, so the run cannot be flattered by leftovers.
  try {
    psql(['-c', 'drop schema if exists public cascade; create schema public;']);
    psql(['-f', join(ROOT, 'tools/ci/supabase-platform.sql')]);
  } catch (err) {
    die('the platform bootstrap failed — that is tools/ci/supabase-platform.sql,',
      'not one of your migrations.',
      String(err.stderr || err.message).trim().split('\n').slice(-5).join('\n  '));
  }

  let failure = null;
  const skipped = [];
  for (const m of files) {
    try {
      psql(['-f', m.path]);
      process.stdout.write(`  ✓ ${m.name}\n`);
    } catch (err) {
      const stderr = String(err.stderr || err.message).trim();
      const { code, refused } = classify(stderr);
      const msg = stderr.split('\n').filter(Boolean);
      if (refused) {
        // The file rolled back whole, so the schema is as if it had not run.
        // If a later migration needed something from it, that one fails for a
        // real reason and stops the run — which is the right outcome.
        process.stdout.write(`  ⊘ ${m.name}  (refused — needs data)\n`);
        skipped.push({ name: m.name, msg });
        continue;
      }
      process.stdout.write(`  ✗ ${m.name}  (${code || 'no SQLSTATE'})\n`);
      failure = { name: m.name, msg };
      // Stop at the first: everything after fails for ITS reasons, and a wall
      // of consequent errors hides the one that started it.
      break;
    }
  }

  if (failure) {
    console.error(`\n✗ ${failure.name} could not be applied to an empty database.\n`);
    for (const line of failure.msg.slice(-8)) console.error(`  ${line}`);
    console.error('\n  Everything before it applied cleanly. Nothing after it was tried.\n');
    console.error('  If this migration is old and has ALREADY been applied to the real');
    console.error('  databases, do NOT edit it in place: the fix belongs in a new one,');
    console.error('  or in tools/ci/supabase-platform.sql if the gap is a Supabase');
    console.error('  feature this replay does not provide.\n');
    process.exit(1);
  }

  if (skipped.length) {
    console.log(`\n  ⊘ ${skipped.length} migration(s) refused because this database has no data.`);
    console.log('    Each raised its own exception (P0001), which is a data check,');
    console.log('    not a schema problem. What they said:\n');
    for (const sk of skipped) {
      console.log(`    ${sk.name}`);
      const said = sk.msg.find((l) => /ERROR:/.test(l)) || sk.msg[0];
      console.log(`      ${said}`);
    }
  }

  const tables = psql(['-tAc',
    "select count(*) from information_schema.tables where table_schema in ('public','passport')"]).trim();
  console.log(`\n✓ all ${files.length} migrations applied to an empty database — ${tables} tables.\n`);
  console.log('  This proves the schema can be rebuilt from this repo alone.');
  console.log('  It does NOT prove behaviour: auth.uid() is null here, so policies');
  console.log('  are not exercised. That is `npm run proofs -- --dev`.\n');
}

// Importable for its guard test — the same shape as the other tools here.
if (import.meta.filename === process.argv[1]) main();
