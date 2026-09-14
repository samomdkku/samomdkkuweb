-- ============================================================
-- house0194-import-fills-registry.sql — an import fills a hole in the registry
-- and never writes over anything in it.
--
-- WHAT THIS DEFENDS. 0189 said the registry wins over import data. 0194 keeps
-- that and narrows it: "wins" means wherever the registry HAS a value, not
-- wherever a row exists. The properties, and §C is the one 0189 exists for:
--
--   §A  a registry hole is FILLED from the import
--   §B  …every column, not just the name
--   §C  ⛔ a registry value is NEVER overwritten by an import
--   §D  a NON-import insert still prefers the incoming value (unchanged)
--   §E  the two branches differ ONLY in the coalesce direction
--
-- Everything runs inside a transaction that ROLLS BACK.
--
--   node tools/db-query.mjs tools/house0194-import-fills-registry.sql
-- ============================================================
begin;

create temporary table probe (step text, expected text, got text) on commit drop;

insert into public.sais (code) values ('141') on conflict (code) do nothing;

create temporary table batch on commit drop as
  with b as (insert into public.student_import_batches (file_name, row_count)
             values ('house0194-proof.csv', 0) returning id)
  select id from b;

-- ── §A/§B a hole is filled ─────────────────────────────────────────────────
-- A registry row that knows only a full_name — exactly the shape a ทีม SAMO
-- member has before ระบบบ้าน ever hears of them, and the shape 136 real people
-- were in when this was measured.
create temporary table empty_person on commit drop as
  with p as (
    insert into public.people (kkumail, full_name)
    values ('h0194.empty@kkumail.com', 'ว่าง เปล่า') returning id)
  select id from p;

insert into public.students
  (kkumail, student_id, first_name_th, last_name_th, nickname_imported,
   major, sai_code, person_id, last_import_batch)
select 'h0194.empty@kkumail.com', '649999101-1', 'ชื่อจากไฟล์', 'สกุลจากไฟล์',
       'เล่นจากไฟล์', 'MD', '141', (select id from empty_person), (select id from batch);

insert into probe select '01. ชื่อ filled from the import', 'ชื่อจากไฟล์',
  (select first_name_th from public.people where id = (select id from empty_person));
insert into probe select '02. นามสกุล filled', 'สกุลจากไฟล์',
  (select last_name_th from public.people where id = (select id from empty_person));
insert into probe select '03. ชื่อเล่น filled', 'เล่นจากไฟล์',
  (select nickname from public.people where id = (select id from empty_person));
insert into probe select '04. รหัสนักศึกษา filled', '649999101-1',
  (select student_id from public.people where id = (select id from empty_person));
insert into probe select '05. สาขา filled', 'MD',
  (select major from public.people where id = (select id from empty_person));
-- cohort_year is DERIVED from the รหัส by people_fill_cohort, so it arrives
-- either way; asserted so a change to that trigger cannot silently drop it.
insert into probe select '06. รุ่น derived', '2564',
  (select cohort_year::text from public.people where id = (select id from empty_person));

-- ── §C ⛔ a registry VALUE is never overwritten ────────────────────────────
-- This is the whole of 0189 and the reason the import branch exists at all.
create temporary table curated_person on commit drop as
  with p as (
    insert into public.people (kkumail, first_name_th, last_name_th, nickname,
                               student_id, major)
    values ('h0194.curated@kkumail.com', 'ชื่อที่ดูแลไว้', 'สกุลที่ดูแลไว้',
            'เล่นที่ดูแลไว้', '649999102-9', 'MD')
    returning id)
  select id from p;

insert into public.students
  (kkumail, student_id, first_name_th, last_name_th, nickname_imported,
   major, sai_code, person_id, last_import_batch)
select 'h0194.curated@kkumail.com', '649999999-9', 'ชื่อจากไฟล์', 'สกุลจากไฟล์',
       'เล่นจากไฟล์', 'MDI', '141', (select id from curated_person), (select id from batch);

insert into probe select '10. ⛔ curated ชื่อ survives', 'ชื่อที่ดูแลไว้',
  (select first_name_th from public.people where id = (select id from curated_person));
insert into probe select '11. ⛔ curated นามสกุล survives', 'สกุลที่ดูแลไว้',
  (select last_name_th from public.people where id = (select id from curated_person));
insert into probe select '12. ⛔ curated ชื่อเล่น survives', 'เล่นที่ดูแลไว้',
  (select nickname from public.people where id = (select id from curated_person));
insert into probe select '13. ⛔ curated รหัส survives', '649999102-9',
  (select student_id from public.people where id = (select id from curated_person));
insert into probe select '14. ⛔ curated สาขา survives', 'MD',
  (select major from public.people where id = (select id from curated_person));

-- …and the STUDENT row took the registry's values on the way in
-- (students_link_person, 0189) — so after both triggers the two agree.
insert into probe select '15. the student row agrees with the registry', 'ชื่อที่ดูแลไว้',
  (select first_name_th from public.students
    where kkumail = 'h0194.curated@kkumail.com');

-- ── §D a NON-import insert is unchanged ────────────────────────────────────
-- A claim or a hand-added student: the incoming value is the newest thing
-- anybody has said, and it still wins over an empty registry column.
create temporary table claimed_person on commit drop as
  with p as (insert into public.people (kkumail, full_name)
             values ('h0194.claim@kkumail.com', 'เคลม ทดสอบ') returning id)
  select id from p;

insert into public.students
  (kkumail, student_id, first_name_th, last_name_th, major, sai_code, person_id)
