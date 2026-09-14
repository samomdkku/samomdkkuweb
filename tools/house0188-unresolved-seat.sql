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

-- A real import batch. Since 0189 `batch_id` is NOT NULL and the reference is
-- `on delete restrict`: a held row that cannot name the import it came from
-- reads to both mirror triggers as "not import data", which is the wrong branch
-- for a row that exists only because an import could not use it (§G2 below).
create temporary table batch on commit drop as
  with b as (
    insert into public.student_import_batches (file_name, row_count)
    values ('house0188-proof.csv', 0) returning id)
  select id from b;

insert into public.student_import_unresolved
  (batch_id, student_id, first_name_th, last_name_th, major, sai_code, cohort_year, reason)
select (select id from batch), * from (values
  ('689999991-1', 'สมชาย',  'ใจดี',   'MD', '141', 2568::smallint, 'no_kkumail'),
  ('689999992-9', 'สมหญิง', 'ใจงาม',  'MD', '141', 2568::smallint, 'no_kkumail'),
  (null,          'ไม่มีรหัส', 'เลย',  'MD', '141', 2568::smallint, 'no_kkumail_no_student_id')) v;

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
 order by u.id limit 3;

insert into probe select '05. three unused kkumail accounts are available', '3',
  (select count(*)::text from actor);

-- Put each actor's REGISTRY row into a known state, instead of taking whatever
-- `public.people` happens to hold for them.
--
-- WHY THIS IS HERE AT ALL. The first version of this proof took the registry as
-- found, and §12 asserted that the claimed รหัสนักศึกษา landed on the student
-- row. That is true only for somebody the registry does not already know — and
-- 0189 made the registry WIN on that column, so the assertion went red against
-- correct code the moment the first actor turned out to be a real registered
-- person. A proof whose subject is "whatever row comes back first" is a proof
-- whose scenario can change under it. Create the geometry the case needs.
--
--   actor 1 — registry AGREES with the held row  → a clean claim (§B)
--   actor 3 — registry DISAGREES                 → 0189's precedence (§H)
create or replace function pg_temp.set_registry(
  p_n integer, p_first text, p_last text, p_sid text) returns void
language plpgsql as $$
declare v_mail text; v_id uuid;
begin
  select email into v_mail from actor where n = p_n;
  select id into v_id from public.people where lower(btrim(kkumail)) = v_mail;
  if v_id is null then
    insert into public.people (kkumail, first_name_th, last_name_th, student_id)
    values (v_mail, p_first, p_last, p_sid);
  else
    update public.people
       set first_name_th = p_first, last_name_th = p_last, student_id = p_sid
     where id = v_id;
  end if;
end $$;

select pg_temp.set_registry(1, 'สมชาย', 'ใจดี', '689999991-1');
-- A DIFFERENT รหัส from the held row's, deliberately. That divergence is the
-- whole scenario: 0189 lets the registry win on `student_id`, so the claimer
-- lands under THIS number and nobody in `students` carries the held row's — the
-- exact state in which "is somebody already a student under this รหัส" stops
-- being able to see that the seat was dealt with (0190, §53/§54).
select pg_temp.set_registry(3, 'ภูมิใจ', 'นามเดิม', '659999993-3');

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

-- 0189. The row's ชื่อ, รหัส, สาขา and สาย came from an import file, so both
-- mirror triggers have to treat it as import data. Without the flag the claim
-- took the OPPOSITE branch from the importer with the same data: it pushed the
-- file's spelling up over a curated registry name and recorded nothing (§H).
insert into probe select '14. …and is marked as import-sourced, like the importer''s own rows', 'true',
  (select (last_import_batch is not null) from public.students s join actor a on a.n = 1
    where lower(btrim(s.kkumail)) = a.email);

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

-- ── §H the file does NOT get to rename somebody the registry already knows ──
--
-- THE BUG 0189 FIXED, and it is not a hypothetical: `653070078-2` in the
-- 2026-09-14 handover is spelled วรมิตา by the สายรหัส table, รมิตา by
-- ฝ่ายวิชาการ's, and her own kkumail is `ramita.si@` — so the file is the wrong
-- source for that name, and the claim path was the one that would have let it
-- win. Before 0189 a claim wrote the file's spelling straight over a curated
-- registry name and recorded nothing, which is the OPPOSITE of what the
-- importer does with the same data.
insert into public.student_import_unresolved
  (batch_id, student_id, first_name_th, last_name_th, major, sai_code, cohort_year, reason)
select (select id from batch), '689999993-7', 'ภูมิใจ', 'ชื่อในไฟล์', 'MD', '141', 2568, 'no_kkumail';

insert into probe select '60. the registry name before the claim', 'ภูมิใจ,นามเดิม',
  (select p.first_name_th || ',' || p.last_name_th
     from public.people p join actor a on a.n = 3 where lower(btrim(p.kkumail)) = a.email);

select pg_temp.as_actor(3);
set local role authenticated;
insert into attempt select 'registry_differs', pg_temp.try_claim('689999993-7', 'ภูมิใจ');
reset role;

