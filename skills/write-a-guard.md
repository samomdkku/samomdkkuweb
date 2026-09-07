# Writing a guard — a test, a proof script, or a sweep

Read this **before** adding anything whose job is to notice a problem:
a `src/js/*.test.js` ratchet, a `tools/*.mjs` / `tools/*.sql` proof, or a
one-off sweep you are about to trust an answer from.

This repo's guards have been wrong more often than its features, and always in
the same direction: **they reported green over a live hazard.** That is the worst
failure a guard has, because it also stops anyone looking. Everything below is a
rule this repo paid for, with the instance that bought it.

---

## The one ritual that catches almost everything

**Break it, watch it fail, restore it.** In the same sitting, before you commit.

```bash
cp src/js/thing.js /tmp/thing.bak
# reintroduce the exact bug the guard is for
npx vitest run src/js/thing.test.js     # MUST fail, and on the RIGHT assertion
cp /tmp/thing.bak src/js/thing.js
npx vitest run src/js/thing.test.js     # green again
```

A guard you have only ever seen pass is a guard you have not tested. On
2026-08-10 a brand-new test for the dead ยกเลิก button **passed with the bug
reintroduced** — it was matching prose in a comment. Two minutes of this ritual
found it. Nothing else would have.

For a SQL proof the equivalent is: run it against the state *before* the fix and
confirm the failing rows are the finding, then apply and re-run. `0147` went
20/23 → 23/23, and the three that moved were exactly the hole.

---

## The six ways a guard lies

### 1. It cannot see the hazard

`photo-refcount.test.js` was asked to find columns named `photo_url`. It found
every one, faithfully, and reported green for three days while the hazard sat in
`houses.icon_url` — one column along, invisible to it (0146).

> **Scan by SHAPE, and force a decision on every hit.** Not "columns named
> `photo_url`" but "every `*_url` column a delete path can reach", with an
> explicit allow-list of exclusions that each carry a reason. A new column then
> fails the test until somebody classifies it.

**And the instrument that feeds the guard needs a guard.** Four tests here each
hand-rolled `.replace(/\/\*[\s\S]*?\*\//g, '')` to strip comments. `main.js`
contains `input.accept = 'image/*'`, so the "comment" opened inside that string
and ran to the next close-marker in the file — 13,839 characters blanked before
any assertion ran, ~24,000 across three modules, and `native-dialog.test.js` was
one of the readers left blind. A wrong instrument does not fail the test; it
makes the test PASS, because the hazard is no longer in the text it was handed.
One shared `src/js/strip-comments.js`, with its own test whose control asserts it
can still find the motivating hazard. Its OWN first draft was out of phase on
template interpolations — so the rule is: anything that transforms the source
before the assertion (comment stripping, minified-bundle grepping, slicing a
region out of a file) is part of the guard and needs the same reintroduce-and-
watch-it-fail treatment as the assertion.

The same trap, one level finer: **a guard can match one SPELLING of the thing it
is looking for.** `definer-authz.test.js` was written to catch a SECURITY DEFINER
function that refuses people on a role list, and its first pattern looked for the
role-list SYNTAX — `current_user_role() in (…)`. Re-introducing the exact bug it
was written for left it GREEN, because 0045 had refactored the call into a local
`v_role` and tested the variable. The predicate was still a role list; it just
did not look like one. Matching the CHANNEL instead (`current_user_role` in the
body at all) caught it. When your pattern names an operator, an argument list, or
a call shape, ask what a rename or an intermediate variable does to it.

### 2. Its control finds nothing either

A sweep that returns zero rows has told you nothing until you have proved it can
return something. `0147`'s first sweep printed *"0 policies reference `users`"*
beside *"0 policies reference anything"* — both were the instrument failing.

> **Every sweep prints the count its CONTROL found**, next to the count that
> matters. "5 policies have inline subqueries, and here they are; 0 of them name
> `users`" is evidence. "0" is not.

### 3. It is satisfied by prose

The guard reads source text, and the source text *talks about* the thing.

- `confirm-modal.test.js` looked for a click handler with
  `/\[data-confirm-no\][\s\S]*addEventListener\('click'/`. The source's own
  comment contained `[data-confirm-no]`, and an unrelated
  `addEventListener('click', onYes)` sat further down. **It passed with the bug
  present.**
- Its helper then used `indexOf(marker)` and found the marker **in the comment**,
  reporting "no cancel button found" against markup that was right there.

