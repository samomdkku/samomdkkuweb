# NIGHT-TASKS — 2026-10-14: every system survives into the next SAMO year
Budget: 6 runs
Until: 2026-10-14T09:00:00Z
Reserve sessions: 0
Branch: agent/2026-10-14

THE OWNER'S ASK (2026-10-13, verbatim where it matters): make "every single
system … persist forever more than this year, self sustainable". Example: the
PR form has **290 tickets in โพสต์เรียบร้อย (เสร็จสิ้น)**; "the next samoyear the
new worker if they continue to use this it'll be a mess, so it should can look
PR Staff Dashboard for each samoyear like หนังสือโครงการ". Questions they want
DECIDED, not asked back: "what to do with the data, do we should have ways to
delete it, backup?, export it save at external?, should the drive files that
saved be separate by samoyear to be organize properly. the จัดการทีม for each
year." Scope: "every single system from prform vssound samoshop หนังสือโครงการ
adminteamsamo ระบบบ้าน หน้าฝ่าย etc every single function in the samoweb,
adminsamo, samopassport". They want you to "plan, thinking all edge case
thoroughly, handle everything, decide everything. and implement it all",
re-check with **/scrutinize** (installed: use the Skill tool, skill name
`scrutinize`), "best practice, best way", "also scan for bugs, properly handoff".
The budget is everything until the weekly reset, 2026-10-14 16:00 ICT.

⛔ **CONSTRAINTS THAT APPLY TO EVERY TASK. Read them before you start.**

- **You have samo-dev, and ONLY samo-dev.** `~/samo-agent/.env.local` holds
  samo-dev's URL, anon key and access token and nothing else; that token answers
  403 on production (measured 2026-10-13). So you CAN and SHOULD:
  `node tools/apply-migration.mjs supabase/migrations/NNNN_*.sql --dev`, then run
  your proof with `node tools/db-query.mjs tools/<proof>.sql`, read every
  verdict line, and fix until green — and prove it RED first where you can
  (run the proof before the migration, or reintroduce the bug, and watch it
  fail). Every tool prints `→ project: <ref> (<label>)`: the only acceptable ref
  is samo-dev's; if you ever see a different one, STOP that task and write why.
  ⚠️ samo-dev holds an UNMASKED copy of real student data (decision D1): never
  print rows of people into commits, docs or logs — counts and synthetic probe
  rows only, and roll back or delete what you create. samo-dev's data is NOT
  production's (e.g. it has no open ระบบบ้าน held rows) — CREATE the rows a
  scenario needs, inside the proof's transaction. Production is applied by the
  owner's next session after review: say "applied to samo-dev, proof N/N; NOT on
  production" wherever it matters. Use the facts below for production numbers.
- **You cannot push, deploy, run Apps Script, or touch production.** Commit on
  this branch. Every run CONTINUES `agent/2026-10-14`: read
  `git log --oneline origin/main..HEAD` and `docs/YEAR-ROLLOVER.md` first — an
  earlier task decided things you must build on, not re-decide. Never reset,
  rebase or merge the branch.
- **Migration numbers are RESERVED, one block per task** so cold runs never
  collide: task 2 → 0219, task 3 → 0220, task 4 → 0221, task 5 → 0222, task 6 →
  0223, task 7 → 0224, task 8 → 0225, task 9 → 0226, task 10 → 0227–0228, task 11 → 0229.
  A task that needs no migration leaves its number unused (a gap is fine;
  `migration-numbers.test.js` must stay green — read it).
- **ADD, never DROP, in these migrations.** Production runs the CURRENT bundle
  until the owner deploys yours; a dropped or renamed column breaks it
  (`skills/ship-a-migration.md`). New columns get defaults or are nullable, and
  old code must keep working against the new schema.
- **Read the LIVE-equivalent body before redefining a function**: the newest
  migration that defines it (`grep -l "function public.<name>" supabase/migrations/* | sort | tail -1`),
  NEVER the first one. 0193 rebuilt a function from an old copy and silently
  reverted 0190 for three weeks (`docs/mistakes/postgres-schema.md`, newest entry).
