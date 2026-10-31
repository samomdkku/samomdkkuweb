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
   existing "เผยแพร่ปีนี้/เผยแพร่ซ้ำ" action in จัดการทีม) snapshots the CURRENT
   tree into an archive and may be run any number of times with no handover
   happening — it does not touch `started_at`/`ended_at` and is not what this
   doc is about. Only run a handover when the new team has actually taken
   office.
2. ⛔ **ORDER: PUBLISH → EDIT → SWITCH.** (Owner-session review 2026-10-14;
   this replaces the agent's "switch first, edit after".)
   1. **เผยแพร่ปีนี้** on the outgoing year. A PUBLISHED year — even the
      current one — is shown publicly from its ARCHIVE
      (`get_public_team_chart`, 0153), so from here on the public page keeps
      the outgoing team no matter what happens to the live tree.
   2. **Edit the live tree** (จัดการทีม) into the incoming team. ⚠️ Grants
      follow the live tree, so a person removed now loses their access NOW —
      add the incoming people first and remove the outgoing ones on the
      handover day if the old team still has work to finish. ⛔ The pane
      now shows "ผังสดเปลี่ยนแล้ว" on the current year — do NOT press
      "เผยแพร่ซ้ำ" here: a re-publish deletes and rebuilds the archive, so the
      outgoing year's history would become the new team (the dialog says so).
   3. **ตั้งเป็นปีปัจจุบัน** on the new year on handover day. The outgoing
      archive is NOT re-snapshotted (0224 only archives a year that was never
      published), the public page now shows the live tree as the new year,
      and every new PR/VS/โครงการ is stamped with it.
   Switching FIRST is the worse order: the new year is unpublished, so the
   public page labels the half-edited live tree as the new team for the whole
   edit. Forgetting step 1 is covered — the switch auto-archives an
   unpublished outgoing year — but then the archive is whatever the tree
   holds at that moment, which is the new team if step 2 already happened.
   **Showing the new team BEFORE the switch (0270)** — no live-tree edit
   needed: ทีม SAMO → ทีมแต่ละปี → เพิ่มปี (e.g. 2570, "คัดลอกผังตอนนี้" or
   "เริ่มจากว่าง") → จัดรายชื่อ → แสดงบนหน้าเกี่ยวกับเรา. The public page gets a
   "ทีมปี 2570" button; the portal stays in 2569. On the switch the shown 2570
   list keeps being what เกี่ยวกับเรา shows (a published archive wins), so the
   new team appears on the day without editing the live tree first — the tree
   is then only about WHO HOLDS WHICH PERMISSION. ⛔ Do not press เผยแพร่ซ้ำ on
   2570 once it is current unless the live tree really is the new team: it
   rebuilds the list from the tree. It asks first (hand-edited year, 0270).
3. **Know who is about to lose the admin seat.** Whoever calls
   `start_team_term` keeps whatever `team_edit`/`master` grant they hold — the
   RPC does not touch permissions. If the outgoing VP is the only `team_edit`
   holder, grant the incoming one BEFORE the handover, or nobody can run the
   next one (the standing escape hatch if that happens anyway: a `dev`-role
   account, e.g. `samomdkkudev`, always passes this gate independent of the
   tree — `0224`'s header explains why no extra safety trigger was built for
   this instead).

## Running it

**Admin → ปี SAMO** (`/admin/#years`, `src/js/samo-year-admin.js`, since
2026-10-20). The page reads the handover's state from the database and shows
the three steps in order — ① บันทึกทีมปี… (publish) ② ไปที่ ทีม SAMO → จัดการทีม
(edit) ③ เริ่มปี SAMO … (switch). Step 3 calls `start_samo_year(p_year,
p_passport_name, p_season_name)` (0242), which CALLS `start_team_term` below and,
when a Passport name is given, opens that Passport วาระสโม + its first season
in the SAME transaction (create-then-end, `docs/INVARIANTS.md`). The Passport
half needs the org-wide Passport grant (`passport_admin_context()
->'all_departments'`, every `master` has it); without it the page says Passport
will not move and starts the ปี SAMO alone. ทีม SAMO → ทีมแต่ละปี no longer
offers the switch (re-publish, names/photos and delete stay there). Going BACK a
year is under "ปีอื่น ๆ" and never touches Passport.

ปีการศึกษา (ชั้นปี) is a DIFFERENT value moved on the same page by its own
button (`set_academic_year`, 0141, `house` grant) — the faculty's promotion day
is not the team's handover day (owner, 2026-10-20). Browser check of the whole
page: `node tools/browser/year-page.mjs` (samo-dev, writes nothing).

```sql
select public.start_team_term(2570);  -- the incoming year, พ.ศ.
```

One call does, in one transaction (never observable as two states):

- refuses if the caller holds neither `vp_admin`/`dev` role nor the
  `team_edit` permission (which `master` already satisfies —
  `current_user_has_permission` folds it, 0111; no separate master check
  needed or wanted). ⛔ **Not the bare `team` permission** — since 0110 that
  key is a VIEW grant every ทีม SAMO posting gets for free, so gating a
  handover on it (0219's bug, closed by 0224) let any of 300+ accounts with
  no edit rights at all flip the current year.
- **auto-archives the OUTGOING term if it has never been published** (0224)
  — calls `publish_team_term` on whatever was current, snapshotting the live
  tree exactly as it stood at this instant, BEFORE anything else below runs.
  A year that already has an archive keeps it: `publish_team_term` deletes
  and rebuilds, so re-running it would replace a correct snapshot. That no-overwrite rule
  is what makes step 2's publish → edit → switch order safe.
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
set and `is_current = false`; the incoming term shows `started_at` set AND
(since 0224) `published_at` set — a handover that did not also archive the
outgoing term did not run the current code. Then open จัดการทีม, confirm the
badge moved, and open the outgoing year's "แก้ไขรายชื่อ/รูป" to see the
roster that was actually live at the boundary.

## If it goes wrong

- **Ran it for the wrong year by accident**: call it again for the year it
  should have been. The function refuses nothing here except re-selecting
  the SAME year, so correcting a mistake is just another call — the term you
  close now reopens correctly later if needed (its `started_at` is
  preserved, per above). The outgoing term was archived by the mistaken
  call only if it had never been published, and is never re-archived by the
  correcting call — so an undo/redo cannot overwrite a year's history with a
  tree edited in between. To refresh an archive on purpose, press
  "เผยแพร่ซ้ำ" on that year.
- **Nobody holds `team_edit`/`master` any more and the call is refused**:
  grant it through `public.users.permissions` directly (`dev` role can
  always do this) — that is the intended escape hatch; `start_team_term`
  deliberately does not accept a role-only override beyond `vp_admin`/`dev`.
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

`tools/year0219-samo-year.sql` (`node tools/run-proofs.mjs year0219` —
rolled back, no state left behind) covers: a stranger refused, the admin's
handover closing-and-opening atomically, a same-year re-call refused, a
timestamp exactly on the boundary resolving to the new term, one microsecond
earlier resolving to the old one, an out-of-range year refused, and a
mistaken rollover undone-and-redone keeping its original `started_at`.

`tools/team0224-handover.sql` (`node tools/run-proofs.mjs team0224`) covers
0224's two changes: a VIEW-only `team` holder (what every ทีม SAMO posting
gets for free since 0110) is refused, paired against a `team_edit` holder
being allowed for the identical call; the outgoing term gets a real archive
with no separate `publish_team_term` call, matching the live public tree's
own node/member counts; and a regression guard that `discord_role_targets()`
still names zero references to `team_terms`.

Both applied to samo-dev only; production gets them when the owner reviews
and applies this branch's migrations (`skills/ship-a-migration.md`).
