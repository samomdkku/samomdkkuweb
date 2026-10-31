-- ============================================================
-- 0269 — a หนังสือโครงการ's Drive folder is filed by ปีงบประมาณ, and the
--        database records WHERE the folder is.
--
-- WHY (owner, 2026-10-31): "the หนังสือโครงการ use different year system, it
-- use ปีงบประมาณ … admin can move หนังสือ to other ปีงบประมาณ manually like if
-- this project is gonna done in 2570 but create in 2569 they'd move it to
-- ปีงบประมาณ 70" — and when they do, the Drive folder moves too (owner's
-- answer, same day). The 46 older flat folders are filed by ปีงบ as well.
--
-- WHAT WAS WRONG. 0223 filed a new โครงการ's folder under its ปี SAMO
-- (`Projects/<samo_year_be>/…`), while every screen of หนังสือโครงการ groups by
-- ปีงบ (src/js/projects/fiscal-year.js). The five โครงการ created after 1 ต.ค.
-- 2569 sat in `Projects/2569/` with ปีงบ 2570.
--
-- ── WHY A COLUMN FOR THE FOLDER, NOT "THE PATH = THE ปีงบ" ────────────────
-- The folder path is recomputed from the row on every upload, rename, QR and
-- delete (0223's header). If the year segment were read from the ปีงบ, then
-- changing the ปีงบ would point every later call at a folder that does not
-- exist (GAS get-or-CREATES it: the files silently split in two) — and the
-- ปีงบ CAN change: by hand (0165), or by correcting created_at (NULL
-- fiscal_year_be means "ask the clock"). So the label and the location are
-- two facts:
--   fiscal_year_be / created_at — which ปีงบ the โครงการ COUNTS in (a label)
--   drive_year_be               — which year folder its files ARE in (a fact
--                                 about Drive, written only after Drive says so)
-- This is not class 6's "fill-once copy of an expression": it never derives
-- anything, it records where a folder was put. When the two disagree the
-- detail page says so and offers the move (projects/inbox.js).
--
-- NULL = the folder is flat, `Projects/<slug>_<id>` (every row before 0223).
--
-- ── EXPAND, THEN CONTRACT ─────────────────────────────────────────────────
-- ADD only. The bundle being served until the deploy reads drive_layout +
-- samo_year_be and never this column; the new bundle reads this column first
-- and falls back to that pair for a row the old bundle creates in the gap
-- (projectDriveYear, data.js). drive_layout stays for that fallback; it can be
-- dropped once nothing reads it. The one-time move of existing folders
-- (tools/projects-file-by-fiscal-year.mjs) runs AFTER the deploy, never before.
-- ============================================================

alter table public.projects
  add column if not exists drive_year_be smallint;

alter table public.projects
  drop constraint if exists projects_drive_year_be_check;
alter table public.projects
  add constraint projects_drive_year_be_check
  check (drive_year_be is null or drive_year_be between 2500 and 2700);

comment on column public.projects.drive_year_be is
  'Which year folder this โครงการ''s Drive files are IN: Projects/<drive_year_be>/'
  '<slug>_<id>/…; NULL = flat, Projects/<slug>_<id>/…. A fact about Drive, '
  'written by the app only AFTER Apps Script moved or created the folder '
  '(moveProjectFolderToYear) — never derived from fiscal_year_be, which is the '
  'LABEL (which ปีงบ it counts in) and may change independently. 0269.';

-- Every row 0223 filed under a year: its folder is where 0223 put it, under
-- samo_year_be. Recording that is what lets the new bundle stop reading
-- samo_year_be for paths; it moves nothing.
update public.projects
   set drive_year_be = samo_year_be
 where drive_layout = 'year'
   and drive_year_be is null
   and samo_year_be is not null;
