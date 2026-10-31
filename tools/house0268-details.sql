-- ============================================================
-- house0268-details.sql — a student the file does not name can hand over
-- everything (สาย included) for an admin to check, and learns nothing by it.
--
--   §A  submit stores every field, verbatim, on the CALLER's own request
--   §B  …and its answer does not depend on what the file holds (no oracle)
--   §C  …and it never touches `students` — a สาย typed is a statement, not a bบ้าน
--   §D  validation: สาย 1–3 digits, never 000; นามสกุล required; padding
--   §E  who may call it: a kkumail account with NO record; not anon
--   §F  the receipt reads back their own words, still nothing about the held list
--   §G  ANY path giving that address a record closes the request (the trigger)
--   §H  the admin's list carries the details; a non-admin cannot read it
--   §I  the claim's miss still has ONE exit, and now says `details`
--
-- Everything ROLLS BACK.
--   node tools/db-query.mjs tools/house0268-details.sql
-- ============================================================
begin;

create temporary table probe (step text, expected text, got text) on commit drop;

-- ── subjects ────────────────────────────────────────────────────────────────
insert into public.sais (code) values ('142') on conflict (code) do nothing;
create temporary table batch on commit drop as
  with b as (insert into public.student_import_batches (file_name, row_count)
             values ('house0268-proof.csv', 0) returning id) select id from b;
-- A held seat that agrees with actor 2 on the รหัส — so if submit consulted the
-- file at all, actor 2's answer could differ from actor 1's.
insert into public.student_import_unresolved
  (batch_id, student_id, first_name_th, last_name_th, major, sai_code, cohort_year, reason)
select (select id from batch), '689999771-1', 'ประยุทธ', 'ทดสอบ', 'MD', '142', 2568, 'no_kkumail';

create temporary table actor on commit drop as
select u.id, lower(btrim(u.email)) as email, row_number() over (order by u.id) as n
  from public.users u
 where u.email ilike '%@kkumail.com'
   and not exists (select 1 from public.students s where lower(btrim(s.kkumail)) = lower(btrim(u.email)))
   and not exists (select 1 from public.house_help_requests h where h.kkumail = lower(btrim(u.email)))
   -- a STUDENT, by the gate's own predicate: no role and no grant on either
   -- channel. The first run picked a `master` holder, who reads the table by
   -- design, and §44 reported a "leak" that was the probe subject.
   and coalesce(u.role, 'user') = 'user'
   and cardinality(coalesce(u.permissions, '{}')) = 0
   and cardinality(coalesce(u.managed_permissions, '{}')) = 0
 order by u.id limit 3;
insert into probe select '00. three unused kkumail accounts holding no grant', '3', (select count(*)::text from actor);

create temporary table admin_ on commit drop as
select u.id, lower(btrim(u.email)) as email from public.users u
 where u.role in ('vp_admin','dev')
    or 'house' = any (coalesce(u.permissions,'{}') || coalesce(u.managed_permissions,'{}'))
    or 'master' = any (coalesce(u.permissions,'{}') || coalesce(u.managed_permissions,'{}'))
 order by u.id limit 1;

create or replace function pg_temp.as_(p_id uuid) returns void language sql as $$
  select set_config('request.jwt.claims',
    (select json_build_object('sub', u.id, 'role', 'authenticated', 'email', u.email)::text
       from public.users u where u.id = p_id), true);
$$;
create or replace function pg_temp.try(p_sql text) returns jsonb language plpgsql as $fn$
declare v jsonb;
begin execute p_sql into v; return coalesce(v, 'null'::jsonb);
exception when others then return jsonb_build_object('raised', sqlerrm); end $fn$;
grant execute on function pg_temp.try(text) to authenticated;
create temporary table r (k text, v jsonb) on commit drop;
grant insert, select on r to authenticated;

create temporary table students_before on commit drop as select count(*) c from public.students;

-- ── §A + §B ─────────────────────────────────────────────────────────────────
select pg_temp.as_((select id from actor where n = 1));
set local role authenticated;
insert into r select 'a1', pg_temp.try($q$select public.submit_my_house_details(' 689999770-3 ', 'สมปอง', 'ทดลองดี', 'ปอง', 'MD', '7')$q$);
reset role;
select pg_temp.as_((select id from actor where n = 2));
set local role authenticated;
insert into r select 'a2', pg_temp.try($q$select public.submit_my_house_details('689999771-1', 'ไม่ใช่ประยุทธ', 'คนอื่น', null, null, '142')$q$);
reset role;

insert into probe select '10. submit stores every field on the caller''s request', '689999770-3|สมปอง|ทดลองดี|ปอง|MD|007|true',
  (select concat_ws('|', typed_student_id, typed_first_name, typed_last_name, typed_nickname, typed_major, typed_sai_code, (details_at is not null)::text)
     from public.house_help_requests where kkumail = (select email from actor where n = 1));
insert into probe select '11. …as an open no_record request', 'no_record,true',
  (select kind || ',' || (resolved_at is null)::text from public.house_help_requests where kkumail = (select email from actor where n = 1));
