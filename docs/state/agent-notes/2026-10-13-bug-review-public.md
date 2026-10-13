# Bug review (deep) — the public site and Passport — 2026-10-13, night queue task 6

Scope: `index.html`, `src/js/main.js` and every public module (home, news,
VS/PR forms, shop storefront + checkout, my-seat/my-house, about/org chart,
projects-view including task 1's ฝ่ายสโม filter, dept pages including task
2's new ones), and `passport/` (scan, dashboard, admin). Same method as task
5 (`docs/state/agent-notes/2026-10-13-bug-review-admin.md`): read
`.claude/rules/mistakes.md`'s seven classes first, then the matching
`docs/mistakes/*.md` write-ups for prior incidents in each area.

Given the breadth of this scope (the whole public app plus a second
sub-app), research was fanned out across five parallel read-only passes —
home/news/org-chart, VS/PR forms, shop storefront/checkout,
my-seat/my-house + projects-view + dept pages, and Passport — each told to
report candidate bugs with file:line, failure scenario and confidence, not
to fix anything. All fixes below were then written, tested and
mutation-checked by hand against the real repo, the same way task 5 did.

Six confirmed bugs fixed; three with full mutation-checked regression tests,
one (passport) with a NEW structural test for a module that had none before,
one (dept colour identity) that strengthened an EXISTING test, and one
(a legacy SQL landmine) that is a comment-only mitigation with nothing to
test against. Everything else read is in "What did NOT get a fix" below.

## 1. The cart drawer's qty cap never knew about anyone else's reservations

`src/js/shop/cart.js` — the drawer's `+` button cap (`maxFor`, now the
exported pure `maxQtyFor`) read `p.reserved_matrix` off whatever
`setShopCartProducts()` was last handed, which is `listProducts()`'s raw
result — no reserved counts (those come from a separate RPC,
`fetchReservedMatrixAll`). `products.js` and `checkout.js` each splice the
reserved matrix onto their OWN copy for their OWN purposes; neither fed it
back into `cart.js`'s shared `productMap`. A size/colour fully claimed by
OTHER buyers' pending orders still showed as available in the drawer, even
though checkout correctly refused it at the final step (no money at risk —
only the drawer's own promise was wrong).

**Fix**: `cart.js` now holds its own `reservedMatrix`, fed by a new
`setCartReservedMatrix()` — called once on shop-tab-open (`index.js`) and
again whenever `checkout.js`'s `refreshStock()` learns a fresher one.
Test: `src/js/shop/cart-reserved-matrix.test.js` (6 assertions on the
extracted pure `maxQtyFor`, plus two structural checks that both callers
actually wire the setter). Write-up: `docs/mistakes/app-state.md`.

## 2. The public หนังสือโครงการ mirror never refreshed after its first load

`src/js/projects-view.js` — `bootIfNeeded()` set its own `initialised` flag
on the first call and returned immediately on every later `shown.bs.tab`.
Its callee, `mountCustomerProjects()` (`src/js/projects/index.js`), already
has the correct re-show behaviour (`if (customerInitialised) { await
reloadProjects(); return; }`) — but with no caller ever reaching it twice,
that branch was dead code. A visitor who kept the tab open never saw an
admin's later ฝ่ายสโม tag/visibility change until a hard reload. Predates
this week's ฝ่ายสโม work — both guard flags were introduced together, in the
same commit, one redundant with the other.

**Fix**: `bootIfNeeded()` keeps `initialised` only to decide whether to
paint the loading spinner; it always calls `mountCustomerProjects()` now,
letting that function's own flag tell first-mount from re-show apart. Test:
`src/js/projects-view-restale.test.js` (captures the `shown.bs.tab` listener
with a hand-built `document` stand-in — no jsdom here — and asserts a second
and third tab-show each call `mountCustomerProjects` again). Write-up:
`docs/mistakes/app-state.md`.

## 3. The VS public board's problem detail could get overwritten by a stale fetch

`src/js/vs-board.js` — `vsBoardOpen(id)` sets `openProblemId = id`, awaits
`get_public_vs_problem`, then called `renderProblemDetail(data)`
unconditionally. On a slow connection, tapping one card then quickly
tapping another (or going back to the list) before the first resolves let
the first's stale response paint over whatever is on screen now.
`vs-tracking.js`'s `enhanceBoardBanner()` already names and guards against
exactly this race one file over; `vsBoardOpen` never got the same guard.

**Fix**: added `if (id !== openProblemId) return;` right after the await,
before the render call — same place, same shape as the existing guard.
Test: `src/js/vs-board-stale-fetch.test.js` (structural — no jsdom; asserts
the guard exists and sits between the await and the render call).
Write-up: `docs/mistakes/frontend-ui.md`.

## 4. `removeOwnScan` (Passport) showed "Removed ✓" on a delete that may have matched zero rows

`passport/js/dashboard.js` — the self-service "remove my mis-scan" delete
had no `.select()` and never checked a row count, only `error`. Per this
repo's own rule (every DELETE needs a `data.length` check — RLS denies by
returning zero rows, not an error) and the already-correct sibling in
`admin-page.js` (`window.deleteActivity`), a delete matching no row under
RLS (a stale session, a race on `currentUserId`) still cleared local
memory/photos, showed the success toast, and reloaded — after which the
stamp reappeared, contradicting the toast just shown.

