-- ============================================================
-- rotation0262-off-criteria.sql — แลก Rotation: off-criteria swaps
-- (0.2–0.3, missing GPA, >0.3) + anti-probing GPA edit lock.
--
-- Proves:
-- 1. Helper function correctly categorizes 'diff_02_03', 'missing_gpa', 'diff_over_03'.
-- 2. Direct off-criteria request succeeds with p_off_criteria = true.
-- 3. Broadcast with p_off_criteria = true is refused ('cannot_broadcast_off_criteria').
-- 4. Anti-spam: second pending off-criteria ask is refused ('too_many_off_criteria').
-- 5. Accepting off-criteria ask executes swap and logs kind = 'off_criteria' with reason.
-- 6. Different gender cannot swap off-criteria (gender rule preserved).
-- 7. rotation_set_gpa hard locks at >= 3 edits in rotation_gpa_audit ('ROTATION_GPA_LOCKED').
--
-- Rolls back.
--   node tools/db-query.mjs tools/rotation0262-off-criteria.sql [--dev]
-- ============================================================
begin;

create temporary table probe (step text, expected text, got text) on commit drop;
grant insert, select on probe to authenticated, anon;

-- Setup test round 'proof-0262'
insert into public.rotation_rounds (id, title, published, swaps_open, swaps_close_at, gpa_rule)
values ('proof-0262', 'Proof 0262', true, true, now() + interval '1 day', 'band_or_close');

-- Select two real users from public.users
create temporary table subj (k text primary key, uid uuid, email text) on commit drop;
grant select on subj to authenticated, anon;

insert into subj (k, uid, email)
select 's1', u.id, lower(btrim(u.email)) from public.users u where u.email is not null order by u.id limit 1;

insert into subj (k, uid, email)
select 's2', u.id, lower(btrim(u.email)) from public.users u where u.email is not null and u.id not in (select uid from subj) order by u.id limit 1;

-- Create synthetic test students in 'proof-0262'
-- S1: Group A, Male, GPA 3.50
-- S2: Group B, Male, GPA 3.25 (diff = 0.25 -> diff_02_03)
-- S3: Group C, Male, GPA null (missing_gpa)
-- S4: Group D, Male, GPA 3.00 (diff = 0.50 -> diff_over_03)
-- S5: Group E, Female, GPA 3.25 (different gender -> blocked)
insert into public.rotation_students (round_id, student_id, prefix, first_name, last_name, gender, original_group, current_group, gpa, kkumail)
values
  ('proof-0262', '999999991-1', 'นาย', 'ผู้ขอ', 'ทดสอบหนึ่ง', 'M', 'A', 'A', 3.50, (select email from subj where k='s1')),
  ('proof-0262', '999999992-2', 'นาย', 'เพื่อนสอง', 'ทดสอบสอง', 'M', 'B', 'B', 3.25, (select email from subj where k='s2')),
  ('proof-0262', '999999993-3', 'นาย', 'เพื่อนสาม', 'ทดสอบสาม', 'M', 'C', 'C', null, 's3.test@kkumail.com'),
  ('proof-0262', '999999994-4', 'นาย', 'เพื่อนสี่', 'ทดสอบสี่', 'M', 'D', 'D', 3.00, 's4.test@kkumail.com'),
  ('proof-0262', '999999995-5', 'นางสาว', 'เพื่อนหญิง', 'ทดสอบห้า', 'F', 'E', 'E', 3.25, 's5.test@kkumail.com');

create temporary table stu (k text primary key, id uuid, g text) on commit drop;
grant select on stu to authenticated, anon;

insert into stu (k, id, g)
select student_id, id, current_group from public.rotation_students where round_id = 'proof-0262';

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

-- §1 Helper classification
insert into probe select '01. S1 vs S2 (diff 0.25) categorized as diff_02_03', 'diff_02_03',
  public.rotation_pair_off_criteria_reason('proof-0262',
    (select s from public.rotation_students s where round_id = 'proof-0262' and student_id = '999999991-1'),
    (select s from public.rotation_students s where round_id = 'proof-0262' and student_id = '999999992-2'));

