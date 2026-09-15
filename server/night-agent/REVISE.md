# Revision pass — the queue finished and the window is still open

Earlier tasks tonight already ran. Read `git log --oneline main..HEAD` and the
files those commits touched, then spend this pass making that work BETTER — not
starting something new, and not rewriting what already works.

Pick the highest-value item you can finish in this one pass:

1. **A bug in tonight's own work.** Re-read it as a hostile reviewer. Does each
   piece do what it claims? Is a label claiming something its number does not
   test? Did anything get asserted that was never verified?
2. **A guard that is green against broken code.** Take a test written tonight,
   reintroduce the bug it exists for, confirm it goes RED on the assertion you
   expect, restore it. **Check the mutation actually landed** before believing a
   green result. If a guard does not catch its own bug, fix the guard and say so.
3. **A simplification.** Less code doing the same thing, with the tests still
   passing, is worth more than another feature nobody asked for.
4. **A gap in the documentation** tonight's work created.
5. **The release notes.** `src/data/changelog.js` holds a `PENDING` array of
   entries written as work shipped. Read it, read `docs/VERSIONING.md`, and write
   `docs/state/agent-notes/2026-09-16-release-notes-draft.md`: how the pending
   entries would group into a release, which version number the policy implies
   (MAJOR = the portal's scope changed · MINOR = a new system inside it · PATCH =
   fixes), and a plain-Thai draft a student could read. ⛔ PLAN ONLY — do NOT run
   `npm run release`, do NOT edit `changelog.js`, do NOT bump a version. The
   owner decides when a release is cut.

⛔ Do NOT start a new feature. Do NOT refactor something unrelated. Do NOT
rewrite a file that is already correct just to have changed something — churn is
worse than an idle window, because a human has to read it.

Run `npm test` and `npm run build` before finishing. If either fails and you
cannot fix it in this pass, REVERT your change and say so.

Append one short paragraph to `docs/state/agent-notes/2026-09-16-revisions.md`
saying what you changed and why. If you found nothing worth changing, write that
instead — one honest line beats an invented improvement.
