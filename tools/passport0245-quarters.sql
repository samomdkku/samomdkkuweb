-- ============================================================
-- passport0245-quarters.sql — Passport quarters change themselves (0245),
-- an activity's points go to the quarter it names, and only org-wide admins
-- move a quarter.
--   §A  shape + ACL: the schedule is deny-all; the machinery is not callable
--       through the API; the four page RPCs are signed-in only.
--   §B  the calendar: schedule_at() maps instants to (วาระ, quarter) at the
--       owner's boundaries, including Q4 spanning ม.ค.–ก.พ. and Q1 opening the
--       next วาระ.
--   §C  the rollover, at FIXED instants (apply_season_schedule(p_now)): nothing
--       before a boundary; exactly one roll after it, stamped with the
--       boundary; idempotent; an activity made ahead is linked when its
--       quarter opens; Q1 opens a new วาระสโม bridged to its ปี SAMO.
--   §D  stamp_scan: a closed quarter refuses, a quarter not open yet refuses
--       with its date, an open one credits the ACTIVITY's quarter.
--   §E  manual: a plain account and a ฝ่าย-scoped admin cannot move a quarter
--       (RPC or table); an org-wide admin can, forward and BACK; a bad schedule
--       is refused; saving one never rolls anything.
-- Fixtures: its own วาระ 'proof-0245' and seasons; every open real season is
-- closed first so nothing depends on production's quarter. Borrows three
-- users + one kkumail identity; everything ROLLS BACK.
--   node tools/db-query.mjs tools/passport0245-quarters.sql
-- ============================================================
begin;

create temporary table probe (step text, expected text, got text) on commit drop;

-- ── §A shape + ACL ──────────────────────────────────────────────────────────
insert into probe select '00. season_schedule has row security', 'true',
  (select relrowsecurity::text from pg_class where oid = 'passport.season_schedule'::regclass);
insert into probe select '01. anon holds NO privilege on season_schedule', '0',
  (select count(*)::text from information_schema.role_table_grants
    where table_schema = 'passport' and table_name = 'season_schedule' and grantee = 'anon');
insert into probe select '02. authenticated holds NO privilege on season_schedule', '0',
  (select count(*)::text from information_schema.role_table_grants
    where table_schema = 'passport' and table_name = 'season_schedule' and grantee = 'authenticated');
insert into probe select '03. the machinery is not callable by authenticated', 'false,false',
  (select has_function_privilege('authenticated', 'passport.apply_season_schedule(timestamptz)', 'execute')::text
       || ',' || has_function_privilege('authenticated', 'passport.schedule_at(timestamptz,passport.season_schedule)', 'execute')::text);
insert into probe select '04. anon cannot call any of the four page RPCs', 'false,false,false,false',
  (select string_agg(has_function_privilege('anon', f, 'execute')::text, ',' order by f) from unnest(array[
     'passport.season_status()', 'passport.set_season_schedule(boolean,jsonb)',
     'passport.start_season(integer)', 'passport.start_vara(text,integer,integer)']) f);
insert into probe select '05. authenticated can call all four', 'true,true,true,true',
  (select string_agg(has_function_privilege('authenticated', f, 'execute')::text, ',' order by f) from unnest(array[
     'passport.season_status()', 'passport.set_season_schedule(boolean,jsonb)',
     'passport.start_season(integer)', 'passport.start_vara(text,integer,integer)']) f);

-- ── §B the calendar, on the owner's default schedule ────────────────────────
create temporary table sched on commit drop as
  select row(true, true, 3,1,'00:00'::time, 6,1,'00:00'::time, 9,1,'00:00'::time, 12,1,'00:00'::time,
             null::timestamptz, now(), null::uuid)::passport.season_schedule as s;
create or replace function pg_temp.q(p_ts timestamptz) returns text language sql as $$
  select (x ->> 'label') || '/' || (x ->> 'be')
    from (select passport.schedule_at(p_ts, (select s from sched)) x) z;
