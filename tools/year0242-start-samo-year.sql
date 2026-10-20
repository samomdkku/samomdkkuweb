-- ============================================================
-- year0242-start-samo-year.sql — start_samo_year() (0242): one act starts the
-- ปี SAMO and, for an org-wide Passport admin, opens the next Passport วาระสโม.
--   §A  the function exists; anon cannot execute it.
--   §B  DENY: a plain account changes nothing.
--   §C  DENY then ALLOW for a team_edit holder WITHOUT Passport: asking for
--       Passport refuses the WHOLE call (the ปี SAMO stays put — all or
--       nothing); the same holder with no Passport name starts the year and
--       Passport is untouched.
--   §D  ALLOW for team_edit + passport: both move — exactly one open Passport
--       year (bridged to the new ปี SAMO) with exactly one open season, the old
--       year/season ended, the outgoing year's blank bridge filled.
--   §E  a Passport year already bridged to the target is not duplicated, and
--       going BACK a year never opens a วาระ.
-- Sentinel years 2697/2698/2699 (year0219: 2691/2692; team0224: 2693/2694;
-- data0222 + team0228: 2695/2696). Borrows three existing accounts and
-- reshapes them; everything ROLLS BACK.
--   node tools/db-query.mjs tools/year0242-start-samo-year.sql [--dev]
-- ============================================================
begin;

create temporary table probe (step text, expected text, got text) on commit drop;

insert into probe select '00. start_samo_year(int,text,text) exists', '1',
  (select count(*)::text from pg_proc
    where oid = 'public.start_samo_year(integer,text,text)'::regprocedure);
insert into probe select '01. anon cannot execute it', 'false',
  (select has_function_privilege('anon', 'public.start_samo_year(integer,text,text)', 'execute')::text);
insert into probe select '02. authenticated can execute it', 'true',
  (select has_function_privilege('authenticated', 'public.start_samo_year(integer,text,text)', 'execute')::text);

-- ── fixtures ──────────────────────────────────────────────────────────────
delete from public.team_terms where year in (2697, 2698, 2699);
-- A known current year to move FROM, so the proof never depends on whatever
-- production's current year happens to be.
update public.team_terms set is_current = false where is_current;
insert into public.team_terms (year, is_current, started_at, published_at)
     values (2697, true, now() - interval '1 year', now());
-- A known open Passport year + season with a BLANK bridge, as production's is.
update passport.samo_seasons set ended_at = now() - interval '1 second' where ended_at is null;
update passport.samo_years   set ended_at = now() - interval '1 second' where ended_at is null;
insert into passport.samo_years (name, started_at) values ('proof-0242-old', now() - interval '1 year');
insert into passport.samo_seasons (samo_year_id, name, started_at)
  select id, 'proof-0242-old-season', now() - interval '1 year' from passport.samo_years where name = 'proof-0242-old';

create temporary table subj on commit drop as
  select id, email from public.users where email is not null order by id limit 3;
insert into probe select '03. three existing accounts to borrow', '3', (select count(*)::text from subj);
create temporary table p1 on commit drop as select id, email from subj order by id limit 1;
create temporary table p2 on commit drop as select id, email from subj order by id offset 1 limit 1;
create temporary table p3 on commit drop as select id, email from subj order by id offset 2 limit 1;
grant select on p1, p2, p3 to authenticated;

alter table public.users disable trigger users_self_update_guard;
update public.users set role = 'user', permissions = '{}', managed_permissions = '{}', managed_passport_scopes = '{}'
 where id = (select id from p1);
update public.users set role = 'user', permissions = array['team_edit'], managed_permissions = '{}', managed_passport_scopes = '{}'
 where id = (select id from p2);
update public.users set role = 'user', permissions = array['team_edit', 'passport'], managed_permissions = '{}', managed_passport_scopes = '{}'
 where id = (select id from p3);
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

-- ── §B DENY: a plain account ───────────────────────────────────────────────
select pg_temp.as_((select id from p1), (select email from p1));
set local role authenticated;
insert into r select 'plain', pg_temp.try($q$select public.start_samo_year(2698, 'proof-0242-new', 'Q1')$q$);
insert into r select 'plain_bare', pg_temp.try($q$select public.start_samo_year(2698)$q$);
reset role;
insert into probe select '10. a plain account asking for Passport is refused (Passport gate)', 'true',
  (select (v like 'raised: %Passport%')::text from r where k = 'plain');
