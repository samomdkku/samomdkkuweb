#!/usr/bin/env node
// ============================================================
// apply-migration.mjs — run a SQL migration file against the
// Supabase Postgres DB via the Supabase Management API.
//
// WHY the Management API (not the service_role key): the
// service_role JWT only authenticates to PostgREST / Auth /
// Storage — it CANNOT run DDL (create table / alter / policy).
// The Management API `database/query` endpoint (the same one the
// dashboard SQL editor uses) runs arbitrary SQL, authenticated by
// a personal access token (PAT).
//
// SETUP (one-time): add a PAT to .env.local (gitignored):
//   1. https://supabase.com/dashboard/account/tokens → Generate new token
//   2. add the line:  SUPABASE_ACCESS_TOKEN=sbp_xxxxxxxx
//   (project ref is derived from VITE_SUPABASE_URL already in .env.local)
//
// RUN:
//   node tools/apply-migration.mjs supabase/migrations/0057_shop_catalog_config.sql
//
// Alternative (no PAT): if you'd rather use the DB connection
// string, set SUPABASE_DB_URL=postgresql://... in .env.local and
// this script will use `psql` if available. The PAT path needs no
// extra tooling, so it's preferred.
// ============================================================

import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { recordApplied, credentials } from './migrations-lib.mjs';

/**
 * Record the apply in public.schema_migrations (0169).
 *
 * NEVER fails the run. The migration has already executed by the time this is
 * called; reporting failure here would tell a human to re-run DDL that already
 * landed, which is worse than a missing row. It says so loudly instead.
 */
async function note(file, ref, token) {
  const who = process.env.USER || process.env.LOGNAME || 'unknown';
  const r = await recordApplied(file, { ref, token, by: who });
  if (r.ok) return;
  console.warn(`! applied, but NOT recorded in schema_migrations: ${r.why}`);
  console.warn('  If the table does not exist yet, apply 0169 and then run:');
  console.warn('    node tools/migrate-status.mjs --backfill');
}

async function main() {
  const file = process.argv.slice(2).find((a) => !a.startsWith('--'));
  if (!file) {
    console.error('usage: node tools/apply-migration.mjs <path-to-.sql> [--dev]');
    process.exit(1);
  }
  if (!existsSync(file)) {
    console.error(`file not found: ${file}`);
    process.exit(1);
  }
  const sql = readFileSync(file, 'utf8');

  // --dev targets samo-dev. Added 2026-09-01, because until then this script
  // could ONLY reach production: `migrations-lib.credentials()` had understood
  // --dev since the dev database was built, and this — the one tool that runs
  // DDL — did not use it. So "try it on dev first", the whole point of having a
  // dev database, was not something the standard tooling could do, and every
  // migration's first execution anywhere was against real student data.
  const { ref, token, env, dev, label } = credentials();
  const dbUrl = dev ? env.SUPABASE_DEV_DB_URL : env.SUPABASE_DB_URL;

  console.log(`→ project: ${ref}  [${label}]`);
  console.log(`→ file:    ${file} (${sql.length} bytes)`);

  if (token) {
    console.log('→ mechanism: Supabase Management API');
    const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: sql }),
    });
    const bodyText = await res.text();
    if (!res.ok) {
      console.error(`✗ HTTP ${res.status}: ${bodyText}`);
      process.exit(1);
    }
    console.log('✓ migration applied.');
    if (bodyText && bodyText.trim() && bodyText.trim() !== '[]') {
      console.log('  response:', bodyText.slice(0, 2000));
    }
    await note(file, ref, token);
    return;
  }

  if (dbUrl) {
    console.log('→ mechanism: psql (SUPABASE_DB_URL)');
    try {
      execFileSync('psql', [dbUrl, '-v', 'ON_ERROR_STOP=1', '-f', file], { stdio: 'inherit' });
      console.log('✓ migration applied.');
      if (token) await note(file, ref, token);
      else console.log('  (not recorded in schema_migrations — that path needs SUPABASE_ACCESS_TOKEN)');
    } catch (e) {
      console.error('✗ psql failed:', e.message);
      process.exit(1);
    }
    return;
  }

  console.error(
    'No credential found. Add ONE of these to .env.local:\n' +
    '  SUPABASE_ACCESS_TOKEN=sbp_...   (preferred — https://supabase.com/dashboard/account/tokens)\n' +
    '  SUPABASE_DB_URL=postgresql://... (requires psql installed)',
  );
  process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
