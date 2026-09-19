#!/usr/bin/env node
// ============================================================
// test-clean.mjs — run the suite over ONLY the files git tracks, which is what
// CI will run it over.
//
// WHY THIS EXISTS. `npm test` here and `npm test` on CI are not the same test,
// and the difference is invisible until a push goes red. This repo has paid for
// it in both directions:
//
//   2026-09-18  the dead-pointer sweeps read `externaldata/` — 1,776 real
//               students' data, gitignored. Present on the laptop, absent on
//               CI: green here, RED on CI for two pushes.
//   earlier     three assertions read the maintainer's gitignored `.env.local`:
//               green on every laptop, red on CI for 19 pushes, unread.
//
// Both are the same shape — an assertion that asks the FILESYSTEM a question
// whose answer depends on which machine is asking. The individual fixes make
// each assertion ask git instead. This script is the thing that would have
// CAUGHT them: it stages exactly `git ls-files` into a temp directory, links
// `node_modules`, and runs the suite there.
//
// It uses the WORKING TREE's content, not HEAD's, so uncommitted edits are
// tested — the failure this prevents usually arrives with them.
//
//   npm run test:clean
// ============================================================
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, copyFileSync, rmSync, symlinkSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

// `-z` and a NUL split: a tracked path may contain anything, including a
// newline, and splitting on '\n' would silently drop or halve such a file —
// leaving the clean run testing something subtly different from CI, which is
// the exact failure mode this script exists to remove.
const files = git('ls-files', '-z').split('\0').filter(Boolean);
if (!files.length) { console.error('git ls-files returned nothing — is this a repo?'); process.exit(2); }

const dir = mkdtempSync(join(tmpdir(), 'samo-clean-'));

// ⛔ IT HAS TO BE A REAL GIT REPO, not just a directory of the right files.
// The first version copied the files and stopped, and three assertions went red
// that are green on CI — because they shell out to git (`ls-files`,
// `check-ignore`) and git answers "not a repository" rather than the truth.
// A clean-room that reports failures CI will not report is worse than none: it
// teaches you to ignore it. `git init` + the same remote + the same .gitignore
// (itself a tracked file, so it arrives with the rest) is what makes the answers
// match.
execFileSync('git', ['init', '-q'], { cwd: dir });
const origin = (() => {
  try { return git('remote', 'get-url', 'origin').trim(); } catch { return ''; }
})();
if (origin) execFileSync('git', ['remote', 'add', 'origin', origin], { cwd: dir });

// ⛔ AND IT HAS TO SEE THE HISTORY. A fresh `git init` holds no objects, so
// `git cat-file -e <sha>` says no for every sha — including the perfectly good
// one in STATE.md's ✅ DEPLOYED line, whose guard then fails. That is a red this
// tool INVENTED: CI checks out with `fetch-depth: 0` and resolves it fine.
//
// Borrowing the real object database via `alternates` gives the clean room the
// same history CI has, while the working tree stays clean — which is the only
// difference this script is built to expose. Read-only by nature: nothing here
// ever writes an object.
writeFileSync(join(dir, '.git/objects/info/alternates'),
  `${join(ROOT, '.git/objects')}\n`);

let copied = 0;
for (const rel of files) {
  const src = join(ROOT, rel);
  if (!existsSync(src)) continue;            // deleted-but-still-tracked
  const dst = join(dir, rel);
  mkdirSync(dirname(dst), { recursive: true });
  copyFileSync(src, dst);
  copied += 1;
}
// Not copied — linked. Installing would take minutes and test a different
// dependency resolution than the one being worked in.
symlinkSync(join(ROOT, 'node_modules'), join(dir, 'node_modules'), 'dir');

// Staged, not committed: `git ls-files` reads the INDEX, so adding is what
// makes the copies visible to it — and a commit would cost time for nothing.
// `-f` because .gitignore is here too and some tracked paths match it.
execFileSync('git', ['add', '-A', '-f'], { cwd: dir });

console.log(`\n  ${copied} tracked files → ${dir}`);
console.log('  (nothing gitignored is here — this is what CI sees)\n');

const r = spawnSync('npx', ['vitest', 'run', ...process.argv.slice(2)],
  { cwd: dir, stdio: 'inherit', env: { ...process.env, CI: 'true' } });

rmSync(dir, { recursive: true, force: true });

if (r.status !== 0) {
  console.error('\n⛔ RED on a clean tree. This is what CI will report.');
  console.error('   The usual cause is an assertion reading a file that is');
  console.error('   gitignored — present here, absent there. Ask git, not the');
  console.error('   filesystem.\n');
}
process.exit(r.status ?? 1);
