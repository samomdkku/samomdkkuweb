-- ============================================================
-- house0243-advisor-phones.sql — an อาจารย์'s เบอร์โทรศัพท์ reaches house admins
-- and NOBODY else, by any path.
--
--   §A  the table's own protection, read from the catalog (not from 0243's text)
--   §B  a house admin reads and writes a phone (the ALLOW — without it every DENY
--       below could be a broken table)
--   §C  a signed-in nobody: no rows, no writes
--   §D  a STUDENT of that อาจารย์'s สาย: the advisor reaches them through
--       get_my_student_record(), the phone does not — anywhere in the payload
--   §E  anon: no privilege at all, and a read raises
--
-- Everything runs inside a transaction that ROLLS BACK.
--   node tools/db-query.mjs tools/house0243-advisor-phones.sql [--dev]
-- ============================================================
begin;

create temporary table probe (step text, expected text, got text) on commit drop;

-- ── §A the catalog ──────────────────────────────────────────────────────────
insert into probe select '00. advisor_phones has RLS on', 'true',
  (select relrowsecurity::text from pg_class where oid = 'public.advisor_phones'::regclass);
insert into probe select '01. anon holds NO privilege on advisor_phones', 'false',
  (select (has_table_privilege('anon', 'public.advisor_phones', 'select')
        or has_table_privilege('anon', 'public.advisor_phones', 'insert')
        or has_table_privilege('anon', 'public.advisor_phones', 'update')
        or has_table_privilege('anon', 'public.advisor_phones', 'delete'))::text);
insert into probe select '02. its only policy is the house-admin one', 'advisor_phones_admin_all',
  (select string_agg(policyname, ',' order by policyname) from pg_policies
    where schemaname = 'public' and tablename = 'advisor_phones');
insert into probe select '03. the phone is NOT a column of advisors', '0',
  (select count(*)::text from information_schema.columns
    where table_schema = 'public' and table_name = 'advisors' and column_name ilike '%phone%');
insert into probe select '04. no function body names advisor_phones', '0',
  (select count(*)::text from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
      and pg_get_functiondef(p.oid) ilike '%advisor_phones%');

-- ── subjects ────────────────────────────────────────────────────────────────
-- A synthetic สาย, อาจารย์ and phone. The number is not a real one.
insert into public.sais (code) values ('149') on conflict (code) do nothing;
create temporary table adv on commit drop as
  with a as (insert into public.advisors (first_name_th, last_name_th, dept)
             values ('ทดสอบ0243', 'ห้ามรั่ว', 'proof') returning id)
  select id from a;
grant select on adv to authenticated;
insert into public.sai_advisors (sai_code, advisor_id) select '149', id from adv;

create temporary table admin on commit drop as
select u.id, lower(btrim(u.email)) as email from public.users u
 where u.role in ('vp_admin','dev')
    or 'house' = any (coalesce(u.permissions,'{}') || coalesce(u.managed_permissions,'{}'))
    or 'master' = any (coalesce(u.permissions,'{}') || coalesce(u.managed_permissions,'{}'))
 order by u.id limit 1;
insert into probe select '05. an account holding the house grant exists', '1',
  (select count(*)::text from admin);

-- A real kkumail account with NO house access and no student row yet — given a
-- student row in สาย 149 below, so get_my_student_record() has a record to
-- return. `public.users.email` is what that function joins on, so the subject
-- must be a real users row, not an invented uuid.
create temporary table stu on commit drop as
select u.id, lower(btrim(u.email)) as email from public.users u
 where u.email ilike '%@kkumail.com'
   and coalesce(u.role, 'user') not in ('vp_admin','dev')
   and not ('house'  = any (coalesce(u.permissions,'{}') || coalesce(u.managed_permissions,'{}')))
   and not ('master' = any (coalesce(u.permissions,'{}') || coalesce(u.managed_permissions,'{}')))
   and not exists (select 1 from public.students s where lower(btrim(s.kkumail)) = lower(btrim(u.email)))
 order by u.id limit 1;
insert into probe select '06. an unprivileged kkumail account exists', '1',
  (select count(*)::text from stu);
insert into public.students (kkumail, first_name_th, last_name_th, sai_code)
  select email, 'ทดสอบ0243', 'นักศึกษา', '149' from stu;

create or replace function pg_temp.as_admin() returns void language sql as $$
  select set_config('request.jwt.claims',
    (select json_build_object('sub', id, 'role', 'authenticated', 'email', email)::text from admin), true);
$$;
create or replace function pg_temp.as_student() returns void language sql as $$
  select set_config('request.jwt.claims',
    (select json_build_object('sub', id, 'role', 'authenticated', 'email', email)::text from stu), true);
