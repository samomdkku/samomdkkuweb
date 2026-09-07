# Mistakes — Proof scripts & verification discipline

How the `tools/*.mjs` proofs lie to you. A probe that can only report "denied" cannot tell a working guard from a broken one.

Each entry: **Symptom → Cause → Fix → Where it lives now**. The always-loaded index of every entry across all nine files is `.claude/rules/mistakes.md`; add new entries here, then run `npm run mistakes:index`.

---

## Two implementations of one rule drift silently — diff them, don't eyeball them

**Symptom**: none. The 0096 visibility ladder is implemented twice —
`public.vs_remark_vis()` as the server boundary and `remarkVis()` in `utils.js`
for rendering — and STATE.md dutifully said "mirrors, keep them in step". That
sentence is not a mechanism.
**Cause**: a differential test over 26 input shapes found 3 disagreements. The
SQL accepts `'t'`, `'1'` and numeric `1` as truthy for the legacy `internal`
flag (`lower(e->>'internal') in ('true','t','1')`; jsonb `->>` stringifies, so
`1` arrives as `'1'`); the JS accepted only `true` and `'true'`.
**Severity**: fails SAFE — the server strips the entry as staff-only and the
client never sees it. The reverse direction (JS believing an entry is
staff-only while the server ships it) would have rendered a staff note to a
submitter. No live row uses those shapes; the app writes `internal: true`.
**Fix**: JS now matches the SQL truthy set exactly, pinned in
`utils.test.js`, and the differential test is permanent:
`tools/vs-remark-vis-mirror.mjs` runs every legal + malformed shape through
BOTH and diffs.
**Rule**: when one rule is implemented on both sides of the wire, write the
differential test the same commit. And when reviewing one, state which
direction of disagreement is the dangerous one — here "JS stricter than SQL" is
safe and "SQL stricter than JS" is a leak, and only the test can tell you which
you have.

---

---

## Debugging note: `tools/db-query.mjs` COMMITS — a probe with `limit 1` and no `ORDER BY` will mutate a real row

**Symptom**: while reproducing the RLS bug above, a probe that did
`update vs_tickets set target_dept='SE' where id = (select id … limit 1)` under
a widened policy reported `rows=1` — and moved a **real production ticket** into
SE. Caught only by diffing `select target_dept, count(*)` against a snapshot
taken before the session.
**Cause**: `db-query.mjs` posts to the Management API `database/query` endpoint,
which runs the string as ONE implicit transaction and **commits**. Its header
says "READ-ONLY" as a statement of intent, not an enforced mode. A plpgsql
`begin … exception when others` block only rolls back the failing *sub*
transaction; every probe that SUCCEEDED persisted.
**Fix / how to probe safely**:
- Every proof script in `tools/` ends its Management-API call with `rollback;`
  for exactly this reason. Do the same for ad-hoc investigation — it is one word.
- Snapshot the shape you are about to disturb (`select <col>, count(*) … group
  by 1`) BEFORE the first write probe, and diff it after. That snapshot is what
  turned "everything looks restored" into "one ticket is in the wrong dept".
- `where id = (… limit 1)` with no `ORDER BY` picks a DIFFERENT row per call, so
  verifying "the ticket I touched" by id proves nothing about the one an earlier
  probe touched.
**Restoring**: the ticket's own timeline said which dept it belonged to. Reverted
with `touch_vs_tickets_updated_at` disabled so the restore did not stamp a third
bogus `updated_at`, and set `updated_at` back to the last genuine event.

---

---

## RLS does not RAISE on UPDATE/DELETE — a proof that asks "did it throw?" scores a fully-blocked write as permitted

**Symptom**: the first run of a new authorization proof reported
`anon cannot update scans -> ALLOWED`, `anon cannot set anyone total_km ->
ALLOWED`, and `CAN still rename self -> ALLOWED` — the last one a pass, the first
two apparently catastrophic. The policies were in fact correct; the *test* was
wrong, in the direction that matters: it would equally have reported ALLOWED for a
genuinely open policy, so it could not tell a closed system from an open one.
**Cause**: RLS filters rows; it does not reject statements. For UPDATE and DELETE a
row the policy hides is simply **not visible**, so the statement succeeds having
touched nothing and no exception is raised. Wrapping it in
`begin … exception when others then 'blocked'` therefore records ALLOWED for both
the permitted case and the fully-denied case. INSERT is the exception that misleads
you into the pattern: a `WITH CHECK` failure IS a real error (42501), so
INSERT probes written this way work, and you generalize from them.
**Fix**: for UPDATE/DELETE assert `ROW_COUNT`, not the absence of an exception:
```sql
update … ; get diagnostics v_rc = ROW_COUNT;
insert into out values('k','rows='||v_rc);
```
then treat `blocked:*` OR `rows=0` as denied, and `rows=N>0` as permitted. The
distinction also makes the assertion honest in the other direction — "the student
CAN still rename themselves" now means one row actually changed, not merely that
nothing exploded.
**Where**: `tools/pass-hardening.mjs` `TRY` (INSERT / RPC probes) vs `TRYN`
(UPDATE / DELETE probes); the 53 checks split along exactly that line.
**Rule**: in any RLS proof, classify each probe by statement type first. Only
INSERT and an explicit `raise` in a definer function fail loudly; SELECT, UPDATE
and DELETE fail *quietly and by row count*. Two more traps from the same script:
the Management API returns **201**, not 200, so a `status !== 200` guard discards a
successful run; and once you `set_config('role', 'anon')` inside a transaction you
must `reset role` at top level before impersonating the next principal, or every
later phase silently runs as anon and "passes".

---

---

## A proof script that fails for a CORRECT reason gets ignored — then it protects nothing

**Two instances in one bug-scan pass, both in tools/:**
1. `prof0095-seat-parity.mjs` asserted "an account with no seat reads **no**
   sign requests". `project_sign_requests_read` has a deliberate
   `prof_id = auth.uid()` branch — a named recipient reads their own request,
   seat or not — and since the script was written, two real requests were
   addressed to the probe account. The policy is right; the assertion aged out.
   Now: `where prof_id is distinct from auth.uid()`, i.e. assert what the policy
   actually promises — *nothing beyond your own name*.
2. `seat0109-my-seat.mjs` asserted "the payload contains no other person's
   kkumail" with a bare `position(kkumail in blob)`. One live `team_members` row
   carries the placeholder `kkumail = '-'`, and a hyphen appears in every uuid
   in the payload → a reported leak that did not exist. Now the candidate must
   look like an address (`like '%@%.%'`, length ≥ 6).
