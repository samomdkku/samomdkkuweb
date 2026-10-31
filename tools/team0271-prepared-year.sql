-- ============================================================
-- team0271-prepared-year.sql — next year's ทีม SAMO prepared ahead, applied
-- on switch day (0271)
--   §0  structural: ONLY the known functions read team_draft_* (a permission
--       resolver reading it would make a prepared grant live early); the draft
--       has the live tables' columns; every live column is APPLIED or on the
--       named exclusion list (a registry — a new column fails here, not in prod)
--   §A  start_team_draft(live) copies the live tree with the SAME ids
--   §B  who may touch a draft, both directions: an editor writes a future year;
--       nobody writes the current or a past year; a plain user reads nothing
--   §C  a switch with NO draft changes nothing in the live tree (control)
--   §D  edits to the draft; team_draft_summary says what the switch will do
--   §E  shown ahead: เกี่ยวกับเรา reads the DRAFT, with the person's identity
--   §F  ⛔ the switch, run as a PLAIN signed-in visitor (the automatic 1 มี.ค.
--       path): the draft becomes live — moved, re-permissioned, added, removed —
--       and a continuing member keeps the LIVE identity, a new one takes the
--       PERSON's (not the stale draft copy), Discord + Passport links survive
--   §G  undo: switching back restores the exact tree it replaced
--   §H  refusals
--   §I  deleting a year takes its draft with it
-- Sentinel years 2683–2685 — below every other proof's range. Rolled back.
--
--   node tools/db-query.mjs tools/team0271-prepared-year.sql [--dev]
-- ============================================================
begin;

create temporary table probe (step text, expected text, got text) on commit drop;

-- ── §0 structural ────────────────────────────────────────────────────────
insert into probe select '00. the functions that read team_draft_* are exactly the known set',
  '_apply_team_draft,get_public_team_chart,photo_reference_count,set_team_term_shown,start_team_draft,team_draft_nodes_no_cycle,team_draft_summary',
  (select string_agg(distinct p.proname, ',' order by p.proname) from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'passport') and p.prosrc ~ 'team_draft_(nodes|members)');

insert into probe select '01. RLS on both draft tables; anon holds no privilege on either', 'true|true|false|false',
  (select (select relrowsecurity from pg_class where oid = 'public.team_draft_nodes'::regclass)
     || '|' || (select relrowsecurity from pg_class where oid = 'public.team_draft_members'::regclass)
     || '|' || has_table_privilege('anon', 'public.team_draft_nodes', 'select,insert,update,delete')
     || '|' || has_table_privilege('anon', 'public.team_draft_members', 'select,insert,update,delete'));

insert into probe select '02. draft columns = live columns + term_year, in order (nodes|members)', 'true|true',
  (select ((select string_agg(column_name, ',' order by ordinal_position) from information_schema.columns
             where table_schema = 'public' and table_name = 'team_nodes') || ',term_year'
          = (select string_agg(column_name, ',' order by ordinal_position) from information_schema.columns
             where table_schema = 'public' and table_name = 'team_draft_nodes'))::text
     || '|' ||
          ((select string_agg(column_name, ',' order by ordinal_position) from information_schema.columns
             where table_schema = 'public' and table_name = 'team_members') || ',term_year'
          = (select string_agg(column_name, ',' order by ordinal_position) from information_schema.columns
             where table_schema = 'public' and table_name = 'team_draft_members'))::text);

-- Every team_nodes column is set by the apply (`col = d.col`) or excluded by name.
insert into probe select '03. every team_nodes column is applied or excluded by name (unlisted: none)', '',
  (select coalesce(string_agg(c.column_name, ',' order by c.column_name), '')
     from information_schema.columns c
    where c.table_schema = 'public' and c.table_name = 'team_nodes'
      and c.column_name not in ('id', 'created_at', 'updated_at', 'discord_role_id')
      and pg_get_functiondef('public._apply_team_draft(integer, integer)'::regprocedure)
          !~ ('\m' || c.column_name || ' = d\.' || c.column_name || '\M'));

