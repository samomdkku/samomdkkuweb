-- ============================================================
-- 0219 — ONE SAMO year, every system. Core infra (night agent, task 2 of the
-- 2026-10-14 queue). Design: docs/YEAR-ROLLOVER.md § The SAMO year.
--
-- WHY team_terms AND NOT A NEW TABLE. 0104/0105 already built the registry
-- (`year` PK, `is_current` with a partial unique index, a publish/archive
-- pair) that ทีม SAMO's own ปีการศึกษา pane uses. A second "SAMO year" table
-- would be the two-homes-for-one-fact bug `.claude/rules/mistakes.md` class 6
-- names as this repo's most expensive class. This migration only ADDS to it.
--
-- WHAT THIS BUILDS
--   1. team_terms.started_at / ended_at — when a term was actually live, so a
--      historical row can be filed under the year that was ACTUALLY in office,
--      not just "whichever row happens to be is_current right now".
--   2. current_samo_year() — the INSERT-time answer: "what year is it right
--      now". Every later task's trigger calls this, once, at row creation.
--   3. samo_year_for_timestamp(ts) — the BACKFILL-time answer: "what year was
--      it at this past instant". Tasks 3/4/6 need this to backfill existing
--      rows without guessing.
--   4. samo_year_be_default() — one generic BEFORE INSERT trigger function
--      every later task's table attaches, so the stamping rule has ONE body
--      instead of four near-identical copies (class 6 again).
--   5. start_team_term(year) — the handover RPC, replacing the two separate
--      PATCH requests `team/api.js`'s `setCurrentTerm` used to issue (its own
--      comment already flagged the gap: "Not atomic — a failure between the
--      two leaves NO current term"). One plpgsql call is one transaction, so
--      there is no instant another session can observe zero current terms.
--
-- WHY current_samo_year() IS SECURITY DEFINER, DIFFERING FROM THE DESIGN DOC'S
-- ILLUSTRATIVE SNIPPET. team_terms' only RLS policy is "vp_admin/dev/team
-- permission, for all" (0104) — nobody else may SELECT it. But
-- pr_tickets_insert_anyone (0001) lets an ANONYMOUS visitor insert a PR
-- ticket, and that INSERT's trigger must still resolve a year. An
-- invoker-rights current_samo_year() called from that trigger would run AS
-- the anonymous caller, see zero rows under RLS, and silently return NULL —
-- exactly the "an unresolvable reference fails open... to NULL" class 2
-- failure this repo keeps re-discovering. SECURITY DEFINER + a narrow,
-- single-purpose body (one column, no filter a caller controls) is the same
-- shape as current_user_role()/get_public_team_years() already use for the
-- identical reason.
--
-- WHY samo_year_for_timestamp TREATS A NULL started_at AS "-infinity" FOR A
-- CURRENT **OR ALREADY-CLOSED** TERM, BUT NOT A NEVER-STARTED ONE. Every row
-- in team_terms today has started_at = NULL — the column did not exist until
-- this migration — and the 2569 row has been the ONLY team in office since
-- this whole system started operating (2026-05). A backfill that requires an
-- explicit started_at before it will match a timestamp would answer
-- "ก่อนเริ่มระบบปี" (no term covers it) for every one of the 311 PR tickets /
-- 119 VS tickets / 42 โครงการ that motivated this whole design — the exact
-- outcome the design doc's PR section says must NOT happen.
--
-- The FIRST version of this function keyed the "-infinity" escape hatch on
-- `is_current` alone. That reads right only until the FIRST handover ever
-- happens: the moment start_team_term closes 2569, is_current flips to false
-- and a backfill written years later (a new table added after several
-- handovers) would see 2569 as unresolvable forever, even for the exact same
-- PR tickets this was built to classify. A term's started_at is unrecorded
-- for exactly two reasons, and only one of them means "unknown, assume it
-- covers everything up to its close": it is open right now (is_current), or
-- it WAS open and got closed without ever having a start stamped (ended_at is
-- not null — structurally only possible for the one term this column applied
-- to for the first time, since start_team_term always stamps started_at on
-- every OTHER open). A row with NEITHER flag is a future term seeded ahead of
-- time via createTerm and never started — it must match nothing.
-- ============================================================

