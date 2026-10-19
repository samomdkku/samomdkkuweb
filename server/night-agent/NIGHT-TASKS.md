# NIGHT-TASKS — 2026-10-18: the SAMO-year queue, tasks 8–12 (re-queued)
Budget: 20 runs
Until: 2026-10-21T08:30:00Z
Reserve sessions: 0
Revise passes: 6
Branch: agent/2026-10-18

THE OWNER'S ASK (2026-10-13, unchanged): make "every single system … persist
forever more than this year, self sustainable" — PR, VitalSound, SAMO Shop,
หนังสือโครงการ, ทีม SAMO, ระบบบ้าน, หน้าฝ่าย, Passport, "every single function in
the samoweb, adminsamo, samopassport". Plan every edge case, DECIDE, implement,
re-check with **/scrutinize** (the Skill tool, skill name `scrutinize`), scan for
bugs, hand off properly. On 2026-10-18 the owner asked for the five tasks the
2026-10-14 queue never reached (it was stopped after task 7) to be run now.
Task numbers 8–12 are kept on purpose so they match `docs/state/HANDOFF.md` §22.

⛔ **WHAT IS DIFFERENT FROM THE 2026-10-14 QUEUE. Read this first.**

- **Tasks 1–7 are DONE AND ON PRODUCTION.** The old branch `agent/2026-10-14`
  was reviewed, fixed by the owner's session and merged to `main`; 0219–0228 are
  applied to production AND samo-dev; the bundle and Apps Script v16 are
  deployed. This queue branches FRESH from `origin/main` as `agent/2026-10-18`.
  Never touch, merge or rebase `agent/2026-10-14` — it is history.
- **Where the owner's review overruled the agent, the OWNER wins.** Read
  `docs/state/HANDOFF.md` §22 ("Owner-session review, 2026-10-14") before
  anything: handover order is **publish → edit → switch**; `fiscal_year_be` is
  NOT backfilled (NULL means "ask the clock", `fiscal-year.js`); an UNFINISHED
  past-year ticket is always shown and never locked; exports go to
  `~/samo-exports`, never inside the repo; `vs_scrub_closed_tickets` refuses
  under 24 months; a year in use cannot be deleted (0228). Do not re-decide any
  of these. `docs/YEAR-ROLLOVER.md` is the design — but where it and HANDOFF §22
  disagree, §22 is newer and is the truth.
- **The owner's own work since then is on `main` too** — read
  `git log --oneline --since=2026-10-14 origin/main` and the session notes
  `docs/state/claude-2026-10-15.md`, `docs/state/claude-2026-10-16.md`: SAMO
  Shop admin (ยอดขาย tab, ต้องจัดการ, slip queue, order ประวัติ), the home page
  banner + tool icons, ข้อมูลของฉัน moved to `/me`. Build on it, do not undo it.
  Memory `home-page-and-me` and `kita-shop-frontend` hold decisions made there.
