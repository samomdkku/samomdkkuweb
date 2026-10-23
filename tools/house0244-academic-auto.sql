-- ============================================================
-- house0244-academic-auto.sql — ปีการศึกษา changes itself at its cutoff (0244),
-- and an admin can still set it, set it BACK, and move the cutoff.
--   §A  ACL: the resolver is not callable through the API; the schedule
--       setter is signed-in only; anon keeps get_academic_year (0141).
--   §B  the rule, at FIXED instants (academic_year_resolve(p_now)):
--       before the cutoff → last year's; at it → the calendar's; a value set
--       AFTER the cutoff stands until the next one; auto OFF → the stored one.
--   §C  every reader agrees with the resolver (one home).
--   §D  the stamp: set_academic_year stamps even an UNCHANGED value ("change
--       it back" after an automatic move), a direct table UPDATE stamps too.
--   §E  writes: a plain account is refused; a house admin sets the year and
--       the schedule; 30 ก.พ. is refused; saving a schedule does not move
--       today's ปีการศึกษา.
-- Borrows two accounts and reshapes them; everything ROLLS BACK.
--   node tools/db-query.mjs tools/house0244-academic-auto.sql
-- ============================================================
begin;

create temporary table probe (step text, expected text, got text) on commit drop;

-- ── §A ──────────────────────────────────────────────────────────────────────
insert into probe select '00. the resolver is not callable by anon / authenticated', 'false,false',
  (select has_function_privilege('anon', 'public.academic_year_resolve(timestamptz)', 'execute')::text
       || ',' || has_function_privilege('authenticated', 'public.academic_year_resolve(timestamptz)', 'execute')::text);
insert into probe select '01. the schedule setter: anon no, authenticated yes', 'false,true',
  (select has_function_privilege('anon', 'public.set_academic_year_schedule(boolean,integer,integer,text)', 'execute')::text
       || ',' || has_function_privilege('authenticated', 'public.set_academic_year_schedule(boolean,integer,integer,text)', 'execute')::text);
insert into probe select '02. anon still reads get_academic_year (0141)', 'true',
  (select has_function_privilege('anon', 'public.get_academic_year()', 'execute')::text);

-- ── §B the rule, owner's default cutoff (1 ก.ค. 00:00) ──────────────────────
update public.house_settings
   set academic_auto = true, academic_cutoff_month = 7, academic_cutoff_day = 1, academic_cutoff_time = '00:00',
       academic_year = 2568
 where id = (select id from public.house_settings order by id limit 1);
-- set BEFORE the 2026 cutoff (the trigger stamped now(); pin it to May)
update public.house_settings set academic_year_set_at = timestamptz '2026-05-01 12:00 Asia/Bangkok'
 where id = (select id from public.house_settings order by id limit 1);
create or replace function pg_temp.y(p_ts timestamptz) returns text language sql as $$
  select (x ->> 'academic_year') || '/' || (x ->> 'source') from (select public.academic_year_resolve(p_ts) x) z;
$$;
insert into probe select '10. 30 มิ.ย. 23:59 — still the stored 2568 (set after the 2025 cutoff)', '2568/manual',
  pg_temp.y('2026-06-30 23:59:00 Asia/Bangkok');
insert into probe select '11. 1 ก.ค. 00:00 — the calendar takes over: 2569', '2569/auto',
  pg_temp.y('2026-07-01 00:00:00 Asia/Bangkok');
insert into probe select '12. next_change_at is the NEXT cutoff, to 2570', 'true,2570',
  (select (((public.academic_year_resolve('2026-10-23 12:00 Asia/Bangkok')) ->> 'next_change_at')::timestamptz
            = timestamptz '2027-07-01 00:00 Asia/Bangkok')::text
       || ',' || (public.academic_year_resolve('2026-10-23 12:00 Asia/Bangkok') ->> 'next_value'));
-- a value set AFTER the cutoff stands until the next one
update public.house_settings set academic_year = 2568, academic_year_set_at = timestamptz '2026-08-01 09:00 Asia/Bangkok'
 where id = (select id from public.house_settings order by id limit 1);
insert into probe select '13. set back to 2568 on 1 ส.ค. — 2568 stands in October', '2568/manual',
  pg_temp.y('2026-10-23 12:00 Asia/Bangkok');
insert into probe select '14. …and the NEXT cutoff still advances it (a forgotten year moves)', '2570/auto',
  pg_temp.y('2027-07-01 00:00:01 Asia/Bangkok');
update public.house_settings set academic_auto = false where id = (select id from public.house_settings order by id limit 1);
insert into probe select '15. auto OFF — the stored value, whatever the date (0141 behaviour)', '2568/manual',
  pg_temp.y('2030-01-01 00:00 Asia/Bangkok');
update public.house_settings set academic_auto = true where id = (select id from public.house_settings order by id limit 1);

-- ── §C every reader asks the resolver ──────────────────────────────────────
insert into probe select '20. get_academic_year() = the resolver', 'true',
  (select (public.get_academic_year() = (public.academic_year_resolve() ->> 'academic_year')::int)::text);
insert into probe select '21. academic_year_status() = the resolver', 'true',
  (select (public.academic_year_status() = public.academic_year_resolve())::text);
-- a CONTROL for the sweep: the resolver itself must match, or an empty answer
-- below means the pattern is blind, not that the rule holds
insert into probe select '22a. CONTROL: the sweep pattern finds the resolver', 'true',
  (select (pg_get_functiondef('public.academic_year_resolve(timestamptz)'::regprocedure) ~ 'house_settings'
       and pg_get_functiondef('public.academic_year_resolve(timestamptz)'::regprocedure) ~ '\macademic_year\M')::text);
insert into probe select '22. no function but the resolver reads house_settings.academic_year', '',
  (select coalesce(string_agg(p.proname, ',' order by p.proname), '') from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
      and p.proname not in ('academic_year_resolve', 'set_academic_year', 'set_academic_year_schedule',
                            'house_settings_stamp_academic')
      and pg_get_functiondef(p.oid) ~ 'house_settings'
      and pg_get_functiondef(p.oid) ~ '\macademic_year\M' );

-- ── §D the stamp ────────────────────────────────────────────────────────────
update public.house_settings set academic_year_set_at = timestamptz '2020-01-01'
 where id = (select id from public.house_settings order by id limit 1);
update public.house_settings set academic_year = academic_year + 1
 where id = (select id from public.house_settings order by id limit 1);
insert into probe select '30. a direct table UPDATE of the year stamps set_at', 'true',
  (select (academic_year_set_at > now() - interval '1 minute')::text from public.house_settings order by id limit 1);

create temporary table subj on commit drop as
  select id, email from public.users where email is not null order by id limit 2;
create temporary table p1 on commit drop as select id from subj order by id limit 1;
create temporary table p2 on commit drop as select id from subj order by id offset 1 limit 1;
grant select on p1, p2 to authenticated;
alter table public.users disable trigger users_self_update_guard;
update public.users set role = 'user', permissions = '{}', managed_permissions = '{}' where id = (select id from p1);
update public.users set role = 'user', permissions = array['house'], managed_permissions = '{}' where id = (select id from p2);
alter table public.users enable trigger users_self_update_guard;
create or replace function pg_temp.as_(p_id uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
$$;
create or replace function pg_temp.try(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return 'ok';
exception when others then return 'raised: ' || sqlerrm; end $$;
grant execute on function pg_temp.try(text) to authenticated;
create temporary table r (k text, v text) on commit drop;
grant insert, select on r to authenticated;

-- the SAME stored value, with the stamp in the past: "change it back"
update public.house_settings set academic_year = (public.academic_year_resolve() ->> 'clock_year')::int - 1
 where id = (select id from public.house_settings order by id limit 1);
update public.house_settings set academic_year_set_at = timestamptz '2020-01-01'
 where id = (select id from public.house_settings order by id limit 1);
insert into r select 'before_back', public.get_academic_year()::text;

select pg_temp.as_((select id from p2));
set local role authenticated;
insert into r select 'back', pg_temp.try(format('select public.set_academic_year(%s)',
  (select academic_year from public.house_settings order by id limit 1)));
reset role;
insert into r select 'after_back', public.get_academic_year()::text;

insert into probe select '31. CONTROL: with an old stamp the calendar wins', 'true',
  (select ((select v from r where k = 'before_back')::int = (public.academic_year_resolve() ->> 'clock_year')::int)::text);
insert into probe select '32. set_academic_year to the value ALREADY stored is a real decision', 'ok,true',
  (select (select v from r where k = 'back') || ','
       || ((select v from r where k = 'after_back')::int = (public.academic_year_resolve() ->> 'clock_year')::int - 1)::text);

-- ── §E writes ───────────────────────────────────────────────────────────────
select pg_temp.as_((select id from p1));
set local role authenticated;
insert into r select 'plain_year',  pg_temp.try('select public.set_academic_year(2569)');
insert into r select 'plain_sched', pg_temp.try($q$select public.set_academic_year_schedule(true, 7, 1, '00:00')$q$);
reset role;
insert into probe select '40. a plain account cannot set the year', 'true', (select (v like 'raised:%ไม่มีสิทธิ์%')::text from r where k = 'plain_year');
insert into probe select '41. …nor the schedule', 'true', (select (v like 'raised:%ไม่มีสิทธิ์%')::text from r where k = 'plain_sched');

insert into r select 'today', public.get_academic_year()::text;
select pg_temp.as_((select id from p2));
set local role authenticated;
insert into r select 'bad_day', pg_temp.try($q$select public.set_academic_year_schedule(true, 2, 30, '00:00')$q$);
insert into r select 'bad_time', pg_temp.try($q$select public.set_academic_year_schedule(true, 7, 1, '25:00')$q$);
-- a cutoff that has ALREADY passed this year (1 ม.ค.) would make the calendar
-- win at once if saving did not pin today's value
insert into r select 'good', pg_temp.try($q$select public.set_academic_year_schedule(true, 1, 1, '06:30')$q$);
reset role;
insert into r select 'after_save', public.get_academic_year()::text;
insert into probe select '42. 30 ก.พ. is refused', 'true', (select (v like 'raised:%ไม่มีในปฏิทิน%')::text from r where k = 'bad_day');
insert into probe select '43. 25:00 is refused', 'true', (select (v like 'raised:%เวลาไม่ถูกต้อง%')::text from r where k = 'bad_time');
insert into probe select '44. a house admin saves a schedule', 'ok', (select v from r where k = 'good');
insert into probe select '45. …stored to the minute', '1,1,06:30',
  (select academic_cutoff_month || ',' || academic_cutoff_day || ',' || to_char(academic_cutoff_time, 'HH24:MI')
     from public.house_settings order by id limit 1);
insert into probe select '46. …and saving it did NOT move today''s ปีการศึกษา', 'true',
  (select ((select v from r where k = 'today') = (select v from r where k = 'after_save'))::text);

select step,
       case when got is not distinct from expected then 'PASS' else 'FAIL' end as result,
       expected, got
  from probe order by step;
rollback;
