-- ============================================================
-- team0270-hand-built-years.sql — a ทีม SAMO year built by hand (0270)
--   §0  structural: the ONLY functions that read team_archive_* (the archive
--       grants nothing — a resolver reading it would make a typed-in name a
--       permission), the new signatures, anon cannot call them
--   §A  copy_team_year from the live tree: every public ตำแหน่ง and person,
--       hidden until shown, marked hand-edited, the portal's year untouched
--   §B  set_team_term_shown: the year appears on เกี่ยวกับเรา from its archive
--   §C  a ตำแหน่ง and a person added by hand appear in the public chart
--   §D  ⛔ publish refuses to rebuild a hand-edited year; with replace=true it
--       rebuilds and clears the mark (the control that the refusal is the
--       guard, not a broken function)
--   §E  integrity: no cross-year node, no ตำแหน่ง under its own descendant
--   §F  copy_team_year from another year keeps every parent and every person
--   §G  refusals: into the current year, into a non-empty year, show the
--       current year, show an empty year, a caller without team_edit
--   §H  the automatic switch rebuilds an unpublished outgoing year anyway
--   §I  deleting a year that holds a hand-built list still works
-- Sentinel years 2687/2688/2686 — below every other proof's range (2691+).
-- Rolled back.
--
--   node tools/db-query.mjs tools/team0270-hand-built-years.sql [--dev]
-- ============================================================
begin;

create temporary table probe (step text, expected text, got text) on commit drop;

-- ── §0 structural ────────────────────────────────────────────────────────
insert into probe select '00. the functions that read team_archive_* are exactly the known set',
  '_publish_team_term,copy_team_year,get_public_team_chart,photo_reference_count,set_team_term_shown,team_archive_nodes_no_cycle',
  (select string_agg(distinct p.proname, ',' order by p.proname) from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'passport') and p.prosrc ilike '%team_archive_%');

insert into probe select '01. publish_team_term(integer, boolean) exists and the 1-arg one is gone', '1|0',
  (select count(*) filter (where pg_get_function_identity_arguments(p.oid) = 'p_year integer, p_replace_hand_edits boolean')
          || '|' || count(*) filter (where pg_get_function_identity_arguments(p.oid) = 'p_year integer')
     from pg_proc p where p.proname = 'publish_team_term' and p.pronamespace = 'public'::regnamespace);

insert into probe select '02. anon can execute none of publish / copy / show', 'false|false|false',
  (select has_function_privilege('anon', 'public.publish_team_term(integer, boolean)', 'execute')
     || '|' || has_function_privilege('anon', 'public.copy_team_year(integer, integer)', 'execute')
     || '|' || has_function_privilege('anon', 'public.set_team_term_shown(integer, boolean)', 'execute'));

insert into probe select '03. authenticated can execute all three (the RPC states its own permission check)', 'true|true|true',
  (select has_function_privilege('authenticated', 'public.publish_team_term(integer, boolean)', 'execute')
     || '|' || has_function_privilege('authenticated', 'public.copy_team_year(integer, integer)', 'execute')
     || '|' || has_function_privilege('authenticated', 'public.set_team_term_shown(integer, boolean)', 'execute'));

insert into probe select '04. _publish_team_term is not callable by authenticated', 'false',
  (select has_function_privilege('authenticated', 'public._publish_team_term(integer, boolean)', 'execute')::text);

-- ── principals ───────────────────────────────────────────────────────────
create temporary table actor on commit drop as
select u.id, lower(btrim(u.email)) as email from public.users u
 where u.role = 'dev'
    or 'master' = any (coalesce(u.permissions,'{}') || coalesce(u.managed_permissions,'{}'))
 order by u.id limit 1;
create temporary table plain on commit drop as
select u.id, lower(btrim(u.email)) as email from public.users u
 where u.role = 'user'
   and coalesce(array_length(u.permissions, 1), 0) = 0
   and coalesce(array_length(u.managed_permissions, 1), 0) = 0
 order by u.id limit 1;
insert into probe select '05. a team_edit actor and a plain signed-in user exist', '1|1',
  (select (select count(*) from actor) || '|' || (select count(*) from plain));

create or replace function pg_temp.as_(p_tbl text) returns void language plpgsql as $$
declare v text;
begin
  execute format('select json_build_object(''sub'', id, ''role'', ''authenticated'', ''email'', email)::text from %I', p_tbl) into v;
  perform set_config('request.jwt.claims', v, true);
