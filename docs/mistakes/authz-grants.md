# Mistakes — The permission / seat / scope channel (ทีม SAMO grants)

One narrative: `managed_permissions` grew beside the old role list, and every gate that still asked "what ROLE are you?" became a silent block. Read before adding an access channel, a scope dimension, or a seat.

Each entry: **Symptom → Cause → Fix → Where it lives now**. The always-loaded index of every entry across all nine files is `.claude/rules/mistakes.md`; add new entries here, then run `npm run mistakes:index`.

---

## Adding a permission-based access channel leaves every ROLE-ONLY gate as a latent block — a role:'user' account with real granted perms gets bounced

**Symptom**: After 0081 made the SAMO Team tree grant real perms, a person
(`phuriphat.ma@kkumail.com`) whose tree membership gave them `pr` (+more) logged
into `/admin/` and got stuck at the sign-in gate — even though the DB row was
correct (`role='user'`, `managed_permissions=['creator','pr','projects','samoshop',
'team','vs']`, verified live). The PR tab never even rendered.
**Cause**: The admin ENTRY gate was role-only:
`const isStaff = STAFF_ROLES.includes(role); if (!isStaff) showAuthGate()`.
`STAFF_ROLES` is the fixed list of staff roles; a Google login is `role='user'`,
which isn't in it — so the gate bounced the account before `userCanAccess()` (which
IS permission-aware) ever ran. The per-section sidebar gating at
`userCanAccess(feature)` was already correct; the bug was the COARSE "are you allowed
in the building at all" check one level up, which still asked "is your ROLE staff?"
not "do you have ANY admin capability?". Same shape lurked in the `authReady.then()`
settle-check (`!STAFF_ROLES.includes(u.role)`) and the `?scan=` subscriber.
**Fix**: `canUseAdmin(user) = STAFF_ROLES.includes(role) || ADMIN_FEATURES.some(f =>
userCanAccess(f, user))` where `ADMIN_FEATURES = ['pr','vs','samoshop','projects',
'creator','team']`. Gate BOTH the onAuthChange handler and the authReady settle-check
on `canUseAdmin`, not the role list. Non-staff admin users get a 'ทีม SAMO' sidebar
label fallback.
**Where**: `src/js/admin-main.js` (`canUseAdmin`/`ADMIN_FEATURES`, the onAuthChange
gate, the authReady `.then`). **Rule**: when you introduce a permission channel that
can grant access to accounts OUTSIDE the existing role set (here: `managed_permissions`
on `role='user'` kkumail logins), grep for EVERY `ROLE.includes(role)` / `role === 'x'`
gate — each is a role-only chokepoint that silently ignores the new channel. Route the
coarse "can this account use the app at all" check through the same
permission-aware predicate the fine-grained gates use, never a hardcoded role list.

---

## "โมนา got pr permission in teamsamo but she can't delete pr ticket" — a SECURITY DEFINER RPC restated a policy that had already moved

**Symptom**: A ทีม SAMO member granted PR through her node
(`role='user'`, `permissions='{}'`, `managed_permissions='{creator,pr,team}'`)
could open the PR staff dashboard, read every ticket and save edits — but ลบ
returned `{"code":"42501", "message":"not authorized to delete PR tickets"}`.
Everything else about her access worked, which is what made it look like a
one-off rather than a channel gap.
**Cause**: 0043 moved ticket deletion behind `soft_delete_pr_ticket()` on
purpose — a soft delete is an UPDATE at the storage level, so a plain PATCH
would have inherited the BROADER update policy — and re-checked, by hand, what
its header called "the EXACT current delete authorization":
`current_user_role() not in ('pr_staff','dev')`. That was 0001's version of the
rule. 0014 had already taught `pr_tickets_delete_staff` the permission channel
(`or current_user_has_permission('pr')`) twenty-nine migrations earlier. So the
copy was stale **on the day it was written**, and stayed invisible because every
account anyone tested with holds the ROLE, which satisfies both spellings. The
VS twin in the very same migration, `soft_delete_vs_ticket`, DID carry
`current_user_has_permission('vs')` — one gate of a pair was right, so review
saw a permission-aware pair.
**Fix**: 0149 makes the RPC mirror the live policy —
`v_role in ('pr_staff','dev') or public.current_user_has_permission('pr')`,
with 0045's `v_role is null` fail-closed guard kept ahead of it.
`current_user_has_permission` already reads the UNION of `permissions` and
`managed_permissions` (0081) and answers yes to everything for `master` (0111),
so a node grant, a direct grant and a master account all resolve in one call.
**Where**: `supabase/migrations/0149_pr_soft_delete_honours_the_permission_channel.sql`;
guard `tools/pr0149-delete-permission.sql` (12/12). The guard is DIFFERENTIAL by
construction: it asks the POLICY and the RPC the same question about three
subjects — permission-only, role-only, ungranted — and fails when they disagree,
so it cannot be satisfied by a gate that merely denies. It reproduced the bug
before the fix (B1 FAIL, C1 2-of-3) with both controls behaving. Its instruments
undo themselves by raising inside their own subtransaction, because the first
version used `rollback to savepoint` and silently discarded its own probe rows
along with the delete — an empty result read exactly like a passing run.
**Ratchet**: `src/js/definer-authz.test.js` — runs in `npm test`, reads the
migrations, and fails when a SECURITY DEFINER function raises 42501 while
consulting the ROLE and never the permission channel. Its own first version was
BLIND: it matched the role-list SYNTAX (`current_user_role() in (…)`), and
re-introducing this exact bug left it green, because 0045 had already captured
the call into `v_role` and tested the VARIABLE. Matching the CHANNEL rather than
one spelling of it caught it; the lesson is now in `skills/write-a-guard.md` §1.
The scan found no other instance — 14 definer functions raise 42501 and the
static parse matched `pg_proc` exactly, which is the control.
**Rule**: when a policy is restated in a SECURITY DEFINER function, the
restatement is a COPY, and this repo's rule is that two implementations of one
rule drift. Do not copy the policy TEXT — copy the QUESTION, and write the
differential in the same commit. A comment saying "mirrors policy X" is not a
mechanism; the one in 0043 said exactly that and was wrong when it was typed.
And when you thread a new access channel through a pair of twins, check the
SECOND one: `soft_delete_vs_ticket` being correct is what hid this for 106
migrations.

---

## A narrowing "scope" dimension added ALONGSIDE an unconditional full-access permission is DEAD — RLS ORs the branches, so the broad grant always wins

**Symptom**: A person granted VitalSound through the SAMO Team tree with a
per-ฝ่าย binding (0082 `team_nodes.vs_dept` → `users.managed_vs_depts`) logged
in with their kkumail and saw + managed EVERY department's tickets — not the
one dept they were bound to, unlike a real VP account (`samomdkkuvpa`). The
tree row, the resolver, `managed_vs_depts`, and the new RLS branch were all
verifiably correct, which is what makes this one hard to see.
**Cause**: 0082 added the dept scope as an ADDITIVE dimension parallel to the
`vs` permission, and the perm modal offered the two independently — a checkbox
grid ("VitalSound") plus an always-visible dept `<select>`. The admin did the
natural thing: ticked VitalSound (to grant VS at all) AND picked a dept. But
`vs` means FULL VS — `current_user_has_permission('vs')` is an unconditional
`true` branch in every VS policy, and permissive RLS policies are OR'd, so it
swallowed the narrower `target_dept = any(current_user_vs_depts())` branch.
Live proof: node `หัวหน้าฝ่าย IT` had `permissions={vs}` AND
`vs_dept='อุปนายกฝ่ายวิชาการ'` → `managed_permissions={pr,vs}` → full access.
Same family as "a per-recipient SELECT RLS is DEAD when a `using(true)` policy
already exists" — a broad OR-branch cannot be narrowed by adding a second one.
**Fix**: make the scope a PROPERTY OF THE GRANT, not a sibling of it. A row now
carries EITHER `vs` (all depts) OR a `vs_dept` (that dept only), never both:
the dept picker appears only after VitalSound is ticked (progressive
disclosure), and choosing a specific dept drops `vs` from `permissions[]` on
save (`readPermInputs()`). Migration 0083 normalises the rows written under the
old model (`array_remove(permissions,'vs') where vs_dept is not null`) and adds
`current_user_vs_scope()` — NULL = all depts, `{}` = no access, else the
allowed depts — so every VS surface asks ONE fail-closed predicate instead of
re-deriving `role in (...) or has_permission or vp_admin-dept` five ways.
**Where**: `supabase/migrations/0083_vs_scope_is_not_full.sql`,
`src/js/team/index.js` (`readPermInputs` / `syncVsScopeVisibility`),
`src/js/vs-staff.js` (`isVsSuper` / `vsScopeDepts`),
`tools/vs0083-scope.mjs` (10-check proof, run it after any VS RLS change).
**Rules**: (1) before adding a narrowing dimension to an authorization model,
grep the policies for an existing unconditional branch (`has_permission('x')`,
`using(true)`, a role list) — if one exists, your new branch is decorative
until the broad grant is made mutually exclusive with it. (2) A UI that lets an
admin select both a broad grant and a narrow scope INDEPENDENTLY will be used
that way; encode the exclusivity in the form, not in a doc comment.
(3) The second half of this fix is the boring half: a scoped principal needs
the SAME dept-scoped abilities everywhere the existing narrow role has them
(tags, dedup search/merge/unmerge, soft-delete, moderation) or every button
throws "not authorized" — grep for each `= current_user_dept()` site.