- **Every new SECURITY DEFINER gate**: write it so it FAILS CLOSED — since 0218
  `current_user_role()` returns '' not NULL, but still prefer
  `if not coalesce(<check>, false) then raise`. Read `docs/mistakes/authz-rls.md`
  and `.claude/rules/mistakes.md` classes 1, 2, 4, 5 before any RLS or RPC.
  Pair every DENY assertion in a proof with an ALLOW over the same rows, pick
  probe subjects by the gate's own predicate (never `role = 'dev'` — there are
  ZERO dev accounts in production), and register proofs in `tools/run-proofs.mjs`.
- **`STATE.md` is checked by `state-handoff.test.js`:** "Migrations through
  NNNN" must equal the highest file on disk and the live-proof count must equal
  what `tools/run-proofs.mjs` registers. Update both in the SAME commit as a new
  migration/proof, and write beside them that 0219+ are NIGHT-AGENT WORK,
  applied to samo-dev only, NOT production. Claim a proof result only for a run
  you did, on samo-dev, with its N/N. STATE.md has a line budget —
  keep it short; detail goes to `docs/YEAR-ROLLOVER.md`.
- **The repo AND `docs/` are PUBLIC** (docs/ is served at samo.md.kku.ac.th/docs).
  No student names, no emails, no open-security-hole detail. Security findings
  go to `~/samo-night/reports/` (outside the repo).
- **Memory**: ~65 files at the path in your preamble — decisions that live
  nowhere else. Read the ones your task touches (team-identity-is-kkumail,
  one-person-registry, master-grants-all-project-seats, perms-architecture,
  passport-*, shop-*, vs-workflow-direction, gas-*, upload-on-save-not-on-pick,
  trashed-drive-file-still-public, docs-are-published, our-bug-our-repair …).
- Follow `CLAUDE.md`: write-ups in `docs/mistakes/*.md` for bugs you FIX
  (`npm run mistakes:index` after), a `PENDING` entry in `src/data/changelog.js`
  for anything a person would NOTICE (plain Thai, `changelog.test.js` enforces
  it), Thai UI text, no emojis in UI, light theme only, tokens not raw colours.
  `npm test` and `npm run build` green before every commit.
- **UI**: every admin control must work at 390px wide with no sideways scroll.
  If you add a year picker, REUSE one component for every system (the owner's
  ask was "like หนังสือโครงการ", whose ปีงบ filter is the model — read
  `src/js/projects/` for it) — one picker, one source of years, never a copy per
  system (class 6).