$$;
create or replace function pg_temp.as_stranger() returns void language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', gen_random_uuid(), 'role', 'authenticated',
                      'email', 'nobody-0243@kkumail.com')::text, true);
$$;
create or replace function pg_temp.try(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return 'ok';
exception when others then return 'raised: ' || sqlerrm; end $$;
grant execute on function pg_temp.try(text) to authenticated, anon;

create temporary table r (k text, v text) on commit drop;
grant insert, select on r to authenticated, anon;

-- ── §B the house admin — the ALLOW ──────────────────────────────────────────
select pg_temp.as_admin();
set local role authenticated;
insert into r select 'admin_insert', pg_temp.try(format(
  'insert into public.advisor_phones (advisor_id, phone) values (%L, %L)',
  (select id from adv), '0899990243'));
insert into r select 'admin_read', (select phone from public.advisor_phones where advisor_id = (select id from adv));
insert into r select 'admin_update', pg_temp.try(format(
  'update public.advisor_phones set phone = %L where advisor_id = %L', '0899990244', (select id from adv)));
insert into r select 'admin_bad', pg_temp.try(format(
  'update public.advisor_phones set phone = %L where advisor_id = %L', '089-999-0244', (select id from adv)));
reset role;
insert into probe select '10. a house admin adds a phone', 'ok', (select v from r where k = 'admin_insert');
insert into probe select '11. a house admin reads it', '0899990243', (select v from r where k = 'admin_read');
insert into probe select '12. a house admin changes it', 'ok', (select v from r where k = 'admin_update');
insert into probe select '13. only digits are stored (dashes refused)', 'true',
  (select (v like 'raised:%advisor_phones_phone_check%')::text from r where k = 'admin_bad');

-- ── §C a signed-in nobody ───────────────────────────────────────────────────
select pg_temp.as_stranger();
set local role authenticated;
insert into r select 'str_read', (select count(*)::text from public.advisor_phones);
insert into r select 'str_update', pg_temp.try(format(
  'update public.advisor_phones set phone = %L where advisor_id = %L', '0811111111', (select id from adv)));
insert into r select 'str_insert', pg_temp.try(format(
  'insert into public.advisor_phones (advisor_id, phone) values (%L, %L)', gen_random_uuid(), '0811111111'));
reset role;
insert into probe select '20. a signed-in nobody reads 0 phones', '0', (select v from r where k = 'str_read');
insert into probe select '21. … and their update changes nothing', '0899990244',
  (select phone from public.advisor_phones where advisor_id = (select id from adv));
insert into probe select '22. … and their insert is refused', 'true',
  (select (v like 'raised:%row-level security%')::text from r where k = 'str_insert');

-- ── §D the student of that สาย ──────────────────────────────────────────────
select pg_temp.as_student();
set local role authenticated;
insert into r select 'stu_rec', public.get_my_student_record()::text;
insert into r select 'stu_read', (select count(*)::text from public.advisor_phones);
insert into r select 'stu_adv', (select count(*)::text from public.advisors);
reset role;
-- The CONTROL: the อาจารย์ DOES reach this student. Without it, "no phone in the
-- payload" would also be what an empty record says.
insert into probe select '30. the student sees their อาจารย์ (control)', 'true',
  (select (v like '%ทดสอบ0243 ห้ามรั่ว%')::text from r where k = 'stu_rec');
insert into probe select '31. … and the phone appears nowhere in that payload', 'false',
  (select (v like '%0899990244%' or v ilike '%phone%')::text from r where k = 'stu_rec');
insert into probe select '32. the student reads 0 phones directly', '0', (select v from r where k = 'stu_read');
insert into probe select '33. the student reads 0 advisors rows directly', '0', (select v from r where k = 'stu_adv');

-- ── §E anon ─────────────────────────────────────────────────────────────────
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
insert into r select 'anon_read', pg_temp.try('select count(*) from public.advisor_phones');
reset role;
insert into probe select '40. anon reading advisor_phones is refused outright', 'true',
  (select (v like 'raised: permission denied%')::text from r where k = 'anon_read');

-- ── §F the row goes with its อาจารย์ ────────────────────────────────────────
delete from public.advisors where id = (select id from adv);
insert into probe select '50. deleting the อาจารย์ deletes the phone', '0',
  (select count(*)::text from public.advisor_phones where phone = '0899990244');

select step,
       case when got is not distinct from expected then 'PASS' else 'FAIL' end as result,
       expected, got
  from probe order by step;

rollback;
