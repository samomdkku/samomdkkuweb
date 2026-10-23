-- 0246 — moving an activity to another quarter moves the points already earned
--
-- ASKED (owner, 2026-10-23): "if admin config activity point to go in Q2,
-- people scan at Q2, then admin change it to Q3, what'll happen to the point
-- people has scan"; "if activity is Q3 admin change to Q2, what should happen,
-- should it move point to Q2 and close it for no one to scan? what's the best".
--
-- WHAT HAPPENED BEFORE THIS. 0245 credits every scan to its ACTIVITY's quarter
-- and asserted that no scan sits outside it — but only the admin PAGE stopped a
-- quarter change once someone had scanned. The table did not: an UPDATE of
-- `quarter` re-filed the activity and left its scans behind in the old
-- quarter, breaking the invariant 0245 was built on; and a move to a closed
-- quarter was refused for everyone, including the repair the owner chose for
-- the 7 activities of 2026-10-23.
--
-- THE RULE (decided 2026-10-23 on the recommendation the owner asked for):
-- points always live in the activity's quarter, so MOVING the activity MOVES
-- its points. Where it may move:
--   * to the quarter that is OPEN now — anyone who may edit the activity; the
--     points move with it and its QR keeps scanning;
--   * BACK to a CLOSED quarter — org-wide Passport admins only: it rewrites a
--     finished quarter's leaderboard, and the QR stops scanning (that is what
--     "this was a Q2 event" means);
--   * to a quarter that has NOT STARTED — only while nobody has scanned: the
--     points would otherwise belong to a season that does not exist yet and
--     vanish from every leaderboard until it opens.
-- km totals never change: a scan's points_awarded and user_id are untouched,
-- and on_scan_points_changed acts on those two only.
--
-- Enforced in the TRIGGER, not the page, so a console write or a future
-- client meets the same rule (class 4). A caller with no auth.uid() — the
-- rollover linking a waiting activity, a superuser repair — is not a person
-- choosing a quarter and is not gated.

begin;

-- Rebuilt from the LIVE body (pg_get_functiondef, md5 95777e5c…, = 0245's).
-- Changes: a quarter change is validated against the scans that exist, a
-- closed target is allowed to an org-wide admin on UPDATE, and the explicit-
-- season branch no longer returns before that validation.
create or replace function passport.activity_season_default()
returns trigger
language plpgsql
security definer
set search_path to 'passport'
as $fn$
declare
  v_os passport.samo_seasons;
  v_s  passport.samo_seasons;
  v_q  int;
  v_moving boolean;
  v_person boolean := auth.uid() is not null;
begin
  if tg_op = 'INSERT' then
    perform passport.apply_season_schedule();   -- the quarter it is checked against is current
  end if;

  v_moving := tg_op = 'UPDATE' and (new.season_id is distinct from old.season_id
                                    or new.quarter is distinct from old.quarter
                                    or new.samo_year_id is distinct from old.samo_year_id);
  if tg_op = 'UPDATE' and not v_moving then
    return new;
  end if;

  if new.season_id is not null
     and (tg_op = 'INSERT' or new.season_id is distinct from old.season_id) then
    -- An explicit season decides the quarter and the วาระ (data repair, and the
    -- rollover linking a waiting activity).
    select * into v_s from passport.samo_seasons where id = new.season_id;
    if not found then raise exception 'SEASON_NOT_FOUND'; end if;
    new.samo_year_id := v_s.samo_year_id;
    new.quarter := coalesce(v_s.quarter, new.quarter,
                            (passport.schedule_at(v_s.started_at) ->> 'quarter')::smallint);
  else
    select * into v_os from passport.samo_seasons where ended_at is null order by started_at desc limit 1;

    if new.quarter is null then
      -- No choice made (an older client, a script): the open quarter, as 0180 did.
      if v_os.id is null then raise exception 'NO_OPEN_SEASON'; end if;
      new.season_id    := v_os.id;
      new.samo_year_id := v_os.samo_year_id;
      new.quarter      := coalesce(v_os.quarter, (passport.schedule_at() ->> 'quarter')::smallint);
      return new;
    end if;

    new.samo_year_id := coalesce(new.samo_year_id, v_os.samo_year_id,
      (select id from passport.samo_years where ended_at is null order by started_at desc limit 1));
    if new.samo_year_id is null then raise exception 'NO_OPEN_SEASON'; end if;

    select * into v_s from passport.samo_seasons
     where samo_year_id = new.samo_year_id and quarter = new.quarter;
    if found then
      -- A closed quarter: never for a NEW activity (a dead poster); on a move,
      -- the org-wide check below decides.
      if v_s.ended_at is not null and tg_op = 'INSERT' then
        raise exception 'QUARTER_CLOSED:Q%', new.quarter;
      end if;
      new.season_id := v_s.id;
    else
      -- A quarter with no season yet: only AHEAD of the open one, in an open วาระ.
      if (select ended_at from passport.samo_years where id = new.samo_year_id) is not null then
        raise exception 'QUARTER_CLOSED:Q%', new.quarter;
      end if;
      v_q := coalesce(v_os.quarter, (passport.schedule_at() ->> 'quarter')::int);
      if v_os.samo_year_id = new.samo_year_id and new.quarter < v_q then
        raise exception 'QUARTER_CLOSED:Q%', new.quarter;
      end if;
      new.season_id := null;
    end if;
  end if;

  -- ── 0246: a MOVE is checked against the points it carries ───────────────
  if v_moving and v_person then
    if new.season_id is null
       and exists (select 1 from passport.scans where activity_id = new.id) then
      raise exception 'QUARTER_NOT_OPEN_HAS_SCANS:Q%', new.quarter;
    end if;
    if new.season_id is not null
       and (select ended_at from passport.samo_seasons where id = new.season_id) is not null
       and not passport._org_wide() then
      raise exception 'QUARTER_CLOSED_ORG_WIDE_ONLY:Q%', new.quarter;
    end if;
  end if;
  return new;
end $fn$;

-- Same trigger definition as 0245 (insert, or update of the three columns).
drop trigger if exists activities_set_season on passport.activities;
create trigger activities_set_season
  before insert or update of quarter, samo_year_id, season_id on passport.activities
  for each row execute function passport.activity_season_default();

-- ── the points follow ─────────────────────────────────────────────────────
-- AFTER, so it sees the season the BEFORE trigger settled on. A move to a
-- quarter not open yet never reaches here with scans (refused above), and a
-- waiting activity being linked at its rollover has none.
create or replace function passport.activity_moves_its_scans()
returns trigger
language plpgsql
security definer
set search_path to 'passport'
as $fn$
begin
  if new.season_id is not null and new.season_id is distinct from old.season_id then
    update passport.scans s
       set season_id    = new.season_id,
           samo_year_id = (select samo_year_id from passport.samo_seasons where id = new.season_id)
     where s.activity_id = new.id
       and s.season_id is distinct from new.season_id;
  end if;
  return null;
end $fn$;
revoke all on function passport.activity_moves_its_scans() from public, anon, authenticated;

drop trigger if exists activities_move_scans on passport.activities;
-- ⚠️ `after update`, NOT `after update of season_id`: an UPDATE OF trigger fires
-- only when the STATEMENT names the column, and a client that sets just
-- `quarter` gets its season_id from the BEFORE trigger — which does not count.
-- The function compares old and new itself.
create trigger activities_move_scans
  after update on passport.activities
  for each row execute function passport.activity_moves_its_scans();

commit;
