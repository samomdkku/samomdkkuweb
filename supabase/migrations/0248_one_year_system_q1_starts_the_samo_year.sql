-- 0248 — ONE year system: Q1 (1 มี.ค.) starts the ปี SAMO for every system
--
-- ASKED (owner, 2026-10-23): "will the ปี SAMO ปัจจุบัน 2569 sync with the
-- วาระสโม · Passport MDKKU SAMO'69 … it should be unified because at มีนาคม it
-- should be ปี SAMO 2570 automatically. it should use the same year system for
-- both".
--
-- WHAT IT WAS. Two clocks. 0245 made Passport's Q1 open a new วาระสโม by
-- itself on 1 มี.ค., but the ปี SAMO (team_terms — what PR, VitalSound,
-- หนังสือโครงการ, SAMO Shop and the ทีม SAMO archive file work under) moved
-- only when someone pressed เริ่มปี SAMO. On 1 มี.ค. 2570 Passport would have
-- said SAMO'70 while every other system kept filing under 2569. And the open
-- วาระ "MDKKU SAMO'69" was not even bridged to ปี SAMO 2569.
--
-- THE SHAPE.
--   * Q1's start in passport.season_schedule IS the start of the ปี SAMO. At
--     that boundary apply_season_schedule also starts ปี SAMO <BE of the
--     boundary> — forward only, only if nobody started it already — stamped
--     with the BOUNDARY, archiving the outgoing team exactly as the button does.
--   * It needs to run as SOMEBODY with no rights at all (a student's scan, a
--     guest PR form), so start_team_term / publish_team_term are SPLIT into the
--     permission check (unchanged, the only thing granted) and an unchecked
--     body (_start_team_term / _publish_team_term) that only definer code can
--     reach. One body each — the manual button and the automatic switch cannot
--     drift. Rebuilt from the LIVE bodies (pg_get_functiondef), gates removed
--     by exact text, nothing else retyped.
--   * WHERE it runs: first in stamp_scan, every activity insert, every PR /
--     VitalSound / โครงการ / Shop insert (samo_year_be_default — so no row can
--     be filed under the old year), season_status (Passport pages, /admin/#years,
--     the admin top-bar chip), and every manual year/quarter action before it
--     acknowledges the boundary. No timer, no visitor needed.
--   * Moving Q1 (or switching the automatic change off) now moves the ปี SAMO
--     for every system, so it also takes start_team_term's permission.
--   * The open วาระ "MDKKU SAMO'69" is bridged to ปี SAMO 2569 now.

begin;

