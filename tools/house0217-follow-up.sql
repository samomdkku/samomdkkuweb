-- ============================================================
-- house0217-follow-up.sql — what ฝ่ายข้อมูล found out about a held row is
-- kept, closes only what it should, and survives the next roster import.
--
--   §A  only a house admin can record or undo an answer (ALLOW + DENY)
--   §B  ติดต่อไม่ได้ / คาดว่าลาออก keep the seat OPEN; ลาออก / ไม่มีตัวตน close it
--   §C  an import CARRIES what we knew about an open row (it used to erase it)
--   §D  an import does not re-hold a seat already answered — with a รหัส (0190,
--       which 0193 had reverted) AND without one (new) — with CONTROLS that a
--       never-answered line IS still held
--   §E  a close can be undone; a row that became a student cannot be reopened
--
-- Everything runs inside a transaction that ROLLS BACK.
--   node tools/db-query.mjs tools/house0217-follow-up.sql
-- ============================================================
begin;

create temporary table probe (step text, expected text, got text) on commit drop;

insert into probe select '00. the follow-up columns exist', '3',
  (select count(*)::text from information_schema.columns
    where table_schema = 'public' and table_name = 'student_import_unresolved'
      and column_name in ('follow_up', 'follow_up_at', 'follow_up_by'));

-- ── subjects ────────────────────────────────────────────────────────────────
insert into public.sais (code) values ('141'), ('142'), ('143'), ('144'), ('145')
  on conflict (code) do nothing;

create temporary table batch on commit drop as
  with b as (insert into public.student_import_batches (file_name, row_count)
             values ('house0217-proof.csv', 0) returning id)
  select id from b;
grant select on batch to authenticated;

create temporary table admin on commit drop as
select u.id, lower(btrim(u.email)) as email from public.users u
 where u.role in ('vp_admin','dev')
    or 'house' = any (coalesce(u.permissions,'{}') || coalesce(u.managed_permissions,'{}'))
    or 'master' = any (coalesce(u.permissions,'{}') || coalesce(u.managed_permissions,'{}'))
 order by u.id limit 1;
insert into probe select '01. an account holding the house grant exists', '1',
  (select count(*)::text from admin);

create or replace function pg_temp.as_admin() returns void language sql as $$
  select set_config('request.jwt.claims',
    (select json_build_object('sub', id, 'role', 'authenticated', 'email', email)::text from admin), true);
$$;
-- A signed-in nobody: an id no users row has, so role and permissions are empty.
create or replace function pg_temp.as_stranger() returns void language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', gen_random_uuid(), 'role', 'authenticated',
                      'email', 'nobody-0217@kkumail.com')::text, true);
