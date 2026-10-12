-- ============================================================
-- pr0149-delete-permission.sql — does soft_delete_pr_ticket() honour the SAME
-- authorization as the DELETE policy it says it mirrors?
--
-- THIS IS A DIFFERENTIAL TEST. `soft_delete_pr_ticket` restates
-- `pr_tickets_delete_staff` in a second place (0043 chose an RPC precisely so
-- the soft-delete would not inherit the broader UPDATE policy), and two
-- implementations of one rule drift — which is exactly what happened: 0014 had
-- already added `current_user_has_permission('pr')` to the policy, 0043 was
-- written from 0001's pr_staff/dev-only version, and the RPC never learned the
-- permission channel. So every case below asks what the POLICY decides, then
-- asks what the RPC decides, and compares.
--
-- Both directions, because both are silent when wrong: a DENY-only probe cannot
-- tell a working guard from a broken service, and an ALLOW-only probe cannot see
-- a gate that has stopped gating.
--
-- Every subject is RESOLVED FROM THE DATA, never hardcoded — a proof whose
-- subject is a person's name rots the moment the org chart moves.
--
-- 0168 WIDENED THIS PROOF, because it widened what the drift was. The same rule
-- was spelled FOUR times, not two — pr_tickets_read's third branch,
-- pr_tickets_update_staff, pr_tickets_delete_staff and the RPC — and all four
-- now call one predicate, public.current_user_can_manage_pr(). So:
--
--   §A/§B/§C  behavioural, unchanged in shape: read / update / delete / rpc,
--             three subjects each, allow AND deny, every gate compared.
--   §D        STRUCTURAL, new: there is exactly ONE implementation. It fails if
--             a site stops calling the predicate, or starts spelling the rule
--             out again beside it. Behaviour alone cannot see that — four
--             identical copies agree perfectly right up until one is edited.
--
-- Each instrument UNDOES ITSELF by raising inside its own subtransaction, so
-- nothing here depends on the outer rollback and no probe row is lost to a
-- `rollback to savepoint` (which discards the temp-table insert as well).
--
--   node tools/db-query.mjs tools/pr0149-delete-permission.sql
-- ============================================================
begin;

create temporary table probe (step text, expected text, got text) on commit drop;
create temporary table verdict (subj text, gate text, got text) on commit drop;

-- ── Subjects ────────────────────────────────────────────────────────────────
-- perm: holds 'pr' ONLY through the permission channel (permissions[] or
--       managed_permissions[]) and has NO staff role. This is the shape a
--       ทีม SAMO node grant produces, and the one that was refused.
create temporary table subj_perm on commit drop as
select u.id as uid, u.role from public.users u
 where u.role not in ('pr_staff', 'dev')
   and not ('master' = any(coalesce(u.permissions, '{}')))
   and not ('master' = any(coalesce(u.managed_permissions, '{}')))
   and ('pr' = any(coalesce(u.permissions, '{}'))
     or 'pr' = any(coalesce(u.managed_permissions, '{}')))
 order by u.id limit 1;

-- role: holds the staff ROLE. The control that must stay ALLOWED.
-- Since 2026-09-26 NO account holds a staff role — samomdkkudev, the last
-- `dev`, became role 'user' + master — and this control silently lost its
-- subject (5 rows red). So when none exists it is MADE here, on a plain user,
-- inside this transaction, which rolls back. Do not relax the assertions.
create temporary table subj_role on commit drop as
select u.id as uid, u.role from public.users u
 where u.role in ('pr_staff', 'dev') order by u.id limit 1;
insert into subj_role
select u.id, 'pr_staff' from public.users u
 where not exists (select 1 from subj_role)
   and u.role = 'user'
   and coalesce(array_length(u.permissions, 1), 0) = 0
   and coalesce(array_length(u.managed_permissions, 1), 0) = 0
   and u.id not in (select uid from subj_perm)
 order by u.id limit 1;
-- users_self_update_guard lets only STAFF change a role, and STAFF is a ROLE
-- (current_user_is_staff) — which no account holds any more, so no caller can
-- pass it. Skip triggers for this ONE statement (no table lock; rolled back).
set local session_replication_role = replica;
update public.users set role = 'pr_staff'
 where id = (select uid from subj_role) and role not in ('pr_staff', 'dev');
