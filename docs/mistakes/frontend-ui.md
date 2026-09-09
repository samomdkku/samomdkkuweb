# Mistakes — Bootstrap, CSS, DOM & the browser

Layout, modals, touch, icons, escaping, and markup that ships without its stylesheet.

Each entry: **Symptom → Cause → Fix → Where it lives now**. The always-loaded index of every entry across all nine files is `.claude/rules/mistakes.md`; add new entries here, then run `npm run mistakes:index`.

---

## Ticket renderers interpolate user-text into innerHTML → XSS

**Symptom**: A guest who submits a PR/VS ticket with `<img src=x onerror=alert(1)>`
in any free-text field (brief, caption, rushReason, otherPlatformReason,
contentName, contact, problem, remark, …) pops scripts at every staff
viewer of that ticket.
**Cause**: Renderers like `renderPRDashboard`, `renderPRHistoryList`,
`renderUserHistoryList`, `renderTimeline`, the VS staff kanban, and
`renderManageAgentsList` build their HTML with template literals and
`insertAdjacentHTML` / `innerHTML`. Any user-text field interpolated
raw is an XSS hole.
**Fix**: Use `escHtml` from `utils.js` for any text field. Use `safeUrl`
for any URL going into an `href` attribute (blocks `javascript:`,
`data:`, attribute-injection payloads). The only string that may go
through innerHTML *raw* is Quill-produced rich text (announcement
content + VS problem field) — both are explicitly trusted.
**Where**: applied in `src/js/pr-tracking.js`, `pr-staff.js`,
`vs-tracking.js`, `vs-staff.js`, `utils.js renderTimeline`,
`announcements.js`. Don't add a new renderer without an `escHtml`
audit.

---

---

## A module shared across two shells carries shell-specific assumptions that silently break in the other shell

**Symptom (two faces, same root)**:
  1. Tapping a หนังสือโครงการ notification from another admin section
     (ภาพรวม / PR / Shop) does nothing — you must already be on the
     หนังสือโครงการ section for it to navigate.
  2. The public read-only customer mirror (`/projects-view`) flashes a
     "คอมเมนต์ใหม่" banner + "ใหม่" pills on every comment, even though
     the customer has no unread state.
**Cause**: `src/js/projects/*` is mounted in BOTH the public SPA and the
admin app. (1) `openProjectsTab()` switched sections via
`window.activateTab('pills-projects-tab')` — a Bootstrap pill that only
exists in the public shell; the admin shell switches sections via
`showAdminSide()`, so the jump silently no-op'd. (2) `renderCommentBanner`
/ `renderCommentsList` decided "unread" purely from `e.role !== role`;
for the synthetic `role='customer'` there is no per-user seenAt
(`getDocSeenAt` returns 0), so every comment read as new.
**Fix**: (1) `openProjectsTab()` detects the admin shell
(`document.getElementById('adminSideNav')`) and routes through
`window.openAdminSection('projects')` instead of the pill; added a
single-flight guard on `loadInitialData()` so the sidebar + jump paths
don't double-fetch. (2) Gate the comment banner + unread highlighting on
`!customerMode` in `inbox.js`.
**Where**: `src/js/projects/index.js` `openProjectsTab` + `loadInitialData`
single-flight; `src/js/projects/inbox.js` `renderCommentBanner` /
`renderCommentsList`. When reusing a module in a second shell, audit every
`activateTab` / `#bootstrap-id` / role assumption against the host shell.
**CSS flavor of the same trap (2026-07-24)**: styles for an ADMIN-only surface
(the VS staff modal's `.vs-duptree*` / `.vs-modal-section*`) were added to
`src/css/vs.css`, which only the PUBLIC entry imports (`main.css`); the admin
entry loads `src/admin.css` → the new UI shipped completely unstyled on the
admin app (looked like raw text on iPad). Before styling any component, check
WHICH html includes its partial (`grep modal-x admin/index.html index.html`)
and put the CSS in the entry that actually loads it: public-only → `vs.css`
(via `main.css`), admin-only → e.g. `vs-admin.css` (via `admin.css`), both →
a file imported by both.

---

---

## An anon-INSERTable table's text columns are ATTACKER-controlled — escape on render even in a "staff-only" internal dashboard

**Symptom**: The new `analytics_events` table (migration 0065) is publicly
INSERTable via the bundled anon key (same append-only pattern as `notify_log`
/ `pr_tickets`). Its `path` column is normally written by the frontend tracker
from `location`, so it *looks* like trusted first-party data. But the staff
usage dashboard (`analytics-dashboard.js` `rankBars`) rendered `top_paths[].path`
into `innerHTML` raw — and an attacker can `POST /rest/v1/analytics_events` with
`{"path":"<img src=x onerror=…>"}` directly. Result: **stored XSS that fires in
every staff member's browser** when they open สถิติการใช้งาน (confirmed: the raw
`<img onerror>` string stores verbatim).
**Cause**: "internal / staff-only view" gave a false sense that its inputs are
trusted. Authorization on the *read* (staff-only SELECT / RPC) says nothing
about who could *write* the row. Any table whose INSERT policy is
`with check (true)` for anon has every text column attacker-controlled,
regardless of who reads it back. Same root class as the ticket-renderer XSS
entry above — just reached through an anon-writable log instead of a form.
**Fix**: `escHtml()` every such field on render (path AND role, both into the
text node and the `title=""` attribute). Length CHECKs in the migration cap
size but do NOT sanitize content — escaping at render is the actual defense.
**Where**: `src/js/analytics-dashboard.js` (`rankBars` + `barChart` now import
and apply `escHtml` from `utils.js`). **Rule**: before rendering ANY column of
an anon-INSERTable table (`analytics_events`, `notify_log`, `pr_tickets`,
`vs_tickets`, …) into innerHTML — even in a staff-only dashboard — treat it as
untrusted and `escHtml` it. Read-side authorization is not input validation.

---

---

## Re-opening an ALREADY-OPEN Bootstrap modal with `new bootstrap.Modal(...).show()` stacks a second backdrop — page stays dimmed after close

**Symptom**: In the VS staff modal, tapping a ticket in the แผนผังเรื่องซ้ำ
(dup tree) — which re-runs `openStaffModal` to jump to the linked ticket while
the modal is already open — left the page dimmed ("web dimmer") afterward.
Closing the modal removed one backdrop but another stayed forever.
**Cause**: `openStaffModal` ended with `new bootstrap.Modal(el).show()`. When
the element is ALREADY shown, constructing a fresh Modal instance and calling
`.show()` adds a SECOND `.modal-backdrop` that the original instance's
`.hide()` never cleans up. Any "navigate within an open modal" flow (dup tree,
kanban dup-rows, similar-list jumps) triggers it.
**Fix**: `bootstrap.Modal.getOrCreateInstance(el).show()` — reuses the live
instance, whose `.show()` no-ops when `_isShown`; the DOM content re-rendered
above it just appears. Rule: NEVER `new bootstrap.Modal(...)` in a code path
that can run while that modal is open; always `getOrCreateInstance`.
**Where**: `src/js/vs-staff.js` `openStaffModal`. Grep for `new bootstrap.Modal`
if any other modal ever gains an internal "jump to other record" affordance.

---

---

## A destructive-direction toggle without a confirm silently dropped a privacy guard (vs_categories.personal flipped to publishable)

**Symptom**: The 0072 isolation proof went 19/23 — the CONFIDENTIAL test
ticket appeared on the public board, its detail returned data, SE could
publish it, students could me-too it. Root cause was DATA, not code: the
seeded `personal` category had `is_confidential=false, public_eligible=true`.
**Cause**: The new category manager confirmed the toggle only when turning
confidential ON. Turning it OFF — the direction that REMOVES a privacy
guard — was a silent one-tap, and a tap during user testing flipped the
personal-complaints lane to publishable. No real ticket leaked (none in that
category was published), but every confidential re-check downstream keys on
that flag, so the whole hard-exclusion stood on an unguarded toggle.
**Fix**: (1) restored `personal` to confidential; (2) the manager now
confirms BOTH directions, with the OFF confirm worded as removing
protection. **Rule**: when adding a toggle whose one direction weakens a
security/privacy invariant, that direction needs the STRONGER confirm (or a
type-to-confirm) — not the safe direction. Also: re-run
`tools/vs0072-isolation.mjs` after ANY change that touches vs_categories or
the public-board RPCs; it catches config-level regressions, not just code.

---

---

## A modal that closes on save makes every edit a round trip — refresh in place instead

**Symptom** (reported): "when บันทึกข้อมูล on a VitalSound ticket it closes the
ticket and I have to keep opening it again — I think it's for refresh, but I
want better UX."
**Cause**: `submitStaffAction` ended with `alert('อัปเดตข้อมูลสำเร็จ!')` →
`modal.hide()` → `fetchStaffTickets()`. Closing was doing the work of
*refreshing*: the only way to see the new timeline entry was to reopen the
ticket, because the modal's content is rendered once at open time. So every
status bump and one-line remark bounced the staffer back to the kanban to find
the ticket again — and the success `alert()` was a blocking dialog on top of a
modal, for the happy path, on every single save.
**Fix**: `await fetchStaffTickets()` (which repaints the kanban behind the
modal), then re-render the modal from the fresh row and report success inline in
the footer. Closing becomes the ปิด button's job, i.e. the user's choice.
Re-rendering while shown is safe *only* because `openStaffModal` ends in
`bootstrap.Modal.getOrCreateInstance(el).show()`, which no-ops on an open modal
— `new bootstrap.Modal(...)` there would stack a second backdrop (see the
stacked-backdrop entry). Guard the case where the refetched cache no longer
contains the ticket (transferred to a dept this user can't see, or deleted
concurrently): hide the modal rather than rendering stale data.
**Where**: `src/js/vs-staff.js` `submitStaffAction` / `reopenCurrentTicket` /
`staffSaveStatus`; `#staffSaveStatus` in `src/html/modal-vs-staff.html`.
**Rule**: if a dialog closes itself after a write, ask whether it is closing
because the user is *done* or because the code has no way to refresh in place.
The second is a bug wearing a feature's clothes.

---

---

## A manager modal opened ON TOP of a form must repaint that form's inputs — the vocabulary it edits was rendered once, at open time

