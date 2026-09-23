// ==============================================
// NATIVE DIALOGS ARE NOT CONTROL FLOW.
//
// Chrome shows a "Prevent this page from creating additional dialogs" checkbox
// after a few dialogs. Once it is ticked, for the whole life of that page:
//
//     confirm() → false, instantly, no UI
//     prompt()  → null,  instantly, no UI
//     alert()   → nothing at all
//
// Code that reads those as "the user said no" then does nothing, silently,
// forever. This repo has shipped that bug THREE times, each reported as a
// button that does nothing:
//
//   • ทีม SAMO's ลบสมาชิก      ("ลบสมาชิกไม่ได้ — nothing happens at all")
//   • ระบบบ้าน's ปฏิเสธ         (same report, months later, same cause)
//   • ระบบบ้าน's แจ้งข้อมูลไม่ถูกต้อง, which collected its reason with prompt()
//
// And an ADMIN session is the one that reaches the checkbox first — it is the
// session that uses dialogs most. `src/js/confirm-modal.js` draws the question
// instead; `askConfirm` / `askDelete` always resolve and cannot be suppressed.
//
// This test is a RATCHET, not a wall. The modules below still use the native
// dialogs and are known debt; the list may only ever SHRINK. Converting one and
// forgetting to delete its line here fails the test, and adding a native dialog
// to a module that has been cleaned fails it too.
// ==============================================
import { describe, it, expect } from 'vitest';
import { stripComments } from './strip-comments.js';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SRC = new URL('.', import.meta.url);

/**
 * Modules that may still call `confirm()` / `prompt()`. Every entry is a
 * user-facing dialog waiting to become a dead button.
 *
 * ⚠️ ONLY REMOVE LINES FROM THIS LIST. If you are adding one, convert the call
 * to `askConfirm` from ./confirm-modal.js instead — and if it collects a VALUE,
 * put an input in the form it affects (that is why there is no askPrompt).
 */
const STILL_NATIVE = new Set([
  'vs-staff.js',
  'pr-staff.js',
  'announcements.js',
  'profile.js',
]);

/** `confirm(` / `prompt(` as a CALL, not `.confirm(`, not `askConfirm(`, and
 *  not the word inside a comment or a string. Comments are stripped first
 *  because several of these modules explain the hazard in prose. */
const CALL = /(^|[^.\w$])(confirm|prompt)\s*\(/;

// Comments AND string contents, via the shared scanner. The regex this used to
// carry opened a "comment" at the `/*` inside `input.accept = 'image/*'` and ran
// to the next `*​/` in the file — 13,839 characters of main.js, 2,321 of
// admin-main.js and ~6,000 across my-seat.js were never scanned at all, and
// my-seat.js is one of the modules this test was written for. See
// strip-comments.js.
function stripCommentsAndStrings(code) {
  return stripComments(code, { keepStrings: false });
}

function jsFiles(dir = SRC, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const u = new URL(e.name + (e.isDirectory() ? '/' : ''), dir);
    if (e.isDirectory()) jsFiles(u, out);
    else if (e.name.endsWith('.js') && !e.name.endsWith('.test.js')) out.push(u);
  }
  return out;
}

const rel = (u) => fileURLToPath(u).replace(/.*\/src\/js\//, '');

describe('native confirm()/prompt() are not used as control flow', () => {
  const offenders = new Set();
  for (const f of jsFiles()) {
    const name = rel(f);
    // confirm-modal.js owns the ONE legitimate call: a fallback for pages with
    // no Bootstrap, where a native dialog beats no confirmation at all.
    if (name === 'confirm-modal.js') continue;
    const code = stripCommentsAndStrings(readFileSync(f, 'utf8'));
    for (const line of code.split('\n')) {
      if (CALL.test(line)) { offenders.add(name); break; }
    }
  }

  it('adds no new module to the native-dialog list', () => {
    const added = [...offenders].filter((f) => !STILL_NATIVE.has(f)).sort();
    expect(added, `these modules must use askConfirm() from ./confirm-modal.js:\n${added.join('\n')}`)
      .toEqual([]);
  });

  it('keeps the allow-list honest — a cleaned module must be removed from it', () => {
    const stale = [...STILL_NATIVE].filter((f) => !offenders.has(f)).sort();
    expect(stale, `no longer uses a native dialog — delete from STILL_NATIVE:\n${stale.join('\n')}`)
      .toEqual([]);
  });

  it('has cleaned every ทีม SAMO / ระบบบ้าน / self-service module', () => {
    // The surfaces an admin drives hardest, and the ones a student uses to fix
    // their own record. Named explicitly so a future edit to STILL_NATIVE
    // cannot quietly re-admit one of them.
    const mustBeClean = [
      'team/index.js', 'team/terms.js', 'team/health.js',
      'house/index.js', 'house/my-house.js',
      'my-seat.js', 'identity-check.js', 'admin-main.js', 'main.js',
    ];
    const dirty = mustBeClean.filter((f) => offenders.has(f));
    expect(dirty, `native dialog in a hot admin/self-service path:\n${dirty.join('\n')}`)
      .toEqual([]);
  });
});
