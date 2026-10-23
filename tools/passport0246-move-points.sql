-- ============================================================
-- passport0246-move-points.sql — moving an activity to another quarter moves
-- the points already earned (0246), by the owner's rules:
--   * to the quarter OPEN now — any admin; the points follow;
--   * back to a CLOSED quarter — org-wide admins only; the points follow and
--     the QR stops scanning;
--   * to a quarter NOT STARTED — refused once anyone has scanned; allowed while
--     nobody has;
--   * a client that sets only `quarter` (not season_id) still moves the points
--     — the AFTER trigger must not be `update OF season_id`;
--   * km totals never change; no scan is left outside its activity's quarter.
-- Fixtures: its own วาระ with Q2 CLOSED and Q3 OPEN, three activities and real
-- profiles to scan as. Borrows two accounts; everything ROLLS BACK.
--   node tools/db-query.mjs tools/passport0246-move-points.sql
-- ============================================================
begin;

create temporary table probe (step text, expected text, got text) on commit drop;

-- ── fixtures ────────────────────────────────────────────────────────────────
update passport.season_schedule set auto = false where id;      -- real now() must not roll anything
update passport.samo_seasons set ended_at = now() - interval '1 second' where ended_at is null;
update passport.samo_years   set ended_at = now() - interval '1 second' where ended_at is null;
insert into passport.samo_years (name, started_at) values ('proof-0246', now() - interval '200 days');
insert into passport.samo_seasons (samo_year_id, name, quarter, started_at, ended_at)
  select id, 'Q2', 2, now() - interval '200 days', now() - interval '50 days' from passport.samo_years where name = 'proof-0246';
insert into passport.samo_seasons (samo_year_id, name, quarter, started_at)
  select id, 'Q3', 3, now() - interval '50 days' from passport.samo_years where name = 'proof-0246';
create temporary table ss on commit drop as
  select s.quarter, s.id from passport.samo_seasons s join passport.samo_years y on y.id = s.samo_year_id where y.name = 'proof-0246';
grant select on ss to authenticated;

-- aOld: a Q2 activity scanned in Q2 · aNow: a Q3 activity scanned in Q3 ·
-- aHeld: a Q3 activity with scans · aFree: a Q3 activity nobody scanned
insert into passport.activities (name, base_points_km, static_token, season_id, department_id)
  select 'proof-0246 ' || k, 10, 'proof-0246-' || k, (select id from ss where quarter = q), 6
    from (values ('old', 2), ('now', 3), ('held', 3), ('free', 3)) v(k, q);
create temporary table aa on commit drop as
  select replace(name, 'proof-0246 ', '') k, id from passport.activities where name like 'proof-0246 %';
grant select on aa to authenticated;

create temporary table who on commit drop as
  select id from passport.profiles order by id limit 2;
create temporary table km_before on commit drop as
  select id, total_km from passport.profiles where id in (select id from who);
insert into passport.scans (user_id, activity_id, points_awarded, activity_name, department_id, samo_year_id, season_id)
  select w.id, a.id, 10, 'proof', 6, (select samo_year_id from passport.samo_seasons where id = act.season_id), act.season_id
    from who w cross join aa a join passport.activities act on act.id = a.id
   where a.k in ('old', 'now', 'held');
