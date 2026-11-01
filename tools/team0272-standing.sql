-- ============================================================
-- team0272 — ถาวร groups outlive the ปี SAMO (0272)
--
--   §0  structure: RLS on the list, anon holds nothing, only the switch applies
--   §A  marking a group ถาวร: an editor may, a plain account may not; it must be
--       a root; it is hidden from เกี่ยวกับเรา and stays hidden
--   §B  a ถาวร person's permission is EFFECTIVE through the ordinary resolver —
--       for a gmail address too (any domain signs in)
--   §C  preparing a year copies the yearly tree only; the summary counts
--       yearly rows and says how many ถาวร people the switch keeps
--   §D  THE POINT: a switch to a year prepared FROM EMPTY keeps every ถาวร
--       group, person and permission — and still removes the yearly people
--       the draft does not hold; a stale draft copy of a ถาวร group loses
--   §E  the undo copy is exactly the yearly tree (undo itself: team0271 §G)
--   §F  team_sign_in_status: editors yes, a plain account no
--   §G  my_advisor_house: an อาจารย์ sees their บ้าน and nothing else; a
--       non-อาจารย์ and an inactive อาจารย์ get nothing
--   §H  get_my_team_seat marks a ถาวร posting
--
-- Sentinel years 2683–2685, sentinel ids 0000…272x. Everything rolls back.
--   node tools/db-query.mjs tools/team0272-standing.sql
-- ============================================================
begin;

create temporary table probe (step text, expected text, got text) on commit drop;

-- ── §0 structure ─────────────────────────────────────────────────────────
insert into probe select '00. RLS on team_standing_groups; anon holds no privilege on it', 'true|false',
  (select (select relrowsecurity from pg_class where oid = 'public.team_standing_groups'::regclass)
     || '|' || has_table_privilege('anon', 'public.team_standing_groups', 'select,insert,update,delete'));
insert into probe select '01. anon executes none of the new functions', 'false|false|false|false|false',
  (select has_function_privilege('anon', 'public.team_standing_node_ids()', 'execute')
     || '|' || has_function_privilege('anon', 'public.team_node_is_standing(uuid)', 'execute')
     || '|' || has_function_privilege('anon', 'public.team_sign_in_status()', 'execute')
     || '|' || has_function_privilege('anon', 'public.my_advisor_house()', 'execute')
     || '|' || has_function_privilege('authenticated', 'public._apply_team_draft(integer, integer)', 'execute'));

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
   and u.email is not null
   and not exists (select 1 from public.team_members m where lower(m.kkumail) = lower(u.email))
   and not exists (select 1 from public.advisors a where a.email = lower(u.email))
 order by u.id limit 1;

insert into probe select '02. subjects exist: an editor and a plain account', '1|1',
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
create or replace function pg_temp.j(p text) returns jsonb language plpgsql as $$
begin return p::jsonb; exception when others then return jsonb_build_object('raised', p); end $$;
grant execute on function pg_temp.try(text), pg_temp.val(text) to authenticated, anon;
create temporary table r (k text, v text) on commit drop;
grant insert, select on r to authenticated, anon;

-- ── planted tree ─────────────────────────────────────────────────────────
-- G: a root that becomes ถาวร, with ตำแหน่ง GR under it holding `pr`, and two
--    people: SM (a kku.ac.th address) and SG (a gmail address).
-- Y: an ordinary yearly root with one member YM, used to show the switch still
--    removes the yearly people a draft does not hold.
-- C: a yearly ตำแหน่ง nested under Y, to show a non-root cannot be ถาวร.
insert into public.team_nodes (id, parent_id, name, kind, position, is_public)
values ('00000000-0000-4000-8000-000000002721', null, 'proof0272 ถาวร', 'division', 900, true),
       ('00000000-0000-4000-8000-000000002722', '00000000-0000-4000-8000-000000002721', 'proof0272 อาจารย์', 'role', 0, true),
       ('00000000-0000-4000-8000-000000002723', null, 'proof0272 yearly', 'division', 901, false),
       ('00000000-0000-4000-8000-000000002724', '00000000-0000-4000-8000-000000002723', 'proof0272 child', 'role', 0, false);