-- A continuing member gets EXACTLY the placement columns — not one identity column.
insert into probe select '04. a continuing member is updated in exactly the placement columns',
  'dept_page,inherit_permissions,node_id,passport_dept_id,passport_sub_dept_id,permissions,position,project_seat,shop_source,vs_dept',
  (select string_agg(c.column_name, ',' order by c.column_name)
     from information_schema.columns c
    where c.table_schema = 'public' and c.table_name = 'team_members' and c.column_name <> 'id'
      and pg_get_functiondef('public._apply_team_draft(integer, integer)'::regprocedure)
          ~ ('\m' || c.column_name || ' = d\.' || c.column_name || '\M'));

-- A NEW member is inserted with every column but the bookkeeping ones.
insert into probe select '05. every team_members column is inserted for a new member (unlisted: none)', '',
  (select coalesce(string_agg(c.column_name, ',' order by c.column_name), '')
     from information_schema.columns c
    where c.table_schema = 'public' and c.table_name = 'team_members'
      and c.column_name not in ('created_at', 'updated_at')
      and position(c.column_name in substring(
            pg_get_functiondef('public._apply_team_draft(integer, integer)'::regprocedure)
            from 'insert into public\.team_members\s*\(([^)]*)\)')) = 0);

insert into probe select '06. anon executes none of start/summary; nobody but the switch runs _apply', 'false|false|false|false',
  (select has_function_privilege('anon', 'public.start_team_draft(integer, text)', 'execute')
     || '|' || has_function_privilege('anon', 'public.team_draft_summary(integer)', 'execute')
     || '|' || has_function_privilege('authenticated', 'public._apply_team_draft(integer, integer)', 'execute')
     || '|' || has_function_privilege('authenticated', 'public._start_team_term(integer, timestamptz)', 'execute'));

-- ── principals + subjects ────────────────────────────────────────────────
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
   and not exists (select 1 from public.team_members m where lower(m.kkumail) = lower(u.email))
 order by u.id limit 1;

-- P is CREATED here: a person nobody has placed in ทีม SAMO yet (production has
-- some, samo-dev has none — a subject that can run out is made, not searched for).
insert into public.people (id, kkumail, full_name, nickname)
values ('00000000-0000-4000-8000-000000002710', 'proof0271.person@kkumail.com', 'คนใหม่ ทดสอบ', 'ORIG'),
       ('00000000-0000-4000-8000-000000002720', 'proof0271.mailonly@kkumail.com', 'คนที่สอง ทดสอบ', 'ORIG2');

-- L: a leaf ตำแหน่ง holding people. E1, E2: two members outside L, E1 with a
-- kkumail (so its effective permissions can be asked). P: a person with no
-- ทีม placement, to be the NEW member. DN: a continuing node with a Discord role.
create temporary table subj on commit drop as
with leaf as (
  select n.id from public.team_nodes n
   where not exists (select 1 from public.team_nodes c where c.parent_id = n.id)
     and exists (select 1 from public.team_members m where m.node_id = n.id)
     and n.parent_id is not null
     and not exists (select 1 from passport.departments d where d.team_node_id = n.id)
     and not exists (select 1 from passport.sub_departments d where d.team_node_id = n.id)
   order by n.id limit 1)
select (select id from leaf) as l,
       (select m.id from public.team_members m
         where m.node_id <> (select id from leaf) and nullif(btrim(m.kkumail), '') is not null
           and not ('pr' = any (m.permissions))
         order by m.id limit 1) as e1,
       (select m.id from public.team_members m
         where m.node_id <> (select id from leaf)
         order by m.id desc limit 1) as e2,
       '00000000-0000-4000-8000-000000002710'::uuid as p,
       (select n.id from public.team_nodes n where n.discord_role_id is not null
         and n.id <> (select id from leaf) order by n.id limit 1) as dn,
       (select n.id from public.team_nodes n where n.parent_id is null order by n.position, n.id limit 1) as root;

insert into probe select '07. subjects exist: actor, plain, L, E1, E2≠E1, P, root', '1|1|true',
  (select (select count(*) from actor) || '|' || (select count(*) from plain) || '|'
     || (l is not null and e1 is not null and e2 is not null and e1 <> e2 and p is not null and root is not null)::text
     from subj);

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
-- A refusal is stored as 'raised: …'; reading it as json must give a FAILING
-- row, never abort the script (an aborted proof is silence, not red).
create or replace function pg_temp.j(p text) returns jsonb language plpgsql as $$
begin return p::jsonb; exception when others then return jsonb_build_object('raised', p); end $$;
grant execute on function pg_temp.try(text), pg_temp.val(text) to authenticated, anon;
create temporary table r (k text, v text) on commit drop;
grant insert, select on r to authenticated, anon;
grant select on subj to authenticated, anon;

