-- ============================================================
-- security0235-whole-class-sweeps.sql — five standing security PROPERTIES,
-- each proved with an ALLOW list plus a PLANTED control, so the detector
-- cannot be blind to the hazard it exists for (skills/write-a-guard.md:
-- "its control finds nothing either" is one of the six ways a guard lies).
--
-- §0  every table in public/passport carries row security, except ONE named
--     exception that also carries no grant (so a policy would be moot
--     anyway — _timeline_backup_0166, docs/mistakes/postgres-schema.md).
-- §1  every SECURITY DEFINER function pins search_path.
-- §2  every function anon can EXECUTE is on this list, with a reason. A
--     function that becomes anon-executable without a matching line here
--     turns this proof red — "a new definer function then FAILS until
--     someone decides" (NIGHT-TASKS task 15's own wording).
-- §3  every PERMISSIVE write policy reading `using (true)` /
--     `with check (true)` for anon or authenticated is on this list.
-- §4  no table holds an anon/authenticated WRITE grant (the Supabase
--     default-ACL every new table in `public`/`passport` is born with) while
--     lacking row security to actually gate it — the 0188 hazard, generalised
--     into a proof instead of a one-off fix.
--
-- WRITTEN AGAINST A LIVE FINDING, not a hypothetical: before migration 0235,
-- §2a failed for real — 51 trigger functions and 4 internal helpers
-- (`resolve_person_id` chief among them — it INSERTs into `public.people`,
-- the one person registry, from caller-supplied text with no permission
-- check at all) were anon-executable with no business being direct RPCs.
-- Run this file before AND after 0235 to see that red become green for the
-- right reason, not a relaxed assertion.
--
--   node tools/db-query.mjs tools/security0235-whole-class-sweeps.sql
--   node tools/db-query.mjs tools/security0235-whole-class-sweeps.sql --dev
-- ============================================================
begin;

create temporary table probe (step text, expected text, got text) on commit drop;

-- ============================================================
-- §0 — row security on every table
-- ============================================================
create temporary table _rls_allow (schema text, tbl text, reason text);
insert into _rls_allow values
  ('public', '_timeline_backup_0166',
   'scratch backup table — revoke all from public/anon/authenticated too, so a policy would be moot (0166)');

insert into probe select '0a. every table has row security, except the allow-listed exceptions', 'true', (
  not exists (
    select 1
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('public', 'passport') and c.relkind = 'r'
      and not c.relrowsecurity
      and not exists (select 1 from _rls_allow a where a.schema = n.nspname and a.tbl = c.relname)
  )
)::text;

insert into probe select '0b. the one RLS exception also carries no write/read grant (not a live hazard)', 'true', (
  not exists (
    select 1 from information_schema.role_table_grants g
    join _rls_allow a on a.schema = g.table_schema and a.tbl = g.table_name
    where g.grantee in ('anon', 'authenticated')
      and g.privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'SELECT')
  )
)::text;

create table public._security0235_rls_control (id int);
insert into probe select '0c. CONTROL — an unlisted table with no RLS is caught', 'false', (
  not exists (
    select 1
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = '_security0235_rls_control'
      and not c.relrowsecurity
      and not exists (select 1 from _rls_allow a where a.schema = n.nspname and a.tbl = c.relname)
  )
)::text;
drop table public._security0235_rls_control;

-- ============================================================
-- §1 — every SECURITY DEFINER function pins search_path
-- ============================================================
insert into probe select '1a. every SECURITY DEFINER function in public/passport pins search_path', 'true', (
  not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'passport') and p.prosecdef
      and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')
  )
)::text;

create function public._security0235_definer_control() returns boolean
  language sql security definer as $$ select true $$;
insert into probe select '1b. CONTROL — an unpinned SECURITY DEFINER function is caught', 'false', (
  not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = '_security0235_definer_control' and p.prosecdef
      and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')
  )
)::text;
drop function public._security0235_definer_control();