update public.team_nodes set permissions = array['pr'] where id = '00000000-0000-4000-8000-000000002722';
insert into public.team_members (id, node_id, position, kkumail, full_name)
values ('00000000-0000-4000-8000-000000002725', '00000000-0000-4000-8000-000000002722', 0, 'proof0272.staff@kku.ac.th', 'อาจารย์ ทดสอบ'),
       ('00000000-0000-4000-8000-000000002726', '00000000-0000-4000-8000-000000002722', 1, 'proof0272.someone@gmail.com', 'คนนอก ทดสอบ'),
       ('00000000-0000-4000-8000-000000002727', '00000000-0000-4000-8000-000000002724', 0, 'proof0272.yearly@kkumail.com', 'ปีนี้ ทดสอบ');

-- ── §A marking ───────────────────────────────────────────────────────────
select pg_temp.as_('plain');
set local role authenticated;
insert into r select 'plainMark', pg_temp.try($q$insert into public.team_standing_groups (node_id) values ('00000000-0000-4000-8000-000000002721')$q$);
reset role;
select pg_temp.as_('actor');
set local role authenticated;
insert into r select 'childMark', pg_temp.try($q$insert into public.team_standing_groups (node_id) values ('00000000-0000-4000-8000-000000002724')$q$);
insert into r select 'mark', pg_temp.try($q$insert into public.team_standing_groups (node_id) values ('00000000-0000-4000-8000-000000002721')$q$);
reset role;
insert into probe select '10. a plain account cannot mark a group ถาวร; an editor can', 'raised|ok:1',
  (select split_part((select v from r where k = 'plainMark'), ':', 1) || '|' || (select v from r where k = 'mark'));
insert into probe select '11. a ตำแหน่ง inside a ฝ่าย cannot be ถาวร (only a top-level group)', 'raised',
  (select split_part((select v from r where k = 'childMark'), ':', 1));
insert into probe select '12. marking hides the group from เกี่ยวกับเรา', 'false',
  (select is_public::text from public.team_nodes where id = '00000000-0000-4000-8000-000000002721');

select pg_temp.as_('actor');
set local role authenticated;
insert into r select 'nest', pg_temp.try($q$update public.team_nodes set parent_id = '00000000-0000-4000-8000-000000002723' where id = '00000000-0000-4000-8000-000000002721'$q$);
insert into r select 'unhide', pg_temp.try($q$update public.team_nodes set is_public = true where id = '00000000-0000-4000-8000-000000002721'$q$);
reset role;
insert into probe select '13. a ถาวร group cannot be moved under another; asking to show it leaves it hidden', 'raised|ok:1|false',
  (select split_part((select v from r where k = 'nest'), ':', 1) || '|' || (select v from r where k = 'unhide')
     || '|' || (select is_public::text from public.team_nodes where id = '00000000-0000-4000-8000-000000002721'));
insert into probe select '14. the whole subtree reads ถาวร; the yearly root does not', 'true|true|false',
  (select public.team_node_is_standing('00000000-0000-4000-8000-000000002721')::text
     || '|' || public.team_node_is_standing('00000000-0000-4000-8000-000000002722')::text
     || '|' || public.team_node_is_standing('00000000-0000-4000-8000-000000002723')::text);
insert into probe select '15. เกี่ยวกับเรา (live) never lists a ถาวร node', 'false|false',
  (select exists (select 1 from jsonb_array_elements(public.get_public_team_chart(null) -> 'nodes') e
                   where e ->> 'id' in ('00000000-0000-4000-8000-000000002721', '00000000-0000-4000-8000-000000002722'))::text
     || '|' || exists (select 1 from jsonb_array_elements(public.get_public_team_chart(null) -> 'members') e
                   where e ->> 'node_id' = '00000000-0000-4000-8000-000000002722')::text);

-- ── §B grants through the ordinary resolver ──────────────────────────────
insert into probe select '20. a ถาวร person holds the group''s permission — kku.ac.th and gmail alike', 'true|true',
  (select ('pr' = any (public.effective_team_permissions_for_email('proof0272.staff@kku.ac.th')))::text
     || '|' || ('pr' = any (public.effective_team_permissions_for_email('proof0272.someone@gmail.com')))::text);

