// ============================================================
// remove-own-scan-delete-guard.test.js — removeOwnScan() in dashboard.js
// showed "Removed ✓" on a DELETE that may have matched ZERO rows.
//
// THE BUG. `supabase.from('scans').delete().eq('id', scan.id).eq('user_id',
// currentUserId)` had no `.select()` and never checked how many rows were
// actually deleted — only `error`. Per this repo's own documented rule
// (.claude/rules/mistakes.md class 7: "Every DELETE needs
// `return=representation` + a `data.length` check — RLS returns zero rows,
// not an error") and the ALREADY-CORRECT sibling in admin-page.js
// (window.deleteActivity, which does exactly this check), a delete that
// matches no row under RLS returns 200 with no error. If `scan.id` /
// `currentUserId` ever disagree with the DB's view of `auth.uid()` (a stale
// session, a race on currentUserId), the old code showed "Removed from your
// passport ✓", cleared the student's local memory/photos, and reloaded —
// and the stamp reappeared right after, directly contradicting the toast
// just shown.
//
// No test infra exists under passport/ yet and dashboard.js isn't built to
// be imported standalone in Node (it creates a live Supabase client and
// wires DOM listeners at module scope), so this pins the fix the same way
// this repo's other structural guards do (admin-order-modal.test.js,
// reserved-rule.test.js): by the exact shape of the SOURCE, not by running
// the module. See docs/mistakes/frontend-ui.md, "NEVER SLICE SOURCE BY LINE
// NUMBER" — this reads the function body structurally (brace-counted), not
// by a line range.
// ============================================================

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const SRC = readFileSync(new URL('./dashboard.js', import.meta.url), 'utf8');
const CODE = SRC.split('\n').filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join('\n');

/** The body of a top-level `[async ]function NAME(...) { ... }`, found by
 *  counting braces from its opening one — structural, not a line range. */
function functionBody(src, name) {
  const m = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\([^)]*\\)\\s*\\{`).exec(src);
  if (!m) throw new Error(`function ${name} not found`);
  let depth = 1;
  let i = m.index + m[0].length;
  const start = i;
  for (; i < src.length && depth > 0; i++) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') depth -= 1;
  }
  return src.slice(start, i - 1);
}

describe('removeOwnScan — the self-service "remove my mis-scan" delete', () => {
  const body = functionBody(CODE, 'removeOwnScan');

  it('still deletes by id + user_id (the RLS-scoping half of the fix stays intact)', () => {
    expect(body).toMatch(/\.from\(\s*['"]scans['"]\s*\)\.delete\(\)/);
    expect(body).toMatch(/\.eq\(\s*['"]id['"]\s*,\s*scan\.id\s*\)/);
    expect(body).toMatch(/\.eq\(\s*['"]user_id['"]\s*,\s*currentUserId\s*\)/);
  });

  it('asks for the deleted rows back (.select), the only way RLS silence is visible', () => {
    expect(body).toMatch(/\.select\(/);
  });

  it('checks the row count before treating the delete as a success', () => {
    // Matches window.deleteActivity's own guard shape in admin-page.js —
    // "no data, or an empty array" must be treated as a failure, not routed
    // through the success toast / localStorage-clear / reload path.
    expect(body).toMatch(/data\.length\s*===\s*0/);
  });

  it('the empty-match check runs BEFORE the success toast, not after', () => {
    const checkIdx = body.search(/data\.length\s*===\s*0/);
    const toastIdx = body.search(/Removed from your passport/);
    expect(checkIdx).toBeGreaterThan(-1);
    expect(toastIdx).toBeGreaterThan(-1);
    expect(checkIdx).toBeLessThan(toastIdx);
  });
});
