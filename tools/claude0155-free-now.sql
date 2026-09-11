-- ============================================================
-- claude0155-free-now.sql — does claude_free_now() answer "how much may I use
-- right now, and until when" the way the owner stated it?
--
-- The owner gave three worked examples and they are the whole specification, so
-- they are the test. A1–A3 are those three, verbatim; A4 and A5 hold down the
-- two branches the examples do not reach.
--
--   A1  week 660% left · booking 16:00–19:00 for 70% · now 11:00  → 100%
--   A2  the same, at 12:00                                        →  30%
--   A3  week 100% left · the same booking · now 11:00             →  30%
--
-- BOTH DIRECTIONS, as everything here must be. A probe that can only report a
-- number cannot tell a working rule from a stuck one, so every case names WHICH
-- of the two constraints bound it (`bound_by`) and WHEN it stops being true
-- (`until`) — three answers per case, not one. A5 is the unconstrained control:
-- no bookings, full week, and the answer must be a whole session. If A5 ever
-- prints the same number as A2, the function has stopped reading its inputs.
--
-- WHAT MAKES THIS DIFFERENT FROM READING THE SQL: the 5-hour window is taken
-- from the MEASUREMENT when one is open (A4), not from the clock. That branch
-- is invisible in a scenario where no window happens to be open, which is every
-- scenario the owner described.
--
-- The scenario sits in a FUTURE quota week, clear of live bookings, exactly as
-- claude0154-quota-guard.sql does — the alternative is deleting real rows and
-- trusting a rollback.
--
--   node tools/db-query.mjs tools/claude0155-free-now.sql
-- ============================================================

begin;

create temp table probe (step text, expected text, got text) on commit drop;

-- Subject resolved from the data, never hardcoded: a proof naming a person rots
-- the moment the org chart moves.
create temp table subj on commit drop as
  select id as uid from public.users order by created_at limit 1;

-- ⚠️ THE SCENARIO IS ANCHORED TO now(), NOT TO A DATE SOMEBODY TYPED.
-- This was `timestamptz '2026-09-05 00:00+07'` with three comments around it
-- asserting properties of that date: that it was "clear of anything real", that
-- its samples were "months after every real row", and that the whole scenario
-- was "entirely in the future". All three were true the day they were written
-- and the calendar walked past every one of them, taking seven cases red at
-- once with NOTHING broken. A date is not a property; derive the property.
--
-- A quota week opens Wed 16:00 ICT, so week_start + 2d8h is the Saturday inside
-- it, exactly as the original hardcoded instant was. Four weeks out keeps the
-- whole scenario later than every real usage sample (so the probe's own sample
-- is the one claude_free_now() reads) and later than now (so a still-to-run
-- block really is still to run) — both for as long as this file exists, rather
-- than until a particular Tuesday.
create temp table t on commit drop as
  select public.claude_week_start(now() + interval '28 days')
         + interval '2 days 8 hours' as d0;

-- ⚠️ THE SCENARIO NEEDS AN ABSENCE, SO IT CONSTRUCTS ONE AND THEN ASSERTS IT.
-- Every expectation below is stated in absolute percent — "reserved counts the
-- block that has not run yet: 70" — which is only true if the ONE booking this
-- proof writes is the only booking in the week. That held while the table was
-- empty and stopped holding on 2026-09-07, when the first real booking ever
-- made landed in exactly this week, also for 70%: C2 then read 140 and five
-- cases went red together with nothing broken. A claim of "clear of anything
-- real" in a COMMENT is the tell, and the construction can assert it
-- (.claude/rules/mistakes.md class 7).
--
-- Scoped to the probe week, inside the `begin … rollback` this file ends with —
-- the same pattern free_at() already uses on claude_usage_samples below.
delete from public.claude_bookings
 where starts_at >= public.claude_week_start((select d0 from t))
   and starts_at <  public.claude_week_start((select d0 from t)) + interval '7 days';

insert into probe select
  'A0. control — the probe week holds NOTHING but this proof''s own booking', '0',
  (select coalesce(sum(pct), 0)::text from public.claude_bookings
    where starts_at >= public.claude_week_start((select d0 from t))
      and starts_at <  public.claude_week_start((select d0 from t)) + interval '7 days');