-- ── baseline for §D/§E ──────────────────────────────────────────────────
create or replace function pg_temp.fp_yearly() returns text language sql as $$
  select md5(
    coalesce((select string_agg(concat_ws('~', n.id, n.parent_id, n.name, n.kind, n.position,
                n.permissions, n.inherit_permissions, n.vs_dept, n.project_seat, n.is_public,
                n.passport_dept_id, n.passport_sub_dept_id, n.shop_source, n.is_board,
                n.color, n.tier, n.dept_page, n.discord_role, n.discord_role_id), '|' order by n.id)
                from public.team_nodes n
               where n.id not in (select s.id from public.team_standing_node_ids() s)), '')
    || '#' ||
    coalesce((select string_agg(concat_ws('~', m.id, m.node_id, m.position, m.permissions,
                m.inherit_permissions, m.vs_dept, m.project_seat, m.passport_dept_id,
                m.passport_sub_dept_id, m.shop_source, m.dept_page, m.kkumail, m.full_name,
                m.nickname), '|' order by m.id)
                from public.team_members m
               where m.node_id not in (select s.id from public.team_standing_node_ids() s)), ''))
$$;
create or replace function pg_temp.fp_standing() returns text language sql as $$
  select md5(
    coalesce((select string_agg(concat_ws('~', n.id, n.parent_id, n.name, n.permissions, n.is_public), '|' order by n.id)
                from public.team_nodes n
               where n.id in (select s.id from public.team_standing_node_ids() s)), '')
    || '#' ||
    coalesce((select string_agg(concat_ws('~', m.id, m.node_id, m.permissions, m.kkumail, m.full_name, m.person_id), '|' order by m.id)
                from public.team_members m
               where m.node_id in (select s.id from public.team_standing_node_ids() s)), ''))
$$;

delete from public.team_terms where year in (2683, 2684, 2685);
create temporary table orig on commit drop as
select public.current_samo_year() as y,
       pg_temp.fp_yearly() as fpy, pg_temp.fp_standing() as fps,
       (select count(*) from public.team_nodes n
         where n.id not in (select s.id from public.team_standing_node_ids() s)) as y_nodes,
       (select count(*) from public.team_members m
         where m.node_id not in (select s.id from public.team_standing_node_ids() s)) as y_members,
       (select count(*) from public.team_members m
         where m.node_id in (select s.id from public.team_standing_node_ids() s)) as s_members;
insert into public.team_terms (year) values (2683), (2684), (2685);
grant select on orig to authenticated, anon;

insert into probe select '21. the planted ถาวร group is counted (2 people), alongside any real ones', 'true',
  (select (s_members >= 2)::text from orig);

-- ── §C preparing a year ─────────────────────────────────────────────────
select pg_temp.as_('actor');
set local role authenticated;
insert into r select 'startLive', pg_temp.val($q$select public.start_team_draft(2685, 'live')::text$q$);
reset role;
insert into probe select '30. a draft from the live tree copies every YEARLY node and member — and no ถาวร row', 'true|0|0',
  (select (pg_temp.j((select v from r where k = 'startLive')) ->> 'nodes' = y_nodes::text
       and pg_temp.j((select v from r where k = 'startLive')) ->> 'members' = y_members::text)::text from orig)
  || '|' || (select count(*) from public.team_draft_nodes d where d.term_year = 2685
              and d.id in (select s.id from public.team_standing_node_ids() s))
  || '|' || (select count(*) from public.team_draft_members d where d.term_year = 2685
              and d.id in ('00000000-0000-4000-8000-000000002725', '00000000-0000-4000-8000-000000002726'));

select pg_temp.as_('actor');
set local role authenticated;
insert into r select 'sumLive', pg_temp.val($q$select public.team_draft_summary(2685)::text$q$);
reset role;
insert into probe select '31. …so the summary shows NO change, and counts the ถาวร people kept', 'true',
  (select (pg_temp.j((select v from r where k = 'sumLive')) ->> 'nodes_removed' = '0'
       and pg_temp.j((select v from r where k = 'sumLive')) ->> 'members_removed' = '0'
       and pg_temp.j((select v from r where k = 'sumLive')) ->> 'standing_members' = s_members::text)::text from orig);

-- ── §D a switch to a year prepared FROM EMPTY ───────────────────────────
-- 2684 holds ONE new ฝ่าย and nothing else — the worst case 0271 left open —
-- plus a STALE copy of the ถาวร root under a different name, as a draft made
-- before the group became ถาวร would carry.
select pg_temp.as_('actor');
set local role authenticated;
insert into r select 'startEmpty', pg_temp.val($q$select public.start_team_draft(2684, 'empty')::text$q$);
insert into r select 'draftNode', pg_temp.try($q$insert into public.team_draft_nodes (term_year, id, name, kind, position, is_public)
  values (2684, '00000000-0000-4000-8000-000000002728', 'proof0272 new', 'division', 0, true),
         (2684, '00000000-0000-4000-8000-000000002721', 'STALE COPY', 'division', 0, true)$q$);
