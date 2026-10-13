# Running a SAMO-year handover

The runbook for the admin action that starts a new ทีม SAMO year — the
boundary every other system (`samo_year_be` columns) files its history
against. Design: `docs/YEAR-ROLLOVER.md` § The SAMO year. Infra: migration
`0219_one_samo_year_for_every_system.sql`, proof `tools/year0219-samo-year.sql`.

## What "the SAMO year" is, in one paragraph

There is no new year table. `public.team_terms` — already built for ทีม
SAMO's own ปีการศึกษา pane (0104/0105) — IS the registry: `year` (พ.ศ.,
primary key), `is_current` (exactly one row, enforced by a partial unique
index), and since 0219, `started_at`/`ended_at`. "The SAMO year" is a term of
OFFICE (who holds which seat), decided by an explicit admin action — **never**
derived from a calendar. ปีงบ (`projects.fiscal_year_be`, 1 ต.ค.–30 ก.ย.) and
ปีการศึกษา (`study-year.js`, 1 ส.ค.) are separate, real calendars this does
not touch.

## Before you run it

1. **This is a handover, not a re-publish.** `publish_team_term()` (the
   existing "บันทึกเป็นปีที่ผ่านมา" action in จัดการทีม) snapshots the CURRENT
   tree into an archive and may be run any number of times with no handover
   happening — it does not touch `started_at`/`ended_at` and is not what this
   doc is about. Only run a handover when the new team has actually taken
   office.
2. **Edit the live tree to the NEW team first**, then hand over — or hand
   over first and edit after. Either order is fine (grants come from the live
   tree via `sync_my_team_permissions()`, not from `team_terms`), but decide
   which and do not leave the tree half-edited across the boundary; it
   confuses anyone reading `team_members` history later, not the handover
   itself.
3. **Know who is about to lose the admin seat.** Whoever calls
   `start_team_term` keeps whatever `team`/`master` grant they hold — the RPC
   does not touch permissions. If the outgoing VP is the only `team` holder,
   grant the incoming one BEFORE the handover, or nobody can run the next
   one.

## Running it

In จัดการทีม (admin → ทีม SAMO → ปีการศึกษา pane), the "ตั้งเป็นปีปัจจุบัน"
button on any listed term calls `setCurrentTerm(year)`
(`src/js/team/terms.js:300` → `src/js/team/api.js`), which is the RPC below —
there is no separate CLI path, by design, so the UI is always exercised and
never drifts from it.

```sql
select public.start_team_term(2570);  -- the incoming year, พ.ศ.
```

One call does, in one transaction (never observable as two states):

- refuses if the caller holds neither `vp_admin`/`dev` role nor the `team`
  permission (which `master` already satisfies — `current_user_has_permission`
  folds it, 0111; no separate master check needed or wanted)
- refuses with a clear Thai message if `p_year` is already the current term
  (a double-click does nothing, not a silent re-open)
- refuses if `p_year` is outside 2500–2700 (typo guard)
- closes the outgoing term: `is_current = false`, `ended_at = now()`
- opens the incoming term: `is_current = true`, `started_at = now()` (or,
  if this year was PREVIOUSLY current and is being reopened after a mistaken
  rollover, its ORIGINAL `started_at` — never overwritten, so a correction
  stays visible in history rather than erasing it)

If the year has no `team_terms` row yet, `start_team_term` creates one (same
as `createTerm` would, but already marked current). If it does exist
(typically seeded ahead of time via จัดการทีม's "เพิ่มปี" button), it reuses
the row.

## What happens afterward, system by system

Nothing else runs automatically. Each system reads the new current year the
next time it writes a row, because every `samo_year_be` column is stamped by
`samo_year_be_default()` — one BEFORE INSERT trigger body, attached per-table
by the migration that added that system's column (PR: task 3, VS: task 4,
Shop: task 5, หนังสือโครงการ's parallel `samo_year_be`: task 6 — see
`docs/YEAR-ROLLOVER.md` for which task number ships which). Nothing is
reclassified retroactively:

- Tickets/orders opened before the handover KEEP their original year — a
  shop order still `pending` across the boundary stays filed under the team
  that took the money, not the incoming one (see Shop section, design doc).
- `projects.fiscal_year_be` is UNCHANGED by this — it is a different
  government calendar on a different column.
- `passport.samo_years` is a SEPARATE registry in an isolated schema,
  deliberately not folded into this one (cross-schema FKs do not exist in
  this codebase). If Passport also opens a new year around the same time,
  set the bridge column by hand:
  `update passport.samo_years set team_term_year = 2570 where id = <the new passport year>;`
  — loose reference, no FK, same shape as `team_majors`.
- Dashboards default to the CURRENT year and get a "ดูปีก่อน" picker
  (`src/js/samo-year.js`'s `fetchSamoYears()`/`wireSamoYearPicker()`) — the
  SAME list จัดการทีม itself shows (`get_public_team_years()`, 0104), so a
  year never means two different things in two tabs.

## Verifying it worked

```bash
node tools/db-query.mjs <(echo "select year, is_current, started_at, ended_at from public.team_terms order by year desc limit 5;")
```

Exactly one row has `is_current = true`; the outgoing term shows `ended_at`
set and `is_current = false`; the incoming term shows `started_at` set. Then
open จัดการทีม and confirm the badge moved.

## If it goes wrong

- **Ran it for the wrong year by accident**: call it again for the year it
  should have been. The function refuses nothing here except re-selecting
  the SAME year, so correcting a mistake is just another call — the term you
  close now reopens correctly later if needed (its `started_at` is
  preserved, per above).
- **Nobody holds `team`/`master` any more and the call is refused**: grant it
  through `public.users.permissions` directly (`dev` role can always do
  this) — that is the intended escape hatch; `start_team_term` deliberately
  does not accept a role-only override beyond `vp_admin`/`dev`.
- **A backfill needs to know which year a PAST row belongs to**, not just
  "what year is it now": that is `samo_year_for_timestamp(ts)`, not
  `current_samo_year()`. It treats a term with no recorded `started_at` as
  covering "since before this column existed" only when that term is
  current OR was closed without ever recording a start (the one term this
  column first applied to) — never for a future term seeded ahead of time
  and never started. See the migration's own header comment before changing
  this function; it has a documented wrong-first-draft (keying the escape
  hatch on `is_current` alone breaks the SECOND handover ever run).

## Proof

`tools/year0219-samo-year.sql` (register it with `node tools/run-proofs.mjs
year0219` — rolled back, no state left behind) covers: a stranger refused,
the admin's handover closing-and-opening atomically, a same-year re-call
refused, a timestamp exactly on the boundary resolving to the new term, one
microsecond earlier resolving to the old one, an out-of-range year refused,
and a mistaken rollover undone-and-redone keeping its original `started_at`.
Applied to samo-dev only; production gets it when the owner reviews and
applies this branch's migrations (`skills/ship-a-migration.md`).