-- §B: actor 2's รหัส IS in the held list (different ชื่อ); actor 1's is not. The
-- two answers must have the same SHAPE — a key present for one and not the
-- other would say which รหัส the file holds.
insert into probe select '12. the answer has the same keys whether or not the file holds that รหัส', 'true',
  (select ((select array_agg(k order by k) from jsonb_object_keys((select v from r where k = 'a1')) k)
         = (select array_agg(k order by k) from jsonb_object_keys((select v from r where k = 'a2')) k))::text);
insert into probe select '13. …and it is a real answer, not two errors agreeing', 'false',
  (select ((select v from r where k = 'a1') ? 'raised')::text);
insert into probe select '14. the function body never reads the held list', 'false',
  (select (pg_get_functiondef('public.submit_my_house_details(text,text,text,text,text,text)'::regprocedure)
           ~* 'student_import_unresolved')::text);

-- ── §C ──────────────────────────────────────────────────────────────────────
insert into probe select '20. no student row was created by submitting', 'true',
  (select ((select count(*) from public.students) = (select c from students_before))::text);

-- ── §D validation ───────────────────────────────────────────────────────────
select pg_temp.as_((select id from actor where n = 3));
set local role authenticated;
insert into r select 'd_nosai', pg_temp.try($q$select public.submit_my_house_details('689999772-9', 'ก', 'ข', null, null, '')$q$);
insert into r select 'd_000',   pg_temp.try($q$select public.submit_my_house_details('689999772-9', 'ก', 'ข', null, null, '000')$q$);
insert into r select 'd_long',  pg_temp.try($q$select public.submit_my_house_details('689999772-9', 'ก', 'ข', null, null, '1234')$q$);
insert into r select 'd_nolast',pg_temp.try($q$select public.submit_my_house_details('689999772-9', 'ก', '  ', null, null, '12')$q$);
insert into r select 'd_nosid', pg_temp.try($q$select public.submit_my_house_details('', 'ก', 'ข', null, null, '12')$q$);
reset role;
insert into probe select '30. no สาย is refused', 'true', (select (v ? 'raised')::text from r where k = 'd_nosai');
insert into probe select '31. สาย 000 is refused', 'true', (select (v ? 'raised')::text from r where k = 'd_000');
insert into probe select '32. a 4-digit สาย is refused', 'true', (select (v ? 'raised')::text from r where k = 'd_long');
insert into probe select '33. a blank นามสกุล is refused', 'true', (select (v ? 'raised')::text from r where k = 'd_nolast');
insert into probe select '34. a blank รหัส is refused', 'true', (select (v ? 'raised')::text from r where k = 'd_nosid');
insert into probe select '35. …and none of the refusals left a row', '0',
  (select count(*)::text from public.house_help_requests where kkumail = (select email from actor where n = 3));
-- CONTROL for 30–35: the same account CAN submit a valid one (so the refusals
-- are validation, not a broken function).
select pg_temp.as_((select id from actor where n = 3));
set local role authenticated;
insert into r select 'd_ok', pg_temp.try($q$select public.submit_my_house_details('689999772-9', 'ก', 'ข', null, null, '12')$q$);
reset role;
insert into probe select '36. CONTROL: a valid submit from that account works, สาย padded', '012',
  (select typed_sai_code from public.house_help_requests where kkumail = (select email from actor where n = 3));

-- ── §E who may call it ──────────────────────────────────────────────────────
insert into probe select '40. anon may not execute it', 'false',
  has_function_privilege('anon', 'public.submit_my_house_details(text,text,text,text,text,text)', 'execute')::text;
insert into probe select '41. authenticated may (the body gates)', 'true',
  has_function_privilege('authenticated', 'public.submit_my_house_details(text,text,text,text,text,text)', 'execute')::text;
-- an account WITH a student record is refused (it fixes its card instead)
create temporary table has_rec on commit drop as
  select u.id from public.users u join public.students s on lower(btrim(s.kkumail)) = lower(btrim(u.email))
   where u.email ilike '%@kkumail.com' order by u.id limit 1;
select pg_temp.as_((select id from has_rec));
set local role authenticated;
insert into r select 'e_rec', pg_temp.try($q$select public.submit_my_house_details('689999773-7', 'ก', 'ข', null, null, '12')$q$);
reset role;
insert into probe select '42. an account that already has a record is refused', 'true',
  (select ((v->>'raised') like '%มีข้อมูลนักศึกษาอยู่แล้ว%')::text from r where k = 'e_rec');
-- a non-kkumail account is refused
create temporary table nonkku on commit drop as
  select id from public.users where email is not null and email not ilike '%@kkumail.com' order by id limit 1;
select pg_temp.as_((select id from nonkku));
set local role authenticated;
insert into r select 'e_gmail', pg_temp.try($q$select public.submit_my_house_details('689999773-7', 'ก', 'ข', null, null, '12')$q$);
reset role;
insert into probe select '43. a non-kkumail account is refused', 'true', (select (v ? 'raised')::text from r where k = 'e_gmail');
-- the table itself stays admin-only: a student cannot read the requests
select pg_temp.as_((select id from actor where n = 1));
set local role authenticated;
insert into r select 'e_read', jsonb_build_object('n', (select count(*) from public.house_help_requests));
reset role;
insert into probe select '44. a student reads 0 rows of the table directly', '0', (select v->>'n' from r where k = 'e_read');

