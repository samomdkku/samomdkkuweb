# NIGHT-TASKS — 2026-10-20: the quality queue, tasks 13–23 (one full week)
Budget: 30 runs
Until: 2026-10-27T08:00:00Z
Reserve sessions: 0
Revise passes: 6
Branch: agent/2026-10-20

THE OWNER'S ASK (2026-10-20): the SAMO-year queue (tasks 8–12) is finished, and
the owner has a fresh week of Claude to give — "improve samoweb from ui ux to
workflow, code, architecture, security, bugs … for most benefit". This queue is
the answer, IN PRIORITY ORDER: finish what earlier reviews found and left open,
make the proofs trustworthy, then security, static analysis, the student's phone
experience, speed, maintainability, tests for untested logic, the Passport app
on a phone, and a final review (20 and 21 added the same morning — owner: fill
all 7 sessions with real work). If the week runs out,
the tasks that did not run are the least valuable ones — keep the order.

⛔ **WHAT IS DIFFERENT FROM THE 2026-10-18 QUEUE. Read this first.**

- **This branch STACKS on `agent/2026-10-18`, which is NOT merged.** That
  branch (tasks 8–12: 0229–0233, the SAMO-year work for ระบบบ้าน, Shop,
  Passport, stats) is applied to samo-dev ONLY and waits for the owner's review
  (`docs/state/HANDOFF.md` §22). `agent/2026-10-20` was created from its tip, so
  YOUR work is `git log --oneline agent/2026-10-18..HEAD` — never
  `origin/main..HEAD`, which also lists the 19 commits you did not write. Never
  rewrite, rebase or revert a 2026-10-18 commit; if you find a bug in one, fix
  it in a NEW commit and say so in your task block (the owner merges the two
  branches in order).
- **Migration numbers RESERVED, new block** (0229–0233 belong to the 2026-10-18
  branch): task 14 → 0234, task 15 → 0235–0237, task 17 → 0238, task 20 →
  0239, task 21 → 0240, task 22 → 0241. A task that needs no migration leaves its number unused (a gap is fine;
  `migration-numbers.test.js` must stay green — read it).
- **These tasks are QUALITY work, not features.** Do not add a system, a page,
  a permission or a setting nobody asked for. A finding you cannot fix in your
  task goes in your task block with file:line; a design idea goes under
  "proposals for the owner", never into code. Memory
  `keep-what-works-show-evidence`: "no change" is a valid answer.

⛔ **CONSTRAINTS THAT APPLY TO EVERY TASK** (each one was paid for):

- **You have samo-dev, and ONLY samo-dev.** `~/samo-agent/.env.local` holds
  samo-dev's URL, anon key and access token and nothing else; that token answers
  403 on production. So you CAN and SHOULD:
  `node tools/apply-migration.mjs supabase/migrations/NNNN_*.sql --dev`, then
  `node tools/db-query.mjs tools/<proof>.sql --dev`, read every verdict line,
  and fix until green — and prove it RED first (run the proof before the
  migration, or reintroduce the bug, and watch it fail — and check the mutation
  LANDED). Every tool prints `→ project: <ref> (<label>)`: the only acceptable
  label is samo-dev's; if you ever see PRODUCTION, STOP that task and write why.
  ⚠️ samo-dev holds an UNMASKED copy of real student data (decision D1): never
  print rows of people into commits, docs or logs — counts and synthetic probe
  rows only, and roll back or delete what you create. CREATE the rows a
  scenario needs inside the proof's transaction. Say "applied to samo-dev, proof
  N/N; NOT on production" wherever it matters.
- **You cannot push, deploy, run Apps Script, reload nginx or touch
  production.** Commit on this branch. Every run CONTINUES `agent/2026-10-20`:
  read `git log --oneline agent/2026-10-18..HEAD` and the TOP of
  `docs/state/night-agent.md` first — an earlier task of THIS queue decided
  things you must build on. Never reset, rebase or force anything.
  `server/*.conf`, `appscript/*.gs` and systemd units may be EDITED (with
  tests); the owner installs/deploys them — say exactly how in your block.
- **ADD, never DROP.** Production runs the CURRENT bundle until the owner
  deploys yours (`skills/ship-a-migration.md`). New columns get defaults or are
  nullable; old code must keep working against the new schema.
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
- **Before touching `src/js/auth.js`, `src/js/db.js` or anything calling
  supabase-js, read `docs/mistakes/supabase-client.md`.** Before
  `appscript/*.gs`, read `docs/mistakes/integrations.md` and memory
  `gas-is-an-unauthenticated-api`. Before `server/`, `docs/mistakes/deploy-hosting.md`.
