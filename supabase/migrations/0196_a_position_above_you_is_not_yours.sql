-- 0196_a_position_above_you_is_not_yours.sql
--
-- NINE PEOPLE WERE GIVEN THE HEAD'S DISCORD ROLE.
--
-- Reported by the owner 2026-09-19: "why มิกซ์มี่ got role หัวหน้าฝ่าย PR, also
-- many people on discord". In ทีม SAMO, `ฝ่าย Content creator` and `ฝ่าย Media
-- management` sit UNDER the ตำแหน่ง `หัวหน้าฝ่าย PR` — a position used as a
-- folder. discord_role_targets() gave every linked person the role of EVERY
-- ticked node above them, so once that ตำแหน่ง was ticked (the 90 adopted
-- 2026-09-19), everyone in both sub-ฝ่าย received `หัวหน้าฝ่าย PR`, which can
-- manage 8 channels. Only เอื้อย, the actual head, held it that morning.
--
-- The rule "a member receives their own node's role plus every ticked
-- ancestor's" (DISCORD-ROLE-SYNC.md §5c) was written for ฝ่าย, where belonging
-- is inherited. A ตำแหน่ง is not inherited: sitting under the head does not
-- make you the head. Now: your OWN node's role (any kind), plus the role of
-- every ancestor that is a DIVISION. A role-kind ancestor is skipped — the walk
-- continues past it, so the ฝ่าย above it are still yours.
--
-- Body copied from the LIVE pg_get_functiondef (2026-09-19); the only change is
-- the `and (a.node_id = s.node_id or n.kind = 'division')` line. Grants are
-- untouched by CREATE OR REPLACE. Proof: tools/team0196-position-not-inherited.sql.

CREATE OR REPLACE FUNCTION public.discord_role_targets()
 RETURNS TABLE(discord_user_id text, person_id uuid, role_ids text[], role_names text[], pending text[], placements integer)
 LANGUAGE sql
 STABLE
AS $function$
  with linked as (
    select dl.person_id, dl.discord_user_id from public.discord_links dl
  ),
  seats as (
    select l.person_id, l.discord_user_id, tm.node_id
      from linked l
      join public.team_members tm on tm.person_id = l.person_id
  ),
  due as (
    select distinct s.person_id, s.discord_user_id, n.id, n.name, n.discord_role_id
      from seats s
      cross join lateral public.discord_node_ancestry(s.node_id) a
      join public.team_nodes n on n.id = a.node_id
     where n.discord_role
       and (a.node_id = s.node_id or n.kind = 'division')
  )
  select
    l.discord_user_id,
    l.person_id,
    coalesce(array_agg(d.discord_role_id order by d.name)
               filter (where d.discord_role_id is not null), '{}') as role_ids,
    coalesce(array_agg(d.name order by d.name)
               filter (where d.discord_role_id is not null), '{}') as role_names,
    coalesce(array_agg(d.name order by d.name)
               filter (where d.discord_role_id is null), '{}')     as pending,
    (select count(distinct tm.node_id)::int from public.team_members tm
      where tm.person_id = l.person_id)                            as placements
  from linked l
  left join due d on d.person_id = l.person_id
  group by l.discord_user_id, l.person_id;
$function$;
