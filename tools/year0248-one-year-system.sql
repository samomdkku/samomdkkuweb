-- ============================================================
-- year0248-one-year-system.sql — Q1 (1 มี.ค.) starts the ปี SAMO for every
-- system, in the same act that opens Passport's วาระสโม (0248).
--   §A  the unchecked bodies are reachable by definer code only; the buttons
--       keep their permission check; the stamping trigger is a definer.
--   §B  at FIXED instants: nothing before 1 มี.ค.; at it, ปี SAMO 2569 → 2570
--       stamped with the BOUNDARY, the outgoing team archived, Passport opens
--       "MDKKU SAMO'70" bridged to 2570, samo_year_for_timestamp agrees on both
--       sides, a second call changes nothing; a ปี SAMO already started by hand
--       is never switched again (forward only).
--   §C  the GUEST path: a row inserted as anon (a guest PR form) is filed under
--       the NEW year — the trigger applies the due switch before stamping. Its
--       geometry is CREATED around today's date, so it can never run out.
--   §D  Q1 and the auto switch now move the ปี SAMO for every system: a
--       Passport-only org-wide admin may edit Q2–Q4 but not Q1 or auto; with
--       ทีม SAMO edit rights too, they may.
--   §E  (0249) pressing เริ่มปี SAMO on Q1 day, before anything applied the
--       switch, succeeds instead of rolling the switch back.
-- Uses the real ปี 2569–2571 rows inside a transaction that ROLLS BACK.
--   node tools/db-query.mjs tools/year0248-one-year-system.sql
-- ============================================================
begin;

create temporary table probe (step text, expected text, got text) on commit drop;

-- ── §A ──────────────────────────────────────────────────────────────────────
insert into probe select '00. the unchecked bodies: no anon, no authenticated', 'false,false,false,false',
  (select string_agg(has_function_privilege(r, f, 'execute')::text, ',' order by f, r)
     from unnest(array['anon', 'authenticated']) r,
          unnest(array['public._start_team_term(integer,timestamptz)', 'public._publish_team_term(integer)']) f);
insert into probe select '01. the buttons stay callable by authenticated (they check inside)', 'true,true',
  (select has_function_privilege('authenticated', 'public.start_team_term(integer)', 'execute')::text
       || ',' || has_function_privilege('authenticated', 'public.publish_team_term(integer)', 'execute')::text);
insert into probe select '02. the stamping trigger runs as definer (a guest insert can move the year)', 'true',
  (select prosecdef::text from pg_proc where oid = 'public.samo_year_be_default()'::regprocedure);

-- ── fixtures for §B ─────────────────────────────────────────────────────────
update public.team_terms set is_current = false where is_current;
insert into public.team_terms (year) values (2569), (2570), (2571) on conflict (year) do nothing;
update public.team_terms set is_current = (year = 2569), started_at = null, ended_at = null, published_at = null
 where year in (2569, 2570, 2571);
update passport.samo_seasons set ended_at = now() - interval '1 second' where ended_at is null;
update passport.samo_years   set ended_at = now() - interval '1 second' where ended_at is null;
insert into passport.samo_years (name, started_at, team_term_year)
     values ('proof-0248', timestamptz '2026-06-01 00:00 Asia/Bangkok', 2569);
insert into passport.samo_seasons (samo_year_id, name, quarter, started_at)
  select id, 'Q4', 4, timestamptz '2026-12-01 00:00 Asia/Bangkok' from passport.samo_years where name = 'proof-0248';
update passport.season_schedule
   set auto = true,
       q1_month = 3, q1_day = 1, q1_time = '00:00', q2_month = 6, q2_day = 1, q2_time = '00:00',
       q3_month = 9, q3_day = 1, q3_time = '00:00', q4_month = 12, q4_day = 1, q4_time = '00:00',
       last_applied_boundary = timestamptz '2026-12-01 00:00 Asia/Bangkok'
 where id;

create temporary table r (k text, v text) on commit drop;
grant insert, select on r to authenticated, anon;

-- ── §B at fixed instants ────────────────────────────────────────────────────
insert into r select 'feb', passport.apply_season_schedule('2027-02-28 23:59:00 Asia/Bangkok') ->> 'applied';
insert into probe select '10. 28 ก.พ. 23:59 — nothing moves; still ปี SAMO 2569', 'false,2569',
  (select (select v from r where k = 'feb') || ',' || public.current_samo_year());
insert into r select 'mar', passport.apply_season_schedule('2027-03-01 00:00:05 Asia/Bangkok') ->> 'samo_year';
insert into probe select '11. 1 มี.ค. — ปี SAMO becomes 2570 in the same act', '2570,2570',
  (select (select v from r where k = 'mar') || ',' || public.current_samo_year());