insert into probe select '00. six fixture scans, each in its activity''s quarter', '6,0',
  (select count(*) || ',' || count(*) filter (where s.season_id is distinct from a.season_id)
     from passport.scans s join passport.activities a on a.id = s.activity_id where a.name like 'proof-0246 %');

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
create or replace function pg_temp.try(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return 'ok';
exception when others then return 'raised: ' || sqlerrm; end $$;
grant execute on function pg_temp.try(text) to authenticated;
create temporary table r (k text, v text) on commit drop;
grant insert, select on r to authenticated;
create or replace function pg_temp.qof(p_k text) returns text language sql as $$
  select string_agg(distinct s.name, ',') from passport.scans sc
    join passport.samo_seasons s on s.id = sc.season_id
   where sc.activity_id = (select id from aa where k = p_k);
$$;

-- ── a ฝ่าย-scoped admin ────────────────────────────────────────────────────
select pg_temp.as_((select id from p2));
set local role authenticated;
insert into r select 'p2_ctx', (public.passport_admin_context() ->> 'is_admin') || ',' || passport._org_wide()::text;
insert into r select 'old_to_open', pg_temp.try($q$update passport.activities set quarter = 3, season_id = null where id = (select id from aa where k = 'old')$q$);
insert into r select 'now_to_closed', pg_temp.try($q$update passport.activities set quarter = 2, season_id = null where id = (select id from aa where k = 'now')$q$);
insert into r select 'held_ahead', pg_temp.try($q$update passport.activities set quarter = 4, season_id = null where id = (select id from aa where k = 'held')$q$);
insert into r select 'free_ahead', pg_temp.try($q$update passport.activities set quarter = 4, season_id = null where id = (select id from aa where k = 'free')$q$);
reset role;

insert into probe select '10. subject p2 is a ฝ่าย-scoped admin, NOT org-wide', 'true,false', (select v from r where k = 'p2_ctx');
insert into probe select '11. Q2 (closed) → the OPEN Q3: allowed for any admin', 'ok', (select v from r where k = 'old_to_open');
insert into probe select '12. …and its points moved with it', 'Q3', pg_temp.qof('old');
insert into probe select '13. Q3 → a CLOSED Q2 by a ฝ่าย-scoped admin is refused', 'true',
  (select (v like 'raised: QUARTER_CLOSED_ORG_WIDE_ONLY:Q2%')::text from r where k = 'now_to_closed');
insert into probe select '14. …and nothing moved', 'Q3', pg_temp.qof('now');
insert into probe select '15. a scanned activity cannot move to a quarter NOT STARTED', 'true',
  (select (v like 'raised: QUARTER_NOT_OPEN_HAS_SCANS:Q4%')::text from r where k = 'held_ahead');
insert into probe select '16. …its points stay where they were', 'Q3', pg_temp.qof('held');
insert into probe select '17. an UNSCANNED one may move ahead, and waits for its quarter', 'ok,4,null',
  (select (select v from r where k = 'free_ahead') || ',' || quarter || ',' || coalesce(season_id::text, 'null')
     from passport.activities where id = (select id from aa where k = 'free'));

-- ── an org-wide admin ──────────────────────────────────────────────────────
select pg_temp.as_((select id from p3));
set local role authenticated;
insert into r select 'p3_org', passport._org_wide()::text;
insert into r select 'now_back', pg_temp.try($q$update passport.activities set quarter = 2, season_id = null where id = (select id from aa where k = 'now')$q$);
reset role;
insert into probe select '20. subject p3 IS org-wide', 'true', (select v from r where k = 'p3_org');
insert into probe select '21. an org-wide admin moves it BACK to the closed Q2', 'ok', (select v from r where k = 'now_back');
insert into probe select '22. …its points went with it', 'Q2', pg_temp.qof('now');

-- the QR now refuses: its quarter is closed
create temporary table kk on commit drop as
  select id from auth.users where lower(email) like '%@kkumail.com'
     and id not in (select id from who) order by created_at limit 1;
select set_config('request.jwt.claims', json_build_object('sub', (select id from kk), 'role', 'authenticated')::text, true);
insert into r select 'scan_closed', pg_temp.try($q$select passport.stamp_scan((select id from aa where k = 'now'), 'proof-0246-now')$q$);
insert into probe select '23. …and its QR no longer scans (SEASON_CLOSED)', 'raised: SEASON_CLOSED', (select v from r where k = 'scan_closed');

-- a client that names ONLY `quarter` — the BEFORE trigger sets season_id, and
-- an `after update OF season_id` trigger would never see it
select pg_temp.as_((select id from p3));
set local role authenticated;
insert into r select 'quarter_only', pg_temp.try($q$update passport.activities set quarter = 3 where id = (select id from aa where k = 'now')$q$);
reset role;
insert into probe select '24. setting ONLY quarter still moves the points', 'ok,Q3',
  (select (select v from r where k = 'quarter_only') || ',' || pg_temp.qof('now'));

-- ── what must not change ────────────────────────────────────────────────────
insert into probe select '30. no scan of these activities is outside its activity''s quarter', '0',
  (select count(*)::text from passport.scans s join passport.activities a on a.id = s.activity_id
    where a.name like 'proof-0246 %' and s.season_id is distinct from a.season_id);
insert into probe select '31. km totals did not move (moves change the quarter, not the points)', 'true',
  (select (sum(p.total_km) = (select sum(total_km) + 60 from km_before))::text
     from passport.profiles p where p.id in (select id from who));

select step,
       case when got is not distinct from expected then 'PASS' else 'FAIL' end as result,
       expected, got
  from probe order by step;
rollback;