-- ============================================================
-- §2 — anon EXECUTE is an allow-list, not a default
-- ============================================================
create temporary table _exec_allow (schema text, fn text, args text, reason text);
insert into _exec_allow (schema, fn, args, reason) values
  ('passport', 'admin_covers_dept', 'p_dept_id integer, p_sub_dept_id integer',
    'passport RLS/admin-scope helper — anon must be able to evaluate it to get a quiet deny'),
  ('passport', 'is_admin', '', 'passport RLS helper, same reason'),
  ('public', '_registry_admin_ok', '', 'registry-merge RLS helper'),
  ('public', 'apply_product_production_status', 'p_product_id text, p_status text',
    'fails closed on current_user_is_shop_admin() — a direct staff RPC'),
  ('public', 'current_samo_year', '', 'read-only; the current SAMO year is not a secret'),
  ('public', 'current_user_can_manage_pr', '', 'RLS/permission helper'),
  ('public', 'current_user_can_publish_project', '', 'RLS/permission helper'),
  ('public', 'current_user_dept', '', 'RLS/permission helper'),
  ('public', 'current_user_has_any_grant', '', 'RLS/permission helper'),
  ('public', 'current_user_has_permission', 'perm text', 'RLS/permission helper'),
  ('public', 'current_user_is_prof', '', 'RLS/permission helper'),
  ('public', 'current_user_is_project_actor', '', 'RLS/permission helper'),
  ('public', 'current_user_is_project_uni_staff', '', 'RLS/permission helper'),
  ('public', 'current_user_is_shop_admin', '', 'RLS/permission helper'),
  ('public', 'current_user_is_staff', '', 'RLS/permission helper'),
  ('public', 'current_user_is_vs_handler', '', 'RLS/permission helper'),
  ('public', 'current_user_project_seats', '', 'RLS/permission helper'),
  ('public', 'current_user_role', '', 'RLS/permission helper'),
  ('public', 'current_user_vs_depts', '', 'RLS/permission helper'),
  ('public', 'current_user_vs_scope', '', 'RLS/permission helper'),
  ('public', 'get_academic_year', '', 'every signed-in AND guest screen needs ชั้นปี math (0145)'),
  ('public', 'get_pr_ticket_by_id', 'p_id text', 'guest PR tracking by the capability token the submitter was given (0021)'),
  ('public', 'get_public_org_chart', '', 'the public org chart page'),
  ('public', 'get_public_team_chart', 'p_year integer', 'the public team chart page'),
  ('public', 'get_public_team_years', '', 'lists which years the public team chart can show'),
  ('public', 'get_public_vs_board', 'p_category text, p_sort text, p_limit integer', 'the public VitalSound board'),
  ('public', 'get_public_vs_problem', 'p_id text', 'a public VS board card''s detail view'),
  ('public', 'get_vs_linked_context', 'p_id text', 'a public VS card''s merged-duplicate context'),
  ('public', 'get_vs_ticket_by_id', 'p_id text', 'guest VS tracking by the capability token the submitter was given'),
  ('public', 'held_seat_key', 'p_cohort smallint, p_sai text, p_first text, p_last text', 'pure string helper, no table read'),
  ('public', 'lookup_email_by_username', 'p_username text, p_password text',
    'username sign-in — hardened by 0236 to stop returning a real email the caller could not already derive'),
  ('public', 'name_key', 'p text', 'pure string helper, no table read'),
  ('public', 'passport_scope_tokens', 'p_dept integer, p_sub integer', 'pure helper, no table read'),
  ('public', 'prof_can_see_document', 'p_doc_id text', 'RLS helper — always false for anon, since current_user_is_prof() is'),
  ('public', 'prof_can_see_file', 'p_file_id bigint', 'RLS helper, same reason'),
  ('public', 'prof_can_see_file', 'p_file_id bigint, p_sign_request_id text', 'RLS helper, same reason'),
  ('public', 'prof_can_see_project', 'p_project_id text', 'RLS helper, same reason'),
  ('public', 'project_doc_is_public', 'p_document_id text', 'RLS helper for the public-project read path'),
  ('public', 'project_is_public', 'p_project_id text', 'RLS helper, same reason'),
  ('public', 'public_stats', '', 'the public homepage counters'),
  ('public', 'samo_dept_keys', '', 'the 12 ฝ่าย keys — not a secret, also shipped client-side'),
  ('public', 'search_public_vs', 'p_query text, p_limit integer', 'the public VS board search box'),
  ('public', 'set_project_samo_dept', 'p_project text, p_dept text, p_on boolean', 'fails closed on current_user_can_publish_project()'),
  ('public', 'set_project_samo_depts', 'p_project text, p_depts text[]', 'fails closed on current_user_can_publish_project()'),
  ('public', 'shop_active_stock', 'p shop_products', 'pure helper over an already-fetched row'),
  ('public', 'shop_drive_url_ok', 'p_url text', 'pure validation helper, no table read'),
  ('public', 'shop_image_base', 'p_url text', 'pure string helper, no table read'),
  ('public', 'shop_image_cover', 'p_images jsonb', 'pure helper, no table read'),
  ('public', 'shop_images_ok', 'p jsonb', 'pure validation helper, no table read'),
  ('public', 'shop_reserved_matrix', 'p_product_id text', 'public stock display on the shop page'),
  ('public', 'shop_reserved_matrix_all', '', 'public stock display on the shop page'),
  ('public', 'shop_slip_url_ok', 'p_url text', 'pure validation helper, no table read'),
  ('public', 'shop_unit_price', 'p shop_products, p_size text', 'pure helper over an already-fetched row'),
  ('public', 'soft_delete_pr_ticket', 'p_id text', 'fails closed on current_user_can_manage_pr()'),
  ('public', 'student_id_key', 'p text', 'pure string helper, no table read'),
  ('public', 'sync_my_team_permissions', '', 'returns the EMPTY shape for a null auth.uid() — the caller''s own sync'),
  ('public', 'vs_merge_remarks', 'p_own jsonb, p_extra jsonb', 'pure jsonb helper, no table read'),
  ('public', 'vs_public_phase', 'p_status text', 'pure helper, no table read'),
  ('public', 'vs_remark_vis', 'e jsonb', 'pure helper, no table read'),
  ('public', 'vs_visible_remarks', 'p_remarks jsonb, p_level text', 'pure helper, no table read');

