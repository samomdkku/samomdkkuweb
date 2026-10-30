-- ============================================================
-- 0266 — pressing เริ่มปี SAMO on Q1 day finishes the job instead of undoing
-- the automatic switch. Supersedes 0249's draft (HANDOFF §31c).
--
-- THE BUG (found 2026-10-23, the bug scan of 0248). start_samo_year first runs
-- the due automatic switch, which on 1 มี.ค. starts the very year the admin is
-- asking for; start_team_term then raises "ปี … เป็นปีปัจจุบันอยู่แล้ว" and the
-- WHOLE transaction — the automatic switch included — rolls back. Every press
-- failed the same way until a scan or a form applied the switch first.
--
-- WHY 0249 DID NOT FIX IT. Its early return fired only when the team year AND
-- the open Passport วาระ were both on p_year after the switch. The automatic
-- switch can move the team year without opening a Passport วาระ (measured on
-- samo-dev 2026-10-30: `apply_season_schedule()` answered applied:false,
-- reason "admin", and the team year moved anyway) — then 0249 fell through to
-- the same raise. Its proof case 40 stayed red for exactly that state.
--
-- THIS SHAPE. Read the current year BEFORE the automatic switch. If the switch,
-- in THIS call, made p_year current, the team half is already done: skip
-- start_team_term (keeping its permission check, stated here), and still run
-- the Passport half when one was asked for — it reports `already` if the
-- switch opened the วาระ too, and opens it if not. Any other press is
-- unchanged, including "already current" for a year started earlier.
--
-- Rebuilt from the LIVE body (= 0248; 0249 never reached production).
-- Proof: tools/year0248-one-year-system.sql §E (cases 40–43).
-- ============================================================

create or replace function public.start_samo_year(
  p_year integer, p_passport_name text default null, p_season_name text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_before   integer;
  v_prev     integer;
  v_old      integer;
  v_auto     boolean;
  v_team     jsonb;
  v_pp_name  text := nullif(btrim(coalesce(p_passport_name, '')), '');
  v_ss_name  text := nullif(btrim(coalesce(p_season_name, '')), '');
  v_year_id  uuid;
  v_season   uuid;
  v_quarter  smallint;
  v_passport jsonb := jsonb_build_object('moved', false);
begin
  select year into v_before from public.team_terms where is_current limit 1;
  -- 0248: an automatic switch that is due runs first — otherwise the ack at
  -- the end of this function would mark the boundary done without it.
  perform passport.apply_season_schedule();
  select year into v_prev from public.team_terms where is_current limit 1;

  -- 0266: did the automatic switch, just now, start the year being asked for?
  v_auto := v_before is distinct from v_prev and v_prev is not distinct from p_year;
  -- The year that was current before this press (what an ended วาระ belongs to).
  v_old := case when v_auto then v_before else v_prev end;

  if v_auto then
    -- start_team_term's own gate, asked here because it will not be called.
    if not coalesce(
         public.current_user_role() = any (array['vp_admin', 'dev'])
         or public.current_user_has_permission('team_edit'), false) then
      raise exception 'start_team_term: ไม่มีสิทธิ์';
    end if;
  end if;

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

  -- The team half. Raises on its own gate, a bad year, or "already current" —
  -- unless the automatic switch above has just done it.
  if v_auto then
    v_team := jsonb_build_object('year', p_year, 'previous_year', v_before, 'automatic', true);
  else
    v_team := public.start_team_term(p_year);
  end if;

  if v_pp_name is not null then
    if exists (select 1 from passport.samo_years
                where ended_at is null and team_term_year = p_year) then
      v_passport := jsonb_build_object('moved', false, 'already', true);
    else
      v_quarter := coalesce(substring(v_ss_name from '^\s*[Qq]\s*([1-4])\s*$')::smallint,
                            (passport.schedule_at() ->> 'quarter')::smallint);
      insert into passport.samo_years (name, team_term_year)
           values (v_pp_name, p_year)
        returning id into v_year_id;
      insert into passport.samo_seasons (samo_year_id, name, quarter)
           values (v_year_id, v_ss_name, v_quarter)
        returning id into v_season;

      update passport.samo_seasons set ended_at = now()
       where ended_at is null and id <> v_season;
      update passport.samo_years
         set ended_at = now(),
             team_term_year = coalesce(team_term_year, v_old)
       where ended_at is null and id <> v_year_id;
      perform passport._ack_current_boundary();

      v_passport := jsonb_build_object('moved', true, 'name', v_pp_name,
                                       'season', v_ss_name, 'samo_year_id', v_year_id);
    end if;
  end if;

  return v_team || jsonb_build_object('passport', v_passport);
end $fn$;
