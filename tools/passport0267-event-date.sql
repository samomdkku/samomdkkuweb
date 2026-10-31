-- ============================================================
-- passport0267-event-date.sql — an activity's EVENT DATE decides its quarter,
-- and its QR scans for a window that no quarter boundary cuts (0267).
--   §A  shape + ACL: the two dates are NOT NULL and bounded; the preview RPC
--       is signed-in only; the resolver machinery is not callable at all; no
--       scan anywhere sits outside its activity's season (REAL data).
--   §B  the calendar: a quarter's DAYS, Q4 spanning the new year, a boundary
--       set at 08:30 putting its day in the quarter before; the default window
--       is two calendar months (31 ธ.ค. → 28 ก.พ.).
--   §C  resolution: today → the open quarter; the last day of the previous
--       quarter → that CLOSED quarter; a day in a วาระ not started, or before
--       any วาระ, is refused with the reason.
--   §D  the trigger: a dated insert files itself; a closed quarter is allowed
--       on insert; a person cannot create an already-expired activity; a
--       hand-set end is kept within [date, date + 366], refused outside it,
--       and replaced by the default when the DATE moves out from under it.
--   §E  stamp_scan: inside the window a CLOSED quarter's QR scans and the
--       points go to THAT quarter (the agreement); so does an event in the
--       previous วาระ (the community camps); before the date and after the end
--       it refuses with the day; refusals write nothing.
--   §F  moves through the date (0246's rules): a ฝ่าย-scoped admin cannot
--       move scanned points into a closed quarter, an org-wide one can and the
--       points follow; a quarter not started is refused once scanned; a date
--       change inside the same quarter moves nothing and needs no rights.
-- Fixtures are RELATIVE TO TODAY (two วาระ of its own: the previous one, all
-- closed, and the current one up to today's quarter), so no case depends on
-- which day it runs — the rail proofs that ran out of geometry taught that.
-- Borrows two accounts and one kkumail identity; everything ROLLS BACK.
--   node tools/db-query.mjs tools/passport0267-event-date.sql
-- ============================================================
begin;

create temporary table probe (step text, expected text, got text) on commit drop;

-- ── §A shape + ACL ──────────────────────────────────────────────────────────
insert into probe select '00. event_date and scan_until are NOT NULL', 'NO,NO',
  (select string_agg(is_nullable, ',' order by column_name) from information_schema.columns
    where table_schema = 'passport' and table_name = 'activities' and column_name in ('event_date', 'scan_until'));
insert into probe select '01. the window is bounded by a CHECK (date ≤ end ≤ date + 366)', '1',
  (select count(*)::text from pg_constraint where conname = 'activities_scan_window_ok'
      and conrelid = 'passport.activities'::regclass);
insert into probe select '02. anon cannot call activity_date_info; authenticated can', 'false,true',
  (select has_function_privilege('anon', 'passport.activity_date_info(date,uuid)', 'execute')::text || ','
       || has_function_privilege('authenticated', 'passport.activity_date_info(date,uuid)', 'execute')::text);
insert into probe select '03. the resolver machinery is not callable by authenticated', 'false,false,false',
  (select string_agg(has_function_privilege('authenticated', f, 'execute')::text, ',' order by f) from unnest(array[
     'passport._resolve_event_date(date,uuid)', 'passport._quarter_days(integer,integer)', 'passport._year_vara(uuid)']) f);
insert into probe select '04. REAL DATA: no scan sits outside its activity''s season', '0',
  (select count(*)::text from passport.scans s join passport.activities a on a.id = s.activity_id
    where a.season_id is not null and s.season_id is distinct from a.season_id);

-- ── §B the calendar, on the owner's default schedule ────────────────────────
update passport.season_schedule
   set auto = false,
       q1_month = 3, q1_day = 1, q1_time = '00:00', q2_month = 6, q2_day = 1, q2_time = '00:00',
       q3_month = 9, q3_day = 1, q3_time = '00:00', q4_month = 12, q4_day = 1, q4_time = '00:00'
 where id;
insert into probe select '10. Q2 of วาระ 2569 is 1 มิ.ย. – 31 ส.ค. 2026', '[2026-06-01,2026-09-01)', passport._quarter_days(2026, 2)::text;
insert into probe select '11. Q4 spans the new year (1 ธ.ค. – 28 ก.พ.)', '[2026-12-01,2027-03-01)', passport._quarter_days(2026, 4)::text;
update passport.season_schedule set q3_time = '08:30' where id;
insert into probe select '12. a boundary at 08:30 puts its day in the quarter BEFORE (days and schedule agree)', '[2026-09-02,2026-12-01),Q2',
  (select passport._quarter_days(2026, 3)::text || ',' || (passport.schedule_at(timestamptz '2026-09-01 00:00 Asia/Bangkok') ->> 'label'));
update passport.season_schedule set q3_time = '00:00' where id;
insert into probe select '13. the default window is two calendar months', '2026-10-30,2027-02-28',
  (select ((date '2026-08-30' + interval '2 months')::date)::text || ',' || ((date '2026-12-31' + interval '2 months')::date)::text);

-- ── fixtures: two วาระ of our own, relative to today ───────────────────────
update passport.samo_seasons set ended_at = now() - interval '1 second' where ended_at is null;
update passport.samo_years   set ended_at = now() - interval '1 second' where ended_at is null;

create temporary table fx on commit drop as
  select t, v, q,
         lower(passport._quarter_days(v, q)) - 1 as prev_last,          -- last day of the previous quarter (closed)
         lower(passport._quarter_days(v, 1)) - 1 as vara_prev_last,     -- last day of the previous วาระ (Q4)
         lower(passport._quarter_days(v + 1, 1)) as next_vara_first,    -- first day of the next วาระ
         case when q < 4 then lower(passport._quarter_days(v, q + 1))   -- first day of the next quarter
              else lower(passport._quarter_days(v + 1, 1)) end as next_q_first
    from (select (now() at time zone 'Asia/Bangkok')::date t,
                 (passport.schedule_at(now()) ->> 'vara_year')::int v,
                 (passport.schedule_at(now()) ->> 'quarter')::int q) z;
grant select on fx to authenticated;

insert into passport.samo_years (name, started_at, ended_at, team_term_year)
  select 'proof-0267-prev', (passport._quarter_starts(v - 1, (select s from passport.season_schedule s where s.id)))[1],
         (passport._quarter_starts(v, (select s from passport.season_schedule s where s.id)))[1], v - 1 + 543 from fx;
insert into passport.samo_years (name, started_at, team_term_year)
  select 'proof-0267-cur', (passport._quarter_starts(v, (select s from passport.season_schedule s where s.id)))[1], v + 543 from fx;
insert into passport.samo_seasons (samo_year_id, name, quarter, started_at, ended_at)
  select y.id, 'Q' || g, g, now() - interval '400 days' + g * interval '1 day', now() - interval '2 seconds'
    from passport.samo_years y cross join generate_series(1, 4) g where y.name = 'proof-0267-prev';
insert into passport.samo_seasons (samo_year_id, name, quarter, started_at, ended_at)
  select y.id, 'Q' || g, g, now() - interval '300 days' + g * interval '1 day',
         case when g < fx.q then now() - interval '2 seconds' end
    from passport.samo_years y cross join fx cross join generate_series(1, fx.q) g where y.name = 'proof-0267-cur';
-- On the last day of a วาระ, tomorrow is in the next one: give it an open
-- วาระ to wait in, so §E's "not yet" case has a date it can file.
insert into passport.samo_years (name, started_at, team_term_year)
  select 'proof-0267-next', now(), v + 1 + 543 from fx
   where (passport.schedule_at((t + 1)::timestamp at time zone 'Asia/Bangkok') ->> 'vara_year')::int <> v;

create or replace function pg_temp.season_of(p_tok text) returns text language sql as $$
  select y.name || '/Q' || s.quarter || '/' || case when s.ended_at is null then 'open' else 'closed' end
    from passport.activities a join passport.samo_seasons s on s.id = a.season_id
    join passport.samo_years y on y.id = s.samo_year_id where a.static_token = p_tok;
$$;
create or replace function pg_temp.scan_season(p_tok text) returns text language sql as $$
  select string_agg(distinct y.name || '/Q' || s.quarter, ',') from passport.scans sc
    join passport.samo_seasons s on s.id = sc.season_id join passport.samo_years y on y.id = s.samo_year_id
   where sc.activity_id = (select id from passport.activities where static_token = p_tok);
$$;
create or replace function pg_temp.try(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return 'ok';
exception when others then return 'raised: ' || sqlerrm; end $$;
grant execute on function pg_temp.try(text) to authenticated;
create temporary table r (k text, v text) on commit drop;
grant insert, select on r to authenticated;

-- ── subjects ────────────────────────────────────────────────────────────────
create temporary table subj on commit drop as
  select id from public.users where email is not null order by id limit 2;
create temporary table p2 on commit drop as select id from subj order by id limit 1;
create temporary table p3 on commit drop as select id from subj order by id offset 1 limit 1;
grant select on p2, p3 to authenticated;
alter table public.users disable trigger users_self_update_guard;
update public.users set role = 'user', permissions = '{}', managed_permissions = '{}', managed_passport_scopes = '{d:6}' where id = (select id from p2);
update public.users set role = 'user', permissions = array['passport'], managed_permissions = '{}', managed_passport_scopes = '{}' where id = (select id from p3);
alter table public.users enable trigger users_self_update_guard;
create or replace function pg_temp.as_(p_id uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
$$;
create or replace function pg_temp.nobody() returns void language sql as $$
  select set_config('request.jwt.claims', '', true);
$$;

-- ── §C resolution, through the page's own RPC ──────────────────────────────
select pg_temp.as_((select id from p3));
set local role authenticated;
insert into r select 'info_today', (select (x ->> 'vara_name') || '/' || (x ->> 'label') || '/' || (x ->> 'state')
  from (select passport.activity_date_info((select t from fx)) x) z);
insert into r select 'info_prev', (select (x ->> 'label') || '/' || (x ->> 'state')
  from (select passport.activity_date_info((select prev_last from fx)) x) z);
insert into r select 'info_next_vara', (select (x ->> 'ok') || '/' || coalesce(x ->> 'error', '')
  from (select passport.activity_date_info((select next_vara_first from fx)) x) z);
reset role;
-- (called as owner: the resolver is not the caller's to call, the RPC is)
insert into r select 'info_before', (select (x ->> 'ok') || '/' || (x ->> 'error')
  from (select passport._resolve_event_date(lower(passport._quarter_days((select v from fx) - 1, 1)) - 1) x) z);
insert into r select 'info_default', (select x ->> 'default_scan_until'
  from (select passport._resolve_event_date(date '2026-12-31')
            || jsonb_build_object('default_scan_until', (date '2026-12-31' + interval '2 months')::date) x) z);

insert into probe select '20. today resolves to the open quarter of the current วาระ', 'true',
  (select (v = 'proof-0267-cur/Q' || (select q from fx) || '/open')::text from r where k = 'info_today');
insert into probe select '21. the last day of the previous quarter resolves to that CLOSED quarter', 'true',
  (select (v = 'Q' || case when (select q from fx) = 1 then 4 else (select q from fx) - 1 end || '/closed')::text
     from r where k = 'info_prev');
-- ('true/' only on a วาระ's last day, when the fixture opened the next one.)
insert into probe select '22. a day in a วาระ that has not started is refused, with why', 'true',
  (select (v in ('false/VARA_NOT_STARTED', 'true/')) ::text from r where k = 'info_next_vara');
insert into probe select '23. a day before any วาระ is refused as closed', 'false/QUARTER_CLOSED', (select v from r where k = 'info_before');

-- ── §D the trigger ──────────────────────────────────────────────────────────
select pg_temp.nobody();
insert into passport.activities (name, base_points_km, static_token, event_date, department_id)
  select 'proof-0267 today', 10, 'proof-0267-today', t, 6 from fx;
insert into passport.activities (name, base_points_km, static_token, event_date, department_id)
  select 'proof-0267 closed', 10, 'proof-0267-closed', prev_last, 6 from fx;
insert into probe select '30. a dated insert files itself in its date''s quarter', 'true',
  (select (pg_temp.season_of('proof-0267-today') = 'proof-0267-cur/Q' || (select q from fx) || '/open')::text);
insert into probe select '31. …with the window defaulted to two months', 'true',
  (select (scan_until = (event_date + interval '2 months')::date and not scan_until_set)::text
     from passport.activities where static_token = 'proof-0267-today');
insert into probe select '32. a CLOSED quarter is allowed on insert (its window decides, not the season)', 'true',
  (select (pg_temp.season_of('proof-0267-closed') like '%/closed')::text);

select pg_temp.as_((select id from p3));
set local role authenticated;
insert into r select 'expired', pg_temp.try($q$insert into passport.activities (name, base_points_km, event_date, department_id)
  select 'proof-0267 expired', 1, t - 100, 6 from fx$q$);
insert into r select 'end_before', pg_temp.try($q$insert into passport.activities (name, base_points_km, event_date, scan_until_set, scan_until, department_id)
  select 'proof-0267 bad1', 1, t, true, t - 1, 6 from fx$q$);
insert into r select 'end_far', pg_temp.try($q$insert into passport.activities (name, base_points_km, event_date, scan_until_set, scan_until, department_id)
  select 'proof-0267 bad2', 1, t, true, t + 367, 6 from fx$q$);
insert into r select 'end_kept', pg_temp.try($q$insert into passport.activities (name, base_points_km, static_token, event_date, scan_until_set, scan_until, department_id)
  select 'proof-0267 kept', 1, 'proof-0267-kept', t, true, t + 300, 6 from fx$q$);
reset role;
insert into probe select '33. a person cannot create an activity whose window has already passed', 'true',
  (select (v like 'raised: ACTIVITY_EXPIRED:%')::text from r where k = 'expired');
insert into probe select '34. a hand-set end BEFORE the date is refused', 'raised: SCAN_UNTIL_INVALID', (select v from r where k = 'end_before');
insert into probe select '35. a hand-set end more than 366 days after it is refused', 'raised: SCAN_UNTIL_INVALID', (select v from r where k = 'end_far');
insert into probe select '36. a hand-set end inside the bound is kept', 'ok,true,300',
  (select (select v from r where k = 'end_kept') || ',' || scan_until_set || ',' || (scan_until - event_date)
     from passport.activities where static_token = 'proof-0267-kept');

select pg_temp.nobody();
update passport.activities set event_date = event_date - 120 where static_token = 'proof-0267-kept';
insert into probe select '37. the DATE moving out from under a hand-set end hands it back to the default', 'false,true',
  (select scan_until_set || ',' || (scan_until = (event_date + interval '2 months')::date)
     from passport.activities where static_token = 'proof-0267-kept');
update passport.activities set event_date = event_date - 1 where static_token = 'proof-0267-closed';
insert into probe select '38. moving an unset date moves its default end with it', 'true',
  (select (scan_until = (event_date + interval '2 months')::date)::text from passport.activities where static_token = 'proof-0267-closed');
update passport.activities set event_date = event_date + 1 where static_token = 'proof-0267-closed';

-- ── §E stamp_scan ───────────────────────────────────────────────────────────
-- closed quarter, window open through today · the previous วาระ's last day
-- (the camps) · tomorrow · ended yesterday
update passport.activities set scan_until_set = true, scan_until = (select t from fx) where static_token = 'proof-0267-closed';
insert into passport.activities (name, base_points_km, static_token, event_date, scan_until_set, scan_until, department_id)
  select 'proof-0267 camp', 10, 'proof-0267-camp', vara_prev_last, true, t, 6 from fx;
insert into passport.activities (name, base_points_km, static_token, event_date, department_id)
  select 'proof-0267 soon', 10, 'proof-0267-soon', t + 1, 6 from fx;
insert into passport.activities (name, base_points_km, static_token, event_date, scan_until_set, scan_until, department_id)
  select 'proof-0267 old', 10, 'proof-0267-old', t - 10, true, t - 1, 6 from fx;

create temporary table kk on commit drop as
  select id from auth.users where lower(email) like '%@kkumail.com' order by created_at limit 1;
insert into probe select '40. a kkumail identity to scan as', '1', (select count(*)::text from kk);
select set_config('request.jwt.claims', json_build_object('sub', (select id from kk), 'role', 'authenticated')::text, true);
insert into r select 's_today',  pg_temp.try($q$select passport.stamp_scan((select id from passport.activities where static_token='proof-0267-today'),  'proof-0267-today')$q$);
insert into r select 's_closed', pg_temp.try($q$select passport.stamp_scan((select id from passport.activities where static_token='proof-0267-closed'), 'proof-0267-closed')$q$);
insert into r select 's_camp',   pg_temp.try($q$select passport.stamp_scan((select id from passport.activities where static_token='proof-0267-camp'),   'proof-0267-camp')$q$);
insert into r select 's_soon',   pg_temp.try($q$select passport.stamp_scan((select id from passport.activities where static_token='proof-0267-soon'),   'proof-0267-soon')$q$);
insert into r select 's_old',    pg_temp.try($q$select passport.stamp_scan((select id from passport.activities where static_token='proof-0267-old'),    'proof-0267-old')$q$);

insert into probe select '41. CONTROL: today''s QR scans, credited to the open quarter', 'true',
  (select (v = 'ok' and pg_temp.scan_season('proof-0267-today') = 'proof-0267-cur/Q' || (select q from fx))::text from r where k = 's_today');
insert into probe select '42. THE AGREEMENT: a CLOSED quarter''s QR scans inside its window…', 'ok', (select v from r where k = 's_closed');
insert into probe select '43. …and its points go to THAT closed quarter, not the open one', 'true',
  (select (pg_temp.scan_season('proof-0267-closed') || '/closed' = pg_temp.season_of('proof-0267-closed'))::text);
insert into probe select '44. the camps: an event of the previous วาระ scanned now counts in THAT วาระ', 'ok,proof-0267-prev/Q4',
  (select (select v from r where k = 's_camp') || ',' || pg_temp.scan_season('proof-0267-camp'));
insert into probe select '45. before its date a QR refuses, naming the date', 'true',
  (select (v = 'raised: SCAN_NOT_YET:' || to_char((select t from fx) + 1, 'YYYY-MM-DD'))::text from r where k = 's_soon');
insert into probe select '46. after its end a QR refuses, naming the last day', 'true',
  (select (v = 'raised: SCAN_EXPIRED:' || to_char((select t from fx) - 1, 'YYYY-MM-DD'))::text from r where k = 's_old');
insert into probe select '47. refusals wrote no scan', '0',
  (select count(*)::text from passport.scans where activity_id in
     (select id from passport.activities where static_token in ('proof-0267-soon', 'proof-0267-old')));

-- ── §F moves through the date ──────────────────────────────────────────────
select pg_temp.as_((select id from p2));
set local role authenticated;
insert into r select 'p2_ctx', (public.passport_admin_context() ->> 'is_admin') || ',' || passport._org_wide()::text;
insert into r select 'p2_to_closed', pg_temp.try($q$update passport.activities set event_date = (select prev_last from fx)
  where static_token = 'proof-0267-today'$q$);
insert into r select 'p2_within', pg_temp.try($q$update passport.activities set event_date = event_date - 1
  where static_token = 'proof-0267-closed'$q$);
reset role;
select pg_temp.as_((select id from p3));
set local role authenticated;
insert into r select 'p3_org', passport._org_wide()::text;
insert into r select 'p3_ahead', pg_temp.try($q$update passport.activities
   set event_date = (select next_q_first from fx)
 where static_token = 'proof-0267-today'$q$);
insert into r select 'p3_to_closed', pg_temp.try($q$update passport.activities set event_date = (select prev_last from fx)
  where static_token = 'proof-0267-today'$q$);
reset role;

insert into probe select '50. subject p2 is a ฝ่าย-scoped admin, NOT org-wide; p3 IS org-wide', 'true,false,true',
  (select (select v from r where k = 'p2_ctx') || ',' || (select v from r where k = 'p3_org'));
insert into probe select '51. a ฝ่าย-scoped admin cannot move scanned points into a CLOSED quarter by its date', 'true',
  (select (v like 'raised: QUARTER_CLOSED_ORG_WIDE_ONLY:%')::text from r where k = 'p2_to_closed');
insert into probe select '52. a date change INSIDE the same quarter needs no rights and moves nothing', 'true',
  (select (v = 'ok' and pg_temp.season_of('proof-0267-closed') like '%/closed')::text from r where k = 'p2_within');
insert into probe select '53. a scanned activity cannot be dated into a quarter not started', 'true',
  (select (v like 'raised: QUARTER_NOT_OPEN_HAS_SCANS:%' or v like 'raised: VARA_NOT_STARTED:%')::text from r where k = 'p3_ahead');
insert into probe select '54. an org-wide admin dates it into the closed quarter, and its points follow', 'true',
  (select (v = 'ok' and pg_temp.scan_season('proof-0267-today') || '/closed' = pg_temp.season_of('proof-0267-today'))::text
     from r where k = 'p3_to_closed');
insert into probe select '55. no scan of these activities is outside its activity''s season', '0',
  (select count(*)::text from passport.scans s join passport.activities a on a.id = s.activity_id
    where a.name like 'proof-0267 %' and s.season_id is distinct from a.season_id);

select step,
       case when got is not distinct from expected then 'PASS' else 'FAIL' end as result,
       expected, got
  from probe order by step;
rollback;
