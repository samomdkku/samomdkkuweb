-- ============================================================
-- rotation0261-audit.sql — แลก Rotation: GPA change audit trail.
--
-- Proves:
-- 1. Direct SELECT / INSERT / UPDATE / DELETE on rotation_gpa_audit
--    is DENIED to anon and authenticated.
-- 2. Changing gpa logs (old_gpa, new_gpa) with user_id to rotation_gpa_audit.
-- 3. Changing to the SAME value does NOT produce a redundant audit row.
-- 4. Setting gpa to null logs (old_gpa, null).
-- 5. Non-admin calling rotation_admin_gpa_audit raises ROTATION_ADMIN_ONLY.
-- 6. Named admin calling rotation_admin_gpa_audit reads the audit trail.
--
-- Rolls back.
--   node tools/db-query.mjs tools/rotation0261-audit.sql [--dev]
-- ============================================================
begin;

create temporary table probe (step text, expected text, got text) on commit drop;
grant insert, select on probe to authenticated, anon;

-- §A Security & Privileges
insert into probe select '01. anon holds no privilege on rotation_gpa_audit', 'false',
  (select bool_or(has_table_privilege('anon', c.oid, 'select') or has_table_privilege('anon', c.oid, 'insert')
               or has_table_privilege('anon', c.oid, 'update') or has_table_privilege('anon', c.oid, 'delete'))::text
     from pg_class c where c.relname = 'rotation_gpa_audit');

insert into probe select '02. authenticated cannot SELECT rotation_gpa_audit directly', 'false',
  (select has_table_privilege('authenticated', 'public.rotation_gpa_audit', 'select')::text);

insert into probe select '03. anon cannot call rotation_admin_gpa_audit', 'false',
  (select has_function_privilege('anon', 'public.rotation_admin_gpa_audit(text)', 'execute')::text);

insert into probe select '04. authenticated can execute rotation_admin_gpa_audit RPC', 'true',
  (select has_function_privilege('authenticated', 'public.rotation_admin_gpa_audit(text)', 'execute')::text);

-- §B Subjects & Setup
create temporary table subj (k text primary key, uid uuid, email text) on commit drop;
grant select on subj to authenticated, anon;

insert into subj
select 'admin', u.id, lower(btrim(u.email))
  from public.users u
 where u.id in (select user_id from public.rotation_admins)
    or u.role = 'dev'
 limit 1;

insert into subj
select 'student', u.id, lower(btrim(u.email))
  from public.users u
 where u.id not in (select user_id from public.rotation_admins)
   and coalesce(u.role, 'user') not in ('dev')
 limit 1;

create temporary table r (k text primary key, v text) on commit drop;
grant insert, select on r to authenticated, anon;

create or replace function pg_temp.try(sql text) returns text language plpgsql as $$
begin
  execute sql;
  return 'ok';
exception when others then
  return 'raised: ' || SQLERRM;
end;
$$;

create or replace function pg_temp.as_(k text) returns void language plpgsql as $$
declare
  u subj;
begin
  select * into u from subj where subj.k = $1;
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', u.uid::text, 'role', 'authenticated', 'email', u.email)::text, true);
end;
$$;

-- Create synthetic test student
insert into public.rotation_students (round_id, student_id, prefix, first_name, last_name, gender, original_group, current_group, kkumail)
values ('y6-2570', '999999999-9', 'นาย', 'ทดสอบ', 'ออดิต', 'M', 'A', 'A', 'audit.test@kkumail.com');

insert into r (k, v) select 'stu_id', id::text from public.rotation_students where student_id = '999999999-9';

-- §C Trigger functionality on GPA change
-- 1. Initial gpa set to 3.50
update public.rotation_students
   set gpa = 3.50
 where student_id = '999999999-9';

insert into probe select '05. first gpa change logged (null -> 3.50)', 'null -> 3.50',
  (select coalesce(old_gpa::text, 'null') || ' -> ' || new_gpa::text
     from public.rotation_gpa_audit
    where student_id = (select v::uuid from r where k='stu_id')
    order by id desc limit 1);

-- 2. Update to the SAME GPA (no-op)
update public.rotation_students
   set gpa = 3.50
 where student_id = '999999999-9';

insert into probe select '06. updating to same gpa does not insert duplicate log', '1',
  (select count(*)::text
     from public.rotation_gpa_audit
    where student_id = (select v::uuid from r where k='stu_id'));

-- 3. Update to 3.20
update public.rotation_students
   set gpa = 3.20
 where student_id = '999999999-9';

insert into probe select '07. second change logged (3.50 -> 3.20)', '3.50 -> 3.20',
  (select coalesce(old_gpa::text, 'null') || ' -> ' || new_gpa::text
     from public.rotation_gpa_audit
    where student_id = (select v::uuid from r where k='stu_id')
    order by id desc limit 1);

-- 4. Update to null
update public.rotation_students
   set gpa = null
 where student_id = '999999999-9';

insert into probe select '08. clearing gpa logged (3.20 -> null)', '3.20 -> null',
  (select coalesce(old_gpa::text, 'null') || ' -> ' || coalesce(new_gpa::text, 'null')
     from public.rotation_gpa_audit
    where student_id = (select v::uuid from r where k='stu_id')
    order by id desc limit 1);

-- §D RPC Authorization
select pg_temp.as_('student');
insert into r select 'rpc_student', pg_temp.try($q$select public.rotation_admin_gpa_audit('y6-2570')::text$q$);
reset role;

insert into probe select '09. student calling rotation_admin_gpa_audit is refused', 'raised: ROTATION_ADMIN_ONLY',
  (select v from r where k='rpc_student');

select pg_temp.as_('admin');
insert into r select 'rpc_admin', (public.rotation_admin_gpa_audit('y6-2570')->0->>'student_id');
reset role;

insert into probe select '10. admin calling rotation_admin_gpa_audit succeeds', 'true',
  (select ((select v from r where k='rpc_admin') is not null)::text);

select step,
       case when got is not distinct from expected then 'PASS' else 'FAIL' end as result,
       expected, got
  from probe order by step;

rollback;
