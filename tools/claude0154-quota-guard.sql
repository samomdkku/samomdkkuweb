-- ============================================================
-- claude0154-quota-guard.sql — does the จองโควตา Claude schema actually
-- enforce the four rules it claims, and does it still ALLOW the bookings it
-- is supposed to allow?
--
-- The four rules (0154):
--   1. a block is at most 5 hours          (check constraint)
--   2. two blocks never overlap in time    (exclusion constraint)
--   3. one 5-hour session carries 100%, shared by everyone inside it (trigger)
--   4. one quota week carries 700%         (trigger)
--
-- BOTH DIRECTIONS, because both failure modes are silent. A DENY-only probe
-- cannot tell a working guard from a broken service — if the trigger raised on
-- everything, a deny-only run would print all-green. So every rule below has an
-- ALLOW case sitting immediately beside its DENY case, over the SAME rows.
--
-- The session cases are the ones worth reading: A1+A2 are the owner's own
-- example (30% over 2h, then 70% over 1h inside the same 5-hour window), and D1
-- is the same window refusing the next 5%.
--
-- §B re-checks the PRIVILEGES, not the migration text. claude_sessions() is
-- SECURITY DEFINER over claude_bookings, so a grant to `authenticated` would
-- hand the entire board to any signed-in account with no `claude` grant in the
-- path. It was granted in the first draft of 0154 and revoked before apply;
-- B4 exists so it cannot come back. Read with has_function_privilege(), which
-- is the effective authority, not the `revoke` line we hope we wrote.
--
-- NOTE this proves the TRIGGERS and CONSTRAINTS, which apply to every writer
-- including the table owner. It does NOT prove RLS — this runs as `postgres`,
-- which bypasses it. The RLS half is B1–B3 (the policies and grants exist and
-- anon holds nothing) plus the per-account probe in tools/authz-sweep-identity.sql.
--
--   node tools/db-query.mjs tools/claude0154-quota-guard.sql
-- ============================================================

begin;

create temp table probe (step text, expected text, got text) on commit drop;

-- ── the instrument: attempt a booking, report allow/deny, undo itself ───────
-- The exception block is a subtransaction, so a rejected insert rolls back by
-- itself and leaves the accepted ones standing. That is what lets the session
-- cases accumulate.
create function pg_temp.try_book(p_user uuid, p_start timestamptz, p_mins int, p_pct int)
returns text language plpgsql as $$
begin
  begin
    insert into public.claude_bookings (user_id, starts_at, ends_at, pct, purpose)
    values (p_user, p_start, p_start + make_interval(mins => p_mins), p_pct, 'proof row');
    return 'allow';
  exception when others then
    return 'deny';
  end;
end $$;

-- Subject resolved from the data, never hardcoded: a proof naming a person
-- rots the moment the org chart moves (tools/proofs, 0092).
create temp table subj on commit drop as
  select id as uid from public.users order by created_at limit 1;

-- Wed 2026-09-02 16:00 opens the week; these probes sit on the Saturday inside
-- it. This comment used to end "clear of anything real" and that was the bug —
-- see the block below.
create temp table t on commit drop as
  select timestamptz '2026-09-05 09:00+07' as t0;

-- ⚠️ THE SCENARIO NEEDS AN ABSENCE, SO IT CONSTRUCTS ONE AND THEN ASSERTS IT.
-- "Clear of anything real" was true while claude_bookings was empty and stopped
-- being true on 2026-09-07, when the first real booking ever made landed in
-- exactly this week and took 70% of the weekly pool the arithmetic below
-- spends. A5 — "a booking that exactly fills the week is allowed" — then failed
-- alone, for a reason no reader could get from the verdict, and STATE.md
-- recorded a WRONG cause for it ("the live 5-hour window is already claimed").
-- Nothing was broken; the proof had borrowed its geometry instead of building
-- it. A claim of "clear of anything real" in a COMMENT is the tell, and the
-- construction can assert it (.claude/rules/mistakes.md class 7).
--
-- The delete is scoped to the probe week and sits inside the `begin … rollback`
-- this file ends with, so it is undone before anyone else can read it — the
-- same already-established pattern as this file's update of claude_settings
-- below. Its point is that the arithmetic no longer depends on what production
-- happens to hold.
delete from public.claude_bookings
 where starts_at >= public.claude_week_start((select t0 from t))
   and starts_at <  public.claude_week_start((select t0 from t)) + interval '7 days';

