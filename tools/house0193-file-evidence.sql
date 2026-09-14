-- ============================================================
-- house0193-file-evidence.sql — what the file said survives the cleaning, and
-- can never become an identity.
--
-- WHAT THIS DEFENDS. 0193 adds two columns to `student_import_unresolved` that
-- hold EVIDENCE: the address cell as the handover file had it, on the rows where
-- the cleaner removed it, and one sentence of what the file said that no other
-- column can carry (the รุ่น of a row with no รหัสนักศึกษา). The properties:
--
--   §A  the columns exist and are plain text, held to no constraint
--   §B  the importer CARRIES them, and they land on the right row
--   §C  the admin's list EMITS them        — a column the list omits does not
--                                            exist as far as an admin is concerned
--   §D  ⛔ they are EVIDENCE, never an identity: a claim, a promote and a
--       re-import must all ignore `file_kkumail` completely
--   §E  `cohort_year` still means "derived from the รหัสนักศึกษา" — a รุ่น the
--       file merely STATED must not appear there
--   §F  a client that sends neither key behaves exactly as before
--
-- §D is the one worth stating out loud. `file_kkumail` is an address we have
-- ALREADY decided is not this person's login — that is the entire reason the row
-- is held. If anything ever resolves a row USING it, the bug is a student row
-- keyed on somebody else's address, which is the failure the cleaner blanks it
-- to avoid. So the proof asserts the absence: after a claim, the new student's
-- kkumail is the CLAIMANT's, never the file's.
--
-- Everything runs inside a transaction that ROLLS BACK.
--
--   node tools/db-query.mjs tools/house0193-file-evidence.sql
-- ============================================================
begin;

create temporary table probe (step text, expected text, got text) on commit drop;

-- ── §A the columns ──────────────────────────────────────────────────────────
insert into probe select '01. file_kkumail exists', 'text',
  (select data_type from information_schema.columns
    where table_schema = 'public' and table_name = 'student_import_unresolved'
      and column_name = 'file_kkumail');

insert into probe select '02. file_note exists', 'text',
  (select data_type from information_schema.columns
    where table_schema = 'public' and table_name = 'student_import_unresolved'
      and column_name = 'file_note');

-- Evidence is quoted, so it is held to NOTHING: no check, no unique, no foreign
-- key. A constraint here would be a rule about a file we do not control, and the
-- row exists precisely because that file was irregular.
insert into probe select '03. no constraint references file_kkumail', '0',
  (select count(*)::text from pg_constraint c
     join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
    where c.conrelid = to_regclass('public.student_import_unresolved')
      and a.attname in ('file_kkumail', 'file_note'));

-- ── subjects ────────────────────────────────────────────────────────────────
insert into public.sais (code) values ('141') on conflict (code) do nothing;

create temporary table batch on commit drop as
  with b as (insert into public.student_import_batches (file_name, row_count)
             values ('house0193-proof.csv', 0) returning id)
  select id from b;
-- Read while impersonating `authenticated`, so the role needs the grant. These
-- are TEMP tables inside a transaction that rolls back; nothing survives it.
grant select on batch to authenticated;

-- An admin to speak as. Chosen by the PREDICATE the RPCs actually test, not by
-- `limit 1` over the table — house0188 paid for that three times in one file.
create temporary table actor on commit drop as
  select u.id, lower(btrim(u.email)) as email
    from public.users u
   where u.email is not null
     and (u.role in ('vp_admin', 'dev')
          or 'house'  = any (coalesce(u.permissions, '{}'))
          or 'house'  = any (coalesce(u.managed_permissions, '{}'))
          or 'master' = any (coalesce(u.permissions, '{}'))
          or 'master' = any (coalesce(u.managed_permissions, '{}')))
   order by u.id
   limit 1;
grant select on actor to authenticated;

insert into probe select '04. found an admin to speak as', 'true',
  (select (count(*) = 1)::text from actor);

create or replace function pg_temp.as_admin() returns void language plpgsql as $$
declare v_id uuid; v_mail text;
begin
  select id, email into v_id, v_mail from actor;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_id, 'role', 'authenticated',
                      'email', v_mail)::text, true);
end $$;

-- ── §B the importer carries them ────────────────────────────────────────────
-- The REAL payload shape, as src/js/house/io.js toUnresolvedRow() builds it.
select pg_temp.as_admin();
set local role authenticated;
create temporary table kept on commit drop as
select public.record_unresolved_rows((select id from batch), jsonb_build_array(
  jsonb_build_object(
    'source_line', 114, 'student_id', '649999001-1',
    'first_name_th', 'ธีร์ธวัช', 'last_name_th', 'ทดสอบ',
    'major', 'MD', 'sai_code', '141', 'cohort_year', 2564,
    'file_kkumail', 'someone.else@kkumail.com',
    'file_note', 'ไฟล์ระบุอีเมลนี้ไว้ แต่เป็นของคนอื่น จึงไม่ใช้',
    'reason', 'no_kkumail'),
  jsonb_build_object(
    'source_line', 888, 'student_id', null,
    'first_name_th', 'จารุเดช', 'last_name_th', 'ทดสอบ',
    'major', 'MD', 'sai_code', '141', 'cohort_year', null,
    'file_kkumail', null,
    'file_note', 'ไฟล์ระบุรุ่น MD52 (ไม่มีรหัสนักศึกษาให้คำนวณ)',
    'reason', 'no_kkumail_no_student_id')
)) as v;
reset role;

insert into probe select '10. both rows held', '2',
  (select (v->>'held') from kept);