select 'h0194.claim@kkumail.com', '649999103-7', 'ชื่อที่กรอกเอง', 'สกุลที่กรอกเอง',
       'MD', '141', (select id from claimed_person);

insert into probe select '20. a non-import insert still writes up', 'ชื่อที่กรอกเอง',
  (select first_name_th from public.people where id = (select id from claimed_person));

-- ── §E the shape of the function itself ────────────────────────────────────
-- A SOURCE assertion, deliberately, and it is the only one here: the two
-- branches are correct only while their coalesces point OPPOSITE ways, and that
-- is invisible to any behavioural test that does not already know which branch
-- it is in. Reversing either one passes §A or §D while breaking the other.
insert into probe select '30. the import branch coalesces REGISTRY first', 'true',
  (select (pg_get_functiondef(p.oid) like '%coalesce(p.first_name_th, new.first_name_th)%')::text
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'student_insert_mirror_up');
insert into probe select '31. the ordinary branch coalesces INCOMING first', 'true',
  (select (pg_get_functiondef(p.oid) like '%coalesce(new.first_name_th, p.first_name_th)%')::text
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'student_insert_mirror_up');

-- ── §F THE LIVE INVARIANT ──────────────────────────────────────────────────
-- Everything above is about one synthetic person. This asks the question the
-- whole mirror exists to answer, over the REAL table: does anybody disagree
-- with their own placements right now?
--
-- It is allowed to be this strict because the mirrors are SYNCHRONOUS — there is
-- no window in which a row is legitimately out of step. If this goes red, a
-- write reached one table and not the other, which is the defect and not a
-- timing artefact. (It went red for 136 people before 0194; that is how the
-- stall was found.)
--
-- ⚠️ IT MUST EXCLUDE THIS PROOF'S OWN FIXTURES, and it did not at first. §C's
-- `curated_person` is SUPPOSED to disagree — the registry keeps its ชื่อเล่น
-- while `nickname_imported` keeps the file's, which is the whole point of that
-- section — so the live assertion counted the very row the proof had just
-- created to prove the opposite, and reported 1 against a clean database. A
-- proof that measures live data has to subtract itself.
-- ⚠️ AND IT MUST SAY WHEN IT CANNOT ASK. samo-dev is a copy taken before the
-- roster existed: it has one student, so these four would compare almost
-- nothing and the control would fail. Skipping silently would be the
-- "green while broken" shape this repo has paid for, so the skip is PRINTED on
-- both sides of the comparison and is visible in the output.
create temporary table has_roster on commit drop as
  select (select count(*) from public.students where kkumail not like 'h0194.%') > 100 as yes;

insert into probe select '60. no person disagrees with their ระบบบ้าน row',
  case when (select yes from has_roster) then '0' else 'ข้าม — ฐานนี้ยังไม่มีรายชื่อ' end,
  case when not (select yes from has_roster) then 'ข้าม — ฐานนี้ยังไม่มีรายชื่อ' else
  (select count(distinct p.id)::text
     from public.people p join public.students s on s.person_id = p.id
    where p.kkumail not like 'h0194.%'
      and (coalesce(p.first_name_th,''), coalesce(p.last_name_th,''),
           coalesce(p.student_id,''), coalesce(p.nickname,''), coalesce(p.photo_url,''))
          is distinct from
          (coalesce(s.first_name_th,''), coalesce(s.last_name_th,''),
           coalesce(s.student_id,''), coalesce(s.nickname,''), coalesce(s.photo_url,''))) end;

insert into probe select '61. no person disagrees with their ทีม SAMO row',
  case when (select yes from has_roster) then '0' else 'ข้าม — ฐานนี้ยังไม่มีรายชื่อ' end,
  case when not (select yes from has_roster) then 'ข้าม — ฐานนี้ยังไม่มีรายชื่อ' else
  (select count(distinct p.id)::text
     from public.people p join public.team_members m on m.person_id = p.id
    where coalesce(p.kkumail,'') not like 'h0194.%'
      and (m.full_name, m.first_name_th, m.last_name_th, m.nickname, m.major,
           m.student_id, m.cohort_year, m.kkumail, m.photo_url)
          is distinct from
          (p.full_name, p.first_name_th, p.last_name_th, p.nickname, p.major,
           p.student_id, p.cohort_year, p.kkumail, p.photo_url)) end;

insert into probe select '62. nobody holds two registry rows on one kkumail', '0',
  (select count(*)::text from (
     select lower(btrim(kkumail)) k from public.people
      where kkumail is not null and kkumail not like 'h0194.%'
      group by 1 having count(*) > 1) x);

insert into probe select '63. no ทีม SAMO row points at a different person than ระบบบ้าน', '0',
  (select count(*)::text from public.team_members m
     join public.students s on lower(btrim(s.kkumail)) = lower(btrim(m.kkumail))
    where m.person_id is distinct from s.person_id
      and s.kkumail not like 'h0194.%');

-- CONTROL for 60-63: the tables are not empty, so a zero above is a real
-- agreement rather than a join that matched nothing. Four proofs of "no rows
-- disagree" over an empty set would be green for ever and mean nothing.
insert into probe select '64. …and it says so when it cannot ask', 'true',
  (select ((select yes from has_roster)
           = ((select count(*) from public.people p
                 join public.students s on s.person_id = p.id
                where p.kkumail not like 'h0194.%') > 100))::text);

select step,
       case when got is not distinct from expected then 'PASS' else 'FAIL' end as result,
       expected, got
  from probe order by step;

rollback;