---

---

## The privilege-ESCALATING option must never be a select's default — "ทุกแผนก" at index 0 silently granted full VitalSound on every save

**Symptom**: minutes after the 0083 UI shipped, the same team node kept coming
back as `permissions={vs}, vs_dept=null` (full VS) even though the admin's
stated intent was a per-ฝ่าย scope. Looked like the fix had not deployed, or
like a string-encoding mismatch stopping the `<select>` from preselecting the
stored dept. It was neither — a byte-compare of all 12 dept values against
`vs_tickets.target_dept` matched exactly, and the deployed bundle was correct.
**Cause**: the new scope select was built as
`<option value="">ทุกแผนก</option>` + one option per dept. The empty value —
i.e. the browser's default selection for a fresh grant — WAS the widest
possible grant. So ticking "VitalSound" and pressing บันทึก without ever
touching the scope picker handed over every department's confidential tickets.
The one interaction an admin is most likely to perform (tick the box, save)
produced the most dangerous outcome, silently.
**Fix**: split "nothing chosen" from "all departments". `""` is now
`— เลือกขอบเขต —` and saving with it blocks with a Thai message;
`__all__` (`VS_SCOPE_ALL`) is the explicit full grant and additionally
requires a `confirm()` naming the consequence. A node/member that already
carries `vs` preselects `__all__`, so editing an existing full grant is
unchanged. Same principle as the vs_categories confidential-toggle entry
above: guard the direction that REMOVES protection, not the safe one.
**Where**: `src/js/team/index.js` (`VS_SCOPE_ALL`, `fillVsScopeSelect`,
`readPermInputs` returning null, `readPermInputsOrWarn`).
**Rule**: in any picker where one option is broader/more destructive than the
others, index 0 must be a non-choice ("— เลือก… —") and the broad option must
be selected deliberately. Never let "the user didn't touch this control" and
"the user asked for maximum privilege" be the same input value. Corollary for
debugging: when live data keeps reverting to a wide setting, suspect the
form's default before suspecting the write path.

---

---

## A capability key is not a ROLE — granting flat `projects` produced a tab with no controls, because the app branches on `user.role`, not on the permission

**Symptom**: the obvious way to let a person use หนังสือโครงการ via the SAMO
Team tree — tick "หนังสือโครงการ" in จัดการสิทธิ์ — opens the tab for them and
then does nothing useful. No ส่งหนังสือ button, no รับเรื่อง controls, no role
hint, and every write is refused. Looks like the grant didn't apply; the grant
is fine.
**Cause**: `projects` is one permission key but THREE workflows
(`vp_admin` = ส่งหนังสือ, `uni_staff` = รับเรื่อง/อัปเดต, `sa_prof` = ลงนาม).
`src/js/projects/index.js` does `currentRole = user.role` and every control,
hint, scope filter and notification branch keys off that string; a tree
grantee is `role='user'`, which matches no branch. Server-side the same shape:
`current_user_is_project_actor()` was the hardcoded list
`role in ('vp_admin','uni_staff','dev')`. So the permission opened the door to
a room with no furniture. Two further role-only chokepoints hid behind it:
`current_user_is_prof()` (`role = 'sa_prof'`) gated every professor policy, and
`sign.js` addressed the signature request with
`listUsersByRole('sa_prof')[0]` — a role query that can never see a tree-granted
อาจารย์ AND silently assumed exactly one professor exists.
**Fix**: give the grant a SEAT — `team_nodes/team_members.project_seat ∈
(vpa|staff|prof)` → `users.managed_project_seats[]` →
`current_user_project_seats()` (0086), mirroring how `vs_dept` scoped
VitalSound. Widen the two role-only helpers at their single definition each so
every policy that calls them picks seats up for free, and resolve the seat to a
role ONCE in the frontend (`projectSeatRole()`) so the ~40 `role === '…'`
branches keep working untouched. The seat picker is required whenever the perm
is ticked — a `projects` grant with no seat is refused at save time rather than
shipped as a dead tab. `prof` is deliberately NOT an actor (a professor who
became one would see every project instead of only what was sent to them).
**Where**: `supabase/migrations/0086_team_project_seats.sql`,
`src/js/projects/index.js` (`projectSeatRole`), `src/js/projects/api.js`
(`listProjectProfs`), `src/js/projects/sign.js`, `src/js/team/index.js`.
Proof: `tools/proj0086-seats.mjs` (18 checks incl. the prof-is-not-an-actor
negative).
**Rule**: before exposing a feature through a flat permission key, grep the
module for `user.role` / `role === `. If the UI or RLS branches on role rather
than on the permission, the permission alone is NOT a working grant — either
add the missing dimension (a seat/scope) or the grant is decorative. Same
family as the VS "scope added next to an unconditional permission" entry: a new
access channel must be threaded through EVERY gate the old channel used, not
just the one you were looking at.

---

---

## When a SCOPED grant deliberately drops its blanket permission key, every reader of that key must learn the second signal — or re-opening the editor wipes the grant

**Symptom** (caught in a bug scan, before it reached a user): a person or node
granted SAMO Passport **scoped to one department** shows the "SAMO Passport"
checkbox UNTICKED when the จัดการสิทธิ์ modal is re-opened, with the scope block
hidden. Nothing looks broken — until the admin saves that modal for any
unrelated reason (adding `pr`, flipping inherit), at which point
`passport_dept_id` is written back as `null` and the grant is **silently
destroyed**. The row still exists, so nothing errors.
**Cause**: 0083/0087 make scoped and full mutually exclusive — a scoped grant
stores the binding (`vs_dept` / `passport_dept_id`) and NO blanket key in
`permissions[]`, because the blanket key is an unconditional OR-branch in RLS
that would swallow the narrower check. That is correct. But the modal restored
its checkboxes from `permissions[]` alone, with a hand-written special case for
exactly one key:
```js
cb.checked = cb.value === 'vs' ? vsOn : own.has(cb.value);   // ← 'passport' missing
```
The `vs` case had been patched when VS gained its scope; adding a SECOND scoped
permission re-introduced the same bug for the new key. The read path and the
write path disagreed about what "granted" means.
**Fix**: one predicate both modals share — `permTicked(key, own, row)` — that
knows every key whose grant can be expressed as a binding instead of a
permission. New scoped permissions extend that function rather than adding
another ternary. Regression-tested in `src/js/team/perm-ticked.test.js`,
including `passport_dept_id: 0` (a real id must not read as falsy).
**Where**: `src/js/team/index.js` `permTicked` + both `open*PermModal`.
**Rule**: any time you make a grant's storage POLYMORPHIC — "either this key or
that binding" — grep for every place that answers "is this granted?" and route
them all through one shared predicate the same commit. A read that knows only
the old representation does not fail loudly; it reports "not granted", and the
next write makes that true.

---

---

## The permission that manages the grant engine was the one the grant engine didn't honour — and a helper test is not a permission test

