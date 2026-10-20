-- ============================================================
-- 0233 — prune_analytics() must never roll up a PARTIAL day.
--
-- FOUND (revision pass, night queue 2026-10-18, re-reading 0231 as a hostile
-- reviewer rather than trusting its own proof's PASS count). 0231's cutoff is
-- a raw timestamp: `now() - make_interval(days => retain_days)`. The VM timer
-- (server/stats-retention.timer) runs this WEEKLY with a FIXED retain_days
-- (default 90), so `now()` advances ~7 days between runs and `cutoff` drifts
-- with it — it is essentially never exactly midnight. Whichever calendar day
-- CONTAINS `cutoff` at run time gets split: rows before `cutoff` on that day
-- are rolled up and deleted THIS run; rows at/after `cutoff` stay live.
--
-- The next run, one week later, recomputes that same day's rollup FROM
-- SCRATCH — `insert ... on conflict (day) do update set visitors = excluded.…`
-- OVERWRITES the existing row rather than adding to it. By then the earlier
-- (already-deleted) portion no longer exists anywhere to re-aggregate, so the
-- overwrite silently replaces a correct partial count with a DIFFERENT,
-- equally partial one — the first portion's events are gone from
-- analytics_events (deleted) and were never folded into the rollup that
-- survives. This is permanent, silent data loss: analytics_overview()'s
-- visitors_by_day/top_paths will under-report whichever day straddled a
-- cutoff, forever, with no error and no way to tell from the output alone
-- (class 7 — "a sentinel is not a value"; here the sentinel is `cutoff`
-- itself drifting across a day it should never have split).
--
-- Reproduced live on samo-dev before this fix (24 synthetic events on one
-- day, 20 before a simulated cutoff_1 and 4 after; a second prune call with a
-- cutoff one day later overwrote the day's rollup from 20 down to 4 — 20
-- events permanently lost). Not committed as a proof in that form; see
-- tools/stats0233-no-split-day.sql below for the kept version.
--
-- WHY `prune_claude_usage_samples()` (0231, the SAME migration) does NOT have
-- this bug: its cutoff is `claude_week_start(now()) - weeks * interval`, and
-- `claude_week_start()` always returns a week-ALIGNED instant, so the cutoff
-- is always a clean week boundary and a week's samples can never straddle it.
-- `prune_analytics()` just never applied the same day-alignment to its own
-- cutoff — the asymmetry is the bug, not a different mechanism.
--
-- FIX. Truncate `cutoff` to the start of its own calendar day
-- (`date_trunc('day', …)`) BEFORE using it in either the rollup or the
-- delete. A day is now included only once it is ENTIRELY before cutoff's
-- day — never partially — so it is captured exactly once, in one run, with
-- its true full-day count. The visible cost: retention is "at least
-- retain_days", up to ~23h59m longer, which is a round-to-nearest-day
-- behaviour (cheaper to explain than a line of missing data) and nobody
-- reads retain_days expecting sub-day precision.
--
-- `on conflict (day) do update` is left as-is (and still needed — a manual
-- re-run of the same already-fully-resolved day must stay a no-op, proven by
-- 0231's own §E); it is safe now only because no day it ever fires for is a
-- partial one.
-- ============================================================

create or replace function public.prune_analytics(retain_days integer default 90)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  removed  integer;
  cutoff   timestamptz := date_trunc('day', now() - make_interval(days => greatest(retain_days, 1)));
begin
  -- Roll up every day about to be deleted, in the SAME transaction as the
  -- delete — this is what makes "a day is in exactly one of the two tables"
  -- true without a separate reconciliation step. `cutoff` is now ALWAYS a
  -- day boundary (0233), so `at < cutoff` can never split a calendar day
  -- across two runs.
  insert into public.analytics_daily_rollup (day, visitors, events, path_counts, rolled_up_at)
  select
    base.day, base.visitors, base.events, coalesce(pcs.path_counts, '{}'::jsonb), now()
  from (
    select at::date as day, count(distinct session_id) as visitors, count(*) as events
      from public.analytics_events
     where at < cutoff
     group by at::date
  ) base
  left join (
    select day, jsonb_object_agg(path, n) as path_counts
    from (
      select at::date as day, coalesce(path, '(unknown)') as path, count(*) as n
        from public.analytics_events
       where at < cutoff and event in ('pageview', 'tab')
       group by 1, 2
    ) pc
    group by day
  ) pcs on pcs.day = base.day
  on conflict (day) do update set
    visitors     = excluded.visitors,
    events       = excluded.events,
    path_counts  = excluded.path_counts,
    rolled_up_at = now();

  delete from public.analytics_events
   where at < cutoff;
  get diagnostics removed = row_count;
  return removed;
end;
$$;

revoke all on function public.prune_analytics(integer) from public, anon, authenticated;

comment on function public.prune_analytics(integer) is
  'Roll every day older than retain_days into analytics_daily_rollup, THEN delete those analytics_events rows (default 90). cutoff is day-aligned (0233) so a calendar day is never split across two runs. SQL editor / VM timer only. See migration 0231 (rollup), 0065 (original), 0233 (day-alignment fix).';