-- A fingerprint of everything the switch may change in the live tree.
create or replace function pg_temp.fp(p_link boolean default true) returns text language sql as $$
  select md5(
    coalesce((select string_agg(concat_ws('~', n.id, n.parent_id, n.name, n.kind, n.position,
                n.permissions, n.inherit_permissions, n.vs_dept, n.project_seat, n.is_public,
                n.passport_dept_id, n.passport_sub_dept_id, n.shop_source, n.is_board,
                n.color, n.tier, n.dept_page, n.discord_role, n.discord_role_id), '|' order by n.id)
                from public.team_nodes n), '')
    || '#' ||
    coalesce((select string_agg(concat_ws('~', m.id, m.node_id, m.position, m.permissions,
                m.inherit_permissions, m.vs_dept, m.project_seat, m.passport_dept_id,
                m.passport_sub_dept_id, m.shop_source, m.dept_page, m.kkumail, m.full_name,
                m.nickname, case when p_link then m.person_id end), '|' order by m.id)
                from public.team_members m), ''))
$$;

delete from public.team_terms where year in (2683, 2684, 2685);
create temporary table orig on commit drop as
select public.current_samo_year() as y, pg_temp.fp() as fp, pg_temp.fp(false) as pg_temp_fp_nolink,
       (select count(*) from public.team_nodes) as nodes,
       (select count(*) from public.team_members) as members,
       (select count(*) from passport.departments where team_node_id is not null)
     + (select count(*) from passport.sub_departments where team_node_id is not null) as pp_links,
       (select discord_role_id from public.team_nodes where id = (select dn from subj)) as dn_role;
create temporary table snapm on commit drop as select id, person_id from public.team_members;
insert into public.team_terms (year) values (2683), (2684), (2685);
grant select on orig to authenticated, anon;

-- ── §A start a draft from the live tree ──────────────────────────────────
select pg_temp.as_('actor');
set local role authenticated;
insert into r select 'startA', pg_temp.val($q$select public.start_team_draft(2685, 'live')::text$q$);
reset role;
insert into probe select '10. start_team_draft(2685, live) copies every node and member', 'true',
  (select (pg_temp.j((select v from r where k = 'startA')) ->> 'nodes' = nodes::text
       and pg_temp.j((select v from r where k = 'startA')) ->> 'members' = members::text
       and members > 0)::text from orig);
insert into probe select '11. …with the SAME ids (none missing either way)', '0|0',
  (select (select count(*) from public.team_nodes n where not exists
            (select 1 from public.team_draft_nodes d where d.term_year = 2685 and d.id = n.id))
     || '|' || (select count(*) from public.team_members m where not exists
            (select 1 from public.team_draft_members d where d.term_year = 2685 and d.id = m.id)));
insert into probe select '12. preparing a draft grants nothing: the live tree is untouched', 'true',
  (select (pg_temp.fp() = fp)::text from orig);

-- ── §B who may touch a draft ─────────────────────────────────────────────
select pg_temp.as_('plain');
set local role authenticated;
insert into r select 'plainRead', pg_temp.val($q$select count(*)::text from public.team_draft_members where term_year = 2685$q$);
insert into r select 'plainWrite', pg_temp.try($q$update public.team_draft_nodes set name = name where term_year = 2685$q$);
insert into r select 'plainStart', pg_temp.val($q$select public.start_team_draft(2684, 'empty')::text$q$);
reset role;
insert into probe select '20. a plain user reads 0 draft rows, updates 0, cannot start a draft', '0|ok:0|raised',
  (select (select v from r where k = 'plainRead') || '|' || (select v from r where k = 'plainWrite')
     || '|' || split_part((select v from r where k = 'plainStart'), ':', 1));

select pg_temp.as_('actor');
set local role authenticated;
insert into r select 'actorWrite', pg_temp.try($q$update public.team_draft_nodes set position = position where term_year = 2685$q$);
insert into r select 'curWrite', pg_temp.try(format($q$insert into public.team_draft_nodes (term_year, name, kind) values (%s, 'x', 'division')$q$,
  (select y from orig)));
reset role;
insert into probe select '21. the editor writes a future year (allow) but not the current one (deny)', 'true|raised',
  (select ((select v from r where k = 'actorWrite') = 'ok:' || nodes)::text
     || '|' || split_part((select v from r where k = 'curWrite'), ':', 1) from orig);

