# Mistakes — Migrations, DDL, triggers & constraints

What Postgres refuses to do in place, and which guards fire in contexts you did not write them for.

Each entry: **Symptom → Cause → Fix → Where it lives now**. The always-loaded index of every entry across all nine files is `.claude/rules/mistakes.md`; add new entries here, then run `npm run mistakes:index`.

---

## Postgres has no `create or replace policy` — partial-replay migrations 42710 out

**Symptom**: User runs an RLS-adding migration once. Later runs the
same file again (re-applying after a tweak elsewhere, or the SQL editor
double-fires). Postgres errors:
`ERROR: 42710: policy "policy_name" for table "x" already exists`
and the script aborts BEFORE any grants / data fixes below it.
**Cause**: `create policy` has no `or replace` variant in Postgres
(through at least 16). `create table if not exists` and `create index
if not exists` ARE idempotent and lull migration authors into a false
sense of safety.
**Fix**: Wrap every `create policy` with `drop policy if exists`:
```sql
drop policy if exists "policy_name" on schema.table;
create policy "policy_name" on schema.table for select using (...);
```
Apply to every RLS policy in every new migration. The drop is a no-op
on first run; it makes the re-run case clean.
**Where**: First seen in
`supabase/migrations/0031_project_doc_views.sql`. Pattern to use in
any future migration that adds RLS policies. (Migrations 0001, 0013,
0014, etc. predate this rule — leave them; they're applied and not
re-run.)

---

---

## A self-update column guard silently bricks EVERY new signup when it blocks a column another trigger legitimately writes

**Symptom**: Brand-new Google sign-in fails. The Supabase OAuth callback
(`/auth/v1/callback?...`) 302-redirects back to the app with
`error_code=unexpected_failure` +
`error_description=Database+error+saving+new+user`. Existing users log
in fine; only first-time signups fail. The same failure bricks the
profile-modal "set password" flow. Looks like an OAuth/redirect-config
problem; it isn't.
**Cause**: Two triggers fire on user creation and they fight:
- 0027 `handle_auth_user_password_sync` (AFTER INSERT / AFTER UPDATE OF
  `encrypted_password` on `auth.users`) UPDATEs `public.users.has_password`
  to mirror "does this auth user have a password".
- 0028 `users_self_update_guard` (BEFORE UPDATE on `public.users`) RAISES
  if a non-staff caller changes a privileged column — including
  `has_password` ("server-managed").
During a GoTrue signup the sync trigger's UPDATE runs with
`auth.uid() = NULL`, so `current_user_is_staff()` is false, so the guard
takes its `has_password` branch and aborts the whole signup transaction.
The guard cannot distinguish the legitimate server-side sync trigger from
a malicious client PATCH — both execute in a non-staff context.
**How it was confirmed**: `POST /auth/v1/admin/users` (with the service
role, with OR without a password) reproduces it exactly:
`P0001 users_self_update_guard: has_password is server-managed`, HTTP 500,
no row created. The admin API fires the same triggers as a real OAuth
signup, so it's a faithful, reversible repro (delete the test user after,
or nothing is created when it fails).
**Fix**: 0041 redefines the guard so the `has_password` change is allowed
when it AGREES with the authoritative `auth.users.encrypted_password`
state (sync trigger always writes the correct mirror value → passes; a
client trying to set a contradicting value → still blocked; setting the
already-correct value → harmless no-op). All other guarded columns
(id/role/permissions/method/username-once) unchanged.
**Where**: `supabase/migrations/0041_fix_has_password_guard_blocks_signup.sql`.
**Pattern to never repeat**: before adding a `raise`-on-change column guard
keyed on `current_user_is_staff()` / `auth.uid()`, list EVERY other trigger
that writes that column. Any server-managed column written by another
trigger will be writing under a NULL `auth.uid()` during signup and will
trip the guard, taking the whole transaction down. Guard against the
*client write path*, not the *value* — gate on agreement with the source
of truth (or a transaction-local bypass flag set by the server writer),
never on the staff context alone.

---

---

## Service-role seed can't UPDATE `role`/`permissions` — `users_self_update_guard` fires for the service role too (auth.uid()=null → not staff)

**Symptom**: A provisioning script (e.g. `tools/vp-accounts.mjs`,
`tools/president-account.mjs`) creates the auth user fine, then
`supabase.from('users').update({ role: 'dev', ... }).eq('id', uid)` with the
**service_role** key fails:
`users_self_update_guard: role can only be changed by staff`.
**Cause**: RLS is bypassed for `service_role`, but **triggers still fire**.
`users_self_update_guard` (0028/0041, BEFORE UPDATE on `public.users`) lets
only staff change privileged columns (`role`, `permissions`, `method`,
`has_password`, locked `username`). "Staff" = `current_user_is_staff()` →
`current_user_role()` → row for `auth.uid()`. The service-role JWT has no
`sub`, so `auth.uid()` is null → no row → not staff → guard raises. (Same
shape as the 0041 signup-brick bug: server contexts run with null
`auth.uid()`.)
**Fix**: The guard is **BEFORE UPDATE only — there is no INSERT guard** on
`public.users`. Re-seed the row instead of updating it: `select *` the
existing row, `delete` it, `insert` it back with `role`/`department` changed.
Service role bypasses RLS for both delete and insert; the auto-created row is
safe to replace for a brand-new account (nothing FK-references it yet). Done
in `tools/president-account.mjs seed`. **`vp-accounts.mjs` still does a plain
`.update({role})` and will hit this same block if re-run today** — port the
select→delete→insert fallback there if you re-provision VPs. (Alternatives if
the row already has dependents: a SECURITY DEFINER RPC granted to
service_role, or set the role in the Supabase SQL editor — both need SQL
access this repo's `.env.local` doesn't carry.)
**Where**: `tools/president-account.mjs`; guard in
`supabase/migrations/0028` + `0041`.
**Best method for an EXISTING row with FK dependents** (e.g. granting an
already-provisioned staff account a new `permissions[]` value — done
2026-07-22 to add `'samoshop'` to `samomdkkumdi`): do NOT delete+insert —
that row is FK-referenced (created content, actions, etc.) and the delete
either cascades data away or fails on RESTRICT. Instead disable the guard
for one atomic UPDATE via `tools/apply-migration.mjs` (runs as Postgres
superuser over the Management API `database/query` endpoint):
```sql
alter table public.users disable trigger users_self_update_guard;
update public.users set permissions = array_append(coalesce(permissions,'{}'),'samoshop')
 where username = 'samomdkkumdi' and not ('samoshop' = any(coalesce(permissions,'{}')));
alter table public.users enable trigger users_self_update_guard;
```
Safe because: the endpoint runs a multi-statement string as ONE implicit
transaction (simple-query protocol), so a failing UPDATE rolls back the
DISABLE too (trigger stays enabled); and `ALTER TABLE … DISABLE TRIGGER`
takes a transaction-scoped ACCESS EXCLUSIVE lock, so no other session ever
observes the guard disabled. Verify `tgenabled='O'` (enabled) on
`pg_trigger` afterward. Prefer this over delete+insert for any established
`public.users` row.

---

---

## `create or replace function` CANNOT change the return type — drop it first