insert into probe select
  'A0. control — the probe week is EMPTY before the scenario builds it', '0',
  (select coalesce(sum(pct), 0)::text from public.claude_bookings
    where starts_at >= public.claude_week_start((select t0 from t))
      and starts_at <  public.claude_week_start((select t0 from t)) + interval '7 days');

-- ── §A. The session and week arithmetic ────────────────────────────────────

-- A1/A2 are the owner's example: a session opens at the first booking, runs
-- 5 hours, and the 100% is shared by whoever lands inside it.
insert into probe select 'A1. first booking opens a session (2h, 30%)', 'allow',
  pg_temp.try_book((select uid from subj), (select t0 from t), 120, 30);

insert into probe select 'A2. second booking JOINS that session (1h, 70%)', 'allow',
  pg_temp.try_book((select uid from subj), (select t0 from t) + interval '2 hours', 60, 70);

-- D1 is A2's twin: same session, now full. If this returns allow, rule 3 is off.
insert into probe select 'D1. session at 100% refuses another 5%', 'deny',
  pg_temp.try_book((select uid from subj), (select t0 from t) + interval '3 hours', 60, 5);

-- D2: overlapping the 11:00–12:00 block. The exclusion constraint, not the UI.
insert into probe select 'D2. a block overlapping another is refused', 'deny',
  pg_temp.try_book((select uid from subj), (select t0 from t) + interval '2 hours 30 minutes', 30, 1);

-- D3: 6 hours, on a clear day, so ONLY the span rule can reject it.
insert into probe select 'D3. a 6-hour block is refused', 'deny',
  pg_temp.try_book((select uid from subj), (select t0 from t) + interval '1 day', 360, 1);

-- A3: the same clear day at 5 hours exactly — the boundary must be inclusive,
-- or "จองได้สูงสุด 5 ชม." is a lie by one minute.
insert into probe select 'A3. a 5-hour block is allowed (boundary)', 'allow',
  pg_temp.try_book((select uid from subj), (select t0 from t) + interval '1 day', 300, 1);

-- D4: 13:30–14:30 straddles the edge of the 09:00–14:00 session. One booking
-- must belong to exactly one window or the arithmetic has no meaning.
insert into probe select 'D4. a block straddling a session edge is refused', 'deny',
  pg_temp.try_book((select uid from subj), (select t0 from t) + interval '4 hours 30 minutes', 60, 1);

-- A4: 14:00 is the session END, so this opens a NEW one with a fresh 100%.
-- Without this case, D1 and D4 would also pass if the trigger simply refused
-- everything after the first two rows.
insert into probe select 'A4. a block after the session end opens a new one', 'allow',
  pg_temp.try_book((select uid from subj), (select t0 from t) + interval '5 hours', 120, 50);

-- Weekly pool. 30+70+1+50 = 151 booked so far. Squeeze the pool to 161 rather
-- than writing 700% of probe rows: the rule under test is the comparison, and
-- a smaller pool exercises the same branch.
update public.claude_settings set week_pool_pct = 161 where id;

insert into probe select 'A5. a booking that exactly fills the week is allowed', 'allow',
  pg_temp.try_book((select uid from subj), (select t0 from t) + interval '2 days', 60, 10);

insert into probe select 'D5. a booking past the weekly pool is refused', 'deny',
  pg_temp.try_book((select uid from subj), (select t0 from t) + interval '2 days 2 hours', 60, 1);

-- ── §B. Privileges, read from the authority ────────────────────────────────

insert into probe select 'B1. claude_bookings has RLS enabled', 'true',
  (select relrowsecurity::text from pg_class where oid = 'public.claude_bookings'::regclass);

