-- ============================================================
-- house-claim-flow-manual-seed.sql — one obviously-fake held seat, so a human
-- can watch the ยืนยันตัวตน (self-claim) flow succeed in a REAL signed-in
-- browser, without touching a real student's row.
--
-- WHY THIS EXISTS. docs/HOUSE-YEAR-HANDOVER.md § วิธีทดสอบ walks through every
-- outcome `claim_my_student_seat` can answer. Five of them are already proven
-- by tools/house0191-help-requests.sql (role-impersonation inside a ROLLED-BACK
-- transaction) and by src/js/house/api.test.js (the wrapper contract, no DB at
-- all) — but neither of those puts anything in front of a real browser. This
-- script's only job is the one thing that needs one: a held row that a REAL
-- Google-signed-in @kkumail.com account can actually type into the form and
-- watch turn into a card.
--
-- ⛔ RUN THIS AGAINST samo-dev, NEVER PRODUCTION:
--
--     VITE_SUPABASE_URL=$SUPABASE_DEV_URL node tools/db-query.mjs \
--       tools/house-claim-flow-manual-seed.sql
--
-- Check the "→ project: … (samo-dev)" line it prints to stderr BEFORE trusting
-- the result — this is the exact mistake docs/mistakes/tooling-proofs.md's
-- npm-run-flag-trap entry is named for.
--
-- It COMMITS (there is nothing here for a live UI to see if it rolled back).
-- Run tools/house-claim-flow-manual-cleanup.sql when done — the ONE-open-row
-- rate limit on house_help_requests means a leftover fake row does not hurt
-- anything, but the fake seat should not linger where a real import could
-- someday collide with its student_id.
-- ============================================================
begin;

-- An obviously-fake สาย, sitting well outside the real 001-3xx range this
-- repo's own fixtures use (gaps.test.js, house0191's proof) so nobody mistakes
-- it for a real advisor's assignment.
insert into public.sais (code) values ('999') on conflict (code) do nothing;

with b as (
  insert into public.student_import_batches (file_name, row_count)
  values ('MANUAL-TEST-DO-NOT-KEEP.csv', 1)
  returning id
)
insert into public.student_import_unresolved
  (batch_id, student_id, first_name_th, last_name_th, major, sai_code, cohort_year, reason)
select b.id, '000000001-1', 'ทดสอบ', 'ระบบบ้าน', 'MD', '999', 2565, 'no_kkumail'
  from b;

commit;

-- What to type into the form at /  (บ้านของฉัน card, "ยังไม่มีข้อมูลของคุณ" empty
-- state) once signed in with a @kkumail.com account that has NO students row
-- yet (any spare kkumail account works — it does not need to belong to a real
-- MDKKU student, only to pass the domain check):
--
--   รหัสนักศึกษา:  000000001-1     (or 0000000011 — the dash is optional)
--   ชื่อจริง:      ทดสอบ
--
-- Expected: "พบข้อมูลของคุณแล้ว กำลังโหลด…" then a real การ์ด showing สาย 999,
-- house = last digit of 999 = 9, รุ่น "MD50" (cohort_year 2565 is the same
-- value gaps.test.js's fixtures use — chosen so the label computes normally,
-- not because it means anything). Typing "ทดสอบด" (wrong ชื่อ) or
-- "000000002-2" (wrong รหัส) first must both answer the SAME neutral sentence
-- (ยังไม่พบรายชื่อ...) before you try the real values — that sameness IS the
-- anti-enumeration property 0191 exists to keep; see § วิธีทดสอบ, outcome 2.
