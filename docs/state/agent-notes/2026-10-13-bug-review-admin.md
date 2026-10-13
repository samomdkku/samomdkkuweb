# Bug review (deep) — the admin app — 2026-10-13, night queue task 5

Scope: `admin/index.html`, `src/js/admin-main.js`, and the admin modules —
projects (including tasks 1–2's own work this branch: the ฝ่ายสโม tag editor
and the หน้าฝ่าย/dept-page expansion), shop admin, team, house, VS/PR,
creator/announcements, dept pages, Discord bot panel, and the new (this week)
บัญชีผู้ใช้ dashboard. Read `.claude/rules/mistakes.md`'s seven classes first,
then `docs/mistakes/frontend-ui.md` + `app-state.md` for the exact prior
incidents in this repo those classes compress — the three bugs below are each
a new instance of a shape this repo has already paid for once.

Three confirmed bugs, each fixed with a mutation-checked test (break the fix,
watch the test go red, restore, watch it go green) and written up in
`docs/mistakes/`. Everything else read — `discord-bot-admin.js`,
`accounts/admin.js`, the rest of `projects/inbox.js`, and large chunks of
`shop/admin.js`/`house/index.js`/`team/index.js` via a targeted Explore pass —
came back consistent with this repo's own safe conventions (delegated click
handlers, `wired`/`mounted`/`loaded` guards, RLS-empty-write checks after
PATCH/DELETE). No security-flavoured finding surfaced; nothing here needed the
private report.

## 1. หน้าฝ่าย editor reset the ฝ่าย picker and discarded unsaved edits on re-entry

`src/js/dept-page-admin.js` — `initDeptPageAdmin(user)` is called by
`admin-main.js` on EVERY entry into the section (sidebar click, even on the
already-open section). It unconditionally reset `state.dept` to the first ฝ่าย
in the account's list and re-fetched + repainted the row editor from the
server — so an account managing several ฝ่าย (the blanket grant) lost its
current ฝ่าย selection, and anything typed but not yet saved vanished with no
warning, on nothing more than a stray sidebar click. Every other admin
workspace in this app (`team/index.js`, `house/index.js`) uses a load-once
flag for exactly this "re-entry is a no-op" reason; this one didn't.

**Fix**: track the uid this editor is wired for, and skip the reset on a
same-account re-entry (a real account switch already triggers a full page
reload elsewhere, before this function could ever see a different uid).
Test: `src/js/dept-page-admin.test.js`. Write-up:
`docs/mistakes/app-state.md` → "Switching to หน้าฝ่าย a second time…".

## 2. Two ฝ่ายสโม tag chips clicked quickly could silently drop one of them

`src/js/projects/inbox.js` — `onToggleProjectDept()` (this branch's own new
code, task 1) reads a โครงการ's current tags, computes the whole new array,
and writes it back — a read-modify-write on one shared array column, exposed
through several independent chip buttons. `btn.disabled` only guards one
button against a second click on ITSELF; it does nothing for two DIFFERENT
chips clicked close together on the same โครงการ, and both would read the
same pre-toggle array and overwrite each other's change.

**Fix**: serialize every toggle through one module-scope promise queue, and
await the reload that refreshes the cache before the function returns, so a
queued second click reads the FIRST click's result, not the original state.
Test: `src/js/projects/dept-chip-race.test.js`. Write-up:
`docs/mistakes/app-state.md` → "Two ฝ่ายสโม tag chips clicked quickly…". Not
given a changelog entry — the feature it's part of (`projects.samo_depts`,
migration 0212) is not applied to the database yet, so nobody has been able
to hit this in production; it's folded into the existing unreleased PENDING
entry for that feature instead of getting its own.

## 3. One click on "ลบคำสั่งซื้อ" in the shop order modal could fire several deletes

