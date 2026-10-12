// master-mirrors.test.js — the ratchet for the `master` fold.
//
// WHY THIS EXISTS
// `master` (migration 0111) is a rule implemented on BOTH sides of the wire, and
// this repo has now paid for that drift twice:
//
//   2026-08-17 — a master holder found the PR/VS "ไม่ส่งแจ้งเตือน" toggle and the
//                full VitalSound controls missing, because those gates read
//                `role === 'dev'` and a master is `role='user'`.
//   2026-08-18 — a master holder opened หนังสือโครงการ onto an EMPTY pane,
//                because `projectSeatRole()` read the raw `managed_project_seats`
//                column while SQL's `current_user_project_seats()` folds master
//                into all three seats. 36 of 41 master holders were affected.
//
// The second one is the interesting failure. `master-role-gates.test.js` was
// written after the FIRST report and swept for `role === 'x'` literals — and
// `projectSeatRole` has none. It does not GATE on a role, it PRODUCES one,
// upstream of every gate. A sweep shaped like the last bug could not see it.
//
// So this test is not another pattern sweep. It is a REGISTRY: it enumerates
// the SQL functions that special-case the master key, and fails when that set
// changes. A new one is not necessarily a bug — but it is always a decision
// about whether JS needs to learn the same fold, and this is what forces
// somebody to make it instead of discovering it from a user months later.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { stripComments } from './strip-comments.js';

const MIG_DIR = new URL('../../supabase/migrations/', import.meta.url);

/**
 * Every `public.<name>` function whose BODY mentions the master key.
 *
 * Comments are stripped first: several migrations discuss master in prose while
 * defining something unrelated, and a guard satisfied by a comment is the
 * `confirm-modal.test.js` trap.
 *
 * The body is taken from the DOLLAR-QUOTED block (`as $$ … $$`), not "up to the
 * next function". The first version did the latter and reported a third name,
 * `get_claude_board` — it had swallowed the `create policy` statements that
 * follow it in 0154, which reference master but are not that function. Checked
 * against the live database (`pg_get_functiondef` over every function in
 * `public`, 2026-08-18): the live answer is exactly the two names below, and
 * `get_claude_board`'s real body does not contain the word. The scan is only
 * trustworthy because it was reconciled with the authority, not instead of it.
 */
function sqlFunctionsThatFoldMaster() {
  const found = new Set();
  for (const f of readdirSync(MIG_DIR).filter((n) => n.endsWith('.sql'))) {
    const src = stripComments(readFileSync(new URL(f, MIG_DIR), 'utf8'));
    const re = /create\s+(?:or\s+replace\s+)?function\s+public\.(\w+)\s*\(/gi;
    let m;
    while ((m = re.exec(src))) {
      const rest = src.slice(m.index);
      const open = /\bas\s+(\$\w*\$)/i.exec(rest);
      if (!open) continue;
      const from = open.index + open[0].length;
      const to = rest.indexOf(open[1], from);
      if (/'master'/.test(rest.slice(from, to < 0 ? rest.length : to))) found.add(m[1]);
    }
  }
  return found;
}

/**
 * The registry. Each SQL function that folds master, and where JS says the same
 * thing. `mirror` is `[file, substring that must appear]` — deliberately a
 * PROPERTY of the mirror (that it routes through the one shared predicate),
 * never a copy of the fold's own list, so a wrong list cannot pass itself.
 */
const REGISTRY = {
  // The permission test itself. JS mirror: userCanAccess() → holdsMaster().
  current_user_has_permission: ['auth.js', 'holdsMaster(user)'],
  // The seats. JS mirror: projectSeatRole() → holdsMaster(). Added 2026-08-18.
  current_user_project_seats: ['projects/index.js', 'holdsMaster(user)'],
  // 0211: the account dashboard is master-ONLY. The page asks holdsMaster()
  // before calling either RPC (and the sidebar's `accounts: 'master'` entry
  // reaches it through userCanAccess()).
  account_dashboard: ['accounts/admin.js', 'holdsMaster(getUser())'],
  account_dashboard_pulse: ['accounts/admin.js', 'holdsMaster(getUser())'],
};

describe('every SQL function that folds `master` has a named JS mirror', () => {
  const found = sqlFunctionsThatFoldMaster();

  it('the scanner can actually SEE something (a guard whose control finds nothing is not a guard)', () => {
    // If a migration reshuffle broke the regex this would silently pass every
    // other assertion by finding an empty set — the `house0116` failure mode.
    expect(found.size).toBeGreaterThan(0);
    expect([...found]).toContain('current_user_has_permission');
  });

  it('names exactly the functions the registry knows about', () => {
    // A NEW name here is not automatically a bug — it is an unanswered
    // question: does the frontend branch on whatever this function returns? If
    // it does, give it a holdsMaster() term and add it below. If it does not
    // (server plumbing, a policy helper nothing in JS reads), add it with a
    // one-line note saying so. Do not delete the assertion.
    expect([...found].sort()).toEqual(Object.keys(REGISTRY).sort());
  });

  it.each(Object.entries(REGISTRY))('%s is mirrored in JS', (_sqlFn, [file, needle]) => {
    const src = stripComments(readFileSync(new URL(`./${file}`, import.meta.url), 'utf8'));
    expect(src).toContain(needle);
  });

  it('the mirror is the SHARED predicate, never a re-derived includes()', () => {
    // `holdsMaster()` exists so the two-channel test (permissions AND
    // managedPermissions — 26 of the 29 rows carrying master are ตำแหน่ง, i.e.
    // the managed channel) lives in one place. A hand-rolled
    // `permissions.includes('master')` in a new caller is the drift this whole
    // file is about, and team-vocab.test.js already pins auth.js's own count.
    for (const [file] of Object.values(REGISTRY)) {
      const src = stripComments(readFileSync(new URL(`./${file}`, import.meta.url), 'utf8'));
      if (file === 'auth.js') continue; // auth.js DEFINES it; the count is pinned elsewhere.
      expect(src).not.toMatch(/permissions\s*\)?\s*\.includes\('master'\)/);
      expect(src).toMatch(/import \{[^}]*holdsMaster[^}]*\} from '\.\.?\/auth\.js'/);
    }
  });
});
