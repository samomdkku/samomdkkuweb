#!/usr/bin/env node
// ============================================================
// db-query.mjs — run a READ-ONLY SQL file and print the full JSON result.
//
// WHY THIS EXISTS SEPARATELY FROM apply-migration.mjs:
// apply-migration.mjs echoes the response with `.slice(0, 2000)`, which
// silently truncates any result bigger than that — and it does so WITHOUT
// saying it truncated. Introspection queries (pg_get_functiondef over every
// function, a policy dump, a column list) blow past 2000 chars constantly, so
// using it to investigate produces confidently wrong answers. This prints
// everything.
//
// Same credential path as apply-migration.mjs: SUPABASE_ACCESS_TOKEN (a
// Management-API PAT) from .env.local, project ref derived from
// VITE_SUPABASE_URL. It runs as the Postgres SUPERUSER — auth.uid() is null
// and RLS is bypassed, so to observe what a real user sees you must
// `set_config('role', …)` + `set_config('request.jwt.claims', …)` inside a
// transaction, the way tools/*-proof scripts do.
//
// USE FOR READS. It will happily run DDL/DML — that is what
// apply-migration.mjs is for, and migrations belong in supabase/migrations/
// so they are reviewable and re-runnable. If you must mutate to investigate,
// wrap it in `begin; … rollback;` (every proof script in this directory is
// built that way) so production is never left changed.
//
//   node tools/db-query.mjs path/to/query.sql          (the default project)
//   node tools/db-query.mjs path/to/query.sql --dev    (samo-dev)
//   node tools/db-query.mjs path/to/query.sql | python3 -m json.tool
// ============================================================
import { readFileSync } from 'node:fs';

// `--dev` targets samo-dev, the same switch run-proofs.mjs and
// apply-migration.mjs take. ⛔ An UNKNOWN flag is refused, never ignored: this
// file once took only a path, so `db-query.mjs x.sql --dev` ran x.sql on
// PRODUCTION while the person typing it believed it was samo-dev — and it
// cleared a real value there (2026-10-14, docs/mistakes/tooling-proofs.md).
const args = process.argv.slice(2);
const wantDev = args.includes('--dev');
const unknown = args.filter((a) => a.startsWith('-') && a !== '--dev');
const file = args.find((a) => !a.startsWith('-'));
if (!file || unknown.length) {
  console.error(`usage: node tools/db-query.mjs <path-to-.sql> [--dev]${unknown.length ? `  (unknown: ${unknown.join(' ')})` : ''}`);
  process.exit(1);
}

// Credentials, target and the "which project answered" line all come from
// tools/env-lib.mjs now. Two behaviours this file established are preserved
// there and must not be lost:
//
//   process.env WINS over .env.local — the override in the header only works
//   because of that, and it silently did not on 2026-08-28.
//
//   .env.local is OPTIONAL — CI has none, and a hard read turned "no local
//   secrets" into an unhandled ENOENT that read like a broken tool. Measured
//   2026-08-29: without this, 21 of 23 proofs failed in a CI-shaped run with
//   valid credentials in the environment.
import { loadEnv, announceTarget } from './env-lib.mjs';

const loaded = loadEnv();
if (wantDev) {
  const url = loaded.env.SUPABASE_DEV_URL;
  const tok = loaded.env.SUPABASE_DEV_ACCESS_TOKEN;
  if (!url || !tok) {
    console.error('--dev needs SUPABASE_DEV_URL + SUPABASE_DEV_ACCESS_TOKEN (in .env.local or the environment)');
    process.exit(2);
  }
  loaded.env = { ...loaded.env, VITE_SUPABASE_URL: url, SUPABASE_ACCESS_TOKEN: tok };
}
const env = loaded.env;
const { ref: REF, isDev } = announceTarget(loaded);
if (wantDev && !isDev) {
  console.error('--dev was asked for but the target is not samo-dev — refusing');
  process.exit(2);
}

const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ query: readFileSync(file, 'utf8') }),
});

const body = await r.text();
if (!r.ok) { console.error(`HTTP ${r.status}:`, body); process.exit(1); }
process.stdout.write(body);