-- ---------------------------------------------------------------------------
-- 1. team_terms.started_at / ended_at — ADD only, both nullable.
-- ---------------------------------------------------------------------------
alter table public.team_terms
  add column if not exists started_at timestamptz,
  add column if not exists ended_at   timestamptz;

comment on column public.team_terms.started_at is
  'When this term actually became the live one. Set EXCLUSIVELY by '
  'start_team_term() — never by publish_team_term(), which only snapshots '
  'the tree and may be re-run without a handover happening. NULL + is_current '
  'means "current since before this column existed" (see samo_year_for_timestamp).';
comment on column public.team_terms.ended_at is
  'When this term stopped being the live one. Set EXCLUSIVELY by '
  'start_team_term() on the term it replaces. NULL means still open (either '
  'the current term, or a future term never started).';

-- ---------------------------------------------------------------------------
-- 2. current_samo_year() — the one function every trigger calls at INSERT.
-- ---------------------------------------------------------------------------
create or replace function public.current_samo_year()
returns integer
language sql stable security definer set search_path = public as $$
  select year from public.team_terms where is_current limit 1
$$;

revoke all on function public.current_samo_year() from public;
grant execute on function public.current_samo_year() to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. samo_year_for_timestamp(ts) — the range lookup a ONE-TIME backfill uses.
-- ---------------------------------------------------------------------------
-- NOT simply "is_current ⇒ -infinity": that reads right only until the FIRST
-- handover ever happens. The moment start_team_term closes 2569, is_current
-- flips to false and a naive version would stop resolving 2569's own history
-- forever — a ONE-TIME backfill run years from now (a new table added long
-- after several handovers) would then see 2569 as "never happened". A term
-- has recorded no start for exactly two reasons, and only one of them means
-- "unknown, assume forever": it is open now (is_current), or it WAS open and
-- got closed without ever having a start stamped (ended_at is not null — only
-- possible for the very first term this column ever applied to, since every
-- OTHER close is preceded by a start_team_term-recorded open). A row with
-- NEITHER flag is a future term seeded ahead of time and never started — it
-- must match nothing.
create or replace function public.samo_year_for_timestamp(p_ts timestamptz)
returns integer
language sql stable security definer set search_path = public as $$
  select t.year
    from public.team_terms t
   where p_ts >= case
           when t.started_at is not null then t.started_at
           when t.is_current or t.ended_at is not null then '-infinity'::timestamptz
           else null
         end
     and p_ts <  coalesce(t.ended_at, 'infinity'::timestamptz)
   order by coalesce(t.started_at, '-infinity'::timestamptz) desc
   limit 1
$$;