set local session_replication_role = origin;

-- none: no PR access by any channel. The control that must stay DENIED —
--       without it, "denied" proves nothing, because a broken service denies
--       everyone.
create temporary table subj_none on commit drop as
select u.id as uid, u.role from public.users u
 where u.role not in ('pr_staff', 'dev')
   and not ('pr' = any(coalesce(u.permissions, '{}')))
   and not ('pr' = any(coalesce(u.managed_permissions, '{}')))
   and not ('master' = any(coalesce(u.permissions, '{}')))
   and not ('master' = any(coalesce(u.managed_permissions, '{}')))
 order by u.id limit 1;

create temporary table subj_ticket on commit drop as
select t.id from public.pr_tickets t
 where t.deleted_at is null order by t.id limit 1;

-- ── Instruments ─────────────────────────────────────────────────────────────
-- What the RLS DELETE POLICY decides. RLS does NOT raise on DELETE — it removes
-- zero rows — so the instrument counts rather than catching. The raise at the
-- end aborts the inner subtransaction, undoing the delete and carrying the
-- answer out in the message.
create or replace function pg_temp.policy_allows(p_uid uuid, p_id text)
returns text as $$
declare n int; msg text;
begin
  begin
    perform set_config('request.jwt.claims',
      json_build_object('sub', p_uid::text, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    with d as (delete from public.pr_tickets where id = p_id returning 1)
      select count(*) into n from d;
    raise exception using errcode = '22000',
      message = 'UNDO:' || case when n > 0 then 'allow' else 'deny' end;
  exception when sqlstate '22000' then
    get stacked diagnostics msg = message_text;
    execute 'reset role';
    return replace(msg, 'UNDO:', '');
  end;
end $$ language plpgsql;

-- What the READ policy decides. Counted over tickets the subject did NOT
-- submit, because pr_tickets_read has a submitter branch that has nothing to do
-- with the PR desk — counting all rows would score a guest's own ticket as desk
-- access. No undo needed: a select changes nothing.
create or replace function pg_temp.read_allows(p_uid uuid)
returns text as $$
declare n int;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.pr_tickets t
   where t.submitter_id is distinct from p_uid;
  execute 'reset role';
  return case when n > 0 then 'allow' else 'deny' end;
end $$ language plpgsql;

-- What the UPDATE policy decides. The write is a no-op assignment (status to
-- itself) so nothing is altered even before the undo, and the row is found by
-- id so a wrong subject cannot silently hit a different ticket.
--
-- ⚠️ This measures read AND update: Postgres needs the SELECT policy to locate
-- the row an UPDATE ... WHERE names. That is not a flaw here — it is exactly
-- what the app path requires, and both gates ask the same predicate now. If
-- they ever disagree, §A1r/§A1u disagreeing is the signal.
create or replace function pg_temp.update_allows(p_uid uuid, p_id text)
returns text as $$
declare n int; msg text;
begin
  begin
    perform set_config('request.jwt.claims',
      json_build_object('sub', p_uid::text, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    with u as (update public.pr_tickets set status = status where id = p_id returning 1)
      select count(*) into n from u;
    raise exception using errcode = '22000',
      message = 'UNDO:' || case when n > 0 then 'allow' else 'deny' end;
  exception when sqlstate '22000' then
    get stacked diagnostics msg = message_text;
    execute 'reset role';
    return replace(msg, 'UNDO:', '');
  end;
end $$ language plpgsql;

-- What the RPC decides. 'allow' is only reported when the soft delete actually
-- STAMPED deleted_at — passing the gate and doing nothing is a different bug,
-- and this proof must not score it as success.
create or replace function pg_temp.rpc_allows(p_uid uuid, p_id text)
returns text as $$
declare stamped boolean; msg text;
begin
  begin
    perform set_config('request.jwt.claims',
      json_build_object('sub', p_uid::text, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    perform public.soft_delete_pr_ticket(p_id);
    execute 'reset role';
    select (t.deleted_at is not null) into stamped
      from public.pr_tickets t where t.id = p_id;
    raise exception using errcode = '22000',
      message = 'UNDO:' || case when stamped then 'allow' else 'allow-but-no-stamp' end;
  exception
    when sqlstate '22000' then
      get stacked diagnostics msg = message_text;
      execute 'reset role';
      return replace(msg, 'UNDO:', '');
    when insufficient_privilege then
      execute 'reset role';
      return 'deny';
    when others then
      execute 'reset role';
      return 'ERROR ' || sqlstate;
  end;
end $$ language plpgsql;

-- ── Preconditions — a vacuous case passes, so assert the subjects exist ──────
insert into probe select 'S1. a permission-only PR user exists', '1',
  (select count(*)::text from subj_perm);
insert into probe select 'S2. a staff-role PR user exists', '1',
  (select count(*)::text from subj_role);
insert into probe select 'S3. an ungranted user exists', '1',
  (select count(*)::text from subj_none);
insert into probe select 'S4. a live PR ticket exists', '1',
  (select count(*)::text from subj_ticket);
insert into probe select 'S5. the permission-only subject carries no staff role',
  'true', (select (role not in ('pr_staff', 'dev'))::text from subj_perm);

-- ── Both gates, all three subjects ──────────────────────────────────────────
insert into verdict select 'perm', 'read',
  pg_temp.read_allows((select uid from subj_perm));
insert into verdict select 'role', 'read',
  pg_temp.read_allows((select uid from subj_role));
insert into verdict select 'none', 'read',
  pg_temp.read_allows((select uid from subj_none));
insert into verdict select 'perm', 'update',
  pg_temp.update_allows((select uid from subj_perm), (select id from subj_ticket));
insert into verdict select 'role', 'update',
  pg_temp.update_allows((select uid from subj_role), (select id from subj_ticket));
insert into verdict select 'none', 'update',
  pg_temp.update_allows((select uid from subj_none), (select id from subj_ticket));
insert into verdict select 'perm', 'policy',
  pg_temp.policy_allows((select uid from subj_perm), (select id from subj_ticket));
insert into verdict select 'role', 'policy',
  pg_temp.policy_allows((select uid from subj_role), (select id from subj_ticket));
insert into verdict select 'none', 'policy',
  pg_temp.policy_allows((select uid from subj_none), (select id from subj_ticket));
insert into verdict select 'perm', 'rpc',
  pg_temp.rpc_allows((select uid from subj_perm), (select id from subj_ticket));
insert into verdict select 'role', 'rpc',
  pg_temp.rpc_allows((select uid from subj_role), (select id from subj_ticket));
insert into verdict select 'none', 'rpc',
  pg_temp.rpc_allows((select uid from subj_none), (select id from subj_ticket));

insert into probe select 'A0a. READ allows the permission-only user', 'allow',
  (select got from verdict where subj = 'perm' and gate = 'read');
insert into probe select 'A0b. READ allows the staff-role user', 'allow',
  (select got from verdict where subj = 'role' and gate = 'read');
insert into probe select 'A0c. READ denies the ungranted user', 'deny',
  (select got from verdict where subj = 'none' and gate = 'read');
insert into probe select 'A0d. UPDATE allows the permission-only user', 'allow',
  (select got from verdict where subj = 'perm' and gate = 'update');
insert into probe select 'A0e. UPDATE allows the staff-role user', 'allow',
  (select got from verdict where subj = 'role' and gate = 'update');
insert into probe select 'A0f. UPDATE denies the ungranted user', 'deny',
  (select got from verdict where subj = 'none' and gate = 'update');
insert into probe select 'A1. DELETE POLICY allows the permission-only user', 'allow',
  (select got from verdict where subj = 'perm' and gate = 'policy');
insert into probe select 'A2. DELETE POLICY allows the staff-role user', 'allow',
  (select got from verdict where subj = 'role' and gate = 'policy');
insert into probe select 'A3. DELETE POLICY denies the ungranted user', 'deny',
  (select got from verdict where subj = 'none' and gate = 'policy');
insert into probe select 'B1. RPC allows the permission-only user', 'allow',
  (select got from verdict where subj = 'perm' and gate = 'rpc');
insert into probe select 'B2. RPC allows the staff-role user', 'allow',
  (select got from verdict where subj = 'role' and gate = 'rpc');
insert into probe select 'B3. RPC denies the ungranted user', 'deny',
  (select got from verdict where subj = 'none' and gate = 'rpc');

-- ── The differential itself ─────────────────────────────────────────────────
insert into probe select 'C1. RPC and POLICY agree on all three subjects', '3',
  (select count(*)::text from verdict p join verdict r
     on r.subj = p.subj and r.gate = 'rpc' and p.gate = 'policy'
   where p.got = r.got);

-- All four gates ask one predicate, so all four must return one answer per
-- subject. 3 subjects x 1 distinct answer = 3.
insert into probe select 'C2. all FOUR gates agree, per subject', '3',
  (select count(*)::text from (
     select subj from verdict where gate in ('read','update','policy','rpc')
      group by subj having count(distinct got) = 1) s);

-- ── §D. Structural: ONE implementation, not four that happen to agree ───────
-- Read from the AUTHORITY (pg_policy / pg_proc), never from the migration that
-- wrote them. The rule's old spelling is the thing that must be GONE: a site
-- that calls the predicate AND still carries `'pr_staff'` beside it has grown a
-- second copy again, and behaviour would not notice for as long as they match.
create temporary table site on commit drop as
select 'pr_tickets_read'          as name, pg_get_expr(polqual, polrelid) as src
  from pg_policy where polname = 'pr_tickets_read'
union all
select 'pr_tickets_update_staff', pg_get_expr(polqual, polrelid)
  from pg_policy where polname = 'pr_tickets_update_staff'
union all
select 'pr_tickets_delete_staff', pg_get_expr(polqual, polrelid)
  from pg_policy where polname = 'pr_tickets_delete_staff'
union all
select 'soft_delete_pr_ticket', p.prosrc
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'soft_delete_pr_ticket';

insert into probe select 'D0. all four sites were found (the sweep looked)', '4',
  (select count(*)::text from site);
insert into probe select 'D1. all four CALL current_user_can_manage_pr()', '4',
  (select count(*)::text from site where src like '%current_user_can_manage_pr%');
insert into probe select 'D2. none of the four still SPELLS the rule', '0',
  (select count(*)::text from site
    where src ~ 'pr_staff' or src ~ 'current_user_has_permission');
-- ⚠️ D3–D5 name the predicate, so each one is written to report 'MISSING'
-- rather than raise if it is not there. An aborted script is SILENCE — this
-- repo has lost 23 migrations of coverage to a proof that errored instead of
-- failing — and "the predicate was deleted" is precisely the regression §D is
-- here to catch, so it must be the loudest FAIL, not a stack trace.
insert into probe select 'D3. the predicate exists, is STABLE and SECURITY DEFINER', 'true',
  coalesce((select (p.prosecdef and p.provolatile = 's')::text
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'current_user_can_manage_pr'), 'MISSING');

-- Fail-closed is a property of the predicate now, not a branch each caller has
-- to remember. A caller with no public.users row has a NULL role, `null in
-- (...)` is NULL, and NULL must read as NO — coalesce is what makes it so.
--
-- The claim is CLEARED first, deliberately: set_config(..., true) is
-- TRANSACTION-scoped, so without this the probe would still be wearing
-- subj_none from the instrument above and would answer 'false' for the wrong
-- reason — a pass that proves nothing about the NULL branch.
create or replace function pg_temp.predicate_with_no_user() returns text as $$
begin
  perform set_config('request.jwt.claims', '{}', true);
  return public.current_user_can_manage_pr()::text;
exception when undefined_function then return 'MISSING';
end $$ language plpgsql;

insert into probe select 'D4. the predicate fails CLOSED for a caller with no users row',
  'false', pg_temp.predicate_with_no_user();

insert into probe select 'D5. the predicate is reachable by the app roles', 'true',
  coalesce((select has_function_privilege('authenticated', oid, 'execute')::text
      from pg_proc
     where oid = to_regprocedure('public.current_user_can_manage_pr()')), 'MISSING');

select step, expected, got,
       case when expected = got then 'PASS' else 'FAIL' end as result
from probe order by step;

rollback;
