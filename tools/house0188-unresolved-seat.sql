-- ============================================================
-- house0188-unresolved-seat.sql — a held seat may be claimed by the person it
-- names, and by nobody else.
--
-- WHAT THIS IS DEFENDING. 0188 lets a signed-in student turn a row the import
-- could not use into their own ระบบบ้าน record, by supplying two facts from the
-- handover file. Every assertion below is paired with its opposite, because a
-- probe that can only demonstrate "allowed" cannot tell a working grant from a
-- broken guard, and one that can only demonstrate "denied" cannot tell a
-- working guard from a broken connection.
--
--   §A  the table is not a directory       — and the admin CAN still read it
--   §B  the right รหัส + the right ชื่อ claims — and takes the สาย with it
--   §C  the right รหัส + the WRONG ชื่อ does not — nor the wrong รหัส
--   §D  …and a miss says the SAME thing either way (no membership oracle)
--   §E  one account claims ONCE
--   §F  a non-kkumail account may not claim at all
--   §G  the import drops a held row whose person is already a student
--       — and keeps one whose person is not (the control)
--
-- Everything runs inside a transaction that ROLLS BACK, on real `sais` so the
-- foreign key behaves as it does in life.
--
--   node tools/db-query.mjs tools/house0188-unresolved-seat.sql
-- ============================================================
begin;

create temporary table probe (step text, expected text, got text) on commit drop;

insert into probe select '00. the table exists', 'true',
  (to_regclass('public.student_import_unresolved') is not null)::text;

-- ── §A it is not a directory ────────────────────────────────────────────────
-- The rows are 165 real students' ชื่อ, รหัสนักศึกษา and สายรหัส. There is one
-- policy and it is the admin gate; `authenticated` reaching the table directly
-- would make the self-claim's careful silence pointless.
insert into probe select '01. row security is ON', 'true',
  (select relrowsecurity::text from pg_class
    where oid = to_regclass('public.student_import_unresolved'));

insert into probe select '02. exactly one policy, and it is the admin gate', '1,student_import_unresolved_admin_all',
  (select count(*)::text || ',' || min(polname)
     from pg_policy where polrelid = to_regclass('public.student_import_unresolved'));

insert into probe select '03. anon may not read the table', 'false',
  has_table_privilege('anon', to_regclass('public.student_import_unresolved'), 'select')::text;

-- CONTROL for 03. `authenticated` holds the GRANT — that is how the admin
-- policy can ever apply — so the protection is the policy, and 05/06 below are
-- what prove it bites. An assertion that `authenticated` lacked the grant would
-- pass today and say nothing about the policy.
insert into probe select '04. authenticated holds the grant (the policy is what gates)', 'true',
  has_table_privilege('authenticated', to_regclass('public.student_import_unresolved'), 'select')::text;

-- ── subjects ────────────────────────────────────────────────────────────────
-- A สาย that really exists, so `sai_code`'s foreign key is exercised rather
-- than avoided. 0188's own รหัส pattern (9999) is used for every subject: the
-- faculty code cannot belong to anyone, which is the rule 0120 set after a real
-- student's รหัส spread through the repo's examples.
insert into public.sais (code) values ('141') on conflict (code) do nothing;

insert into public.student_import_unresolved
  (student_id, first_name_th, last_name_th, major, sai_code, cohort_year, reason)
values
  ('689999991-1', 'สมชาย',  'ใจดี',   'MD', '141', 2568, 'no_kkumail'),
  ('689999992-9', 'สมหญิง', 'ใจงาม',  'MD', '141', 2568, 'no_kkumail'),
  (null,          'ไม่มีรหัส', 'เลย',  'MD', '141', 2568, 'no_kkumail_no_student_id');

-- Two real auth accounts to speak as. `public.users.email` is what
-- get_my_student_record and claim_my_student_seat both read, so the subject has
-- to be a row there, not an invented uuid.
create temporary table actor on commit drop as
select u.id, lower(btrim(u.email)) as email,
       row_number() over (order by u.id) as n
  from public.users u
 where u.email ilike '%@kkumail.com'
   and not exists (select 1 from public.students s
                    where lower(btrim(s.kkumail)) = lower(btrim(u.email)))
 order by u.id limit 2;

