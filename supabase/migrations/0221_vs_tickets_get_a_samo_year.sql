-- ============================================================
-- 0221 — VitalSound tickets get a SAMO year (night agent, task 6 of the
-- 2026-10-14 queue). Design: docs/YEAR-ROLLOVER.md § VitalSound. Core infra:
-- 0219. Export/deletion gate: 0222 (task 5).
--
-- SAME STORED-AT-INSERT SHAPE AS pr_tickets.samo_year_be (0220) — one trigger
-- body (samo_year_be_default, 0219), one backfill rule (samo_year_for_timestamp
-- over the real `timestamp` column, which already exists on vs_tickets exactly
-- like pr_tickets, NOT `created_at`, for the identical reason 0220's header
-- gives: `created_at` on a pre-Supabase row is migration day, not the day the
-- report actually came in).
--
-- WHY NO PAST-YEAR EDIT LOCK, UNLIKE PR (0220). docs/YEAR-ROLLOVER.md § VS is
-- explicit that the year column is "a FILTER, never an access boundary" and
-- names NO read-only-by-default UI rule the way the PR section does — on the
-- contrary it says a dept handler must keep reading "their own dept's history
-- across years… because the PDPA notice's access list already covers
-- continuity of service". A hard "แก้ไขของปีก่อน" lock would actively work
-- against the one case this section calls out by name: a duplicate filed THIS
-- year merging into a canonical ticket FILED LAST YEAR (edge case 14) routinely
-- needs to write the canonical row — e.g. mirroring progress, or re-opening it
-- — regardless of which SAMO year it happens to be filed under. PR tickets do
-- not have this merge relationship, which is why that lock made sense there
-- and does not make sense here.
--
-- "OPEN TICKETS CARRY OVER": the filter facet this ships (vs-staff.js) hides a
-- CLOSED ticket (resolution is not null) from a year other than the one
-- selected, but a ticket that is still OPEN (resolution is still null — the
-- dept has not finished with it) is never hidden by the year facet, in ANY
-- year view. A new team taking office must see every inherited unresolved
-- complaint by default, not just this year's; only the "done and crowding
-- the view" pile PR's 290-ticket complaint was about gets the opt-in
-- decluttering. This rule lives in src/js/vs-year.js (ticketMatchesYearFilter)
-- — NOT in SQL — because, same as PR, it is a workflow nudge over data RLS
-- already returns in full; the database keeps answering every year for every
-- row regardless of status.
--
-- PDPA RETENTION — SHAPE FROM THE DESIGN DOC, NUMBER INVENTED AND NAMED AS SUCH.
-- `vs_scrub_closed_tickets()` below is the FUNCTION § VitalSound asked task 6
-- to ship; it is NEVER called by this migration and nothing schedules it yet
-- (task 11's job, same as every other prune function in this design). It
-- anonymises exactly the two free-text columns the consent notice's own
-- promise of anonymity does NOT already cover — `problem` (what the student
-- typed) and `resolution_note` (what staff typed back, submitter-visible,
-- 0073) — and leaves every structured column (category, resolution, status,
-- target_dept, phase-relevant dates) untouched, because trend analysis over
-- those is the notice's OWN stated purpose #3 ("พัฒนาและปรับปรุงการดำเนินงาน")
-- and a full delete would destroy it for nothing gained.
--
-- NOT SCRUBBED, FLAGGED RATHER THAN SILENTLY LEFT OUT: `remarks` (the internal
-- timeline jsonb) can also carry a staff-typed reference to a name, same as
-- the one-uid-in-JSON lesson docs/mistakes/postgres-schema.md already named
-- for a different table. Scrubbing a jsonb ARRAY safely — keeping each
-- entry's `by`/time shape while blanking only free text — is a bigger,
-- separate piece of work than one migration's remaining budget affords
-- tonight; shipping a partial scrub that silently claims "handled" would be
-- worse than naming the gap. The public board NEVER reads `problem` or
-- `resolution_note` (it reads the curated `public_title`/`public_note`
-- columns SE writes specifically for it, 0072) or `remarks` — so this
-- function changes nothing the public board shows, matching the design doc's
-- own "the public board's content stays".
--
-- WHY A YEAR PARAMETER, NOT A DATE CUTOFF. The gate this must open —
-- year_export_recorded(system, year) (0222) — is keyed by (system, year), so
-- the scrub itself is naturally "once THIS year's export is on record, you may
-- scrub closed THIS-year tickets old enough". `p_months` stays a parameter
-- (default 24, the design doc's own invented-and-labelled default) so the
-- owner can tighten or loosen it later with no new migration, per § Deletion.
-- ============================================================

-- ---------------------------------------------------------------------------
-- 1. vs_tickets.samo_year_be — ADD only, nullable, staff-overridable (same
--    shape as pr_tickets.samo_year_be, 0220).
-- ---------------------------------------------------------------------------
alter table public.vs_tickets
  add column if not exists samo_year_be smallint;

comment on column public.vs_tickets.samo_year_be is
  'Which SAMO year (team_terms.year, พ.ศ.) this ticket was FILED under. '
  'Stamped ONCE at INSERT by vs_tickets_samo_year_default — never recomputed '
  'on an update. A staff UPDATE may correct it explicitly (same '
  'vs_tickets_update_staff policy that already governs every other column). '
  'A FILTER only — never an access boundary; RLS (0082) is unchanged by this '
  'column. Not to be confused with vs_tickets.year (a student''s own ชั้นปี, '
  'unrelated — see tools/year-export.mjs''s registry comment for the same '
  'warning).';

create index if not exists vs_tickets_samo_year_idx
  on public.vs_tickets (samo_year_be);

-- ---------------------------------------------------------------------------
-- 2. The trigger — INSERT only, the SAME shared body 0220 attaches to
--    pr_tickets (0219's samo_year_be_default()).
-- ---------------------------------------------------------------------------
drop trigger if exists vs_tickets_samo_year_default on public.vs_tickets;
create trigger vs_tickets_samo_year_default
  before insert on public.vs_tickets
  for each row execute function public.samo_year_be_default();

-- ---------------------------------------------------------------------------
-- 3. ONE-TIME backfill — every existing row has samo_year_be = NULL because
--    the column did not exist until this migration ran, so deriving one from
--    `timestamp` overwrites no human decision (same exception 0220 grants
--    PR's 311 pre-existing rows, and docs/YEAR-ROLLOVER.md grants
--    หนังสือโครงการ's 42 — identical reasoning, restated per system on
--    purpose rather than left to be assumed).
-- ---------------------------------------------------------------------------
update public.vs_tickets
   set samo_year_be = public.samo_year_for_timestamp(coalesce("timestamp", created_at))
 where samo_year_be is null;

-- ---------------------------------------------------------------------------
-- 4. vs_tickets.anonymized_at — idempotency marker for the PDPA scrub below.
--    NULL = never scrubbed. Set once, by the scrub function only; nothing
--    else writes it (no staff UI control exists for this column on purpose —
--    un-scrubbing is not a thing; a human who needs the original text back
--    uses the pre-scrub EXPORT, per docs/YEAR-ROLLOVER.md § Export).
-- ---------------------------------------------------------------------------
alter table public.vs_tickets
  add column if not exists anonymized_at timestamptz;

comment on column public.vs_tickets.anonymized_at is
  'Set once by vs_scrub_closed_tickets() when problem/resolution_note were '
  'overwritten with a PDPA placeholder. NULL = original text still present. '
  'Nothing un-sets this — recovery is the pre-scrub export, never a restore '
  'of this column.';

-- ---------------------------------------------------------------------------
-- 5. vs_scrub_closed_tickets(year, months) — the PDPA anonymiser. FUNCTION
--    ONLY: nothing calls this yet (task 11 schedules prune jobs; this one is
--    deliberately left unscheduled here, same as 0222's own export gate was
--    left unscheduled by task 5).
--
--    Fails CLOSED on three independent axes, each raising a DIFFERENT
--    message so a caller (and this migration's own proof) can tell WHICH
--    gate refused:
--      a. permission  — data_admin or dev only (0222's own permission shape)
--      b. the export gate — year_export_recorded('vs_tickets', p_year) (0222)
--      c. bad input — p_year/p_months null or out of range
--
--    Only touches a row that is: filed under p_year, CLOSED (resolution is
--    not null — the column 0073 sets only when staff close a ticket; a
--    ticket merely sitting in the "เสร็จสิ้น" kanban column with no
--    resolution recorded yet — should not happen per 0073's own UI gate, but
--    is treated as "not yet decided" rather than guessed at, same
--    unresolvable-reference-fails-closed rule as every other gate here),
--    old enough (updated_at — the only "last touched" signal vs_tickets has,
--    see the column comment below for why this is a CONSERVATIVE proxy, not
--    an exact "closed_at"), and not already scrubbed.
-- ---------------------------------------------------------------------------
create or replace function public.vs_scrub_closed_tickets(
  p_year integer, p_months integer default 24
) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_count integer;
begin
  if not coalesce(
       public.current_user_has_permission('data_admin')
       or public.current_user_role() = 'dev', false) then
    raise exception 'vs_scrub_closed_tickets: ไม่มีสิทธิ์';
  end if;

  if p_year is null or p_year < 2500 or p_year > 2700 then
    raise exception 'vs_scrub_closed_tickets: bad year %', p_year;
  end if;
  if p_months is null or p_months < 1 then
    raise exception 'vs_scrub_closed_tickets: bad months %', p_months;
  end if;

  if not public.year_export_recorded('vs_tickets', p_year) then
    raise exception 'vs_scrub_closed_tickets: ปี % ยังไม่มีการส่งออกข้อมูล (year_export_log) — export ก่อนลบ/ลบข้อมูลเสมอ', p_year;
  end if;

  update public.vs_tickets
     set problem = '[ข้อมูลถูกลบตามนโยบาย PDPA]',
         resolution_note = case when resolution_note is not null
                                 then '[ข้อมูลถูกลบตามนโยบาย PDPA]' else null end,
         anonymized_at = now()
   where samo_year_be = p_year
     and resolution is not null
     and anonymized_at is null
     and updated_at < now() - (p_months || ' months')::interval;
  get diagnostics v_count = row_count;

  return v_count;
end;
$$;

comment on function public.vs_scrub_closed_tickets(integer, integer) is
  'PDPA text anonymisation (docs/YEAR-ROLLOVER.md § VitalSound): overwrites '
  'problem/resolution_note on CLOSED tickets (resolution is not null) filed '
  'under p_year, untouched for at least p_months (default 24, an invented '
  'default — tighten/loosen freely, no migration needed). Refuses unless the '
  'caller holds data_admin or role=dev, AND year_export_recorded(''vs_tickets'', '
  'p_year) is true (0222) — export before scrub, always. Never deletes the '
  'row; never touches category/resolution/status/target_dept (trend data) or '
  'public_title/public_note (0072, the public board never reads problem/'
  'resolution_note so this changes nothing the board shows) or remarks (NOT '
  'scrubbed — flagged in this migration''s header as a known, deliberate gap, '
  'not silently handled). Idempotent via anonymized_at. FUNCTION ONLY — '
  'nothing schedules this call yet (task 11''s job).';

comment on column public.vs_tickets.updated_at is
  'Last modification (any UPDATE, via touch_updated_at trigger, 0077). '
  'vs_scrub_closed_tickets() uses this as a CONSERVATIVE proxy for "time since '
  'closed" — there is no separate resolved_at/closed_at column. Any later '
  'touch (e.g. a staff correction after close) pushes the scrub window out '
  'further, never in — the function can scrub LATER than exactly p_months '
  'after resolution was set, never earlier, which is the privacy-safe '
  'direction to be wrong in.';

revoke all on function public.vs_scrub_closed_tickets(integer, integer) from public;
revoke all on function public.vs_scrub_closed_tickets(integer, integer) from anon;
grant execute on function public.vs_scrub_closed_tickets(integer, integer) to authenticated;
