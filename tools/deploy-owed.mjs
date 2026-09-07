#!/usr/bin/env node
// ============================================================
// deploy-owed.mjs — is a deploy owed, or is prod current?
//
//   npm run deploy:owed
//
// WHY THIS EXISTS. `main` being ahead of the deployed sha is the NORMAL state
// here: most commits are docs, write-ups and tests, none of which reaches a
// bundle. The only question that matters is whether `src/` or either entry
// HTML moved since the last deploy. STATE.md carried that as a copy-pasteable
// `git diff --stat <sha>..HEAD` snippet — and the sha was RETYPED into it.
//
// On 2026-08-28 the deployed sha had FOUR homes in STATE.md and exactly one of
// them had been corrected: the ✅ DEPLOYED line said `2151d6a` while the two
// "check, do not trust this line" commands and the closing paragraph still said
// `7405712`, two deploys behind. Following the file's OWN instrument reported
// 132 insertions of already-shipped code — which reads exactly like "a deploy is
// owed" and costs a VPN session to disprove. That is the failure this repo has
// paid for twice (commit bcdd4cd was the first).
//
// THE FIX IS NOT A CAREFULLER EDIT. It is removing the retyping: the sha has
// ONE home, the ✅ DEPLOYED line, and this script READS it from there. A
// verification command that cannot name the wrong sha cannot rot.
// ============================================================

import { readFileSync } from 'node:fs';
import { credentials, pendingMigrations } from './migrations-lib.mjs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// What a deploy actually ships. Tests live under src/ but never reach a bundle,
// so counting them would report a deploy owed for every guard we write.
//
// ⚠️ `docs/` IS ON THIS LIST SINCE 2026-08-31, and the reason is worth keeping:
// the VM started serving the documentation at samo.md.kku.ac.th/docs that day
// (server/deploy.sh builds it with DOCS_BASE=/docs/). Until this line changed,
// this tool watched only `src/` — so it answered "NO DEPLOY OWED, production is
// serving current code" while /docs on the VM was an entire restructure behind
// what `main` said. The instrument that tells you whether production is current
// had gone blind to half of what production serves, and it failed GREEN, which
// is the worst direction (.claude/rules/mistakes.md class 7).
//
// The rule this encodes: WHEN THE DEPLOY LEARNS TO PUBLISH SOMETHING NEW, ADD
// IT HERE IN THE SAME COMMIT. Anything server/deploy.sh copies into /var/www
// belongs on this list — nginx config included, because a config change also
// needs a trip to the VM (and one that `deploy.sh` does NOT even perform: see
// its install line at the top of server/nginx-samo.conf).
//
// ⚠️ 2026-09-01 — THE SAME BLINDNESS, ONE DIRECTORY DEEPER. This list carried
// `:!docs/state/**` and `:!docs/state-archive/**`, on the reasonable-sounding
// theory that a person's session notes are not "shipping". VitePress does not
// agree: its `srcExclude` covers node_modules, templates, package and demos and
// says nothing about `docs/state`, so `collect()` globs those files, the
// sidebar links them, and `samo.md.kku.ac.th/docs/state/<handle>` serves them —
// verified by curl. So this tool answered "nothing owed" over a page production
// was serving stale, which is precisely the failure its own header above
// describes, failing GREEN again.
//
// The exclusions are gone. If those pages should NOT be public, the fix is
// VitePress `srcExclude` — and then they may come off this list. The two must
// agree, and `docs-shipping-parity.test.js` now fails the build when they do
// not, because a comment saying "keep these in step" is not a mechanism.
const SHIPPED = [
  'src/', ':!src/**/*.test.js', 'index.html', 'admin/index.html',
  'docs/',
  'server/nginx-samo.conf', 'server/deploy.sh',
];

const git = (...args) =>
  execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();

// Same, but git's own `fatal:` stays quiet — used where WE print the diagnosis
// and git's version would only arrive first and contradict the tone.
const gitQuiet = (...args) =>
  execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

function deployedSha() {
  const state = readFileSync(join(ROOT, 'STATE.md'), 'utf8');
  const found = [...state.matchAll(/DEPLOYED = `([0-9a-f]{7,40})`/g)].map((m) => m[1]);

  if (found.length === 0) {
    throw new Error(
      'STATE.md states no deployed sha.\n' +
      'The ✅ DEPLOYED line is this script\'s only input; restore it as:\n' +
      '  - ✅ **DEPLOYED = `<sha>` (YYYY-MM-DD)**, ...',
    );
  }
  if (new Set(found).size > 1) {
    throw new Error(
      `STATE.md names ${new Set(found).size} different deployed shas: ${[...new Set(found)].join(', ')}.\n` +
      'That is the exact bug this script exists to end — one fact, one home.',
    );
  }
  return found[0];
}


/**
 * ⛔ THE FAILURE THIS CATCHES, and it is not about files.
 *
 * Someone asks Claude for a feature; Claude writes the code AND a migration.
 * They do not notice the migration, it is reviewed, merged — and never applied.
 * Then a deploy ships code that reads a column production does not have.
 *
 * Nothing else in the chain can see it: the tests pass, the CI replay passes
 * (it proves the SQL is VALID, not that any real database ran it), and a git
 * diff cannot know what a database contains. Only the database can answer, so
 * this asks it — at the one moment somebody is about to ship.
 *
 * Best effort on purpose: no network, no credentials, or a database that
 * cannot be reached must not stop a deploy that may be urgent. It says it
 * could not check rather than implying everything is fine.
 */
