-- 0244 — ปีการศึกษา changes itself at a cutoff, and an admin can still set it
--
-- ASKED (owner, 2026-10-23): "make ปีการศึกษา will automatically change itself
-- every 31 june because the university in history opens at sometime 17-27 june
-- … in case admin in later years forgot to change. but still make admin can
-- change it or change back manually, can adjust the date time month cutoff".
--
-- This REVERSES the stance 0141 took ("it reminds; it never acts", study-year.js)
-- — by the owner's decision, not by drift. 0141's worry was a system that moves
-- 1,800 ชั้นปี on a day the faculty did not pick. The answer here keeps the
-- admin in charge of that day: the cutoff is theirs to set, and a value they
-- set by hand STANDS until the next cutoff passes.
--
-- ⚠️ "31 June" does not exist. The default cutoff is 1 ก.ค. 00:00 (Asia/Bangkok)
-- — the instant June ends, after the 17–27 June opening the owner described.
-- It is a setting, not a constant.
--
-- THE SHAPE, and why it is DERIVED rather than written by a timer.
--   * ONE resolver, public.academic_year_resolve(), decides the value every
--     reader sees. get_academic_year(), academic_year_status() and (through
--     get_academic_year) get_my_team_seat() all ask it. Nothing writes "the new
--     year" at the cutoff: the cutoff is a FACT about the clock, so the value is
--     computed from it. No pg_cron (not enabled), no VM timer to forget to
--     schedule (docs/mistakes/deploy-hosting.md: `enable` is not `schedule`),
--     no first-request race.
--   * The rule: with auto ON, the calendar's ปีการศึกษา wins UNLESS an admin set
--     the value AFTER the most recent cutoff — then theirs stands until the next
--     one. So "change it" and "change it back" both work, and a forgotten year
--     still advances the following June. With auto OFF the stored value is the
--     answer, exactly as 0141 behaved.
--   * "set after the cutoff" needs to know WHEN it was set. That is stamped by a
--     TRIGGER on house_settings, not inside set_academic_year: house admins can
--     also UPDATE the table directly (house_settings_admin_all), and a stamp
--     held in one writer is a rule held on one path (class 4).
--   * Changing the SCHEDULE never moves today's year. Saving a new cutoff or
--     switching auto on first pins the value the page was showing, so the next
--     change is the next cutoff — not an instant jump nobody pressed.
--
-- BACKFILL: academic_year_set_at := updated_at (2026-08-07 on production).
-- That is after the 1 ก.ค. 2026 cutoff, so today's answer is the stored 2569 —
-- which is also what the calendar says. Nothing a person sees changes today.

begin;

-- ── 1. the schedule + the stamp ───────────────────────────────────────────
alter table public.house_settings
  add column if not exists academic_auto          boolean  not null default true,
  add column if not exists academic_cutoff_month  smallint not null default 7,
  add column if not exists academic_cutoff_day    smallint not null default 1,
  add column if not exists academic_cutoff_time   time     not null default '00:00',
  add column if not exists academic_year_set_at   timestamptz;

alter table public.house_settings drop constraint if exists house_settings_academic_cutoff_ok;
alter table public.house_settings add constraint house_settings_academic_cutoff_ok check (
  academic_cutoff_month between 1 and 12
  and academic_cutoff_day between 1 and case academic_cutoff_month
        when 2 then 28 when 4 then 30 when 6 then 30 when 9 then 30 when 11 then 30 else 31 end
);

comment on column public.house_settings.academic_auto is
  'ON: at the cutoff each year the ปีการศึกษา becomes the calendar''s, unless an admin set it after that cutoff (0244). OFF: academic_year is the answer, as in 0141.';
comment on column public.house_settings.academic_year_set_at is
  'When academic_year was last changed by a person. Stamped by a trigger on ANY update of it (0244) — never set by hand.';

update public.house_settings
   set academic_year_set_at = coalesce(academic_year_set_at, updated_at, now());

create or replace function public.house_settings_stamp_academic()
returns trigger
language plpgsql
set search_path to 'public'
as $fn$
begin
  if new.academic_year is distinct from old.academic_year then
    new.academic_year_set_at := now();
  end if;
  return new;
end $fn$;

drop trigger if exists house_settings_stamp_academic on public.house_settings;
create trigger house_settings_stamp_academic
  before update on public.house_settings
  for each row execute function public.house_settings_stamp_academic();

-- ── 2. the ONE resolver ───────────────────────────────────────────────────
-- p_now is a parameter so a proof can stand at any instant; every caller in
-- the app passes nothing.
create or replace function public.academic_year_resolve(p_now timestamptz default now())
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $fn$
declare
  s       public.house_settings;
  v_local timestamp := p_now at time zone 'Asia/Bangkok';
  v_y     int       := extract(year from v_local)::int;
  v_this  timestamptz;
  v_last  timestamptz;
  v_next  timestamptz;
  v_cal   int;
  v_eff   int;
  v_src   text;