**Symptom** (reported): "after I จัดการหมวดหมู่ → add a หมวดหมู่, I can't select
the one I added immediately — I have to close the ticket and open it again."
**Cause**: `#staffCategory` / `#staffPubCategorySel` are filled ONCE by
`fillStaffCategorySelect()` inside `openStaffModal()`. The category manager is a
stacked modal opened over that still-open ticket, and after a write it repainted
the kanban facet, the publish panel and its own list — but never the two selects
underneath it. So the new row existed everywhere except the control the user
opened the manager in order to use. The TAG manager next door had it right
(`refreshTagsAfterMutate()` re-fills the open ticket's tag editor); the category
manager was simply never given the equivalent, and the gap is invisible unless
you use the two features back to back.
**Fix**: `refreshCategoriesAfterMutate()`, called from add / patch / delete
alike. Two details that matter more than the repaint itself:
- **Preserve the pending selection.** `fillStaffCategorySelect()` resets the
  selects to the ticket's SAVED category, so a naive re-fill throws away an
  unsaved pick the user made just before opening the manager. Snapshot
  `sel.value`, re-fill, restore it if that option still exists (it won't if they
  just deleted it).
- **Do NOT auto-select the newly added category.** It is what the user
  "obviously" wants, but category drives confidentiality and board eligibility,
  so auto-selecting silently stages a re-classification on a ticket they only
  meant to add vocabulary for. Make it available in one click and say so in the
  status line instead.
**Where**: `src/js/vs-staff.js` `refreshCategoriesAfterMutate` (+ `vsCatAdd` /
`vsCatPatch` / `vsCatDelete`); the pattern to copy is `refreshTagsAfterMutate`.
**Rule**: whenever a modal edits the VOCABULARY that a form behind it renders as
options, list every control that consumed that vocabulary and repaint all of
them — the one you forget is usually the one the user opened the modal to fill.

---

---

## Attribute-driven visibility: check that EVERY value in the markup has a handler, and which way an unhandled one fails

**Symptom class** (three instances found in one sweep): an element gated by a
`data-*` attribute is shown to the wrong people, or to nobody, because the JS
that toggles it doesn't know that attribute value.
**The sweep** — cheap, run it whenever a role/permission is added:
```sh
grep -rho 'data-projects-role="[^"]*"' src/html/*.html | sort -u   # values in markup
grep -n  'data-projects-role='          src/js/projects/index.js   # values with a handler
```
Repeat for `data-admin-side` (vs `SIDE_FEATURE`), `data-role-only`,
`data-perm-only`, `data-admin-pane` (vs `SECTION_META`).
**Which way it fails depends on the markup, and that is the part to check first:**
- `#projectsGridEmpty` spans carry NO `d-none` → the JS hides by ADDING it → an
  unhandled value **fails OPEN** (visible to everyone). This bit: a new
  `data-projects-role="sa_prof"` span with no matching `querySelectorAll` block
  would have shown professor copy to vp_admin as well.
- The article edit/delete buttons DO carry `d-none` → **fails CLOSED**. Safer,
  but it hides the bug: the buttons were gated `data-role-only="pr_staff dev"`,
  so a ทีม SAMO `creator` grantee (role='user') never got them even though
  `announcements_write` lets them edit. Replaced with `data-perm-only="creator"`,
  resolved through `userCanAccess()` so role defaults, `permissions[]` and the
  tree all count.
**Also found the same shape in plain JS**, not attributes: the inbox bucket
empty-copy was `role === 'uni_staff' ? A : B`, so อาจารย์ silently got the
vp_admin wording ("ไม่มีหนังสือถูกตีกลับให้แก้") for a bucket that for them means
รอลงนาม. A two-way ternary on a three-role system is the same missing-handler bug
with no attribute involved.
**Rules**: (1) prefer `d-none`-in-markup + opt-in showing, so an unhandled value
fails closed. (2) Gate on a CAPABILITY (`data-perm-only` → `userCanAccess`) not a
role list, or every ทีม SAMO grant works except at that one control. (3) Any
`role === 'x' ? … : …` is a missing branch as soon as a third role exists — grep
for them after adding a role.

---

---

## A directional action whose direction lives ONLY in a label on the other party's row gets read backwards — and offering just one direction turns an N-item job into N searches

**Symptom** (reported): "when I want a ticket to be a subticket, `รวมเข้าเรื่องนี้`
— the user is confused, they think the current ticket is the master and the
listed one becomes the subticket." Exactly inverted from what it did.
**Cause**: the merge panel had ONE direction, stated nowhere except a button
label sitting on the OTHER ticket's row. "รวมเข้าเรื่องนี้" = "merge into THIS
one" — and `นี้` has no fixed referent: read on the row it means the row, read
by someone who just opened a ticket it means the open ticket. The action took
the second reading and did the opposite of it. A demonstrative pronoun in a
button label is ambiguous BY CONSTRUCTION whenever the button sits on one of
the two things it could refer to.
**The second half, which the user found by using it**: with only the
duplicate→canonical direction, merging 10 tickets into one main meant opening
each of the 10 and re-searching for the main every time. The workflow existed
only from the side that happens to be *one* ticket, so the bulk case — which is
the common one when curating a known main — was N× the work.
**Fix**: (1) direction is an explicit MODE, restated as a sentence naming the
open ticket's id and what happens to it; (2) every button names what the ROW
becomes (`เลือกเป็นเรื่องหลัก`), never what "this" does; (3) BOTH directions
ship — push (the open ticket becomes a duplicate; one target ⇒ a button) and
pull (ticked tickets become duplicates of the open one; many targets ⇒
checkboxes + one bulk action). Same `merge_vs_tickets(p_dup, p_canonical)`,
only the argument order differs — no migration.
**Where**: `src/js/vs-staff.js` (`mergeDir` / `mergeTargetRow` /
`renderMergeDirection` / `onPullMergeClick`), `src/html/modal-vs-staff.html`,
`src/css/vs-admin.css`.
**Three details worth reusing for any bulk action:**
- *Pre-empt the refusals the server will make.* `merge_vs_tickets` rejects a
  source that already owns duplicates. In pull mode that row is locked with the
  reason ON the row, rather than letting the user tick it and collect an error.
- *Bulk ≠ atomic.* Each merge is independently meaningful, so 8-of-10 is a
  correct outcome, not a broken transaction — sequential calls, per-ticket
  failure report. What is NOT acceptable is a silent partial.
- *A selection is scoped to the thing it was made in.* It is cleared when the
  modal opens another ticket; otherwise it silently follows the user into a
  different cluster and the next click merges the wrong things.
**Rule**: whenever an action relates two records asymmetrically (merge, link,
parent, supersede, assign), the UI must name BOTH sides and which one changes —
never rely on "this"/"นี้"/"here". And ask which side the user will be looking
at when they start the task: if it can be either, both directions need to
exist, and the many-to-one side needs multi-select or it is N separate jobs.

---

---

## `touch-action: none` on a drag handle makes the page unscrollable THERE — so every scroll that starts on a handle becomes a drag

**Symptom** (reported): "on ทีม SAMO on mobile, sometimes I just scroll the phone,
and it accidentally swaps / moves the role." Intermittent, never on desktop, and
it looked like a SortableJS sensitivity problem.
**Cause**: CSS, not the drag library. `.team-handle` carried
`touch-action: none`. That property tells the browser to suppress **every**
default touch gesture on the element — including panning — so a touch that merely
*began* on a handle could not scroll the page at all. SortableJS (no `delay`
configured) starts dragging on `touchstart`. Combined: finger lands on a handle
while flicking down the list → the browser refuses to scroll → the library
interprets the movement as a drag → a ตำแหน่ง silently moves. `touch-action: none`
is the right advice for a handle when drags start immediately (it stops the page
fighting the drag), which is exactly why it gets copied in — but it makes the
handle a scroll dead-zone, and on a tree view the handles are spread down the
whole scrollable surface.
**Fix**: make touch drags require intent, and let the browser keep panning.
- `touch-action: pan-y` on the handle (vertical scroll still belongs to the
  browser);
- `delay: 220` + **`delayOnTouchOnly: true`** so a mouse stays instant and only
  touch needs a hold;
- `touchStartThreshold: 8` so any finger travel inside the delay cancels the
  pending drag — this is what makes "scroll wins, hold wins" unambiguous;
- `chosenClass` feedback, because a touch drag that starts with no visual signal
  reads as either broken or accidental;
- a larger hit box under `@media (pointer: coarse)` — the mouse-sized
  `padding: 0.15rem` caused BOTH accidental drags and failed deliberate ones;
- and drag disabled outright in the mode where reordering is not the task
  (จัดการสิทธิ์), since there it can only ever happen by mistake.
**Where**: `src/css/team.css` `.team-handle`; `src/js/team/index.js` `TOUCH_DRAG`
+ `attachSortables` + the `mode === 'team'` gate on the attach call.
**Rule**: never pair `touch-action: none` with a drag that begins on
`touchstart` inside a scrollable list. Pick one: immediate drag on a small
dedicated non-scrolling surface, or (for a list) long-press + `pan-y`. And when a
mobile gesture "sometimes" does the wrong thing, check the CSS `touch-action` of
whatever the finger landed on before tuning the JS library.

---

---

## A partial left behind by a restructure is a DECOY — edits land in a file nothing includes, and the page simply does not change

**Symptom**: added a year picker and a board grid to `src/html/tab-team-public.html`,
rebuilt, reloaded — neither element existed in the DOM
(`document.getElementById('orgBoard')` → null). The rest of that same partial was
clearly live: `#orgBody`, `#orgSearch` and the whole spine tree rendered fine. So
the page looked like it was serving a STALE copy of the file I had just edited,
and the first two theories were both about caching (the HTML-include plugin not
watching partials; Vite holding a transform). Restarting the dev server changed
nothing, which is the tell.
**Cause**: `grep -rn "tab-team-public" index.html` returns NOTHING. Commit
`07b9beb` ("merge ทีม SAMO org chart into เกี่ยวกับเรา tab") had COPIED that
markup into `src/html/tab-about.html` and repointed `index.html` at it, leaving
the original partial on disk, unreferenced. The ids matched because it was a
copy, so every symptom pointed at the live file while every edit went to the dead
one. `git grep` for the id would have found two hits in ~5 seconds; I searched for
the behaviour instead of the file.
**Fix**: apply the edits to `tab-about.html`, and `git rm` the orphan so there is
one copy again. **Rule**: before editing any `src/html/*.html` partial, confirm
something includes it — `grep -rn "<partial-name>" index.html admin/index.html`.
An unreferenced partial is worse than a deleted one: it absorbs edits silently.
And when a DOM element you just added is missing while its siblings render,
suspect TWO FILES before suspecting one stale one — `getElementById` returning
null for new markup next to working old markup is the signature.

---

---

## A shared `render()` that repaints a pane another module owns will destroy that module's in-progress input

**Symptom**: none reported — found by tracing what fires `render()` in
`src/js/team/index.js`. It is the target of `scheduleRemoteRender()`, i.e. the
Supabase Realtime subscription on `team_nodes`/`team_members`. The new
ปีการศึกษา branch ended in `renderTerms()`, so **another admin editing the live
tree would `innerHTML`-rebuild the archive editor and throw away whatever the
first admin was typing** — a name half-corrected, an unsaved ชื่อเล่น.
**Cause**: `render()` already knew this hazard for drag (`dragging` /
`pendingRender` exist because a remote event mid-SortableJS-gesture cancels the
drag — logged above). Adding a third mode that owns its own DOM re-introduced the
same exposure through a different door: a text input is as destroyable as a drag
gesture, and there was no equivalent guard. The archive is also *independent of
the live tree*, so the repaint had no informational value at all.
**Fix**: the `isYears` branch toggles visibility and returns. `terms.js` owns its
pane and repaints on its own actions; `enterTerms()` paints a loading line on
cold entry, since `render()` no longer does it.
**Rule**: when a shell's `render()` can be invoked by a remote/background event,
it must not rebuild DOM owned by a sub-module that holds user input. Either the
sub-module owns its repaint, or the shell needs the same "is the user mid-gesture"
guard the drag path already has. Before adding a branch to a shared render, list
every caller of that function — not just the one you are writing for.

---

---

## A `busy` flag that RETURNS EARLY silently discards the second action — serialise instead of dropping

**Symptom**: none reported. `guard()` in `src/js/team/terms.js` opened with
`if (busy) return;`. Type a corrected name, Tab to ชื่อเล่น, type, blur — the two
`change` events land close enough together that the second PATCH is dropped. The
status line still reads "บันทึกแล้ว" (from the first), so the edit looks saved
and is not; the value survives on screen until the next repaint, then reverts.
**Cause**: a re-entrancy guard was reached for where a QUEUE was needed. Dropping
is only correct when the second call is a duplicate of the first (a double-clicked
submit). Here every call carries different data, so dropping is data loss —
and the early `return` gives the caller no way to know it happened.
**Fix**: `chain = chain.then(...)` — every call queues behind the previous one,
nothing is discarded, and the status line reports the last real outcome.
**Rule**: before writing `if (busy) return`, ask what the dropped call CARRIED. If
it carries user input, serialise it. Reserve the drop for idempotent re-submits,
and even then prefer disabling the control so the user can see why nothing
happened.

---

---

## A Bootstrap icon name from a LATER release renders as nothing — no error, no failed request, just an empty box

**Symptom**: none reported for months. `SAMO Passport` showed a blank gap where
its icon should be, in the ทีม SAMO permission modal and (newly) on the landing
timeline; the profile modal's "รอยืนยัน" email badge had the same hole.
**Cause**: `bi-passport`, `bi-passport-fill` and `bi-envelope-arrow-up` were all
added in **bootstrap-icons 1.11**. Both entries pin **1.10.5** via CDN
(`index.html` and `admin/index.html`). A Bootstrap icon is a `::before`
codepoint in an icon font, so a name that does not exist is not a 404 and not a
console error — the font loaded fine, the class simply matches no rule and the
glyph is absent. It fails **silently and invisibly**, which is why it survived:
you only catch it by looking at that exact pixel, and a missing icon looks like
deliberate whitespace.
**Fix**: `npm run check:icons` (`tools/check-icons.mjs`) — reads the pinned
version out of `index.html`, fetches that stylesheet, extracts all ~1950 real
names, and fails on any `bi-*` class in the repo that is not among them. It
strips comments first, or it flags its own documentation: `projects/data.js`
already carried a comment naming `bi-send-arrow-up-fill` as missing, which is
evidence this had been hit before and fixed one-off without a guard.
**Deliberately NOT in `npm test`** — it fetches over the network, and a unit
suite that needs the internet is a suite that fails on a plane.
**Where**: `tools/check-icons.mjs`; fixes in `src/data/changelog.js`,
`src/html/tab-team.html`, `src/js/profile.js`.
**Rule**: before using a Bootstrap icon you have not used before, run
`npm run check:icons`. Do not trust the icon browser on the Bootstrap website —
it shows the LATEST release, not the version you pin. The same trap applies to
any icon font (Material Symbols, Font Awesome): a name is not a URL, so a wrong
one cannot 404.

---

---

## iOS Safari `100vh` hides the bottom of a full-height drawer

**Symptom**: Sign-out button (or any bottom-anchored control) in the
mobile admin sidebar drawer was unreachable on iPhone — buried under
Safari's bottom URL chrome.
**Cause**: iOS Safari measures `100vh` against the *large viewport*
(URL bar hidden). When the URL bar is shown — which is the default
state on first open — the drawer extends *past* the visible area, and
the user has to scroll to reach the bottom. Adding `bottom: 0` on a
fixed element doesn't help: the element is positioned relative to the
same large viewport.
**Fix**: Use `100dvh` (dynamic viewport height) for the drawer height,
which shrinks when the chrome is shown. Keep `100vh` above it as a
fallback for browsers that don't grok `dvh`. Additionally pad the bottom
of the bottom-anchored control with
`max(0.85rem, calc(env(safe-area-inset-bottom) + 0.6rem))` so it sits
above the iOS home-indicator inset too.
**Where**: `src/css/workspace.css` `.workspace-side` (mobile @media block)
+ `.workspace-side-foot` (same block). Apply the same pattern to any
new full-height mobile overlay (offcanvas, modal-fullscreen on mobile).

---

---

## Pane-scoped DOM selectors break when the shell is rewritten

**Symptom**: In the admin app, clicking "การตั้งค่า" inside the หนังสือโครงการ
pane does nothing — the manage view never replaces the inbox view.
**Cause**: `setView()` in `src/js/projects/index.js` scoped its selectors
to `#pills-projects [data-projects-view]` / `[data-projects-pane]`, and
its click delegation listened on `#pills-projects`. The cc27157 public→
admin split removed the `id="pills-projects"` wrapper (tab-projects.html
now sits inside `<section data-admin-pane="projects">`), so every
scoped query found nothing and the click handler never bound.
**Fix**: Drop the `#pills-projects` scoping — the `data-projects-view`
/ `data-projects-pane` attributes are unique to this feature, so match
them at document scope. Delegate the click on `document` too.
**Where**: `src/js/projects/index.js` `setView()` + the `initProjects()`
click delegate. Whenever a refactor moves a partial into a new shell,
audit any module-scoped `#foo`-rooted query selectors against the new
DOM — the JS module's selector strings travel with the module and
will silently break if the host wrapper id changes.

---

---

## A full-height centered page with `height:100% + overflow:hidden` is unscrollable on mobile when the content is taller than the viewport

**Symptom**: The pages.dev "we've moved" splash (`public/moved.html`) could not be
scrolled up/down on iPad — the card (and the countdown + CTA below it) were
clipped, unreachable. Fine on desktop / tall phone viewports; only bit where the
card exceeds the viewport (iPad landscape, large text / zoom, short screens).
**Cause**: the splash `body` used `html,body{height:100%}` + `body{display:grid;
place-items:center; overflow:hidden}`. `height:100%` pins the body to exactly the
viewport height, and `overflow:hidden` then clips anything taller — so a centered
card bigger than the viewport has its overflow hidden with no way to scroll to it.
(Same family as the iOS `100vh` drawer entry above — full-height mobile layouts
are the recurring trap.)
**Fix**: drop the fixed `height:100%` (keep `min-height:100dvh` so it still fills
the screen but can GROW past it), and change `overflow:hidden` → `overflow-x:hidden`
(kills only horizontal aurora bleed; per CSS the y-axis then computes to `auto`, so
the page scrolls vertically). Grid `place-items:center` with auto rows keeps the
card centered when it fits and top-aligned+scrollable when it doesn't. The fixed
background layers (`.aurora`/`.stars`, `position:fixed`) are unaffected — `body`'s
overflow never clips fixed descendants (their containing block is the viewport,
not `body`), so the backdrop stays put while content scrolls.
**Where**: `public/moved.html` in BOTH this repo and the passport repo. For any
future full-screen centered page, use `min-height:100dvh` (never `height:100%`)
and never `overflow:hidden` on the scroll root — reach for `overflow-x:hidden` if
you only need to tame horizontal bleed.

---

---

## Bootstrap tab JS keeps the parent dropdown open

**Symptom**: After clicking "PR Form" inside the "เครื่องมือ" dropdown, the
dropdown stays open and the toggle stays styled active.
**Cause**: Bootstrap's tab JS directly sets `.show` on the parent
`.dropdown-menu`, bypassing the Dropdown API — so `.hide()` doesn't help.
**Fix**: Listen for `shown.bs.tab`. Strip `.show` from any `.dropdown-menu.show`
inside `.samo-navbar` and reset `aria-expanded="false"` on the toggle.
**Where**: `src/js/main.js`.

---

---

## Bootstrap mobile offcanvas + `data-bs-toggle="pill"` race

**Symptom**: On mobile, tapping a tool in the offcanvas drawer activates the
new pane on top of the old one (stacked panes).
**Cause**: The offcanvas pill buttons aren't part of the navbar's tablist, so
Bootstrap activates the new pane but never deactivates the previously-active
one.
**Fix**: In the offcanvas, drop `data-bs-toggle="pill"` and use
`onclick="activateTab('pills-X-tab')"` which routes through the canonical
tab button (in the right tablist). Close offcanvas in a delegated click
handler.
**Where**: `src/html/navbar.html` + `src/js/main.js`.

---

---

## `form.reset()` clears the file input but `fileInput.files` still references the old File

Not currently biting us, but worth knowing: after `form.reset()`, the file
input element's `.files` property may still reference the previously-selected
file in some browsers. If you trigger an upload in a second submission and
read `fileInput.files`, you can re-upload the previous file. Re-create the
input element OR explicitly `fileInput.value = ''` if this becomes a problem.

---

---

## `form.reset()` clears hidden inputs

**Symptom**: First PR submit succeeds; second submit goes through with
`submitter = 'Guest'` even though user is signed in.
**Cause**: After success, we call `form.reset()` to clear visible fields.
This also resets hidden inputs `prGoogleUserEmail` / `prGoogleUserName`.
**Fix**: Re-populate hidden inputs from `authGetUser()` immediately after reset.
**Where**: `src/js/pr-form.js` success path inside `handlePrFormSubmit`.

---

---

## HTML5 `required` on a hidden field silently blocks form submit

**Symptom**: User fills in every visible field of the project send-document
modal, clicks "ส่ง" — nothing happens. No error, no spinner, no Discord
ping, no row. DevTools console quietly says
`An invalid form control with name='' is not focusable.`
**Cause**: The same `<form>` does double duty for "create project + first
doc" and "add doc to existing project". Depending on mode, half its fields
are hidden via `d-none`. But HTML5 form validation **still runs on hidden
required fields** — and because the browser can't focus a hidden field to
show the validation tooltip, it just refuses to submit, silently.
**Fix**: Add `novalidate` to the `<form>` AND remove all `required`
attributes from inputs that may be hidden by mode. Do validation in JS
(`onSubmit` throws clear Thai errors that surface via `alert`). HTML5
required + dynamic hide/show is a footgun in any multi-mode form here.
**Where**: `src/html/modal-project-send.html` `#projectSendForm`. If you
add a new dual-mode modal, do the same.

---

---

## Adding `prefers-color-scheme: dark` to ONE component in a light-only app makes just that component go dark on a dark-mode OS

**Symptom**: The new landing-page stat strip rendered **dark green** while the
rest of the (white) site stayed light. Only happened for users whose OS/browser
was set to dark mode.
**Cause**: This app is **light-only** — a repo-wide grep shows ZERO
`prefers-color-scheme` / `data-theme` rules anywhere except the files just added
(`home-stats.css`, `analytics.css`). Those new files included
`@media (prefers-color-scheme: dark)` + `:root[data-theme="dark"]` overrides
(a good habit for standalone artifacts / theme-aware sites — but wrong here).
With no app-level theme system, the media query is the ONLY thing reacting to
the OS preference, so a dark-mode visitor got a dark component island floating
in the otherwise-white page. The general "design both themes" guidance has an
explicit carve-out — *"a design that deliberately commits to one visual world
may stay single-theme"* — and this app has committed to light.
**Fix**: Remove all `prefers-color-scheme` / `data-theme` blocks from
`home-stats.css` + `analytics.css`; they now render light unconditionally.
**Rule**: before adding dark-mode CSS to a NEW component, grep the app for an
existing theme system (`prefers-color-scheme`, `data-theme`, a theme toggle). If
there is none, the app is single-theme — match it, don't unilaterally introduce
a half-theme that only your component honors. (Standalone Artifacts are the
exception — those SHOULD be theme-aware; the deployed app is not.)
**Where**: `src/css/home-stats.css`, `src/css/analytics.css`.

---

---

## A `data-role="x"` element with no matching toggle in the JS is visible to EVERYONE — and a role with no empty-state copy reads as a broken page

**Symptom**: "I assigned myself as อาจารย์ on ทีม SAMO, but when I open
หนังสือโครงการ I see nothing." Not a permission bug — verified live that 0 sign
requests named that account (all 11 named `saprof`), so an empty inbox was
CORRECT. It looked broken because of what the empty state said: nothing.
**Cause**: `#projectsGridEmpty` carries one `<span data-projects-role="…">` per
role, and `applyRoleVisibility()` toggled `d-none` on the `vp_admin` and
`uni_staff` spans only. There was no `sa_prof` span at all, so a professor got
the heading "ยังไม่มีโครงการในมุมมองนี้" above an EMPTY paragraph — no reason, no
next step. A role whose normal state is "empty until someone sends you
something" needs that said out loud, or every professor's first login looks like
a failure.
**The trap in the fix**: these spans carry NO `d-none` in the markup — they are
hidden by the JS toggling it ON. So adding a `data-projects-role="sa_prof"` span
WITHOUT adding a matching `querySelectorAll` block makes it visible to every
role instead of only the professor (a vp_admin would read both "กด สร้าง
โครงการใหม่" and "เมื่อเจ้าหน้าที่คณะส่งหนังสือมาให้ลงนาม"). Default-visible +
opt-in hiding means an unhandled attribute FAILS OPEN.
**Where**: `src/html/tab-projects.html` `#projectsGridEmpty`;
`src/js/projects/index.js` `applyRoleVisibility()` (now toggles all three roles).
**Rules**: (1) when a role can legitimately see zero rows, write its empty-state
copy — "nothing here yet" and "you have no access" look identical to a user.
(2) Any attribute-driven visibility scheme that hides by ADDING a class fails
open; grep that every value in the markup has a handler
(`grep -o 'data-projects-role="[a-z_]*"' src/html/*.html | sort -u` vs the
`querySelectorAll` calls) whenever you add a role.

---

---

## Bootstrap gives EVERY modal the same z-index — so a stacked modal declared earlier in the HTML paints BEHIND the one that opened it

**Symptom** (reported): in จัดการทีม → a person → the ตำแหน่ง selector, "it
doesn't show the popup, it shows เลือกตำแหน่ง behind it". The picker opens, the
backdrop dims, focus moves into it — and it is invisible, underneath the member
editor. Reads like a broken `.show()` call or a missing `d-none` toggle.
**Cause**: Bootstrap's docs say "multiple open modals are not supported" and the
CSS means it — every `.modal` is z-index 1055 and every `.modal-backdrop` 1050,
with no per-instance adjustment. Equal z-index means **DOM order decides the
painting order**, so the modal declared LATER in the HTML wins. `#teamPickerModal`
sits at line ~149 of `tab-team.html` and `#teamMemberModal` at ~372, so opening
the picker from the member editor put it behind. Nothing about the JS is wrong,
and the same code works perfectly when the picker is opened from the tree (no
other modal up), which is what makes it look intermittent.
**Fix**: `src/js/modal-stack.js` — ONE delegated `show.bs.modal` listener,
wired in both entries. It counts `.modal.show` (the event fires before Bootstrap
adds `.show` to this element and before it appends this modal's backdrop, so the
count is exactly the modals already up), and lifts this modal to
`1055 + depth*20` with its backdrop 10 below. `hidden.bs.modal` clears the
inline z-index and re-asserts `modal-open` on `<body>`, which Bootstrap strips
on ANY hide even when an outer modal is still shown.
**Where**: `src/js/modal-stack.js`; `initModalStack()` in `main.js` +
`admin-main.js`. **Rules**: (1) opening a modal from inside another modal needs
this — do not "fix" it by reordering the HTML, which only moves the problem to
the next pair. (2) It composes with the existing stacked-backdrop entry above:
use `getOrCreateInstance(el).show()` (never `new bootstrap.Modal`) AND let the
stacker place it.

---

---

## A class in the markup with NO rule in any stylesheet is invisible in review and looks exactly like a broken value — assert the coverage

**Symptom** (reported with a screenshot): the ทีม SAMO member editor's portrait
preview rendered at full size and burst out of the modal, over the form. The
call site looked right. The markup looked right.
**Cause**: `.team-photo-field` / `-preview` / `-controls` / `-empty` were written
into `src/html/tab-team.html` and **the stylesheet rules were never added** —
`grep -rn "team-photo" src/css/` returned nothing. With no box to fit, an `<img>`
renders at its natural size (Bootstrap 5's Reboot does NOT set a global
`img{max-width:100%}` — that is `.img-fluid`, opt-in). Nothing errors, nothing
logs, and the diff that introduced it reads as complete.
**Fix**: the rules, plus a TEST that makes the class impossible to forget —
`src/js/team/health.test.js` extracts every `team-*` class from the partial and
every `team-health-*` / `imgcrop-*` class from the JS, and asserts each has a
rule in the stylesheets those entries load. Run on the existing code it
immediately found four more: two deliberate layout hooks (allow-listed by name,
so the list itself stays meaningful), one **dead class** (`team-picker-dialog` —
no rule, no JS selector, removed), and one genuinely missing rule
(`team-perm-inherited-label`).
**Where**: `src/css/team.css`; the coverage tests at the bottom of
`src/js/team/health.test.js`. Two things that make the test not-annoying: the
allow-list is explicit and named (a growing allow-list is a smell, not a
solution), and the regex uses `(?<!-)` so a CSS CUSTOM PROPERTY set from JS
(`--imgcrop-ratio`) is not mistaken for a class.
**Rule**: when a layout bug appears in NEW markup, `grep` one of its class names
against `src/css/` before debugging the JS. And for any module that owns its own
class namespace, assert the coverage — it costs six lines and catches the whole
class. Related: the entry above on `convertDriveUrl`'s ignored size argument;
both bugs were in that one screenshot, and either alone was survivable.

---

---

## An indicator that links to a LIST moves the work instead of removing it — the click already said WHICH one, so carry it

**Symptom** (reported): "when I click the flag on a person in จัดการทีม it goes
to ตรวจสอบข้อมูล, but I don't know where to look — the admin shouldn't have to
remember the person they just clicked." Exactly right, and the feature had
looked finished: the flag was on the correct rows, the tooltip named the real
reasons, the navigation worked.
**Cause**: the flag answered "does this person need attention?" and then handed
over to a screen answering "who needs attention?" — a strictly *less* specific
question than the one just asked. With 24 findings the admin re-scans a list to
re-find someone they had already pointed at. The information was thrown away at
the exact moment it was most precise.
**Fix**: the navigation carries the subject. A member-row flag opens the pane
filtered to that person; a rolled-up count on a ตำแหน่ง filters to that whole
branch (clicking "11" is asking about those 11). Three details that make a
filter safe rather than confusing:
- **The filter is stated and reversible on screen** — a "แสดงเฉพาะ … · N
  รายการ" banner with a "ดูทั้งหมด (24)" button. A silent filter is worse than
  none.
- **Arriving by the ordinary tab CLEARS it.** A screen that quietly keeps
  showing a subset reads as "everything else is fixed".
- **The empty state must know it is filtered.** "ข้อมูลครบถ้วน" under a filter
  is a lie about the other 23; it says "…สำหรับ <คนนี้> แล้ว" instead.
**The bug this shape hides**: the filter and the indicator must agree about
which records a finding concerns. If the filter's id extraction missed one of
the shapes the indicator uses, clicking a flag would open a pane declaring that
person has NOTHING wrong — indistinguishable from a resolved problem, so nobody
reports it. `idsOf()` is therefore exported and unit-tested directly against the
flag map ("every flagged member is reachable from at least one finding").
**Where**: `src/js/team/health.js` (`idsOf`, `focusIds`, `enterHealth(focus)`),
`src/js/team/index.js` (`openHealthFor`, `memberIdsUnder`).
**Rule**: whenever a per-row indicator navigates to an aggregate view, pass the
row through. And when two code paths derive "which records does this concern?",
test them against each other — the failure mode is a screen confidently saying
"nothing here", which reads as success.

---

## State parked on a REUSED DOM element outlives the record it describes — a modal is filled again, the element is not

**Symptom** (found by a bug scan, but it had already SHIPPED): open a ตำแหน่ง
holding the `master` grant in จัดการสิทธิ์, close it, then open an ordinary
person. Their permission grid shows the FIRST row's permissions. The grid is
what gets saved, so pressing บันทึก writes the second person a set of
permissions they never had.
**Cause**: `syncMasterVisibility()` needs to know whether master was on a moment
ago, so that turning it OFF can restore the grant it overwrote when it force-
ticked everything. It kept that memory on the grid element — an `is-master`
class plus a `preMaster` dataset snapshot. That is fine WITHIN one row and
wrong across rows: the modal is re-filled from the same DOM every time it opens,
so the element outlives the record. On the second open the function read
"master was on, now it is off" — a transition that never happened — and restored
the first row's snapshot over the second row's real values.
**The tell**: the value being remembered describes a ROW, but the place it is
stored is scoped to the SCREEN. Any `dataset.*` / class flag used as memory has
this hazard the moment its host is reused, and a modal, a table row template
and a re-rendered list are all reused hosts.
**Fix**: `resetMasterState(grid)` at the top of each fill path
(`fillNodePermPane` / `fillMemberPermPane`), before the row's values are
applied — so the grid can never carry one record's state into another. It must
be in the FILL, not in the sync: the sync also runs on every `change` event,
where the memory is exactly what is needed.
**Where**: `src/js/team/index.js` `resetMasterState` / `syncMasterVisibility`.
**Rules**: (1) when a DOM element stores state ABOUT a record, clear it where
the element is re-pointed at a new record, not where the state is read.
(2) Prefer deriving "what was it before?" from the record you are editing over
remembering it in the DOM. (3) Reproduce this class by opening TWO different
records in sequence — one open never shows it, and neither does a unit test that
renders once. This one was caught by driving a real browser through
open-A-then-open-B.

---

## Uploading a replacement photo on PICK leaves the previous file in Drive forever

**Symptom** (reported): "when there's already a picture of me uploaded on
teamsamo and i press upload files, and upload it without pressing the นำรูปออก,
the drive now store both files."
**What it was NOT**: the delete plumbing. `deleteTeamPhotoIfUnused()` ref-counts
`team_members` + `team_archive_members` and only then calls the GAS
`deleteTeamFile` action — and that action is live and working. Probed it before
touching anything, with a well-formed but non-existent Drive id, which returns
`{success:true, alreadyGone:true}`; the same probe with a junk action name
returns `Unknown action`, so the probe could tell "works" from "not deployed"
(both directions — class 7). The archive theory was wrong too: the live DB had
exactly ONE row with a photo and zero archive rows.
**Cause**: the admin member form uploaded the framed file the instant it was
PICKED, and only wrote the resulting URL into a hidden input. So every
intermediate choice became a real Drive file while only the last one ever
reached the row. Pick twice → the first upload is an orphan. Pick once and close
the editor → the upload is an orphan. And the delete path could never clean them
up, because it trashes the photo the DB was POINTING AT — precisely the file that
is not the orphan.
**Fix**: nothing leaves the browser until บันทึก. The crop dialog's output is
held in `memberPhotoPending` with an `URL.createObjectURL` preview; the submit
handler uploads it (with the modal still open and the button showing
`กำลังอัปโหลดรูป…`, so a failure has somewhere to be reported), then the existing
"trash the previous file if unreferenced" step runs as before. `นำรูปออก` drops
the pending pick as well as the stored URL, and `openMemberModal` clears it — the
modal is one reused DOM element, the same hazard as the permission grid above.
**Where**: `src/js/team/index.js` (`memberPhotoPending`, `clearPendingPhoto`,
`onMemberPhotoPick`, `uploadPendingPhoto`, `onMemberSubmit`); the same rule in
`src/js/my-seat.js` `wireSelfEdit`, which grew a photo field in the same commit.
**Rule**: an upload is a WRITE to an external store, so it belongs on the save
path, not on the pick. If a file can be uploaded before the record that will
reference it is committed, the difference between the two is a leak nobody can
find later — and the cleanup routine you already have cannot help, because it
only knows about files the database still names.

---

## A filled "danger" style made an UNCHECKED checkbox look ticked

**Symptom** (reported): "don't highlight the ทุกระบบ (Master) in the แก้ไขสิทธิ์
it makes people confusing if it's being selected or not."
**Cause**: the grid says "this option is ON" with
`.team-perm-opt:has(input:checked) { border-color: green; background: tinted }`.
The Master row then styled itself with `.is-danger { border-color: orange;
background: #fff6f0 }` — the same two properties, unconditionally. So the one
row in the form where being wrong about the state hands out every permission in
the app looked identical whether or not it was ticked.
**Fix**: OFF is a plain white row whose LABEL is orange (marking it out without
claiming a state); ON gets the filled panel plus an inset orange bar, and
`accent-color` makes the tick itself orange. Same information, but the
"selected" channel is used only for selected.
**Where**: `src/css/team.css` `.team-perm-opt.is-danger`.
**Rule**: a component's severity/kind styling must not borrow the same visual
channel the component already uses for STATE. If "checked" is a tinted
background, a variant must not have a tinted background at rest.

---

## A second pass over the same controls silently UNLOCKED the checkbox the first pass had locked

**Symptom** (found by driving the modal, not reported): ทีม SAMO (ดู) in
แก้ไขสิทธิ์ was supposed to be ticked-and-locked — the server grants it to
everyone with a posting, so a live checkbox there is a control that does
nothing. It rendered with the padlock and the dashed "อัตโนมัติ" chip, but the
box was fully clickable: `disabled` was `false` on every open. Unticking it
made the pane claim the person has no view access; reopening the modal put the
tick back.

**Cause**: two passes decide `disabled` on the same nodes, and the second one is
unconditional. `fillPermGrid()` writes `checked disabled` into the markup for an
implicit key. `syncMasterVisibility()` runs immediately after and does
`cb.disabled = on` over every non-master checkbox — where `on` is "is master
ticked". In the normal case master is OFF, so that line assigns `false` and
clears the lock the markup had just set. The bug is invisible in either function
read alone: each is correct about the rule it owns.

**Fix**: skip `IMPLICIT_PERMS` in the master loop entirely — the implicit row's
state is not master's to decide, in either direction. Guard test in
`team-vocab.test.js` asserts the skip exists AND precedes the assignment;
verified to go red with the line removed.

**Where**: `src/js/team/index.js` `syncMasterVisibility()`.

**Rule**: **only ever touch the controls THIS pass locked.** A pass that assigns
`el.disabled = <its own condition>` across a shared set will overwrite locks put
there for unrelated reasons. The read-only pass in this very file already
carries that lesson in a comment (`[data-readonly-locked]` exists precisely so
it can un-disable only what it disabled) — the master pass was written without
it. When one bug has already been paid for in a file, grep the file for the
other passes over the same nodes before assuming it was the only one.

---

## "ลบสมาชิกไม่ได้" — the delete button did nothing at all, and BOTH ways it can do nothing were silent

**Symptom**: In /admin/ → ทีม SAMO, clicking the trash icon on a member row
(`j@kkumail.com`, under หัวหน้าฝ่าย IT) did **nothing** — no confirm dialog, no
error, no change. Reported as "i can't delete this".

**Cause**: The database was never the problem, and proving that first is what
made the rest tractable. Simulating the exact DELETE as the signed-in account
(`phuriphat.ma@kkumail.com`, which holds `master`) inside `begin; … rollback;`
returned `deleted_rows: 1` — RLS allows it, there is no FK referencing
`team_members`, and the only triggers are `AFTER UPDATE` / statement-level.

So the failure was entirely client-side, and `onDeleteMember()` had **two**
silent exits before it ever reached the network:

1. `const m = findMember(id); if (!m) return;` — a DOM row that outlived the
   model it was rendered from produces a dead button with no trace.
2. `if (!confirm(...)) return;` — and a native `confirm()` **cannot tell you it
   was suppressed**. Chrome's "Prevent this page from creating additional
   dialogs" checkbox, once ticked, makes every later `confirm()` return `false`
   instantly with no UI for the lifetime of that page. The team module calls
   `confirm()` in 8 places, so an admin session reaches that checkbox easily.
   This is why only DELETE broke while แก้ไข / ย้าย kept working — those open
   Bootstrap modals, not dialogs.

And had the click reached the network, it would *still* have been silent:
`deleteMember()` checked only `error`, and PostgREST answers an RLS-blocked
DELETE with `204` and zero rows, not an error (the entry above,
"silent-success on RLS-blocked updates / deletes"). Three independent silent
paths stacked on one button.

**Fix**: Both early exits now say something and resync (`alert` + `reload()`)
instead of returning. All five deletes in `src/js/team/api.js` and three in
`src/js/shop/api.js` now send `prefer: 'return=representation'` and throw on an
empty array — matching what `projects/api.js`, `vs-staff.js` and
`announcements.js` already did. `src/js/delete-guard.test.js` sweeps every
`method: 'DELETE'` in `src/js` and asserts both halves; it was verified to FAIL
when a guard is removed, not merely to pass.

**Where it lives now**: `src/js/team/api.js` (deleteNode / deleteMember /
deleteTerm / deleteArchiveMember / deleteMajor), `src/js/shop/api.js`
(deleteProductType / deletePromptpayQr / deletePickupLocation),
`src/js/team/index.js` (onDeleteNode / onDeleteMember),
`src/js/delete-guard.test.js`.

**Rules**: (1) A handler that can `return` without doing anything must say why —
"nothing happened" is the hardest symptom to debug because it names no
component. (2) Native `confirm()` / `alert()` are not reliable control flow in a
long-lived SPA: the browser can disable them permanently and silently, and
`false` then means "suppressed", not "cancelled". Destructive confirmations
belong in an app-owned modal. (3) When a UI action fails, prove which SIDE it
fails on before reading either — simulating the write as the real user, rolled
back, cost one query and eliminated RLS, FKs, triggers and realtime in one shot.

---

## "แก้ไขข้อมูล ของระบบบ้าน — ต้องกดหลายครั้งถึงจะขึ้น" — one listener per re-render + a toggle reading its own state

**Symptom** (as reported): *"the แก้ไขข้อมูล of ระบบบ้าน on samoweb main page, i
need to click many times and sometime it will appear, also the เพื่อนร่วมบ้าน"*.
Intermittent, unreproducible on a fresh load, and it "healed" if you kept
clicking — the profile of a bug nobody can pin down.

**Cause**: two ordinary decisions that are harmless apart and fatal together.

1. `renderMyHouse()` painted the card with `host.innerHTML = …` and then called
   `wireCard(host)`, which attached a **delegated** `click` listener **to `host`
   itself**. `host` is `#homeMyHouse` — a node in `index.html` that survives
   every re-paint. The card re-renders on every auth event (`onAuthChange` fires
   on load, on each token refresh, after every save), so the listener count grew
   by one each time: 1, 2, 3…
2. The handler opened the panel with `p.classList.toggle('d-none')` — visibility
   derived from the element's *own current class*.

N listeners × a self-referential toggle = the panel flips N times per click, so
it opens on an **odd** number of paints and does nothing on an even one. First
load: one listener, works. After the session settles or after one save: two,
dead. Click twice: opens.

**Fix**: listeners go on the nodes **this paint created** (`host.querySelector(...)`
inside the freshly written markup), so the next `innerHTML =` throws them away
with the nodes. Panel visibility is one variable — `open = 'edit' | 'report' |
'roster' | null` — and every panel's `hidden` is assigned from it explicitly;
nothing asks the DOM what state it is in. `src/js/house/my-house.test.js` pins
both shapes at the source (no `host.addEventListener`, no
`classList.toggle('d-none')`), the way `delete-guard.test.js` pins the DELETE
convention.

**Where it lives now**: `src/js/house/my-house.js` (`wireCard`),
`src/js/house/my-house.test.js`.

**Rules**: (1) **A listener attached to a node that outlives the render is a
leak with behaviour.** If a function both writes `innerHTML` and adds a
listener, the listener must go on something inside that `innerHTML` — otherwise
call it exactly once, from a place that cannot run twice. (2) **Never derive UI
state from the DOM you are about to change.** `classList.toggle` answers "what
is it now?", which is only correct if the handler runs exactly once; hold the
state in a variable and assign every dependent property from it. This is the
same geometry as the perm-grid checkbox that a second pass silently unlocked
(class 6) — one property, two sources of truth. (3) An **intermittent** UI bug
that gets better when you click more is almost always a handler-count problem,
not a race.

---

## A chooser that opens as an empty placeholder while its vocabulary loads SUBMITS the empty value

**Symptom** (found by tracing, before it reached anyone): opening บ้านของฉัน →
แก้ไขข้อมูล and pressing บันทึก quickly would silently clear the student's สาขา.

**Cause**: the form was rendered with `<select name="major"><option value="">—
กำลังโหลด —</option></select>` and the real list was fetched when the panel
opened. The form is submittable the instant it appears, so a submit inside that
window read `value === ''`. The RPC treats a present-but-empty key as an
intentional clear (`nullif(btrim(''),'') → NULL`), so the สาขา was erased — and
because the same call records the field in `students.self_edited`, the
0125 trigger then protects the *erased* value from every future import. A
half-second race produced a permanent loss.

Two things made it invisible: the window is short, and the sibling component
had already solved it. `my-seat.js` renders its สาขา chooser as
`optionsHtml(majors, val)` — which, with `majors` still `[]`, keeps the stored
value as its own selected option — so the pre-load markup there is already
correct. The house card was written later and drifted from it.

**Fix**: render the select from `majorOptionsHtml(rec.major)` at paint time; the
async load only ever REPLACES options with a longer list. `my-house.test.js`
asserts the initial markup carries `value="<current>" selected` and no loading
placeholder, and the guard was verified to FAIL when the placeholder is put back.

**Where it lives now**: `src/js/house/my-house.js` (`editFormHtml`,
`majorOptionsHtml`), `src/js/house/my-house.test.js`.

**Rules**: (1) **A control that is visible is submittable.** Anything rendered
before its data arrives must render with the CURRENT value already correct —
"loading" is a state for the options, never for the value. (2) When a sibling
component already does the same job, read it before writing the second one; the
older one here was right and the new one regressed against it (class 6).
(3) Watch for a fix that makes a loss PERMANENT: `self_edited` is exactly right
for a deliberate edit and exactly wrong for an accidental one, so the accidental
path has to be closed at the source.

---

## "ปฏิเสธ ไม่ทำงาน แต่อนุมัติทำงาน" — the same suppressed-dialog bug, on a different button

**Symptom** (as reported): *"ขอแก้ สายรหัส จาก 100 เป็น 200 … when i hit ปฏิเสธ it
doesn't work, when i hit อนุมัติ it works"* — the house คำขอแก้ไข queue.

**Cause**: the reject path collected a reason with `prompt()`:

```js
const note = approve ? null : (prompt('เหตุผลที่ปฏิเสธ …') || null);
if (!approve && note === null) return;      // "cancelled"
```

**Two** silent exits, and the reporter could have hit either:
1. Chrome's "Prevent this page from creating additional dialogs", once ticked,
   makes every later `prompt()` return `null` instantly with no UI for the life
   of the page — read here as "cancelled".
2. Pressing OK on an EMPTY box returns `''`, which `|| null` also turns into
   `null`. So an admin with no particular reason got the same nothing, and
   nobody had ever been told a reason was mandatory.

อนุมัติ worked for exactly one reason: it never opened a dialog.

**This was already known and written down.** The identical cause is logged two
entries above for ทีม SAMO's delete button, `my-house.js` had already replaced
its two `prompt()`s for this reason and says so in a comment, and a scan earlier
the same day listed "the house admin pane still uses 4 native
`confirm()`/`prompt()` calls" as an open item — and shipped. **A hazard written
down three times still shipped a live bug**, which is the actual lesson.

**Fix**: the reason is an ordinary `<input>` in the request card — always
visible, genuinely optional, impossible for the browser to suppress. The two
remaining `confirm()` calls (delete student, delete advisor) now use
`src/js/confirm-modal.js`, an app-owned dialog that always resolves and treats
ESC / backdrop / ยกเลิก as false. It reuses `vs-staff.js`'s stacked-modal
plumbing verbatim — both deletes open from inside an already-open modal, and
Bootstrap gives every modal the same z-index and drops `body.modal-open` when the
top one closes.

**Where it lives now**: `src/js/confirm-modal.js`, `src/js/house/index.js`
(`onDecide`, `onStudentDelete`, `onAdvisorDelete`).

**Rules**: (1) **A native dialog is not control flow.** `confirm()` → false and
`prompt()` → null are indistinguishable from "the browser turned them off".
(2) When a fix is applied to one module, grep the SIBLING modules in the same
commit — `my-house.js` was fixed and `index.js`, twenty lines away in the same
feature, was not. (3) An open item in a scan report is not a fix; if it is a live
silent failure on a destructive control, it is the thing to do first, not the
thing to write down. `team/index.js` still has 9 `confirm()` calls — same fix,
same helper.

---

## "แก้ไขสมาชิก shows ชื่อ นามสกุล as blank, that isn't good" — a correct refusal, where there WAS a human to ask

**Symptom**: after the ชื่อ/นามสกุล split shipped (0135), opening แก้ไขสมาชิก on
any of the 399 pre-split members showed both name boxes EMPTY, with the stored
name printed underneath as a hint. Reported within minutes.

**Cause**: the rule "never split a stored name on whitespace" was applied
literally instead of by its purpose. The purpose is *no unreviewed guess is ever
written* — which is why `house/io.js` refuses a whole CSV: there is no human in
the loop for 1,800 rows. A member modal is the opposite situation: one admin,
one person, the stored name on screen. Refusing to suggest there bought no
safety and cost two things — an editor whose most visible field opens empty
reads as data loss, and a split nobody would ever fill in for 399 people
one blank pair at a time.

**Fix**: `suggestNameSplit()` (`team/fields.js`) fills the boxes from the first
run of whitespace, the stored name is shown beside them, and the save path asks
once — through `askConfirm`, never `window.confirm` — when the values are still
the untouched suggestion. The guess becomes a decision, and only on the first
edit of each legacy row.

**Where it lives now**: `src/js/team/fields.js` (`suggestNameSplit`, with the
"never call this to build a patch" warning), `src/js/team/index.js`
(`openMemberModal`, `onMemberSubmit`).

**Rules**: (1) A safety rule states an OUTCOME, not a mechanism — before
applying one somewhere new, ask which of its preconditions actually hold here.
(2) "Refuse" and "suggest, then confirm" are different answers to the same risk,
and the right one depends on whether a human is present to review. (3) An
editor that opens with an empty field the user can see filled elsewhere will be
reported as data loss, correctly.

---

## Adding an `await` before the modal closes re-opened a double-submit window

**Symptom**: found by audit, same session it was introduced. Pressing บันทึก
twice on a NEW ทีม SAMO member could create the person twice.

**Cause**: `onMemberSubmit` disabled the submit button only inside its
`if (memberPhotoPending)` branch. That was safe for a reason nobody had written
down — with no photo there was no `await` between the submit event and
`modalInstance(...).hide()`, so there was no window to click in. Adding the
ชื่อ/นามสกุล confirmation put an `await askConfirm(...)` **before** the hide,
with the modal open and the button live. Two presses, two dialogs, two
`createMember` calls.

The precondition was invisible: the safety came from the absence of an await,
which is not something a reader thinks to preserve.

**Fix**: a wrapper that disables the button and drops re-entrant submits, with a
`finally` that restores it. The photo branch's inner `finally` now restores only
the LABEL — re-enabling `disabled` there would have re-opened the window for the
rest of the save.

Dropping the second press is right here and is NOT the "a busy flag that returns
early silently discards the second action" trap in this file: that is about two
DIFFERENT actions being collapsed. This is the same submit twice, and the honest
answer to "save this form again while it is saving" is nothing.

**Where it lives now**: `src/js/team/index.js` (`onMemberSubmit` /
`runMemberSubmit`).

**Rule**: any handler that ends in a mutation must own its busy state
explicitly. "There is no await before the close" is a precondition, not a
design — the next person to add a confirmation will not know they are removing
it.

---

## "เพิ่มสมาชิก ไม่ทำงาน" + "ค้นหาคนจากระบบ ไม่ขึ้นรายชื่อ" — one deletion took out the block beside it

**Symptom**: two reports, one session, on iPad AND desktop. (1) In `/admin/`
ทีม SAMO, the **เพิ่มสมาชิก** button did nothing at all — no modal, no message,
no alert. (2) The **ค้นหาคนจากระบบ** box in the member editor never showed a
suggestion. Nothing in the build or the 552 tests was red.

**Cause**: migration 0141's commit removed the "ดึงจากระบบบ้าน" button, whose
handler `onFillFromHouse` lived in `team/index.js`. The deletion ran past the
end of that function and took the **next 95 lines** with it — the 0137 person
picker: `personSearchToken` / `personSearchTimer` / `personSearchHits` and the
two renderers `renderPersonResults()` / `pickPerson()`. Every CALL site stayed.

Five free identifiers, two symptoms:

- `fillMemberModal` resets the picker on open (`personSearchToken += 1`). That
  line is a `ReferenceError`, thrown while **preparing** the dialog — so the
  modal never got shown, on every path into it. A silent nothing.
- the search input's handler touches `personSearchTimer` on the first keystroke
  and dies before it ever queries.

Nothing in this repo could see it. Vite/Rollup do not resolve free identifiers
— an unknown name is assumed to be a global — and there is no linter. The
symptom only exists at runtime, in a signed-in admin pane that no test drives.

Two containment fixes shipped first and neither was the cure, which is itself
worth recording: splitting `openMemberModal` into open-then-fill, and wrapping
each of `initTeam`'s ten `wire*()` calls in its own try/catch. Both were right
(the modal now opens half-filled instead of not at all, and one broken wire-up
no longer kills the tree delegation eight lines later) — but they turned a dead
button into a degraded one. **Containment that makes a failure visible is not a
diagnosis; the console line it adds is.**

**Fix**: restore the deleted block verbatim. Then the mechanism, because the
comment version of this rule ("check what you are deleting next to") is exactly
the kind nobody reads: `src/js/undefined-refs.test.js` parses every module with
`rollup/parseAst` and fails the build on any identifier that is read but bound
nowhere in its file and is not a global. The binding scan is whole-file and
over-approximate on purpose — shadowing and hoisting become non-issues, and a
guard that never cries wolf is one that survives. It found the five names and
six real vendor/browser globals (`bootstrap`, `Quill`, `createImageBitmap`),
which are now an explicit allow-list.

Also removed: `teamMemberHouseFillHint`, the removed button's status line, left
behind in both the markup and `fillMemberModal` — the same partial-deletion
class, in the harmless direction.

**Where it lives now**: `src/js/team/index.js` (the restored
`// ---- the person picker (0137)` block) · `src/js/undefined-refs.test.js` ·
`src/html/tab-team.html`.

**Rule**: a delete is an edit to its NEIGHBOURS. And when a language will not
tell you that a name resolves to nothing, make the build tell you — this repo
has now paid twice in one week for a removal that took an unrelated neighbour
with it (`485478f` deleted Drive files it thought were unused; this one deleted
code it thought was part of what it was removing).

---

## The ลบ button on a สาขา row rendered OUTSIDE the modal on a phone — an `auto` grid track sized from min-content

**Symptom**: found by driving the admin app at 390 px, not by a report. In
จัดการรายการสาขา (ทีม SAMO → member editor → จัดการรายการสาขา), each row was
**426 px wide inside a 374 px dialog**. The trash button sat entirely off the
right edge and the pencil was half-clipped, so on an iPhone or an Android phone
**a สาขา could not be deleted at all**. The page reported no horizontal overflow
(`documentElement.scrollWidth === innerWidth`) because the modal body clipped
it — the usual overflow check said everything was fine.

**Cause**: `.team-majors-list` was `display: grid` with no `grid-template-columns`.
The implicit track is `auto`, and an `auto` track is floored at its content's
**min-content** width. The row's min-content is not negotiable: a `white-space:
nowrap` count plus two 32 px buttons plus the gaps. So the track grew past its
container instead of the row shrinking, and `.team-major-main { flex: 1;
min-width: 0 }` — which looks like it handles exactly this — never got the
chance, because the row it lives in was never the constrained thing.

It looked correct on every desktop it had ever been opened on.

**Fix**: `grid-template-columns: minmax(0, 1fr)` so the track cannot exceed the
container, `flex-wrap: wrap` on the row so the actions drop to a second line
rather than off the edge, `margin-left: auto` on the count so count + both
buttons travel as one right-aligned cluster, and a `<576px` rule giving the name
the whole first line. Verified at 390 / 412 / 768 / 1440 px in headless Chrome.

**Where it lives now**: `src/css/team.css` (`.team-majors-list`,
`.team-major-row`, `.team-major-main`, `.team-major-count`).

**Rule**: `overflow-x` on `<html>` is not a mobile test. A clipped ancestor
hides the overflow from every page-level check, so the thing to measure is
whether each control's `getBoundingClientRect().right` is inside the container
that clips it. And a CSS grid's default `auto` track does not shrink below
min-content — inside a fixed-width parent, spell the track `minmax(0, 1fr)`.

---

## `confirm()` on a SAVE path, not just a delete — permissions silently refused to save

**Symptom**: found by audit while sweeping this class. In ทีม SAMO → จัดการสิทธิ์,
pressing บันทึก on a grant that includes full `vs` ("ทุกแผนก") or full `passport`
("ทุกฝ่าย") could do nothing at all — no save, no error, no dialog.

**Cause**: the same suppressed-dialog mechanism that killed ลบสมาชิก and ระบบบ้าน's
ปฏิเสธ, but on a *write* path. `readPermInputsOrWarn()` guarded those two
escalating grants with `confirm()` and returned `null` on a false. Once Chrome's
"Prevent this page from creating additional dialogs" box is ticked — and the
admin session that hands out permissions is exactly the session that ticks it —
`confirm()` returns false instantly with no UI, so the guard read "the admin
backed out" and the submit handler returned. Forever, for that page.

The two earlier instances of this class were both DELETES, which is how it kept
being filed as "the delete button is broken" rather than as what it is: a
dialog is not a value you can read.

**Fix**: every native dialog in `team/index.js` and `team/terms.js` now goes
through `askConfirm` / `askDelete` (`src/js/confirm-modal.js`), which this app
draws and which always resolves. `readPermInputsOrWarn` and `confirmMaster`
became async and are awaited at all four call sites. `renameMajor`'s `prompt()`
became an input in the row it renames — there is deliberately no `askPrompt`,
because a value the user types belongs in the form it affects.

The guard is `src/js/native-dialog.test.js`: a RATCHET listing the modules that
still use native dialogs, which may only shrink, plus an explicit
must-stay-clean list for the ทีม SAMO / ระบบบ้าน / self-service surfaces.

**Where it lives now**: `src/js/team/index.js` · `src/js/team/terms.js` ·
`src/js/native-dialog.test.js`.

**Rule**: when a hazard has already been paid for twice, the third fix is a
test, not a third patch. And look for the class on the WRITE paths too — a
guard that fails closed on a delete is annoying; on a save it is invisible.

---

## `/admin/#vs` opened the VitalSound workspace for an admin with no VitalSound grant

**Symptom**: found by tracing the admin router. The sidebar hides sections the
account cannot use, and the click delegate skips a hidden button — but the HASH
was never checked. Typing (or bookmarking, or following an old link to)
`/admin/#vs`, `#shop`, `#house` ran that section's `enter*()` loader and painted
its workspace, with no sidebar entry to leave by.

**Cause**: `showAdminSide(which)` trusted its argument. Two more doors shared
the gap: `tryCreatorDeepLink()` opened the announcement editor for `#creator/<id>`
without checking `creator`, and the `?scan=<order>` subscriber routed to the shop.

Not a data leak — RLS returns no rows, so the panes come up empty — which is
precisely what makes it worth fixing: a workspace that renders and then can do
nothing is the "live-looking ลบ button that 42501s" shape, one layer up.

**Fix**: `canOpenSection(which)` resolves the section's key through the existing
`SIDE_FEATURE` map and `userCanAccess()`, and `showAdminSide` falls back to the
landing pane. An UNKNOWN section stays allowed — `showAdminSide` already lands
those on the landing pane, and failing closed here would be a second copy of the
section list to keep in step.

**Where it lives now**: `src/js/admin-main.js` (`canOpenSection`).

**Rule**: a gate on the widget is not a gate on the route. Enumerate every way
in — click, hash, query string, deep link — because the URL bar is one of them
and it is the one nobody renders.

---

## `{"code":"23505" … "students_kkumail_key"}` in an alert() — a unique index used as a first line of defence

**Symptom**: reported verbatim — *"what if i add student data in ระบบบ้าน that
already exist in teamsamo, it shows `{"code":"23505","details":null,"hint":null,
"message":"duplicate key value violates unique constraint \"students_kkumail_key\""}`.
what if the data isn't the same, or some field left blank, etc."*

**Cause**: the create path had no duplicate handling at all, so the raw PostgREST
envelope reached `alert()`. A unique index is the correct BACKSTOP and a terrible
first line of defence: by the time it fires the admin has filled in a whole form,
and what comes back names an index rather than a person — it does not say who the
address belongs to, whether they are already in a บ้าน, or what to do next. The
admin's only remaining move is to guess.

**Fix**: "already exists" is THREE situations wanting three different next
actions, so the form grew three states rather than one error message.

1. **Already a นักศึกษา** — nothing to create. Name them, name their สาย and
   บ้าน, and offer a button that switches the modal to the row that exists.
2. **In the registry, not in ระบบบ้าน** — a ทีม SAMO member getting a house
   placement for the first time. A legitimate save; the DB links them to the same
   `public.people` row. "ใช้ข้อมูลจากระบบ" fills the BLANK boxes only, and every
   field where the registry DISAGREES is listed with both values — choosing
   between two spellings of a real person's name is a decision, not a merge.
3. **Nobody** — no banner.

**Two things that would have made it wrong**:

- The lookup is `search_people` (SECURITY DEFINER), **not** a scan of the
  `students` array the pane already holds. RLS returns zero rows rather than an
  error, so a local scan answers "no such person" for exactly the rows the caller
  cannot see — a fail-open, and the shape behind three bugs here already.
- **Exact kkumail equality only.** `search_people` is a SEARCH; treating its best
  guess as an identity would let a half-typed address claim a stranger's record
  ("an ILIKE lookup makes the id a PATTERN, not a capability").

`duplicateMessage()` stays as the second line and is **not** redundant: the
lookup can be in flight or failed, two admins can pass the check in the same
instant, and the รหัสนักศึกษา clash is deliberately not pre-checked at all (a
shared รหัส is an ambiguous fact about two humans — 0108 — not a duplicate to
merge). Same shape as `update_my_student_record` (0125), whose own comment says
it: *the pre-check gives the good message in the ordinary case; the exception
handler is what makes it true.*

**Where it lives now**: `src/js/house/index.js` (`paintPersonMatch`,
`duplicateMessage`) · `src/js/house/duplicate-message.test.js` · proof
`tools/house0145-duplicate-person.sql` (5/5).

**Rule**: a constraint violation is a fact about a PERSON, and the UI owes the
reader that sentence — but say it while the field is still being typed, not after
a form has been filled in. Keep the handler anyway: a pre-check is a courtesy and
only the index is the guarantee. And every error translator needs a control that
NON-matching errors pass through untranslated — one that swallows a permissions
failure as "ข้อมูลซ้ำ" costs an admin an afternoon hunting a duplicate that does
not exist.

---

## "แก้ไขสมาชิก … ค้นหาคนจากระบบ … พู่กัน picture become myself" — a picker built for ADD, reused in EDIT, wired to a mirror

**Symptom**: as reported — open แก้ไขสมาชิก on your OWN row, use ค้นหาคนจากระบบ,
click a different person, and the form fills with them. Then the other person's
portrait becomes yours. Measured on prod afterwards: **five rows across
`people`, `students` and `team_members` had collapsed onto a single photo.**

**Cause**: `pickPerson()` (`team/index.js`) overwrites the identity fields with
the picked person's. That is correct for **เพิ่มสมาชิก**, where "who is this"
has no previous answer. In **แก้ไขสมาชิก** the identical click means something
else — it REASSIGNS an existing posting to a different human — and the function
could not tell the two apart, because it never looked at `teamMemberId`.

The blast radius is the part worth remembering. The picker only edits a form;
the damage is done by three correct mechanisms downstream:

1. save writes the picked `kkumail` onto the edited posting;
2. `team_members_link_person` repoints that row's `person_id` at the picked
   person's `public.people` row (the registry matches on kkumail);
3. `team_member_mirror_up` UPDATEs that registry row from the posting —
   including `photo_url` and `photo_focus`;
4. `person_mirror_down` fans the result to every OTHER posting that person holds
   and to their `students` row.

Nothing raised. Every one of those steps is doing exactly its job. **A form that
can change WHICH ENTITY a row refers to is a different kind of control from one
that edits the row's fields, and the mirrors turn it into a multi-system write.**

The portrait was a second, independent bug underneath it: `search_people`
returned no photo, so `pickPerson` left the *previous* row's face in the form
while changing who the row was. Clearing it instead would have been no safer —
`team_member_mirror_up` assigns unconditionally, so `photo_url = null` does not
mean "leave it alone", it means "wipe this person's portrait everywhere".

**Fix**: (a) `pickPerson` asks first — `askConfirm`, danger, default cancel —
but ONLY when it is genuinely a swap: editing, with an existing kkumail, picking
a different one. A posting with no kkumail yet (15 live) is the case this picker
legitimately serves during an edit and stays one click. (b) migration **0148**
adds `photo_url`/`photo_focus` to `search_people`, so the portrait travels with
the person and step 3 writes their own face back onto them — a no-op. (c) the
damaged data was repaired through the registry, letting the same mirror fan the
correct portrait back down.

**Where it lives now**: `src/js/team/index.js` (`pickPerson`),
`supabase/migrations/0148_search_people_carries_the_portrait.sql`.

**Rules**: (1) **A control that reassigns identity is not an edit control** —
when the same widget serves ADD and EDIT, ask what the click MEANS in each, not
whether it fills the same boxes. (2) A mirror makes every local write a
distributed one: before allowing a form to change a foreign key, ask what
follows it. (3) When a projection feeds a form, it must carry EVERY column the
save will write, or the form composes one entity out of two. (4) Fixing this in
the client alone was not possible — the missing column was the bug.

---

## The ยกเลิก button in `askConfirm` did nothing — in the module written because buttons did nothing

**Symptom**: found by driving the real UI, not by a report. A confirm dialog
opened, and clicking **ยกเลิก** left it on screen. Clicked again — still there.
Clicked by element reference rather than coordinates, to rule out an overlay
stealing the hit — still there. `ESC` dismissed it instantly.

**Cause**: the markup in `confirm-modal.js` was

```html
<button type="button" class="btn btn-sm btn-secondary" data-confirm-no>ยกเลิก</button>
```

Nothing in the module binds a click handler to `[data-confirm-no]`. That is by
design and it is the good design — the promise resolves from `hidden.bs.modal`,
so ESC, the backdrop and the button all funnel through one exit and cannot
disagree. But that only works if something actually HIDES the modal. The yes
button calls `modal.hide()` explicitly. The no button was relying on a
`data-bs-dismiss="modal"` attribute **that was never written**. So it was inert:
21 call sites, every destructive confirmation in the app, and the only way out
was a key nobody is told about.

The file's own header comment asserted *"ESC / backdrop / ยกเลิก all mean
false"*. The intent was documented; the wiring was absent. **A comment is not a
mechanism** — and this is the second time that sentence has been earned by this
exact file.

**The irony is the finding.** `confirm-modal.js` exists *because* Chrome's
"prevent this page from creating additional dialogs" checkbox turns native
`confirm()` into a silently-false no-op, reported twice here as
"ลบสมาชิกไม่ได้" and "ปฏิเสธ ไม่ทำงาน". The replacement shipped a button that
does nothing. A fix for a class of bug is not immune to that class.

**Fix**: `data-bs-dismiss="modal"` on the button, plus
`src/js/confirm-modal.test.js`, which accepts EITHER that attribute or a real
click handler, and separately pins that the resolution still happens in
`hidden.bs.modal` (so "fixing" cancel by resolving in a click handler, which
would break the ESC and backdrop paths instead, also fails).

**Two ways the test itself was wrong first, both worth keeping**:
1. Its helper found the marker with `indexOf`, and the marker string also
   appears in the source's own COMMENT, so it reported "no cancel button found"
   against markup that was right there. It matches a `<button …>` tag now.
2. Its "or a click handler exists" branch matched the words `[data-confirm-no]`
   in a comment plus an unrelated `addEventListener('click', onYes)` further
   down — so with the bug reintroduced the test still PASSED. It strips comments
   before asserting now. **A guard that reads comments can be satisfied by
   writing about the fix instead of making it.**

**And the explanatory comment broke the build once**: written as an HTML comment
INSIDE the `innerHTML` template literal, it contained attribute names in
backticks, and a backtick inside a template literal ends the template literal.
`undefined-refs.test.js` caught it as a Rollup parse error.

**Where it lives now**: `src/js/confirm-modal.js`, `src/js/confirm-modal.test.js`.

**Rules**: (1) When a dismissal is declarative (`data-bs-dismiss`), it is CODE —
losing it is losing a line of logic, so pin it. (2) Drive the control a person
actually aims at; ESC working is not the button working. (3) Verify a new guard
BOTH ways — reintroduce the bug and watch it fail — or you have written a test
that asserts your own comment. (4) The module that fixes a bug class is not
exempt from that class.

---

## A VIEW is not a BREAKPOINT — scoping a layout to `@media` and then making it user-selectable

**Symptom**: none visible, which is why it survived. The public org chart's
รายการ view lost its connector rails and its depth-scaled headings on any screen
≥1024px. Nothing looked broken; the tree simply rendered flat, exactly as it had
before those rules were written.

**Cause**: the layout started out chosen by SCREEN SIZE — indented list under
1024px, horizontal chart above — so the list rules lived in
`@media (max-width: 1023.98px)`. Correct at the time. Then the owner asked for a
toggle, and the views became a `data-view` attribute the reader controls. The
media query was never revisited, so on a desktop the reader could select รายการ
and get a version of it that had been silently disabled.

**Fix**: scope on `[data-view="list"]` / `[data-view="chart"]`. The rule is the
generalisation: **a media query answers "how big is the screen", a view answers
"what did the reader ask for", and the moment the second exists the first is the
wrong question.** Nothing about 1024px was ever what those rails depended on.

**Where it lives now**: `src/css/org-chart.css`, the "THE TWO VIEWS" block, whose
header says this in three lines so the next person does not re-derive it.

**Rules**: (1) When a layout becomes user-selectable, grep every `@media` that
was standing in for the choice. (2) A rule that stops applying is invisible —
CSS has no undefined-reference error. The only way to catch it is to ask the
browser for the computed value.

---

## A markup refactor silently unhooked every `> .org-station` selector

**Symptom**: also invisible. The depth-scaled ตำแหน่ง headings (a ฝ่าย larger
than a ตำแหน่ง four levels down) simply never applied — every heading rendered at
the base size, which looks like a design that was never added rather than one
that stopped working.

**Cause**: the horizontal chart needed each node's box to be a layout SIBLING of
its children row, so `nodeBlock` began wrapping the station in `.org-box`:

```
li.org-node > h3.org-station              →  li.org-node > div.org-box > h3.org-station
```

Five selectors written as `.org-node[data-depth="N"] > .org-station …` kept
parsing, kept being served, and matched nothing.

**Fix**: `> .org-box > .org-station`. Found by asking the page for
`getComputedStyle(...).fontSize` and getting `none` for an element the selector
claimed to style — then confirming with
`document.querySelector(sel)` returning `null` for the old path and an element
for the new one, which distinguishes "the rule is wrong" from "the element is
absent".

**Where it lives now**: `src/css/org-chart.css`, with a comment on the hop.

**Rules**: (1) **A child combinator is a contract with the markup.** Changing the
DOM shape breaks every `>` selector that crossed the changed boundary, silently,
with no build error and no console warning. When you insert a wrapper, grep for
`> .<child>` on the element you wrapped. (2) The instrument for "is this rule
applying" is the computed style, never the stylesheet.

---

## `justify-content: center` makes the overflow of a scroll container UNREACHABLE

**Symptom**: reported as "สมาชิกฝ่าย Production it department got cutoff". Boxes
at the start of a horizontally-scrolling org chart were clipped, and no amount
of scrolling revealed them.

**Cause**: a flex row centred with `justify-content: center` distributes its
overflow to BOTH sides. The end-side overflow is scrollable; the start-side
overflow sits at a negative offset that the scroll range does not cover, so the
browser clips it and there is no scroll position that shows it. Any ฝ่าย wider
than the viewport lost content off the left.

**Fix**: `justify-content: safe center` — the `safe` keyword falls back to
`start` exactly when the alignment would cause overflow. A section that fits
stays centred; one that does not becomes fully reachable.

Verified by measuring, not by looking: for every box, compute
`rect.left - wrapper.left + wrapper.scrollLeft` and assert none is negative.
0 boxes after, several before.

**Where it lives now**: `src/css/org-chart.css`.

**Rules**: (1) Any centred flex/grid that can overflow its scroll container needs
`safe`. (2) "It looks cut off" has a mechanical test — a negative scroll-space
offset — that is far more reliable than scrolling around looking for it.

---

## `flex-wrap` does nothing inside `width: max-content`

**Symptom**: added `flex-wrap: wrap` to make a twelve-column org-chart row wrap
on an iPad, rebuilt, re-measured — and the numbers came back **byte-identical**.
Not "a bit better": exactly the same, to the pixel.

**Cause**: the flex container's ancestor chain carried `width: max-content`, so
the container is always as wide as its content wants to be. A wrap point is a
width the content is not allowed to exceed, and `max-content` guarantees there
is no such width. Wrapping was correctly enabled and could never trigger.

**Fix**: bound the wrapping row — `max-width: calc(100vw - <gutter>)`. Wrapping
then happens at the screen edge, and costs nothing when the row already fits
because it is a no-op there.

**Where it lives now**: `src/css/org-chart.css`, noted in the block header
because the failed attempt is more instructive than the fix.

**Rules**: (1) `flex-wrap` needs a CONSTRAINT, not just permission. If nothing
bounds the container, nothing wraps. (2) **Identical measurements after a change
mean the change did not apply** — that is a stronger signal than a small
improvement, and it is worth re-measuring precisely so the difference between
"no effect" and "small effect" is visible.

---

## "เข้าสู่ระบบด้วย Google" read as KKU-only — a steer written as a rule + a form behind a collapse

**Symptom**: reported as two complaints about the sign-in modal at once. "it
shows too many text", and — the substantive one — the copy made Google sign-in
look restricted to KKU: *"i not just want to encourage only kku people, it'd be
misleading for other normal people who thinks oh only kku would use login with
google, in fact they can use it also and i want them to use it."* Plus: the
username/password form "shouldn't be collapse, it should be expand all".

**Cause**: three separate mistakes stacked on the same screen.

1. **A steer stated as a requirement.** The copy read "นักศึกษาและบุคลากร MDKKU
   ใช้บัญชี Google ของมหาวิทยาลัย" and "เลือกบัญชีที่ลงท้ายด้วย @kkumail.com หรือ
   @kku.ac.th". Both are imperative. The intent was true and useful — a
   non-kkumail account can never match `students.kkumail`, so ระบบบ้าน is empty
   for it — but the reader cannot see intent, only grammar. An outsider reading
   an instruction they cannot follow concludes the door is not theirs.
2. **The benefit clause made it worse, not better.** "…เพื่อให้เห็นข้อมูลสายรหัส
   บ้าน และตำแหน่งในทีม SAMO ของตัวเอง" was added to justify the steer, and it
   re-created the impression it was meant to soften: a list of things you get by
   using the KKU domains reads as the reason the KKU domains are required.
3. **The collapse hid a route AND broke a caller.** The form lived in a
   `.collapse` opened by a text link. `account-switch.js` `pickAccount()`
   prefills `#signinLoginUsername` and then calls `pInput.focus()` — and
   `.focus()` on a `display:none` input is a silent no-op. So switching back to
   a saved password account opened a modal that looked empty and inert, with the
   username invisibly prefilled inside a shut collapse.

Found while fixing the copy, not reported: `samoShowSigninScreen()` toggles a
`d-none` between the login and register screens and **nothing ever toggled it
back**. One visit to สมัครสมาชิก made register the permanent landing screen for
every later open — including the switcher path in (3), which prefills a form on
a screen that is no longer showing.

**Fix**: each line now names an AUDIENCE instead of stating a rule —
"สำหรับบุคคลทั่วไป และนักศึกษา/บุคลากร มข. (@kkumail.com หรือ @kku.ac.th)" over the
Google button, and "สำหรับผู้ที่ไม่ต้องการเปิดเผยตัวตน" over the password form,
which is what that route has always actually been (it was mislabelled "สำหรับ
บัญชีของฝ่ายงาน"). The domains survive as a parenthetical because KKU students
scan for them; nothing tells anyone which account to pick. The collapse is gone,
so both routes are visible and hierarchy is carried by button WEIGHT — filled
Google, outline password. The screen reset is one `hidden.bs.modal` listener in
`mountAccountSwitch()`, the only module BOTH entries import.

**Where it lives now**: `src/html/modal-signin.html`, `src/css/cards.css`
(`.signin-kku-hint`, `.signin-alt-caption`), `src/js/account-switch.js`.
Guarded by `src/js/signin-screen.test.js` — no collapse on the login screen, the
copy names บุคคลทั่วไป and never says "เลือกบัญชีที่ลงท้ายด้วย", and the reset
listener exists. Verified by reintroducing all three bugs and watching four
assertions fail.

**Rules**: (1) **A steer written in the imperative is a rule to the reader**,
whatever it was meant as. If a channel accepts everyone, the copy has to say who
it is FOR, not what to pick. (2) Justifying a steer with the benefits it unlocks
strengthens it — the benefit list is read as the reason for the restriction.
(3) **Hiding a legitimate route behind a disclosure widget is an API change**:
every caller that focuses, prefills, or scrolls to something inside it now acts
on a `display:none` node, and `.focus()` fails silently. (4) A screen toggle
with no reset is a mode the user cannot leave — pair every `d-none` flip that
survives a close with a reset on `hidden.bs.modal`.

---

## "เข้าสู่ระบบด้วย Google ... it also gmail.com email etc." — FOUR reports on one caption, because a DOMAIN LIST is read as a whitelist

**Symptom**: Four separate reports, months apart, all saying the Google button
looked KKU-only. Each rewrite answered the previous wording and kept the same
element — a parenthesised list of the two KKU domains — on the theory that KKU
students scan for it. The last version said, in words, that anyone could use it:
"ใช้ได้ทุกบัญชี Google ทั้ง Gmail ของบุคคลทั่วไป และอีเมล มข.
(@kkumail.com, @kku.ac.th)". The owner: *"this'll make normal people who glance
think @gmail.com cant sign in."*
**Cause**: **A list of addresses is read as the set of ACCEPTED addresses**,
whatever the sentence around it claims, because the literal domains are the only
scannable tokens on the line and they are both KKU. Report 3 had been about the
same thing one level up — those domains were the only BOLD text, so emphasis
contradicted the words it sat inside. Removing the bold left the list, and the
list was the mechanism all along.
Two accompanying misreads, same family: the signup link ("ยังไม่มีบัญชีชื่อ
ผู้ใช้?") never said the account was the ANONYMOUS one, so the single fact about
that route was absent where the choice was made; and the home page's sign-in
strip said "เข้าสู่ระบบเพื่อเข้าถึงเครื่องมือฝ่ายของคุณ … จัดการงานเจ้าหน้าที่",
framing the whole door as staff-only before the modal was ever opened.
**Fix**: the caption is GONE. The standard button carries no caption anywhere
else on the web, and a line that does not exist cannot be misread. The link text
names the route ("สร้างบัญชีแบบไม่เปิดเผยตัวตน"); the home strip names the
visitor.
**And the button was non-compliant, which is why the screen also felt
unfamiliar** — reported separately as *"the ui doesnt look familiar to the user
how they would see in other website, company, making them friction"*. Google's
branding guidelines allow light (#FFFFFF + #747775 stroke), dark (#131314) or
neutral (#F2F2F2) fills only, and require the standard four-colour G at its own
size on white; ours was brand-green with a monochrome Bootstrap glyph. It broke
both rules AND stopped reading as a Google button to someone who has signed in
elsewhere a hundred times. Compliance is required for app verification, so this
was never a style choice.
An intermediate pass had also boxed the anonymous route in a tinted panel with a
segmented control. It tested clean and was still wrong: it read as a second app
bolted under the divider. Reverted to the convention — social button, divider,
credentials, switch link at the bottom — which took the login screen from 659px
to 465px.
**Where**: `src/html/modal-signin.html` · `src/css/cards.css` (`.signin-*`) ·
`src/js/signin-modal.js` (new — the handlers had been VERBATIM in both `main.js`
and `admin-main.js`, reset in a third file) · `src/html/tab-home.html`.
Guard: `signin-screen.test.js` now fails if ANY email domain appears in the
modal, and pins the four G hexes.
**Also fixed in passing, not a wording problem**: the register form advertised
`minlength="4"` and "อย่างน้อย 4 ตัวอักษร" while `registerWithPassword()` rejects
under 6 — the form invited a password the code refused. The guard reads the
number out of `auth.js` now.
**And a fifth report, on the switch link**: "ยังไม่มีบัญชี? สร้างบัญชีแบบไม่
เปิดเผยตัวตน" — *"the people would think they have to สร้างบัญชีแบบไม่เปิดเผยตัวตน
when they first come to the web when they can use google account."* **The
question described a STATE every first-time visitor is in**, so all of them took
it as their line — including the ones who should just press Google, which
creates the account implicitly so they never sign up at all. Fixed by asking
about the WANT instead: "ไม่ต้องการเปิดเผยตัวตน? สร้างบัญชีด้วยชื่อผู้ใช้". A
Google user answers no and moves on; the person who wants it finds the route by
the words they were already looking for. `signin-screen.test.js` fails if
"ยังไม่มีบัญชี" returns.
**A sixth pass, on the button itself**: *"i want normal people to know that they
can login with google account immediately without having to register like the
anonymous."* "เข้าสู่ระบบด้วย Google" reads as *for people who already have an
account* — a newcomer does not know that signing in with Google CREATES theirs,
so they go hunting for a สมัคร link and land on the anonymous route. Now
"สร้างบัญชีและเข้าสู่ระบบด้วย Google" (Google's guidelines recommend Sign in /
Sign up / Continue and permit localization; the one-button-does-both case is what
"Continue with Google" exists for). Google's own Thai string is
"ลงชื่อเข้าใช้ด้วย Google" and is deliberately NOT used — this site says
เข้าสู่ระบบ everywhere, and a third verb for one action costs more than matching
Google's wording gains. The screen now uses ONE verb for creating an account
(สร้างบัญชี); it had been saying both สร้างบัญชี and สมัครสมาชิก, which a guard
now forbids. ⚠ The label is LONG: fine at 390px, but it WRAPPED at 320px until a
font step was added — and the first version of that step sat ABOVE
`.signin-google` in the file, so at equal specificity the base rule won and the
media query changed nothing while matching. Measured, not assumed.
**Two more from the same pass**: the modal header carried a PINK wash, because
`.modal-header` in `modals.css` paints EVERY modal `--pink-50` — pink is the PR
form's per-tab accent (CLAUDE.md), not global chrome, and the account switcher
had already opted out with a comment saying so. And the password reveal showed
an OPEN eye while the password was hidden (icon-as-action); the owner read it as
backwards, so the icon now shows the STATE (slashed while hidden) while the
`aria-label` keeps naming the action. A differential guard pins the markup's
initial icon to the input's initial `type`, because those live in two files.
**Rule**: when copy is reported as misleading and the words already say the right
thing, the claim is being made by something OTHER than the words — the emphasis,
the punctuation, the one concrete token in a sentence of abstractions. Ask what
a person who reads three words of it takes away. **A question addressed to a
state ("no account yet?") is answered YES by everyone new, so it recruits the
people it was not for; a question addressed to a want ("don't want to be
identified?") sorts them.** And before styling a third-party sign-in button, read that party's branding guidelines: familiarity
is the feature, and for Google it is also a verification requirement.

---

## "when i zoom, it renders some different view then switches back" — an auto-fit re-armed by the gesture

**Symptom**: reported by the owner while driving the 3D org-chart demo on a
phone: pinching to zoom made the view flicker to a different framing and snap
back. Reported a second time after the first fix, so **this one is still open**
— the write-up below is the half that was found, and
`docs/demos/about-3d/README.md` carries the remaining leads.

**Cause (the part that was real)**: the camera re-fit itself to the graph
whenever `fitted` was false, and a `ResizeObserver` set `fitted = false` on
every resize. On a phone a pinch **resizes the visual viewport**, so the gesture
re-armed the auto-fit on every frame of itself: the user zoomed, the fit yanked
the camera back to its computed distance, the user zoomed again. Two things were
each correct alone — "refit when the frame size changes" and "let the user
zoom" — and neither knew the other existed.

**Fix**: a `userZoomed` latch. The first manual zoom takes ownership of the
camera, and after that only an EXPLICIT action (entering fullscreen, switching
layout, focusing a ฝ่าย) is allowed to reframe; a bare resize only updates the
aspect ratio, the renderer size and the pixel ratio.

**Where it lives now**: `zoomBy()` and the `ResizeObserver` in
`docs/demos/about-3d/frameC.js` — a demo, not shipped app code.

**Rules**: (1) **A gesture that changes the viewport will re-trigger anything
keyed to viewport changes.** Pinch-zoom, the mobile URL bar collapsing, and the
on-screen keyboard all fire resize; none of them mean "the user wants their view
reset". (2) When automatic and manual control share one value, the manual one
must latch, and the list of things allowed to override it must be written down
as explicit actions — not "whenever it looks stale".

---

## A blank canvas is not a diagnosis — the graph had flown past the far plane

**Symptom**: the 3D frame rendered nothing at all. No exception, no console
warning, WebGL context alive and not lost, canvas the right size, every DOM
overlay in place. Just an empty stage.

**Cause**: two of them, and the second is the lesson. Each ฝ่าย had been given
an angular wedge, enforced by **hard-clamping** every node back inside its slice
each tick. But a hard positional clamp inside a relaxation loop is a ratchet:
cards squeezed together inside a narrow wedge could not relieve the pressure
sideways, so the only direction left was outward, every tick, forever. Measured
extent of the position buffer: **5,708 units** — while the camera's far plane
was 4,000. Everything was still being drawn, perfectly, entirely outside the
view frustum.

**Fix**: the wedge became a spring (rotate a fraction of the overshoot back,
damp the tangential velocity) plus a hard radius cap as a backstop, and the far
plane went to 20,000 so a future runaway is visible rather than invisible.

**Where it lives now**: the wedge block in `docs/demos/about-3d/frameC.js`.

**Rules**: (1) **"Nothing rendered" and "everything flew off screen" look
identical**, so never debug a blank viewport by looking at it — print the extent
of the data (`Math.max(...positions.map(Math.abs))`) and the camera distance.
One probe found this immediately; staring at the picture found nothing in
several attempts. (2) A hard constraint applied every tick inside a physics or
layout relaxation will convert pressure into drift along whatever axis you left
free. Constrain with a force, and cap the axis you left free.

---

## "the picture render wrong ... zoom also bug" — `srcset` resolves ONCE

**Symptom**: as reported, two things at once on the new ผังองค์กร view. The
portraits in the chart cards looked wrong at rest, and got visibly worse the
moment you zoomed in.

**Cause**: two independent causes wearing one report.

1. **The portrait was sized like an avatar, but the source photos are waist-up
   studio shots.** The card drew a 26px face. At 26px a head is about eight
   pixels: what you actually see is a torso and a shirt. The control was the
   OTHER views — รายการ renders the identical photo into a 136px box, where it
   reads as a person. 26px was never a resolution problem, it was a *crop*
   problem, and no amount of extra pixels would have fixed it.

2. **`srcset` is resolved once, from the element's CSS LAYOUT size — and zooming
   an SVG never changes that.** The chart lives on a `d3-zoom` canvas, so a card
   can be magnified several times over, but the transform only scales the
   painted result; layout is untouched, so the browser never re-runs candidate
   selection. Measured live: six zoom-in steps grew the portrait's box from
   26×35 to **125×167** while `naturalWidth` stayed **34** and `currentSrc`
   never changed — a bitmap stretched **3.7×** past its pixel data.

**Fix**: the portrait went to 44px so a face is legible, and the `srcset` hint
was made to buy the zoom headroom up front —

```
sizes = <portrait CSS width> × <max zoom>   =   44 × 3   =   132px
```

with candidates at 1×/2×/3× of that for DPR 1–3. **Both halves are required**:
the second only terminates because `scaleExtent` now caps zoom at 3. With the
library's default `[0.001, 20]` there is no source size that is ever enough.
A first attempt used `box × 2` and still measured 0.67× headroom at full zoom on
a retina screen.

**Where it lives now**: `GRAPH_SHAPE` in `src/js/org-face.js`, `ROW_H` and the
`.scaleExtent([0.3, 3])` call in `src/js/org-graph.js`, `.orgg-person` in
`src/css/org-graph.css`. `org-graph-metrics.test.js` asserts
`sizes >= faceWidth × maxZoom`, that candidates cover DPR 1–3, and that the zoom
cap exists at all — so raising the zoom without raising the request fails.

**Rules**: (1) **A responsive-image hint describes LAYOUT size, so it is blind to
any transform.** On a zoom/pan canvas, `sizes` must be the size at MAXIMUM zoom,
not the resting size — and that is only a finite number if the zoom is capped.
Uncapped zoom and responsive images are incompatible by construction. (2) When a
report says "wrong" AND "worse when I do X", suspect two causes, not one
cause with two symptoms — here the size was a design error and the blur was a
platform behaviour, and fixing either alone still looked broken. (3) **Reuse of
a shared element does not carry its sizing rationale.** `.org-face` was built
for a 130px card; dropping it into a 26px slot inherited the markup and threw
away the only reason the crop worked.


---

## "the picture on ipad still bug" — `position` in `<foreignObject>` drops the transform

**Symptom**: on iPad (and any WebKit), the portrait in a ผังองค์กร card was
painted at the **chart's top-left corner**, detached from its card, while the
card itself showed the person's name beside an empty slot. Chrome was perfect.

**Cause**: `.org-face` carries `position: relative` — it is the containing block
for the photo layered over the initials, which is right in the รายการ view where
it is ordinary HTML. Inside an SVG `<foreignObject>`, WebKit paints a
**positioned** element *without the ancestor SVG transform*, so it lands at the
untransformed origin. The `<g>` holding the chart is transformed, so the face
was drawn as if that transform did not exist.

Isolated on real WebKit with a minimal page — a `<g transform="translate(300,
200)">` over a `foreignObject`, flipping one property at a time and measuring
where the pixels actually landed:

```
overflow:hidden · aspect-ratio · display:grid · border-radius  →  312,214   ok
position:relative                                              →   12, 14   wrong
```

12,14 is 312−300, 214−200: displaced by exactly the transform. The `img`'s own
`position: absolute` was incidental — a first fix removed only that, and the bug
simply moved from the image to the whole face box.

**Fix**: nothing inside the foreignObject is positioned. `.orgg-person .org-face`
overrides back to `position: static`, and the photo/initials stack via
`grid-area` in one cell instead of absolute layering. Scoped to this view,
because it is the only one living inside an SVG.

**Where it lives now**: `.orgg-person .org-face` in `src/css/org-graph.css`,
guarded by `org-graph-metrics.test.js`.

**Rules**: (1) **`getBoundingClientRect()` cannot see a paint bug.** It returned
the CORRECT box in every variant, including the broken ones — layout was right,
only the compositing was wrong. No computed style and no DOM measurement could
detect this; the only instrument that could was decoding the screenshot and
finding where the pixels were. When a bug is visible but every measurement says
fine, measure the PIXELS. (2) **Reusing an HTML component inside SVG re-opens
every CSS assumption it was built on.** `.org-face` was correct for six months in
two views; the third view put it inside a `foreignObject` and `position:
relative` silently changed meaning. (3) The guard for this needed TWO corrections
before it worked — it first matched `.org-face-initials` as a substring of
`.org-face` and passed with the fix deleted, then swallowed the preceding comment
block into the selector and failed with the fix present. **Run the falsification;
a guard you have not seen fail is not a guard.**

## A DEPTH NUMBER cannot name a level of a ragged tree

**Symptom.** Nothing was reported as broken. The owner asked for a different
picture — "การแสดงบนหน้าเว็บเริ่มจากฝ่าย PR then draw line to 3: Role head PR,
Role 2 PR, Role 3 PR … Then next will show 2 lines to ฝ่าย media, creator" —
and building it exposed that the existing control could not express it.

**Cause.** The ผังองค์กร / ผังรวม "แสดงถึง" rungs were RAW DEPTH:
`d._expanded = d.depth <= level`, with the buttons labelled ฝ่าย / หัวหน้าฝ่าย /
ทีมย่อย. That labelling is only true if every branch has the same shape, and
this tree does not. Measured on the live 298 nodes, depth 2 is:

| branch | depth 2 |
|---|---|
| สำนักนายกฯ | `หัวหน้าฝ่ายเลขาฯนายกฯ` — a head ✅ |
| ฝ่ายดิจิทัล | `ฝ่าย PR` — a ฝ่าย, one rung short ❌ |
| ฝ่ายบริหารองค์กร | `หัวหน้าฝ่ายเอกสาร` … and `สมาชิกฝ่ายตรวจเอกสาร` beside it |

So ONE number was simultaneously right and wrong depending on where you looked,
and the button's label was accurate for part of the screen only. This is the
same family as the `<` / `<=` off-by-one that shipped in the same control weeks
earlier — that one was fixable by changing an operator; this one was not,
because the levels genuinely do not line up.

**Fix.** Define the rungs on what a node **IS**, not how deep it sits:
`ฝ่ายหลัก` (root ฝ่าย) → `ฝ่ายย่อย` (every ฝ่าย) → `ตำแหน่ง` (every ฝ่าย plus the
seats it holds directly) → `ทั้งหมด`. In ฝ่ายดิจิทัล the ตำแหน่ง rung reaches
four levels down and in สำนักนายกฯ two, which is the point. This required the
`kind` vocabulary to be unambiguous first — the tree carried a third value,
`department`, on 78 of 298 nodes, all of them containers (0151 folded it into
`division`; `src/js/node-kind.js` still reads it leniently).

Two things a depth predicate gave for free and a kind predicate does not, both
now asserted:

- **Ancestor closure.** `depth <= n` implies every ancestor passes; "every ฝ่าย"
  does not. `ฝ่าย Media management` hangs off `หัวหน้าฝ่าย PR`, a ตำแหน่ง, so the
  ฝ่าย rungs must drag that seat in or d3 draws a line to a box that is not
  there. `applyRung` walks up explicitly.
- **Nesting.** Pressing a deeper rung must never REMOVE a box. Asserted as a
  superset check across the whole ladder.

**Where it lives now.** `src/js/org-rung.js` — a pure module holding both rules
that `kind` decides (sibling order and the rungs), so all four views obey one
copy. Guarded by `org-rung.test.js`, which runs the predicate over a fixture
shaped like the live tree instead of reading the source for an operator; the
old guard could only ever check that `<=` was the right way round.
`node-kind.test.js` keeps the vocabulary at two.

**The general rule.** *A control's LABEL is a claim about every branch it
applies to.* Before naming a rung after a thing ("หัวหน้าฝ่าย", "ทีมย่อย"), check
that the thing is at the same coordinate everywhere — and if it is not, express
the rung in whatever the data actually distinguishes, even if that means giving
the data a distinction it did not reliably carry.


## "It shows 4 lines to อุปนายก, ฝ่าย PR, ComArt, IT" — ORDER was not the problem, RANK was

**Symptom.** Reported twice. First: "Navigate to role at that level first, then
ฝ่าย will be under it." That was read as an ORDERING request and shipped as a
stable sort putting ตำแหน่ง before ฝ่าย among siblings. The owner came back with
the concrete case: *"currently on ผังรวม it shows ฝ่ายดิจิทัลและสื่อสารองค์กร
then 4 lines showing all อุปนายกฝ่ายดิจิทัล, ฝ่าย PR, ฝ่าย ComArt, ฝ่าย IT. It
should be … then ONE line to อุปนายกฝ่ายดิจิทัล then THREE lines to ฝ่าย PR,
ComArt, IT."* Then a third time, to be sure: *"after the ฝ่าย head, it should
run through roles first, then put all sub ฝ่าย as one step down not siblings to
the roles."*

**Cause.** The chart drew `team_nodes.parent_id` literally. Stored, a ฝ่าย's
head seat and its sub-ฝ่าย are all children of the ฝ่าย row, so d3 put them on
ONE RANK — four lines fanning out of the same box. That is the chart asserting
they are peers. They are not: the อุปนายก heads the ฝ่าย and the three sub-ฝ่าย
report to them. Reordering left-to-right cannot fix a wrong rank, which is why
the first fix looked like it did nothing.

The reading error is the reusable part. "role first, then ฝ่าย under it" is
ambiguous between sequence and depth, and the first reading was picked because
it was the cheaper change. **"under" from someone describing a drawing means
BELOW, not AFTER.**

**Fix.** `chartParentage()` — a DISPLAY parentage computed over the projection
on the way to all four public views. For a ฝ่าย holding both seats and
sub-ฝ่าย: the seats stay its children, the sub-ฝ่าย become children of the
FIRST seat. First = `position` 0 = the head, which the tree already ranks and
which the equal-sized cards already rely on — so no list of Thai title prefixes
to rot.

It does NOT apply when the parent is a ตำแหน่ง: หัวหน้าฝ่าย PR holds a seat and
ฝ่าย Media management, and pushing the ฝ่าย under หัวหน้าฝ่าย Content creator
would invent a reporting line nobody drew. Those stay siblings, seats first.
`team_nodes.parent_id` is untouched and the admin tree still shows what is
stored.

**Where it lives now.** `src/js/org-rung.js`, applied once in `org-chart.js`'s
`index()` so all four views read the same structure — including the SEARCH,
whose `parentOf` map now derives from `byParent` instead of `chart.nodes`. Built
from the stored parent map it would have kept an ancestor the chart no longer
draws a line to, leaving a filtered result hanging off nothing. Guarded by
`org-rung.test.js`.

**The general rule.** *A tree drawn as a chart makes a claim the stored tree
does not: that everything on one rank is peer to everything else on it.* When a
storage parent and a reporting parent differ, the drawing needs its own
parentage — and when someone describes what they want in terms of LINES and
what is UNDER what, they are describing rank, not sequence.

## "ฝ่ายวิชาการ inside ฝ่ายรังสีเทคนิค shows different color" — a GUESS beat inheritance

**Symptom.** As reported. A sub-ฝ่าย named `ฝ่ายวิชาการ`, nested inside
`ฝ่ายรังสีเทคนิค`, rendered in ฝ่ายวิชาการ's blue instead of its parent
branch's brown — in the admin tree and in รายการ/แผนผัง.

**Cause.** A ฝ่าย's colour has two sources: one the admin CHOSE
(`team_nodes.color`, 0152) and one DERIVED by matching the name against a regex
table. `tintColor()` was called on EVERY node, so the derived half fired at
every depth. `/วิชาการ/` matches `ฝ่ายวิชาการ` wherever it sits, and the match
overrode the `--node-tint` the node would otherwise have inherited from its
root.

The derived answer is a GUESS standing in for an identity nobody recorded. That
is defensible at a root, where there is nothing to inherit. Inside a branch
there always is, so the guess must lose.

**Why it survived.** Measured on the live tree: **29 non-root nodes match the
palette by name, and 27 of them match the SAME colour as their own root by
coincidence** — `อุปนายกฝ่ายบริหารองค์กร` contains `บริหารองค์กร`,
`อุปนายกฝ่ายเวชนิทัศน์` contains `เวชนิทัศน์`. They painted the right answer for
the wrong reason. Only the two where the coincidence broke — `ฝ่ายวิชาการ` under
`ฝ่ายรังสีเทคนิค` and under `ฝ่ายเวชนิทัศน์` — were visible, so 27 of the 29
instances were invisible evidence that the mechanism was sound.

**Fix.** `tintColor(node, isRoot)`: a CHOSEN colour is honoured at any depth (a
human typed it about that node); a DERIVED one only at a root. `isRoot`
**defaults to false**, so a caller that forgets the argument inherits — the safe
answer — rather than guessing.

**Where it lives now.** `src/js/dept-tint.js`, one resolver for the admin tree
and both public renderers. `dept-tint.test.js` asserts the non-root case with
the reported subject AND one of the coincidental ones, and separately that all
three call sites still pass the flag — a bare `tintColor(node)` is exactly how
this would come back.

**The general rule.** *A derived value and an inherited one are not
interchangeable defaults: derivation is only correct where inheritance has
nothing to offer.* And when a heuristic is right most of the time BY
COINCIDENCE, its successes are not evidence — count how many of them would have
been right anyway.

## แผนผัง became a staircase — one structure, two different drawings

**Symptom.** Not reported by anyone; found by rendering a view the change had
never been rendered in. After sub-ฝ่าย were re-parented onto their ฝ่าย's head
seat, แผนผัง — the CSS chart — stopped being a chart. It descended as a
one-node-wide diagonal ribbon down the middle of an otherwise empty page.

**Measured, same data, same viewport, only the parentage swapped:**

| | before | after |
|---|---|---|
| แผนผัง page height | 25,847 px | **52,163 px** |
| ฝ่ายดิจิทัล section | 1,627 px | **4,265 px** |
| max node depth | 5 | **9** |
| single-child branches | 25 / 97 | 43 / 122 |

รายการ's page height was unchanged (3,723 px) **only because it opens
collapsed** — its depth moved 5 → 9 too, so expanded it ran four levels deeper
than the admin tree it mirrors.

**Cause.** `chartParentage()` was applied to the shared `byParent` index, so all
four views got it. แผนผัง's entire design is "a ฝ่าย branches SIDEWAYS once";
re-parenting leaves nearly every ฝ่าย with a single child, so nothing branches
and every level is one more step down the staircase.

The reasoning that produced it was the trap. "One structure, so the views cannot
drift" is normally right in this repo — class 6 is its most expensive class. But
these are not two implementations of one rule. **รายการ and แผนผัง draw
CONTAINMENT** (what is inside ฝ่าย IT); **ผังองค์กร and ผังรวม draw REPORTING**
(who answers to whom). Two drawings of one dataset, and the difference is the
product decision, not drift.

**Fix.** Two parentages, named as such: `byParent` (stored, what the CSS views
read) and `byParentChart` (`chartParentage`, what the canvas views read).
`indexStats()` became a function OF a map and runs twice — a head seat's
"ใต้สังกัด …" on the canvas must count the sub-ฝ่าย hanging off it, while the
same seat in รายการ must not claim them.

The search needed a third piece. `computeFilter` walks the stored parents, which
is right for the CSS views; on the canvas, ฝ่าย PR's parent is the อุปนายก — a
stored SIBLING — so a search for "PR" kept ฝ่าย PR without keeping the box its
line is drawn from, and `flatten`, which descends from the root and stops at the
first node the filter does not keep, dropped the whole branch. `chartFilter()`
widens the kept set to the canvas's own ancestors, in the canvas only, so
รายการ does not start listing a head seat nobody searched for.

**Where it lives now.** `src/js/org-chart.js` — the two maps are declared
together under a comment carrying these measurements. Verified by re-measuring:
แผนผัง returned to 25,847 / 1,627 / depth 5, identical to before.

**The general rule.** *"One implementation so they cannot drift" is only a
virtue when the two callers actually want the same answer.* Before unifying,
name what each caller is drawing. And: **a change is not verified in a view you
did not open** — three of the four views were rendered and inspected here, and
the fourth was the one that broke.

---

## จองโควตา Claude rendered unstyled — CSS in the wrong ENTRY

**Symptom.** A screenshot of the new จองโควตา Claude pane, minutes after it was
deployed: the sidebar entry, the title, the week label, the 700% pool and the
"= อีก 7.0 เซสชัน" readout all correct — and everything below them stacked down
the left edge as plain text. Day names, day numbers, the week-scale digits
(`01234567` on one line) and all 24 hour labels, one per line, no grid, no
columns, no calendar.

**Cause.** `src/css/claude.css` was imported by `src/main.css`. The pane lives in
`admin/index.html`, which loads `src/admin.css`. This repo builds **two SPA
entries from one tree** (public `/` and admin `/admin/`), each with its own CSS
root, so the stylesheet was compiled into the bundle the page does not download
and was absent from the one it does. Nothing failed: the build was clean, the
tests were green, the markup was right, the data was right, and the deploy
verified. The rules simply never loaded.

Two things made it invisible. **CSS fails silently** — no error, no failed
request, no console warning — and this repo already has the entry for that
(*"a class in the markup with no rule in any stylesheet is invisible in review
and looks exactly like a broken value"*). And the failure mode is
indistinguishable from never having written the layout, so a reviewer reading
the diff sees a complete stylesheet and a complete partial and no defect.

It is also, exactly, class 4 wearing new clothes: *a fix on one path is not a
fix*. The path enumerated here was "add the import to the CSS entry", and there
are two CSS entries.

**Fix.** Moved the `@import` to `src/admin.css` and **removed** it from
`src/main.css` — the pane is admin-only, so the public bundle was carrying 6 kB
of rules nothing could ever match. Then the mechanism: `src/css-entry.test.js`
asserts (a) every file in `src/css/` is imported by at least one entry, so an
orphan stylesheet cannot exist, and (b) for each admin-only pane, its stylesheet
is in `admin.css` and *not* in `main.css`. The second check asserts its own
premise first — that the partial really is absent from `index.html` — so if a
pane later becomes public the test reports a stale pairing instead of quietly
enforcing it.

**Where it lives now.** `src/admin.css` (the import, with a comment saying why it
must not also be in `main.css`), `src/css-entry.test.js` (35 cases). Falsified by
putting the import back in `main.css`: the paired assertion goes red.

**The general rule.** *An `@import` is a path, and this repo has two of them.*
When a feature is scoped to one entry, every layer it needs — module, partial,
stylesheet — has to be added on that entry's side, and "it built and the tests
passed" cannot tell you it was. **Render the view you changed.** The org-chart
session paid for that sentence a day earlier and it was true again here: this
pane was verified by build, tests, a live RPC probe and a 20/20 SQL proof, and
was never once looked at.

## "on ipad, when touch, it mess up between scroll and adding the booking"

**Symptom.** On an iPad, จองโควตา Claude was unusable: touching the calendar to
scroll the week would open the booking modal instead. The owner also reported,
separately and confusingly, *"when i click arrow next to สัปดาห์นี้ on my ipad
it shows my profile"* — tapping the week arrow at the TOP of the pane opened a
dialog showing their name and ตำแหน่ง.

**Cause.** Two failures of one design. `pointerdown` on a day column started a
drag-selection, which is right for a mouse and wrong for a finger, because every
scroll of a 24-hour × 8-day grid begins with exactly that event.

1. A plain TAP booked. `paintSel()` floors a selection at one slot
   (`if (b - a < SLOT_MIN) b = a + SLOT_MIN`), so even a zero-distance press
   produced a bookable 15 minutes and `onDragEnd` opened the modal.
2. The "shows my profile" report was the same drag, one step later. When the
   browser takes a gesture over to scroll it fires `pointercancel` — and nothing
   listened for it, so `drag` stayed set. `pointerup` is bound to `window` by
   necessity (a drag may end outside the column), so the NEXT tap anywhere in
   the pane ran `onDragEnd` with the stale state. "My profile" was the booking
   modal's identity card, which is the first thing visible in it on a tablet.

**Fix.** A finger must HOLD before it is selecting — holding still is the one
thing a scroll gesture never does, so it is what separates them. `gesture.js`
decides per `pointerType` (`mouse` → drag immediately, `touch`/`pen` → hold
400 ms within a 12 px slop). A hold produces a 60-minute block, so the gesture
is complete without dragging. `pointercancel` AND `touchcancel` clear both the
pending hold and any live drag.

Scrolling is suppressed only while a touch-initiated selection is live, via a
`{ passive: false }` `touchmove` listener that calls `preventDefault()` — **not**
`touch-action: none`, which is already an entry in this file (it makes the
surface unscrollable). The ordering is what makes it work: the hold fires only
while the finger is still, so no scroll has begun yet, and a scroll that has not
begun can still be refused.

**Where it lives now.** `src/js/claude/gesture.js` (pure, unit-tested),
`onDragStart`/`onDragMove`/`onDragCancel`/`onTouchMove` in
`src/js/claude/index.js`. Guarded by `src/js/claude/gesture.test.js` §A/§B, and
driven end-to-end on an emulated iPad with real touch events
(`skills/drive-the-browser.md`): tap → no modal, hold → modal, scroll → no
modal, arrow-tap-after-scroll → no modal.

**The general rule.** *On a scroll surface, `pointerdown` is not an intent — it
is the start of every gesture the surface supports.* And a handler that arms
state on `pointerdown` must handle `pointercancel`, or the state outlives the
gesture and fires from somewhere the user was not even touching.

Two things the falsification run taught, both worth more than the fix:

- **Removing the `pointercancel` listener did NOT reproduce the bug** once the
  hold gate existed — a scroll never arms a drag any more, so the listener is
  unreachable by that path. The case that reaches it is a hold that ARMS and is
  then cancelled. A falsification that does not go red may mean the guard is
  wrong, or it may mean the path is already closed; you cannot tell without
  writing the case that reaches it.
- **CDP's `Input.dispatchTouchEvent{type:'touchCancel'}` dispatches no DOM
  events at all** in headless Chrome. The instrument could not see the hazard
  (`skills/write-a-guard.md`); the test now dispatches a real `PointerEvent`.

## "in the next week it shows ยังไม่มีตำแหน่งในผังทีม" — identity from a row on screen

**Symptom.** In the current week the booking modal named the owner correctly —
ภูริพัฒณ์ มหาพรหมรักษ์, ฝ่าย IT, หัวหน้า IT. Press ▸ to next week and book
there, and the same modal showed the raw account name and
"ยังไม่มีตำแหน่งในผังทีม".

**Cause.** `paintIdCard()` resolved who the reader is with
`board.bookings.find((b) => b.is_mine)` — i.e. by hunting for a booking of
theirs among the rows for the week being displayed. The board RPC filters
bookings to one quota week, so in any week you had not booked in, the lookup
found nothing and fell through to `getUser()`, which knows only the auth
account. The identity was correct exactly when you had already booked, and
wrong every other time.

**Fix.** The projection that builds a booking's `person` became its own function
(`claude_person(uuid)`, migration 0155) and `get_claude_board()` now returns
`me` built from it. One projection serves the reader and everyone else, so they
cannot drift. `board.me` is used only when it carries a name — an account with
no ตำแหน่ง projects to a null name, and letting that displace the account's own
name would replace one wrong label with another.

**Where it lives now.** `claude_person()` and `get_claude_board()` in
`supabase/migrations/0155_claude_measured_usage_log.sql`; `paintIdCard()` in
`src/js/claude/index.js`. Guarded by `gesture.test.js` §C.

**The general rule.** *An identity must never be derived from a row that
happened to be in the current query's result set.* The filter that makes a list
correct — a week, a department, a status — is not a filter anyone applied to the
question "who am I", and the fallback hides it: it looks right in exactly the
case you tested in.

## "the rails it got overlap with the booking making it look weird"

**Symptom.** The capacity rail down the left of each day drew into the session
frame and beside the booking block, so any day with a booking showed three
adjacent vertical stripes, and the "ว่าง 100%" label sat on the block's edge.

**Cause.** Three absolutely-positioned things claiming the same 10 pixels and
nobody owning the layout: `.claude-free` at `left: 0; width: 6px`,
`.claude-session` at `left: 2px`, and `.claude-bk` at `left: 9px` with a 3px
coloured left border. Each was written against the column, none against the
others.

**Fix.** The day column now declares the lane —
`--claude-rail-x` / `--claude-rail-w` / `--claude-lane` — the rail draws inside
it over a faint track, and the frame, the block and the drag selection all
start at `var(--claude-lane)`. The label moved beside the lane (100% does not
fit in 11px and overflowed looking broken) and `paintGrid()` skips it where a
block occupies the same minutes.

**Where it lives now.** `.claude-daycol` in `src/css/claude.css`; the
`occupied`/`clash` check in `paintGrid()`.

**The general rule.** *When several absolutely-positioned layers share a
column, one of them has to own the geometry and the rest have to be expressed
in terms of it.* Independent pixel offsets agree until one changes.

**And the instrument matters.** Reading the stylesheet says the rail (0–6px) and
the block (9px+) do not overlap, which is true — the actual collision was rail
against SESSION FRAME. Only measuring the painted boxes named it:

```js
const hit = (a,b) => a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t;
```

over every `.claude-free` × `.claude-bk` / `.claude-session` pair, with a
control asserting all three kinds are actually on screen. "It looks weird" is a
geometry claim; answer it with geometry.

## "why there's 50% rails in the period that has people book" — a right number answering the wrong question

**Symptom.** The capacity rail drew "50%" down the side of a block somebody had
booked 08:00–13:00. The rail's stated meaning is *free to use without booking*.

**Cause.** Not arithmetic. `claude_free_now(t)` for a `t` inside their block is
genuinely 50 — a session begun then shares theirs, and 50 is what they left. The
rail asked "how much could I take starting here" over a stretch where the right
answer is "nothing, this is theirs". A correct number, in a place where the
question does not apply, reading as an invitation to do the exact thing the
booking exists to prevent.

**Fix.** The rail is carved against the booked spans in the same column and each
booked stretch draws a distinct hatched "held" state with no number. That time
already carries two better statements: the block says who holds it, and the
session frame's tag says how much of that session is left.

Deliberately not red — red in this lane already means "no quota left at all",
which is a different and much more alarming fact than "somebody booked this".

**Where it lives now.** `carve()` and the `is-held` pass in `paintGrid()`,
`src/js/claude/index.js`; `.claude-free.is-held` in `src/css/claude.css`.

**The general rule.** *A readout is only correct where its question applies.*
Before believing a number, check that the sentence the UI puts around it is true
at every point it is drawn — the arithmetic can be right everywhere while the
sentence is false in half the places it appears.

## "พอดีจอ" collapsed the calendar to its minimum row height

**Symptom.** A "fit the whole day on screen" toggle worked when clicked, and was
wrong on the next page load — the grid came back at the 16px floor, the shortest
hour row the CSS allows, with the card mostly white space. Clicking the toggle
off and on again fixed it until the next reload.

**Cause.** The handler sized the content from its own container:

```js
const usable = scroller.clientHeight - headH;      // ← the loop
tab.style.setProperty('--claude-hour-h', `${usable / 24}px`);
```

The scroller is `max-height: 620px` with `overflow: auto`, so while the content is
SHORTER than the cap its `clientHeight` **is the content height**. Shrink the
rows, the container shrinks with them, the next pass reads the smaller number and
shrinks again. On a fresh load — where the toggle is applied before the content
has ever been tall — it ran straight to the floor. Clicking off restored the
default hour height, which made the content tall enough to hit the cap, so
clicking on again read the real 620 and looked correct.

**Fix.** Measure the CAP, not the container:
`parseFloat(getComputedStyle(scroller).maxHeight)`. It is a fixed quantity, it is
where the mobile breakpoint already lives (480px), and it breaks the loop.

**Where it lives now.** `applyFit()` in `src/js/claude/index.js`.

**The general rule.** *Never measure a container to size the content that
determines the container's size.* `overflow: auto` + `max-height` is a
shrink-to-fit box until the cap is reached, so `clientHeight` is an OUTPUT of the
content, not a constraint on it. Read the constraint itself. The tell is a bug
that fixes itself when you toggle it twice — that is a feedback loop finding a
fixed point, not a race.

## An inline `<b>` rendered as a second heading

**Symptom.** In the ข้อตกลง list, "กด **ยกเลิกการจอง** ให้คนอื่นด้วย" broke into
three lines with the bold phrase alone in the middle, reading like a heading for
a rule that did not exist. Invisible in the markup, invisible in review, obvious
in the first screenshot.

**Cause.** `.claude-terms-list b { display: block; font-size: 0.96rem; }` was
written for the rule's headline, which is a direct child of the `<li>`. A
descendant selector is a claim about EVERYTHING underneath it, so it also caught
every inline `<b>` inside the explanation `<span>`.

**Fix.** `.claude-terms-list > li > b` for the headline; a separate rule for
`span b` that only sets colour.

**Where it lives now.** `src/css/claude.css`, the ข้อตกลง section. Guarded by the
`inline <b> stays inline` browser probe, which asserts the COMPUTED `display`
rather than the stylesheet.

**The general rule.** *A descendant selector styles content you have not written
yet.* When a rule is meant for a structural position, say the position (`>`).
This is the same class as the markup refactor that unhooked every
`> .org-station` selector, from the other direction: there the child combinator
was too narrow, here the descendant one was too wide. Both fail SILENTLY, and
both are only visible in the render.

## A confirm dialog offered two buttons that both began with "ยกเลิก"

**Symptom.** Renaming ลบการจอง → ยกเลิกการจอง put the dialog's confirming button
one word away from its dismissing one: **ยกเลิก** (back out) beside **ยกเลิกการจอง**
(do it). Both correct in isolation; together, a coin flip on a destructive action.

**Cause.** `askConfirm()`'s "no" button is a hardcoded, shared `ยกเลิก` — it is
the same component every delete in the app uses. The caller only chooses the
`yes` label, so a caller whose ACTION is itself a cancellation collides with it.

**Fix.** The action shares no word with the dismissal and says what happens:
`ใช่ คืนช่วงเวลานี้`. The button in the modal FOOTER still reads ยกเลิกการจอง,
which is what was asked for — the collision only exists inside the dialog.

**Where it lives now.** `removeBooking()` in `src/js/claude/index.js`; guarded by
`window-share.test.js` §G, which asserts the `yes` label does not START with the
same word as the shared dismissal rather than pinning one exact string.

**The general rule.** *A button label is only unambiguous next to the other
buttons.* Any confirm whose ACTION is a cancellation, an undo, a revert or a
"no" will collide with a generic dismiss label, and the collision is invisible in
the source because the two strings live in different files. Read the rendered
dialog.

## "i see something weird in the box booking behind" + "10:00100%" — one narrow column, three collisions

**Symptom.** From a phone, on the จองโควตา Claude calendar: a booking block
printed `10:00100%` with the two runs of text on top of each other, and an empty
pale card hung underneath the block with nothing in it. Turning the ใช้จริง
overlay on made it worse — times clipped mid-digit (`01:0`) and the whole column
read, in the owner's words, as a mess.

**Cause.** Three separate failures that only appear once a column is narrow, and
the pane had only ever been opened on a laptop.

1. **An absolutely positioned tag over free-flowing text.** `.claude-bk-p` sat at
   `top: 2px; right: 4px` and the time was a normal line. At a 66px head the
   time wrapped — underneath the tag, which is not in the flow and therefore
   reserves nothing. Wide enough, no overlap; narrow enough, guaranteed overlap.
2. **A frame with the same visual weight as a card.** The 5-hour session frame
   was a rounded, filled, bordered rectangle. A window opens at a booking's
   start and runs five hours, so the frame is usually TALLER than the block that
   opened it — and the part hanging below read as an empty second booking.
3. **A lane taken out of the content instead of added to the layout.** The
   ใช้จริง overlay reserved 30px down the right of each day but the grid's
   `min-width` did not change, so the 30px came out of the booking's width.

**Fix.** (1) time and percentage in one flex row — they cannot overlap at any
width, and the time ellipsises instead. (2) The frame is a BRACKET: a left rail
with a cap at each end, no fill, no radius; it cannot be mistaken for a card.
(3) `min-width` rises with the overlay, so the lane is added rather than taken.

Two things the fix then taught, both measured:

- **The end time cannot be drawn as text at any width.** "10:00–11:45" wants
  77px and the percentage another 34px, against a 96px head on a DESKTOP column.
  There is no width that fits both without a 1300px grid to scroll sideways
  through on a phone. So the end goes: the block's HEIGHT is its duration and
  its bottom edge is its end, which is what every calendar people already use
  does with a compact event. The full range stays in the tooltip and the modal.
- **A one-pixel shortfall does not render as a tight line, it renders as `0…`**
  — the ellipsis needs room of its own, so it eats a whole character. "It fits"
  has to mean "with headroom", especially when the content varies ("100%" is
  wider than "5%").

**Where it lives now.** `.claude-bk-head` / `.claude-session` / `.is-hist` in
`src/css/claude.css`; the block markup in `paintGrid()`. The instrument is a
browser probe that reports `scrollWidth - clientWidth` per block across five
configurations (phone/iPad/desktop × overlay on/off) — zero is the assertion.

**The general rule.** *A layout is only correct at the widths it has been
rendered at.* Every one of these three is invisible in the stylesheet, invisible
in a unit test, and obvious in the first phone screenshot. And when text and a
number must share a line, put them in the same FLOW — an absolutely positioned
label reserves nothing, so it is a collision waiting for a narrow viewport.

## A tag positioned where the thing it describes always covers it

**Symptom.** A "เหลือ N% · ถึง HH:MM" chip was added to the 5-hour session frame
— the number the owner had asked to be able to read off the rectangle — and it
never appeared on screen once.

**Cause.** It was placed at the frame's top-right. But a window OPENS at a
booking's start, by definition, so the frame's top is *always* covered by the
block that opened it, and the block is a higher z-index with an opaque
background. The tag was correct, rendered, and behind something in every real
case. A screenshot showed it missing; nothing else would have.

**Fix.** Move it to the frame's BOTTOM, which is the tail — the part of the
window nobody has claimed yet. That is also the part the tag is *about*, so the
position now carries meaning instead of fighting for space.

**Where it lives now.** `.claude-session-tag` in `src/css/claude.css`, placed by
`paintGrid()`.

**The general rule.** *Before positioning a label, ask what is always at that
position.* Anything anchored to a container whose contents are generated —
"top-right of the frame", "start of the range", "the first row" — has a
neighbour by construction, and the geometry that makes the container exist is
usually the geometry that fills that corner.

---

## "it shows only 16.00 not 16.00-21:00" — the end time was dropped at every width, on a measurement taken against the wrong breakpoint

**Symptom.** Two asks in one message: *"The booking in calendar should show time
when to when, currently it shows only 16.00 not 16.00-21:00, with name, no need
for reason why booking."*

**Cause.** `.claude-bk-t2` carried `display: none` unconditionally, and the
comment above it recorded the measurement that put it there: `"10:00–11:45"`
wants 77px and `"100%"` another 34, against a 96px head. Both numbers were
right. The conclusion was not — it assumed the two had to share a ROW. Given a
line of its own the range fits at every width the grid produces.

The reason was on the block because there was nothing else on that line; it was
also the thing pushing the name into an ellipsis, and it is never the question
somebody scanning a week is asking.

**Fix.** Three height tiers, chosen in JS from the block's MEASURED height
(`bookingLayout()` in `claude/week.js`) rather than by a media query, because the
constraint is the block's height — duration × `--claude-hour-h` — and that
variable moves with "พอดีจอ", the mobile breakpoint and a tablet rotation. A
stylesheet cannot ask how tall an element is. `full` and `tight` stack the range
over `name + %`; `micro` (under 28px, a 15-minute block) stacks range over `%`
and sends the name to the tooltip. The range survives every tier.

⚠️ **THE MEDIA QUERIES WERE ON THE WRONG NUMBER, AND HAD BEEN ALL ALONG.** They
said `max-width: 767.98px`. But `.claude-cal-grid` has `min-width: 940px` and
the calendar SCROLLS SIDEWAYS rather than squeezing its columns — so a day
column is ~112px and a booking card ~81px at EVERY viewport below 940. An iPad
at 834px got the desktop font in a phone-sized card. Measured in the browser:
`"16:00–21:00"` overflowed by 11px and `"ว่าง 25% · ถึง 21:00"` by 28px, neither
visible in the stylesheet. The breakpoint is now 939.98.

⚠️ **A first version of `micro` put the range and the percentage in one flex
row** — 86px of content in a 71px card. Two short lines fit where one long one
does not.

**Where it lives now.** `bookingLayout()` in `src/js/claude/week.js` (pure, with
a MONOTONE property test: a taller block may never get a poorer layout), the
`.claude-bk.is-full/.is-tight/.is-micro` rules in `src/css/claude.css`.

**The general rule.** *The breakpoint belongs on the quantity that actually
constrains the text, and on this grid that is the COLUMN, not the viewport.* A
container with a `min-width` that scrolls decouples the two completely, and a
viewport media query on such a layout is a guess that happens to be right on one
device. Assert `scrollWidth - clientWidth === 0` per element in a real browser at
390 / 834 / 1440 — and check first that the stylesheet under test is even
loaded, since `claude.css` is `@import`ed by `src/admin.css` and a harness
pointed at `src/main.css` renders the pane unstyled and reports zero overflow.

---

## The 5-hour frame described the window; people were asking what they could put in it

**Symptom.** *"like i book 16.00-19.00 for 75%, it should show being dash box
(three sides) for 25% that can be filled … and if like people book 100%
16.00-19.00 just show the dashline as red but if that person book any% like 70%
100% full 5 hours, you dont need to show dash line because no one would be able
to fill in during that period."*

**Cause.** The session bracket framed the WHOLE 5-hour window — blocks included
— and hung a tag off the bottom reading "เหลือ 25%". It was an accurate
description of a rectangle. The question people bring to a calendar is *can I
put something HERE, and how much?*, and answering it off that mark required
knowing that the window is five hours, that the block inside it is three, and
subtracting. It was also drawn over windows where the answer is "nothing, ever",
because a booking filling all five hours leaves quota with no time to spend it
in.

**Fix.** Draw the mark over exactly what is still fillable: the window's time
MINUS every booking in it, and only when that stretch has both free TIME and
free PERCENT. Both halves are load-bearing — 3h at 75% leaves 2h and 25%, 3h at
100% leaves 2h and nothing (red), 5h at 70% leaves 30% and no time at all
(nothing drawn). A dashed outline, open at the top: a window is OPENED by a
booking, so a gap always hangs off the bottom of one, and the open edge says
"the rest of that block's pot" rather than "a second, empty thing" — which is
exactly how the old filled frame was misread once already ("something weird in
the box booking behind").

The capacity rail is no longer drawn inside a window either. Its question is
"start here and take this much WITHOUT booking", and inside a window the block
and the dashed box already answer it; a third mark saying the same number two
pixels away is what the owner was reading as wrong.

**Where it lives now.** `gaps` / `.claude-gap` in `src/js/claude/paintGrid()`
and `src/css/claude.css`; `carve()` in `claude/week.js`, now shared with the
rail instead of being a closure serving one caller.

**The general rule.** *Draw the answer, not the object.* A mark whose geometry
IS the answer needs no caption and cannot be read off by the wrong arithmetic;
a mark that describes a container makes every reader do the subtraction, and
some of them will do it wrong. The test for whether a mark has earned its place
is whether there is a case where it should not appear at all — if there is none,
it is decoration.

---

## "ใช้จริง" drew the gauge reading instead of the usage — the integral where the derivative was wanted

**Symptom.** Two reports, months apart, about the same overlay: first *"i don't
understand ใช้จริง overlay that shows 93% 97% etc"*, then a full specification
of what it should have been: *"if actual people use at 10.07, your last detect
at 10.00 found nothing, 10.15 found 3% … show it as 10.07-10.15 as 3% instead …
then 10.23 till 10.45 they don't use any … so you'd display 10.07-10.30 7%,
10:45-11.00 3%"*.

**Cause.** One bar per 15-minute sample, its WIDTH the CUMULATIVE five-hour
reading. Read top to bottom that is the integral — a staircase climbing to 97%
and sawtoothing back — and it answers "what did the gauge say at 12:15", which
is not a question anyone brings to a calendar. The question is *when was it
being used, and how much went in then*: the DERIVATIVE.

**The thing that made it fixable was already in every sample and unused.**
`five_hour.resets_at` comes back on every poll, so `resets_at − 5h` is the
instant the window opened — the first message. That is not a sample, so it is
not bounded by the sampling rate at all. Measured: a window whose first message
was at 15:00 was polled at 14:51 (nothing) and 15:06 (7%). The old drawing put
that 7% at 14:51–15:06; it can only have been spent in 15:00–15:06.

**Fix.** `claude_usage_runs()` (0162): a rise between two polls is attributed to
`(prev, cur]`, **clamped to the window's opening instant**. Consecutive rises
merge into a run; a poll with no rise ends it. That single clamp reproduces
every case in the report exactly.

Three drawn states, because the picture must not claim more precision than the
polling has: an **exact** left edge (the window's own opening) gets a solid cap,
an **inferred** one (a poll boundary) is feathered, and a stretch where the
reporter was DOWN is **hatched and labelled as missing** — not drawn as usage
(a time nobody measured) and not left blank (which reads as "nobody used it").

⚠️ **Three defects the drawing itself surfaced, none visible in the diff:**
- `exact_start` was true for no run, because the flag was recomputed per SPAN
  and cleared when a later span was folded into the run — i.e. on every run
  longer than one poll.
- The window's `resets_at` wobbles ±1s between polls (the API returns
  `now + seconds_remaining`), so clamping to the RAW value drew a run starting
  at `14:59:59`. A second of API noise, rendered as a time. Round to the minute.
- `partial` ("we joined this window too late to say when it was used") was
  written as "the first reading was above zero" — which is true of every window,
  since the first poll after an opening is already above zero. It marked all
  four live windows partial. The real test is whether that first reading can be
  LOCATED: is the first poll more than one missed-poll interval after the
  opening?

⚠️ **And one collision the measurement caught:** a window that resets at 20:00
while the next opens at 20:00 puts a run label and a window-total label on the
same pixel — `ใช้ 55%` printed over `96%`, both unreadable, the same shape as the
`10:00100%` entry above. The first collision tracker only compared run labels to
each other and could not see it, because the two labels are emitted by different
loops. One occupancy map per column now covers every label the overlay places.

**Where it lives now.** `claude_usage_runs()` / `claude_usage_windows()` in
`0162_claude_usage_runs_when_it_was_actually_used.sql`, rendered by
`paintHistory()`. Guarded by `tools/claude0162-usage-runs.sql` (23/23), whose §A
is the owner's worked example sample-for-sample, falsified by deleting the clamp
(which reddens exactly A1, A5, B1, B2 and leaves every control green).

**The general rule.** *When a gauge is sampled, the reading is not the story —
the CHANGE between readings is, and its position in time is bounded by whatever
else the sample carries.* Before adding resolution (polling harder, which costs
rate limit and, here, rotates an OAuth credential 96×/day), look for a field
already in the payload that pins an edge exactly. And when precision is uneven
across a picture, DRAW it uneven: an exact edge and a fifteen-minute guess that
look identical are a claim you did not measure.

---

## "why does it show color weird" / "i still see rail weird" — a magnitude encoding that was too loud, three times

**Symptom.** The capacity rail bucketed a continuous 0–100% into one amber, so
*"the bar 98% show yellow, and the 25% also show yellow, may make user
misunderstood that it's also 98%"*. Three attempts at the fix were each reported
back within minutes.

**What each attempt got wrong, and it is the same mistake at three sizes:**

1. **Solid saturated fill.** A band is ~8px wide and often many HOURS tall, so
   full saturation is a column of mustard hard against the day divider. It read
   as a rule, not as data. The design it replaced was a 30%-alpha wash for
   exactly this reason — the alpha was load-bearing and looked like styling.
2. **Quiet fill + a saturated 2px right edge.** Fixed the wide bands and made
   the narrow ones worse: that week's quota was ~6% free everywhere, so every
   band sat on its 2.5px minimum and 2.5px of fill under a 2px border is
   *almost all border* — a hard gold line down all seven days.
3. **A column-wide track** to read the bar against. Once it was strong enough to
   be a container it drew an **empty gauge** down every day with no reading at
   all, which states "nothing available" where the truth is "no data".

⚠️ **And clipping the band deleted every number on it.** Splitting the rail into
track + fill needed the fill's corners rounded, and `overflow: hidden` on the
band was the quick way. But `.claude-free-tag` is a CHILD at
`left: calc(100% + 3px)` — outside the band on purpose, because "100%" does not
fit in a 10px lane — so the clip removed every percentage. Reported as *"it
doesn't show the percentage of rail anymore"*.

**The browser probe could not see it.** It measured the tag's own `scrollWidth`
(unaffected by an ancestor clipping it) and counted label COLLISIONS — of which
there were now zero, because no label was visible. **A guard that asks "do these
overlap" scores "none of them exist" as a pass.**

**Fix.** Colour alone, four validated steps, full width — the owner's call:
*"i just want the color full, you seperate color like that is enough"*. The
percentage beside each band carries the precision.

**Where it lives now.** `.claude-free.is-full/.is-part/.is-low/.is-none` in
`src/css/claude.css`, thresholds in `paintGrid()`, guarded in
`window-share.test.js` (including "the band never clips its own label" and "no
width encoding", both falsified).

**The general rule.** *A colour scale is computable — compute it.* Two candidate
steps were rejected by `dataviz/scripts/validate_palette.js` on numbers no eye
would produce: a burnt orange for the low step is ΔE 10.4 from the clay
"measured" colour (the collision this repo had already paid for once), and
`#a67c00` is 14.0 from the amber, under the 15 floor. And *the same encoding is
a different object at 2px and at 8px* — decide it at the size it will actually
be drawn, over the data that actually exists, not on a swatch.

---

## "ย้ายปีงบ แล้วโครงการหายไปเลย" — a follow-the-row fix that only fired half the time

**Symptom.** Moving a โครงการ to another ปีงบประมาณ while the grid was filtered
to a year worked; choosing **"ตามวันที่สร้าง (อัตโนมัติ)"** on the same project
made it disappear from the list with no explanation.

**Cause.** `onMoveProjectFiscalYear` deliberately follows the viewer's filter to
wherever the project lands, so it does not vanish from under them. The line was:

```js
const next = picked === 'auto' ? null : Number(picked);
if (filterFY !== 'all' && next != null && String(next) !== filterFY) filterFY = String(next);
```

`next` is the value **written to the column**, and clearing an override writes
`NULL`. So the `next != null` test skipped the follow for exactly the case where
the resulting year is not the value written — and the project moved to its
derived year while the filter stayed put. The guard produced the failure it
existed to prevent.

**Fix.** Ask the resulting year through the same function the grid filter uses,
with the row as it will be:

```js
const resulting = projectFiscalYear({ ...p, fiscal_year_be: next });
if (filterFY !== 'all' && resulting != null && String(resulting) !== filterFY) {
  filterFY = String(resulting);
}
```

**Where it lives now.** `src/js/projects/inbox.js` `onMoveProjectFiscalYear()`;
`projectFiscalYear()` in `src/js/projects/fiscal-year.js`; pinned by
`fiscal-year.test.js` §3d, which asserts the follow agrees with the filter for
every value the dialog can return (falsified before committing).

**The general rule.** **The value you WRITE and the state the user will SEE are
two different questions, and a null write is where they diverge.** When code
reacts to a change by predicting where a row lands, it must ask the same
function the view asks — never re-derive the answer beside it. A local
prediction and the real filter are two implementations of one rule, and the
`null` branch is where they part company first.

---

## Adding one cell to a flex row collapsed the project name to one character per line

**Symptom.** Putting the ปีงบ chip on the กล่องจดหมาย list rows looked right on
a desktop. On a 390px phone, the one row that also carried a badge rendered its
name as a vertical column of single characters, ~700px tall, with the chip and
the timestamp running off the right edge of the card.

**Cause.** `.projects-list-row` is a flex row whose every other cell —
icon, badges, count, timestamp — is `flex: 0 0 auto`. Only the name cell
(`.projects-list-name-wrap`) flexes, and it carried `min-width: 0`. So each
fixed cell takes its width **out of the name**, and `min-width: 0` says the
name may go to zero. Thai has no spaces, so the name is `overflow-wrap:
anywhere` — with no width left it wraps after every character instead of
truncating. Adding one more fixed cell was all it took.

**Fix.** Three parts, each one found by measuring the previous one:

1. the chip moved into `.projects-list-name-line` (which already wraps)
   instead of being taken as another column;
2. `min-width: 7.5rem` — a floor, not zero — on the name cell;
3. `flex-wrap: wrap` on the row under 576px, with the name cell at
   `flex: 1 1 65%`, so the badges + count + timestamp go to a second line.

Part 3 exists because part 2 alone was not enough, and only the 320px
measurement said so — the floor stops the name collapsing and the row then
overflows its own box instead:

```
390px viewport                    name width   row height
control (no chip)                    120px         94px
chip as a new cell                     0px        702px    ← the bug
chip in the name line + floor        120px        123px

320px viewport                    name width   row height   content overflow
before this change (min-width:0)      43px        208px       none
floor, no wrap                       120px         94px       +65px  ← traded one for the other
floor + wrap (shipped)               213px        105px       none
```

Note the "before" column: at 320px the row was ALREADY crushing the name to
43px. The new cell did not create that bug, it made it visible.

**Where it lives now.** `src/css/projects.css` `.projects-list-name-wrap`;
`fyChipHtml()` + `renderProjectListRow()` in `src/js/projects/inbox.js`; pinned
by `fiscal-year.test.js` §3e, which fails if the floor goes back to `0` —
read through `stripComments`, because the rule's own comment names
`min-width:0` while explaining the bug and a raw-text guard fails on that prose.

**The general rule.** **In a flex row where every other cell is `flex: 0 0
auto`, the flexible text cell needs a width FLOOR, not `min-width: 0` — the
next cell anyone adds is taken out of it — and below some viewport the row has
to WRAP, because a floor with no wrap just moves the damage from the text to
the row's own bounds.** And the instrument has to be a CONTROL: the same page
rendered with the new element hidden, measured side by side, at the NARROWEST
supported width. Row height alone does not say whether a tall row is the new
element or the old one being crushed, and the width where a change is safe is
not the width where it is tested.

---

## "it doesn't care about ระดับ that i config in the admin teamsamo"

**Symptom.** Two complaints in one message, and they turned out to have one
cause. (1) On เกี่ยวกับเรา, แผนผัง drew a ฝ่าย's ระดับ 2 seats beside its own
หัวหน้า and its sub-ฝ่าย beside the อุปนายก who runs them, while ผังรวม — the
canvas view of the same data — had honoured ระดับ since 0153. (2) "i see there
are many leftover space including the box ui ฝ่าย role etc". Measured: the
section was **24,101px at 1440px wide and 55,273px on a 390px phone** — sixty-five
screens — and at 390px the PAGE scrolled horizontally (395/390).

**Cause.** แผนผัง read `byParent` — the STORED children, in `position` order.
`tier` was never consulted anywhere in that renderer; the only reader of
`tierOf()` was `chartParentage()`, which the canvas view uses. So ระดับ existed,
the admin could set it, and exactly one of the two public surfaces drew it.

The emptiness was structural, not spacing. แผนผัง was a classic top-down
connector chart in CSS: a box, a horizontal bar, a row of child boxes. In that
geometry siblings sit in a ROW and are TOP-ALIGNED, so a ตำแหน่ง holding one
person standing beside a ฝ่าย holding forty leaves a column of dead pixels the
exact height of the tall one. No padding value fixes a layout whose rows are as
tall as their tallest cell.

The tempting fix — "make แผนผัง call `chartParentage` too" — had already been
tried and reverted (`docs/state-archive/2026-08-15-late-org-chart-reporting.md`):
nesting is how a CANVAS states rank, and on a page nesting is vertical. Applied
to แผนผัง it took the page from 25,847px to 52,163px and max depth from 5 to 9.

**Fix.** Split the two questions the "one structure" idea had merged.

*Order* is one rule: `orderChildren(kids, groupTiers)` in `org-rung.js` —
ตำแหน่ง before ฝ่าย, seats grouped by ระดับ ascending. `chartParentage()` now
calls it instead of building its own `byTier` map, so there is one grouping
implementation, and `org-rung.test.js` holds the differential that the SEAT
SEQUENCE `orderChildren` produces equals the sequence you get by walking
`chartParentage`'s rung chain.

*Geometry* is two rules, deliberately. ผังรวม keeps nesting. แผนผัง became a
page of ฝ่าย PANELS: a titled collapsible container whose body is ONE wrapping
band holding its ตำแหน่ง cards (rung order preserved, the leading rung tinted)
followed by its sub-ฝ่าย as cards. Flow has no ragged-column failure mode and
never needs a horizontal scrollbar.

Four measurements drove the rest of it, in this order:

| change | 1440px | 390px |
|---|---|---|
| the connector chart | 24,101 | 55,273 |
| panels, `align-items: stretch` | 17,895 | — |
| … `flex-start` + seats sized by content | 16,872 | 32,776 |
| … portrait BESIDE the name, root ฝ่าย open only | **3,989** | **8,144** |

`align-items: stretch` was the single worst line: it made every tile on a line
as tall as the tallest, so a one-person ตำแหน่ง sharing a line with a
forty-person ฝ่าย became a 900px empty bordered column — the old dead space,
redrawn with a border round it.

**Where it lives now.** `orderChildren()` in `src/js/org-rung.js`;
`unitBlock()` / `seatBlock()` / `childrenHtml()` in `src/js/org-chart.js`; the
แผนผัง block in `src/css/org-chart.css`. Guard: `org-rung.test.js` §"แผนผัง and
ผังรวม order one ฝ่าย identically" — falsified by reversing the rung sort (8
assertions red) and by ignoring `groupTiers` (1 red).

**The general rule.** **When two views of one dataset must agree, separate the
ORDER from the GEOMETRY and share only the order.** Sharing the geometry is the
mistake this repo made in both directions: once by giving both views the
canvas's parentage (a 52,000px staircase), once by leaving them with no shared
rule at all (ระดับ drawn in one view and ignored in the other). The order is a
pure function over the data and belongs in one module with a differential test;
the geometry is what each surface is FOR.

And: **a layout whose rows are as tall as their tallest cell cannot be made
dense by tuning spacing.** Whitespace complaints on a connector tree are a
report about the geometry. The instrument is the section's own scrollHeight at
three widths, before and after — not a screenshot of the part that looks wrong.

---

## `hidden` did nothing, and only Bootstrap's CDN stylesheet was hiding it

**Symptom.** None visible — which is the point. The ทีม SAMO page's ฝ่าย
panels collapsed correctly, the ปีการศึกษา picker hid itself when there was
only one year, and ขยาย/ย่อทั้งหมด hid itself during a search. All three are
`element.hidden = true` in `org-chart.js`. All three were one blocked request
away from doing nothing at all.

**Cause.** The UA rule is `[hidden] { display: none }` with **no
`!important`**, so any author rule that sets `display` on the same element beats
it. Three elements were in exactly that shape:

| element | its own rule | toggled by |
|---|---|---|
| `.org-years` | `display: flex` | `host.hidden = …` |
| `.org-expand-all` | `display: inline-flex` | `btn.hidden = …` |
| `.orgc-unit-body` | `display: flex` | `panel.hidden = …` |

It worked because Bootstrap's reboot ships `[hidden]{display:none!important}`
and `index.html` loads Bootstrap from `cdn.jsdelivr.net`. Nothing in `src/css/`
carried the rule. Measured in a headless browser with that one `<link>` blocked
and nothing else changed:

```
Bootstrap CSS      .orgc-unit-body[hidden]      #orgBody height
loaded             display: none                    3,463 px
blocked            display: flex                   22,474 px   ← every ฝ่าย open
blocked, + fix     display: none                    3,318 px
```

The older markup was safe by accident — `.org-node-body` set only an
`animation`, no `display`, so the UA rule was unopposed. The panel rewrite gave
the body a `display: flex` and moved the whole disclosure onto a third-party
stylesheet arriving, without anybody choosing that.

**Fix.** One declaration in `src/css/base.css`, which both entries import:
`[hidden] { display: none !important; }`. `!important` is not decoration —
`[hidden]` and `.orgc-unit-body` are both specificity (0,1,0), and base.css is
imported FIRST, so without it source order hands the win to the later file.

**Where it lives now.** `src/css/base.css`, top of file, with the measurement in
its comment. Guard: `hidden-attribute.test.js` — asserts the rule exists, that
it carries `!important`, and (the CONTROL) that a class declaring `display` is
still toggled via `.hidden`, so the guard cannot pass by having nothing to
protect. Falsified three ways before shipping.

**The general rule.** **A behaviour that depends on a rule you did not write is
not implemented, it is borrowed** — and CSS borrowing fails silently, at someone
else's deploy, on someone else's network. When an attribute is your mechanism
(`hidden`, `disabled`, `open`), own the rule that makes it work in a file you
ship. The instrument is not "does it work here": it is **remove the dependency
and measure again**. Blocking one `<link>` in a headless browser is a
five-minute experiment that turns "it works" into "it works BECAUSE".

## A CSS block lifted out of a deleted commit came back with three rules silently commented out

**Symptom.** Not reported — caught by looking at a screenshot, which is why it
is written up. ผังสายงาน was restored from `befd30e` and rendered *almost*
right: every box was there, every connector was drawn, but the ฝ่าย names were
CENTRED instead of left-aligned and the coloured dot beside each name was
missing entirely. Nothing errored. Nothing logged. It looked like a design
choice somebody had made.

**Cause.** The restore lifted ~230 lines of CSS out of the deleted commit by
LINE NUMBER. One of those slices began mid-comment:

```css
/* GRID, not flex-wrap. A ตำแหน่ง name here can be "ฝ่ายจัดการโครงการ …
   their own line and the chevron ended up floating alone under the name. Named
.org-station-btn { … }          ← inside the comment
.org-station-dot { … }          ← inside the comment
.org-branch .org-station-dot { … }  ← inside the comment
```

The `/*` never closed until the next `*/` three rules later, so the browser
never saw them. `.org-station-btn`'s `display: grid` and `text-align: start`
were gone, leaving the row's default centring; `.org-station-dot`'s
`background`, `width` and `height` were gone, leaving a 0×0 element.

An unclosed comment is the only CSS defect that can delete code you did not
touch, and the failure is doubly quiet: the deleted rules are the ones with a
VISUAL default (`text-align`, a zero-size element), so the page renders
something plausible rather than nothing. The same slice also opened
`@media (hover: hover) {` with no body, which swallowed the following rule too.

**Fix.** The extraction now takes ONE contiguous slice with complete comments
and complete blocks, and the extractor asserts `count('/*') == count('*/')` and
`count('{') == count('}')` before writing. Guarded permanently by
`src/js/org-lines.test.js` §A (the stylesheet parses) and §B, which is the
stronger half: **every class the renderer emits must have at least one live
rule**, with the class list read out of the renderer's own source rather than
typed. A rule that is commented out, a selector left pointing at a class that
was renamed, and a class nobody ever styled are three different mistakes with
one symptom, and §B catches all three. Falsified by reintroducing the exact
unclosed comment.

**Where it lives now.** `src/css/org-chart.css`, the ผังสายงาน block;
`src/js/org-lines.test.js`.

**The general rule.** *Never slice source by line number — slice by structure,
and check the result parses before you trust it.* This is the same class as the
`'image/*'` regex that blanked 13,839 characters before any assertion ran
(`tooling-proofs.md`): the INSTRUMENT that moves code is part of the change, and
an instrument that produces syntactically broken output produces something that
still runs. For CSS specifically, the tell is that a missing rule and a rule
that was never written look identical, so "it renders" is not evidence — ask
whether every class you EMIT is styled, mechanically.

## "i press สร้างบัญชีและเข้าสู่ระบบด้วย google and button do nothing … but on google app it works"

**Symptom.** On an iPad in Safari, two unrelated controls were dead: the Google
button inside the sign-in modal, and a ฝ่าย entry in the nav. Both opened their
container — the modal appeared, the menu appeared — and then nothing happened.
In the Google app's in-app browser the same two worked. The owner guessed cache,
and was right about the cause without being right about the mechanism.

**Cause.** Not a Safari bug, and not two bugs. On iOS every browser is WebKit,
including the Google app's in-app browser, so the ENGINE cannot be the
difference — only STATE can. What differs is which copy of `index.html` each one
is running, and that turns out to be everything:

- Bootstrap is a **classic `<script>` from a CDN**. It loads and works
  regardless. So every `data-bs-toggle` still opens its menu and its modal —
  the page LOOKS alive.
- Our own code is an **ES module**, and ~90 controls across `src/html/*.html`
  are inline `onclick="activateTab(…)"` / `onclick="samoGoogleSignIn()"` against
  globals that module defines. Lose the module and all ninety die at once,
  silently: an inline handler calling a missing global throws into the console,
  which nobody on an iPad is looking at.

`server/deploy.sh` keeps old hashed chunks on purpose (`c5edc16`), but only as
far back as the oldest deploy on disk — 2026-08-18 when this was reported, seven
days. A Safari tab open longer than that, restored from a suspended tab or the
back/forward cache, re-runs an `index.html` naming a bundle the server no longer
has. **The HTML's `Cache-Control: no-cache, must-revalidate` does not save you**:
a bfcache/suspended-tab restore does not revalidate. And a flaky connection at
load time produces the identical failure, which is why this is not really a
cache bug — ANY failure to fetch the entry module lands here.

**Reproduced, and that is the part worth copying.** Playwright's WebKit at iPad
size against the live site, with one route rule 404ing `assets/public-*.js`:

```
bootstrap alive : true        drawer opens : true
our module ran  : false       signin modal : OPENS
ฝ่าย navigates  : NO          google button: DOES NOTHING
visible errors  : "Can't find variable: activateTab"   (console only)
```

Every symptom matched, and the control — the same script without the 404 —
passed. A fresh context could not reproduce it, which is exactly why "works in
the other browser" was never evidence about the browser.

**Fix: DETECTION, not prevention.** A boot watchdog in both entry HTMLs, as a
CLASSIC script so it runs in the world where the module does not. The module
sets `window.__samoBooted = true` after its imports (a module that fails to load
a DEPENDENCY is just as dead). If the flag is never set — on the module
element's `error` event, or after 8 s — a bar appears saying the page did not
load fully, with one button that re-navigates with a cache-busting query.
`location.reload()` is deliberately NOT used: on iOS it can re-serve the very
HTML that named the missing bundle, so the fix would exhibit the bug.

**Where it lives now.** `index.html` + `admin/index.html` (the watchdog),
`src/js/main.js` + `src/js/admin-main.js` (the flag), guarded by
`src/js/boot-watchdog.test.js`, falsified three ways.

**The general rule.** *If your code is a module and your framework is not, the
page can be dead and animated at the same time — so something that is NOT your
module has to be able to say so.* More generally: a failure whose only signal is
a console error is invisible on a phone. And when a bug appears in one browser
but not another **on the same engine**, stop looking at the browser; the variable
is state, and the fastest disproof is a fresh context.

## "even i press the โหลดใหม่ … it still show it" — the watchdog was the bug

**Symptom.** A boot watchdog shipped that morning to catch a dead entry module
(see the entry above). Within the hour: *"even i press the โหลดใหม่ on ipad from
the 'โหลดหน้าเว็บได้ไม่ครบ', it still show it"*. Note what the report does NOT
say: the buttons were not reported dead any more. Only the warning would not go
away.

**Cause — two mistakes, and the first one is the interesting one.**

1. **A bare 8-second timer decided the app had failed.** Reproduced on WebKit at
   iPad size by delaying the bundle 11 s and letting it ARRIVE: the app booted
   perfectly and the bar appeared anyway. On a phone with bad wifi that repeats
   on every load — so the warning was firing on the most common case in the
   world it was written for, and no reload could ever clear it because the next
   load did the same thing.
2. **Nothing could ever remove the bar.** `tell()` appended it and there was no
   path back. A late-arriving module left a permanent warning over a working
   page. A one-way door on a heuristic is how a false positive becomes
   unfixable.

Together these made the fix indistinguishable from the bug it was fixing — the
person taps the remedy, the warning returns, and now the remedy looks broken
too.

**Fix.** Wait for a DEFINITE signal, and stay reversible.

- The script element's own `error` event — that bundle will never arrive, so
  speak immediately.
- The window `load` event — every resource has settled, so a module that still
  has not reported itself has errored or thrown. This is the real trigger.
- The timer survives only as a 25 s backstop for a `load` that never comes, and
  it defers while `document.readyState !== 'complete'`.
- The poll keeps running after the bar is shown, so a module that arrives late
  takes the bar away with it.

Verified on WebKit across four scenarios — normal, slow-but-arrives (11 s),
very-slow-past-the-backstop (27 s, bar appears then self-dismisses), and a real
404 — with the assertion `booted === !bar` in every one.

**Where it lives now.** `index.html` + `admin/index.html`; guarded by
`src/js/boot-watchdog.test.js` (23 assertions), falsified by restoring the bare
timer and by removing the dismiss path.

**The general rule.** *A warning that fires on the healthy case is worse than no
warning, and a warning that cannot be withdrawn is worse still.* Before shipping
a heuristic that speaks to a user, run it against the SLOW-BUT-FINE case, not
only the broken one — that is the case it will actually meet. And give every
such heuristic a way back: if the thing it warned about resolves, it must
un-warn, or the first false positive is permanent.

## A SyntaxError blamed on the DOCUMENT, in a page whose own scripts all parse

**Symptom.** After two rounds of watchdog fixes the owner's iPad still failed,
and the diagnostic finally produced something real:

```
bundle: /assets/public-Cy2iC_uh.js      readyState: complete   waited: 11s
errors: SyntaxError: Unexpected identifier 't'. Expected ')' to end an
        argument list. @?_r=…:74 | script failed: public-Cy2iC_uh.js
```

**What it took to read it.** Four things were established by elimination, each
cheap, and together they point somewhere none of them does alone:

1. **The bundle is fine** — that hash is current and serves 200.
2. **Everything the server sends parses** — both inline scripts under
   `node --check` (extracted with a real HTML parser, not a regex; a regex
   matched a `<script>` *inside an HTML comment* and produced a false alarm),
   and the bundle as an ES module.
3. **A corrupt BUNDLE is blamed on the bundle.** Fed WebKit a truncated
   `assets/public-*.js`: `SyntaxError … @/assets/public-*.js:1`. The owner's
   error names the DOCUMENT, so the bad script is not the bundle.
4. **The watchdog RAN** — it is what reported this. So the error cannot be a
   parse failure of the watchdog's own inline script, even though document line
   74 sits inside it. That contradiction is the whole clue.

Resolving it: fed WebKit a document with a broken inline `<script>` placed
AFTER the watchdog. Result — same message, same document attribution, and the
same ORDER (SyntaxError first, `script failed` second). The owner's page
contains a script we do not ship.

**Cause — CONFIRMED by the owner: the "Stay" Safari extension.** Turning it off
for the site fixed it immediately. The next report carried the proof:

```
scripts: 1:inline(293b) 2:inline(8592b) 3:cdn.quilljs.com 4:/assets/public-*.js[mod]
         5:inline(9021b) 6:inline(2188b) 7:inline(43561b) 8:inline(2012b)
         9:inline(8027b)[mod] 10:cdn.jsdelivr.net/…/bootstrap
stack: appendChild@[native code] / i@webkit-masked-url://hidden/:1:72535
```

Five inline scripts we do not ship — ~65 KB, one of them a MODULE — and a stack
whose frames live at `webkit-masked-url://hidden/`, which is WebKit's marker for
extension-injected code. One of the injected scripts had a syntax error, and our
entry module failed alongside it.

Something in that browser was injecting script into the
page — a Safari content blocker or extension is the ordinary version of this,
and it explains the fact that started the whole investigation and that no
same-origin theory ever could: **it works in the Google app's in-app browser,
which does not run Safari extensions.** Same engine, different injected page.

**Fix (of the instrument — the cause is the reader's browser).** The diagnostic
now keeps the FULL filename instead of `String(e.filename).split('/').pop()`,
which on a document URL returns the query string and throws away which file the
error was in; adds the column and the error's stack; and inventories every
`<script>` on the page with its source and byte length, so a script that is
present in the reader's DOM and absent from ours is visible rather than
inferred.

**Where it lives now.** `index.html` + `admin/index.html`, guarded by
`src/js/boot-watchdog.test.js`.

**The general rule.** *When an error names a FILE, check that the file is the
one you think — and never reduce a filename to its basename in a diagnostic.*
The lossy version cost a full round trip with a real user. And when a page's own
scripts all parse but the browser reports a syntax error in the document, stop
looking for your bug: the document being parsed is not the document you sent.
The tell is a contradiction like "the reporter reported an error that would have
prevented the reporter from running" — chase that, it is never noise.

## A second markup site for the same navigation had no handler, so it full-reloaded

**Symptom.** Golden Period opened correctly from the ฝ่าย page and, from the
เครื่องมือ launcher, threw away the SPA and reloaded the entire bundle. Both
"worked", so nothing looked broken — the launcher route was simply slow and lost
all in-memory state.

**Cause.** One navigation, **two pieces of markup**. `departments.js` renders its
cards with `data-dept-tool-path` and has a delegated click handler that
`preventDefault()`s and calls `window.navigateTo`. The launcher
(`src/html/tab-tools.html`) is hand-written markup with **no such handler** —
every other entry there is a `<button onclick="activateTab(…)">`, so the gap had
never shown up. Adding the repo's first `<a href>` to an in-app route in that
file inherited the browser's default navigation.

**Fix.** Keep the `href` — it is what makes middle-click and copy-link work —
and add `onclick="navigateTo('<path>'); return false;"`, which is the launcher's
own idiom. Guarded by `dept-tool-mirror.test.js`.

⚠️ **The guard's FIRST version was wrong and fired on the healthy case**: it
flagged any `href` starting with `/`, which caught `/passport/` — a SEPARATE
application at its own base, where a full page load is CORRECT. The subject is
now derived from `PATH_ROUTES` in `main.js`, so it means "an in-app route"
rather than "looks internal".

**Where it lives now.** `src/html/tab-tools.html`, `src/js/dept-tool-mirror.test.js`.

**The general rule.** *When one behaviour is implemented by a delegated handler,
every markup site that can produce the element must be inside the delegate's
subtree — or it silently gets the browser default instead.* The tell is that
both paths "work" and only one is fast. And when guarding it, derive the subject
from the routing table, never from the shape of the string: a guard that fires
on a correct case gets suppressed, and then it protects nothing.

## The สถิติ quota panels had 29 tests and had never been LOOKED at — two faults at 390px

**Symptom.** Nobody reported this, which is the point. The handoff said it
plainly: the panels were unit-tested, their classes were confirmed in the
SERVED bundle, and **nobody had opened `/admin#analytics`**. Driving it at
390 px found two faults in the first screenshot:

1. `มองไม่เห็น` wrapped to two lines in **8 of the 12** action rows, so a
   two-word STATUS read as a broken cell rather than an answer.
2. `แยกตามระบบ` showed **`ไฟล์หนังสือโคร…`** and **`SAMO Pass…`** — the one
   thing that panel exists to say, which system is spending the shared Apps
   Script quota, was the part cut off.

**Cause.** Both are layout, and every instrument in use was blind to layout.
The chip inherited the table cell's normal wrapping; nothing said it was a
status. `.an-rank-label` was `white-space: nowrap` + `text-overflow: ellipsis`
in a fixed **96 px** (84 px on phone) grid column, with the full text in a
`title` attribute — **and a phone has no hover.** The desktop author saw a
tooltip and considered the text disclosed.

Note what did NOT catch it. `analytics-email.test.js` renders the panel to a
string and asserts on the HTML: correct, and structurally blind. The
class-existence guard passed because `.an-rank-label` *has* a rule — it was the
rule that was wrong. And the bundle grep confirmed the strings ship, which says
nothing about whether they are readable. Three green instruments, one unopened
view.

**Fix.** `white-space: nowrap` on `.an-gas-yes`/`.an-gas-no` (the table already
carries `overflow-x: auto`, so it costs nothing); `.an-rank-label` wraps to two
lines via `-webkit-line-clamp` + `overflow-wrap: anywhere` instead of
ellipsizing, and the column went 96→108 px / 84→92 px. Wrapping works at any
label length and any width, which ellipsis-plus-hover does not — and it fixed
truncation nobody had noticed in the OTHER two rank panels too
(`admin:landing`, `/admin/#team` were being cut at 84 px).

**Where it lives now.** `src/css/analytics.css`; guarded by the
`the quota panels stay readable on a phone` block in
`src/js/analytics-email.test.js` (both guards falsified by reintroducing each
fault and watching the named assertion go red).

**The general rule.** *A `title` attribute is not a fallback — it is disclosure
on ONE input path, and the touch path has no hover.* Truncating text and
"recovering" it via tooltip means the content simply does not exist for phone
users; if a label can be long, let it wrap. And the older rule this is the
newest instance of: **a change is NOT verified in a view you never opened.**
Unit tests, a class-existence guard and a bundle grep are all satisfied by a
page that renders wrong — when the remaining risk is *visual*, the only
instrument that can see it is a rendered screenshot you actually look at.

## "The tool renders fine" — but ~160px of dead space under it, and every test was green

**Symptom.** The first ฝ่าย tool frame (`/tools/starter`) rendered correctly:
right chrome, right sandbox, right content, no overflow at any width. Under the
content, inside the frame's border, sat about 160px of empty white. 24 unit
tests, `npm run build`, `check:embeds` and the whole 1,615-test suite were
green. **The screenshot showed it in one look.**

**Cause — the frame was measuring itself.** The host gives a new frame
`min-height: 70vh` so a tool that never reports a height is still readable. The
tool reports its height with:

```js
parent.postMessage({ height: document.documentElement.scrollHeight }, '*');
```

Inside an iframe, `document.documentElement` **is the frame**. So the tool
measured the box the host had just sized, and told the host to size the box to
that — a container sizing the content that sizes it. The number could never
come out below the 70vh floor, whatever the content was. A tool taller than
70vh looked perfect; every shorter one carried the difference as dead space.

**Fix.** Measure `document.body.getBoundingClientRect().height` and observe
`document.body`. The body is laid out by its content and is independent of the
frame, so the answer is the same at any frame size.

**How it is guarded, and why not where you would expect.** Not by asserting the
starter uses `body` — that is asserting the fix, not the property, and the next
tool copied from a different template would slip past it. The property is *the
same tool reports the same height at two different viewport heights*, and only
a browser can ask it. `tools/smoke-browser.mjs` now loads the frame at 900px
and at 400px and requires the two to agree. Falsified: with the old line it
reports 628 and 467; with the fix, 467 and 467.

**Where it lives now.** `public/embed/starter/index.html` (with the reason, in
Thai, above the six lines every tool copies), `tools/smoke-browser.mjs` check 9,
`docs/DEPT-TOOLS.md` §3.

**The general rule — this repo already had it, and I still shipped it.**
*Never measure a container to size the content that sizes it.* It was written
here from a different case, and it did not stop this one, because in a
cross-origin frame the loop is invisible: the two halves are in different
documents, written by different people, and neither line looks wrong on its own.
**The tell is that a fault scales with the CONTAINER's size, not the content's**
— dead space that grows when the window does. And the reason it survived 24
tests is that a jsdom test has no layout engine at all: it can prove the message
was sent and cannot prove the number in it means anything. **A frame is a view
you have not opened until you have looked at it.**

## "ไม่พบใครที่ตรงกับ …" stayed on screen with the matching rows listed right beneath it

**Symptom.** In ทีม SAMO → เพิ่ม/แก้ไขสมาชิก → ค้นหาคนจากระบบ, typing a query
that matches nobody, then typing more, left

```
ไม่พบใครที่ตรงกับ “<the FIRST query>” — กรอกข้อมูลเองด้านล่างได้เลย
```

sitting directly above the results for the SECOND query. The hint and the list
contradicted each other, and the hint is the more authoritative-looking of the
two because it is a sentence. Noticed while driving the admin UI on 2026-08-10,
carried in `docs/NEXT.md` §0b as "one line in `renderPersonResults`".

**Cause — the message had an entry and no exit.** `renderPersonResults` wrote
the verdict on the empty-result branch and never touched the hint on the branch
that finds rows. Nothing was stale in the sense of a cache: the sentence was
TRUE when it was written and nothing was responsible for withdrawing it. The
same hole covered the second outcome, a query dropping below the two-character
floor, where nothing has been searched and so no verdict is owed at all.

**It was not one line.** The note in NEXT.md was written from the symptom and
under-counted the work, which is worth recording on its own: fixing it needs a
sentence to fall BACK to, and that resting sentence is different for เพิ่ม
(«พิมพ์อย่างน้อย 2 ตัวอักษร …») and แก้ไข («ค้นหาเพื่อเติมข้อมูลจากระบบทับของเดิม …»),
which only `openMemberModal` knows. Retyping either at the renderer would be one
rule with two implementations. And `src/html/tab-team.html` holds a THIRD copy —
what the box says on the first paint, before any modal has opened — which HTML
cannot import.

**Fix.** `PERSON_SEARCH_HINT_ADD` / `PERSON_SEARCH_HINT_EDIT` are exported
constants; a module-scope `personSearchResting` holds whichever this open is
using, and `renderPersonResults` restores it on both non-verdict outcomes. A
successful pick promotes its own confirmation («เติมข้อมูลของ X แล้ว …») to be
the resting text, because after a pick that sentence is a true statement about
the FORM, not about the query — so clearing the search box must not retract it.

**Where it lives now.** `src/js/team/index.js` (the constants, `personSearchResting`,
`renderPersonResults`, `pickPerson`, and the modal reset), guarded by
`src/js/person-search-hint.test.js` — four assertions, each reintroduced and
watched fail before the fix was kept: the rows path, the short-query path, the
one-home rule, and the HTML copy.

**The general rule.** *A message a renderer can turn ON must be turned OFF by
every other outcome that renderer can reach.* This is class 4 in a quiet form —
authorization is per-path, and so is disclosure: enumerate the branches, not the
one you were looking at. The tell is a UI string written inside an `if` with no
matching `else`. And the second half is class 6: the moment a message has more
than one resting value, it has more than one author, so give it a constant
before the two spellings drift.

## "the orange highlight box is not aligned" — it was not an alignment error

**Symptom.** Reported of a diagram on the docs site: *"the picture on When your
work depends on other work — the orange highlight box is not aligned"*.

**Cause — the box was too NARROW, and x was right all along.**

```svg
<rect x="472" y="52" width="212" height="27" .../>
<text x="578" y="70" text-anchor="middle" font-size="12.5">
  feat/b — branched off feat/a, not off main</text>
```

The box spans 472→684, its centre is 578, and the text is centred on 578 —
correct. But that sentence needs ~268px at 12.5px and the chip is 212px, so it
hung out of both ends. **The obvious remedy — move `x` — would have made it
worse**, which is what the word "aligned" invites you to do.

**The instrument, and what it found on its own.** `tools/svg-text-fit.mjs`
measures every `<text>` against the `<rect>` it sits in. It immediately caught a
SECOND one nobody had reported: a caption in `branches.svg` started at x=640,
needed 289px, and ran 29px past the 900px frame — its last two words were simply
not on the picture.

It is an ESTIMATE and says so: no font metrics, a per-character width table,
built to err wide so anything it passes has room. Thai vowels and tone marks are
counted as zero-width, or every Thai label over-estimates by about a third and
pushes each box wider than it needs to be.

⚠️ **It cannot see two shapes OVERLAPPING, and both halves were present.** An
orange caption crossing a green curve, and a leader line struck through a
caption — found by rendering the files and looking at them. The test narrows
what you have to look for; it does not replace looking.

**Where it lives now.** `tools/svg-text-fit.mjs`, `src/js/docs-diagrams.test.js`
(with both controls, plus `<title>` and "is referenced by a page" checks).

**The general rule.** *When a report says "not aligned", measure the box before
you move the thing inside it.* A label that overflows is centred perfectly and
still looks wrong, and SVG will not tell you: overflowing text is valid, renders
without warning, and passes every test in a repo that has no layout engine.

## A block styled with Bootstrap looked perfect in the editor and unstyled on the page

**Symptom.** Caught before shipping, while building the ฝ่าย visual-editor spike
— and it would have been invisible until a student opened a real ฝ่าย page.

**Cause.** A `kind='html'` block is rendered into an iframe via `srcdoc` with a
sandbox that omits `allow-same-origin`. **That document is BLANK**: no
Bootstrap, no site stylesheet, no Google Font. But the EDITOR runs inside the
admin page, which has all three. So a block written as
`<div class="row"><div class="col-md-6">` looks exactly right where it is
authored and collapses to unstyled markup where it is read.

The same trap in reverse bit the first render of the editor's own rows: a static
probe that did NOT load Bootstrap showed every layout broken and the "hidden"
file inputs visible. That was the probe, not the code — the control is to check
whether an already-shipped view has the same symptom before believing it.

**Fix.** Every block carries its own inline layout, and the saved document is
wrapped with its own `<style>` (font, colours, `box-sizing`) plus the
`samo-embed-height` reporter. Columns stack by `flex: 1 1 260px` + `flex-wrap`
with **no media query**, so a non-designer cannot ship a laptop-only layout.

**Where it lives now.** `src/js/dept-visual-editor.js` (`wrapDocument`, `BLOCKS`)
and `src/js/dept-visual-editor.test.js`, which asserts no block uses a Bootstrap
class and no block carries `@media`.

**The general rule.** *An isolated frame inherits NOTHING — check what the
document your markup lands in actually has, not what the page you authored it in
has.* Generalises past sandboxes: an email body, a PDF renderer, a
`srcdoc` preview and a web component's shadow root all have their own idea of
what CSS exists. **The place a thing is composed is not the place it is read**,
and the only instrument that can tell you is the rendered destination.

## GrapesJS hid its own block panel, and the empty canvas WAS the complaint

**Symptom.** The visual-editor spike loaded, imported the existing content, and
opened at phone width — and the right-hand panel read *"Select an element before
using Style Manager"* over an empty canvas. The blocks were behind an icon.

**Cause.** GrapesJS's default panel layout opens on the Style Manager, not the
Block Manager. Nothing was broken; the one thing on screen that tells a person
what to do next was one unlabelled click away.

**Why it matters more than a default usually would.** This spike exists to
answer *"it is untuitive"*. Shipping it with the blocks hidden would have
reproduced the exact complaint inside the thing built to fix it, and the owner
would reasonably have judged the whole approach on it.

**Fix.** `editor.Panels.getButton('views', 'open-blocks')?.set('active', true)`
after init, wrapped in a try/catch so a renamed panel id degrades to the icon
rather than throwing.

**Where it lives now.** `src/js/dept-visual-editor.js`.

**The general rule.** *A library's defaults are tuned for its own demo, not for
your least technical user* — and the gap is only visible in a screenshot. This
was found by rendering the editor and looking at it, after unit tests, a build,
and a bundle-isolation check had all passed. **A UI you have not looked at is a
UI you have not tested**, and that is now three separate entries in this file.

---

## Fixing the transport made a latent bug REACHABLE — a signature drawn at zero height

**Symptom** (not yet reported by a person — found by scrutinising the fix that
enabled it): the e-sign modal produces a PDF the system records as ลงนามแล้ว,
uploads to Drive and shows a green tick for, and the signature is **not visible
on any page**. Identical to the symptom of the 0181 report, by a different
mechanism, so it would have been diagnosed as a relapse.

**Cause**. `currentRatios()` took the signature's proportions from layout —
`overlay.clientHeight / overlay.clientWidth`. `useSignature()` assigns
`overlay.src` and calls `capturePlacement()` **in the same tick**, before the
image has loaded, so `clientHeight` is 0 and the placement is stored with
`aspect: 0`. An `onload` handler re-captures with the right value, so the window
is short — but `signAllPages()` copies whichever placement it finds and stamps
it on EVERY page, and at embed time `h = w * aspect` is then 0. `drawImage` with
`height: 0` succeeds silently.

**Why it was dormant, and why that matters.** The in-app ลงนาม button had never
worked in production — nginx served pdf.js's `.mjs` worker as
`application/octet-stream` (`deploy-hosting.md`), so `getDocument()` always
rejected and nobody reached this code. Fixing the MIME **un-shielded it**, in
the same session, silently.

**Fix**. `sigAspect` is captured from the TRIMMED BITMAP inside
`trimmedSignature()`, where the crop's `h / w` is known exactly, and
`currentRatios()` reads that instead of the DOM. Plus a floor at embed time:
if `p.aspect` is not a positive finite number, fall back to
`png.height / png.width`, which pdf-lib knows — no path may draw a zero-height
signature, because the result satisfies every downstream check and no human eye.

**Where it lives now**: `src/js/projects/esign.js` ·
`src/js/projects/signed-file-integrity.test.js` ("a signed PDF must actually
show the signature", 3 assertions, each watched to fail with its bug back).

**The general rule.** *An image's proportions are a property of the IMAGE;
measuring them through layout turns a constant into a race.* Read
`naturalWidth`/`naturalHeight` or the source bitmap, never `clientHeight` on an
element whose `src` you set in the same tick. And the wider one, which is the
reason this entry exists at all: **when you repair the transport that was
keeping a feature dead, every bug BEHIND it becomes reachable in the same
commit.** A fix that turns a feature on for the first time is not a fix, it is a
launch — re-read the code it just enabled, because it has never executed in
production and nothing about "it was already merged" means it works.
