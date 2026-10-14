-- ============================================================
-- 0223 — หนังสือโครงการ gets a SAMO year, its 36 NULL ปีงบ rows get a real
-- value, and new โครงการ get a per-year Drive layout (night agent, task 7
-- of the 2026-10-14 queue). Design: docs/YEAR-ROLLOVER.md § หนังสือโครงการ.
-- Core infra: 0219. Export registry already expects this column:
-- tools/year-export.mjs's `projects` entry has read `yearColumn:
-- 'samo_year_be'` since task 5 (0222), ahead of this migration shipping it.
--
-- THREE INDEPENDENT CHANGES, each explained separately below because each
-- rests on a different piece of evidence:
--   1. projects.samo_year_be      — same insert-time-stamped column as
--                                    pr_tickets (0220) / vs_tickets (0221).
--   2. projects.fiscal_year_be    — a ONE-TIME backfill of the 36 NULL rows.
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
-- WHY (2) DEVIATES FROM 0165's OWN STATED RULE, ON PURPOSE, NAMED HERE SO A
-- FUTURE READER DOES NOT TREAT IT AS A REGRESSION. 0165's header says
-- "Nothing backfills this column; a row only gets a number when someone
-- sets one" — true, and still the right default for any row a human might
-- later disagree with. This migration backfills the 36 rows that have
-- NEVER had anyone set an opinion, with the EXACT value
-- `projectFiscalYear()` already derives for them at read time
-- (src/js/projects/fiscal-year.js's `deriveFiscalYearBE`) — so no displayed
-- year changes for a single row, and `isFiscalYearMoved()` — which compares
-- the stored override against a fresh derivation from `created_at` — stays
-- false for every one of them (override now EQUALS the derivation, so no
-- row gets a spurious "ย้ายแล้ว" badge it never earned). This is the same
-- exception 0220/0221 already took for samo_year_be and docs/YEAR-ROLLOVER.md
-- names for fiscal_year_be by name ("there is no stored human decision a
-- backfill would overwrite"); 0165's rule protects a CHOICE, and a NULL row
-- has never had one. The arithmetic is inlined once, HERE, as a one-time
-- UPDATE rather than a reusable function — turning it into a permanent SQL
-- function would be a SECOND, ongoing implementation of
-- `deriveFiscalYearBE` (mistakes class 6); a one-shot UPDATE statement dies
-- with this migration file, leaving exactly one living implementation (the
-- JS one) going forward. The expression is converted to 'Asia/Bangkok'
-- first — deriveFiscalYearBE's own comment says the rule is defined on
-- "the viewer's local calendar (the audience is in ICT)", and a UTC
-- timestamptz read directly would misclassify any created_at that falls in
-- the ~7-hour gap around midnight ICT.
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
-- 2. projects.fiscal_year_be — ONE-TIME backfill of the 36 rows nobody has
--    ever set an opinion on, using the EXACT rule src/js/projects/
--    fiscal-year.js's deriveFiscalYearBE already applies at read time
--    (1 ต.ค.–30 ก.ย., named for the year it ENDS in; ต.ค.–ธ.ค. -> next พ.ศ.),
--    evaluated in Asia/Bangkok local time to match "the viewer's local
--    calendar" the JS function's own comment names. The 11 rows that
--    already carry a human's override are UNTOUCHED (`where fiscal_year_be
--    is null`) — this can never overwrite a decision someone already made.
-- ---------------------------------------------------------------------------
update public.projects
   set fiscal_year_be = (
         extract(year from (created_at at time zone 'Asia/Bangkok'))::int + 543
         + case when extract(month from (created_at at time zone 'Asia/Bangkok'))::int >= 10
                then 1 else 0 end
       )
 where fiscal_year_be is null;

-- ---------------------------------------------------------------------------
-- 3. projects.drive_layout — which Drive folder SHAPE this โครงการ's files
--    actually live under. 'flat' = `Projects/<slug>_<id>/...` (every row
--    that exists today — their real folders already live there and are
--    NEVER moved by this migration). 'year' = `Projects/<samo_year_be>/
--    <slug>_<id>/...` (every row created from now on). The two-step ADD
--    then ALTER DEFAULT is deliberate: it back-fills every existing row to
--    'flat' as a literal value at the moment the column appears (matching
--    their real, unmoved folders), then flips the DEFAULT so every future
--    INSERT gets 'year' with no trigger needed — a plain column default is
--    enough because, unlike samo_year_be, nothing here ever needs to read
--    "what year is current RIGHT NOW" at insert time.
-- ---------------------------------------------------------------------------
alter table public.projects
  add column if not exists drive_layout text not null default 'flat';

alter table public.projects
  drop constraint if exists projects_drive_layout_check;
alter table public.projects
  add constraint projects_drive_layout_check
  check (drive_layout in ('flat', 'year'));

alter table public.projects
  alter column drive_layout set default 'year';

comment on column public.projects.drive_layout is
  '''flat'' (every row as of migration 0223): the real Drive folder is '
  'Projects/<slug>_<id>/... — NEVER relocated by this column''s existence. '
  '''year'' (every row created after 0223): the real Drive folder is '
  'Projects/<samo_year_be>/<slug>_<id>/... — see appscript/prform.gs''s '
  'walkProjectsPathByCode_ (accepts an optional leading year segment, '
  'exact-matched not code-matched) and src/js/projects/data.js''s '
  'buildProjectFolderPath/buildDocFolderPath (take the year only when this '
  'column says ''year''). GAS change WRITTEN, NOT DEPLOYED — needs '
  'npm run deploy:gas (skills/deploy-gas.md) before any new upload actually '
  'lands in a year subfolder.';
