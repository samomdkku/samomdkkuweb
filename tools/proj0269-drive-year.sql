-- ============================================================
-- proj0269-drive-year.sql — projects.drive_year_be (0269): where a
-- หนังสือโครงการ's Drive folder IS, so the folder can follow the ปีงบ.
--   §0  structural: the column, its range check, its comment
--   §A  the backfill: every row 0223 filed under a year records that year
--   §B  ALLOW — a project actor creates a โครงการ filed under a ปีงบ and
--       records a move (what createProject / syncDriveYear send)
--   §C  DENY — anon cannot move it; the range check refuses a non-year
--   Rolled back. Sentinel ids PRJ-T0269*.
--
--   node tools/db-query.mjs tools/proj0269-drive-year.sql [--dev]
-- ============================================================
begin;

create temporary table probe (step text, expected text, got text) on commit drop;

-- ── §0 structural ────────────────────────────────────────────────────────
insert into probe select '00. projects.drive_year_be exists, smallint, nullable', 'smallint|YES',
  (select data_type || '|' || is_nullable from information_schema.columns
    where table_schema = 'public' and table_name = 'projects' and column_name = 'drive_year_be');

insert into probe select '01. its check admits only NULL or a year 2500–2700', 'true',
  (select (pg_get_constraintdef(oid) ilike '%2500%' and pg_get_constraintdef(oid) ilike '%2700%')::text
     from pg_constraint where conname = 'projects_drive_year_be_check');

insert into probe select '02. the column says it is a fact about Drive, not the ปีงบ', 'true',
  (select (col_description('public.projects'::regclass,
     (select attnum from pg_attribute where attrelid = 'public.projects'::regclass and attname = 'drive_year_be'))
     ilike '%LABEL%')::text);

-- ── §A backfill ──────────────────────────────────────────────────────────
insert into probe select '10. no row filed by 0223 under a year is missing its recorded folder', '0',
  (select count(*)::text from public.projects
    where drive_layout = 'year' and drive_year_be is null and samo_year_be is not null);

-- ── principal: a project actor (master or dev) ───────────────────────────
create temporary table actor on commit drop as
select u.id, lower(btrim(u.email)) as email from public.users u
 where u.role = 'dev'
    or 'master' = any (coalesce(u.permissions,'{}') || coalesce(u.managed_permissions,'{}'))
 order by u.id limit 1;

insert into probe select '20. a project actor exists to act as', '1', (select count(*)::text from actor);

create or replace function pg_temp.as_actor() returns void language sql as $$
  select set_config('request.jwt.claims',
    (select json_build_object('sub', id, 'role', 'authenticated', 'email', email)::text from actor), true);
$$;
create or replace function pg_temp.try(p_sql text) returns text language plpgsql as $$
declare n int;
begin execute p_sql; get diagnostics n = row_count; return 'ok:' || n;
exception when others then return 'raised: ' || sqlerrm; end $$;
grant execute on function pg_temp.try(text) to authenticated, anon;
create temporary table r (k text, v text) on commit drop;
grant insert, select on r to authenticated, anon;

-- ── §B ALLOW ─────────────────────────────────────────────────────────────
select pg_temp.as_actor();
set local role authenticated;
insert into r select 'ins', pg_temp.try($q$insert into public.projects (id, name, status, drive_layout, drive_year_be)
  values ('PRJ-T0269', 'proof 0269', 'open', 'year', 2570)$q$);
insert into r select 'move', pg_temp.try($q$update public.projects set drive_year_be = 2571 where id = 'PRJ-T0269'$q$);
reset role;
insert into probe select '30. an actor creates a โครงการ filed under ปีงบ 2570 (createProject)', 'ok:1',
  (select v from r where k = 'ins');
insert into probe select '31. …and records a folder move (syncDriveYear)', 'ok:1',
  (select v from r where k = 'move');
insert into probe select '32. the row now says 2571', '2571',
  (select drive_year_be::text from public.projects where id = 'PRJ-T0269');

-- ── §C DENY ──────────────────────────────────────────────────────────────
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
insert into r select 'anon', pg_temp.try($q$update public.projects set drive_year_be = 2599 where id = 'PRJ-T0269'$q$);
reset role;
insert into probe select '40. anon cannot move it (no row, or refused)', 'true',
  (select (v in ('ok:0') or v like 'raised:%')::text from r where k = 'anon');
insert into probe select '41. …and the row still says 2571 (the DENY is real, the ALLOW above is the control)', '2571',
  (select drive_year_be::text from public.projects where id = 'PRJ-T0269');

insert into r select 'range', pg_temp.try($q$update public.projects set drive_year_be = 1999 where id = 'PRJ-T0269'$q$);
insert into probe select '42. the range check refuses a non-year', 'true',
  (select (v like 'raised:%projects_drive_year_be_check%')::text from r where k = 'range');

select step,
       case when got is not distinct from expected then 'PASS' else 'FAIL' end as result,
       expected, got
  from probe order by step;

rollback;
