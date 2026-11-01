-- ============================================================
-- 0272 — ถาวร: groups of people who stay every year
--
-- REQUESTED (owner, 2026-11-01): "a section for people who will persist
-- throughout every year indefinitely, can add ฝ่าย, permission that person has
-- like the normal ทีม SAMO … if i retired from this year … and i can add like
-- อาจารย์, เจ้าหน้าที่คณะ so they don't need to be added every year." Plus:
-- any email may sign in to it (gmail, hotmail, kku.ac.th …) — which the
-- database already allowed: team_members.kkumail is matched against the
-- sign-in email whatever its domain.
--
-- WHY THIS IS NEEDED, NOT JUST NICE. 0271's switch makes the prepared year's
-- tree the live one and DELETES every live row the draft does not hold. The
-- hidden อาจารย์ / เจ้าหน้าที่คณะ groups (they hold the หนังสือโครงการ signing
-- desks) survive a switch only if whoever prepared the year copied them — a
-- draft started "เริ่มจากว่าง" would take every signer's access away on
-- 1 มี.ค., silently.
--
-- THE SHAPE: ONE TREE, NOT TWO. A ถาวร group is an ordinary top-level
-- team_nodes row listed in team_standing_groups. Its people hold permissions
-- through exactly the same resolvers (effective_team_*_for_email) as everyone
-- else, so no gate has to learn a new access channel (mistakes.md class 5 —
-- the most repeated bug here). Only the YEAR machinery learns to leave it
-- alone:
--   start_team_draft   copies yearly groups only
--   _apply_team_draft  never inserts, updates or deletes a ถาวร row, and the
--                      undo copy it files is the yearly tree only
--   team_draft_summary counts yearly rows only, and says how many ถาวร people
--                      the switch leaves as they are
-- and the PUBLIC side needs no change at all: a ถาวร group is never is_public
-- (enforced below), and get_public_team_chart + _publish_team_term already
-- walk only public roots.
--
-- WHY A TABLE AND NOT A team_nodes COLUMN. 0271 copies the tree with
-- `select n.*, p_year` into team_draft_nodes, whose columns are team_nodes'
-- plus term_year LAST. A new team_nodes column would land after term_year in
-- the draft table and the positional copy would put a boolean into term_year.
-- The flag also only means something on a ROOT, and a table keyed by the root
-- says that by construction.
--
-- ALSO HERE: 0271's undo lost a ตำแหน่ง's Discord role. A ตำแหน่ง dropped for
-- the new year is deleted by the switch; switching BACK re-inserts it from the
-- undo copy, and the insert left discord_role_id out (to keep a duplicated
-- ฝ่าย from failing the unique index). team0271 case 70 was red on production,
-- where the probe's ตำแหน่ง holds a role, and green on samo-dev, where it does
-- not. The id is now carried when no live row holds it.
--
-- AND: who in the tree has ever signed in (team_sign_in_status), and the
-- อาจารย์'s own view of their บ้าน (my_advisor_house).
-- ============================================================

-- ── 1. The ถาวร list ────────────────────────────────────────────────────
create table if not exists public.team_standing_groups (
  node_id    uuid primary key references public.team_nodes(id) on delete cascade,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);
comment on table public.team_standing_groups is
  'ถาวร (0272): top-level ทีม SAMO groups that outlive the ปี SAMO — the switch, the prepared year and its undo copy never touch them. Grants come from the ordinary tree resolvers.';

-- pg_default_acl hands anon every privilege on a new public table (0188).
revoke all on public.team_standing_groups from anon, public;
grant select, insert, delete on public.team_standing_groups to authenticated;
alter table public.team_standing_groups enable row level security;

drop policy if exists team_standing_groups_read on public.team_standing_groups;
create policy team_standing_groups_read on public.team_standing_groups for select to authenticated
  using (public.current_user_role() = any (array['vp_admin', 'dev'])
         or public.current_user_has_permission('team_edit')
         or public.current_user_has_permission('team'));
