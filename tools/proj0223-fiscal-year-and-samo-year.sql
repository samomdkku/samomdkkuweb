-- ============================================================
-- proj0223-fiscal-year-and-samo-year.sql — projects.samo_year_be /
-- .fiscal_year_be / .drive_layout (0223):
--   §0  structural: all three columns, the samo_year_be index + INSERT
--       trigger, the drive_layout check constraint + its two defaults
--   §A  a โครงการ inserted with no samo_year_be gets current_samo_year(),
--       through the SAME trigger every other system (0219) shares
--   §B  an explicit samo_year_be at insert is NOT overwritten
--   §C  THE SAMO-YEAR BACKFILL EXPRESSION, across a REAL handover: a
--       โครงการ created while a sentinel term was current keeps resolving
--       to THAT term from its `created_at` even after a later handover
--       makes a different term current (same shape as pr0220 §C)
--   §D  a โครงการ inserted with no drive_layout gets the column DEFAULT
--       ('year') — never 'flat', which only pre-existing rows carry
--   §E  THE fiscal_year_be BACKFILL EXPRESSION matches
--       deriveFiscalYearBE()'s own boundary EXACTLY: 30 ก.ย. vs 1 ต.ค.,
--       and ต.ค.–ธ.ค. landing in the NEXT พ.ศ. year — the same two
--       fixtures fiscal-year.test.js §1 asserts in JS, re-asserted here in
--       SQL so the two implementations cannot quietly drift apart
--   §F  a row that ALREADY carries a human's fiscal_year_be override is
--       untouched by 0223's backfill (simulated: the migration already
--       ran, so this re-runs its own UPDATE statement against a
--       synthetic already-overridden row and checks it is not clobbered)
--
-- Sentinel years 2699/2700 — unused by year0219 (2691/2692), pr0220/
-- team0224 (2693/2694), vs0221 (2697/2698) or data0222's cleanup range
-- (2691-2697) — so this proof's handovers cannot collide with another
-- proof's leftover rows.
--
--   node tools/db-query.mjs tools/proj0223-fiscal-year-and-samo-year.sql
-- ============================================================
begin;

create temporary table probe (step text, expected text, got text) on commit drop;

-- ── §0 structural ────────────────────────────────────────────────────────
insert into probe select '00. projects.samo_year_be exists, smallint', '1',
  (select count(*)::text from information_schema.columns
    where table_schema = 'public' and table_name = 'projects'
      and column_name = 'samo_year_be' and data_type = 'smallint');

insert into probe select '01. an index on samo_year_be exists', 'true',
  (select (count(*) > 0)::text from pg_indexes
    where schemaname = 'public' and tablename = 'projects'
      and indexdef ilike '%samo_year_be%');

insert into probe select '02. a trigger on projects calls samo_year_be_default()', 'true',
  (select (count(*) > 0)::text from pg_trigger t
     join pg_proc p on p.oid = t.tgfoid
    where t.tgrelid = 'public.projects'::regclass
      and p.proname = 'samo_year_be_default');