$$;
create or replace function pg_temp.try(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return 'ok';
exception when others then return 'raised: ' || sqlerrm; end $$;
grant execute on function pg_temp.try(text) to authenticated;

create temporary table r (k text, v text) on commit drop;
grant insert, select on r to authenticated;

-- Held rows, created directly (the import path is §C/§D's subject).
insert into public.student_import_unresolved
  (batch_id, student_id, first_name_th, last_name_th, major, sai_code, cohort_year, reason)
values
  ((select id from batch), '689999701-1', 'ทดสอบ', 'ติดต่อไม่ได้', 'MD', '141', 2568, 'no_kkumail'),
  ((select id from batch), null,          'ทดสอบ', 'ลาออกไม่มีรหัส', 'MD', '142', 2568, 'no_kkumail_no_student_id'),
  ((select id from batch), '689999703-3', 'ทดสอบ', 'ไม่มีตัวตน',  'MD', '143', 2568, 'no_kkumail');
create temporary table subj on commit drop as
  select id, coalesce(student_id, '') as sid, last_name_th as tag from public.student_import_unresolved
   where batch_id = (select id from batch);
grant select on subj to authenticated;

-- ── §A who may ──────────────────────────────────────────────────────────────
select pg_temp.as_stranger();
set local role authenticated;
insert into r select 'deny_set', pg_temp.try(format(
  'select public.set_unresolved_follow_up(%L, %L, null)',
  (select id from subj where tag = 'ติดต่อไม่ได้'), 'unreachable'));
reset role;
insert into probe select '10. a stranger may NOT record an answer', 'true',
  (select (v like 'raised: ไม่มีสิทธิ์%')::text from r where k = 'deny_set');

-- ── §B what each answer does ────────────────────────────────────────────────
select pg_temp.as_admin();
set local role authenticated;
insert into r select 'allow_set', pg_temp.try(format(
  'select public.set_unresolved_follow_up(%L, %L, %L)',
  (select id from subj where tag = 'ติดต่อไม่ได้'), 'unreachable', 'ฝ่ายข้อมูล: ติดต่อไม่ได้'));
insert into r select 'close_left', pg_temp.try(format(
  'select public.set_unresolved_follow_up(%L, %L, null)',
  (select id from subj where tag = 'ลาออกไม่มีรหัส'), 'left'));
insert into r select 'close_none', pg_temp.try(format(
  'select public.set_unresolved_follow_up(%L, %L, null)',
  (select id from subj where tag = 'ไม่มีตัวตน'), 'no_person'));
insert into r select 'bad_status', pg_temp.try(format(
  'select public.set_unresolved_follow_up(%L, %L, null)',
  (select id from subj where tag = 'ติดต่อไม่ได้'), 'gone'));
reset role;

insert into probe select '11. the admin records ติดต่อไม่ได้', 'ok', (select v from r where k = 'allow_set');
insert into probe select '12. …and the seat stays OPEN (still claimable)', 'unreachable|open',
  (select follow_up || '|' || case when resolved_at is null then 'open' else 'closed' end
     from public.student_import_unresolved where id = (select id from subj where tag = 'ติดต่อไม่ได้'));
insert into probe select '13. ลาออก CLOSES the row as a dismissal', 'left|dismissed',
  (select follow_up || '|' || coalesce(resolved_how, 'open')
     from public.student_import_unresolved where id = (select id from subj where tag = 'ลาออกไม่มีรหัส'));
insert into probe select '14. ไม่มีตัวตน CLOSES the row too', 'no_person|dismissed',
  (select follow_up || '|' || coalesce(resolved_how, 'open')
     from public.student_import_unresolved where id = (select id from subj where tag = 'ไม่มีตัวตน'));
insert into probe select '15. an unknown status is refused', 'true',
  (select (v like 'raised: สถานะการติดตามไม่ถูกต้อง%')::text from r where k = 'bad_status');
insert into probe select '16. the table refuses a closing answer on an OPEN row', 'true',
  (select (pg_temp.try(format(
     'update public.student_import_unresolved set follow_up = %L where id = %L',
     'left', (select id from subj where tag = 'ติดต่อไม่ได้'))) like 'raised:%check%')::text);

-- ── §C + §D the next import ─────────────────────────────────────────────────
-- The file names all three again, plus two lines nobody has answered — the
-- CONTROLS: one with a รหัส, one without.
select pg_temp.as_admin();
set local role authenticated;
insert into r select 'import', public.record_unresolved_rows((select id from batch), jsonb_build_array(
  jsonb_build_object('student_id', '689999701-1', 'first_name_th', 'ทดสอบ', 'last_name_th', 'ติดต่อไม่ได้',
                     'sai_code', '141', 'cohort_year', 2568, 'source_line', 1),
  jsonb_build_object('first_name_th', 'ทดสอบ', 'last_name_th', 'ลาออกไม่มีรหัส',
                     'sai_code', '142', 'cohort_year', 2568, 'reason', 'no_kkumail_no_student_id', 'source_line', 2),
  jsonb_build_object('student_id', '689999703-3', 'first_name_th', 'ทดสอบ', 'last_name_th', 'ไม่มีตัวตน',
                     'sai_code', '143', 'cohort_year', 2568, 'source_line', 3),
  jsonb_build_object('student_id', '689999704-4', 'first_name_th', 'ทดสอบ', 'last_name_th', 'ยังไม่ตอบ',
                     'sai_code', '144', 'cohort_year', 2568, 'source_line', 4),
  jsonb_build_object('first_name_th', 'ทดสอบ', 'last_name_th', 'ยังไม่ตอบไม่มีรหัส',
                     'sai_code', '145', 'cohort_year', 2568, 'reason', 'no_kkumail_no_student_id', 'source_line', 5)
))::text;
reset role;

insert into probe select '20. the import CARRIES ติดต่อไม่ได้ onto the re-created open row', 'unreachable|ฝ่ายข้อมูล: ติดต่อไม่ได้',
  (select follow_up || '|' || coalesce(note, '') from public.student_import_unresolved
    where resolved_at is null and student_id = '689999701-1');
insert into probe select '21. …and says how many it carried', 'true',
  (select ((v::jsonb ->> 'carried')::int >= 1)::text from r where k = 'import');
insert into probe select '22. a seat closed WITH a รหัส is not re-held (0190, restored)', '0',
  (select count(*)::text from public.student_import_unresolved
    where resolved_at is null and student_id = '689999703-3');
insert into probe select '23. a seat closed with NO รหัส is not re-held (new)', '0',
  (select count(*)::text from public.student_import_unresolved
    where resolved_at is null and sai_code = '142' and cohort_year = 2568 and last_name_th = 'ลาออกไม่มีรหัส');
insert into probe select '24. CONTROL: a never-answered line WITH a รหัส is held', '1',
  (select count(*)::text from public.student_import_unresolved
    where resolved_at is null and student_id = '689999704-4');
insert into probe select '25. CONTROL: a never-answered line with NO รหัส is held', '1',
  (select count(*)::text from public.student_import_unresolved
    where resolved_at is null and sai_code = '145' and cohort_year = 2568);

-- ── §E undo ─────────────────────────────────────────────────────────────────
select pg_temp.as_stranger();
set local role authenticated;
insert into r select 'deny_reopen', pg_temp.try(format('select public.reopen_unresolved_row(%L, null)',
  (select id from subj where tag = 'ลาออกไม่มีรหัส')));
reset role;
insert into probe select '30. a stranger may NOT reopen', 'true',
  (select (v like 'raised: ไม่มีสิทธิ์%')::text from r where k = 'deny_reopen');

select pg_temp.as_admin();
set local role authenticated;
insert into r select 'reopen', pg_temp.try(format('select public.reopen_unresolved_row(%L, %L)',
  (select id from subj where tag = 'ลาออกไม่มีรหัส'), 'ยังเรียนอยู่'));
reset role;
insert into probe select '31. the admin reopens a ลาออก row: open, answer cleared', 'ok|open|',
  (select (select v from r where k = 'reopen') || '|'
          || case when resolved_at is null then 'open' else 'closed' end || '|' || coalesce(follow_up, '')
     from public.student_import_unresolved where id = (select id from subj where tag = 'ลาออกไม่มีรหัส'));

-- A row that became a student: promote one, then try to reopen it.
create temporary table promoted on commit drop as
  select id from public.student_import_unresolved where resolved_at is null and student_id = '689999704-4';
grant select on promoted to authenticated;
select public.promote_unresolved_row((select id from promoted), 'house0217-proof@kkumail.com');
set local role authenticated;
insert into r select 'reopen_student', pg_temp.try(format('select public.reopen_unresolved_row(%L, null)',
  (select id from promoted)));
reset role;
insert into probe select '32. a row that became a student cannot be reopened', 'true',
  (select (v like 'raised: รายการนี้กลายเป็นข้อมูลนักศึกษาแล้ว%')::text from r where k = 'reopen_student');

select step,
       case when got is not distinct from expected then 'PASS' else 'FAIL' end as result,
       expected, got
  from probe order by step;

rollback;