**Symptom** (reported live): the ทีม SAMO permission was granted to
`phuriphat.ma@kkumail.com` through the tree. Signed in as that account, EVERY
tree edit failed with "บันทึกไม่สำเร็จ (สิทธิ์ไม่พอ)" — which also made granting
เขียนประกาศ to someone fail, so it read as two separate bugs. It was one: the
account could not write the tree at all, so no grant could be issued from it.
**Cause**: 0046 gated `team_nodes` / `team_members` on ROLE only —
`current_user_role() = any(array['vp_admin','dev'])` — with no
`current_user_has_permission('team')` branch. When 0081 introduced
`managed_permissions`, every OTHER feature's policy was updated (announcements
honours `creator`, `pr_agents` and `pr_tickets` honour `pr`,
`current_user_is_shop_admin()` honours `samoshop`) — the team tables were
missed. The UI honoured it (`userCanAccess('team')`, `ADMIN_FEATURES`), so the
section rendered and only writes died. Third instance of the same class this
cycle.
**A second one fell out of the same sweep**: `projects_insert` /
`projects_delete` / `project_documents_insert` / `project_documents_delete`
never called `current_user_is_project_actor()` and stayed role-only, so the
0086 `vpa` seat could UPDATE a project but not CREATE one — the single thing
ผู้ส่งหนังสือ exists to do. `proj0086-seats.mjs` missed it because it asserted
`current_user_is_project_actor()` returned true rather than performing a real
INSERT. **A predicate test is not a permission test**: the helper can be right
while the policy that was supposed to call it never does. The script now does
the INSERT (allowed for `vpa`, refused for `prof` and for no seat).
**Fix**: 0089 adds the `team` permission branch to both team-table policies;
0090 adds the `vpa` seat to the four project write policies — deliberately
alongside the existing role list rather than switching to the actor helper,
because that helper also admits `uni_staff`, who must not create projects.
**Where**: `supabase/migrations/0089_*`, `0090_*`; proofs
`tools/team0089-manage.mjs` (5) and the extended `tools/proj0086-seats.mjs` (21).
**Rules**: (1) after adding an access channel, enumerate EVERY table the
feature writes and check each policy names the channel — a UI gate that honours
it will hide the gap until someone tries to save. (2) Test the OPERATION, not
the predicate. (3) Watch for the recursive case: the permission governing the
permission system is the easiest one to forget, because you are usually holding
a role that already works.
**Third layer, same sweep (0091)**: the notify fan-out resolved every audience
by role — `listUsersByRole('uni_staff'|'vp_admin'|'sa_prof')` — so a seat holder
could be sent a หนังสือ, act on it, and never get a single in-app notification.
This is the quietest failure of the three: the workflow works, the bell is just
empty, and nobody reports a notification they never knew to expect. Replaced by
`list_project_seat_users(seat)` (role OR seat, id + display name only). So the
enumeration rule covers **writes AND audience lookups** — anywhere the feature
asks "who is the X?", not just "may this user write?".
**Harness note (cost me 20 minutes)**: seeding a grant by poking
`users.managed_permissions` directly then writing to `team_nodes` does NOT work
— the write fires the statement-level recompute trigger, which rebuilds
managed_permissions from the tree and wipes a grant with no binding behind it.
Seed the real node+member binding and call `sync_my_team_permissions()`.

---

---

## A seat/scope dimension that is UNIONED with what it inherits is not a choice — the widest value wins and the explicit pick is decorative

