-- ============================================================
-- team0197-sync-queue.sql — every web change that decides a Discord key
-- leaves work for the sync service, and nothing else does. Rolled back.
--   node tools/db-query.mjs tools/team0197-sync-queue.sql
-- RUN BEFORE 0197 AND IT FAILS AT 01.
-- ============================================================
begin;
create temporary table probe (step text, expected text, got text) on commit drop;
create or replace function pg_temp.try(q text) returns text language plpgsql as $$
begin execute q; return 'ok'; exception when others then return sqlstate; end $$;

insert into probe select '01. the queue exists, with RLS on', 'true',
  (select coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.discord_sync_queue'))::text, 'missing'));
insert into probe select '02. anon holds NO privilege on it', 'false',
  (select has_table_privilege('anon', 'public.discord_sync_queue', 'select,insert,update,delete')::text);
insert into probe select '03. authenticated holds NO privilege on it', 'false',
  (select has_table_privilege('authenticated', 'public.discord_sync_queue', 'select,insert,update,delete')::text);

create temporary table subj on commit drop as
select id from public.people where id not in (select person_id from public.discord_links)
 order by id limit 1;
create temporary table mark on commit drop as select coalesce(max(id), 0) as m from public.discord_sync_queue;
create or replace function pg_temp.since() returns text language sql as $$
  select coalesce(string_agg(kind, ',' order by id), '(none)') from public.discord_sync_queue
   where id > (select m from mark) $$;
create or replace function pg_temp.reset() returns void language sql as $$
  update mark set m = coalesce((select max(id) from public.discord_sync_queue), 0) $$;

insert into public.team_nodes (id, parent_id, name, kind, discord_role, discord_role_id) values
  ('00000000-0000-4000-8000-0000000019a1', null, 'probe0197 A', 'division', true, '970000000000000001'),
  ('00000000-0000-4000-8000-0000000019a2', null, 'probe0197 B', 'division', false, null);
insert into probe select '10. creating nodes → structure, one each', 'structure,structure', pg_temp.since();
select pg_temp.reset();

insert into public.team_members (id, node_id, person_id, full_name)
select '00000000-0000-4000-8000-0000000019b1', '00000000-0000-4000-8000-0000000019a1', id, 'probe' from subj;
insert into probe select '20. placing a person → person', 'person', pg_temp.since();
select pg_temp.reset();

update public.team_members set node_id = '00000000-0000-4000-8000-0000000019a2' where id = '00000000-0000-4000-8000-0000000019b1';
insert into probe select '21. moving them → person', 'person', pg_temp.since();
select pg_temp.reset();

update public.team_members set nickname = 'probe nick' where id = '00000000-0000-4000-8000-0000000019b1';
insert into probe select '22. CONTROL: editing their nickname → nothing', '(none)', pg_temp.since();

delete from public.team_members where id = '00000000-0000-4000-8000-0000000019b1';
insert into probe select '23. removing them → person', 'person', pg_temp.since();
select pg_temp.reset();

update public.team_nodes set name = 'probe0197 A renamed' where id = '00000000-0000-4000-8000-0000000019a1';
insert into probe select '30. renaming a MAPPED node → rename', 'rename', pg_temp.since();
select pg_temp.reset();
update public.team_nodes set name = 'probe0197 B renamed' where id = '00000000-0000-4000-8000-0000000019a2';
insert into probe select '31. CONTROL: renaming an unmapped node → nothing', '(none)', pg_temp.since();

update public.team_nodes set position = 7 where id = '00000000-0000-4000-8000-0000000019a2';
insert into probe select '32. CONTROL: reordering siblings → nothing', '(none)', pg_temp.since();

update public.team_nodes set parent_id = '00000000-0000-4000-8000-0000000019a1' where id = '00000000-0000-4000-8000-0000000019a2';
insert into probe select '33. moving a node under another → structure', 'structure', pg_temp.since();
select pg_temp.reset();

update public.team_nodes set discord_role = true where id = '00000000-0000-4000-8000-0000000019a2';
insert into probe select '34. ticking a node → structure', 'structure', pg_temp.since();
select pg_temp.reset();

insert into public.discord_links (person_id, discord_user_id) select id, '970000000000000099' from subj;
insert into probe select '40. linking → structure', 'structure', pg_temp.since();
select pg_temp.reset();
update public.discord_links set link_source = 'nickname-import' where discord_user_id = '970000000000000099';
insert into probe select '41. CONTROL: touching link_source → nothing', '(none)', pg_temp.since();
delete from public.discord_links where discord_user_id = '970000000000000099';
insert into probe select '42. unlinking → structure', 'structure', pg_temp.since();
select pg_temp.reset();

delete from public.team_nodes where id = '00000000-0000-4000-8000-0000000019a1';
insert into probe select '50. deleting a node (and its child) → structure for each', 'structure,structure', pg_temp.since();

select step, case when got is not distinct from expected then 'PASS' else 'FAIL' end as result, expected, got
  from probe order by step;
rollback;