drop policy if exists team_standing_groups_write on public.team_standing_groups;
create policy team_standing_groups_write on public.team_standing_groups for all to authenticated
  using (public.current_user_role() = any (array['vp_admin', 'dev'])
         or public.current_user_has_permission('team_edit'))
  with check (public.current_user_role() = any (array['vp_admin', 'dev'])
              or public.current_user_has_permission('team_edit'));

-- ── 2. Which nodes are ถาวร ─────────────────────────────────────────────
-- Invoker functions: called from the definer functions below, and from the
-- editor, where RLS already limits them to people who can read the tree.
create or replace function public.team_standing_node_ids()
returns table (id uuid)
language sql
stable
set search_path = public
as $$
  with recursive s as (
    select n.id
      from public.team_nodes n
      join public.team_standing_groups g on g.node_id = n.id
    union
    select c.id
      from public.team_nodes c
      join s on c.parent_id = s.id
  )
  select s.id from s
$$;

create or replace function public.team_node_is_standing(p_node uuid)
returns boolean
language sql
stable
set search_path = public
as $$
  with recursive up as (
    select n.id, n.parent_id, 0 as hops from public.team_nodes n where n.id = p_node
    union all
    select n.id, n.parent_id, up.hops + 1
      from public.team_nodes n join up on n.id = up.parent_id
     where up.hops < 64
  )
  select exists (select 1 from up join public.team_standing_groups g on g.node_id = up.id)
$$;

revoke all on function public.team_standing_node_ids() from public, anon;
revoke all on function public.team_node_is_standing(uuid) from public, anon;
grant execute on function public.team_standing_node_ids() to authenticated;
grant execute on function public.team_node_is_standing(uuid) to authenticated;

-- ── 3. A ถาวร group is a hidden ROOT, always ────────────────────────────
-- Hidden because เกี่ยวกับเรา shows a YEAR's team and these people are not
-- part of one; a root because the flag is inherited by the whole subtree and
-- a group nested inside a yearly ฝ่าย would be deleted with it.
create or replace function public.team_standing_groups_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_parent uuid;
begin
  select parent_id into v_parent from public.team_nodes where id = new.node_id;
  if not found then
    raise exception 'ไม่พบกลุ่มนี้' using errcode = 'P0001';
  end if;
  if v_parent is not null then
    raise exception 'กลุ่มถาวรต้องเป็นกลุ่มบนสุด — ย้ายออกมาไว้ชั้นบนสุดก่อน' using errcode = 'P0001';
  end if;
  update public.team_nodes set is_public = false where id = new.node_id and is_public;
  return new;
end $$;

drop trigger if exists team_standing_groups_guard on public.team_standing_groups;
create trigger team_standing_groups_guard
  before insert on public.team_standing_groups
  for each row execute function public.team_standing_groups_guard();

create or replace function public.team_nodes_standing_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from public.team_standing_groups g where g.node_id = new.id) then
    if new.parent_id is not null then
      raise exception 'ย้ายกลุ่มถาวรไปไว้ใต้กลุ่มอื่นไม่ได้ — นำออกจากถาวรก่อน' using errcode = 'P0001';
    end if;
    new.is_public := false;
  end if;
  return new;
end $$;

drop trigger if exists team_nodes_standing_guard on public.team_nodes;
create trigger team_nodes_standing_guard
  before update of parent_id, is_public on public.team_nodes
  for each row execute function public.team_nodes_standing_guard();

revoke all on function public.team_standing_groups_guard() from public, anon, authenticated;
revoke all on function public.team_nodes_standing_guard() from public, anon, authenticated;

-- ── 4. Preparing a year copies the YEARLY tree only ─────────────────────
-- Body = 0271's, the two copies filtered.
create or replace function public.start_team_draft(p_year integer, p_from text default 'live')
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_current integer := public.current_samo_year();
  v_nodes   integer := 0;
  v_members integer := 0;