begin
  select * into s from public.house_settings order by id limit 1;
  if not found then
    return jsonb_build_object('academic_year', null);
  end if;

  v_this := make_timestamptz(v_y, s.academic_cutoff_month, s.academic_cutoff_day,
              extract(hour from s.academic_cutoff_time)::int,
              extract(minute from s.academic_cutoff_time)::int, 0, 'Asia/Bangkok');
  if p_now >= v_this then
    v_cal := v_y + 543;
    v_last := v_this;
    v_next := v_this + interval '1 year';
  else
    v_cal := v_y + 542;
    v_last := v_this - interval '1 year';
    v_next := v_this;
  end if;

  if not s.academic_auto then
    v_eff := coalesce(s.academic_year, v_cal);  v_src := 'manual';
  elsif s.academic_year is not null and s.academic_year_set_at is not null
        and s.academic_year_set_at >= v_last then
    v_eff := s.academic_year;                   v_src := 'manual';
  else
    v_eff := v_cal;                             v_src := 'auto';
  end if;

  return jsonb_build_object(
    'academic_year', v_eff,
    'source',        v_src,
    'clock_year',    v_cal,
    'behind',        greatest(v_cal - v_eff, 0),
    'auto',          s.academic_auto,
    'cutoff_month',  s.academic_cutoff_month,
    'cutoff_day',    s.academic_cutoff_day,
    'cutoff_time',   to_char(s.academic_cutoff_time, 'HH24:MI'),
    'last_cutoff',   v_last,
    'set_at',        s.academic_year_set_at,
    -- What the next cutoff will make it: the calendar's year from then. Null
    -- with auto OFF, when nothing changes by itself.
    'next_change_at', case when s.academic_auto then v_next end,
    'next_value',     case when s.academic_auto then v_cal + 1 end
  );
end $fn$;

revoke all on function public.academic_year_resolve(timestamptz) from public, anon, authenticated;

-- ── 3. every reader asks it ───────────────────────────────────────────────
-- Same signature, same grants (anon keeps get_academic_year: 0141 shipped it so).
create or replace function public.get_academic_year()
returns integer
language sql
stable
security definer
set search_path to 'public'
as $fn$
  select (public.academic_year_resolve() ->> 'academic_year')::int;
$fn$;

create or replace function public.academic_year_status()
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $fn$
  select public.academic_year_resolve();
$fn$;

-- The manual control. Same gate and the same ±1 window as 0141, measured
-- against the CALENDAR's year (it used to be a month>=8 formula, a second
-- home of the cutoff that disagreed with the setting the moment it existed).
create or replace function public.set_academic_year(p_year integer)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_clock int := (public.academic_year_resolve() ->> 'clock_year')::int;
begin
  if not (public.current_user_role() = any (array['vp_admin','dev'])
          or public.current_user_has_permission('house')) then
    raise exception 'ไม่มีสิทธิ์เปลี่ยนปีการศึกษา';
  end if;
  if p_year is null then raise exception 'ต้องระบุปีการศึกษา'; end if;
  if p_year < v_clock - 1 or p_year > v_clock + 1 then
    raise exception 'ปีการศึกษา % ห่างจากปีปัจจุบัน (%) เกินไป — ตั้งได้ระหว่าง % ถึง %',
      p_year, v_clock, v_clock - 1, v_clock + 1;
  end if;

  -- Stamped HERE as well as by the trigger, because the trigger only sees a
  -- CHANGE of the stored value — and "change it back" after an automatic move
  -- usually writes the value that is ALREADY stored (2569 stays in the column
  -- while the cutoff makes the answer 2570). Without this stamp that press
  -- would change nothing and the automatic year would keep winning.
  update public.house_settings
     set academic_year = p_year, academic_year_set_at = now(), updated_at = now()
   where id = (select id from public.house_settings order by id limit 1);

  return public.academic_year_resolve();
end $fn$;

-- The schedule control, same gate.
create or replace function public.set_academic_year_schedule(
  p_auto boolean, p_month integer, p_day integer, p_time text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_now  int := (public.academic_year_resolve() ->> 'academic_year')::int;
  v_time time;
  v_max  int;
begin
  if not (public.current_user_role() = any (array['vp_admin','dev'])
          or public.current_user_has_permission('house')) then
    raise exception 'ไม่มีสิทธิ์ตั้งวันเปลี่ยนปีการศึกษา';
  end if;
  if p_auto is null or p_month is null or p_day is null or p_time is null then
    raise exception 'ต้องระบุให้ครบ: เปิด/ปิด เดือน วัน และเวลา';
  end if;
  begin
    v_time := p_time::time;
  exception when others then
    raise exception 'เวลาไม่ถูกต้อง: % (ใช้รูปแบบ 00:00)', p_time;
  end;
  -- The month length is computed FIRST: a CASE inside an IF condition ends the
  -- condition at the CASE's own THEN (plpgsql scans to the first one).
  v_max := case p_month when 2 then 28 when 4 then 30 when 6 then 30 when 9 then 30
                        when 11 then 30 else 31 end;
  if p_month < 1 or p_month > 12 or p_day < 1 or p_day > v_max then
    raise exception 'วันที่ %/% ไม่มีในปฏิทิน (กุมภาพันธ์ตั้งได้ถึงวันที่ 28)', p_day, p_month;
  end if;

  -- Pin today's value FIRST, so a new cutoff (or switching auto back on) can
  -- never change the ปีการศึกษา the moment it is saved.
  update public.house_settings
     set academic_auto         = p_auto,
         academic_cutoff_month = p_month,
         academic_cutoff_day   = p_day,
         academic_cutoff_time  = date_trunc('minute', v_time)::time,
         academic_year         = v_now,
         academic_year_set_at  = now(),
         updated_at            = now()
   where id = (select id from public.house_settings order by id limit 1);

  return public.academic_year_resolve();
end $fn$;

revoke all on function public.set_academic_year_schedule(boolean, integer, integer, text) from public, anon;
grant execute on function public.set_academic_year_schedule(boolean, integer, integer, text) to authenticated;

commit;
