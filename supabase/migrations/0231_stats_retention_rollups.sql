-- ============================================================
-- 0231 — Stats retention: two rollup tables so pruning raw rows does not
--        erase what the dashboards report.
--
-- ASKED (night queue, task 10, docs/YEAR-ROLLOVER.md § Stats): schedule the
-- two existing-but-unscheduled retention jobs (prune_analytics, 0065;
-- prune_notify_log, 0055), add the analogous job for claude_usage_samples,
-- and make sure the thing that reads the pruned table SURVIVES pruning —
-- "does analytics_overview() survive pruning? prove it" (tools/stats0231-
-- retention.sql).
--
-- THE GAP THIS CLOSES. `analytics_overview(days)` clamps `days` to [1, 365]
-- (0173), but `prune_analytics()`'s own default retention is 90 days. Ask the
-- dashboard for 180 days and, once a week-90 prune has run, `visitors_by_day`
-- and `top_paths` would silently go quiet for the older half of the range —
-- no error, just a chart that looks like traffic stopped. A SENTINEL-shaped
-- bug (class 7): the function does not fail, it answers confidently wrong.
--
-- THE FIX. `analytics_daily_rollup` holds one row per calendar day: a
-- pre-aggregated visitor count and a `path_counts` jsonb map, written by
-- `prune_analytics()` for every day it is about to delete, NEVER for a day
-- still live. Because a day is rolled up in the SAME transaction it is
-- deleted, a day is never in both places at once — so the read side can
-- simply prefer the rollup when one exists, and fall back to the raw table
-- otherwise, with no double-counting window to reason about.
--
-- `claude_usage_samples` gets the same shape at week granularity
-- (`claude_usage_weekly_rollup`, keyed by `claude_week_start()` — the SAME
-- week-boundary function the booking guard uses, not a re-derived one) since
-- the design calls for keeping only 8 weeks of raw samples; the live
-- rail/guard functions only ever look at the CURRENT week, so nothing
-- downstream of them changes.
--
-- pg_cron is NOT installed on this project (confirmed, STATE.md 2026-10-18
-- preamble) and enabling it is a one-click dashboard action only the project
-- owner can take (Database → Extensions) — this agent has no production
-- credential to do it even if it wanted to. DECISION: ship a VM systemd timer
-- instead (`server/stats-retention.*`), the same pattern this repo already
-- uses for the whole-DB backup job (`server/supabase-backup.*`, also written
-- and never installed) — one scheduling mechanism for every "needs to run
-- weekly" job on this stack, rather than two (a VM timer AND a Postgres
-- extension the owner would have to separately enable and trust). Rejected
-- alternative: ask the owner to enable pg_cron — rejected only as the
-- DEFAULT, not forbidden; the VM timer needs no dashboard change and no new
-- trust boundary (it already holds SUPABASE_DB_URL for the backup job), so it
-- is the lower-friction install. If the owner later enables pg_cron anyway,
-- `select cron.schedule(...)` calling the exact same three functions is a
-- one-line swap — nothing here is pg_cron-shaped in a way that would need
-- rewriting.
-- ============================================================

-- ------------------------------------------------------------
-- 1. analytics_daily_rollup — what prune_analytics() keeps before it deletes.
-- ------------------------------------------------------------
create table if not exists public.analytics_daily_rollup (
  day          date primary key,
  visitors     integer not null default 0,   -- distinct session_id that day
  events       integer not null default 0,   -- total analytics_events rows that day
  path_counts  jsonb   not null default '{}'::jsonb,  -- {path: count} for event in ('pageview','tab')
  rolled_up_at timestamptz not null default now()
);

comment on table public.analytics_daily_rollup is
  'Per-day aggregate of analytics_events, written by prune_analytics() for every day it is about to delete. A day lives in exactly one of {analytics_events, analytics_daily_rollup} at a time — see migration 0231.';

alter table public.analytics_daily_rollup enable row level security;
revoke all on public.analytics_daily_rollup from anon, authenticated;