insert into r select 'sumEmpty', pg_temp.val($q$select public.team_draft_summary(2684)::text$q$);
reset role;
insert into probe select '40. the empty draft holds the new ฝ่าย and the stale copy', 'ok:2',
  (select v from r where k = 'draftNode');
insert into probe select '41. its summary removes every yearly member and no ถาวร one', 'true',
  (select (pg_temp.j((select v from r where k = 'sumEmpty')) ->> 'members_removed' = y_members::text
       and pg_temp.j((select v from r where k = 'sumEmpty')) ->> 'standing_members' = s_members::text)::text from orig);

select pg_temp.as_('plain');
insert into r select 'switch', pg_temp.val($q$select public._start_team_term(2684, now())::text$q$);
insert into probe select '42. the switch ran and reports the ถาวร people it kept', 'true',
  (select ((pg_temp.j((select v from r where k = 'switch')) -> 'applied_draft' ->> 'standing_kept') = s_members::text)::text from orig);
insert into probe select '43. every ถาวร group and person is exactly as before; the stale copy did not rename it', 'true|proof0272 ถาวร',
  (select (pg_temp.fp_standing() = fps)::text from orig)
  || '|' || (select name from public.team_nodes where id = '00000000-0000-4000-8000-000000002721');
insert into probe select '44. …and their permission is still effective (kku.ac.th, gmail)', 'true|true',
  (select ('pr' = any (public.effective_team_permissions_for_email('proof0272.staff@kku.ac.th')))::text
     || '|' || ('pr' = any (public.effective_team_permissions_for_email('proof0272.someone@gmail.com')))::text);
insert into probe select '45. the yearly people the draft did not hold are gone; the new ฝ่าย is live', 'false|0|true',
  (select exists (select 1 from public.team_members where id = '00000000-0000-4000-8000-000000002727')::text
     || '|' || (select count(*) from public.team_members m
                 where m.node_id not in (select s.id from public.team_standing_node_ids() s))
     || '|' || exists (select 1 from public.team_nodes where id = '00000000-0000-4000-8000-000000002728')::text);
insert into probe select '46. the undo copy filed under the outgoing year holds no ถาวร row', '0|0',
  (select (select count(*) from public.team_draft_nodes d where d.term_year = y
            and d.id = '00000000-0000-4000-8000-000000002721')
     || '|' || (select count(*) from public.team_draft_members d where d.term_year = y
            and d.id in ('00000000-0000-4000-8000-000000002725', '00000000-0000-4000-8000-000000002726')) from orig);

-- ── §E the undo copy ────────────────────────────────────────────────────
-- Switching BACK from here would re-insert the whole yearly team (every row was
-- removed by the empty draft), which runs past the query timeout this proof is
-- sent under. Undo itself is team0271's case 70; what 0272 changed is WHAT the
-- undo copy holds, and that is asserted directly: exactly the yearly tree.
insert into probe select '50. the undo copy is exactly the yearly tree that was replaced', 'true|true',
  (select ((select count(*) from public.team_draft_nodes d where d.term_year = y) = y_nodes)::text
     || '|' || ((select count(*) from public.team_draft_members d where d.term_year = y) = y_members)::text from orig);

-- ── §F who has signed in ─────────────────────────────────────────────────
select pg_temp.as_('actor');
set local role authenticated;
insert into r select 'sigActor', pg_temp.val($q$select count(*)::text from public.team_sign_in_status()$q$);
insert into r select 'sigNever', pg_temp.val($q$select has_account::text from public.team_sign_in_status() where member_id = '00000000-0000-4000-8000-000000002725'$q$);
reset role;
select pg_temp.as_('plain');
set local role authenticated;
insert into r select 'sigPlain', pg_temp.val($q$select count(*)::text from public.team_sign_in_status()$q$);
reset role;
insert into probe select '60. an editor reads sign-in status (an address nobody signed in with = false); a plain account is refused', 'true|false|raised',
  (select ((select v from r where k = 'sigActor') ~ '^[0-9]+$' and (select v from r where k = 'sigActor')::int > 0)::text
     || '|' || coalesce((select v from r where k = 'sigNever'), 'missing')
     || '|' || split_part((select v from r where k = 'sigPlain'), ':', 1));

