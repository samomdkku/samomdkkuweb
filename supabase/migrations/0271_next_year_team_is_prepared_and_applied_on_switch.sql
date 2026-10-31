-- ============================================================
-- 0271 — the NEXT ปี SAMO's team is prepared ahead and applied on switch day.
--
-- Owner 2026-10-31: the ทีม SAMO admin gets a year bar (2568 · 2569 ปัจจุบัน ·
-- 2570) instead of a ทีมแต่ละปี list with an editor nested in each year; picking
-- a year that has not started yet opens the SAME tree editor — ฝ่าย, ตำแหน่ง,
-- people AND permissions — and asked what those permissions should do:
-- "Prepare, apply on switch day". Nothing prepared grants anything until the
-- year starts; at the switch the prepared tree BECOMES the live one.
--
-- WHY A DRAFT WITH THE SAME IDS, AND WHY APPLYING IS A DIFF.
-- The live tree is not a leaf. passport.departments/sub_departments point at
-- team_nodes.id (on delete SET NULL), Discord roles are keyed by
-- team_nodes.discord_role_id, and deleting a team_members row can prune the
-- person it pointed at (prune_orphan_person). "Swap the tree" by delete +
-- insert would cut every one of those for every continuing ฝ่าย. So a draft is
-- a COPY of the live rows with the SAME ids, and applying it is the edit an
-- admin would have made by hand: update the rows that continue, insert the new
-- ones, delete the ones that are gone — every trigger firing as for a hand edit.
--
-- WHAT A DRAFT CARRIES, column by column (the registry `team0271` asserts):
--   nodes   — every column but id / created_at / updated_at / discord_role_id
--             (the bot owns that id; the unique index on it would also fail the
--             whole switch the first time a draft duplicated a ฝ่าย).
--   members — PLACEMENT columns are applied to a continuing member (node_id,
--             position, permissions, inherit_permissions, vs_dept, project_seat,
--             passport_dept_id, passport_sub_dept_id, shop_source, dept_page).
--             IDENTITY (name, nickname, รหัส, สาขา, photo, kkumail …) belongs to
--             the PERSON, not to a year: a continuing member keeps the live row's
--             identity, and a NEW member takes it from `people` at the moment of
--             the switch when linked. team_member_insert_mirror_up writes the
--             inserted row's identity UP into people, so inserting a draft copy
--             made weeks earlier would revert the person's own later edits (the
--             0145 shape). The draft's copy is display only.
--
-- UNDO. Before applying, the outgoing live tree is saved as the draft of the
-- OUTGOING year. Switching back therefore applies it and restores the tree
-- exactly — a mistaken เริ่มปี SAMO is reversible. Only when a draft is applied:
-- with no draft the live tree simply continues, as it always has.
--
-- BOTH SWITCH PATHS. The เริ่มปี SAMO button (start_team_term → here) and the
-- automatic 1 มี.ค. switch (passport.apply_season_schedule → here) both go
-- through _start_team_term, which is the only place a draft is applied. The
-- automatic path runs as whichever signed-in visitor's page load reached the
-- boundary, so the member UPDATE sets app.team_sync — the flag
-- team_members_self_update_guard already honours for system writes — or that
-- visitor's lack of team_edit would refuse the switch.
-- ============================================================

-- ── 1. The draft tables ─────────────────────────────────────────────────
-- LIKE keeps every column, default and CHECK of the live tables, so a draft row
-- can hold anything a live row can and the copy below is `select n.*`. When the
-- live tables gain a column, that copy fails LOUDLY until the draft gains it too
-- (and team0271 says which column), rather than silently carrying less.
create table if not exists public.team_draft_nodes
  (like public.team_nodes including defaults including constraints);
alter table public.team_draft_nodes
  add column if not exists term_year integer not null
    references public.team_terms(year) on delete cascade on update cascade;
-- Re-runnable: the FKs that depend on the primary keys go first.
alter table if exists public.team_draft_members
  drop constraint if exists team_draft_members_node_same_year;