-- ── §F the receipt ──────────────────────────────────────────────────────────
select pg_temp.as_((select id from actor where n = 1));
set local role authenticated;
insert into r select 'f1', public.my_house_help_status();
reset role;
insert into probe select '50. the receipt reads back their own สาย and นามสกุล', '007|ทดลองดี',
  (select (v->'typed'->>'sai_code') || '|' || (v->'typed'->>'last_name') from r where k = 'f1');
insert into probe select '51. …and nothing about the held list', 'false',
  (select ((v ? 'candidates') or (v ? 'showing'))::text from r where k = 'f1');

-- ── §G any path closes it ───────────────────────────────────────────────────
-- An ADMIN adding the person by hand (the path that used to leave it open).
select pg_temp.as_((select id from admin_));
insert into public.students (kkumail, student_id, first_name_th, last_name_th, sai_code)
  select email, '689999770-3', 'สมปอง', 'ทดลองดี', '142' from actor where n = 1;
insert into probe select '60. an admin adding the address by hand closes its request', 'admin',
  (select resolved_how from public.house_help_requests where kkumail = (select email from actor where n = 1));
insert into probe select '61. CONTROL: the other open requests are untouched', 'true,true',
  (select string_agg((resolved_at is null)::text, ',' order by kkumail) from public.house_help_requests
    where kkumail in (select email from actor where n in (2, 3)));
-- …and after a resolve, new details REOPEN it (actor 3: dismissed, then resubmits)
select pg_temp.as_((select id from admin_));
select public.resolve_house_help_request((select id from public.house_help_requests where kkumail = (select email from actor where n = 3)), 'proof');
select pg_temp.as_((select id from actor where n = 3));
set local role authenticated;
insert into r select 'g_again', pg_temp.try($q$select public.submit_my_house_details('689999772-9', 'ก', 'ข', null, null, '13')$q$);
reset role;
insert into probe select '62. new details reopen a closed request', 'true,013',
  (select (resolved_at is null)::text || ',' || typed_sai_code from public.house_help_requests where kkumail = (select email from actor where n = 3));
-- A SELF claim closes it as 'claimed' — the trigger fires first and must not
-- label the student's own success as an admin's.
insert into public.student_import_unresolved
  (batch_id, student_id, first_name_th, last_name_th, major, sai_code, cohort_year, reason)
select (select id from batch), '689999774-5', 'ก', 'ข', 'MD', '142', 2568, 'no_kkumail';
select pg_temp.as_((select id from actor where n = 3));
set local role authenticated;
insert into r select 'g_claim', pg_temp.try($q$select public.claim_my_student_seat('689999774-5', 'ก')$q$);
reset role;
insert into probe select '63. a successful self-claim closes it as claimed', 'true,claimed',
  (select (select v->>'ok' from r where k = 'g_claim') || ',' || resolved_how
     from public.house_help_requests where kkumail = (select email from actor where n = 3));

-- ── §H the admin's list ─────────────────────────────────────────────────────
select pg_temp.as_((select id from admin_));
insert into probe select '70. the admin list carries the submitted details', 'คนอื่น|142',
  (select (x->>'typed_last_name') || '|' || (x->>'typed_sai_code')
     from jsonb_array_elements(public.list_house_help_requests(true)) x
    where x->>'kkumail' = (select email from actor where n = 2));
select pg_temp.as_((select id from actor where n = 2));
set local role authenticated;
insert into r select 'h_student', pg_temp.try($q$select public.list_house_help_requests(true)$q$);
reset role;
insert into probe select '71. a student cannot read the list', 'true', (select (v ? 'raised')::text from r where k = 'h_student');

-- ── §I the claim's miss ─────────────────────────────────────────────────────
select pg_temp.as_((select id from actor where n = 2));
set local role authenticated;
insert into r select 'i_miss', pg_temp.try($q$select public.claim_my_student_seat('689999771-1', 'ผิดชื่อ')$q$);
insert into r select 'i_total', pg_temp.try($q$select public.claim_my_student_seat('680000001-8', 'ไม่มีใคร')$q$);
reset role;
insert into probe select '80. a miss asks for the details', 'false,true',
  (select (v->>'ok') || ',' || (v->>'details') from r where k = 'i_miss');
insert into probe select '81. a near miss and a total miss still say the same thing', 'true',
  (select ((select v->>'message' from r where k = 'i_miss') = (select v->>'message' from r where k = 'i_total'))::text);
insert into probe select '82. …and the miss still has ONE exit', '1',
  (select ((length(d) - length(replace(d, '''ok'', false', ''))) / length('''ok'', false'))::text
     from (select pg_get_functiondef('public.claim_my_student_seat(text,text)'::regprocedure) d) x);

select step,
       case when got is not distinct from expected then 'PASS' else 'FAIL' end as result,
       expected, got
  from probe order by step;
rollback;
