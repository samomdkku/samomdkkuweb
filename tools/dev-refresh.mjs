#!/usr/bin/env node
// ============================================================
// dev-refresh.mjs — rebuild samo-dev from production.
//
//   CONFIRM=1 npm run dev:refresh
//
// Every step below was done by hand on 2026-08-27 and the traps are real, not
// anticipated. Read skills/build-the-dev-database.md for why each one exists.
//
// ⛔ THIS IS DESTRUCTIVE TO samo-dev AND MUST NEVER TOUCH PRODUCTION.
// Three independent guards, because one is a typo away from a catastrophe:
//   1. the target ref must equal SUPABASE_DEV_URL's ref;
//   2. the target ref must NOT equal VITE_SUPABASE_URL's ref;
//   3. CONFIRM=1 must be set.
// Production is only ever opened with a READ (pg_dump).
// ============================================================

import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvLocal, projectRefFromUrl, listMigrationFiles, checksumOf, sqlLit } from './migrations-lib.mjs';

const PG = process.env.PG_BIN || '/opt/homebrew/opt/libpq/bin';
const env = { ...loadEnvLocal(), ...process.env };

const prodRef = projectRefFromUrl(env.VITE_SUPABASE_URL);
const devRef = projectRefFromUrl(env.SUPABASE_DEV_URL);
const PROD = env.SUPABASE_DB_URL;
const DEV = env.SUPABASE_DEV_DB_URL;

function die(msg) { console.error(`✗ ${msg}`); process.exit(1); }

if (!PROD || !DEV) die('SUPABASE_DB_URL and SUPABASE_DEV_DB_URL must both be in .env.local');
if (!devRef) die('SUPABASE_DEV_URL is missing or malformed');
if (projectRefFromUrl(DEV.replace('postgresql://postgres:', 'https://').replace(/^.*@db\./, 'https://')) !== devRef
    && !DEV.includes(devRef)) die('SUPABASE_DEV_DB_URL does not point at SUPABASE_DEV_URL\'s project');
if (DEV.includes(prodRef)) die('REFUSING: the dev connection string contains the PRODUCTION project ref');
if (!PROD.includes(prodRef)) die('SUPABASE_DB_URL does not point at VITE_SUPABASE_URL\'s project');
if (process.env.CONFIRM !== '1') {
  console.error(
    `This DESTROYS and rebuilds samo-dev (${devRef}) from production (${prodRef}).\n` +
    'Re-run with CONFIRM=1 to proceed.',
  );
  process.exit(1);
}

const work = mkdtempSync(join(tmpdir(), 'samo-dev-refresh-'));
const psql = (uri, args) => execFileSync(`${PG}/psql`, [uri, '-v', 'ON_ERROR_STOP=0', ...args], { encoding: 'utf8', maxBuffer: 1 << 28 });
const q = (uri, sql) => execFileSync(`${PG}/psql`, [uri, '-tAc', sql], { encoding: 'utf8', maxBuffer: 1 << 28 }).trim();

console.log(`→ source ${prodRef} (READ ONLY)`);
console.log(`→ target ${devRef}  (WILL BE REBUILT)`);
console.log(`→ work   ${work}`);

// ---- 1. dump ------------------------------------------------------------
// schema_migrations describes the DATABASE IT IS IN, not the application. Copying
// it between databases makes dev claim production's apply history — and it is
// what collided on the first hand-run (duplicate key on version 0169).
console.log('\n[1/8] dumping production');
execFileSync(`${PG}/pg_dump`, [PROD, '--schema-only', '--no-owner',
  '--schema=public', '--schema=passport', '-f', join(work, 'schema.sql')], { stdio: 'inherit' });
execFileSync(`${PG}/pg_dump`, [PROD, '--data-only', '--no-owner',
  '--table=auth.users', '--table=auth.identities', '-f', join(work, 'auth.sql')], { stdio: 'inherit' });
execFileSync(`${PG}/pg_dump`, [PROD, '--data-only', '--no-owner',
  '--schema=public', '--schema=passport',
  '--exclude-table-data=public.schema_migrations',
  '-f', join(work, 'app.sql')], { stdio: 'pipe' });

const grantCount = (readFileSync(join(work, 'schema.sql'), 'utf8').match(/^GRANT /gm) || []).length;
// A dump with --no-privileges has ZERO grants, and RLS with no GRANT denies
// everyone while reading exactly like the policies working (0138).
if (grantCount < 100) die(`the schema dump has only ${grantCount} GRANTs — it was taken without privileges`);
console.log(`      schema.sql: ${grantCount} GRANTs ✓`);

