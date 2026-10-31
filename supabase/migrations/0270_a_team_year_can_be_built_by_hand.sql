-- ============================================================
-- 0270 — a ทีม SAMO year can be built by hand, for the year AHEAD or a
--        year gone by, and shown on เกี่ยวกับเรา without moving the
--        portal's year.
--
-- WHY (owner, 2026-10-31): "i want to be able to custom, add next or previous
-- year of adminteamsamo that'll show on the เกี่ยวกับเรา all people list also
-- without having to move all the system to next year". Label on the page:
-- "ทีมปี 2570", the same as every other year (owner's answer, same day).
--
-- ── WHAT ALREADY WORKED, AND WHY THIS IS SMALL ───────────────────────────
-- get_public_team_chart(year) serves a PUBLISHED year from team_archive_*
-- for ANY year, current or not (0105), and get_public_team_years lists every
-- published year. So a 2570 whose archive is filled and whose published_at is
-- set already appears on เกี่ยวกับเรา — and on 1 มี.ค. 2570, when the automatic
-- switch makes it current, it keeps being shown, because a published archive
-- wins over the live tree. What was missing:
--   1. a way to START a year that is not a photo of today's live tree:
--      copy_team_year (empty / the live tree / another year's list);
--   2. a way to show or hide it as a whole, without rebuilding it:
--      set_team_term_shown;
--   3. adding, moving and renaming ตำแหน่ง and people in a year (frontend,
--      straight to the tables — the 0104 write policies already allow it) —
--      and the two integrity rules that writing by hand now needs: a row's
--      parent / node is in the SAME year, and a ตำแหน่ง is never its own
--      ancestor;
--   4. ⛔ a guard on the one call that would DESTROY such a year:
--      _publish_team_term deletes the year's archive and rebuilds it from
--      the live tree (keeping photos only by src_member_id). Run on a
--      hand-built 2570 — "เผยแพร่ซ้ำ" after it became current, or the
--      handover page's step 1 — it would erase every name typed in by hand.
--      team_terms.hand_edited_at records that a person changed the list;
--      publish then refuses unless the caller says to replace it.
--
-- ── WHAT THIS MUST NOT BECOME ────────────────────────────────────────────
-- The archive grants NOTHING (terms.js header): no kkumail, no permission, no
-- resolver reads team_archive_*. A hand-built year is a published LIST. Who
-- holds which permission is still the live tree. The proof asserts the set of
-- functions that read the archive (tools/team0270-hand-built-years.sql §0).
--
-- ── EXPAND ONLY ──────────────────────────────────────────────────────────
-- publish_team_term(p_year) keeps answering the bundle being served: the new
-- signature adds a defaulted parameter, so `{p_year}` resolves to it. The
-- only behaviour the old bundle can notice is the refusal on a hand-edited
-- year — which no year has until the new bundle edits one.
-- ============================================================

-- ── 1. hand_edited_at ────────────────────────────────────────────────────
alter table public.team_terms
  add column if not exists hand_edited_at timestamptz;

comment on column public.team_terms.hand_edited_at is
  'When a person last changed this year''s archive list by hand (added, '
  'renamed, moved or removed a ตำแหน่ง or person, or started it with '
  'copy_team_year). NULL = the archive is exactly what publish_team_term built '
  'from the live tree. publish_team_term refuses to rebuild a year with this '
  'set unless told to replace it, because the rebuild deletes the list. 0270.';

-- Set by any write to the archive that is NOT _publish_team_term's own rebuild.
-- The rebuild marks itself with a transaction-local setting it clears on exit.
create or replace function public.team_archive_mark_hand_edited()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(current_setting('samo.team_publishing', true), '') = 'on' then
    return null;
  end if;
  update public.team_terms
     set hand_edited_at = now()
   where year = coalesce((case when tg_op = 'DELETE' then old.year else new.year end), -1)
     and hand_edited_at is distinct from now();
  return null;
end $$;

revoke all on function public.team_archive_mark_hand_edited() from public, anon, authenticated;

drop trigger if exists team_archive_nodes_hand_edited on public.team_archive_nodes;
create trigger team_archive_nodes_hand_edited
  after insert or update or delete on public.team_archive_nodes
  for each row execute function public.team_archive_mark_hand_edited();

drop trigger if exists team_archive_members_hand_edited on public.team_archive_members;
create trigger team_archive_members_hand_edited
  after insert or update or delete on public.team_archive_members
  for each row execute function public.team_archive_mark_hand_edited();

-- ── 2. same-year integrity ───────────────────────────────────────────────
-- publish_team_term always wrote parent and node inside the year it built.
-- A hand-written row is one PATCH away from pointing into another year, where
-- the public chart (which selects by year) would silently drop it. Composite
-- foreign keys make that unrepresentable. MATCH SIMPLE: a NULL parent_id (a
-- root ฝ่าย) is not checked, as before.
alter table public.team_archive_nodes
  drop constraint if exists team_archive_nodes_id_year_key;
alter table public.team_archive_nodes
  add constraint team_archive_nodes_id_year_key unique (id, year);

alter table public.team_archive_nodes
  drop constraint if exists team_archive_nodes_parent_same_year;
alter table public.team_archive_nodes
  add constraint team_archive_nodes_parent_same_year
  foreign key (parent_id, year) references public.team_archive_nodes (id, year)
  on delete cascade;

alter table public.team_archive_members
  drop constraint if exists team_archive_members_node_same_year;
alter table public.team_archive_members
  add constraint team_archive_members_node_same_year
  foreign key (node_id, year) references public.team_archive_nodes (id, year)
  on delete cascade;

alter table public.team_archive_nodes
  drop constraint if exists team_archive_nodes_name_len;
alter table public.team_archive_nodes
  add constraint team_archive_nodes_name_len
  check (char_length(btrim(name)) between 1 and 200);
alter table public.team_archive_nodes
  drop constraint if exists team_archive_nodes_kind_chk;
alter table public.team_archive_nodes
  add constraint team_archive_nodes_kind_chk
  check (kind in ('division', 'role'));
alter table public.team_archive_members
  drop constraint if exists team_archive_members_name_len;
alter table public.team_archive_members
  add constraint team_archive_members_name_len
  check (char_length(btrim(full_name)) between 1 and 200);

-- A ตำแหน่ง moved under its own descendant leaves a loop no root reaches: the
-- public page builds the tree from the roots down, so the whole branch would
-- vanish without an error.
create or replace function public.team_archive_nodes_no_cycle()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_cur  uuid := new.parent_id;
  v_hops integer := 0;
begin
  while v_cur is not null loop
    if v_cur = new.id then
      raise exception 'ย้ายตำแหน่งไปไว้ใต้ตำแหน่งย่อยของตัวเองไม่ได้'
        using errcode = 'P0001';
    end if;
    v_hops := v_hops + 1;
    if v_hops > 64 then
      raise exception 'ผังลึกเกิน 64 ชั้น' using errcode = 'P0001';
    end if;
    select parent_id into v_cur from public.team_archive_nodes where id = v_cur;
  end loop;
  return new;
end $$;

drop trigger if exists team_archive_nodes_no_cycle on public.team_archive_nodes;
create trigger team_archive_nodes_no_cycle
  before insert or update of parent_id on public.team_archive_nodes
  for each row when (new.parent_id is not null)
  execute function public.team_archive_nodes_no_cycle();

-- ── 3. _publish_team_term refuses to erase a hand-built list ─────────────
drop function if exists public.publish_team_term(integer);
drop function if exists public._publish_team_term(integer);

create or replace function public._publish_team_term(
  p_year integer,
  p_replace_hand_edits boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_nodes   integer;
  v_members integer;
  v_kept    integer;
  v_hand    integer;
begin
  -- 0248: the permission check lives in publish_team_term(); this is the body.
  if p_year is null or p_year < 2500 or p_year > 2700 then
    raise exception 'publish_team_term: bad year %', p_year;
  end if;

  insert into public.team_terms (year) values (p_year)
    on conflict (year) do nothing;

  -- 0270: a list a person built or corrected by hand is NOT rebuilt silently.
  -- The message carries a stable prefix + the head-count so the app can ask
  -- "replace N people with today's live tree?" and call again with true.
  if not coalesce(p_replace_hand_edits, false) then
    select count(*) into v_hand
      from public.team_archive_members am
      join public.team_terms t on t.year = am.year
     where am.year = p_year and t.hand_edited_at is not null;
    if v_hand > 0 then
      raise exception 'TEAM_YEAR_HAND_EDITED:%', v_hand
        using errcode = 'P0001',
              hint = 'รายชื่อปีนี้ถูกแก้ด้วยมือ — การเผยแพร่จากผังสดจะแทนที่รายชื่อทั้งหมด';
    end if;
  end if;

  perform set_config('samo.team_publishing', 'on', true);

  create temp table if not exists _pub_photos (
    src_member_id uuid primary key, photo_url text, photo_focus text
  ) on commit drop;
  -- `where true` is load-bearing: PostgREST sessions preload safeupdate,
  -- which refuses a DELETE with no WHERE even inside this function.
  delete from _pub_photos where true;
  insert into _pub_photos (src_member_id, photo_url, photo_focus)
  select distinct on (am.src_member_id) am.src_member_id, am.photo_url, am.photo_focus
    from public.team_archive_members am
   where am.year = p_year
     and am.src_member_id is not null
     and am.photo_url is not null
   order by am.src_member_id, am.id;

  delete from public.team_archive_nodes where year = p_year;

  -- `as materialized` is required: `mapped` is referenced twice and contains
  -- gen_random_uuid(); inlined, every parent_id lookup would come back null.
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
     set published_at = now(), updated_at = now(), hand_edited_at = null
   where year = p_year;

  perform set_config('samo.team_publishing', 'off', true);

  return jsonb_build_object('year', p_year, 'nodes', v_nodes,
                            'members', v_members, 'photos_kept', v_kept);
end;
$function$;

revoke all on function public._publish_team_term(integer, boolean) from public, anon, authenticated;
grant execute on function public._publish_team_term(integer, boolean) to service_role;

create or replace function public.publish_team_term(
  p_year integer,
  p_replace_hand_edits boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
begin
  -- coalesce(..., false) is load-bearing (0218): a caller with no users row
  -- makes the comparison NULL, and "not null" would skip the raise.
  if not coalesce(
       public.current_user_role() = any (array['vp_admin', 'dev'])
       or public.current_user_has_permission('team_edit'), false) then
    raise exception 'publish_team_term: not authorized';
  end if;
  return public._publish_team_term(p_year, p_replace_hand_edits);
end $function$;

revoke all on function public.publish_team_term(integer, boolean) from public, anon;
grant execute on function public.publish_team_term(integer, boolean) to authenticated, service_role;

-- _start_team_term archives the OUTGOING year only when it was never
-- published (0224). Such a year RAN on the live tree, so the live tree is the
-- right record of it even if a hand-built draft was sitting there hidden —
-- and the automatic switch at 1 มี.ค. must never fail on a refusal. Same body
-- as 0248 otherwise; only the call changes.
do $$
declare
  v_src text;
begin
  select pg_get_functiondef('public._start_team_term(integer, timestamptz)'::regprocedure) into v_src;
  if position('public._publish_team_term(v_current)' in v_src) = 0 then
    raise exception '0270: _start_team_term no longer calls _publish_team_term(v_current) — re-read it before patching';
  end if;
  execute replace(v_src, 'public._publish_team_term(v_current)', 'public._publish_team_term(v_current, true)');
end $$;

-- ── 4. copy_team_year — start a year from nothing, the live tree, or a year
create or replace function public.copy_team_year(p_to integer, p_from integer default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_current integer;
  v_nodes   integer;
  v_members integer;
begin
  if not coalesce(
       public.current_user_role() = any (array['vp_admin', 'dev'])
       or public.current_user_has_permission('team_edit'), false) then
    raise exception 'copy_team_year: not authorized';
  end if;
  if p_to is null or p_to < 2500 or p_to > 2700 then
    raise exception 'copy_team_year: bad year %', p_to;
  end if;
  if p_from is not null and p_from = p_to then
    raise exception 'คัดลอกปี % มาใส่ตัวเองไม่ได้', p_to using errcode = 'P0001';
  end if;

  select year into v_current from public.team_terms where is_current limit 1;
  -- The current year's list IS the live tree (or its published photo); a copy
  -- into it would fight เผยแพร่ปีนี้. Build the year ahead or a past one.
  if p_to is not distinct from v_current then
    raise exception 'ปี % เป็นปีปัจจุบัน — ใช้ปุ่มเผยแพร่ปีนี้แทน', p_to using errcode = 'P0001';
  end if;
  if exists (select 1 from public.team_archive_nodes where year = p_to) then
    raise exception 'ปี % มีรายชื่ออยู่แล้ว — ลบรายชื่อเดิมก่อนเริ่มใหม่', p_to using errcode = 'P0001';
  end if;
  if p_from is not null and not exists (select 1 from public.team_archive_nodes where year = p_from) then
    raise exception 'ปี % ไม่มีรายชื่อให้คัดลอก', p_from using errcode = 'P0001';
  end if;

  insert into public.team_terms (year) values (p_to) on conflict (year) do nothing;

  if p_from is null then
    -- The live tree, public ตำแหน่ง only — exactly what เกี่ยวกับเรา shows today.
    with recursive live as (
      select n.id, n.parent_id, n.name, n.kind, n.position, n.is_board, n.color, n.tier
        from public.team_nodes n
       where n.parent_id is null and n.is_public
      union all
      select c.id, c.parent_id, c.name, c.kind, c.position, c.is_board, c.color, c.tier
        from public.team_nodes c join live l on c.parent_id = l.id
       where c.is_public
    ),
    mapped as materialized (select l.*, gen_random_uuid() as new_id from live l)
    insert into public.team_archive_nodes
          (id, year, src_id, parent_id, name, kind, position, is_board, color, tier)
    select m.new_id, p_to, m.id,
           (select p.new_id from mapped p where p.id = m.parent_id),
           m.name, m.kind, m.position, m.is_board, m.color, m.tier
      from mapped m;
    get diagnostics v_nodes = ROW_COUNT;

    insert into public.team_archive_members
          (year, node_id, src_member_id, full_name, nickname, photo_url, photo_focus, position)
    select p_to, an.id, m.id, m.full_name, m.nickname, m.photo_url, m.photo_focus, m.position
      from public.team_members m
      join public.team_archive_nodes an on an.year = p_to and an.src_id = m.node_id;
    get diagnostics v_members = ROW_COUNT;
  else
    -- Another year's list, through an explicit old → new id map (ids are
    -- fresh per year; the map is what keeps every parent and every person on
    -- the copied ตำแหน่ง). src ids travel with it, so if this year is later
    -- published from the live tree the photos it holds are still matched.
    create temp table if not exists _copy_year_map (old_id uuid primary key, new_id uuid not null)
      on commit drop;
    delete from _copy_year_map where true;
    insert into _copy_year_map (old_id, new_id)
    select n.id, gen_random_uuid() from public.team_archive_nodes n where n.year = p_from;

    insert into public.team_archive_nodes
          (id, year, src_id, parent_id, name, kind, position, is_board, color, tier)
    select m.new_id, p_to, n.src_id, pm.new_id,
           n.name, n.kind, n.position, n.is_board, n.color, n.tier
      from public.team_archive_nodes n
      join _copy_year_map m on m.old_id = n.id
      left join _copy_year_map pm on pm.old_id = n.parent_id
     where n.year = p_from;
    get diagnostics v_nodes = ROW_COUNT;

    insert into public.team_archive_members
          (year, node_id, src_member_id, full_name, nickname, photo_url, photo_focus, position)
    select p_to, m.new_id, am.src_member_id, am.full_name, am.nickname,
           am.photo_url, am.photo_focus, am.position
      from public.team_archive_members am
      join _copy_year_map m on m.old_id = am.node_id
     where am.year = p_from;
    get diagnostics v_members = ROW_COUNT;
  end if;

  update public.team_terms set hand_edited_at = now(), updated_at = now() where year = p_to;

  return jsonb_build_object('year', p_to, 'from', p_from, 'nodes', v_nodes, 'members', v_members);
end;
$function$;

revoke all on function public.copy_team_year(integer, integer) from public, anon;
grant execute on function public.copy_team_year(integer, integer) to authenticated, service_role;

-- ── 5. set_team_term_shown — show or hide a whole non-current year ───────
-- published_at is what get_public_team_years / get_public_team_chart read.
-- For a NON-current year, setting it shows the archive as it stands and
-- clearing it hides the year; nothing is rebuilt either way. The current year
-- keeps its own button (เผยแพร่ปีนี้), because for it "not published" means
-- "show the live tree", and a hide here would make the 1 มี.ค. switch rebuild it.
create or replace function public.set_team_term_shown(p_year integer, p_shown boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_current integer;
  v_people  integer;
  v_at      timestamptz;
begin
  if not coalesce(
       public.current_user_role() = any (array['vp_admin', 'dev'])
       or public.current_user_has_permission('team_edit'), false) then
    raise exception 'set_team_term_shown: not authorized';
  end if;
  if not exists (select 1 from public.team_terms where year = p_year) then
    raise exception 'ไม่พบปี %', p_year using errcode = 'P0001';
  end if;
  select year into v_current from public.team_terms where is_current limit 1;
  if p_year is not distinct from v_current then
    raise exception 'ปี % เป็นปีปัจจุบัน — ใช้ปุ่มเผยแพร่ปีนี้แทน', p_year using errcode = 'P0001';
  end if;
  if coalesce(p_shown, false) then
    select count(*) into v_people from public.team_archive_members where year = p_year;
    if v_people = 0 then
      raise exception 'ปี % ยังไม่มีรายชื่อ — เพิ่มคนก่อนแสดงบนหน้าเกี่ยวกับเรา', p_year using errcode = 'P0001';
    end if;
    update public.team_terms
       set published_at = coalesce(published_at, now()), updated_at = now()
     where year = p_year
     returning published_at into v_at;
  else
    update public.team_terms
       set published_at = null, updated_at = now()
     where year = p_year;
    v_at := null;
  end if;
  return jsonb_build_object('year', p_year, 'shown', v_at is not null, 'published_at', v_at);
end;
$function$;

revoke all on function public.set_team_term_shown(integer, boolean) from public, anon;
grant execute on function public.set_team_term_shown(integer, boolean) to authenticated, service_role;