**Rule**: when a proof fails, find out WHICH branch produced the number before
touching any policy — and prefer assertions worded as the invariant ("nothing
beyond X") over incidental counts ("zero rows"), because a count encodes a
snapshot of the data and the data moves. A probe whose candidate set can contain
placeholder / single-character values needs a shape filter, or it cries wolf.


## `pg_get_functiondef` over every function 42809s on aggregates — and the whole introspection query fails, reporting nothing

**Symptom**: the enumeration recipe recorded in migration 0110's own comments —
`select proname from pg_proc p join pg_namespace n … where pg_get_functiondef(p.oid) ~ 'has_permission\(''team''\)'` —
returns `ERROR: 42809: "array_agg" is an aggregate function` through the
Management API. Run casually (or with the error swallowed) it looks like a clean
sweep: no function names, nothing to fix.
**Cause**: two independent traps in one query. (1) `pg_get_functiondef` RAISES on
an aggregate or window function, and `pg_proc` contains those, so the predicate
blows up on a row that has nothing to do with the search — fix with
`p.prokind = 'f'`. (2) The pattern itself never matches: `pg_policies.qual` and
function bodies render the literal as `current_user_has_permission('team'::text)`,
so `has_permission\('team'\)` finds zero of the twelve live hits. The policy
version of the same recipe therefore reported "no policy uses the view key" while
every read policy did.
**Fix**: `prokind='f'`, and match `'team'::text` (or just `has_permission\(''team'`
as a prefix). Verified by re-running: the corrected query found exactly the three
functions that named `prefix` before 0113 dropped it, and 12 policies naming the
team keys.
**Rule**: an introspection query that returns NOTHING is not evidence of nothing.
Before trusting a sweep, make it find something you already know is there — the
allow-direction of class 7, applied to your own tooling. And never write a
verification recipe into a comment without running it first; a wrong one is worse
than none, because the next person reads it as already checked.

---

## A proof failed for a CORRECT reason because its subject was hardcoded — the org chart moved underneath it

**Symptom**: `tools/proj0092-seat-parity.mjs` printed
`FAIL baseline: the member inherits a seat from their ตำแหน่ง []` while every
other check in the file passed, including the one immediately after it that
exercises the SAME function. Discovered incidentally while verifying that
migration 0147 had not broken seat resolution — i.e. it had been failing for an
unknown length of time and nobody had looked.

**Cause**: the script hardcoded `TREE_USER = 'phuriphat.ma@kkumail.com'` as the
person who inherits a `project_seat` from their ตำแหน่ง. The org chart was
reorganised since; that account now sits under *Ungrole* and *หัวหน้าฝ่าย IT*,
and neither node carries a `project_seat` (only *อุปนายกฝ่ายบริหารองค์กร* does).
So `effective_team_project_seats_for_email()` correctly returned `{}` and the
proof correctly reported that its own FIXTURE was gone. Nothing was broken except
the assumption.

This is the failure mode that matters: a proof that cries wolf gets ignored, and
an ignored proof guards nothing. A permanently-red check is worse than no check,
because it also trains you to skim past the greens next to it.

**Fix**: resolve the subject FROM THE TREE instead of naming them —
`select tm.kkumail from team_members tm join team_nodes tn on tn.id = tm.node_id
where tn.project_seat is not null and tm.project_seat is null limit 1` — and
assert first that such a person exists, so a genuinely empty tree still fails
loudly and for the right reason. Sections B–D keep the hardcoded account because
they STAGE an explicit seat and so do not depend on where anyone sits. 13 → 14
checks, 14/14.

**Where it lives now**: `tools/proj0092-seat-parity.mjs` section A.

**Rules**: (1) A proof's SUBJECT should be derived from the property under test,
not named. Anything named is a fixture, and fixtures rot at the speed of the
data. (2) When a proof fails, decide "stale fixture" vs "real regression" BEFORE
touching anything else — and if it is the fixture, fix the proof rather than
noting it, because the note is what the next person will not read. (3) The tell
here was a FAIL sitting next to a PASS that used the same function: when one
assertion about a function fails and another succeeds, suspect the data.

---


### Second instance, 2026-08-15: the subject SELECTOR was narrower than the gate

`house0144-delete-impact.sql` picked whoever could run the RPC with

```sql
where 'house' = any(managed_permissions) or 'house' = any(permissions)
```

but `student_delete_impact` (0144) admits **two** channels:

```sql
current_user_role() in ('vp_admin','dev')  OR  has_permission('house')
```

On 2026-08-15 the permission half selected **nobody** — zero accounts held
`house` in either column, while **twelve** held the role — so `admin_uid` was
empty, `sub` was null, and the RPC correctly raised 42501. The proof did not go
red with a useful message: it **ERRORED**, which `run-proofs.mjs` reports as
UNKNOWN, and `STATE.md` had been asserting "15/15 green" for three days.

Nothing was wrong with the function or the policy. The proof had simply lost its
subject, because a grant channel moved while the picker watched only one of them.

**Fix**: the picker now mirrors the gate — both channels, permission-holders
ranked first so that half keeps being exercised whenever anyone holds it.

**Rule**: **a proof's SUBJECT SELECTOR is part of the gate it is testing, and has
to be as wide as the gate.** If the function accepts role OR permission, a picker
that matches only permission is one org-chart edit away from testing nothing —
and it fails by ERRORING, which is silence rather than a red line. Re-derive the
selector from the function's own `if`, never from the channel that happened to be
populated the day it was written.

## Four guards were reading a MANGLED file — `'image/*'` opened a "comment" that ate 13,839 characters of main.js

**Symptom**: A new assertion in `signin-screen.test.js` — "these handlers are
defined exactly once" — passed with a duplicate handler sitting in `main.js` on
a line the test had just been shown. Reintroducing the bug did not turn it red.
**Cause**: Every guard that reads JS source carried its own
`.replace(/\/\*[\s\S]*?\*\//g, '')` to strip block comments. That regex cannot
tell a comment opener from the two characters `/*` inside a STRING, and
`main.js` contains `input.accept = 'image/*';`. The "comment" opened there and
ran to the next close-marker anywhere in the file: **13,839 characters of real
source blanked before a single assertion ran**. The same literal is in
`admin-main.js` (2,321 chars) and `my-seat.js` (~6,000 across seven spots).
Measured total: ~24,000 characters invisible to the guards — and one of the
blinded readers was `native-dialog.test.js`, whose entire job is to find native
dialogs in exactly those modules.
**Fix**: one shared `src/js/strip-comments.js` — a character scanner with a mode
stack that knows strings, template literals and regex literals, and replaces
comments with equivalent whitespace so line numbers still match. All four guards
read through it.
**The fix's own first draft was wrong in the same family**, which is the part
worth keeping: it skipped from a backtick to the next backtick, ignoring that
`${…}` holds real code. A multi-line template in `house/my-house.js` put it out
of phase for the rest of the file, leaving a `/** … */` block unstripped — and
`native-dialog.test.js` then reported that block's PROSE as a call site. A false
positive is how that got noticed at all; had it failed the other way it would
have been silent.
**Where**: `src/js/strip-comments.js` + `strip-comments.test.js`, used by
`signin-screen` · `native-dialog` · `confirm-modal` · `definer-authz`.
The stripper's own test asserts the property a phase error violates: with
strings and regex literals blanked, NO comment marker may survive in ANY module
— and it walks subdirectories, because the top-level-only first version never
saw the file that broke it.
**Rule**: a guard's INSTRUMENT needs a guard. Comment-stripping, minified-bundle
grepping and "read the source and match a pattern" all silently change what the
test can see, and when the instrument is wrong the test does not fail — it
PASSES, because the hazard is no longer in the text it was handed. Never
hand-roll a lexer per test file: one shared instrument, with its own test, whose
control asserts it still finds the hazard it was built for.

---

## A proof whose subject was a SHOP ADMIN reported that a buyer could set an order total to ฿1

**Symptom**: A new both-directional proof for the buyer self-update whitelist
printed `D1. buyer may NOT change the total — expected refused, got allowed`,
and `D4. the total is untouched — expected 5, got 1`. Read literally, anyone
could rewrite the price of their own order.
**Cause**: The proof resolved its subject as "an order in a buyer-editable
status", `order by id limit 1`. Every one of the six orders in this database was
placed by a shop ADMIN (they are test orders), and
`shop_orders_self_update_guard` opens with
`if public.current_user_is_shop_admin() then return new; end if;` — so the guard
never engaged. Every case, ALLOW and DENY alike, was measuring an admin's
permissions. The ALLOW half had been "passing" for the same reason.
**Fix**: the subject is MANUFACTURED — clone a real order onto a real non-admin
account inside the transaction that is rolled back anyway — and the exclusion is
asserted rather than assumed (`S2. the subject is NOT a shop admin`, read from
`current_user_is_shop_admin()` under the subject's own claims). Note the
exclusion needs the permission columns, not just the role: that helper is true
for `samoshop` OR `master` through either `permissions` or `managed_permissions`.
**Where**: `tools/shop0150-buyer-contact.sql`.
**Rule**: **an authorization proof measures whoever it impersonates, and a
privileged subject makes both halves vacuous at once** — the ALLOW half passes
for the wrong reason and the DENY half fails for the wrong reason. When the
guard under test has an early-return for a role, the subject MUST be excluded
from that role, and the exclusion must be an assertion in the output. If real
data cannot supply such a subject, manufacture one inside the rollback rather
than settling for the subject that exists. Corollary: a DENY case that fails
loudly is worth more than an ALLOW case that passes quietly — here the deny half
was the only thing that revealed the probe was measuring the wrong person.

---

## Checking the proofs by hand produced TWO false alarms in a row — they emit four different output shapes

**Symptom**: An end-of-session sweep ran every live proof through an ad-hoc
parser and reported `authz-sweep-identity 0/23 FAIL`. The proof was fully green.
The corrected parser then reported four more as `N-1/N FAIL`. Those were green
too.
**Cause**: The parser looked for a `result` column. The proofs do not agree on
one — `authz-sweep-identity` and `pr0149` use `verdict`, `house0144` and
`shop0150` use `result`, the `house0145` / `house0146` / `team0145` family uses
`status` **and ends with an `ALL PASS` SCORE row**, `house0116` returns a single
JSON blob with no per-case column at all, and six more are `.mjs` scripts
printing plain text. The first parser could not see `verdict`; the second
counted each file's own summary row as a failing case.
**Fix**: `tools/run-proofs.mjs` (`npm run proofs`) runs all fifteen and prints
one normalised verdict each. It knows the four shapes, treats a trailing
`ALL PASS` row as a summary rather than a case, and reports a proof that ERRORS
as a failure — with the property that matters: **output it cannot interpret is
UNKNOWN and exits non-zero**, never a pass.
**Where**: `tools/run-proofs.mjs`; `STATE.md` now says to use it and why.
Verified by reintroduction, both ways: a SQL syntax error surfaces as
`✗ FAIL errored: …`, and a flipped expectation as `✗ FAIL 1 failed — B3. RPC
denies the ungranted user`.
**Rule**: **the thing that READS a guard's output is part of the guard.** A
verification step that cries wolf gets switched off, and this repo has written
that down twice already — so the parser is not an incidental script, it is the
instrument, and it needs the same reintroduce-and-watch-it-fail treatment as the
assertion. When several guards report in different formats, normalise them once
in a checked-in tool instead of re-deriving the format at each call site.

---

## A proof that ERRORS is not a proof that fails — it is a proof that is ABSENT, and `house0116-authz.sql` had been absent for 23 migrations

**Symptom**: `node tools/db-query.mjs tools/house0116-authz.sql` returned
`HTTP 400 … ERROR: 42883: function public.get_house_roster(smallint) does not
exist`. Not one assertion printed. Found only because 0147 prompted a re-run of
the whole proof suite; nothing had run this file since **0124**.

**Cause**: three separate rots, each individually reasonable, and one of them
fatal in a way the other two are not.

1. `get_house_roster()` was DROPPED on purpose by 0124 (ระบบบ้าน publishes
   อาจารย์, never students). The script still called it — inside the `DO` block,
   so the whole block aborted at that line and **every assertion, including the
   ones before it, produced nothing**.
2. It still asserted `students.status` and `students.sai_locked`, columns 0120
   dropped.
3. Its signed-in subject was the hardcoded `manee.j@kkumail.com`, which has
   **never existed in `public.users`** — so `auth.uid()` was NULL and the ALLOW
   half could not have worked even before (1) killed the file outright.

The distinction that matters: a proof that FAILS is loud and shows you which
assertion. A proof that ERRORS produces no assertions at all, and a file that
exists, is named after the migration it guards, and is listed in `STATE.md` looks
exactly like coverage. It is worse than having no proof, because it occupies the
slot where a real one would go.

**Fix**: subjects resolved from the grant model instead of named (an account
holding `house`/`master` for the allow half; an ungranted account with no
`students` row for the ordinary half, so the fixture row can be inserted without
colliding with `students_kkumail_key`). The allow assertion compares against the
REAL row count rather than a hardcoded `2`. The self-edit probe now smuggles
`sai_code` — a column that still exists and still must not be self-writable —
beside the legal `nickname_self`, and asserts the STORED value afterwards,
because the RPC builds an explicit column list and so IGNORES an unknown key
rather than raising. And the roster probe is **inverted**: it now asserts
`get_house_roster` does NOT exist, turning 0124's privacy decision into a guard
that fails if anyone re-adds a student-roster reader. 8/8.

**Where it lives now**: `tools/house0116-authz.sql`.

**Rules**: (1) **When a migration drops a function or a column, grep `tools/` for
it in the SAME commit.** 0120 and 0124 each dropped something this file named,
and neither noticed. (2) Distinguish "the proof failed" from "the proof did not
run" — a suite runner that only looks for the word FAIL scores an aborted script
as silence. (3) Invert a deletion into an assertion: if dropping something was a
DECISION, guard its absence, or the next person re-adds it and every proof still
passes.

## A browser probe measured its coordinates before the page scrolled

**Symptom.** A CDP touch-gesture run against the Claude booking calendar
reported four of five cases green on its first run. The one red case was the one
asserting that a long press DOES open the modal.

**Cause.** The touch point was computed as `column.getBoundingClientRect().top +
120`. `buildGrid()` scrolls the calendar to 08:00, so the column's own rect
starts several hundred pixels ABOVE the scroll viewport and that expression
landed on the hero panel. Every "a tap opens no modal" result was true because
nothing was being tapped. The single failing case was the only one that could
not pass vacuously — which is the entire reason to write an ALLOW beside every
DENY.

The same run then produced a second instance of the same mistake: the week
arrow's coordinates were read BEFORE a `scrollIntoView()` moved the toolbar,
because the app sets `scroll-behavior: smooth`, so `scrollIntoView()` returns
before the scroll has happened. The arrow tap landed on empty page and "tapping
the arrow opens no modal" passed for the wrong reason.

**Fix.** Every synthetic-input probe now carries a CONTROL that names what is
under the point before touching it:

```js
const hit = document.elementFromPoint(x, y);
results.push(`${hit?.closest('.claude-daycol') ? 'PASS' : 'FAIL'}  CONTROL: …`);
```

and coordinates are re-measured at the moment of use, after an instant scroll
plus a wait.

**Where it lives now.** The driver pattern in `skills/drive-the-browser.md`.

**The general rule.** *A synthetic click, tap or drag must prove it hit
something before it proves anything else.* Input coordinates are computed from a
layout that the previous step may have moved, and the failure mode is silent and
green: a tap on nothing produces exactly the same "no side effect" the passing
case asserts. Related and equally silent: `scrollIntoView()` under
`scroll-behavior: smooth` returns before the scroll, so any coordinate read on
the next line is stale.

## A comment listed four boundaries and the code had three

**Symptom.** The Claude capacity rail drew one band "ว่าง 48%" from 11:00 to
03:00 the next day, straight through 14:39 — the moment the open 5-hour window
resets and a fresh 100% becomes available.

**Cause.** `claude_free_windows()` builds its segments by evaluating
`claude_free_now()` at every instant where the answer can change. The migration
header lists four such instants and names the fourth as "the open window's own
reset". The `union` had three. The three that were there all came from the
bookings table and were easy to enumerate; the missing one came from a
MEASUREMENT, which is exactly why it was the one left out.

**Fix.** The reset is in the boundary set — and, more usefully, the guard no
longer asserts a list of boundaries at all. It asserts the PROPERTY:

> the answer does not change inside a band.

Three interior samples per band, compared to the number the band is labelled
with. Any missing boundary — that one, or one nobody has thought of — makes some
band non-constant and turns it red without anyone predicting it. Falsified by
reintroducing both original bugs: the general case catches both.

**Where it lives now.** `tools/claude0157-rail-segments.sql` §A1.

**The general rule.** *Do not write a guard from the same list the code was
written from.* If the list is what is wrong, a guard that restates it passes.
Assert the property the list was supposed to produce.

A second lesson from the same file: the first draft of §B asserted that every
band's end instant still earns that band's number, and three bands failed —
**the assertion was wrong, not the code.** Only one boundary kind
(`booking_start − 5h`) carries "you may still start AT this moment"; at a
window reset or a booking's start or end the later value already applies. A
guard that generalises one boundary's behaviour to all of them turns a true
statement into a false one, and it costs a debugging session to find out which
end was wrong.

---

## A control threshold that assumed the proof runs early in the quota week

**Symptom.** `claude0161-rail-guard-parity.sql` went red on
**C1. control — the grid is not empty**, with every real assertion green. The
suite had been 21/22 the day before and was now 20/22, which reads as a
regression in the rail↔guard parity.

**Cause.** The grid the differential walks is the REMAINDER of the Claude quota
week, at 15-minute steps:

```sql
generate_series(greatest(now(), claude_week_start(now())) + interval '1 minute',
                claude_week_start(now()) + interval '7 days' - interval '1 minute',
                interval '15 minutes')
```

so it has ~672 points just after the Wednesday 16:00 reset and shrinks to zero
as the next one approaches. The control asserted `count(*) > 100` — a constant
that silently means "this proof is run with at least 25 hours left in the week".
Measured on 2026-08-18 at 18:39 ICT, ~21 h before the reset: **86 points**. The
guard was correct, the code was correct, and the proof was red.

**Fix.** `> 20` — five hours, one full Claude window, the shortest span over
which the differential says anything — with the reason written next to it. The
vacuity that C1 exists to catch is really covered by **C2** ("the answer
actually VARIES across the week"): a constant pair of functions fails C2 no
matter how many points the grid has.

**Where it lives now.** `tools/claude0161-rail-guard-parity.sql` §C.
Sibling hazard, noted but not hit: `claude0157`'s sample-booking search runs
`date_trunc('hour', now()) + 7h` → `week_start + 7d − 11h` and collapses the
same way (5 candidate slots left at that same instant).

**The general rule.** **A control whose threshold is a constant encodes WHEN
the proof is allowed to run.** Any subject derived from `now()` against a
period boundary shrinks to nothing at the end of that period — so either
derive the threshold from the span actually available, or set it to the
smallest span over which the assertion still means something, and say which in
the file. A proof that fails for a correct reason is a proof that gets ignored,
and the next reader pays for it by re-deriving a green result.

## Two proofs ERRORED for six days because their scenario needed a week with room left in it

**Symptom.** `claude0157` and `claude0161` both died on
`HTTP 400 … 23502: null value in column "starts_at"` — not a failing assertion,
an aborted script producing zero probe rows. `STATE.md` carried the right
diagnosis on 2026-08-19 and the owed fix went unwritten, so the two reds sat in
every subsequent handoff as known-bad noise. That is the whole cost: a proof
that errors is indistinguishable from a proof nobody reads, and both of these
guard the rail arithmetic a later session then changed.

**Cause, and it is a rot with a clock on it.** Both scenarios find their slot in

```sql
generate_series(date_trunc('hour', now()) + interval '7 hours',
                public.claude_week_start(now()) + interval '7 days' - interval '11 hours',
                interval '1 hour')
```

— the remainder of the LIVE quota week. Run late enough in that week and the
range is empty, `sc.b_start` is NULL, and the booking insert six statements
later violates NOT NULL. Measured 2026-08-25 23:05 ICT: the week ended in
5h55m; zero rows. The slot was already resolved from the data rather than
hardcoded (the lesson from `proj0092`), which is why this reads as safe — but
"derived from live data" and "always derivable" are different properties, and
only the second keeps a proof runnable.

**Fix.** Three things, and only the first is about the error.

1. **The proof owns its week.** `claude_free_windows()` reads `now()` itself and
   only ever draws the CURRENT week — there is no `p_at` to move — so the
   scenario genuinely needs a week with room in it. What decides where that week
   starts is `claude_settings.week_reset_dow` / `week_reset_time`, a SETTING,
   and the whole proof runs inside a transaction that rolls back. It now states
   the geometry it needs: *the current quota week began two hours ago*. Every
   `claude_week_start()` call — in the search, in the function, in the trigger —
   reads that same moved boundary.
2. **The empty search FAILS instead of aborting.** A00 asserts a slot was found
   and the insert is `where … is not null`, so a genuinely full week produces a
   red assertion rather than silence.
3. **`claude0157` B4 got the second booking it always needed.** B4 asserts at
   least one deadline is a real STEP DOWN — that waiting can COST you quota,
   which is the rail's entire claim. One booking produced `48 → 48 → 50 → 50 →
   100`, monotonically non-decreasing: the heaviest window was the EARLIEST one,
   so every edge stepped up and B4 correctly refused to pass vacuously. A heavy
   block after the free stretch supplies the phenomenon. A01 controls that the
   row was actually written — a B4 red because the SCENARIO failed reads exactly
   like a B4 red because the RULE broke.

**What the new scenario then found, which is why this entry is worth reading.**
B1 asserted that at a deadline the instant itself EQUALS the earlier band.
Measured where a window RESET and a DEADLINE coincide:

```
04:00 − 1s    50    the first booking's window, still running
04:00        100    a session begun exactly here ends exactly as the next
                    booking opens, and the previous window has just reset
04:00 + 1s    20    inside the next booking's window, 80 loaded
```

100 is correct, and larger than BOTH neighbours. The promise a deadline makes is
*"act at this instant and you do not lose the larger number"*, not "you get
exactly the earlier band" — identical at an ordinary deadline, different when
two boundary kinds land on one instant. B1 is now `>=`, falsified with a
one-second-late oracle (B1 and the new B1b go red; A1 and B2 stay green, which
is what shows the weakening did not blind it).

**It also means the RAIL under-reports at that instant**, and that is recorded
rather than hidden: bands are drawn from one second INSIDE, so no band carries
the 100. Accepted — an isolated instant that beats both open intervals around it
has no width to be drawn with, and the error is in the safe direction: the rail
shows less than is available, never more.

**Where it lives now.** `tools/claude0157-rail-segments.sql` §A00/§A01/§B1/§B1b
and `tools/claude0161-rail-guard-parity.sql`. All 23 proofs green 2026-08-25.

**The general rule.** *A scenario built from live geometry is only as runnable
as that geometry — if the thing it needs can run out, the proof must CREATE it,
not search for it.* Move the SETTING that defines the geometry rather than
relaxing what the scenario asks for; relaxing it is tuning the guard to pass.
And when a control refuses to pass vacuously, supply the phenomenon it is asking
about AND add a control that the supply worked — otherwise the next red is
unreadable.

## `open(p, "w")` truncates before the `read()` you passed to it

**Symptom.** A one-liner meant to append a write-up —
`open(p,'w').write(open(p).read() + entry)` — left `docs/mistakes/tooling-proofs.md`
holding only the new entry. 12 write-ups gone. Caught within seconds, but only
because `npm run mistakes:index` printed **207 entries** where the previous run
had printed 219, and that number was on screen to compare against.

**Cause.** Python evaluates the CALL's arguments before the call, so
`open(p,'w')` runs first and truncates the file to zero; the inner
`open(p).read()` then reads the empty file. The expression looks like
"read, then write" and executes as "truncate, then read".

**Fix.** Read into a variable first, assert it looks whole, then open for
writing:

```python
prev = open(p, encoding='utf-8').read()
assert len(prev) > 10000, 'refusing to append to a file that looks truncated'
open(p, 'w', encoding='utf-8').write(prev + entry)
```

**Where it lives now.** Recovered with `git checkout` — the only reason the loss
was cheap is that the file was committed.

**The general rule.** *A destructive open is not an argument, it is a
statement.* Any expression that both opens a file for writing and reads that
same file is a truncation, whatever the order looks like on the page. And the
generated COUNT that caught it is the real lesson: a tool that prints "219
entries" every run turns a silent deletion into a number that visibly moved —
which is worth more than the tool's actual job.

## A proof went red fifteen minutes after the app started working again

**Symptom.** `npm run proofs` reported `claude0167-monitoring-switch.sql ✗ FAIL
— 2 failed — A2 · stale sample (600 min) → NO weekly remainder is claimed`. It
had been green the day before, and nothing in the commit under test came within
a mile of the Claude module — the session had touched `pr_tickets` policies and
nothing else.

**Cause.** Not the code, and not the assertion. The INSTRUMENT.

`pg_temp.week_left(p_age)` puts one sample in the table at a chosen age and asks
`claude_free_now()` what the week has left. Its whole premise is that the row it
inserts is the newest one `claude_latest_sample()` can see — that function takes
the newest row in the table and *then* tests its age, so anything fresher
answers the question instead. The comment above it said exactly that, and said
it in the confident voice: *"the sample is deleted first, so the probe's row is
the newest by construction rather than by hoping — the real table holds four
days of rows whose sampled_at would otherwise be compared against."*

The delete was `where raw->>'proof' = 'claude0167'`. Its own rows. The real ones
were never touched.

That was invisible for exactly as long as the reporter was PAUSED. With no real
sample newer than about eleven hours, a deliberately 600-minute-old probe row
genuinely was the newest, and the proof measured the age rule it meant to
measure. The owner switched measurement back on at 17:18 UTC; the timer wrote a
fresh sample at 17:20 and every fifteen minutes after that. From then on the
newest row was a real one twelve minutes old, `claude_free_now()` believed it —
correctly — and A2 read `560.0` where it wanted `NULL`.

**Fix.** Clear every sample inside the proof's own transaction, which is rolled
back like every other write in the file (`claude_usage_samples` carries no
triggers — checked before the change, and the 585 real rows were counted again
after). Then A0, which asserts the premise instead of asserting it in prose:
after a probe call there is exactly one sample in the table and it is the
probe's.

**A0 needed a second pass, and that is its own lesson.** Written as one
statement — `... from (select pg_temp.week_left(5)) warm` — it reported `585
rows, probe=none`. A volatile function's writes are not visible to the rest of
the statement that called it, so the count saw the table as it stood *before*
the delete. A control that measures the wrong instant is not a control. The
warm-up call is now its own statement.

Falsified by restoring the scoped delete: A0, A2 and A4 all go red together.

**Where it lives now.** `tools/claude0167-monitoring-switch.sql` — the delete,
the ⚠️ paragraph on the instrument, and §A0.

**The general rule.** This file already carries *"its SCENARIO needs live
geometry that RAN OUT"* — two rail proofs that searched the remainder of the
quota week for a slot and errored once the week was nearly over. This is the
same class from the other side: **a scenario can depend on the ABSENCE of
something just as silently as on the presence of it**, and absence is the harder
one to notice, because the proof is green while the system is broken and goes
red when the system recovers. Ask of every proof: *what is this quietly assuming
the environment will not do?* Here the answer was "write a row", which is the
one thing the feature exists to do.

And the tell was in the comment all along. **A comment that says a thing is true
"by construction rather than by hoping" is a claim, and a claim in a comment is
the shape this repo keeps paying for.** If it is by construction, the
construction can assert it — that is what A0 is.

## STATE.md said a proof was red that had been green for a day — in three places

**Symptom.** Asked to "check the handoff until you find no error", an audit of
`STATE.md` turned up **six** stale claims in a file whose entire value is being
true. Five shared one shape, and it is the shape that matters:

> the same fact lived in TWO OR MORE places, and only ONE was corrected.

| claim | where it was still wrong | reality |
|---|---|---|
| context budget "29,725 / 30,000, 275 bytes of headroom — the next write-up may turn `npm test` red" | one paragraph, ~400 lines below a paragraph saying that exact claim was false and had been deleted | 16,712 / 30,000 (56%) |
| "`claude0157` B4 is red" | three separate places | green since 2026-08-25 |
| test count | 1309 · 1170 · 1312, three homes | 1312 |
| "still owed: grant the `claude` permission" | top of the file | granted; the bottom of the same file said so |
| deployed sha | `543a025` | prod was two deploys ahead |
| head-counts (146 accounts / 41 masters) | two homes, one updated | 153 / 42 |

**Cause.** Not carelessness in any single edit. Each correction was made
*correctly* — in the place the author happened to be reading. `STATE.md` is
~1,350 lines, and a fact acquired a second home the moment a session summarised
it in its own block while an older block still stated it. Nothing connected the
two, so a correction landed in one and the other went on asserting the opposite.

**Why it costs more than being silent.** A file that contradicts itself cannot
be partially trusted: the reader has no way to tell which half is current, so
they re-derive the work anyway — which is the single thing the handoff exists to
prevent. The `543a025` line is the sharpest case. A stale deployed sha reads
*exactly* like "there is a deploy owed", and disproving it costs a VPN session
and 90 seconds. It is not a missing fact; it is a fact pointing the wrong way.

**Fix.** `src/js/state-handoff.test.js`, five assertions, each falsified:

- every repo-relative path `STATE.md` names resolves (or is exempted with a
  written reason — served bundle hashes and filename PATTERNS are named as
  evidence, not as files, and are excluded by requiring a `/`);
- "Migrations through NNNN" matches the highest migration on disk;
- the claimed live-proof count matches what `run-proofs.mjs` registers
  (minus `db-query.mjs`, which is the runner, not a proof);
- **every** spelling of each of those must agree — the check runs over all
  matches, not the first;
- the file may state exactly one test count.

It found a third home of the test count on its first run, in a paragraph that
had also been carrying "migrations through 0166" and "21 of 22 proofs green"
for a week.

**Where it lives now.** `src/js/state-handoff.test.js`; `STATE.md`'s example
paragraph now carries ⛔ *do not read counts out of this paragraph*, and says
the live numbers live in exactly one place.

**The general rule.** This is the repo's class 6 — *two implementations of one
rule drift* — with prose as the implementation, and it is easier to walk into
than the code version, because a document has no compiler and every sentence
looks equally authoritative. Two habits, in order of value:

1. ⛔ **When you correct a claim, grep the whole file for its other homes before
   you commit.** Every one of the five was a single grep away.
2. **Give a decaying fact exactly one home, and make the other places point at
   it rather than repeat it.** A number in a narrative block is a copy that will
   never be updated, because nobody re-reads a session summary to check its
   arithmetic. The durable half of an old block is the LESSON; the counts in it
   are already wrong.

And the reason a test is the third fix here: this had been paid for at least
three times before — "this line said `543a025` for a day", "two sessions
repeated the locked-out claim", "it said measurement was OFF after it had been
turned back on" — each time diagnosed correctly, written down, and repeated
anyway.

## `which pg_dump` said it was not installed, and it had been installed all along

**Symptom (as recorded in the plan).** *"`pg_dump`, `psql` and the `supabase`
CLI are **all absent** from this machine — `which` finds none of them."* On the
strength of that line, three phases of `docs/TEAM-WORKFLOW.md` were marked
blocked on "install a PostgreSQL 17 client", and a note was written telling the
next session to `brew install libpq` before planning around it.

**Cause.** `which` searches `PATH`. **Homebrew's `libpq` is keg-only** — it is
installed under `/opt/homebrew/opt/libpq/bin` and deliberately NOT linked into
`PATH`, because its binaries collide with the ones a full `postgresql` formula
would install. So `which` was answering a question about `PATH` and the answer
was read as a statement about the disk. Measured 2026-08-27:
`brew list --versions libpq` → `libpq 18.4`, and
`/opt/homebrew/opt/libpq/bin/pg_dump --version` → `pg_dump (PostgreSQL) 18.4`.
It had been there the whole time.

There was a second, smaller error stacked on the first: the plan reasoned that a
client older than the 17.6 server would refuse, and concluded "install 17". The
refusal is one-directional — `pg_dump` refuses to dump a server *newer* than
itself, and a newer client dumping an older server is the supported case. 18.4
against 17.6 was always fine.

**Fix.** Use the full path, or `export PATH="/opt/homebrew/opt/libpq/bin:$PATH"`.
`docs/TEAM-WORKFLOW.md` §7.1 now records the correction, and phase 1 is blocked
on the database password alone.

**Where it lives now.** `docs/TEAM-WORKFLOW.md` §7.1.

**The general rule.** *Class 7 — check that the INSTRUMENT can see the thing.*
A negative result is a statement about what the instrument searched, never about
what exists. `which` searches `PATH`; `grep` searches the file you gave it (not
the shared chunk the code actually landed in); a minified bundle has no
module-scope names to find. **Before believing a zero, ask what the tool looked
at, and check it against a subject you KNOW is there** — here, one
`brew list --versions` would have cost five seconds and saved a day of the plan
being wrong about its own blockers.

## A `pg_dump` restore made the copy MORE permissive than the original

**Symptom.** `samo-dev` was built from a `pg_dump` of production and compared
against it object by object. Tables, functions, triggers and RLS-enabled tables
matched exactly. **Grants did not: dev had 134 that production does not have,
and 0 that it was missing.** Sixteen tables — `students`, `people`,
`student_change_requests`, `student_import_batches`, `_timeline_backup_0166`,
`schema_migrations` and ten more — had been granted to **`anon`**, which
production grants nothing on.

**Cause.** Supabase sets `ALTER DEFAULT PRIVILEGES` granting everything to
`anon` / `authenticated` / `service_role` on newly created tables. `pg_dump`
writes the GRANTs a database HAS; it writes no REVOKEs, because it assumes stock
PostgreSQL defaults where nothing is granted to anyone. Every table the restore
CREATES therefore picks up the platform's defaults first, and nothing in the
dump takes them back off. **The dump is a description of what is granted, not of
what is denied, and on a platform with non-standard defaults those are different
things.**

**Why it was not cosmetic.** RLS was still enabled on all of them, so rows were
still filtered — which is exactly why it would have survived a casual look.
But production refuses `anon` at the GRANT, *before any policy runs*, and dev
would have refused only at the policy. Two databases, two different gates, and
`docs/TEAM-WORKFLOW.md` D2 puts **no door gate on the preview URL** precisely
because dev is supposed to behave identically (§7.3).

**Fix.** Generate the REVOKEs from the measured difference — never from a
hand-written list of tables that look sensitive — and re-measure until extra = 0
and missing = 0. It took 134 revokes. `npm run dev:check` (`tools/dev-check.mjs`)
is now the ratchet: it compares the anon key's HTTP status on both databases
across allow-subjects AND deny-subjects, and was falsified by granting `anon`
SELECT on `students` on dev alone — it reported `DRIFT` and exited 1.

**Where it lives now.** `skills/build-the-dev-database.md` §3b,
`tools/dev-check.mjs`.

**The general rule.** *Comparing two systems, compare what each DENIES, not only
what each allows.* A copy is verified by the differences being zero in **both
directions** — "everything the original had is present" is half a check, and it
is the half that cannot see an addition. And when a platform ships non-standard
defaults, any tool that emits only the positive state (a dump, an export, a
seed) will silently inherit them.

## A refresh script printed "identical to production" while refreshing nothing

**Symptom.** `tools/dev-refresh.mjs`, run for the first time, finished with
`row-count diffs: 0 · grants extra: 0 · grants missing: 0` and
`✓ samo-dev rebuilt and identical to production`. Buried above it, filtered out
of the summary, was `ERROR: duplicate key value violates unique constraint
"users_pkey" … CONTEXT: COPY users, line 1`.

**Cause, two halves that hid each other.** Step 2 drops and recreates `public`
and `passport` — it does **not** touch `auth`, which is a different schema. So
`COPY auth.users` hit rows from the previous load and **aborted the entire COPY
at line 1**, leaving dev's accounts exactly as they were. Step 6 then compared
64 tables — `public` and `passport` only — and never looked at `auth`, so it
could not see what step 4 had failed to do. **The verification's blind spot was
in the same place as the bug**, which is why the run went green.

It only *looked* correct because the stale auth copy happened to be identical to
the fresh one: the hand-run had loaded it minutes earlier. A refresh a week later
would have carried a week-old set of accounts and still reported parity.

**Fix.** `truncate auth.users cascade` before loading, and include
`auth.users` / `auth.identities` in the comparison — 64 tables became 66, which
is the number the by-hand check had used all along. Re-run: 66 compared, 0
diffs, and the sign-in proof re-run against the rebuilt copy because truncating
auth had wiped the password the earlier proof set.

**Where it lives now.** `tools/dev-refresh.mjs` steps 4 and 6,
`skills/build-the-dev-database.md`.

**The general rule.** *A verification that covers less than the operation is not
a verification — and the gap is always where the bug lives, because the same
blind spot produced both.* Enumerate what the operation TOUCHES, then check that
the verification's subject list covers all of it. Here the operation wrote to
`auth` and `public`; the check read only `public`. **Also: a script that filters
its own noise must not filter its own errors.** The COPY failure was on screen
the whole time, three lines above a green summary that contradicted it.

## `npm test | grep` returned success while the suite was failing

**Symptom.** Two commits were pushed to `main` on 2026-08-27 with a failing
test, hours after CI was made blocking. Both were written as guarded chains that
looked safe.

**Cause, and the second one is the interesting half.** The first was
`npm test ... ; git add` — a semicolon, so nothing gated the commit. The "fix"
committed for it was `npm test 2>&1 | grep -E "Tests" && git commit` — **and a
pipe replaces the exit status with the LAST command's.** `grep` found the summary
line and exited 0, so `&&` saw success while the suite was red and the failure
was printed on screen three lines above.

**Fix.** `npm test > /tmp/t.log 2>&1; echo $?` and read the CODE, or keep any
pipe out from between the test and the `&&`. Direct pushes to `main` by an admin
bypass the required check (`enforce_admins: false`, deliberate — it is what lets
the owner push), so branch protection does not catch this shape.

**Where it lives now.** `skills/` habits and this entry.

**The general rule.** *Class 7 — the instrument decides what can be seen.* A
pipeline's exit code describes its LAST stage, not its first; a summary line
matching is not the same fact as a suite passing. Same shape as `which pg_dump`
reporting "absent" for a keg-only binary earlier the same day: both times the
tool answered a narrower question than the one being asked, and the narrower
answer was read as the broader one. **When a check gates something, verify the
CHECK reports failure — run it once against a known-bad state.**

## `urllib` got 403 from Discord and I reported the service as DOWN

**Symptom.** A check of the VitalSound webhooks reported all twelve DEAD with
HTTP 403, and "VitalSound notifications are broken for 12 departments" was
reported to the owner as a live production outage.

**Cause.** The check used Python's `urllib.request`, whose default User-Agent is
`Python-urllib/3.x`. Discord's edge rejects it with **403 Forbidden** regardless
of whether the webhook exists. The same twelve URLs checked with `curl` — and
with Node's `fetch`, which is what `tools/discord-webhook-identify.mjs` uses —
returned **200 with the channel id, all twelve alive**.

**How it was caught.** The twelve had been created and read back through the bot
API minutes earlier, so "all twelve dead" contradicted a known-good observation
from the same session. A result that contradicts a breadcrumb you already have
is the instrument, not the world.

**The earlier reading was probably wrong too.** The check that first declared
the OLD VS webhook dead used the identical urllib script and got the identical
403. The webhook it condemned may have been healthy; it has since been replaced,
so that can no longer be settled — which is itself the cost.

**Fix.** Use the committed tool (`npm run webhook:id`), which uses `fetch`.
Never hand-roll an HTTP check against a third-party API with a library whose
default User-Agent is a bot signature.

**Where it lives now.** `tools/discord-webhook-identify.mjs`.

**The general rule.** *Distinguish "the service says no" from "the service did
not answer the question you think you asked."* 401 and 403 are different
answers: 401 said "invalid webhook token" (a real verdict about the credential),
403 said nothing about the credential at all. **Before believing a negative
result from a network probe, reproduce it with a second client.** Two clients
disagreeing means the instrument; two agreeing means the world.


---

## The verification command in STATE.md named a sha two deploys behind — so following the handoff's own instructions reported a deploy that had already shipped

**Symptom.** `STATE.md` said, in bold, *"Check, do not trust this line"*, and
gave the command to run. Running it printed seven changed files and **132
insertions** under `src/` — the unmistakable shape of *a deploy is owed*. Nothing
was owed. Everything it listed had shipped two deploys earlier.

**Cause.** The deployed sha had **four homes** in one file, and exactly one of
them had been corrected:

| line | said | actual |
|---|---|---|
| the ✅ DEPLOYED line | `2151d6a` | ✅ correct |
| "Previous:" | `36ac1d5` | `832bb14` (two deploys stale) |
| the `git diff` snippet, twice | `7405712` | two deploys stale |
| the closing "no deploy is owed" | `7405712` | two deploys stale |

This is class 6 (*two implementations of one rule drift*) with a twist that made
it much more expensive: **the stale copy was the INSTRUMENT.** The file did not
merely assert something false — it handed the reader a working command that
produced convincing false evidence, complete with a diffstat. A prose claim
invites doubt; a command's output does not.

`state-handoff.test.js` had a comment in its own header naming this exact
failure ("the deployed sha named a commit two deploys behind... costs a VPN
session to disprove") and had not been given an assertion for it. **A hazard
written down in the guard's comments is not guarded.**

**Fix — remove the retyping, do not retype more carefully.** `npm run
deploy:owed` (`tools/deploy-owed.mjs`) parses the ✅ DEPLOYED line — the sha's
one home — and diffs it against the working tree. The guard then forbids the
*shape*: STATE.md may not contain `git diff <sha>..HEAD` at all, and must
declare exactly one DEPLOYED sha, which must resolve to a real commit.

**A second bug, found by falsifying the first.** `deploy-owed.mjs` v1 used
`git diff <sha>..HEAD`, copied from the snippet it replaced. That compares
**commits**, so with an edited `src/main.css` sitting unstaged it answered
**"NO DEPLOY OWED"** — the instrument could not see the hazard, and an
uncommitted shipping change is the *more* urgent kind, since it is not even
pushed. Omitting `..HEAD` diffs the deployed commit against the working tree;
`git ls-files --others` catches a file never added at all. Only the ritual
found this: reintroduce the bug, watch it fail, restore.

**A third, in the guard's own exemption list.**
`ABSENT_ON_PURPOSE['src/html/tab-golden-period.html']` said *"PLANNED, not
written — DELETE this exemption in the same commit that creates the file."* The
file was created; the exemption stayed. For every day after, the dead-pointer
sweep **skipped a path that existed** — rename or delete that file and both
sweeps stay green while STATE.md points at nothing. Now asserted: no exemption
may survive its file arriving.

**Where it lives now.** `tools/deploy-owed.mjs` · `npm run deploy:owed` ·
three new assertions in `src/js/state-handoff.test.js`.

**The general rule.** *When a fact is retyped into a command, the command is a
copy that rots — and a rotten instrument is worse than a rotten sentence,
because its output looks like evidence.* Delete the copy: have the command READ
the fact from its one home, and let the guard forbid the shape that reintroduces
it. **And an exemption is a claim about the world too** — the ones that say
"not written yet" expire, and a guard whose exemption outlives the absence it
describes fails GREEN.

---

## "The VM can't do mail" — one probe answered a narrower question than the sentence it was written into

**Symptom.** An assessment concluded *do not self-host email*, and the owner
immediately asked the obvious question back: **"isn't there a way to send email
from the VM?"** There is. `smtp.gmail.com:587` answers from that box, completes
STARTTLS, and offers `AUTH`. The conclusion had been generalised past its
evidence.

**Cause.** One probe was run — *can something outside connect IN to the VM?* —
and the answer, correctly *no*, was written up as though it settled **three**
different questions:

| question | direction | truth |
|---|---|---|
| can anything connect **in**? | inbound | **no** — only 443 is mapped |
| can it deliver **direct to MX**? | outbound :25 | **no** — egress blocked |
| can it send via a **relay**? | outbound :587 | **YES**, and never tested |

The probe swept `202.28.95.46` — *the public address*. Nothing about it could
have answered a question about egress, because it was pointed the wrong way. The
write-up then reached a conclusion that needed all three.

The tell was in the evidence and went unread: `curl https://github.com` had
already returned **200 from that box** in the same session. Outbound worked, it
was recorded, and it was not connected to the claim being made.

**A second error inside the correction.** The follow-up probe reported
`smtp-brevo.com:587 blocked`. That host does not exist — Brevo's is
`smtp-relay.brevo.com`, which is **OPEN**. A DNS failure and a filtered port are
different facts and the probe printed them identically, so an invented hostname
became a finding. Resolve the name first and print the IP; a probe that cannot
distinguish "no such host" from "blocked" will manufacture blockers.

**Fix.** Test each direction separately and say which one each result belongs
to. `docs/EMAIL.md` §3 is now a three-row table — send / be a server / receive —
because those were always three answers wearing one sentence. And a TCP connect
is not a service: the relay claim is backed by an actual SMTP session
(`openssl s_client -starttls smtp`) showing the `250-AUTH` line, since a captive
proxy will complete a handshake and nothing else.

**Where it lives now.** `docs/EMAIL.md` §3.

**The general rule.** *A probe answers the question its direction asks, not the
sentence you write around it.* Before generalising a negative result, name the
question it actually tested and check whether the conclusion needs a wider one —
**"X cannot do Y" almost always hides an unstated direction, endpoint or
credential.** Two supporting habits, both paid for here: evidence already
collected in the session (that `github` 200) is evidence against your claim too,
so re-read it; and **resolve a hostname before reporting its port shut**,
because a typo and a firewall look identical from a connect() call.

---

## A dashboard was about to report 83% of a quota that was really at 7% — sentinel strings, and a data import counted as traffic

**Symptom.** A new สถิติ panel was ready to show **25 Apps Script calls in one
minute** against a 30-simultaneous ceiling. The owner asked the only question
that mattered: *"are there really 25 pr upload in 60 seconds?"* There were not.
The real peak is **2**.

**Cause 1 — a sentinel is not a value.** The count used `file_url is not null`
as "has an upload". That column holds four different things:

| value | rows | is it an upload? |
|---|---|---|
| `https://drive.google.com/file/d/…` | 98 | **yes** |
| `null` | 61 | no |
| `ลิงก์เสริม: <url>` — a link the submitter PASTED | 50 | **no** |
| `ไม่มีไฟล์แนบ` — "no attachment" | 9 | **no** |

`null` was handled. The two Thai sentinels were not, so 98 real uploads were
reported as 157. This is the repo's own recurring shape wearing new clothes:
asking whether a field is `null` instead of whether it *resolves*.

**Cause 2 — a timestamp records when a ROW was written, not when work was
done.** The 25 rows landed within **2.86 seconds**, ~65 ms apart. That is the
Sheets→Supabase migration writing straight to Postgres, for files that were
*already in Drive*. **Not one Apps Script call happened.** Nothing in a `count()`
distinguishes a bulk import from a stampede — the shape is identical.

**Fix.** Count only real uploaded files, and drop rows arriving under a second
after the previous one: no human submits two forms 65 ms apart, and that spacing
is the signature of a machine. `excluded_bulk` ships in the payload so the
exclusion is visible — *an exclusion nobody can see is how a number quietly
becomes a lie*.

**How close this came to being expensive.** 83% of a ceiling is a number
somebody acts on. The panel would have argued for serialising uploads,
splitting the Google account, or a migration off Apps Script — real work, to fix
a system sitting at 7%.

**A near-miss in the same session.** A build slip left the corrected migration
containing only comments and one `comment on function` statement.
`apply-migration.mjs` printed **`✓ migration applied`**, because that statement
succeeded. The function was untouched and the old numbers kept coming back.
Every apply is now followed by reading the live body back
(`pg_get_functiondef(oid) like '%<new marker>%'`).

**Where it lives now.** `supabase/migrations/0173_gas_count_real_uploads_not_sentinels_or_imports.sql`
· `src/js/analytics-email.test.js`.

**The general rule.** *A derived metric is a claim about the world, and it must
be checked against the ROWS before anyone is shown it.* Both errors survived
being written, reviewed, and a passing test suite — and neither survived thirty
seconds of `select … limit 26`. Before shipping an aggregate, **print the
records behind its most extreme value and look at them**. Two questions catch
this class: *what else can this column contain?* and *what would a bulk write
look like here?*

---

## Impersonating a user through the Management API works for one statement and silently stops working at the next

**Symptom.** Testing `analytics_overview()` needs a caller with an admin grant —
as the Management-API superuser `auth.uid()` is null, so the RPC correctly
raises. The documented workaround works:

```sql
begin;
select set_config('role','authenticated',true),
       set_config('request.jwt.claims', json_build_object('sub', '<uuid>')::text, true);
select public.analytics_overview(90);   -- ✅ returns data
rollback;
```

The identical pattern with an `update` in place of the `select` **silently does
nothing**. No error, HTTP 200, and the row is unchanged.

**Cause.** The endpoint does not carry the transaction-local settings across
statements the way a psql session does. Verified rather than guessed: a probe
inside the same block returns `role = authenticated`, `is_staff = true`,
`auth.uid()` non-null — *the impersonation genuinely takes effect* — it just
does not survive to the next statement, so the `update` runs back as superuser
and `users_self_update_guard` rejects it.

**What made it hard to see.** The failure has two layers of camouflage. The API
returns only one result set, so a multi-statement block can answer with the
`set_config` row and look like a success; and `public.users` has been SELECT
self-only since 0147, so `returning email` yields nothing even when an update
*does* land. "No rows back" therefore means *either* refused *or* invisible.

**Fix.** For READS of a guarded RPC, the pattern is fine — one statement after
the config, inside one block. For WRITES from a maintenance script, use
`set session_replication_role = 'replica'` (what `dev-refresh.mjs` already does
to load data) and make the script refuse every project except the disposable
one, by ref, before it writes — see `tools/dev-grants.mjs`.

**Where it lives now.** `tools/dev-grants.mjs` (the reasoning sits beside the
line it explains) · `src/js/dev-grants.test.js` asserts the refusal ordering.

**The general rule.** *A session setting is not a session when the transport
re-connects between statements.* Before trusting an impersonated write, read the
row back **as superuser in a separate call** — the write path's own answer
cannot distinguish "refused" from "invisible to me". And treat a multi-statement
block against an HTTP query endpoint as one statement's worth of guarantees.

## `npm run proofs` against dev ran two proofs against PRODUCTION and printed one green summary

**Symptom.** Nobody reported it — it was found while building the CI job that
would have relied on it. The documented way to point the proofs at the dev
database,

```bash
VITE_SUPABASE_URL=$SUPABASE_DEV_URL npm run proofs
```

sent the 17 `.sql` proofs to `samo-dev` and `proj0092-seat-parity.mjs` +
`grant0093-reads.mjs` to **production**, then printed `all 25 proofs green`
over the mixture. Nothing in the output named a project.

**Cause.** 39 tools in `tools/` each hand-rolled the same `.env.local` parse,
and they did not agree. `db-query.mjs` had ALREADY been bitten by this on
2026-08-28 — a migration applied to dev, verified with the tool, reported NOT
APPLIED, because the check read a different database than the write — and it
was fixed there by letting `process.env` win. **Its siblings were not fixed, and
the header recording the lesson sat in the one file that no longer had the
bug.** A fix in one file is not a mechanism.

The second half of the same defect: `.env.local` was read with an unguarded
`readFileSync`, so any environment without that file (a CI runner) got an
unhandled `ENOENT` that reads like a broken tool rather than a missing
credential. Measured: 21 of 23 proofs failed a CI-shaped run that was holding
perfectly valid credentials in its environment.

**Fix.** `tools/env-lib.mjs` — one loader (`.env.local` optional, `process.env`
wins) and one `resolveTarget()` that derives the label by **comparing refs**,
never by trusting which variable a value came from. Adopted by `db-query.mjs`
(which covers every `.sql` proof and the four `.mjs` proofs that shell to it)
and by the two that hand-rolled HTTP.

But the mechanism is not the refactor. **`run-proofs.mjs` now reads each proof's
own `→ project: <ref>` announcement back and FAILS any proof whose answer came
from a database other than the one it was sent to**; a proof that announces
nothing is UNKNOWN, never PASS. That catches a proof nobody has written yet,
which the two-file fix does not. `--dev` additionally refuses to run if
`SUPABASE_DEV_URL` does not resolve to samo-dev, and SKIPS the two non-database
proofs explicitly with the reason printed — a summary that silently shrinks is
its own bug.

**Where it lives now.** `tools/env-lib.mjs`, `tools/run-proofs.mjs`,
`.github/workflows/proofs.yml`, guarded by `src/js/proof-targeting.test.js`.
Both runtime branches were falsified by reintroducing the drift (FAIL: "ran
against fheueuowbchsnsvbcgil, not the samo-dev ref") and by removing the
announcement (UNKNOWN), and the static guard by making a proof parse
`.env.local` again.

⚠️ **The static guard's first version fired on the healthy case** — it required
every `.mjs` proof to reach the database through `env-lib`, including
`repo-protection.mjs` and `notify-exposure.mjs`, which ask GitHub and Cloudflare
and hold no database credential at all. Its subject is now derived from the
runner's own `NON_DB` set.

**The general rule.** *A tool that can be pointed at more than one database must
SAY which one answered, and whatever aggregates those tools must check the
answer came from where it was sent.* Writing the lesson into the header of the
one file you just fixed leaves every sibling holding the bug — and when the
aggregate prints a single verdict, the mixture is invisible by construction.
Corollary paid for here twice over: **before trusting a green suite, ask what it
would look like if half of it had answered from somewhere else.**

## `main`'s CI was red for a day because a guard could not see the commit it was checking

**Symptom.** Every `build` run on `main` had failed since 2026-08-28 with

```
Error: STATE.md says DEPLOYED = e0bd2e2, which is not a commit in this repo.
```

and then, a day later, the same sentence with `f9584e5`. Both shas were
perfectly correct and present. Nobody noticed, because a check that is always
red is indistinguishable from a check.

**Cause.** `actions/checkout@v4` fetches **depth 1**. `state-handoff.test.js`
verifies STATE.md's deployed sha with `git cat-file -e <sha>^{commit}`, and in a
shallow clone every commit but the tip is simply absent — so git answers exactly
what it answers for a MISTYPED sha. The guard already handled "no git at all"
(a tarball, a sandbox) and returned inconclusive; it had no idea that a git
which *is* present can still be unable to see a valid object.

**Why it mattered more than a red X.** `build` is a REQUIRED status check on
`main` (phase 0's highest-value guardrail, enabled 2026-08-27). A permanently
false red there blocks **every contributor PR** — the guardrail built to protect
the branch was quietly closing it.

**Fix.** Both halves, because either alone is a half-fix: `build.yml` checks out
with `fetch-depth: 0`, so the guard is REAL in CI rather than merely quiet; and
the test now asks `git rev-parse --is-shallow-repository` before failing, so
"I cannot see that object" is never reported as "that object does not exist".
Falsified both ways — a bogus sha in a full clone still fails, and the correct
sha in a real `--depth 1` clone passes.

**Where it lives now.** `.github/workflows/build.yml`,
`src/js/state-handoff.test.js`.

**The general rule.** *A guard's instrument needs a guard too, and the question
"did it answer NO, or could it not see?" is the one that separates them.* This
repo already had that rule for `which` not finding `pg_dump` (a `PATH` answer
read as a disk answer); it recurred verbatim in git. **And check the CI
dashboard**: a guard nobody looks at fails silently no matter how loudly it
prints, and this one had been shouting for a day into a tab nobody opened.

## A CI gate whose red depended on jsDelivr, and two tests that passed over deleted code

**Symptom.** None yet — all three were found by a scrutiny pass on the day they
were written, before anyone was misled. They are recorded because each is a
recurrence of a rule this repo already had.

**1. The browser smoke could go red on a CDN blip.** `smoke-browser.mjs` failed
on ANY failed Script/Stylesheet fetch, and the page loads from
`cdn.jsdelivr.net`, `cdn.quilljs.com` and `fonts.googleapis.com`. A slow route
from a GitHub runner would have turned the check red for a reason unrelated to
the change — *a warning that fires on the healthy case*, reproduced inside the
instrument built to enforce that very rule. Now only **our own origin** fails
the run; a third-party failure prints a note.

⚠️ **This is safe only because a real outage is still caught, by a DIFFERENT
check.** Blocking jsDelivr was measured: the page breaks badly (Bootstrap is a
classic CDN script, so the module graph throws and no handler binds) and the
BOOT checks fail. **Measure the outcome, not the cause** — the network
assertion added little and carried all the false-positive risk.

**2. The same file's watchdog diagnostic named the wrong culprit.** It printed
"the watchdog fired on a page that booted — it is crying wolf again" over a page
that had NOT booted, where the watchdog was right. The check is now skipped, and
says so, when the page did not boot.

**3. Two guards passed while the code they guard was deleted.** Both were
vacuity, both in tests written that same hour:
· one asserted an identifier appeared in `auth.js` — and it still appeared, **in
a comment**. Fixed with `stripComments()`, which four other tests already use.
· one asserted branch ORDER with `indexOf(a) < indexOf(b)` — and when `a` was
deleted, `indexOf` returned **−1, which is less than everything**. Fixed by
requiring both to exist first.

**4. The proof-target check read only the FIRST announcement.** A proof querying
dev and then production would have passed on its opening line. Now every
announcement must match; falsified by making a proof emit a second one.

**Where it lives now.** `tools/smoke-browser.mjs`, `tools/run-proofs.mjs`,
`src/js/google-provider-guard.test.js`, `src/js/proof-targeting.test.js`.

**The general rule.** *A guard written in the same hour as the code it guards
has not been tested against anything but the author's intent — delete the code
and watch it go red, and treat every `indexOf`, substring or identifier match as
vacuous until you have seen it fail.* And when a check can be red for a reason
outside the change, prefer the check that measures the OUTCOME: the boot probe
catches a CDN outage without ever asserting on the network.

## `npm run deploy:owed` said "production is serving current code" while /docs was a whole rebuild behind

**Symptom.** Right after the docs site was restructured and pushed,
`npm run deploy:owed` printed **✅ NO DEPLOY OWED — production is serving
current code.** It was wrong: `samo.md.kku.ac.th/docs/start/install` answered
404 on the VM while `main` had contained that page for an hour.

**Cause.** `SHIPPED` in `tools/deploy-owed.mjs` was `['src/',
':!src/**/*.test.js', 'index.html', 'admin/index.html']`. That was a complete
list on the day it was written — a deploy only published two bundles. Earlier
the SAME DAY, `server/deploy.sh` learned to build the docs with
`DOCS_BASE=/docs/` and publish them to `/var/www/docs`, and nobody widened the
list. The one instrument that answers *is production current* had gone blind to
half of what production serves, and it answered GREEN, which is the direction
that gets believed and acted on.

**Fix.** `docs/` (minus `docs/state/**` and `docs/state-archive/**`, which are
notes rather than published artifacts and would make it cry wolf on every
handoff), plus `server/nginx-samo.conf` and `server/deploy.sh` — a config change
also needs a trip to the VM. The reason is written beside the list.

**Where it lives now.** `tools/deploy-owed.mjs`, in the comment above `SHIPPED`.

**The general rule.** **When the deploy learns to publish something new, add it
to the deploy checker in the SAME COMMIT.** An instrument's subject list is
correct only for the system it was written against, and nothing tells you when
the system grows past it — the checker keeps answering confidently about the
part it still knows. This is the sibling of "a guard cannot see the hazard"
(§write-a-guard trap #1): here the guard could see fine, it had simply never
been told the building had another floor.

## Dead-link checking on the docs site had been off since the day it was built

**Symptom.** None — found while sweeping for damage after a large restructure,
before anyone was misled. The docs site built green through a change that moved
or deleted every contributor-facing page.

**Cause.** `ignoreDeadLinks` in the VitePress config carried
`/^\/(?!samomdkkuweb)/`, intended to mean "ignore absolute links that are not
part of this site". It does the opposite of what its author believed. **In
markdown you write a site link WITHOUT the base** — `/contributing`,
`/start/install` — and VitePress prepends `base` at build time. So no link in
any source file ever begins with `/samomdkkuweb`, the negative lookahead matched
every one of them, and the whole site's internal links were exempt. A
restructure could have shipped with completely broken navigation and a passing
build.

**Fix.** The pattern is deleted. Verified in both directions: the build still
passes with it gone (so there were no actual dead links), and a deliberately
inserted `[x](/no-such-page-xyz)` is now reported and fails the build.

**Where it lives now.** `docs/.vitepress/config.mjs`, with a ⛔ note so it is not
reintroduced by someone reasoning about it the same way.

**The general rule.** **An ignore-pattern is a guard running in reverse, and it
is never tested.** A wrong assertion goes red; a wrong exemption goes quiet, and
its blast radius is everything it silently covers. When you write one, prove it
with a control — insert the thing it should still catch and watch the build
fail. And be specific about which STRING the pattern sees: a build tool rewrites
paths, so the value in the source file is often not the value you are picturing.

---

## `git push` to main refused with GH013 right after the org transfer, while the protection proof was all green

**Symptom.** `samomdkkuweb` was transferred to the `samomdkku` organisation.
The first push of the follow-up commit was rejected:

```
remote: error: GH013: Repository rule violations found for refs/heads/main.
remote: - Required status check "build" is expected.
remote: - Changes must be made through a pull request.
```

`node tools/repo-protection.mjs` reported **six of six checks passing**,
including `enforce_admins stays OFF` — the very check whose stated purpose is
"it is what lets the owner push main". The proof and the remote disagreed, and
the proof was the one being trusted.

**Cause — there are TWO enforcement paths, and the proof read one.**
GitHub enforces branch rules through the classic
`repos/{r}/branches/main/protection` API *and*, independently, through
**rulesets** (`repos/{r}/rulesets`). This repo has carried an active ruleset
named `main-protect` since 2026-05-23. `repo-protection.mjs` never mentioned
rulesets, so for three months its six green checks described **half the gate**,
and nothing said so.

The transfer then emptied that ruleset's `bypass_actors`. Read back from the
ruleset's own version history — GitHub keeps one, which is what turned a theory
into a fact — the pre-transfer version held four:

```
RepositoryRole 5 (admin)  bypass_mode always   ← the owner's direct push
Integration 85455 / 946600 / 1143301           ← three GitHub Apps
```

and the post-transfer version held `[]`. Nothing reported this. The classic
`enforce_admins` flag was genuinely untouched, so the check watching it stayed
truthfully green while the capability it exists to protect was gone.

**Fix.** `RepositoryRole 5` restored with `bypass_mode: always`; the push then
succeeded (GitHub still prints the bypassed rule as a `remote:` line — that is
a log of the bypass, not a rejection, and it is easy to misread as failure).
The three `Integration` bypasses were deliberately **not** restored: they cannot
be resolved to a named app through any public endpoint, and
`gh api orgs/samomdkku/installations` returns `total_count: 0`, so they would
grant nothing to nobody. Re-granting an unidentifiable app the right to bypass
`main` is not a thing to do to make a red line go green.

`repo-protection.mjs` now reads both paths, and asserts the bypass **by
property** — "an admin can still push" — rather than re-listing whatever is
configured today. It also asserts a ruleset governs `main` *before* asserting
anything about its bypasses, so deleting the ruleset fails loudly instead of
passing over an empty list.

Proved by the ritual: bypass stripped → `✗ admin can still push main (ruleset
bypass): expected true, got false` → restored → green.

**Where it lives now.** `tools/repo-protection.mjs`, with the cost written
above the code. `skills/move-the-repo-to-an-organisation.md` §5d.

**The general rule.** **Ask whether the thing you are reading is the thing that
DECIDES.** A proof named after a capability ("protection") but bound to one
API is a proof about that API, and it will keep answering confidently after the
platform grows a second mechanism beside it. This is the class-7 failure in its
most convincing form: not a broken assertion, but six true ones that together
imply something false. When a proof and the real system disagree, the proof is
the suspect — and when a platform offers two ways to configure one behaviour,
a guard that reads one of them is guarding nothing.

Corollary, for any transfer or migration: **capability is not configuration.**
The classic flag survived and the capability did not. Test what you can still
DO, not what the settings still SAY.

---

## `deploy:owed` went blind to a page production serves — again, one directory deeper

**Symptom.** `npm run deploy:owed` printed **"no deploy owed"** while
`samo.md.kku.ac.th/docs/state/phuriphatma` was serving a page several commits
stale. The tool exists *specifically* to answer "is production current", and it
answered wrong in the direction nobody investigates: green.

**Cause.** Two spellings of "what production serves", drifted.

| | says what ships |
|---|---|
| `docs/.vitepress/config.mjs` | `collect()` globs **every** `.md` under `docs/`; `srcExclude` names only node_modules, templates, package, demos |
| `tools/deploy-owed.mjs` | `SHIPPED` carried `':!docs/state/**'`, `':!docs/state-archive/**'` |

The exclusion was reasonable-sounding — a person's session notes are not
"shipping" in any sense the author cared about — and simply untrue: VitePress
globs them, the sidebar links them, nginx serves them. Verified with curl, not
by reading either file.

**This is the SECOND time in two days.** On 2026-08-31 the same tool watched
only `src/` and answered "production is current" while `/docs` was an entire
restructure behind. That fix added `docs/` and wrote a header saying *"WHEN THE
DEPLOY LEARNS TO PUBLISH SOMETHING NEW, ADD IT HERE IN THE SAME COMMIT"* — a
paragraph, in the file, which did not stop the same class recurring inside the
directory it had just added.

**Fix.** The exclusions are gone. And because a header saying "keep these in
step" demonstrably does not keep anything in step,
`src/js/docs-shipping-parity.test.js` now asserts the PROPERTY at `npm test`
time: **every page VitePress actually publishes is a page `deploy-owed` can see
change.** It calls `collect()` — the real publisher — rather than re-reading the
config's exclusion list, so it cannot be satisfied by two lists that are wrong
in the same way. Two controls guard it: `docs/` must be watched at all, and
`collect()` must return a non-empty set. Reintroduced the exclusion, watched it
name `state/phuriphatma.md`, restored.

If those notes should not be public, the fix is `srcExclude` — and *then* they
may leave `SHIPPED`. Either arrangement passes; disagreement does not.

**A second, smaller trap from the same hour.** Verifying the by-hand docs
publish, `grep -c prof_can_see_document` on the served page returned 1 and I
read that as "the new section shipped". It had not: the phrase occurs in an
OLDER section of the same page. The control (`Two wrong turns`) was also 1, so
both halves agreed — on the wrong answer. **A verification string must be unique
to the change, not merely present in it**; re-grepping for `The sweep
afterwards` returned 0 and told the truth.

**The general rule.** *When a deploy learns to publish a new path, the tool that
reports staleness must learn it in the same commit — and the only durable way to
make that happen is a test that asks the PUBLISHER what it publishes.* Any
instrument whose subject is a hand-maintained list of paths will go blind the
first time somebody adds a path; derive the list from the thing that actually
does the work.

## A proof that was GREEN by hand and RED under its own runner

**Symptom.** `tools/dept0179-kinds.sql` passed 10/10 when run directly through
`node tools/db-query.mjs`. Registered in `run-proofs.mjs` and run by
`npm run proofs`, the same file against the same database reported:

```
dept0179-kinds.sql   ✗ FAIL   FAIL in blob
```

**Cause — the runner reads the LAST result set, and mine was a summary.**
`run-proofs.mjs` looks for a per-case verdict column. My script ended with

```sql
select count(*) filter (where expected = got) as passed, ...
```

which has no verdict column, so the runner fell through to its blob branch:
`if (/FAIL|DENIED_UNEXPECTED/i.test(text)) return FAIL`. That branch scans the
raw output text — and found the word `FAIL` **inside the file's own CASE
expression**, `case when expected = got then 'PASS' else '*** FAIL ***' end`.

So the proof was failed by a string it printed while describing how it would
report a failure. Nothing was wrong with the assertions or the database.

**Fix.** Shaped like `dept0177-page-scope.sql`, which was already correct: one
row per case, a `result` column, and **nothing after it**.

```sql
select case_name as step,
       case when expected = got then 'PASS' else 'FAIL' end as result,
       expected, got
  from probe order by case_name;
```

**Where it lives now.** `tools/dept0179-kinds.sql`, with the reason in a comment
above the final select so the next person does not "improve" it by appending a
summary again.

**The general rule.** *A proof is only as good as the runner's ability to READ
it, and the runner's contract is a shape, not a sentence.* Two things generalise
beyond SQL. First, **a trailing summary row hides the cases** — anything that
aggregates after the per-case output moves the answer out of the shape the
harness parses. Second, and worse, **a fallback that scans raw text for a word
will find that word in the code that produces it**; a heuristic branch cannot
distinguish a verdict from a string literal describing verdicts. If you write
such a fallback, it must be the last resort and it must say so loudly — which
this one does, and the fix is on the proof's side, not the runner's.

⚠️ **The tell is the one that matters: green by hand, red under the runner, same
subject.** That difference is never the database. It is the instrument.

## A check whose own audience could not run it

**Symptom.** `docs/start/install.md` told a brand-new contributor to verify their
setup with:

```bash
npm run dev:check
```

Run by the person it was written for, that exits 1 with

```
✗ PRODUCTION: URL or anon key missing from .env.local
```

having proved nothing about the four keys they had just pasted.

**Cause.** `tools/dev-check.mjs:51` reads `VITE_SUPABASE_URL` and
`VITE_SUPABASE_ANON_KEY` — it is a PARITY guard, comparing `samo-dev` against
**production**, and needs both sides by design. A contributor has neither
production value and must never be sent them (`.claude/rules/security.md`).

The command was correct. The audience was wrong, and nothing in either the
script or the guide connected the two.

**Why this is worse than a missing check.** A verification step that fails on a
CORRECT setup blames the reader for the guide's mistake, at the exact moment
they have no way to tell which of the two is at fault. A newcomer's first
five minutes is the worst possible place to spend that confusion.

**Fix.** A second, contributor-facing command — `npm run env:check`
(`tools/env-check.mjs`) — which asks only what its reader can answer: the file
exists, the four `SUPABASE_DEV_*` names are present, none is still the
placeholder from `.env.local.example`, no value got wrapped in quotes, and the
dev database answers. Each failure says what to do about it.

⛔ **The two were deliberately NOT merged.** Teaching `dev:check` to skip the
production half when credentials are absent would make it pass in the one case
it exists to catch — a guard that fails GREEN. `env-example.test.js` pins both
directions: `env-check` reads no production name, `dev-check` still reads two.

**Where it lives now.** `tools/env-check.mjs`, `docs/start/install.md` §4d (with
a warning naming the other command), `README.md`'s script table, and
`src/js/env-example.test.js`.

**The general rule.** *Before telling someone to run a command, check it works
with the credentials THEY have.* A tool's requirements are part of its contract
and are invisible in its name; `dev:check` sounds like it checks your dev setup.
The wider shape: **a diagnostic must be runnable by the person the diagnosis is
for**, or it converts a solvable problem into a mysterious one.

## A guard that asserted the implementation, and went red on a refactor

**Symptom.** `dept-content.test.js` failed with
*"a row created from หน้าฝ่าย is public the moment it is added"* — a real and
serious-sounding message — while the property it names was perfectly intact.

**Cause.** The assertion counted string literals:

```js
const kinds = insert.match(/visible:\s*false/g) || [];
expect(kinds.length).toBe(2);   // one per kind
```

It was written when `addRow` had two branches, one per kind. 0179 added two more
kinds and folded all four seeds into one insert with a single `visible: false`,
so the count went to 1. Nothing regressed; the guard was pinned to the SHAPE of
the code rather than to what the code must be true of.

**Fix.** Assert the property, plus the one way it could be undone:

```js
expect(insert).toMatch(/visible:\s*false/);
// a seed spread AFTER visible:false could override it back
expect(insert).toMatch(/visible:\s*false,\s*\.\.\.seed/);
```

**Where it lives now.** `src/js/dept-content.test.js`, "every row addRow creates
is a draft, whatever the kind".

**The general rule.** *A guard written against today's shape fails on a
refactor and says nothing about a real regression* — and it costs more than the
false alarm, because the fastest way to make it green again is to change the
number, which is how a guard quietly stops meaning anything. Ask what must be
TRUE, not how many times it is currently written down. Related and already here:
never write a guard from the same list the code came from.

## The browser smoke covered the smaller entry, and nobody noticed for months

**Symptom.** None — that is the point. Found on 2026-09-02 by asking a question
nothing in the repo asks: *after adding a static import to `dept-page-admin.js`,
did anyone actually LOAD the admin page?* The answer was no, and there was no
way to have done it, because `tools/smoke-browser.mjs` only ever loaded `/`.

**The asymmetry.** This app has two entries. The public one is 226 KB. The admin
one is **537 KB — most of the code in the project** — and it had zero browser
coverage. Everything that looked like coverage stops short of the thing that
breaks:

| What it proves | What it cannot see |
|---|---|
| `npm test` (jsdom, no bundle) | a module-level throw in a built entry |
| `npm run build` | that it COMPILES, not that it RUNS |
| `curl \| grep <string>` | a string is present in a file that never executed |

So a `dept-visual-editor.js` with a top-level error would have passed 1,712
tests, a clean build, a served-artefact grep and a 13/13 smoke — and left every
admin page dead. This repo has already shipped that exact failure once: the
entry module never ran, Bootstrap's CDN kept every menu opening, and ~90 inline
`onclick="global()"` handlers were silently gone.

**Fix.** Three checks appended to `smoke-browser.mjs`: the admin entry's
`__samoBooted`, that the sign-in gate rendered, and no horizontal overflow.
Deliberately run **signed out** — the entry module must parse and run before the
gate can paint, so a boot failure is visible with no credential, which keeps the
smoke safe for CI on a public repo. `.github/workflows/smoke.yml` already runs
this file on every preview, so the new checks came with a trigger attached.

Falsified before being kept: asking for a flag that is never set turns it red
with the right message (15 passed, 1 failed); restored, 16/16.

**Where it lives now.** `tools/smoke-browser.mjs`, the block after the tool-frame
checks.

**The general rule.** *Coverage is a claim about a SURFACE, and a suite that
grew up around one entry point will quietly exclude the other.* Count the
entries — bundles, binaries, routes, workers — and ask which ones your smoke
actually visits. The tell here was that the number nobody could answer was not
"is it broken" but "has anyone looked", and the honest answer to the second is
what surfaced the first.

---

## "Unset is SAFE" — a guard that would have called a preview pointed at production a PASS

**Symptom.** None. `node tools/repo-protection.mjs` printed all green, and had
been printing all green, while carrying an assumption that was false of one of
the three projects it checks. Found by reading the sibling app's source for an
unrelated reason.

**Cause.** The Cloudflare check judged each project's database with:

```js
// Unset is SAFE — a build with no Supabase URL reaches no database.
const url = vars.VITE_SUPABASE_URL?.value;
… !url || url === devUrl …
```

That comment is **true of the app it was written against and false of the one
beside it**. samoweb's `src/js/db.js` reads `import.meta.env.VITE_SUPABASE_URL`
with no fallback, so unset really does reach nothing. samomdkkupassport's
`js/app.js` reads

```js
import.meta.env?.VITE_SUPABASE_URL || "https://fheueuowbchsnsvbcgil.supabase.co"
```

— the **production** project, hardcoded, with the production anon key on the
next line. So for that project *unset means production*. Delete the variable in
the dashboard and the preview talks to real student data, while the guard whose
entire purpose is catching that reports **PASS**. The repo has already had the
live incident this describes (`refactorsamomdkkuweb` holding the production URL
with `VITE_ENV_NAME` unset); this is the same incident with the alarm disabled.

The fallback is not itself a mistake — its comment explains it exists so a
missing build env cannot send passport to the RETIRED project B and split-brain
the data. The mistake is a guard in repo A reasoning about what a missing value
means in repo B.

**Fix.** Do not special-case the sibling. Require the variable to be **SET and
equal to the dev URL** for every project: true of all three today, needs no
knowledge of any app's fallback, and a deleted variable now goes RED. The
message distinguishes unset from wrongly-set, because those have different
remedies.

**Where it lives now.** `tools/repo-protection.mjs`, Cloudflare section — the
old comment is kept inverted, as the reason.

**The general rule — class 7, "guards fail GREEN", with the tell.** *A guard
that reasons about what a MISSING value falls back to is asserting a fact about
code it cannot see.* The fallback lives in another repository, another language
or another team's file, and it can change without the guard noticing. Assert the
POSITIVE state you require — set, and set to this — rather than enumerating the
states you believe are harmless. **Whenever a guard's comment says a condition
is "safe" or "neutral", find the code that makes it so and check it is the only
code that can.** Here there were two readers of one variable and only one had
been read.

---

## A proof that was written, run by hand, committed — and never ran in the suite

**Symptom.** None, which is the point. `npm run proofs` printed **"all 30 proofs
green"** immediately after a 31st proof was added, run against samo-dev AND
production by hand, and committed. The number that is supposed to be the
evidence was the thing concealing the gap: 30 was also the answer yesterday.

**Cause.** `PROOFS` in `tools/run-proofs.mjs` is a hardcoded list. Adding the
file is not adding the line, and nothing connected the two. Same class as the
mistakes index found the same day — a guard whose SUBJECT is a hardcoded name
(class 7) — landing this time on the tool whose whole job is telling you which
guards still hold.

**Fix.** The directory is the authority for what exists. An unlisted
`tools/*.sql` and a listed-but-absent one both exit 1 naming the file.

⚠️ **`.sql` ONLY, and the first version got this wrong.** `PROOFS` also holds
`.mjs` proofs, while `tools/` is full of `.mjs` that are NOT proofs
(`apply-migration`, `db-query`, …). Comparing every listed entry against the
`.sql` listing declared all eight `.mjs` proofs missing. A directory can only be
the authority for an extension where **every** file is a proof.

**Then it failed for a second, unrelated reason.** Once it ran, the new proof
reported `FAIL — 6 failed` while every row it emitted said `"verdict":"ok"`.
`judge()` counts a case as passing only if the verdict **starts with `PASS`**.
Before that it had emitted `RAISE NOTICE`, which the Management API does not
return at all — `[]`, every case executed and none readable.

So one proof failed three ways in a row while being correct: **invisible to the
runner, unreadable by the runner, then misread by the runner.** The SQL was
right every time.

**Where it lives now.** `tools/run-proofs.mjs` (the directory check),
`tools/passport0180-season-gate.sql` (rows, and `PASS`/`FAIL` verdicts).

**The general rule.** *A new guard is not wired in until you have watched the
runner report it.* Run the suite and find your proof's name in the output —
"the suite is green" is not evidence when your proof may not be in the suite.
And when a proof is green by hand and red under the runner on the same database,
stop looking at the SQL: the difference is never the subject, it is the
instrument.

---

## `pass-hardening` reported 9 failures and the database was innocent every time

**Symptom.** `tools/pass-hardening.mjs` printed **45 passed, 9 failed** against
production. The failures read like a live passport breach — a student could
update their own `total_km`, edit another student's row, delete someone else's
scans, call `admin_leaderboard()`, and read the whole roster:

```
FAIL cannot set own total_km          -> rows=1
FAIL cannot touch another student     -> rows=1
FAIL admin_leaderboard refused        -> ALLOWED
FAIL reads only own profile           -> 637
```

**The first diagnosis was wrong, and it was written into the handoff.** It said
the failures were an artefact: the Management API connects as the Postgres
superuser, which bypasses RLS, so every "cannot" is *expected* to be allowed.
Plausible, never tested, and it wrote off nine failures for weeks.

Two measurements killed it. A control through the same API showed impersonation
works perfectly — `set_config('role','authenticated')` plus JWT claims moves
`current_user` to `authenticated`, drops `rolbypassrls` to false, resolves
`auth.uid()`, and cuts a `passport.profiles` read from **637 rows to 1**. And
the script's own output already disproved it: the **anon block passed 15/15**,
including `reads 0 profiles`. A global RLS bypass cannot spare anon and hit only
the student.

**Cause.** The probe's "student" was an **admin**. The selection reads:

```sql
-- students: real kkumail auth accounts that are not admins ...
select u.id into v_student from auth.users u
 where lower(u.email) like '%@kkumail.com'
   and u.id is distinct from v_admin_full and u.id is distinct from v_admin_scoped
 order by u.created_at limit 1;
```

The comment says *not admins*; the SQL excludes only the two admins it had
already picked for the admin tests, then takes the **oldest** kkumail account —
which is a founder. It selected an account whose `permissions` column is
**empty** while `managed_permissions` holds `master`, so `passport.is_admin()`
returned true and the "student" satisfied `profiles_read_self_or_admin` and
`profiles_update_admin`. All six student failures, plus an admin one and a
cascading `total_km` delta, fall out of that single wrong subject.

**Fix.** Ask the gate, never a column. The loop impersonates each candidate and
keeps the first two for which `passport.is_admin()` is false, raising if it
cannot find two. Result: **54 passed, 0 failed** on the same database, same
minute. The ninth failure was separate and also stale — it asserted the shared
`passportadmin@samomdkku.app` account *exists*, but the 17 shared-password
admins were deleted on purpose on 2026-08-17/18, so a finished security cleanup
scored as a broken proof. Inverted: absence passes, and a re-provisioned
shared-password admin now fails loudly.

It then joined `npm run proofs`, which took two more fixes it had been dodging
for its whole life: it parsed `.env.local` itself (so it ignored `--dev`
targeting — `proof-targeting.test.js` fails the build on exactly this) and it
never announced its target, so the runner scored it **UNKNOWN**. Both now come
from `env-lib.mjs` like every other proof.

**Where it lives now.** `tools/pass-hardening.mjs` (the `is_admin()` loop and the
inverted shared-account check), listed in `PROOFS` in `tools/run-proofs.mjs`.

**The general rule.** *A deny-check is only as good as the identity it denies.*
Before believing a DENY failure, ask what the probe's subject actually holds —
derived from the gate's own predicate, not from the column you expect. Here
`permissions` was empty and `managed_permissions` held `master`; a subject check
reading `permissions` alone would have agreed the account was an ordinary
student. And **an explanation that dismisses a failure needs the same proof as
one that reports it** — "it's just an artefact" was accepted for weeks while the
script's own anon block sat three lines above, contradicting it.

---

## The install guide explained a permission failure that a public repo cannot have

**Symptom** (reported by the owner, reading the guide as a newcomer would):
*"is this can occur?? isn't it public repo — If it says `Repository not found`
or `permission denied`"*.

`docs/start/install.md` step 2 carried a prominent warning box:

> **If it says `Repository not found` or `permission denied`** — that means you
> have not been invited to the project yet.

**Cause.** `samomdkku/samomdkkuweb` is **public** (`gh repo view --json
visibility` → `PUBLIC`), so `gh repo clone` succeeds for anyone with a GitHub
account and there is no invitation to lack. The sentence was never measured; it
was written by analogy with private repositories, in the voice of a finding.

Two costs, and the second is the expensive one:

1. It **misdiagnoses**. The failures that actually happen there are a typo in
   the slug and `gh` not being signed in — neither of which the box mentions, so
   the reader stops looking at the two things it really is.
2. It sends the reader down the **fork** road, which is real and correct but
   loses the automatic preview site, to solve a problem they do not have. The
   guide's own [Prerequisites §4](../start/prerequisites.md) already said nobody
   has to be invited. **Two homes, one corrected** — class 6.

Permission does bite in this flow; it bites one step later, at `git push` into
the repository, which is where the fork advice belongs.

**Fix.** The box now states the repository is public, names the two failures
that do occur, and moves the fork route to the sentence about sending a change
back, linking to the side-by-side table rather than restating it.

**Where it lives now.** `docs/start/install.md` step 2.

**The general rule.** *Prose about an ACCESS failure must name the access it
tested.* "Permission denied means you were not invited" reads as a finding and
is really an assumption about a repository's visibility — a fact one command
answers. This is the "`X cannot do Y` hides an unstated direction, endpoint or
credential" trap in `.claude/rules/mistakes.md` class 7, wearing documentation's
clothes: the reader cannot tell an explanation from a measurement, so they
believe it and stop measuring. And a guide that explains a failure the system
cannot produce is worse than one that says nothing, because it hands the reader
a confident wrong answer at the exact moment they are least able to judge it.

---

## The setup guide's four keys: two the app never read, two nobody should have had

**Symptom.** Reported as a plain question — *"so how should i send them the
credentials of .env.local"* — while asking whether SOPS was the right tool.
Tracing what those credentials actually did answered a different question.

**Cause, part 1 — the app never read them.** `docs/start/install.md` had a
contributor fill in `SUPABASE_DEV_URL` / `SUPABASE_DEV_ANON_KEY`.
`src/js/db.js` reads `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`. **Nothing
mapped one to the other** — not `vite.config.js`, not `tools/dev-all.mjs`.
Measured by building the file the guide produces and asking Vite's own loader:

```
loadEnv('development', dir, 'VITE_')   ->   {}
```

So the traced sequence was: paste the values → `npm run env:check` prints
**"✓ You are set up"** → `npm run dev` starts an app with no database. Identical
to §4e's *failure* state. Worse on the passport half: `passport/js/app.js` falls
back to a **hardcoded production URL and anon key** when the variable is unset,
so a volunteer following the guide was reading the real student database.

**Why nobody saw it for weeks.** A maintainer's own `.env.local` carries
`VITE_*` pointing at **production**, so `npm run dev` worked on the only machine
it was ever run on — by talking to the live site. Both halves of that are wrong,
and the working case hid the broken one.

**Cause, part 2 — the guard could not see it.** `env-example.test.js` asserted
that the example declares four names and that the docs name the same four: a
list against a list, both derived from the same decision. The hazard lived in
the GAP between the example and the app, which no list comparison can reach.

**Cause, part 3 — the four were not four of a kind.** Two are the pair the built
website already publishes (an address and a visitor key RLS gates). The other
two are `SUPABASE_DEV_ACCESS_TOKEN`, which can delete the project, and
`SUPABASE_DEV_DB_URL`, a direct login that ignores every permission rule over an
UNMASKED copy of real student records. Every consumer of those two is migration
tooling; a contributor editing `src/` needs neither. They were handed to
everyone because they arrived in the same block and the guard asserted all four.

**Fix.** `tools/dev-env.mjs` maps the dev pair into what the app reads, prints
which database it chose, and sets `VITE_ENV_NAME` so the existing ribbon paints.
Both vite configs call it **only on `command === 'serve'`** — a production build
must never be repointed, and that gate is asserted. `.env.local.example` now
ships the powerful pair commented out; `env-check.mjs` REQUIRES two and merely
reports the other two, so a correctly-provisioned contributor gets a green
check instead of being told their setup is broken.

**Where it lives now.** `tools/dev-env.mjs`, `vite.config.js`,
`passport/vite.config.js`, `tools/env-check.mjs` (`REQUIRED` / `OPTIONAL`), and
`src/js/dev-env.test.js` — which asserts the PROPERTY: feed in the file the
guide tells a person to create, and a real database must come out. Both bugs
were reintroduced and each failed on its own assertion before restoring.

**A third fix, from the owner, the same day.** Told about the split, they went
straight past it: *"i think making the contributor cp .env.example, input each
key manually is bug prone, i thought of handling the file, or someway automate"*.
Right, and it makes the first two fixes cheap to hold: `npm run setup`
(`tools/setup-env.mjs`) takes the message a maintainer sent, pasted whole —
greeting, code fence, `export`, quotes, CRLF, and a key a chat client wrapped
onto two lines — and writes the file. **The transcription step is gone, so the
three failures the guide used to list cannot happen.** It MERGES rather than
overwrites (a maintainer's `.env.local` holds production credentials and the VM
sudo password), backs the file up first, never prints a value, and REFUSES a
paste containing a production name.

⚠️ **And its own first bug was in the half the unit tests could not see.** Nine
`parsePaste` cases were green while the real command was broken: the READ loop
ended the paste at the first blank line after any non-empty line, and people
send a covering note — so "hey, here you go" + blank closed input before one
credential arrived, and it then told the reader they had pasted nothing. Found
by piping a realistic message through the actual command, not by reading it.
`opensAssignment` is now the terminating condition and is asserted directly.

**A fourth fix, from the owner pressing the same point further.** *"incase in
the future there's more key, or key is changed, it would be tiresome to manually
copy paste each key"* — the toil is not the typing, it is that **nothing told
anyone**. A variable added to the project reached a contributor's machine only
when something broke in a way that did not mention it.

`REQUIRED` and `OPTIONAL` were two hand-written arrays beside the file they
described — class 6, and the reason a new variable was invisible. They are now
DERIVED from `.env.local.example` (`tools/env-manifest.mjs`): an active `NAME=`
line is required, a commented `# NAME=` line is database-work only. One edit to
that file and `env:check` starts asking, `setup` starts accepting, `env:share`
starts offering, and every contributor's next `npm run dev` names it and says
what to ask for — silent when nothing is wrong. Proved by adding a variable to
the example and watching all four react with no code change.

`npm run env:share` closes the sending side: the maintainer stops hand-picking
lines out of a file that also holds `SUPABASE_DB_URL` and
`SAMO_VM_SUDO_PASSWORD`. It cannot emit a name the example does not offer a
contributor, and refuses to run into a pipe without `--force`.

⚠️ **And that refactor broke the whole suite in a way that named no cause.**
Importing `env-check.mjs` from `vite.config.js` put its `#!/usr/bin/env node`
mid-bundle — Vite bundles its config — and esbuild answered
`tools/env-check.mjs:1:396: ERROR: Syntax error "!"` for a file whose line 1 is
19 characters. Fixed by moving the shared part into a shebang-free
`env-manifest.mjs`; `dev-env.test.js` now walks the config's import graph and
fails with a sentence instead.

**A fifth fix — the owner asking the question that invalidated my answer.**
*"but then i have to be access to my computer to can do it"* and *"i would have
to send it many times for each person isn't it"*. Both true. `env:share`
automated the maintainer's TYPING and left them as the DELIVERY MECHANISM —
once per person, for ever, laptop required. `npm run env:pull` removes them:
values live in one vault item, each contributor fetches their own.

⛔ **AND I HAD TOLD THEM THAT WAS IMPOSSIBLE, from a search result rather than a
test.** I wrote in HANDOFF that the Bitwarden CLI "expects a bare HTTPS root" so
our `/vault/` subpath ruled it out. One command disproved it:

```
bw config server https://samo.md.kku.ac.th/vault   → Saved setting `config`.
bw login <nonexistent user>                        → "Username or password is
                                                      incorrect"  (it REACHED
                                                      the identity endpoint; a
                                                      wrong URL gives a
                                                      CONNECTION error)
```

The vault had been publishing the answer at `/vault/api/config` the whole time.
**A search result about a tool is not a measurement of that tool against YOUR
deployment**, and writing it into the handoff as a constraint would have closed
off the right design for however long the note survived.

⚠️ **A REAL BUG, found only because a test for the new tool exercised the old
one.** `parsePaste` continued a wrapped value onto any line without whitespace —
so the `─────────────` rules that `env:share` prints around its block got glued
onto the end of the anon key. **Pasting exactly what you were shown** produced a
key wrong by thirteen invisible characters, surfacing later as "the database
refused the key (401)". Fixed by requiring a continuation line to be token
characters AND to contain at least one alphanumeric — `*` and `-` are legal
inside a password, so the charset alone could not do it, but a line of PURE
punctuation is never half of a credential. Nine earlier `parsePaste` cases were
green throughout: none of them pasted the tool's own output.

**The general rule.** *A guard that compares a list to a list proves the two
lists agree, not that either one works.* Here both lists were right and the
thing between them did not exist. Ask what the lists were meant to PRODUCE and
assert that instead — the property, end to end, from the artefact a real person
creates. And **when a setup hands over N credentials, ask what each one opens**:
"the SUPABASE_DEV_* block" is a name for a group, and a group name is how a
project-deleting token and an RLS-bypassing database login end up on a
volunteer's laptop because they wanted to change a colour. The corollary for
deciding how to DELIVER secrets: settle what is in the envelope before choosing
the envelope — and then delete the step where a human retypes what is inside it.
**A pure function's tests do not cover the loop that feeds it**: exercise the
COMMAND against a realistic input, or the half you did not extract stays
unproven. **And the most realistic input to a paste-parser is the output of your
own tool** — the one shape nine hand-written cases all missed.

---

## `npm run migrate:status --dev` answered about PRODUCTION for months

**Symptom.** Found on 2026-09-06 when the owner said *"i want you to write docs
properly, check if you've write properly"* — an instruction to VERIFY rather
than assert, which is the only reason this was looked at.

`README.md` told people to run:

```bash
npm run migrate:status --dev
```

**Cause.** npm treats `--dev` as its OWN flag and never passes it to the script.
Measured, same line, one difference:

```
npm run migrate:status --dev      → project fheueuowbchsnsvbcgil [PRODUCTION]
                                    PENDING: 0
npm run migrate:status -- --dev   → project xibugtlsphcfuvstnxxh [samo-dev]
                                    PENDING: 3
```

A wrong answer wearing the right question — and not a quiet one: it reports
**PRODUCTION is in step** to somebody who believes they asked about samo-dev,
while dev really has three pending migrations. The tool is innocent; it prints
`[PRODUCTION]` precisely so this is catchable, which is exactly the guard
`docs/state/HANDOFF.md` §7 already told readers to rely on. The DOC handed them
the broken command.

The same shape had just been introduced by me in three fresh places
(`npm run env:share --db`, `--only`, `--copy`), where the failure is quieter
still: `--db` silently yields the two-value block, so a maintainer would believe
they had sent four values and sent two.

**Fix.** Every `npm run <script> --flag` in the repo's markdown rewritten as
`npm run <script> -- --flag`, with the reason inline at the two places a reader
is most likely to copy from. `src/js/docs-commands.test.js` sweeps all markdown
for the broken form, and separately asserts that every `npm run <name>` on a
getting-started page names a script that actually exists in `package.json`.
Both were reintroduced and each failed on its own assertion before restoring.

**Where it lives now.** `README.md`, `skills/build-the-dev-database.md`,
`skills/onboard-a-contributor.md`, `docs/start/sharing-credentials.md`; guarded
by `src/js/docs-commands.test.js`.

**The general rule.** *A command in a document is code, and nobody ever runs
it.* Prose is reviewed by reading; a command is only ever verified by execution,
and the gap between "this looks right" and "this does what it says" is where a
`--` lives. **Run every command you put in a doc, and diff its output against
what the sentence around it claims** — here the claim was "the same question,
against samo-dev" and the output said `[PRODUCTION]` in the first line. Same
lesson as the deploy pipeline that discarded its failing step: the instrument
was printing the answer all along and nobody was made to look at it.

---

## `env:pull` repointed the user's personal Bitwarden CLI, and its guard was satisfied by a comment

**Symptom.** None — nothing failed. Found on 2026-09-06 during an audit the
owner asked for (*"keep checking until you find no error"*), by RUNNING a
command whose failure path had only ever been reasoned about.

**Cause 1 — a project tool wrote outside the project.** `tools/env-pull.mjs`
called `bw config server <our vault>` with no appdata override, so the Bitwarden
CLI wrote to `~/Library/Application Support/Bitwarden CLI/data.json` and
**silently repointed a personal `bw` at the SAMO vault**. Confirmed by finding
the file the run had just created, with `"base": "https://samo.md.kku.ac.th/vault"`
in it. Anyone who uses `bw` for their own passwords would have found it talking
to us, with nothing anywhere to say why.

**Fix 1.** `BITWARDENCLI_APPDATA_DIR` pinned to a gitignored `.bw/` inside the
project, set in the ONE helper every invocation goes through, so it cannot be
forgotten at one call site. The file the audit itself created was deleted, so
the machine was left as it was found.

**Cause 2 — and this is the more useful half.** The guard written for Fix 1
asserted `expect(SRC).toMatch(/BITWARDENCLI_APPDATA_DIR/)` against the RAW file.
The fix ships with a JSDoc paragraph explaining the hazard, and that paragraph
contains the name. So **deleting the actual override left the test GREEN** —
verified: reintroduced the bug, ran the test, `14 passed`.

That is "satisfied by PROSE" in `.claude/rules/mistakes.md` class 7 — the same
shape as `confirm-modal.test.js` matching a comment — and the only reason it was
caught is the ritual: reintroduce the bug and watch it fail *on the assertion you
expect*. It did not fail, so the guard was wrong.

**Fix 2.** Read through `stripComments()`, the shared instrument, plus a control
asserting the stripper is actually removing the explanatory comment — so if the
stripper ever stops working, the guard says so instead of quietly reading prose
again.

**Where it lives now.** `tools/env-pull.mjs` (the `bw()` helper and `BW_DIR`),
`.gitignore`, `src/js/env-pull.test.js`.

**The general rule.** *A guard that greps a source file is reading the comments
too, and comments describe the fix in the fix's own words* — which is exactly the
vocabulary the assertion uses. Strip comments before asserting on source, and
control that the stripping happened. And the wider one: **the failure path you
have only reasoned about is not tested.** Running `npm run env:pull` once, in the
state every contributor is actually in, took under a minute and found a side
effect on somebody else's machine that no amount of reading would have shown.

## `npm run env:pull` printed "Signing in." and then nothing, for ever

**Symptom** (owner, 2026-09-07, the first real run of the whole path):

> *"i only see these text, nothing happens"*

```
  Fetching your credentials from https://samo.md.kku.ac.th/vault

  Signing in. Use your SAMO vault email and master password.
  (Nothing is stored in this project — the session ends when
   this command does.)
```

and then the cursor sat there. No error, no timeout, no CPU. Every theory it
invites is about the network or the vault — a slow TLS handshake, the `/vault/`
subpath, a 17 MB `npx` download — and all of them are wrong.

**Cause.** `bw` writes its prompts to **stderr**, and `bw()` piped stderr.
stdin was inherited, so the CLI was genuinely waiting for an answer to a
question that had been captured into a buffer nobody read. Measured, which is
the only reason this took minutes instead of an afternoon:

```
$ bw login --raw </dev/null 1>out 2>err
  out: (empty)            ← --raw puts the SESSION KEY here, which is why
                            stdout was captured in the first place
  err: ? Email address:   ← the prompt
```

The capture was not careless: `--raw` prints the session key on stdout and the
tool must read it. stderr was piped alongside it out of symmetry, and because
`die()` quotes stderr to say what went wrong. Both are right for the six
subcommands that never ask anything, and fatal for the two that do.

Second, smaller cause found in the same run: **`bw login` exits 0 with empty
stdout when its prompt reaches end-of-input.** So the run continued with
`BW_SESSION=''` and died four steps later at `get item`, blaming the vault for
a sign-in that had never happened — the failure naming the wrong step.

**Fix.** `stdioFor(args)`, exported so it can be asserted: stderr is
`'inherit'` for `login`/`unlock`, `'pipe'` for everything else, stdout always
captured. Plus an explicit `if (!session)` that fails at the step that actually
failed, and a line before the first call saying the first run downloads ~17 MB —
that call's progress is piped away too, and it is the other silent wait.

**The guard, and what it caught on the way.** `src/js/env-pull.test.js` asserts
the property both ways: prompting commands must inherit stderr, non-prompting
commands must capture it (that half is not decoration — inheriting everywhere
would throw away the diagnostic `die()` quotes). Reintroduced the bug, watched
it fail on that assertion, restored.

Writing it turned an OLDER guard red: "locks the vault on every exit path"
counted occurrences of the STRING `--raw` in the raw file, so three sentences of
a new comment *explaining what `--raw` does* broke it while the code was
correct. Same file, same lesson as the entry above, one entry later — and the
fastest way to green was to edit a number. It now counts CALL SITES in the
stripped source, with a control that fails if it has no subject.

**Where it lives now.** `tools/env-pull.mjs` (`stdioFor`, the `!session`
guard), `src/js/env-pull.test.js`.

**The general rule.** *A tool that asks a question on a stream it has captured
is a hang, and it looks exactly like a network stall* — which is what everyone
debugs first, away from the code. Before capturing a child process's output, ask
whether that child ever needs to ask the human something; the streams that carry
QUESTIONS and the streams that carry DIAGNOSTICS are not the same set, and
`stdio` is one decision for both. Class 7's "the instrument can delete the
witness", moved one step earlier: here the deleted witness was not the evidence
of a failure but the prompt that would have prevented it.

## CI was red for 19 consecutive pushes, and the 20th was a real change

**Symptom.** A push comes back `Status: Failure` — `2 failures · 1842 passes`.
The two are in `dev-env.test.js`, and locally the same suite says `1848
passed`. The obvious reading is that the commit just pushed broke something.

It did not. **`build.yml` had failed on every push since 2026-09-06 04:53** —
nineteen runs across 33 hours, `9aab626` through `e90bbc8` — and the twentieth
was indistinguishable from them.

**Cause.** Three assertions passed the maintainer's OWN `.env.local`:

```js
applyDevDatabaseEnv(procEnv, join(ROOT, '.env.local'));
```

That file is gitignored *because it holds production secrets*, so it exists on
every maintainer's laptop and can never exist on a CI runner. The guards were
green where nothing was at stake and red where the check is actually enforced.

Two things made it worse than an ordinary red build:

- **One of the three was green on CI for the reason it exists to catch.**
  `expect(env.VITE_ENV_NAME).not.toBe('production')` passes on `undefined`, and
  `undefined` is precisely "no ribbon, looks like production". So the CI signal
  was two failures where the honest count was three.
- **A build that is red for a reason nobody can fix stops being read.** Nothing
  was ignored on purpose; local `npm test` — the repo's standing check before
  every commit — kept answering `1848 passed`, which is the answer to a
  different question than the one CI asks.

**Fix.** `contributorEnvFile()` writes the existing in-memory `contributorEnv()`
fixture — built FROM `.env.local.example`, so it tracks the contract — into a
temp dir, and the three assertions take that path. The guards now assert the
same property with no secret present, which means they assert it everywhere.

**The ratchet.** A sweep over every `*.test.js` in the repo asserting none of
them reads this repo's real `.env.local`, with a control that fails if the walk
finds no files. It runs in the normal suite, so the next instance is caught on
the laptop rather than 19 pushes later. Reintroduced one of the three original
call sites, watched it go red, restored.

**Where it lives now.** `src/js/dev-env.test.js`.

**The general rule.** *A guard that needs a secret cannot run where guards are
enforced.* Anything a test reads must be either committed or synthesised — feed
it the artefact a real person creates, never the one your own machine happens to
have. And the meta-rule this cost 19 runs to learn: **`npm test` passing locally
is not the same claim as CI passing**, so when a CI failure names tests that
pass locally, the first question is not "what did I break" but "how long has
this been red" — `gh run list --workflow=build.yml` answers it in one command.
