#!/usr/bin/env node
// ============================================================
// migrate-status.mjs — what does this database have, and what is pending?
//
//   node tools/migrate-status.mjs             # report (PRODUCTION)
//   node tools/migrate-status.mjs --dev       # report against samo-dev
//   node tools/migrate-status.mjs --backfill  # record every existing file as
//                                             # source='backfilled' (once)
//
// Designed in docs/TEAM-WORKFLOW.md §4. Reads public.schema_migrations (0169).
//
// WHAT A "BACKFILLED" ROW MEANS: this file predates tracking, and this database
// is BELIEVED to carry it. It has no apply time because nobody observed one.
// Only rows written by apply-migration.mjs say `applied`, and only those carry
// a real timestamp. The two are never merged into one word.
// ============================================================

import {
  listMigrationFiles, checksumOf, sqlLit, runSql, credentials, pendingMigrations,
} from './migrations-lib.mjs';

const backfill = process.argv.includes('--backfill');
const { ref, token, label } = credentials();

async function main() {
  const files = listMigrationFiles();

  let rows;
  try {
    rows = await runSql(
      'select version, name, source, applied_at, applied_by, checksum from public.schema_migrations order by version;',
      { ref, token },
    );
  } catch (e) {
    if (/schema_migrations/.test(e.message) && /does not exist|not exist/i.test(e.message)) {
      console.error(
        '✗ public.schema_migrations does not exist on this project.\n' +
        '  Apply it first:\n' +
        '    node tools/apply-migration.mjs supabase/migrations/0169_migrations_are_tracked_where_they_are_applied.sql\n' +
        '  then:\n' +
        '    node tools/migrate-status.mjs --backfill',
      );
      process.exit(1);
    }
    throw e;
  }

  const byVersion = new Map(rows.map((r) => [r.version, r]));

  if (backfill) {
    const missing = files.filter((f) => !byVersion.has(f.version));
    if (!missing.length) {
      console.log('nothing to backfill — every file is already recorded.');
      return;
    }
    const values = missing
      .map((f) => `(${sqlLit(f.version)}, ${sqlLit(f.name)}, 'backfilled', null, null, ${sqlLit(checksumOf(f.path))})`)
      .join(',\n    ');
    await runSql(
      `insert into public.schema_migrations (version, name, source, applied_at, applied_by, checksum)
       values\n    ${values}\n   on conflict (version) do nothing;`,
      { ref, token },
    );
    console.log(`✓ backfilled ${missing.length} file(s) as source='backfilled' (no apply time — none was observed).`);
    console.log('  Re-run without --backfill to see the report.');
    return;
  }

  // `pending` and `changed` come from the shared helper, so the warning
  // deploy-owed prints and the report here can never disagree.
  const { pending, changed } = await pendingMigrations({ ref, token });
  const applied = files.filter((f) => byVersion.get(f.version)?.source === 'applied');
  const backfilled = files.filter((f) => byVersion.get(f.version)?.source === 'backfilled');
  const orphans = rows.filter((r) => !files.some((f) => f.version === r.version));

  console.log(`project ${ref}  [${label}]`);
  console.log(`  files:      ${files.length}`);
  console.log(`  applied:    ${applied.length}   (observed by apply-migration.mjs)`);
  console.log(`  backfilled: ${backfilled.length}   (predates tracking, no apply time)`);
  console.log(`  PENDING:    ${pending.length}`);

  if (pending.length) {
    console.log('\npending — not recorded on this database:');
    for (const f of pending) console.log(`  ${f.name}`);
    console.log('\napply with:  node tools/apply-migration.mjs supabase/migrations/<file>');
  }
  if (changed.length) {
    console.log('\n⚠️  EDITED AFTER RECORDING — the file no longer matches what was applied:');
    for (const f of changed) console.log(`  ${f.name}`);
    console.log('  A migration is a record of what ran. Write a NEW one instead of editing this.');
  }
  if (orphans.length) {
    console.log('\n⚠️  RECORDED BUT NO FILE — renamed or deleted in the repo:');
    for (const r of orphans) console.log(`  ${r.version} ${r.name}`);
  }
  if (!pending.length && !changed.length && !orphans.length) console.log('\n✓ in step.');
}

main().catch((e) => { console.error('✗', e.message); process.exit(1); });