- **Migration numbers are RESERVED again, new block** (0225–0228 were used by
  the owner's session, so the old reservations are void): task 8 → 0229,
  task 9 → 0230, task 10 → 0231–0232, task 11 → 0233. A task that needs no
  migration leaves its number unused (a gap is fine; `migration-numbers.test.js`
  must stay green — read it).
- **The shared pieces exist — REUSE them, never copy them** (class 6):
  `src/js/samo-year.js` (the ONE year picker + `currentSamoYear()`; PR uses it
  in `pr-year.js`, VS in `vs-year.js` — read both as the pattern),
  `public.current_samo_year()` / `samo_year_for_timestamp()` (0219, newest
  bodies in 0226), `year_export_log` + `year_export_recorded()` (0222, the gate
  every deletion/anonymisation RPC must call), `tools/year-export.mjs`,
  `skills/year-rollover.md`, `skills/backup-and-export.md`.

⛔ **CONSTRAINTS THAT APPLY TO EVERY TASK** (same as 2026-10-14 — each one was
paid for):

- **You have samo-dev, and ONLY samo-dev.** `~/samo-agent/.env.local` holds
  samo-dev's URL, anon key and access token and nothing else; that token answers
  403 on production. So you CAN and SHOULD:
  `node tools/apply-migration.mjs supabase/migrations/NNNN_*.sql --dev`, then
  `node tools/db-query.mjs tools/<proof>.sql --dev`, read every verdict line,
  and fix until green — and prove it RED first where you can (run the proof
  before the migration, or reintroduce the bug, and watch it fail). Every tool
  prints `→ project: <ref> (<label>)`: the only acceptable label is samo-dev's;
  if you ever see PRODUCTION, STOP that task and write why. ⚠️ samo-dev holds an
  UNMASKED copy of real student data (decision D1): never print rows of people
  into commits, docs or logs — counts and synthetic probe rows only, and roll
  back or delete what you create. samo-dev's data is NOT production's — CREATE
  the rows a scenario needs, inside the proof's transaction. Say "applied to
  samo-dev, proof N/N; NOT on production" wherever it matters.
- **You cannot push, deploy, run Apps Script, or touch production.** Commit on
  this branch. Every run CONTINUES `agent/2026-10-18`: read
  `git log --oneline origin/main..HEAD` first — an earlier task of THIS queue
  decided things you must build on. Never reset, rebase or merge the branch.
- **ADD, never DROP.** Production runs the CURRENT bundle until the owner
  deploys yours (`skills/ship-a-migration.md`). New columns get defaults or are
  nullable; old code must keep working against the new schema. A schema DEFAULT
  must not get ahead of the bundle (0223's lesson in HANDOFF §22).
- **Read the LIVE-equivalent body before redefining a function**: the newest
  migration that defines it (`grep -l "function public.<name>" supabase/migrations/* | sort | tail -1`),
  NEVER the first one (0193 silently reverted 0190 for three weeks).
- **Every new SECURITY DEFINER gate FAILS CLOSED**:
  `if not coalesce(<check>, false) then raise`. `revoke … from public` is NOT
  enough on Supabase — anon has an EXPLICIT default grant; revoke from `anon`
  too and ASSERT the privilege in the proof (0226). Read
  `docs/mistakes/authz-rls.md` and `.claude/rules/mistakes.md` classes 1, 2, 4,
  5 before any RLS or RPC. Pair every DENY with an ALLOW over the same rows,
  pick probe subjects by the gate's own predicate (never `role = 'dev'` — zero
  dev accounts exist; `master` folds — memory master-grants-all-project-seats),
  and register proofs in `tools/run-proofs.mjs`.
- **`STATE.md` is checked by `state-handoff.test.js`:** "Migrations through
  NNNN" must equal the highest file on disk and the live-proof count must equal
  what `tools/run-proofs.mjs` registers. Update both in the SAME commit as a new
  migration/proof, and write beside them that 0229+ are NIGHT-AGENT WORK,
  applied to samo-dev only, NOT production. STATE.md has a line budget — keep it
  short; detail goes to `docs/YEAR-ROLLOVER.md` and your task block.
- **The repo AND `docs/` are PUBLIC** (docs/ is served at samo.md.kku.ac.th/docs).
  No student names, no emails, no open-security-hole detail. Security findings
  go to `~/samo-night/reports/` (outside the repo).
- **Memory**: read the files your task touches (one-person-registry,
  team-identity-is-kkumail, house-*, shop-*, kita-shop-frontend, passport-*,
  two-supabase-projects, perms-architecture, master-grants-all-project-seats,
  samo-year-handover-order, home-page-and-me, docs-are-published,
  our-bug-our-repair, upload-on-save-not-on-pick …).
- Follow `CLAUDE.md`: write-ups in `docs/mistakes/*.md` for bugs you FIX
  (`npm run mistakes:index` after), a `PENDING` entry in `src/data/changelog.js`
  for anything a person would NOTICE (plain Thai, `changelog.test.js` enforces
  it), Thai UI text, no emojis in UI, light theme only, tokens not raw colours.
  `npm test` and `npm run build` green before every commit.
- **UI**: every control must work at 390px wide with no sideways scroll. Where
  you can, drive it: `skills/drive-the-browser.md` and `tools/browser/*.mjs`
  (they refuse production; samo-dev only).
- **Before you end ANY task**: run the `scrutinize` skill on your own diff for
  that task (`git diff <your first commit>^..HEAD`), fix what it finds, then
  append a block to `docs/state/night-agent.md` headed EXACTLY
  `## Task N — <system> (2026-10-18)` (N = your task number; the runner's check
  looks for that heading, so write it LAST, only when the task is finished, and
  never write another task's heading): what you built, every decision with the
  alternative you rejected, what is WRITTEN NOT APPLIED, and the exact commands
  the owner runs next. Update YOUR row (8–12) in `docs/state/HANDOFF.md` §22's
  table — never another row.
- **Commit as you go.** A run can be cut off by the quota at any moment.

⛔ **THERE IS NO HUMAN AWAKE. NEVER END A TASK BY ASKING A QUESTION.**
Decide, act, record what you chose, what you rejected and what would change
your mind. A defended decision the owner can overturn beats a question nobody
reads until morning.

**FACTS MEASURED ON PRODUCTION, 2026-10-18 (you cannot query production; use these):**

- Whole database **64 MB** (free tier 500 MB). `analytics_events` 29,368 rows /
  10 MB; `claude_usage_samples` 4,108 / 7 MB; `project_notifications` 5,187;
  `notify_log` 667. **`pg_cron` is NOT installed** — scheduling means a VM
  systemd timer (pattern: `server/supabase-backup.*`, `server/vaultwarden/`) or
  enabling the extension (decide, and say which the owner must do by hand).
- **Shop** `shop_orders` 50 (paid 49, review 1), 3 products; `shop_orders` has
  `placed_at` + `updated_at`, no `created_at`, and **no `samo_year_be` yet**
  (the shop part of the year work was never built).
- **PR** `pr_tickets` 320, all `samo_year_be = 2569`.
- `students` 1,667. `announcements`: 6, all `approved` — none `archived`.
- **ทีม SAMO** `team_terms`: 2569 current, 2570 exists, neither published.
- **Passport** `passport.samo_years` 1 row, `passport.samo_seasons` 1,
  `passport.scans` 1,332. `passport.seasons` (db/0004) is believed DEAD — the
  design says nothing in `passport/js/*` reads it; re-check before relying on it.
- ระบบบ้าน covers MD49–MD54; ชั้นปี = `academicYear()` + รหัส
  (`src/js/study-year.js`, rollover month 8); MD49 is ปี 6 now and graduates
  at the next rollover. 0217 gave held rows a `follow_up` flow.

---

## 8. ระบบบ้าน + ข้อมูลของฉัน — academic-year rollover, graduates, the next รุ่น
Done when: grep -q "^## Task 8 " docs/state/night-agent.md && npm test --silent && npm run --silent build

Read `docs/YEAR-ROLLOVER.md` § ระบบบ้าน, `docs/HOUSE-DATA-REPAIR.md` and
`skills/import-the-house-roster.md` first. What happens when the academic year
rolls (`saveAcademicYear` in `src/js/house/`): MD49 graduates (ปี 7 → "จบแล้ว"
per `study-year.js`), MD55 arrives through the import loop, held rows (0217
follow_up) and help requests across the rollover, graduates' accounts (never
deleted — memory one-person-registry), houses/สาย reuse (never re-run: a สาย is
a fact, not derivable). The design proposes `students.graduated_at` + a
default roster filter that hides graduated รุ่น with a toggle — build it or
defend a better shape (e.g. derive "graduated" from the same `study-year.js`
rule with a JS↔SQL differential test, instead of a stored flag that can drift —
class 6, "fill-once means never-correct"). Make the admin pane,
`help-diagnosis.js`'s covered-รุ่น range and `/me` (ข้อมูลของฉัน, since
2026-10-16) follow the rollover with NO code change next year — grep for every
hardcoded `MD49`/`49`…`54`/year literal in `src/js/house/` and `src/js/me*`.
Migration 0229 if needed, proof registered.