insert into probe select '05. two unused kkumail accounts are available', '2',
  (select count(*)::text from actor);

-- Speaking AS one of them. `set local role` at TOP LEVEL — inside a plpgsql
-- helper it never takes effect, which is how a proof of a policy ends up
-- proving nothing (docs/mistakes/authz-rls.md).
create or replace function pg_temp.as_actor(p_n integer) returns void
language plpgsql as $$
declare v public.users%rowtype;
begin
  select u.* into v from public.users u join actor a on a.id = u.id where a.n = p_n;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v.id, 'role', 'authenticated', 'email', v.email)::text, true);
end $$;

-- Calling the claim through a wrapper that CATCHES, because two of the cases
-- below are `raise exception`, not a returned `ok:false` — and in a plain SQL
-- script an uncaught raise aborts the whole transaction, so the proof would end
-- at its first refusal with every later assertion simply absent. An absent
-- assertion reads as silence, and silence has scored as success in this repo
-- before (docs/mistakes/tooling-proofs.md).
create or replace function pg_temp.try_claim(p_sid text, p_name text) returns jsonb
language plpgsql as $fn$
begin
  return public.claim_my_student_seat(p_sid, p_name);
exception when others then
  return jsonb_build_object('ok', 'raised', 'message', sqlerrm);
end $fn$;

create temporary table attempt (k text, r jsonb) on commit drop;
-- The claims below run as `authenticated`, so that role must be able to write
-- the scratch table that records what came back. It is a TEMP table dropped on
-- commit, and this transaction rolls back regardless — the grant reaches
-- nothing outside this script.
grant insert, select on attempt to authenticated;
grant execute on function pg_temp.try_claim(text, text) to authenticated;

-- ── §B the right two facts claim the seat ───────────────────────────────────
select pg_temp.as_actor(1);
set local role authenticated;
insert into attempt select 'match', pg_temp.try_claim('689999991-1', 'สมชาย');
reset role;

insert into probe select '10. the matching claim succeeds', 'true',
  (select r->>'ok' from attempt where k = 'match');

-- …and it is the SEAT that was claimed, not merely a row. บ้าน is the last digit
-- of the สาย, so a claim that made a student with no สาย would report ok and put
-- the person nowhere.
insert into probe select '11. …and carries the สายรหัส from the held row', '141',
  (select r->>'sai' from attempt where k = 'match');

insert into probe select '12. …the student row exists under the CALLER''s address', 'true',
  (select exists (select 1 from public.students s join actor a on a.n = 1
                   where lower(btrim(s.kkumail)) = a.email
                     and s.student_id = '689999991-1'))::text;

insert into probe select '13. …and the held row is closed as a self-claim', 'self_claim',
  (select resolved_how from public.student_import_unresolved
    where student_id = '689999991-1');

-- ── §C the wrong facts do not ───────────────────────────────────────────────
select pg_temp.as_actor(2);
set local role authenticated;
insert into attempt select 'wrong_name',  pg_temp.try_claim('689999992-9', 'สมปอง');
insert into attempt select 'wrong_sid',   pg_temp.try_claim('680000000-0', 'สมหญิง');
insert into attempt select 'no_such_row', pg_temp.try_claim('689999999-9', 'ไม่มีใคร');
reset role;

insert into probe select '20. right รหัส + wrong ชื่อ is refused', 'false',
  (select r->>'ok' from attempt where k = 'wrong_name');
insert into probe select '21. wrong รหัส + right ชื่อ is refused', 'false',
  (select r->>'ok' from attempt where k = 'wrong_sid');
insert into probe select '22. neither matching is refused', 'false',
  (select r->>'ok' from attempt where k = 'no_such_row');

insert into probe select '23. …and the seat is still open after the misses', 'true',
  (select (resolved_at is null)::text from public.student_import_unresolved
    where student_id = '689999992-9');

-- ── §D a miss is not a membership oracle ────────────────────────────────────
-- The reason §A keeps the table unreadable is that the list is private. A
-- refusal that said "that รหัส is held, but the name is wrong" would hand the
-- list back one guess at a time — and it is the NEAR miss, the real รหัส with a
-- wrong name, that leaks. That is the one compared here.
insert into probe select '30. a near miss and a total miss say the same thing', 'true',
  (select ((select r->>'message' from attempt where k = 'wrong_name')
        is not distinct from
           (select r->>'message' from attempt where k = 'no_such_row'))::text);