insert into probe select '11. a plain account without Passport is refused (team gate)', 'true',
  (select (v like 'raised: start_team_term: ไม่มีสิทธิ์%')::text from r where k = 'plain_bare');
insert into probe select '12. …and the current year did not move', '2697',
  (select year::text from public.team_terms where is_current);

-- ── §C team_edit WITHOUT passport ─────────────────────────────────────────
select pg_temp.as_((select id from p2), (select email from p2));
set local role authenticated;
insert into r select 'team_only_pp', pg_temp.try($q$select public.start_samo_year(2698, 'proof-0242-new', 'Q1')$q$);
reset role;
insert into probe select '20. team_edit alone + a Passport name: the WHOLE call is refused', 'true',
  (select (v like 'raised: %ต้องมีสิทธิ์ SAMO Passport ทุกฝ่าย%')::text from r where k = 'team_only_pp');
insert into probe select '21. …so the ปี SAMO did NOT move either (all or nothing)', '2697',
  (select year::text from public.team_terms where is_current);

set local role authenticated;
insert into r select 'team_only', pg_temp.try($q$select public.start_samo_year(2698)$q$);
reset role;
insert into probe select '22. team_edit alone, no Passport name: the year starts', 'ok',
  (select v from r where k = 'team_only');
insert into probe select '23. …2698 is now current', '2698',
  (select year::text from public.team_terms where is_current);
insert into probe select '24. …and Passport is untouched (the old year still the one open)', 'proof-0242-old',
  (select string_agg(name, ',') from passport.samo_years where ended_at is null);

-- ── §D team_edit + passport: both move ────────────────────────────────────
select pg_temp.as_((select id from p3), (select email from p3));
set local role authenticated;
insert into r select 'both', pg_temp.try($q$select public.start_samo_year(2699, 'proof-0242-new', 'Q1')$q$);
reset role;
insert into probe select '30. team_edit + passport: the call succeeds', 'ok',
  (select v from r where k = 'both');
insert into probe select '31. …2699 is now current', '2699',
  (select year::text from public.team_terms where is_current);
insert into probe select '32. …exactly ONE open Passport year, the new one, bridged to 2699', 'proof-0242-new:2699',
  (select string_agg(name || ':' || team_term_year, ',') from passport.samo_years where ended_at is null);
insert into probe select '33. …exactly ONE open season, Q1 of the new year', 'Q1',
  (select string_agg(s.name, ',') from passport.samo_seasons s
     join passport.samo_years y on y.id = s.samo_year_id
    where s.ended_at is null and y.name = 'proof-0242-new');
insert into probe select '34. …no open season belongs to any other year', '0',
  (select count(*)::text from passport.samo_seasons s
     join passport.samo_years y on y.id = s.samo_year_id
    where s.ended_at is null and y.name <> 'proof-0242-new');
insert into probe select '35. …the outgoing Passport year is ended and its blank bridge filled with 2698', '2698',
  (select team_term_year::text from passport.samo_years where name = 'proof-0242-old' and ended_at is not null);

-- ── §E already bridged; going back ────────────────────────────────────────
-- Re-open 2698 then come forward to 2699 again: Passport already has an open
-- year bridged to 2699, so no second one may be opened.
update public.team_terms set is_current = false where year = 2699;
update public.team_terms set is_current = true  where year = 2698;
set local role authenticated;
insert into r select 'again', pg_temp.try($q$select public.start_samo_year(2699, 'proof-0242-dup', 'Q1')$q$);
reset role;
insert into probe select '40. forward again onto an already-bridged year succeeds', 'ok',
  (select v from r where k = 'again');
insert into probe select '41. …and opened NO second Passport year', '0',
  (select count(*)::text from passport.samo_years where name = 'proof-0242-dup');
insert into probe select '42. …the bridged one is still the only open year', 'proof-0242-new',
  (select string_agg(name, ',') from passport.samo_years where ended_at is null);

set local role authenticated;
insert into r select 'back', pg_temp.try($q$select public.start_samo_year(2698, 'proof-0242-back', 'Q1')$q$);
reset role;
insert into probe select '43. going BACK a year with a Passport name is refused', 'true',
  (select (v like 'raised: %ย้อนปี SAMO ไม่เริ่มวาระสโมใหม่%')::text from r where k = 'back');
insert into probe select '44. …and changed nothing (2699 still current)', '2699',
  (select year::text from public.team_terms where is_current);

select step,
       case when got is not distinct from expected then 'PASS' else 'FAIL' end as result,
       expected, got
  from probe order by step;
rollback;
