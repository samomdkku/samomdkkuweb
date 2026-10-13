-- ============================================================
-- 0220 — PR tickets get a SAMO year (night agent, task 3 of the 2026-10-14
-- queue). Design: docs/YEAR-ROLLOVER.md § PR. Core infra: 0219.
--
-- THE OWNER'S OWN EXAMPLE. PR Staff Dashboard shows all 311 pr_tickets in one
-- kanban, 290 of them already โพสต์เรียบร้อย (เสร็จสิ้น) — "the next samoyear
-- the new worker ... it'll be a mess". This column + backfill is what lets the
-- dashboard default to the CURRENT year and hide that pile without deleting it.
--
-- WHY A STORED COLUMN, STAMPED AT INSERT, NEVER RECOMPUTED — mirrors
-- projects.fiscal_year_be's existing shape (0165), restated here because an
-- unresolvable-reference failure here would be worse than most: pr_tickets
-- is the table 0219's own header names as the reason current_samo_year() had
-- to be SECURITY DEFINER (pr_tickets_insert_anyone lets an ANONYMOUS guest
-- insert). An invoker-rights read at INSERT time would see zero team_terms
-- rows under RLS and silently stamp NULL on every anonymous PR submission —
-- the exact class-2 failure 0219 already closed for this precise case.
--
-- WHY THE BACKFILL READS `timestamp`, NOT `created_at` — pr-staff.js's own
-- fetch comment already explains why: "`created_at` can default to
-- migration-time for legacy rows, putting them in an arbitrary order". Every
-- live submission AND the original Sheets-to-Supabase migration both set
-- `timestamp` to the real submission instant; `created_at` is the row's birth
-- in THIS database, which for pre-Supabase tickets is migration day, not the
-- day a ฝ่าย actually asked for the post. Deriving the SAMO year from the
-- wrong column would misfile every one of those legacy tickets.
--
-- WHY NO RLS CHANGE. docs/YEAR-ROLLOVER.md is explicit: "a FILTER, never an
-- access boundary". A submitter's own-row read, and pr_staff/dev's see-all
-- (current_user_can_manage_pr(), 0168), are both year-independent — a PR
-- officer must keep reading last year's tickets for continuity, and a guest
-- tracking their own ticket must not lose access to it the day the team
-- changes. Only the UI (pr-staff.js) locks editing on a past-year VIEW, with
-- an explicit override — that is a workflow nudge, not a security rule, so it
-- does not belong in a migration.
-- ============================================================

-- ---------------------------------------------------------------------------
-- 1. pr_tickets.samo_year_be — ADD only, nullable, admin-overridable (same
--    shape as projects.fiscal_year_be).
-- ---------------------------------------------------------------------------
alter table public.pr_tickets
  add column if not exists samo_year_be smallint;

comment on column public.pr_tickets.samo_year_be is
  'Which SAMO year (team_terms.year, พ.ศ.) this ticket was filed under. '
  'Stamped ONCE at INSERT by pr_tickets_samo_year_default — never recomputed '
  'on an update, so correcting a submission later cannot silently relabel '
  'it. A staff PATCH may set this explicitly (pr_tickets_update_staff, 0168) '
  'for the rare "filed under the wrong year" correction. NULL only for a row '
  'the one-time backfill below could not resolve (should not happen for any '
  'row that existed before this migration ran).';

create index if not exists pr_tickets_samo_year_idx
  on public.pr_tickets (samo_year_be);

-- ---------------------------------------------------------------------------
-- 2. The trigger — INSERT only. Reuses 0219's one shared trigger body so the
--    stamping rule has ONE implementation across PR/VS/Shop/หนังสือโครงการ.
-- ---------------------------------------------------------------------------
drop trigger if exists pr_tickets_samo_year_default on public.pr_tickets;
create trigger pr_tickets_samo_year_default
  before insert on public.pr_tickets
  for each row execute function public.samo_year_be_default();

-- ---------------------------------------------------------------------------
-- 3. ONE-TIME backfill. Every row today has samo_year_be = NULL because the
--    column did not exist until this migration — nobody has chosen a year
--    for any of them, so deriving one from `timestamp` overwrites no human
--    decision (the same exception docs/YEAR-ROLLOVER.md grants projects'
--    42 pre-existing rows, for the identical reason).
--
--    A row this cannot resolve (samo_year_for_timestamp returns NULL — would
--    mean a timestamp older than every team_terms row, including the
--    genesis one's permanent -infinity floor fixed by 0219's own post-review
--    patch) is left NULL rather than guessed at; the dashboard's "all" view
--    and the CSV export both still show it, just outside any single year.
-- ---------------------------------------------------------------------------
update public.pr_tickets
   set samo_year_be = public.samo_year_for_timestamp(coalesce("timestamp", created_at))
 where samo_year_be is null;
