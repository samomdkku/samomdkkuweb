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
// were applied one at a time to a database that already had the previous 179,
// and `dev:refresh` builds samo-dev by COPYING production rather than by
// replaying anything. So "the schema can be rebuilt from the repo" was a
// belief, not a fact — and it is the belief every recovery plan rests on.
//
// It also gives a contributor a way to be told their migration is broken
// without holding any credential at all: the database here is empty, local to
// the job, and gone when it ends. That is the whole reason it can run on a
// public repository's pull requests.
//
// ⛔ REFUSES TO RUN AGAINST ANYTHING THAT LOOKS REAL. The first thing it does
// is drop the public schema. Pointed at a Supabase host by accident, that is a
// catastrophe, so a URL naming one is rejected before a single statement runs.
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

if (!URL_) die('DATABASE_URL is not set.', 'This wants a throwaway Postgres, not a real one.');

// A deny that costs nothing and one day saves everything.
if (/supabase\.(co|com)|amazonaws|\.rds\./i.test(URL_)) {
  die('REFUSING: DATABASE_URL points at what looks like a hosted database.',
    'This script DROPS THE PUBLIC SCHEMA. It is for an empty throwaway only.');
}

function psql(args, { input } = {}) {
  return execFileSync(PSQL, [URL_, '-v', 'ON_ERROR_STOP=1', '-q', ...args], {
    encoding: 'utf8', input, stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 1 << 28,
  });
}

const files = listMigrationFiles();
if (!files.length) die('no migrations found — nothing to replay.');

console.log(`\n  Replaying ${files.length} migrations onto an empty database.\n`);

// Start from nothing, so the run cannot be flattered by leftovers.
try {
  psql(['-c', 'drop schema if exists public cascade; create schema public;']);
  psql(['-f', join(ROOT, 'tools/ci/supabase-platform.sql')]);
} catch (err) {
  die('the platform bootstrap failed — this is tools/ci/supabase-platform.sql,',
    'not one of your migrations.',
    String(err.stderr || err.message).trim().split('\n').slice(-5).join('\n  '));
}

const failures = [];
for (const m of files) {
  try {
    psql(['-f', m.path]);
    process.stdout.write(`  ✓ ${m.name}\n`);
  } catch (err) {
    const msg = String(err.stderr || err.message).trim().split('\n').filter(Boolean);
    process.stdout.write(`  ✗ ${m.name}\n`);
    failures.push({ name: m.name, msg });
    // Stop at the first one: everything after it fails for its reasons, and a
    // wall of consequent errors hides the one that started it.
    break;
  }
}

if (failures.length) {
  const f = failures[0];
  console.error(`\n✗ ${f.name} could not be applied to an empty database.\n`);
  for (const line of f.msg.slice(-8)) console.error(`  ${line}`);
  console.error('\n  Everything before it applied cleanly. Nothing after it was tried —');
  console.error('  those would fail for this one\'s reasons, not their own.\n');
  console.error('  If this migration is old and has ALREADY been applied to the real');
  console.error('  databases, do NOT edit it in place: the fix belongs in a new one,');
  console.error('  or in tools/ci/supabase-platform.sql if the gap is a Supabase');
  console.error('  feature this replay does not provide.\n');
  process.exit(1);
}

const tables = psql(['-tAc',
  "select count(*) from information_schema.tables where table_schema in ('public','passport')"]).trim();
console.log(`\n✓ all ${files.length} migrations applied to an empty database — ${tables} tables.\n`);
console.log('  This proves the schema can be rebuilt from this repo alone.');
console.log('  It does NOT prove behaviour: auth.uid() is null here, so policies');
console.log('  are not exercised. That is `npm run proofs -- --dev`.\n');
