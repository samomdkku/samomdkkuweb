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
(`supabase/migrations/0213_dept_pages_for_every_dept.sql`) and
`tools/dept0213-every-dept.mjs`, registered in run-proofs.mjs. STATE.md's
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
