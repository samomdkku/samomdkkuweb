#!/usr/bin/env node
// ============================================================
// ci-status.mjs — is every GitHub workflow green on main, EACH ONE?
//
// WHY (owner, 2026-10-13): "it said samomdkkuweb migration workflow run all
// jobs have failed, i've seen a lot of message like this and you keep missing
// it". The `migrations` workflow (replay every migration onto an empty
// database) had been red since 3345f94 while a session reported "GitHub's
// checks pass on every push".
//
// HOW IT HID. That workflow runs only when a migration changes. Every later
// push ran `build`, `docs`, `preview-mirror` — all green — so "the latest run"
// and "the runs on HEAD" both looked clean. A red run is only visible if you
// ask each workflow for ITS OWN latest result. That is the whole check:
// per workflow, the newest COMPLETED run on main must not have failed.
//
//   node tools/ci-status.mjs          # prints one line per workflow; exit 1 if any red
// ============================================================
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const RED = new Set(['failure', 'cancelled', 'timed_out', 'startup_failure', 'action_required']);

/**
 * PURE. runsByWorkflow: { [workflowFile]: [{ status, conclusion, headSha, url, createdAt }] }
 * newest first. Returns { red: [...], green: [...], none: [...] }.
 * A workflow with only in-progress runs, or none on main, is `none` — not red,
 * not green: it has not said anything yet.
 */
export function ciVerdict(runsByWorkflow) {
  const out = { red: [], green: [], none: [] };
  for (const [wf, runs] of Object.entries(runsByWorkflow)) {
    const done = (runs || []).find((r) => r.status === 'completed');
    if (!done) { out.none.push({ wf }); continue; }
    (RED.has(done.conclusion) ? out.red : out.green).push({ wf, ...done });
  }
  return out;
}

function gh(args) {
  const r = spawnSync('gh', args, { encoding: 'utf8', cwd: fileURLToPath(new URL('..', import.meta.url)) });
  if (r.status !== 0) throw new Error((r.stderr || r.stdout || 'gh failed').trim().split('\n')[0]);
  return r.stdout;
}

/** Ask GitHub. Throws when it cannot — the caller must report that as SKIP, never as green. */
export function fetchRuns() {
  const dir = fileURLToPath(new URL('../.github/workflows/', import.meta.url));
  const files = readdirSync(dir).filter((f) => /\.ya?ml$/.test(f));
  const runs = {};
  for (const f of files) {
    runs[f] = JSON.parse(gh(['run', 'list', '--workflow', f, '--branch', 'main', '--limit', '5',
      '--json', 'status,conclusion,headSha,url,createdAt']));
  }
  return runs;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  let v;
  try { v = ciVerdict(fetchRuns()); } catch (e) {
    console.log(`SKIP could not ask GitHub: ${e.message}`);
    process.exit(2);
  }
  for (const r of v.red) console.log(`RED   ${r.wf}: ${r.conclusion} on ${String(r.headSha).slice(0, 7)} — ${r.url}`);
  for (const r of v.green) console.log(`GREEN ${r.wf}: ${r.conclusion} on ${String(r.headSha).slice(0, 7)}`);
  for (const r of v.none) console.log(`NONE  ${r.wf}: no completed run on main`);
  process.exit(v.red.length ? 1 : 0);
}