**Fix**: added `.select('id')` + a `data.length === 0` check before the
success path, matching `deleteActivity`'s shape exactly. Test:
`passport/js/remove-own-scan-delete-guard.test.js` — the first test file to
exist under `passport/`; structural (dashboard.js isn't built to import
standalone — it creates a live Supabase client and wires DOM listeners at
module scope), pins the check's presence, its correct row-count comparison,
and that it runs BEFORE the success toast, not after. Write-up: amended the
existing `docs/mistakes/passport.md` entry for this exact function, since it
already documented the feature.

## 5. ฝ่ายรังสีเทคนิค borrowed a different concept's colour, not its own

`src/data/depts.js` — `rt`'s `colorVar` was `--dept-projects`, a token
`base.css` documents as `/* โครงการอื่นๆ */` ("other projects") — the SAME
token `src/data/tools.js`'s unrelated `rt-website` tool card and
`tab-departments.html`'s generic "other projects" launcher used. No two
DEPT_DEFS entries shared a hex, so the existing `depts.test.js` "distinct
colour" assertion was green throughout; it just never checked the token
itself wasn't borrowed from a non-dept concept. Pre-existing, not introduced
by this week's "every ฝ่าย has a page" work — just never caught.

**Fix**: added `--dept-rt` / `--dept-hover-rt` to `base.css`; pointed
`depts.js`, the rt card in `tab-departments.html`, and the `rt-website` tool
entry in `tools.js` at it. Strengthened `depts.test.js` with a new
assertion — every `colorVar` must equal `--dept-<own key>` — mutation-
checked (reverted → the new assertion goes red while the old "distinct hex"
one stays green, demonstrating why the weaker check alone missed it).
Write-up: `docs/mistakes/frontend-ui.md`.

## 6. A legacy Passport SQL file could silently undo a later season-rollover fix (comment-only mitigation, no live bug)

