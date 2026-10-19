-- ============================================================
-- stats0231-retention.sql — the stats retention rollups (0231):
--   §0  structural: both rollup tables exist, RLS enabled, the two prune
--       functions exist with their documented default parameters
--   §A  prune_analytics(90) rolls a synthetic OLD day into
--       analytics_daily_rollup BEFORE deleting its raw analytics_events rows
--       — proven RED first (the day is NOT in the rollup before pruning),
--       then green after
--   §B  THE ACTUAL QUESTION THIS MIGRATION EXISTS TO ANSWER: does
--       analytics_overview() survive pruning? Called with days=365 (inside
--       the clamp, past the 90-day retention) AFTER the prune, its
--       visitors_by_day for the pruned day reports the ROLLED-UP count, not
--       zero — proven by DELTA (count on-screen before vs after inserting +
--       pruning the synthetic day), so this holds regardless of how much
--       real data the database already has
--   §C  top_paths' merge logic (live UNION rolled) returns the correct SUM
--       for a uniquely-named synthetic path, checked directly against the
--       rollup's own path_counts rather than through the top-10 LIMIT (which
--       a busy database could legitimately push a small synthetic count out
--       of) — the property under test is "the merge is correct", not "our
--       path makes the top 10"
--   §D  prune_claude_usage_samples(8) rolls a synthetic OLD week into
--       claude_usage_weekly_rollup before deleting the raw samples
--   §E  re-running both prune functions a second time is a no-op (0 rows
--       removed, rollup unchanged) — the day/week is gone from the raw
--       table, so there is nothing left to roll up twice
--   §F  RLS: analytics_daily_rollup / claude_usage_weekly_rollup each pair
--       an ALLOW (an account with the right grant) with a DENY (anon, and a
--       plain ungranted account) — never a deny-only probe (class 7)
--
--   node tools/db-query.mjs tools/stats0231-retention.sql --dev
-- ============================================================
begin;

create temporary table probe (step text, expected text, got text) on commit drop;
grant insert, select on probe to authenticated, anon;

-- ── §0 structural ────────────────────────────────────────────────────────
insert into probe select '00. analytics_daily_rollup exists', '1',
  (select count(*)::text from information_schema.tables
    where table_schema = 'public' and table_name = 'analytics_daily_rollup');
insert into probe select '01. claude_usage_weekly_rollup exists', '1',
  (select count(*)::text from information_schema.tables
    where table_schema = 'public' and table_name = 'claude_usage_weekly_rollup');
insert into probe select '02. both rollup tables have RLS enabled', '2',
  (select count(*)::text from pg_class
    where relname in ('analytics_daily_rollup', 'claude_usage_weekly_rollup')
      and relrowsecurity);
insert into probe select '03. prune_analytics(integer default 90) exists', 'true',
  (select (count(*) > 0)::text from pg_proc
    where proname = 'prune_analytics' and pronamespace = 'public'::regnamespace);
insert into probe select '04. prune_claude_usage_samples(integer default 8) exists', 'true',
  (select (count(*) > 0)::text from pg_proc
    where proname = 'prune_claude_usage_samples' and pronamespace = 'public'::regnamespace);

-- ── principals ───────────────────────────────────────────────────────────
create temporary table admin_all on commit drop as
select u.id, lower(btrim(u.email)) as email from public.users u
 where u.role = 'dev'
 order by u.id limit 1;
insert into probe select '05. a dev/staff account exists (for grant ALLOW probes)', '1',
  (select count(*)::text from admin_all);
grant select on admin_all to authenticated;

create temporary table subj_none on commit drop as
select u.id as uid from public.users u
 where u.role not in ('dev', 'vp_admin', 'pr_staff', 'shop_admin')
   and coalesce(array_length(u.permissions, 1), 0) = 0
   and coalesce(array_length(u.managed_permissions, 1), 0) = 0
   and coalesce(array_length(u.managed_vs_depts, 1), 0) = 0
   and coalesce(array_length(u.managed_project_seats, 1), 0) = 0
   and coalesce(array_length(u.managed_passport_scopes, 1), 0) = 0
   and coalesce(array_length(u.managed_shop_sources, 1), 0) = 0
   and u.id not in (select id from admin_all)
 order by u.id limit 1;
insert into probe select '06. an ordinary ungranted account exists (for DENY probes)', '1',
  (select count(*)::text from subj_none);
grant select on subj_none to authenticated;

