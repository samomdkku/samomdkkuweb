-- ============================================================
-- passport0247-departments.sql — Passport's ฝ่าย list is admin-managed and
-- picked from ทีม SAMO (0247).
--   §A  the tables stay deny-all; the four admin RPCs are signed-in only.
--   §B  the backfill kept every id, took the labels the pages showed, and
--       linked each ฝ่าย to its ONE top-level ทีม SAMO division.
--   §C  DENY: a plain account and a ฝ่าย-scoped admin read nothing and write
--       nothing (control: the subjects ARE what they are meant to be).
--   §D  ALLOW for an org-wide admin: add a ฝ่าย from a ทีม SAMO node (new id =
--       max + 1), a ฝ่ายย่อย under it, rename, hide (still listed, marked),
--       delete what nothing used — and the refusals that protect history:
--       deleting a used ฝ่าย, moving a used ฝ่ายย่อย, a duplicate name.
-- Borrows three accounts; everything ROLLS BACK.
--   node tools/db-query.mjs tools/passport0247-departments.sql
-- ============================================================
begin;

create temporary table probe (step text, expected text, got text) on commit drop;

-- ── §A ──────────────────────────────────────────────────────────────────────
insert into probe select '00. both tables keep row security with NO policy (deny-all)', 'true,true,0',
  (select string_agg(relrowsecurity::text, ',' order by relname) from pg_class
    where oid in ('passport.departments'::regclass, 'passport.sub_departments'::regclass))
  || ',' || (select count(*) from pg_policies where schemaname = 'passport' and tablename in ('departments', 'sub_departments'));
insert into probe select '01. anon cannot call any of the four RPCs', 'false,false,false,false',
  (select string_agg(has_function_privilege('anon', f, 'execute')::text, ',' order by f) from unnest(array[
     'passport.department_catalog()', 'passport.save_department(integer,text,uuid,boolean,integer)',
     'passport.save_sub_department(integer,integer,text,uuid,boolean,integer)', 'passport.delete_department(text,integer)']) f);
insert into probe select '02. authenticated can call all four (each checks org-wide inside)', 'true,true,true,true',
  (select string_agg(has_function_privilege('authenticated', f, 'execute')::text, ',' order by f) from unnest(array[
     'passport.department_catalog()', 'passport.save_department(integer,text,uuid,boolean,integer)',
     'passport.save_sub_department(integer,integer,text,uuid,boolean,integer)', 'passport.delete_department(text,integer)']) f);

-- ── §B the backfill ─────────────────────────────────────────────────────────
insert into probe select '10. ids 1–10 are all still there', '10',
  (select count(*)::text from passport.departments where id between 1 and 10);
insert into probe select '11. …with the labels the pages showed', 'บริหารองค์กร|วิชาการ|รังสีเทคนิค',
  (select string_agg(name, '|' order by id) from passport.departments where id in (1, 6, 10));
insert into probe select '12. each of the ten links to the top-level ทีม SAMO division of its name', '10',
  (select count(*)::text from passport.departments d join public.team_nodes n on n.id = d.team_node_id
    where d.id between 1 and 10 and n.parent_id is null and n.kind = 'division' and n.name = 'ฝ่าย' || d.name);

-- ── subjects ────────────────────────────────────────────────────────────────
create temporary table subj on commit drop as
  select id from public.users where email is not null order by id limit 3;