$$;
insert into probe select '10. 31 ส.ค. 23:59 is still Q2 of วาระ 2569', 'Q2/2569', pg_temp.q('2026-08-31 23:59:59 Asia/Bangkok');
insert into probe select '11. 1 ก.ย. 00:00 is Q3', 'Q3/2569', pg_temp.q('2026-09-01 00:00:00 Asia/Bangkok');
insert into probe select '12. 1 ธ.ค. 00:00 is Q4', 'Q4/2569', pg_temp.q('2026-12-01 00:00:00 Asia/Bangkok');
insert into probe select '13. 28 ก.พ. (next calendar year) is still Q4 of the same วาระ', 'Q4/2569', pg_temp.q('2027-02-28 23:59:00 Asia/Bangkok');
insert into probe select '14. 1 มี.ค. opens Q1 of วาระ 2570', 'Q1/2570', pg_temp.q('2027-03-01 00:00:00 Asia/Bangkok');
insert into probe select '15. Q3 ends when Q4 starts (1 ธ.ค. 00:00)', 'true',
  (select ((passport.schedule_at('2026-10-23 12:00 Asia/Bangkok', (select s from sched)) ->> 'ends_at')::timestamptz
           = timestamptz '2026-12-01 00:00 Asia/Bangkok')::text);

-- ── fixtures ────────────────────────────────────────────────────────────────
update passport.season_schedule
   set auto = false,                      -- frozen while fixtures are built
       q1_month = 3, q1_day = 1, q1_time = '00:00', q2_month = 6, q2_day = 1, q2_time = '00:00',
       q3_month = 9, q3_day = 1, q3_time = '00:00', q4_month = 12, q4_day = 1, q4_time = '00:00',
       last_applied_boundary = timestamptz '2026-06-01 00:00 Asia/Bangkok'
 where id;
update passport.samo_seasons set ended_at = now() - interval '1 second' where ended_at is null;
update passport.samo_years   set ended_at = now() - interval '1 second' where ended_at is null;
insert into passport.samo_years (name, started_at, team_term_year)
     values ('proof-0245', timestamptz '2026-06-01 00:00 Asia/Bangkok', 2569);
insert into passport.samo_seasons (samo_year_id, name, quarter, started_at)
  select id, 'Q2', 2, timestamptz '2026-06-01 00:00 Asia/Bangkok' from passport.samo_years where name = 'proof-0245';

