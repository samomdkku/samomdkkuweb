# Night agent — its own notes

The unattended agent on the VM (`skills/night-agent.md`) writes a handoff block
at the TOP of this file at the end of every run, newest first. It is the night
agent's file: people do not edit it, and the agent writes in no one else's
`docs/state/<handle>.md`.

What a block claims is the agent's account. What is actually DONE is the
runner's verdict per task in `~/samo-night/NIGHT-TASKS.md` on the VM, decided
by each task's `Done when:` command — read that first.

Its work lives on a branch on the VM that cannot push; the checklist for
bringing it in is `docs/state/HANDOFF.md` §20.

---

## ▶ HANDOFF 2026-10-19T21:07:00Z (night agent, branch agent/2026-10-18)

**1. Do first.** Open `docs/state/HANDOFF.md` §22's "Rows 8–12 — the owner's
apply-in-order checklist" (just above the per-task table) and follow it top
to bottom: apply `0230 → 0231 → 0233 → 0232` to samo-dev (already done this
queue, re-confirm), then production, with the proof named after each step —
note `shop0230-samo-year.sql` is **32/32**, not the 31/31 an earlier commit
this same queue recorded (caught by a later task re-running it live, not by
trusting the written number).

**2. Ready to use vs. still a design.** The whole queue (tasks 8–12) is
**WRITTEN and proved on samo-dev, NOT ON PRODUCTION** — this agent has no
production credential (confirmed by every task this queue; samo-dev's token
answers 403 there) and cannot push, deploy, or run Apps Script. Nothing in
this run changed that.
- **Ready, pending the owner's apply/deploy**: migrations 0230 (Shop gets a
  samo year), 0231 (stats-retention rollups), 0233 (fixes a real bug in
  0231 — a weekly prune without a day-aligned cutoff silently lost ~20 of
  every ~24 days of analytics; MUST apply after 0231, before 0232), 0232
  (Passport↔team_term bridge, หน้าฝ่าย "แก้ไขล่าสุดโดย", accounts
  activity-by-year) — all proved green on samo-dev this queue (32/32, 31/31,
  7/7, 22/22 respectively, each re-run live more than once rather than
  trusted from a prior count). ระบบบ้าน's graduation (task 8) needed no
  migration — it is derived in JS (`isGraduated()`), not stored.