end $$;
create or replace function pg_temp.try(p_sql text) returns text language plpgsql as $$
declare n int;
begin execute p_sql; get diagnostics n = row_count; return 'ok:' || n;
exception when others then return 'raised: ' || sqlerrm; end $$;
create or replace function pg_temp.val(p_sql text) returns text language plpgsql as $$
declare v text;
begin execute p_sql into v; return v;
exception when others then return 'raised: ' || sqlerrm; end $$;
grant execute on function pg_temp.try(text), pg_temp.val(text) to authenticated, anon;
create temporary table r (k text, v text) on commit drop;
grant insert, select on r to authenticated, anon;

delete from public.team_terms where year in (2686, 2687, 2688);
create temporary table before_cur on commit drop as select public.current_samo_year() as y;

create temporary table live_counts on commit drop as
with recursive live as (
  select n.id from public.team_nodes n where n.parent_id is null and n.is_public
  union all
  select c.id from public.team_nodes c join live l on c.parent_id = l.id where c.is_public
)
select (select count(*) from live) as nodes,
       (select count(*) from public.team_members m join live l on l.id = m.node_id) as members;

-- ── §A copy from the live tree ───────────────────────────────────────────
select pg_temp.as_('actor');
set local role authenticated;
insert into r select 'copyA', pg_temp.val($q$select public.copy_team_year(2687, null)::text$q$);
reset role;
insert into probe select '10. copy_team_year(2687, live) copies every public ตำแหน่ง and person', 'true',
  (select ((select v from r where k = 'copyA')::jsonb ->> 'nodes' = nodes::text
       and (select v from r where k = 'copyA')::jsonb ->> 'members' = members::text
       and members > 0)::text from live_counts);
insert into probe select '11. …it is hidden (not published) and marked hand-edited', 'false|true',
  (select (published_at is not null) || '|' || (hand_edited_at is not null) from public.team_terms where year = 2687);
insert into probe select '12. …not listed on เกี่ยวกับเรา yet', 'false',
  (select (public.get_public_team_years() @> '[{"year":2687}]')::text);
insert into probe select '13. …and the portal''s year did not move', 'true',
  (select (public.current_samo_year() is not distinct from y)::text from before_cur);

-- ── §B show it ───────────────────────────────────────────────────────────
select pg_temp.as_('actor');
set local role authenticated;
insert into r select 'show', pg_temp.val($q$select public.set_team_term_shown(2687, true)::text$q$);
reset role;
insert into probe select '20. set_team_term_shown(2687, true) shows it', 'true',
  (select ((select v from r where k = 'show')::jsonb ->> 'shown'));
insert into probe select '21. get_public_team_years lists 2687, not as current', 'true',
  (select (public.get_public_team_years() @> '[{"year":2687,"is_current":false}]')::text);
insert into probe select '22. get_public_team_chart(2687) serves the archive with every copied person', 'true',
  (select (c ->> 'source' = 'archive' and jsonb_array_length(c -> 'members') = lc.members)::text
     from live_counts lc, lateral (select public.get_public_team_chart(2687) as c) x);
insert into probe select '23. the current year''s chart is unchanged (still the live tree or its own snapshot)', 'true',
  (select ((public.get_public_team_chart(null) ->> 'year')::int is not distinct from y)::text from before_cur);

-- ── §C a ตำแหน่ง and a person added by hand ──────────────────────────────
update public.team_terms set hand_edited_at = null where year = 2687;
select pg_temp.as_('actor');
set local role authenticated;
insert into r select 'addNode', pg_temp.try($q$insert into public.team_archive_nodes (id, year, parent_id, name, kind, position)
  values ('00000000-0000-4000-8000-000000002701', 2687, null, 'ฝ่ายทดสอบ 0270', 'division', 999)$q$);
insert into r select 'addMember', pg_temp.try($q$insert into public.team_archive_members (year, node_id, full_name, nickname, position)
  values (2687, '00000000-0000-4000-8000-000000002701', 'คนพิมพ์เอง ทดสอบ', 'ทดสอบ', 0)$q$);
reset role;
insert into probe select '30. an actor adds a ฝ่าย and a person to 2687 by hand', 'ok:1|ok:1',
  (select (select v from r where k = 'addNode') || '|' || (select v from r where k = 'addMember'));
insert into probe select '31. …the person is in the public chart', 'true',
  (select (public.get_public_team_chart(2687) -> 'members' @> '[{"name":"คนพิมพ์เอง ทดสอบ"}]')::text);