> **Strip comments before asserting**, and match structurally (`<button[^>]*…>`)
> rather than by `indexOf`. A guard that reads comments can be satisfied by
> *writing about* the fix instead of making it.

### 4. Its subject is a name, and names rot

- `proj0092-seat-parity.mjs` hardcoded a member who inherits a `project_seat`.
  The org chart was reorganised; that person no longer does. It had been failing
  for an entirely correct reason for weeks, which is how a proof stops being read.
- `house0116-authz.sql` named `manee.j@kkumail.com` as its signed-in subject —
  an address that **has never existed** in `public.users`, so `auth.uid()` was
  NULL and its whole ALLOW half was vacuous from the day it was written.

> **Derive the subject from the property under test.** "Any member under a node
> that has a `project_seat`". "Any account with no grants in EITHER column and no
> `students` row". Then assert *that such a subject exists* — so a genuinely
> empty tree still fails, loudly and for the right reason.

### 5. It errors instead of failing

`house0116-authz.sql` called `get_house_roster()`, dropped on purpose by 0124,
**from inside its `DO` block**. The block aborted on that line, so not one of its
assertions ran — including the ones before it. It was dead for 23 migrations and
still looked like coverage in `STATE.md`.

> **A proof that ERRORS is ABSENT, not failing.** A runner that greps for the
> word FAIL scores an aborted script as silence. When a migration drops a
> function or a column, `grep tools/` for it **in the same commit**.

### 6. It needs something the enforcing machine cannot have

Three assertions in `dev-env.test.js` passed `join(ROOT, '.env.local')` — the
maintainer's own file, gitignored *because it holds production secrets*. Green
on every laptop, red on every CI runner. **`build.yml` failed on 19 consecutive
pushes** (2026-09-06 → 2026-09-07) and nobody read run 20, which carried a real
change; local `npm test` kept answering `1848 passed`, which is a different
question. One of the three was worse than red — `expect(env.VITE_ENV_NAME)
.not.toBe('production')` passes on `undefined`, so on CI it was GREEN for the
exact state it exists to catch.

> **A guard that needs a secret cannot run where guards are enforced.** Anything
> a test reads is committed or synthesised — feed it the artefact a real person
> creates (`contributorEnvFile()` writes one from `.env.local.example`), never
> the one your machine happens to have. And when CI names tests that pass
> locally, the first question is *how long has this been red*
> (`gh run list --workflow=build.yml`), not *what did I break*.

---

## Checklist before you commit a guard

- [ ] I reintroduced the bug and watched this guard fail — **on the assertion I
      expected**, not a different one.
- [ ] Every DENY has an ALLOW over the same rows. (A probe that can only print
      "denied" cannot tell a working guard from a broken connection.)
- [ ] The control prints what it found, not just that it found nothing.
- [ ] It matches shape, not one name; new instances fail until classified.
- [ ] Its subject is derived, not named.
- [ ] It reads code, not comments — and the STRIPPER it reads through is the
      shared `strip-comments.js`, not a fresh regex.
- [ ] If it errors, that is distinguishable from passing.
- [ ] It runs with nothing on the machine but the repo — no `.env.local`, no
      credential, no network. Check by hiding the file and running the suite.

## Shapes worth copying

| Want | Copy |
|---|---|
| Audit registry — every call site must declare an answer | `upload-cleanup.test.js` |
| Shape scan with reasoned exclusions | `photo-refcount.test.js` (`NOT_A_PORTRAIT`) |
| Both-directional live authz sweep | `tools/authz-sweep-identity.sql` |
| Differential — predict, act, compare | `tools/house0144-delete-impact.sql` |
| Derived subject + existence assertion | `tools/house0116-authz.sql` |
| Source-text ratchet done safely | `confirm-modal.test.js` + `strip-comments.js` |
| Differential between a form and the code behind it | `signin-screen.test.js` (reads the minimum out of auth.js) |

## Two SQL-specific traps

- **`tools/db-query.mjs` COMMITS.** Wrap anything that writes in
  `begin; … rollback;`. A probe with `limit 1` and no `ORDER BY` will mutate a
  real row.
- **RLS does not RAISE on UPDATE/DELETE** — it silently affects 0 rows, while a
  guard trigger raises `P0001` and a missing GRANT raises `42501`. Score all
  three as "blocked", and report WHICH, because a GRANT-less table denies
  everyone and reads exactly like the policy working.
- `set_config(…, true)` is **transaction**-scoped and `reset role` does not clear
  it, so a deny case after an impersonation helper can pass with the previous
  identity still in place.