**Symptom**: "I gave myself หนังสือโครงการ as **คณะ**, but it shows many new
notifications / many updates — it should look like samomdkkuvpa." The person had
picked เจ้าหน้าที่คณะ in จัดการสิทธิ์, yet got the VP-Admin inbox (every project,
nothing seen ⇒ everything badged "อัปเดต"). Looks like an unread-state bug; the
seen-state code is fine (per-user `project_doc_views` + user-scoped localStorage).
**Cause**: `effective_team_project_seats_for_email()` UNIONed the person's own
`project_seat` with every seat inherited from their ตำแหน่ง, and the frontend
`projectSeatRole()` then resolved the array with `SEAT_ORDER = ['vpa','staff','prof']`
— *widest first*. Their ตำแหน่ง (หัวหน้าฝ่าย IT) carries `vpa`, so picking `staff`
yields `{staff,vpa}` → `vp_admin`. Proven live by simulating the pick in a
rolled-back transaction. **The union is what makes the pick meaningless**: for an
additive grant (permissions, VS depts) union is right — you can hold PR *and*
inherit ประกาศ. A seat is a single role in one workflow; two seats is not a wider
grant, it is an ambiguous one, and any "pick the widest" tiebreak turns the
narrower explicit choice into a no-op.
**Fix (0092)**: nearest explicit binding wins. A person's own seat REPLACES
inheritance; `node_effective_project_seats` returns at the FIRST ancestor naming a
seat instead of collecting all of them. `SEAT_ORDER` survives only as a tiebreak
across two genuine postings. The three UI sites that painted "own + inherited"
chips now show one or the other, or the modal advertises a grant that doesn't
resolve.
**Where**: `supabase/migrations/0092_project_seat_parity.sql`;
`src/js/team/index.js` (`inheritedSeatsFor`, `nodeEffectiveSeats`,
`refreshMemberPermEff`, both chip renderers); `src/js/projects/index.js`
(`SEAT_ORDER` comment). Proof: `tools/proj0092-seat-parity.mjs`.
**Rule**: before making a dimension inheritable, decide whether it is ADDITIVE or
EXCLUSIVE. If two values cannot both be true of one person, inheritance must
OVERRIDE, never union — and never resolve the ambiguity with "widest wins", which
silently upgrades privilege. Same family as the 0083 VS entry ("a narrowing scope
added alongside an unconditional permission is DEAD") and the 0087 passport-scope
`permTicked` entry: whenever a grant's storage becomes polymorphic, every reader
must agree on which representation wins.

**Three more role-only gaps fell out of the same sweep** — the 0089/0090/0091 rule
("enumerate EVERY table the feature writes AND every audience lookup") had still
missed a table and a helper:
- `project_sign_requests` INSERT/UPDATE/DELETE were `role in ('uni_staff','dev')`,
  so a `staff` seat could act on a document but could not **ส่งให้อาจารย์ลงนาม** —
  the one thing เจ้าหน้าที่คณะ exists for. Now `current_user_is_project_uni_staff()`
  (role OR seat). Deliberately NOT `current_user_is_project_actor()`, which also
  admits `vpa` — the sender does not request signatures.
- `project_settings` write was `role in ('vp_admin','dev')` → the `vpa` seat opens
  การตั้งค่า and cannot save.
- **A regression 0091 shipped**, hitting the REAL `saprof` account in production:
  `list_project_seat_users()` guards on `current_user_is_project_actor()`, which is
  deliberately false for a professor (0086 — a prof must not see every project).
  But `notifySignDecision()` runs AS the professor and asks for the staff + vpa
  audiences, so both returned **zero rows** and the professor's sign/reject
  notified nobody. It returns an empty set rather than an error, so the role-only
  fallback in `api.js listProjectSeatUsers` never fired either. Measured: as
  saprof `staff=0 vpa=0`; as sastaff `staff=1 vpa=11`. Now a prof may READ an
  audience (still id + display_name only) — reading "who is the คณะ" is not the
  same capability as being an actor.
**Rule**: when you narrow a helper that an audience/notification lookup depends
on, check every ROLE that calls it, not just the ones it was written for — an
authorization predicate reused as a *directory* query fails silently and empty.

---

---

## A permission channel has TWO halves — writes AND reads. `current_user_is_staff()` is a role list, so every read gated on it silently excluded tree-granted accounts

**Symptom** (found by a sweep, before most of it was reported): a `creator`
grantee could WRITE an announcement and then not SEE it. `announcements_write`
honours `current_user_has_permission('creator')`; `announcements_read` was
`status = 'approved' OR current_user_is_staff()`. A tree-granted account is
`role='user'`, so drafts and pending posts vanished from เขียนประกาศ and
ลำดับการแสดงประกาศ — the writer's own unpublished work, invisible to them.
Write-only access is the nastiest shape of this bug: the save succeeds, so
nothing looks broken until you go looking for the row.
**The sweep that found it** (worth re-running after any RLS change):
```sql
select tablename, policyname, cmd, coalesce(qual,'')||' '||coalesce(with_check,'')
  from pg_policies where schemaname='public';
```
then flag every policy matching `current_user_role|current_user_is_staff` that
does NOT also match `has_permission|managed_|current_user_.*scope|_seats`. That
turned up 7, of which 3 were real: `announcements_read`, `vs_followers` /
`vs_public_comments` read (a VS dept-scoped handler could administer a ticket but
not read its followers or staff comment thread), and `analytics_events`
(สถิติการใช้งาน is offered to anyone who can use the admin app).
**The fix that would have been WRONG**: broadening `current_user_is_staff()`
itself. It is what `users_self_update_guard` (0028/0041) trusts to allow
privileged-column writes — widening it lets any tree-granted account
`update users set role='dev'` on itself. Each policy was repointed individually
instead: announcements → `+ has_permission('creator')`; VS →
`current_user_is_vs_handler()` (already "staff OR any VS scope");
analytics → a new `current_user_has_any_grant()`. 0093's proof asserts the
non-widening explicitly, with a real self-promotion attempt.
**Where**: `supabase/migrations/0093_shop_scope_and_grant_reads.sql`; proof
`tools/shop0093-scope.mjs` (18 checks).
**Rule**: when you add an access channel, the enumeration covers **writes,
audience lookups (0091), AND reads**. A read gated on a role list is invisible
until someone with the new channel goes looking for data they just created. And
never widen a predicate that a security trigger also consumes — check
`grep -rn "current_user_is_staff" supabase/migrations/` before touching it.
**FOURTH surface, found 2026-07-30 (0102)**: a **SECURITY DEFINER RPC's own
`raise` guard**. 0093 repointed the `analytics_events` TABLE read to
`current_user_has_any_grant()` but left `analytics_overview()` raising
`'analytics_overview: staff only'`. สถิติการใช้งาน is offered with NO permission
requirement (`SIDE_FEATURE.analytics = null`), so every ทีม SAMO grantee saw the
menu item and got `P0001 staff only` on open. The table and the function
disagreed about the same question. Fix: the SAME predicate in both, so they
cannot drift. So the enumeration is: **writes · reads · audience lookups ·
definer-RPC guards**. Sweep for the last one with
`select proname from pg_proc where pg_get_functiondef(oid) ~ 'current_user_is_staff'`.

---

---

## Deriving "which department is this admin" from a UI filter is not a permission — SAMO Shop had one grant and a localStorage preference

**Symptom / premise to correct**: "samoshop has two workflow permissions, for
samomdkkuvpa and samomdkkumdi". It did not. There is ONE `samoshop` permission
and both accounts simply held it; `current_user_is_shop_admin()` was
`role in ('shop_admin','dev') OR has_permission('samoshop')` and EVERY shop table
hung off that single predicate. What looked like two workflows was
`shop_products.source` (md/rt/mdi/sittikao, the 0058 ownership key) driving a
**localStorage** filter default — a UI preference the admin could clear, not a
boundary.
**Fix (0093)**: a real scope — `team_nodes/team_members.shop_source` →
`users.managed_shop_sources` → `current_user_shop_scope()` (NULL = every source,
`{}` = none, else the list), shaped like `current_user_vs_scope()` so no caller
can read "no access" as "all access". Product writes are confined by
`current_user_owns_shop_source(source)`.
**What was deliberately NOT scoped, and why it matters**: ORDERS. One order can
hold items from several sources — that is what a shared cart means — so "MDI's
orders" is not a property of a row, it is a property of *some of its items*.
A policy pretending otherwise would either hide orders that contain MDI items or
expose orders that contain everyone's. Splitting order access per source means
splitting the ORDER, which is a product decision. Orders stay admin-wide and the
UI keeps filtering them by `product_source`. **Shipping a policy that LOOKS like
it isolates departments but doesn't is worse than shipping none** — write down
the boundary you did not draw.
**Also**: a scoped admin's product LIST is filtered client-side to their sources.
Not for secrecy (the catalogue is public) but because rows they cannot write
would render with live-looking Edit/Delete buttons that every click 42501s on.
**REVERTED BY 0094 — and the reason is the lesson.** The user's answer was "SAMO
Shop is one role, I want it full, both": a product-only scope isolates nothing
anyone cares about, because ORDERS — the thing a department actually works out
of — cannot be scoped. Building the scopeable half of a boundary and leaving the
meaningful half shared produces a setting that looks like isolation and isn't.
**The right question was "what does a department need to NOT see?", not "which
column can I scope?"** — the answer would have been "orders", and that would have
surfaced the mixed-source problem before any code was written. All the shop
scoping is gone (helpers dropped, policy restored, picker removed); the
`shop_source` / `managed_shop_sources` columns remain inert and unread.
**Do not re-add a source scope without being asked.**
**Where**: `supabase/migrations/0093_*.sql` (added) and `0094_*.sql` (reverted).

---

---

## A seat that grants a SHARED role must not be modelled as a new individual — the อาจารย์ seat built a private desk instead of opening the existing one

**Symptom**: "on saprof there are 11 shown in ทั้งหมด, but on my kkumail granted
อาจารย์ in ทีม SAMO it shows 0." Both accounts resolve to `sa_prof`; the grant,
the seat resolver and the RLS all check out. Easy to answer "working as designed
— nothing has been sent to you yet", and that answer is *technically* right and
*practically* wrong.
**Cause**: every prof gate keyed on `sign_requests.prof_id = auth.uid()` —
`prof_can_see_document/_project/_file`, the sign-request read+update policies,
`scopeProjectsForRole()`, `docPendingSignForProf()`, and the file filter in
`loadFilesForDoc`. So the seat produced **a brand-new professor with an empty
desk**, when what the org wanted was **access to the professor's desk**. The
other two seats already behaved the second way (`staff` sees what sastaff sees,
`vpa` what samomdkkuvpa sees) because uni_staff and vp_admin are not per-person
filtered — prof was the only per-uid one, so the inconsistency was invisible
until someone held the seat.
**The signal I should have caught earlier**: this org runs SHARED department
accounts and the repo already records "don't design per-person assignee/roster
features". A per-uid recipient IS a per-person assignee. When a seat exists to
let a real person occupy a shared institutional role, "scoped to me" is the
wrong default — the role is the unit, not the individual.
**Fix (0095)**: the helpers now ask "am I อาจารย์, and was this sent for
signature at all?" `current_user_is_prof()` stays INSIDE each helper — the
policies OR them in, so a helper that ignored the caller would hand every
signature-requested document to any authenticated user. Frontend filters follow
the same rule.
**What deliberately did NOT change**: a professor is still not a project actor.
They see only หนังสือ carrying a signature request (11 of 26 live), never the
other 15, and inside a requested หนังสือ still only the requested + signed files,
never the private drafts. Making prof an actor exposes all 26 — rejected in 0086,
still rejected. Proof `tools/prof0095-seat-parity.mjs` asserts BOTH halves: same
desk as saprof, AND still cannot create a project or request a signature.
**Tradeoff written down**: every อาจารย์ now sees every signature request, so two
professors would see each other's. Correct for one shared role, wrong the day
per-professor privacy is wanted — and the fix then is the uid check PLUS a "which
professor am I" dimension, not a plain revert (which would empty the seat again).
**Rule**: when adding a seat/grant that lets an individual act as a shared role,
ask "should this person see what the shared account sees, or start empty?" for
EACH surface. If the answer is "the same", any `= auth.uid()` predicate on that
surface is a bug in waiting — and it will look like correct behaviour, because an
empty inbox is indistinguishable from a working one with nothing in it.

---

---

## WEAKENING the meaning of a permission key silently PROMOTES every gate that still treats it as the strong one

**Symptom**: 0110 split ทีม SAMO's `team` permission into `team` (view) and
`team_edit` (write), and granted `team` implicitly to all ~285 people with a
posting in the tree. `tools/team0110-view-edit.mjs` went 34/34. Then
`tools/team0104-terms.mjs` — a proof from a different feature, run only because
this repo's rule is to re-run the whole `tools/` suite after any RLS change —
went 37/40:
```
FAIL other permissions alone cannot write team_terms
FAIL publish_team_term refuses a caller without `team`
FAIL team_term_status refuses a caller without `team`
```
Every one of the 285 members could create/edit ปีการศึกษา, write the
`team_people` register, edit the published archive snapshots, and publish or
close an academic year.
**Cause**: the well-logged class here is *"a new access channel must be threaded
through EVERY gate the old one used"* (0089 → 0090 → 0091 → 0093 → 0102). This
is its mirror image, and it is easier to miss because nothing is being ADDED:
the key `team` kept its name and its spelling, so nothing looked like it needed
revisiting — but its MEANING moved from "may manage ทีม SAMO" to "may look at
it", while four tables (`team_terms`, `team_people`, `team_archive_nodes`,
`team_archive_members`) and two SECURITY DEFINER RPCs (`publish_team_term`,
`team_term_status`) still read it as write authority. Demoting a key promotes
every gate that still consumes it, in one step, silently.
**Fix**: 0110 §8 gives those four tables the same read/write pair as
`team_nodes`/`team_members` and repoints both RPC guards at `team_edit`. The
enumeration is mechanical, never from memory — and note it must cover **policies
AND definer-RPC guards**, the same four surfaces as the additive case:
```sql
select tablename, policyname from pg_policies
 where schemaname='public'
   and (coalesce(qual,'')||coalesce(with_check,'')) ~ 'has_permission\(''<key>''\)';
select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and pg_get_functiondef(p.oid) ~ 'has_permission\(''<key>''\)';
```
Run it again after the fix and read what remains: here `get_my_team_seat()` still
names `team` and is CORRECT, because it is asking "may this person view?" — the
sweep tells you where to look, it does not tell you the answer.
**Where**: `supabase/migrations/0110_team_view_edit_split.sql` §8; proofs
`tools/team0110-view-edit.mjs` (now asserts read-yes/write-no on all four
tables) and `tools/team0104-terms.mjs`.
**Rules**: (1) changing what an existing permission key MEANS is the same size
of change as adding one — run the same enumeration, in both directions.
(2) Prefer a NEW key for the stronger meaning and leave the old key weak
(`team` stayed view, `team_edit` is new), so any gate you miss fails CLOSED for
the strong operation instead of open. Had it been done the other way round —
`team` keeps write, a new `team_view` is added — a missed gate would have been a
lockout, which someone reports in minutes; the way round it was actually done,
a missed gate is a silent privilege grant nobody notices. **This is why the
whole `tools/` suite gets re-run, not just the proof for the migration you
wrote**: 0110's own proof was 34/34 green while this was live.