insert into probe select '32. …and the year is marked hand-edited again (the trigger, not the copy, set it)', 'true',
  (select (hand_edited_at is not null)::text from public.team_terms where year = 2687);

-- ── §D publish refuses, then replaces when told ──────────────────────────
select pg_temp.as_('actor');
set local role authenticated;
insert into r select 'pubRefuse', pg_temp.val($q$select public.publish_team_term(2687)::text$q$);
reset role;
insert into probe select '40. publish_team_term(2687) refuses a hand-edited year, naming the head-count', 'true',
  (select (v like 'raised: TEAM_YEAR_HAND_EDITED:%' and split_part(v, ':', 3)::int = lc.members + 1)::text
     from r, live_counts lc where k = 'pubRefuse');
insert into probe select '41. …and the hand-added person is still there', '1',
  (select count(*)::text from public.team_archive_members where year = 2687 and full_name = 'คนพิมพ์เอง ทดสอบ');

select pg_temp.as_('actor');
set local role authenticated;
insert into r select 'pubReplace', pg_temp.val($q$select public.publish_team_term(2687, true)::text$q$);
reset role;
insert into probe select '42. with replace=true it rebuilds from the live tree (the CONTROL)', 'true',
  (select ((select v from r where k = 'pubReplace')::jsonb ->> 'members' = members::text)::text from live_counts);
insert into probe select '43. …the hand-added person is gone and the mark is cleared', '0|false',
  (select (select count(*) from public.team_archive_members where year = 2687 and full_name = 'คนพิมพ์เอง ทดสอบ')
     || '|' || (select (hand_edited_at is not null) from public.team_terms where year = 2687));

-- ── §E integrity ─────────────────────────────────────────────────────────
insert into public.team_terms (year) values (2686);
insert into public.team_archive_nodes (id, year, name, kind) values
  ('00000000-0000-4000-8000-000000002702', 2686, 'ราก 2686', 'division'),
  ('00000000-0000-4000-8000-000000002703', 2686, 'ลูก 2686', 'role');
update public.team_archive_nodes set parent_id = '00000000-0000-4000-8000-000000002702'
 where id = '00000000-0000-4000-8000-000000002703';

select pg_temp.as_('actor');
set local role authenticated;
insert into r select 'crossYear', pg_temp.try($q$insert into public.team_archive_members (year, node_id, full_name)
  values (2687, '00000000-0000-4000-8000-000000002702', 'ข้ามปี')$q$);
insert into r select 'crossParent', pg_temp.try($q$update public.team_archive_nodes
  set parent_id = '00000000-0000-4000-8000-000000002702'
  where id = (select id from public.team_archive_nodes where year = 2687 and parent_id is null order by id limit 1)$q$);
insert into r select 'cycle', pg_temp.try($q$update public.team_archive_nodes
  set parent_id = '00000000-0000-4000-8000-000000002703'
  where id = '00000000-0000-4000-8000-000000002702'$q$);
insert into r select 'moveOk', pg_temp.try($q$update public.team_archive_nodes set parent_id = null
  where id = '00000000-0000-4000-8000-000000002703'$q$);
reset role;
insert into probe select '50. a person cannot sit on a ตำแหน่ง of another year', 'true',
  (select (v like 'raised:%team_archive_members_node_same_year%')::text from r where k = 'crossYear');
insert into probe select '51. a ตำแหน่ง cannot hang under another year''s ตำแหน่ง (subject: a ROOT, so the row exists)', 'true',
  (select (v like 'raised:%team_archive_nodes_parent_same_year%')::text from r where k = 'crossParent');
insert into probe select '52. a ตำแหน่ง cannot move under its own descendant', 'true',
  (select (v like 'raised:%ตำแหน่งย่อยของตัวเอง%')::text from r where k = 'cycle');
insert into probe select '53. an ordinary move (to the top level) is allowed — the control', 'ok:1',
  (select v from r where k = 'moveOk');

-- ── §F copy from another year ────────────────────────────────────────────
select pg_temp.as_('actor');
set local role authenticated;
insert into r select 'copyF', pg_temp.val($q$select public.copy_team_year(2688, 2687)::text$q$);
reset role;
insert into probe select '60. copy_team_year(2688, 2687) copies the same number of ตำแหน่ง and people', 'true',
  (select ((select v from r where k = 'copyF')::jsonb ->> 'nodes' = (select count(*)::text from public.team_archive_nodes where year = 2687)
       and (select v from r where k = 'copyF')::jsonb ->> 'members' = (select count(*)::text from public.team_archive_members where year = 2687))::text);
