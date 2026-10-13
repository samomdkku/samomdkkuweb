-- ============================================================
-- year0219-samo-year.sql — the SAMO-year core infra (0219):
--   §A  who may call start_team_term — ALLOW + DENY, and a denied call
--       changes NOTHING
--   §B  a handover closes the outgoing term and opens the incoming one in
--       ONE call — never zero current terms, never two
--   §C  current_samo_year() tracks the handover the instant it commits
--   §D  calling start_team_term on the year ALREADY current is refused, not
--       silently re-applied (edge case 5)
--   §E  samo_year_for_timestamp(): a timestamp exactly ON the new boundary
--       resolves to the NEW term; one microsecond earlier resolves to the OLD
--       one — even though the old term's own started_at was never recorded
--       (every real row in team_terms today has started_at = NULL)
--   §F  reopening a year after a mistaken rollover keeps its ORIGINAL
--       started_at — it does not reset to "now" (edge case 6)
--   §G  THE GENESIS ROW, CLOSED THEN REOPENED: the REAL current term (the
--       one that was is_current when 0219 first ran) has started_at = NULL
--       for a real reason — the column did not exist yet. §B's close must
--       turn that NULL into a PERMANENT '-infinity', not leave it NULL, or
--       reopening the SAME real term later (here) would coalesce it to
--       "now" and strand every timestamp that predates the reopen with no
--       resolvable term — found by reproducing it in a throwaway probe
--       before this fix existed, and worse than §F because §F's subject
--       (2691) was never NULL — it got a real started_at on its FIRST open.
--
-- Two sentinel years far outside anything real (2691/2692) stand in for a
-- handover so the REAL current term is only ever touched by the one assertion
-- that is supposed to touch it (§B/§D/§G), and even that is undone by the
-- rollback at the end.
--
-- Everything runs inside a transaction that ROLLS BACK.
--   node tools/db-query.mjs tools/year0219-samo-year.sql
-- ============================================================
begin;

create temporary table probe (step text, expected text, got text) on commit drop;

insert into probe select '00. team_terms has started_at AND ended_at', '2',
  (select count(*)::text from information_schema.columns
    where table_schema = 'public' and table_name = 'team_terms'
      and column_name in ('started_at', 'ended_at'));

insert into probe select '01. current_samo_year / samo_year_for_timestamp / start_team_term / samo_year_be_default all exist', '4',
  (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('current_samo_year', 'samo_year_for_timestamp', 'start_team_term', 'samo_year_be_default'));

-- ── principals ───────────────────────────────────────────────────────────────
create temporary table admin on commit drop as
select u.id, lower(btrim(u.email)) as email from public.users u
 where u.role in ('vp_admin','dev')
    or 'team' = any (coalesce(u.permissions,'{}') || coalesce(u.managed_permissions,'{}'))
    or 'master' = any (coalesce(u.permissions,'{}') || coalesce(u.managed_permissions,'{}'))
 order by u.id limit 1;
insert into probe select '02. an account holding the ทีม SAMO grant exists', '1',
  (select count(*)::text from admin);

create or replace function pg_temp.as_admin() returns void language sql as $$
  select set_config('request.jwt.claims',
    (select json_build_object('sub', id, 'role', 'authenticated', 'email', email)::text from admin), true);
$$;
-- A signed-in nobody: an id no users row has, so role and permissions are empty.
create or replace function pg_temp.as_stranger() returns void language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', gen_random_uuid(), 'role', 'authenticated',
                      'email', 'nobody-0219@kkumail.com')::text, true);
$$;
create or replace function pg_temp.try(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return 'ok';
exception when others then return 'raised: ' || sqlerrm; end $$;
grant execute on function pg_temp.try(text) to authenticated;

create temporary table r (k text, v text) on commit drop;
grant insert, select on r to authenticated;

-- ── subjects: sentinel years, nowhere near the real 2569/2570 ───────────────
delete from public.team_terms where year in (2691, 2692);

create temporary table orig_current on commit drop as
  select year, started_at, ended_at from public.team_terms where is_current;
grant select on orig_current to authenticated;
insert into probe select '03. exactly one real current term exists before the test', '1',
  (select count(*)::text from orig_current);

-- ── §A who may ──────────────────────────────────────────────────────────────
select pg_temp.as_stranger();
set local role authenticated;
insert into r select 'deny_start', pg_temp.try('select public.start_team_term(2691)');
reset role;
insert into probe select '10. a stranger may NOT start a term', 'true',
  (select (v like 'raised: start_team_term: ไม่มีสิทธิ์%')::text from r where k = 'deny_start');
insert into probe select '11. …and the real current term is UNTOUCHED', (select year::text from orig_current),
  (select year::text from public.team_terms where is_current);
insert into probe select '12. …and 2691 was never created', '0',
  (select count(*)::text from public.team_terms where year = 2691);

-- ── §B the admin hands over to 2691 ─────────────────────────────────────────
select pg_temp.as_admin();
set local role authenticated;
insert into r select 'start_2691', pg_temp.try('select public.start_team_term(2691)');
reset role;
insert into probe select '20. the admin starts year 2691', 'ok', (select v from r where k = 'start_2691');
insert into probe select '21. 2691 is now the current term', 'true',
  (select is_current::text from public.team_terms where year = 2691);
insert into probe select '22. the OUTGOING term is closed: is_current false, ended_at set', 'false|true',
  (select is_current::text || '|' || (ended_at is not null)::text
     from public.team_terms where year = (select year from orig_current));
insert into probe select '23. exactly ONE current term exists — never zero, never two', '1',
  (select count(*)::text from public.team_terms where is_current);

-- ── §C current_samo_year() sees it immediately ──────────────────────────────
insert into probe select '24. current_samo_year() now answers 2691', '2691',
  (select public.current_samo_year()::text);

-- ── §D a second call for the SAME year is refused, not silently reopened ───
select pg_temp.as_admin();
set local role authenticated;
insert into r select 'start_2691_again', pg_temp.try('select public.start_team_term(2691)');
reset role;
insert into probe select '25. starting the year ALREADY current is refused', 'true',
  (select (v like 'raised: start_team_term: % เป็นปีปัจจุบันอยู่แล้ว%')::text
     from r where k = 'start_2691_again');
insert into probe select '26. …and it is still the only current term', '1',
  (select count(*)::text from public.team_terms where is_current);

-- ── §E samo_year_for_timestamp(): the boundary, both sides ─────────────────
-- The OUTGOING term's started_at was never recorded (every real team_terms
-- row predates this migration) — the whole point of §E is that its history
-- still resolves correctly, one microsecond before the handover.
create temporary table boundary on commit drop as
  select started_at from public.team_terms where year = 2691;