- **`STATE.md` is checked by `state-handoff.test.js`:** "Migrations through
  NNNN" must equal the highest file on disk and the live-proof count must equal
  what `tools/run-proofs.mjs` registers. Update both in the SAME commit as a new
  migration/proof, and write beside them that 0229+ are NIGHT-AGENT WORK,
  applied to samo-dev only, NOT production. STATE.md has a line budget — keep it
  short; detail goes in your task block.
- **The repo AND `docs/` are PUBLIC** (docs/ is served at samo.md.kku.ac.th/docs).
  No student names, no emails, no OPEN-security-hole detail anywhere in git.
  An open security finding goes to `~/samo-night/reports/2026-10-20-security.md`
  (outside the repo). A hole you FIX may be written up in `docs/mistakes/` once
  the fix is on this branch, but say "fixed on agent/2026-10-20, not deployed".
- **Memory** (`~/samo-night/memory`): read the files your task touches — at
  least `MEMORY.md`'s index, then e.g. one-person-registry, perms-architecture,
  master-grants-all-project-seats, signin-copy-rules, ui-copy-names-the-audience,
  keep-what-works-show-evidence, app-is-light-only, kita-shop-frontend,
  shop-price-is-server-side, gas-is-an-unauthenticated-api, docs-are-published,
  both-repos-are-public, verify-live-dont-assert, fix-every-path-not-one,
  guard-tests-are-the-third-fix, headless-chrome-cdp-driver.
- Follow `CLAUDE.md`: write-ups in `docs/mistakes/*.md` for bugs you FIX
  (Symptom → Cause → Fix → Where it lives now; `npm run mistakes:index` after),
  a `PENDING` entry in `src/data/changelog.js` for anything a person would
  NOTICE (plain Thai, `changelog.test.js` enforces it), Thai UI text, no emojis
  in UI, light theme only, tokens not raw colours (`theme.test.js`).
  `npm test` and `npm run build` green before every commit; `npm run test:clean`
  before your LAST commit of a task (CI runs over exactly what git carries).
- **UI**: every control must work at 390px wide with no sideways scroll. Drive
  it: `skills/drive-the-browser.md`, `tools/browser/*.mjs` (they refuse
  production; samo-dev only) and memory headless-chrome-cdp-driver. A UI change
  not seen in a rendered page is not verified — say so if you could not.
- **Before you end ANY task**: run the `scrutinize` skill (the Skill tool,
  skill name `scrutinize`) on your own diff for that task
  (`git diff <your first commit>^..HEAD`), fix what it finds, then append a
  block to `docs/state/night-agent.md` headed EXACTLY
  `## Task N — <topic> (2026-10-20)` (N = your task number; the runner's check
  looks for that heading, so write it LAST, only when the task is finished, and
  never write another task's heading): what you changed, every decision with
  the alternative you rejected, what is WRITTEN NOT APPLIED/DEPLOYED, what you
  could NOT verify, and the exact commands the owner runs next.
- **Commit as you go.** A run can be cut off by the quota at any moment; a
  resumed task reads its own WIP commits first.

⛔ **THERE IS NO HUMAN AWAKE. NEVER END A TASK BY ASKING A QUESTION.**
Decide, act, record what you chose, what you rejected and what would change
your mind. A defended decision the owner can overturn beats a question nobody
reads until morning. A decision that is the OWNER'S (who may edit what, what a
ฝ่าย sees, whether a feature exists) is recorded as a proposal, never built.

**FACTS MEASURED ON PRODUCTION, 2026-10-18 (you cannot query production):**
whole database 64 MB; `pg_cron` NOT installed; `shop_orders` 50, 3 products;
`pr_tickets` 320; `students` 1,667; production has FIVE triggers on
`auth.users` (`on_auth_user_created`, `…_passport_link`, `…_email_change`,
`…_password_sync_insert/_update`) and samo-dev has NONE (HANDOFF §19.1). Live
proofs on production 2026-10-14: 67 of 69 green, red = `dept0177`, `team0135`.

---

## 13. Finish what earlier reviews found and left open
Done when: grep -q "^## Task 13 " docs/state/night-agent.md && npm test --silent && npm run --silent build