-- CONTROL for 30: the messages are real sentences, so the equality above is not
-- two nulls agreeing. An assertion satisfied by absence is the shape this repo
-- has been bitten by five times.
insert into probe select '31. …and that shared message is a real sentence', 'true',
  (select (length(coalesce(r->>'message','')) > 20)::text
     from attempt where k = 'wrong_name');

-- ── §E one account, one claim ───────────────────────────────────────────────
-- Actor 1 holds a student row from §B. Without this an account could walk the
-- held list and take every seat it could name.
select pg_temp.as_actor(1);
set local role authenticated;
insert into attempt select 'second_claim', pg_temp.try_claim('689999992-9', 'สมหญิง');
reset role;

insert into probe select '40. an account that already has a record cannot claim again', 'raised',
  (select r->>'ok' from attempt where k = 'second_claim');

insert into probe select '41. …and the seat it reached for is still open', 'true',
  (select (resolved_at is null)::text from public.student_import_unresolved
    where student_id = '689999992-9');

-- ── §F a non-kkumail account may not claim at all ───────────────────────────
-- ระบบบ้าน matches a person to their record on kkumail and nothing else
-- (get_my_student_record joins on it), so a row written under any other address
-- is one its own owner could never read.
create temporary table outsider on commit drop as
select u.id, lower(btrim(u.email)) as email from public.users u
 where u.email is not null and length(btrim(u.email)) > 0
   and u.email not ilike '%@kkumail.com'
 order by u.id limit 1;

insert into probe select '45. a non-kkumail account exists to test with', 'true',
  (select (count(*) = 1)::text from outsider);

select set_config('request.jwt.claims',
  (select json_build_object('sub', id, 'role', 'authenticated', 'email', email)::text
     from outsider), true);
set local role authenticated;
insert into attempt select 'outsider', pg_temp.try_claim('689999992-9', 'สมหญิง');
reset role;

insert into probe select '46. a non-kkumail account is refused', 'raised',
  (select r->>'ok' from attempt where k = 'outsider');

-- CONTROL for 46: the refusal is about the DOMAIN, not about the row being
-- unavailable — the same facts succeeded for a kkumail caller in §B, and this
-- seat is still open (41). Without this, a guard that refused everyone would
-- pass 46 for ever.
insert into probe select '47. …for the domain, not because the seat was gone', 'true',
  (select (r->>'message' like '%kkumail%')::text from attempt where k = 'outsider');

-- ── §G the import drops a held row whose person is already a student ────────
-- THE LEAK THIS CLOSES. After §B, actor 1 is a student — but the handover file
-- still has no address for 689999991-1, so the next import would hold them
-- again, for ever. Both halves are asserted: the resolved person is dropped,
-- and somebody genuinely still missing is KEPT.
select public.record_unresolved_rows(null, jsonb_build_array(
  jsonb_build_object('student_id','689999991-1','first_name_th','สมชาย',
                     'sai_code','141','cohort_year',2568,'reason','no_kkumail','source_line',10),
  jsonb_build_object('student_id','689999993-7','first_name_th','สมศรี',
                     'sai_code','141','cohort_year',2568,'reason','no_kkumail','source_line',11)
));

insert into probe select '50. a held row whose person is now a student is dropped', 'false',
  (select exists (select 1 from public.student_import_unresolved
                   where student_id = '689999991-1' and resolved_at is null))::text;

insert into probe select '51. …and one still missing is kept (the control)', 'true',
  (select exists (select 1 from public.student_import_unresolved
                   where student_id = '689999993-7' and resolved_at is null))::text;

insert into probe select '52. …while the self-claim record survives the re-import', 'self_claim',
  (select resolved_how from public.student_import_unresolved
    where student_id = '689999991-1' and resolved_at is not null);

select step,
       case when got is not distinct from expected then 'PASS' else 'FAIL' end as result,
       expected, got
  from probe order by step;

rollback;