create temporary table p1 on commit drop as select id from subj order by id limit 1;
create temporary table p2 on commit drop as select id from subj order by id offset 1 limit 1;
create temporary table p3 on commit drop as select id from subj order by id offset 2 limit 1;
grant select on p1, p2, p3 to authenticated;
alter table public.users disable trigger users_self_update_guard;
update public.users set role = 'user', permissions = '{}', managed_permissions = '{}', managed_passport_scopes = '{}' where id = (select id from p1);
update public.users set role = 'user', permissions = '{}', managed_permissions = '{}', managed_passport_scopes = '{d:6}' where id = (select id from p2);
update public.users set role = 'user', permissions = array['passport'], managed_permissions = '{}', managed_passport_scopes = '{}' where id = (select id from p3);
alter table public.users enable trigger users_self_update_guard;
create or replace function pg_temp.as_(p_id uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
$$;
create or replace function pg_temp.try(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return 'ok';
exception when others then return 'raised: ' || sqlerrm; end $$;
grant execute on function pg_temp.try(text) to authenticated;
create temporary table r (k text, v text) on commit drop;
grant insert, select on r to authenticated;

-- a ทีม SAMO node to add (rp = รพ. ร่วมผลิต-shaped: a top-level division with children)
create temporary table node on commit drop as
  select n.id, n.name,
         (select c.id   from public.team_nodes c where c.parent_id = n.id order by c.position, c.name limit 1) kid,
         (select c.name from public.team_nodes c where c.parent_id = n.id order by c.position, c.name limit 1) kid_name
    from public.team_nodes n
   where n.parent_id is null and n.kind = 'division'
     and exists (select 1 from public.team_nodes c where c.parent_id = n.id)
     and n.id not in (select team_node_id from passport.departments where team_node_id is not null)
   order by n.name limit 1;
grant select on node to authenticated;
insert into probe select '13. a ทีม SAMO division with children, not yet in Passport, to add', '1', (select count(*)::text from node);

-- ── §C DENY ─────────────────────────────────────────────────────────────────
select pg_temp.as_((select id from p1));
set local role authenticated;
insert into r select 'p1_cat',  pg_temp.try('select passport.department_catalog()');
insert into r select 'p1_save', pg_temp.try($q$select passport.save_department(null, 'proof-0247 sneaky')$q$);
reset role;
select pg_temp.as_((select id from p2));
set local role authenticated;
insert into r select 'p2_ctx',  (public.passport_admin_context() ->> 'is_admin') || ',' || passport._org_wide()::text;
insert into r select 'p2_save', pg_temp.try($q$select passport.save_department(6, 'proof-0247 renamed')$q$);
insert into r select 'p2_del',  pg_temp.try($q$select passport.delete_department('department', 6)$q$);
insert into r select 'p2_tbl',  pg_temp.try($q$update passport.departments set name = 'proof-0247 direct' where id = 6$q$);
reset role;
insert into probe select '20. a plain account cannot read the catalog', 'true', (select (v like 'raised:%ทุกฝ่าย%')::text from r where k = 'p1_cat');
insert into probe select '21. …nor add a ฝ่าย', 'true', (select (v like 'raised:%ทุกฝ่าย%')::text from r where k = 'p1_save');
insert into probe select '22. subject p2 is a ฝ่าย-scoped admin, not org-wide', 'true,false', (select v from r where k = 'p2_ctx');
insert into probe select '23. a ฝ่าย-scoped admin cannot rename a ฝ่าย', 'true', (select (v like 'raised:%ทุกฝ่าย%')::text from r where k = 'p2_save');
insert into probe select '24. …nor delete one', 'true', (select (v like 'raised:%ทุกฝ่าย%')::text from r where k = 'p2_del');
insert into probe select '25. …nor write the table directly (deny-all; 0 rows touched)', 'ok,วิชาการ',
  (select (select v from r where k = 'p2_tbl') || ',' || (select name from passport.departments where id = 6));

-- ── §D ALLOW for an org-wide admin ─────────────────────────────────────────
-- The tables are deny-all to the CALLER, so ids are read back as the
-- superuser between steps (ids.k) — a lookup inside the signed-in block would
-- read nothing, which is the deny working, not the RPC failing.
create temporary table ids (k text, id int) on commit drop;
grant select on ids to authenticated;

select pg_temp.as_((select id from p3));
set local role authenticated;
insert into r select 'p3_org', passport._org_wide()::text;
insert into r select 'cat', pg_temp.try('select passport.department_catalog()');
insert into r select 'add', pg_temp.try(format('select passport.save_department(null, %L, %L::uuid)',
  (select name from node), (select id from node)));
reset role;
insert into ids select 'dept', id from passport.departments where team_node_id = (select id from node);

select pg_temp.as_((select id from p3));
set local role authenticated;
insert into r select 'add_sub', pg_temp.try(format('select passport.save_sub_department(null, %s, %L, %L::uuid)',
  (select id from ids where k = 'dept'),
  (select kid_name from node), (select kid from node)));   -- the tree is not readable to p3 — by design
reset role;
insert into ids select 'sub', id from passport.sub_departments where team_node_id = (select kid from node);

select pg_temp.as_((select id from p3));
set local role authenticated;
insert into r select 'dup', pg_temp.try(format('select passport.save_department(null, %L)', 'วิชาการ'));
insert into r select 'rename', pg_temp.try(format('select passport.save_department(%s, %L, %L::uuid)',
  (select id from ids where k = 'dept'), 'proof-0247 ชื่อใหม่', (select id from node)));
insert into r select 'hide', pg_temp.try(format('select passport.save_department(%s, %L, %L::uuid, false)',
  (select id from ids where k = 'dept'), 'proof-0247 ชื่อใหม่', (select id from node)));
insert into r select 'listed', (select string_agg((x ->> 'name') || '/' || (x ->> 'active'), ',')
  from jsonb_array_elements(public.list_passport_departments() -> 'departments') x where x ->> 'name' like 'proof-0247%');
insert into r select 'del_used', pg_temp.try($q$select passport.delete_department('department', 6)$q$);
insert into r select 'move_used_sub', pg_temp.try($q$select passport.save_sub_department(3, 6, 'จิตอาสา')$q$);
insert into r select 'del_new_with_sub', pg_temp.try(format('select passport.delete_department(%L, %s)', 'department',
  (select id from ids where k = 'dept')));
insert into r select 'del_sub', pg_temp.try(format('select passport.delete_department(%L, %s)', 'sub_department',
  (select id from ids where k = 'sub')));
insert into r select 'del_new', pg_temp.try(format('select passport.delete_department(%L, %s)', 'department',
  (select id from ids where k = 'dept')));
reset role;
insert into r select 'new_id', (select id::text from ids where k = 'dept');

insert into probe select '30. subject p3 IS org-wide', 'true', (select v from r where k = 'p3_org');
insert into probe select '31. it reads the catalog (list + ทีม SAMO tree + usage)', 'ok', (select v from r where k = 'cat');
insert into probe select '32. it adds a ฝ่าย from a ทีม SAMO node', 'ok', (select v from r where k = 'add');
insert into probe select '33. …which gets the NEXT id, never a reused one', 'true',
  (select ((select v from r where k = 'new_id')::int > 10)::text);
insert into probe select '34. …and a ฝ่ายย่อย under it from the node''s child', 'ok', (select v from r where k = 'add_sub');
insert into probe select '35. a second active ฝ่าย with an existing name is refused', 'true', (select (v like 'raised:%มีฝ่ายชื่อ%')::text from r where k = 'dup');
insert into probe select '36. it renames, then hides; a hidden ฝ่าย is still LISTED, marked', 'ok,ok,proof-0247 ชื่อใหม่/false',
  (select (select v from r where k = 'rename') || ',' || (select v from r where k = 'hide') || ',' || (select v from r where k = 'listed'));
insert into probe select '37. a ฝ่าย with activities cannot be deleted (hide instead)', 'true', (select (v like 'raised:%ถูกใช้แล้ว%')::text from r where k = 'del_used');
insert into probe select '38. a used ฝ่ายย่อย cannot move to another ฝ่าย', 'true', (select (v like 'raised:%ย้ายไปฝ่ายอื่นไม่ได้%')::text from r where k = 'move_used_sub');
insert into probe select '39. a ฝ่าย that still has a ฝ่ายย่อย cannot be deleted', 'true', (select (v like 'raised:%ถูกใช้แล้ว%')::text from r where k = 'del_new_with_sub');
insert into probe select '40. CONTROL: unused rows DO delete (sub, then ฝ่าย)', 'ok,ok,0',
  (select (select v from r where k = 'del_sub') || ',' || (select v from r where k = 'del_new') || ','
       || (select count(*) from passport.departments where team_node_id = (select id from node)));
insert into probe select '41. nothing renamed a ฝ่าย the refusals touched', 'วิชาการ|จิตอาสา',
  (select (select name from passport.departments where id = 6) || '|' || (select name from passport.sub_departments where id = 3));

select step,
       case when got is not distinct from expected then 'PASS' else 'FAIL' end as result,
       expected, got
  from probe order by step;
rollback;