-- ── §C control: a switch with NO draft changes nothing ───────────────────
select pg_temp.as_('plain');
insert into r select 'noDraft', pg_temp.val($q$select public._start_team_term(2684, now())::text$q$);
insert into probe select '30. switching to a year with no draft: applied_draft null, tree identical', 'true|true',
  (select ((pg_temp.j((select v from r where k = 'noDraft')) -> 'applied_draft') = 'null'::jsonb)::text
     || '|' || (pg_temp.fp() = fp)::text from orig);
insert into r select 'back0', pg_temp.val(format($q$select public._start_team_term(%s, now())::text$q$, (select y from orig)));
insert into probe select '31. …and back again, still identical, nothing stashed', 'true|0',
  (select (pg_temp.fp() = fp)::text || '|'
     || (select count(*) from public.team_draft_nodes where term_year in (2684, (select y from orig)))
     from orig);

-- ── §D edit the draft ────────────────────────────────────────────────────
select pg_temp.as_('actor');
set local role authenticated;
-- a new ฝ่าย under the first root
insert into r select 'addN', pg_temp.try($q$insert into public.team_draft_nodes (term_year, id, parent_id, name, kind, position)
  select 2685, '00000000-0000-4000-8000-000000002711', root, 'ฝ่ายทดสอบ 0271', 'division', 999 from subj$q$);
-- a NEW member linked to P, carrying a STALE copy of P's identity
insert into r select 'addM', pg_temp.try($q$insert into public.team_draft_members (term_year, id, node_id, person_id, kkumail, full_name, nickname, position)
  select 2685, '00000000-0000-4000-8000-000000002712', '00000000-0000-4000-8000-000000002711', p.id, p.kkumail, 'ชื่อเก่า ค้าง', 'STALE', 0
    from public.people p where p.id = (select p from subj)$q$);
-- a NEW member the people search filled: kkumail only, no person link, stale copy
insert into r select 'addM2', pg_temp.try($q$insert into public.team_draft_members (term_year, id, node_id, kkumail, full_name, nickname, position)
  values (2685, '00000000-0000-4000-8000-000000002722', '00000000-0000-4000-8000-000000002711', 'proof0271.mailonly@kkumail.com', 'ชื่อเก่า ค้าง', 'STALE2', 1)$q$);
-- E1 moves to the new ฝ่าย, gains `pr`, and the draft's copy of its nickname is changed
insert into r select 'moveE1', pg_temp.try($q$update public.team_draft_members
   set node_id = '00000000-0000-4000-8000-000000002711', permissions = array_append(permissions, 'pr'),
       nickname = 'DRAFT-NICK'
 where term_year = 2685 and id = (select e1 from subj)$q$);
-- E2 leaves; ตำแหน่ง L is closed (with its people)
insert into r select 'delE2', pg_temp.try($q$delete from public.team_draft_members where term_year = 2685 and id = (select e2 from subj)$q$);
insert into r select 'delL', pg_temp.try($q$delete from public.team_draft_nodes where term_year = 2685 and id = (select l from subj)$q$);
-- a loop is refused
insert into r select 'cycle', pg_temp.try($q$update public.team_draft_nodes set parent_id = '00000000-0000-4000-8000-000000002711'
 where term_year = 2685 and id = (select root from subj)$q$);
insert into r select 'sum', pg_temp.val($q$select public.team_draft_summary(2685)::text$q$);
reset role;
insert into probe select '40. the editor adds a ฝ่าย + person, moves E1, removes E2 and L', 'ok:1|ok:1|ok:1|ok:1|ok:1',
  (select string_agg(v, '|' order by array_position(array['addN','addM','moveE1','delE2','delL'], k))
     from r where k in ('addN','addM','moveE1','delE2','delL'));
insert into probe select '41. a ฝ่าย under its own descendant is refused', 'raised',
  (select split_part(v, ':', 1) from r where k = 'cycle');

create temporary table expect on commit drop as
select (select count(*) from public.team_members where node_id = (select l from subj)) as l_members,
       (select count(*) from public.team_members where node_id = (select l from subj) and id = (select e2 from subj)) as e2_in_l;