**Symptom**: A migration that evolves an existing RPC's return type (e.g. 0082
changing `sync_my_team_permissions()` from `returns text[]` to `returns jsonb`)
fails on apply with `42P13: cannot change return type of existing function` /
`HINT: Use DROP FUNCTION ... first`. The whole file rolls back (Management-API
runs it as one txn), so nothing lands — safe, but confusing if you expected the
columns above it to persist.
**Cause**: `create or replace function` may change the body but NOT the
signature's return type (nor arg types). Postgres refuses in-place.
**Fix**: `drop function if exists public.fn(argtypes);` immediately before the
`create`. Re-`grant` after (the drop takes the grants with it). Watch for
callers depending on the old return shape during the deploy window — 0082's
frontend handles BOTH `text[]` (pre) and `{permissions,vs_depts}` (post) so an
old bundle against the new RPC still works. If other DB objects depend on the
function, `drop` will fail unless you recreate them too (or the return change is
what forces a coordinated migration).
**Where**: `supabase/migrations/0082_team_vs_dept_scope.sql`. Same family as the
"no create or replace policy" entry — some objects can't be replaced in place.

---

---

## A `NOT NULL` column with `ON DELETE SET NULL` is a latent contradiction — the FK cleanup fails at delete time and BLOCKS the parent delete

**Symptom**: A brand-new child table applies clean, all tests + isolation
checks pass, feature ships. The bug is invisible because nothing in normal
use / tests ever deletes a referenced PARENT row. Then one day deleting a
`public.users` row (or whatever the FK points at) errors with a NOT NULL
violation on a child table you weren't even thinking about — and the parent
delete is blocked entirely.
**Cause**: a column declared BOTH `not null` AND `references parent(id) on
delete set null`. The clauses contradict: when the parent is deleted Postgres
tries to SET the child FK column to NULL, but the column is NOT NULL → the
whole DELETE aborts. Seen in 0072: `vs_public_comments.author_user_id uuid
not null references public.users(id) on delete set null`. `create table if
not exists` will NOT fix it on a re-apply (the table already exists), so the
contradiction persists silently.
**Fix**: make the delete action consistent with the null-ability —
`on delete cascade` if the child can't exist without its parent (chosen here,
matches `vs_followers`), OR drop `not null` if you genuinely want
orphan-but-keep (`set null`). For a table already created by an earlier run,
re-point it idempotently:
`alter table X drop constraint if exists X_<col>_fkey;
 alter table X add constraint X_<col>_fkey foreign key (<col>) references
 parent(id) on delete cascade;` — then verify `pg_constraint.confdeltype='c'`
(c=cascade, n=set null, a=no action).
**Where**: `supabase/migrations/0072_vs_public_board.sql`. **Rule**: grep every
new migration for a column that is both `not null` and `on delete set null`
(or `set default` with no default) on the same FK — that pair is always a bug.

---

---

## Recreating a function from the migration that FIRST defined it silently reverts every later one

**Symptom**: `tools/vs0083-scope.mjs` went 15/16 immediately after applying an
unrelated feature migration — "board: reads staff-only comment on OWN dept"
failed with `is_handler=true, reads_own=false`. Nothing in the new migration
mentioned scopes or handlers.
**Cause**: 0096 needed to add an `updates` key to `get_public_vs_problem`, so it
was written by copying that function's body out of `0078_vs_staff_only_comments.sql`
and editing it. But the function had been redefined AGAIN in
`0084_vs_board_scoped_handler_is_staff.sql`, which added `v_scope
text[] := current_user_vs_scope()` and two comment-visibility branches. Copying
0078's body and `create or replace`-ing it dropped 0084's work — a clean apply,
no error, and the only signal was a proof script from three migrations ago.
`create or replace function` has no "are you sure you're editing the latest
version" check; the file you read is not necessarily the definition that is live.
**Fix**: before re-creating ANY existing function, diff against the LIVE body:
```sql
select pg_get_functiondef(p.oid) from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname='public' and p.proname='<fn>';
```
and/or `grep -ln "function public.<fn>" supabase/migrations/*.sql` to find every
file that defines it — the LAST one is the base to edit. 0096 also touched
`get_public_vs_board` (last defined 0078 ✔) and `get_vs_ticket_by_id` (last
defined 0080 ✔); only the one with a THIRD definition bit.
**Where**: `supabase/migrations/0096_vs_remark_visibility.sql` §5 (now carries a
"BASED ON 0084's BODY" note naming the trap).
**Rule**: the migrations directory is an append-only log, not a source tree —
the newest definition wins and older files are actively misleading. Re-run the
proof scripts for the FEATURE AREA after any function rewrite, not just for the
thing you were changing; that is the only thing that caught this.

---

---

## Hard-deleting a row referenced by an `ON DELETE RESTRICT` FK fails 23503 — degrade to archive, don't surface the raw error

**Symptom**: Admin SAMO Shop → ลบสินค้า on a product that has been ordered
→ "ลบไม่สำเร็จ: {"code":"23503", ... "shop_order_items_product_id_fkey" ...}".
The raw PostgREST error JSON is dumped into the toast.
**Cause**: `shop_order_items.product_id references shop_products(id) ON DELETE
RESTRICT` (0003 schema) — deliberately protects order history. Any product
that appears in even one order can never be hard-deleted; PostgREST returns
Postgres error 23503 (the FK guard makes the DELETE a clean no-op, so nothing
is half-deleted). `deleteProduct` rethrew `error.message` raw (which, via
`dbRest`, is the whole PostgREST JSON body string — that's why the toast
showed JSON).
**Fix**: `shop_products` already has `is_active` + a read policy
`using (is_active OR current_user_is_shop_admin())`, so archiving (set
`is_active = false`) hides a product from the shop while keeping it visible to
admin and preserving every order FK. Same write RLS as DELETE
(`shop_products_write_admin` `for all`), so no auth change and no soft-delete-
RLS trap. `deleteProduct` now detects 23503 / the FK name and throws a typed
`PRODUCT_HAS_ORDERS` error; the admin click-handler offers a confirm to
`archiveProduct()` instead.
**Where**: `src/js/shop/api.js` (`deleteProduct` typed error +
`archiveProduct`), `src/js/shop/admin.js` (delete handler fallback). **Latent
parallel**: `project_documents.type_id references project_doc_types(id) ON
DELETE RESTRICT` (0005) is the same class — no UI deletes doc types today, but
if one is added, apply the same detect-23503-then-archive/block pattern.

---

---

## Check constraint must be dropped BEFORE updating to a new enum value

**Symptom**: Running a migration that renames enum values fails with
`ERROR: new row for relation "X" violates check constraint "X_col_check"`
on the `UPDATE` statement itself — even though that UPDATE's whole job
is to move the values to the new set.
**Cause**: PostgreSQL evaluates check constraints on every row mutation.
If the migration UPDATEs to a value that's outside the OLD check, the
update fails before the new ALTER … ADD CHECK runs.
**Fix**: Always `ALTER TABLE … DROP CONSTRAINT IF EXISTS X_check` **before**
`UPDATE … SET col = new_value`, then `ALTER TABLE … ADD CONSTRAINT X_check
CHECK (col IN (new_set))` afterwards. Also broaden the UPDATE to
`WHERE col NOT IN (new_set)` so a re-run / unexpected legacy value
doesn't get left in an invalid state.
**Where**: `supabase/migrations/0007_shop_refactor.sql` for the shop
`source` enum (md/rt/mdi/sittikao). Apply this pattern to any future
enum-rename migration.

---

---

## (Passport) An `AFTER INSERT`-on-`auth.users` re-key trigger only fires for accounts that have NEVER logged into the project — pre-existing accounts silently don't get their carried data