// ---- 2. wipe + reload schema -------------------------------------------
console.log('[2/8] rebuilding the dev schema');
q(DEV, "drop schema if exists passport cascade; drop schema if exists public cascade; create schema public; grant usage on schema public to anon, authenticated, service_role;");
q(DEV, "create extension if not exists pg_trgm with schema extensions;");
psql(DEV, ['-q', '-f', join(work, 'schema.sql')]);

// ---- 3. the grant drift ------------------------------------------------
// Supabase's ALTER DEFAULT PRIVILEGES grant on every newly created table;
// pg_dump emits no REVOKEs because it assumes stock PostgreSQL defaults. So a
// restore is MORE PERMISSIVE than its source. Fix from the MEASURED difference.
console.log('[3/8] removing grants the restore invented');
const GR = "select table_schema||'|'||table_name||'|'||grantee||'|'||privilege_type from information_schema.role_table_grants where table_schema in ('public','passport') and grantee in ('anon','authenticated','service_role') order by 1;";
const setOf = (uri) => new Set(q(uri, GR).split('\n').filter(Boolean));
const pg = setOf(PROD), dg = setOf(DEV);
const extra = [...dg].filter((x) => !pg.has(x));
if (extra.length) {
  writeFileSync(join(work, 'revoke.sql'),
    extra.map((r) => { const [s, t, g, p] = r.split('|'); return `revoke ${p} on "${s}"."${t}" from "${g}";`; }).join('\n'));
  psql(DEV, ['-q', '-f', join(work, 'revoke.sql')]);
}
console.log(`      revoked ${extra.length}`);

// ---- 4. data, auth first ------------------------------------------------
// Seven public tables carry a foreign key to auth.users. `replica` defers
// triggers AND foreign keys, which four circular-FK tables need anyway.
// ⛔ auth is NOT dropped by step 2 (that only rebuilds public + passport), so
// without this the COPY aborts on the first duplicate id and dev SILENTLY KEEPS
// ITS OLD ACCOUNTS. The first version of this script did exactly that and still
// printed "identical to production" — because step 6 was only comparing
// public/passport. A refresh that cannot refresh auth is not a refresh.
console.log('[4/8] loading data (auth first)');
q(DEV, "truncate auth.users cascade;");
for (const f of ['auth.sql', 'app.sql']) {
  writeFileSync(join(work, `load-${f}`), `set session_replication_role = 'replica';\n` + readFileSync(join(work, f), 'utf8'));
  psql(DEV, ['-q', '-f', join(work, `load-${f}`)]);
}

// ---- 5. dev's own migration record -------------------------------------
console.log('[5/8] recording migrations as backfilled on dev');
const files = listMigrationFiles();
const values = files.map((f) => `(${sqlLit(f.version)}, ${sqlLit(f.name)}, 'backfilled', null, null, ${sqlLit(checksumOf(f.path))})`).join(',');
q(DEV, `insert into public.schema_migrations (version,name,source,applied_at,applied_by,checksum) values ${values} on conflict (version) do nothing;`);

// ---- 6. verify ----------------------------------------------------------
console.log('[6/8] verifying against production');
const gen = q(PROD, "select string_agg(format('select %L::text as t, count(*) from %I.%I', n.nspname||'.'||c.relname, n.nspname, c.relname), ' union all ' order by 1) from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind='r' and n.nspname in ('public','passport');");
// Compare auth too. Leaving it out is what let a stale auth copy pass as good.
const AUTH = "select 'auth.users', count(*) from auth.users union all select 'auth.identities', count(*) from auth.identities";
const rows = (uri) => new Map(
  (q(uri, `${gen} order by 1`) + '\n' + q(uri, AUTH))
    .split('\n').filter(Boolean).map((l) => l.split('|')),
);
const rp = rows(PROD), rd = rows(DEV);
const diffs = [...rp].filter(([t, n]) => t !== 'public.schema_migrations' && rd.get(t) !== n);
const pg2 = setOf(PROD), dg2 = setOf(DEV);
const stillExtra = [...dg2].filter((x) => !pg2.has(x)).length;
const missing = [...pg2].filter((x) => !dg2.has(x)).length;