-- ── 1. the unchecked bodies ────────────────────────────────────────────────
create or replace function public._publish_team_term(p_year integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_nodes   integer;
  v_members integer;
  v_kept    integer;
begin
  -- coalesce(..., false) is load-bearing. current_user_role() is NULL for a
  -- caller with no public.users row, and `null = any(...)` is NULL, so a bare
  -- `if not (...)` would evaluate `not null` = null, skip the raise, and run the
  -- privileged body.
  -- 0248: the permission check lives in publish_team_term(); this is the body.

  if p_year is null or p_year < 2500 or p_year > 2700 then
    raise exception 'publish_team_term: bad year %', p_year;
  end if;

  insert into public.team_terms (year) values (p_year)
    on conflict (year) do nothing;

  create temp table if not exists _pub_photos (
    src_member_id uuid primary key, photo_url text, photo_focus text
  ) on commit drop;
  -- `where true` is load-bearing: PostgREST sessions preload safeupdate
  -- (authenticator's session_preload_libraries), which refuses a DELETE with
  -- no WHERE — "DELETE requires a WHERE clause" — even inside this function.
  delete from _pub_photos where true;
  insert into _pub_photos (src_member_id, photo_url, photo_focus)
  select distinct on (am.src_member_id) am.src_member_id, am.photo_url, am.photo_focus
    from public.team_archive_members am
   where am.year = p_year
     and am.src_member_id is not null
     and am.photo_url is not null
   order by am.src_member_id, am.id;

  delete from public.team_archive_nodes where year = p_year;

  -- `as materialized` is required, not stylistic: `mapped` is referenced twice
  -- and contains gen_random_uuid(). Inlined, each reference would generate a
  -- DIFFERENT uuid and every parent_id lookup would come back null, silently
  -- flattening the tree.
  with recursive live as (
    select n.id, n.parent_id, n.name, n.kind, n.position, n.is_board,
           n.color, n.tier
      from public.team_nodes n
     where n.parent_id is null and n.is_public
    union all
    select c.id, c.parent_id, c.name, c.kind, c.position, c.is_board,
           c.color, c.tier
      from public.team_nodes c
      join live l on c.parent_id = l.id
     where c.is_public
  ),
  mapped as materialized (
    select l.*, gen_random_uuid() as new_id from live l
  )
  insert into public.team_archive_nodes
        (id, year, src_id, parent_id, name, kind, position, is_board, color, tier)
  select m.new_id, p_year, m.id,
         (select p.new_id from mapped p where p.id = m.parent_id),
         m.name, m.kind, m.position, m.is_board, m.color, m.tier
    from mapped m;
  get diagnostics v_nodes = ROW_COUNT;

  insert into public.team_archive_members
        (year, node_id, src_member_id, full_name, nickname, photo_url, photo_focus, position)
  select p_year, an.id, m.id, m.full_name, m.nickname,
         coalesce(m.photo_url,   p.photo_url),
         coalesce(m.photo_focus, p.photo_focus),
         m.position
    from public.team_members m
    join public.team_archive_nodes an on an.year = p_year and an.src_id = m.node_id
    left join _pub_photos p on p.src_member_id = m.id;
  get diagnostics v_members = ROW_COUNT;

  select count(*) into v_kept
    from public.team_archive_members am
    join _pub_photos p on p.src_member_id = am.src_member_id
    join public.team_members m on m.id = am.src_member_id
   where am.year = p_year and m.photo_url is null;

  update public.team_terms
     set published_at = now(), updated_at = now()
   where year = p_year;

  return jsonb_build_object('year', p_year, 'nodes', v_nodes,
                            'members', v_members, 'photos_kept', v_kept);
end;
$function$;

create or replace function public._start_team_term(p_year integer, p_at timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_current integer;
  v_now     timestamptz := coalesce(p_at, now());   -- 0248: the automatic switch passes the BOUNDARY
  v_closed  integer;
  v_archive jsonb := null;
begin
  -- 0248: the permission check lives in start_team_term(); this is the body,
  -- also run by the automatic ปี SAMO switch at Q1 (apply_season_schedule).

  if p_year is null or p_year < 2500 or p_year > 2700 then
    raise exception 'start_team_term: bad year %', p_year;
  end if;

  select year into v_current from public.team_terms where is_current limit 1;

  -- Edge case 5 (docs/YEAR-ROLLOVER.md): a double-run must refuse with a
  -- clear message, never silently re-open the same term.
  if v_current is not distinct from p_year then
    raise exception 'start_team_term: ปี % เป็นปีปัจจุบันอยู่แล้ว', p_year;
  end if;

  -- 0224 ADD: archive the OUTGOING term exactly as the live tree stands RIGHT
  -- NOW, before anything below (or any later edit) can touch it — unless it
  -- already has an archive (see this file's header). Same call
  -- the "เผยแพร่ปีนี้/เผยแพร่ซ้ำ" button already makes — this just makes it
  -- automatic at the one moment it must not be skipped or mis-ordered. Only
  -- when v_current exists: a from-scratch bootstrap with no current term yet
  -- has nothing to archive.
  -- Never over an EXISTING archive: publish_team_term deletes and rebuilds,
  -- so re-running it here would replace a correct snapshot (and every
  -- correction made to it) with whatever the live tree holds now.
  if v_current is not null and exists (
       select 1 from public.team_terms
        where year = v_current and published_at is null) then
    select public._publish_team_term(v_current) into v_archive;
  end if;

  -- Close the outgoing term FIRST: team_terms_one_current (0104) is a partial
  -- unique index on is_current, so a second row cannot become true while the
  -- first still is. Both statements are ONE plpgsql call, hence one
  -- transaction — no other session can ever see zero current terms between
  -- them, unlike the two separate PATCH requests this RPC replaces.
  --
  -- started_at = coalesce(started_at, '-infinity') FIXES THE GENESIS ROW the
  -- instant it first closes — unchanged from 0219; see that migration's
  -- header for the full reasoning (reproduced in a rolled-back probe there
  -- before the fix existed).
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
    'started_at', v_now, 'closed_terms', v_closed,
    'archived_outgoing', (v_archive is not null)
  );
end;
$function$;

revoke all on function public._publish_team_term(integer) from public, anon, authenticated;
revoke all on function public._start_team_term(integer, timestamptz) from public, anon, authenticated;

-- ── 2. the buttons: the same permission check, then the one body ──────────
create or replace function public.publish_team_term(p_year integer)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
begin
  -- coalesce(..., false) is load-bearing (0218): a caller with no users row
  -- makes the comparison NULL, and "not null" would skip the raise.
  if not coalesce(
       public.current_user_role() = any (array['vp_admin', 'dev'])
       or public.current_user_has_permission('team_edit'), false) then
    raise exception 'publish_team_term: not authorized';
  end if;
  return public._publish_team_term(p_year);
end $fn$;

create or replace function public.start_team_term(p_year integer)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
begin
  -- 0224: 'team_edit', not 'team' (a VIEW grant every ทีม SAMO posting has).
  if not coalesce(
       public.current_user_role() = any (array['vp_admin', 'dev'])
       or public.current_user_has_permission('team_edit'), false) then
    raise exception 'start_team_term: ไม่มีสิทธิ์';
  end if;
  return public._start_team_term(p_year, now());
end $fn$;

-- ── 3. the rollover moves the ปี SAMO at Q1 ────────────────────────────────
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
  v_team int;
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

  -- 0248: ONE year system. Q1 is also the start of the ปี SAMO, so every
  -- system that files work by year (PR, VitalSound, หนังสือโครงการ, SAMO Shop,
  -- the ทีม SAMO archive) moves at the same instant Passport opens its วาระ.
  -- Only FORWARD, and only if nobody started it already (by hand, early).
  -- Stamped with the boundary, so samo_year_for_timestamp agrees with it.
  if q = 1 and coalesce(public.current_samo_year(), 0) < be then
    perform public._start_team_term(be, b);
    v_team := be;
  end if;
  select * into os from passport.samo_seasons where ended_at is null order by started_at desc limit 1;
  select * into oy from passport.samo_years   where ended_at is null order by started_at desc limit 1;

  -- An admin already started something for this period (manual start after
  -- the boundary): theirs stands.
  if os.id is not null and os.started_at >= b then
    return jsonb_build_object('applied', false, 'reason', 'admin', 'samo_year', v_team);
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
    return jsonb_build_object('applied', false, 'reason', 'already', 'samo_year', v_team);
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
                            'samo_year_id', ny, 'new_year', v_new_year, 'reopened', v_reopened,
                            'samo_year', v_team);
end $fn$;

-- ── 4. every PR / VitalSound / โครงการ / Shop row applies a due switch first ─
-- SECURITY DEFINER now: the guest PR form inserts as anon, and the switch it
-- may trigger writes tables anon cannot touch.
create or replace function public.samo_year_be_default()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $fn$
begin
  if new.samo_year_be is null then
    perform passport.apply_season_schedule();   -- 0248: 1 มี.ค. moves the year before this row is filed
    new.samo_year_be := public.current_samo_year();
  end if;
  return new;
end $fn$;

-- ── 5. manual actions apply first, then acknowledge ───────────────────────
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
  perform passport.apply_season_schedule();   -- 0248: a due switch first, so the ack below cannot swallow it
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
  perform passport.apply_season_schedule();   -- 0248: a due switch first, so the ack below cannot swallow it
  insert into passport.samo_years (name, team_term_year) values (v_name, p_team_term_year) returning id into ny;
  insert into passport.samo_seasons (samo_year_id, name, quarter)
       values (ny, 'Q' || p_quarter, p_quarter) returning id into ns;
  update passport.samo_seasons set ended_at = now() where ended_at is null and id <> ns;
  update passport.samo_years   set ended_at = now() where ended_at is null and id <> ny;
  perform passport._ack_current_boundary();
  return passport.season_status();
end $fn$;

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
  v_old passport.season_schedule;
begin
  if not passport._org_wide() then
    raise exception 'ตั้งวันเปลี่ยน Quarter ต้องมีสิทธิ์ SAMO Passport ทุกฝ่าย';
  end if;
  if p_auto is null or jsonb_typeof(p_quarters) is distinct from 'array'
     or jsonb_array_length(p_quarters) <> 4 then
    raise exception 'ต้องระบุวันเริ่มของ Q1–Q4 ให้ครบทั้ง 4 ช่วง';
  end if;
  perform passport.apply_season_schedule();   -- 0248: a due switch first, so the ack below cannot swallow it
  select * into s from passport.season_schedule where id for update;
  v_old := s;
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

  -- 0248: Q1 is the start of the ปี SAMO for EVERY system, so moving it (or
  -- switching the automatic change off) is also start_team_term's decision.
  if (s.auto, s.q1_month, s.q1_day, s.q1_time) is distinct from (v_old.auto, v_old.q1_month, v_old.q1_day, v_old.q1_time)
     and not coalesce(public.current_user_role() = any (array['vp_admin', 'dev'])
                      or public.current_user_has_permission('team_edit'), false) then
    raise exception 'วันเริ่ม Q1 คือวันเริ่มปี SAMO ของทุกระบบ — แก้ Q1 หรือปิดการเปลี่ยนอัตโนมัติต้องมีสิทธิ์แก้ไขทีม SAMO ด้วย';
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

-- ── 6. what the pages read ────────────────────────────────────────────────
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
    -- 0248: the ปี SAMO rides on Q1 — what /admin/#years shows next to the วาระ
    'samo_year', public.current_samo_year(),
    -- Only what WILL happen: the switch is forward-only, so a ปี SAMO already
    -- at or past next year's (started by hand, early) is not switched again.
    'next_samo_year', case when s.auto
                            and coalesce(public.current_samo_year(), 0) < (cur ->> 'be')::int + 1 then
        jsonb_build_object('year', (cur ->> 'be')::int + 1,
                           'at', (passport._quarter_starts((cur ->> 'vara_year')::int + 1, s))[1]) end,
    'applied', v_apply);
end $fn$;

-- ── 7. bridge the open วาระ to its ปี SAMO ─────────────────────────────────
update passport.samo_years
   set team_term_year = public.current_samo_year()
 where ended_at is null and team_term_year is null
   and public.current_samo_year() is not null
   and right(name, 2) = right(public.current_samo_year()::text, 2);

commit;