- **Before you end ANY task**: run the `scrutinize` skill on your own diff for
  that task (`git diff <your first commit>^..HEAD`), fix what it finds, then
  append a block to `docs/state/night-agent.md` headed EXACTLY
  `## Task N — <system> (2026-10-14)` (N = your task number; the runner's check
  looks for that heading, so write it LAST, only when the task is finished, and
  never write another task's heading): what you built, every
  decision with the alternative you rejected, what is WRITTEN NOT APPLIED, and
  the exact commands the owner runs next. Update your row in the HANDOFF section
  task 1 creates.
- **Commit as you go.** A run can be cut off by the quota at any moment.

⛔ **THERE IS NO HUMAN AWAKE. NEVER END A TASK BY ASKING A QUESTION.**
Decide, act, record what you chose, what you rejected and what would change
your mind. A defended decision the owner can overturn beats a question nobody
reads until morning.

## FACTS MEASURED ON PRODUCTION, 2026-10-13 (you cannot query production; use these)

- Whole database: **60 MB** (Supabase free tier: 500 MB). Biggest tables:
  `analytics_events` 26,266 rows / 10 MB since 2026-07-23 (per month: Jul 3,624 ·
  Aug 12,725 · Sep 7,766 · Oct 1–13 3,732); `claude_usage_samples` 3,511 / 6.8 MB
  since 2026-08-15; `project_notifications` 3,897 / 1.9 MB; `notify_log` 581;
  `students` 1,647; `people` 1,698; `users` 756.
- **PR** `pr_tickets`: 311 rows since 2026-05-22 — โพสต์เรียบร้อย (เสร็จสิ้น) 290 ·
  รอ PR รับเรื่อง 12 · PR รับเรื่อง 7 · รอโพสต์ตามกำหนดการ 1 · รับบรีฟแล้ว 1; 11 soft-deleted.
- **VitalSound** `vs_tickets`: 119 since 2026-05-29 — เสร็จสิ้น 53, the rest open
  across 8 statuses; `vs_public_comments` 16, `vs_followers` 5, `vs_tags` 11.
- **Shop** `shop_orders` 43 (paid 35, review 9), latest 2026-10-13; 3 products.
  shop_orders has `updated_at` but NO `created_at`.
- **หนังสือโครงการ** `projects` 42: `fiscal_year_be` = 2570 on 11, **NULL on 36**;
  `project_documents` 87, `project_files` 155, `project_sign_requests` 25.
- **ทีม SAMO** `team_terms`: year 2569 `is_current=true`, year 2570 exists,
  `published_at` NULL on both; `team_archive_nodes`/`team_archive_members` exist
  and are EMPTY; `team_nodes` 300, `team_members` 450. See 0104/0106 and
  `publish_team_term` — a term/archive mechanism already exists; build on it.
- **Passport** has its own year model: `passport.samo_years` (one row, name
  "MDKKU SAMO'69", started 2026-06-17, `ended_at` NULL) and `passport.samo_seasons`
  (one: "Q2"); `passport.scans` 1,161 (2026-06-17 → now) carry `samo_year_id`.
  There is ALSO `passport.seasons` (separate table — find out which is live).
- **ระบบบ้าน** covers MD49–MD54 (owner: MD47/48 are not added). ชั้นปี is derived
  from `academicYear()` + รหัส (`src/js/study-year.js`); MD49 is ปี 6 now and
  graduates. 0217 (applied) gave held rows a `follow_up` flow.
- Three existing "year" notions, none shared: `team_terms.year` (BE, 2569),
  `passport.samo_years` (uuid + name), `projects.fiscal_year_be` (ปีงบ, Oct-start)
  plus `study-year.js`'s academic year (rollover month 8). Unifying the SAMO-year
  notion WITHOUT breaking the other three is task 2's job.
- Drive: uploads go through Apps Script into "My Drive/IT Database/{PR,Projects,
  Shop,Team,Passport}" (memory gas-apps-script-topology; `appscript/*.gs`). A
  trashed Drive file is still PUBLIC (memory trashed-drive-file-still-public).

---

## 1. PLAN — decide the SAMO-year model for every system (design doc, no app code)
Done when: test -s docs/YEAR-ROLLOVER.md && node -e "const s=require('fs').readFileSync('docs/YEAR-ROLLOVER.md','utf8');const need=['## Inventory','## The SAMO year','## PR','## VitalSound','## SAMO Shop','## หนังสือโครงการ','## ทีม SAMO','## เกี่ยวกับเรา','## ระบบบ้าน','## หน้าฝ่าย','## Passport','## Announcements','## Accounts','## Stats','## Claude booking','## Discord','## Drive','## Backup','## Export','## Deletion','## Year-end runbook','## Edge cases','## Build order'];const miss=need.filter(h=>!s.includes(h));const dec=(s.match(/^Decision:/gm)||[]).length;if(miss.length||dec<20){console.error('missing',miss,'decisions',dec);process.exit(1)}" && grep -q "Status:" docs/state/HANDOFF.md && grep -q "SAMO-year handover" docs/state/HANDOFF.md && npm test --silent

Write `docs/YEAR-ROLLOVER.md`: the design every later task builds. Read the code
for EVERY system first — public (`src/js/`), admin (`src/js/admin-main.js` and
the modules it mounts), Passport (`passport/`), Apps Script (`appscript/`), the
VM services (`server/`), and the migrations. Then, per system (the headings in
the check above, each its own `## ` section), write:
- **Inventory**: every table/column/Drive folder/service it owns, how it grows
  (use the measured numbers), and what a new team on day 1 of next year sees.