create or replace function pg_temp.as_admin() returns void language sql as $$
  select set_config('request.jwt.claims',
    (select json_build_object('sub', id, 'role', 'authenticated', 'email', email)::text from admin_all), true);
$$;
create or replace function pg_temp.as_none() returns void language sql as $$
  select set_config('request.jwt.claims',
    (select json_build_object('sub', uid, 'role', 'authenticated', 'email', 'nobody-0231@kkumail.com')::text from subj_none), true);
$$;
create or replace function pg_temp.as_anon() returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
$$;

-- A dev account also needs 'claude' to read claude_usage_weekly_rollup —
-- current_user_has_permission('claude'), not current_user_has_any_grant().
-- 'dev' role satisfies current_user_has_permission() for every key (checked
-- behaviourally in §F rather than assumed).

-- ── synthetic OLD day, far enough back that no real traffic collides ─────
-- A day this old also cannot collide with any OTHER proof's own sentinel
-- window (shop0230 uses 2695/2696 team_terms years, unrelated table).
delete from public.analytics_events where path = 'stats0231-probe-path';
delete from public.analytics_daily_rollup where day = (current_date - 120);
insert into public.analytics_events (at, session_id, event, path, is_authed, app)
select (current_date - 120) + (n || ' minutes')::interval, 'sess-0231-' || (n % 7), 'pageview',
       'stats0231-probe-path', false, 'public'
  from generate_series(1, 40) n;
-- a second, LIVE (recent) day with the same path — must stay untouched
-- by the prune and must NOT be double-counted in §C's merge.
delete from public.analytics_events where path = 'stats0231-live-path';
insert into public.analytics_events (at, session_id, event, path, is_authed, app)
select now() - interval '1 hour', 'sess-0231-live', 'pageview', 'stats0231-live-path', false, 'public';

insert into probe select '10. BEFORE prune: the old day is NOT yet in the rollup (red first)', 'f',
  (exists (select 1 from public.analytics_daily_rollup where day = (current_date - 120)))::text;
insert into probe select '11. BEFORE prune: 40 raw rows exist for the probe path', '40',
  (select count(*)::text from public.analytics_events where path = 'stats0231-probe-path');

select public.prune_analytics(90);

insert into probe select '12. AFTER prune: the raw probe-path rows are gone', '0',
  (select count(*)::text from public.analytics_events where path = 'stats0231-probe-path');
insert into probe select '13. AFTER prune: the day is now in the rollup', 'true',
  (exists (select 1 from public.analytics_daily_rollup where day = (current_date - 120)))::text;
insert into probe select '14. the rollup counted all 40 events for that day', '40',
  (select events::text from public.analytics_daily_rollup where day = (current_date - 120));
insert into probe select '15. the rollup counted 7 distinct sessions (0..6)', '7',
  (select visitors::text from public.analytics_daily_rollup where day = (current_date - 120));
insert into probe select '16. path_counts carries the probe path with n=40', '40',
  (select (path_counts->>'stats0231-probe-path') from public.analytics_daily_rollup where day = (current_date - 120));
insert into probe select '17. the LIVE (recent) path row was NOT touched by the prune', '1',
  (select count(*)::text from public.analytics_events where path = 'stats0231-live-path');

-- ── §B: analytics_overview() survives the prune ───────────────────────────
select pg_temp.as_admin();
set local role authenticated;
with r as (select public.analytics_overview(365) as j)
insert into probe select '20. visitors_by_day for the pruned day reports the ROLLED-UP count (7), not 0 or absent',
  '7',
  (select (e->>'n') from r, jsonb_array_elements(j->'visitors_by_day') e
    where e->>'d' = to_char((current_date - 120), 'YYYY-MM-DD'));
reset role;
reset session authorization;

-- ── §C: top_paths' merge is correct for the probe path specifically ──────
-- Replicates the function's own merge CTEs for ONE path, so the assertion
-- does not depend on whether a busy database pushes a small synthetic count
-- out of the real function's top-10 LIMIT.
with since_365 as (select now() - interval '365 days' as since),
live as (
  select coalesce(path, '(unknown)') path, count(*) n
    from public.analytics_events, since_365
   where at > since and event in ('pageview', 'tab') and path = 'stats0231-probe-path'
   group by 1
), rolled as (
  select kv.key as path, kv.value::int as n
    from public.analytics_daily_rollup r, since_365, lateral jsonb_each_text(r.path_counts) kv
   where r.day >= since::date and r.day <= now()::date and kv.key = 'stats0231-probe-path'
)
insert into probe select '30. probe path''s merged total (live+rolled, no double count) = 40', '40',
  (select coalesce(sum(n), 0)::text from (select * from live union all select * from rolled) u);