alter table public.team_draft_nodes
  drop constraint if exists team_draft_nodes_parent_same_year;
alter table public.team_draft_nodes
  drop constraint if exists team_draft_nodes_pkey;
alter table public.team_draft_nodes
  add constraint team_draft_nodes_pkey primary key (term_year, id);
alter table public.team_draft_nodes
  drop constraint if exists team_draft_nodes_parent_same_year;
alter table public.team_draft_nodes
  add constraint team_draft_nodes_parent_same_year
  foreign key (term_year, parent_id)
  references public.team_draft_nodes (term_year, id) on delete cascade;

create table if not exists public.team_draft_members
  (like public.team_members including defaults including constraints);
alter table public.team_draft_members
  add column if not exists term_year integer not null
    references public.team_terms(year) on delete cascade on update cascade;
alter table public.team_draft_members
  drop constraint if exists team_draft_members_pkey;
alter table public.team_draft_members
  add constraint team_draft_members_pkey primary key (term_year, id);
alter table public.team_draft_members
  drop constraint if exists team_draft_members_node_same_year;
alter table public.team_draft_members
  add constraint team_draft_members_node_same_year
  foreign key (term_year, node_id)
  references public.team_draft_nodes (term_year, id) on delete cascade;

create index if not exists team_draft_nodes_parent_idx
  on public.team_draft_nodes (term_year, parent_id);
create index if not exists team_draft_members_node_idx
  on public.team_draft_members (term_year, node_id);

comment on table public.team_draft_nodes is
  'ทีม SAMO of a ปี SAMO that has not started (0271): same ids as team_nodes, applied by _start_team_term. Grants NOTHING — no permission resolver reads it. Rows of a PAST year are the undo copy of the tree that year replaced.';
comment on table public.team_draft_members is
  'Members of a not-yet-started ปี SAMO (0271). Placement columns are applied on switch; identity is the person''s (people), the copy here is display only.';

-- ── 2. Who may read and write a draft ───────────────────────────────────
-- Exactly the live tree's audience — anyone who can edit a draft can already
-- edit the live tree, so this adds no power. Writes are limited to years that
-- have NOT started: a past year's rows are the undo copy and only the switch
-- writes them. pg_default_acl hands anon every privilege on a new public table
-- (0188), so revoke first.
revoke all on public.team_draft_nodes, public.team_draft_members from anon, public;
grant select, insert, update, delete on public.team_draft_nodes, public.team_draft_members to authenticated;
alter table public.team_draft_nodes enable row level security;
alter table public.team_draft_members enable row level security;

drop policy if exists team_draft_nodes_read on public.team_draft_nodes;
create policy team_draft_nodes_read on public.team_draft_nodes for select to authenticated
  using (public.current_user_role() = any (array['vp_admin', 'dev'])
         or public.current_user_has_permission('team_edit')
         or public.current_user_has_permission('team'));
drop policy if exists team_draft_nodes_write on public.team_draft_nodes;
create policy team_draft_nodes_write on public.team_draft_nodes for all to authenticated
  using ((public.current_user_role() = any (array['vp_admin', 'dev'])
          or public.current_user_has_permission('team_edit'))
         and term_year > coalesce(public.current_samo_year(), 0))
  with check ((public.current_user_role() = any (array['vp_admin', 'dev'])
               or public.current_user_has_permission('team_edit'))
              and term_year > coalesce(public.current_samo_year(), 0));

drop policy if exists team_draft_members_read on public.team_draft_members;
create policy team_draft_members_read on public.team_draft_members for select to authenticated
  using (public.current_user_role() = any (array['vp_admin', 'dev'])
         or public.current_user_has_permission('team_edit')
         or public.current_user_has_permission('team'));
drop policy if exists team_draft_members_write on public.team_draft_members;
create policy team_draft_members_write on public.team_draft_members for all to authenticated
  using ((public.current_user_role() = any (array['vp_admin', 'dev'])
          or public.current_user_has_permission('team_edit'))
         and term_year > coalesce(public.current_samo_year(), 0))
  with check ((public.current_user_role() = any (array['vp_admin', 'dev'])
               or public.current_user_has_permission('team_edit'))
              and term_year > coalesce(public.current_samo_year(), 0));