`passport/db/0010_passport_authz_hardening.sql` defines `passport.stamp_scan()`
with no season check; `supabase/migrations/0180` later `create or replace`s
the SAME function to add one (a QR from a finished quarter must not stamp).
0214 (tonight's migration porting 0010/0011 into tracked history)
deliberately does not re-touch `stamp_scan`, since 0180 already owns it.
Nothing is broken today — the live function is 0180's — but `passport/CLAUDE.md`
still generically says "run the file in `db/`" to apply a migration, and
re-running `db/0010` on a database that already has 0180 would silently
revert the season check with no error. Not a code bug, a documentation
landmine for a future fresh-environment setup; added a loud comment above
the `create or replace` naming the hazard and pointing at 0180/0214. No test
possible or needed — nothing live to verify against. Write-up:
`docs/mistakes/passport.md`.

## What did NOT get a fix

Everything below was read by the five research passes and is either too
low-confidence, too narrow, already mitigated elsewhere, or a design
question rather than a bug. Noted here so it isn't re-discovered from
scratch.

- **`/news/{id}` deep link stays on the home tab if the announcements fetch
  fails** (`main.js`'s `applyPathRoute` has no guard the actual load path,
  `handleArticleHash`, has). Medium confidence — only the failure path is
  broken; needs a flaky/failed Supabase read at exactly page-load time.
- **`home-stats.js`** conflates a legitimate `users: 0` with an RPC failure
  (low confidence, theoretical on a live site), and binds its
  `shown.bs.tab` listener inside `render()` rather than at module init (low
  confidence, dormant — only one call site today). `org-chart.js`,
  `org-graph.js`, `org-rung.js`, `org-face.js`, `dept-tint.js`,
  `dept-content.js`, `departments.js`, `launcher.js` all came back clean —
  each already carries comments showing a prior fix for the exact race/
  staleness/drift shape being checked for.
- **VS/PR**: the guest ticket-tracking fallback (`vs-tracking.js`/
  `pr-tracking.js`) fails CLOSED for an unauthenticated guest if the lookup
  RPC ever 404s — dormant, the RPC has been live for dozens of migrations.
  `pr-staff.js` never adopted `vs-staff.js`'s `getOrCreateInstance` modal
  fix — latent, nothing in PR currently triggers a re-show while open.
  `setTicketPublic` doesn't repaint the sibling dup-tree panel after
  publishing — cosmetic, self-corrects on next open. `pr-staff.js` has no
  "nothing changed" no-op guard that `vs-staff.js` has — cosmetic/UX only.
- **Shop**: a retry's subtotal-dedup comparison could false-positive on a
  mid-flow admin price change — narrow, fails safe (just a confusing
  message). A redundant double-render on checkout step-2 item removal —
  cosmetic/perf only. The dev-only "no slip required" gate's server-side
  enforcement couldn't be verified from the JS files in scope (would need
  the `place_shop_order` SQL body) — flagged as "verify server-side", not a
  confirmed bug.
- **my-seat / profile-cache**: a student's record fixed by an admin in a
  separate session stays stale in the student's already-open tab until a
  hard reload — a known architectural limitation shared with the rest of
  this no-realtime app, not a regression. `my-seat.js`'s missing/null-field
  handling was checked against admin's own engine and found correctly
  unified, no divergence.
- **Public dept-page render for a brand-new, content-less ฝ่าย** renders an
  empty, silent (no crash, no "ยังไม่มีเครื่องมือ" message) section — looks
  like pre-existing, intentional-enough behaviour, not a regression from
  this week's page expansion.
- **Passport**: `deleteCert` has the same missing-row-count gap as
  `removeOwnScan` did, but lower severity — no success toast is shown on a
  silent failure, and the list re-renders from a fresh read either way, so
  it self-heals. Certificate scope is checked once at panel-open, not
  re-checked at submit — superseded by an already-documented, broader
  server-side gap (certificate writes are `is_admin()`-only, not
  department-scoped, HANDOFF-tracked separately). The GAS upload/delete
  endpoint's server-side ownership check on `fileId` couldn't be verified
  without reading `gas/Upload.gs`, which wasn't in scope — flagged as a
  follow-up read, not a finding (this pattern is explicitly sanctioned
  policy per `.claude/rules/security.md`, not a new vuln).

No still-open security vulnerability was found in either sweep beyond what
is already tracked (`docs/state/HANDOFF.md`, the existing OPEN entries in
memory). Nothing here was routed to the private report.

## Verdict

Six confirmed bugs fixed (5 with a mutation-checked regression test — break
the fix, watch the test/assertion go red, restore, watch it go green — the
6th a comment-only documentation mitigation with no live behaviour to test).
`npm run mistakes:index` run after the write-ups (416 entries across 10
files; `check:context` still within budget — 53,828/60,000 bytes). `npm
test` — 2603/2603 green. `npm run build` — green (both the main app and the
passport build). Three new `PENDING` changelog entries added
(`src/data/changelog.js`) for the fixes to already-live, already-deployed
features — projects-view, the VS board, and Passport's remove-scan button.
The cart drawer fix got no new entry: an existing unreleased PENDING entry
("the + button won't let you add more than what's left") already describes
the user-visible promise this fix makes actually true in the case it
missed. The dept-colour fix and the SQL comment got no changelog entry —
neither is something a visitor could notice. `STATE.md` not touched — no
migration, proof, or deploy state changed by this task.