-- ── the instrument ─────────────────────────────────────────────────────────
-- One sample decides both the open-window branch and the weekly remainder, so
-- the probe writes the sample it needs, asks, and takes it away again. Its
-- sampled_at is the probe instant, which is months after every real row, so it
-- is the row claude_free_now() reads.
--
-- p_week_left is stated in SESSION percent — the unit the whole feature uses —
-- and converted here to the weekly 0–100 utilization the samples table stores.
-- That conversion is the one this function has to get right, so spelling it out
-- backwards in the test is deliberate.
create function pg_temp.free_at(
  p_at         timestamptz,
  p_week_left  numeric,
  p_fh_pct     numeric      default 0,
  p_fh_reset   timestamptz  default null
) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  delete from public.claude_usage_samples where raw->>'proof' = 'claude0155';
  insert into public.claude_usage_samples (
    sampled_at, five_hour_pct, five_hour_resets_at,
    seven_day_pct, seven_day_resets_at, raw)
  values (p_at, p_fh_pct, p_fh_reset,
          100 - (p_week_left / (select week_pool_pct / 100.0 from public.claude_settings where id)),
          p_at + interval '3 days',
          jsonb_build_object('proof', 'claude0155'));
  v := public.claude_free_now(p_at);
  delete from public.claude_usage_samples where raw->>'proof' = 'claude0155';
  return v;
end $$;

-- Reported to the nearest whole percent: the weekly reading is stored as
-- numeric(5,2) of a 0–100 window, so 660 session-% round-trips as 660.03. A
-- test that demanded exactness would be testing float printing, not the rule.
create function pg_temp.free_pct(v jsonb) returns text language sql as $$
  select round((v->>'free_pct')::numeric)::text;
$$;

create function pg_temp.at_hhmm(v jsonb, k text) returns text language sql as $$
  select to_char((v->>k)::timestamptz at time zone 'Asia/Bangkok', 'HH24:MI');
$$;

-- ── the scenario: one booking, 16:00–19:00, 70% ────────────────────────────
insert into public.claude_bookings (user_id, starts_at, ends_at, pct, purpose)
select uid, (select d0 from t) + interval '16 hours',
            (select d0 from t) + interval '19 hours', 70, 'proof row 0155'
  from subj;

-- ── §A. The owner's three examples ─────────────────────────────────────────

-- A1. A session opened at 11:00 runs to 16:00 and ENDS as theirs begins, so it
--     shares with nobody. The week has 660 and a session is only worth 100.
insert into probe select 'A1. 11:00, week 660% left  → a whole session', '100',
  pg_temp.free_pct(pg_temp.free_at((select d0 from t) + interval '11 hours', 660));
insert into probe select 'A1b. …and it is the SESSION that binds, not the week', 'session',
  (pg_temp.free_at((select d0 from t) + interval '11 hours', 660))->>'bound_by';
insert into probe select 'A1c. …good until the window closes at 16:00', '16:00',
  pg_temp.at_hhmm(pg_temp.free_at((select d0 from t) + interval '11 hours', 660), 'until');

-- A2. One hour later the same session runs to 17:00, so their block is INSIDE
--     it and 70 of that 100 is spoken for.
insert into probe select 'A2. 12:00, same booking     → only what they left', '30',
  pg_temp.free_pct(pg_temp.free_at((select d0 from t) + interval '12 hours', 660));
insert into probe select 'A2b. …and it runs out when THEIR block opens, 16:00', '16:00',
  pg_temp.at_hhmm(pg_temp.free_at((select d0 from t) + interval '12 hours', 660), 'until');
insert into probe select 'A2c. …named as a booking, not as a window closing', 'booking',
  (pg_temp.free_at((select d0 from t) + interval '12 hours', 660))->>'reason';

-- A3. The session is wide open; the WEEK is nearly gone and 70 of what is left
--     is already promised to somebody.
insert into probe select 'A3. 11:00, week 100% left   → the week binds', '30',
  pg_temp.free_pct(pg_temp.free_at((select d0 from t) + interval '11 hours', 100));
insert into probe select 'A3b. …and it says so', 'week',
  (pg_temp.free_at((select d0 from t) + interval '11 hours', 100))->>'bound_by';

-- ── §B. The two branches the examples never reach ──────────────────────────

-- B1. A 5-hour window is ALREADY OPEN and 60% burned. The window is Anthropic's
--     (closing 13:00), not now+5h, so the answer is 40% until 13:00 — and the
--     16:00 booking is outside it and must NOT be subtracted. This is the whole
--     reason the function reads the measurement instead of the clock.
insert into probe select 'B1. open window, 60% burned → 40%, not 100%', '40',
  pg_temp.free_pct(pg_temp.free_at((select d0 from t) + interval '11 hours', 660,
                                   60, (select d0 from t) + interval '13 hours'));
insert into probe select 'B1b. …closing at ITS reset, 13:00, not at 16:00', '13:00',
  pg_temp.at_hhmm(pg_temp.free_at((select d0 from t) + interval '11 hours', 660,
                                  60, (select d0 from t) + interval '13 hours'), 'until');