insert into probe select '02. S1 vs S3 (null GPA) categorized as missing_gpa', 'missing_gpa',
  public.rotation_pair_off_criteria_reason('proof-0262',
    (select s from public.rotation_students s where round_id = 'proof-0262' and student_id = '999999991-1'),
    (select s from public.rotation_students s where round_id = 'proof-0262' and student_id = '999999993-3'));

insert into probe select '03. S1 vs S4 (diff 0.50) categorized as diff_over_03', 'diff_over_03',
  public.rotation_pair_off_criteria_reason('proof-0262',
    (select s from public.rotation_students s where round_id = 'proof-0262' and student_id = '999999991-1'),
    (select s from public.rotation_students s where round_id = 'proof-0262' and student_id = '999999994-4'));

insert into probe select '04. S1 vs S5 (different gender) returns null', 'null',
  coalesce(public.rotation_pair_off_criteria_reason('proof-0262',
    (select s from public.rotation_students s where round_id = 'proof-0262' and student_id = '999999991-1'),
    (select s from public.rotation_students s where round_id = 'proof-0262' and student_id = '999999995-5')), 'null');

-- §2 Off-criteria requests
-- Switch to S1
select pg_temp.as_('s1');

-- A: Attempt to broadcast off-criteria -> rejected
insert into probe select '05. broadcast off-criteria is rejected', 'cannot_broadcast_off_criteria',
  (public.rotation_request('proof-0262', null, 'B', true)->>'reason');

-- B: Direct off-criteria request S1 -> S2 (diff 0.25)
create temporary table req (k text primary key, id uuid) on commit drop;
grant insert, select on req to authenticated, anon;

insert into req (k, id)
select 'req_s2', (public.rotation_request('proof-0262', (select id from stu where k='999999992-2'), null, true)->>'id')::uuid;

insert into probe select '06. direct off-criteria request S1 -> S2 succeeds', 'true',
  (select ((select id from req where k='req_s2') is not null)::text);

-- C: Anti-spam: attempting second off-criteria ask while req_s2 is pending -> rejected
insert into probe select '07. second off-criteria ask rejected by anti-spam', 'too_many_off_criteria',
  (public.rotation_request('proof-0262', (select id from stu where k='999999993-3'), null, true)->>'reason');

-- §3 Acceptance & Move recording
-- Switch to S2
select pg_temp.as_('s2');

insert into probe select '08. S2 accepts off-criteria request from S1', 'true',
  (public.rotation_accept((select id from req where k='req_s2'))->>'ok');

reset role;

insert into probe select '09. rotation_moves logs kind = off_criteria with reason diff_02_03', 'off_criteria:diff_02_03',
  (select kind || ':' || off_criteria_reason
     from public.rotation_moves
    where request_id = (select id from req where k='req_s2')
    limit 1);

-- §4 Anti-probing GPA edit lock
-- Set up 3 audit rows for S1
insert into public.rotation_gpa_audit (round_id, student_id, old_gpa, new_gpa)
values
  ('proof-0262', (select id from stu where k='999999991-1'), null, 3.50),
  ('proof-0262', (select id from stu where k='999999991-1'), 3.50, 3.40),
  ('proof-0262', (select id from stu where k='999999991-1'), 3.40, 3.30);

select pg_temp.as_('s1');

-- Attempting 4th edit via rotation_set_gpa must raise ROTATION_GPA_LOCKED
create temporary table gpa_probe (msg text) on commit drop;
grant insert, select on gpa_probe to authenticated, anon;

do $$
begin
  perform public.rotation_set_gpa('proof-0262', 3.20);
  insert into gpa_probe values ('unexpected_success');
exception when others then
  insert into gpa_probe values (SQLERRM);
end;
$$;

reset role;

insert into probe select '10. 4th GPA edit is rejected with ROTATION_GPA_LOCKED', 'ROTATION_GPA_LOCKED',
  (select msg from gpa_probe limit 1);

-- Output verdicts
select step,
       case when got is not distinct from expected then 'PASS' else 'FAIL' end as result,
       expected, got
  from probe order by step;

rollback;