insert into probe select '2a. anon EXECUTE matches the allow-list exactly — nothing unlisted', 'true', (
  not exists (
    select 1
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'passport')
      and has_function_privilege('anon', p.oid, 'EXECUTE')
      and not exists (
        select 1 from _exec_allow a
        where a.schema = n.nspname and a.fn = p.proname
          and a.args = pg_get_function_identity_arguments(p.oid)
      )
  )
)::text;

insert into probe select '2b. every allow-listed entry is still actually anon-executable (no stale line)', 'true', (
  not exists (
    select 1 from _exec_allow a
    where not exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = a.schema and p.proname = a.fn
        and pg_get_function_identity_arguments(p.oid) = a.args
        and has_function_privilege('anon', p.oid, 'EXECUTE')
    )
  )
)::text;

create function public._security0235_exec_control() returns boolean language sql as $$ select true $$;
grant execute on function public._security0235_exec_control() to anon;
insert into probe select '2c. CONTROL — a newly-anon-executable, unlisted function is caught', 'false', (
  not exists (
    select 1
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'EXECUTE')
      and not exists (
        select 1 from _exec_allow a
        where a.schema = n.nspname and a.fn = p.proname and a.args = pg_get_function_identity_arguments(p.oid)
      )
  )
)::text;
drop function public._security0235_exec_control();

-- ============================================================
-- §3 — permissive true-policy writes are an allow-list too
-- ============================================================
create temporary table _policy_allow (schema text, tbl text, policy text, reason text);
insert into _policy_allow values
  ('public', 'analytics_events', 'analytics_events_insert_any', 'anonymous page-view pings; write-only, no anon SELECT'),
  ('public', 'notify_log', 'notify_log_insert_any', 'anonymous notification-attempt log; write-only, no anon SELECT'),
  ('public', 'pr_tickets', 'pr_tickets_insert_anyone', 'guest PR submission — no login wall on the PR form, by design'),
  ('public', 'vs_tickets', 'vs_tickets_insert_anyone', 'guest VS submission — no login wall on the VS form, by design');

insert into probe select '3a. every permissive true-check write policy is allow-listed', 'true', (
  not exists (
    select 1 from pg_policies pol
    where pol.schemaname in ('public', 'passport') and pol.permissive = 'PERMISSIVE'
      and pol.cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
      and (pol.qual = 'true' or pol.with_check = 'true')
      and not exists (
        select 1 from _policy_allow a
        where a.schema = pol.schemaname and a.tbl = pol.tablename and a.policy = pol.policyname
      )
  )
)::text;

create table public._security0235_policy_control (id int);
alter table public._security0235_policy_control enable row level security;
create policy _security0235_policy_control_insert on public._security0235_policy_control
  for insert to anon with check (true);
insert into probe select '3b. CONTROL — an unlisted true-check policy is caught', 'false', (
  not exists (
    select 1 from pg_policies pol
    where pol.schemaname = 'public' and pol.tablename = '_security0235_policy_control'
      and pol.with_check = 'true'
      and not exists (
        select 1 from _policy_allow a
        where a.schema = pol.schemaname and a.tbl = pol.tablename and a.policy = pol.policyname
      )
  )
)::text;
drop table public._security0235_policy_control;

-- ============================================================
-- §4 — an anon/authenticated WRITE grant with no RLS to gate it (0188)
-- ============================================================
-- relkind = 'r' on purpose: a VIEW (passport.user_tiers is the only one) has
-- no `relrowsecurity` of its own to turn on — its protection is
-- `security_invoker`, deferring to the underlying table's RLS, already
-- covered by migration 0214/Finding 1 of the 2026-10-13 report. Folding it
-- in here made this check fail for the WRONG reason on the first draft.
insert into probe select '4a. no TABLE grants anon/authenticated a WRITE while lacking row security', 'true', (
  not exists (
    select 1
    from information_schema.role_table_grants g
    join pg_class c on c.relname = g.table_name and c.relkind = 'r'
    join pg_namespace n on n.oid = c.relnamespace and n.nspname = g.table_schema
    where g.table_schema in ('public', 'passport')
      and g.grantee in ('anon', 'authenticated')
      and g.privilege_type in ('INSERT', 'UPDATE', 'DELETE')
      and not c.relrowsecurity
  )
)::text;

create table public._security0235_acl_control (id int);
insert into probe select '4b. CONTROL — a brand-new table, born anon-writable by the default ACL, with RLS left off, is caught', 'false', (
  not exists (
    select 1
    from information_schema.role_table_grants g
    join pg_class c on c.relname = g.table_name and c.relkind = 'r'
    join pg_namespace n on n.oid = c.relnamespace and n.nspname = g.table_schema
    where g.table_schema = 'public' and c.relname = '_security0235_acl_control'
      and g.grantee in ('anon', 'authenticated')
      and g.privilege_type in ('INSERT', 'UPDATE', 'DELETE')
      and not c.relrowsecurity
  )
)::text;
drop table public._security0235_acl_control;

select step, expected, got, case when expected = got then 'PASS' else 'FAIL' end as verdict
  from probe order by step;

rollback;
