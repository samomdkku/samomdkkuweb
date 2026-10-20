-- ============================================================
-- proj0223-fiscal-year-and-samo-year.sql — projects.samo_year_be /
-- .drive_layout (0223; the file name predates the ปีงบ backfill's removal):
--   §0  structural: both columns, the samo_year_be index + INSERT
--       trigger, the drive_layout check constraint + its 'flat' default
--   §A  a โครงการ inserted with no samo_year_be gets current_samo_year(),
--       through the SAME trigger every other system (0219) shares
--   §B  an explicit samo_year_be at insert is NOT overwritten
--   §C  THE SAMO-YEAR BACKFILL EXPRESSION, across a REAL handover: a
--       โครงการ created while a sentinel term was current keeps resolving
--       to THAT term from its `created_at` even after a later handover
--       makes a different term current (same shape as pr0220 §C)
--   §D  a โครงการ inserted with no drive_layout (what the PREVIOUS bundle
--       sends) gets 'flat' — the default must not run ahead of the code
--       that builds the folder; one inserted with drive_layout = 'year'
--       (what the new createProject sends) keeps it, through RLS as a sender
--   (§E/§F, which re-ran a fiscal_year_be backfill, were removed with that
--   backfill in the 2026-10-14 review — NULL there means "ask the clock")
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

insert into probe select '03. projects.drive_layout exists, text, default FLAT (the code, not the default, asks for year)', '''flat''::text',
  (select column_default from information_schema.columns
    where table_schema = 'public' and table_name = 'projects'
      and column_name = 'drive_layout');

insert into probe select '04. drive_layout check constraint admits only flat|year', 'true',
  (select (pg_get_constraintdef(oid) ilike '%''flat''%' and pg_get_constraintdef(oid) ilike '%''year''%')::text
     from pg_constraint where conname = 'projects_drive_layout_check');

-- Bounded by DATE, as the label always said: 0223 was applied 2026-10-14 and
-- the bundle that asks for the year folder shipped the same day, so a project
-- created since is 'year' BY DESIGN. Counting every row went red on production
-- 2026-10-20 the moment real people created โครงการ with the new bundle.
insert into probe select '05. every row created BEFORE 0223 (2026-10-14) is flat, not year', '0',
  (select count(*)::text from public.projects
    where drive_layout <> 'flat' and created_at < '2026-10-14T00:00:00Z');

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
insert into probe select '12. …and with no drive_layout given (the previous bundle) it is flat', 'flat',
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
-- MINUTES, not days, and the term start_team_term just closed is closed at
-- the same instant: `now() - 2 days` collided with any REAL term started in
-- the last two days (samo-dev's 2571, 2026-10-18) — shop0230's write-up in
-- docs/mistakes/tooling-proofs.md.
update public.team_terms set ended_at = now() - interval '2 minutes'
 where year <> 2699 and ended_at = now();
update public.team_terms set started_at = now() - interval '2 minutes' where year = 2699;

select pg_temp.as_admin();
set local role authenticated;
insert into r select 'ins_hist',
  pg_temp.try($q$insert into public.projects (id, name, status, created_at) values
              ('PRJ-TEST0223C', 'proof 0223 — historical', 'open', now() - interval '1 minute')$q$);
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

-- ── §D the new bundle asks for 'year' explicitly, and RLS lets it ─────────
select pg_temp.as_admin();
set local role authenticated;
insert into r select 'ins_d',
  pg_temp.try($q$insert into public.projects (id, name, status, drive_layout) values
              ('PRJ-TEST0223D', 'proof 0223 — new bundle', 'open', 'year')$q$);
reset role;
insert into probe select '40. a sender inserting drive_layout = year (createProject) succeeds', 'ok',
  (select v from r where k = 'ins_d');
insert into probe select '41. …and the row keeps year', 'year',
  (select drive_layout from public.projects where id = 'PRJ-TEST0223D');
insert into probe select '42. PRJ-TEST0223A (no drive_layout given) is still flat', 'flat',
  (select drive_layout from public.projects where id = 'PRJ-TEST0223A');

select step,
       case when got is not distinct from expected then 'PASS' else 'FAIL' end as result,
       expected, got
  from probe order by step;

rollback;