insert into probe select '42. team_draft_summary: +1 ฝ่าย, −1 ตำแหน่ง, +2 people, −(1 + L''s people), ≥1 changed', 'true',
  (select (s ->> 'nodes_added' = '1' and s ->> 'nodes_removed' = '1' and s ->> 'members_added' = '2'
       and (s ->> 'members_removed')::int = 1 + l_members
       and (s ->> 'members_changed')::int >= 1)::text
     from expect, lateral (select pg_temp.j((select v from r where k = 'sum')) as s) x);

-- P edits their own record AFTER the draft copied it.
update public.people set nickname = 'FRESH' where id = (select p from subj);
update public.people set nickname = 'FRESH2' where id = '00000000-0000-4000-8000-000000002720';

-- ── §E shown ahead ───────────────────────────────────────────────────────
select pg_temp.as_('actor');
set local role authenticated;
insert into r select 'show', pg_temp.val($q$select public.set_team_term_shown(2685, true)::text$q$);
reset role;
insert into probe select '50. a prepared year can be shown; เกี่ยวกับเรา reads the DRAFT', 'true|draft',
  (select (pg_temp.j((select v from r where k = 'show')) ->> 'shown') || '|'
     || (public.get_public_team_chart(2685) ->> 'source'));
insert into probe select '51. …and shows the new person with the PERSON''s nickname, not the stale copy', 'FRESH',
  (select m ->> 'nickname' from jsonb_array_elements(public.get_public_team_chart(2685) -> 'members') m
    where m ->> 'node_id' = '00000000-0000-4000-8000-000000002711' and m ->> 'name' is not null
      and (m ->> 'nickname') in ('FRESH', 'STALE'));
insert into probe select '52. the current year''s chart is still the live tree', 'true',
  (select ((public.get_public_team_chart(null) ->> 'year')::int is not distinct from y)::text from orig);

-- ── §F the switch, as a PLAIN visitor (the automatic path) ───────────────
select pg_temp.as_('plain');
insert into r select 'switch', pg_temp.val($q$select public._start_team_term(2685, now())::text$q$);
insert into probe select '60. the switch runs for a visitor without team_edit and reports the draft it applied', 'true',
  (select ((pg_temp.j((select v from r where k = 'switch')) -> 'applied_draft' ->> 'members_added') = '2')::text);
insert into probe select '61. 2685 is current; its draft is consumed; it reads LIVE (not a hidden empty archive)', 'true|0|false|live',
  (select (public.current_samo_year() = 2685)::text
     || '|' || (select count(*) from public.team_draft_nodes where term_year = 2685)
     || '|' || (select (published_at is not null)::text from public.team_terms where year = 2685)
     || '|' || (public.get_public_team_chart(null) ->> 'source'));
insert into probe select '62. the new ฝ่าย is live and the new member is in it, linked to P', 'true|true',
  (select exists (select 1 from public.team_nodes where id = '00000000-0000-4000-8000-000000002711')::text
     || '|' || exists (select 1 from public.team_members where id = '00000000-0000-4000-8000-000000002712'
                        and node_id = '00000000-0000-4000-8000-000000002711'
                        and person_id = (select p from subj))::text);
insert into probe select '63. the new member took the PERSON''s identity, and P''s own edit survived', 'FRESH|FRESH',
  (select (select nickname from public.team_members where id = '00000000-0000-4000-8000-000000002712')
     || '|' || (select nickname from public.people where id = (select p from subj)));
insert into probe select '63b. a member the search filled (kkumail only) is linked and took the PERSON''s identity', 'true|FRESH2|FRESH2',
  (select (m.person_id = '00000000-0000-4000-8000-000000002720')::text || '|' || m.nickname
     || '|' || (select nickname from public.people where id = '00000000-0000-4000-8000-000000002720')
     from public.team_members m where m.id = '00000000-0000-4000-8000-000000002722');
insert into probe select '64. E1 moved and holds pr; its nickname is the LIVE one, not the draft copy', 'true|true|true',
  (select (m.node_id = '00000000-0000-4000-8000-000000002711')::text
     || '|' || ('pr' = any (m.permissions))::text
     || '|' || (m.nickname is distinct from 'DRAFT-NICK')::text
     from public.team_members m where m.id = (select e1 from subj));
insert into probe select '65. …and the permission is EFFECTIVE (resolver sees it)', 'true',
  (select ('pr' = any (public.effective_team_permissions_for_email(m.kkumail)))::text
     from public.team_members m where m.id = (select e1 from subj));