- **Decision:** lines (one decision per line, starting `Decision:`): how data is
  scoped to a SAMO year, what the default view shows, how a past year is browsed
  (read-only? editable by whom?), what carries over (open PR/VS tickets, unpaid
  shop orders, permissions, seats, people, houses), what is archived, exported,
  deleted, and WHEN and BY WHOM. Each with the rejected alternative and why.
- Answer the owner's questions explicitly: delete? backup? export to external?
  Drive folders per year? จัดการทีม per year? Ground deletion in PDPA (VitalSound
  carries personal data; read its PDPA notice in the code) — retention periods
  stated, anonymise vs delete, who may trigger it, and that nothing is deleted
  without an export first.
- `## The SAMO year`: ONE definition. Decide the boundary (term handover, not
  1 January; read team_terms / publish_team_term / passport.samo_years and how
  `is_current` flips), its single source of truth in SQL with a JS twin, how it
  relates to ปีงบ and the academic year (they stay; say how each system picks
  which one), and how a row gets its year (stored at write time vs derived from
  a timestamp — decide; consider late edits and back-dated rows).
- `## Stats`: storage projection (500 MB ceiling) and a retention/rollup plan.
- `## Edge cases`: at least 25, each with the handling — e.g. a ticket opened in
  one year and closed in the next; a person in two terms; a staffer who leaves
  mid-year still holding a grant; a PR ticket edited after archive; a
  rollover run twice; a rollover undone; a year with no term published yet;
  Drive files of a deleted row; shop preorders spanning the boundary; a held
  ระบบบ้าน row across the academic rollover; master holders; anonymous
  (username) accounts of people who graduated; Discord roles after handover.
- `## Year-end runbook`: the ordered checklist the next IT team runs, which
  becomes `skills/year-rollover.md` in task 2.
- `## Build order`: map the decisions to tasks 2–11 of this queue and their
  reserved migration numbers.

Also add a section to `docs/state/HANDOFF.md` titled `## 22. SAMO-year handover
— night agent 2026-10-14` with a `Status:` line (HYPOTHESIS until applied) and a
table: one row per task (what, migration, proof, applied?, owner action).
Run `scrutinize` on the finished design before you end (it is a plan — the
skill reviews plans too), and fix what it finds in the doc.

## 2. The ONE SAMO year — foundation, admin control, runbook
Done when: ls supabase/migrations/0219_*.sql >/dev/null 2>&1 && test -f tools/year0219-samo-year.sql && test -f skills/year-rollover.md && grep -rqi "samo.year\|samoYear" src/js --include=*.js && grep -q "year0219" tools/run-proofs.mjs && npm test --silent && npm run --silent build

Build what `docs/YEAR-ROLLOVER.md` § The SAMO year decided: the single source of
truth in SQL (migration 0219, ADD only), a SQL function returning a row's/
timestamp's SAMO year, a JS twin with a DIFFERENTIAL test that parses the
migration (the 0217 `follow-up.test.js` pattern), the admin control to see and
switch the current year (gated by `master`/the decided permission; fail-closed;
`master` folds — read memory master-grants-all-project-seats), and ONE shared
year-picker component every later task reuses. Proof `tools/year0219-samo-year.sql`
(rolled back; ALLOW + DENY; idempotent rollover; a timestamp exactly on the
boundary) — applied to samo-dev and green there before you finish. Write `skills/year-rollover.md` from the runbook — the document the
next IT team follows. Keep passport.samo_years, team_terms and ปีงบ working:
link them, do not replace them.

## 3. PR Form — a dashboard per SAMO year, export, Drive per year
Done when: grep -q "^## Task 3 " docs/state/night-agent.md && grep -rqi "samo.year\|samoYear\|yearPicker\|year-picker" src/js/pr* src/js/admin* 2>/dev/null && npm test --silent && npm run --silent build