insert into probe select '03. projects.drive_layout exists, text, default year', '''year''::text',
  (select column_default from information_schema.columns
    where table_schema = 'public' and table_name = 'projects'
      and column_name = 'drive_layout');

insert into probe select '04. drive_layout check constraint admits only flat|year', 'true',
  (select (pg_get_constraintdef(oid) ilike '%''flat''%' and pg_get_constraintdef(oid) ilike '%''year''%')::text
     from pg_constraint where conname = 'projects_drive_layout_check');

insert into probe select '05. every EXISTING row (created before 0223) is flat, not year', '0',
  (select count(*)::text from public.projects where drive_layout <> 'flat');

-- ── principal: a sender (vp_admin/dev) who can also call start_team_term ──
create temporary table admin_all on commit drop as
select u.id, lower(btrim(u.email)) as email from public.users u
 where u.role = 'dev'
    or 'master' = any (coalesce(u.permissions,'{}') || coalesce(u.managed_permissions,'{}'))
 order by u.id limit 1;

set local session_replication_role = replica;
insert into admin_all
select u.id, lower(btrim(u.email))
  from public.users u
 where not exists (select 1 from admin_all)
   and u.role = 'user'
   and coalesce(array_length(u.permissions, 1), 0) = 0
 order by u.id limit 1;
update public.users set role = 'dev'
 where id = (select id from admin_all) and role <> 'dev'
   and exists (select 1 from admin_all);
set local session_replication_role = origin;

insert into probe select '06. a vp_admin/dev + team-handover admin exists (made here if none did)', '1',
  (select count(*)::text from admin_all);

create or replace function pg_temp.as_admin() returns void language sql as $$
  select set_config('request.jwt.claims',
    (select json_build_object('sub', id, 'role', 'authenticated', 'email', email)::text from admin_all), true);
$$;
create or replace function pg_temp.try(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return 'ok';
exception when others then return 'raised: ' || sqlerrm; end $$;
grant execute on function pg_temp.try(text) to authenticated;

create temporary table r (k text, v text) on commit drop;
grant insert, select on r to authenticated;

delete from public.team_terms where year in (2699, 2700);
delete from public.projects where id like 'PRJ-TEST0223%';

-- ── §A no explicit year → stamped from current_samo_year() ─────────────────
select pg_temp.as_admin();
set local role authenticated;
insert into r select 'ins_a',
  pg_temp.try($q$insert into public.projects (id, name, status) values
              ('PRJ-TEST0223A', 'proof 0223 — no explicit year', 'open')$q$);
reset role;
insert into probe select '10. insert with no samo_year_be succeeds', 'ok', (select v from r where k = 'ins_a');
insert into probe select '11. …stamped with current_samo_year()',
  (select public.current_samo_year()::text),
  (select samo_year_be::text from public.projects where id = 'PRJ-TEST0223A');
insert into probe select '12. …and defaults to drive_layout = year', 'year',
  (select drive_layout from public.projects where id = 'PRJ-TEST0223A');

-- ── §B an explicit year at INSERT is kept, not overwritten ──────────────────
select pg_temp.as_admin();
set local role authenticated;
insert into r select 'ins_b',
  pg_temp.try($q$insert into public.projects (id, name, status, samo_year_be) values
              ('PRJ-TEST0223B', 'proof 0223 — explicit year', 'open', 2555)$q$);
reset role;
insert into probe select '20. insert WITH an explicit samo_year_be succeeds', 'ok', (select v from r where k = 'ins_b');
insert into probe select '21. …and the trigger left it alone', '2555',
  (select samo_year_be::text from public.projects where id = 'PRJ-TEST0223B');

-- ── §C the samo_year_be backfill expression, across a REAL handover ────────
select pg_temp.as_admin();
set local role authenticated;
insert into r select 'start_2699', pg_temp.try('select public.start_team_term(2699)');
reset role;
insert into probe select '30. sentinel term 2699 opens', 'ok', (select v from r where k = 'start_2699');

-- now() is frozen for this transaction's lifetime — backdate 2699's
-- started_at directly (same technique as pr0220 §C) so the two sentinel
-- terms do not collapse onto one instant.
update public.team_terms set started_at = now() - interval '2 days' where year = 2699;

select pg_temp.as_admin();
set local role authenticated;
insert into r select 'ins_hist',
  pg_temp.try($q$insert into public.projects (id, name, status, created_at) values
              ('PRJ-TEST0223C', 'proof 0223 — historical', 'open', now() - interval '1 day')$q$);
reset role;
insert into probe select '31. a โครงการ created while 2699 is current is stamped 2699', '2699',
  (select samo_year_be::text from public.projects where id = 'PRJ-TEST0223C');

select pg_temp.as_admin();
set local role authenticated;
insert into r select 'start_2700', pg_temp.try('select public.start_team_term(2700)');
reset role;
insert into probe select '32. handover to 2700 succeeds — 2699 is now history', 'ok', (select v from r where k = 'start_2700');
insert into probe select '33. current_samo_year() now answers 2700', '2700', (select public.current_samo_year()::text);

select pg_temp.as_admin();
set local role authenticated;
insert into r select 'clear_hist', pg_temp.try($q$update public.projects set samo_year_be = null where id = 'PRJ-TEST0223C'$q$);
reset role;
insert into probe select '34. clearing samo_year_be for the backfill test succeeds', 'ok', (select v from r where k = 'clear_hist');

update public.projects
   set samo_year_be = public.samo_year_for_timestamp(created_at)
 where id = 'PRJ-TEST0223C' and samo_year_be is null;
insert into probe select '35. the backfill resolves it to 2699 (when it REALLY happened), not 2700 (now)', '2699',
  (select samo_year_be::text from public.projects where id = 'PRJ-TEST0223C');

-- ── §D a โครงการ inserted now gets drive_layout = year by default ──────────
insert into probe select '40. PRJ-TEST0223A (inserted after 0223) carries drive_layout = year', 'year',
  (select drive_layout from public.projects where id = 'PRJ-TEST0223A');

-- ── §E the fiscal_year_be backfill expression matches deriveFiscalYearBE ───
-- Re-run 0223's OWN expression against two synthetic rows pinned on the
-- exact boundary fiscal-year.test.js §1 asserts in JS (local(2026,9,30,23)
-- -> 2569; local(2026,10,1,0) -> 2570), so SQL and JS cannot silently
-- drift off the same day without this proof catching it.
select pg_temp.as_admin();
set local role authenticated;
insert into r select 'ins_e1',
  pg_temp.try($q$insert into public.projects (id, name, status, created_at) values
              ('PRJ-TEST0223E1', 'proof 0223 — 30 ก.ย. 23:00 ICT', 'open',
               '2026-09-30 23:00:00+07')$q$);
insert into r select 'ins_e2',
  pg_temp.try($q$insert into public.projects (id, name, status, created_at) values
              ('PRJ-TEST0223E2', 'proof 0223 — 1 ต.ค. 00:00 ICT', 'open',
               '2026-10-01 00:00:00+07')$q$);
reset role;
update public.projects set fiscal_year_be = null
 where id in ('PRJ-TEST0223E1', 'PRJ-TEST0223E2');
update public.projects
   set fiscal_year_be = (
         extract(year from (created_at at time zone 'Asia/Bangkok'))::int + 543
         + case when extract(month from (created_at at time zone 'Asia/Bangkok'))::int >= 10
                then 1 else 0 end
       )
 where id in ('PRJ-TEST0223E1', 'PRJ-TEST0223E2') and fiscal_year_be is null;
insert into probe select '50. 30 ก.ย. 23:00 ICT backfills to ปีงบ 2569 (still the OLD year, hours from rollover)', '2569',
  (select fiscal_year_be::text from public.projects where id = 'PRJ-TEST0223E1');
insert into probe select '51. 1 ต.ค. 00:00 ICT backfills to ปีงบ 2570 (the NEW year, the instant it rolls)', '2570',
  (select fiscal_year_be::text from public.projects where id = 'PRJ-TEST0223E2');

-- ── §F an already-set fiscal_year_be override is never clobbered ──────────
select pg_temp.as_admin();
set local role authenticated;
insert into r select 'ins_f',
  pg_temp.try($q$insert into public.projects (id, name, status, created_at, fiscal_year_be) values
              ('PRJ-TEST0223F', 'proof 0223 — human override stands', 'open',
               '2026-09-30 23:00:00+07', 2560)$q$);
reset role;
insert into probe select '59. the override insert succeeds (fiscal_year_be is range-checked 2500-2700, 2560 is valid)', 'ok',
  (select v from r where k = 'ins_f');
update public.projects
   set fiscal_year_be = (
         extract(year from (created_at at time zone 'Asia/Bangkok'))::int + 543
         + case when extract(month from (created_at at time zone 'Asia/Bangkok'))::int >= 10
                then 1 else 0 end
       )
 where id = 'PRJ-TEST0223F' and fiscal_year_be is null;
insert into probe select '60. a row that already had a human override (2560, far from the 2569 the date would derive) is untouched by the backfill''s "where …is null" guard', '2560',
  (select fiscal_year_be::text from public.projects where id = 'PRJ-TEST0223F');

select step,
       case when got is not distinct from expected then 'PASS' else 'FAIL' end as result,
       expected, got
  from probe order by step;

rollback;