---

## `master` opened the tab but not the ROLE-gated controls inside it

**Symptom** (reported 2026-08-17): a person holding `master` (ทุกระบบ,
inherited from ฝ่าย IT) opened the app on their personal @kkumail.com and found
features "stripped off" versus the shared `samomdkkudev` (role=`dev`): the
"ไม่ส่งแจ้งเตือน Discord" toggle on the PR/VS forms was gone, and the VitalSound
workspace hid its full-department controls.

**Cause**: `master` answers YES to every *permission* question — `userCanAccess`,
and the DB `current_user_has_permission` which folds `master` (0111). So the TAB
opens (`userCanAccess('vs')` → true) and RLS grants the rows
(`current_user_vs_scope()` = null-super for `has_permission('vs')` ← master). But
a master holder is `role='user'`, so every gate written against the ROLE —
`role === 'dev'` (`main.js` `.dev-only-feature`) and the literal role list in
`isVsSuper()` (`vs-staff.js`) — skipped them. The DB said super; the frontend
said not-super. Classic frontend/DB mismatch, and the fifth surface of "a new
access channel must be threaded through EVERY gate": `master` was threaded
through the permission gates and the RLS, and missed the ROLE gates.

**Fix**: `main.js` `.dev-only-feature` now toggles on
`role !== 'dev' && !holdsMaster(user)`; `isVsSuper()` adds `|| holdsMaster(u)`,
mirroring the DB. Guard: `src/js/master-role-gates.test.js` (both assertions
falsified — they go red when the `holdsMaster` term is dropped).

**Where it lives now**: `src/js/main.js` (the `.dev-only-feature` loop),
`src/js/vs-staff.js` `isVsSuper()`, guarded by
`src/js/master-role-gates.test.js`. **Left as-is by the owner's decision**: the
~28 `role === 'dev'` gates in `src/js/projects/*` (the หนังสือ send flow) — that
module is driven by the project-seat picker, not by master.

**Rule**: when a permission key is meant to imply full access, grep for the
ROLE-literal gates too, not just the permission gates —
`grep -rn "role === '\''dev'\''\|=== '\''dev'\''" src/js/`. `holdsMaster()`
belongs anywhere `role === 'dev'` grants a capability that master should also
grant. A gate that reads the ROLE cannot see a permission, and master is a
permission.

---

## "when i select permission as master, i cant select sub of the หนังสือโครงการ"

**Symptom** (2026-08-18, with a screenshot): granting `master` in ทีม SAMO made
the หนังสือโครงการ **บทบาท** un-selectable. The dropdown was visible and
enabled, the admin could pick "ผู้ส่งหนังสือ (SAMO)", บันทึก reported success —
and re-opening the modal showed it empty again. The workaround in the field was
to untick master and hand-tick seven individual permissions instead, which is
the exact rot `master` exists to prevent.

Underneath it, a second and larger symptom nobody had reported: a master holder
opening หนังสือโครงการ got the tab and **nothing inside it** — no ส่งหนังสือ
button, no inbox controls, a blank role hint. Measured on the live DB: **36 of
41 master holders** were in that state. The other 5 worked, which is why it
looked intermittent — they happened to inherit a `vpa` seat from a parent
ตำแหน่ง.

**Cause** — two halves of one mistake, both reading the seat as if it were a
*scope*.

*The editor half.* `readPermInputs` returned `project_seat: null` the instant
`master` was ticked, alongside `vs_dept: null` and `passport_*: null`. For VS
and Passport that is correct and deliberate (0083: a scope stored beside the
blanket key is swallowed by it). But VitalSound แผนก and Passport ฝ่าย are
**scopes** — each has a widest value and master IS that value — while the
หนังสือโครงการ seat is not. `vpa` / `staff` / `prof` are three **desks in one
transaction** (sender → receiver → signer); there is no "all three" desk to
draw, so nulling it did not mean "the widest", it meant "nobody". Worse, the
three scope pickers stayed VISIBLE and ENABLED under master —
`syncMasterVisibility` only disables checkboxes, never the selects — so the form
offered three live controls whose values were all discarded on save.

*The frontend half.* `projectSeatRole()` in `src/js/projects/index.js` read the
raw `users.managed_project_seats` column. SQL does not:
`current_user_project_seats()` (0111) is
`when current_user_has_permission('master') then array['vpa','staff','prof']`.
So RLS treated a master as a project actor AND a prof, while JS resolved
`role='user'` — hiding every `[data-projects-role]` block and blanking
`projectsRoleHint`. The migration's own comment asserts *"`projectSeatRole()`
resolves the widest (vpa)"*. It never did. A comment saying "keep in step" is
not a mechanism.

**Why the previous sweep missed it.** The 2026-08-17 master≠role write-up above
ends by explicitly LEAVING the `role === 'dev'` gates in `src/js/projects/*`,
on the reasoning that "that module is driven by the project-seat picker, not by
master". That was true and it was the wrong conclusion, because nobody asked
what the seat picker *did* under master — it was being erased. And the guard
written after that report (`master-role-gates.test.js`) swept for `role === 'x'`
literals, which `projectSeatRole` does not contain: **it does not GATE on a
role, it PRODUCES one**, upstream of all 28 of them. A sweep shaped like the
last bug cannot see the function that feeds it.

The DB proof was green throughout. `tools/master0111-grant.mjs` asserts "holds
all three หนังสือโครงการ seats" — but it asks the *database*, so it could not
see the frontend at all.

**Fix**
- `projectSeatRole()` folds master as a **floor**, not an override: an
  explicitly stored seat still decides the desk. Master says *may*; the seat
  says *which screen*. Under-showing relative to RLS is safe; the reverse is not.
- `readPermInputs` keeps `project_seat` under master and still nulls the two
  real scopes.
- The VS and Passport pickers are now **hidden** under master (replaced by one
  line saying master already covers them) instead of live-and-discarded.
- The บุคคล editor **pre-fills ผู้ส่งหนังสือ** when master goes on, marked
  `dataset.masterAuto` so turning master back off removes a value the form
  invented (the `preMaster` rule, one control over) and cleared by
  `resetMasterState` so it cannot leak onto the next row opened.
- A ตำแหน่ง is deliberately **not** pre-filled: a node seat inherits down the
  subtree, and simulating it on the live tree showed it would hand `vpa` to
  **57 more people**, each then on `list_project_seat_users('vpa')` — i.e.
  notified on every หนังสือ update in the faculty. That row shows the head-count
  instead.