-- B2. THE CONTROL. Nothing booked, nothing burned, a full week: the answer has
--     to be one whole session. Without this, every case above would still print
--     green if the function had frozen at some number.
insert into probe select 'B2. control — no booking, full week → 100%', '100',
  pg_temp.free_pct(pg_temp.free_at((select d0 from t) + interval '5 hours', 700));

-- ── §C. The unbooked remainder — the number the owner asked to see ─────────
-- "if people haven't used it full, I can use it": week.free_pct is
-- measured-left MINUS everything still reserved, and it must reconcile exactly.
insert into probe select 'C1. week free = left − reserved (660 − 70)', '590',
  round(((pg_temp.free_at((select d0 from t) + interval '11 hours', 660))
          ->'week'->>'free_pct')::numeric)::text;
insert into probe select 'C2. reserved counts the block that has not run yet', '70',
  ((pg_temp.free_at((select d0 from t) + interval '11 hours', 660))
     ->'week'->>'reserved_pct');
-- C3 asserted the opposite of the truth until 0158 and went red the moment the
-- bug was fixed, which is the right way round for a guard to be wrong.
--
-- It said "asked about an instant after their block ends, it is no longer
-- reserved". That is only true once the block has ACTUALLY RUN. Asking on
-- Saturday about Tuesday does not spend it — and treating it as released let
-- the weekly remainder climb 10 → 60 → 160 → 260 → 360 across the week, with
-- the freed reservation counted once as "not reserved" and never as "spent".
--
-- The scenario here is entirely in the future, so the block stays subtracted at
-- every probe instant, and what the number must NOT do is grow.
insert into probe select 'C3. a still-to-run block stays reserved, whenever you ask', '70',
  ((pg_temp.free_at((select d0 from t) + interval '20 hours', 660))
     ->'week'->>'reserved_pct');

insert into probe select 'C3b. …so the weekly remainder does not grow by waiting', 'true',
  (((pg_temp.free_at((select d0 from t) + interval '20 hours', 660))->'week'->>'free_pct')::numeric
   <= ((pg_temp.free_at((select d0 from t) + interval '11 hours', 660))->'week'->>'free_pct')::numeric
   )::text;

-- ── §C2. The boundary the calendar rail is drawn from ──────────────────────
-- claude_free_windows() only works because the answer changes at
-- booking_start MINUS 5h, and nothing on a calendar marks that instant. If the
-- boundary set ever loses it, the rail keeps drawing — with the wrong number
-- for the five hours before every booking, which is the stretch people are
-- most likely to be looking at.
insert into probe select 'C4. 11:00 and 12:00 really do differ (the -5h boundary)', '100/30',
  pg_temp.free_pct(pg_temp.free_at((select d0 from t) + interval '11 hours', 660))
  || '/' ||
  pg_temp.free_pct(pg_temp.free_at((select d0 from t) + interval '12 hours', 660));

-- ── §D. The gate ───────────────────────────────────────────────────────────
-- claude_free_now() is SECURITY DEFINER over claude_bookings and the samples,
-- so a grant to `authenticated` would publish who booked what to an account
-- with no `claude` grant anywhere in the path — the same hole 0154 §7 closed on
-- claude_sessions(). Read from the ACL, not from the revoke we hope we wrote.
insert into probe select 'D1. claude_free_now is NOT callable by authenticated', 'false',
  has_function_privilege('authenticated', 'public.claude_free_now(timestamptz)', 'execute')::text;
insert into probe select 'D2. claude_person is NOT callable by authenticated', 'false',
  has_function_privilege('authenticated', 'public.claude_person(uuid)', 'execute')::text;
insert into probe select 'D3. claude_usage_deltas is NOT callable by authenticated', 'false',
  has_function_privilege('authenticated',
    'public.claude_usage_deltas(timestamptz, timestamptz)', 'execute')::text;
insert into probe select 'D3b. claude_free_windows is NOT callable by authenticated', 'false',
  has_function_privilege('authenticated', 'public.claude_free_windows(timestamptz)', 'execute')::text;
insert into probe select 'D4. the log RPC IS callable by authenticated', 'true',
  has_function_privilege('authenticated',
    'public.get_claude_usage_log(timestamptz)', 'execute')::text;
-- D5 is D4's other direction: callable is not the same as ungated. The gate is
-- inside the function body, and it is the same key the board uses.
insert into probe select 'D5. …and gated on the claude permission', 'true',
  (pg_get_functiondef('public.get_claude_usage_log(timestamptz)'::regprocedure)
     like '%current_user_has_permission(''claude'')%')::text;

-- ── verdict ────────────────────────────────────────────────────────────────
select step, expected, got,
       case when expected = got then 'PASS' else 'FAIL' end as result
from probe order by step;

rollback;