-- authenticated ONLY, unlike current_samo_year() above: nothing anon can
-- trigger (no anon INSERT trigger calls this) needs it — it is a one-time
-- BACKFILL tool for tasks 3/4/6's migrations and a future admin "what year
-- was this timestamp" lookup, both of which run signed in. Least privilege:
-- do not hand an anonymous caller a boundary-probing function it has no
-- legitimate caller for.
revoke all on function public.samo_year_for_timestamp(timestamptz) from public;
grant execute on function public.samo_year_for_timestamp(timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. samo_year_be_default() — the ONE trigger body every later task attaches.
--
-- Plain (invoker) function on purpose: it does no RLS-gated read of its own,
-- it only calls current_samo_year(), which already carries the SECURITY
-- DEFINER. `new.samo_year_be` is a plain assignment, not dynamic SQL — every
-- table this attaches to is required to name the column exactly
-- `samo_year_be`, which is the convention this whole design doc fixes.
-- ---------------------------------------------------------------------------
create or replace function public.samo_year_be_default()
returns trigger
language plpgsql as $$
begin
  if new.samo_year_be is null then
    new.samo_year_be := public.current_samo_year();
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. start_team_term(year) — the handover RPC. Closes the outgoing term,
--    opens the incoming one, in ONE transaction.
-- ---------------------------------------------------------------------------
create or replace function public.start_team_term(p_year integer)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_current integer;
  v_now     timestamptz := now();
  v_closed  integer;
begin
  -- coalesce(..., false) is load-bearing (0218's lesson): a caller with no
  -- public.users row must be refused, not waved through by a NULL comparison.
  if not coalesce(
       public.current_user_role() = any (array['vp_admin', 'dev'])
       or public.current_user_has_permission('team'), false) then
    raise exception 'start_team_term: ไม่มีสิทธิ์';
  end if;

  if p_year is null or p_year < 2500 or p_year > 2700 then
    raise exception 'start_team_term: bad year %', p_year;
  end if;

  select year into v_current from public.team_terms where is_current limit 1;

  -- Edge case 5 (docs/YEAR-ROLLOVER.md): a double-run must refuse with a
  -- clear message, never silently re-open the same term.
  if v_current is not distinct from p_year then
    raise exception 'start_team_term: ปี % เป็นปีปัจจุบันอยู่แล้ว', p_year;
  end if;

  -- Close the outgoing term FIRST: team_terms_one_current (0104) is a partial
  -- unique index on is_current, so a second row cannot become true while the
  -- first still is. Both statements are ONE plpgsql call, hence one
  -- transaction — no other session can ever see zero current terms between
  -- them, unlike the two separate PATCH requests this RPC replaces.
  --
  -- started_at = coalesce(started_at, '-infinity') FIXES THE GENESIS ROW the
  -- instant it first closes. The term that was is_current when THIS
  -- migration ran has started_at = NULL for a real reason (the column did
  -- not exist yet) — samo_year_for_timestamp treats that as "-infinity" via
  -- its `t.is_current` branch. But the moment this UPDATE closes it, that
  -- branch stops applying, and without this line started_at would STAY NULL
  -- until some future start_team_term(same year) reopened it — at which
  -- point the INSERT below's `coalesce(started_at, v_now)` would stamp
  -- TODAY's date onto a term that was actually open since before this system
  -- existed, making every earlier backfill timestamp unresolvable (NULL)
  -- again: verified by reproducing it in a rolled-back probe before this
  -- fix existed. Stamping -infinity HERE, while the row is still
  -- unambiguously "closed, never-recorded-start", makes the fact permanent
  -- before the ambiguous window (another close/reopen cycle) can ever reach
  -- it.
  update public.team_terms
     set is_current = false,
         ended_at    = v_now,
         updated_at  = v_now,
         started_at  = coalesce(started_at, '-infinity'::timestamptz)
   where is_current;
  get diagnostics v_closed = row_count;

  insert into public.team_terms (year, is_current, started_at, updated_at)
       values (p_year, true, v_now, v_now)
    on conflict (year) do update
       set is_current = true,
           -- Edge case 6, a rollover undone and redone: a term's ORIGINAL
           -- started_at is a fact about history and must not move once set.
           started_at = coalesce(public.team_terms.started_at, v_now),
           ended_at = null,
           updated_at = v_now;

  return jsonb_build_object(
    'year', p_year, 'previous_year', v_current,
    'started_at', v_now, 'closed_terms', v_closed
  );
end;
$$;

-- Functions are granted EXECUTE to PUBLIC by default (0101's lesson) —
-- revoke from both public and anon by name; only a signed-in account may
-- even attempt the authorization check above.
revoke all on function public.start_team_term(integer) from public;
revoke all on function public.start_team_term(integer) from anon;
grant execute on function public.start_team_term(integer) to authenticated;
