-- 0245 — Passport quarters (and วาระสโม) change themselves; an activity names
--        the quarter its points go to; the missed Q3 is repaired backwards
--
-- ASKED (owner, 2026-10-23):
--   "make it automatically change Quater and วาระสโม as Q1 = มีค - พค Q2 = มิย -
--    สค Q3 = กย - พย Q4 = ธค - กพ but admin can change it manually and adjust
--    the date time month cutoff"
--   "you can look for points samopassport recalculate backwards because admin
--    forgot to change that quater of samo so it misclassified some points as Q2"
--   "when creating an activity, admin must specify which quarter the points
--    will be credited to upon scanning (only one quarter can be selected)"
--   "move all points in those activity … to Q3. those 7 is now Q3"
--
-- WHAT WENT WRONG. Nobody pressed "New Season" on 1 ก.ย. 2026, so Q2 stayed
-- open for 7½ weeks: 323 scans (28,150 km, 208 students) and 8 activities made
-- in September–October were filed as Q2, and the Q3 leaderboard never existed.
-- A rollover that depends on a person remembering a date is forgotten by
-- construction — the same argument 0244 answers for ปีการศึกษา.
--
-- THE SHAPE.
--   * passport.season_schedule — ONE row: four quarter starts (month, day,
--     time, Asia/Bangkok), an auto switch, and the last boundary applied.
--     Q1 opens a new วาระสโม. Defaults are the owner's: 1 มี.ค. · 1 มิ.ย. ·
--     1 ก.ย. · 1 ธ.ค., 00:00.
--   * passport.schedule_at(ts) — the ONE place an instant becomes (วาระ,
--     quarter, starts_at, ends_at). Every rollover, the status RPC and the
--     activity picker ask it.
--   * passport.apply_season_schedule() rolls the open season (and, at Q1, the
--     วาระ) when a boundary has passed that was not yet applied. It is called
--     FIRST by stamp_scan and by every activity insert — so a scan can never
--     land in a stale quarter, whether or not anybody opens the admin page and
--     whether or not some timer was scheduled. The status RPC also calls it, so
--     a page that only READS still shows the right quarter. Rows it creates are
--     stamped with the BOUNDARY's instant, not the moment of the first scan.
--     A fast path with no lock returns at once unless a boundary is due, so
--     scans at a busy event are not serialised behind it.
--   * Manual control stays: start_season(q) switches to a quarter (reopening it
--     if it already ran — that is "change it back"), start_vara() opens a new
--     วาระสโม. Each one, and every schedule edit, ACKNOWLEDGES the current
--     boundary, so the automatic step never undoes an admin's choice; it next
--     acts at the next boundary.
--   * An activity carries samo_year_id + quarter, chosen at creation. Its
--     points are credited to THAT quarter (stamp_scan stamps the scan with the
--     activity's season, no longer "whatever is open"), and its QR scans only
--     while that quarter is open — 0180's rule, unchanged. A quarter AHEAD of
--     the open one may be chosen: its season does not exist yet, so season_id
--     is NULL until the rollover creates it and links every activity waiting on
--     it; a scan before then is refused with SEASON_NOT_OPEN and the date.
--     An insert that names no quarter (an old client, a script) still gets the
--     open one, as 0180 did — the UI is what makes the choice required.
--
-- THE REPAIR (one transaction, guarded on the exact state it fixes): Q3 is
-- created with started_at = 1 ก.ย. 2026 00:00 (Asia/Bangkok) and Q2 ended at
-- that instant. Activities created on/after it become Q3, and so does every Q2
-- activity scanned on/after it — the 7 the owner chose ("all 7 to q3"; OSCE ×3,
-- HRD Landmark Aug 2 + Sep 1, MDKKU Community, the สัมมนา). Then EVERY scan of
-- a Q3 activity becomes Q3, including the 27 made before 1 ก.ย. ("move all
-- points in those activity … to Q3"). No km moves: on_scan_points_changed acts
-- on user_id / points_awarded only, and neither is touched.

begin;

-- ── 1. the schedule ──────────────────────────────────────────────────────
create or replace function passport._day_ok(p_month integer, p_day integer)
returns boolean
language sql
immutable
as $fn$
  select p_month between 1 and 12
     and p_day between 1 and case p_month
           when 2 then 28 when 4 then 30 when 6 then 30 when 9 then 30 when 11 then 30 else 31 end;
$fn$;

create table if not exists passport.season_schedule (
  id        boolean primary key default true check (id),
  auto      boolean  not null default true,
  q1_month  smallint not null default 3,  q1_day smallint not null default 1, q1_time time not null default '00:00',
  q2_month  smallint not null default 6,  q2_day smallint not null default 1, q2_time time not null default '00:00',
  q3_month  smallint not null default 9,  q3_day smallint not null default 1, q3_time time not null default '00:00',
  q4_month  smallint not null default 12, q4_day smallint not null default 1, q4_time time not null default '00:00',
  last_applied_boundary timestamptz,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  constraint season_schedule_days_ok check (
    passport._day_ok(q1_month, q1_day) and passport._day_ok(q2_month, q2_day)
    and passport._day_ok(q3_month, q3_day) and passport._day_ok(q4_month, q4_day))
);
comment on table passport.season_schedule is
  'When each Passport quarter starts (Asia/Bangkok); Q1 opens a new วาระสโม. Read and written ONLY through passport.season_status / set_season_schedule (0245).';

-- Deny-all on purpose. pg_default_acl on this project grants anon full rights
-- to every NEW table (0188's lesson), so the revoke is not decoration.
alter table passport.season_schedule enable row level security;
revoke all on passport.season_schedule from public, anon, authenticated;

insert into passport.season_schedule (id) values (true) on conflict (id) do nothing;

/** The four quarter starts of the วาระ whose Q1 falls in CE year p_v. A quarter
 *  whose month/day comes before Q1's in the calendar belongs to the NEXT year
 *  (Q4 = ธ.ค. is year v; a Q4 configured as ม.ค. would be v+1). */
create or replace function passport._quarter_starts(p_v integer, s passport.season_schedule)
returns timestamptz[]
language plpgsql
stable
as $fn$
declare
  m  int[]  := array[s.q1_month, s.q2_month, s.q3_month, s.q4_month];
  d  int[]  := array[s.q1_day,   s.q2_day,   s.q3_day,   s.q4_day];
  t  time[] := array[s.q1_time,  s.q2_time,  s.q3_time,  s.q4_time];
  out timestamptz[] := '{}';
  ts timestamptz;
  q  int;
begin
  for q in 1..4 loop
    ts := make_timestamptz(p_v, m[q], d[q], extract(hour from t[q])::int,
                           extract(minute from t[q])::int, 0, 'Asia/Bangkok');
    if q > 1 and ts < out[1] then
      ts := make_timestamptz(p_v + 1, m[q], d[q], extract(hour from t[q])::int,
                             extract(minute from t[q])::int, 0, 'Asia/Bangkok');
    end if;
    out := out || ts;
  end loop;
  return out;
end $fn$;

/** THE answer to "which quarter is it at p_ts". p_s lets a proof (or the
 *  schedule editor, validating a draft) ask about a schedule not yet saved. */
create or replace function passport.schedule_at(
  p_ts timestamptz default now(), p_s passport.season_schedule default null)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'passport'
as $fn$
declare
  s   passport.season_schedule := p_s;
  v   int;
  st  timestamptz[];
  q   int := 4;
  nxt timestamptz;
begin
  if s.id is null then
    select * into s from passport.season_schedule where id;
  end if;
  v  := extract(year from p_ts at time zone 'Asia/Bangkok')::int;
  st := passport._quarter_starts(v, s);
  if p_ts < st[1] then
    v  := v - 1;
    st := passport._quarter_starts(v, s);
  end if;
  while q > 1 and p_ts < st[q] loop q := q - 1; end loop;
  nxt := case when q < 4 then st[q + 1] else (passport._quarter_starts(v + 1, s))[1] end;
  return jsonb_build_object(
    'vara_year', v, 'be', v + 543, 'quarter', q, 'label', 'Q' || q,
    'starts_at', st[q], 'ends_at', nxt, 'starts', to_jsonb(st));
end $fn$;

-- ── 2. a season knows its quarter ─────────────────────────────────────────
alter table passport.samo_seasons
  add column if not exists quarter smallint check (quarter between 1 and 4);
comment on column passport.samo_seasons.quarter is
  'Which quarter of its วาระ this season is (1–4). Set by every path that opens one (0245); NULL only for a legacy free-text season.';
update passport.samo_seasons
   set quarter = substring(name from '^\s*[Qq]\s*([1-4])\s*$')::smallint
 where quarter is null and name ~ '^\s*[Qq]\s*[1-4]\s*$';
create unique index if not exists samo_seasons_year_quarter_key
  on passport.samo_seasons (samo_year_id, quarter) where quarter is not null;

-- ── 3. the rollover ───────────────────────────────────────────────────────
create or replace function passport.apply_season_schedule(p_now timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path to 'passport'
as $fn$
declare
  s      passport.season_schedule;
  cur    jsonb;
  b      timestamptz;
  q      int;
  be     int;
  os     passport.samo_seasons;
  oy     passport.samo_years;
  ny     uuid;
  ns     uuid;
  v_new_year boolean := false;
  v_reopened boolean := false;
begin
  -- Fast path, no lock: nothing is due almost always.
  select * into s from passport.season_schedule where id;
  if not found or not s.auto then
    return jsonb_build_object('applied', false, 'reason', 'off');
  end if;
  cur := passport.schedule_at(p_now, s);
  b   := (cur ->> 'starts_at')::timestamptz;
  if s.last_applied_boundary is not null and b <= s.last_applied_boundary then
    return jsonb_build_object('applied', false, 'reason', 'current');
  end if;

  -- Due. The first caller past a boundary rolls it; the rest wait, then see it done.
  select * into s from passport.season_schedule where id for update;
  if not s.auto or (s.last_applied_boundary is not null and b <= s.last_applied_boundary) then
    return jsonb_build_object('applied', false, 'reason', 'current');
  end if;
  -- Recorded BEFORE anything below, so the activity UPDATE at the end (whose
  -- trigger is allowed to call this) finds the boundary already applied.
  update passport.season_schedule set last_applied_boundary = b where id;

  q  := (cur ->> 'quarter')::int;
  be := (cur ->> 'be')::int;
  select * into os from passport.samo_seasons where ended_at is null order by started_at desc limit 1;
  select * into oy from passport.samo_years   where ended_at is null order by started_at desc limit 1;

  -- An admin already started something for this period (manual start after
  -- the boundary): theirs stands.
  if os.id is not null and os.started_at >= b then
    return jsonb_build_object('applied', false, 'reason', 'admin');
  end if;

  if oy.id is null or (q = 1 and oy.team_term_year is distinct from be) then
    insert into passport.samo_years (name, started_at, team_term_year)
         values ('MDKKU SAMO''' || right(be::text, 2), b, be)
      returning id into ny;
    v_new_year := true;
  else
    ny := oy.id;
  end if;

  if not v_new_year and os.id is not null and os.samo_year_id = ny and os.quarter = q then
    return jsonb_build_object('applied', false, 'reason', 'already');
  end if;

  select id into ns from passport.samo_seasons where samo_year_id = ny and quarter = q;
  if ns is null then
    insert into passport.samo_seasons (samo_year_id, name, quarter, started_at)
         values (ny, 'Q' || q, q, b)
      returning id into ns;
  else
    update passport.samo_seasons set ended_at = null where id = ns;
    v_reopened := true;
  end if;

  update passport.samo_seasons set ended_at = greatest(b, started_at)
   where ended_at is null and id <> ns;
  if v_new_year then
    update passport.samo_years
       set ended_at = greatest(b, started_at),
           team_term_year = coalesce(team_term_year, be - 1)
     where ended_at is null and id <> ny;
  end if;

  -- Activities that were made AHEAD for this quarter start scanning now.
  update passport.activities set season_id = ns
   where samo_year_id = ny and quarter = q and season_id is null;

  return jsonb_build_object('applied', true, 'at', b, 'quarter', q, 'season_id', ns,
                            'samo_year_id', ny, 'new_year', v_new_year, 'reopened', v_reopened);
end $fn$;

-- ── 4. an activity names its quarter ──────────────────────────────────────
alter table passport.activities
  add column if not exists samo_year_id uuid references passport.samo_years(id),
  add column if not exists quarter smallint check (quarter between 1 and 4);
comment on column passport.activities.quarter is
  'The quarter this activity''s points are credited to, chosen by the admin who creates it (0245). Its QR scans only while that quarter is open.';
comment on column passport.activities.season_id is
  'The season row of (samo_year_id, quarter) once it exists. NULL = a quarter ahead of the open one, linked by apply_season_schedule when it opens (0245).';

update passport.activities a
   set samo_year_id = s.samo_year_id,
       quarter = coalesce(s.quarter, (passport.schedule_at(s.started_at) ->> 'quarter')::smallint)
  from passport.samo_seasons s
 where s.id = a.season_id and (a.samo_year_id is null or a.quarter is null);

alter table passport.activities alter column samo_year_id set not null;
alter table passport.activities alter column quarter      set not null;
alter table passport.activities alter column season_id    drop not null;

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
begin
  if tg_op = 'INSERT' then
    perform passport.apply_season_schedule();   -- the quarter it is checked against is current
  end if;

  -- An explicit season decides the quarter and the วาระ (data repair, and the
  -- rollover linking a waiting activity).
  if new.season_id is not null
     and (tg_op = 'INSERT' or new.season_id is distinct from old.season_id) then
    select * into v_s from passport.samo_seasons where id = new.season_id;
    if not found then raise exception 'SEASON_NOT_FOUND'; end if;
    new.samo_year_id := v_s.samo_year_id;
    new.quarter := coalesce(v_s.quarter, new.quarter,
                            (passport.schedule_at(v_s.started_at) ->> 'quarter')::smallint);
    return new;
  end if;

  if tg_op = 'UPDATE' and new.quarter is not distinct from old.quarter
     and new.samo_year_id is not distinct from old.samo_year_id then
    return new;
  end if;

  select * into v_os from passport.samo_seasons where ended_at is null order by started_at desc limit 1;

  if new.quarter is null then
    -- No choice made (an older client, a script): the open quarter, as 0180 did.
    -- A gap between seasons refuses rather than handing out a dead poster.
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
    if v_s.ended_at is not null then raise exception 'QUARTER_CLOSED:Q%', new.quarter; end if;
    new.season_id := v_s.id;
    return new;
  end if;

  -- A quarter with no season yet: only AHEAD of the open one, in an open วาระ.
  if (select ended_at from passport.samo_years where id = new.samo_year_id) is not null then
    raise exception 'QUARTER_CLOSED:Q%', new.quarter;
  end if;
  v_q := coalesce(v_os.quarter, (passport.schedule_at() ->> 'quarter')::int);
  if v_os.samo_year_id = new.samo_year_id and new.quarter < v_q then
    raise exception 'QUARTER_CLOSED:Q%', new.quarter;
  end if;
  new.season_id := null;
  return new;
end $fn$;

drop trigger if exists activities_set_season on passport.activities;
create trigger activities_set_season
  before insert or update of quarter, samo_year_id, season_id on passport.activities
  for each row execute function passport.activity_season_default();

-- ── 5. stamp_scan credits the ACTIVITY's quarter ─────────────────────────
-- Rebuilt from the LIVE body (pg_get_functiondef, md5 330df116…, identical to
-- 0180's), re-read immediately before writing this. Changes: the rollover runs
-- first; the season comes from the activity; a quarter not open yet says when.
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
  v_open   boolean;
  v_vy     int;
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
  -- scan is filed, so no scan can land in a stale quarter.
  perform passport.apply_season_schedule();

  select * into v_act from passport.activities where id = p_activity_id;
  if not found then raise exception 'ACTIVITY_NOT_FOUND'; end if;

  -- constant-time-ish compare is unnecessary here (the token is in the QR the
  -- user already holds) but the comparison MUST be `=`, never LIKE — samoweb
  -- 0101: an ILIKE lookup turns the secret into a pattern the caller controls.
  if v_act.static_token is null or v_act.static_token <> p_token then
    raise exception 'INVALID_TOKEN';
  end if;

  -- 0245: the points go to the quarter the ACTIVITY names. season_id is the
  -- link the rollover fills; resolve (วาระ, quarter) too, in case a season was
  -- opened by a path that did not link it.
  v_season := coalesce(v_act.season_id,
    (select id from passport.samo_seasons
      where samo_year_id = v_act.samo_year_id and quarter = v_act.quarter));
  if v_season is null then
    -- Say WHEN it opens, from the activity's OWN วาระ (its ปี SAMO bridge, or
    -- the วาระ its start falls in) — never from today's, which names the wrong
    -- year for an activity filed in the next one.
    select coalesce(y.team_term_year - 543, (passport.schedule_at(y.started_at) ->> 'vara_year')::int)
      into v_vy from passport.samo_years y where y.id = v_act.samo_year_id;
    raise exception 'SEASON_NOT_OPEN:Q%:%', v_act.quarter,
      coalesce(to_char((passport._quarter_starts(v_vy,
                 (select ss from passport.season_schedule ss where ss.id)))[v_act.quarter]
               at time zone 'Asia/Bangkok', 'YYYY-MM-DD"T"HH24:MI'), '');
  end if;

  -- 0180: the quarter this activity belongs to must still be OPEN. NULL raises
  -- too — a scan that cannot be attributed to a quarter must not count.
  select (ended_at is null), samo_year_id into v_open, v_year
    from passport.samo_seasons where id = v_season;
  if v_open is distinct from true then
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

-- ── 6. what the pages read and the manual controls ───────────────────────
create or replace function passport._org_wide()
returns boolean
language sql
stable
security definer
set search_path to 'passport'
as $fn$
  select coalesce((public.passport_admin_context() ->> 'all_departments')::boolean, false);
$fn$;

create or replace function passport._ack_current_boundary()
returns void
language sql
security definer
set search_path to 'passport'
as $fn$
  update passport.season_schedule
     set last_applied_boundary = greatest(coalesce(last_applied_boundary, '-infinity'),
                                          (passport.schedule_at() ->> 'starts_at')::timestamptz)
   where id;
$fn$;

/** Applies any due rollover, then says where Passport stands and which quarters
 *  a NEW activity may be credited to. Every Passport page and /admin/#years. */
create or replace function passport.season_status()
returns jsonb
language plpgsql
security definer
set search_path to 'passport'
as $fn$
declare
  v_apply jsonb;
  s   passport.season_schedule;
  cur jsonb;
  oy  passport.samo_years;
  os  passport.samo_seasons;
  v_q int;
  v_choices jsonb := '[]'::jsonb;
  v_s passport.samo_seasons;
  q   int;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  v_apply := passport.apply_season_schedule();
  select * into s from passport.season_schedule where id;
  cur := passport.schedule_at(now(), s);
  select * into oy from passport.samo_years   where ended_at is null order by started_at desc limit 1;
  select * into os from passport.samo_seasons where ended_at is null order by started_at desc limit 1;

  if oy.id is not null then
    v_q := coalesce(case when os.samo_year_id = oy.id then os.quarter end, (cur ->> 'quarter')::int);
    for q in 1..4 loop
      select * into v_s from passport.samo_seasons where samo_year_id = oy.id and quarter = q;
      if (v_s.id is not null and v_s.ended_at is null) or (v_s.id is null and q > v_q) then
        v_choices := v_choices || jsonb_build_object(
          'quarter', q, 'label', 'Q' || q,
          'starts_at', (cur -> 'starts') ->> (q - 1),
          'ends_at', case when q < 4 then (cur -> 'starts') ->> q
                          else to_jsonb((passport._quarter_starts((cur ->> 'vara_year')::int + 1, s))[1]) #>> '{}' end,
          'open', v_s.id is not null,
          'season_id', v_s.id);
      end if;
    end loop;
  end if;

  return jsonb_build_object(
    'auto', s.auto,
    'quarters', jsonb_build_array(
      jsonb_build_object('quarter', 1, 'month', s.q1_month, 'day', s.q1_day, 'time', to_char(s.q1_time, 'HH24:MI')),
      jsonb_build_object('quarter', 2, 'month', s.q2_month, 'day', s.q2_day, 'time', to_char(s.q2_time, 'HH24:MI')),
      jsonb_build_object('quarter', 3, 'month', s.q3_month, 'day', s.q3_day, 'time', to_char(s.q3_time, 'HH24:MI')),
      jsonb_build_object('quarter', 4, 'month', s.q4_month, 'day', s.q4_day, 'time', to_char(s.q4_time, 'HH24:MI'))),
    'schedule_now', cur,
    'next_change_at', case when s.auto then cur ->> 'ends_at' end,
    'next_label', case when s.auto then case when (cur ->> 'quarter')::int = 4
                    then 'Q1 · วาระสโมใหม่' else 'Q' || ((cur ->> 'quarter')::int + 1) end end,
    'year',   case when oy.id is null then null else jsonb_build_object(
                'id', oy.id, 'name', oy.name, 'started_at', oy.started_at, 'team_term_year', oy.team_term_year) end,
    'season', case when os.id is null then null else jsonb_build_object(
                'id', os.id, 'name', os.name, 'quarter', os.quarter, 'started_at', os.started_at,
                'samo_year_id', os.samo_year_id) end,
    'choices', v_choices,
    'can_manage', passport._org_wide(),
    'applied', v_apply);
end $fn$;

/** Org-wide admins edit the four starts and the auto switch. Saving never
 *  rolls anything: the current boundary is acknowledged, so the next
 *  automatic step is the next boundary. */
create or replace function passport.set_season_schedule(p_auto boolean, p_quarters jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'passport'
as $fn$
declare
  s  passport.season_schedule;
  st timestamptz[];
  nx timestamptz;
  i  int;
  e  jsonb;
  m  int; d int; t time;
begin
  if not passport._org_wide() then
    raise exception 'ตั้งวันเปลี่ยน Quarter ต้องมีสิทธิ์ SAMO Passport ทุกฝ่าย';
  end if;
  if p_auto is null or jsonb_typeof(p_quarters) is distinct from 'array'
     or jsonb_array_length(p_quarters) <> 4 then
    raise exception 'ต้องระบุวันเริ่มของ Q1–Q4 ให้ครบทั้ง 4 ช่วง';
  end if;
  select * into s from passport.season_schedule where id for update;
  s.auto := p_auto;
  for i in 0..3 loop
    e := p_quarters -> i;
    begin
      m := (e ->> 'month')::int; d := (e ->> 'day')::int; t := (e ->> 'time')::time;
    exception when others then
      raise exception 'Q% กรอกไม่ถูกต้อง (เดือน วัน เวลา 00:00)', i + 1;
    end;
    if m is null or d is null or t is null or not passport._day_ok(m, d) then
      raise exception 'Q%: วันที่ %/% ไม่มีในปฏิทิน (กุมภาพันธ์ตั้งได้ถึงวันที่ 28)', i + 1, d, m;
    end if;
    t := date_trunc('minute', t)::time;
    case i
      when 0 then s.q1_month := m; s.q1_day := d; s.q1_time := t;
      when 1 then s.q2_month := m; s.q2_day := d; s.q2_time := t;
      when 2 then s.q3_month := m; s.q3_day := d; s.q3_time := t;
      else        s.q4_month := m; s.q4_day := d; s.q4_time := t;
    end case;
  end loop;

  -- In order, Q1 → Q4, all inside one year from Q1.
  st := passport._quarter_starts(2001, s);
  nx := (passport._quarter_starts(2002, s))[1];
  if not (st[1] < st[2] and st[2] < st[3] and st[3] < st[4] and st[4] < nx) then
    raise exception 'วันเริ่มต้องเรียง Q1 → Q2 → Q3 → Q4 และอยู่ในหนึ่งปีนับจาก Q1';
  end if;

  update passport.season_schedule
     set auto = s.auto,
         q1_month = s.q1_month, q1_day = s.q1_day, q1_time = s.q1_time,
         q2_month = s.q2_month, q2_day = s.q2_day, q2_time = s.q2_time,
         q3_month = s.q3_month, q3_day = s.q3_day, q3_time = s.q3_time,
         q4_month = s.q4_month, q4_day = s.q4_day, q4_time = s.q4_time,
         updated_at = now(), updated_by = auth.uid()
   where id;
  perform passport._ack_current_boundary();
  return passport.season_status();
end $fn$;

/** Switch Passport to quarter p_quarter of the open วาระ — forward, or BACK
 *  (a quarter that already ran is reopened, its season and scans intact). */
create or replace function passport.start_season(p_quarter integer)
returns jsonb
language plpgsql
security definer
set search_path to 'passport'
as $fn$
declare
  oy passport.samo_years;
  ns uuid;
  v_closed timestamptz;
begin
  if not passport._org_wide() then
    raise exception 'เปลี่ยน Quarter ต้องมีสิทธิ์ SAMO Passport ทุกฝ่าย';
  end if;
  if p_quarter is null or p_quarter not between 1 and 4 then
    raise exception 'Quarter ต้องเป็น 1–4';
  end if;
  select * into oy from passport.samo_years where ended_at is null order by started_at desc limit 1;
  if oy.id is null then raise exception 'ยังไม่มีวาระสโมที่เปิดอยู่ — เริ่มวาระสโมก่อน'; end if;

  select id, ended_at into ns, v_closed from passport.samo_seasons
   where samo_year_id = oy.id and quarter = p_quarter;
  if ns is null then
    insert into passport.samo_seasons (samo_year_id, name, quarter)
         values (oy.id, 'Q' || p_quarter, p_quarter)
      returning id into ns;
  elsif v_closed is not null then
    update passport.samo_seasons set ended_at = null where id = ns;
  end if;
  -- Create (or reopen) first, then close the rest — same statement batch, one
  -- transaction, so no reader can see a moment with nothing open.
  update passport.samo_seasons set ended_at = now() where ended_at is null and id <> ns;
  update passport.activities set season_id = ns
   where samo_year_id = oy.id and quarter = p_quarter and season_id is null;
  perform passport._ack_current_boundary();
  return passport.season_status();
end $fn$;

/** A new วาระสโม by hand, with its first quarter. The automatic one at Q1
 *  makes this rare; it exists for a วาระ that must not wait for the date. */
create or replace function passport.start_vara(
  p_name text, p_quarter integer, p_team_term_year integer default null)
returns jsonb
language plpgsql
security definer
set search_path to 'passport'
as $fn$
declare
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  ny uuid;
  ns uuid;
begin
  if not passport._org_wide() then
    raise exception 'เริ่มวาระสโมต้องมีสิทธิ์ SAMO Passport ทุกฝ่าย';
  end if;
  if v_name is null or length(v_name) > 80 then raise exception 'ใส่ชื่อวาระสโม (ไม่เกิน 80 ตัวอักษร)'; end if;
  if p_quarter is null or p_quarter not between 1 and 4 then raise exception 'Quarter ต้องเป็น 1–4'; end if;
  if p_team_term_year is not null and p_team_term_year not between 2500 and 2700 then
    raise exception 'ปีทีม SAMO ต้องเป็นเลขปี พ.ศ.';
  end if;
  insert into passport.samo_years (name, team_term_year) values (v_name, p_team_term_year) returning id into ny;
  insert into passport.samo_seasons (samo_year_id, name, quarter)
       values (ny, 'Q' || p_quarter, p_quarter) returning id into ns;
  update passport.samo_seasons set ended_at = now() where ended_at is null and id <> ns;
  update passport.samo_years   set ended_at = now() where ended_at is null and id <> ny;
  perform passport._ack_current_boundary();
  return passport.season_status();
end $fn$;

-- ── 7. start_samo_year (0242) files its season under a quarter ───────────
-- Rebuilt from the LIVE body (pg_get_functiondef, re-read before writing).
-- One change: the season it opens records its quarter — from the name when it
-- is "Q1"…"Q4", else the schedule's current one — and the boundary is
-- acknowledged, so the automatic step does not roll it straight back.
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

-- ── 8. a วาระ / season is written by ORG-WIDE admins only ─────────────────
-- The policies said passport.is_admin(), which a ฝ่าย-scoped admin also holds;
-- only the admin page's button stopped them rolling everyone's quarter (class
-- 3: the narrow gate was the UI, the broad one the table). Every legitimate
-- writer now is a definer function above, or start_samo_year (definer too), so
-- the table path is narrowed to the same test those functions make.
drop policy if exists samo_seasons_insert on passport.samo_seasons;
drop policy if exists samo_seasons_update on passport.samo_seasons;
drop policy if exists samo_seasons_delete on passport.samo_seasons;
drop policy if exists samo_years_insert   on passport.samo_years;
drop policy if exists samo_years_update   on passport.samo_years;
drop policy if exists samo_years_delete   on passport.samo_years;
create policy samo_seasons_insert on passport.samo_seasons for insert with check (passport._org_wide());
create policy samo_seasons_update on passport.samo_seasons for update using (passport._org_wide()) with check (passport._org_wide());
create policy samo_seasons_delete on passport.samo_seasons for delete using (passport._org_wide());
create policy samo_years_insert   on passport.samo_years   for insert with check (passport._org_wide());
create policy samo_years_update   on passport.samo_years   for update using (passport._org_wide()) with check (passport._org_wide());
create policy samo_years_delete   on passport.samo_years   for delete using (passport._org_wide());

-- ── 9. grants ─────────────────────────────────────────────────────────────
-- Internal machinery: callable by the definer functions above (owner), by
-- nobody through the API.
revoke all on function passport._day_ok(integer, integer)                         from public, anon, authenticated;
revoke all on function passport._quarter_starts(integer, passport.season_schedule) from public, anon, authenticated;
revoke all on function passport.schedule_at(timestamptz, passport.season_schedule) from public, anon, authenticated;
revoke all on function passport.apply_season_schedule(timestamptz)                 from public, anon, authenticated;
-- _org_wide answers only "am I org-wide" about the CALLER; the policies above
-- run as the caller, so they need it.
revoke all on function passport._org_wide()                                        from public, anon;
grant execute on function passport._org_wide()                                     to authenticated;
revoke all on function passport._ack_current_boundary()                            from public, anon, authenticated;
-- What the pages call: signed-in only; the writes check org-wide inside.
revoke all on function passport.season_status()                          from public, anon;
revoke all on function passport.set_season_schedule(boolean, jsonb)       from public, anon;
revoke all on function passport.start_season(integer)                     from public, anon;
revoke all on function passport.start_vara(text, integer, integer)        from public, anon;
grant execute on function passport.season_status()                    to authenticated;
grant execute on function passport.set_season_schedule(boolean, jsonb) to authenticated;
grant execute on function passport.start_season(integer)               to authenticated;
grant execute on function passport.start_vara(text, integer, integer)  to authenticated;

-- ── 10. THE REPAIR — the Q3 nobody started ─────────────────────────────────
-- Guarded on the exact state it fixes (production's Q2 season, still open),
-- so on any other database — CI's empty replay, a dev copy already repaired —
-- it only records the current boundary and changes nothing else.
do $repair$
declare
  v_q2   uuid := 'f79c569a-2cea-4b82-b893-27a345fcf50e';
  v_b    timestamptz := timestamptz '2026-09-01 00:00:00 Asia/Bangkok';
  v_year uuid;
  v_q3   uuid;
  n_act  int;
  n_scan int;
  n_gone int;
begin
  select samo_year_id into v_year from passport.samo_seasons
   where id = v_q2 and ended_at is null and quarter = 2;
  if v_year is null then
    raise notice '0245 repair: season % is not an open Q2 here — nothing to repair', v_q2;
    perform passport._ack_current_boundary();
    return;
  end if;

  insert into passport.samo_seasons (samo_year_id, name, quarter, started_at)
       values (v_year, 'Q3', 3, v_b)
    returning id into v_q3;
  update passport.samo_seasons set ended_at = v_b where id = v_q2;

  -- Activities made on/after 1 ก.ย., and every Q2 activity scanned on/after it
  -- (the owner's "all 7 to q3").
  update passport.activities a set season_id = v_q3
   where a.season_id = v_q2
     and (a.created_at >= v_b
          or exists (select 1 from passport.scans s where s.activity_id = a.id and s.scanned_at >= v_b));
  get diagnostics n_act = row_count;

  -- Every scan of a Q3 activity is Q3 — before 1 ก.ย. too ("move all points in
  -- those activity … to Q3").
  update passport.scans s set season_id = v_q3
    from passport.activities a
   where a.id = s.activity_id and a.season_id = v_q3 and s.season_id is distinct from v_q3;
  get diagnostics n_scan = row_count;

  -- A scan on/after 1 ก.ย. whose activity was since deleted: by when it happened.
  update passport.scans s set season_id = v_q3
   where s.season_id = v_q2 and s.scanned_at >= v_b
     and not exists (select 1 from passport.activities a where a.id = s.activity_id);
  get diagnostics n_gone = row_count;

  update passport.season_schedule set last_applied_boundary = v_b where id;

  -- The invariant the new model rests on, asserted before commit.
  if exists (select 1 from passport.scans s join passport.activities a on a.id = s.activity_id
              where s.season_id is distinct from a.season_id) then
    raise exception '0245 repair: a scan is filed outside its activity''s quarter';
  end if;
  raise notice '0245 repair: % activities → Q3, % scans → Q3, % scans of deleted activities → Q3',
    n_act, n_scan, n_gone;
end $repair$;

commit;