async function reportPendingMigrations() {
  let creds;
  try {
    creds = credentials([]);   // no --dev: PRODUCTION, which is what deploys reach
  } catch {
    console.log('   (migrations not checked — no credentials on this machine)');
    console.log('');
    return;
  }
  try {
    const { pending, changed } = await pendingMigrations(creds);
    if (pending.length) {
      console.log(`⛔ ${pending.length} MIGRATION(S) ARE NOT APPLIED TO PRODUCTION:`);
      console.log('');
      for (const f of pending) console.log(`     ${f.name}`);
      console.log('');
      console.log('   Deploying now ships code against a database that does not have');
      console.log('   these. Apply them FIRST if they ADD something; if one REMOVES');
      console.log('   something, deploy first and drop after — skills/ship-a-migration.md.');
      console.log('');
      console.log('     node tools/apply-migration.mjs supabase/migrations/<file>');
      console.log('');
    } else if (changed.length) {
      console.log('⚠️  A migration file no longer matches what production recorded:');
      for (const f of changed) console.log(`     ${f.name}`);
      console.log('   Write a NEW migration rather than editing one that ran.');
      console.log('');
    }
  } catch (err) {
    console.log(`   (migrations not checked — ${String(err.message).split('\n')[0]})`);
    console.log('');
  }
}

let sha;
try {
  sha = deployedSha();
} catch (err) {
  console.error(`✖ ${err.message}`);
  process.exit(2);
}

try {
  gitQuiet('cat-file', '-e', `${sha}^{commit}`);
} catch {
  console.error(`✖ STATE.md says DEPLOYED = ${sha}, which is not a commit in this repo.`);
  console.error('  Either the sha is mistyped, or this clone has not fetched it.');
  process.exit(2);
}

// An ancestry check first: "ahead" is only meaningful if the deployed commit is
// actually behind us. If it is not, the diff below would still print something
// and mean something else entirely.
let ancestor = true;
try {
  git('merge-base', '--is-ancestor', sha, 'HEAD');
} catch {
  ancestor = false;
}

const head = git('rev-parse', '--short', 'HEAD');
const subject = git('log', '-1', '--format=%s', sha);

console.log(`deployed  ${sha}  ${subject}`);
console.log(`local     ${head}  ${git('log', '-1', '--format=%s', 'HEAD')}`);
console.log('');

if (!ancestor) {
  console.error(`✖ ${sha} is NOT an ancestor of HEAD.`);
  console.error('  Production is running something this branch does not contain —');
  console.error('  a force-push, a wrong branch, or a deploy from another clone.');
  console.error('  Do not deploy over it until you know which.');
  process.exit(2);
}

// `<sha>..HEAD` compares COMMITS, and the working tree is invisible to it.
// Writing this script's first version that way made it answer "NO DEPLOY OWED"
// with an edited src/main.css sitting unstaged — the instrument could not see
// the hazard. Omitting `..HEAD` diffs the deployed commit against the WORKING
// TREE, so committed and uncommitted shipping changes both count. An uncommitted
// one is the more urgent of the two: it is not even pushed.
const changed = git('diff', '--name-only', sha, '--', ...SHIPPED)
  .split('\n')
  .filter(Boolean);

// A file that was never `git add`ed is not in any diff at all, and a new
// component nobody has added is as undeployed as code gets.
const untracked = git('ls-files', '--others', '--exclude-standard', '--', ...SHIPPED)
  .split('\n')
  .filter(Boolean);

// BEFORE the verdict, not after: a pending migration matters most when no
// deploy is owed — merged, never applied, and "✅ NO DEPLOY OWED" is exactly
// where a reader stops.
await reportPendingMigrations();

if (changed.length === 0 && untracked.length === 0) {
  const behind = git('rev-list', '--count', `${sha}..HEAD`);
  console.log('✅ NO DEPLOY OWED — production is serving current code.');
  console.log(`   ${behind} commit(s) since the deploy, none of them shipping:`);
  console.log('   docs, write-ups and tests do not reach a bundle.');
  process.exit(0);
}

console.log(`⚠️  A DEPLOY IS OWED — ${changed.length + untracked.length} shipping file(s) changed:`);
console.log('');
if (changed.length) console.log(git('diff', '--stat', sha, '--', ...SHIPPED));
if (untracked.length) {
  console.log(' untracked (never committed):');
  for (const f of untracked) console.log(`   ${f}`);
  console.log('');
}
if (git('status', '--porcelain', '--', ...SHIPPED)) {
  console.log('   ⛔ Some of these are UNCOMMITTED. Commit and push before you');
  console.log('      deploy — the VM builds from the branch, not from this machine.');
  console.log('');
}
console.log('   Deploy: skills/deploy-vm.md (needs VPN; pushing main does NOT deploy).');
console.log('   Then verify from the SERVED artifact and update the ✅ DEPLOYED');
console.log('   line in STATE.md — it is the only home for that sha.');
process.exit(1);