**The part that is invisible and mattered most**: the stored seat is not only a
screen. `list_project_seat_users()` / `list_project_profs()` read
`managed_project_seats` to decide **who gets notified** (`projects/notify.js`)
and **who can be picked as the signing อาจารย์** (`projects/sign.js`). So the
null seat also meant the bell never rang and nobody could address them. Note the
asymmetry the DB already encodes and the fix mirrors: the CALLER-scoped
`current_user_project_seats()` folds master, while the PUBLISHED
`managed_project_seats` column does not — access is implied, a directory listing
is declared.

**Where it lives now**: `src/js/projects/index.js` (`MASTER_SEATS`,
`projectSeatRole`), `src/js/team/index.js` (`readPermInputs`, `masterOn`,
`syncMasterSeatDefault`, `seatFanoutCount`, `permChipsHtml`).
Guards: `src/js/projects/seat.test.js` (differential — the expected seats are
PARSED out of `0111_master_grant.sql`, never retyped), `src/js/team/master-seat.test.js`
(behavioural, calling the real functions with plain-object DOM stand-ins), and
`src/js/master-mirrors.test.js` (the ratchet below). All falsified by
reintroducing each bug.

**Rule**: when one grant is defined to imply another, the implication is a rule
on BOTH sides of the wire — and the JS side is not found by grepping for gates,
because the drift can live in the function that COMPUTES the value every gate
reads. Enumerate the SQL functions that special-case the key and keep a registry
of where JS says the same thing. And before nulling a field because a stronger
grant "covers" it, ask whether the field is a SCOPE (has a widest value, which
the stronger grant is) or an IDENTITY (names one of several roles, which no
amount of access answers). Only the first is safe to erase.


## "I set SAMO Passport for the ฝ่าย and it doesn't show" — the grant was live; only the chip was missing

**Symptom, as reported (urgent).** *"why i set samopassport permission in the
admin teamsamo ฝ่ายกิจการมหาวิทยาลัย as กิจการมหาวิทยาลัย ทั้งฝ่าย(ทุกแผนกย่อย)
and it doesn't show on the จัดการสิทธิ์ of admin teamsamo, and i'm not sure if
they couldn't access it now."* The row for that ฝ่าย showed only
`จองโควตา Claude`. Reopening the editor showed the tick and the scope correctly.

**They could access it.** Asked of the server's own resolver rather than
inferred: `node_effective_passport_scopes` returned `d:5` for **all 51** people
under that ฝ่าย, and all 19 who had ever signed in already carried `d:5` in
`users.managed_passport_scopes`. Nothing was broken and nobody was locked out.

**Cause.** `readPermInputs` DROPS the `passport` key the moment a scope is
chosen — scoped-is-not-full, the 0083 rule — so a scoped grant stores
`passport_dept_id` and **no capability key at all**. `permChipsHtml` renders the
capability keys plus two hand-passed scopes: the VitalSound แผนก and the
project seat. There was no passport parameter, so a scoped grant drew nothing.

⚠️ **The first investigation got this wrong and nearly reported an outage.** It
swept for `'passport' = any(permissions)` — which by construction can never
match a scoped grant — found only one unrelated ฝ่าย, and concluded nobody had
access. **The query was built from the same model the bug lives in.** The tell
was in the data and was misread: the node showed `permissions: ['claude']`,
which is exactly what a *correctly saved* scoped passport grant looks like.

**Fix.** `permChipsHtml` gains `passOwn` / `passInherited`, with
`passportToken()` mirroring `public.passport_scope_tokens` (a sub-department
wins over its department) and an inheritance walk mirroring
`node_effective_passport_scopes`. Hidden under `master`, like the VS chip, since
master IS the widest scope and naming a narrower one understates it. The chip
gets its own CSS class **and a live rule** — a class the renderer emits with no
rule is a feature nobody built.

**Where it lives now.** `src/js/team/index.js` (`passportToken`,
`inheritedPassportScopesFor`, `nodeEffectivePassportScopes`,
`passportScopeLabel`, the chip block), `src/css/team.css` `.is-pass`, guarded by
`src/js/passport-scope-chip.test.js` — verified by deleting the chip block and
watching exactly three assertions fail, with the control and the master case
still passing.

**⚠️ AND THE FIX HAD A SECOND HALF, reported minutes later: "currently it
render like ฝ่าย #5".** The chip was right; nothing was fetching the ฝ่าย NAMES
for the tree. They live in the passport schema behind
`list_passport_departments()`, and only the two permission MODALS ever called
the loader — so a row painted in perms mode had an empty catalog and every chip
fell back to its id. `render()` now requests the catalog once when the
permission tree is on screen and re-renders when it arrives. **A legible
fallback made the gap survivable and also made it invisible**: the chip never
looked broken, so nothing said the names were missing. When you add a fallback,
ask what is supposed to RELIEVE it, and whether anything actually does.

**The general rule.** *A grant that is stored by DROPPING a key needs every
reader taught the new shape — and the reader people actually look at is the
one that says whether the grant exists.* This is the SECOND TWIN again (0149):
VitalSound got a scope chip when scopes were invented; Passport later got the
column, the editor, the inheritance walk and the SQL resolver, and not this one
reader. **When you add a scope, grep for every place the OLD scope's value is
rendered, not just where it is stored.** And when a report says "it does not
show", establish whether it does not EXIST or does not DISPLAY before touching
anything — they need opposite fixes, and only one of them is an outage.


## The same bug in three more readers — swept for on purpose, 2026-08-30

After the จัดการสิทธิ์ chip was fixed, the obvious question was **where else does
a reader test for a key that a scoped grant does not carry.** The sweep is one
grep — `includes('vs')` and `includes('passport')` across `src/` — and it found
three more places plus two that were already right. Numbers are from production
that day.

**FIXED — `ctaFor()` in `my-seat.js`, the person's own card.** It read only
`seat.permissions`, so the shortcut button was missing for **42 people** holding
a passport ฝ่าย with no `passport` key, and **3** holding a VitalSound แผนก with
no `vs` key. Their card knew about the scope — `scopeRows()` right below it
prints one — and the button beside it said nothing. It now takes the whole
`seat` and treats a scope as the grant it is.

⚠️ **This was first written up as "offered no way in at all", which is WRONG,
and the owner caught it**: *"i thought everyone even not admin can open
samopassport"*. They are right. `passport_admin_context()` is the authority —
`is_admin` is the blanket permission **or any scope**, and `all_departments` is
the blanket one alone. **Every kkumail student can open SAMO Passport and
collect stamps; that was never gated.** The grant is passport ADMIN rights over
a ฝ่าย's activities. So the defect was a missing SHORTCUT on a card, not a
lockout — real, worth fixing, and an order of magnitude less severe than first
stated. *Read what a permission actually gates before describing what its
absence costs; the function that reads it will tell you, and "permission named
after an app" does not mean "permission to open the app".*

**FIXED — the collapsed member tag in `team/index.js`.** `${eff.length} สิทธิ์`
counted capability keys, so a member whose only grant was scoped rendered **no
tag at all**: the row read as "no permissions" about someone who had them.

**LATENT, left alone deliberately — `userCanAccess('passport')`.** It has an
explicit branch for a scoped `vs` and for a `projects` seat, and none for
passport; `managedPassportScopes` is not loaded onto the user object at all.
**Nothing calls it today** (`passport` is not in `ADMIN_FEATURES` — a passport
grant is not admin access, and the app has its own gate), so this is a trap
rather than a bug: the next person to add a passport link to the portal will
gate on it and deny 42 of the 45 holders. Written down rather than
speculatively built.

**Already correct, checked not assumed** — `isVsSuper()` in `vs-staff.js` tests
the blanket key ON PURPOSE (super = every department) and `vsScopeDepts()`
handles the scoped case; `readPermInputs`'s two confirmation guards read
`out.permissions`, which by design holds the key only for the escalating
"ทุกฝ่าย / ทุกแผนก" case; and `team/io.js` carries **both** passport columns for
nodes and members, so an export/import round-trip does not widen a
sub-department grant to its whole ฝ่าย.

**The general rule.** *When a value is stored by REMOVING a key, `grep` for
every test of that key the same day.* The set is small and enumerable — it took
one grep — and each hit is either a bug or a deliberate decision worth a
comment. **Do the sweep at the moment the dropping rule is invented**, not two
migrations later when someone reports the third symptom of it.


## A scope line under `master` understates it — the same rule, a second reader