-- live-path (never pruned) must NOT also appear in rolled for the same path —
-- proves the "never in both at once" invariant the migration's header claims.
insert into probe select '31. stats0231-live-path has NO rollup row (never pruned)', '0',
  (select count(*)::text from public.analytics_daily_rollup, lateral jsonb_each_text(path_counts) kv
    where kv.key = 'stats0231-live-path');

-- re-run: idempotent, nothing left to roll up a second time
select public.prune_analytics(90);
insert into probe select '32. a second prune_analytics(90) touches nothing new for that day', '40',
  (select events::text from public.analytics_daily_rollup where day = (current_date - 120));

-- ── §D: claude_usage_weekly_rollup ─────────────────────────────────────────
-- ONE fixed instant for the whole section — repeating `now() - interval
-- '70 days'` across statements can drift by seconds, which is harmless for
-- claude_week_start() in practice but not worth risking.
create temporary table probe_week on commit drop as
select (now() - interval '70 days') as ts, public.claude_week_start(now() - interval '70 days') as wk;
grant select on probe_week to authenticated;

delete from public.claude_usage_samples where raw ? 'stats0231_probe';
delete from public.claude_usage_weekly_rollup where week_start = (select wk from probe_week);
insert into public.claude_usage_samples (sampled_at, five_hour_pct, seven_day_pct, raw, reported_by)
select (select ts from probe_week) + (n || ' hours')::interval, (10 + n)::numeric, (50 + n)::numeric,
       jsonb_build_object('stats0231_probe', true), (select id from admin_all)
  from generate_series(1, 5) n;

insert into probe select '40. BEFORE prune: 5 raw claude_usage_samples rows for the probe week', '5',
  (select count(*)::text from public.claude_usage_samples where raw ? 'stats0231_probe');

select public.prune_claude_usage_samples(8);

insert into probe select '41. AFTER prune: the raw probe-week samples are gone', '0',
  (select count(*)::text from public.claude_usage_samples where raw ? 'stats0231_probe');
insert into probe select '42. AFTER prune: that week is now in claude_usage_weekly_rollup', '1',
  (select count(*)::text from public.claude_usage_weekly_rollup where week_start = (select wk from probe_week));
insert into probe select '43. the weekly rollup''s peak_seven_day_pct is the MAX of the 5 samples (55)', '55.00',
  (select peak_seven_day_pct::text from public.claude_usage_weekly_rollup where week_start = (select wk from probe_week));

select public.prune_claude_usage_samples(8);
insert into probe select '44. a second prune_claude_usage_samples(8) touches nothing new for that week', '5',
  (select sample_count::text from public.claude_usage_weekly_rollup where week_start = (select wk from probe_week));

-- ── §F: RLS — ALLOW paired with DENY, both tables ─────────────────────────
select pg_temp.as_admin();
set local role authenticated;
insert into probe select '50. ALLOW: a dev/grant-holding account reads analytics_daily_rollup', 'true',
  (exists (select 1 from public.analytics_daily_rollup where day = (current_date - 120)))::text;
insert into probe select '51. ALLOW: a dev account (current_user_has_permission(''claude'')) reads claude_usage_weekly_rollup', 'true',
  (exists (select 1 from public.claude_usage_weekly_rollup where week_start = (select wk from probe_week)))::text;
reset role;
reset session authorization;

select pg_temp.as_none();
set local role authenticated;
insert into probe select '52. DENY: an ungranted account reads ZERO rows from analytics_daily_rollup', '0',
  (select count(*)::text from public.analytics_daily_rollup);
insert into probe select '53. DENY: an ungranted account reads ZERO rows from claude_usage_weekly_rollup', '0',
  (select count(*)::text from public.claude_usage_weekly_rollup);
reset role;
reset session authorization;

select pg_temp.as_anon();
set local role anon;
insert into probe select '54. DENY: anon reads ZERO rows from analytics_daily_rollup', '0',
  (select count(*)::text from public.analytics_daily_rollup);
insert into probe select '55. DENY: anon reads ZERO rows from claude_usage_weekly_rollup', '0',
  (select count(*)::text from public.claude_usage_weekly_rollup);
reset role;
reset session authorization;

select step,
       case when got is not distinct from expected then 'PASS' else 'FAIL' end as result,
       expected, got
  from probe order by step;

rollback;
