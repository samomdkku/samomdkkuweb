-- ============================================================
-- stats0233-no-split-day.sql — prune_analytics() never splits a calendar day
-- across two runs (0233, fixing 0231's drifting-timestamp cutoff).
--
-- §A  a day whose events straddle an UN-aligned instant — 20 events just
--     before that instant, 4 just after, same calendar day — is captured
--     WHOLE on the first run that reaches it (not 20-then-4-overwriting-20).
-- §B  a day that is NOT yet old enough to be included at all stays OUT of
--     the rollup entirely (no early partial capture).
-- §C  running prune_analytics a second time with a slightly larger
--     retain_days (simulating a week passing) is a no-op for an
--     already-resolved day — the §E idempotency property 0231 already
--     proved still holds after 0233's change.
--
--   node tools/db-query.mjs tools/stats0233-no-split-day.sql --dev
-- ============================================================
begin;

create temporary table probe (step text, expected text, got text) on commit drop;

-- ── §A: a day that would have straddled an un-aligned cutoff ────────────
delete from public.analytics_events where path = 'stats0233-split-probe';
delete from public.analytics_daily_rollup
 where day = ((now() - interval '90 days')::date);

-- 20 events shortly BEFORE the un-aligned instant cutoff_1 = now()-90d would
-- have been; 4 shortly AFTER it, same calendar day. Under the pre-0233 bug
-- these diverge; under the fix both halves land in the SAME rollup row
-- together, the first time the WHOLE day clears retain_days=90.
insert into public.analytics_events (at, session_id, event, path, is_authed, app)
select (now() - interval '90 days') - interval '2 minutes' + (n || ' seconds')::interval,
       'sess-0233-old-' || n, 'pageview', 'stats0233-split-probe', false, 'public'
  from generate_series(1, 20) n;
insert into public.analytics_events (at, session_id, event, path, is_authed, app)
select (now() - interval '90 days') + interval '2 minutes' + (n || ' seconds')::interval,
       'sess-0233-new-' || n, 'pageview', 'stats0233-split-probe', false, 'public'
  from generate_series(1, 4) n;

insert into probe select '00. 24 synthetic events exist before any prune', '24',
  (select count(*)::text from public.analytics_events where path = 'stats0233-split-probe');

-- A day-aligned cutoff (date_trunc('day', now()-90d)) sits STRICTLY BEFORE
-- both halves (they're within +-2 minutes of the un-aligned now()-90d, which
-- is later in the day than its own midnight) — so retain_days=90 alone does
-- NOT yet pull this day in. This is what proves §B simultaneously: nothing
-- is captured early.
select public.prune_analytics(90);
insert into probe select '01. retain_days=90: day not yet old enough, no rollup row', '0',
  (select count(*)::text from public.analytics_daily_rollup
    where day = ((now() - interval '90 days')::date));
insert into probe select '02. retain_days=90: all 24 events still live (none captured early)', '24',
  (select count(*)::text from public.analytics_events where path = 'stats0233-split-probe');

-- Advance one full day (retain_days=89): date_trunc('day', now()-89d) is
-- now AFTER both halves' timestamps (they're within the now()-90d calendar
-- day, and now()-89d's midnight is the NEXT day) — the whole day clears at
-- once.
select public.prune_analytics(89);
insert into probe select '03. retain_days=89: the WHOLE day is rolled up at once (24, not 4 or 20)', '24',
  (select events::text from public.analytics_daily_rollup
    where day = ((now() - interval '90 days')::date));
insert into probe select '04. retain_days=89: visitors = 24 distinct sessions', '24',
  (select visitors::text from public.analytics_daily_rollup
    where day = ((now() - interval '90 days')::date));
insert into probe select '05. retain_days=89: all 24 raw rows now deleted', '0',
  (select count(*)::text from public.analytics_events where path = 'stats0233-split-probe');

-- ── §C: re-running is still a no-op for an already-resolved day ─────────
select public.prune_analytics(89);
insert into probe select '10. a second run at the same retain_days touches nothing new', '24',
  (select events::text from public.analytics_daily_rollup
    where day = ((now() - interval '90 days')::date));

select step,
       case when got is not distinct from expected then 'PASS' else 'FAIL' end as result,
       expected, got
  from probe order by step;

rollback;
