-- ============================================================
-- 0242 — starting a ปี SAMO can open the next Passport วาระสโม in the SAME act
--
-- WHAT WAS ASKED (owner, 2026-10-20)
--   "changing ปี that'll effect many system should be ui ux distinct in the
--    admin, not just hiding in the ทีมsamo" — and, asked whether Passport's
--   วาระสโม should move with it: "Move it in the same click".
--
-- WHY A NEW FUNCTION, NOT TWO CALLS FROM THE BROWSER
--   The browser could call start_team_term() and then write passport.samo_years
--   itself. A failure between the two leaves ปี SAMO 2570 beside a Passport
--   still on '69 — the half-moved state the one click exists to prevent, with
--   nothing to say so. Here both happen in one transaction: all or nothing.
--
-- WHAT IT DOES NOT CHANGE
--   * start_team_term() is CALLED, not copied — its gate (team_edit / vp_admin /
--     dev, 0224), its auto-archive of an unpublished outgoing year and its
--     started_at/ended_at bookkeeping stay in their one home. A second copy of
--     that body here is the class-6 drift this repo has paid for repeatedly.
--   * NO NEW ACCESS CHANNEL. Opening a Passport วาระ resets the live
--     leaderboard; Passport's own admin page requires the org-wide Passport
--     grant for it (assertOrgWide). That same test is asked here, from its one
--     home, passport_admin_context()->'all_departments'. A team_edit holder
--     WITHOUT it can still start the ปี SAMO — they simply pass no Passport
--     name, and the page tells them Passport will not move. Every `master`
--     holds both (current_user_has_permission folds master, 0111).
--   * Going BACK a year never opens a Passport วาระ (refused) — a วาระ is a
--     leaderboard window; rolling the team year back is a correction, not a
--     new season of scanning.
--
-- PASSPORT ORDER (docs/INVARIANTS.md "Never leave a GAP between two วาระ or two
-- seasons"): CREATE the new year + its first season, THEN end the old ones.
-- Inside one transaction no reader can see between them anyway, but the order
-- is kept so this body reads like admin-page.js's startNewYear, its twin.
-- A Passport year already bridged to p_year (ฝ่าย กิจกรรม opened it by hand)
-- is left alone: the call reports `already` instead of opening a second one.
-- The OUTGOING open year gets team_term_year filled if it was blank (0232's
-- bridge) — it was open during the year being closed, which is what it means.
-- ============================================================

create or replace function public.start_samo_year(
  p_year          integer,
  p_passport_name text default null,
  p_season_name   text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_prev     integer;
  v_team     jsonb;
  v_pp_name  text := nullif(btrim(coalesce(p_passport_name, '')), '');
  v_ss_name  text := nullif(btrim(coalesce(p_season_name, '')), '');
  v_year_id  uuid;
  v_season   uuid;
  v_passport jsonb := jsonb_build_object('moved', false);
begin
  select year into v_prev from public.team_terms where is_current limit 1;

  if v_pp_name is not null then
    -- Asked BEFORE start_team_term, so a refusal changes nothing at all.
    if not coalesce((public.passport_admin_context() ->> 'all_departments')::boolean, false) then
      raise exception 'start_samo_year: เริ่มวาระสโมของ Passport ต้องมีสิทธิ์ SAMO Passport ทุกฝ่าย';
    end if;
    if v_ss_name is null then
      raise exception 'start_samo_year: วาระสโมใหม่ต้องมี season แรก';
    end if;
    if length(v_pp_name) > 80 or length(v_ss_name) > 80 then
      raise exception 'start_samo_year: ชื่อวาระ/season ยาวเกินไป';
    end if;
    if v_prev is not null and p_year < v_prev then
      raise exception 'start_samo_year: ย้อนปี SAMO ไม่เริ่มวาระสโมใหม่';
    end if;
  end if;

  -- The team half. Raises on its own gate, a bad year, or "already current".
  v_team := public.start_team_term(p_year);

  if v_pp_name is not null then
    if exists (select 1 from passport.samo_years
                where ended_at is null and team_term_year = p_year) then
      v_passport := jsonb_build_object('moved', false, 'already', true);
    else
      insert into passport.samo_years (name, team_term_year)
           values (v_pp_name, p_year)
        returning id into v_year_id;
      insert into passport.samo_seasons (samo_year_id, name)
           values (v_year_id, v_ss_name)
        returning id into v_season;

      update passport.samo_seasons set ended_at = now()
       where ended_at is null and id <> v_season;
      update passport.samo_years
         set ended_at = now(),
             team_term_year = coalesce(team_term_year, v_prev)
       where ended_at is null and id <> v_year_id;

      v_passport := jsonb_build_object('moved', true, 'name', v_pp_name,
                                       'season', v_ss_name, 'samo_year_id', v_year_id);
    end if;
  end if;

  return v_team || jsonb_build_object('passport', v_passport);
end;
$$;

revoke all on function public.start_samo_year(integer, text, text) from public;
revoke all on function public.start_samo_year(integer, text, text) from anon;
grant execute on function public.start_samo_year(integer, text, text) to authenticated;

comment on function public.start_samo_year(integer, text, text) is
  'Start a ปี SAMO (start_team_term, its gate and bookkeeping) and, when a '
  'Passport name is given, open that Passport วาระสโม + its first season in the '
  'same transaction (org-wide Passport grant required for that half). The '
  'admin page /admin/#year calls this; ทีม SAMO no longer offers the switch.';