insert into probe select 'B2. authenticated can SELECT claude_bookings (a policy with no grant denies everyone)', 'true',
  has_table_privilege('authenticated', 'public.claude_bookings', 'SELECT')::text;

insert into probe select 'B3. anon holds NOTHING on claude_bookings', 'false',
  (has_table_privilege('anon', 'public.claude_bookings', 'SELECT')
   or has_table_privilege('anon', 'public.claude_bookings', 'INSERT'))::text;

-- The regression guard for the leak found in review: a SECURITY DEFINER reader
-- over the whole table, reachable without the `claude` gate.
insert into probe select 'B4. claude_sessions() is NOT executable by authenticated', 'false',
  has_function_privilege('authenticated',
    'public.claude_sessions(timestamptz,timestamptz)', 'EXECUTE')::text;

insert into probe select 'B5. claude_week_start() is NOT executable by authenticated', 'false',
  has_function_privilege('authenticated',
    'public.claude_week_start(timestamptz)', 'EXECUTE')::text;

-- ...and its ALLOW twin: the one door that IS supposed to be open. Without
-- this, B4/B5 would pass on a database where every grant had been dropped.
insert into probe select 'B6. get_claude_board() IS executable by authenticated', 'true',
  has_function_privilege('authenticated',
    'public.get_claude_board(timestamptz)', 'EXECUTE')::text;

insert into probe select 'B7. get_claude_board() is gated on the claude permission', 'true',
  (pg_get_functiondef('public.get_claude_board(timestamptz)'::regprocedure)
     like '%current_user_has_permission(''claude'')%')::text;

-- ── §C. The gate itself, as two real accounts ──────────────────────────────
--
-- B1–B7 read privileges; this section actually CALLS get_claude_board() as a
-- signed-in account and as an ungranted one. Both halves are load-bearing: the
-- DENY alone cannot tell a working gate from a broken function (it would print
-- green if the RPC raised on everything), and the ALLOW alone cannot see a gate
-- that has stopped gating.

create function pg_temp.board_as(p_uid uuid)
returns text language plpgsql as $$
begin
  begin
    perform set_config('request.jwt.claims',
      json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
    perform public.get_claude_board(now());
    return 'allow';
  exception when others then
    return 'deny';
  end;
end $$;

-- Subjects resolved from the data. `master` answers yes to every key through
-- the 0111 union, so the granted subject is picked by the SAME predicate the
-- function tests with — a picker that does not mirror the gate selects nobody
-- and the proof errors instead of failing (the 42501 that sat green for three
-- days in house0144).
create temp table granted on commit drop as
  select id from public.users
   where 'claude' = any(permissions)    or 'claude' = any(managed_permissions)
      or 'master' = any(permissions)    or 'master' = any(managed_permissions)
   order by created_at limit 1;

create temp table ungranted on commit drop as
  select id from public.users
   where not ('claude' = any(permissions) or 'claude' = any(managed_permissions)
           or 'master' = any(permissions) or 'master' = any(managed_permissions))
     and coalesce(role, 'user') = 'user'
   order by created_at limit 1;

-- The probe table and the subject tables are read/written while impersonating
-- `authenticated`, so they need the grant too — a temp table belongs to the
-- session role, not to whoever is wearing it at the time.
grant select on granted, ungranted to authenticated;
grant select, insert on probe to authenticated;

insert into probe select 'C0. both subjects exist (a proof with no subject proves nothing)', '2',
  ((select count(*) from granted) + (select count(*) from ungranted))::text;

set local role authenticated;
insert into probe select 'C1. a granted account CAN read the board', 'allow',
  pg_temp.board_as((select id from granted));
insert into probe select 'C2. an ungranted account CANNOT read the board', 'deny',
  pg_temp.board_as((select id from ungranted));
reset role;

-- ── verdict ────────────────────────────────────────────────────────────────
select step, expected, got,
       case when expected = got then 'PASS' else 'FAIL' end as result
from probe order by step;

rollback;