insert into probe select '12. …stamped with the BOUNDARY on both sides of the handover', 'true,true',
  (select ((select started_at from public.team_terms where year = 2570) = timestamptz '2027-03-01 00:00 Asia/Bangkok')::text
       || ',' || ((select ended_at from public.team_terms where year = 2569) = timestamptz '2027-03-01 00:00 Asia/Bangkok')::text);
insert into probe select '13. …the outgoing team was archived as 2569 (as the button does)', 'true',
  (select (published_at is not null)::text from public.team_terms where year = 2569);
insert into probe select '14. …and Passport opened MDKKU SAMO''70, bridged to 2570', 'MDKKU SAMO''70,2570',
  (select name || ',' || team_term_year from passport.samo_years where ended_at is null);
insert into probe select '15. a timestamp either side files under the right year', '2569,2570',
  (select public.samo_year_for_timestamp('2027-02-15 12:00 Asia/Bangkok') || ',' || public.samo_year_for_timestamp('2027-03-05 12:00 Asia/Bangkok'));
insert into r select 'again', passport.apply_season_schedule('2027-03-01 00:00:09 Asia/Bangkok') ->> 'applied';
insert into probe select '16. a second call changes nothing; exactly one current ปี SAMO', 'false,1,2570',
  (select (select v from r where k = 'again') || ',' || (select count(*) from public.team_terms where is_current)
       || ',' || public.current_samo_year());

-- a ปี SAMO started BY HAND ahead of the next Q1 is not switched again
update public.team_terms set is_current = false where is_current;
update public.team_terms set is_current = true, started_at = timestamptz '2028-02-10 09:00 Asia/Bangkok' where year = 2571;
insert into r select 'next', passport.apply_season_schedule('2028-03-01 00:00:05 Asia/Bangkok')::text;
insert into probe select '17. a ปี SAMO already started by hand is NOT switched again (forward only)', '2571,true',
  (select public.current_samo_year() || ','
       || ((select started_at from public.team_terms where year = 2571) = timestamptz '2028-02-10 09:00 Asia/Bangkok')::text);

-- ── §C the guest path, around TODAY ────────────────────────────────────────
-- Q1 = today 00:00 (Bangkok), the others a month apart after it; the previous
-- boundary acknowledged; the current ปี SAMO one behind what today's Q1 means.
update passport.season_schedule s
   set q1_month = x.m, q1_day = least(x.d, 28), q1_time = '00:00',
       q2_month = x.m % 12 + 1,       q2_day = 1, q2_time = '00:00',
       q3_month = (x.m + 1) % 12 + 1, q3_day = 1, q3_time = '00:00',
       q4_month = (x.m + 2) % 12 + 1, q4_day = 1, q4_time = '00:00',
       last_applied_boundary = now() - interval '400 days'
  from (select extract(month from now() at time zone 'Asia/Bangkok')::int m,
               extract(day   from now() at time zone 'Asia/Bangkok')::int d) x
 where s.id;
create temporary table want on commit drop as
  select (passport.schedule_at(now()) ->> 'be')::int be, (passport.schedule_at(now()) ->> 'quarter')::int q;
grant select on want to authenticated, anon;
insert into probe select '20. CONTROL: today IS a Q1 by the constructed schedule', '1', (select q::text from want);
insert into public.team_terms (year) select be from want on conflict (year) do nothing;
insert into public.team_terms (year) select be - 1 from want on conflict (year) do nothing;
update public.team_terms set is_current = false where is_current;
update public.team_terms set is_current = true, started_at = null, ended_at = null where year = (select be - 1 from want);
update public.team_terms set started_at = null, ended_at = null where year = (select be from want);
create temporary table guest_row (samo_year_be int) on commit drop;
create trigger guest_row_year before insert on guest_row for each row execute function public.samo_year_be_default();
grant insert, select on guest_row to anon;
set local role anon;
insert into guest_row default values;
reset role;
insert into probe select '21. a row a GUEST inserts is filed under the NEW year', 'true',
  (select (samo_year_be = (select be from want))::text from guest_row);
insert into probe select '22. …because the switch ran first: it is the current ปี SAMO now', 'true',
  (select (public.current_samo_year() = (select be from want))::text);

-- ── §D who may move Q1 ──────────────────────────────────────────────────────
update passport.season_schedule
   set auto = true,
       q1_month = 3, q1_day = 1, q1_time = '00:00', q2_month = 6, q2_day = 1, q2_time = '00:00',
       q3_month = 9, q3_day = 1, q3_time = '00:00', q4_month = 12, q4_day = 1, q4_time = '00:00',
       last_applied_boundary = timestamptz '2099-01-01'          -- nothing rolls in this section
 where id;
