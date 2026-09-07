// ==============================================
// "Pending" has ONE definition.
//
// ⛔ THE FAILURE THIS CHAIN EXISTS FOR. Someone asks Claude for a feature;
// Claude writes the code AND a migration. They do not notice the migration —
// it was one file among several and they were reading the feature. It is
// reviewed, merged, and never applied. Then a deploy ships code that reads a
// column production does not have.
//
// Three things now stand between that and students: the CI notice on the pull
// request, `migrate:status`, and the warning `deploy:owed` prints at the moment
// somebody is about to ship. All three must agree about what "pending" means —
// two copies of that rule would drift, and the copy that drifts is the one that
// says everything is fine (`.claude/rules/mistakes.md` class 6).
// ==============================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from './strip-comments.js';

const ROOT = join(import.meta.dirname, '..', '..');
const read = (p) => stripComments(readFileSync(join(ROOT, p), 'utf8'));

describe('one definition of pending, shared', () => {
  it('migrate-status and deploy-owed both ask the same function', () => {
    for (const f of ['tools/migrate-status.mjs', 'tools/deploy-owed.mjs']) {
      expect(read(f), `${f} computes "pending" itself instead of calling the `
        + 'shared pendingMigrations() — a second copy of the rule')
        .toMatch(/pendingMigrations/);
    }
  });

  it('the definition lives in migrations-lib, exported once', () => {
    const lib = read('tools/migrations-lib.mjs');
    expect(lib).toMatch(/export async function pendingMigrations/);
    expect((lib.match(/export async function pendingMigrations/g) || []).length).toBe(1);
  });
});

describe('deploy:owed asks about PRODUCTION, and survives not being able to', () => {
  const SRC = read('tools/deploy-owed.mjs');

  it('no --dev — a deploy reaches production, so that is what it must check', () => {
    expect(SRC, 'deploy-owed is asking a database, but not the one a deploy '
      + 'affects').toMatch(/credentials\(\[\]\)/);
  });

  it('a machine with no credentials or no network still gets its answer', () => {
    // ⛔ It must never block a deploy that may be urgent, and must never imply
    // "clean" when it simply could not look.
    expect(SRC).toMatch(/not checked/);
    expect(SRC, 'the check is not wrapped — a network error would crash '
      + 'deploy:owed instead of degrading').toMatch(/catch/);
  });

  it('it runs BEFORE the verdict, where a reader has not stopped yet', () => {
    const call = SRC.indexOf('reportPendingMigrations()');
    const verdict = SRC.indexOf('NO DEPLOY OWED');
    expect(call, 'reportPendingMigrations is never called').toBeGreaterThan(-1);
    expect(call, 'the warning prints after "✅ NO DEPLOY OWED", which is exactly '
      + 'where somebody stops reading').toBeLessThan(verdict);
  });
});

describe('the pull request says it too — before anyone can merge it', () => {
  const SRC = read('tools/ci/migration-notice.mjs');

  it('names the files, so "I did not know it was in there" cannot happen', () => {
    expect(SRC).toMatch(/diff-filter=A/);
    expect(SRC).toMatch(/apply-migration\.mjs/);
  });

  it('does not fail the build — a migration to apply is work, not an error', () => {
    expect(SRC, 'the notice exits non-zero, which turns normal work into a red '
      + 'check and teaches people to ignore it').not.toMatch(/process\.exit\(1\)/);
  });

  it('the workflow runs it even when the replay failed', () => {
    // A broken migration is exactly when you most need to be told it is not
    // applied anywhere.
    expect(readFileSync(join(ROOT, '.github/workflows/migrations.yml'), 'utf8'))
      .toMatch(/migration-notice\.mjs/);
  });
});
