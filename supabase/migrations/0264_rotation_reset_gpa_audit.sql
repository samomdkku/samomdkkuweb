-- ============================================================
-- 0264 — แลก Rotation: reset test GPA audit trail count.
--
-- Resets all pre-launch test GPA edit audit records so that
-- students start with a clean slate of 0/3 edits while preserving
-- their current saved GPAs in public.rotation_students.
-- ============================================================

truncate table public.rotation_gpa_audit restart identity;