**Symptom**: A gmail→kkumail migration test on `pmphuriphat→phuriphat.ma`
showed the receiving kkumail account with **no points/activities/stamps**,
even though the migration "moved" the data.
**Cause**: The merge relies on `passport_link_user_by_email()`, wired as
`on_auth_user_created_passport_link` **AFTER INSERT on auth.users** (0060/0063).
It re-keys a carried profile (matched by email) to the new auth uuid — but only
on the **INSERT** of the auth user, i.e. the account's **first-ever login** to
the project. `phuriphat.ma` already had an auth user (logged in months earlier),
so the trigger had already fired (finding nothing then) and will NOT fire again;
`ensureProfile()` matches by **uuid only** (not email), so it just creates an
empty profile. Data stranded on the old-uuid profile. **The real 5 are fine** —
verified none of their kkumail addresses had a pre-existing `auth.users` row, so
their first kkumail login WILL fire the re-key. The trap is only for a target
account that already exists.
**Fix / how to test such a case faithfully**: don't rely on the login trigger
for an already-existing target — do the re-key manually (move
`scans.user_id`/`season_results.user_id`/`profiles.id` old→new uuid), which is
exactly what the trigger would have done. Before any future re-key migration,
check `auth.users` for a pre-existing target row; if present, the trigger won't
fire and the profile must be merged/re-keyed explicitly.
**Where**: trigger in `0060`/`0063`; `ensureProfile` in passport `js/auth.js`;
verification + tracker queries recorded in STATE.md passport section.

---

---

## A PL/pgSQL `RETURNS TABLE(... col ...)` function silently ignores `ORDER BY col` — the OUT-param name shadows the query column, so it sorts by the NULL variable

