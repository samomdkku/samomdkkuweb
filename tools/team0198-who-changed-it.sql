-- ============================================================
-- team0198-who-changed-it.sql — each queued change says WHO made it and WHAT
-- it was, in Thai the channel can read. Rolled back.
--   node tools/db-query.mjs tools/team0198-who-changed-it.sql
-- RUN BEFORE 0198 AND IT FAILS AT 01.
-- ============================================================
begin;
create temporary table probe (step text, expected text, got text) on commit drop;
insert into probe select '01. the queue carries actor_name and detail', '2',
  (select count(*)::text from information_schema.columns where table_schema = 'public'
     and table_name = 'discord_sync_queue' and column_name in ('actor_name', 'detail'));

-- An EDITOR: a real portal account whose email is a registry person's kkumail.
create temporary table ed on commit drop as
select u.id as uid, p.id as pid, p.nickname from public.users u
  join public.people p on lower(btrim(p.kkumail)) = lower(btrim(u.email))
 where nullif(btrim(p.nickname), '') is not null order by u.id limit 1;
-- A SUBJECT: someone else (a second placement is fine — it is rolled back).
create temporary table subj on commit drop as
select p.id, p.nickname from public.people p
 where p.id not in (select pid from ed) and nullif(btrim(p.nickname), '') is not null
 order by p.id limit 1;
insert into probe select '02. an editor and a subject exist', '2',
  ((select count(*) from ed) + (select count(*) from subj))::text;

insert into public.team_nodes (id, parent_id, name, kind, discord_role, discord_role_id) values
  ('00000000-0000-4000-8000-0000000019c1', null, 'probe0198 ฝ่ายหนึ่ง', 'division', true, '980000000000000001'),
  ('00000000-0000-4000-8000-0000000019c2', null, 'probe0198 ฝ่ายสอง', 'division', true, '980000000000000002');
create temporary table mark on commit drop as select coalesce(max(id), 0) as m from public.discord_sync_queue;

-- ── as the EDITOR, through the web ─────────────────────────────────────────
select set_config('request.jwt.claims', json_build_object('sub', (select uid from ed), 'role', 'authenticated')::text, true);
insert into public.team_members (id, node_id, person_id, full_name)
select '00000000-0000-4000-8000-0000000019d1', '00000000-0000-4000-8000-0000000019c1', id, 'probe' from subj;
update public.team_members set node_id = '00000000-0000-4000-8000-0000000019c2' where id = '00000000-0000-4000-8000-0000000019d1';
update public.team_nodes set name = 'probe0198 ฝ่ายหนึ่ง ใหม่' where id = '00000000-0000-4000-8000-0000000019c1';

create temporary table got on commit drop as
select row_number() over (order by id) as n, kind, actor_name, detail from public.discord_sync_queue where id > (select m from mark);

insert into probe select '10. placing: names the EDITOR', 'true',
  (select (actor_name like (select nickname from ed) || '%')::text from got where n = 1);
insert into probe select '11. placing: says who went where', 'เพิ่ม ' || (select nickname from subj) || '% เข้า probe0198 ฝ่ายหนึ่ง',
  (select case when detail like 'เพิ่ม ' || (select nickname from subj) || '% เข้า probe0198 ฝ่ายหนึ่ง'
               then 'เพิ่ม ' || (select nickname from subj) || '% เข้า probe0198 ฝ่ายหนึ่ง' else detail end from got where n = 1);
insert into probe select '12. moving: from → to', 'true',
  (select (detail like 'ย้าย %จาก probe0198 ฝ่ายหนึ่ง ไป probe0198 ฝ่ายสอง')::text from got where n = 2);
insert into probe select '13. renaming a mapped ฝ่าย: old → new', 'เปลี่ยนชื่อ probe0198 ฝ่ายหนึ่ง → probe0198 ฝ่ายหนึ่ง ใหม่',
  (select detail from got where kind = 'rename');

-- ── with NO web session — a script / the SQL console ───────────────────────
select set_config('request.jwt.claims', '', true);
delete from public.team_members where id = '00000000-0000-4000-8000-0000000019d1';
insert into probe select '20. CONTROL: no web session is SAID, never a guessed name', 'ไม่ได้แก้ผ่านหน้าเว็บ (สคริปต์ / ผู้ดูแลระบบ)',
  (select actor_name from public.discord_sync_queue where id > (select m from mark) order by id desc limit 1);
insert into probe select '21. removing: says who left what', 'true',
  (select (detail like 'เอา %ออกจาก probe0198 ฝ่ายสอง')::text from public.discord_sync_queue where id > (select m from mark) order by id desc limit 1);

select step, case when got is not distinct from expected then 'PASS' else 'FAIL' end as result, expected, got
  from probe order by step;
rollback;