insert into probe select '66. E2 and ตำแหน่ง L are gone from the live tree', 'false|false',
  (select exists (select 1 from public.team_members where id = (select e2 from subj))::text
     || '|' || exists (select 1 from public.team_nodes where id = (select l from subj))::text);
insert into probe select '67. Passport ฝ่าย links and the Discord role id of continuing ฝ่าย survive', 'true|true',
  (select (((select count(*) from passport.departments where team_node_id is not null)
          + (select count(*) from passport.sub_departments where team_node_id is not null)) = pp_links)::text
     || '|' || ((select discord_role_id from public.team_nodes where id = (select dn from subj)) is not distinct from dn_role)::text
     from orig);
insert into probe select '68. the outgoing tree was kept as the outgoing year''s undo copy', 'true',
  (select ((select count(*) from public.team_draft_nodes where term_year = y) = nodes
       and (select count(*) from public.team_draft_members where term_year = y) = members)::text from orig);

-- ── §G undo ──────────────────────────────────────────────────────────────
select pg_temp.as_('plain');
insert into r select 'undo', pg_temp.val(format($q$select public._start_team_term(%s, now())::text$q$, (select y from orig)));
-- person_id is compared separately: removing a member can PRUNE the person it
-- pointed at (prune_orphan_person — no other placement, never signed in, never
-- confirmed), exactly as removing them by hand does, and a pruned record cannot
-- come back. The restored row is then linked again by kkumail.
insert into probe select '70. switching back restores the exact tree it replaced (person links aside)', 'true|true',
  (select (pg_temp.j((select v from r where k = 'undo')) -> 'applied_draft' is not null
       and pg_temp.j((select v from r where k = 'undo')) -> 'applied_draft' <> 'null'::jsonb)::text
     || '|' || (pg_temp.fp(false) = pg_temp_fp_nolink)::text from orig);
insert into probe select '71. …and every person link whose person still exists is the original one', '0',
  (select count(*)::text from snapm s join public.team_members m on m.id = s.id
    where m.person_id is distinct from s.person_id
      and exists (select 1 from public.people p where p.id = s.person_id));

-- ── §H refusals ──────────────────────────────────────────────────────────
select pg_temp.as_('actor');
set local role authenticated;
insert into r select 'cur', pg_temp.val(format($q$select public.start_team_draft(%s, 'live')::text$q$, (select y from orig)));
insert into r select 'twice1', pg_temp.val($q$select public.start_team_draft(2683, 'empty')::text$q$);
insert into r select 'twice2', pg_temp.val($q$select public.start_team_draft(2683, 'live')::text$q$);
insert into r select 'badfrom', pg_temp.val($q$select public.start_team_draft(2684, 'other')::text$q$);
reset role;
insert into probe select '80. refused: a draft of the current year, a bad source', 'raised|raised',
  (select split_part((select v from r where k = 'cur'), ':', 1) || '|' || split_part((select v from r where k = 'badfrom'), ':', 1));
-- 'empty' makes no node, so a second start is allowed; once a node exists it is not
select pg_temp.as_('actor');
set local role authenticated;
insert into r select 'nodeIn', pg_temp.try($q$insert into public.team_draft_nodes (term_year, name, kind) values (2683, 'x', 'division')$q$);
insert into r select 'twice3', pg_temp.val($q$select public.start_team_draft(2683, 'live')::text$q$);
reset role;
insert into probe select '81. an empty start, then a second start once the year holds a ฝ่าย is refused', 'true|ok:1|raised',
  (select (pg_temp.j((select v from r where k = 'twice1')) ->> 'nodes' = '0')::text
     || '|' || (select v from r where k = 'nodeIn')
     || '|' || split_part((select v from r where k = 'twice3'), ':', 1));

-- ── §I delete a year holding a draft ─────────────────────────────────────
select pg_temp.as_('actor');
set local role authenticated;
insert into r select 'del', pg_temp.try($q$delete from public.team_terms where year = 2683$q$);
reset role;
insert into probe select '90. deleting year 2683 takes its draft with it', 'ok:1|0',
  (select (select v from r where k = 'del') || '|'
     || (select count(*) from public.team_draft_nodes where term_year = 2683));

select step,
       case when got is not distinct from expected then 'PASS' else 'FAIL' end as result,
       expected, got
  from probe order by step;

rollback;