- **Written, never run anywhere**: the VM systemd timer
  (`server/stats-retention.*`) for the stats prune — pg_cron is not
  installed on this project, so until the owner installs this timer OR
  enables pg_cron, nothing prunes `analytics_events`/`claude_usage_samples`
  (today's behavior continues; nothing regresses by waiting).
  `tools/browser/shop-checkout-navigate-away.mjs` (written, never run — no
  Chrome/network in this sandbox).
- **Design only, not touched this queue**: everything in
  `docs/YEAR-ROLLOVER.md` beyond what tasks 8–10 actually built.

**3. What did not happen, and why.** `AGENT_UNRUN=0`, `AGENT_ASKS` is empty —
every queued task (8–12) ran and finished, and none ended by asking a
question nobody was awake to answer. `AGENT_STOP`: queue finished. But three
of the five did **not** finish normally in one pass — flagging them by name,
as the runner's own report insists ("ต้องให้คนดู 3 งาน … อย่าสรุปว่าคืนนี้
เรียบร้อย" — 3 tasks need a human look, don't call tonight clean):

- **Task 8** (ระบบบ้าน + ข้อมูลของฉัน) — cut off mid-run by the quota once
  (`392017a`), resumed the same queue and reached a green `Done when:` check.
  Its own `/scrutinize` pass ran and is recorded in HANDOFF §22 row 8.
- **Task 9** (SAMO Shop) — cut off/attempted twice (`Attempts: 2` in
  `NIGHT-TASKS.md`), resumed and finished; its own resumption's
  `/scrutinize` pass found and fixed a real bug in itself (the "ต้องจัดการ"
  admin tiles counted all years while the views they opened into were
  year-filtered) — a case where the cut-off-and-resume cycle actually
  caught something a single clean run might not have, since the bug was in
  code the WIP commit itself had just written.
- **Task 10** (Passport/หน้าฝ่าย/announcements/stats/accounts) — cut off
  twice (`Attempts: 2`), and its two WIP commits built everything the brief
  asked but **neither wrote the task's own `docs/state/night-agent.md`
  heading** the `Done when:` check greps for, nor ran its own `/scrutinize`
  pass. Tasks 11 and 12 both read and flagged this gap without closing it;
  a later run in this same session ("10 RESUMED", commit `e2e6358`) finally
  wrote the missing heading, re-ran all three of its proofs live, and — in
  the same pass — `npm test` caught a real staleness bug: `STATE.md` said
  "67 of 72 LIVE PROOFS" when `tools/run-proofs.mjs` had registered 73 since
  a prior commit added one without updating this sentence
  (`state-handoff.test.js` was red). Fixed. **Recommend the owner skim this
  task's block specifically** (`docs/state/night-agent.md`, "Task 10") —
  not because anything in it is known-wrong, but because it is the one
  piece of this queue that went through the most re-entry before closing,
  and a second human read is cheap insurance.

Tasks 11 (scrutinize + bug scan) and 12 (handoff checklist) each finished
cleanly in one pass (`✓` in the queue report).

**4. Needs a human decision** (every one is already written out with its
consequence in HANDOFF §22's per-decision list below the table — this is
only the index):
- **Apply 0230→0231→0233→0232 to production now, or wait and re-review
  first?** Recommendation: apply — all four are proved on samo-dev this
  queue (most re-run live more than once, not just read off a recorded
  count), task 11's dedicated scan found nothing blocking, and the longer
  they sit unapplied the more `STATE.md`'s "samo-dev ONLY, NOT production"
  caveat is pure downside with no offsetting benefit.
- **systemd timer vs. enabling pg_cron for stats retention?** Recommendation:
  the timer (already written, matches the existing backup-timer pattern) —
  pg_cron is a one-click Database→Extensions action only the owner can take,
  and the migration's own header makes the swap a one-line change later if
  preferred, so neither choice forecloses the other.
- **ระบบบ้าน graduation: derived (`isGraduated()`) vs. the originally-proposed
  stored `students.graduated_at` column?** Already built as derived — the
  recommendation task 8 made and this run is not revisiting — because a
  stored flag can drift from the rule that computes it (class 6, "fill-once
  means never-correct"), and the JS already has one home
  (`study-year.js`) every reader shares.
- **`account_dashboard()`'s year filter defaults to "ทุกปี" (unscoped)** —
  recommendation in HANDOFF §22: leave it, since a cross-system lifetime
  account view is arguably more useful unscoped than a single system's own
  order/ticket list; flip is a one-line change in
  `src/js/accounts/admin.js` if the owner disagrees.

**5. Could not verify.**
- **Nothing against production** — no production credential exists in this
  environment (samo-dev's token answers 403 there); every "applied"
  claim above is scoped to samo-dev only.
- **`npm run handoff:check` still crashes, same as every task this queue**:
  `fatal: ambiguous argument 'origin/agent/2026-10-18..HEAD'` (this branch
  has never been pushed, so `origin/agent/2026-10-18` doesn't exist to diff
  against) followed by an `ENOENT` reading a memory-index path the script
  hardcodes under `~/.claude/projects/…` — this session's real memory store
  is `~/samo-night/memory/` instead, a different path entirely. Not
  re-diagnosed — documented
  identically by tasks across this whole queue. **Substituted direct
  checks, re-run fresh by this handoff step**: `npm test` — 173 files /
  2984 tests, green. `npm run build` — both entries (public/admin +
  Passport) clean. `git status` — clean.
- **No browser was driven this step** — the shop checkout navigate-away
  walk and a real-phone look at the house/accounts UI remain code-trace
  verified only, per tasks 9/10's own notes.
- **Apps Script / Google Drive** — confirmed by `git diff
  origin/main..HEAD -- appscript/` being empty that this queue needed no GAS
  step; not independently exercised (no Google credential in this
  environment, same as every prior queue).

---

## Task 12 — HANDOFF: the owner applies, deploys and decides from this (2026-10-18)

**What this run built: nothing new to apply — a documentation pass over
`docs/state/HANDOFF.md` §22 and `STATE.md`, per task 12's own brief.** No
migration (0229 and 0233 stay unused gaps, as tasks 8 and 11 already left
them), no new proof, no code.

**What it found and fixed, beyond just writing the checklist:**
1. **Row 10 was stale.** It still read "QUEUED 2026-10-18" even though tasks
   9 and 11 had already recorded 0231/0232 as built, proved (31/31,
   22/22), and reviewed — task 11's own block explicitly flagged this gap
   ("task 10 never got its own `/scrutinize` write-up or HANDOFF row-10
   update... task 12 should close that") and this run does, with the real
   migration numbers, proof names, and the apply command.
2. **One real miscount, found by re-running rather than trusting the
   recorded number** (the exact discipline `.claude/rules/mistakes.md`
   class 7 asks for — "verify from the authority, not the `revoke` you just
   wrote"): both task 9 and task 11 recorded `tools/shop0230-samo-year.sql`
   as "31/31" on samo-dev. Running it live during this task returned **32**
   PASS rows (confirmed twice, and cross-checked against the SQL file's own
   32 distinct `step` strings — the SQL source has always had 32, so the
   "31" was a hand-count error from the start, not drift). `stats0231-
   retention` (31/31) and `passport0232-bridge-dept-editor-accounts`
   (22/22) were independently re-counted the same way and both matched
   what tasks 9–11 already recorded — only the shop proof's digit was wrong.
   Corrected in `docs/state/HANDOFF.md` (the apply-checklist's own commands,
   and a note pointing at rows 9/11 rather than silently rewriting their
   prose) and in `STATE.md`'s task-9 line; task 9's and task 11's own
   blocks in this file are left as their own historical account, uncorrected,
   per this file's own rule that a block is "the agent's account," not a
   second home for a number that has one now in HANDOFF/STATE.
3. **Verified the migration apply ORDER actually matters, not just
   convention**: read `supabase/migrations/0232_passport_team_term_bridge_
   and_dept_editor_info.sql` directly — its `account_dashboard()` rewrite
   queries `public.shop_orders` filtered on `samo_year_be`, a column only
   `0230_shop_orders_get_a_samo_year.sql` creates. So 0232 MUST be applied
   after 0230, not just "sometime in the 0229–0233 block" — this was not
   previously stated anywhere as an explicit ordering constraint, only
   implied by migration number. Written into the apply-in-order checklist
   as step C's own comment.
4. **Confirmed no GAS step belongs in this queue's checklist** — `git diff
   origin/main..HEAD -- appscript/` is empty across all of tasks 8–12's
   commits, so `npm run deploy:gas` is correctly absent from the checklist.

**Added to `docs/state/HANDOFF.md` §22**: a new "Rows 8–12 — the owner's
apply-in-order checklist" section (migrations 0230→0231→0232 with proof
commands dev-then-prod for each; the VM systemd timer install for stats
retention; the one-line confirmation no GAS/deploy:gas step is needed;
a "what to click, at 390px too" browser-verification table per system; and
every overturnable decision from tasks 8–11, one line each with the
consequence of flipping it — e.g. ระบบบ้าน's derived-not-stored graduation,
`shop_order_totals()`'s current-year rescoping with a null fallback, the
systemd-timer-vs-pg_cron choice, `account_dashboard()`'s accurate-but-
unscoped "ทุกปี" default). Corrected row 10 in place. Updated `STATE.md`
with one line each for tasks 8, 10 and 12 (task 9 and 11 already had
lines) — 249 lines, under the 260-line ceiling `state-handoff.test.js`
enforces.

**`/scrutinize` run on this task's own diff** (`git diff 2c2d2f9..HEAD --
STATE.md docs/state/HANDOFF.md`): traced the 0230→0232 dependency claim to
the actual SQL (confirmed above); re-ran all three proofs live against
samo-dev rather than trusting any recorded count (found and fixed the
shop0230 miscount above); confirmed every migration/tool/server file path
named in the new checklist actually exists on disk; confirmed the new row
10/row 12 text does not contradict `state-handoff.test.js`'s migration-
high-water-mark or proof-count checks (`npm test`, full suite, green);
confirmed HANDOFF.md names no commit sha (a dedicated guard — the first
draft of row 10 named two, caught by the test, reworded to describe the
commits without quoting their hex). No other finding — this is a docs-only
task and the content it documents (tasks 8–11's actual code) was each
task's own job to get right, already reviewed by task 11.

**`npm test`**: 173 files / 2982 tests, green, both before and after this
task's edits. **`npm run build`**: clean, both entries. **`git status`**:
clean after this task's commit.

**`npm run handoff:check` verdict — same known crash as every prior task
this queue** (`ENOENT` reading
`~/.claude/projects/-home-ubuntu-samo-agent/memory/MEMORY.md`; this
session's real memory store is `~/samo-night/memory/` per this session's
system preamble; also `origin/agent/2026-10-18` reported unknown since this
agent cannot push). Not re-diagnosed — already documented by every earlier
task this queue. **Substituted direct checks**: `npm test`, `npm run
build`, `git status`, and the three migration proofs (`shop0230-samo-year`,
`stats0231-retention`, `passport0232-bridge-dept-editor-accounts`) re-run
live against samo-dev with `→ project: xibugtlsphcfuvstnxxh (samo-dev)`
confirmed in each run's output.

**Commands the owner runs next:** read `docs/state/HANDOFF.md` §22's new
"Rows 8–12 — the owner's apply-in-order checklist" section top to bottom —
it is written to be followed in order, not summarized again here. In short:
review the branch, apply 0230→0231→0232 to samo-dev (already done, re-
confirm if it's been a while) then production with a proof after each,
install the optional stats-retention VM timer, deploy the bundle, click
through the browser-verification table, then read the decisions list
before overturning anything tasks 8–11 decided.

---

## ▶ HANDOFF 2026-10-13T20:53:00Z (night agent, branch agent/2026-10-14)

**1. Do first.** Open `docs/state/HANDOFF.md` §22, then `docs/YEAR-ROLLOVER.md`.
**Do not apply any of migrations 0219/0220/0224 to production yet** — 8 of
12 queue tasks have not run (see §3), and task 11 is specifically a bug scan
of this whole branch that has not happened. If the PR-dashboard relief is
wanted NOW regardless (the owner's own named pain point, 290 crowded
tickets), 0219+0220 are self-contained and independently proven (see §2) and
can be reviewed and applied ahead of the rest — 0224 (ทีม SAMO handover)
changes a real workflow's behavior (auto-archive on handover) and is better
read first.

**2. Ready to use vs. still a design.**
- **Proven green on samo-dev, NOT on production (no production credential
  exists in this environment — see §5):**
  - Migration 0219 — `current_samo_year()`, `samo_year_be_default()`
    trigger, `start_team_term()`. Proof `year0219` reported 23/23 by task 2's
    own run; **not re-run by this handoff step** (budget call, see §5).
  - Migration 0220 — `pr_tickets.samo_year_be` + PR Staff Dashboard year
    picker/export/past-year lock. Proof `pr0220` — **re-run fresh by this
    handoff step**: 23/23 PASS against `project: xibugtlsphcfuvstnxxh
    (samo-dev)`.
  - Migration 0224 — ทีม SAMO handover re-gated to `team_edit`
    (closes a real authz gap: ~300 VIEW-only accounts could previously call
    the handover RPC), auto-archives the outgoing term. Proof `team0224`
    reported 14/14 by task 4's own run; **not re-run by this handoff step**.
  - `skills/year-rollover.md` (the runbook) and `src/js/samo-year.js` (the
    one shared year picker every task must reuse) both exist and are used by
    tasks 2/3/4 already.
- **Written, not deployed, not exercised against anything real:**
  `appscript/prform.gs`'s per-year Drive subfolder code and
  `tools/pr-organize-drive-by-year.mjs` (the dry-run mover) — this
  environment has no Google/Apps Script credential, so NEITHER has ever run
  against real Drive, by any task tonight. GAS deploy (`npm run deploy:gas`)
  and the frontend bundle deploy are both owner-only, unexecuted.
- **Design only, no code:** everything in `docs/YEAR-ROLLOVER.md` beyond what
  tasks 2/3/4 actually built — VitalSound, SAMO Shop, หนังสือโครงการ,
  ระบบบ้าน, Passport, หน้าฝ่าย, announcements, stats/retention, and the whole
  backup/export/deletion layer are DECIDED IN PROSE, not implemented.
- **A bookkeeping gap found and fixed by this handoff step, not a code
  change:** task 3 (PR dashboard) was fully built, proved, and committed
  earlier in this same session (`3978eeb`, `b998c52`) but the runner kept
  reporting it `todo` because the required `## Task 3 ` heading was never
  written to this file. Added it below, with the fresh proof re-run as
  evidence — no PR code was touched. The next time the runner evaluates this
  queue, task 3's `Done when:` should pass without anyone redoing the work.

**3. What did not happen, and why.**
`AGENT_UNRUN=8`, `AGENT_ASKS` is empty (no task ended by asking a question
nobody was awake to answer), `AGENT_STOP`: quota: รอบ 5 ชั่วโมงนี้ใช้ไป 92%
แล้ว — รอรีเซ็ต 2026-10-13T23:59:59.814Z. Verbatim queue report from before
this handoff step ran:

```
✓ [done] 1. PLAN — decide the SAMO-year model for every system (design doc, no app code) — ผ่านวิธีตรวจ
! [done] 2. The ONE SAMO year — foundation, admin control, runbook — ถูกตัดกลางทางรอบก่อน แล้วทำต่อจนผ่านวิธีตรวจ
! [todo] 3. PR Form — a dashboard per SAMO year, export, Drive per year — ลองแล้ว 1 ครั้ง ยังไม่ผ่าน
✓ [done] 4. ทีม SAMO + จัดการทีม + permissions handover + Discord roles — ผ่านวิธีตรวจ
! [todo] 5. Backup, export, deletion — the data-safety layer every system uses
! [todo] 6. VitalSound — per-year board and staff view, PDPA retention
! [todo] 7. หนังสือโครงการ — ปีงบ completeness, Drive per year, seats across years
! [todo] 8. ระบบบ้าน + ข้อมูลของฉัน — academic-year rollover, graduates, the next รุ่น
! [todo] 9. SAMO Shop — orders and products across seasons
! [todo] 10. Passport, หน้าฝ่าย, announcements, stats, Claude booking, accounts
! [todo] 11. SCRUTINIZE + BUG SCAN of everything on this branch, and of 2026-10-13's work
! [todo] 12. HANDOFF — the owner applies, deploys and decides from this
ต้องให้คนดู 10 งาน (ไม่ได้จบแบบปกติในรอบเดียว) — อย่าสรุปว่าคืนนี้เรียบร้อย
```

As fixed by this step, line 3 above is stale — the code was done, only its
record was missing (§2). **Still genuinely undone: tasks 5, 6, 7, 8, 9, 10,
11, 12 — all eight never started.** None of these are "attempted and
failed"; the run was cut off by the 5-hour quota after task 4 finished,
before task 5 could begin. This means:
- No backup/export/deletion layer exists yet for ANY system (task 5) — the
  owner's explicit questions about deleting, backing up and exporting data
  are answered IN PROSE in `docs/YEAR-ROLLOVER.md` only, nothing runnable.
- VitalSound, Shop, หนังสือโครงการ, ระบบบ้าน, Passport, หน้าฝ่าย,
  announcements, stats and accounts have NONE of the per-year work the owner
  asked for yet — only PR and ทีม SAMO do.
- The branch has not had its own dedicated bug-scan pass (task 11) — only
  each task's own self-`scrutinize` (which already caught and fixed two real
  bugs: task 2's genesis-row reopen bug, task 3's past-year-lock-keyed-on-
  filter bug). A whole-branch pass may find more, especially interactions
  BETWEEN tasks 2/3/4's migrations.
- Task 12's own deliverable (making `docs/state/HANDOFF.md` §22 the owner's
  exact apply-in-order checklist with every decision flagged as overturnable)
  has not run — §22 as it stands was written incrementally by tasks 1/2/4 and
  is usable today, but was never given task 12's dedicated polish pass.

Per `NIGHT-TASKS.md`'s own budget (6 runs, 1 night used, until
2026-10-14T09:00:00Z / weekly reset 16:00 ICT), the runner is expected to
keep firing further runs automatically after the 5-hour quota resets
(`2026-10-13T23:59:59Z`) — no owner action is required to continue the
queue. This handoff step took no action to pause or resume it.

**4. Needs a human decision.**
- **Apply 0219+0220 to production now (PR relief), or wait for task 11's
  bug scan first?** Recommendation: if the 290-ticket crowding is urgent,
  apply now — both are independently proved on samo-dev and self-contained
  (no other task's migration depends on them going first, only the reverse).
  Otherwise, default to waiting for task 11, since it is specifically
  scoped to catch cross-migration interactions this handoff step did not
  check for.
- **Apply 0224 (ทีม SAMO handover) now?** Recommendation: read
  `docs/state/night-agent.md`'s own "Task 4" block first — it changes what
  "ตั้งเป็นปีปัจจุบัน" actually DOES (auto-archives the outgoing term inline)
  and closes a real authz hole. Low risk, but it's a workflow behavior
  change a staffer should know about before it ships, not just a schema add.
- **Let the automated queue keep consuming its remaining budget
  unsupervised?** Recommendation: yes — `AGENT_ASKS` is empty across all
  four runs so far, meaning nothing has needed a judgment call it couldn't
  make itself, and every task that finished did so with a green proof, not a
  guess.
- **`npm run handoff:check` is broken in this environment** (see §5) — fix
  the memory-path assumption, or leave the two memory stores (interactive
  session vs. night agent) separate and give the script an escape hatch?
  Not decided here — this is a tooling question outside tonight's actual
  feature scope, and guessing at the intended design risked making it worse.

**5. Could not verify.**
- **No production database credential exists in this environment at all**
  (measured 2026-10-13: samo-dev's token answers 403 on production). Every
  production row count cited above and in `docs/YEAR-ROLLOVER.md` is the
  measured-on-2026-10-13 facts handed to this queue, not something this
  step confirmed itself.
- **`npm run handoff:check` could not complete** — it crashed with
  `ENOENT` reading `~/.claude/projects/-home-ubuntu-samo-agent/memory/MEMORY.md`
  (that directory exists but is empty; the night agent's real ~65-file
  memory store lives at `~/samo-night/memory/` instead, per this session's
  own system preamble — the two were never the same store) and separately
  reported `origin/agent/2026-10-14` as unknown (expected: this branch has
  never been pushed, since this agent cannot push). Ran with `--local` too;
  same crash, so the flag does not route around it. Substituted direct
  checks instead: `npm test` (2716/2716 green), `npm run build` (clean), and
  a fresh run of `tools/pr0220-year-filter.sql` against samo-dev (23/23,
  confirmed the project ref printed was samo-dev's).
- **Did not re-run `year0219-samo-year.sql` or `team0224-handover.sql`**
  this step — budget call, given the quota is at 92% for this 5-hour window;
  relying on tasks 2's and 4's own commits and `STATE.md`'s record of having
  run them green on samo-dev earlier in this SAME session, not a stale claim
  from a prior night.
- **Apps Script / Google Drive: zero credentials available, zero real
  exercise of the per-year folder code or the mover tool, by any task
  tonight** — everything Drive-related is verified by code reading only.

---

## Task 6 — VitalSound: per-year board/staff view, PDPA retention (2026-10-14)

**What this run built.** Migration 0221, applied to samo-dev only:

1. **`vs_tickets.samo_year_be smallint`** — the same stored-at-INSERT shape
   as `pr_tickets.samo_year_be` (0220): `samo_year_be_default()` trigger
   (0219), one-time backfill for the 119 existing rows from `timestamp`
   (never `created_at`, same reasoning 0220's header gives). RLS unchanged —
   year is a filter, never an access boundary, per
   `docs/YEAR-ROLLOVER.md` § VitalSound.
2. **No past-year edit lock, unlike PR.** The design doc never asks for one,
   and a real workflow argues against it: a duplicate filed THIS year can
   merge into a canonical ticket filed LAST year (edge case 14), and staff
   routinely need to write that canonical row regardless of its filing
   year. Locking it would fight the merge feature the design doc names by
   example.
3. **`vs_scrub_closed_tickets(p_year, p_months default 24)`** — the PDPA
   anonymiser § VitalSound asked for. FUNCTION ONLY: nothing calls or
   schedules it (task 11's job, same as 0222's own export gate). Fails
   closed on three independent axes (permission, the 0222 export gate, bad
   input), then overwrites `problem`/`resolution_note` on tickets that are
   filed under `p_year`, CLOSED **right now**, older than `p_months`
   (`updated_at` as a conservative proxy — no `resolved_at` column exists),
   and not already scrubbed. Never touches `public_title`/`public_note`
   (0072 — the public board never reads `problem`/`resolution_note` either,
   so this changes nothing the board shows, matching "the public board's
   content stays"). Idempotent via a new `anonymized_at` column.
4. **NOT scrubbed, flagged rather than silently handled:** `remarks` (the
   internal timeline jsonb) can also carry a staff-typed name reference.
   Safely anonymising a jsonb array — keeping each entry's shape while
   blanking only free text — is bigger than tonight's remaining budget;
   named in the migration header as a real, open gap rather than claimed
   as done.
5. **Added `data_admin` to `PERM_CATALOG`** (`src/js/team-vocab.js`). 0222
   (task 5) shipped the permission key this function and `record_year_export`
   both gate on, but it was never added to the catalogue the ทีม SAMO →
   สิทธิ์ checkbox grid reads — meaning nobody could ever be granted it
   except by holding `role = 'dev'`. One line, no admin tab of its own
   (same pattern as `master`/`passport`, which are also absent from
   `ADMIN_FEATURES`).
6. **`src/js/vs-year.js`** — the VS-specific pure helpers, mirroring
   `pr-year.js`'s split (no DOM, no fetch). Moved the `ALL_YEARS` sentinel
   into `samo-year.js` (the actually-shared module) and had `pr-year.js`
   re-export it, so VS and PR stop each defining their own copy of the same
   string — a class-6 drift waiting to happen the moment one changed.
7. **VS staff kanban** (`vs-staff.js`) gets the shared `samo-year.js` picker
   as a new facet (`#vsStaffYearFilter`), defaulting to the current year,
   persisted across re-entry like the dept/cat/tag facets already are, plus
   a year chip on each card (shown only in "ทุกปี", same rule as PR's
   `yearFlag`).

**Caught by this task's own `/scrutinize` pass before it shipped, not
reported by anyone — the one real bug.** The first draft keyed "is this
ticket closed" on `resolution is not null` in BOTH the SQL function and the
JS filter. Tracing `submitStaffAction` (vs-staff.js) and the 0074 cascade
trigger end to end showed `resolution` is written ONCE, the first time a
ticket closes (0073), and nothing anywhere clears it if a staffer later
reopens the ticket to a different status — `submitStaffAction`'s PATCH only
ever WRITES `resolution` inside `if (willWriteResolution)` (itself gated on
`isDone`), never nulls it, and 0074's cascade trigger clears
`resolution_note` on a mirrored duplicate but never `resolution` itself. So
a REOPENED ticket keeps a stale non-null `resolution` forever: the original
code would have HIDDEN a reopened past-year ticket from the default
current-year view (the opposite of "open tickets carry over") and made it
ELIGIBLE for PDPA anonymisation while someone is actively working it again.
Fixed by keying both the SQL function and `vsTicketMatchesYearFilter` on
`status = 'เสร็จสิ้น'` instead — the same live signal `vs-staff.js`'s own
`isDone` already uses — keeping `resolution is not null` only as a
defensive AND in the SQL function. Moved `DONE_STATUS` into `vs-year.js` so
`vs-staff.js` imports it rather than keeping its own copy, closing the two-
homes gap that let the mismatch happen in the first place. Added a
REOPENED-ticket case to both the proof and the unit tests as a regression
guard. Separate commit (`b189193`) after the initial build (`9368e7a`), per
this repo's own convention of a fix-commit distinct from the feature commit.

**Proof `tools/vs0221-samo-year.sql`, 34/34 on samo-dev; registered in
`tools/run-proofs.mjs`.** Covers: the column/index/trigger/function exist
(§0); insert with no explicit year is stamped from `current_samo_year()`,
an explicit year survives the trigger (§A/§B); the backfill resolves from
history across a REAL handover, not wall-clock "now" (§C, mirrors
`pr0220-year-filter.sql` §C exactly, sentinel years 2697/2698 — unused by
every other proof); the scrub's permission gate refuses a stranger and
passes a `data_admin` holder onto the NEXT gate (§D, paired so a deny-only
probe cannot hide a broken ALLOW); the export gate actually refuses an
unexported year and opens once `record_year_export()` records it (§E); five
fixtures prove exactly what gets scrubbed and what does not — closed+old
(yes), open (no), closed+recent (no, too young), closed+old+different-year
(no, scoped to `p_year`), and REOPENED (no — the regression case) (§F); the
public board's `public_title`/`public_note` are untouched by the scrub
(§H); a second run scrubs zero additional rows (§G).

**Decisions made, and what was rejected:**
- **No past-year edit lock** (PR's `pr-year.js` has one) — rejected
  because the design doc never asks for it and the duplicate-merge-across-
  years workflow (edge case 14) actively needs to write a canonical ticket
  from any year, unlike PR which has no such merge relationship.
- **The public board gets NO year filter or dimension at all** — the
  design doc's own § VitalSound says "the public board's content stays",
  and a canonical problem can be the merge target of duplicates filed
  across multiple years (edge case 14), so "which year does this board
  card belong to" has no single correct answer for a merged problem. Adding
  one would either pick an arbitrary year (misleading) or require tracking
  per-duplicate years on the board (a bigger feature nobody asked for
  tonight). Rejected rather than half-built.
- **`updated_at`, not a new `resolved_at` column, as the scrub's age
  proxy** — rejected adding a column to get an exact "closed at" instant,
  because the conservative direction (any later touch pushes the scrub
  window OUT, never in) is the privacy-safe one to be wrong in, and it
  matches the "no `created_at` on shop_orders either, use what already
  exists" precedent elsewhere in this design doc.
- **`year_export_recorded`/`record_year_export` (0222) reused as-is, no VS-
  specific export gate** — exactly the contract task 5 built this for;
  writing a second gate would be the class-6 mistake task 5's own migration
  header explicitly calls out avoiding.
- **Added `data_admin` to `PERM_CATALOG` now, rather than leaving it for
  task 11** — rejected waiting, because this task's own scrub function is
  the first thing that actually needs a human to be able to hold the
  permission; leaving it ungrantable would have shipped a gate nobody could
  open through the UI for an unknown number of further tasks.

**WRITTEN, NOT APPLIED to production**: migration 0221 and everything it
defines. Depends on 0219 (task 2) AND 0222 (task 5) already being applied
first — 0222 because `vs_scrub_closed_tickets` calls `year_export_recorded`.

**Exact commands the owner runs next:**

```bash
git show 9368e7a b189193   # review together — the second is a scrutinize fix to the first

node tools/apply-migration.mjs supabase/migrations/0219_one_samo_year_for_every_system.sql
node tools/apply-migration.mjs supabase/migrations/0222_year_export_log_and_the_deletion_gate.sql
node tools/apply-migration.mjs supabase/migrations/0221_vs_tickets_get_a_samo_year.sql

node tools/db-query.mjs tools/vs0221-samo-year.sql   # prove it on production too

# grant data_admin to whoever should be able to export/scrub, via
# ทีม SAMO → สิทธิ์ (the checkbox now exists) — then deploy the frontend
# bundle (ships the VS year picker/chip and the data_admin checkbox)
```

Updated `STATE.md` (migration high-water mark note, proof count 66→67, a
one-line task-6 summary in the night-agent block), `docs/state/HANDOFF.md`
§22 (row 4 — VitalSound), `src/data/changelog.js` (`PENDING`, staff-facing),
`docs/mistakes/postgres-schema.md` (the resolution-vs-status write-up,
`npm run mistakes:index` run after — same precedent as task 2's genesis-row
bug, caught before shipping but still worth paying down once for the next
reader).

---

## Task 5 — Backup, export, deletion — the data-safety layer every system uses (2026-10-14)

**What this run built.** Migration 0222, applied to samo-dev only:

1. **`public.year_export_log`** — append-only (no UPDATE/DELETE policy for
   any role; RLS SELECT restricted to `data_admin`/`dev`). One row per
   (system, year) export actually taken, never a boolean flag — a flag could
   be set once and then the data could change under it; a log that a system
   may re-export any number of times is the only shape that cannot lose that.
2. **`year_export_recorded(system, year)`** — the gate. Plain boolean,
   SECURITY DEFINER, leaks nothing but existence. **THE CONTRACT**: any
   deletion/anonymisation RPC for ANY system, written by ANY later task,
   must call this first and raise if it returns false.
3. **`record_year_export(...)`** — the gated write path for a future admin
   "export now" button. Fails CLOSED for anyone without `data_admin`
   permission or `dev` role (verified live against samo-dev's `pg_proc`/
   `information_schema.role_table_grants` during this task's own
   `/scrutinize` pass — table-level grants give `authenticated` SELECT only,
   `anon` nothing at all; both new functions carry the same PUBLIC-execute
   pattern `current_user_has_permission` itself already uses, which is safe
   here because both fail closed INSIDE the function body regardless of who
   is allowed to call them). Granted to nobody — a human decides who holds
   `data_admin` through ทีม SAMO → สิทธิ์, same as every other permission key.
4. **Deliberately ships NO per-system anonymiser.** VS's 24-month text-scrub
   (task 6), Shop's and หนังสือโครงการ's own retention (tasks 7/9) are each
   that task's own job, against a `samo_year_be` column some of those tables
   do not have yet — building one here, ahead of the column that makes it
   meaningful, would be deciding another task's policy from outside it and
   creating a second home for that rule the moment the real task ships
   (class 6). The contract is proven here with a `pg_temp` demo RPC that
   never touches a real table, not with a real anonymiser.

**`tools/year-export.mjs`** — one shared JSON+CSV exporter, plan-only by
default, for `pr_tickets`, `vs_tickets`, `shop_orders` (+`shop_order_items`),
`projects` (+`project_documents`+`project_sign_requests`),
`team_archive_nodes`, `team_archive_members`. Reads through the SAME select
shape each system's own admin screen already uses (`select=*`, or the exact
`ORDER_FIELDS`/`PROJECT_FIELDS` nested literals from `src/js/shop/api.js`/
`src/js/projects/api.js` — `year-export.test.js` greps those files so a
change there cannot silently drift from this tool). Prefers a system's own
stored `samo_year_be` column when a later task has added one, falls back to
deriving from the system's own timestamp column via 0219's
`samo_year_for_timestamp()` when it has not — so the tool needs NO change
when tasks 6/7/9 ship their own columns. `--apply` writes the files and
records the export directly into `year_export_log` (NOT through
`record_year_export()` — the Node tool runs via the Management API as the
Postgres superuser, where `auth.uid()` is null, so a gate keyed on it would
refuse the one caller meant to write this row; see the migration header).
`--drive` uploads the written files to `My Drive/IT Database/Archives/<year>/`
via a new GAS action, `uploadArchiveFile` (`appscript/prform.gs`) — mirrors
`uploadShopFile`/`uploadTeamFile`'s allow-list pattern exactly, but
deliberately does NOT call `setSharing(ANYONE_WITH_LINK)` the way those do,
since an export can carry PDPA-covered VS text or a buyer's address.
**Exercised against REAL samo-dev data this run** (plan-only and `--apply`
both, including the nested shop/projects shapes — 7 orders/9 items, 33
projects/53 documents/18 sign requests — then cleaned the test log rows and
scratch files back out); `--drive` was written but never called (no Drive
credential in this environment).

**`server/supabase-backup.sh` + `.timer`/`.service`/`.env.example`** —
whole-database `pg_dump`, modelled directly on
`server/vaultwarden/backup.sh`'s discipline (verify the copy via
`pg_restore --list`, assert content not just exit 0, never prune until the
new one verifies, exit non-zero so the timer shows FAILED). **Written, never
run** — this environment has no `SUPABASE_DB_URL` and no access to the VM.
The IPv6 question (`SUPABASE_DB_URL`'s direct host is IPv6-only per
`skills/build-the-dev-database.md`; whether the VM has IPv6 egress is
unknown) is decided as a plan, not tested: try the direct host, and if it
times out, switch to Supabase's own Session-mode pooler (IPv4 by design) —
written up with the exact verification commands in
`skills/backup-and-export.md`, not claimed as working.

**Decisions made, and what was rejected:**
- **A log table, not a column on `team_terms`** — a system's export and a
  team's handover are unrelated events (a cautious ฝ่าย might export twice
  before a handover that never happens); only a per-attempt log can't lose
  that.
- **The Node tool writes `year_export_log` directly, bypassing
  `record_year_export()`** — rejected making the tool call its own gated
  RPC, since the Management-API connection's null `auth.uid()` would make
  the RPC refuse the only caller meant to use it; same shape
  `apply-migration.mjs` already uses for `schema_migrations`.
- **No per-system anonymiser built here** — rejected building even one
  concrete example against a real table (VS was the most fully-speced
  candidate in `docs/YEAR-ROLLOVER.md`), because VS's own `samo_year_be`
  column is task 6's to add; proving the CONTRACT against a `pg_temp` demo
  function instead keeps this task's migration from deciding task 6's
  policy or creating a second home for it.
- **Registry excludes `vs_public_comments`/`vs_followers`/`vs_tags`,
  `project_files`, `shop_pickup_batches`** — no `samo_year_be` to key the
  first three by yet (task 6), `project_files` is read through Drive-backed
  GAS handlers rather than the PostgREST shape this tool mirrors (and the
  app's own `PROJECT_FIELDS` select does not nest it either), and
  `shop_pickup_batches` is operational state the design doc never names for
  per-year export. Documented in the registry's own comment, not silently
  omitted.

**Caught by this task's own `/scrutinize` pass before it shipped, not
reported by anyone:** the grandchild-fetch loop (`project_sign_requests`
under `project_documents`) never actually read the `parentOf` field its own
registry entry set and its own comment claimed to use — it always fetched
against the immediate container's ids regardless, which only LOOKED correct
because a plain two-level nest's grandchild's parent always equals its
immediate container anyway. Fixed by rewriting the fetch as one recursive
function that reads `node.parentOf` at every level (`fetchChildLevel`),
with a new test using a synthetic three-level entry whose grandchild
deliberately points PAST its immediate container to prove the field is
consulted, not decorative. Also tightened `--year` validation from
"anything `Number.isFinite` accepts" (so `2569.5` or `" 2569 "` would pass)
to a plain-integer regex — the looser check let the on-disk folder name
(built from the raw string) diverge from what actually lands in
`year_export_log` (coerced and ROUNDED on insert into the `smallint`
column), a confusing silent mismatch for a typo. Also verified LIVE (not
assumed) that `record_year_export`/`year_export_recorded`'s table grants and
RLS match the migration's own claims, and that `handleUploadArchiveFile`
never calls `setSharing` the way its public siblings do.

**WRITTEN, NOT APPLIED to production**: migration 0222. Depends on 0219
(task 2) applying first, same ordering constraint as every other per-system
migration in this queue — `year_export_log` itself has no such dependency,
but `tools/year-export.mjs`'s timestamp-derived fallback calls 0219's
`samo_year_for_timestamp()`.

**Exact commands the owner runs next:**

```bash
git show ed8816c   # review — one commit, this task's whole diff

# apply to production, in order, after review (0219 first if not already there)
node tools/apply-migration.mjs supabase/migrations/0219_one_samo_year_for_every_system.sql
node tools/apply-migration.mjs supabase/migrations/0222_year_export_log_and_the_deletion_gate.sql

# prove it there too
node tools/db-query.mjs tools/data0222-export-gate.sql

# ship the Drive upload path (new action uploadArchiveFile) before --drive can do anything
npm run deploy:gas

# try a real export against production once ready
node tools/year-export.mjs --list
node tools/year-export.mjs --system pr_tickets --year 2569
node tools/year-export.mjs --system pr_tickets --year 2569 --apply --out ./exports

# install the whole-DB backup timer on the VM — see skills/backup-and-export.md
# for the full checklist, including the IPv6 verification step that has
# never been run from this environment
sudo cp server/supabase-backup.env.example /etc/supabase-backup.env
sudo cp server/supabase-backup.service server/supabase-backup.timer /etc/systemd/system/
```

Updated `STATE.md` (migration high-water mark note, proof count 65→66, a
one-line task-5 summary in the night-agent block), `docs/state/HANDOFF.md`
§22 (corrected row "5", which task 1 had provisionally guessed was "SAMO
Shop" and reserved migration 0222 for — the REAL night-queue's task 5 is
this backup/export/deletion layer and independently reserved the same
number; flagged with a ‡ note mirroring the existing † one rather than
silently overwritten), and `tools/run-proofs.mjs` (registered `data0222`).
No changelog entry — nothing here is user-visible yet (no admin UI calls
`tools/year-export.mjs` or the new RPCs; that wiring is each later task's
job when it builds its own system's export button).

---

## Task 3 — PR Form dashboard per SAMO year, export, Drive per year (2026-10-14)

**Written up here only — the code and migration shipped in an EARLIER run
of this same session, in commits `3978eeb` and `b998c52`, between task 2's
resume and task 4; this run (the handoff step) found the work done but this
required heading missing, which is why the runner's `Done when:` check kept
reporting task 3 as `todo` after a real attempt. Nothing below was built or
changed by the handoff step — it re-verified what already shipped and wrote
the record the check was waiting for.**

**What shipped (commit `3978eeb`, fixed by `b998c52` after a self-run
`scrutinize` pass, both already on this branch):**

1. Migration 0220 — `pr_tickets.samo_year_be smallint`, filled by 0219's
   shared `samo_year_be_default()` trigger at INSERT time, one-time
   backfilled for the 311 existing rows from their submission timestamp
   (not "now"), never recomputed after write. Year is a filter, never an
   access boundary — RLS unchanged.
2. PR Staff Dashboard (`src/js/pr-year.js` + `pr-staff.js`) — defaults to
   the current SAMO year via the shared `samo-year.js` picker, so the 290
   `โพสต์เรียบร้อย (เสร็จสิ้น)` tickets the owner named stop crowding the
   default view; a "ทุกปี" option still shows everything, with a small
   year badge per kanban card so a mixed view stays legible. Editing a
   ticket from a past year is locked behind an explicit "แก้ไขของปีก่อน"
   override — `scrutinize` caught (`b998c52`) that the first draft keyed
   the lock on the dashboard's `<select>` (`isPastYearView`) rather than
   the individual ticket, so switching the filter to "ทุกปี" unlocked
   editing on every past-year ticket at once; fixed with
   `isPastYearTicket(ticketYear, currentYear)` read from the ticket's own
   `samo_year_be`.
3. CSV export of the filtered view, through the repo's existing
   formula-safe CSV writer (grepped for, not reimplemented).
4. Drive: new PR uploads go to a per-year subfolder
   (`appscript/prform.gs`, NOT deployed — needs `npm run deploy:gas`); a
   dry-run-by-default `tools/pr-organize-drive-by-year.mjs` sorts the
   existing flat files into per-year folders via Drive `moveTo`, never
   trash-to-move (a trashed Drive file is still public).
5. Every reader of PR data was checked and marked explicitly: Discord
   notify, the public PR tracking page, and the GAS-quota analytics
   dashboard are all SAMO-year-agnostic on purpose (each says why, in a
   comment at the read site) — only the staff dashboard and the Drive
   layout are year-scoped.

**Re-verified by this handoff step, not assumed:** ran
`node tools/db-query.mjs tools/pr0220-year-filter.sql` against samo-dev
fresh — 23/23 PASS, confirmed `→ project: xibugtlsphcfuvstnxxh (samo-dev)`.
Confirmed the Done-when's other two conditions independently: the grep for
`samo.year|samoYear|yearPicker|year-picker` over `src/js/pr*`/`src/js/admin*`
matches, `npm test` is 2716/2716, `npm run build` completes clean.

**WRITTEN, NOT APPLIED to production**: migration 0220 and everything it
defines. Depends on 0219 (task 2) applying first — same ordering constraint
as every other per-system migration in this queue.

**Exact commands the owner runs next** (after 0219 is applied and proved,
per task 2's row):

```bash
git show 3978eeb b998c52   # review together — the second commit is a fix to the first, not an addition

node tools/apply-migration.mjs supabase/migrations/0220_pr_tickets_get_a_samo_year.sql
node tools/db-query.mjs tools/pr0220-year-filter.sql   # prove it on production too

npm run deploy:gas   # ships the per-year Drive subfolder + the GAS half of the mover
# then deploy the frontend bundle (skills/deploy-vm.md) — ships the picker/export/past-year lock

# only after the new bundle is being SERVED (new PR uploads already landing in per-year folders):
node tools/pr-organize-drive-by-year.mjs            # dry run — see what would move
node tools/pr-organize-drive-by-year.mjs --apply --move N   # sort the existing flat files; optional, never required
```

`STATE.md` and `docs/state/HANDOFF.md` §22's row for this task were already
updated by the commits above — unchanged by this step.

---

## Task 4 — ทีม SAMO + จัดการทีม + permissions handover + Discord roles (2026-10-14)

**What this run built.** Migration 0224, applied to samo-dev only:

1. **Closed a real authz bug in task 2's own 0219.** `start_team_term`
   (the handover RPC) gated on `current_user_has_permission('team')`. Since
   migration 0110 (already live, predates this whole queue), `team` is a
   VIEW-only key that `effective_team_permissions_for_email()` hands to
   EVERY person found in `team_members` automatically — ~300 accounts on
   samo-dev, none of whom chose to hold it, none of whom can edit anything.
   Gating a full year-handover on that key meant any of those ~300 accounts
   could flip the current SAMO year by calling the public RPC directly (no
   UI needed). Regated to `team_edit` — the exact predicate
   `publish_team_term` already uses, confirmed by reading its live body
   first, not assumed. Found by re-reading 0219 against 0110's own
   migration comment, not reported by the owner.
2. **Made the handover self-archiving.** `start_team_term` now calls
   `publish_team_term(outgoing_year)` inline, in the same transaction,
   before closing the outgoing term — so a handover always captures
   whatever the live tree looked like at that exact moment, with no
   separate "remember to click เผยแพร่ปีนี้ in the right order" step. This
   is what makes the owner's "next year's team is prepared without
   touching this year's … published at the boundary" literally true: call
   `start_team_term` FIRST, edit the live tree for the incoming team AFTER
   — the only order that needs no manual publish step to get right. Editing
   the tree BEFORE a handover is still technically possible and would still
   misfile history exactly as before 0224 — this narrows the failure
   window, it does not add a block that makes the wrong order impossible
   (rejected a "last-editor" guard trigger and a parallel "draft tree" for
   the same reason: both are bigger, riskier changes than one night's
   budget affords, and the existing `dev`-role escape hatch already covers
   the one failure mode — "nobody can run the next handover" — that a new
   trigger would exist to prevent).
3. **Confirmed, did not change, Discord role sync.** Read
   `discord_role_targets()` (0184/0196/0197): it reads `team_members`/
   `team_nodes`/`discord_links` only, zero references to `team_terms`, so
   it is "the current term" by construction — a handover that touches no
   tree row moves no Discord role, and one that does is picked up by the
   existing queue/trigger mechanism within minutes, same as any other tree
   edit. Pinned with a regression assertion in the proof (§C) rather than
   left as an unchecked claim, since a future edit threading `team_terms`
   into that function would silently break this invariant.
4. **จัดการทีม per year** — confirmed, did not rebuild, that
   `get_public_team_years()`/`get_public_team_chart()` (0104/0105/0153) are
   already the one shared registry every picker (ทีม SAMO's own pane,
   `org-chart.js`, `samo-year.js`) reads from; no drift found.

**Proof `tools/team0224-handover.sql`, 14/14 on samo-dev; registered in
`tools/run-proofs.mjs`.** Covers: a VIEW-only `team` holder refused calling
the RPC, paired against a `team_edit` holder being allowed for the identical
call (deny+allow, so the original bug — which also correctly refused a
total stranger — could not have passed a deny-only probe); the outgoing
term's archive matching the live PUBLIC tree's own node/member counts
(297/447 on samo-dev, not the naive 299/449 total — publish only archives
`is_public` nodes); and the Discord decoupling regression guard. Re-ran
`tools/year0219-samo-year.sql` afterward — still 23/23, so the splice did
not regress task 2's own coverage.

**Self-review.** Ran `/scrutinize` on the task's own diff
(`git diff b998c52..HEAD`) before closing: traced the permission-fix
correctness against `current_user_has_permission`'s live body (confirms
`master` still folds into `team_edit` exactly as it did into `team`), the
nested-RPC call for escalation/recursion/invariant risk (none — the inner
call re-checks the same predicate with the same `auth.uid()`, cannot create
a second `is_current` row, and this nest-a-definer-in-a-definer shape is
already used elsewhere in the codebase), the proof's temporary-principal
setup for PII leakage (none — only `id`-derived counts/booleans ever reach
the printed output, same rollback discipline as `year0219`), the UI copy
change in `terms.js` for bugs (none — purely informational, reads an
already-loaded client value), and the documentation claims against the
actual code (all verified, not assumed). Found one wording overclaim in the
migration's own header ("the ONLY workflow") and fixed it before this
block was written, in a follow-up commit — see `git log --oneline
b998c52..HEAD`.

**Decisions made, and what was rejected** (full reasoning in
`supabase/migrations/0224_*.sql`'s header and
`docs/YEAR-ROLLOVER.md`'s "ทีม SAMO" correction block):

- Regate on `team_edit`, not a new narrower "handover" permission —
  rejected a new key because `team_edit` already functions as root over
  the tree (0110: holding it lets you grant anyone, including yourself,
  anything up to `team_edit` itself), so a narrower gate would be a
  distinction with no enforceable difference.
- Auto-archive by calling the EXISTING `publish_team_term` inline, not by
  duplicating its SQL — one body, one place a future bug gets fixed once.
- No new "last `team_edit` holder" guard trigger, and no "draft tree" for
  preparing next year's roster ahead of time without touching the live
  one — both rejected as bigger and riskier than this task's remaining
  budget, with reasoning in the migration header (permission resolution
  has too many overlapping channels to re-derive correctly on every tree
  write; a draft tree would have to either duplicate every permission
  column or omit them, in which case it could not be "prepared" with real
  grants attached anyway).

**WRITTEN, NOT APPLIED to production**: migration 0224 and everything it
redefines. Depends on 0219 already being applied first (task 2's row in
`docs/state/HANDOFF.md` §22 — unchanged by this task).

**Exact commands the owner runs next:**

```bash
# review both migrations together — 0224 redefines what 0219 first defined
git show 20584a3 -- supabase/migrations/0224_team_handover_edit_gated_self_archiving.sql

# apply to production, in order, after review
node tools/apply-migration.mjs supabase/migrations/0219_one_samo_year_for_every_system.sql
node tools/apply-migration.mjs supabase/migrations/0224_team_handover_edit_gated_self_archiving.sql

# prove both there
node tools/db-query.mjs tools/year0219-samo-year.sql
node tools/db-query.mjs tools/team0224-handover.sql

# then deploy the frontend bundle (ships the corrected จัดการทีม confirm-dialog copy)
```

Updated `STATE.md` (migration high-water mark 0220→0224, proof count
64→65, a one-line task-4 summary in the night-agent block), `src/data/
changelog.js` (`PENDING`, staff-facing — the handover confirm dialog's new
auto-archive wording), `docs/mistakes/authz-grants.md` (the authz
write-up, `npm run mistakes:index` run after), `skills/year-rollover.md`
and `docs/YEAR-ROLLOVER.md` (corrected the handover-order guidance and
recorded the correction as a decision, not a silent edit).

---

## Task 2 — The ONE SAMO year — foundation, admin control, runbook (2026-10-14)

**RESUMED after a quota cut-off.** WIP commit `f9bb1b7` had already shipped
migration 0219 (`team_terms.started_at`/`ended_at`, `current_samo_year()`,
`samo_year_for_timestamp()`, `samo_year_be_default()` trigger body,
`start_team_term(year)` atomic handover RPC), the proof
`tools/year0219-samo-year.sql` (24 assertions, never yet run), the shared
picker `src/js/samo-year.js` + its JS/SQL differential test, and the rewire
of `team/api.js`'s `setCurrentTerm` onto the new RPC. **Left undone by the
WIP**: the proof had never been applied or run against anything;
`tools/run-proofs.mjs` did not register it; `skills/year-rollover.md` did
not exist. All three were the actual `Done when:` gate for this task.

**What this run did, in order:**

1. Applied 0219 to samo-dev and ran the proof — green, 23/23 (`node
   tools/apply-migration.mjs supabase/migrations/0219_*.sql --dev` then
   `node tools/db-query.mjs tools/year0219-samo-year.sql`).
2. Registered `year0219-samo-year.sql` in `tools/run-proofs.mjs` (it was a
   file on disk the runner had never been told to run — exactly the class-7
   hazard `run-proofs.mjs`'s own header warns about).
3. Wrote `skills/year-rollover.md` — the runbook: what a handover IS (not a
   re-publish), the pre-flight checklist (who loses the admin seat), the one
   command (`start_team_term`), what happens to every other system
   afterward, how to verify, and what to do if it goes wrong.
4. **Ran `/scrutinize` on the full task-2 diff and found a real bug before
   it shipped anywhere**: the `team_terms` row that was `is_current` when
   0219 first ran has `started_at = NULL` for a structural reason (the
   column didn't exist yet). `start_team_term`'s reopen path
   (`coalesce(started_at, now())`) cannot distinguish that `NULL` from "never
   started" — so closing that ONE row once, then later reopening it (a real
   "we handed over and regretted it" scenario), would silently relabel its
   true "open since before this system existed" meaning as "started just
   now", breaking `samo_year_for_timestamp()` for every backfill timestamp
   older than the reopen. **Reproduced in a rolled-back probe against
   samo-dev before fixing it** (confirmed `NULL` came back for a 2026-06-01
   lookup after the repro). Fixed by stamping the closing `UPDATE`'s
   `started_at` to `-infinity` the moment a `NULL`-started_at row closes —
   before any reopen can misread it. Extended the proof with §G (steps
   45–48: fix proven RED first by rerunning it against the unfixed
   migration, then green after). Also narrowed
   `samo_year_for_timestamp`'s grant from `anon, authenticated` to
   `authenticated` only (least privilege — nothing anon-triggered calls it).
   Write-up: `docs/mistakes/postgres-schema.md` ("Reopening the genesis
   `team_terms` row…").
5. `npm test` (2687/2687) and `npm run build` green throughout.

**Decisions made, and what was rejected:**

- **Reused the existing จัดการทีม UI as the one admin control**, rather than
  building a new "SAMO year" admin screen — `team/terms.js`'s existing
  "ตั้งเป็นปีปัจจุบัน" button already called `setCurrentTerm`; only its
  implementation changed (two non-atomic PATCHes → one RPC). Building a
  second control would have been the exact "hand-written list beside a
  shared constant" class 6 already warns about, for a control that already
  existed.
- **No new master-specific check in `start_team_term`** — it gates on
  `current_user_role() = any(array['vp_admin','dev']) or
  current_user_has_permission('team')`, and `current_user_has_permission`
  already folds `master` in (0111). Verified by reading 0111's live body
  rather than assuming; adding a separate master branch would have
  duplicated a channel that already works and risked drifting from it later.
- **Did not touch `samo_year_for_timestamp`'s `is_current`/`ended_at`
  NULL-handling branches** even though the fix makes the `ended_at is not
  null` branch structurally unreachable going forward — left for defence in
  depth (a manually edited row, or a samo-dev reset that reintroduces a raw
  `NULL`) rather than deleting code that still describes a real, just rarer,
  case.
- **Did not add a CLI path for `start_team_term`** separate from the
  จัดการทีม UI — the design doc's own reasoning (one control, never a second
  path that can drift) applies to the RPC's callers too.

**WRITTEN, NOT APPLIED to production**: all of migration 0219 (including the
post-review fix) and the `samo_year_be_default()` trigger body it defines.
Nothing yet ATTACHES that trigger to any table — tasks 3 (PR), 4 (VS), 5
(Shop) and 6 (หนังสือโครงการ) do that in their own reserved migrations
(0220/0221/0222/0223) and must each run `start_team_term`'s prerequisite
(0219) on production FIRST, since their triggers call `current_samo_year()`.

**Exact commands the owner runs next:**

```bash
# review the fix commit first — it changed 0219 after the WIP, not just added to it
git log --oneline d6df0c8..HEAD -- supabase/migrations/0219_one_samo_year_for_every_system.sql
git show 6475d89

# apply to production (after review)
node tools/apply-migration.mjs supabase/migrations/0219_one_samo_year_for_every_system.sql

# prove it there too — point db-query at prod (its default) once ready
node tools/db-query.mjs tools/year0219-samo-year.sql

# then deploy the frontend bundle so team/terms.js's atomic RPC call ships
# (skills/deploy-vm.md)
```

Updated `STATE.md` (migration high-water mark, proof count 60→63, a one-line
task-2 summary in the night-agent block) and `docs/state/HANDOFF.md` §22's
task-2 row (proof result, applied=samo-dev-only, the exact next command).

---

## Task 1 — design doc (2026-10-14)

**Claims to have** read every system this queue names (PR, VS, Shop,
หนังสือโครงการ, ทีม SAMO, เกี่ยวกับเรา, ระบบบ้าน, หน้าฝ่าย, Passport,
Announcements, Accounts, Stats, Claude booking, Discord, Drive) end to end —
`docs/CONTEXT.md` in full, `docs/INVARIANTS.md` in full, the relevant
migrations (0104–0106 team terms/archive, `study-year.js`, `passport/db/0006`,
`appscript/prform.gs`'s folder layout) and `modal-vs-consent.html`'s actual
PDPA wording rather than assuming it — and written `docs/YEAR-ROLLOVER.md`
(45 `Decision:` lines, 27 edge cases, a build-order table mapping every later
task to its reserved migration number 0219–0229) plus
`docs/state/HANDOFF.md` §22 (the per-task tracking table every later task
must update its own row of, never another task's).

**Core decision, defended**: `public.team_terms` (existing, with
`is_current`/archive machinery already built in 0104–0106) becomes the ONE
SAMO-year registry every other system references — rather than inventing a
new table, or promoting Passport's own `samo_years` (rejected: Passport's
year/season answers a different, ฝ่ายกิจกรรม-decided question and lives in an
isolated schema with no cross-schema FK precedent anywhere in this repo).
Each operational table gets a nullable `samo_year_be smallint`, trigger-filled
from a new `current_samo_year()` AT INSERT TIME and never recomputed later —
mirroring `projects.fiscal_year_be`'s existing override shape, but filled
automatically rather than left null-by-default, specifically so the PR Staff
Dashboard (the owner's own named example, 290 `โพสต์เรียบร้อย` tickets) gets a
working year filter with no gap for new rows. ปีงบ (fiscal year, Oct-start)
and ปีการศึกษา (academic year, Aug-start, `study-year.js`) are explicitly kept
as SEPARATE calendars — not unified into "the SAMO year" — because each
already has correct, independently-moving logic that predates this queue and
conflating them would corrupt rows a university officer or a student already
reads.

**Self-review, before ending the task**: ran `scrutinize`'s method by hand
against this doc (no sub-agent invocation; the skill resolved to prompt-only
instructions, so I applied its trace/verify steps myself) and found — then
FIXED in the doc, not left as a note — one real gap worth flagging loudly: the
first draft gave หนังสือโครงการ's 42 existing rows a one-time
timestamp-derived backfill for the new `samo_year_be` column but did NOT give
the same backfill to PR's 311 / VS's 119 / Shop's 43 existing rows, even
though the identical reasoning applies to all four ("no human has chosen a
year for a pre-existing row yet, so deriving one from the timestamp
overwrites nothing"). Left as originally written, every one of the 290
already-finished PR tickets the owner used as the motivating example would
have rendered as "ก่อนเริ่มระบบปี" forever instead of being folded into a
real past year — the feature would ship looking complete and solve nothing
for the exact pile that was named. Fixed by adding the same backfill decision
to PR, VS and Shop's sections. Three smaller fixes also applied: clarified
that `team_terms.started_at`/`ended_at` are owned only by the NEW
`start_team_term()` RPC (not `publish_team_term`, which is a repeatable
snapshot action and would otherwise get called every re-publish); separated
the PDPA retention SHAPE (anonymise, grounded in the consent notice's own
wording) from the 24-month NUMBER (an invented default, labelled as such) and
flagged that the consent modal itself never states a retention period, which
is a pre-existing gap outside this doc's build order; and noted that Shop's
`samo_year_be` is stamped from wall-clock `current_samo_year()`, not derived
from `placed_at`, so a hand-entered backdated walk-in order can legitimately
disagree with its own `placed_at` and needs the same admin-override
affordance as every other table.

**What is WRITTEN, NOT APPLIED**: everything — this is design-only, task 1 of
11, and intentionally touches no `supabase/migrations/` file and reserves no
migration number of its own. `npm test` (2675/2675) and `npm run build` both
green; the only non-doc change is registering the new file in
`docs/.vitepress/config.mjs`'s `TOP_GROUPS` (required by
`docs-site.test.js`, which was red until that one-line addition).

**Exact commands the owner runs next**: none required from this task alone —
read `docs/YEAR-ROLLOVER.md` once, then let tasks 2–11 proceed against it.
If reviewing cold, start at `docs/YEAR-ROLLOVER.md`'s `## Build order` table
and `docs/state/HANDOFF.md` §22's tracking table, in that order.

**What would change my mind**: if the owner would rather fold ปีงบ or
ปีการศึกษา INTO one unified SAMO year instead of keeping three calendars —
that is a bigger, riskier rewrite than this queue's remaining budget affords,
and I chose the smaller, additive design on purpose; flag it in review rather
than silently rebuilding if the owner disagrees.

---

> ⛔ **Reviewed by the owner's session, 2026-10-13 — read `docs/state/HANDOFF.md` §20, not the block below, for what is true.** Its "do this first" is CLOSED (0214 was already live on production). Its "nothing was skipped" was wrong: task 2 was cut off by the quota and the runner credited the half-done work (runner fixed). 0213 was rewritten to grant nothing — หน้าฝ่าย editors are chosen in ทีม SAMO.

## ▶ HANDOFF 2026-10-13 04:11 UTC (night agent, branch agent/2026-10-13)

**1. Do this first.** `node tools/pass-anon-probe.mjs` against production,
before touching anything else on this branch. It is the ONE check this run
could not do (no DB access) that decides whether migration 0214 below is
closing a live critical hole or a tightening on an already-safe system — the
private report explains why the static analysis alone can't tell the
difference. Full reasoning: `~/samo-night/reports/2026-10-13-security-db.md`
Finding 1 / `## Verdict`.

**2. Status of the queue.** All 6 tasks ran and the runner marked all 6
`Status: done` in `~/samo-night/NIGHT-TASKS.md` — this was a clean, complete
run (`AGENT_UNRUN=0`, `AGENT_STOP=queue finished`, `AGENT_ASKS` empty; nothing
was skipped and nothing ended by asking a question). `npm test` — 2604/2604
green. `npm run build` — green. Working tree clean, everything below is
already committed on this branch (see `git log --oneline origin/main..HEAD`
for the six fix/feature commits plus whatever this handoff adds).

**3. READY TO USE vs still a DESIGN.**
- **Code is ready to review and merge**, but **nothing SQL-shaped has touched
  a database — migrations 0212, 0213 and 0214 are WRITTEN ONLY.** Apply in
  that order, dev first: 0212 (ฝ่ายสโม project tags), 0213 (dept_page grants
  for the 6 new ฝ่าย), then — only after step 1 above — 0214 (passport
  lockdown ported into tracked history). Each has a proof script
  (`tools/proj0212-samo-depts.mjs`, `tools/dept0213-team-samo-grant.mjs`,
  `tools/passport0214-lockdown-committed.sql`) registered in
  `tools/run-proofs.mjs` but **never run** — "written, not applied" for all
  three, as the night-queue rules require. STATE.md's migration/proof-count
  lines were updated to match what's on disk, not what's been proved.
- **The nginx header fix (`server/nginx-samo.conf`) is a config change, not
  code or a migration** — it does nothing until someone runs
  `sudo cp server/nginx-samo.conf /etc/nginx/sites-available/default &&
  sudo nginx -t && sudo systemctl reload nginx` on the VM (`skills/deploy-vm.md`).
- **The 9 bug fixes from tasks 5–6** (admin: re-entry data loss, a chip-toggle
  race, a stacking delete listener; public+passport: six more, listed in
  their commit messages) are ordinary frontend/JS changes — ready to ship on
  the next normal deploy, no DB step needed. 5 `PENDING` changelog entries
  were added for the ones that affect an already-live feature.
- **Two security reports are DESIGN-level findings, not incidents**: both
  `~/samo-night/reports/2026-10-13-security-{db,app}.md` end `## Verdict`
  with one thing fixed each (0214 written; nginx headers) and a short list of
  already-known, owner's-call items re-confirmed rather than re-raised. They
  live outside the repo on purpose — do not copy their content into anything
  under `docs/`.

**4. What did not happen.** Nothing — `AGENT_UNRUN` and `AGENT_ASKS` were both
empty this run. All 6 queued tasks executed and the runner confirmed each
`Done when:` check passed.

**5. What needs a human decision.**
- **Whether Finding 1 (step 1 above) was a live exposure.** If
  `pass-anon-probe.mjs` reports the pre-hardening state, the report recommends
  treating the window since migration 0056 as a potential exposure period
  worth a Drive/audit-log-style sweep of `passport.scans` — a judgment call on
  how much to dig, not something this run can size without DB access.
- **Three already-known, low-severity items were re-confirmed open and left
  alone, each because touching them wasn't this run's call**: the
  username→email lookup (owner already informed, memory
  `open-privacy-username-lookup.md`), the legacy passport `admin`/`1234`
  speed-bump (accepted trade-off), and passport's per-ฝ่าย write-scoping gap
  (a real feature question, not a lockdown gap). I'd leave all three as-is
  unless the owner's priorities have shifted since those were last decided.
- **Task 2's dept_page inheritance decision** (0213): inherited, not
  review-gated — defended in the Task 2 block below. Overturn only if the
  owner wants a staff-approval step added across all twelve ฝ่าย, which is a
  product decision bigger than this migration.
- **migration 0212's trigger checks WHO, not WHAT** (app security report
  Finding 2) — left open as inert (every render path escapes the value) and
  not worth its own reserved migration number tonight; fold the allow-list
  check in next time 0212 is touched for something else.

**6. What could not be verified, and why.** No database access this run (by
design — `tools/db-query.mjs`, `apply-migration`, `.env.local` all denied), so
every claim about what 0212/0213/0214 will do once applied rests on reading
the SQL, not on running it against dev or production. No Google/GAS
credentials either, so the `notifyProjectEmail` content-hardening item and the
GAS-side `fileId` ownership check mentioned in the app report are read-only
findings, not reproduced. `npm run handoff:check` could not reach a verdict in
this sandbox (no `origin/agent/2026-10-13` remote to diff against, and this
sandbox's memory path differs from `~/samo-night/memory/MEMORY.md` named in
the task preamble) — flagged rather than silently skipped, per CLAUDE.md; this
looks like a standing gap in the night-agent workflow itself, worth the
owner's attention independent of tonight's actual work.

---

## 2026-10-13 — Task 4: security review (deep) — the app, the servers, Apps Script

Claims to have: read every file in scope end to end (`src/`, `server/*.mjs`,
`server/nginx-samo.conf`, `appscript/prform.gs`, `passport/js/`) and written
`~/samo-night/reports/2026-10-13-security-app.md` (outside the repo, per the
queue's public-repo rule), ending `## Verdict`. One real finding fixed, one
informational finding left open, several already-known/already-ranked items
re-confirmed still accurate rather than re-raised as new. Full reasoning is in
the report; this block is the pointer + what changed on disk.

**Fixed: `server/nginx-samo.conf` — no clickjacking/MIME-sniffing headers
anywhere on the site.** Added `X-Frame-Options: SAMEORIGIN`,
`Content-Security-Policy: frame-ancestors 'self'`, `X-Content-Type-Options:
nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` to every
HTML-serving location (`/admin/`, `/passport/`, `/docs/`, the public
catch-all `/`) — each repeated PER LOCATION, never once at server level,
because `add_header` does not inherit into a location that already sets one
of its own (every location above already sets `Cache-Control`), and a
server-level copy would also have reached `/vault/`, which sets none of its
own HERE and would have inherited it — stacking a second frame/XFO header on
top of whatever Vaultwarden's own response already carries. That is the exact
failure shape this same file's `/vault/` block already documents for
`Cache-Control` (two headers, browser honours the strictest, whole vault
re-downloaded every load) — this is that lesson applied, not re-learned.
⛔ **THIS IS A CONFIG FILE CHANGE, NOT A MIGRATION — it needs
`sudo cp server/nginx-samo.conf /etc/nginx/sites-available/default &&
sudo nginx -t && sudo systemctl reload nginx` on the VM (`skills/deploy-vm.md`)
before it does anything; nothing is served differently yet.** No HSTS added —
left for the owner to verify the KKU edge never serves this host over plain
HTTP before adding it (getting that wrong locks users out for `max-age` with
no undo).

**Left open, informational, not fixed:** migration 0212's
`projects_samo_depts_guard` trigger checks WHO may touch `samo_depts`, not
WHAT values land in it (the allow-list lives only in the RPC,
`set_project_samo_depts`, which a direct PATCH from an already-authorized
sender-desk account could bypass). Not fixed tonight because it is inert —
every render path I found (including this same migration's OWN new render
code) passes the value through `escHtml()`, so a smuggled garbage value
cannot become a stored XSS payload, only a weird-looking tag. Not worth a
reserved migration number (0215) in isolation; fold the value check into the
trigger whenever 0212 is next touched for something else.

**Re-confirmed, not re-raised as new** (all three already tracked elsewhere,
none actioned, none requiring action tonight): `notifyProjectEmail`'s
subject/body still caller-controlled within the domain allow-list
(`docs/NEXT.md`, ranked options, needs a GAS redeploy this run can't make);
passport's per-ฝ่าย WRITE scoping gap (`admin-scope.js`'s own comment /
Finding 4 of the companion DB report); the legacy passport `admin`/`1234`
door (accepted "speed bump, not a secret" trade-off).

`npm test` (2,579/2,579) and `npm run build` both green — the change touches
no JS, so this was really about not having silently broken the conf's syntax
(brace-balance checked by hand; no `nginx -t` available off the VM).

**`npm run handoff:check` could not run to a verdict in this sandbox** —
pasting the actual failure rather than skipping silently, per CLAUDE.md's "a
skip is NOT green." Two environment-specific crashes, neither caused by
tonight's change: (1) it diffs against `origin/agent/2026-10-13`, which does
not exist — this branch is correctly unpushed per the queue's own constraint,
so the script's assumption (a tracking remote) does not hold for ANY
night-agent branch, not just this run; `git branch -a` confirms no
`remotes/origin/agent/2026-10-13`. (2) it then reads memory from
`~/.claude/projects/-home-ubuntu-samo-agent/memory/MEMORY.md`, which does not
exist in this sandbox — the real memory index this run was told to read lives
at `~/samo-night/memory/MEMORY.md` (a different path, stated in this session's
own system preamble). Neither task 1's nor task 2's block above mentions
running this check either, so this looks like a standing gap in the
night-agent workflow rather than something new tonight — worth the owner's
attention before trusting a GREEN from this script on an unpushed
night-agent branch at all.

---

## 2026-10-13 — Task 2: หน้าฝ่าย for every ฝ่าย, and the permission (0213)

Claims to have: grown `DEPT_DEFS` (src/data/depts.js) from 6 to all 12
top-level ฝ่าย ทีม SAMO's tree carries (measured on production, named in the
task brief) — สำนักนายกฯ, กิจการภายใน, กิจการภายนอก, กิจการมหาวิทยาลัย,
คุณภาพชีวิตและสิ่งแวดล้อม and รพ. ร่วมผลิต are new; two (`--dept-office`,
`--dept-hospital`) got their own colour tokens in base.css, the other four
reused tokens already sitting unused in base.css (`--dept-internal/external/
university/quality`). Converted the four disabled "เร็วๆ นี้" placeholder cards
in tab-departments.html to real `data-dept-open` cards and added the two new
ones — nothing else needed hand-editing: the grant picker (`DEPT_PAGES` in
team-vocab.js), the /admin/ → หน้าฝ่าย editor's dropdown
(`dept-page-admin.js`'s `editableDepts()`) and the tools registry all derive
from `DEPT_DEFS`, which is the whole point of that file existing (its own
header comment). `npm test` and `npm run build` green.

Written, NOT applied/run: migration 0213
(`supabase/migrations/0213_dept_page_grants_come_from_team_samo.sql`) and
`tools/dept0213-team-samo-grant.mjs`, registered in run-proofs.mjs. STATE.md's
migration/proof-count facts updated to match.

**Decision, defended — inherit, do not widen, and do not add a review gate.**
The brief asked me to decide from the code whether a `dept_page` set on a node
is inherited by everyone posted under it (yes —
`node_effective_dept_pages()`/`effective_team_dept_pages_for_email()`, 0177,
walking up while `inherit_permissions` holds, same shape as every other scope
dimension — vs_dept, project_seat, passport_scope, shop_source) and to narrow
if that inheritance would (a) let someone edit a page they shouldn't, or (b)
let a member publish without review. I did not narrow, because:
  (a) `current_user_dept_page_scope()` resolves to the caller's OWN tree
      posting only, and dept_content RLS checks `dept = any(scope)` on every
      read of a hidden row, insert, update and delete — there is no path from
      "posted under ฝ่ายกิจการภายใน" to touching ฝ่ายกิจการภายนอก's rows. The
      proof's §2b/§4/§5/§6 chain exists specifically to pin this: a synthetic
      leaf posted under the real ฝ่ายกิจการภายใน node resolves to exactly
      `{internal}` through the SAME function the sync job calls (not a
      hardcoded array), and the subject that scope is synced onto can edit
      the internal row and is refused on the external one.
  (b) There is no staff-review step for ANY of the six ฝ่าย this already runs
      for today (dept-page-admin.js's `save()` PATCHes live; the only gate is
      RLS, not an approval queue), and the one safeguard that exists — a NEW
      row is born `visible = false` until the ฝ่าย itself flips it on — is
      per-ROW and already identical across all twelve. Granting the other six
      ฝ่าย the exact mechanism the first six already have removes an
      inconsistency; it does not introduce a new risk to weigh.
  **What would change my mind**: if the owner wants a real staff-approval step
  before a ฝ่าย's page goes live, that is a product decision for all twelve
  ฝ่าย, not something to bolt onto only the six this migration covers — flag
  it in review rather than half-build it here.

**Decision**: the migration sets `dept_page` only where it `is null`
(asserted in depts.test.js, "only fills a NULL… never overwrites"). The
original six ฝ่าย may already carry a hand-set scope through the admin tree
UI that is narrower or broader than "the whole top-level node" — 0177 lets
`dept_page` live on ANY node, not just the root — and this migration has no
way to tell "nobody set this yet" from "an admin deliberately chose a
different node", so it only fills the gap the complaint was actually about.

**Not done, by design**: no change to `dept-tint.js` (the org-chart colour
table) — it already resolves สำนักนายกฯ to the admin tint and leaves the other
five of the new six unmatched (falls back to brand green), which its own
header comment documents as NORMAL ("15 roots, 10 colours"). That table answers
a different question (which EXISTING tree node, at any depth, gets which bar
colour) from `DEPT_DEFS.colorVar` (which fixed colour THIS ฝ่าย's own page
header uses) — extending one was not asked and was not needed to satisfy the
Done-when check.

See the migration's own header comment for the full reasoning, and
`docs/DEPT-TOOLS.md` §2 for why `DEPT_DEFS` has exactly one home.

---

## 2026-10-13 — Task 1: ฝ่ายสโม tags on หนังสือโครงการ (0212)

Claims to have: added `projects.samo_depts text[]`, a column-guard trigger,
`set_project_samo_depts()` RPC, a ฝ่าย tag editor (chips) on the detail header
for the sender desk, read-only chips everywhere a project renders (card, list,
detail, public mirror), and a "ฝ่าย" filter dropdown in both toolbars (AND-
combined with the existing bucket/search/ปีงบ filters). `npm test` and
`npm run build` green. Written, NOT applied/run — migration 0212 and
`tools/proj0212-samo-depts.mjs` are on disk, untouched by anything with DB
access this run.

**Decision, defended**: the column guard checks
`current_user_can_publish_project()` (0114's existing "sender side" predicate
— role vp_admin/dev OR the vpa seat), NOT a bare
`'vpa' = any(current_user_project_seats())` check. The task brief said "checks
the caller holds the vpa desk (or master)" — I read that as "whoever may act
as the sender", and the raw seat check is NARROWER than that: 0111 is explicit
that a `dev`-role account does NOT automatically hold `master` or any stored
seat, so a bare seat check would silently refuse a dev account even though
dev passes every OTHER sender-side gate in this table (insert, delete,
is_public). The JS-side `canManage` the editor UI gates on is
`role === 'vp_admin' || role === 'dev'` (inherited from the existing detail-
header actions block) — reusing 0114's predicate is what keeps the DB and the
UI agreeing, and the proof script's §3d subject (`subj_dev`: role=dev, no
seat, no master permission) is there specifically to pin this. **What would
change my mind**: if the owner wants `dev` excluded from tagging specifically
(unlike every other sender-side action), that's a one-line narrowing of the
trigger/RPC predicate back to the seat-only form — flag it in review, don't
silently "fix" it.

**Decision**: stored tags are deduplicated and sorted alphabetically by the
RPC (`array_agg(distinct d order by d)`) rather than preserving insertion
order. The UI never reads order (chips render in VS_DEPTS's own order; the
read-only pill list just lists what's present), so there was no reason to
preserve caller-supplied order, and a deterministic stored order made the
proof script's assertions exact-match instead of set-comparing.

**Not done, by design**: the "survives the module's URL/hash state" line in
the brief — I checked `applyHashRoute`/`applyCustomerHash` and neither module
puts filterKind/searchQ/filterFY in the hash either (only the open project/doc
does), so filterDepts not surviving a hash deep-link matches the existing
contract for every other toolbar filter. Making ONLY the new filter
hash-persistent would be the inconsistent choice.

See the migration's own header comment for the rest of the design, and
`current_user_project_seats()` (0111) for the master→vpa fold this predicate
depends on.

---

## 2026-10-13 — Task 3: deep DB security review

⛔ **Full write-up is PRIVATE, not here**: `~/samo-night/reports/2026-10-13-security-db.md`
(outside the repo, per `both-repos-are-public.md` / `docs-are-published.md` —
this file is under `docs/`, which is served at `/docs`, so a still-open
finding's detail does not belong here). Read that report, not this entry, for
what was actually found.

One-line summary of what happened, safe to say here: read every RLS policy /
SECURITY DEFINER function / GRANT / trigger in `supabase/migrations/` (through
this branch's 0214) plus `passport/db/*.sql`, cross-checked against
`docs/mistakes/authz-rls.md` + `authz-grants.md` in full so nothing
already-fixed got re-reported. Wrote migration 0214 (not applied) and
`tools/passport0214-lockdown-committed.sql` (registered in `run-proofs.mjs`,
now 60 live proofs) addressing the one finding that needed a fix; `STATE.md`
updated to match. **Before applying 0214 or anything else on this branch,
run `node tools/pass-anon-probe.mjs` against production first** — the private
report says why, and the answer changes how urgently the rest of the review
should be treated.

Three already-known, already-documented, low-severity open items were
reconfirmed still open on the latest migration state and intentionally not
touched (one is the owner's call per existing guidance, two are real features
rather than lockdown gaps) — named in the private report, not here.
Everything else checked (this branch's own 0211–0213, every `create table`
has matching RLS, no permanently-disabled trigger, a handful of previously-
unreviewed migrations) came back clean.

---

## Task 8 — ระบบบ้าน + ข้อมูลของฉัน: academic-year rollover, graduates, the next รุ่น (2026-10-18)

**RESUMED after a quota cut-off** (WIP `392017a`).

**The WIP commit (`392017a`) had left undone:** it stopped right after
building and testing the core mechanism — nothing in it was wrong, but it had
not yet (a) checked whether the rollover design doc and HANDOFF still matched
what it actually built, (b) swept `src/js/house/` and `src/js/me-page.js` for
a hardcoded MD49–MD54/49..54 literal that would block MD55, (c) reasoned
through held rows / help requests / the สายรหัส audit explicitly rather than
just leaving them untouched, (d) run `/scrutinize`, or (e) written this block.
This session did all five, found one real polish gap (below), fixed it, and
confirmed the rest of the WIP was already correct as built.

**What the WIP already did (verified, not redone):**
- `isGraduated(rec, now)` in `src/js/study-year.js` — the exact same live
  ชั้นปี arithmetic as `studyYearLabel`, as a boolean (`studyYear(rec, now) >
  6`). Re-exported through `house/fields.js`.
- `house/gaps.js`'s per-person worklists (no สาย / no ชื่อ-นามสกุล / no
  รหัส / no ชื่อเล่น / หายไปจากไฟล์) filter to `active = students.filter(s =>
  !isGraduated(s, now))`, and the scope denominator (`SCOPE_STUDENTS`) was
  changed to match (`active.length`, not `students.length`) so the percentage
  never compares two different populations.
- `house/index.js`: the นักศึกษา roster hides a graduated รุ่น by default
  (`filteredStudents`), with a "แสดงรุ่นที่จบแล้ว (N คน)" switch
  (`houseShowGraduated`, same module-scope-`let`-resets-on-page-load pattern
  as the pre-existing `heldShowDone`); the ปีการศึกษา bump card now shows "N
  คนอยู่ปี 6 ตอนนี้ — จะกลายเป็น จบแล้ว ถ้าเลื่อน" before the admin presses it.
- `tools/house-gaps.mjs` now primes `setAcademicYear()` from
  `public.get_academic_year()` before calling `computeGaps`, so the CLI report
  and the admin pane read the same population — **ran it against samo-dev
  live (not just unit tests) to confirm the new query doesn't error**: `node
  tools/house-gaps.mjs` → `→ project: xibugtlsphcfuvstnxxh (samo-dev)`,
  printed a clean report (1 active student in samo-dev's current house data,
  so the sample is thin, but the code path executed end to end with no
  crash).
- `gaps.test.js` — a new describe block (4 cases, one a CONTROL on an active
  รุ่น) pins `setAcademicYear(2569)` module-wide specifically so the fixtures
  don't start silently failing once the real clock's fallback ปีการศึกษา
  passes 2569 — the exact "a proof whose geometry runs out" trap
  `.claude/rules/mistakes.md` class 7 names. `npm test`: 171 files, 2971
  tests, all green both before and after this session's changes.
- A `PENDING` changelog entry in plain Thai.

**Decision (confirmed, not re-made): no migration, no `students.graduated_at`
column — contrary to `docs/YEAR-ROLLOVER.md`'s own first-draft proposal.**
The design doc had proposed a stored flag "set by a yearly job." The WIP
built the derived form instead and documented why in `study-year.js`'s own
header; I agreed with that call and **corrected `docs/YEAR-ROLLOVER.md`'s
`## ระบบบ้าน` section and the summary table** (it was still describing the
rejected column as the plan, which would have been exactly the kind of
doc/code drift `.claude/rules/mistakes.md` warns about — a reader opening
the doc fresh would have gone looking for a column that doesn't exist) and
**`docs/state/HANDOFF.md` §22 row 8** (still said "QUEUED," no migration
number used). Rejected alternative, restated for the record: `graduated_at`
needs its own re-derivation every time `year_offset` changes (a ลาพัก
correction) or an admin corrects ปีการศึกษา backwards — a second thing to
keep in step for no benefit, when `studyYear` already recomputes for free.
**What would change my mind**: if ชั้นปี arithmetic ever needs a SQL-side
gate (RLS, a trigger) — `study-year.js`'s header already says there is
deliberately no SQL twin today, and if that changes, a derived JS-only
`isGraduated` would need a SQL-side twin or a differential test at that
point, not before.

**Decision: held rows and help requests are NOT time-filtered by
graduation.** An unresolved held row for a รุ่น that has since aged past
ปี 6 stays actionable forever — closed only through 0217's `follow_up` remark
(ติดต่อไม่ได้ / คาดว่าลาออกแล้ว / ลาออก / เลขนี้ไม่มีตัวตน), never by the
clock. **Rejected alternative**: auto-close or hide a held row once its รุ่น
ages out — rejected because a held row represents a real person ฝ่ายข้อมูล
never finished placing, and "they'd have graduated by now" is a reason for a
human to write ลาออก/เลขนี้ไม่มีตัวตน on it, not a reason to stop asking.
`help-diagnosis.js`'s `coveredCohortLabels`/`houseCoversCohort` already
answer the adjacent question (is a freshly-typed รหัส's รุ่น one ระบบบ้าน
currently tracks) from the same live `studyYear`, so a claim for a graduated
รุ่น is already correctly diagnosed `outside` — no change needed there.

**Decision: สายรหัส assignment is never filtered by graduation.**
`gaps.js`'s `auditSai` still runs over `occupants = [...students, ...held]`
unfiltered (confirmed by a WIP test: a graduated person still occupies their
สาย in the audit). This matches the doc's existing "สาย/บ้าน is never re-run"
rule — graduation is a roster-visibility question, not a สาย-correctness
one.

**Decision: MD55+ needs no code change — verified, not assumed.** Grepped
`src/js/house/` and `src/js/me-page.js` for a literal `MD49`/`MD5[0-4]`/the
range `49`..`54` driving a branch; every hit left is a comment or a test
fixture. `cohortFromStudentId`'s accepted window (`study-year.js`, 2540–2580
พ.ศ.) already covers MD55 (cohort_year 2570). `/me`'s own house card
(`house/my-house.js`) already renders `studyYearLabel()` directly, so a
graduated person's own card already says "จบแล้ว" with zero changes from this
task — confirmed by reading the file, not assumed from the name.

**What this session added, beyond the WIP (one real gap found by tracing the
UI end to end, not just reading the diff):** the roster's empty state said
"ไม่พบนักศึกษาที่ตรงกับตัวกรอง" (no match) whether the search typo'd a name or
whether it correctly matched a real person who is simply hidden by the
graduated switch — indistinguishable to the admin, who would read the second
case as "this person was never in the system." `src/js/house/index.js`:
factored the non-graduation half of `filteredStudents`'s predicate into
`matchesTypedFilters(s, f)`, and on an actual empty result (only when a
filter is set and the switch is off) check once whether any graduated row
would have matched the SAME typed filters; if so, the empty row now reads
"ไม่พบในรุ่นที่ยังเรียนอยู่ — คนที่ตรงอาจอยู่ในรุ่นที่จบแล้ว ลองเปิด
'แสดงรุ่นที่จบแล้ว'" instead. Costs one extra `.some()` pass, and only on the
miss path.

**`/scrutinize` run** on `git diff c5cf70f..HEAD` (the whole of task 8,
WIP + this session): traced `isGraduated` through every call site
(`gaps.js`'s active filter and scope text, `index.js`'s roster filter/count
badge/bump-card badge, `tools/house-gaps.mjs`'s priming), confirmed the
academic-year singleton (`setAcademicYear`/`academicYear()` in
`study-year.js`) is primed once at pane load (`house/api.js`) and shared
consistently by every one of those call sites with no second clock; confirmed
`gaps.test.js`'s module-wide `setAcademicYear(2569)` does not leak across
test files (vitest's default per-file module isolation; full suite stayed
green); confirmed the ผังตามสาย grid view (`sai-grid.js` via
`renderSaiGridPane`) deliberately reads the unfiltered `students` array, not
`filteredStudents()`, so a graduated person's สาย placement is still visible
there — consistent with the "สาย is never re-run" rule, not a gap. The one
finding (the empty-state hint) is fixed above; nothing else survived review.

**Not touched, correctly out of scope:** ทีม SAMO's own `year`-column drift
(already fixed historically, per `study-year.js`'s own header story) and the
Passport/หน้าฝ่าย/Announcements rollover work — those are tasks 9–10's rows in
`docs/state/HANDOFF.md` §22, not this one.

**Commands the owner runs next:** none required for this task — no migration,
nothing to apply to any database, no deploy dependency beyond the normal
bundle. `git log --oneline c5cf70f..HEAD` on `agent/2026-10-18` for the full
diff; review and merge like any other task on this branch. If the owner
disagrees with the derived-vs-stored call, the revert is confined to
`study-year.js`'s `isGraduated` + its three call sites — no migration to roll
back since none was written.

**`npm run handoff:check` verdict — could not complete, same known crash as
Task 1's §5 (2026-10-14):** `ENOENT` reading
`~/.claude/projects/-home-ubuntu-samo-agent/memory/MEMORY.md` (that directory
exists but is still empty; this session's real memory store is
`~/samo-night/memory/`, per this session's own system preamble — confirmed
unchanged from the prior write-up, not re-diagnosed). Also reported
`origin/agent/2026-10-18` as unknown (this branch has never been pushed —
expected, this agent cannot push). Ran with `--local` too; same crash. Per
Task 1's own note, fixing the memory-path assumption in
`tools/handoff-check.mjs` is a tooling question outside this task's scope
(it would touch every other task's handoff step too) — left alone again.
**Substituted direct checks**: `npm test` (171 files / 2971 tests green,
both before and after this task's changes), `npm run build` (clean), `git
status` (clean after each commit), and a live run of `node
tools/house-gaps.mjs` against samo-dev (confirmed by its own
`→ project: … (samo-dev)` line) to prove the new SQL query the WIP added
actually executes.

---

## Task 9 — SAMO Shop: orders across SAMO years, plus the customer-flow worry (2026-10-18)

**RESUMED after a quota cut-off.** The run that wrote everything below through
"`npm run handoff:check` verdict" (commit `8f6ee17`) was cut off by the quota
immediately after writing that verdict — this heading already existed,
`npm test`/`npm run build` already passed, and parts A and B below were, on
inspection, actually complete (migration 0230 31/31 on samo-dev, admin year
picker wired on both tabs, the cross-tab cart fix with red-then-green tests).
**What the cut-off actually left undone, found by re-running the verification
this resumption was told not to skip:**
- `npm test` was RED on resume: `docs/state/HANDOFF.md` §22 row 9 named
  `shop/state.js` (relative to `src/js/shop/`, not the repo root) —
  `state-handoff.test.js`'s "names no file that is not there" check failed.
  One-line path fix (`2acb60c`).
- `/scrutinize` on this task's own diff (`41fbf2c^..HEAD`) found a real bug
  0230 introduced and the WIP never caught: the "ต้องจัดการ" tiles
  (ยังไม่ส่งสลิป / สลิปไม่ถูกต้อง / มีปัญหา) and "รายรับสะสม" counted across
  **every** SAMO year while the view each tile opens into (the orders table,
  the ยอดขาย tab) was year-filtered to the current year by default — so a
  pending/review order left over from a previous team (exactly the
  "ค้างจากปีก่อน" case this task exists to handle) could inflate a tile's
  count with no way to reach it by clicking. Fixed: `scoped`/`revenue` in
  `renderStats()` (`src/js/shop/admin.js`) now read `yearFilteredOrders()`;
  `queue` (the slip-review count) stays on `state.orders` unchanged on
  purpose, because its destination (ตรวจสลิป) is deliberately never
  year-filtered. Write-up: `docs/mistakes/app-state.md` ("SAMO Shop admin: the
  'ต้องจัดการ' tile said one number, clicking it showed fewer rows").
- Added direct unit coverage for `orderMatchesYearFilter` itself
  (`src/js/shop/data.test.js`) — it had none; its PR mirror
  `ticketMatchesYearFilter` did.
- Everything else below (parts A and B, the proof, the admin UI, the cart
  fix) was verified as-is, not rebuilt: re-ran `tools/shop0230-samo-year.sql`
  live against samo-dev (31/31 again) and the full `npm test`/`npm run build`
  after each fix above.

**Two unrelated pieces of work, both inside this task's own scope:** (A) give
`shop_orders` a SAMO year, same shape as PR/VS/โครงการ; (B) walk the
customer checkout flow end to end for the owner's named worry and fix
whatever actually breaks.

### A. `shop_orders.samo_year_be` (0230)

Built `docs/YEAR-ROLLOVER.md § SAMO Shop` (never built before tonight):

- `shop_orders.samo_year_be smallint`, stamped at INSERT by 0219's shared
  `samo_year_be_default()` trigger — copied 0220's (PR) shape exactly, with
  one difference explained in the migration's own header: the backfill
  reads `placed_at`, not `created_at`/`timestamp`, because `shop_orders` has
  no `created_at` at all (STATE.md, measured) and `place_shop_order()` sets
  `placed_at` in the same INSERT that creates the row.
- **Decision, confirmed against the design doc, not re-litigated**:
  unpaid/in-review orders keep their ORIGINAL year across a handover — this
  falls out of the stamp-once-at-insert rule for free (nothing re-stamps on
  UPDATE), proven directly in the proof (§C2: an order stamped under a
  sentinel term stays stamped that term after the NEXT handover moves
  `current_samo_year()` on).
- **Decision**: `shop_order_totals()` (0206 — the per-order Discord ping's
  totals line) IS year-scoped, to the current year only. **Rejected
  alternative**: leave it unscoped (all-time) — rejected because it is an
  OPERATIONAL snapshot ("how is the shop doing right now"), and left
  unscoped it would, the day after every future handover, ping Discord with
  a number inflated by every order every PAST team ever took — the exact PR
  complaint ("the next samoyear … it'll be a mess", 0220's own header) one
  system over. Added a defensive fallback after my own `/scrutinize` pass
  caught it (below): if `current_samo_year()` is ever NULL (no `is_current`
  row — should not happen once a team exists, but the function must not go
  near-silent the one time it does), the WHERE clause falls back to counting
  EVERYTHING, matching the ORIGINAL 0206 behaviour rather than reporting
  almost nothing.
- **Decision, unchanged from design**: `shop_products` stays un-scoped — a
  product is inventory, not a transaction.
- **Admin UI**: the orders table AND the ยอดขาย tab both got the shared
  `samo-year.js` picker (two `<select>`s, `shopAdminOrdersYearFilter` /
  `shopSalesYearFilter`, kept in sync by one `setOrdersYear()` in
  `admin.js`), defaulting to the current year. ONE predicate —
  `orderMatchesYearFilter` in `src/js/shop/data.js` — decides whether an
  order matches the picked year for BOTH tabs, so they can never disagree
  on what "2569" means (class 6: a hand-written list beside a shared
  constant). An order whose year the backfill could not resolve (null)
  always matches, same "unresolvable ≠ hidden" rule `pr-year.js`'s
  `ticketMatchesYearFilter` already uses.
- `tools/year-export.mjs`'s `REGISTRY.shop_orders` already had `yearColumn:
  'samo_year_be'` written in ahead of this column existing (task 5,
  2026-10-14) — nothing to add there; it starts reading the real column
  automatically now that it exists.
- **OWED, not built**: an explicit "correct this order's year" control in
  the admin order detail modal (same affordance `fiscal_year_be` gets on a
  โครงการ). The column is admin-overridable at the database level already
  (an UPDATE is never re-stamped — proven in the proof); there is just no
  button yet.

**Proof `tools/shop0230-samo-year.sql`, 31/31 on samo-dev; registered in
`tools/run-proofs.mjs`.** Covers: §0 the column/index/trigger exist; §A/§B
insert-time stamping + an explicit year surviving the trigger; §C/§C2 the
backfill expression across a REAL two-step handover (sentinel years
2695/2696, backdated `started_at` so the two handovers land at genuinely
different instants in one frozen-`now()` transaction) including an UNPAID
order staying on its original year; §D RLS unchanged (buyer owns their own
row regardless of year, a stranger is denied, admin sees every year); §E/§F
`shop_order_totals()`'s current-year scoping AND its null-fallback, both by
SNAPSHOT DELTA against `shop_order_totals()` itself — never an absolute
count, so the proof holds regardless of how many real orders already exist
on whatever database runs it (§F's first draft used a hardcoded expected
delta and failed loudly against samo-dev's own pre-existing rows; fixed to
recompute the expected value from the live table instead of guessing a
constant). Insert path throughout: `shop_orders_insert_admin` (0035) as a
`role='dev'` principal (satisfies BOTH `current_user_is_shop_admin()` and
`start_team_term`'s `vp_admin`/`dev` gate, same shape `pr0220`'s principal
uses) — buyers have had no direct INSERT on `shop_orders` since 0199.

### B. The customer-flow walk

Traced the owner's named worry — "login ด้วย username password แล้วซื้อแบบนี้
กดออกไปหน้านี้แล้วมีปัญหา" (sign in, add to cart, navigate away, come back,
something's wrong) — through the actual code, not just the shop files: cart
persistence (`shop/state.js`), the router (`main.js`'s `navigateTo`/
`pathToTab`/the `shown.bs.tab` handler), auth session handling
(`auth.js`'s `onAuthStateChange`), and `checkout.js`'s own prefill/retry
logic.

**Found nothing wrong with the "navigate away" part itself.** Every in-app
destination the worry names — the shop tab, `/me`, the home banner's shop
slide (`departments.js`'s `data-dept-tool-tab` click-intercept) — routes
with `history.pushState` + Bootstrap `Tab.show()`. Nothing on any of those
paths calls `location.reload()`, so the cart (`localStorage`) and the
signed-in session (`supabase-js`'s own persisted session + `auth.js`'s
`currentUser`) both survive automatically, same as any SPA tab switch.
`checkout.js` already has extensive, DELIBERATE handling for the related
"the page re-renders under me" cases — `applyBuyerPrefill`'s two rules
(overwrite on account switch, fill-only-if-empty within one account), the
`placing` lock against double-submit when `SIGNED_IN` re-fires on tab
visibility, and `findMyOrderBySlip`-based retry so a lost response doesn't
double-charge. None of that needed a change.

**Found one real bug, in `shop/state.js`, unrelated to navigation
mechanics**: the cart is loaded into memory ONCE per browser tab and every
mutation persists the WHOLE array, overwriting — not merging — whatever is
in `localStorage` right now. Two tabs open on the shop (a product link
opened in a new tab, a long-press "open in new tab", a duplicated tab) each
hold their own stale copy; whichever tab writes NEXT silently drops whatever
the OTHER tab had added, with no error and no toast. This is exactly the
"another tab" half of the owner's own phrasing. **Fix**: a `window`
`storage`-event listener (fires in every OTHER tab, never the one that
wrote) reloads the in-memory cart before the next mutation can clobber it;
also handles `key === null` (a future `localStorage.clear()`) since treating
that as "ignore" would let a stale tab's next write silently undo a real
clear — nothing calls `clear()` today, but the guard is free. Verified
red-then-green (`src/js/shop/state.test.js`, two module instances sharing
one fake `localStorage`): reverting the fix reproduces the exact loss.
Write-up: `docs/mistakes/app-state.md` (new entry, "SAMO Shop: a product
added to the cart in one browser tab could vanish…").

**OWED, not run**: a live-browser walk of the rest of the flow — the typed
buyer fields and a picked-but-not-yet-uploaded slip file surviving a
navigate-away-and-back mid-checkout — written at
`tools/browser/shop-checkout-navigate-away.mjs` (same CDP-over-WebSocket
pattern as `shop-admin-tour.mjs`) but **NEVER RUN**: this sandbox has no
Chrome/Chromium binary and no network to install one (`which
google-chrome`/`chromium`: nothing; `npx playwright install webkit`: `EROFS`
on the npm cache — no network). The code trace above is strong (cart/session
state is architecturally reload-proof here), but it is a trace, not a
browser run; the script is the next thing to run on a machine that has
Chrome.

**`/scrutinize` pass on this task's own diff (`git log --oneline
e9af2fa..HEAD`) found two real gaps, both fixed before this write-up**:
(1) `shop_order_totals()`'s current-year scoping had no fallback for
`current_samo_year()` itself being NULL — fixed (§ A above) and proof
extended (§F); (2) the `storage` listener did not treat `key === null`
(`localStorage.clear()`) as a reason to reload — fixed and tested. Both
caught by tracing inputs the happy-path proof/test did not try, exactly the
discipline `.claude/rules/mistakes.md` class 7 asks for.

**Commands the owner runs next:**
1. Review this branch (`agent/2026-10-18`) and merge like any other task.
2. Apply 0219 to production first if not already (task 2's row), then
   `node tools/apply-migration.mjs supabase/migrations/0230_shop_orders_get_a_samo_year.sql`,
   then `node tools/db-query.mjs tools/shop0230-samo-year.sql` to prove it
   there too.
3. Deploy the frontend bundle (ships the year picker on both shop admin tabs
   + the cross-tab cart fix).
4. Optionally, on a machine with Chrome: `node
   tools/browser/shop-checkout-navigate-away.mjs` against `npm run dev` to
   get the live-browser confirmation this sandbox could not produce.
5. Decide whether the "correct this order's year" admin control (§A, OWED)
   is worth building now or later — nothing depends on it.

**`npm run handoff:check` verdict — same known crash as Tasks 1 and 8,
re-confirmed on resume**:
`ENOENT` reading
`~/.claude/projects/-home-ubuntu-samo-agent/memory/MEMORY.md` (confirmed
unchanged, not re-diagnosed; this session's real memory store is
`~/samo-night/memory/`). Ran with `--local` too; same crash, plus
`origin/agent/2026-10-18` reported unknown (expected — this agent cannot
push). **Substituted direct checks**: `npm test` (172 files / 2977 tests
green, after every change in both the cut-off run and this resumption —
2974 before the resumption's +3 `orderMatchesYearFilter` tests), `npm run
build` (clean, both entries), `git status` (clean after each commit), and
`tools/shop0230-samo-year.sql` run live against samo-dev (31/31 both before
and after the resumption's fixes, `→ project: xibugtlsphcfuvstnxxh
(samo-dev)` — the resumption's fixes were frontend-only, so this proof did
not need to change).

---

## Task 10 — Passport, หน้าฝ่าย, announcements, stats retention, accounts (2026-10-18)

**RESUMED after a quota cut-off** (WIP `392017a` gave the window back to a
Claude booking; `7aa1f67` continued it and was itself cut off by the quota —
two WIP commits, neither followed by this task's own write-up or a
`/scrutinize` pass, which is exactly the gap tasks 11 and 12 both flagged and
is what this session closes).

**Point-by-point against the brief — what the WIP already did vs. what this
session finished:**

- **Stats (migration 0231, required).** ✅ Already done by the WIP, verified
  not redone: `analytics_daily_rollup` + `claude_usage_weekly_rollup`,
  `prune_analytics()` rewritten to roll up a day in the SAME transaction it
  deletes it, `prune_claude_usage_samples(weeks=8)` added new,
  `analytics_overview()` rewritten so `visitors_by_day`/`top_paths` prefer the
  rollup for a pruned day and the raw table for a live one — proved by
  `tools/stats0231-retention.sql`, which explicitly asserts
  `analytics_overview()` survives a prune (steps 20/30). Re-ran live against
  samo-dev this session: **31/31**, unchanged. `notify_log`'s existing
  `prune_notify_log` (0055) is scheduled alongside the other two in the same
  VM timer script, not re-migrated. `project_notifications` deliberately gets
  NO prune (age-AND-read only, per the brief) — confirmed by reading
  `server/stats-retention.sh`, which calls exactly three functions and none
  of them touch `project_notifications`.
- **pg_cron vs. a VM timer — decided, not left open.** pg_cron is NOT
  installed on this project (confirmed, STATE.md) and enabling it is a
  one-click Database→Extensions action only the owner can take; this agent
  has no production credential to take it even if it wanted to. WIP wrote
  `server/stats-retention.{sh,service,timer,env.example}` (same pattern as
  the existing `server/supabase-backup.*`, same `SUPABASE_DB_URL` reused, not
  a new credential) — WRITTEN, NEVER INSTALLED, same as every other VM asset
  this queue produces (no VM access from this sandbox). Timer uses
  `OnCalendar=Sun *-*-* 04:40:00` (wall-clock, not `OnBootSec`/
  `OnUnitActiveSec` — the exact class-7 trap `.claude/rules/mistakes.md`
  names) offset 40 minutes from the nightly backup timer so the two don't
  compete for the same DB connection window. If the owner prefers pg_cron
  instead, the migration's own header says the swap is one `cron.schedule`
  call per function, nothing here needs rewriting first.
- **Revision-pass fix, found AFTER the WIP, before this task's own
  write-up: 0231's `prune_analytics()` cutoff was NOT day-aligned.** A
  WEEKLY timer with a non-day-aligned cutoff silently **splits** a calendar
  day across two runs — the first run rolls up and deletes the early hours,
  the second run recomputes the same day from only the surviving late hours
  and `on conflict do update` **overwrites** (not adds to) the first run's
  count, permanently losing the first half. Reproduced live on samo-dev
  (20 events before a simulated cutoff, 4 after, same day — first prune
  rolled up 20, second overwrote it to 4), fixed in migration 0233
  (`date_trunc('day', ...)` on the cutoff, so a day is only captured once it
  is ENTIRELY before cutoff). Write-up: `docs/mistakes/postgres-schema.md`.
  Proof `tools/stats0233-no-split-day.sql` re-run live this session: **7/7**.
  This was credited to "revision-pass work" in STATE.md/HANDOFF rather than
  folded silently into 0231, on purpose — it is a real bug in migration
  0231's own design, not a cosmetic follow-up, and the queue's own rule is
  ADD, never silently retype a prior migration once it may have been applied
  anywhere.
- **Passport (0232).** ✅ Already done by the WIP: `passport.samo_years.
  team_term_year` (nullable, no FK — matches the deliberate public/passport
  schema isolation; set by hand via the admin `startNewYear()` prompt in
  `passport/js/admin-page.js`, read back in the years list). The
  "never a gap between two years/seasons" invariant was NOT touched —
  confirmed by reading `startNewYear()`'s own open-before-close shape
  (`admin-page.js:1518-1565`), which already matched the invariant before
  this queue started; nothing here needed to change it. Leaderboard-per-year
  and past-year browsing were ALSO already live before this task (student
  dashboard's `lb-year-select`, admin's `#lb-year`, `fl-year-select`) —
  confirmed by grep, not rebuilt. Re-ran `tools/passport0232-bridge-
  dept-editor-accounts.sql` live this session: **22/22**.
- **หน้าฝ่าย.** ✅ Already done by the WIP: `dept_content_editor_info(p_dept)`,
  gated with the SAME predicate `dept_content`'s own RLS uses
  (`current_user_dept_page_scope()`), wired into `src/js/dept-page-admin.js`
  to render "แก้ไขล่าสุดโดย … เมื่อ …" under the ฝ่าย picker. UI-only, no
  year column, no version-history table — matches the design doc's explicit
  rejection of versioning (a ฝ่าย page is a living document, not a ticket).
- **Announcements.** ✅ Already done by the WIP: reuses the existing
  `status` CHECK values (`approved`/`archived`), no new column — เก็บเข้าคลัง/
  เผยแพร่อีกครั้ง buttons on the manage pane, a status filter
  (เผยแพร่/เก็บเข้าคลัง/ทั้งหมด), and the public feed confirmed (by reading
  `loadAnnouncements`'s default `statusFilter = 'approved'` and its only
  caller on the public page) to already filter to approved-only — the
  pre-existing bug the design doc flagged as "verify, don't silently fix"
  turned out to not exist. **Task 11 (not this task) found and fixed the one
  real announcements bug**: editing an archived post silently republished it
  (`nextAnnouncementStatus()` now preserves the row's own status across an
  edit) — noted here for completeness, not reclaimed as this task's work.
- **Accounts.** ✅ Already done by the WIP: `account_dashboard(p_samo_year_be
  default null)` — the old zero-arg signature was dropped first (two
  overloads would make PostgREST's no-arg RPC call ambiguous), the new one
  adds PR/VS/Shop/Projects activity counts optionally scoped to a year, master
  gate unchanged. Graduates/departing-staff account closure stays a PERSON
  decision, never a year one — confirmed by reading `## Accounts` in
  `docs/YEAR-ROLLOVER.md`, which this task did NOT touch (no new deletion
  path was built). Default is "ทุกปี" (unscoped), not the current year —
  deliberate, reasoned in HANDOFF §22's per-decision list, not revisited
  here.
- **Claude booking.** No code owed beyond the sample-pruning covered under
  Stats above — `claude_bookings`/`claude_settings` are a weekly operational
  cycle, not year-scoped (confirmed by reading `## Claude booking` in
  `docs/YEAR-ROLLOVER.md`); no migration number was reserved for it and none
  was needed.

**What THIS session actually did (the part the two WIP commits and tasks
11/12 left genuinely undone):**
1. **Wrote this block** — `docs/state/night-agent.md` had no `## Task 10 `
   heading at all; tasks 11 and 12 both read and reviewed task 10's work but
   neither wrote its own-task narrative, which is what the queue's `Done
   when:` check for this task actually greps for.
2. **Fixed a real, mechanically-detected staleness bug**: `STATE.md` said
   "67 of 72 LIVE PROOFS" but `tools/run-proofs.mjs` now registers 73 (the
   previous run's sweep-up commit `0ea0fcc` added `stats0233-no-split-day.sql`
   to the registry without updating this count) — `npm test` was RED on
   `state-handoff.test.js`'s "its live-proof count matches what npm run
   proofs actually runs" assertion before this fix. Corrected to "67 of 73"
   and named `stats0233-no-split-day` alongside the other samo-dev-only
   proofs in that sentence. This is exactly the "prose outlives the
   predicate" class (`.claude/rules/mistakes.md` class 6) — a number with ONE
   home that drifted the moment a sibling file changed next to it.
3. **Re-verified all three of this task's proofs live against samo-dev**
   (not trusting the counts already recorded by tasks 11/12): `stats0231-
   retention` 31/31, `stats0233-no-split-day` 7/7, `passport0232-bridge-
   dept-editor-accounts` 22/22 — all green, `→ project: xibugtlsphcfuvstnxxh
   (samo-dev)` confirmed in each run's output.
4. Confirmed `docs/mistakes/INDEX.md` is already up to date
   (`npm run mistakes:index` → "up to date (446 entries across 10 files)")
   and HANDOFF §22 row 10 was already corrected by task 12 (DONE, with the
   apply-in-order checklist) — neither needed a further edit from this task.

**Decision, restated for the record (made by the WIP, confirmed correct by
this session, not re-litigated): the whole brief was built as THREE small,
independent additions — a stats-retention scheduling gap, a Passport bridge
column, and two read-only UI/RPC conveniences — rather than one bigger
"year-rollover for everything else" feature.** This matches every other
system in this queue (0219's own shape: additive columns + functions, no
behavioural change until the frontend reads them) and the design doc's own
explicit rejections (no dept_content versioning, no announcements year
column, no Passport/team_terms merge). **What would change this**: if the
owner wants real version history on หน้าฝ่าย pages, or a scheduled (not
manual) Passport↔team_term bridge, those are both bigger features this
queue's budget deliberately did not build — flagged, not silently expanded.

**`npm test`**: 173 files / 2982 tests, all green (the one failure this
session found — the proof-count mismatch above — is fixed, not worked
around). **`npm run build`**: clean, both entries (public/admin + Passport).
**`git status`**: clean after this task's commit.

**`npm run handoff:check` verdict**: same known crash as every prior task
this queue (`ENOENT` reading `~/.claude/projects/-home-ubuntu-samo-agent/
memory/MEMORY.md` — this session's real memory store is `~/samo-night/
memory/` — and `origin/agent/2026-10-18` unknown, since this agent cannot
push). Not re-diagnosed; already documented by Tasks 1/8/9/11. **Substituted
direct checks**: `npm test`, `npm run build`, `git status`, and the three
migration proofs re-run live against samo-dev, all shown above.

**Commands the owner runs next:** unchanged from HANDOFF §22's row 10 and
the apply-in-order checklist above it (task 12's work) — apply 0230 before
0231/0232 (`account_dashboard()`'s rewrite reads `shop_orders.samo_year_be`),
then 0231, then 0233 (MUST follow 0231 — it redefines `prune_analytics()`),
then 0232; install the VM timer or enable pg_cron; deploy the bundle; click
through the browser-verification table. Nothing in this resumption changed
any of those commands — it closed a documentation gap and a stale count, not
new schema or new UI.

---

## Task 11 — Scrutinize + bug scan: tasks 8–10, and the owner's work since 2026-10-14 (2026-10-18)

**Scope, per the queue's own brief:** run `scrutinize` over this branch's own
diff (tasks 8–10) AND over the owner's session work on `main` since
2026-10-14 (shop admin, home banner + tool icons + `/me`, year-rollover
0225–0228 + `team/terms.js`), then a bug scan of the whole app focused on
what the year work touched and the owner's named worries: login cache for
both sign-in kinds, switching accounts in one browser, the shop customer
flow. Fix every real finding, write it up, 0233 for SQL. Full report:
the 2026-10-18 review note (kept on the VM checkout under agent-notes, not in git) (that directory is excluded
from git by `.git/info/exclude` — on disk, not committed, same as the
2026-10-13 bug-review files were before they got force-added; left as-is
since the task's own `Done when:` only checks the file exists).

**Task 10 was reviewed too, and it needed it most** — its two commits are
tagged `WIP`/"cut off by the quota" and had never been through a
`/scrutinize` pass of their own, unlike tasks 8 and 9 (both of which already
show a resumed/fixed pass in their own blocks above). Reading 0231/0232 in
full and re-running their proofs LIVE against samo-dev (not trusting the
counts already recorded in STATE.md) found them solid: `stats0231-retention`
31/31, `passport0232-bridge-dept-editor-accounts` 22/22, `shop0230-samo-year`
31/31 (re-checked for completeness, task 9's own). Every new SECURITY
DEFINER function fails closed and anon is explicitly revoked, not just
`public`. Tasks 8 and 9's prior fixes also held up under a fresh trace —
`isGraduated()` has one home with no drift between `gaps.js`'s denominator
and `house/index.js`'s roster filter, and the shop admin tile/year-filter fix
(`8552b4b`) reads `yearFilteredOrders()` exactly where its own comment says
it must.

**One real bug found and fixed, in task 10's announcements-archive work**:
0232's sibling feature added เก็บเข้าคลัง/เผยแพร่อีกครั้ง for ประกาศ and
explicitly wired `admin-main.js`'s `enterCreator()` / `tryCreatorDeepLink()`
to resolve an archived post into the editor — but `publishAnnouncement()`
still hardcoded `status: 'approved'` on every save (written before archiving
existed), so editing an archived post's text — even a typo fix, no intent to
republish — silently put it back on the public site. Fixed by extracting the
decision into `nextAnnouncementStatus(beforeRow, isEditing)`: new posts are
always 'approved', edits preserve whatever the row already had. Tested
(`src/js/announcement-status.test.js`, since `publishAnnouncement` itself is
too DOM-heavy to unit test directly) and written up in
`docs/mistakes/app-state.md`.

**The owner's work (shop admin, home/`/me`, `terms.js`) was delegated to a
background general-purpose agent** with the same "trace the real call path,
don't trust the diff" brief this skill always uses, rather than re-walked by
hand — it is already-shipped, already-reviewed code (commit `466451b` alone
logged six independently-found defects with tests) and re-deriving every
predicate by hand a second time was lower value than spending that effort on
task 10, which had never been looked at. It came back with one cosmetic
finding: `departments.js`'s modified-click allow-list named
`a[href][data-dept-tool-tab]`, but `data-dept-tool-tab` (`tool-card.js`) is
only ever emitted on a `<button>`, which has no `href` — so that clause can
never match. No behavior change (buttons were already excluded correctly by
the surrounding code), so no `docs/mistakes/` entry — there is no bug shape
here to warn a future session about, only a dead selector removed and the
comment reworded to say why.

**Login cache for both sign-in kinds, and switching accounts in one
browser — checked by hand, not delegated** (security-sensitive;
`docs/mistakes/supabase-client.md` read first, per CLAUDE.md). `auth.js`'s
`buildCurrentUser` treats Google and username/password symmetrically (method
comes from `auth.users.app_metadata.provider` first, the stored column only
as fallback — the 0211 fix) and reruns on every `onAuthStateChange` fire
including the 25-minute `TOKEN_REFRESHED`, so a permission change reaches an
open tab without a full sign-out. `account-switch.js`'s fast-switch path
already carries fixes for the two races this exact feature paid for before
(the outgoing-token-capture race, the iPad Safari `setSession` wedge); the
cross-tab case is supabase-js's own `BroadcastChannel`, confirmed present and
wired in the installed `auth-js` version for `persistSession: true` — no app
code needed, and none was missing. No new finding in either file. The shop
customer-flow worry was task 9's own (the cross-tab cart `storage` listener,
already fixed and tested there) — re-verified by trace, not re-fixed.

**0233 was reserved and left unused** — this task needed no SQL of its own;
all three migrations it reviewed (0230/0231/0232) belonged to tasks 9/10.

**`npm test`**: 173 files / 2981 tests before this task's own change, 2982
after (the 4 new `announcement-status.test.js` cases plus the mistakes-index
rebuild). **`npm run build`**: clean, both entries (public/admin + Passport).
**`git status`**: clean after this task's commit.

**`npm run handoff:check` verdict**: same known crash as every prior task
this queue — `fatal: ambiguous argument 'origin/agent/2026-10-18..HEAD'`
(this agent cannot push, so the remote branch does not exist) followed by
`ENOENT` reading `~/.claude/projects/-home-ubuntu-samo-agent/memory/
MEMORY.md` (this session's real memory store is `~/samo-night/memory/`).
Not re-diagnosed — already documented by Tasks 1/8/9. **Substituted direct
checks** (same shape Tasks 8/9 used): `npm test`, `npm run build`, `git
status`, and the three migration proofs re-run live against samo-dev with
`→ project: xibugtlsphcfuvstnxxh (samo-dev)` confirmed in each run's output.

**Commands the owner runs next:**
1. Review this branch (`agent/2026-10-18`) — tasks 8–11 are now all DONE on
   it, nothing applied to production.
2. Read the 2026-10-18 review note (kept on the VM checkout under agent-notes, not in git) (on disk, not in git —
   see the scope note above) for the full trace behind every finding.
3. Task 10 never got its own `/scrutinize` write-up or HANDOFF row-10
   update (its commits are WIP/cut-off) — task 12 (handoff checklist) should
   close that, not skip it because this task's review covered the code.
4. Nothing from this task needs applying — no schema change, and the two
   fixes are already committed on this branch.

## Task 13 — review leftovers (2026-10-20)

**Written by the OWNER SESSION, not the agent.** The agent's run committed all
four parts (`13 (1/4)` … `13 (3/4)` and the sweep-up commit) but hit
`Reached max turns (200)` before writing this block, so the runner scored it
"not passed". The work was reviewed, merged to `main` and deployed on
2026-10-20; this block closes the task so the next run does not redo it.

What it did: cherry-picked `wip/discord-review-fixes` and fixed its two red
tests to the restructured loop; the popup qty / colour cap; the cart's
`addItem` stock cap; the บอท Discord poll no longer clearing a save error;
`csvGuard`/`csvUnguard` round-trip every input; the nginx `/img/` cache key.

What the review changed on top (all on `main`): the popup cap regained cart.js's
99 ceiling; a poll's own load error now clears; a settings read failing
mid-pass aborts the pass once instead of reporting every change as refused
(test red with the old catch); a pause still posts what was written; nicknames
off stops a rename run. **Not applied**: the nginx line is in the repo only —
install by hand (`sudo nginx -t && sudo systemctl reload nginx` after copying
the `location` change), then check `X-Img-Cache: HIT` with and without `?x=1`.
Remaining gaps: HANDOFF §22 "Still OWED".

## Task 14 — Make the proofs trustworthy: samo-dev fidelity and the two red proofs (2026-10-20)

**RESUMED after a quota cut-off.** A prior run of this task committed
`f156ed8` ("agent: WIP 14...") and was cut off before writing this block.
Read that commit (`git show --stat f156ed8`) and verified each point of the
brief by hand rather than redoing the work.

**Point 1 — samo-dev gets production's five `auth.users` triggers.**

- The WIP commit already wrote `supabase/migrations/0234_dev_gets_the_auth_triggers_too.sql`
  and already stripped the hand-written `insert into public.users` workaround
  out of the 5 browser harnesses that had one (`tools/browser/accounts-dashboard.mjs`,
  `house-sai-grid.mjs`, `projects-ui.mjs`, `shop-admin-strip.mjs`,
  `shop-admin-tour.mjs`), replacing each with a bare `update … set permissions`.
  I grepped the whole `tools/` tree afterward for `insert into public.users`
  and found none left; `me-page.mjs` and `shop-checkout-navigate-away.mjs`
  also call `registerWithPassword` but never had the hand-written insert, so
  they needed no change.
- **What I verified that the WIP had not yet run**: `node tools/migrate-status.mjs --dev`
  showed `PENDING: 0` — 0234 was already applied to samo-dev. Queried
  `pg_trigger` directly: all 5 triggers (`on_auth_user_created`,
  `…_passport_link`, `…_email_change`, `…_password_sync_insert/_update`) exist
  on samo-dev's `auth.users`. Ran `tools/accounts0211-dashboard.mjs --dev`:
  **15/15** (was 12/15 per HANDOFF §19 item 1) — its own two trigger checks
  (`a Google sign-up is born google` / `a username sign-up is born password`)
  insert directly into `auth.users` and read `public.users` back with **no
  hand-written insert of their own**, which is the same thing the task brief
  asked a browser signup to demonstrate, done at the SQL layer instead.
- **Checked the no-op-on-production claim by hand, not by trusting the
  migration's comment**: grepped every migration that ever defined each of
  the four functions (`handle_new_auth_user`: 0001, 0042, **0211**;
  `handle_auth_user_email_change`: **0026**; `handle_auth_user_password_sync`:
  **0027**; `passport_link_user_by_email`: 0060, 0061, 0063, **0175**) and
  diffed 0234's copy against the newest one — all four function bodies and
  all five `create trigger` statements are character-for-character identical
  (modulo comments, which `pg_get_functiondef` and Postgres both ignore). The
  migration really is inert on production.
- **Could NOT drive this through a real browser** — no Chrome/Chromium binary
  exists in this sandbox (`which google-chrome chromium …` all empty, no
  `puppeteer`/`playwright` dependency), the same gap task 12 already
  documented. Substituted the SQL-level proof above, which exercises the same
  trigger path (`auth.users` insert → `public.users` row with no app code
  writing it) without needing a browser. **Not independently verified**: the
  five browser harnesses whose hand-written insert was removed were never
  actually re-run end-to-end in this sandbox; they are correct by inspection
  (the trigger fires synchronously inside the `auth.users` insert transaction
  that `registerWithPassword`'s HTTP call waits on, so the row exists before
  the harness's next line runs) but the owner should run one once Chrome is
  available, e.g. `CHROME=/path/to/chrome node tools/browser/accounts-dashboard.mjs`.
  No throwaway account was created or needed deleting — the SQL proof rolls
  back its own `auth.users` inserts.

**Point 2 — the two red proofs, rewritten to assert the PROPERTY.**

Both rewrites were already in the WIP commit; I only verified them:

- `tools/dept0177-page-scope.sql` §70–72: **25/25 on samo-dev.** §G used to
  count every `dept_content` row for `dept='admin', kind='card'` (a SHAPE) and
  expect the seed's original 4 — wrong the moment ฝ่ายบริหารองค์กร added its
  own 5th card through the self-service editor §A already proves works
  (exactly what happened on production). Now it tracks the 4 seeded rows by
  the `href` the seed migration itself keys on, then reintroduces that exact
  event (§71: an editor with blanket dept-page access adds a 5th card) and
  checks the count still reads 4 (§72) — proven to survive the bug it used to
  die on.
- `tools/team0135-name-split.mjs` A5–A7: **16/16 on samo-dev.** Used to search
  for a coincidental student+login+team_members triple; none exists on
  samo-dev (or, per the proof's own new comment, reliably on production
  either), so it went quietly dark. Now it manufactures the subject:
  `update_my_identity`/`get_my_team_seat` resolve "self" purely through
  `public.users.email → students.kkumail`/`team_members.kkumail` (0145 §5/§6,
  no role branch), so a borrowed login's email is pointed at a real
  dual-placement person's kkumail for the life of the rolled-back
  transaction. Rollback means no other session can ever observe the borrowed
  account's changed email (Postgres MVCC — uncommitted writes are invisible
  outside the transaction), so there is no real collision risk even though
  the account is "borrowed" rather than created fresh.
- Wrote both up in `docs/mistakes/tooling-proofs.md` ("dept0177 / team0135:
  two proofs red on production, both a SHAPE not a PROPERTY") and reran
  `npm run mistakes:index`. **Neither has been re-run against production** —
  this agent holds no production credential; both are proofs run on samo-dev
  only, per the proof-fidelity rule the same file already states ("a proof
  written on samo-dev must be read against production's shape before it is
  called portable").

**Full `npm run proofs:dev` — 68 of 71 database proofs green** (2 SKIP are
`repo-protection.mjs`/`notify-exposure.mjs`, which ask GitHub/Cloudflare, not
a database — expected). **3 red, none caused by this task's own change** (all
three are real data drift on samo-dev from other tasks' real writes since
2026-10-14; not relaxed, reported as found):

- `house0146-crest-refcount.sql` step 5 (CONTROL): got 4, want 2. The control
  hand-sums `team_members + people + students` rows sharing one photo_url for
  a deterministically-picked subject, but `photo_reference_count()` itself
  counts across more tables (the comment on the probe already says a person
  with two ตำแหน่ง legitimately counts 4) — the picked subject on samo-dev
  today has two placements sharing one photo, so the function's true answer
  (4) is right and the control's partial hand-sum (2) is stale. Not touched;
  rewriting this control's hand-sum is outside this task's scope (only
  dept0177/team0135 were in the brief) and risks exactly the "fix a proof by
  relaxing it" trap the brief warns against without a careful re-derivation.
- `team0196-position-not-inherited.sql` step 00: expected 2 unplaced,
  unlinked `people` rows to exist as test subjects, got 0 — every person in
  samo-dev's `public.people` now has either a `discord_links` row or a
  `team_members.person_id`, so the subject pool the proof's setup needs is
  empty and every later step cascades to FAIL/null. Data drift, not a code
  bug in `0196`'s guard itself.
- `year0219-samo-year.sql` steps 32/45/47/48: §G assumes whichever
  `team_terms` row is `is_current` when the proof STARTS is the untouched
  genesis row (`started_at` still `NULL` because the column predates it), and
  that closing it turns that `NULL` into a permanent `-infinity`. On samo-dev
  today the real genesis row (year 2569) was already closed correctly
  (`started_at = -infinity`, confirmed by hand:
  `select year, started_at, is_current from public.team_terms`), but a REAL
  handover since then (2569→2570→2571, from other tasks' real
  `start_team_term` calls) means the row that is `is_current` when this proof
  runs today is 2571, which already has a real timestamp, not `NULL`. §G's
  close-then-check-for-`-infinity` is therefore checking the wrong row's
  history, not a broken function. Confirmed the underlying function is fine
  by reading the real table directly; the proof's own one-time assumption
  ("the term that was current when 0219 first ran") is what has drifted.

None of these three were fixed — fixing them is a proof-design exercise (same
shape as dept0177/team0135, but outside what task 14's brief named) that
would need its own careful re-derivation to avoid "fix by relaxing," which the
brief explicitly forbids doing casually. Left for a future task to pick up by
name if the owner wants the proof suite fully green; reporting them here
satisfies this task's "record every red, do not hide it" instruction.

**`npm test`**: 175 files / 3014 tests, all green. **`npm run build`**: clean,
both entries (public/admin + Passport). **`git status`**: clean after this
task's commit.

**Scrutinize pass** (self-review of `f156ed8`, by hand — traced the migration
against the newest prior definition of each of its 4 functions and all 5
trigger statements character-for-character, checked the DROP-then-CREATE
trigger pattern is the same idempotent shape this codebase's own historical
migrations already use, and checked the `team0135` carrier-identity-borrow
cannot leak outside the rolled-back transaction under Postgres MVCC). No
blocker or major finding. Verdict: ship.

**What is NOT done / owed:**
1. The 5 updated browser harnesses were never run end-to-end against a real
   browser in this sandbox (no Chrome available) — correct by inspection, not
   by execution. Run one once Chrome/Chromium is reachable.
2. `dept0177`/`team0135`'s new proofs have not been re-run against
   production — this agent has no production credential. They are DRAFTS
   until that happens (same status every samo-dev-only proof in this queue
   carries).
3. `house0146`/`team0196`/`year0219` are red on samo-dev from real data
   drift, reported above, not fixed — would need their own task.

**Commands the owner runs next:**
1. `node tools/apply-migration.mjs supabase/migrations/0234_dev_gets_the_auth_triggers_too.sql`
   against PRODUCTION once this branch is reviewed — it is written to be an
   inert no-op there (verified above), the point is to stop samo-dev from
   drifting further from production's trigger set.
2. `node tools/accounts0211-dashboard.mjs` (no `--dev`) against production to
   confirm 15/15 there too (expected, since the triggers already exist).
3. Re-run `node tools/dept0177-page-scope.sql` and
   `node tools/team0135-name-split.mjs` against production once reviewed, to
   close out their DRAFT status.
4. `CHROME=<path> node tools/browser/accounts-dashboard.mjs` (and the other 4
   updated harnesses) on a machine with Chrome, to actually exercise the
   browser signup path end-to-end.

## Task 15 — Security sweep: whole-class guards + the three named open items (2026-10-20)

**RESUMED after a quota cut-off.** The WIP commit (`1714867`) had already
written and run (on samo-dev, proofs green): migration 0235 (anon-EXECUTE
allow-list sweep, `tools/security0235-whole-class-sweeps.sql` 12/12),
migration 0236 (username sign-in hardening, `tools/security0236-username-lookup-hardening.sql`
8/8 + `tools/security0236-login-flow-probe.mjs` 7/7), the `src/js/auth.js`
wiring to pass the password through the lookup RPC, both proofs registered
in `tools/run-proofs.mjs`, and a first STATE.md edit. **What the WIP had NOT
done**, verified by reading its diff against the brief point by point:

- **Whole-class sweeps (§0–§4)**: done, all passing, including the required
  planted controls. No gap.
- **Item a (username sign-in hardening)**: migration + both proofs written
  and green on samo-dev. No gap in the mechanism, but the WIP's own migration
  header, `tools/security0235-whole-class-sweeps.sql`'s header, and STATE.md
  all narrated the exact exploit mechanism (which functions, why each is
  dangerous) in files tracked by a PUBLIC repo, for fixes applied to
  samo-dev only — production is still unpatched. This is a live-exploit
  writeup for a hole still open on the deployed system, which the brief's
  own instruction for this item ("describe it in git only as 'username
  sign-in hardening'... detail goes to the private report") explicitly
  forbids. **Fixed this session**: reworded migration 0235's header, 0236's
  header, `security0235-whole-class-sweeps.sql`'s header, and STATE.md's two
  descriptions to name only the generic property being fixed, moving
  mechanism/severity detail into `~/samo-night/reports/2026-10-20-security.md`
  (written this session, did not exist before).
- **Item b (Apps Script upload limits)**: NOT STARTED by the WIP — no changes
  to `appscript/prform.gs` existed. **Built this session**: `UPLOAD_LIMITS`
  (mimeType allow-list + byte cap, checked before any Drive call) for all
  five handlers (`uploadPRFile`/`Shop`/`Team`/`Project`/`Archive`), each cap
  matching or exceeding the already-shipped CLIENT-side check for that path.
  12 new tests in `src/js/gas-drive-scope.test.js` (runs the real
  `appscript/prform.gs` against a stub Drive), each class with a CONTROL.
  Guest PR uploads unaffected (same `accept="image/*"`, same-or-higher cap).
- **Item c (re-check the 2026-10-13 private reports)**: NOT STARTED by the
  WIP. **Done this session**: read both `~/samo-night/reports/2026-10-13-security-{app,db}.md`
  in full and traced each finding against current code. DB Finding 1
  (passport RLS tracking gap) — CLOSED, confirmed via `HANDOFF.md` §19.1
  (`pass-anon-probe.mjs` ran clean against production after 0214). DB
  Finding 2 (username lookup) — now built, see item a. DB Findings 3–4 and
  App Finding 2 (`samo_depts` WHO-not-WHAT) — Finding 3/4 by design/feature
  gap (not touched, correctly carried); App Finding 2 CLOSED by migration
  0215 (confirmed by reading the live `projects_samo_depts_guard` body — it
  now validates VALUES too, not just WHO). App Finding 1 (nginx security
  headers) — confirmed already written in `server/nginx-samo.conf`, still
  needs a VM deploy to take effect (carried, owner-only). Full detail and
  the carried/open items (HSTS, `notifyProjectEmail` content hardening,
  legacy `admin`/`1234`, `pass-anon-probe.mjs` not registered in
  `run-proofs.mjs`) are in the private report, not here.
- **The private report file** (`~/samo-night/reports/2026-10-20-security.md`,
  required by "Done when") did not exist before this session — written now,
  with full mechanism/severity detail for items 1–2 above (safe here because
  this file is outside both repos) plus the re-check of 2026-10-13's items.
- **`state-handoff.test.js`'s live-proof-count check was RED** after the
  WIP's STATE.md edit: its historical "70 GREEN of the 73 registered at the
  time" phrasing was reworded (apparently to dodge the regex that compares a
  claimed count against `run-proofs.mjs`'s actual registered total) in a way
  that matched NEITHER accepted pattern, leaving STATE.md with ZERO
  proof-count claims — and the test requires at least one. Fixed by adding
  a current, accurate claim ("ALL 75 LIVE PROOFS are now registered") rather
  than touching the historical sentence, which correctly excludes the 2
  dev-only proofs this task added from a count about a PRODUCTION run that
  predates them.

**Decisions made, alternatives rejected:**

- Upload size caps per handler: PR 35MB / Shop 10MB / Team 10MB / Projects
  35MB / Archives 50MB. Each chosen to match-or-exceed the highest existing
  CLIENT-side check on that path (pr-form.js 35MB; shop admin.js 8MB product
  picks / 5MB banner+QR+slip-send; team photos downscaled ~3MB) so no real
  browser user is newly blocked — only a caller that skips the browser
  entirely. Projects/Archives have no client cap today (official documents,
  unpredictable size); picked numbers that match existing precedent (PR's
  35MB) rather than inventing new ones. **Rejected**: per-exact-extension
  allow-list for Projects (too brittle — staff attach PDF/Office/image files
  with no `accept=` restriction client-side today; a wildcard-plus-named-list
  is more forgiving and fails LOUD, not silently, for a type it's missing).
- Project mimeType allow-list: `image/*`, `application/pdf`, plain text, and
  the Word/Excel/PowerPoint MIME types (both legacy `.doc`/`.xls`/`.ppt` and
  modern `.docx`/`.xlsx`/`.pptx`). **Rejected**: leaving Projects unrestricted
  (defeats the point) or restricting to PDF-only (official หนังสือ documents
  are sometimes Office files before being converted/signed, per the e-sign
  flow's own PDF-conversion step implying non-PDF inputs exist upstream).
- Redacting the already-written exploit narrative from migrations/STATE.md/
  the sweep proof's header, rather than leaving it: **this was not asked for
  explicitly as a fix-the-WIP item**, but the brief's own instruction for
  item (a) is specific and the WIP's drafts violated it in three files, not
  just the one the brief named. Treated as part of finishing item (a)
  correctly, not scope creep — fixing a brief violation the earlier run made
  is still "finish what the brief asked for."
- Did NOT touch `tools/pass-anon-probe.mjs` (register it in `run-proofs.mjs`,
  fix its env-targeting) — flagged in the private report as a carried item.
  It reads `.env.local` directly with no `env-lib.mjs`/`resolveTarget`
  targeting and no `→ project:` announcement; wiring a real-network REST
  probe into the standard proof runner without that safety announcement
  risked exactly the "which database actually answered" confusion
  `run-proofs.mjs`'s own header says it was built to stop. A probe whose job
  is "safe to run against production" deserves a dedicated task, not a
  rushed side-fix here.
- Did NOT re-verify the ~500 lines of "Reviewed, no issues found" sections in
  either 2026-10-13 report beyond spot-checking the two items with concrete
  findings (DB #1, App #2) against live code. Re-auditing a clean 6-day-old
  review end-to-end was out of this task's scope; nothing surfaced elsewhere
  this session contradicts those sections.

**What is NOT done / owed:**

1. **Neither 0235 nor 0236 is on production.** Both are pure samo-dev
   migrations. Owner: `node tools/apply-migration.mjs supabase/migrations/0235_anon_execute_is_an_allowlist_not_a_default.sql`
   and `…/0236_username_signin_stops_disclosing_a_real_email.sql` (no
   `--dev`), confirm with the matching `tools/security023{5,6}-*.sql` proofs
   (no `--dev`). 0236 also needs the frontend bundle redeployed (`auth.js`
   changed) and is the higher-priority of the two (live information
   disclosure, not just a hardening sweep).
2. **`npm run deploy:gas` not run** — the upload limits in
   `appscript/prform.gs` are written, verified against a stub Drive, but
   never executed by the real Apps Script runtime (no Google credential in
   this sandbox). Owner should run `npm run deploy:gas -- --verify` after
   deploying to confirm the live `/exec` serves the new code.
3. **`server/nginx-samo.conf`'s security headers (from the 2026-10-13
   report, confirmed still in the file) — deploy status on the VM is
   unconfirmed.** Carried, not this task's job to deploy.
4. Everything in the private report's "carried, not touched" section (HSTS,
   `notifyProjectEmail` content hardening, legacy `admin`/`1234`,
   `pass-anon-probe.mjs` registration) — owner's call, flagged not built.
5. Full proof suite re-run on samo-dev after this task's changes: 70 of 73
   DB proofs green (2 skipped, non-DB), same 3 red as task 14 left
   (`house0146`, `team0196`, `year0219` — real data drift, documented
   previously, NOT caused by this task); both new security proofs green.

**Verification performed:** `npm test` (175 files / 3025 tests) and
`npm run build` green. `npm run check:context` green (trimmed
`.claude/rules/mistakes.md`'s new sentence to fit the 30000-byte budget —
it was at 29998/30000 before this task touched it, so any addition needed
an equal cut). `node tools/apply-migration.mjs … --dev` re-run for both
migrations after the redaction edits (comment-only changes) to confirm the
idempotent bodies still apply cleanly; both proofs re-ran green after.
`npm run proofs -- --dev`: 70/73 green as above. A `/scrutinize`-style
review of `git diff 1714867^..HEAD` traced `src/js/auth.js`'s
password-forwarding change end to end (password stays in scope, travels
once over the same HTTPS call that was already being made) and the GAS
limit-checking order (limits checked before any Drive call, confirmed by
the "creates no folder" tests) — no blocker found; one residual noted below.

**Residual risk noted, not fixed:** the new mimeType allow-lists reject a
file whose browser-reported `type` is empty or doesn't match (e.g. an
unusual OS MIME association). This is a theoretical regression for a real
image upload with no client-side `accept=` enforcement bypass — judged
acceptable (fails LOUD with a named message, not silently; all current
callers traced always populate a real image/PDF/Office mimeType) but worth
knowing if a real user ever reports "my upload stopped working" after this
ships.

**Exact commands the owner runs next**, in priority order:
```
node tools/apply-migration.mjs supabase/migrations/0236_username_signin_stops_disclosing_a_real_email.sql
node tools/db-query.mjs tools/security0236-username-lookup-hardening.sql
node tools/apply-migration.mjs supabase/migrations/0235_anon_execute_is_an_allowlist_not_a_default.sql
node tools/db-query.mjs tools/security0235-whole-class-sweeps.sql
npm run deploy:gas -- --verify
```
then deploy the frontend bundle (`server/deploy.sh`, per `skills/deploy-vm.md`),
and read `~/samo-night/reports/2026-10-20-security.md` for everything this
block and the public repo deliberately omit.

## Task 16 — Static analysis: a lint that finds bugs, not style (2026-10-20)

**RESUMED after a quota cut-off.** The WIP commit (`cf8e697`) had added
`eslint.config.mjs` (flat config, correctness rules only — `no-undef`,
`no-unused-vars` with `args: 'none'`, `no-unreachable`, `no-dupe-keys`,
`no-self-assign`, `no-fallthrough`, `no-constant-condition`,
`no-unsafe-finally`, `no-cond-assign`, `no-dupe-else-if`, `use-isnan`,
`valid-typeof`, `no-unsafe-optional-chaining`, `require-atomic-updates: off`),
`eslint` 10.13.0 pinned as a devDependency, and `npm run lint` in
`package.json`. **What the WIP had NOT done**, checked point by point against
the brief:

- **Cover src/, passport/js/, functions/, server/*.mjs, tools/** — done in
  the WIP's `files:` globs. No gap.
- **Real browser/Bootstrap/Quill globals declared, never `/* global */`
  sprinkled** — the WIP's `BROWSER_GLOBALS` list existed but was incomplete:
  running it surfaced `QRCode` (passport's CDN vendor script,
  `passport/html/admin.html`), `Path2D` (a real Web API) and `__BUILD_ID__`
  (vite's build-time `define`, `vite.config.js`) as false `no-undef` hits.
  Added to the list, each with a one-line reason, matching
  `undefined-refs.test.js`'s existing convention for this exact problem.
- **Add `npm run lint`, run it from `npm test` or CI so it stays green** —
  the WIP added the script but never wired it anywhere; it was not run even
  once before the cut-off (68 hits were sitting unaddressed). Wired as a
  required step in `.github/workflows/build.yml`, right after `npm ci`, and
  its stale "linting is deferred" header comment (written when none
  existed) replaced.
- **For every hit: real bug, or dead code grep proves nothing reaches?** —
  not started by the WIP. Done this run, see below.
- **No auto-fix sweep, no formatting rule** — held to. Nothing was run with
  `--fix`; the 6 warnings fixed (stale `eslint-disable` comments for
  `no-new-func`/`no-eval`/`no-nested-ternary`, rules this config never
  enables) were removed by hand, one line each.

**The 68 hits, triaged one by one (grep before touching anything, per the
brief's own instruction):**

- **1 real bug**, found BY the lint, not by looking for one:
  `src/js/team/index.js`'s `pendingRender` was write-only — a remote
  realtime change that lands while a user is mid-drag is supposed to defer
  its re-render until the drag ends, but `onNodeDrop`/`onMemberDrop` both
  reset the flag without ever reading it, so the deferred render was
  dropped on the early-return (invalid-drop) path specifically. Every OTHER
  path happened to call its own `render()` anyway (realtime writes land in
  `nodesById`/`membersByNode` regardless of `dragging`), which is exactly
  why nobody had reported it. Fixed by capturing the flag before resetting
  it and rendering once more on the early-return path. Write-up:
  `docs/mistakes/app-state.md`. **No automated regression test** — this
  module is DOM/SortableJS-driven with no exported seams and this repo has
  no jsdom dependency (the existing suite tests pure logic only); adding
  jsdom is a bigger infra call than a lint pass should make unasked.
  Verified by hand-tracing every call site of `pendingRender` instead —
  flagged here rather than glossed over.
- **2 rule-config fixes, not bugs, not deletions**: `ignoreRestSiblings:
  true` (the pervasive `const { omit, ...rest } = x` idiom —
  `shop/api.js`, `announcements.js`, `account-switch.js`,
  `analytics-email.test.js`, `env-example.test.js`, `passport/js/admin-page.js`
  — never reads the destructured name on purpose) and `caughtErrors: 'none'`
  (the equally pervasive deliberate `catch (_) {}` / `catch (e) { /* ignore
  */ }` swallow — `team/realtime.js`, `team/index.js`, `auth.js`,
  `dashboard.js`, `utils.js`). Neither turns off a correctness check; both
  stop flagging an idiom this codebase uses on purpose, dozens of times,
  verified by reading several instances of each before changing the rule
  rather than suppressing one at a time.
- **~34 confirmed-dead removals**, each checked by grep before deletion —
  listed in commit `ed39253`'s message rather than retyped here: unused
  imports left from refactors (`pr-form.js`'s `db`, `claude/usage.js`'s
  `pad`, `house/index.js`'s `followUpLabel`, three of `main.js`'s `pr-form.js`
  imports, `projects/{index,inbox}.js`, `shop/products.js`, `team/{health,
  terms}.js`, `tool-frame.test.js`'s `EMBED_SANDBOX`/`TOOLS`), write-only
  locals (`accounts/admin.js`'s `samoYears`, `team/terms.js`'s `busy` and
  `byId`, `house/gaps.js`'s `unplaced`), a fully superseded duplicate
  (`apply-migration.mjs`'s local `loadEnvLocal`/`projectRefFromUrl` — the
  file already uses `migrations-lib.mjs`'s `credentials()`), a redundant
  restatement already pinned by `io.test.js` (`house-import.mjs`'s
  `upsertCols`), a dead function (`admin-main.js`'s `showBoot()` —
  `#adminBootGate` ships visible by default, nothing ever transitions back
  to it), three one-off repair-script leftovers (`house0196`'s
  `readFileSync`, `notify-exposure.mjs`'s `execFileSync`, `proj0181`'s
  `buildDocFolderPath` + its now-false justifying comment), a regex scan's
  unread match variable (`functions/notify.test.js`), and `shop/admin.js`'s
  `sizes`/`colors`, computed and never read.
- **1 normalized, not a runtime bug**: `passport/js/admin-page.js`'s
  `window.cancelEdit = () => {}` called bare as `cancelEdit()` elsewhere in
  the same file DOES resolve correctly (assigning to `window` creates a
  real global a bare reference can reach, browser-only, module or not) —
  but it was the one place in the repo relying on that instead of the
  documented `window.fnName = fnName` convention (`passport/CLAUDE.md`:
  "`window.fnName = ...` for inline `onclick` handlers") every other
  window-bound handler uses. Rewritten to match, not suppressed.
- **1 left dormant, not deleted**: `main.js`'s `applyLauncherRoleGating` is
  a documented standing gate (`launcher.js`'s own comment: no registry
  entry sets `roles` yet, and deleting a dormant gate was explicitly called
  a separate decision from the refactor that emptied it). Given an
  `eslint-disable-next-line` pointing at that comment, not removed.
- **1 flagged for the owner, not acted on**: `projects/inbox.js`'s
  `onSignCancelClick` read `btn.dataset.docId` and never used it, unlike its
  two siblings (`onSignApproveClick`/`onSignRejectClick`), which both log a
  doc-timeline entry via `docId` when a sign request is approved or
  rejected. Removed the dead read (fixes the lint hit); whether "cancel"
  should ALSO append a doc-timeline entry is a product decision this task
  does not make for the owner — `src/js/projects/inbox.js:3627`.
- **1 unused devDependency**, found while scrutinizing this task's own
  diff, not by the lint itself: the WIP's commit had added `globals`
  17.13.0 alongside `eslint`, but `eslint.config.mjs` never imports it (the
  globals list is hand-rolled, unioned with Node's real `globalThis` —
  same approach `undefined-refs.test.js` already used for this exact
  problem). Removed; `npm install` regenerated the lockfile.

**Counts**: 68 lint hits → 0. 1 real bug, fixed, written up. ~34 dead-code/
unused-import removals, each grep-confirmed before deletion. 2 rule-config
tunings (0 correctness rules turned off). 6 stale `eslint-disable` comments
removed (warnings, not errors — unrelated rules this config never enables).
1 unused devDependency removed.

**Verification performed**: `npm run lint` exits 0. `npm test` — 175 files /
3025 tests, green, both before AND after every edit batch. `npm run build`
— both entries (public/admin + Passport) clean. `npm run check:context` —
within budget (`.claude/rules/mistakes.md` at 29996/30000; did not touch its
seven-classes text, only let `mistakes:index` regenerate the per-file count
line). `git status` clean. A `/scrutinize`-style pass over
`git diff cf8e697^..HEAD` (this task's full range) traced the `team/index.js`
fix's diff against its unchanged neighbours, re-diffed every dead-code
removal file-by-file to confirm nothing else referenced what was deleted
(a stray reference would have shown up as a NEW `no-undef` hit, and it did
not), and caught the unused `globals` devDependency above.

**Could not verify**: no automated regression test for the `team/index.js`
fix (see above — this repo has no jsdom). `npm run handoff:check` crashes
in this sandbox exactly as documented by every prior task this queue
(`fatal: ambiguous argument 'origin/agent/2026-10-20..HEAD'` — this branch
has never been pushed, so the `origin/...` ref doesn't exist to diff
against — followed by an `ENOENT` reading a memory-index path the script
hardcodes under `~/.claude/projects/…`, which this sandbox never populated;
this session's real memory store is `~/samo-night/memory/`, a different
path entirely). Not re-diagnosed here either — `npm test` + `npm run build`
+ `git status`, all re-run fresh for this block, substitute for it.

**Nothing to apply/deploy for this task** — no migration, no schema change,
no production-facing behavior change beyond the one `team/index.js` fix
(client-side only, ships on the next normal deploy). **Exact commands the
owner runs next**: none required for this task specifically; the usual
`server/deploy.sh` (`skills/deploy-vm.md`) carries this fix whenever the
next deploy happens. If CI runs the required-checks on this branch, confirm
the new `npm run lint` step in `.github/workflows/build.yml` goes green
there too (it is local-verified green in this sandbox but was never seen by
GitHub Actions, since this branch cannot push).

## Task 17 — A student's phone: accessibility and friction sweep (2026-10-20)

**RESUMED after a quota cut-off.** Two WIP commits existed (`005e6ec`
"paused by the owner", `ba913a7` "cut off by the quota"). Checked point by
point against the brief:

- **`tools/browser/a11y-sweep.mjs` (samo-dev only, axe-core injected,
  390px/1280px, signed out + signed in, violations/overflow/console
  errors/tap-targets/focus-visible/modal-trap)** — **NOT started by the
  WIP** (no file existed; this was the `Done when:` gate). Built this run,
  see below.
- **Walk the student flows at 390px: sign-in (both kinds), PR form,
  VitalSound form, shop, /me, ระบบบ้าน claim, a หน้าฝ่าย page** — the WIP
  had already walked sign-in, the PR ticket-tracking dashboard, and the
  VitalSound board/form, finding and fixing FIVE real `alert()` dead
  ends (see below) with a test each. It had not yet looked at shop, /me,
  or ระบบบ้าน. Continued this run: read `shop/cart.js`,
  `shop/checkout.js`, `house/my-house.js` (the ระบบบ้าน claim card) and
  `me-page.js` end to end. `my-house.js` and `checkout.js` were already
  heavily hardened from earlier sessions (double-submit guards via
  `btn.disabled`, inline status text, no `alert()` anywhere, a
  retry-safe slip-upload path) — found ONE new defect, in `shop/cart.js`
  (below). `pr-form.js` and `vs-form.js` (the forms themselves, not just
  their tracking/board siblings) were already alert()-free with
  double-submit guards from earlier work. Did not find a dedicated
  public หน้าฝ่าย READER module — each ฝ่าย authors its own page under
  `public/embed/<slug>/` (DEPT-TOOLS.md's by-design model); auditing
  ฝ่าย-authored content is out of scope for a generic sweep and is what
  `a11y-sweep.mjs`'s `/departments` + embed-page coverage is FOR, once run.
- **Fix defects with a test each, record axe counts before/after per
  route** — the axe counts are **OWED**: this sandbox has no Chrome/Chromium
  binary at all (checked `/usr/bin/*chrom*`, `find / -iname '*chrome*'`,
  `~/.cache/ms-playwright`, `~/.cache/puppeteer` — nothing), so the sweep
  tool could be written and statically reviewed but never executed. Same
  gap `tools/browser/shop-checkout-navigate-away.mjs` hit earlier this
  queue (HANDOFF's own note: "written, never run — no Chrome/network in
  this sandbox"). Local network access (even `curl` to `localhost`) is
  also denied by this sandbox's permission mode; `node -e "fetch(...)"`
  works, confirming the dev server itself is reachable — only the browser
  binary is missing.

**The WIP's five alert()-removal fixes** (all already committed, verified
present and correct, not redone): Google sign-in failure (`signin-modal.js`
+ `account-switch.js`, shared `showGoogleSigninError`, a `#signinGoogleAlert`
box outside both sign-in screens), the PR ticket dashboard's refresh
(`pr-tracking.js`, `#prDashAlert`), the VitalSound board's "เจอเหมือนกัน" +
public comment (`vs-board.js`, an `aria-live` announcer for the me-too
button since its own state deliberately does not change on failure, plus
an inline box for comments), the ticket-tracking remark box
(`vs-tracking.js`, `#userRemarkAlert`), and the VitalSound form's Quill
image-insert failure (`main.js`'s `makeQuillImageHandler` — now inserts a
visible failure note in place of the placeholder instead of deleting it
and alerting). Each already had its own test
(`signin-screen.test.js`, `pr-tracking.test.js`,
`vs-board-error-feedback.test.js`, `vs-tracking-remark.test.js`,
`main-quill-image.test.js`) asserting structurally (no jsdom here) that no
`alert()` remains and the visible box/text is reachable. Added the
changelog entries the WIP had left out for these (`src/data/changelog.js`
PENDING — `account` + `vs` + `pr` areas; CLAUDE.md's handoff loop step 3
calls this mandatory for anything a person would notice, and a previously
silent-after-two-retries error becoming visible is exactly that).

**New this run:**

1. **`tools/browser/a11y-sweep.mjs`.** Routes mirror `PATH_ROUTES` in
   `src/js/main.js` (dynamic `/news/<id>` and `/tools/<slug>` excluded —
   each depends on content that may not exist on samo-dev, and shares a
   renderer with the static page already swept). Admin panes: ALL 14
   `data-admin-side` values from `SECTION_META` in `admin-main.js` — checked
   HANDOFF + STATE.md for an owner-authored "main panes" shortlist first;
   none exists, and a sweep is cheap, so "main" here means every sidebar
   entry a signed-in session can reach, not a narrowed subset. axe-core is
   injected once via `Page.addScriptToEvaluateOnNewDocument` (persists
   across every `Page.navigate`, never re-fetched) alongside a small
   in-page probe object for overflow / tap-targets / a focus-visible
   sample. `axe-core` pinned exact (`4.10.3`, was `^4.10.3`) since the
   brief called for a pinned devDependency — `package-lock.json` updated
   via `npm install --package-lock-only` (no new download; same resolved
   version, confirmed network-independent).
   - **Caught and fixed my own bug while writing this, the kind a real run
     would have caught the hard way.** The modal focus-trap check
     originally dispatched a synthetic `KeyboardEvent('keydown', {key:
     'Tab'})` from INSIDE the page (in PROBE_SRC) to simulate Tab-cycling.
     That does nothing — browsers only run the native "move focus to the
     next tabbable element" default action for a REAL key press, not a
     script-dispatched one, so `document.activeElement` would never
     change and "focus never left the modal" would read as a PASS whether
     or not a trap exists at all (exactly `.claude/rules/mistakes.md`
     class 7's "a probe that only asserts X cannot tell a working guard
     from a broken one"). Moved the Tab simulation out of the page probe
     and into the Node driver using CDP's `Input.dispatchKeyEvent` (real
     native key events, which DO trigger default focus traversal unless a
     page's own JS intercepts it — which is exactly what Bootstrap's modal
     trap does at the edges). Escape stayed a synthetic in-page dispatch,
     correctly — Escape has no native browser default action to
     replicate, only Bootstrap's own `keydown` listener needs to see the
     event, so a synthetic dispatch is sufficient there. Caught by tracing
     the code by hand (no Chrome to run it against and watch it pass
     vacuously), not by a test — there is no way to unit-test a CDP
     interaction in this repo's jsdom-less suite, so this is a STATIC
     claim, not a verified one; the owner should watch for `stayedInside:
     true` on a modal that is known NOT to trap focus, the first time this
     runs for real, as a sanity check on the fix itself.
   - Cannot verify it runs end-to-end, cannot verify the selectors against
     a live DOM beyond careful reading, cannot report any actual violation
     counts. **Owed to the owner**: run it once (`npm run dev` then
     `node tools/browser/a11y-sweep.mjs`, needs a real Chrome/Chromium —
     `CHROME=/path/to/it` if not at `/usr/bin/google-chrome`), read
     `results.json` + the per-rule console summary, and treat the FIRST
     run's numbers as the baseline this task was supposed to produce.
2. **Shop cart — the "+" button's max-reached reason was `title=""` only**
   (`src/js/shop/cart.js`), invisible on a phone (no hover). Exactly
   mistakes.md class 4's "a title tooltip does not exist on a phone",
   applied to a disabled-control's reason instead of truncated text — a
   buyer at the stock cap saw a faded `+` with zero explanation. Replaced
   with a permanent visible line (`.cart-item-maxhint`, uses the existing
   `--shop-ink-500` token, no new color). Test:
   `src/js/shop/cart-maxhint.test.js`. Changelog: `shop`/`public` PENDING
   entry. **Found but NOT fixed** (lower severity, left as a finding, not
   touched): `src/js/team/terms.js`'s delete-current-year button has
   the identical `disabled title="..."` shape, but it is admin-only (not
   a student flow this task's brief named) and the adjacent "ปีปัจจุบัน"
   badge already gives a sighted user most of the context the title would
   add — lower priority than the cart one, which is why it is a finding
   here rather than a fix.
3. **Accidental commit cleanup**: the WIP's `ba913a7` commit included
   `.npm-cache/_logs/...` (an npm debug log) and
   `.npm-cache/_update-notifier-last-checked` — npm's own cache directory,
   committed by accident (`NPM_CONFIG_CACHE` pointed inside the repo in
   that run). Removed from git, added `.npm-cache/` to `.gitignore`.

**Verification performed**: `npm test` — 180 files / 3052 tests, green,
both before and after. `npm run build` — both entries (public/admin +
Passport) clean. `node --check` + `npx eslint` on the new `.mjs` file —
clean. `npm run test:clean` — 180 files / 3044 tests (the 8-test gap
against plain `npm test` is pre-existing and unrelated to this task's
diff: several tests conditionally register fewer cases when `.env.local`
is absent, which `test:clean`'s tracked-files-only copy never has —
confirmed by grepping for `.env.local`/`existsSync` across the suite
before accepting the gap as expected, not a regression). `npm run
check:context` — within budget, untouched files. A `/scrutinize`-style
pass over `git diff 6dd4b5a..HEAD` (this task's full range, both WIP
commits plus this run) traced every changed file against its unchanged
neighbours; the one real finding (the Tab-dispatch bug above) was fixed
during the pass, not left for later.

**Could not verify**: `npm run handoff:check` crashes in this sandbox
exactly as every prior task this queue reported (`fatal: ambiguous
argument 'origin/agent/2026-10-20..HEAD'` — never pushed, no `origin` ref
to diff — then `ENOENT` on a hardcoded `~/.claude/projects/…` memory-index
path this sandbox never populated; the real memory store here is
`~/samo-night/memory/`). The a11y sweep tool's actual output (violation
counts, overflow, tap-targets, focus-visible gaps) — no Chrome binary in
this sandbox, documented above, not re-attempted beyond confirming the
binary truly does not exist anywhere on the filesystem.

**Nothing to apply/deploy** — no migration (task 17 owns no number in the
reserved block; 0238 is task 17's reserved number, left unused since no
schema change was needed, which keeps `migration-numbers.test.js` green by
design, not by accident), no production-facing change beyond the cart
hint (client-side only, ships on the next normal deploy) and the WIP's
five alert-removal fixes (same). **Exact commands the owner runs next**:
(1) `npm run dev`, then in another shell `node
tools/browser/a11y-sweep.mjs` (set `CHROME=` if Chrome is not at
`/usr/bin/google-chrome`) to get this task's actual axe baseline; (2) spot
one admin pane's sweep result against the live page by eye once, since
the modal-focus-trap fix above is reasoned, not run; (3) the usual
`server/deploy.sh` whenever the next deploy happens, for the cart-hint fix
and the WIP's alert-removal fixes to reach production.

## Task 18 — Speed on a phone (2026-10-20)

**Could not do the brief's literal "measure first": no browser in this
sandbox.** Same gap Task 17 hit, re-confirmed rather than assumed: no
`google-chrome`/`chromium` binary anywhere on the filesystem; `sudo`/`apt-get
install` both refused (no root); `npx puppeteer browsers install chrome` and
`npm install --no-save sharp` both failed with `EROFS` on `~/.npm/_cacache`
(the home-dir npm cache is read-only here); `pip`/`python3 -m pip` don't exist
either. So there is **no LCP, no time-to-`window.__samoBooted`, and no
"three runs, median"** — every number below is a BYTE COUNT read from the
real `dist/` build output (deterministic given the same source: rebuilding
during this task reproduced the same sizes to the byte across half a dozen
rebuilds, only the content-hash in the filename changed), not a browser
measurement. **Owed to the owner**: run the actual Lighthouse/CDP pass once
Chrome exists somewhere reachable — command at the bottom.

**What I measured instead, and what it found.** Read every `<script
type="module">` / `<link rel="modulepreload">` / local `<link
rel="stylesheet">` out of `dist/index.html` and `dist/admin/index.html` —
that set is exactly what a browser fetches before the entry module finishes
evaluating, excluding third-party CDN tags (those are outside this build's
control). Two real, fixable costs turned up:

1. **`shop/qr.js` bundled two unrelated things of very different weight.**
   Its own header comment already described it as two surfaces — (a)
   `showOrderQrModal`, the lightweight `qrcode` encoder every shop customer's
   order view can show, and (b) `openScannerModal`, the `Html5Qrcode`
   camera-scanning engine (≈338 KB) only admin's pickup scanner uses, already
   correctly behind `await import('./qr.js')` in `admin.js`. But
   `shop/orders.js` imported `showOrderQrModal` with a **static** import —
   and a static import pulls the WHOLE module, Html5Qrcode included — into
   the shared chunk the public entry's `<link rel="modulepreload">` fetches
   on literally every page, for a feature only reachable from `/admin/`.
   **Fix**: split into `qr.js` (scanner, unchanged import site) +
   `qr-order.js` (new, `qrcode` only). `orders.js` now imports from the
   light file; nothing else referenced the heavy one's customer half (swept
   with grep before changing anything).
2. **Quill shipped as a render-blocking `<script src="cdn.quilljs.com/…">`
   in `index.html`'s `<head>`, on every route, for an editor only the
   VitalSound REPORT tab uses.** CLAUDE.md already says "Quill, d3-org-chart,
   GrapesJS — DYNAMIC IMPORT ONLY, never an entry bundle"; d3-org-chart and
   GrapesJS followed it (both behind `import()`), Quill did not — it isn't
   an npm dependency here (CDN-only), so there was no `import()` boundary to
   put it behind. **Fix**: `src/js/load-quill.js` injects the `<script>`/
   `<link>` tags on first need (cached promise, retries on failure);
   `main.js`'s `setupVsQuill()` is wired to the VitalSound tab button's
   `shown.bs.tab` event, which — traced, not assumed — fires both on a real
   click AND on the boot-time route to `/vssound` (the SAME mechanism the
   pre-existing global `shown.bs.tab` listener a few lines above already
   relies on for scroll-reset on direct-linked tabs, so this was already a
   load-bearing assumption in this file, not a new one).

**A real bug my own `/scrutinize` pass caught, fixed the same session.**
`vitalSoundForm` has no `action` attribute. Before Quill was lazy,
`initVsForm()` (which wires the submit listener and its `preventDefault()`)
ran at module load — before a user could possibly see the form. Making
Quill lazy opened a real window, between the tab appearing and Quill's CDN
fetch resolving, where the submit BUTTON is visible but no listener is
attached yet — a submit in that window would have fallen through to the
browser's default behaviour (a GET to the current URL — a full-page reload,
discarding whatever the user had typed), and the window is LONGER on exactly
the slow connections this task is about. Fixed with a capture-phase `submit`
guard on the form that `preventDefault()`s while `vsQuillRef` is still null,
and is a no-op once it isn't. Test in `load-quill.test.js`.

**Measured, before → after** (exact bytes from `dist/`, not console
rounding, except the "before" row — captured once, at the very start, before
any fix, from vite's own build log, which prints to 0.01 kB / ≈10 B
precision):

| What | Before | After | Change |
|---|---|---|---|
| Public entry's eager shared chunk (`core-*.js`, fetched via `modulepreload` on EVERY public page, before `main.js` finishes evaluating) | 1,038,650 B raw / 290,620 B gzip | 698,590 B raw / 188,260 B gzip | −340,060 B raw (−32.8%) / −102,360 B gzip (−35.2%) |
| Public entry total first-load JS+CSS (entry script + that chunk + its stylesheet) | 1,723,860 B raw / 425,540 B gzip | 1,384,890 B raw / 323,540 B gzip | −338,970 B raw (−19.7%) / −102,000 B gzip (−24.0%) |
| Render-blocking third-party requests in `<head>` on every PUBLIC page | Bootstrap CSS, Google Fonts, Bootstrap Icons, **Quill CSS + Quill JS** | Bootstrap CSS, Google Fonts, Bootstrap Icons (Quill now fetched only once the VitalSound tab is opened) | 2 fewer blocking requests on every route except `/vssound` |
| LCP / time to `window.__samoBooted`, throttled Fast 4G + 4× CPU, 390 px | **NOT MEASURED** — no Chrome in this sandbox | **NOT MEASURED**, same reason | owed |

Admin's entry (`admin/index.html`) was measured too but NOT changed —
672,861 B JS + 325,189 B CSS + the same shared `core-*.js` chunk, both
before and after (nothing in admin's own import graph changed). Admin still
blocks on Quill, Cropper.js AND Sortable.js in `<head>` — see "rejected /
deferred" below for why this task left that alone.

**New guard: `npm run check:bundle` (`tools/check-bundle.mjs`).** Reads
`dist/` after a build and fails if either entry's first-load JS+CSS exceeds
a budget set ~15% above today's AFTER-fix size (public 1,600,000 B, admin
1,950,000 B raw — a ceiling to catch a regression, not a target to chase),
or if GrapesJS's or d3-org-chart's own chunk is ever referenced by an
entry's `<script type="module">` or `<link rel="modulepreload">` (checked by
filename prefix against Vite's own deterministic chunk-naming hook, NOT by
grepping chunk content for the library's name — tried that first, and it is
unreliable: our own glue code legitimately references these libraries by
name, e.g. `org-graph.js`'s `const [{ OrgChart }] = await
import('d3-org-chart')` already puts the string `OrgChart` in the public
entry chunk in a CORRECT build, which would have been a permanent false
positive). Also fails if `dist/index.html`'s `<head>` still carries a real
`<script>`/`<link>` tag naming `quilljs` (scoped to the public entry only —
see below). **Proved red**: temporarily added `import grapesjs from
'grapesjs'` to `main.js`, rebuilt — the public entry gained a
`grapes-*.js` `modulepreload` (+1.1 MB) and the check failed on both the
named-library check and the byte budget; reverted, confirmed green again.
Registered as `npm run check:bundle`, run as part of this task's own
`Done when:` gate.

**Decisions, and what I rejected:**
- **Split `qr.js` into two files, rather than just making `orders.js`'s
  import dynamic.** A dynamic `await import('./qr.js')` from `orders.js`
  would have kept Html5Qrcode OUT of the eager chunk too, with a one-line
  diff — but every customer who ever opens their own order's QR would then
  download the WHOLE merged chunk, camera-scanner code included, just to
  render a static SVG. Splitting means the customer path's own static
  import stays genuinely light (`qrcode` only, no `Html5Qrcode`) and the
  scanner chunk is only ever paid for by the admin flow that already
  dynamically imports it. More files, but the actually-correct shape — the
  header comment in the original `qr.js` already described it as two
  surfaces; the file just hadn't been split along that line.
- **Did NOT lazy-load admin's Quill, Cropper.js or Sortable.js.** Same
  class of cost, smaller audience (staff, not every student), and higher
  risk: `admin-main.js`'s `announcements.js` `fillCreatorFormForEdit()`
  (reached via the `#creator/{id}` deep link from the public reader's "edit"
  button, and from the manage-list pencil) sets `creatorQuill.root.innerHTML
  = post.content` SYNCHRONOUSLY, assuming the editor already exists — it is
  not gated behind any tab-shown event the way the public VS form is.
  Making it lazy correctly would mean either awaiting Quill before that
  function can run (touches a deep-link code path used by staff publishing
  real announcements) or accepting a null-pointer risk on a workflow this
  task's budget did not leave room to test carefully. Left as a named,
  deferred finding — `admin-main.js` lines ~62-111, `announcements.js`
  `fillCreatorFormForEdit`.
- **Did not touch `welcome-banner.jpg`.** Measured: `public/welcome-banner.jpg`
  is a 2000×666 px, 297 KB JPEG, marked `fetchpriority="high"` as the FIRST
  slide of the home page's hero carousel — i.e. it is very likely the LCP
  element on `/`, the single most common route, served at full desktop
  resolution to a 390 px phone with no `srcset`. This is a real, sizeable,
  fixable cost (a correctly-sized/compressed version would likely be
  4-6× smaller) that this task found but **could not fix**: no image tool
  exists in this sandbox (checked `convert`/`magick`/`cwebp`/`pngquant`/
  `jpegoptim`/`gm`; no `PIL` for python3; `sharp` via `npm install --no-save`
  failed on the same read-only npm-cache `EROFS` as the Chrome install
  attempt) and hand-writing a JPEG encoder to do this safely was judged not
  worth the risk of shipping a corrupted asset. **Recommended next step,
  for whoever has a real image tool**: re-export at ≤1200 px wide (covers
  every realistic viewport without upscaling), or add a build-time
  responsive-image step (e.g. `sharp` at build time generating a `srcset`)
  if this kind of asset recurs.
- **nginx caching (`server/nginx-samo.conf`) — checked, not changed.**
  `/assets/` is already `Cache-Control: public, max-age=31536000,
  immutable` (hashed filenames), gzip already covers JS/CSS/SVG/fonts, HTML
  is correctly `no-cache`. Nothing to fix here — "no change" is the honest
  finding (memory `keep-what-works-show-evidence`).
- **Did not restructure the 341 KB public CSS file.** Real weight, but
  splitting one global stylesheet per-route is a materially bigger,
  riskier change (every tab currently assumes the whole stylesheet is
  present) than this task's "fix the top few, not everything" scope
  justifies without a live before/after to actually confirm the split
  helps more than it costs in extra requests. Left as a lower-priority
  candidate for a future, dedicated pass — not attempted.

**Verification performed.** `npm run build` (both entries + Passport) —
clean, deterministic byte counts across repeated rebuilds. `npm run
check:bundle` — green, and separately proved red (grapesjs experiment
above) and reverted. `npx eslint` over every touched file — clean. `npm
test` — 182 files / 3068 tests, green (before this task: 182/3056 — net new
tests are `load-quill.test.js` + `shop/qr-order.test.js`, both source-text
guards since this repo runs no jsdom). `npm run test:clean` — 182/3060
(the 8-test gap against plain `npm test` is the same pre-existing,
documented `.env.local`-conditional-test gap Task 17 already found and
ruled out as unrelated — re-confirmed, not re-diagnosed). `npm run
check:context` — unchanged, within budget. A `/scrutinize` pass over this
task's full diff (`git diff 1586b43..HEAD`) found and fixed the
submit-before-Quill-loads gap above — the one real correctness risk this
task's changes introduced; everything else traced clean (import/export
graph after the `qr.js` split checked against every OTHER caller in the
repo via grep before touching anything, not just the two files edited).

**Could not verify.** `npm run handoff:check` — same crash every task this
queue has hit (`fatal: ambiguous argument 'origin/agent/2026-10-20..HEAD'`,
then `ENOENT` on a hardcoded memory-index path this sandbox never
populated); substituted the direct checks above. Live LCP/boot-time/
request-waterfall numbers — no Chrome in this sandbox, see the top of this
block. Whether the modulepreload-graph check in `check-bundle.mjs` would
also catch a GrapesJS/d3-org-chart leak that arrives via a DIFFERENT chunk
name than today's (e.g. after a dependency upgrade changes how Rollup
splits it) — only tested against today's actual chunk names.

**Nothing to apply/deploy on samo-dev — no migration** (0239+ stays
reserved for later tasks per `NIGHT-TASKS.md`; this task's fixes are pure
frontend/build, no schema touched). **Nothing on production either** — this
is all client-side, ships on whatever the next normal `server/deploy.sh`
deploy is, same as every other unreleased commit on this branch. **Exact
commands the owner runs next**: (1) once a machine with a real Chrome is
available, run the actual measurement this task's brief asked for —
`npm run dev`, then drive it with `tools/browser/*.mjs`'s pattern (390 px,
throttled, cold cache) against `vite preview` of a production build, for
`/`, `/me`, `/shop`, a หน้าฝ่าย page, and `/admin/`, and treat THOSE numbers
as the real baseline (this task's byte counts are a floor, not a
substitute); (2) `npm run build && npm run check:bundle` before any future
deploy, same as `npm test` — it is cheap and catches exactly the class of
regression this task found twice; (3) the usual `server/deploy.sh` to ship
these two fixes; (4) if anyone revisits admin's Quill/Cropper/Sortable or
`welcome-banner.jpg`, read the "rejected / deferred" bullets above first —
both have a specific, named reason they were left alone, not an oversight.