grant select on boundary to authenticated;

insert into probe select '30. a timestamp exactly ON the new boundary resolves to the NEW term', '2691',
  (select public.samo_year_for_timestamp((select started_at from boundary))::text);
insert into probe select '31. one microsecond before it resolves to the OLD term (unrecorded started_at, closed)',
  (select year from orig_current)::text,
  (select public.samo_year_for_timestamp((select started_at - interval '1 microsecond' from boundary))::text);
insert into probe select '32. a timestamp from years before ANY of this (e.g. 2026-01-01) still resolves to the OLD term',
  (select year from orig_current)::text,
  (select public.samo_year_for_timestamp('2026-01-01T00:00:00Z'::timestamptz)::text);

-- ── §F a rollover undone and redone keeps the ORIGINAL started_at ──────────
select pg_temp.as_admin();
set local role authenticated;
insert into r select 'start_2692', pg_temp.try('select public.start_team_term(2692)');
reset role;
insert into probe select '40. a second handover to 2692 succeeds', 'ok', (select v from r where k = 'start_2692');

create temporary table recorded_2691 on commit drop as
  select started_at from public.team_terms where year = 2691;
grant select on recorded_2691 to authenticated;
insert into probe select '41. 2691 is closed now (reopening it next is the real test)', 'false',
  (select is_current::text from public.team_terms where year = 2691);

select pg_temp.as_admin();
set local role authenticated;
insert into r select 'reopen_2691', pg_temp.try('select public.start_team_term(2691)');
reset role;
insert into probe select '42. reopening 2691 (an undone rollover) succeeds', 'ok', (select v from r where k = 'reopen_2691');
insert into probe select '43. 2691 is current again, ended_at cleared', 'true|',
  (select is_current::text || '|' || coalesce(ended_at::text, '') from public.team_terms where year = 2691);
insert into probe select '44. …and its started_at did NOT move — a mistake stays visible in history, not erased',
  (select started_at::text from recorded_2691),
  (select started_at::text from public.team_terms where year = 2691);

-- ── §G the GENESIS row (the REAL current term), closed in §B, reopened here ─
-- orig_current is the term that was really is_current before this test ever
-- ran — started_at = NULL for a real reason (0219 added the column under
-- it). §B's close must have already turned that NULL permanent as
-- '-infinity'; this reopens it and checks that value SURVIVES, exactly the
-- scenario a "we switched VPs and regretted it" rollback hits for real.
insert into probe select '45. after §B closed it, the genesis term''s started_at is permanently -infinity (not NULL)', '-infinity',
  (select started_at::text from public.team_terms where year = (select year from orig_current));

select pg_temp.as_admin();
set local role authenticated;
insert into r select 'reopen_genesis', pg_temp.try(
  format('select public.start_team_term(%s)', (select year from orig_current)));
reset role;
insert into probe select '46. reopening the genesis term succeeds', 'ok', (select v from r where k = 'reopen_genesis');
insert into probe select '47. …its started_at STILL did not move to "now" — the fix holds across a second close/reopen', '-infinity',
  (select started_at::text from public.team_terms where year = (select year from orig_current));
insert into probe select '48. …so a timestamp from long before this test still resolves to it, not NULL',
  (select year::text from orig_current),
  (select public.samo_year_for_timestamp('2020-01-01T00:00:00Z'::timestamptz)::text);

-- ── cleanup check: nothing above should have been reachable by a bad year ──
insert into r select 'bad_year', pg_temp.try('select public.start_team_term(9999)');
insert into probe select '50. an out-of-range year is refused', 'true',
  (select (v like 'raised: start_team_term: bad year%')::text from r where k = 'bad_year');

select step,
       case when got is not distinct from expected then 'PASS' else 'FAIL' end as result,
       expected, got
  from probe order by step;

rollback;