-- ── 3. A draft tree cannot loop ─────────────────────────────────────────
-- The composite FK keeps a parent inside the same year; this keeps it from being
-- its own descendant (the live tree's editor refuses that client-side; a draft
-- must hold the same line at the table, since the switch writes it to live).
create or replace function public.team_draft_nodes_no_cycle()
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
    select parent_id into v_cur from public.team_draft_nodes
     where id = v_cur and term_year = new.term_year;
  end loop;
  return new;
end $$;

drop trigger if exists team_draft_nodes_no_cycle on public.team_draft_nodes;
create trigger team_draft_nodes_no_cycle
  before insert or update of parent_id on public.team_draft_nodes
  for each row when (new.parent_id is not null)
  execute function public.team_draft_nodes_no_cycle();

-- ── 4. Start preparing a year ───────────────────────────────────────────
-- p_from 'live' copies the live tree with its ids (the usual case: next year's
-- team is this year's, changed); 'empty' starts with nothing.
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
    insert into public.team_draft_nodes select n.*, p_year from public.team_nodes n;
    get diagnostics v_nodes = row_count;
    insert into public.team_draft_members select m.*, p_year from public.team_members m;
    get diagnostics v_members = row_count;
  end if;

  update public.team_terms set updated_at = now() where year = p_year;
  return jsonb_build_object('year', p_year, 'from', p_from,
                            'nodes', v_nodes, 'members', v_members);
end;
$function$;

revoke all on function public.start_team_draft(integer, text) from public, anon;
grant execute on function public.start_team_draft(integer, text) to authenticated;

-- ── 5. What the switch would do — said BEFORE anyone presses it ─────────
create or replace function public.team_draft_summary(p_year integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $function$
begin
  if not coalesce(
       public.current_user_role() = any (array['vp_admin', 'dev'])
       or public.current_user_has_permission('team_edit')
       or public.current_user_has_permission('team'), false) then
    raise exception 'team_draft_summary: not authorized';
  end if;
  if not exists (select 1 from public.team_draft_nodes where term_year = p_year) then
    return jsonb_build_object('year', p_year, 'prepared', false);
  end if;
  return jsonb_build_object(
    'year', p_year,
    'prepared', true,
    'nodes', (select count(*) from public.team_draft_nodes where term_year = p_year),
    'members', (select count(*) from public.team_draft_members where term_year = p_year),
    'nodes_added', (select count(*) from public.team_draft_nodes d
                     where d.term_year = p_year
                       and not exists (select 1 from public.team_nodes n where n.id = d.id)),
    'nodes_removed', (select count(*) from public.team_nodes n
                       where not exists (select 1 from public.team_draft_nodes d
                                          where d.term_year = p_year and d.id = n.id)),
    'members_added', (select count(*) from public.team_draft_members d
                       where d.term_year = p_year
                         and not exists (select 1 from public.team_members m where m.id = d.id)),
    'members_removed', (select count(*) from public.team_members m
                         where not exists (select 1 from public.team_draft_members d
                                            where d.term_year = p_year and d.id = m.id)),
    'members_changed', (select count(*) from public.team_draft_members d
                          join public.team_members m on m.id = d.id
                         where d.term_year = p_year
                           and (m.node_id, m.permissions, m.inherit_permissions, m.vs_dept,
                                m.project_seat, m.passport_dept_id, m.passport_sub_dept_id,
                                m.shop_source, m.dept_page)
                               is distinct from
                               (d.node_id, d.permissions, d.inherit_permissions, d.vs_dept,
                                d.project_seat, d.passport_dept_id, d.passport_sub_dept_id,
                                d.shop_source, d.dept_page)),
    'nodes_changed', (select count(*) from public.team_draft_nodes d
                        join public.team_nodes n on n.id = d.id
                       where d.term_year = p_year
                         and (n.parent_id, n.name, n.kind, n.permissions, n.inherit_permissions,
                              n.vs_dept, n.project_seat, n.is_public, n.passport_dept_id,
                              n.passport_sub_dept_id, n.shop_source, n.is_board, n.color,
                              n.tier, n.dept_page, n.discord_role)
                             is distinct from
                             (d.parent_id, d.name, d.kind, d.permissions, d.inherit_permissions,
                              d.vs_dept, d.project_seat, d.is_public, d.passport_dept_id,
                              d.passport_sub_dept_id, d.shop_source, d.is_board, d.color,
                              d.tier, d.dept_page, d.discord_role))
  );
end;
$function$;

revoke all on function public.team_draft_summary(integer) from public, anon;
grant execute on function public.team_draft_summary(integer) to authenticated;

-- ── 6. Applying a draft — called ONLY from _start_team_term ─────────────
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
begin
  if not exists (select 1 from public.team_draft_nodes where term_year = p_year) then
    return null;
  end if;

  -- Undo copy: the tree being replaced, as the outgoing year's draft.
  if p_outgoing is not null then
    delete from public.team_draft_nodes where term_year = p_outgoing;
    insert into public.team_draft_nodes select n.*, p_outgoing from public.team_nodes n;
    insert into public.team_draft_members select m.*, p_outgoing from public.team_members m;
  end if;

  -- Nodes. New ones go in parentless, then ONE update sets every parent, so the
  -- order rows arrive in can never violate team_nodes_parent_id_fkey.
  insert into public.team_nodes
         (id, name, kind, position, permissions, inherit_permissions, vs_dept,
          project_seat, is_public, passport_dept_id, passport_sub_dept_id,
          shop_source, is_board, color, tier, dept_page, discord_role)
  select d.id, d.name, d.kind, d.position, d.permissions, d.inherit_permissions,
         d.vs_dept, d.project_seat, d.is_public, d.passport_dept_id,
         d.passport_sub_dept_id, d.shop_source, d.is_board, d.color, d.tier,
         d.dept_page, d.discord_role
    from public.team_draft_nodes d
   where d.term_year = p_year
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

  -- New members: identity from the PERSON (see header) — found by the link or by
  -- kkumail; a link that no longer resolves is dropped and the row is linked
  -- again by kkumail (team_members_link_person) rather than failing the switch.
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
    -- The person: by the link, or — a row the people search filled carries only
    -- the kkumail — by that address, so it too takes the person's CURRENT identity.
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

  -- Continuing members: placement only. app.team_sync because the automatic
  -- switch can run as a visitor without team_edit (header).
  perform set_config('app.team_sync', '1', true);
  update public.team_members m
     set node_id = d.node_id, position = d.position,
         permissions = d.permissions, inherit_permissions = d.inherit_permissions,
         vs_dept = d.vs_dept, project_seat = d.project_seat,
         passport_dept_id = d.passport_dept_id, passport_sub_dept_id = d.passport_sub_dept_id,
         shop_source = d.shop_source, dept_page = d.dept_page
    from public.team_draft_members d
   where d.term_year = p_year and d.id = m.id
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
   where not exists (select 1 from public.team_draft_members d
                      where d.term_year = p_year and d.id = m.id);
  get diagnostics v_del_m = row_count;

  delete from public.team_nodes n
   where not exists (select 1 from public.team_draft_nodes d
                      where d.term_year = p_year and d.id = n.id);
  get diagnostics v_del_n = row_count;

  -- Consumed. The year now reads LIVE: published_at on the CURRENT year means
  -- "show the frozen archive", and this year's archive is empty, so a draft that
  -- had been shown ahead would otherwise put an empty chart on เกี่ยวกับเรา.
  delete from public.team_draft_nodes where term_year = p_year;
  update public.team_terms set published_at = null, hand_edited_at = null
   where year = p_year;

  return jsonb_build_object(
    'nodes_added', v_ins_n, 'nodes_changed', v_upd_n, 'nodes_removed', v_del_n,
    'members_added', v_ins_m, 'members_changed', v_upd_m, 'members_removed', v_del_m);
end;
$function$;

revoke all on function public._apply_team_draft(integer, integer) from public, anon, authenticated;

-- ── 7. _start_team_term applies it (body = the live 0270 one + step 6) ──
create or replace function public._start_team_term(p_year integer, p_at timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_current integer;
  v_now     timestamptz := coalesce(p_at, now());   -- 0248: the automatic switch passes the BOUNDARY
  v_closed  integer;
  v_archive jsonb := null;
  v_applied jsonb := null;
begin
  if p_year is null or p_year < 2500 or p_year > 2700 then
    raise exception 'start_team_term: bad year %', p_year;
  end if;

  select year into v_current from public.team_terms where is_current limit 1;

  if v_current is not distinct from p_year then
    raise exception 'start_team_term: ปี % เป็นปีปัจจุบันอยู่แล้ว', p_year;
  end if;

  if v_current is not null and exists (
       select 1 from public.team_terms
        where year = v_current and published_at is null) then
    select public._publish_team_term(v_current, true) into v_archive;
  end if;

  -- 0271: the prepared tree of the incoming year becomes the live one. After the
  -- outgoing archive above (it snapshots the tree being replaced) and BEFORE
  -- is_current moves, so the undo copy is filed under the outgoing year.
  v_applied := public._apply_team_draft(p_year, v_current);

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
           started_at = coalesce(public.team_terms.started_at, v_now),
           ended_at = null,
           updated_at = v_now;

  return jsonb_build_object(
    'year', p_year, 'previous_year', v_current,
    'started_at', v_now, 'closed_terms', v_closed,
    'archived_outgoing', (v_archive is not null),
    'applied_draft', v_applied
  );
end;
$function$;

revoke all on function public._start_team_term(integer, timestamptz) from public, anon, authenticated;

-- ── 8. เกี่ยวกับเรา can show a prepared year ahead ──────────────────────
-- A shown future year with a draft reads the DRAFT (is_public respected, as the
-- live branch does), so what the public sees is what will go live — no copy to
-- keep in step. Otherwise unchanged from 0270.
create or replace function public.get_public_team_chart(p_year integer default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $function$
declare
  v_current   integer;
  v_year      integer;
  v_published boolean;
  v_result    jsonb;
begin
  select t.year into v_current from public.team_terms t where t.is_current limit 1;
  v_year := coalesce(p_year, v_current);

  select (t.published_at is not null) into v_published
    from public.team_terms t where t.year = v_year;
  v_published := coalesce(v_published, false);

  if v_published and v_year > coalesce(v_current, 0)
     and exists (select 1 from public.team_draft_nodes d where d.term_year = v_year) then
    with recursive visible as (
      select n.id, n.parent_id, n.name, n.kind, n.position, n.is_board, n.color, n.tier
        from public.team_draft_nodes n
       where n.term_year = v_year and n.parent_id is null and n.is_public
      union all
      select c.id, c.parent_id, c.name, c.kind, c.position, c.is_board, c.color, c.tier
        from public.team_draft_nodes c
        join visible v on c.parent_id = v.id
       where c.term_year = v_year and c.is_public
    )
    select jsonb_build_object(
      'year', v_year,
      'is_current', false,
      'source', 'draft',
      'nodes', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', v.id, 'parent_id', v.parent_id,
                 'name', v.name, 'kind', v.kind, 'position', v.position,
                 'is_board', v.is_board, 'color', v.color, 'tier', v.tier)
               order by v.position, v.name)
          from visible v), '[]'::jsonb),
      'members', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'node_id', m.node_id,
                 'name', coalesce(p.full_name, m.full_name),
                 'nickname', case when p.id is null then m.nickname else p.nickname end,
                 'photo_url', case when p.id is null then m.photo_url else p.photo_url end,
                 'photo_focus', case when p.id is null then m.photo_focus else p.photo_focus end,
                 'position', m.position)
               order by m.position, m.full_name)
          from public.team_draft_members m
          join visible v on v.id = m.node_id
          left join public.people p on p.id = m.person_id
         where m.term_year = v_year), '[]'::jsonb)
    ) into v_result;
    return v_result;
  end if;

  if v_published then
    select jsonb_build_object(
      'year', v_year,
      'is_current', (v_year is not distinct from v_current),
      'source', 'archive',
      'nodes', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', n.id, 'parent_id', n.parent_id,
                 'name', n.name, 'kind', n.kind, 'position', n.position,
                 'is_board', n.is_board, 'color', n.color, 'tier', n.tier)
               order by n.position, n.name)
          from public.team_archive_nodes n
         where n.year = v_year), '[]'::jsonb),
      'members', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'node_id', m.node_id,
                 'name', m.full_name,
                 'nickname', m.nickname,
                 'photo_url', m.photo_url,
                 'photo_focus', m.photo_focus,
                 'position', m.position)
               order by m.position, m.full_name)
          from public.team_archive_members m
         where m.year = v_year), '[]'::jsonb)
    ) into v_result;
    return v_result;
  end if;

  if v_current is null or v_year is not distinct from v_current then
    with recursive visible as (
      select n.id, n.parent_id, n.name, n.kind, n.position, n.is_board,
             n.color, n.tier
        from public.team_nodes n
       where n.parent_id is null and n.is_public
      union all
      select c.id, c.parent_id, c.name, c.kind, c.position, c.is_board,
             c.color, c.tier
        from public.team_nodes c
        join visible v on c.parent_id = v.id
       where c.is_public
    )
    select jsonb_build_object(
      'year', v_current,
      'is_current', true,
      'source', 'live',
      'nodes', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', v.id, 'parent_id', v.parent_id,
                 'name', v.name, 'kind', v.kind, 'position', v.position,
                 'is_board', v.is_board, 'color', v.color, 'tier', v.tier)
               order by v.position, v.name)
          from visible v), '[]'::jsonb),
      'members', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'node_id', m.node_id,
                 'name', m.full_name,
                 'nickname', m.nickname,
                 'photo_url', m.photo_url,
                 'photo_focus', m.photo_focus,
                 'position', m.position)
               order by m.position, m.full_name)
          from public.team_members m
          join visible v on v.id = m.node_id), '[]'::jsonb)
    ) into v_result;
    return v_result;
  end if;

  return jsonb_build_object('year', v_year, 'is_current', false,
                            'source', 'none',
                            'nodes', '[]'::jsonb, 'members', '[]'::jsonb);