## 9. SAMO Shop — orders across SAMO years, plus the customer-flow worry
Done when: grep -q "^## Task 9 " docs/state/night-agent.md && grep -lq "samo_year_be" supabase/migrations/0230_*.sql && npm test --silent && npm run --silent build

Build `docs/YEAR-ROLLOVER.md` § SAMO Shop (never built): migration 0230 —
`shop_orders.samo_year_be` stamped at insert by `current_samo_year()` (copy
0220's PR trigger shape — read it), backfill the 50 existing rows from
`placed_at` via `samo_year_for_timestamp()`, unpaid/in-review orders KEEP their
year (a "ค้างจากปีก่อน" state in admin, never folded into this year). Products
are NOT year-scoped (design). Admin: the orders list AND the ยอดขาย tab
(`src/js/shop/admin-sales.js`, `sales.js` — the owner's 2026-10-15 work) get
the shared `samo-year.js` picker, current year by default; per-year export
through `tools/year-export.mjs` (add `shop` if missing). Prices stay
server-side (memory shop-price-is-server-side) — never touch
`place_shop_order`'s pricing. `shop_order_totals()` (the Discord message) —
decide whether it is year-scoped and say why. Proof `tools/shop0230-*.sql`
registered.

Then walk the CUSTOMER flow end to end in the code for the owner's listed
worry: "login ด้วย username password แล้วซื้อแบบนี้ กดออกไปหน้านี้แล้วมีปัญหา" —
a username/password account adds to cart, navigates away (another tab, /me,
the home banner's shop slide), comes back, checks out, uploads a slip. Find
what breaks (cart state, session refresh, the hash route), fix it, write it up.

## 10. Passport, หน้าฝ่าย, announcements, stats retention, accounts
Done when: grep -q "^## Task 10 " docs/state/night-agent.md && ls supabase/migrations/0231_*.sql >/dev/null 2>&1 && npm test --silent && npm run --silent build

Read `docs/YEAR-ROLLOVER.md` §§ Passport, หน้าฝ่าย, Announcements, Stats,
Claude booking, Accounts. **Stats (migration 0231, required):** a daily rollup
table for `analytics_events` + a prune that keeps the rollup (does
`analytics_overview()` survive pruning? prove it), `prune_claude_usage_samples`
keeping ≥8 weeks (the claude quota proofs read samples — run them after),
`notify_log`; `project_notifications` only age-AND-read, never age alone.
pg_cron is NOT installed: write the VM timer (`server/`, not installed — owner
installs) or the exact owner step to enable pg_cron; decide which and say why.
**Passport** (0232 if needed): `passport.samo_years.team_term_year` bridge
(nullable, no FK, per design); a new year/season startable by an admin WITHOUT
SQL (the "never a gap between two years/seasons" invariant in
`docs/INVARIANTS.md` holds); leaderboard per year; last year browsable. Read
memory passport-* and two-supabase-projects first — the passport schema had
its RLS silently dropped once (0182). **หน้าฝ่าย**: UI only per design —
surface "แก้ไขล่าสุดโดย … เมื่อ …" in the editor. **Announcements**: use the
existing `archived` status; verify the public feed filters it; archive-by-year
control for admins. **Accounts**: `account_dashboard()` (0211, newest body —
check) optional year filter; graduates and departing staff are a PERSON
decision, never a year one (design § Accounts). Proofs registered.

## 11. SCRUTINIZE + BUG SCAN — this branch, and the owner's work since 2026-10-14
Done when: test -s docs/state/agent-notes/2026-10-18-review.md && grep -q '^## Verdict' docs/state/agent-notes/2026-10-18-review.md && npm test --silent && npm run --silent build

Run `scrutinize` over `git diff origin/main..HEAD` (tasks 8–10) AND over the
owner's sessions since the last review: `git log --since=2026-10-14 origin/main`
— notably the shop admin (`src/js/shop/admin*.js`, `sales.js`), the home banner
+ tool icons and `/me` (`src/js/home*`, `src/js/me*`, `src/data/tools.js`), and
the year-rollover fixes 0225–0228 + `src/js/team/terms.js`. Then a bug scan of
the whole app (public, admin, Passport) focused on what the year work touched
and on the owner's list: login cache for BOTH sign-in kinds (Google and
username/password), switching accounts in one browser, the shop customer flow.
Read `docs/mistakes/supabase-client.md` before judging anything in `auth.js`.
Fix every real finding (write-up each in `docs/mistakes/`), 0233 for SQL.
Report in `docs/state/agent-notes/2026-10-18-review.md` with a `## Verdict`
section: findings, fixed / not fixed, and why not. Security findings →
`~/samo-night/reports/`, never the repo.

## 12. HANDOFF — the owner applies, deploys and decides from this
Done when: grep -q "^## Task 12 " docs/state/night-agent.md && grep -q "SAMO-year handover" docs/state/HANDOFF.md && npm test --silent && npm run --silent build

Make `docs/state/HANDOFF.md` §22 rows 8–12 the owner's exact checklist: per
migration in order (0229 → 0233) — apply to samo-dev, run its proof, apply to
production, run again; any GAS step; any timer the owner installs on the VM;
deploy; what to click to verify each system in the browser (at 390px too); and
every DECISION tasks 8–11 made that the owner may want to overturn, one line
each with its consequence. Update `STATE.md` (short). Each row says what is
VERIFIED (proof N/N on samo-dev, `npm test`, build) vs WRITTEN NOT APPLIED. Do
not claim anything you did not run.