`src/js/shop/admin.js` — `openOrderModal()` repaints the modal BODY on every
open (correct), but also re-ran
`document.getElementById('shopAdminOrderModalDelete')?.addEventListener('click', deleteCurrentOrder)`
on every open. That button lives in the modal FOOTER, outside the repainted
body, so it survives across opens — and so does every listener ever attached
to it. Open three orders in a row, click delete once on the third, and
`deleteCurrentOrder` fires three times at once: duplicate DELETE requests for
the same row, a confirm dialog behaving oddly, duplicate toasts. This repo
already has a name for the shape (`my-house.test.js`'s "the re-render trap")
— a listener wired inside the function that repaints around the node it's
attached to, instead of once, outside it.

**Fix**: moved the registration into `ensureMounted()`, the function this
same file already uses to wire every OTHER static control exactly once.
Test: `src/js/shop/admin-order-modal.test.js` (structural — pins which
function body the registration lives in, no jsdom in this repo's test
setup). Write-up: `docs/mistakes/frontend-ui.md` → "One click on
'ลบคำสั่งซื้อ'…". **This one is LIVE in production today** (the shop admin
order modal is an existing, already-deployed feature, unrelated to tonight's
unapplied migrations) — given a changelog entry.

## What did NOT get a fix (read, found clean)

- `accounts/admin.js` / `checks.js` (บัญชีผู้ใช้, new this week): every KPI
  tile's filter matches the predicate `summarize()` used to compute the tile
  (checked `active1`/`new30`/recency buckets against their filters by hand);
  `paintFilterBar()` and `paintList()` both read the SAME `filters` object and
  `currentList()`, so the count line and the rows can't drift; the "open"
  state of an expanded check panel is read back from the DOM before a
  repaint, not re-derived, so it survives a live refresh without the usual
  double-toggle trap.
- `discord-bot-admin.js`: `set()`'s failure path leaves `panel` (hence the
  checkbox states) at the last-known-good value, so a failed toggle visibly
  reverts instead of drifting from the server.
- `projects/inbox.js`'s bucket counts (`projectBucketCounts`) and the grid
  (`renderGrid`) both filter through the same `projectsInScope()` — checked
  this specifically because it's the exact "count disagrees with its list"
  shape (mistakes class 6), and it doesn't recur here.
- An Explore pass over `shop/admin.js` (4719 lines), `house/index.js` (2935
  lines) and `team/index.js` (4411 lines) flagged two more LATENT instances of
  the same listener-accumulation shape as finding #3 — `wireBatchEditor()`
  (shop/admin.js) and `wirePermModal()` (team/index.js) — but both are safe
  TODAY because their one caller always resets the container's innerHTML
  immediately before calling them, which is a different (also-used-elsewhere-
  in-this-repo) pattern, not the bug. Not touched: fixing code that isn't
  broken yet, on a hunch about a future caller, isn't this task's job, and a
  "what if a future refactor…" test would be testing against code that
  doesn't exist. Left as a note for whoever next touches either function.
- A fourth candidate (shop admin's preorder stats tile reading an unfiltered
  aggregate while the list below is filtered) turned out to be ambiguous on
  inspection — the type-chip renderer legitimately needs the unfiltered set
  for its own chip counts, so "the KPI tiles stay global while the list is
  filtered" may be the intended design, not a bug. Left alone rather than
  "fixed" on a guess about intent; worth asking the shop team if the owner
  wants the KPI tiles to follow the search/type filter too.

## Verdict

Three confirmed bugs fixed, each with a mutation-checked regression test
(break → red → restore → green) and a write-up in `docs/mistakes/`.
`npm run mistakes:index` run after the write-ups. `npm test` — 2586/2586
green. `npm run build` — green (both the main app and the passport build).
No security-flavoured finding; nothing routed to the private report. Two
`PENDING` changelog entries added (`src/data/changelog.js`, `audience:
'staff'`) for the two fixes that affect an ALREADY-LIVE feature (หน้าฝ่าย, the
shop order modal); the ฝ่ายสโม chip race was left out of the changelog because
its feature isn't applied to the database yet and already has its own
unreleased entry. `STATE.md` not touched — no migration, proof, or deploy
state changed by this task.
