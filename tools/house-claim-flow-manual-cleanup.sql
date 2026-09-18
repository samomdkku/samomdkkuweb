-- ============================================================
-- house-claim-flow-manual-cleanup.sql — undo house-claim-flow-manual-seed.sql.
--
-- Run this once the live-session steps in docs/HOUSE-YEAR-HANDOVER.md
-- § วิธีทดสอบ are done — whether the claim was left unclaimed, claimed
-- successfully, or claimed and then reported "ไม่ใช่ข้อมูลของฉัน". Every branch
-- is identified by the fake รหัส prefix (`000000%`) or the fake batch's
-- file_name, never by which kkumail account happened to test it, since that
-- account is whatever spare @kkumail.com the tester had on hand and this
-- script has no way to know it.
--
-- ⛔ SAME RULE AS THE SEED SCRIPT — samo-dev only:
--
--     VITE_SUPABASE_URL=$SUPABASE_DEV_URL node tools/db-query.mjs \
--       tools/house-claim-flow-manual-cleanup.sql
-- ============================================================
begin;

-- If the claim succeeded, the fake seat is now a real `students` row —
-- reverse that first or the DELETE below (which targets the batch's held row)
-- finds nothing.
delete from public.students where student_id = '000000001-1';

-- Whatever the test typed as a miss along the way (right or wrong รหัส/ชื่อ) —
-- identified by the fake prefix a real รหัสนักศึกษา can never start with.
delete from public.house_help_requests where typed_student_id like '000000%';

-- The held row, if the claim was never completed.
delete from public.student_import_unresolved
 where batch_id in (select id from public.student_import_batches
                      where file_name = 'MANUAL-TEST-DO-NOT-KEEP.csv');

delete from public.student_import_batches where file_name = 'MANUAL-TEST-DO-NOT-KEEP.csv';

-- The fake สาย, only if nothing else still references it (a real สาย 999 is
-- not expected to exist, but check rather than assume).
delete from public.sais s
 where s.code = '999'
   and not exists (select 1 from public.students where sai_code = '999')
   and not exists (select 1 from public.student_import_unresolved where sai_code = '999');

commit;

select 'cleaned up — re-run the seed script to test again' as done;
