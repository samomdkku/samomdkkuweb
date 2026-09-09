# Mistakes — RLS policies, SECURITY DEFINER & read paths

Postgres-level authorization. The densest file here, and the one that has bitten this repo most often. **Read before writing or changing any policy, `current_user_*` helper, or definer RPC.**

Each entry: **Symptom → Cause → Fix → Where it lives now**. The always-loaded index of every entry across all nine files is `.claude/rules/mistakes.md`; add new entries here, then run `npm run mistakes:index`.

---

## RLS inline subqueries silently depend on the referenced table's RLS

**Symptom**: Per-dept VP gate stops returning rows after someone tightens
an unrelated RLS policy on `public.users` (e.g. restricting `users_read_all`
to self-row only). No error — the dashboard just goes blank for VPs.
**Cause**: Policies like `vs_tickets_read` (0010), `vs_tickets_update_staff`
(0013), `vs_tickets_delete_staff` (0015) used
`target_dept = (select department from public.users where id = auth.uid())`
inline. That subquery runs under the *caller's* RLS, not as `security definer`.
It worked only because `users_read_all` (0001) was wide-open. The coupling
is invisible from the policy body.
**Fix**: For any cross-table lookup used in an RLS predicate, wrap it in a
helper function with `language sql stable security definer set search_path = public`
and `grant execute … to anon, authenticated`. Same pattern as the existing
`current_user_role()` / `current_user_has_permission()` helpers. The dept
lookup is now `public.current_user_dept()` (migration 0016).
**Where**: `current_user_dept()` defined in `0016_current_user_dept_helper.sql`;
all three `vs_tickets` policies repointed there. Don't reintroduce inline
`(select … from public.users where id = auth.uid())` in any new policy.

---

---

## RLS row-level policies don't gate per-column writes

**Symptom**: Any signed-in user can `PATCH /users?id=eq.<their_uid>`
with `{"role":"dev"}` and silently self-promote to dev — full admin
access. Nothing in the browser code does this; an attacker uses curl
or DevTools.
**Cause**: The 0001 RLS policy is
`for update using (id = auth.uid())`. PostgreSQL RLS is row-level
only — it gates *which rows* a caller can mutate, NOT *which columns*.
Once the row check passes, PostgREST happily writes any column the
user includes in the body.
**Fix**: A BEFORE-UPDATE trigger that compares OLD vs NEW and raises
on privileged-column changes for non-staff. Migration 0028 adds
`users_self_update_guard` for `public.users`. Pattern is reusable:
any table where the JS only writes a subset of columns but RLS
allows a per-row UPDATE needs the same kind of guard.
**Where**: `supabase/migrations/0028_users_self_update_guard.sql`,
plus `current_user_is_staff()` (broadened to all staff roles in
0005) used inside the trigger to let admin tools through. **Don't
ship a new `for update using (... = auth.uid())` policy without an
accompanying column guard if any sensitive column lives on the row.**

---

---

## `INSERT ... RETURNING` (a.k.a. `Prefer: return=representation`) re-applies the SELECT RLS policy to the inserted row

**Symptom**: VP-Admin sends a doc → `POST /rest/v1/project_notifications`
returns `403` with `{"code":"42501","message":"new row violates
row-level security policy for table \"project_notifications\""}`.
Browser console confirms the user is signed in (correct `sub` in JWT),
the user's role in `public.users` is `vp_admin`, the live RLS policy is
`with_check (current_user_is_project_actor())`, and calling
`/rpc/current_user_is_project_actor` with the exact same JWT returns
`true`. WITH CHECK clearly passes. INSERT still fails.
**Cause**: Postgres rule: when `INSERT ... RETURNING` (which PostgREST
emits whenever `Prefer: return=representation` is set), the row also
has to pass the SELECT policy or the entire INSERT is rolled back
with the same generic "new row violates row-level security policy"
message. Here:
- WITH CHECK on INSERT: `current_user_is_project_actor()` → ✅ vp_admin
- USING on SELECT:     `user_id = auth.uid()` → ❌ because `user_id`
  is the RECIPIENT (uni_staff), not the caller (vp_admin).
Same wording as a WITH CHECK failure, so it looks like a WITH CHECK
bug; the function returns true under impersonation/RPC and you chase
your tail.
**Fix**: Drop `prefer: 'return=representation'` on any write where
- the inserted/updated row targets a DIFFERENT user than the caller, AND
- the SELECT policy is "owner-only" (`user_id = auth.uid()` or similar).
Use `prefer: 'return=minimal'` (or omit). Callers that need to confirm
the write should check `error` only, not `data.length`. This **conflicts
with the "always check `data.length > 0`" rule** from the
silent-success entry above — that rule applies when the caller is
the *recipient* of the row (so SELECT passes naturally). When the
caller writes "on behalf of" someone else under owner-only SELECT
RLS, `return=minimal` is the only option.
**Where**: `src/js/projects/api.js` `createNotification`. Pattern to
audit on any other "write to another user's row" call site if SELECT
RLS is owner-only.

---

---

## Soft-delete changes the operation from DELETE to UPDATE — so it silently inherits the (usually broader) UPDATE RLS, not the DELETE RLS

**Symptom**: You convert a hard `DELETE` to a soft-delete by PATCHing a
`deleted_at` column. Authorization quietly changes: users who could *update*
a row but not *delete* it can now "delete" it — e.g. the VS owner-can-update
policy (0009) would let a SUBMITTER soft-delete their own ticket via a
crafted PATCH, even though VS deletion is meant to be staff-only — and any
per-row delete rules stop applying because the row's UPDATE policy has
different `using` / `with check` predicates.
**Cause**: PostgreSQL RLS is per-operation. `pr_tickets`/`vs_tickets` had
DELETE policies (pr_staff/dev; vs_staff/dev/has('vs')/vp_admin-own-dept) that
were deliberately narrower than their UPDATE policies (which include
has('pr') (0014), an owner-can-update policy (0009), and a vp_admin policy
whose WITH CHECK is about `target_dept`, not deletion). A `PATCH deleted_at`
runs under the UPDATE policies → wrong authorization. There's also no
column guard, so an owner could set `deleted_at` on their own row via curl.
**Fix**: Don't soft-delete via a raw PATCH when the DELETE and UPDATE
policies differ. Route soft-delete through a `security definer` RPC that
re-checks the SAME predicates as the original DELETE policy, then stamps
`deleted_at`. Reads filter `deleted_at is null` in-app (a deleted row stays
visible to a direct admin query for restore); guest-lookup RPCs must add the
filter too, or a deleted ticket stays trackable by id.
**Where**: `supabase/migrations/0043_soft_delete_tickets.sql`
(+ `0044_vs_delete_any_staff.sql` relaxed VS delete to any staff/VP)
(`soft_delete_pr_ticket` / `soft_delete_vs_ticket`, + the 0021 guest RPCs
recreated with the filter); callers in `src/js/pr-staff.js` /
`src/js/vs-staff.js`. Apply the RPC pattern to any future soft-delete whose
table's DELETE policy isn't identical to its UPDATE policy.

---

---

## `null in (...)` makes a `raise`-on-unauthorized guard fail OPEN