begin
  if not coalesce(
       public.current_user_role() = any (array['vp_admin', 'dev'])
       or public.current_user_has_permission('team_edit'), false) then
    raise exception 'start_team_draft: not authorized';
  end if;
  if not exists (select 1 from public.team_terms where year = p_year) then
    raise exception 'ไม่พบปี %', p_year using errcode = 'P0001';
  end if;
  if p_year <= coalesce(v_current, 0) then
    raise exception 'ปี % เริ่มไปแล้ว — เตรียมทีมล่วงหน้าได้เฉพาะปีที่ยังไม่ถึง', p_year
      using errcode = 'P0001';
  end if;
  if coalesce(p_from, '') not in ('live', 'empty') then
    raise exception 'start_team_draft: p_from must be live or empty' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.team_draft_nodes where term_year = p_year) then
    raise exception 'ปี % มีผังที่เตรียมไว้แล้ว', p_year using errcode = 'P0001';
  end if;

  if p_from = 'live' then
    insert into public.team_draft_nodes select n.*, p_year from public.team_nodes n
     where n.id not in (select s.id from public.team_standing_node_ids() s);
    get diagnostics v_nodes = row_count;
    insert into public.team_draft_members select m.*, p_year from public.team_members m
     where m.node_id not in (select s.id from public.team_standing_node_ids() s);
    get diagnostics v_members = row_count;
  end if;

  update public.team_terms set updated_at = now() where year = p_year;
  return jsonb_build_object('year', p_year, 'from', p_from,
                            'nodes', v_nodes, 'members', v_members);
end;
$function$;

revoke all on function public.start_team_draft(integer, text) from public, anon;
grant execute on function public.start_team_draft(integer, text) to authenticated;

