-- ============================================================
-- 0225 — "เผยแพร่ปีนี้" / "ตั้งเป็นปีปัจจุบัน" failed with
-- "DELETE requires a WHERE clause".
--
-- publish_team_term (newest body: 0153, copied here verbatim but for one
-- line) empties its scratch table with a bare `delete from _pub_photos;`.
-- Every request from the site goes through PostgREST, whose `authenticator`
-- role preloads the `safeupdate` library: a DELETE or UPDATE with no WHERE is
-- refused, inside a SECURITY DEFINER function too. So the publish button has
-- failed for every caller since 0104 (2026-07-30) — production has never had a
-- published term — and the year handover (0224) inherited it.
--
-- Nothing caught it because every proof runs through the Management API,
-- where safeupdate is NOT loaded (and cannot be: "access to library
-- safeupdate is not allowed"). Reproduced on samo-dev through PostgREST with
-- a throwaway anon RPC: bare DELETE → 21000 "DELETE requires a WHERE
-- clause"; `where true` → ok. Guard: tools/safeupdate.test.js reads the newest
-- body of every function and fails on a WHERE-less DELETE/UPDATE.
-- ============================================================

create or replace function public.publish_team_term(p_year integer)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_nodes   integer;
  v_members integer;
  v_kept    integer;
begin
  -- coalesce(..., false) is load-bearing. current_user_role() is NULL for a
  -- caller with no public.users row, and `null = any(...)` is NULL, so a bare
  -- `if not (...)` would evaluate `not null` = null, skip the raise, and run the
  -- privileged body.
  if not coalesce(
       public.current_user_role() = any (array['vp_admin', 'dev'])
       or public.current_user_has_permission('team_edit'), false) then
    raise exception 'publish_team_term: not authorized';
  end if;

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
$$;
