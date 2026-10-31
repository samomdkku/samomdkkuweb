-- 0267 — An activity has an EVENT DATE: its points go to that date's quarter,
--        and its QR scans for a window (two months by default) that no quarter
--        boundary cuts.
--
-- AGREED (the ฝ่าย, Discord, 2026-10-23 20:28–20:34, relayed by the owner):
--   "ใส่วันที่จัดโครงการ -> คะแนนเข้า Q วันนั้น
--    สแกนมีอายุ 2 เดือน นับจากวันนั้น ไม่ยุ่งเกี่ยวกับ Q" — "สวย deal"
--   "ไม่ใช้คำว่า q นะ ขอเป็นวันที่" (the admin enters a DATE, never picks a Q)
--   "สแกนมีอายุ วันไหนถึงวันไหน -> เลือกวันที่ (default ไว้ แต่มีช่องขึ้นให้ติ้ก
--    ถ้าอยากปรับ)" (the expiry is automatic; a tick box reveals it for the
--    rare activity that needs longer)
--   "คะแนนย้ายตาม q admin ตั้งได้แบบ dynamic เลย" (change the date → the
--    points move — 0246's rules, now reached through the date)
--   the community camps: "สแกนได้ถึงที่ตั้งไว้ แต่คะแนนจะนับใน 69" (a scan after
--    a new วาระ began still counts in the วาระ of the event)
--
-- WHAT IT REPLACES. Since 0180 a QR died the moment its quarter's season
-- closed, and since 0245 the admin chose the quarter. Both hurt the same
-- events: a 30–31 ส.ค. seminar got one day before Q2 closed; an activity
-- created in Q2 for a Q3 event (OSCE, HRD Landmark) had to be moved by hand.
-- Now the date decides the quarter, and the window — not the season — decides
-- whether a scan is accepted:
--   event_date ≤ today (Asia/Bangkok) ≤ scan_until
-- with scan_until = event_date + 2 months unless the admin ticked the box
-- (scan_until_set). A scan inside the window is credited to the activity's
-- quarter even when that quarter has closed — that is the agreement, not a
-- fallback: the points never go to "whatever is open" (docs/INVARIANTS.md).
--
-- THE SHAPE.
--   * passport._resolve_event_date(date) — the ONE place a date becomes
--     (วาระ, quarter, season). The trigger and the admin page's preview
--     (activity_date_info) both ask it, so the line the admin reads before
--     saving is the answer the save gets.
--   * The schedule (0245) maps the date, so an event is filed by the calendar
--     the SAMO set, not by which season happened to be open.
--   * quarter / samo_year_id / season_id stay — every leaderboard and 0246's
--     move-the-points trigger read them — but they are DERIVED from the date.
--     An older client that still sends `quarter` gets a date inside that
--     quarter (today, clamped into it), so a tab left open keeps working.
--   * 0246's move rules are unchanged; a date change is a move whenever it
--     lands in another quarter.
--   * A person may not CREATE an activity whose window has already passed (a
--     dead poster). Any admin may file an event in a closed quarter while its
--     window is open — the OSCE case; moving EXISTING points into a closed
--     quarter stays org-wide only (0246).
--
-- THE BACKFILL never changes what a QR does today. event_date = the day the
-- activity was created, clamped into its quarter. scan_until:
--   * season CLOSED → the day before it closed: a dead QR stays dead;
--   * season open, or waiting for its quarter → event_date + 2 months, or the
--     last day of its quarter if later: a live QR is never shortened.
-- Both directions are asserted before commit.

begin;

-- ── 1. the columns ─────────────────────────────────────────────────────────
alter table passport.activities
  add column if not exists event_date date,
  add column if not exists scan_until date,
  add column if not exists scan_until_set boolean not null default false;

comment on column passport.activities.event_date is
  'The (first) day of the event, Asia/Bangkok. Its quarter is where the points go; scanning opens on this day (0267).';
comment on column passport.activities.scan_until is
  'The last day the QR scans, inclusive, Asia/Bangkok. event_date + 2 months unless scan_until_set (0267).';
comment on column passport.activities.scan_until_set is
  'true = an admin set scan_until by hand (the tick box). false = the trigger keeps it at event_date + 2 months (0267).';

-- ── 2. helpers ─────────────────────────────────────────────────────────────
create or replace function passport._bkk_today()
returns date
language sql
stable
as $fn$
  select (now() at time zone 'Asia/Bangkok')::date;
$fn$;

/** The วาระ (CE year of its Q1) a samo_years row belongs to: its ปี SAMO
 *  bridge when it has one, else the วาระ its start falls in. */
create or replace function passport._year_vara(p_year uuid)
returns integer
language sql
stable
security definer
set search_path to 'passport'
as $fn$
  select coalesce(y.team_term_year - 543, (passport.schedule_at(y.started_at) ->> 'vara_year')::int)
    from passport.samo_years y where y.id = p_year;
$fn$;

/** The DAYS of quarter p_q of วาระ p_vara, [first, after-last). A day belongs
 *  to the quarter in force at its 00:00, so a boundary set at 08:30 puts that
 *  day in the quarter BEFORE it — the same rule _resolve_event_date applies. */
create or replace function passport._quarter_days(p_vara integer, p_q integer)
returns daterange
language plpgsql
stable
security definer
set search_path to 'passport'
as $fn$
declare
  s  passport.season_schedule;
  st timestamptz[];
  b  timestamptz;
  e  timestamptz;
begin
  if p_vara is null or p_q is null or p_q not between 1 and 4 then return null; end if;
  select * into s from passport.season_schedule where id;
  st := passport._quarter_starts(p_vara, s);
  b  := st[p_q];
  e  := case when p_q < 4 then st[p_q + 1] else (passport._quarter_starts(p_vara + 1, s))[1] end;
  return daterange(
    (b at time zone 'Asia/Bangkok')::date + case when (b at time zone 'Asia/Bangkok')::time > '00:00' then 1 else 0 end,
    (e at time zone 'Asia/Bangkok')::date + case when (e at time zone 'Asia/Bangkok')::time > '00:00' then 1 else 0 end,
    '[)');
end $fn$;

create or replace function passport._clamp_day(p_d date, p_r daterange)
returns date
language sql
immutable
as $fn$
  select case when p_r is null or isempty(p_r) then p_d
              else least(greatest(p_d, lower(p_r)), upper(p_r) - 1) end;
$fn$;

/** THE answer to "this event date — which วาระ, quarter and season?".
 *  p_prefer: the activity's current วาระ, kept when it is the date's วาระ too
 *  (two rows may carry the same ปี — an old unbridged one and its successor).
 *  Never raises: { ok:false, error } says why, for the page to show. */
create or replace function passport._resolve_event_date(p_date date, p_prefer uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'passport'
as $fn$
declare
  v_ts  timestamptz;
  sch   jsonb;
  v     int;
  q     int;
  y     passport.samo_years;
  s     passport.samo_seasons;
  os    passport.samo_seasons;
  rng   daterange;
  state text;
begin
  if p_date is null then
    return jsonb_build_object('ok', false, 'error', 'NO_DATE');
  end if;
  v_ts := p_date::timestamp at time zone 'Asia/Bangkok';
  sch  := passport.schedule_at(v_ts);
  v    := (sch ->> 'vara_year')::int;
  q    := (sch ->> 'quarter')::int;
  rng  := passport._quarter_days(v, q);

  select yy.* into y from passport.samo_years yy
   where passport._year_vara(yy.id) = v
   order by (yy.id = p_prefer) desc nulls last, (yy.ended_at is null) desc, yy.started_at desc
   limit 1;

  if y.id is null then
    return jsonb_build_object('ok', false,
      'error', case when v_ts > now() then 'VARA_NOT_STARTED' else 'QUARTER_CLOSED' end,
      'quarter', q, 'label', 'Q' || q, 'be', v + 543,
      'starts', lower(rng), 'ends', upper(rng) - 1);
  end if;

  select * into s from passport.samo_seasons where samo_year_id = y.id and quarter = q;
  if s.id is not null then
    state := case when s.ended_at is null then 'open' else 'closed' end;
  else
    -- No season yet: only a quarter AHEAD of the open one, in an open วาระ,
    -- waits for its rollover (0245's rule, unchanged).
    select * into os from passport.samo_seasons where ended_at is null order by started_at desc limit 1;
    if y.ended_at is not null
       or (os.samo_year_id = y.id
           and q < coalesce(os.quarter, (passport.schedule_at() ->> 'quarter')::int)) then
      return jsonb_build_object('ok', false, 'error', 'QUARTER_CLOSED',
        'quarter', q, 'label', 'Q' || q, 'be', v + 543, 'vara_name', y.name,
        'starts', lower(rng), 'ends', upper(rng) - 1);
    end if;
    state := 'waiting';
  end if;

  return jsonb_build_object('ok', true,
    'samo_year_id', y.id, 'vara_name', y.name, 'be', v + 543,
    'quarter', q, 'label', 'Q' || q,
    'season_id', s.id, 'state', state,
    'starts', lower(rng), 'ends', upper(rng) - 1);
end $fn$;

-- ── 3. the backfill (before the new trigger exists) ────────────────────────
-- The 0246 trigger fires on UPDATE OF quarter/samo_year_id/season_id only, and
-- activities_move_scans acts on a season change only, so neither sees these.
update passport.activities a
   set event_date = passport._clamp_day((a.created_at at time zone 'Asia/Bangkok')::date,
                                        passport._quarter_days(passport._year_vara(a.samo_year_id), a.quarter))
 where a.event_date is null;

update passport.activities a
   set scan_until = case
         when s.ended_at is not null then
           least(a.event_date + 366,
                 greatest(a.event_date, (s.ended_at at time zone 'Asia/Bangkok')::date - 1))
         else
           least(a.event_date + 366,
                 greatest((a.event_date + interval '2 months')::date,
                          coalesce(upper(passport._quarter_days(passport._year_vara(a.samo_year_id), a.quarter)) - 1,
                                   a.event_date)))
       end
  from passport.activities a2
  left join passport.samo_seasons s on s.id = a2.season_id
 where a2.id = a.id and a.scan_until is null;

update passport.activities
   set scan_until_set = (scan_until <> (event_date + interval '2 months')::date);

-- Nothing a QR does TODAY changed. Both directions, and the third state.
do $assert$
declare
  v_today date := passport._bkk_today();
  n_killed int; n_revived int; n_early int;
begin
  select count(*) into n_killed from passport.activities a join passport.samo_seasons s on s.id = a.season_id
   where s.ended_at is null and not (a.event_date <= v_today and v_today <= a.scan_until);
  select count(*) into n_revived from passport.activities a join passport.samo_seasons s on s.id = a.season_id
   where s.ended_at is not null and a.scan_until >= v_today;
  select count(*) into n_early from passport.activities a
   where a.season_id is null and a.event_date <= v_today;
  if n_killed + n_revived + n_early > 0 then
    raise exception '0267 backfill: % live QR would stop, % dead QR would revive, % waiting QR would open early',
      n_killed, n_revived, n_early;
  end if;
end $assert$;

alter table passport.activities alter column event_date set not null;
alter table passport.activities alter column scan_until set not null;
alter table passport.activities drop constraint if exists activities_scan_window_ok;
alter table passport.activities add constraint activities_scan_window_ok
  check (scan_until >= event_date and scan_until <= event_date + 366);

-- ── 4. the trigger: the date decides ───────────────────────────────────────
-- Rebuilt from the LIVE body (pg_get_functiondef, = 0246's), re-read before
-- writing. Kept: the rollover first on insert; an explicit season decides
-- (the rollover linking a waiting activity, a repair); 0246's move gates.
-- Changed: everything else derives from event_date; scan_until is kept; a
-- person cannot create an already-expired activity; a closed quarter is no
-- longer refused on INSERT (its window decides).
create or replace function passport.activity_season_default()
returns trigger
language plpgsql
security definer
set search_path to 'passport'
as $fn$
declare
  v_person   boolean := auth.uid() is not null;
  v_today    date := passport._bkk_today();
  v_moving   boolean := false;
  v_explicit boolean;
  v_s        passport.samo_seasons;
  v_r        jsonb;
begin
  if tg_op = 'INSERT' then
    perform passport.apply_season_schedule();   -- resolve against the current quarter
  else
    v_moving := new.event_date   is distinct from old.event_date
             or new.season_id    is distinct from old.season_id
             or new.quarter      is distinct from old.quarter
             or new.samo_year_id is distinct from old.samo_year_id;
    if not v_moving
       and new.scan_until     is not distinct from old.scan_until
       and new.scan_until_set is not distinct from old.scan_until_set then
      return new;
    end if;
  end if;

  -- An explicit season with no date of its own: the rollover linking a waiting
  -- activity, a data repair, an insert naming a season. The season decides the
  -- quarter; the date is pulled inside it.
  v_explicit := new.season_id is not null and (
       (tg_op = 'INSERT' and new.event_date is null)
    or (tg_op = 'UPDATE' and new.season_id is distinct from old.season_id
                         and new.event_date is not distinct from old.event_date));

  if v_explicit then
    select * into v_s from passport.samo_seasons where id = new.season_id;
    if not found then raise exception 'SEASON_NOT_FOUND'; end if;
    new.samo_year_id := v_s.samo_year_id;
    new.quarter := coalesce(v_s.quarter, new.quarter,
                            (passport.schedule_at(v_s.started_at) ->> 'quarter')::smallint);
    new.event_date := passport._clamp_day(coalesce(new.event_date, v_today),
      passport._quarter_days(passport._year_vara(new.samo_year_id), new.quarter));
  else
    -- An older client names a QUARTER, not a date: a day inside that quarter —
    -- today if it is inside, else its nearest day.
    if tg_op = 'INSERT' and new.event_date is null then
      new.event_date := case when new.quarter is null then v_today
        else passport._clamp_day(v_today, passport._quarter_days(
               coalesce(passport._year_vara(new.samo_year_id), (passport.schedule_at() ->> 'vara_year')::int),
               new.quarter)) end;
    elsif tg_op = 'UPDATE' and new.event_date is not distinct from old.event_date
          and (new.quarter is distinct from old.quarter or new.samo_year_id is distinct from old.samo_year_id) then
      new.event_date := passport._clamp_day(v_today, passport._quarter_days(
        passport._year_vara(coalesce(new.samo_year_id, old.samo_year_id)), new.quarter));
    end if;

    v_r := passport._resolve_event_date(new.event_date, new.samo_year_id);
    if not coalesce((v_r ->> 'ok')::boolean, false) then
      raise exception '%:Q%', v_r ->> 'error', coalesce(v_r ->> 'quarter', '?');
    end if;
    new.samo_year_id := (v_r ->> 'samo_year_id')::uuid;
    new.quarter      := (v_r ->> 'quarter')::smallint;
    new.season_id    := (v_r ->> 'season_id')::uuid;
  end if;

  -- The window. The default follows the date; a hand-set end stands — unless
  -- the DATE moved under it (this statement left the end alone) and it no
  -- longer fits: then the default takes over rather than refusing the move.
  -- An older client that moves only the quarter knows nothing of the end.
  if tg_op = 'UPDATE' and new.scan_until_set
     and new.event_date is distinct from old.event_date
     and new.scan_until is not distinct from old.scan_until
     and (new.scan_until < new.event_date or new.scan_until > new.event_date + 366) then
    new.scan_until_set := false;
  end if;
  if not new.scan_until_set or new.scan_until is null then
    new.scan_until_set := false;
    new.scan_until := (new.event_date + interval '2 months')::date;
  end if;
  if new.scan_until < new.event_date or new.scan_until > new.event_date + 366 then
    raise exception 'SCAN_UNTIL_INVALID';
  end if;

  if v_person then
    if tg_op = 'INSERT' and new.scan_until < v_today then
      raise exception 'ACTIVITY_EXPIRED:%', to_char(new.scan_until, 'YYYY-MM-DD');
    end if;
    -- 0246: a MOVE is checked against the points it carries.
    if v_moving and new.season_id is distinct from old.season_id then
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
  end if;
  return new;
end $fn$;

drop trigger if exists activities_set_season on passport.activities;
create trigger activities_set_season
  before insert or update of quarter, samo_year_id, season_id, event_date, scan_until, scan_until_set
  on passport.activities
  for each row execute function passport.activity_season_default();

-- ── 5. stamp_scan: the window decides, the activity's quarter is credited ──
-- Rebuilt from the LIVE body (pg_get_functiondef, = 0245's), re-read before
-- writing. Changed: the 0180 "season closed" refusal is replaced by the scan
-- window; nothing else. The points still go to the ACTIVITY's season — never
-- the open one.
create or replace function passport.stamp_scan(p_activity_id uuid, p_token text)
returns passport.scans
language plpgsql
security definer
set search_path to 'passport'
as $fn$
declare
  v_uid    uuid := auth.uid();
  v_email  text;
  v_moved  text;
  v_act    passport.activities;
  v_year   uuid;
  v_season uuid;
  v_vy     int;
  v_today  date;
  v_row    passport.scans;
begin
  -- fail CLOSED on every missing input (samoweb mistakes.md: `null in (...)`
  -- makes a raise-guard fail OPEN, so each check is explicit)
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_activity_id is null or p_token is null or btrim(p_token) = '' then
    raise exception 'INVALID_TOKEN';
  end if;

  select lower(btrim(email)) into v_email from auth.users where id = v_uid;
  if v_email is null or v_email = '' then raise exception 'AUTH_REQUIRED'; end if;

  -- kkumail-only, mirroring js/auth.js getPassportAccess
  if not (v_email like '%@kkumail.com' or v_email = 'pmphuriphat@gmail.com') then
    raise exception 'NOT_KKUMAIL';
  end if;

  -- an account whose data was migrated AWAY may not stamp
  select to_email into v_moved
    from passport.account_migrations where lower(from_email) = v_email limit 1;
  if v_moved is not null then raise exception 'ACCOUNT_MOVED:%', v_moved; end if;

  -- 0245: a boundary that passed since the last scan is applied BEFORE this
  -- scan is filed, so a waiting activity is linked to its new season.
  perform passport.apply_season_schedule();

  select * into v_act from passport.activities where id = p_activity_id;
  if not found then raise exception 'ACTIVITY_NOT_FOUND'; end if;

  -- constant-time-ish compare is unnecessary here (the token is in the QR the
  -- user already holds) but the comparison MUST be `=`, never LIKE — samoweb
  -- 0101: an ILIKE lookup turns the secret into a pattern the caller controls.
  if v_act.static_token is null or v_act.static_token <> p_token then
    raise exception 'INVALID_TOKEN';
  end if;

  -- 0267: the scan window, in Thai days. A NULL bound refuses (fails closed).
  v_today := passport._bkk_today();
  if v_act.event_date is null or v_act.scan_until is null then
    raise exception 'SEASON_CLOSED';
  end if;
  if v_today < v_act.event_date then
    raise exception 'SCAN_NOT_YET:%', to_char(v_act.event_date, 'YYYY-MM-DD');
  end if;
  if v_today > v_act.scan_until then
    raise exception 'SCAN_EXPIRED:%', to_char(v_act.scan_until, 'YYYY-MM-DD');
  end if;

  -- 0245: the points go to the quarter the ACTIVITY names — open or closed.
  v_season := coalesce(v_act.season_id,
    (select id from passport.samo_seasons
      where samo_year_id = v_act.samo_year_id and quarter = v_act.quarter));
  if v_season is null then
    -- Its quarter has no season yet (the automatic switch is off and nobody
    -- started it). Say when it would open, from the activity's OWN วาระ.
    select coalesce(y.team_term_year - 543, (passport.schedule_at(y.started_at) ->> 'vara_year')::int)
      into v_vy from passport.samo_years y where y.id = v_act.samo_year_id;
    raise exception 'SEASON_NOT_OPEN:Q%:%', v_act.quarter,
      coalesce(to_char((passport._quarter_starts(v_vy,
                 (select ss from passport.season_schedule ss where ss.id)))[v_act.quarter]
               at time zone 'Asia/Bangkok', 'YYYY-MM-DD"T"HH24:MI'), '');
  end if;

  -- A season that does not resolve must not count (class 2: fails CLOSED).
  select samo_year_id into v_year from passport.samo_seasons where id = v_season;
  if v_year is null then
    raise exception 'SEASON_CLOSED';
  end if;

  -- on_new_scan updates profiles by user_id; with no row its UPDATE hits 0 rows
  -- and the km is silently lost, so guarantee the row first.
  insert into passport.profiles (id, email, total_km)
       values (v_uid, v_email, 0)
    on conflict (id) do nothing;

  insert into passport.scans
    (user_id, activity_id, points_awarded, activity_name,
     department_id, sub_department_id, samo_year_id, season_id)
  values
    (v_uid, p_activity_id, v_act.base_points_km, v_act.name,
     v_act.department_id, v_act.sub_department_id, v_year, v_season)
  returning * into v_row;   -- on_new_scan doubles marketing-bonus km + adds total_km

  return v_row;
exception
  when unique_violation then raise exception 'ALREADY_STAMPED';
end $fn$;

-- ── 6. what the admin page asks before it saves ───────────────────────────
/** The preview line under the date field: which วาระ/quarter the points go
 *  to, whether that quarter is open, and the default end of scanning. The
 *  SAME resolver the trigger uses — so the preview is the answer. */
create or replace function passport.activity_date_info(p_event_date date, p_activity_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'passport'
as $fn$
declare
  v_prefer uuid;
  v_def    date;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_event_date is null then return jsonb_build_object('ok', false, 'error', 'NO_DATE'); end if;
  if p_activity_id is not null then
    select samo_year_id into v_prefer from passport.activities where id = p_activity_id;
  end if;
  v_def := (p_event_date + interval '2 months')::date;
  return passport._resolve_event_date(p_event_date, v_prefer)
      || jsonb_build_object('event_date', p_event_date,
                            'default_scan_until', v_def,
                            'max_scan_until', p_event_date + 366,
                            'today', passport._bkk_today());
end $fn$;

-- ── 7. grants ─────────────────────────────────────────────────────────────
revoke all on function passport._year_vara(uuid)                    from public, anon, authenticated;
revoke all on function passport._quarter_days(integer, integer)     from public, anon, authenticated;
revoke all on function passport._resolve_event_date(date, uuid)     from public, anon, authenticated;
revoke all on function passport.activity_date_info(date, uuid)      from public, anon;
grant execute on function passport.activity_date_info(date, uuid)   to authenticated;
-- _bkk_today and _clamp_day read nothing; leaving them callable reveals nothing,
-- but nothing outside the definers above needs them either.
revoke all on function passport._bkk_today()                        from public, anon, authenticated;
revoke all on function passport._clamp_day(date, daterange)         from public, anon, authenticated;

commit;