create temporary table subj on commit drop as
  select id from public.users where email is not null order by id limit 2;
create temporary table pp on commit drop as select id from subj order by id limit 1;
create temporary table pb on commit drop as select id from subj order by id offset 1 limit 1;
grant select on pp, pb to authenticated;
alter table public.users disable trigger users_self_update_guard;
update public.users set role = 'user', permissions = array['passport'], managed_permissions = '{}', managed_passport_scopes = '{}' where id = (select id from pp);
update public.users set role = 'user', permissions = array['passport', 'team_edit'], managed_permissions = '{}', managed_passport_scopes = '{}' where id = (select id from pb);
alter table public.users enable trigger users_self_update_guard;
create or replace function pg_temp.as_(p_id uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
$$;
create or replace function pg_temp.try(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return 'ok';
exception when others then return 'raised: ' || sqlerrm; end $$;
grant execute on function pg_temp.try(text) to authenticated;
create or replace function pg_temp.sched(q1day int, q3day int, auto boolean) returns text language sql as $$
  select format('select passport.set_season_schedule(%L::boolean, %L::jsonb)', auto, json_build_array(
    json_build_object('month', 3, 'day', q1day, 'time', '00:00'), json_build_object('month', 6, 'day', 1, 'time', '00:00'),
    json_build_object('month', 9, 'day', q3day, 'time', '00:00'), json_build_object('month', 12, 'day', 1, 'time', '00:00')));
$$;
grant execute on function pg_temp.sched(int, int, boolean) to authenticated;

select pg_temp.as_((select id from pp));
set local role authenticated;
insert into r select 'pp_ctx', passport._org_wide()::text;
insert into r select 'pp_q1',   pg_temp.try(pg_temp.sched(5, 1, true));
insert into r select 'pp_auto', pg_temp.try(pg_temp.sched(1, 1, false));
insert into r select 'pp_q3',   pg_temp.try(pg_temp.sched(1, 15, true));
reset role;
select pg_temp.as_((select id from pb));
set local role authenticated;
insert into r select 'pb_q1', pg_temp.try(pg_temp.sched(5, 15, true));
reset role;
insert into probe select '30. subject pp is an org-wide Passport admin', 'true', (select v from r where k = 'pp_ctx');
insert into probe select '31. …who may NOT move Q1 (it is the ปี SAMO of every system)', 'true',
  (select (v like 'raised:%สิทธิ์แก้ไขทีม SAMO%')::text from r where k = 'pp_q1');
insert into probe select '32. …nor switch the automatic change off', 'true',
  (select (v like 'raised:%สิทธิ์แก้ไขทีม SAMO%')::text from r where k = 'pp_auto');
insert into probe select '33. …but may still move Q3 (Passport''s own quarters)', 'ok', (select v from r where k = 'pp_q3');
insert into probe select '34. with ทีม SAMO edit rights too, Q1 may move', 'ok,5',
  (select (select v from r where k = 'pb_q1') || ',' || q1_day from passport.season_schedule);

-- ── §E (0249) pressing เริ่มปี SAMO on Q1 day, before anything else applied it ──
update passport.season_schedule s
   set q1_month = x.m, q1_day = least(x.d, 28), q1_time = '00:00',
       q2_month = x.m % 12 + 1, q2_day = 1, q2_time = '00:00',
       q3_month = (x.m + 1) % 12 + 1, q3_day = 1, q3_time = '00:00',
       q4_month = (x.m + 2) % 12 + 1, q4_day = 1, q4_time = '00:00',
       last_applied_boundary = now() - interval '400 days'
  from (select extract(month from now() at time zone 'Asia/Bangkok')::int m,
               extract(day   from now() at time zone 'Asia/Bangkok')::int d) x
 where s.id;
update public.team_terms set is_current = false where is_current;
update public.team_terms set is_current = true, started_at = null, ended_at = null where year = (select be - 1 from want);
update public.team_terms set started_at = null, ended_at = null where year = (select be from want);
select pg_temp.as_((select id from pb));
set local role authenticated;
insert into r select 'press', pg_temp.try(format('select public.start_samo_year(%s, %L, %L)',
  (select be from want), 'proof-0249', 'Q1'));
reset role;
insert into probe select '40. pressing เริ่มปี SAMO on Q1 day succeeds — the automatic switch did it', 'ok,true',
  (select (select v from r where k = 'press') || ',' || (public.current_samo_year() = (select be from want))::text);

select step,
       case when got is not distinct from expected then 'PASS' else 'FAIL' end as result,
       expected, got
  from probe order by step;
rollback;