insert into probe select '61. …every (parent, ตำแหน่ง, person) triple is the same in both years', '0|0',
  (with t as (
     select n.year, coalesce(p.name, '') as parent, n.name as node, coalesce(m.full_name, '') as person
       from public.team_archive_nodes n
       left join public.team_archive_nodes p on p.id = n.parent_id
       left join public.team_archive_members m on m.node_id = n.id
      where n.year in (2687, 2688))
   select (select count(*) from (select parent, node, person from t where year = 2687
                                 except all select parent, node, person from t where year = 2688) a)
     || '|' || (select count(*) from (select parent, node, person from t where year = 2688
                                 except all select parent, node, person from t where year = 2687) b));
insert into probe select '62. …and no copied row points into the source year', '0',
  (select count(*)::text from public.team_archive_nodes n join public.team_archive_nodes p on p.id = n.parent_id
    where n.year = 2688 and p.year <> 2688);

-- ── §G refusals ──────────────────────────────────────────────────────────
select pg_temp.as_('actor');
set local role authenticated;
insert into r select 'intoCurrent', pg_temp.val($q$select public.copy_team_year((select year from public.team_terms where is_current), 2687)::text$q$);
insert into r select 'intoFull', pg_temp.val($q$select public.copy_team_year(2688, null)::text$q$);
insert into r select 'showCurrent', pg_temp.val($q$select public.set_team_term_shown((select year from public.team_terms where is_current), false)::text$q$);
insert into r select 'emptyYear', pg_temp.try($q$delete from public.team_archive_nodes where year = 2686$q$);
insert into r select 'showEmpty', pg_temp.val($q$select public.set_team_term_shown(2686, true)::text$q$);
reset role;
select pg_temp.as_('plain');
set local role authenticated;
insert into r select 'plainCopy', pg_temp.val($q$select public.copy_team_year(2686, null)::text$q$);
insert into r select 'plainShow', pg_temp.val($q$select public.set_team_term_shown(2687, false)::text$q$);
insert into r select 'plainPub', pg_temp.val($q$select public.publish_team_term(2686)::text$q$);
reset role;
insert into probe select '70. copy into the current year is refused', 'true',
  (select (v like 'raised:%ปีปัจจุบัน%')::text from r where k = 'intoCurrent');
insert into probe select '71. copy into a year that already has a list is refused', 'true',
  (select (v like 'raised:%มีรายชื่ออยู่แล้ว%')::text from r where k = 'intoFull');
insert into probe select '72. show/hide of the current year is refused', 'true',
  (select (v like 'raised:%ปีปัจจุบัน%')::text from r where k = 'showCurrent');
insert into probe select '73. showing a year with nobody in it is refused', 'true',
  (select (v like 'raised:%ยังไม่มีรายชื่อ%')::text from r where k = 'showEmpty');
insert into probe select '74. a signed-in user without team_edit can copy / show / publish nothing', 'true|true|true',
  (select (select (v like 'raised:%not authorized%')::text from r where k = 'plainCopy')
     || '|' || (select (v like 'raised:%not authorized%')::text from r where k = 'plainShow')
     || '|' || (select (v like 'raised:%not authorized%')::text from r where k = 'plainPub'));
insert into probe select '75. …and 2687 is still shown (the plain user''s hide did nothing)', 'true',
  (select (published_at is not null)::text from public.team_terms where year = 2687);

-- ── §H the automatic switch passes replace=true ──────────────────────────
insert into probe select '80. _start_team_term rebuilds an unpublished outgoing year with replace=true', 'true',
  (select (pg_get_functiondef('public._start_team_term(integer, timestamptz)'::regprocedure)
           like '%public._publish_team_term(v_current, true)%')::text);

-- ── §I delete a year holding a hand-built list ───────────────────────────
select pg_temp.as_('actor');
set local role authenticated;
insert into r select 'del', pg_temp.try($q$delete from public.team_terms where year = 2688$q$);
reset role;
insert into probe select '90. deleting year 2688 (hand-built list) works and takes its rows with it', 'ok:1|0',
  (select (select v from r where k = 'del') || '|'
     || (select count(*) from public.team_archive_members where year = 2688));

select step,
       case when got is not distinct from expected then 'PASS' else 'FAIL' end as result,
       expected, got
  from probe order by step;

rollback;
