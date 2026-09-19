-- ============================================================
-- team0196-position-not-inherited.sql — a ตำแหน่ง above you is not yours.
--
-- The shape that gave nine people `หัวหน้าฝ่าย PR`: a DIVISION sitting under a
-- ROLE node. Built here in miniature, all rolled back:
--
--   D  ฝ่าย (division, ticked)
--   └─ H  หัวหน้า (role, ticked)          ← head sits here
--      └─ C  ฝ่ายย่อย (division, ticked)
--         └─ M  สมาชิก (role, ticked)     ← member sits here
--
-- Member must get M + C + D, and NOT H. Head must get H + D.
-- RUN BEFORE 0196 AND 30 FAILS (the member gets H).
--   node tools/db-query.mjs tools/team0196-position-not-inherited.sql
-- ============================================================
begin;
create temporary table probe (step text, expected text, got text) on commit drop;

create temporary table subj on commit drop as
select id, row_number() over (order by id) as n from public.people
 where id not in (select person_id from public.discord_links)
   and id not in (select person_id from public.team_members where person_id is not null)
 order by id limit 2;
insert into probe select '00. two unplaced, unlinked people are available', '2', (select count(*)::text from subj);

insert into public.team_nodes (id, parent_id, name, kind, discord_role, discord_role_id) values
  ('00000000-0000-4000-8000-00000000000d', null, 'probe ฝ่าย D', 'division', true, '960000000000000001'),
  ('00000000-0000-4000-8000-00000000000e', '00000000-0000-4000-8000-00000000000d', 'probe หัวหน้า H', 'role', true, '960000000000000002'),
  ('00000000-0000-4000-8000-00000000000c', '00000000-0000-4000-8000-00000000000e', 'probe ฝ่ายย่อย C', 'division', true, '960000000000000003'),
  ('00000000-0000-4000-8000-00000000000f', '00000000-0000-4000-8000-00000000000c', 'probe สมาชิก M', 'role', true, '960000000000000004');

insert into public.team_members (node_id, person_id, full_name)
select '00000000-0000-4000-8000-00000000000f', id, 'probe member' from subj where n = 1;
insert into public.team_members (node_id, person_id, full_name)
select '00000000-0000-4000-8000-00000000000e', id, 'probe head' from subj where n = 2;
insert into public.discord_links (person_id, discord_user_id)
select id, '96100000000000000' || n from subj;

create temporary table got on commit drop as
select t.* from public.discord_role_targets() t join subj s on s.id = t.person_id;

insert into probe select '10. both probe people are returned', '2', (select count(*)::text from got);
insert into probe select '20. the member gets their own ตำแหน่ง M', 'true',
  (select ('960000000000000004' = any (role_ids))::text from got where discord_user_id = '961000000000000001');
insert into probe select '21. …and the ฝ่าย directly above, C', 'true',
  (select ('960000000000000003' = any (role_ids))::text from got where discord_user_id = '961000000000000001');
insert into probe select '22. …and the ฝ่าย ABOVE THE ตำแหน่ง, D — the walk continues past H', 'true',
  (select ('960000000000000001' = any (role_ids))::text from got where discord_user_id = '961000000000000001');
insert into probe select '30. the member does NOT get the head''s ตำแหน่ง H', 'false',
  (select ('960000000000000002' = any (role_ids))::text from got where discord_user_id = '961000000000000001');
insert into probe select '40. CONTROL: the head DOES get H', 'true',
  (select ('960000000000000002' = any (role_ids))::text from got where discord_user_id = '961000000000000002');
insert into probe select '41. …and D above them', 'true',
  (select ('960000000000000001' = any (role_ids))::text from got where discord_user_id = '961000000000000002');
insert into probe select '42. …and NOT the sub-ฝ่าย C below them', 'false',
  (select ('960000000000000003' = any (role_ids))::text from got where discord_user_id = '961000000000000002');

select step, case when got is not distinct from expected then 'PASS' else 'FAIL' end as result, expected, got
  from probe order by step;
rollback;