**Symptom.** None reported; found by scanning for other instances. Both `master`
holders in the tree were being told, on their own seat card, *"VitalSound:
เฉพาะ บริหารองค์กร"* and *"SAMO Passport: เฉพาะบางหน่วยงาน (1)"* — while master
folds every permission and they were in fact reading every department.

**Cause.** They hold `master` on a member row while a vs_dept and a passport
scope are inherited from an ancestor NODE, so `effective_team_*_for_email`
correctly returns both. `scopeRows()` printed any scope whose blanket key was
absent — and a master holder's `permissions` contains `master`, not `vs` or
`passport`.

`permChipsHtml` in the admin tree **already had this rule** and says why in a
comment: *"master is already its widest value — so under master it UNDERSTATES"*.
`scopeRows` is the second reader of the same fact and never learnt it.

**Fix.** `hasMaster` gates both scope lines. The หนังสือโครงการ **seat** is
deliberately not gated: a seat is an IDENTITY (ผู้ส่ง / เจ้าหน้าที่ / อาจารย์),
there is no "all three" desk, and master keeps whichever desk was stored — the
0111 lesson about nulling the seat.

**⚠️ The guard's own first draft asserted nothing.** It matched the raw
department KEY (`อุปนายกฝ่ายบริหารองค์กร`), which `VS_DEPT_LABEL` never
renders — it renders `บริหารองค์กร`. The `not.toContain` passed vacuously. Only
the paired CONTROL — "the same scopes DO show without master" — failed and
exposed it. **A negative assertion needs a positive twin over the same input**,
and both must be scoped to the block under test, because `บริหารองค์กร` also
appears in ordinary copy elsewhere on the card.

**Where it lives now.** `src/js/my-seat.js` `scopeRows()`, guarded by
`src/js/my-seat.test.js`.

**The general rule.** *When a grant has a WIDEST value, every reader that
narrows it must know which grants already ARE that value.* Master is the widest
VS แผนก and the widest passport ฝ่าย, so any UI that says "เฉพาะ …" has to ask
first. Grep for the rule's existing statement — it was already written down one
file away.

## A SIXTH scope dimension — what "thread it through every gate" actually cost, itemised

**Not a bug report.** 0177 added per-ฝ่าย page editing, and the grant is the
fifth thing modelled as a scope (permissions, VS แผนก, project seat, passport
scope, shop source). Class 5 says a new access channel must be threaded through
every gate the old one used; this is the enumeration, written down because the
last four times it was rediscovered one gate at a time — each rediscovery being
a separate reported bug.

**The gates, all of them:**

| # | Gate | What happens if you miss it |
|---|---|---|
| 1 | `team_nodes.dept_page` + `team_members.dept_page` | nowhere to grant it |
| 2 | `node_effective_*` + `effective_team_*_for_email` | the tree row resolves to nothing |
| 3 | `sync_my_team_permissions` | resolves at login, then reverts |
| 4 | `recompute_team_managed_permissions` | a tree EDIT does not reach existing users |
| 5 | `users_self_update_guard` | a user can grant it to themselves |
| 6 | `current_user_*_scope()` + the RLS policies | the grant reaches no table |
| 7 | `auth.js` select + sync mapping + `userCanAccess` | **the DB allows it and the UI never shows it** |
| 8 | the perms modal: fill, visibility, load, save | the grant cannot be made, or is wiped on re-open |
| 9 | the CHIP | the grant is invisible to the admin who made it |
| 10 | `io.js` export/import | a team export silently drops it |
| 11 | `photo_reference_count`, if the feature holds a `*_url` | the cleanup destroys a file still in use |

⚠️ **Three of those are not where anyone looks.** #7 is the one this repo has
paid for most (0089→0093→0102): a person scoped to ONE ฝ่าย holds no permission
key at all, so `userCanAccess('dept_pages')` is false and the sidebar hides the
screen the database would happily let them write. #9 was reported for real about
Passport on 2026-08-30 — *"i set samopassport … and it doesn't show"* — where the
grant was live the whole time and only the chip was missing. #11 was caught here
by a guard test on the same commit, not by a person.

**Two decisions this shape forces, and they have different answers:**

- **ADDITIVE or EXCLUSIVE?** A page grant is additive: holding two pages is
  holding two. A project SEAT is exclusive, which is why 0092 had to make the
  nearest binding REPLACE what it inherits — two seats is not a wider grant, it
  is an ambiguous one, and "widest wins" silently upgrades privilege.
- **Does the blanket key subsume the scope?** Yes, and therefore they must be
  mutually exclusive ON SAVE (`readPermInputs` drops the key when a ฝ่าย is
  chosen). Store both and the scope is decorative, because permissive policies
  are OR'd — 0083, the first time this was learned.

**The general rule.** *A scope dimension is eleven edits, not one.* Adding one
"just like the last" and stopping at the tables is what produced 0089, 0090,
0091, 0093 and 0102 — five reports of one omission. Work this table.

---

## A "whitelist" that OPENED registration: `SIGNUPS_DOMAINS_WHITELIST` overrides `SIGNUPS_ALLOWED=false`

**Symptom.** The Vaultwarden config said, plainly and in this order:

```
SIGNUPS_ALLOWED=false
SIGNUPS_DOMAINS_WHITELIST=kkumail.com
```

Read as English that is "registration is closed, and doubly so — only kkumail".
The truth was the opposite: **any of KKU's ~40,000 `@kkumail.com` accounts could
register**, uninvited, from the open internet. Proven by doing it: a well-formed
POST to `/vault/identity/accounts/register` returned `200` and created an
account nobody had invited.

**Cause.** `src/config.rs`:

```rust
pub fn is_signup_allowed(&self, email: &str) -> bool {
    if self.signups_domains_whitelist().is_empty() {
        self.signups_allowed()
    } else {
        // The whitelist setting overrides the signups_allowed setting.
        self.is_email_domain_allowed(email)
    }
}
```

A **non-empty** whitelist means `signups_allowed` is **never read**. The second
line did not narrow the first; it replaced it. The setting added "as belt and
braces" was the entire hole, and the flag that looked like the gate was dead
code.

**It survived a deliberate check.** Earlier the same day a forum post saying
exactly this was tested — and DISMISSED, because a fetched summary of
`accounts.rs` asserted "the domain whitelist does not override a false
SIGNUPS_ALLOWED setting". That summary was wrong. The probe used to confirm the
dismissal was a malformed body, which returns `422` from the request parser
before any signup logic runs — so it could not have distinguished open from
closed, and it was read as reassurance.

**Fix.** `SIGNUPS_DOMAINS_WHITELIST` unset. **Empty whitelist +
`SIGNUPS_ALLOWED=false` is the only closed configuration.** It also improves
invitations: `is_email_domain_allowed()` returns true for every domain when the
whitelist is empty, which is what lets `@gmail.com` role accounts and
`@kku.ac.th` staff be invited at all. Guarded by `vault-config.test.js`, which
counts only ACTIVE assignments so the explanatory comment cannot satisfy it;
reintroducing the line turns it red.

**Where it lives now.** `server/vaultwarden/vaultwarden.env.example` (with the
function quoted inline), `vault-config.test.js`, `skills/vaultwarden.md`.

**The general rule.** *A setting named for what it RESTRICTS may be implemented
as what it PERMITS — and adding it can switch off the control beside it.* Two
security settings in sequence do not compose by intersection just because they
read that way in a file; find the function that reads BOTH and see which one
wins. And when a claim about a gate is dismissed, the dismissal needs a probe
that could actually have detected the hole: a request rejected by the PARSER
(422) never reached the gate, so it is evidence of nothing. Confirm a gate is
shut by performing the exact action it is supposed to forbid, in full, and
watching it fail — then delete what you created.

---

## Unlinking your Discord account was a permanent ฝ่าย role grant — and the hole had three doors, one of them an UPDATE

**Symptom (found by review, before it bit).** Press **ยกเลิกการเชื่อมต่อ** on
ข้อมูลของฉัน and you keep every mirrored ฝ่าย role for ever. No code path,
manual or automatic, could remove them.

**Cause.** The sync's central safety rule is §5e *"never act on absence"*,
implemented in `discord-apply.mjs` as:

```js
const t = byUser.get(m.user.id);
if (!t) continue;          // not linked → UNKNOWN → not in the plan at all
```