insert into probe select '61. the claim still succeeds', 'true',
  (select r->>'ok' from attempt where k = 'registry_differs');

insert into probe select '62. …and the REGISTRY name is untouched by the file', 'ภูมิใจ,นามเดิม',
  (select p.first_name_th || ',' || p.last_name_th
     from public.people p join actor a on a.n = 3 where lower(btrim(p.kkumail)) = a.email);

-- CONTROL for 62. The file really did carry a different surname, so 62 is not
-- two identical values agreeing — it is the registry winning a disagreement.
insert into probe select '63. …over a surname that genuinely differed', 'ชื่อในไฟล์',
  (select last_name_th from public.student_import_unresolved where student_id = '689999993-7');

-- And the disagreement is not merely discarded. A silent win is indistinguishable
-- from no disagreement having happened, which is how nobody ever finds out the
-- two departments disagree about a real person's name.
insert into probe select '64. …and the disagreement is RECORDED, not dropped', 'true',
  (select exists (select 1 from public.identity_conflicts c
                   join public.people p on p.id = c.person_id
                   join actor a on a.n = 3
                  where lower(btrim(p.kkumail)) = a.email
                    and c.field = 'last_name_th'))::text;

-- ── §G the import drops a held row whose person is already a student ────────
--
-- RUN AS A CALLER THAT ACTUALLY HOLDS THE GRANT, chosen on purpose.
-- `record_unresolved_rows` gates on `current_user_role()`, which reads
-- `auth.uid()` out of the jwt claims — and the claims are still whoever spoke
-- last. This section used to run straight after §F and passed, which looked like
-- it was running as the superuser; it was running as the OUTSIDER, and passed
-- only because the first non-kkumail account in the table happens to be an
-- admin. Adding §H moved a non-admin into that slot and the whole proof errored.
-- Same fragility as §B's registry: a subject that is "whoever comes back first"
-- is a subject that changes under the proof.
create temporary table importer on commit drop as
select u.id, lower(btrim(u.email)) as email from public.users u
 where u.role in ('vp_admin','dev')
    or 'house' = any (coalesce(u.permissions, '{}') || coalesce(u.managed_permissions, '{}'))
    or 'master' = any (coalesce(u.permissions, '{}') || coalesce(u.managed_permissions, '{}'))
 order by u.id limit 1;

insert into probe select '48. an account holding the house grant exists to import as', 'true',
  (select (count(*) = 1)::text from importer);

select set_config('request.jwt.claims',
  (select json_build_object('sub', id, 'role', 'authenticated', 'email', email)::text
     from importer), true);

-- THE LEAK THIS CLOSES. After §B, actor 1 is a student — but the handover file
-- still has no address for 689999991-1, so the next import would hold them
-- again, for ever. Both halves are asserted: the resolved person is dropped,
-- and somebody genuinely still missing is KEPT.
select public.record_unresolved_rows((select id from batch), jsonb_build_array(
  jsonb_build_object('student_id','689999991-1','first_name_th','สมชาย',
                     'sai_code','141','cohort_year',2568,'reason','no_kkumail','source_line',10),
  jsonb_build_object('student_id','689999993-7','first_name_th','ภูมิใจ',
                     'sai_code','141','cohort_year',2568,'reason','no_kkumail','source_line',11),
  jsonb_build_object('student_id','689999995-2','first_name_th','สมศรี',
                     'sai_code','141','cohort_year',2568,'reason','no_kkumail','source_line',12)
));

insert into probe select '50. a held row whose person is now a student is dropped', 'false',
  (select exists (select 1 from public.student_import_unresolved
                   where student_id = '689999991-1' and resolved_at is null))::text;

-- 0190. The SAME question asked of the seat 0189 made unanswerable the other
-- way: actor 3's claim landed under the REGISTRY's รหัส, so no student carries
-- `689999993-7` and the "is somebody already in ระบบบ้าน under this รหัส" test
-- finds nothing. The seat was still dealt with, and the row saying so is in this
-- table with `resolved_at` set.
insert into probe select '53. …and so is one whose claimer kept their registry รหัส', 'false',
  (select exists (select 1 from public.student_import_unresolved
                   where student_id = '689999993-7' and resolved_at is null))::text;

-- CONTROL for 53: that รหัส really is absent from `students`, so 53 is passing
-- on the resolution and not on the student lookup that 0190 was added beside.
insert into probe select '54. …with no student carrying that รหัส at all (the control)', 'false',
  (select exists (select 1 from public.students
                   where public.student_id_key(student_id) = public.student_id_key('689999993-7')))::text;

insert into probe select '51. …and one still missing is kept (the control)', 'true',
  (select exists (select 1 from public.student_import_unresolved
                   where student_id = '689999995-2' and resolved_at is null))::text;

insert into probe select '52. …while the self-claim record survives the re-import', 'self_claim',
  (select resolved_how from public.student_import_unresolved
    where student_id = '689999991-1' and resolved_at is not null);

select step,
       case when got is not distinct from expected then 'PASS' else 'FAIL' end as result,
       expected, got
  from probe order by step;

rollback;
