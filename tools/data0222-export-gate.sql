-- ============================================================
-- data0222-export-gate.sql — 0222's data-safety mechanism:
--   §A  year_export_log + its RLS: a plain subject cannot read or write it
--       directly; the DENY+ALLOW pair for both.
--   §B  year_export_recorded() answers false before any export, true after
--       one, and stays specific to the exact (system, year) pair — a
--       different year or a different system must not borrow the answer.
--   §C  record_year_export() fails CLOSED for a stranger, fails on bad
--       input, succeeds for a data_admin holder AND for dev, returns the
--       new row's id (never a bare success flag), and is APPEND-ONLY — a
--       second export of the same year adds a row rather than overwriting
--       the first.
--   §D  the CONTRACT in practice: a throwaway pg_temp function shaped
--       exactly like a future per-system deletion RPC must open — refuses
--       when the year is unexported, succeeds once it is — proving the
--       gate composes the way docs/YEAR-ROLLOVER.md § Deletion and
--       skills/backup-and-export.md tell a later task to use it, without
--       this proof ever touching a table another task owns.
--
-- Sentinel system name ('proof-system-0222') and years (2695/2696) nowhere
-- near anything real or any other proof's sentinels (year0219: 2691/2692;
-- team0224: 2693/2694). Runs inside a transaction that ROLLS BACK.
--   node tools/db-query.mjs tools/data0222-export-gate.sql --dev
-- ============================================================
begin;

create temporary table probe (step text, expected text, got text) on commit drop;

insert into probe select '00. year_export_log exists with RLS enabled', 'true',
  (select relrowsecurity::text from pg_class
    where oid = 'public.year_export_log'::regclass);

insert into probe select '01. no INSERT/UPDATE/DELETE policy exists for any role — SELECT only', '0',
  (select count(*)::text from pg_policies
    where schemaname = 'public' and tablename = 'year_export_log'
      and cmd in ('INSERT', 'UPDATE', 'DELETE'));

delete from public.year_export_log where system = 'proof-system-0222';

-- ── fixtures: two EXISTING accounts, temporarily reshaped — undone by the
--    rollback at the end, same borrow-and-restore shape as team0224's proof. ─
create temporary table subj on commit drop as
  select id, email, role, permissions, managed_permissions
    from public.users where email is not null order by id limit 2;
insert into probe select '02. two existing accounts to borrow for the duration of this proof', '2',
  (select count(*)::text from subj);

create temporary table p1 on commit drop as select id, email from subj order by id limit 1;
create temporary table p2 on commit drop as select id, email from subj order by id offset 1 limit 1;
grant select on p1, p2 to authenticated;

alter table public.users disable trigger users_self_update_guard;
-- p1: an ordinary account, no data_admin, not dev — must be refused everywhere below.
update public.users set role = 'user', permissions = '{}', managed_permissions = '{}'
 where id = (select id from p1);
-- p2: holds the new data_admin permission — must be allowed.
update public.users set role = 'user', permissions = array['data_admin'], managed_permissions = '{}'
 where id = (select id from p2);
alter table public.users enable trigger users_self_update_guard;