Read `docs/state/HANDOFF.md` §18f and §23f in full. Each item there was
CONFIRMED by a reviewer and never fixed on `main`; re-check each against the
CURRENT code first (some may be half-done since), then finish it:

1. **Discord sync review fixes** live on branch `wip/discord-review-fixes`
   (one commit, `e5490a2`, 2 tests red). `git fetch origin
   wip/discord-review-fixes` and cherry-pick it (the ONE allowed exception to
   "never merge"), then make the 2 red tests green by fixing the TESTS'
   expectations to the restructured loop — with event-based endings, never a
   longer timer (HANDOFF §23f says why; `git log --grep "waits for events"` is
   the pattern). Also fix §18f item 8 if it is small. Each of the 9 fixes keeps
   a test that goes red with the fix reverted — check that.
2. Front end, each with a failing-first test: the product popup's quantity vs
   colour/stock (`src/js/shop/products.js` — `renderQty`, `colorMissing`); the
   cart's `addItem` merging past stock; the บอท Discord tab's 20 s poll clearing
   a save error and re-announcing unchanged `aria-live` text
   (`src/js/discord-bot-admin.js` — paint only on change; check the same shape
   in `src/js/accounts/admin.js`); `csvGuard` passing a real value that starts
   with `'` (`src/js/utils.js` — guard AND unguard must round-trip every input:
   write a property test over many generated strings, not three examples).
3. **PLAUSIBLE items — measure before fixing**: news covers forced to JPEG
   (`-rj`) blacking a transparent PNG, and `image-resize.js`'s Safari fallback
   flattening transparency for every caller. Prove or disprove with a real
   transparent PNG through the real code path (jsdom has no canvas — use
   headless Chrome). Fix only what you reproduce.
4. nginx `/img/` cache key (`server/nginx-samo.conf`): write the
   `proxy_cache_key` change and a test that pins it; the owner installs it by
   hand (`nginx -t`) — write the exact commands. Drop the unused lh3
   `preconnect` from `index.html` ONLY if nothing on the first screen still
   loads from lh3 (grep the served path: `pictureAt()`, `PICTURE_CACHE_HOSTS`).

Write each fixed bug up in the matching `docs/mistakes/*.md`. Update §18f in
`docs/state/HANDOFF.md`: strike what you closed, say what is left and why.

## 14. Make the proofs trustworthy — samo-dev fidelity and the two red proofs
Done when: grep -q "^## Task 14 " docs/state/night-agent.md && npm test --silent && npm run --silent build

Every later task proves its work on samo-dev, so samo-dev must behave like
production. Read HANDOFF §19 item 1 and §16b.

1. **samo-dev has none of production's five `auth.users` triggers**, so a
   sign-up there creates no `public.users` row and every browser harness writes
   that row by hand, hiding real bugs. Find each trigger's function and
   `create trigger` in `supabase/migrations/` (grep the names above; read the
   NEWEST body of each function). Decide the shape and defend it: a migration
   0234 that (re)creates them idempotently — a NO-OP on production, prove that
   by reading it against the migrations that already ran there — or a dev-only
   tool. Apply to samo-dev; `accounts0211-dashboard` on dev must go from 13/15
   to 15/15. Then sign up a throwaway account through the real UI with
   `tools/browser/` and confirm the `public.users` row appears with NO
   hand-written insert; remove the hand-written inserts from the harnesses that
   no longer need them, and delete the throwaway account.
2. **`dept0177` and `team0135` are red on production** because each asserts a
   SHAPE (a hardcoded count of cards; a subject that moved), not a property
   (class 7 — "assert the PROPERTY"). Rewrite each to assert what it exists to
   protect, choosing subjects by the gate's own predicate, CREATING what the
   scenario needs inside the transaction. Prove each new assertion RED with its
   bug reintroduced. Run the full `npm run proofs -- --dev` and record the
   result in your block: every red, with a one-line cause (do not "fix" a proof
   by relaxing it; a red that is real data drift on samo-dev is reported, not
   hidden).

## 15. Security sweep — guards for whole classes, then the open items
Done when: grep -q "^## Task 15 " docs/state/night-agent.md && test -s "$HOME/samo-night/reports/2026-10-20-security.md" && npm test --silent && npm run --silent build

Write PROPERTY guards (a SQL proof registered in `tools/run-proofs.mjs`, run on
samo-dev; read `skills/write-a-guard.md` and `tools/authz-sweep-identity.sql`
for the house style) that make whole classes un-shippable, each with a control
that proves the detector is not blind:

- no table in `public` or `passport` lacks row security (`pg_class.relrowsecurity`);
- every SECURITY DEFINER function pins `search_path`;
- every function anon can EXECUTE is on an explicit allow-list file with a
  one-line reason per entry (read `pg_proc.proacl`, never the `revoke` text) —
  a new definer function then FAILS until someone decides;
- no permissive INSERT/UPDATE/DELETE policy is `using (true)` / `with check
  (true)` for `anon` or `authenticated` unless allow-listed with a reason;
- no table is writable by anon through a GRANT that the 0188 default-ACL
  lesson would explain (`docs/mistakes/postgres-schema.md`).

Fix what the sweeps find (0235–0237), each fix with a both-directions proof.
Then three known items, all OWNER-APPROVED to fix but none yet built:

a. **The OPEN privacy item in memory** (the file whose name starts
   `open-privacy`). Read it; its "How to apply" names the constraint (password
   sign-in must keep working for EVERY account kind). Build the fix, prove on
   samo-dev with a real browser sign-in by username for a password account AND
   for a Google account that set a username, and both directions of the leak.
   Describe it in git only as "username sign-in hardening" until the owner has
   deployed it; detail goes to the private report.
b. **Apps Script upload limits** (HANDOFF §18b "Owner-only"): write the
   server-side limits in `appscript/prform.gs` (what may be uploaded, how big,
   exactly where it may write) with tests in the repo's GAS test style; the
   owner redeploys (`skills/deploy-gas.md`). Keep guest PR uploads working.
c. The private report from 2026-10-13 on the VM
   (`~/samo-night/reports/2026-10-13-security-*.md`): re-check each item
   against the current code; fix what is small and safe; carry the rest.

Everything you find that is still OPEN goes ONLY in
`~/samo-night/reports/2026-10-20-security.md`: severity, who can exploit it,
file:line, and the fix you recommend. That file must exist even if the answer
is "nothing open" (then say what you checked).

## 16. Static analysis — a lint that finds bugs, not style
Done when: grep -q "^## Task 16 " docs/state/night-agent.md && npm run --silent lint && npm test --silent && npm run --silent build

The repo has no linter (only `undefined-refs`). Add ESLint (flat config, a
devDependency, pinned version) with CORRECTNESS rules only — e.g. `no-undef`
(with the real browser/Bootstrap/Quill globals declared, never `/* global */`
sprinkled), `no-unused-vars` (args off), `no-unreachable`, `no-dupe-keys`,
`no-self-assign`, `no-fallthrough`, `no-constant-condition`,
`no-unsafe-finally`, `no-cond-assign`, `no-dupe-else-if`, `use-isnan`,
`valid-typeof`, `no-unsafe-optional-chaining`, `require-atomic-updates` OFF.
No formatting rules, no style churn, no auto-fix sweep over the codebase.
Cover `src/`, `passport/js/`, `functions/`, `server/*.mjs`, `tools/`.

For every hit: is it a REAL bug (a dead branch someone relies on, a misspelt
variable that is always undefined, an unreachable save)? Fix real bugs one
commit each, with a test that fails before the fix, and a write-up. Remove
genuinely dead code only when grep proves nothing reaches it (window-bound
`onclick` names in HTML ARE references — `main.js` wires them). Add `npm run
lint`, run it from `npm test` or CI (`.github/workflows/` — read how the others
run) so it stays green. Record the counts: hits, real bugs, dead code removed,
rules you turned off and why.

## 17. A student's phone — accessibility and friction sweep
Done when: grep -q "^## Task 17 " docs/state/night-agent.md && test -f tools/browser/a11y-sweep.mjs && npm test --silent && npm run --silent build

Build `tools/browser/a11y-sweep.mjs` (samo-dev only, like its siblings): load
every PUBLIC route and the main ADMIN panes at 390px and 1280px, run axe-core
(pinned devDependency, injected into the page) and record violations by rule,
plus: horizontal overflow, console errors, tap targets under 44px for primary
actions, focus visible on every interactive element, every modal trapping and
returning focus. Run it signed out AND signed in (a throwaway account you
create and delete).

Then walk the flows a student actually does, at 390px, as that student: sign
in (both kinds), the PR form, the VitalSound form, the shop (browse → popup →
cart → checkout → slip upload), `/me`, ระบบบ้าน claim, a หน้าฝ่าย page.
Look for: a dead end, a missing loading/disabled state, a double-submit, an
error that says nothing useful, a lost draft, text cut off with no way to read
it (class 4: a `title` tooltip does not exist on a phone).