create or replace function pg_temp.try(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return 'ok';
exception when others then return 'raised: ' || sqlerrm; end $$;
grant execute on function pg_temp.try(text) to authenticated;
create temporary table r (k text, v text) on commit drop;
grant insert, select on r to authenticated;

-- a2: Q2 (open); a3, a4: made AHEAD for Q3 / Q4.
insert into passport.activities (name, base_points_km, static_token, quarter, samo_year_id)
  select 'proof-0245 '||q, 1, 'proof-0245-'||q, q, (select id from passport.samo_years where name = 'proof-0245')
    from unnest(array[2,3,4]) q;
insert into probe select '20. an activity made for Q2 is linked to the open Q2', 'Q2',
  (select s.name from passport.activities a join passport.samo_seasons s on s.id = a.season_id where a.static_token = 'proof-0245-2');
insert into probe select '21. one made AHEAD for Q3 waits (no season yet)', 'null',
  (select coalesce(season_id::text, 'null') from passport.activities where static_token = 'proof-0245-3');
insert into r select 'behind', pg_temp.try($q$insert into passport.activities (name, base_points_km, quarter, samo_year_id)
  select 'proof-0245 behind', 1, 1, id from passport.samo_years where name = 'proof-0245'$q$);
insert into probe select '22. a quarter BEHIND the open one is refused', 'raised: QUARTER_CLOSED:Q1',
  (select v from r where k = 'behind');

-- ── §C the rollover at fixed instants ──────────────────────────────────────
update passport.season_schedule set auto = true where id;
insert into probe select '30. nothing rolls one second before 1 ก.ย.', 'false',
  (select passport.apply_season_schedule('2026-08-31 23:59:59 Asia/Bangkok') ->> 'applied');
insert into probe select '31. it rolls one second after', 'true',
  (select passport.apply_season_schedule('2026-09-01 00:00:01 Asia/Bangkok') ->> 'applied');
insert into probe select '32. Q3 starts AT the boundary, not at the first caller', 'true',
  (select (s.started_at = timestamptz '2026-09-01 00:00 Asia/Bangkok')::text from passport.samo_seasons s
     join passport.samo_years y on y.id = s.samo_year_id where y.name = 'proof-0245' and s.quarter = 3);
insert into probe select '33. Q2 ended at that same instant (no gap, no overlap)', 'true',
  (select (s.ended_at = timestamptz '2026-09-01 00:00 Asia/Bangkok')::text from passport.samo_seasons s
     join passport.samo_years y on y.id = s.samo_year_id where y.name = 'proof-0245' and s.quarter = 2);
insert into probe select '34. the activity made ahead for Q3 is linked now; Q4''s still waits', 'Q3,null',
  (select (select coalesce(s.name, 'null') from passport.activities a left join passport.samo_seasons s on s.id = a.season_id where a.static_token = 'proof-0245-3')
       || ',' || (select coalesce(season_id::text, 'null') from passport.activities where static_token = 'proof-0245-4'));
insert into probe select '35. a second call is a no-op', 'false',
  (select passport.apply_season_schedule('2026-09-01 00:00:02 Asia/Bangkok') ->> 'applied');
insert into probe select '36. …and there is exactly one Q3', '1',
  (select count(*)::text from passport.samo_seasons s join passport.samo_years y on y.id = s.samo_year_id
    where y.name = 'proof-0245' and s.quarter = 3);
-- (each roll in its OWN statement: a check in the same statement as the write
-- reads the snapshot from before it — skills/ship-a-migration.md)
insert into r select 'dec', passport.apply_season_schedule('2026-12-01 00:00:05 Asia/Bangkok') ->> 'applied';
insert into probe select '37. 1 ธ.ค. rolls to Q4 and links its waiting activity', 'true,Q4',
  (select (select v from r where k = 'dec')
       || ',' || (select s.name from passport.activities a join passport.samo_seasons s on s.id = a.season_id where a.static_token = 'proof-0245-4'));
insert into r select 'mar', passport.apply_season_schedule('2027-03-01 00:00:05 Asia/Bangkok') ->> 'new_year';
insert into probe select '38. 1 มี.ค. opens a NEW วาระสโม bridged to ปี SAMO 2570', 'true,MDKKU SAMO''70,2570',
  (select (select v from r where k = 'mar')
       || ',' || (select name || ',' || team_term_year from passport.samo_years where ended_at is null));
insert into probe select '39. …with exactly one open season, Q1, and the old วาระ closed at the boundary', 'Q1,1,true',
  (select (select string_agg(name, ',') from passport.samo_seasons where ended_at is null)
       || ',' || (select count(*) from passport.samo_years where ended_at is null)
       || ',' || (select (ended_at = timestamptz '2027-03-01 00:00 Asia/Bangkok')::text from passport.samo_years where name = 'proof-0245'));

-- ── §D stamp_scan credits the activity's quarter ───────────────────────────
update passport.season_schedule set auto = false where id;   -- real now() must not roll the fixtures
create temporary table kk on commit drop as
  select id from auth.users where lower(email) like '%@kkumail.com' order by created_at limit 1;
insert into probe select '40. a kkumail identity to scan as', '1', (select count(*)::text from kk);
select set_config('request.jwt.claims', json_build_object('sub', (select id from kk), 'role', 'authenticated')::text, true);
insert into passport.activities (name, base_points_km, static_token, quarter, samo_year_id)
  select 'proof-0245 b'||q, 1, 'proof-0245-b'||q, q, (select id from passport.samo_years where ended_at is null)
    from unnest(array[1,2]) q;
insert into r select 'closed',  pg_temp.try($q$select passport.stamp_scan((select id from passport.activities where static_token='proof-0245-2'), 'proof-0245-2')$q$);
insert into r select 'ahead',   pg_temp.try($q$select passport.stamp_scan((select id from passport.activities where static_token='proof-0245-b2'), 'proof-0245-b2')$q$);
insert into r select 'open',    pg_temp.try($q$select passport.stamp_scan((select id from passport.activities where static_token='proof-0245-b1'), 'proof-0245-b1')$q$);
insert into probe select '41. a QR of a CLOSED quarter is refused', 'raised: SEASON_CLOSED', (select v from r where k = 'closed');
insert into probe select '42. a QR of a quarter NOT OPEN YET is refused, with its quarter', 'true',
  (select (v like 'raised: SEASON_NOT_OPEN:Q2:2027-06-01T00:00')::text from r where k = 'ahead');
insert into probe select '43. CONTROL: an open quarter''s QR scans', 'ok', (select v from r where k = 'open');
insert into probe select '44. …and the scan is credited to the ACTIVITY''s quarter + วาระ', 'Q1,MDKKU SAMO''70',
  (select s.name || ',' || y.name from passport.scans sc
     join passport.samo_seasons s on s.id = sc.season_id join passport.samo_years y on y.id = sc.samo_year_id
    where sc.activity_id = (select id from passport.activities where static_token = 'proof-0245-b1'));
insert into probe select '45. refusals wrote no scan', '0',
  (select count(*)::text from passport.scans where activity_id in
     (select id from passport.activities where static_token in ('proof-0245-2', 'proof-0245-b2')));

-- ── §E who may move a quarter ───────────────────────────────────────────────
-- Auto back ON, so the schedule saves below change Q3 only. (§D froze it; the
-- boundary is acknowledged to 1 มี.ค. 2027 by §C, so real now() rolls nothing.)
-- Switching auto or Q1 needs ทีม SAMO rights too since 0248 —
-- year0248-one-year-system.sql proves that half.
update passport.season_schedule set auto = true where id;
create temporary table subj on commit drop as
  select id, email from public.users where email is not null order by id limit 3;
create temporary table p1 on commit drop as select id, email from subj order by id limit 1;
create temporary table p2 on commit drop as select id, email from subj order by id offset 1 limit 1;
create temporary table p3 on commit drop as select id, email from subj order by id offset 2 limit 1;
grant select on p1, p2, p3 to authenticated;
alter table public.users disable trigger users_self_update_guard;
update public.users set role = 'user', permissions = '{}', managed_permissions = '{}', managed_passport_scopes = '{}' where id = (select id from p1);
update public.users set role = 'user', permissions = '{}', managed_permissions = '{}', managed_passport_scopes = '{d:6}' where id = (select id from p2);
update public.users set role = 'user', permissions = array['passport'], managed_permissions = '{}', managed_passport_scopes = '{}' where id = (select id from p3);
alter table public.users enable trigger users_self_update_guard;
create or replace function pg_temp.as_(p_id uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
$$;

-- the probe subjects ARE what they are meant to be, asked of the gate itself
select pg_temp.as_((select id from p2));
set local role authenticated;
insert into r select 'p2_ctx', (public.passport_admin_context() ->> 'is_admin') || ',' || passport._org_wide()::text;
insert into r select 'p2_rpc', pg_temp.try('select passport.start_season(2)');
insert into r select 'p2_tbl', pg_temp.try($q$insert into passport.samo_seasons (samo_year_id, name) select id, 'proof-0245 sneaky' from passport.samo_years where ended_at is null$q$);
reset role;
select pg_temp.as_((select id from p1));
set local role authenticated;
insert into r select 'p1_rpc', pg_temp.try('select passport.start_season(2)');
insert into r select 'p1_sched', pg_temp.try($q$select passport.set_season_schedule(true, '[{"month":3,"day":1,"time":"00:00"},{"month":6,"day":1,"time":"00:00"},{"month":9,"day":1,"time":"00:00"},{"month":12,"day":1,"time":"00:00"}]')$q$);
reset role;

insert into probe select '50. subject p2 is a ฝ่าย-scoped Passport admin, NOT org-wide', 'true,false', (select v from r where k = 'p2_ctx');
insert into probe select '51. a ฝ่าย-scoped admin cannot switch the quarter (RPC)', 'true', (select (v like 'raised:%ทุกฝ่าย%')::text from r where k = 'p2_rpc');
insert into probe select '52. …nor write a season straight into the table', 'true', (select (v like 'raised:%row-level security%')::text from r where k = 'p2_tbl');
insert into probe select '53. a plain account cannot switch the quarter', 'true', (select (v like 'raised:%ทุกฝ่าย%')::text from r where k = 'p1_rpc');
insert into probe select '54. …nor edit the schedule', 'true', (select (v like 'raised:%ทุกฝ่าย%')::text from r where k = 'p1_sched');
insert into probe select '55. both refusals changed nothing (Q1 still the only open season)', 'Q1',
  (select string_agg(name, ',') from passport.samo_seasons where ended_at is null);

select pg_temp.as_((select id from p3));
set local role authenticated;
insert into r select 'p3_org', passport._org_wide()::text;
insert into r select 'p3_fwd',  pg_temp.try('select passport.start_season(2)');
insert into r select 'p3_open_after_fwd', (select string_agg(name, ',') from passport.samo_seasons where ended_at is null);
insert into r select 'p3_back', pg_temp.try('select passport.start_season(1)');
insert into r select 'p3_bad_order', pg_temp.try($q$select passport.set_season_schedule(true, '[{"month":3,"day":1,"time":"00:00"},{"month":9,"day":1,"time":"00:00"},{"month":6,"day":1,"time":"00:00"},{"month":12,"day":1,"time":"00:00"}]')$q$);
insert into r select 'p3_bad_day', pg_temp.try($q$select passport.set_season_schedule(true, '[{"month":3,"day":1,"time":"00:00"},{"month":6,"day":1,"time":"00:00"},{"month":9,"day":1,"time":"00:00"},{"month":2,"day":30,"time":"00:00"}]')$q$);
insert into r select 'p3_good', pg_temp.try($q$select passport.set_season_schedule(true, '[{"month":3,"day":1,"time":"00:00"},{"month":6,"day":1,"time":"00:00"},{"month":9,"day":15,"time":"08:30"},{"month":12,"day":1,"time":"00:00"}]')$q$);
insert into r select 'p3_open_after_save', (select string_agg(name, ',') from passport.samo_seasons where ended_at is null);
insert into r select 'p3_status', pg_temp.try('select passport.season_status()');
reset role;

insert into probe select '60. subject p3 IS org-wide', 'true', (select v from r where k = 'p3_org');
insert into probe select '61. an org-wide admin switches forward', 'ok,Q2', (select (select v from r where k = 'p3_fwd') || ',' || (select v from r where k = 'p3_open_after_fwd'));
insert into probe select '62. …and the activity waiting on that quarter is linked', 'Q2',
  (select s.name from passport.activities a join passport.samo_seasons s on s.id = a.season_id where a.static_token = 'proof-0245-b2');
insert into probe select '63. …and BACK: the earlier quarter reopens, the same row', 'ok,Q1,1',
  (select (select v from r where k = 'p3_back') || ',' || (select string_agg(name, ',') from passport.samo_seasons where ended_at is null)
       || ',' || (select count(*) from passport.samo_seasons s join passport.samo_years y on y.id = s.samo_year_id where y.ended_at is null and s.quarter = 1));
insert into probe select '64. a schedule out of order is refused', 'true', (select (v like 'raised:%เรียง Q1%')::text from r where k = 'p3_bad_order');
insert into probe select '65. 30 ก.พ. is refused', 'true', (select (v like 'raised:%ไม่มีในปฏิทิน%')::text from r where k = 'p3_bad_day');
insert into probe select '66. a good schedule saves', 'ok', (select v from r where k = 'p3_good');
insert into probe select '67. …at the minute it was given (Q3 = 15 ก.ย. 08:30)', '9,15,08:30',
  (select q3_month || ',' || q3_day || ',' || to_char(q3_time, 'HH24:MI') from passport.season_schedule);
insert into probe select '68. …and saving it moved NO quarter', 'Q1', (select v from r where k = 'p3_open_after_save');
insert into probe select '69. season_status answers a signed-in caller', 'ok', (select v from r where k = 'p3_status');

select step,
       case when got is not distinct from expected then 'PASS' else 'FAIL' end as result,
       expected, got
  from probe order by step;
rollback;