The owner's example. The PR Staff Dashboard shows the CURRENT year by default
with the shared picker to browse past years (read-only per the design); the 290
finished tickets of year 2569 must stop crowding the next team's view without
being lost. Open tickets that cross the boundary follow the design. Export a
year (CSV, the repo's CSV-formula-safe writer — grep `csv` in src/js for it).
Drive: new uploads go to a per-year folder — edit `appscript/*.gs` (NOT deployed;
the owner runs `npm run deploy:gas`; read `skills/deploy-gas.md` and memory
gas-is-an-unauthenticated-api first) and write a one-shot, DRY-RUN-by-default
mover for existing files (Apps Script function or `tools/` script) the owner runs
after review. Never trash a file to move it (trashed = still public).
Find every reader of PR data (public PR form status page, Discord notify,
analytics) and make each year-aware or explicitly year-agnostic — say which.

## 4. ทีม SAMO + จัดการทีม + permissions handover + Discord roles
Done when: grep -q "^## Task 4 " docs/state/night-agent.md && grep -rqi "samo.year\|samoYear\|team_terms\|term" src/js/team/*.js && npm test --silent && npm run --silent build

"the จัดการทีม for each year". Build on `team_terms` + `publish_team_term` +
`team_archive_*` (empty today): next year's team is prepared without touching
this year's, published at the boundary, and the old one becomes a browsable
archive. Decide and implement what happens to PERMISSIONS at handover (grants
live on ทีม SAMO nodes and on users.permissions/managed_permissions — read
memory perms-architecture, master-grants-all-project-seats, discord-website-is-truth):
nothing must silently keep power after their term; nothing must silently LOSE
power on the morning of the handover with no successor. Discord roles follow
the website (the sync bot reads `discord_role_targets()` — check it reads the
CURRENT term). Migration 0224 if needed, proof registered.

## 5. Backup, export, deletion — the data-safety layer every system uses
Done when: grep -q "^## Task 5 " docs/state/night-agent.md && test -f tools/year-export.mjs && test -f skills/backup-and-export.md && node tools/year-export.mjs --help >/dev/null && npm test --silent

Implement the design's backup/export/deletion answers once, for all systems:
`tools/year-export.mjs` (per system and per year → JSON + CSV into a target
directory; dry-run/plan by default; reads through the same column lists the app
uses; never prints personal data to stdout — counts only), how it reaches
"external" storage (Drive "IT Database/Archive/<year>/" via Apps Script, or the
vault — decide, write the code, do not run it), and a backup schedule for the
whole database (read `server/vaultwarden/backup.sh` + its timer for the VM
pattern; SUPABASE_DB_URL is IPv6-only — say how the VM reaches it or why it
cannot). Deletion/anonymisation: SECURITY DEFINER RPCs that REFUSE unless the
year's export is recorded as done, dry-run first, `return=representation`-style
counts (read `delete-guard.test.js`). `skills/backup-and-export.md` is the human
procedure. Unit tests with stubbed DB/Drive asserting what goes OUT (the
`docs/mistakes` "source guard is a review, not a test" lesson).

## 6. VitalSound — per-year board and staff view, PDPA retention
Done when: grep -q "^## Task 6 " docs/state/night-agent.md && grep -rqi "samo.year\|samoYear\|yearPicker\|year-picker" src/js/vs* src/js/vitalsound* 2>/dev/null && npm test --silent && npm run --silent build

The public board and the staff view by year; open tickets carry over per the
design; PDPA retention through task 5's layer (anonymise personal fields of
closed tickets after the decided period; the public board's content stays if
the design says so). Confidential tickets: read memory vs-workflow-direction
and every VS policy before touching reads — authorization is per PATH
(class 4). Migration 0221 if needed, proof registered.

## 7. หนังสือโครงการ — ปีงบ completeness, Drive per year, seats across years
Done when: grep -q "^## Task 7 " docs/state/night-agent.md && ls supabase/migrations/0223_*.sql >/dev/null 2>&1 && npm test --silent && npm run --silent build

36 of 42 projects have NO `fiscal_year_be`: write migration 0223 that fills it
from the rule the app already uses (find it — do not invent a second one; the
ปีงบ starts in October) for NULL rows only, plus a proof. Decide how the SAMO
year and ปีงบ coexist here (the owner cited this module as the model — keep its
ปีงบ filter, add whatever the design says). Drive folders per year via
`appscript/` (not deployed). Project seats (vpa/staff/prof) across a handover —
read memory master-grants-all-project-seats before touching seats.

## 8. ระบบบ้าน + ข้อมูลของฉัน — academic-year rollover, graduates, the next รุ่น
Done when: grep -q "^## Task 8 " docs/state/night-agent.md && npm test --silent && npm run --silent build

What happens when the academic year rolls (`saveAcademicYear`): MD49 graduates
(ปี 7 → "จบแล้ว" per study-year.js), MD55 arrives through the import loop
(`skills/import-the-house-roster.md`), held rows (0217 follow_up) and help
requests across the rollover, graduates' accounts, houses/สาย reuse. Make the
admin pane and `help-diagnosis.js`'s covered-รุ่น range follow it with no code
change next year. Migration 0225 if needed, proof registered.

## 9. SAMO Shop — orders and products across seasons
Done when: grep -q "^## Task 9 " docs/state/night-agent.md && npm test --silent && npm run --silent build

Per-year order history and admin view, products/banners/pickup batches that
belong to a season, preorders spanning the boundary, the shop Discord totals
(`shop_order_totals`), export via task 5. Prices stay server-side (memory
shop-price-is-server-side). Migration 0222 if needed (shop_orders has no
created_at — decide how its year is known), proof registered. Also walk the
customer flow end to end in the code for the owner's listed worry: "login ด้วย
username password แล้วซื้อแบบนี้ กดออกไปหน้านี้แล้วมีปัญหา" — fix what breaks.

## 10. Passport, หน้าฝ่าย, announcements, stats, Claude booking, accounts
Done when: grep -q "^## Task 10 " docs/state/night-agent.md && ls supabase/migrations/0227_*.sql >/dev/null 2>&1 && npm test --silent && npm run --silent build

Passport: link `passport.samo_years` to the one SAMO year (task 2) and make a new
year/season startable by an admin without SQL; leaderboard per year; last year
browsable. หน้าฝ่าย content per year (or explicitly year-agnostic — decide).
Announcements: archive by year. Stats: the retention/rollup from the design —
migration 0227 (daily rollup table + a prune function that keeps the rollup;
how it is scheduled: pg_cron if available, else a VM timer — decide) with a
proof; same for `claude_usage_samples`, `notify_log`, `project_notifications`.
Accounts: graduates and departing staff (memory shared-account-purge,
team-identity-is-kkumail). 0228 for anything else here.

## 11. SCRUTINIZE + BUG SCAN of everything on this branch, and of 2026-10-13's work
Done when: test -s docs/state/agent-notes/2026-10-14-review.md && grep -q '^## Verdict' docs/state/agent-notes/2026-10-14-review.md && npm test --silent && npm run --silent build

Run `scrutinize` over `git diff origin/main..HEAD` (this branch, all tasks) AND
over the owner session's work of 2026-10-13 (`git log --since=2026-10-13
origin/main`, notably 0217/0218, `src/js/house/{follow-up,help-diagnosis,sai-grid,gaps,index}.js`,
`tools/house-kkumail-import.mjs`). Then a bug scan of the whole app (public,
admin, Passport) focused on what the year work touched and on the owner's list
(login cache for both sign-in kinds, account switching, shop customer flow).
Fix every real finding (write-ups for each), use 0229 for SQL. Report in
`docs/state/agent-notes/2026-10-14-review.md` with a `## Verdict` section:
findings, fixed/not, and why not. Security findings → `~/samo-night/reports/`.

## 12. HANDOFF — the owner applies, deploys and decides from this
Done when: grep -q "^## Task 12 " docs/state/night-agent.md && grep -q "SAMO-year handover" docs/state/HANDOFF.md && npm test --silent && npm run --silent build

Make `docs/state/HANDOFF.md` §22 the owner's exact checklist: per migration in
order — apply to samo-dev, run its proof, apply to production, run again; GAS
deploy steps; the one-shot Drive mover (dry run first); deploy; what to click
to verify each system in the browser; and every DECISION from
`docs/YEAR-ROLLOVER.md` the owner may want to overturn, one line each with its
consequence. Update `STATE.md` (short). Each row says what is VERIFIED (only
`npm test`/build) vs WRITTEN NOT APPLIED. Do not claim anything you did not run.