That is correct for someone who has **never** linked — an unlinked guild member
is not "entitled to nothing". It is **wrong** for someone who *was* linked, was
given roles because of it, and is not linked now. Both states were the same
observable: an absent row in `discord_links`. `unlink_my_discord()` (0186)
**deletes** the row, so the person vanishes from `discord_role_targets()` and
becomes indistinguishable from a stranger.

**Three doors, and a fix-per-statement closes two of them.** The obvious remedy
is to record the withdrawal inside `unlink_my_discord()`, or with an
`after delete` trigger. Either would have left the third open:

| | how the link goes away | shape |
|---|---|---|
| 1 | the person unlinks | `DELETE` |
| 2 | the person is deleted from the registry | `DELETE` (`on delete cascade`) |
| 3 | the person re-links to a **different** Discord account | **`UPDATE`** |

Door 3 is `redeem_discord_link_code`'s `on conflict (person_id) do update` — the
person moves A → B and account **A is orphaned holding every role it was given**.
0185 §76 already asserted "the OLD account is free for its real owner", so the
door is the design working as intended; nobody had asked what happens to the
roles left behind on it.

**Fix.** One trigger on the TABLE (`0187`), firing on insert, update **and**
delete, maintaining `discord_orphaned_accounts`. It records; it does not remove
— the removal policy is the owner's undecided "what makes a leaver", and
inventing it here would be worse than the gap. `discord-apply.mjs` now names
those accounts and the roles they still hold.

**Two things measured that contradict what was natural to write.**

- **A foreign key on `person_id` would break deleting a person.** It is the tidy
  thing to add, and door 2 makes the trigger fire *during* the cascade when the
  `people` row is already gone: the insert raises `23503 … Key (person_id)=… is
  not present in table "people"` and the whole DELETE aborts. So the FK does not
  merely lose the tombstone — it breaks an unrelated operation, and it would be
  discovered by someone removing a student, not by anyone testing Discord. The
  column is deliberately allowed to dangle, and the proof asserts that it does.
- **The `is distinct from` guard on the UPDATE branch is not what protects an
  unrelated edit.** Removing it leaves the proof fully green, because the
  withdrawal branch deletes the row the orphan branch just wrote, within the
  same statement. What actually catches that case is the **withdrawal**; remove
  both and §33 goes red. Recorded so nobody defends the wrong line.

**Where it lives now.** `supabase/migrations/0187_a_discord_account_nobody_claims.sql`
· `tools/team0187-orphaned-accounts.sql` (18/18, registered in `run-proofs`)
· `tools/discord-apply.mjs` · `src/js/discord-apply.run.test.js` — whose new
cases were watched failing against a tool reduced to the pre-0187 behaviour.

**The general rule.** *"Absent" is not a state — it is the absence of a state,
and several different histories produce it.* Before writing a rule that keys on
a missing row, enumerate what can remove that row, and ask whether every one of
those histories deserves the same answer. Here "never linked" and "withdrew"
needed opposite treatment and were the same query result. And when you do record
the difference, **put the mechanism on the TABLE**: this hole's third door was an
`UPDATE`, so every fix shaped around the word "delete" would have looked complete
and been two-thirds done.

---

## A claim reached `students` around the gate the importer goes through

**Symptom.** None, and there would not have been one for months. 0188 let a
student claim the held handover row that names them. Traced on samo-dev with a
registry row reading `รมิตา` and a held row reading `วรมิตา`: after the claim the
registry said `วรมิตา`, and `identity_conflicts` was empty. The import path, given
the same two values, keeps `รมิตา` and records the disagreement.

**Cause.** Both mirror triggers on `students` decide what kind of write this is
by looking at ONE column:

- `students_link_person` — `v_import := new.last_import_batch is not null`. When
  true, a value the registry already holds wins over the file's and the
  disagreement goes to `identity_conflicts`.
- `student_insert_mirror_up` — returns early when it is non-null; when null it
  pushes the new row's name UP into `people`.

`claim_my_student_seat` and `promote_unresolved_row` inserted without it. So two
brand-new doors for handover data into `students` took the opposite branch from
the door that data had always used, and did it silently — a null read as "this is
the person's own assertion" for data the person had never seen.

**And the example is not invented.** `653070078-2` in the 2026-09-14 file is
spelled วรมิตา by the สายรหัส table, รมิตา by ฝ่ายวิชาการ's, and her own kkumail
is `ramita.si@` — the file is the WRONG source for that name, and the claim path
was the one that would have let it win.

**Fix.** 0189 carries the held row's `batch_id` into `last_import_batch` on both
writers. Not a restatement of the precedence rule inside the two RPCs — that is
two implementations of one rule — but making the existing signal TRUE, because it
is: the row's data came from that batch. `batch_id` became NOT NULL with
`on delete restrict` in the same migration, because a null there reads as "not
import data", which is the wrong answer for a row that exists only because an
import could not use it.

**The sequel, one migration later.** `record_unresolved_rows` decided a seat was
settled by asking whether a STUDENT carries that รหัสนักศึกษา. With the registry
now winning on `student_id`, a claimer whose `people` row carries a different รหัส
lands under the registry's number — so nobody carries the held row's, and the seat
they just claimed came straight back on the next import. 0190 asks the resolution
instead: the `resolved_at` row IS the fact, and the student's รหัส was only ever a
proxy for it.

**Where it lives now.** `supabase/migrations/0189_*.sql`, `0190_*.sql`;
`tools/house0188-unresolved-seat.sql` §H (62/63/64) and §G (53/54).

**The general rule.** *A new access channel must be threaded through every gate
the old one used — and when a gate keys on a FLAG rather than on the caller, the
new channel has to set the flag, not hope the default is right.* The tell is a
boolean derived from `<column> is not null`: it answers for rows that were never
considered when it was written, and it answers with whatever absence happens to
mean. Ask what a null on that column means for EVERY writer, not just the one it
was designed around — and when adding a writer, grep for every branch that reads
the columns you are leaving unset.

## "Why did มิกซ์มี่ get หัวหน้าฝ่าย PR?" — nine people given the head's Discord role, and a sync that never looked at server-wide power

**Symptom (owner, 2026-09-19).** "why มิกซ์มี่ got role หัวหน้าฝ่าย PR, also many
people on discord". Nine members of ฝ่าย Content creator / Media management held
`หัวหน้าฝ่าย PR` — a role that manages 8 channels — hours after the sync ran.

**Cause 1 — a ตำแหน่ง used as a folder.** In ทีม SAMO those two sub-ฝ่าย sit
UNDER the ตำแหน่ง `หัวหน้าฝ่าย PR`. `discord_role_targets()` gave "your node's
role plus every ticked ancestor's" (DISCORD-ROLE-SYNC §5c), a rule written for
ฝ่าย, where belonging is inherited. Being under the head does not make you the
head. It was latent until that ตำแหน่ง was ticked in the 90 adopted that day.

**Cause 2 — found while auditing cause 1.** Every check that day was about what
a role opens IN CHANNELS. Nothing asked what a role can do SERVER-WIDE. So the
sync gave `สมาชิก SAMO Buddy` (MANAGE_CHANNELS + MANAGE_ROLES server-wide) to
one person, and the website's ฝ่ายเลขานุการนายกฯ had been linked that same
afternoon to `📇 ฝ่ายเลขานุการนายกฯ` — which carries ADMINISTRATOR and, being a
ฝ่าย, would have gone to everyone under it at their first link.

**Fix.** 0196: only DIVISION ancestors pass their role down; your own node's
role is always yours (proof `team0196`, which fails at 30 before the migration).
The same rule was copied three times in `discord-readiness.mjs` — all three
changed. The nine removed after checking each loses nothing they held that
morning. `discord-apply.mjs` now lists any role whose own permissions exceed
@everyone's in the power bits, and refuses to ADD it unless the owner names it
(`--allow-power`); the SAMO Buddy grant was reverted and the ADMINISTRATOR role
unlinked from the website.

**Where it lives now.** `supabase/migrations/0196_*`, `tools/discord-apply.mjs`
(`POWER_BITS`, `serverPowers`), `tools/discord-readiness.mjs`,
`src/js/discord-apply.run.test.js`.

**Rule.** A grant that FOLLOWS A TREE must say which kinds of node it follows
through — "everything above you" silently includes a position someone used as
a folder. And an access audit must cover every axis a key grants on: per
channel AND server-wide. The audit that found nothing on one axis was read as
"nothing"; after any bulk grant, diff every person's powers against the
morning, not just their rooms.
