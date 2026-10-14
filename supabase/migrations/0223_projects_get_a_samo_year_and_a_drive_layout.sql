-- ============================================================
-- 0223 — หนังสือโครงการ gets a SAMO year, and new โครงการ get a per-year
-- Drive layout (night agent, task 7
-- of the 2026-10-14 queue). Design: docs/YEAR-ROLLOVER.md § หนังสือโครงการ.
-- Core infra: 0219. Export registry already expects this column:
-- tools/year-export.mjs's `projects` entry has read `yearColumn:
-- 'samo_year_be'` since task 5 (0222), ahead of this migration shipping it.
--
-- TWO INDEPENDENT CHANGES (a third was REMOVED in review — see below):
--   1. projects.samo_year_be      — same insert-time-stamped column as
--                                    pr_tickets (0220) / vs_tickets (0221).
--   3. projects.drive_layout      — a new, EXPLICIT marker so a per-year
--                                    Drive folder (appscript/prform.gs) can
--                                    ship WITHOUT silently relocating the 42
--                                    projects' real, already-shared Drive
--                                    folders out from under them.
--
-- ------------------------------------------------------------------------
-- WHY (1) IS SEPARATE FROM (2), RESTATED FROM THE DESIGN DOC NOT RE-ARGUED.
-- ปีงบประมาณ (fiscal_year_be) is the university's own budget-year
-- convention, read by a real office outside SAMO; samo_year_be is "which
-- ทีม SAMO term sent this", used only by tools/year-export.mjs's "what did
-- last year's VP send" grouping. 11 projects already carry an explicit
-- fiscal_year_be = 2570 — a human's correction for the REAL ปีงบ reason —
-- and conflating the two columns would silently corrupt a value a
-- university officer already reads. They stay two columns, stamped by two
-- different mechanisms (one a trigger, one a one-time UPDATE), forever.
--
-- ⛔ NO fiscal_year_be BACKFILL (removed in the owner-session review,
-- 2026-10-14). The night agent's draft filled the 36 NULL rows with the value
-- deriveFiscalYearBE() computes for them. That contradicts the design
-- src/js/projects/fiscal-year.js states in its own header: NULL MEANS "ASK THE
-- CLOCK", so correcting a โครงการ's created_at still re-derives its ปีงบ; a
-- column filled once from an expression stops tracking it for ever (0128,
-- cohort_year — mistakes class 6, "fill-once means never-correct"). It also
-- bought nothing: every displayed ปีงบ was already right. The 36 NULLs are
-- the CORRECT state, not a gap.
--
-- WHY (3) IS A NEW EXPLICIT COLUMN, NOT A SILENT PATH CHANGE. The task
-- brief asks for "Drive folders per year via appscript". The obvious move —
-- make buildProjectFolderPath()/buildDocFolderPath() always prefix
-- `Projects/<samo_year_be>/...` — would be WRONG the instant it shipped,
-- because unlike pr_tickets (an immutable row, folder built once at
-- submission) a โครงการ's folder path is RECOMPUTED FROM SCRATCH on every
-- rename, delete and QR-folder-info call (src/js/projects/inbox.js's
-- onRenameProject/onDeleteProject, qr.js) — there is no "find the folder
-- GAS already resolved"; `walkProjectsPathByCode_` matches by project CODE
-- under whatever parent the caller's path says. Prefixing a year onto all
-- 42 EXISTING projects' paths would have every rename/delete/QR call start
-- looking in a folder that does not exist (`Projects/2569/<slug>_<id>`)
-- instead of the real one (`Projects/<slug>_<id>`) that already holds their
-- files — a correct-looking code change that breaks every live โครงการ's
-- Drive link the next time anyone touches one, invisible until then. A
-- `drive_layout` marker, 'flat' for every row that exists TODAY and 'year'
-- for every row created from now on, lets the JS builder ask the project
-- itself which shape its real folder uses, instead of assuming. No mover
-- tool, unlike PR's `pr-organize-drive-by-year.mjs`: the design here is
-- "legacy projects stay flat forever", not "catch every project up to the
-- new layout" — PR needed a mover because the SAME flat `PR/` folder kept
-- growing after the column shipped; a โครงการ's folder is created once and
-- never written to by anything else, so leaving it flat costs nothing.
-- ============================================================

-- ---------------------------------------------------------------------------
-- 1. projects.samo_year_be — ADD only, nullable, admin-overridable. Same
--    trigger body (0219) and same backfill shape (0220/0221) as every other
--    system in this queue.
-- ---------------------------------------------------------------------------
alter table public.projects
  add column if not exists samo_year_be smallint;

comment on column public.projects.samo_year_be is
  'Which SAMO year (team_terms.year, พ.ศ.) this โครงการ was SENT under — '
  '"ทีม SAMO sent this", never the university-facing ปีงบ (see '
  'fiscal_year_be, a SEPARATE column). Stamped ONCE at INSERT by '
  'projects_samo_year_default — never recomputed on update. May be '
  'corrected explicitly by the same projects_update policy that already '
  'governs every other column (current_user_is_project_actor()). Read by '
  'tools/year-export.mjs''s projects registry entry.';

create index if not exists projects_samo_year_idx
  on public.projects (samo_year_be);

drop trigger if exists projects_samo_year_default on public.projects;
create trigger projects_samo_year_default
  before insert on public.projects
  for each row execute function public.samo_year_be_default();

update public.projects
   set samo_year_be = public.samo_year_for_timestamp(created_at)
 where samo_year_be is null;

-- ---------------------------------------------------------------------------
-- 3. projects.drive_layout — which Drive folder SHAPE this โครงการ's files
--    actually live under. 'flat' = `Projects/<slug>_<id>/...` (every row
--    that exists today — their real folders already live there and are
--    NEVER moved by this migration). 'year' = `Projects/<samo_year_be>/
--    <slug>_<id>/...` — set EXPLICITLY by the new bundle's createProject().
--
--    ⛔ THE DEFAULT STAYS 'flat' (owner-session review, 2026-10-14). The
--    night agent's draft flipped the default to 'year' here, at APPLY time.
--    But production keeps serving the OLD bundle until the deploy, and the old
--    bundle builds every folder flat — so every โครงการ created in that gap
--    would be LABELLED 'year' while its real folder is flat, and once the new
--    bundle is served its rename/delete/QR would look in a folder that does
--    not exist. A column default is decided by the schema; which folder a row
--    really has is decided by the CODE that created it — so the code says it.
--    The old bundle never sends the column and keeps getting 'flat', which is
--    true for it.
-- ---------------------------------------------------------------------------
alter table public.projects
  add column if not exists drive_layout text not null default 'flat';

alter table public.projects
  drop constraint if exists projects_drive_layout_check;
alter table public.projects
  add constraint projects_drive_layout_check
  check (drive_layout in ('flat', 'year'));

-- Explicit, so re-applying this file over the night agent's draft (which set
-- 'year') puts the default back.
alter table public.projects
  alter column drive_layout set default 'flat';

comment on column public.projects.drive_layout is
  '''flat'' (every row as of migration 0223): the real Drive folder is '
  'Projects/<slug>_<id>/... — NEVER relocated by this column''s existence. '
  '''year'' (set explicitly by createProject in the bundle that shipped with '
  '0223): the real Drive folder is '
  'Projects/<samo_year_be>/<slug>_<id>/... — see appscript/prform.gs''s '
  'walkProjectsPathByCode_ (accepts an optional leading year segment, '
  'exact-matched not code-matched) and src/js/projects/data.js''s '
  'buildProjectFolderPath/buildDocFolderPath (take the year only when this '
  'column says ''year''). GAS change WRITTEN, NOT DEPLOYED — needs '
  'npm run deploy:gas (skills/deploy-gas.md) before any new upload actually '
  'lands in a year subfolder.';