**Symptom**: `find_similar_vs_tickets` (migration 0068) returned the right rows
but in the wrong order — "most similar" was NOT first. No error; the migration
applied clean (the bug only executes at call time, which needs a real staff JWT,
so it never showed during `apply-migration`).
**Cause**: the function is `returns table (... sim real)` and the body did
`return query select …, similarity(…) order by sim desc`. In PL/pgSQL every
`RETURNS TABLE` column is also an OUT **variable**. The final SELECT column is the
*expression* `similarity(…)` — it has no output name `sim` — so `order by sim`
does NOT bind to the query column; it binds to the OUT variable `sim`, which is
unset (NULL) at that point → `order by NULL` → no effective sort. Postgres does
not raise; it just doesn't sort.
**Fix**: order by the **explicit expression**, never the OUT-param name:
`order by …, similarity(regexp_replace(…), v_problem) desc`. (Alternatives:
rename the OUT column so it can't shadow, or `order by <position>`.)
**Where**: `supabase/migrations/0068_vs_dedup.sql` `find_similar_vs_tickets`.
Rule: in any `RETURNS TABLE` PL/pgSQL function, never `ORDER BY`/`WHERE` on an
OUT-param name that isn't an actual output alias of the query — use the
expression or a column position. Verify sort-dependent RPCs by executing them
(not just applying), since the shadowing is silent.

---

---

## A self-update column guard must exempt the definer FUNCTION that writes on login — `auth.uid() is null` only catches the TRIGGER shape

**Symptom**: 0110 added `team_members_self_update_guard` so a member may correct
their own ชื่อเล่น / รหัส / ชั้นปี / สาขา but never their own `permissions`. It
applied cleanly. The proof script then reported nine "PASS"es for the escalation
probes and nine EMPTY results everywhere else — and the empty results were the
real signal. The actual error:
```
P0001: team_members_self_update_guard: you may only edit your own name, …
CONTEXT: SQL statement "update public.team_members set user_id = v_uid
                         where lower(kkumail) = lower(v_email) …"
         PL/pgSQL function sync_my_team_permissions() line 27
```
`sync_my_team_permissions()` runs on EVERY login. The guard would have locked
every member without `team_edit` out of the app — precisely the people the
feature exists for.
**Cause**: this is the 0041 class ("a self-update column guard bricks signup when
it blocks a column another trigger legitimately writes") wearing a second shape,
and the test 0041 taught does not catch it. 0041's offending writer was a
TRIGGER firing during signup, where `auth.uid()` is null — so `if auth.uid() is
null then return new` exempted it. Here the writer is a SECURITY DEFINER
**function**, called BY the member, so `auth.uid()` is their own real uid and the
guard sees an ordinary self-update of a guarded column (`user_id`). Enumerating
"which triggers write this column?" — which I did — misses it completely; the
question is "which SERVER CODE writes this column, under whose identity?".
**Fix**: exempt on the signal the server writer sets about ITSELF, which 0081 had
already established for the recompute trigger:
```sql
if coalesce(current_setting('app.team_sync', true), '') = '1' then return new; end if;
if auth.uid() is null then return new; end if;   -- migrations, tools/*.mjs
```
A client cannot forge it: PostgREST exposes no `set_config`, and the setting is
transaction-local. Find every writer mechanically rather than from memory:
```sql
select proname, prosecdef,
       (pg_get_functiondef(oid) ~* 'set_config\(''app\.team_sync') as sets_flag
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname='public' and p.prokind='f'
   and pg_get_functiondef(oid) ~* '(update|insert into|delete from)\s+public\.<table>';
```
That turned up two here — `sync_my_team_permissions` (fixed) and
`team_person_mirror_down` (0108, unreachable by a non-editor today; noted in the
migration rather than silently ignored).
**Where**: `supabase/migrations/0110_team_view_edit_split.sql` §4; regression
check `tools/team0110-view-edit.mjs` "LOGIN PATH", which runs FIRST because the
harness itself calls sync — if it fails, nothing below it means anything.
**Rules**: (1) before adding a `raise`-on-change column guard, run the query
above and read every hit, asking under WHOSE identity it executes — "server
context" is not the same as "null `auth.uid()`". (2) A definer function called
by an ordinary user is indistinguishable from that user unless it says so;
prefer an explicit transaction-local flag over inferring intent from `auth.uid()`.
(3) The nine false PASSes are the other lesson: probes that only assert "denied"
scored a completely broken transaction as a working guard. Always include one
probe that must SUCCEED — the login-path check is what exposed this.

---

## A UNIQUE EXPRESSION index cannot serve `ON CONFLICT (col)` — the upsert 42P10s, so the whole import is dead on arrival

**Symptom**: Found by scanning before any data existed, so it was never
reported: every chunk of the ระบบบ้าน student import would have failed with
`42P10 there is no unique or exclusion constraint matching the ON CONFLICT
specification`. The feature was complete, tested, deployed — and could not
import a single row.

**Cause**: The uniqueness rule was written as an expression index, because
`A@kku` and `a@kku` are one person:

```sql
create unique index students_kkumail_uniq on students (lower(btrim(kkumail)));
```

The write path expressed the SAME rule differently: the importer upserts through
PostgREST with `?on_conflict=kkumail`, which renders `ON CONFLICT (kkumail)`.
That can only bind to a unique index on the BARE column — an expression index
does not match, and Postgres refuses the statement outright rather than falling
back.

Both halves were individually reasonable, which is what made it invisible: the
index is the right rule, and `on_conflict=kkumail` is the obvious way to spell
an upsert. It is the "two implementations of one rule drift" class where the two
implementations are *a constraint and the statement that depends on it*.

**Fix**: Normalise at the boundary instead of matching at every reader. A
`BEFORE INSERT OR UPDATE` trigger lowercases and trims `kkumail`, which makes a
plain `unique (kkumail)` exactly equivalent to the expression index — and gives
`ON CONFLICT (kkumail)` something to bind to. Verified live: `Scan@KKUmail.COM`
and `scan@kkumail.com` collapse to one row, stored lowercased, and the second
insert UPDATES rather than duplicating. Same treatment applied to
`advisors.email`, which had the identical shape and no upsert yet.

**Where it lives now**: `supabase/migrations/0119_students_kkumail_upsertable.sql`
(`normalize_kkumail()` + `students_kkumail_key`; `normalize_advisor_email()` +
`advisors_email_key`). `src/js/house/api.js` `upsertStudents()`.

**Rules**: (1) If anything upserts a table, the conflict target must be a plain
unique constraint on the named columns — check `?on_conflict=` against
`pg_constraint`, not against "there is a unique index somewhere". (2) Prefer
normalising a key on WRITE over case-folding it in every index, policy and
comparison; `get_my_student_record()` and every RLS helper compare
`lower(btrim(...))` precisely because the stored value could not be trusted.
(3) A feature that is built, tested and deployed can still be 100% non-functional
on its first real use — exercise the actual write path against the real schema
before calling it done.

---

## Seeding an OBSERVED range as if it were reference data — the FK then rejects every real row outside the guess

**Symptom**: Caught before the first import, so nobody hit it: `students.sai_code`
references `sais(code)`, and the migration seeded exactly 100 rows, `'001'`–`'100'`,
on the belief that there were 100 สายรหัส. The real range is any 3-digit value —
สาย are the running number within a year cohort, so how high they go is simply how
many students a year has. Every student on a สาย above 100 would have failed the
foreign key with 23503, killing the import partway through.

**Cause**: The seed encoded a *guess about the world* as a *constraint on the
data*. `sais` looked like reference data (a fixed vocabulary we own, like
`team_majors`), but it is not — it is an OBSERVATION of what the university
assigned, and the only authority for it is the file being imported. Reference
data can be seeded; observations cannot, because the seed is a prediction and
predictions about enrolment go stale silently.

The tell was there in the migration: it shipped with a `DO $$ … raise exception
if the mapping is not 10×10 $$` block. An assertion that the data has exactly the
shape you assumed is not a safety check — it is the assumption restated, and it
passed precisely because the seed had produced it.

**Fix**: `sais` became derived. `ensure_sais(text[])` — SECURITY DEFINER, but
re-checking the `house` permission because it writes — upserts every distinct
code the file contains, and the importer calls it *before* writing students. The
arbitrary seed was deleted, but only rows nothing referenced. No maximum is
written down anywhere now; the column check is just `^[0-9]{3}$`.

**Where it lives now**: `supabase/migrations/0121_sais_are_not_a_fixed_range.sql`,
`src/js/house/api.js` `ensureSais()`, `src/js/house/index.js` `runImport()`.
`fields.test.js` asserts the house split stays within one สาย of even over 100,
287, 300, 320, 450 and 999 — a property that holds at any size, rather than the
old test's "exactly ten each", which was only true for the seeded range.

**Rules**: (1) Before seeding a lookup table, ask whether you OWN the set or are
OBSERVING it. Owned sets (roles, permission keys, houses-per-digit) can be
seeded; observed ones (คน, สาย, anything the outside world assigns) must be
derived from the data. (2) A foreign key onto a seeded observation converts every
unforeseen real value into a hard failure — prefer creating the parent on
demand. (3) An assertion that reproduces your own seeding step proves nothing;
make the test range-independent so it can fail.

---

## Applying "create the parent on demand" at ONE call site instead of on the table — the other three writers still 23503

**Symptom** (reported): setting a student's สาย to `200` in the admin form failed
with `23503 … violates foreign key constraint "students_sai_code_fkey" — Key is
not present in table "sais"`.

**Cause**: 0121 had already made `sais` a derived set and its write-up ended with
the rule *"prefer creating the parent on demand"*. That rule was then applied in
exactly one place — the CSV importer, which calls `ensure_sais()` before writing
students. Three other paths write `students.sai_code` and none of them did: the
admin สมาชิก form, สายรหัส change-request approval, and any future writer.

Same geometry as class 4/5 (per-PATH, not per-table), except the thing enforced
at one call site is an invariant rather than an authorization check. Writing the
rule down in the migration that discovered it did not make the next writer obey
it — which is the whole reason this repo prefers a mechanism over a note.

**Fix**: a `BEFORE INSERT OR UPDATE OF sai_code` trigger on `students` that
creates the `sais` row if absent. The FK stays, so integrity is still enforced,
but it can no longer reject a *valid* สาย. Every path is covered including hand
SQL. The importer's bulk `ensure_sais()` call is kept as an optimisation (one
statement vs ~1,800 trigger firings), not as the mechanism.

Verified live, four directions: admin creating on unseen สาย 200 → OK (house 0);
admin moving to unseen 753 → OK (house 3); malformed `20` → REFUSED by the
trigger; and a STUDENT self-editing to a non-existent 888 → still REFUSED, since
`update_my_student_record()` validates before the UPDATE and a student guessing a
สาย is a typo, not a discovery.

**Where it lives now**: `supabase/migrations/0122_students_create_sai_on_demand.sql`.

**Rule**: when a fix is "materialise X on demand", put it on the TABLE (trigger /
default / generated column), not in the one caller you happened to be looking at.
Count the writers first — `grep` the column name.

---

## "เปลี่ยนรหัสนักศึกษาเป็น 59… หรือ 64… แล้วรุ่นไม่เปลี่ยนตาม" — a DERIVED column filled once, never re-derived

**Symptom**: in ระบบบ้าน, editing a student's รหัสนักศึกษา from `65…` to `59…`
saved fine, and the รุ่น stayed **MD50**. It stayed wrong on every screen, on the
admin table, on the student's own card, and in the CSV export — consistently, so
nothing looked broken. 1 of the 3 rows then in `students` was in this state.

**Cause**: `students.cohort_year` is a stored copy of a value derived from
`student_id`, and the trigger that fills it (`students_fill_cohort`, 0117) was
written as:

```sql
if new.cohort_year is null and new.student_id is not null then
  new.cohort_year := public.cohort_from_student_id(new.student_id);
end if;
```

`is null` is true exactly once in a row's life. After the first fill the trigger
declines to touch the column forever, so a corrected รหัส has no effect on it.
And every reader — the RPC, the JS `cohortLabel`, the export — resolves the รุ่น
as `coalesce(cohort_year, cohort_from_student_id(student_id))`, i.e. the stale
copy always outvotes the live value it was derived from.

This is **class 6 (two implementations of one rule drift)** in its quietest
form: the two implementations are a derived column and the expression it came
from, and the drift is undetectable because the copy is what every reader
prefers. 0116 had already refused to denormalise the HOUSE onto `students` for
exactly this reason — *"a denormalised house column is the drift class waiting
to happen"* — and then `cohort_year` was added anyway, because filling a column
reads as a convenience rather than as a second copy.

**Fix**: recompute whenever `student_id` CHANGES, not only when the copy is
null. An explicit `cohort_year` in the same statement still wins (the transfer
student whose รหัส does not encode their intake), so the escape hatch survives.
Plus a backfill for rows already drifted, restricted to rows whose รหัส actually
yields a รุ่น — blanking the rest would destroy the one case the column is for.

The admin form also grew a live `รุ่น MD50` hint under the รหัส box. The bug was
in SQL, but the reason nobody noticed for weeks is that the derivation was
invisible at the moment of typing.

**Where it lives now**:
`supabase/migrations/0128_cohort_follows_the_sid_and_requests_answer_back.sql`
§1, proven by `tools/house0128-cohort.mjs` — which walks the whole life of a row
(insert → รหัส change → unreadable รหัส → explicit override → unrelated edit),
because a probe that only INSERTS scores this bug as a pass.

**Rule**: a stored copy of a derived value needs a rule for **every** write of
its source, not just the first. `if <copy> is null` is not that rule — it is
"fill once", and it silently means "never correct". Either make the column
GENERATED, or make the trigger fire on change; and when a reader `coalesce`s the
copy ahead of the source, the copy is now the authority whether you meant it or
not.

---

## A bidirectional mirror without an `is distinct from` guard is an infinite recursion

**Symptom** (avoided by design, not survived): merging ทีม SAMO and ระบบบ้าน onto
one `people` registry needs a mirror DOWN (registry → both placements) and a
mirror UP (each placement → registry), because all three surfaces have their own
editor. Written naively, an edit to `team_members` fires the up-mirror, which
writes `people`, which fires the down-mirror, which writes `team_members`, which
fires the up-mirror… until Postgres gives up on stack depth.

**Cause**: a trigger pair with no fixed point. Nothing in the cycle asks "has
this value already arrived?", so every hop is a genuine write and every write is
a new event.

**Fix**: every mirror writes only when the target actually differs —

```sql
update public.people p set full_name = new.full_name, …
 where p.id = new.person_id
   and (p.full_name, p.nickname, …) is distinct from (new.full_name, new.nickname, …);
```

The cycle then converges in two hops: the first write propagates, the second
finds the values already equal, writes zero rows, and fires nothing. **The guard
is not an optimisation — it is the termination condition**, and deleting it as
"redundant" restores the recursion.

Two things that make this easy to get wrong later:
- The guard has to be on **both** directions. One guarded side still terminates,
  but only by luck of ordering, and it stops terminating the moment a third
  mirror is added.
- `is distinct from`, never `<>`. A column going NULL → 'x' is a real change and
  `<>` answers NULL for it, so the write is skipped and the copies stay apart —
  the opposite failure, silent instead of loud.

**Where it lives now**: `supabase/migrations/0133_sync_both_ways.sql`
(`team_member_mirror_up`, `student_mirror_up`) and 0132's `person_mirror_down`.
Proof: `node tools/house0132-registry.mjs` (17/17).

**Rule**: when two tables must agree and both are writable, the sync needs a
fixed point, and equality IS the fixed point. Write the guard in the same commit
as the trigger — a mirror pair is one mechanism, and half of it is a hang.

---

## "เปลี่ยนชื่อเล่นในทีม SAMO แล้วระบบบ้านไม่เปลี่ยน" — a GENERATED column treated as a reason to skip the field

**Symptom**: an admin changed ชื่อเล่น in the ทีม SAMO pane. `team_members` and
`people` both took it; ระบบบ้าน kept showing the old one. Every other field —
name, รหัสนักศึกษา, สาขา — synced correctly, which is what made it look like a
one-field oddity rather than a structural miss.

**Cause**: the registry's mirror-down wrote eight columns to `students` and
`nickname` was not one of them. It had been excluded deliberately, with a
correct-sounding reason: `students.nickname` is
`generated always as (coalesce(nullif(nickname_self,''), nickname_imported))`,
and writing a generated column raises 428C9. True — and then nothing wrote the
columns it is generated FROM, so a real exclusion silently became "this field
never syncs".

**Fix**: write the source column. `nickname_self`, because it outranks
`nickname_imported` and the registry's value always arrived from an
authoritative editor (the person's own card, or an admin) — writing the import
slot instead would leave the visible value unchanged for anyone who had ever set
their own nickname, which was exactly the person in the report.

**The subtle half**: the mirror's `is distinct from` guard must compare the
**GENERATED** value, not the source it writes. Comparing `nickname_self` would
re-fire forever for a row whose effective nickname comes from
`nickname_imported` — the two are never equal, so the guard never terminates.
Compare what a reader sees, because "already in sync" is a statement about the
reader.

**Where it lives now**: `supabase/migrations/0134_nickname_syncs_too.sql`.
Guarded by `tools/house0132-registry.mjs` steps A8b/A8c.

**Rule**: a generated column is never a reason to skip a field in a sync — it is
a reason to write the field it derives from. And when the guard for that sync
compares values, compare the DERIVED one; comparing the source you just wrote
either never terminates or terminates on the wrong condition.

---

## "when i change ชั้นปี in the main web, nothing happens" — a mirror one-way on ONE column

**Symptom**: three reports in one message. Changing ชั้นปี on the home card did
nothing at all — the save reported success and the old value came straight back.
Changing รหัสนักศึกษา moved the รุ่น but not the ปี. And one person, after
setting their รหัส to `603070316-0`, read **ชั้นปี 5 on the main web, จบแล้ว
(ปี 10) in ระบบบ้าน, and ปี 5 in ทีม SAMO** — "the data become not syncing".

**Cause, part 1 — the revert.** `person_mirror_down()` pushed `people.year` into
`team_members.year`. `team_member_mirror_up()` never carried it back. The mirror
was bidirectional on eight columns and **one-way on the ninth**, so the my-seat
save did this:

```
A. before                        tm=5  people=5
B. after PATCH year=3            tm=3  people=5     ← the edit landed
C. after update_my_identity tail tm=5  people=5     ← the trigger undid it
```

Step C is `update_my_identity`'s own last statement — an unrelated `update
public.people`. Any touch of the registry reverted the edit.

The `is distinct from` guard cannot catch this. **The guard is a TERMINATION
condition, not a completeness check**: a column that is only ever written
downhill looks perfectly settled to it.

**Cause, part 2 — two implementations.** ระบบบ้าน DERIVES ชั้นปี
(`ปีการศึกษา − ปีที่เข้า + 1 + year_offset`, 0131) and re-derives ปีที่เข้า when the
รหัส moves (0128). ทีม SAMO STORED it, and nothing has ever bumped that column.
`src/js/house/fields.js` carried a comment predicting this precise failure since
0131 — *"every August all 399 quietly become last year's answer"*. It was that
August: 9 of 400 members were showing a ชั้นปี exactly one year behind, and the
only screen where the two answers appear side by side is one person's own card.

**Fix**: 0145. `people_fill_cohort` (0128's rule, on the registry);
`team_members` gains `cohort_year` + `year_offset`, mirrored DOWN;
`person_mirror_down` carries the INGREDIENTS and no longer carries the answer.
The rule moved out of `house/` into `src/js/study-year.js` — a rule two systems
need does not belong inside one of them, and living under `house/` is what made
"ทีม SAMO should use this too" read as a layering violation instead of the
obvious thing.

**Three details that were each nearly wrong**:

- **Order.** The backfill UPDATEs `people`, which fires the trigger. Run against
  the OLD trigger body it would have blanked the ชั้นปี of the 109 postings whose
  registry row never received a `year` — *for the bundle still being served*.
  Redefine the trigger first, then backfill.
- **Convert, don't discard.** 13 members have a ชั้นปี and no รหัส. Deriving only
  from the รหัส blanks exactly them. The backfill reads the stored ชั้นปี once,
  at the last moment we still know what it meant, as
  `ปีที่เข้า = ปีการศึกษา − ชั้นปี + 1`.
- **`app.team_sync` must be SAVED AND RESTORED, not blanked.** `person_mirror_down`
  now writes columns outside the self-update guard's allow-list, so it needs the
  server-writer exemption. `set_config(…, true)` is TRANSACTION-scoped and this
  AFTER trigger fires *between* the BEFORE guard's per-row invocations — blanking
  the flag lets row 1's mirror disarm the exemption for row 2, and the save fails
  only for members with more than one ตำแหน่ง.

**Answering the owner's question** ("should changing รหัสนักศึกษา change ชั้นปี?
i think it shouldn't"): it must — the รหัส is where ปีที่เข้า comes from, so a
corrected รหัส with a frozen ชั้นปี asserts that someone who entered in 2560 is
in their fifth year in 2569. What must *not* be recomputed is the part that is
about the person, and that is `year_offset`, a DIFFERENCE, which survives the
correction unchanged. The instinct is right; the offset is what satisfies it.

**And the same bug, client-side.** Found while scrutinising the fix:
`studyYear` reads `cohort_year || cohortFromStudentId(sid)` — the STORED cohort
wins — so both new call sites spread the row and overwrote only `student_id`,
keeping the old ปีที่เข้า. The admin's computed box refused to move while the รหัส
was being corrected, and an offset saved in that state is measured against a base
that no longer exists. `yearBasis()` is the one rule: the stored cohort is
trustworthy only while the รหัส it came from is unchanged.

**Where it lives now**: `supabase/migrations/0145_one_chan_pi_derived_everywhere.sql`
· `src/js/study-year.js` · proofs `tools/team0145-one-chan-pi.sql` (16/16) and
`tools/team0145-save-as-the-member.sql` (12/12, impersonated) · ratchet
`src/js/study-year.test.js`.

**Rule**: a bidirectional mirror is only bidirectional on the columns BOTH
directions name — enumerate them, because the `is distinct from` guard reports a
one-way column as settled. And when a comment predicts a failure, it will not
prevent it: this one was written down, correctly, eight months early, and the
bug shipped anyway. **The third fix is a test.** `study-year.test.js` now fails
the build on any `year:` key in a write payload, any second implementation of the
arithmetic, and any ชั้นปี rendered outside `studyYearLabel()`.

## "why 18 august has rail show green 100% shouldn't it be 10%"

**Symptom.** The legend read "ว่างให้ใช้โดยไม่ต้องจอง 10%" while the calendar's
capacity rail showed 60% on one day and 100% on the next. Dumping the segments
showed `week_free_pct` climbing with time: 10 → 60 → 160 → 260 → 360.

**Cause.** `claude_free_now(p_at)` subtracted two quantities measured at
different moments. `left` came from the newest sample — a fact about NOW (385 of
700 remaining). `reserved` was `ends_at > p_at`, the blocks still outstanding at
that FUTURE instant. So a Tuesday question subtracted Tuesday's shrunken
reservation list from Saturday's remaining pool, and every booking that finished
in between silently handed its quota back.

It does not come back: a block that runs SPENDS. With 315 used and 375 booked,
the week ends at 690 of 700 and 10 is the unbooked remainder at every moment
until the reset. The old code reached 160 on Tuesday by counting the same 150%
twice — once as "no longer reserved" and never as "spent".

**Fix.** Pin the reservation set to `least(p_at, now())`. A block between now and
`p_at` stays subtracted because it will consume its share before `p_at` arrives.
`least(...)` rather than a bare `now()` so a question about a PAST instant still
gets the reservation set that was outstanding then.

**Where it lives now.** `claude_free_now()` in
`supabase/migrations/0158_claude_a_finished_booking_spent_its_quota.sql`.
Guarded by `tools/claude0157-rail-segments.sql` §B5 — stated as "the weekly
remainder never RISES as time advances" rather than "is constant", so a change
that legitimately makes it fall stays green.

**The general rule.** *Two quantities in one subtraction must be measured at the
same instant.* This is the second time the same feature shipped this exact
shape (0156 was the week card reading `right_now`), and both times it was
invisible in review — the present is the one instant where every scope agrees,
and it is the instant you are looking at while you build.

## "i can even book at 06.00 which shouldn't be" — a guard checked against a state the insert changes

**Symptom.** With 17 Aug 08:00–13:00 booked at 100%, the board accepted a second
booking starting at 06:00 — and at 03:01, and at 05:00 for 1%. It also did the
opposite: writing 06:00@50% FIRST and then 08:00–13:00@50% was REFUSED
("คร่อมขอบเซสชัน"), although 50 + 50 is exactly 100 and perfectly legal. Which of
two bookings was allowed depended on which had been typed first.

**Cause.** `claude_booking_guard()` (0154 §5) validated the incoming row against
`claude_sessions()` derived from **the other rows**. But that derivation is
greedy **in `starts_at` order**, so a row inserted with an EARLIER start silently
re-derives everybody else's session — and nothing re-validated them. The guard
was checking the new row against a state the new row destroys.

Dumped after the third accepted insert, the derived sessions were
`07:00→12:00 @100` **and** `08:00→13:00 @100`: two 5-hour windows overlapping
four hours, each claiming a full 100%, which one Claude account cannot serve.
Physically, whoever sends the first message opens the window; a 06:00 start opens
[06:00, 11:00) and the 08:00 block is inside it, so they share one 100%.

The mirror image had the same single cause. The straddle rule refused any block
crossing a session edge because its percentage "belonged to no window" — a rule
that only ever fired on the LATER-written row, which is why the identical pair
was legal in one order and not the other.

**Fix.** Replace both session rules with one that is a property of the SET, so it
cannot depend on insert order: *for every 5-hour window opened in the chain, the
bookings whose time overlaps it may not claim more than 100% together.* The
openers are a chain (a booking inside an earlier booking's window joins it rather
than opening a second one), and the window the MEASUREMENT says is open right now
is an anchor too, carrying Claude's own reported utilization as its base load —
which is also what stops a late booking from squeezing somebody who is already
working. The straddle rule is deleted: under the window rule a crossing block IS
defined, because every window it touches is checked to have room for it.

⚠️ **The obvious version of this fix is too strict.** Treating every booking start
as a window opener refuses a booking that begins exactly when the previous window
closes — `claude0154-quota-guard.sql` §A4 went red, and one further case (§D5)
went red only as a CONSEQUENCE of it. The chain is not an optimisation.

**Where it lives now.** `claude_window_loads()` + `claude_booking_guard()` in
`0159_claude_a_window_is_shared_by_whoever_it_covers.sql`. One implementation,
three readers: the trigger refuses, `claude_booking_limits()` caps the form's
slider before anyone presses save, and the board draws each window's remaining
capacity. Guarded by `tools/claude0159-window-share.sql` (30/30, both directions,
FALSIFIED by restoring the 0154 guard — which reddens exactly A3–A6, B2, B4 and
C2 and nothing else) plus `src/js/claude/window-share.test.js`.

**The general rule.** *A guard that validates a candidate against a DERIVED state
must re-derive that state WITH the candidate in it.* Any derivation that depends
on ordering — greedy, `lag()`, "the last open X", a running total — is changed by
an insert anywhere but the end, and checking the newcomer against the old
derivation asks a question about a world that will not exist. The symptom is
always an asymmetry: the same set of rows is legal or illegal depending on the
order it was written in, and that asymmetry is the thing to look for.

---

## "it shouldnt show the rail as 100% in that 25%" — the rail derived its own 5-hour window, and the guard's disagreed

**Symptom.** *"i book 16.00-19.00 for 75% … it shouldnt show the rail as 100% in
that 25%, it shouldnt show yellow, currently there's a bug"*. A booking of 75%
for three hours opens a 5-hour window running 16:00–21:00. In the TAIL of that
window — after the block ends, before the window resets — the capacity rail
offered a whole fresh session.

**Reproduced exactly**, one booking 03:00–06:00 at 75%:

```
claude_window_loads()  a 06:00–08:00 booking → load 175, REFUSED
claude_free_now(06:00) → free 100,  window 06:00–11:00
```

The trigger and the rail, two centimetres apart on the same screen, answering
the same question with two different windows.

**Cause.** `claude_window_loads()` (0159) derives the window from the BOOKING
CHAIN: a booking opens one and everything landing inside joins it.
`claude_free_now()` derived its own from the CLOCK — if the measurement reported
no open window it simply said `[p_at, p_at + 5h)`, and counted only the bookings
overlapping *that*. A block that had already finished inside the real window was
therefore invisible to it, so the tail always looked untouched.

This is the drift class, and the 0154 header had already claimed immunity from
it: *"the arithmetic has exactly one home and it is the database."* It was, and
then the database grew a second one. **A rule can drift between two functions in
the SAME schema; "one home" has to mean one FUNCTION, not one tier.**

**Fix.** `claude_free_now()` stops deriving anything and asks
`claude_window_loads()` which windows contain the instant, taking the heaviest —
the same `order by load_pct desc limit 1` the trigger uses. Everything the
hand-rolled version did is already in there and better: the live measured window
as an anchor, "for the LIVE window count only from now forward" (0158), and for a
chain window count everything OVERLAPPING it, which is the half that was missing.

⚠️ **This gave the rail a new boundary.** The answer now also changes at
`booking_start + 5h`, an instant nothing on a calendar marks and which was in no
other term of `claude_free_windows()`' union. Without adding it the rail draws
ONE band across the reset carrying the smaller number for hours — the same shape
as 0157's BUG 1. It is added as a deliberate SUPERSET (every booking's start+5h,
including bookings that joined an earlier window and open nothing), because a
boundary too many splits one band into two carrying the same number and the
client merges those, while a boundary too few is a wrong number for hours.

⚠️ **AND THE REWRITE SILENTLY REVERTED 0158.** `claude_free_now()` was rebuilt
from the 0155 migration text rather than from the live function body, so
`least(p_at, v_now)` — 0158's whole content — went back to `p_at` and the weekly
remainder started growing again just by asking about a later instant.
`claude0155-free-now.sql` §C3/§C3b went red immediately. This is class 7
verbatim ("read the LIVE function body, not the migration that first defined
it") and it had already been written up once, for a different function.
**`create or replace` over a function that several migrations have edited undoes
all of them at once, and nothing warns you.**

**Where it lives now.**
`0161_claude_the_rail_reads_the_same_window_the_guard_does.sql`. Guarded by
`tools/claude0161-rail-guard-parity.sql` (10/10) — a DIFFERENTIAL, not a list of
expected numbers: over every quarter-hour of the quota week,
`claude_free_now(t)->session->free_pct` must equal
`pool − max(claude_window_loads load at t)`. FALSIFIED by restoring the pre-0161
body inside the transaction, which reddens exactly A2, A3 and B1 and leaves both
controls green. Its §D2 re-asserts the 0158 property from this file too, because
rewriting this function is precisely the event that undoes it.

**The general rule.** *When two functions must agree, the guard is a
differential over their whole input domain, not an example.* An example is
written from the same understanding the code was and passes the day somebody
changes one side. And when a proof's own subject is polluted by live state (a
first draft asserted "the whole pool" at `booking_start − 5h` and got 93,
because a real window was open and carrying 7%), the case does not belong in
that file — it belongs where a controlled sample forces the branch.

## 11 students' passport totals were higher than their own scans, and nothing could ever subtract

**Symptom.** `passport.profiles.total_km` disagreed with the sum of that
person's `passport.scans` for 11 profiles — by 100 up to 2,850. **Every single
drift was POSITIVE.** Not one profile had fewer points than its scans justified.

**Cause.** `passport.scans` carried exactly ONE trigger from 0056 until 0174:
`on_new_scan`, **BEFORE INSERT**, which does
`update profiles set total_km = total_km + calculated_points`. Nothing mirrored
it. A deleted scan left its points on the profile for ever; an edited
`points_awarded` never applied the difference.

The asymmetry in the data was the whole diagnosis — a counter that only ever
gains can only ever be too high — and the structure confirmed it before any
hypothesis was tested: one trigger, one event, `INSERT`.

**Proved, not inferred.** Inside a rolled-back transaction, deleting one
200-point scan left `total_km` at 300 while the remaining scans summed to 100.
Separately, the live-era id range (>648) holds 480 rows across 555 ids — **75
missing** — so scans *are* deleted in normal operation.

**Fix.** Migration 0174 adds `on_scan_deleted` (AFTER DELETE, subtract
`old.points_awarded`) and `on_scan_points_changed` (AFTER UPDATE, apply the
delta, and handle a scan moving between users as a debit plus a credit).
Both subtract **the value the insert actually stored**, never a recomputed one:
`is_marketing_bonus` doubles points at insert time and can be toggled later, so
recomputing would reintroduce the same asymmetry in reverse. Guarded by
`tools/passport0174-total-km-symmetry.sql` (proof #26), falsified by dropping
the delete trigger and watching it go red.

⚠️ **The migration deliberately does NOT recalculate existing totals.** Doing so
would REMOVE points from real students — one would drop from 3,600 to 750.
Whether a student keeps points they have already been shown is an owner's
decision, not a migration's.

⚠️ **AND THE BUG DOES NOT EXPLAIN EVERY ROW — do not claim it does.** One
profile sits 1,996 above her scans, and every `points_awarded` in the table is
0/50/100/200/500 with no hourly or non-round activity, so **1,996 is not
reachable by any combination of deleted scans**. That total was written
directly: `passport.profiles_guard` blocks `total_km` edits except for
`pg_trigger_depth() > 1` (the trigger path) or `is_admin()`. Two more rows are
the test account migration (`account_migrations`). A cause that explains 8 of 11
rows is not the cause of 11.

**Where it lives now.** `supabase/migrations/0174_…`,
`tools/passport0174-total-km-symmetry.sql`, registered in `run-proofs.mjs`.

**The general rule.** *A derived total maintained by a trigger needs a trigger
on every event that can change its inputs — INSERT alone is a counter that only
counts up.* The tell is in the data before you read any code: **if every drift
points the same direction, the mechanism is one-way by construction.** And when
a stored aggregate exists at all, ask what recomputing it would DO to a real
person before offering that as the fix.

## "144 students cannot sign in" — a false alarm from reading the function instead of the trigger list

**Symptom.** A late-session audit reported that 144 passport students would fail
to sign in, with 25,150 km at stake. It was written into the handoff as the top
open item. **It was wrong.**

**Cause.** `passport.handle_new_user()` inserts a profile keyed on the new auth
uuid and never matches by email, and `passport.profiles.email` is UNIQUE — so
reading that function, the collision looks certain. **But that function is not
attached to `auth.users`.** The trigger that actually fires on signup is
`on_auth_user_created_passport_link` → `public.passport_link_user_by_email()`,
which finds a carried profile by email and re-keys `scans`, `season_results`
and `profiles.id` onto the new auth id. The mechanism the merge playbook asked
for HAD been built; the audit never looked for it.

**Fix.** Retracted in the same session it was written, before `/clear`.

**The general rule.** *A function body tells you what would happen IF it ran —
`pg_trigger` tells you whether it runs.* Never conclude a signup/insert path is
broken from the function alone: list the triggers on the table first, and
confirm the one you are reading is among them. A dead function is
indistinguishable from a live one when you only read its body — and this repo
has the mirror-image rule already (verify from the authority, not from the
definition you happen to be looking at).

⚠️ **The one REAL finding underneath it**: `passport_link_user_by_email` wraps
its whole re-key in `exception when others then raise warning`. It fails
SILENTLY — signup still succeeds and the student silently gets an empty
passport. **Built 2026-08-30** as `tools/passport-link-on-signup.sql`, which
counts profiles whose email matches an `auth.users` row with a different id —
and which found the entry below on its first run.


## A carried passport student would have signed in to 0 km — 0174's new trigger fired on a path it was not written for

**Symptom.** None reported, and none reachable by a bug report: no student had
hit it yet. A guard written for a *different* hazard the next day reported
`got = 0 km / 1 scans` where it wanted `100 km / 1 scans`. A student carried over
from the old passport project, signing in for the first time, would arrive with
every stamp present and `total_km` at zero — so the leaderboard (which sums
scans) would still show them, while the tier badge (which reads `total_km`)
would drop them to Novice.

**Cause — the two halves of one rule, written a day apart and never run
together.** `public.passport_link_user_by_email()` re-keys a carried profile in
this order:

```sql
update passport.scans          set user_id = new.id where user_id = v_old_id;
update passport.season_results set user_id = new.id where user_id = v_old_id;
update passport.profiles       set id      = new.id where id      = v_old_id;
```

For as long as that function had existed, `passport.scans` had no UPDATE
trigger, so line one was pure re-pointing and the profile carried its `total_km`
across untouched. **0174 added `on_scan_points_changed`**, which — correctly, for
the case it was written for — treats a change of `user_id` as a transfer between
two people: debit `old.user_id`, credit `new.user_id`. At line one the profile
has not moved yet. There is no row at `new.id`. So the debit emptied the
student's real profile and the credit updated **zero rows**, and line three then
carried the emptied profile onto the new id.

0174 was right about transfers and blind to identity: this is not a scan
changing hands, it is one person's row changing its key. **Reordering does not
help** — move the profile first and the same trigger DOUBLES the total instead,
because then the debit is the no-op.

**Fix.** `0175_passport_relink_keeps_the_km.sql`. After the re-key, restate the
invariant the passport holds everywhere else rather than trying to out-order a
trigger:

```sql
update passport.profiles p
   set total_km = coalesce(
         (select sum(s.points_awarded) from passport.scans s where s.user_id = p.id), 0)
 where p.id = new.id;
```

Measured at the time: all 631 profiles already satisfied that equality (0174's
reconciliation left drift at 0), so it asserts the property instead of
compensating for one particular trigger — a fourth trigger written later cannot
reopen the same hole.

**Exposure: zero students.** The window was 2026-08-29 15:00 UTC (0174 applied)
to 2026-08-30. 144 carried profiles hold km and have not signed in; every one of
them was one signup away from losing it. The two signups inside the window were
not carried students, and no profile drifts from its scans.

**Where it lives now.** `supabase/migrations/0175_…`,
`tools/passport-link-on-signup.sql` (proof #27 in `run-proofs.mjs`) — step *"the
km and the stamps follow the student"*.

**The general rule.** *Adding a trigger adds it to every writer of that table,
including the ones you are not looking at.* A trigger is not a feature of the
statement you wrote it for; it is a feature of the TABLE, and it fires for every
path that touches the column — including a maintenance path whose semantics are
the opposite of the one you had in mind. Before shipping a trigger, `grep` for
every statement in the codebase that writes the column it keys on, and ask what
the trigger means on each. **And the tell here is a multi-statement operation
where the trigger fires between the statements**: the re-key is atomic to the
person reading it and four separate events to Postgres, so a trigger sees the
row half-moved. Where one operation spans several statements, the invariant has
to be RESTATED at the end, not maintained incrementally at each step.

## A migration that applies cleanly on a fresh database and then fails at RUNTIME, far from the change — plpgsql bodies are not resolved at CREATE time

**Symptom (latent — recorded before it bites, not after).** `0173`'s
`analytics_overview()` reads `passport.activities` and `passport.certificates`
directly, because Passport shares the same Google account and therefore the same
GAS quota. Postgres does **not** resolve a plpgsql body at `CREATE FUNCTION`
time, so on a database with no `passport` schema the migration applies with no
error at all, and the failure appears the first time someone opens สถิติ.

That is the worst shape a schema fault can take: the break is arbitrarily far
from the change, in time and in the stack, and the migration that caused it has
already been recorded as successful.

**Who it affects.** Nobody today — production and `samo-dev` both carry the
schema. It is a hazard for a **new** environment: a scratch project, a partial
restore, a per-developer database that dumps only `public`.

**Fix, if it ever bites.** Wrap the two passport arms in
`to_regclass('passport.activities') is not null`, and leave the arms in place —
Passport traffic is real, and counting it is the whole point of `0172`. Do not
"fix" it by deleting them.

**Where it lives now.** Here, and in `docs/SELF-HOST.md`'s notes, where someone
standing an environment up will meet it. ⚠️ **It used to live as a comment
appended to `0173` itself, which is what made `npm run migrate:status` report
`EDITED AFTER RECORDING` for 23 days.** A migration is a record of what ran; the
checksum guard cannot tell a comment from a `where` clause, and it is right not
to try. The file has been restored to the bytes that were applied.

**The general rule.** *Anything a migration teaches you AFTER it has run belongs
somewhere a checksum does not cover.* If the lesson is worth writing, it is
worth writing where the next person will look — a write-up, the setup doc, a
comment on the live function — never as an edit to the applied file, which
trades a real integrity check for a paragraph nobody was going to read there.

---

## I edited a migration after applying it, and samo-dev had been four migrations behind while STATE.md said "in step"

**Symptom.** `npm run migrate:status`, run during a handoff audit rather than
because anything looked wrong:

```
⚠️  EDITED AFTER RECORDING — the file no longer matches what was applied:
  0187_a_discord_account_nobody_claims.sql
  A migration is a record of what ran. Write a NEW one instead of editing this.
```

and, on the dev project, **`PENDING: 4`** — while `STATE.md` carried
*"✅ samo-dev is IN STEP with production (2026-09-07)"*.

**Cause 1 — the edit.** 0187 was applied, and then its COMMENTS were improved
twice in the same session: the measured note that a foreign key on `person_id`
breaks deleting a person, and the admission that the `is distinct from` guard is
not the load-bearing line. Both are good comments. Neither belongs in a file
that has already run — the tool hashes what it applied, and the moment the file
diverges, nobody can tell which version is in the database.

**Fix, and the condition on it.** Every statement in 0187 is idempotent
(`create table if not exists`, `create or replace function`,
`drop trigger if exists` + `create trigger`), so it was **re-applied** and the
record is true again — `PENDING: 0 · in step`. ⛔ **That is only available
because the edit was comments over idempotent DDL.** Had it touched the schema,
re-applying would have been the wrong move and a new migration the only one.
The rule does not bend: a migration is a record of what ran.

**Cause 2 — the drift, which predates the session.** 0183, 0184, 0186 and 0187
had never been applied to samo-dev. The STATE.md line went stale on 2026-09-12
and nobody re-asked, because the sentence reads like a fact rather than like a
measurement with a date on it. It now says *"ask `npm run migrate:status --
--dev`, never this sentence"*.

**⚠️ And applying them, I made it worse before better.** I read a `tail -6` of
the pending list; 0183 was above the cut. 0185 went in without its parent table
and three others failed on `relation "public.discord_links" does not exist`.
Re-applying in dependency order fixed it — but a migration that succeeds out of
order is the dangerous half: it leaves a database no migration file describes.

**Where it lives now.** `STATE.md` (contributor-credentials block);
`docs/state/phuriphatma.md`.

**The general rule.** *A migration's file and the database are two copies of one
fact, and the tool that compares them is the only thing that can see them
disagree — so run it when nothing looks wrong.* Both halves here were invisible
to tests, to the build and to the app: production was correct, dev was correct
for everything anybody had run, and the only symptom was a status command nobody
had reason to type. **Run `migrate:status` for BOTH projects at the end of any
session that applies a migration** — and read the whole pending list, because
these files have dependencies and a truncated list applies them out of order.
