#!/usr/bin/env node
// ============================================================
// migration-notice.mjs — say, in the check's own summary, what CI cannot do.
//
// ⛔ THE FAILURE. Someone asks Claude for a feature. Claude writes the code and
// a migration. They do not notice the migration — it was one file among several
// and they were reading the feature. It is reviewed, merged, and never applied.
// Then the code ships to students against a database without the column it
// needs.
//
// Every step of that is silent today. The tests pass, the replay passes, the
// review looks complete, and the green tick means "this migration is valid",
// which a reader hears as "this migration is done". Those are different claims.
//
// So this prints the names of the migrations the change ADDS, and the commands
// somebody with credentials must run afterwards, into `$GITHUB_STEP_SUMMARY`.
//
// ⚠️ BE HONEST ABOUT WHERE THAT LANDS: a job summary renders on the workflow
// RUN's summary page — one click from the pull request's Checks tab — NOT in
// the pull request conversation. So it is seen by someone who opens the check,
// which is better than a buried log line and weaker than a comment on the PR
// itself. A bot comment would be stronger and needs `pull-requests: write`;
// noted in `docs/state/HANDOFF.md` §8a rather than built at speed.
//
// It never fails the build: a migration that must be applied is normal work,
// not an error. It just refuses to let it be invisible.
// ============================================================
import { execFileSync } from 'node:child_process';

const BASE = process.env.BASE_REF;
const HEAD = process.env.HEAD_REF || 'HEAD';

function added() {
  // No base (a manual run, or the first push of a branch): fall back to the
  // last commit, which is better than saying nothing.
  const range = BASE && !/^0{40}$/.test(BASE) ? `${BASE}..${HEAD}` : `${HEAD}~1..${HEAD}`;
  try {
    return execFileSync('git', ['diff', '--name-only', '--diff-filter=A', range, '--', 'supabase/migrations'],
      { encoding: 'utf8' })
      .split('\n').map((l) => l.trim()).filter((l) => l.endsWith('.sql'));
  } catch {
    return [];
  }
}

const files = added();
const out = [];

if (!files.length) {
  out.push('### No new migrations in this change');
  out.push('');
  out.push('The replay ran because migration tooling changed, not because a migration did.');
} else {
  out.push(`### ⚠️ This adds ${files.length} migration${files.length > 1 ? 's' : ''} — merging does NOT apply ${files.length > 1 ? 'them' : 'it'}`);
  out.push('');
  out.push('A green check above means the SQL is valid and applies to an empty');
  out.push('database. It does **not** mean any real database has it.');
  out.push('');
  for (const f of files) out.push(`- \`${f}\``);
  out.push('');
  out.push('**Someone with credentials must run, after merging:**');
  out.push('');
  out.push('```bash');
  for (const f of files) out.push(`node tools/apply-migration.mjs ${f} --dev   # the practice database`);
  for (const f of files) out.push(`node tools/apply-migration.mjs ${f}         # PRODUCTION`);
  out.push('```');
  out.push('');
  out.push('Check with `npm run migrate:status` (and `-- --dev`). Order matters when');
  out.push('a migration REMOVES something — see `skills/ship-a-migration.md`.');
  out.push('');
  out.push('> If you did not know this change contained a migration, read it now.');
  out.push('> That is the failure this notice exists for.');
}

console.log(out.join('\n'));