Fix DEFECTS (broken, unreadable, unreachable, confusing error) with a test
each. Do NOT redesign anything the owner chose — read memories signin-copy-rules,
ui-copy-names-the-audience, keep-what-works-show-evidence, home-page-and-me,
kita-shop-frontend first; copy changes follow them. Anything that is a design
opinion goes under "proposals for the owner" with a screenshot path. Record
axe violation counts before and after, per route.

## 18. Speed on a phone — measure, fix the biggest, guard it
Done when: grep -q "^## Task 18 " docs/state/night-agent.md && npm run --silent build && npm run --silent check:bundle && npm test --silent

Measure first, with headless Chrome over CDP at 390px on throttled "Fast 4G"
and a 4× CPU slowdown, cold cache, against a local `vite preview` of the
production build: bytes of JS/CSS/fonts/images before first paint, LCP, time
until `window.__samoBooted`, for `/`, `/me`, the shop, a หน้าฝ่าย page and
`/admin/`. Then find the biggest avoidable costs (a library in the first
chunk that only one tab uses — CLAUDE.md: GrapesJS, Quill, d3-org-chart are
DYNAMIC IMPORT ONLY; fonts; oversized images; a request waterfall; cache
headers in `server/nginx-samo.conf`) and fix the top few. Re-measure and
record before/after in a table in your block — same conditions, three runs
each, median.

Add `npm run check:bundle`: reads `dist/` after a build and fails if the
public entry's first-load JS/CSS exceeds a budget set a little above today's
AFTER-fix size, or if any of GrapesJS / Quill / d3 appears in an entry chunk.
Prove it red by importing one statically.

## 19. Maintainability — split the two largest modules, behaviour unchanged
Done when: grep -q "^## Task 19 " docs/state/night-agent.md && npm test --silent && npm run --silent build

`src/js/shop/admin.js` (~5,000 lines) and `src/js/team/index.js` (~4,400) are
read by every session that touches the shop or ทีม SAMO. Split each into
modules along the seams already in it (one tab/pane/feature per file, shared
state in one place), behaviour UNCHANGED:

- MOVE code, do not rewrite it. `git diff --color-moved=zebra` should show
  almost every line as moved; note every line that is not, and why.
- No renames of window-bound functions (`onclick=""` in HTML depends on them),
  no new abstractions, no "while I'm here" fixes — a bug you spot goes in your
  block for task 20, not into the move.
- Verify with the unit tests AND the real page: `tools/browser/shop-admin-tour.mjs`
  and `shop-admin-strip.mjs` before and after (same verdicts), and drive the
  ทีม SAMO admin's four modes (team, perms, years, health) at 390 and 1280
  with no console error. The built bundle must still lazy-load the same way
  (compare chunk names/sizes before and after).

If one split cannot be verified this way, do the other one only and say why.

## 20. Tests for the logic nothing tests yet
Done when: grep -q "^## Task 20 " docs/state/night-agent.md && npm test --silent && npm run --silent build

Measure first: run vitest with coverage (`@vitest/coverage-v8`, pinned
devDependency matching the installed vitest; add an `npm run coverage` script,
NOT a coverage threshold in `npm test`). List the modules holding BUSINESS
RULES — money, stock, status transitions, who may see or do what, dates and
SAMO years, import/export round-trips — whose rules have no test. Likely
candidates (check, do not assume): `src/js/shop/checkout.js`,
`src/js/shop/api.js`, `src/js/pr-staff.js`, `src/js/vs-staff.js`,
`src/js/house/io.js`, `src/js/announcements.js`, `src/js/projects/inbox.js`,
`passport/js/scanning.js`.