// LIVE SYNC is a property of Supabase's `supabase_realtime` PUBLICATION, which
// the dump does not carry: the publication is Supabase's own object, so a
// restore leaves it with whatever the fresh project had. Found 2026-11-01:
// samo-dev lacked 0048's team_nodes + team_members, so ทีมและสิทธิ์'s live
// multi-editor sync was dead on every preview — while rotation_events (0250)
// and team_standing_groups (0273), applied to dev AFTER its rebuild, were
// present. Copy the membership, then compare it like the row counts.
// (`order by 1` inside string_agg sorts by the CONSTANT 1 — it listed the same
// four tables in different orders on the two projects and failed a good copy.)
const PUBS = "select coalesce(string_agg(format('%I.%I', schemaname, tablename), ',' order by schemaname, tablename), '') from pg_publication_tables where pubname = 'supabase_realtime'";
const pubProd = q(PROD, PUBS);
for (const t of pubProd.split(',').filter(Boolean)) {
  psql(DEV, ['-c', `do $$ begin
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime'
                     and format('%I.%I', schemaname, tablename) = '${t.replace(/'/g, "''")}') then
      alter publication supabase_realtime add table ${t};
    end if; end $$;`]);
}
const pubDev = q(DEV, PUBS);

console.log(`      tables compared : ${rp.size}`);
console.log(`      row-count diffs : ${diffs.length}`);
console.log(`      grants extra    : ${stillExtra}`);
console.log(`      grants missing  : ${missing}`);
console.log(`      live-sync tables: ${pubProd.split(',').filter(Boolean).length}${pubDev === pubProd ? '' : ` — MISMATCH (prod ${pubProd} · dev ${pubDev})`}`);
for (const [t, n] of diffs.slice(0, 10)) console.log(`        ${t}: prod=${n} dev=${rd.get(t) ?? 'ABSENT'}`);

if (diffs.length || stillExtra || missing || pubDev !== pubProd) die('dev does not match production — do NOT use this copy');

// ---- 7. repoint anything that reaches a REAL PERSON ---------------------
//
// This runs AFTER the parity check on purpose. Steps 1-6 exist to prove dev is
// a faithful copy; this step deliberately makes it unfaithful, in the one
// direction where fidelity is a hazard. Doing it before would fail the compare.
//
// WHY IT EXISTS. dev is loaded with REAL production data (TEAM-WORKFLOW D1, no
// masking), so `project_settings.uni_staff_email` arrives holding a real
// @kku.ac.th address — and dev and previews send through the SAME Apps Script
// deployment as production. Testing a หนังสือโครงการ flow on dev would email a
// real member of staff a document request that does not exist.
//
// It was fixed by hand once, on 2026-08-28. A hand fix is undone by the next
// `dev:refresh`, silently and with no failure — which is the shape this repo
// keeps paying for. So it lives in the rebuild instead.
//
// mdstuddata.beta@gmail.com is already a whole-address entry in the Apps
// Script allow-list, so nothing on the GAS side needs changing.
console.log('[7/8] repointing outward-facing destinations away from real people');
const DEV_INBOX = process.env.DEV_TEST_INBOX || 'mdstuddata.beta@gmail.com';
q(DEV, `update public.project_settings set uni_staff_email = ${sqlLit(DEV_INBOX)};`);
const landed = q(DEV, 'select uni_staff_email from public.project_settings;').trim();
// Verify rather than assume: an UPDATE that matched no rows returns success.
if (!landed.includes(DEV_INBOX)) {
  die(`could not repoint uni_staff_email on dev (it reads ${landed || 'nothing'}). `
    + 'Do NOT use this copy for notification testing — it would mail a real person.');
}
console.log(`      หนังสือโครงการ email → ${DEV_INBOX}`);

// ---- 8. dev-only guest grants -------------------------------------------
// Same reasoning as step 7: a rebuild wipes anything applied by hand, so the
// list of who can see what on dev lives in a reviewable file and is re-applied
// here. It refuses any project that is not samo-dev, by ref, on its own.
console.log('[8/8] applying tools/dev-grants.json');
try {
  execFileSync(process.execPath,
    [fileURLToPath(new URL('./dev-grants.mjs', import.meta.url))], { stdio: 'inherit' });
} catch {
  // Not fatal: the database is rebuilt and usable. A missing guest grant is a
  // person who cannot see one feature, which is visible immediately; failing
  // the whole refresh over it would be the worse trade.
  console.error('      ⚠️  dev-grants failed — the rebuild is still good, but nobody got guest access.');
}

console.log('\n✓ samo-dev rebuilt and identical to production.');
console.log('  Now run:  npm run dev:check   (the anon-key parity probe)');
console.log('  And prove auth: sign in as a copied account. Nothing else settles it.');