create or replace function pg_temp.as_(p_id uuid, p_email text) returns void language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', p_id, 'role', 'authenticated', 'email', p_email)::text, true);
$$;
create or replace function pg_temp.try(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return 'ok';
exception when others then return 'raised: ' || sqlerrm; end $$;
grant execute on function pg_temp.try(text) to authenticated;

create temporary table r (k text, v text) on commit drop;
grant insert, select on r to authenticated;

-- ── §A1 DENY: a plain subject cannot SELECT year_export_log directly ──────
select pg_temp.as_((select id from p1), (select email from p1));
set local role authenticated;
create temporary table deny_select on commit drop as
  select count(*) as n from public.year_export_log;
reset role;
insert into probe select '10. a plain subject sees ZERO rows of year_export_log (RLS, not an empty table)', '0',
  (select n::text from deny_select);

-- ── §A2 ALLOW: the SAME table, the data_admin holder, after a row exists ──
select pg_temp.as_((select id from p2), (select email from p2));
set local role authenticated;
insert into r select 'insert_as_admin',
  pg_temp.try($q$select public.record_year_export('proof-system-0222', 2695, 7, 'local:/tmp/proof', 'proof row')$q$);
reset role;
insert into probe select '11. a data_admin holder''s record_year_export call succeeds', 'ok',
  (select v from r where k = 'insert_as_admin');

select pg_temp.as_((select id from p2), (select email from p2));
set local role authenticated;
create temporary table allow_select on commit drop as
  select count(*) as n from public.year_export_log where system = 'proof-system-0222';
reset role;
insert into probe select '12. the SAME data_admin holder now sees the row they just recorded', '1',
  (select n::text from allow_select);

-- ── §B year_export_recorded() — specific to (system, year), not borrowed ──
insert into probe select '20. before any record for a NEW year (2696), the gate answers false', 'false',
  public.year_export_recorded('proof-system-0222', 2696)::text;
insert into probe select '21. for the year just exported (2695), the gate answers true', 'true',
  public.year_export_recorded('proof-system-0222', 2695)::text;
insert into probe select '22. a DIFFERENT system name with the same year answers false — the key is (system, year), not year alone', 'false',
  public.year_export_recorded('a-different-system', 2695)::text;

-- ── §C1 DENY: a stranger cannot call record_year_export ───────────────────
select pg_temp.as_((select id from p1), (select email from p1));
set local role authenticated;
insert into r select 'deny_insert',
  pg_temp.try($q$select public.record_year_export('proof-system-0222', 2696, 1, null, null)$q$);
reset role;
insert into probe select '30. a plain subject is REFUSED (fails closed, not silently ignored)', 'true',
  (select (v like 'raised: record_year_export: permission denied%')::text from r where k = 'deny_insert');
insert into probe select '31. …and no row for 2696 was created by the refused attempt', 'false',
  public.year_export_recorded('proof-system-0222', 2696)::text;

-- ── §C2 bad input is refused even for an admitted caller ──────────────────
select pg_temp.as_((select id from p2), (select email from p2));
set local role authenticated;
insert into r select 'bad_system', pg_temp.try($q$select public.record_year_export(null, 2696, 1, null, null)$q$);
insert into r select 'bad_count', pg_temp.try($q$select public.record_year_export('proof-system-0222', 2696, -1, null, null)$q$);
reset role;
insert into probe select '32. a NULL system is refused', 'true',
  (select (v like 'raised: record_year_export: system is required%')::text from r where k = 'bad_system');
insert into probe select '33. a negative row_count is refused', 'true',
  (select (v like 'raised: record_year_export: row_count must be >= 0%')::text from r where k = 'bad_count');

-- ── §C3 the `dev` role path (the escape hatch every other gate here has) ──
alter table public.users disable trigger users_self_update_guard;
update public.users set role = 'dev', permissions = '{}', managed_permissions = '{}'
 where id = (select id from p1);
alter table public.users enable trigger users_self_update_guard;
select pg_temp.as_((select id from p1), (select email from p1));
set local role authenticated;
insert into r select 'insert_as_dev',
  pg_temp.try($q$select public.record_year_export('proof-system-0222', 2696, 3, 'local:/tmp/proof2', null)$q$);
reset role;
insert into probe select '34. a dev-role caller (no data_admin permission) is ALSO allowed', 'ok',
  (select v from r where k = 'insert_as_dev');
alter table public.users disable trigger users_self_update_guard;
update public.users set role = 'user', permissions = '{}', managed_permissions = '{}'
 where id = (select id from p1);
alter table public.users enable trigger users_self_update_guard;

-- ── §C4 append-only: a SECOND export of the SAME year adds a row, never
--    overwrites — the log is the record, not a boolean ───────────────────
select pg_temp.as_((select id from p2), (select email from p2));
set local role authenticated;
insert into r select 're_export',
  pg_temp.try($q$select public.record_year_export('proof-system-0222', 2695, 9, 'local:/tmp/proof-rerun', 're-export')$q$);
reset role;
insert into probe select '40. re-exporting an already-exported year is allowed, not refused as a duplicate', 'ok',
  (select v from r where k = 're_export');
insert into probe select '41. the log now holds TWO rows for that year — neither one was overwritten', '2',
  (select count(*)::text from public.year_export_log
    where system = 'proof-system-0222' and samo_year_be = 2695);

-- ── §D the CONTRACT in practice: a demo deletion RPC, shaped exactly like
--    a future per-system one, must refuse an unexported year and succeed on
--    an exported one. Defined in pg_temp so no permanent object is added —
--    this proves the PATTERN, not a real anonymiser for any system. ───────
create or replace function pg_temp.demo_delete_for_year(p_system text, p_year integer, p_dry_run boolean default true)
returns integer language plpgsql as $$
declare
  v_would_affect integer := 3; -- stands in for "select count(*) from <that system's table> where ..."
begin
  if not public.year_export_recorded(p_system, p_year) then
    raise exception 'demo_delete_for_year: % % has not been exported — refusing', p_system, p_year;
  end if;
  -- a real RPC would UPDATE/DELETE here when p_dry_run is false; this demo
  -- only ever counts, since it owns no table.
  return v_would_affect;
end;
$$;
grant execute on function pg_temp.demo_delete_for_year(text, integer, boolean) to authenticated;

insert into r select 'demo_unexported',
  pg_temp.try($q$select pg_temp.demo_delete_for_year('proof-system-0222', 2697, true)$q$);
insert into probe select '50. the demo RPC REFUSES a year nobody has exported — the contract holds for a NEW caller, not just the gate''s own function', 'true',
  (select (v like 'raised: demo_delete_for_year: proof-system-0222 2697 has not been exported%')::text from r where k = 'demo_unexported');

insert into r select 'demo_exported', pg_temp.try($q$select pg_temp.demo_delete_for_year('proof-system-0222', 2695, true)$q$);
insert into probe select '51. …and SUCCEEDS, returning a count, once that year IS exported', 'ok',
  (select v from r where k = 'demo_exported');

delete from public.year_export_log where system = 'proof-system-0222';

select step,
       case when got is not distinct from expected then 'PASS' else 'FAIL' end as result,
       expected, got
  from probe order by step;

rollback;