For each rule you pick, highest stakes first: extract the PURE decision out of
the DOM/network code only where that is a small, behaviour-preserving move
(the shop's `order-facts.js` / `sales.js` are the house pattern), then write
tests that state the rule as a person would ("a cancelled order frees its
stock"), including the edge cases (empty, null, the year boundary, two tabs).
⛔ A test asserts the RULE, not today's output copied back (class 7: never write
a guard from the SAME LIST the code came from). Mutate the code for each rule
and watch its test go red — check the mutation landed.

A test that exposes a REAL bug: fix it in its own commit, write it up in
`docs/mistakes/`, add a `PENDING` changelog entry if a person would notice. SQL
fixes → 0239. Record in your block: coverage before/after for the modules you
touched, the rules now pinned, and the rules you found but could not test (and
why).

## 21. SAMO Passport on a phone — accessibility, friction and speed
Done when: grep -q "^## Task 21 " docs/state/night-agent.md && npm test --silent && npm run --silent build

Tasks 17 and 18 covered the main site. Passport (`passport/`, its own vite app:
`npm run dev:passport`, `npm run build:passport`) is what students open on a
phone to scan a QR at an event — often on bad signal, in a hurry. Read
`docs/mistakes/passport.md` and memories passport-repo-and-deploy,
passport-kkumail-only-gate, two-supabase-projects and
passport-security-hardening-inflight FIRST. ⛔ `passport/` is NOT an env
directory (vite's `envDir` follows `root`) — never add a `.env*` under it.

1. Extend `tools/browser/a11y-sweep.mjs` (task 17) or add a sibling to cover
   Passport's routes at 390px, signed out and signed in (a throwaway
   kkumail-shaped account on samo-dev, deleted after; the kkumail-only gate is
   ON PURPOSE — never loosen it). axe violations by rule, overflow, console
   errors, focus, tap targets.
2. Walk the student's flow as that student: open a scan link → sign in → the
   stamp lands → my stamps / km / certificate; then again with the network
   dropping mid-scan (CDP offline, slow 3G): no duplicate scan, no silent loss,
   an honest message, a way to retry. Fix DEFECTS with tests; design opinions
   go under "proposals for the owner".
3. Speed: task 18's method (390px, throttled, cold, median of three, against a
   `vite preview` of the passport build) for the scan landing page and the
   dashboard; fix the biggest avoidable costs; extend `npm run check:bundle`
   to the passport entry with its own budget.
4. Admin side (`passport/js/admin-page.js`, `passport/js/dashboard.js`): bug
   scan only — no split, no redesign.

Any SQL → 0240, with a both-directions proof; the passport schema had its RLS
silently dropped once (0182), so after anything you change re-assert the
property: every passport table has row security. Record before/after numbers.

## 22. SCRUTINIZE + BUG SCAN — this whole branch
Done when: test -s docs/state/agent-notes/2026-10-20-review.md && grep -q '^## Verdict' docs/state/agent-notes/2026-10-20-review.md && npm test --silent && npm run --silent build

Run `scrutinize` over `git diff agent/2026-10-18..HEAD` (tasks 13–21), one
task at a time, as a hostile reviewer who must sign off production: does each
change do what its block claims? Was anything asserted that was never run? Is
any guard green against the bug it exists for (reintroduce, watch it go red,
restore — check the mutation landed)? Did a "behaviour unchanged" split change
behaviour? Did a lint fix change semantics? Then a bug scan of whatever the
earlier tasks recorded as "spotted, not fixed". Fix every real finding (write
each up in `docs/mistakes/`; 0241 for SQL). Report in
`docs/state/agent-notes/2026-10-20-review.md` with a `## Verdict` section:
findings, fixed / not fixed, and why not. Security findings → the private
report, never the repo.

## 23. HANDOFF — what the owner reviews, applies, deploys and decides
Done when: grep -q "^## Task 23 " docs/state/night-agent.md && grep -q "Night agent 2026-10-20" docs/state/HANDOFF.md && npm test --silent && npm run --silent build

Add `docs/state/HANDOFF.md` §24, headed `## 24. Night agent 2026-10-20 — the
quality queue`, with a `Status:` line, as the owner's exact checklist:

1. **Merge order**: `agent/2026-10-18` first (§22), then this branch.
2. Per migration in order (0234 → 0241, skipping unused numbers): apply to
   samo-dev, run its proof, apply to production, run again.
3. Every step only the owner can do: Apps Script redeploy (task 15), nginx
   change (task 13), anything on the VM — the exact commands.
4. Deploy, then what to click to verify each change in the browser (at 390px
   too), and which `tools/browser/*.mjs` to run.
5. Every DECISION tasks 13–22 made that the owner may want to overturn, one
   line each with its consequence; every "proposal for the owner" collected in
   one list.

Each row says what is VERIFIED (proof N/N on samo-dev, `npm test`, build, a
browser driver) vs WRITTEN NOT APPLIED. Do not claim anything you did not run.
Update `STATE.md` (short — replace the 🌙 NIGHT AGENT block's body, keep its
line count).
