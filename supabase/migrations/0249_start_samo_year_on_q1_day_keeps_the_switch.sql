-- 0249 — pressing เริ่มปี SAMO on Q1 day no longer undoes the automatic switch
--
-- FOUND 2026-10-23 in the bug scan of 0248. start_samo_year applies a due
-- automatic switch first (0248), which on Q1 day starts the same year the
-- admin is asking for; start_team_term then raised "ปี … เป็นปีปัจจุบันอยู่แล้ว"
-- and the whole transaction — the automatic switch included — rolled back. A
-- loop: every press failed the same way until some other write applied it.
-- Rebuilt from 0248's body (= live); one added early return.
--
-- ⚠️ UNFINISHED (2026-10-23): applied to samo-dev ONLY, NOT production, and it
-- does NOT yet fix the loop — year0248-one-year-system.sql case 40 is still red
-- with it. Diagnose before applying anywhere else: HANDOFF §31c.

begin;

create or replace function public.start_samo_year(
  p_year integer, p_passport_name text default null, p_season_name text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_prev     integer;
  v_team     jsonb;
  v_pp_name  text := nullif(btrim(coalesce(p_passport_name, '')), '');
  v_ss_name  text := nullif(btrim(coalesce(p_season_name, '')), '');
  v_year_id  uuid;
  v_season   uuid;
  v_quarter  smallint;
  v_passport jsonb := jsonb_build_object('moved', false);
begin
  -- 0248: an automatic switch that is due runs first — otherwise the ack at
  -- the end of this function would mark the boundary done without it.
  perform passport.apply_season_schedule();
  select year into v_prev from public.team_terms where is_current limit 1;

  -- 0249: the automatic switch above may have JUST started this very year
  -- (an admin pressing เริ่มปี SAMO on Q1 day before anything else touched the
  -- database). Calling start_team_term again would raise "already current" and
  -- roll the automatic switch back with it — every press, until a scan or a
  -- form applied it first. Report what happened instead.
  if v_prev is not distinct from p_year
     and (select team_term_year from passport.samo_years where ended_at is null
           order by started_at desc limit 1) is not distinct from p_year then
    return jsonb_build_object('year', p_year, 'automatic', true,
      'passport', jsonb_build_object('moved', false, 'already', true));
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

  -- The team half. Raises on its own gate, a bad year, or "already current".
  v_team := public.start_team_term(p_year);

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
             team_term_year = coalesce(team_term_year, v_prev)
       where ended_at is null and id <> v_year_id;
      perform passport._ack_current_boundary();

      v_passport := jsonb_build_object('moved', true, 'name', v_pp_name,
                                       'season', v_ss_name, 'samo_year_id', v_year_id);
    end if;
  end if;

  return v_team || jsonb_build_object('passport', v_passport);
end $fn$;

commit;