**Symptom**: A SECURITY DEFINER RPC guards itself with
`if current_user_role() not in ('staff','dev') then raise ...`. A caller
whose `current_user_role()` is NULL sails straight past the guard and runs
the privileged body instead of being rejected.
**Cause**: SQL three-valued logic. `null in ('a','b')` is `NULL` (not
`false`); `not NULL` is `NULL`; and `IF NULL THEN raise` does NOT execute
the then-branch (only TRUE does). So the guard is skipped — fails OPEN —
for any null input. `current_user_role()` is null when there's no
`public.users` row for `auth.uid()` (and for the service_role JWT, whose
`auth.uid()` is null).
**Fix**: capture the value and add an explicit null check that fails CLOSED:
`if v_role is null or v_role not in (...) then raise`. For an OR of
predicates, lead with `if v_role is null or not (...) then raise` so a NULL
inside the OR can't swallow the whole condition.
**Where**: `supabase/migrations/0045_soft_delete_null_role_guard.sql`
(hardens the 0043/0044 `soft_delete_pr_ticket` / `soft_delete_vs_ticket`).
Audit any `current_user_*() in/not in (...)` guard in a definer function for
the same fail-open. (Granting the RPC to `authenticated` only + a NOT NULL
role column kept it unexploitable here, but don't rely on that.)

---

---

## A per-recipient SELECT RLS policy is DEAD when a `using(true)` public-read policy already exists on the same table (policies are OR'd)

**Symptom**: You add a narrow "this user sees only their rows" SELECT policy
to `projects` / `project_documents` / `project_files` (e.g. to scope the new
professor `sa_prof` seat to "only หนังสือ sent to him"). It has no effect —
the professor (and in fact anyone with the anon key) can still read EVERY
project, document, and file, including private drafts.
**Cause**: migration 0032 (`*_read_public`) already granted
`for select to anon, authenticated using (true)` on those tables to power the
public customer mirror (`/projects-view`). Postgres RLS combines multiple
permissive policies with OR — a `using(true)` policy is unconditionally true,
so it swallows every narrower SELECT branch you add later. The project tables
are simply world-readable by design; SELECT RLS can't re-narrow them.
**Fix**: Don't fight the public-read policy. Enforce the per-recipient scope
at the UI/query layer instead, keyed off a table that DOESN'T have a public
policy. Here `project_sign_requests` has only the 0050 RLS (`actor OR
prof_id = auth.uid()`), so a doc's embedded `sign_requests` is non-empty for
the professor ONLY when it was sent to him — `scopeProjectsForRole()` in
`src/js/projects/index.js` filters his inbox on that signal, and
`loadFilesForDoc()` in `inbox.js` filters his file list to the requested +
signed files. The genuinely load-bearing prof RLS is the **INSERT** branch
(signed-file upload), because 0032 added no public INSERT policy.
**Where**: `supabase/migrations/0050_prof_sign_requests.sql` (the SELECT
branches are commented as DEFENSIVE); UI scoping in
`src/js/projects/index.js` + `inbox.js`. **Before adding any "owner-only"
SELECT RLS to a project table, grep the migrations for an existing
`*_read_public` / `using (true)` policy on it — if one exists, RLS won't
narrow reads; scope in the app off a non-public table instead.**

---

---

## A SECURITY DEFINER RPC over a ROW-SCOPED table leaks the restricted rows unless it re-applies the scope — the table's RLS does NOT protect a definer function

**Symptom**: `find_similar_vs_tickets` / `merge_vs_tickets` (0068) returned VS
tickets from ALL departments to a `vp_admin`, who by the `vs_tickets` read RLS
(0010) may only see their OWN department's tickets. A confidential complaint
system leaking other-dept problem text to the wrong VP.
**Cause**: the RPCs are `SECURITY DEFINER` (needed to compute similarity /
cascade across the table). SECURITY DEFINER runs as the owner and **bypasses
RLS entirely** — so the `vs_tickets_read` policy that scopes `vp_admin` to
`target_dept = current_user_dept()` simply does not apply inside the function.
The function authorized `vp_admin` but then queried the whole table.
(`vs_staff`/`dev` are fine — their RLS is unrestricted, so "see all" matches.)
**Fix**: re-implement the SAME scope predicate inside the definer function for
the restricted role: return only `target_dept = public.current_user_dept()`
rows for `vp_admin`, and reject cross-dept merges. Migration 0069.
**Where**: `supabase/migrations/0069_vs_dedup_dept_scope.sql`. **Rule**: whenever
a SECURITY DEFINER function reads/writes a table whose RLS is row-scoped by role
(dept, owner, tenant…), you MUST re-apply that scope in the function body for any
role that the RLS restricts — the definer bypass means RLS gives you nothing.
Audit every definer RPC against the base table's SELECT/UPDATE policies. Related:
the "per-recipient SELECT RLS is DEAD under `using(true)`" and "RLS inline
subqueries depend on the referenced table's RLS" entries.

---

---

## GitHub-style "duplicate of #A" cross-references LEAK across a per-submitter visibility boundary — the id itself is a capability when lookup is by-id

**Symptom**: VS duplicate management (0068) linked ticket B → canonical A and
wrote remarks like "รวมกับ VS-A…" into B's timeline, plus exposed
`B.duplicate_of = A`. But `get_vs_ticket_by_id` (0021) is a guest lookup granted
to `anon` that returns any ticket by id — **the id is the only secret**. So B's
submitter (a student) could read A's id from their own ticket, paste it into the
tracker, and view A — another student's confidential complaint. Symmetric for
A's submitter seeing B.
**Cause**: GitHub's close-as-duplicate + `#A` mention is safe only because a repo
has UNIFORM visibility. A confidential, per-submitter system does not — tickets
have different owners/depts and lookup-by-id is a capability. Putting the
canonical's id anywhere the duplicate's submitter can read (a remark, or the
`duplicate_of` column returned by the guest RPC) hands them access to it.
**Fix**: keep the cross-reference STAFF-INTERNAL; give the submitter a GENERIC
resolution. (1) Tag id-bearing dedup remarks `internal:true`. (2) The guest
lookup SANITIZES its row — nulls `duplicate_of` and strips `internal` remarks
(staff read the raw table, so they still see the link). (3) On auto-close the
submitter gets a generic "ดำเนินการและปิดแล้ว" remark, no id. Migration 0071 +
a defensive `!e.internal` filter in `vs-tracking.js rowToTicket`.
**Where**: `supabase/migrations/0071_vs_dedup_confidentiality.sql`,
`src/js/vs-tracking.js`. **Rule**: before cross-linking two records that belong
to different principals, check whether the reference (id, link, mention) is
itself readable by the other principal — if lookup is by-id/capability, the id
IS the data. Keep cross-refs on the staff side; sanitize any anon/guest-facing
read.

---

---

## Sanitizing ONE read path of a confidential column leaves parallel read paths leaking — the guest RPC was cleaned, the owner `select=*` was not

**Symptom**: 0071 sanitized the VS guest lookup (`get_vs_ticket_by_id` nulls
`duplicate_of` so a duplicate's submitter can't discover — and then look up —
the canonical ticket, which is ANOTHER student's confidential complaint). But a
**logged-in** submitter reading their own tickets went through a *different*
path — `dbRest('/vs_tickets?select=*&or=(submitter_id...)')` in
`loginToViewHistory` — which returned the raw `duplicate_of` in the JSON. So the
exact id 0071 protected was still one DevTools-open away for any signed-in
submitter. The confidentiality fix looked complete but only covered one of two
reader paths.
**Cause**: A table has multiple submitter-facing read paths (a security-definer
guest RPC AND a direct RLS `select=*`). A sanitization written into ONE (the
RPC) does nothing for the other. `select=*` in particular is a standing hazard:
it ships EVERY column, so any newly-sensitive column is exposed by default, and
a column-level confidentiality rule can't be expressed in RLS (row-level only).
**Fix**: Treat submitter reads as an explicit allow-list, default-deny. The
owner read now selects a named `SUBMITTER_COLS` list that OMITS `duplicate_of`
(and any staff-only field); the guest RPC keeps nulling it. To still show
"your report is linked to an earlier one" WITHOUT the id, a generated
`is_duplicate boolean` (from `duplicate_of is not null`, 0074) is exposed
instead — a non-identifying flag. Verified: guest RPC returns
`duplicate_of=null, is_duplicate=true`; owner read never includes the column.
**Where**: `supabase/migrations/0074_vs_duplicate_linked_tracking.sql`
(`is_duplicate`), `src/js/vs-tracking.js` (`SUBMITTER_COLS`, both the owner read
and the guest fallback read). **Rule**: when you sanitize a confidential column
on one reader, grep for EVERY other path that reads that table for a submitter/
guest (`select=*`, other RPCs, direct `.from()`), and fix them all — or better,
switch those reads to an explicit submitter-safe column allow-list so a future
sensitive column isn't leaked by `*` default. Same family as the "per-recipient
SELECT RLS is DEAD under using(true)" and "definer bypasses RLS" entries: read
authorization is per-path, not per-table.
**Follow-on instance (0080)**: `get_vs_ticket_by_id` (the anon guest lookup) is
`returns setof public.vs_tickets` built from `select * into r … return next r` —
so EVERY column added to `vs_tickets` is auto-exposed to `anon` the moment the
migration lands, until you blank it in that function. 0079 added
`vs_tickets.tags` and it silently rode out to guests (opaque tag ids in the wire
JSON) even though the frontend never rendered it. 0080 blanks `r.tags := '{}'`
alongside the existing `r.duplicate_of := null`. **Rule**: any time you ALTER
`vs_tickets` (or any table behind a `returns setof <table>` / `select *` guest
RPC), open that RPC and decide per-column: sanitize (blank/null) or intentionally
expose. A new column is exposed BY DEFAULT — the type carries it automatically.

---

---

## Publishing a table-backed directory must be a PROJECTION, never a public SELECT policy — `is_public` filters rows, and rows carry every column

**Symptom** (designed out before it shipped, not observed): the SAMO Team tree
is destined to be rendered publicly as the org chart with people's names. The
natural implementation — add `using (true)` to `team_members` like migration
0032 did for the projects tables, and filter on a new `is_public` flag — would
have published `kkumail`, `student_id`, `year`, `major`, `permissions`,
`vs_dept`, `project_seat` and `user_id` for **every student in the tree**,
plus the @kku.ac.th addresses of the อาจารย์ / เจ้าหน้าที่ who hold seats.
**Cause**: RLS is row-level. A visibility flag controls WHICH ROWS a policy
returns and says nothing about which COLUMNS travel with them — and once a
`using (true)` policy exists it can never be narrowed later (policies are OR'd;
see the "per-recipient SELECT RLS is DEAD" entry). A `returns setof
public.team_members` RPC has the same defect from the other direction: every
column added afterwards is exposed automatically, which is exactly how
`vs_tickets.tags` reached guests in 0079.
**Fix**: the only sanctioned publisher is `get_public_org_chart()` (0086) — a
SECURITY DEFINER function returning a hand-built jsonb of
`{id,parent_id,name,kind,position}` + `{node_id,name,nickname,position}` and
nothing else, over a recursive CTE so a non-public parent hides its whole
subtree. `team_nodes.is_public` is defence-in-depth on top of that, not the
boundary. `team_members` keeps NO public policy at all (asserted:
anon reads 0 rows). Verified by `tools/proj0086-seats.mjs`, which asserts the
serialized chart contains no `@`, no `student_id`, no `kkumail`, no seat.
**Rule**: whenever a table holding personal data gains a public surface, write
the projection first and give it the only grant. If you find yourself adding a
public SELECT policy to reach a "just the names" view, stop — you are
publishing the whole row. And put the column allow-list in the function body
(explicit `jsonb_build_object` keys), never `select *` or a
`returns setof <table>`, so a future `alter table` cannot silently widen it.

---

---

## A row-level UPDATE policy with no column guard let a SUBMITTER self-publish to the public board — the curation gate lived in an RPC the policy routed around

**Symptom**: none reported. Found while adding a "public" rung to the VS remark
visibility ladder (0096) and asking "who can actually write this field?".
**Cause**: `vs_tickets_update_owner` (0009) is
`using/with check (submitter_id = auth.uid())`. RLS is ROW-level — once the row
check passes, PostgREST writes ANY column in the body. 0072 put the publishing
gate inside `vs_set_public()` (SE-only, rejects confidential categories,
requires an SE-written headline) and its invariant #2 says "a student's raw
report is NEVER published verbatim" — but nothing stopped a student PATCHing
the columns that function guards. Proven live in a rolled-back transaction as a
real submitter's uid:
```
update vs_tickets set is_public=true, public_title='SELF-PUBLISHED', category='facilities'
 where id = <their own ticket>;                    → UPDATE ACCEPTED
get_public_vs_board(...)                           → 1 row
get_public_vs_problem(id) → 'SELF-PUBLISHED'
```
Also self-close (`status`), reroute (`target_dept`), pollute internal triage
(`tags`), and re-link into another thread (`duplicate_of`).
**Fix**: `vs_tickets_self_update_guard` (0096), the 0028 pattern with the 0041
lesson applied — it fires ONLY when `auth.uid() = old.submitter_id` and the
caller is not a VS handler, so server contexts (null `auth.uid()`: migrations,
definer RPCs, the cascade trigger, `tools/*.mjs` over the Management API) are
untouched. Two details worth copying:
- Compare `to_jsonb(old) - allowed_keys` against `to_jsonb(new) - allowed_keys`
  instead of a hand-written column list, so a column added by a FUTURE
  migration is guarded BY DEFAULT (fails closed).
- Exclude `is_duplicate` from that comparison: it is `GENERATED ALWAYS`, and
  Postgres computes generated columns AFTER before-row triggers, so
  `NEW.is_duplicate` is NULL while `OLD` holds the stored value. Comparing them
  rejects every write. (`updated_at` likewise — the touch trigger fires first,
  't' < 'v' by name.)
- Remarks are append-only + capped, and appended entries must be `vis:'ticket'`
  authored by `'ผู้แจ้งปัญหา'` — otherwise a submitter appends
  `{"vis":"public","by":"เจ้าหน้าที่"}` and it renders on the board as a staff
  progress update.
**Where**: `supabase/migrations/0096_vs_remark_visibility.sql` §6; proof
`tools/vs0096-remark-vis.mjs` (27 checks).
**Rule**: whenever a table's write authorization is "call this RPC, it checks
things", grep for a per-row UPDATE policy on the same table. If one exists, the
RPC is advisory and the real interface is `PATCH /rest/v1/<table>`. Every column
that RPC validates needs a column guard, or the validation is decorative. Same
family as the `public.users` `role` self-promotion entry above — that one was
found in 2 tables, this is the third; **audit any `for update using (<col> =
auth.uid())` policy the moment the table gains a column the owner must not set.**

---

---

## Adding a DELETE to reference data turns every `coalesce(<flag>, false)` lookup into a live fail-open — the dangling id is the new input nobody wrote for

**Symptom**: none reported — found by asking "what reads this table?" before
shipping a delete button for หมวดหมู่ (`vs_categories`), the same affordance
`vs_tags` had just been given.
**Cause**: `vs_tickets.category` is loose text with NO foreign key — 0072's
deliberate choice so retiring a category can never break a ticket. Correct, but
it means deleting a row creates DANGLING references, an input that did not exist
while the table was append-only. Four readers resolve `is_confidential` from
that id; three failed closed and one did not:
```
get_public_vs_board     inner join vs_categories          → row vanishes  ✔
vs_post_public_comment  coalesce(c.is_confidential, true) → refused       ✔
vs_set_public           coalesce(v_conf, true)            → refused       ✔
get_public_vs_problem   coalesce(v_conf, FALSE)           → GATE PASSES   ✗
```
Measured live in a rolled-back transaction, on a confidential ticket left at
`is_public = true` — a state the app reaches ON PURPOSE (staff may move an
already-published ticket into a ความลับ category; the modal confirms "จะซ่อนจาก
กระดานทันที" and relies entirely on the read layer, which is exactly what
0072's isolation test asserts):
```
BEFORE deleting the category   on_board=0  detail=NULL (hidden)   ✔
AFTER  deleting the category   on_board=0  detail='ไม่ควรแสดง'    ✗ SERVED
```
So an ordinary admin action — deleting the confidential category — would have
un-hidden the curated projection AND the whole public comment thread of every
ticket in it.
**Fix**: `coalesce(v_conf, true)` (0098). An id that cannot be resolved is
treated as confidential. This also makes the DETAIL agree with the LIST for the
first time; previously a dangling category meant "absent from the board but
reachable by direct id", a split no caller could have predicted.
**Where**: `supabase/migrations/0098_vs_unknown_category_fails_closed.sql`;
proof in `tools/vs0096-remark-vis.mjs` (the CATEGORY DELETE block).
**Rules**: (1) Before adding DELETE to any reference table, grep every reader of
the referencing column and check what each does with an id that no longer
resolves — `coalesce(flag, false)`, `left join`, and `if not found then` are the
three shapes that fail open. (2) When several readers ask the same question, they
must agree on the unknown case; a table where three say "closed" and one says
"open" is not a design, it is a bug that has not been reached yet. (3) A loose
reference with no FK is fine, but it makes the DEFAULT for a missing row a
security decision — write it down at every call site.

---

---

## The row-level-UPDATE-without-a-column-guard class, found on a THIRD table — this time it was money

**Symptom**: none reported. Found by asking, as a sweep rather than a hunch,
"which tables have a per-row owner UPDATE policy and NO column guard?"
```sql
select p.tablename, p.policyname,
       (select count(*) from pg_trigger t
         where t.tgrelid=(quote_ident(p.schemaname)||'.'||quote_ident(p.tablename))::regclass
           and not t.tgisinternal and t.tgname ~ 'guard') as guards
from pg_policies p where p.schemaname='public' and p.cmd in ('UPDATE','ALL')
  and coalesce(p.qual,'') ~ 'auth\.uid\(\)';
```
**Cause**: `shop_orders_update_self_early` (0003) is
`using (buyer_id = auth.uid() and status = any(array['pending','review','slip_mismatch']))`
with **no `with check`** — so Postgres reuses USING as the check, which is the
only reason a buyer cannot self-approve to `paid`. But inside that window RLS
grants EVERY column. Proven live on a real buyer's own ฿520 pending order:
```
update shop_orders set total=0, subtotal=0, fee=0                    → ACCEPTED
update shop_orders set admin_note='PAID IN FULL - verified by staff',
       timeline='[{"by":"admin","text":"ชำระเงินแล้ว"}]'             → ACCEPTED
update shop_orders set status='paid'                                 → blocked ✔
```
So: place an order, zero the total, forge an `admin_note` and a timeline entry
attributed to "admin", upload any slip — it reaches the verify queue showing ฿0
due with staff-looking corroboration.
**Fix**: `shop_orders_self_update_guard` (0100), same construction as
`users_self_update_guard` (0028/0041) and `vs_tickets_self_update_guard` (0096)
— deny-by-default via `to_jsonb(row) - allowed_keys`, firing only when
`auth.uid() = old.buyer_id` and the caller is not a shop admin.
**The half that mattered more than the guard**: the allow-list came from
READING THE THREE BUYER CALL SITES in `src/js/shop/api.js` (`enrichNewOrder`,
`addOrderSlip`, `removeOrderSlip`) — not from guessing — and
`tools/shop0100-buyer-guard.mjs` replays all three and asserts they still
succeed. A guard that breaks checkout is worse than the hole it closes.
**Where**: `supabase/migrations/0100_*.sql`; proof `tools/shop0100-buyer-guard.mjs`
(12 checks: 5 attacks blocked, 3 buyer flows intact, admin + server unaffected).
**Rule**: this class has now appeared on `users`, `vs_tickets` and
`shop_orders`. Treat `for update using (<col> = auth.uid())` as **incomplete by
construction** — it is a row filter, never a column policy. `tools/security-sweeps.mjs`
sweep #3 keeps the list honest; two low-severity rows
(`project_doc_views`, `project_notifications` — self-defacement only, `user_id`
pinned by the check) are knowingly accepted, not missed.

---

---

## An `ILIKE` lookup makes the id a PATTERN, not a capability

**Symptom**: none reported. Found while sweeping `setof <table>` RPCs for the
0080 auto-expose trap.
**Cause**: `get_pr_ticket_by_id` (0021) was
`select * from pr_tickets where id ilike p_id … limit 1` — ILIKE presumably to
make a hand-typed id case-insensitive. But ILIKE hands the CALLER pattern
syntax, and the function is granted to `anon`. With nothing but the bundled
anon key:
```
POST /rest/v1/rpc/get_pr_ticket_by_id {"p_id":"%"}
  → PR-68TE3N, submitter_label "…@gmail.com", submitter_id, brief, file_url
```
`limit 1` bounds one call; an attacker walks `'PR-A%'`, `'PR-B%'`, … to
enumerate every id and then reads each in full. The entire guest-lookup design
rests on "the id IS the secret". The VS twin uses `=` and was unaffected —
verified with the same probe.
**Fix**: `lower(id) = lower(btrim(p_id))` (0101) — keeps the case-insensitivity
ILIKE existed for, drops the pattern semantics, still resolves a pasted id with
whitespace.
**Also found in the same sweep**: the ten `effective_team_*_for_email` /
`node_effective_*` resolvers were executable by `anon`/PUBLIC, i.e. an
anonymous oracle — `{"p_email":"…@kkumail.com"}` returned that person's exact
grant set. Nothing outside SQL calls them (the frontend only names them in
comments) and their real callers are SECURITY DEFINER, so they were revoked
from anon/authenticated/PUBLIC. `sync_my_team_permissions()` KEEPS its
authenticated grant — `auth.js` calls it every login and it only resolves the
caller's own identity.
**Rule**: in any lookup where the id is the authorization, the comparison must
be `=` (or `lower(x)=lower(y)`) — never `like`/`ilike`/`similar to`/`~`. And
when granting a helper to `anon`, ask what it answers about someone who is NOT
the caller.

---

---

## A `left join` onto a reference table fails OPEN exactly as `coalesce(flag,false)` does — a FIFTH reader, found by the sweep the entry above prescribed

**Symptom**: none reported. Found one commit after the entry above, while
extending `get_vs_linked_context()` for a feature — by re-reading its
"is the canonical publishable" predicate with the delete button now in mind.
**Cause**: 0075 computed it over a LEFT JOIN as
```sql
(coalesce(c.is_confidential, false) or not coalesce(c.public_eligible, true))
```
Both defaults point the wrong way, so a deleted category (c.* all NULL) makes
`blocked` FALSE. Measured live on a confidential canonical + its duplicate:
```
BEFORE deleting the category  {"linked":true,"public":false,"related_count":2}
AFTER  deleting the category  {"linked":true,"public":true,
                               "public_id":"VS-TSTCTXA",
                               "public_title":"หัวข้อลับของเรื่องหลัก",…}
```
It hands the duplicate's submitter the CONFIDENTIAL canonical's id and title —
the exact disclosure 0071/0074/0075 exist to prevent, and the id is a lookup
capability (`get_vs_ticket_by_id` is granted to `anon`).
**Why it was missed**: 0098's header said "grep every reader of the referencing
column", and I grepped the four PUBLIC BOARD readers — the ones I was already
thinking about. `get_vs_linked_context` reads the same column for a different
audience (the submitter tracking view), so it never came to mind. The rule was
right; the search was scoped by feature area instead of by column.
**The sweep that actually works** — mechanical, no judgement about which
feature a function belongs to:
```sql
with fns as (select oid, proname from pg_proc p
             join pg_namespace n on n.oid=p.pronamespace
             where n.nspname='public' and p.prokind='f')   -- prokind: functiondef throws on aggregates
select proname, pg_get_functiondef(oid) from fns
 where pg_get_functiondef(oid) ~ 'is_confidential|public_eligible';
```
Seven hits; six were closed (four inner joins, two `coalesce(...,true)`), this
was the seventh. Full audit table is in 0099's header.
**Fix**: `coalesce(is_confidential, TRUE)` and `coalesce(public_eligible,
FALSE)` (0099). Note a LEFT JOIN is the same hazard as `coalesce(flag,false)`
wearing different clothes — it is what MAKES the row NULL-able in the first
place; an INNER join would have failed closed for free.
**Where**: `supabase/migrations/0099_vs_self_public_context.sql`; proof in
`tools/vs0096-remark-vis.mjs` (BOARD CONTEXT block).
**Rule**: when a fix's own lesson is "audit every reader", run the audit as a
QUERY over `pg_get_functiondef`, not as a mental list of the callers you happen
to be holding. And treat `left join <reference table>` as a fail-open marker
wherever the joined row gates visibility.

---

---

## An UPDATE that moves a row OUT of your own SELECT policy fails with the WITH-CHECK error — the read policy is re-applied to the NEW row, so a handoff is un-PATCHable

**Symptom** (reported): a dept-scoped VitalSound handler picks "โอนคืน SE" and
gets `บันทึกไม่สำเร็จ: {"code":"42501", …"new row violates row-level security
policy for table \"vs_tickets\""}`. Every other save on the same ticket works.
**The trap is the error message.** It names the WITH CHECK failure mode, so you
go read the UPDATE policy — and `vs_tickets_update_staff`'s WITH CHECK (0082)
*explicitly* permits SE:
`... or (current_user_role() = 'vp_admin' and target_dept = any(array[current_user_dept(),'SE']))`.
It is not lying. Three separate proofs that the UPDATE policy passes:
evaluating the expression pulled straight from `pg_policy` returned **true**; a
probe wired in as `(<orig>) or _dbg_raise(…)` **never fired** for `'SE'` while
firing correctly for a genuinely-forbidden other-dept value; and rewriting it to
`with check (true)` **with every user trigger disabled** produced the same 42501.
That last one is the experiment to reach for early — it costs one query and
rules the whole policy out.
**Cause**: Postgres re-applies the **SELECT** policy to the NEW row on UPDATE and
reports the failure with WITH-CHECK wording. `vs_tickets_read` scopes a handler
to their own dept (`target_dept = current_user_dept()` /
`= any(current_user_vs_depts())`), so the instant `target_dept` becomes `'SE'`
the row leaves the writer's visibility. Confirmed by widening ONLY
`vs_tickets_read` to `using (true)`, both UPDATE policies untouched: the very
same statement returns `rows=1`. This is the UPDATE flavour of the
`INSERT … RETURNING` entry above — and it does **not** need `RETURNING`; a bare
plpgsql `update` reproduces it.
**The general shape**: any UPDATE whose *whole purpose* is to move a row out of
your scope cannot satisfy a SELECT policy keyed on that scope. Handoffs,
reassignment, transfer-of-ownership, "release back to the pool" — all
structurally un-PATCHable. And the read policy is CORRECT (you handed the ticket
off; you should not keep reading it), so widening it is the wrong fix.
**Fix**: route the move through a SECURITY DEFINER RPC that re-applies the same
predicate the UPDATE policy encodes — the pattern already used for soft-delete
(0043/0045), publish (0072) and merge (0083). `vs_transfer_dept(p_id, p_dept,
p_remarks)` (0107). RLS is unchanged; nothing gains a new read. Two details
worth copying: it takes the timeline array so the move + its log land in ONE
statement, and the client withholds the "โอนย้ายฝ่าย: X → Y" entry from the
preceding PATCH so a refused transfer can never leave a timeline claiming a
handoff that did not happen. `p_dept` is null/blank-checked BEFORE the
`any(scope)` tests — `null = any(...)` is NULL and `if not (NULL) then` does not
take the branch, so a null destination would otherwise have blanked the column
(the recurring fail-open, again).
**The sweep for the rest of the class** — run it whenever a SELECT policy starts
keying on a mutable column:
```sql
select s.tablename, s.qual from pg_policies s
 where s.schemaname='public' and s.cmd='SELECT' and s.qual !~ '^\(?true\)?$'
   and exists (select 1 from pg_policies u where u.schemaname='public'
                and u.tablename=s.tablename and u.cmd in ('UPDATE','ALL'));
```
then ask of each: *does the qual reference a column this writer can change?*
Done 2026-07-31 — 22 tables, `vs_tickets.target_dept` was the only live
instance. Every other narrow SELECT qual keys on the writer's own
role/permission (`announcements`, `pr_tickets`, `shop_*`, `project_*`) or on a
column the write policy pins (`user_id`, `buyer_id`), so the new row is always
still visible to whoever wrote it.
**Where**: `supabase/migrations/0107_vs_transfer_dept_rpc.sql`;
`src/js/vs-staff.js` `submitStaffAction`; proof `tools/vs0107-transfer.mjs`
(26 checks, both principal shapes — the shared vp_admin account AND a ทีม SAMO
grantee with `managed_vs_depts`).
**Two follow-ons this exposed, both worth the habit:**
1. *A client pre-guard that only half-mirrors the server is a worse error
   message, not a guard.* The warning fired only for `อุปนายก*` destinations, so
   `คณะ` / `นายกสโม` skipped the friendly Thai text and hit the raw RLS error.
   If you write a "catch it before the request" check, mirror the server
   predicate exactly.
2. *A modal that closes itself on success reads as a failure.* After a handoff
   the ticket leaves the user's view, `reopenCurrentTicket()` hides the modal,
   and the inline footer confirmation was being written into something the user
   could no longer see. Say what happened out loud whenever the thing the user
   was looking at disappears as a RESULT of what they did.

---

---

## A VIEW without `security_invoker` reads its base table with the VIEW OWNER's rights — so closing the table's RLS leaves the view still serving the whole thing

**Symptom**: none yet — caught while writing the passport lockdown, one step before
it would have shipped as a false sense of security. The plan closed
`passport.profiles` (`profiles_read_all using (true)` → self-or-admin) to stop anon
dumping 593 students' names + emails. Verified after the change that
`GET /rest/v1/profiles` returns 0 rows for anon. Done, apparently.
**Cause**: `passport.user_tiers` is a plain view over `passport.profiles`, owned by
`postgres`, with `reloptions = null` — i.e. **no `security_invoker`**. A view
without it executes with the privileges of its OWNER, so it never evaluates the
caller's RLS on the underlying table. anon holds SELECT on the view (the schema's
`ALTER DEFAULT PRIVILEGES` grants it automatically). So
`GET /rest/v1/user_tiers?select=*` would have kept returning every student's
`id, full_name, total_km, tier_override, final_tier, has_travel_visa` — plus a
`has_travel_visa` that sub-queries `scans` — with the "fixed" table sitting right
underneath it. Measured live pre-fix: profiles 5 rows / user_tiers 5 rows; the
whole point of the migration undone by an object nobody was looking at.
**Fix**: `alter view passport.user_tiers set (security_invoker = on)` (PG15+; this
project is PG17.6). Landed in the ADDITIVE migration rather than the lockdown,
because while the base policy is still `using (true)` it is a provable no-op — the
dashboard's own-row read behaves identically — which makes it safe to verify early.
**Where**: `passport/db/0010_passport_authz_hardening.sql` §5; asserted by
`tools/pass-hardening.mjs` ("reads 0 user_tiers") and by the external
`tools/pass-anon-probe.mjs`.
**Rule**: before narrowing a table's SELECT policy, list every VIEW over it
(`select c.relname, c.reloptions from pg_class c where c.relkind='v'`) and check
each for `security_invoker=on`. A view without it is a parallel read path that
your new policy does not govern — the same family as "sanitizing ONE read path
leaves the others leaking", except the second path is invisible in `pg_policies`
because a view has no policies of its own.

---

---

## `revoke all ... from public` does NOT remove an explicit grant to `anon` — and a Supabase schema's DEFAULT PRIVILEGES hand `anon` EXECUTE on every new function

**Symptom**: a new SECURITY DEFINER RPC is written to be admin-only and grants
`execute` to `authenticated` only, preceded by the usual
`revoke all on function … from public;`. It applies clean. `anon` can still call
it. Nothing in the migration hints at why.
**Cause**: two separate facts compounding.
- `PUBLIC` and `anon` are **different grantees**. Revoking from `PUBLIC` removes
  only the implicit world grant; an explicit `anon=X/postgres` ACL entry survives
  untouched. `\df+`-style thinking hides this — you have to read `proacl`.
- The `passport` schema carries `ALTER DEFAULT PRIVILEGES … GRANT EXECUTE ON
  FUNCTIONS TO anon, authenticated` (and, for tables, full `arwdDxtm` to both).
  Confirmed in `pg_default_acl`: `defaclobjtype='f'` → `{anon=X/postgres,…}`. So
  **every function created in that schema is anon-callable the instant it exists**,
  before any grant of yours runs.
Measured: after `revoke … from public` + `grant … to authenticated`,
`proacl` on `stamp_scan` was `{postgres=X,anon=X,authenticated=X}` and
`has_function_privilege('anon', …, 'execute')` was true.
**Fix**: `revoke all on function … from anon;` **by name**, per function, and then
verify from the catalog rather than from the migration text:
```sql
select proname, proacl from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='<schema>' and proname in (…);
```
The two RLS *policy helpers* deliberately KEEP their anon grant: policy expressions
are evaluated with the querying role's privileges, so if `anon` could not execute
`passport.is_admin()` every policy calling it would fail with "permission denied
for function" instead of evaluating to false.
**Where**: `passport/db/0010_passport_authz_hardening.sql` §0 documents the schema's
default ACLs; the explicit anon revokes sit with each `grant`.
`tools/pass-anon-probe.mjs` asserts it over real HTTPS.
**Corollary that is worse than the function case**: the same default privileges
give `anon` full DML on every FUTURE TABLE in that schema. So in a schema like
this, RLS is not defence-in-depth — it is the only defence, and a new table
created with RLS off (or on with a `:: true` policy) is world-writable the moment
it exists.

---

---

## Moving a read behind an identity-gated RPC breaks every caller that has NO identity — and a client-side password login is exactly that

**Symptom**: the passport admin leaderboard rendered "Could not load leaderboard:
NOT_AUTHORIZED" for every admin using the temporary `admin`/`1234` door,
immediately after a commit that pointed it at
`passport.admin_leaderboard()` — a SECURITY DEFINER RPC guarding on
`passport.is_admin()`. Admins signing in with Google were fine, so it looked like
a permission-data problem. It wasn't: the RPC was correct and the grant was
correct.
**Cause**: `admin`/`1234` is a **client-side string compare** — `legacyLogin()`
compares two literals and sets a localStorage flag. The password never reaches the
server in any verifiable form, so those sessions carry **no Supabase JWT at all**,
`auth.uid()` is null, and `is_admin()` cannot tell them from an anonymous visitor.
The previous code worked only because it read `profiles` directly and
`profiles_read_all` was `using (true)` — i.e. it worked *because* the table was
world-readable. Replacing a world-readable read with an authorization-checked one
is normally the whole point; the trap is that it silently converts "no identity"
from *fine* into *rejected*, and the caller with no identity is the one nobody
lists when enumerating roles.
**This generalises past legacy logins.** Any caller without a session hits the
same wall: a public/guest page, a pre-login step (the passport scan page resolves
an activity BEFORE sign-in), a cron or webhook using the anon key, a server-side
render. Enumerating "which ROLES call this?" misses them all, because their answer
to "which role?" is *none*.
**Fix**: branch on the explicit signal, not on catching the error —
`adminScope.legacy === true` selects the old direct read; a real session uses the
RPC. Catching NOT_AUTHORIZED would work but hides why two paths exist, and would
also swallow a genuine permission bug in the RPC path.
**Where**: `passport/js/admin-page.js` `ensureLbScans` (commit `76dac38`, fixing
`079f422` the same session); the RPC in `passport/db/0010_passport_authz_hardening.sql`.
**The structural half, which is the real lesson**: this also means the lockdown
(`db/0011`) and "keep admin/1234 fully working" are mutually exclusive, and no
amount of policy writing reconciles them — a door that cannot prove who is behind
it cannot be granted anything the anonymous public isn't. The only fix is to give
that door a real identity (sign it into one shared Supabase account) or retire it.
**Rule**: before putting an existing read behind an identity check, list its
callers by SESSION STATE (signed-in / anonymous / no-session-by-design), not by
role. Every caller in the third bucket breaks, and it breaks loudly for users
while looking correct in every test you wrote as an authenticated principal.

---

---

## `revoke ... from public` leaves the grant that the schema's DEFAULT PRIVILEGES gave `authenticated` — in the `public` schema too, not just `passport`

**Symptom**: a new private helper (`public.team_node_path(uuid)`, 0109) is
written to be callable only from the definer RPC above it, with an explicit
`revoke all ... from public;` and no `grant`. It applies clean. `pg_proc.proacl`
then reads `{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}`
— every signed-in user can call it and walk the private branches of the ทีม SAMO
tree by uuid.
**Cause**: the same fact already logged for the `passport` schema, which I had
assumed was passport-specific: `PUBLIC` and `authenticated` are DIFFERENT
grantees, and this project's `ALTER DEFAULT PRIVILEGES` grants EXECUTE on every
new function to `anon` AND `authenticated`. `revoke ... from public` strips only
the implicit world grant; the explicit role entries survive. It applies to the
**`public` schema as well** — so in this database *every function is callable by
anon and authenticated the instant it exists*, before any grant of yours runs.
The migration's own comment said "not granted to authenticated", which was true
of the SQL and false of the outcome.
**Fix**: revoke each role BY NAME —
`revoke all on function f(args) from public, anon, authenticated;` — and then
**verify from the catalog**, never from the migration text:
```sql
select proname, coalesce(proacl::text,'(default)') from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and proname in ('…');
```
`(default)` in that column means "whatever the default ACL says", i.e. open.
**Where**: `supabase/migrations/0109_my_team_seat.sql`; asserted by
`tools/seat0109-my-seat.mjs` check 1.
**Rule**: a `revoke` is not a fact about the database, it is a request. For any
function that must not be publicly callable, assert the ACL in a proof script —
this one shipped wrong on the first apply and only the catalog query caught it.

---

## An anon-readable settings table published a staff member's real email — the row was opened for two display labels the renderer never read

**Symptom** (found by sweeping, not reported): probing every anon-reachable read
path of หนังสือโครงการ while building 0114 returned the receiving officer's real
`@kku.ac.th` address from `project_settings` — one `select` away for any visitor,
on the same API the public mirror uses.
**Cause**: 0032 gave the table `for select to anon, authenticated using (true)`
so the customer view could show "เจ้าหน้าที่"/"SAMO" name pills, and left a
comment saying a column-select policy or a public view should follow if the
email turned out to be sensitive. The follow-up never came — and the labels were
never actually consumed: the only reader, `ownerLabel()` in `inbox.js`, had ZERO
call sites — and read `settings.uni_label` / `settings.vp_label`, which are not
columns on that row (they are `uni_staff_label` / `vp_admin_label`). So even if
it had been called it would have shown its hardcoded defaults. A whole row of
config was published to buy nothing. The mismatch was invisible because `?.` +
`||` makes a wrong key look exactly like an unset value.
**Fix**: 0115 drops `project_settings_read_public`; the actor+prof policy
`project_settings_read` is what every staff caller already used.
`mountCustomerProjects()` no longer fetches the row at all (it renders with
`settings: null`, which the renderer already handled). Verified both
directions in one transaction: anon reads 0 settings rows while still reading
24 published projects (the control that proves the probe works), vp_admin and
sa_prof read 1 each.
**Where it lives now**: `supabase/migrations/0115_project_settings_not_public.sql`,
`src/js/projects/index.js` mountCustomerProjects; dead `ownerLabel()` deleted.
**Rule**: a public SELECT policy publishes the ROW, so the justification has to
be worth the whole row — and check that the justification is even real. When a
consumer reads config through optional chaining with a fallback, a typo'd key is
indistinguishable from "not configured", so the exposure can outlive the reason
for it by a year. Grep the consumer for the exact column names before you widen
a policy for it. Second instance of "publishing a table-backed directory must be
a PROJECTION, never a public SELECT policy", above.

---

## An admin's decision was written to a column no student had any read path to

**Symptom**: reported as *"the reason admin type doesn't get shown for the user,
also the status that admin reject or accept doesn't get shown to the user"*. An
admin approving or rejecting a สายรหัส correction typed a reason into the card,
saw it save, and the student saw nothing at all — not the verdict, not the note,
not even that the request had been looked at.

**Cause**: `student_change_requests` is admin-only under RLS (0116 §9: one
`for all to authenticated using (role in (vp_admin,dev) or has_permission
('house'))` policy per table). The student's own card reads exactly one thing,
`get_my_student_record()`, and that RPC did not mention the table. So the write
path existed, the storage existed, and the read path had simply never been
built — the feature was complete on the only side anyone was testing from.

Class 4 (**authorization is per-PATH**) read from the other end: the usual
failure is sanitising one reader and leaving three leaking; this is the mirror
image, where the correct restriction on a table was mistaken for a complete
design and nobody asked whether the intended audience could reach it. A UI that
collects a message is a promise that someone receives it.

**Fix**: the outcome travels inside `get_my_student_record()` — already the
caller's own record, already resolving the student from `auth.uid()`, so no new
policy, no new grant and no new address to probe with. Capped at the 10 newest.
A new `applied_value` column carries what the admin ACTUALLY saved when they
correct the value on approval, because "อนุมัติแล้ว" next to a card showing a
third สายรหัส is a lie by omission.

**Where it lives now**:
`supabase/migrations/0128_cohort_follows_the_sid_and_requests_answer_back.sql`
§2, `src/js/house/my-house.js` `requestsHtml()`. Proof:
`tools/house0128-requests.mjs`, which checks BOTH directions — the student sees
their own request, and an account with neither `team` nor `house` reads zero
rows from `students` / `student_change_requests` / `advisors`.

**Rule**: when a form collects a message for a named person, find that person's
read path before shipping it. "The table is admin-only" answers who may WRITE;
it does not answer whether the intended reader can read.

⚠️ **And a debugging note that cost twenty minutes here.** While probing this,
an account with `role: 'user'` and `permissions: []` appeared to read every row
of three admin-only tables, which reads exactly like a fail-open policy. It was
not: `current_user_has_permission()` reads the UNION of `permissions` **and**
`managed_permissions` (0081), and that account held `master` through the
ทีม SAMO org tree. A probe subject chosen by `permissions = '{}'` alone is not
an unprivileged subject in this schema — filter on both columns, or you will
report a vulnerability that is the grant engine working.

---

## An RLS policy with no table GRANT denies everyone, and looks exactly like the policy working

**Symptom**: a new `identity_conflicts` table had two SELECT policies — an admin
one and a "this is your own record" one — and both returned zero rows for
everybody. The DENY probe passed. So did the second DENY probe. The only reason
it was caught is that an ALLOW step sitting between them (a SECURITY DEFINER RPC
reading the same rows) returned 1 while the direct read returned 0.

**Cause**: the migration created the table, enabled RLS, wrote the policies and
`revoke all ... from anon` — and never granted anything to `authenticated`. RLS
NARROWS a privilege; it does not confer one. With no GRANT there is nothing to
narrow, so every policy is unreachable and every read is denied. A definer RPC
runs as the owner and is unaffected, which is what made the two halves disagree.

**Fix**: `grant select, insert, update, delete on public.identity_conflicts to
authenticated;` beside the `enable row level security`, and an ALLOW assertion in
the proof (`an admin can READ the conflicts`) so a future revoke cannot make
every DENY step pass vacuously again.

**Where it lives now**: `supabase/migrations/0138_the_import_disagrees_out_loud.sql`
§2, `tools/house0138-conflicts.mjs` (A9b).

**Rules**: (1) Every new RLS table needs a GRANT in the same migration; the
policies are the second half of the sentence. (2) A DENY-only proof cannot
distinguish a working guard from a table nobody can reach — pair every deny with
an allow over the same rows (class 7).

---

## An RLS policy's inline subquery is subject to the referenced table's RLS — found again, on a policy written FOR ordinary students

**Symptom**: a student could not read their own `identity_conflicts` row. The
admin policy worked, the definer RPC worked, the own-read policy matched nothing.

**Cause**: the policy was the obvious spelling —

```sql
using (exists (select 1 from public.people p
                 join public.users u on lower(btrim(u.email)) = lower(btrim(p.kkumail))
                where p.id = identity_conflicts.person_id and u.id = auth.uid()))
```

— and `people` has its own RLS (`people_read`, which requires
`team` / `team_edit` / `house`). An ordinary student cannot select from `people`,
so the subquery found nothing and the policy denied them their own record. This
is the FIRST entry in this file, met again five years of migrations later, in a
policy whose entire purpose was the unprivileged case.

**Fix**: `public.my_person_id()`, a SECURITY DEFINER `stable` function returning
the caller's registry row, and `using (person_id = public.my_person_id())`.

**Where it lives now**: `supabase/migrations/0138_the_import_disagrees_out_loud.sql` §2.

**Rule**: any table an RLS policy reads must be one the POLICY'S SUBJECT can
read, or the lookup goes through a definer. The failure is silent and always
denies the least privileged caller — i.e. exactly the one the policy exists for.

---

## A bypass flag set with `set_config(..., true)` stays set for the whole TRANSACTION, not the statement

**Symptom**: the 0135 proof asked whether an ordinary member could edit an
admin-owned column on their own `team_members` row. The answer came back
**ALLOWED**, from a guard that had been in place since 0110 and was correct when
read.

**Cause**: `app.team_sync` is the documented server-writer exemption —
`team_members_self_update_guard` returns early when it is `'1'`, so a definer
function can write a guarded column while running with the member's own
`auth.uid()`. Two functions set it and never put it back:
`recompute_team_managed_permissions()` (an AFTER STATEMENT trigger on
`team_members`) and `sync_my_team_permissions()`. `set_config(name, value,
is_local => true)` is transaction-scoped, and a `SET search_path` clause on the
function does not save it back. Measured: `app.team_sync` was unset at the start
of a transaction and `'1'` after a single `update public.students`, because the
0132/0133 mirrors write `team_members.kkumail` and that fires the recompute.

Not reachable through PostgREST as things stand — one request is one transaction
and one PATCH is one statement, and within a statement the BEFORE ROW guard
fires before the AFTER STATEMENT recompute. The protection rested on that
accident, and `update_my_identity` is already an example of the shape that
breaks it: a definer RPC touching `students` and then `team_members`.

**Fix**: migration 0136 — both functions read the previous value into a local,
set `'1'`, and restore. The previous VALUE rather than `''`, because a nested
caller may legitimately already be inside the exemption.

**Where it lives now**: `supabase/migrations/0136_team_sync_flag_does_not_leak.sql`,
`tools/team0135-name-split.mjs` (D5 + D5y, which asserts the probe subject really
is unprivileged AND that `app.team_sync` is not set).

**Rules**: (1) A bypass flag must be restored by whoever set it, in the same
function, to its previous value. (2) Fail-open again (class 2): the guard
answered "allowed" for a condition it could no longer evaluate honestly.
(3) A proof step that asserts the CONTEXT it is testing in — "this caller really
has no grant, and the bypass really is off" — is what turned this from a
mysterious FAIL into a one-line diagnosis.

---

## Every signed-in account could read all 531 rows of `public.users` — a directory dump AND a map of who holds `master`

**Symptom**: nobody reported it. There was no visible bug, no error, no slow
page — which is the point. A live authorization sweep asked what an ORDINARY
account can reach, and the answer for `public.users` was: all of it. Measured
while impersonating a real student picked on BOTH grant columns (`permissions`
AND `managed_permissions` empty, `role = 'user'`), inside a rolled-back
transaction:

    rows_visible 531 · with_email 531 · with_phone 7 · distinct roles 8
    accounts carrying permissions 4 · other accounts' emails readable 530

**Cause**: 0001 shipped

```sql
create policy "users_read_all" on public.users
  for select using (auth.role() = 'authenticated');
```

with the comment *"needed for staff dashboards to show submitter info"*. That
justification had been false for a long time and nobody re-read the policy. A
PR/VS ticket DENORMALISES its submitter onto its own row at submit time
(`vs-form.js` writes the label from `authGetUser()` — the caller's OWN identity),
so no dashboard joins `users` at all. The policy was load-bearing for a design
that no longer existed.

The second harm is worse than the first and is what makes this different from an
ordinary email leak: `role` and `permissions` live in the SAME ROW. A full read
is therefore also a reconnaissance map naming which accounts hold `master`,
`dev`, `vp_admin`. An attacker choosing a target no longer has to guess.

**Fix**: migration 0147 — `users_read_all` → `users_read_self`,
`using (id = auth.uid())`. No staff branch was added: an `or
current_user_is_staff()` arm would have restored the full-table read for eight
roles to serve ZERO call sites, which is class 3 in reverse. Client side, exactly
one path read across users — `listUsersByRole()` in `projects/api.js` — and it
was already a legacy FALLBACK behind two definer projections that superseded it
(`list_project_profs` 0086, `list_project_seat_users` 0092, both id +
display_name, no email). It is deleted: a fallback that reads the table you just
closed is not a fallback, it is the hole with a longer name.

**What was checked FIRST, and is the actually transferable part.** Narrowing a
SELECT policy is dangerous not because of the table but because of 0138's shape —
some OTHER policy inline-subqueries it, that subquery runs with the CALLER's
rights, and tightening here silently empties it. 0110's own comment had predicted
exactly this in writing ("anyone tightening that policy later would silently
empty this one"). So, against the live catalog, **with a control proving the
instrument could find things at all**: 109 policies exist in `public`, 5 contain
an inline subquery and the probe PRINTED all five (project_files,
shop_order_items ×2, shop_pickup_records, vs_tickets) — ZERO name `users`. Zero
SECURITY INVOKER functions read it; the 23 that do are all DEFINER (count printed
as its own control). Zero views exist in `public` at all.

The first version of that sweep returned zero rows for BOTH the hazard and the
control, and zero-with-a-dead-control is worth nothing — that is class 7, and it
is why the counts are in the migration header.

**Where it lives now**:
`supabase/migrations/0147_an_account_directory_is_a_projection_not_a_read.sql`
(the reasoning, the measurements and the "no staff branch" argument),
`tools/authz-sweep-identity.sql` (23/23 — the regression guard, written while the
hole was open and deliberately withheld from this PUBLIC repo until it closed),
and a `comment on table public.users` saying self-only and why.

**Rules**: (1) A table-backed directory must be published as a PROJECTION, never
a SELECT policy — this repo already had that rule written down and the oldest
table predated it. (2) **Re-read the JUSTIFICATION, not just the policy.** This
one carried its own reason in a comment, the reason expired, and the policy
outlived it silently. Grep your policies for comments asserting a need, then go
check whether that need still exists. (3) A permissive read is worse when `role`
and `permissions` share the row: enumerate what a dump COMPOSES, not just what
each column is. (4) Prove BOTH directions — the ALLOW half here (`S7. student CAN
still read their OWN row`) is what distinguishes "fixed" from "login is now
broken for everyone".

## "someone could just book 16.40-20.00 kick me out" — a cap is not a refusal

**Symptom.** Reported with the live numbers: a 5-hour window open since 15:00,
82% of it spent, the clock at 16:28. Somebody could book 16:40–20:00 and take
the session out from under the person working in it.

**Cause.** The guard treated a running window as a CAPACITY question. It refused
100% (82 + 100 > 100) and accepted 18%, and 5%. Arithmetically impeccable, and
the wrong question — because a booking is not a quantity, it is a CLAIM. Once
the latecomer held one, the rules said "รอบที่มีผู้จองไว้ เป็นของผู้จอง" and the
occupant was inside somebody else's block.

The deeper error: the remainder of an open window is not a quantity anyone can
promise. The person already in it may spend the other 18% in ten minutes, doing
nothing wrong — it is their session. So a booking for that 18% is a reservation
the system cannot honour: a hope wearing a booking's clothes, which also confers
authority over someone else's work.

**Fix.** An open window is not bookable at ALL, at any percentage. Whoever sent
the first message holds it until it resets; the earliest a new block may start
is that reset. The refusal names both ways forward — book from the reset, or use
it right now unbooked and shared — because the latecomer is not being denied
ACCESS, only a claim.

The rule is checked BEFORE the capacity rule, so the message a person gets
explains their situation instead of complaining about arithmetic in a window
they were never allowed to book in. And the test is `new.pct > v_prev` — on the
CLAIM, not on the row — so someone who booked before the window opened can still
shrink or cancel.

**Known cost, accepted:** 3% used at 15:05 leaves the window "open" until 20:00
and blocks booking that whole time. That is the right side to err on; the
alternative is issuing reservations that cannot be kept, and the stretch is
still freely usable.

**Where it lives now.** `claude_open_window()` + `claude_booking_guard()` §2 in
`0160_claude_an_open_window_cannot_be_claimed.sql`; surfaced before the save by
`claude_booking_limits().open_window`. Guarded by `claude0159-window-share.sql`
§C (32/32) — whose §C3 went RED when 0160 landed, because it asserted the old
clamp. That is the right way round.

**The general rule.** *When a resource is already in use, the question is not
"how much is left" but "may this be claimed at all".* A cap answers the first
and silently grants the second. Any booking, lock, or reservation over something
with an incumbent needs an ownership test that runs BEFORE the capacity test —
and if the remaining quantity cannot be guaranteed, offering it is worse than
refusing it.

---

## A column guard keyed on "is a professor" locked out everyone who is ALSO a professor

**Symptom.** Reported 2026-09-01: *"my friend has permission master with
ผู้ส่งคณะ but can't ซ่อนจากเว็บ on each หนังสือ of หนังสือโครงการ"* — and,
pasted from the alert:

```
{"code":"P0001", "details":null "hint":null
 "message":"project_documents_prof_guard: professor may only add comments"}
```

The friend is not a professor. The **โครงการ-level** ซ่อนจากเว็บ worked; only
the **per-หนังสือ** one failed. That asymmetry is the whole diagnosis in one
observation: `projects` has no prof guard, `project_documents` does.

**Cause.** 0051 widened `project_documents_update` to admit the professor so he
could comment, and a row-level UPDATE policy grants every column in the row
(class 1) — so it added a BEFORE UPDATE column guard that raises when
`current_user_is_prof()`. Correct at the time: prof and actor were disjoint
sets.

0111 §2 then folded `master` into `current_user_project_seats()` as
`array['vpa','staff','prof']` — deliberately, so a master can work any of the
three desks. `current_user_is_prof()` has answered TRUE for every master since
2026-08-17.

Every **other** caller of that helper is an OR branch in a read/update/insert
policy, where an extra `true` only widens. These two triggers are the only
places it appears as a **restriction**, and a restriction keyed on an identity
reads an EXTRA identity as a disqualification. Enumerated on the live database
— of ten raising triggers, `shop_orders_self_update_guard`,
`vs_tickets_self_update_guard` and `users_self_update_guard` are all
exemption-first (`if <privileged> then return new`), which is why master never
broke there. Only the two prof guards invert it.

**Measured on production before the fix** (rolled-back transaction):

| subject | seats | actor | prof | flip `is_public` on a หนังสือ |
|---|---|---|---|---|
| master | `{vpa,staff,prof}` | t | t | **raise — the bug** |
| vpa-only | `{vpa}` | t | f | allow |
| staff-only | `{staff}` | t | f | refused by `project_public_flag_guard` (correct — staff receive, they do not publish) |
| prof-only | `{prof}` | f | t | denied by RLS (correct) |

So the blast radius was not the reported button. **A master could change
NOTHING on a หนังสือ except a comment** — not ซ่อนจากเว็บ, not
รับเรื่อง/กำลังดำเนินการ/เสร็จสิ้น/ส่งกลับให้แก้/ย้อนสถานะ, not แก้ไขชื่อ/โน้ต,
not `drive_folder`. 41 accounts, eight days, one report. Their colleagues
holding a plain seat were never affected, which is exactly why it looked like
an individual's problem.

**And it was silently corrupting data.** `send.js` creates the row, then
patches `drive_folder` with the real doc id (the folder segment needs an id the
insert has not minted yet) — inside `catch {}`. For a master that PATCH raised.
Three หนังสือ, all master-sent, kept the placeholder path `…/<slug>_` while
their files were uploaded to `…/<slug>_DOC-XXXXX`, so QR-โฟลเดอร์ and
folder-delete pointed at a path that does not exist. Found by asking which rows
do NOT end in their own id — an exact predicate, not a guess, which is also why
the repair (`drive_folder || id`) reproduces byte-for-byte what `send.js` would
have written. The FIRST predicate tried (`like '%//%'`) matched nothing and
would have closed the question as "no damage"; printing the rows is what found
it.

**Fix.** Both guards now ask **`current_user_is_prof() AND NOT
current_user_is_project_actor()`** — "here ONLY as a professor", which is
precisely the branch the policy `actor OR (prof AND prof_can_see_document(id))`
admits him through. The guard and the policy it backstops now name the same
predicate instead of two spellings of one rule (class 6).

**Not** by narrowing `current_user_project_seats()`: master must keep the prof
seat, which is what lets a master read `project_settings`, be listed as a
signer, and insert a signed file. Narrowing the helper would have broken five
GRANTS to fix two RESTRICTIONS. **Not** by exempting `master` by name either —
that spelling drifts, and it is blind to the stored `{staff,prof}` pair the ทีม
SAMO editor can create at any time (zero such accounts today; the guard now
covers them anyway).

`sign_requests_prof_guard` had the identical defect and is fixed in the same
commit. It is LATENT — the UI only ever patches the decision columns — but "the
first fix landing alone" is how these two drift apart (0149 paid for that).

**Where it lives now.** `0176_a_master_is_not_only_a_professor.sql`. Proved live
in both directions by `tools/proj0176-master-desk.sql` (22/22): §A a master may
now flip `is_public`, status, title and `drive_folder`; §B an account that is a
professor and *nothing else* still cannot, and still can comment. §B needed
GEOMETRY the first draft did not create — `prof_can_see_document()` requires the
หนังสือ to have a sign request, so on a หนังสือ with none the professor is
refused by RLS *before* the guard is consulted, and all five §B rows came back
`deny-rls` including the one asserting he CAN comment. A refused row is not a
passing guard; the proof now creates the sign request rather than relaxing what
it asserts. `prof-guard-actor-exemption.test.js` pins the migration corpus at
`npm test` time against the specific way this dies — a later migration
`create or replace`-ing these functions from 0051's or 0114's body, which
0114's own header warns about having nearly done. The empty `catch` in
`send.js` now logs.

**The general rule.** *A guard that RESTRICTS by identity must ask whether that
identity is the ONLY reason the caller is here.* When a grant is widened so one
account can hold several roles at once, every predicate that GRANTS on a role
keeps working — and every predicate that DENIES on a role inverts, silently, for
exactly the most privileged accounts. So when you add a role-folding grant,
enumerate the RESTRICTIONS, not the grants: `pg_get_functiondef ~ 'raise
exception'` over every trigger, and read which side of the `if` the raise is on.
The tell that you are on the wrong side is a guard whose condition is an
identity rather than "the caller has no other way in".

---

## 0181 — a read rule that LOOKS THE ROW UP cannot see the row being created, and a public-site flag had been covering for it

**Symptom** (as reported): *"some หนังสือโครงการ has been อนุมัติแล้ว but there
isn't signature sign on the pdf … i check the log, the teacher just อนุมัติ"* —
เกียรติบัตร ประดับช่อ, หนังสือโครงการ HYROX101, and the ICEM
ประกวดสื่อสร้างสรรค์ หนังสือ, all approved on 2026-09-03 between 02:59 and 03:02
with no signed file attached. Three more หนังสือ handled in the same seven
minutes, by the same อาจารย์, were fine. The owner then found the signed PDFs
**sitting in Google Drive**, referenced by nothing.

**Cause.** `project_files_read` was
`current_user_is_project_actor() OR prof_can_see_file(id)`, and
`prof_can_see_file(id)` answers by SELECTing `project_files` for that id. On
`insert … returning` — which is exactly what PostgREST issues for
`Prefer: return=representation`, and what `api.js createFile()` uses — the row
is not in the table yet, the lookup finds nothing, the SELECT policy fails, and
Postgres rejects the whole statement. Drive is written BEFORE the row, so each
refusal left a publicly-shared PDF that no screen in this app could see.

It should have broken every professor upload since the feature shipped. It did
not, because 0114 had added a second, unrelated policy —
`project_files_read_public using (project_doc_is_public(document_id))` — which
reads the DOCUMENT's flags and never touches the new row. It passes whenever the
โครงการ and the หนังสือ are both public, which is the default. **A public-WEBSITE
feature was the only thing letting an อาจารย์ save his signature**, and all 18
signed uploads in history were on public โครงการ. Hide either flag and signing
dies — while reading, commenting, ยอมรับ, the doc timeline, "seen" and
notifications all keep working. Measured across all three visibility states:
exactly one step of the professor's path ever fails.

**Why it read as human error for six days.** Four things pointed the wrong way.
The professor's own habit was accept-then-upload, so "he forgot" fitted. The
three failures were the three OLDEST requests in a backlog-clearing session, so
"he rushed the tail" fitted. `logSignToDoc` swallows its failure to
`console.warn`, so the append-only doc timeline showed **no upload event** — and
that absence was taken as proof no upload was attempted. And the error he
actually saw was `new row violates row-level security policy for table
"project_files"`, in an `alert()`, in English: `createFile` threw
`error.message` straight through, which is the exact shape `rest-error.js` was
written to stop after 0176. Only the Drive orphans falsified all of it.

**Fix.** Migration 0181. The RULE moves into a two-argument
`prof_can_see_file(id, sign_request_id)` that reads only values the caller
already has; the one-argument form becomes a thin lookup wrapper that delegates
to it, so `tools/prof0095-seat-parity.mjs` and any other caller keep working and
the two cannot drift. The policy passes the ROW's own columns, which exist
during `returning`. In the frontend: one `createFileOrUndo()` deletes the Drive
file when the row is refused (all three upload paths go through it, because the
hazard is in the ORDER they share); both sign handlers now upload BEFORE
retiring the previous signature, excluding the row they just created; the
`accepted` label is `อนุมัติแล้ว`, the no-file chip is a warning that says
`ยังไม่มีไฟล์ลงนาม`, `notifySignDecision`'s subject line is derived from
`hasSigned` like its body already was; approving with no file asks first, and so
does closing เสร็จสิ้น.

**Where it lives now.** `supabase/migrations/0181_*.sql` ·
`tools/proj0181-prof-upload.sql` (registered in `run-proofs.mjs`; ALLOW × 4
visibility states, DENY, a CONTROL that re-runs them with
`project_files_read_public` dropped, and a DIFFERENTIAL over every existing row)
· `src/js/projects/signed-file-integrity.test.js` (12 assertions, each watched
to fail with its bug reintroduced).

**The proof needed three fixes before it could see the bug**, and all three were
green-over-broken: (1) `set local role authenticated` inside the plpgsql helper
that did the insert never took effect, so every case ran as the superuser with
RLS bypassed; (2) the helper scored sqlstate `42501` as "RLS refused", which
also matches a missing GRANT on its own temp fixtures; (3) `returning 1` reads
no column of the new row, so **Postgres never applies the SELECT policy** and
the case passes while the feature is broken. PostgREST issues `RETURNING *`.

**The general rule.** *A policy that identifies a row by LOOKING IT UP in the
table it protects cannot answer for a row being created* — so `insert …
returning` is refused even though the INSERT itself is allowed. Write the prof/
owner branch against the NEW row's own columns. And when a permissive policy set
contains one member that does not depend on the new row (a public flag, an
`is_active`, anything derived from a PARENT), it will mask a broken sibling for
as long as its condition happens to hold: **a proof of a grant must drop the
other policies and re-run, or it is only proving that SOMETHING let the write
through.** The tell that you are exposed is a write that works for most rows and
fails for the ones with an unrelated flag turned off.