end;
$function$;

revoke all on function public.get_public_team_chart(integer) from public;
grant execute on function public.get_public_team_chart(integer) to anon, authenticated;

-- ── 9. Show/hide counts a prepared year's people too ────────────────────
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
    select (select count(*) from public.team_archive_members where year = p_year)
         + (case when p_year > coalesce(v_current, 0)
                 then (select count(*) from public.team_draft_members where term_year = p_year)
                 else 0 end)
      into v_people;
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
grant execute on function public.set_team_term_shown(integer, boolean) to authenticated;

-- ── 10. A picture a draft still uses is in use ──────────────────────────
create or replace function public.photo_reference_count(p_url text)
returns integer
language sql
stable
security definer
set search_path = public
as $function$
  select case
    when nullif(btrim(coalesce(p_url, '')), '') is null then 1
    else (select count(*)::int from public.team_members        where photo_url = btrim(p_url))
       + (select count(*)::int from public.team_archive_members where photo_url = btrim(p_url))
       + (select count(*)::int from public.team_draft_members   where photo_url = btrim(p_url))
       + (select count(*)::int from public.people              where photo_url = btrim(p_url))
       + (select count(*)::int from public.students            where photo_url = btrim(p_url))
       + (select count(*)::int from public.advisors            where photo_url = btrim(p_url))
       + (select count(*)::int from public.houses              where icon_url  = btrim(p_url))
       + (select count(*)::int from public.dept_content        where cover_url = btrim(p_url))
       + (select count(*)::int from public.dept_content        where video_url = btrim(p_url))
  end;
$function$;