insert into probe select '11. the removed address is kept, verbatim', 'someone.else@kkumail.com',
  (select file_kkumail from public.student_import_unresolved
    where source_line = 114 and resolved_at is null);

insert into probe select '12. …on the RIGHT row — the other one has none', 'true',
  (select (file_kkumail is null)::text from public.student_import_unresolved
    where source_line = 888 and resolved_at is null);

insert into probe select '13. the file''s sentence is kept', 'true',
  (select (file_note like 'ไฟล์ระบุรุ่น MD52%')::text
     from public.student_import_unresolved where source_line = 888 and resolved_at is null);

-- ── §E cohort_year still means ONE thing ────────────────────────────────────
-- The row with no รหัสนักศึกษา states its รุ่น in the file. It must NOT appear
-- in cohort_year, which is derived from the รหัส through cohort_from_student_id
-- — 0188 refused that on purpose, and a reader has to be able to tell a derived
-- value from a quoted one.
insert into probe select '20. a STATED รุ่น does not reach cohort_year', 'true',
  (select (cohort_year is null)::text from public.student_import_unresolved
    where source_line = 888 and resolved_at is null);

-- CONTROL for 20: the row that HAS a รหัส did get its cohort_year, so 20 is not
-- passing on a column nothing ever fills.
insert into probe select '21. …while a DERIVED one still does', '2564',
  (select cohort_year::text from public.student_import_unresolved
    where source_line = 114 and resolved_at is null);

-- ── §C the admin can see it ─────────────────────────────────────────────────
select pg_temp.as_admin();
set local role authenticated;
create temporary table listed on commit drop as
  select public.list_unresolved_rows(false) as v;
reset role;

insert into probe select '30. the list emits file_kkumail', 'true',
  (select (v @> jsonb_build_array(jsonb_build_object(
             'file_kkumail', 'someone.else@kkumail.com')))::text from listed);

insert into probe select '31. the list emits file_note', 'true',
  (select bool_or(r->>'file_note' like 'ไฟล์ระบุรุ่น MD52%')::text
     from listed, jsonb_array_elements(v) as r);

-- ── §D ⛔ EVIDENCE, NEVER AN IDENTITY ───────────────────────────────────────
-- A student claims the held seat with their OWN verified address. The file's
-- address is on that row and must play no part: not as the new student's
-- kkumail, not as a match key, not as a fallback.
create temporary table claimant on commit drop as
  select u.id, lower(btrim(u.email)) as email
    from public.users u
   where u.email ilike '%@kkumail.com'
     and not exists (select 1 from public.students s
                      where lower(btrim(s.kkumail)) = lower(btrim(u.email)))
   order by u.id limit 1;
grant select on claimant to authenticated;

insert into probe select '39. found a claimant with no student row', 'true',
  (select (count(*) = 1)::text from claimant);

update public.student_import_unresolved
   set student_id = '649999001-1', first_name_th = 'ธีร์ธวัช'
 where source_line = 114 and resolved_at is null;

do $$
declare v_id uuid; v_mail text;
begin
  select id, email into v_id, v_mail from claimant;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_id, 'role', 'authenticated', 'email', v_mail)::text, true);
end $$;
set local role authenticated;
create temporary table claimed on commit drop as
  select public.claim_my_student_seat('649999001-1', 'ธีร์ธวัช') as v;
reset role;

insert into probe select '40. the claim succeeds', 'true',
  (select (v->>'ok') from claimed);

-- ⛔ THE PROPERTY §D IS ABOUT: which ADDRESS the new row is keyed on.
--
-- ⚠️ It deliberately does NOT assert the รหัสนักศึกษา, and the first version of
-- this proof did — it went red against a correct system, because a claim is
-- IMPORT data (0189) and `students_link_person` lets the REGISTRY win on
-- `student_id` when it already holds one for that person. That is the designed
-- behaviour and it is not what this section is testing. Asserting it here would
-- have made a claim about identity resolution inside a proof about evidence,
-- and the fastest way to green would have been to weaken the real assertion.
insert into probe select '41. ⛔ the new student is keyed on the CLAIMANT''s address', 'true',
  (select exists (select 1 from public.students s, claimant c
                   where lower(btrim(s.kkumail)) = c.email)::text);

insert into probe select '42. ⛔ the FILE''s address became nobody''s login', 'false',
  (select exists (select 1 from public.students
                   where lower(btrim(kkumail)) = 'someone.else@kkumail.com')::text);

-- ── §F an older client, sending neither key ─────────────────────────────────
-- The two columns are additive. A payload without them must behave exactly as
-- it did before 0193 rather than raising — otherwise a stale bundle breaks the
-- import, and the bundle is always behind the database by design.
select pg_temp.as_admin();
set local role authenticated;
create temporary table legacy on commit drop as
select public.record_unresolved_rows((select id from batch), jsonb_build_array(
  jsonb_build_object('source_line', 5, 'student_id', '649999002-9',
    'first_name_th', 'เก่า', 'last_name_th', 'ทดสอบ', 'major', 'MD',
    'sai_code', '141', 'cohort_year', 2564, 'reason', 'no_kkumail')
)) as v;
reset role;

insert into probe select '50. a payload with neither key still holds the row', '1',
  (select (v->>'held') from legacy);

insert into probe select '51. …and both columns are simply null', 'true',
  (select (file_kkumail is null and file_note is null)::text
     from public.student_import_unresolved where source_line = 5 and resolved_at is null);

select step,
       case when got is not distinct from expected then 'PASS' else 'FAIL' end as result,
       expected, got
  from probe order by step;

rollback;