-- ── §G บ้านของฉัน for an อาจารย์ ─────────────────────────────────────────
-- An อาจารย์ is CREATED with the plain account's address, on one สาย that has
-- students — production and samo-dev both have such สาย; the subject is
-- picked, the advisor made.
create temporary table hs on commit drop as
select s.code, s.house_id from public.sais s
 where s.house_id is not null
   and exists (select 1 from public.students st where st.sai_code = s.code)
 order by s.code limit 1;
grant select on hs to authenticated;
insert into public.advisors (id, first_name_th, last_name_th, email, is_active)
select '00000000-0000-4000-8000-000000002729', 'อาจารย์', 'proof0272', email, true from plain;
insert into public.sai_advisors (sai_code, advisor_id, role, position)
select code, '00000000-0000-4000-8000-000000002729', 'secondary', 9 from hs;

select pg_temp.as_('plain');
set local role authenticated;
insert into r select 'adv', pg_temp.val($q$select public.my_advisor_house()::text$q$);
reset role;
insert into probe select '70. the อาจารย์ sees their บ้าน: every student in it, no one outside it', 'true|true|true',
  (select ((pg_temp.j((select v from r where k = 'adv')) -> 'houses' -> 0 ->> 'id')::int = (select house_id from hs))::text
     || '|' || (jsonb_array_length(pg_temp.j((select v from r where k = 'adv')) -> 'students')
                = (select count(*) from public.students st join public.sais s on s.code = st.sai_code
                    where s.house_id = (select house_id from hs)))::text
     || '|' || (not exists (select 1 from jsonb_array_elements(pg_temp.j((select v from r where k = 'adv')) -> 'students') e
                  join public.sais s on s.code = e ->> 'sai_code'
                 where s.house_id <> (select house_id from hs)))::text);
insert into probe select '71. …with full student information and their own สาย marked', 'true|true',
  (select (pg_temp.j((select v from r where k = 'adv')) -> 'students' -> 0 ? 'kkumail'
       and pg_temp.j((select v from r where k = 'adv')) -> 'students' -> 0 ? 'student_id')::text
     || '|' || ((pg_temp.j((select v from r where k = 'adv')) -> 'sai_codes') = jsonb_build_array((select code from hs)))::text);

select pg_temp.as_('actor');
set local role authenticated;
insert into r select 'advNot', pg_temp.val($q$select coalesce(public.my_advisor_house()::text, 'null')$q$);
reset role;
update public.advisors set is_active = false where id = '00000000-0000-4000-8000-000000002729';
select pg_temp.as_('plain');
set local role authenticated;
insert into r select 'advInactive', pg_temp.val($q$select coalesce(public.my_advisor_house()::text, 'null')$q$);
reset role;
insert into probe select '72. someone who is not an อาจารย์, and an inactive อาจารย์, get nothing', 'null|null',
  (select (select v from r where k = 'advNot') || '|' || (select v from r where k = 'advInactive'));

-- ── §H ตำแหน่งของฉัน marks a ถาวร posting ────────────────────────────────
-- Planted as the editor: team_members_self_update_guard reads the JWT, and the
-- last one set was the plain account's.
select pg_temp.as_('actor');
update public.team_members set kkumail = (select email from plain)
 where id = '00000000-0000-4000-8000-000000002726';
insert into public.team_members (id, node_id, position, kkumail, full_name)
select '00000000-0000-4000-8000-00000000272a', '00000000-0000-4000-8000-000000002728', 0, email, 'คนนอก ทดสอบ' from plain;
select pg_temp.as_('plain');
set local role authenticated;
insert into r select 'seat', pg_temp.val($q$select public.get_my_team_seat()::text$q$);
reset role;
insert into probe select '80. ตำแหน่งของฉัน: the ถาวร posting says standing, a yearly one does not', 'true|false',
  (select coalesce((select (e ->> 'standing') from jsonb_array_elements(pg_temp.j((select v from r where k = 'seat')) -> 'postings') e
                     where e ->> 'member_id' = '00000000-0000-4000-8000-000000002726'), 'missing')
     || '|' || coalesce((select (e ->> 'standing') from jsonb_array_elements(pg_temp.j((select v from r where k = 'seat')) -> 'postings') e
                     where e ->> 'member_id' = '00000000-0000-4000-8000-00000000272a'), 'missing'));

select step,
       case when got is not distinct from expected then 'PASS' else 'FAIL' end as result,
       expected, got
  from probe order by step;

rollback;