-- Same audience as analytics_overview() itself (0093's current_user_has_any_grant).
drop policy if exists analytics_daily_rollup_read on public.analytics_daily_rollup;
create policy analytics_daily_rollup_read on public.analytics_daily_rollup
  for select to authenticated
  using (public.current_user_has_any_grant());

grant select on public.analytics_daily_rollup to authenticated;
-- No insert/update/delete grant to any client role: only prune_analytics()
-- (SECURITY DEFINER, called by the VM timer / SQL editor) ever writes this.

-- ------------------------------------------------------------
-- 2. claude_usage_weekly_rollup — what prune_claude_usage_samples() keeps.
-- ------------------------------------------------------------
create table if not exists public.claude_usage_weekly_rollup (
  week_start        timestamptz primary key,  -- public.claude_week_start()'s own grain
  sample_count      integer       not null default 0,
  peak_five_hour_pct  numeric(5,2),
  peak_seven_day_pct  numeric(5,2),
  rolled_up_at      timestamptz   not null default now()
);

comment on table public.claude_usage_weekly_rollup is
  'One row per claude_week_start() week, written by prune_claude_usage_samples() for every week it is about to delete raw samples from. The live rail/guard (claude_window_loads etc.) only ever read the CURRENT week, so this table is read by nothing yet — it exists so a future usage-trend chart does not need raw samples kept forever. See migration 0231.';

alter table public.claude_usage_weekly_rollup enable row level security;
revoke all on public.claude_usage_weekly_rollup from anon, authenticated;

drop policy if exists claude_usage_weekly_rollup_read on public.claude_usage_weekly_rollup;
create policy claude_usage_weekly_rollup_read on public.claude_usage_weekly_rollup
  for select to authenticated
  using (public.current_user_has_permission('claude'));

grant select on public.claude_usage_weekly_rollup to authenticated;

-- ------------------------------------------------------------
-- 3. prune_analytics(retain_days) — now rolls up before it deletes.
--    Same name/signature as 0065's version (CREATE OR REPLACE), so every
--    existing caller (none scheduled yet, but the function identity matters
--    for the VM timer below) keeps working unchanged.
-- ------------------------------------------------------------
create or replace function public.prune_analytics(retain_days integer default 90)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  removed  integer;
  cutoff   timestamptz := now() - make_interval(days => greatest(retain_days, 1));
begin
  -- Roll up every day about to be deleted, in the SAME transaction as the
  -- delete — this is what makes "a day is in exactly one of the two tables"
  -- true without a separate reconciliation step.
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
  'Roll every day older than retain_days into analytics_daily_rollup, THEN delete those analytics_events rows (default 90). SQL editor / VM timer only. See migration 0231 (rollup) and 0065 (original).';

-- ------------------------------------------------------------
-- 4. prune_claude_usage_samples(weeks) — new. Keeps `weeks` weeks (default
--    8 — two quota cycles) of raw samples; anything older is rolled up by
--    claude_week_start() and deleted. The rail/guard never look past the
--    current week, so nothing downstream changes.
-- ------------------------------------------------------------
create or replace function public.prune_claude_usage_samples(weeks integer default 8)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  removed integer;
  cutoff  timestamptz := public.claude_week_start(now()) - make_interval(weeks => greatest(weeks, 1));
begin
  insert into public.claude_usage_weekly_rollup
    (week_start, sample_count, peak_five_hour_pct, peak_seven_day_pct, rolled_up_at)
  select
    public.claude_week_start(sampled_at),
    count(*),
    max(five_hour_pct),
    max(seven_day_pct),
    now()
  from public.claude_usage_samples
  where sampled_at < cutoff
  group by public.claude_week_start(sampled_at)
  on conflict (week_start) do update set
    sample_count       = excluded.sample_count,
    peak_five_hour_pct  = excluded.peak_five_hour_pct,
    peak_seven_day_pct  = excluded.peak_seven_day_pct,
    rolled_up_at        = now();

  delete from public.claude_usage_samples
   where sampled_at < cutoff;
  get diagnostics removed = row_count;
  return removed;
end;
$$;

revoke all on function public.prune_claude_usage_samples(integer) from public, anon, authenticated;

comment on function public.prune_claude_usage_samples(integer) is
  'Roll weeks older than `weeks` (default 8) into claude_usage_weekly_rollup, THEN delete those raw samples. The live rail/guard only read the CURRENT week. SQL editor / VM timer only. See migration 0231.';

-- ------------------------------------------------------------
-- 5. analytics_overview(days) — visitors_by_day and top_paths now prefer the
--    rollup for any day that has one (a pruned day), and fall back to the
--    raw table otherwise (a live day). Every other field reads tables that
--    are never pruned (users, pr_tickets, vs_tickets, projects, shop_orders)
--    and needs no change.
-- ------------------------------------------------------------
create or replace function public.analytics_overview(days integer default 30)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  d integer := greatest(least(coalesce(days, 30), 365), 1);
  since timestamptz := now() - make_interval(days => d);
  result jsonb;
begin
  if public.current_user_has_any_grant() is not true then
    raise exception 'analytics_overview: requires an admin grant';
  end if;

  select jsonb_build_object(
    'range_days', d,
    'generated_at', now(),

    'totals', jsonb_build_object(
      'users',        (select count(*) from public.users),
      'pr',           (select count(*) from public.pr_tickets where deleted_at is null),
      'pr_completed', (select count(*) from public.pr_tickets where deleted_at is null and status like '%เสร็จสิ้น%'),
      'vs',           (select count(*) from public.vs_tickets where deleted_at is null),
      'vs_completed', (select count(*) from public.vs_tickets where deleted_at is null and status like '%เสร็จสิ้น%'),
      'requests',     (select count(*) from public.pr_tickets where deleted_at is null)
                      + (select count(*) from public.vs_tickets where deleted_at is null),
      'projects',        (select count(*) from public.projects),
      'documents',       (select count(*) from public.project_documents),
      'doc_completed',   (select count(*) from public.project_documents where status = 'completed'),
      'doc_signed',      (select count(*) from public.project_sign_requests where status = 'accepted'),
      'doc_transactions',(select coalesce(sum(jsonb_array_length(timeline)), 0)
                            from public.project_documents where jsonb_typeof(timeline) = 'array'),
      'doc_interactions',(select count(*) from public.project_notifications where kind = 'comment')
                         + (select count(*) from public.project_doc_views),
      'orders',       (select count(*) from public.shop_orders),
      'events',       (select count(*) from public.analytics_events)
                     + (select coalesce(sum(events), 0) from public.analytics_daily_rollup)
    ),

    'active', jsonb_build_object(
      'sessions_dau', (select count(distinct session_id) from public.analytics_events where at > now() - interval '1 day'),
      'sessions_wau', (select count(distinct session_id) from public.analytics_events where at > now() - interval '7 days'),
      'sessions_mau', (select count(distinct session_id) from public.analytics_events where at > now() - interval '30 days'),
      'users_dau',    (select count(distinct user_id) from public.analytics_events where user_id is not null and at > now() - interval '1 day'),
      'users_wau',    (select count(distinct user_id) from public.analytics_events where user_id is not null and at > now() - interval '7 days'),
      'users_mau',    (select count(distinct user_id) from public.analytics_events where user_id is not null and at > now() - interval '30 days')
    ),

    'signups_by_day', (
      select coalesce(jsonb_agg(jsonb_build_object('d', to_char(day, 'YYYY-MM-DD'), 'n', coalesce(c.n, 0)) order by day), '[]'::jsonb)
      from generate_series((since)::date, (now())::date, interval '1 day') as day
      left join (
        select created_at::date as d, count(*) n from public.users where created_at > since group by 1
      ) c on c.d = day::date
    ),

    'requests_by_day', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'd', to_char(day, 'YYYY-MM-DD'),
               'pr', coalesce(c.pr, 0), 'vs', coalesce(c.vs, 0),
               'n', coalesce(c.pr, 0) + coalesce(c.vs, 0)) order by day), '[]'::jsonb)
      from generate_series((since)::date, (now())::date, interval '1 day') as day
      left join (
        select dt::date as d,
               count(*) filter (where src = 'pr') pr,
               count(*) filter (where src = 'vs') vs
        from (
          select created_at dt, 'pr' src from public.pr_tickets where created_at > since and deleted_at is null
          union all
          select created_at dt, 'vs' src from public.vs_tickets where created_at > since and deleted_at is null
        ) u group by 1
      ) c on c.d = day::date
    ),

    -- ── visitors_by_day — rollup-aware (0231). A day that has been rolled up
    -- (and its raw rows deleted) reports from analytics_daily_rollup; a day
    -- that has not yet been pruned reports from the live table. The two
    -- never overlap (see prune_analytics's own header), so COALESCE is exact,
    -- not an approximation.
    'visitors_by_day', (
      -- `day` (the generate_series alias) and `analytics_daily_rollup.day`
      -- are BOTH literally named "day", so a bare `day` reference below
      -- would be ambiguous the moment the rollup join was added — qualify
      -- every reference as `day.day`.
      select coalesce(jsonb_agg(jsonb_build_object(
               'd', to_char(day.day, 'YYYY-MM-DD'),
               'n', coalesce(r.visitors, c.n, 0)) order by day.day), '[]'::jsonb)
      from generate_series((since)::date, (now())::date, interval '1 day') as day
      left join public.analytics_daily_rollup r on r.day = day.day
      left join (
        select at::date as d, count(distinct session_id) n from public.analytics_events where at > since group by 1
      ) c on c.d = day.day
    ),

    'top_paths', (
      with live as (
        select coalesce(path, '(unknown)') path, count(*) n
        from public.analytics_events
        where at > since and event in ('pageview', 'tab')
        group by 1
      ), rolled as (
        select kv.key as path, kv.value::int as n
        from public.analytics_daily_rollup r
        cross join lateral jsonb_each_text(r.path_counts) as kv
        where r.day >= since::date and r.day <= now()::date
      ), merged as (
        select path, sum(n) n from (select * from live union all select * from rolled) u group by 1
      )
      select coalesce(jsonb_agg(jsonb_build_object('path', path, 'n', n) order by n desc), '[]'::jsonb)
      from (select * from merged order by n desc limit 10) t
    ),

    'roles', (
      select coalesce(jsonb_agg(jsonb_build_object('role', coalesce(role, 'user'), 'n', n) order by n desc), '[]'::jsonb)
      from (select role, count(*) n from public.users group by 1) r
    ),

    'gas', (
      with calls as (
        select created_at as t, 'อัปโหลด PR' as src
          from public.pr_tickets
         where file_url like 'https://drive.google.com/file/d/%'
        union all
        select uploaded_at, 'ไฟล์หนังสือโครงการ' from public.project_files
        union all
        select slip_uploaded_at, 'สลิปร้านค้า'
          from public.shop_orders where slip_uploaded_at is not null
        union all
        select created_at, 'SAMO Passport'
          from passport.activities where badge_url is not null
        union all
        select created_at, 'SAMO Passport'
          from passport.certificates where background_url is not null
      ),
      paced as (
        select t, src, extract(epoch from (t - lag(t) over (order by t))) as gap
          from calls
      ),
      human as (select t, src from paced where gap is null or gap >= 1),
      inrange as (select * from human where t > since),
      peaks as (
        select
          (select coalesce(max(c),0) from (select count(*) c from inrange group by t::date) a) as per_day,
          (select coalesce(max(c),0) from (select count(*) c from inrange group by date_trunc('hour',t)) b) as per_hour,
          (select coalesce(max(c),0) from (select count(*) c from inrange group by date_trunc('minute',t)) c1) as per_minute,
          (select coalesce(max(c),0) from (select count(*) c from human group by date_trunc('minute',t)) d) as per_minute_ever,
          (select to_char(date_trunc('minute',t),'YYYY-MM-DD HH24:MI') from human
            group by date_trunc('minute',t) order by count(*) desc, 1 desc limit 1) as busiest_minute_at
      )
      select jsonb_build_object(
        'simultaneous_limit', 30,
        'is_floor',           true,
        'total',              (select count(*) from inrange),
        'excluded_bulk',      (select count(*) from paced where gap < 1),
        'peak_per_day',       (select per_day from peaks),
        'peak_per_hour',      (select per_hour from peaks),
        'peak_per_minute',    (select per_minute from peaks),
        'peak_per_minute_ever', (select per_minute_ever from peaks),
        'busiest_minute_at',  (select busiest_minute_at from peaks),
        'by_source', (select coalesce(jsonb_agg(jsonb_build_object('label', src, 'n', n) order by n desc), '[]'::jsonb)
                      from (select src, count(*) n from inrange group by 1) s),
        'by_day', (select coalesce(jsonb_agg(jsonb_build_object(
                     'd', to_char(day,'YYYY-MM-DD'), 'n', coalesce(c.n,0)) order by day), '[]'::jsonb)
                   from generate_series((since)::date,(now())::date, interval '1 day') as day
                   left join (select t::date dd, count(*) n from inrange group by 1) c on c.dd = day::date)
      )
    ),

    'email', (
      with holders as (
        select id from public.users
         where role = 'uni_staff'
            or 'staff' = any (coalesce(managed_project_seats, '{}'))
      ),
      hn as (select greatest(count(*), 1)::numeric as c from holders),
      s as (select project_settings.* from public.project_settings limit 1),
      by_day as (
        select day::date as sent_on,
               ceil(count(p.id) / (select c from hn))::int as n
          from generate_series((since)::date, (now())::date, interval '1 day') as day
          left join public.project_notifications p
                 on p.created_at::date = day::date
                and p.user_id in (select id from holders)
         group by 1
      ),
      sends as (
        select p.created_at
          from public.project_notifications p
         where p.user_id in (select id from holders)
           and p.created_at > since
      ),
      burst as (
        select
          (select coalesce(max(c), 0) from (
             select ceil(count(*) / (select c from hn))::int c
               from sends group by date_trunc('minute', created_at)) a) as per_minute,
          (select coalesce(max(c), 0) from (
             select ceil(count(*) / (select c from hn))::int c
               from sends group by date_trunc('hour', created_at)) b) as per_hour,
          (select round(min(gap)::numeric, 1) from (
             select extract(epoch from created_at
                    - lag(created_at) over (order by created_at)) as gap
               from sends) g where gap is not null and gap > 0) as min_gap_seconds
      )
      select jsonb_build_object(
        'quota_per_day',   100,
        'staff_holders',   (select count(*) from holders),
        'recipients',      (select coalesce(array_length(array_remove(string_to_array(
                              regexp_replace(coalesce(uni_staff_email, ''), '[;[:space:]]+', ',', 'g'),
                              ','), ''), 1), 0) from s),
        'enabled',         (select coalesce(notify_uni_email, true) from s),
        'in_app_enabled',  (select coalesce(notify_uni_in_app, true) from s),
        'simultaneous_limit',  30,
        'recipients_per_message_limit', 50,
        'peak_per_minute', (select per_minute from burst),
        'peak_per_hour',   (select per_hour from burst),
        'min_gap_seconds', (select min_gap_seconds from burst),
        'sent_total',      (select coalesce(sum(n), 0) from by_day),
        'peak_day',        (select coalesce(max(n), 0) from by_day),
        'sent_by_day',     (select coalesce(jsonb_agg(jsonb_build_object(
                              'd', to_char(sent_on, 'YYYY-MM-DD'), 'n', n) order by sent_on), '[]'::jsonb)
                            from by_day)
      )
    )
  ) into result;

  return result;
end;
$function$;

comment on function public.analytics_overview(integer) is
  'Admin สถิติ payload. visitors_by_day and top_paths are ROLLUP-AWARE (0231): a day prune_analytics() has already rolled up and deleted reports from analytics_daily_rollup, a still-live day reports from analytics_events, and the two never overlap. Everything else unchanged from 0173.';

-- ------------------------------------------------------------
-- 6. project_notifications / notify_log — confirmed, not built. Per the
-- design doc: project_notifications is per-user unread/read state read by a
-- live bell icon; pruning it by AGE ALONE risks deleting an unread
-- notification nobody has opened yet. No migration here — if it is ever
-- pruned, the predicate must be age AND read, never age alone. notify_log's
-- own prune_notify_log(retain_days default 30) (0055) needed no rollup: its
-- reader is a human audit view (`ส่งอีเมลสำเร็จ/ล้มเหลว` debugging), not a
-- chart with a date range — scheduling it (below) is the only action owed.
-- ------------------------------------------------------------