-- ── 5. What the switch would do — yearly rows only ──────────────────────
-- Plus how many ถาวร people it leaves exactly as they are, so the question
-- before the switch can say so (and an admin sees, once a year, who still
-- holds access that no year will ever take away).
create or replace function public.team_draft_summary(p_year integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $function$
declare
  v_sn uuid[];
  v_standing jsonb;
begin
  if not coalesce(
       public.current_user_role() = any (array['vp_admin', 'dev'])
       or public.current_user_has_permission('team_edit')
       or public.current_user_has_permission('team'), false) then
    raise exception 'team_draft_summary: not authorized';
  end if;

  v_sn := coalesce(array(select s.id from public.team_standing_node_ids() s), '{}');
  v_standing := jsonb_build_object(
    'standing_groups', (select count(*) from public.team_standing_groups),
    'standing_members', (select count(*) from public.team_members m where m.node_id = any (v_sn)));

  if not exists (select 1 from public.team_draft_nodes where term_year = p_year) then
    return jsonb_build_object('year', p_year, 'prepared', false) || v_standing;
  end if;
  return jsonb_build_object(
    'year', p_year,
    'prepared', true,
    'nodes', (select count(*) from public.team_draft_nodes where term_year = p_year),
    'members', (select count(*) from public.team_draft_members where term_year = p_year),
    'nodes_added', (select count(*) from public.team_draft_nodes d
                     where d.term_year = p_year and d.id <> all (v_sn)
                       and not exists (select 1 from public.team_nodes n where n.id = d.id)),
    'nodes_removed', (select count(*) from public.team_nodes n
                       where n.id <> all (v_sn)
                         and not exists (select 1 from public.team_draft_nodes d
                                          where d.term_year = p_year and d.id = n.id)),
    'members_added', (select count(*) from public.team_draft_members d
                       where d.term_year = p_year
                         and not exists (select 1 from public.team_members m where m.id = d.id)),
    'members_removed', (select count(*) from public.team_members m
                         where m.node_id <> all (v_sn)
                           and not exists (select 1 from public.team_draft_members d
                                            where d.term_year = p_year and d.id = m.id)),
    'members_changed', (select count(*) from public.team_draft_members d
                          join public.team_members m on m.id = d.id
                         where d.term_year = p_year and m.node_id <> all (v_sn)
                           and (m.node_id, m.permissions, m.inherit_permissions, m.vs_dept,
                                m.project_seat, m.passport_dept_id, m.passport_sub_dept_id,
                                m.shop_source, m.dept_page)
                               is distinct from
                               (d.node_id, d.permissions, d.inherit_permissions, d.vs_dept,
                                d.project_seat, d.passport_dept_id, d.passport_sub_dept_id,
                                d.shop_source, d.dept_page)),
    'nodes_changed', (select count(*) from public.team_draft_nodes d
                        join public.team_nodes n on n.id = d.id
                       where d.term_year = p_year and n.id <> all (v_sn)
                         and (n.parent_id, n.name, n.kind, n.permissions, n.inherit_permissions,
                              n.vs_dept, n.project_seat, n.is_public, n.passport_dept_id,
                              n.passport_sub_dept_id, n.shop_source, n.is_board, n.color,
                              n.tier, n.dept_page, n.discord_role)
                             is distinct from
                             (d.parent_id, d.name, d.kind, d.permissions, d.inherit_permissions,
                              d.vs_dept, d.project_seat, d.is_public, d.passport_dept_id,
                              d.passport_sub_dept_id, d.shop_source, d.is_board, d.color,
                              d.tier, d.dept_page, d.discord_role))
  ) || v_standing;
end;
$function$;

revoke all on function public.team_draft_summary(integer) from public, anon;
grant execute on function public.team_draft_summary(integer) to authenticated;

-- ── 6. Applying a draft never touches a ถาวร row ────────────────────────
-- Body = 0271's with: the ถาวร node + member ids taken ONCE, before anything
-- moves; every insert / update / delete and the undo copy excluding them; and
-- discord_role_id carried on an insert when no live row holds it.
--
-- A draft started before 0272 (or before a group became ถาวร) can hold a stale
-- copy of a ถาวร group. Its rows share the live ids, so they are skipped: the
-- live ถาวร group wins, whatever the copy says.
create or replace function public._apply_team_draft(p_year integer, p_outgoing integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_prev text := coalesce(current_setting('app.team_sync', true), '');
  v_ins_n integer; v_upd_n integer; v_del_n integer;
  v_ins_m integer; v_upd_m integer; v_del_m integer;
  v_sn uuid[];   -- ถาวร nodes, as they stand BEFORE the switch
  v_sm uuid[];   -- members placed in them
begin
  if not exists (select 1 from public.team_draft_nodes where term_year = p_year) then
    return null;
  end if;

  v_sn := coalesce(array(select s.id from public.team_standing_node_ids() s), '{}');
  v_sm := coalesce(array(select m.id from public.team_members m where m.node_id = any (v_sn)), '{}');

  -- Undo copy: the YEARLY tree being replaced, as the outgoing year's draft.
  if p_outgoing is not null then
    delete from public.team_draft_nodes where term_year = p_outgoing;
    insert into public.team_draft_nodes select n.*, p_outgoing from public.team_nodes n
     where n.id <> all (v_sn);
    insert into public.team_draft_members select m.*, p_outgoing from public.team_members m
     where m.id <> all (v_sm);
  end if;

  -- Nodes. New ones go in parentless, then ONE update sets every parent, so the
  -- order rows arrive in can never violate team_nodes_parent_id_fkey.
  -- discord_role_id (0272): carried when nothing live holds it and no earlier
  -- draft row claims the same id — so undo restores a ตำแหน่ง's role, while a
  -- duplicated ฝ่าย still cannot fail the unique index.
  insert into public.team_nodes
         (id, name, kind, position, permissions, inherit_permissions, vs_dept,
          project_seat, is_public, passport_dept_id, passport_sub_dept_id,
          shop_source, is_board, color, tier, dept_page, discord_role, discord_role_id)
  select d.id, d.name, d.kind, d.position, d.permissions, d.inherit_permissions,
         d.vs_dept, d.project_seat, d.is_public, d.passport_dept_id,
         d.passport_sub_dept_id, d.shop_source, d.is_board, d.color, d.tier,
         d.dept_page, d.discord_role,
         case when d.discord_role_id is not null
               and not exists (select 1 from public.team_nodes x
                                where x.discord_role_id = d.discord_role_id)
               and not exists (select 1 from public.team_draft_nodes d2
                                where d2.term_year = p_year
                                  and d2.discord_role_id = d.discord_role_id
                                  and d2.id < d.id)
              then d.discord_role_id end
    from public.team_draft_nodes d
   where d.term_year = p_year
     and d.id <> all (v_sn)
     and not exists (select 1 from public.team_nodes n where n.id = d.id);
  get diagnostics v_ins_n = row_count;

  update public.team_nodes n
     set parent_id = d.parent_id, name = d.name, kind = d.kind, position = d.position,
         permissions = d.permissions, inherit_permissions = d.inherit_permissions,
         vs_dept = d.vs_dept, project_seat = d.project_seat, is_public = d.is_public,
         passport_dept_id = d.passport_dept_id, passport_sub_dept_id = d.passport_sub_dept_id,
         shop_source = d.shop_source, is_board = d.is_board, color = d.color,
         tier = d.tier, dept_page = d.dept_page, discord_role = d.discord_role
    from public.team_draft_nodes d
   where d.term_year = p_year and d.id = n.id
     and n.id <> all (v_sn)
     and (n.parent_id, n.name, n.kind, n.position, n.permissions, n.inherit_permissions,
          n.vs_dept, n.project_seat, n.is_public, n.passport_dept_id,
          n.passport_sub_dept_id, n.shop_source, n.is_board, n.color, n.tier,
          n.dept_page, n.discord_role)
         is distinct from
         (d.parent_id, d.name, d.kind, d.position, d.permissions, d.inherit_permissions,
          d.vs_dept, d.project_seat, d.is_public, d.passport_dept_id,
          d.passport_sub_dept_id, d.shop_source, d.is_board, d.color, d.tier,
          d.dept_page, d.discord_role);
  get diagnostics v_upd_n = row_count;

  -- New members: identity from the PERSON (see 0271's header) — found by the
  -- link or by kkumail; a link that no longer resolves is dropped and the row is
  -- linked again by kkumail (team_members_link_person) rather than failing.
  insert into public.team_members
         (id, node_id, position, kkumail, full_name, first_name_th, last_name_th,
          nickname, student_id, year, major, photo_url, photo_focus, person_id,
          cohort_year, year_offset, confirmed, user_id,
          permissions, inherit_permissions, vs_dept, project_seat,
          passport_dept_id, passport_sub_dept_id, shop_source, dept_page)
  select d.id, d.node_id, d.position,
         case when p.id is null then d.kkumail       else coalesce(p.kkumail, d.kkumail) end,
         case when p.id is null then d.full_name     else p.full_name     end,
         case when p.id is null then d.first_name_th else p.first_name_th end,
         case when p.id is null then d.last_name_th  else p.last_name_th  end,
         case when p.id is null then d.nickname      else p.nickname      end,
         case when p.id is null then d.student_id    else p.student_id    end,
         case when p.id is null then d.year          else p.year          end,
         case when p.id is null then d.major         else p.major         end,
         case when p.id is null then d.photo_url     else p.photo_url     end,
         case when p.id is null then d.photo_focus   else p.photo_focus   end,
         p.id,
         case when p.id is null then d.cohort_year   else p.cohort_year   end,
         case when p.id is null then d.year_offset   else p.year_offset   end,
         d.confirmed,
         (select u.id from public.users u where u.id = coalesce(p.user_id, d.user_id)),
         d.permissions, d.inherit_permissions, d.vs_dept, d.project_seat,
         d.passport_dept_id, d.passport_sub_dept_id, d.shop_source, d.dept_page
    from public.team_draft_members d
    left join lateral (
      select x.* from public.people x
       where x.id = d.person_id
          or (d.person_id is null and nullif(btrim(coalesce(d.kkumail, '')), '') is not null
              and lower(btrim(x.kkumail)) = lower(btrim(d.kkumail)))
       order by (x.id = d.person_id) desc nulls last, x.id
       limit 1) p on true
   where d.term_year = p_year
     and not exists (select 1 from public.team_members m where m.id = d.id);
  get diagnostics v_ins_m = row_count;

  -- Continuing members: placement only — and never a ถาวร member.
  perform set_config('app.team_sync', '1', true);
  update public.team_members m
     set node_id = d.node_id, position = d.position,
         permissions = d.permissions, inherit_permissions = d.inherit_permissions,
         vs_dept = d.vs_dept, project_seat = d.project_seat,
         passport_dept_id = d.passport_dept_id, passport_sub_dept_id = d.passport_sub_dept_id,
         shop_source = d.shop_source, dept_page = d.dept_page
    from public.team_draft_members d
   where d.term_year = p_year and d.id = m.id
     and m.id <> all (v_sm)
     and (m.node_id, m.position, m.permissions, m.inherit_permissions, m.vs_dept,
          m.project_seat, m.passport_dept_id, m.passport_sub_dept_id,
          m.shop_source, m.dept_page)
         is distinct from
         (d.node_id, d.position, d.permissions, d.inherit_permissions, d.vs_dept,
          d.project_seat, d.passport_dept_id, d.passport_sub_dept_id,
          d.shop_source, d.dept_page);
  get diagnostics v_upd_m = row_count;
  perform set_config('app.team_sync', v_prev, true);

  delete from public.team_members m
   where m.id <> all (v_sm)
     and not exists (select 1 from public.team_draft_members d
                      where d.term_year = p_year and d.id = m.id);
  get diagnostics v_del_m = row_count;

  delete from public.team_nodes n
   where n.id <> all (v_sn)
     and not exists (select 1 from public.team_draft_nodes d
                      where d.term_year = p_year and d.id = n.id);
  get diagnostics v_del_n = row_count;

  -- Consumed. The year now reads LIVE (0271).
  delete from public.team_draft_nodes where term_year = p_year;
  update public.team_terms set published_at = null, hand_edited_at = null
   where year = p_year;

  return jsonb_build_object(
    'nodes_added', v_ins_n, 'nodes_changed', v_upd_n, 'nodes_removed', v_del_n,
    'members_added', v_ins_m, 'members_changed', v_upd_m, 'members_removed', v_del_m,
    'standing_kept', coalesce(array_length(v_sm, 1), 0));
end;
$function$;

revoke all on function public._apply_team_draft(integer, integer) from public, anon, authenticated;

-- ── 7. Who in the tree has ever signed in ───────────────────────────────
-- public.users.last_seen_at is never written (0 of 905 rows on 2026-11-01), so
-- the sign-in record is auth.users' own. Matched by the address the row would
-- be matched by at sign-in (sync_my_team_permissions), whatever its domain —
-- which is the point: an address typed with a typo, or one the person never
-- uses, shows here as "ยังไม่เคยเข้าระบบ" instead of looking fine. team_edit
-- only: it says when a named person last used the site.
create or replace function public.team_sign_in_status()
returns table (member_id uuid, has_account boolean, last_sign_in_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not coalesce(
       public.current_user_role() = any (array['vp_admin', 'dev'])
       or public.current_user_has_permission('team_edit'), false) then
    raise exception 'team_sign_in_status: not authorized';
  end if;
  return query
  select m.id, (a.id is not null), a.last_sign_in_at
    from public.team_members m
    left join lateral (
      select au.id, au.last_sign_in_at
        from auth.users au
       where lower(au.email) = lower(btrim(m.kkumail))
       order by au.last_sign_in_at desc nulls last
       limit 1) a on true
   where nullif(btrim(coalesce(m.kkumail, '')), '') is not null;
end $$;

revoke all on function public.team_sign_in_status() from public, anon;
grant execute on function public.team_sign_in_status() to authenticated;

-- ── 8. ตำแหน่งของฉัน knows a ถาวร posting ───────────────────────────────
-- Body = the live one (0141 + later), one key added per posting: `standing`.
-- The card drops the student-only fields (รหัส / ชั้นปี / สาขา) and the
-- "ในทีม SAMO" wording for a person whose only postings are ถาวร — an อาจารย์
-- or เจ้าหน้าที่ is not asked for a รหัสนักศึกษา.
create or replace function public.get_my_team_seat()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $function$
declare
  v_uid        uuid := auth.uid();
  v_email      text;
  v_postings   jsonb := '[]'::jsonb;
  v_sid_shared int := 0;
  v_term       int;
  m            public.team_members%rowtype;
  v_node       public.team_nodes%rowtype;
  v_name       text;
  v_nick       text;
  v_empty      jsonb := jsonb_build_object(
                  'email', null, 'name', null, 'nickname', null,
                  'postings', '[]'::jsonb,
                  'permissions', '[]'::jsonb, 'vs_depts', '[]'::jsonb,
                  'project_seats', '[]'::jsonb, 'passport_scopes', '[]'::jsonb,
                  'can_view_team', false, 'can_edit_team', false,
                  'student_id_shared_with', 0, 'term_year', null,
                  'academic_year', null);
begin
  if v_uid is null then return v_empty; end if;
  select email into v_email from public.users where id = v_uid;
  -- `is null or length(btrim()) = 0`, not a bare null check: a blank email
  -- would match every member row whose kkumail is the empty string.
  if v_email is null or length(btrim(v_email)) = 0 then return v_empty; end if;

  select year into v_term from public.team_terms where is_current limit 1;

  for m in
    select * from public.team_members
     where lower(kkumail) = lower(btrim(v_email))
     order by created_at
  loop
    select * into v_node from public.team_nodes where id = m.node_id;
    if not found then continue; end if;      -- posting on a deleted ตำแหน่ง
    v_name := coalesce(v_name, nullif(btrim(coalesce(m.full_name, '')), ''));
    v_nick := coalesce(v_nick, nullif(btrim(coalesce(m.nickname,  '')), ''));
    v_postings := v_postings || jsonb_build_object(
      'member_id', m.id,
      'node_id',  v_node.id,
      'node',     v_node.name,
      'path',     to_jsonb(public.team_node_path(v_node.id)),
      'is_board', coalesce(v_node.is_board, false),
      'standing', public.team_node_is_standing(v_node.id),
      'full_name',  m.full_name,
      'first_name_th', m.first_name_th,
      'last_name_th',  m.last_name_th,
      'nickname',   m.nickname,
      'student_id', m.student_id,
      -- DEAD (0145), still sent so an older bundle keeps rendering.
      'year',       m.year,
      'cohort_year', m.cohort_year,
      'year_offset', m.year_offset,
      'major',      m.major,
      'kkumail',    m.kkumail,
      'photo_url',  m.photo_url,
      'photo_focus', m.photo_focus,
      'permissions', to_jsonb((
        select coalesce(array_agg(distinct p), '{}') from unnest(
          coalesce(m.permissions, '{}') ||
          case when coalesce(m.inherit_permissions, true)
               then public.node_effective_permissions(v_node.id)
               else '{}'::text[] end
        ) as p)),
      'confirmed', coalesce(m.confirmed, false)
    );
  end loop;

  -- How many OTHER identities hold one of this person's รหัสนักศึกษา.
  select count(*) into v_sid_shared from (
    select distinct case when kkumail like '%@%' then lower(btrim(kkumail))
                         else 'row:' || id::text end as who
      from public.team_members
     where student_id is not null and btrim(student_id) <> ''
       and student_id in (
             select student_id from public.team_members
              where lower(kkumail) = lower(btrim(v_email))
                and student_id is not null and btrim(student_id) <> '')
       and (kkumail is null or lower(btrim(kkumail)) <> lower(btrim(v_email)))
  ) s;

  return jsonb_build_object(
    'email',           v_email,
    'name',            v_name,
    'nickname',        v_nick,
    'postings',        v_postings,
    'permissions',     to_jsonb(public.effective_team_permissions_for_email(v_email)),
    'vs_depts',        to_jsonb(public.effective_team_vs_depts_for_email(v_email)),
    'project_seats',   to_jsonb(public.effective_team_project_seats_for_email(v_email)),
    'passport_scopes', to_jsonb(public.effective_team_passport_scopes_for_email(v_email)),
    'can_view_team',   public.current_user_has_permission('team')
                        or public.current_user_has_permission('team_edit')
                        or public.current_user_role() = any (array['vp_admin','dev']),
    'can_edit_team',   public.current_user_has_permission('team_edit')
                        or public.current_user_role() = any (array['vp_admin','dev']),
    'student_id_shared_with', v_sid_shared,
    'term_year',       v_term,
    'academic_year',   public.get_academic_year()
  );
end;
$function$;

-- ── 9. บ้านของฉัน, for an อาจารย์ ────────────────────────────────────────
-- An อาจารย์ is recognised by advisors.email = the address they sign in with
-- (any domain). They see their บ้าน — every บ้าน a สาย of theirs is in — with
-- FULL student information (owner, 2026-11-01: "full information, it's ok"),
-- the บ้าน's สาย and who looks after each, and nothing outside those บ้าน.
-- Phones are NOT here: advisor_phones stays house-admin + master only (0243).
-- Returns null for anyone who is not an active อาจารย์ — the page shows
-- nothing, the same as for a visitor.
create or replace function public.my_advisor_house()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_email  text;
  v_ids    uuid[];
  v_codes  text[];
  v_houses smallint[];
begin
  if v_uid is null then return null; end if;
  select email into v_email from public.users where id = v_uid;
  if v_email is null or length(btrim(v_email)) = 0 then return null; end if;

  select array_agg(a.id order by a.created_at, a.id) into v_ids
    from public.advisors a
   -- Case-blind: the editor lowercases, an import may not.
   where lower(btrim(a.email)) = lower(btrim(v_email)) and a.is_active;
  if v_ids is null then return null; end if;

  select coalesce(array_agg(distinct sa.sai_code), '{}') into v_codes
    from public.sai_advisors sa where sa.advisor_id = any (v_ids);
  select coalesce(array_agg(distinct s.house_id), '{}') into v_houses
    from public.sais s where s.code = any (v_codes) and s.house_id is not null;

  return jsonb_build_object(
    'advisor', (select jsonb_build_object(
                  'id', a.id, 'full_name', a.full_name, 'dept', a.dept,
                  'email', a.email, 'photo_url', a.photo_url, 'photo_focus', a.photo_focus)
                  from public.advisors a where a.id = v_ids[1]),
    'advisor_ids', to_jsonb(v_ids),
    'sai_codes', to_jsonb(v_codes),
    'houses', (select coalesce(jsonb_agg(jsonb_build_object(
                  'id', h.id, 'name', h.name, 'slogan', h.slogan, 'color', h.color,
                  'icon_url', h.icon_url, 'icon_focus', h.icon_focus) order by h.id), '[]'::jsonb)
                 from public.houses h where h.id = any (v_houses)),
    'sais', (select coalesce(jsonb_agg(jsonb_build_object(
                'code', s.code, 'house_id', s.house_id, 'label', s.label) order by s.code), '[]'::jsonb)
               from public.sais s where s.house_id = any (v_houses)),
    'advisors', (select coalesce(jsonb_agg(jsonb_build_object(
                    'id', a.id, 'full_name', a.full_name, 'dept', a.dept, 'email', a.email,
                    'photo_url', a.photo_url,
                    'sai_advisors', (select coalesce(jsonb_agg(jsonb_build_object(
                                        'sai_code', sa.sai_code, 'role', sa.role)
                                        order by sa.position, sa.sai_code), '[]'::jsonb)
                                       from public.sai_advisors sa where sa.advisor_id = a.id))
                    order by a.full_name), '[]'::jsonb)
                   from public.advisors a
                  where a.is_active
                    and exists (select 1 from public.sai_advisors sa
                                  join public.sais s on s.code = sa.sai_code
                                 where sa.advisor_id = a.id and s.house_id = any (v_houses))),
    'students', (select coalesce(jsonb_agg(jsonb_build_object(
                    'id', st.id, 'full_name', st.full_name,
                    'first_name_th', st.first_name_th, 'last_name_th', st.last_name_th,
                    'nickname', st.nickname, 'student_id', st.student_id,
                    'kkumail', st.kkumail, 'major', st.major, 'sai_code', st.sai_code,
                    'cohort_year', coalesce(st.cohort_year, public.cohort_from_student_id(st.student_id)),
                    'year_offset', st.year_offset,
                    'photo_url', st.photo_url, 'photo_focus', st.photo_focus,
                    'bio', st.bio, 'has_account', st.user_id is not null)
                    order by st.sai_code, st.student_id), '[]'::jsonb)
                   from public.students st
                   join public.sais s on s.code = st.sai_code
                  where s.house_id = any (v_houses)),
    'academic_year', public.get_academic_year()
  );
end $$;

revoke all on function public.my_advisor_house() from public, anon;
grant execute on function public.my_advisor_house() to authenticated;
