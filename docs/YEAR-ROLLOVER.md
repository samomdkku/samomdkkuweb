# Year rollover — one SAMO year, every system, forever

> Design doc. No app code here. Written by the night agent, task 1 of the
> 2026-10-14 queue (`agent/2026-10-14`), against the owner's ask: *"every
> single system … persist forever more than this year, self sustainable"*.
> Every `Decision:` line names what was rejected and why. This is HYPOTHESIS
> until a later task applies it — see `docs/state/HANDOFF.md` §22 for the
> per-task status table.

---

## Inventory

One row per system: what it owns, how big it is (measured on production
2026-10-13 — see the night-queue preamble; this doc does not re-query), and
what a brand-new team sees on day one of next year if NOTHING in this queue
ships.

| System | Owns | Size / growth | Day-1-next-year today |
|---|---|---|---|
| PR | `pr_tickets` | 311 rows since 2026-05-22, 290 done | New PR staff see **all 290 finished tickets from last year** in the same kanban as this week's, with no filter |
| VitalSound | `vs_tickets`, `vs_public_comments`, `vs_followers`, `vs_tags` | 119 tickets, 16 comments | Same — new handlers see last year's confidential complaints mixed with new ones, no PDPA retention clock anywhere |
| SAMO Shop | `shop_products`, `shop_orders`(+items), `shop_pickup_batches` | 43 orders, 3 products | New shop team sees every past order; no `created_at` column to even sort by (only `placed_at`/`updated_at`) |
| หนังสือโครงการ | `projects`(+documents/files/sign_requests) | 42 projects, 36 with `fiscal_year_be` NULL | ✅ Already has a ปีงบ picker UI (`fiscal-year.js`) — the ONLY system with a working per-year filter today |
| ทีม SAMO | `team_nodes`, `team_members`, `team_terms`(+archive) | 300 nodes, 450 members, 2 terms | ✅ Already has publish/archive (0104–0106) — a new year is `publish_team_term` + edit the live tree. **The model every other system should copy** |
| เกี่ยวกับเรา (org chart) | reads `team_terms`/archive via `get_public_team_chart(year)` | — | ✅ Rides ทีม SAMO's archive already; nothing to build, confirm it is wired to the SAME registry this doc creates |
| ระบบบ้าน | `students`, `people`, `houses`, `sais`, `advisors` | ~1,800 students, 6 รุ่น (MD49–54) | MD49 (ปี 6 now) has no graduation step — stays in the live roster forever, มีปัญหา counts include people who already left |
| หน้าฝ่าย | `dept_content`, `src/data/depts.js` | 12 ฝ่าย, few dozen content rows | Content has no year at all — a new ฝ่าย officer inherits last year's text silently, with no "this is stale" signal |
| Passport | `passport.samo_years`/`samo_seasons`/`scans`/`certificates` | 1 year row, 1 season, 1,161 scans | ✅ Has its OWN year/season model (admin-declared, `ended_at IS NULL` = current) — the oldest rollover mechanism in the codebase, and the one every other system's design borrows the SHAPE from |
| Announcements | `announcements` | small | No year at all; an old ประกาศ stays `approved` forever with no archive view |
| Accounts | `auth.users`/`public.users`/`people` | 756 users, 1,698 people | Permanent by design — a person's ONE registry row must outlive every term (already true, see `one-person-registry` memory) |
| Stats | `analytics_events` (26,266/10 MB), `claude_usage_samples` (3,511/6.8 MB), `notify_log` (581), `project_notifications` (3,897/1.9 MB) | whole DB 60 MB / 500 MB cap | No retention job runs at all (`docs/INVARIANTS.md` already flags `prune_analytics`/`prune_notify_log` as unscheduled) |
| Claude booking | `claude_bookings`, `claude_usage_samples`, `claude_settings` | operational, 5-hour/weekly windows | Not year-scoped by nature (a weekly quota), but its sample history grows unbounded |
| Discord | `discord_links`, `team_nodes.discord_role*`, the sync service | 449 people | Roles mirror ทีม SAMO LIVE — a handover already propagates in ~15 min, but nothing revokes a departed officer's SERVER-WIDE Discord permissions (`DISCORD_SYNC_ALLOW_POWER`) on handover day |
| Drive | GAS `appscript/prform.gs`, folders under `My Drive/IT Database/{PR,Projects,Shop,Team,Passport}` | — | Only `Team/<ปีการศึกษา>/<ฝ่าย>/...` is already year-prefixed; PR/Shop/Projects/Passport are flat forever |

---

## The SAMO year

**Decision: the SAMO year is `public.team_terms`, not a new table.** It
already has `year integer PK` (พ.ศ.), `is_current boolean` (partial unique
index — exactly one current row), `published_at`, and a working
snapshot-archive pair (`team_archive_nodes`/`team_archive_members`,
`publish_team_term()`, `get_public_team_chart(year)`). Building a second
"SAMO year" registry beside it would instantly create the two-homes-for-one-fact
bug this repo's own mistakes file names as its most expensive class.
**Rejected alternative:** promote `passport.samo_years` to the cross-app
registry instead — rejected because it lives in an isolated Postgres schema
or PR system can't FK into it, and because `team_terms` already has the
archive machinery everyone else should copy, whereas `samo_years` has none
(it only ever marks current/not-current, no snapshot of anything).

**Decision: the boundary is the TEAM HANDOVER, an explicit admin action —
never a calendar date.** `team_terms` is a term of OFFICE (who holds which
seat), not an academic or fiscal year, and SAMO's own handover date moves
year to year. ปีงบ (`projects.fiscal_year_be`, 1 ต.ค.–30 ก.ย.) and ปีการศึกษา
(`study-year.js`, 1 ส.ค. rollover) are REAL, independently-moving calendars
that already have their own correct logic — this doc does not touch either.
**Rejected alternative:** derive the SAMO year from the fiscal or academic
year automatically — rejected because `study-year.js`'s own header comment
already explains why a computed rollover is "confidently wrong" for the
weeks a promotion lags the calendar; the same argument applies here even
harder, since a team handover is a human event with no fixed month.

**Decision: ADD `team_terms.started_at timestamptz` and
`ended_at timestamptz`**, owned EXCLUSIVELY by the new `start_team_term(year)`
RPC below — **not** by `publish_team_term`, which is a different action (it
snapshots the CURRENT tree into that year's archive and may be called
repeatedly without any handover happening, per 0105/0106's "re-publish" flow).
Conflating the two would stamp `started_at` every time an admin merely
re-publishes this year's org chart, which is not a handover. Every
other system's "which year does this row belong to" question becomes
*"which `team_terms` row has `started_at <= row.created_at < coalesce(ended_at,
'infinity')`"* — the exact shape `projects.fiscal_year_be` already proved out
(NULL override column, a pure-JS derivation function, a `.test.js` ratchet).
**Rejected alternative:** derive it from `is_current` flips alone (no
timestamps) — rejected because a later system asking "what year was this
MARCH ticket filed under" needs a date RANGE, not just "whichever term is
current NOW"; `is_current` answers only the present tense.

**Decision: each system stores its SAMO year EXPLICITLY, at write time, via a
trigger reading `current_samo_year()`** (a new one-line SQL function: `select
year from team_terms where is_current`) — **never derived at read time from
the timestamp.** This mirrors `projects.fiscal_year_be`'s "stored, nullable,
overridable" shape but differs in WHEN it is first filled: fiscal_year_be is
null-by-default and a human sets it; the new `samo_year_be` columns are
filled automatically on INSERT so every system gets year-filtering for free
with no backfill gap for new rows. **Rejected alternative:** compute it at
read time from `created_at` against `team_terms` date ranges (a view, not a
column) — rejected because of class 2 in `.claude/rules/mistakes.md`: if an
admin later edits a term's `started_at` (correcting a handover date typed
wrong), every row's classification would silently shift, including rows
already shown to a human on last year's dashboard. A stored value is a FACT
about history; a view is a FACT about the registry's current shape, and
those must not be the same thing for already-closed years.

**Decision: a NEW row ALWAYS gets the term that is current at insert time;
an admin may override it explicitly afterward** (same affordance
`fiscal_year_be` already has — a manual correction column, not a recompute
button). This answers the owner's "a ticket opened in one year and closed in
the next" edge case (below): it stays filed under the year it was OPENED in,
by default, because that is when the team that owns it existed; a human can
move it if the workflow disagrees.

**Decision: one reusable JS module, `src/js/samo-year.js`**, exporting a
single `<select>`-building helper (`samoYearPicker(years, current, onChange)`)
and a `currentSamoYear()` reader — used by PR, VS, Shop, ทีม SAMO and หน้าฝ่าย
dashboards alike. **Rejected alternative:** let each admin screen build its
own year dropdown (what the codebase already does for every OTHER filter
dimension, per class 6 — "a hand-written list beside a shared constant").
The owner explicitly asked for "like หนังสือโครงการ" as the model; making that
ONE component instead of copying `fiscal-year.js`'s pattern five times is
what the night-tasks preamble's UI instruction already requires.

```sql
-- the one function every system's trigger and every dashboard calls
create or replace function public.current_samo_year() returns integer
language sql stable as $$
  select year from public.team_terms where is_current limit 1
$$;
```

---

## PR

**Inventory:** `pr_tickets` (311 rows, 290 `โพสต์เรียบร้อย (เสร็จสิ้น)`), no
year column, no Drive year-prefix (`My Drive/IT Database/PR/` is flat), PR
Staff Dashboard (`pr-staff.js`) renders every non-deleted row in one kanban
with no year filter — exactly the complaint the owner opened the whole
night-queue with.

Decision: add `pr_tickets.samo_year_be smallint`, trigger-filled from
`current_samo_year()` at INSERT, admin-overridable. The PR Staff Dashboard
defaults to the CURRENT year and gets the shared `samo-year.js` picker to
browse past years — same shape as หนังสือโครงการ's ปีงบ filter, which is the
owner's own worked example. Past years are READ-ONLY by default **in the UI
only — no new RLS; the underlying rows stay governed by the existing `pr`
permission gate regardless of year** (no status
transitions shown) with an explicit "แก้ไขของปีก่อน" override for the rare correction,
mirroring how ทีม SAMO's archived terms stay editable on purpose (0105)
rather than being frozen solid — a wrongly-filed historical ticket must stay
fixable, just not by accident.

Decision: **the 311 existing rows get a ONE-TIME backfill of `samo_year_be`
derived from `timestamp`/`created_at` against `team_terms` date ranges, in
task 3's own migration — the same exception the หนังสือโครงการ section below
grants its 42 rows, for the identical reason: nobody has chosen a year for
them yet, so there is no stored human decision a backfill would overwrite.**
**This correction matters most here of every system in this doc**: without
it, all 290 `โพสต์เรียบร้อย (เสร็จสิ้น)` tickets the owner named as the
motivating example would carry `samo_year_be = NULL` forever, rendering as
"ก่อนเริ่มระบบปี" (edge case 25) in the dashboard's default current-year
view — i.e. the exact pile the owner asked to stop seeing would instead
become a SEPARATE pile that is still always visible, and the feature would
look built but accomplish nothing for the 311 rows that prompted it.

Decision: do NOT delete or anonymise PR tickets at year-end. PR content is
operational (captions, briefs, file links), not personal data under PDPA in
the way VS complaints are — there is no regulatory retention ceiling driving
deletion, and the owner's own example ("the next samoyear … it'll be a
mess") was about NAVIGATION, not about disk space (311 rows is noise against
the 500 MB cap). Export to CSV/JSON is offered per year (see `## Export`) so
a graduating PR team can take a copy, but nothing is removed from the
database by a rollover.

---

## VitalSound

**Inventory:** `vs_tickets` (119, PDPA-gated at submission —
`modal-vs-consent.html`), `vs_public_comments` (16), `vs_followers` (5),
`vs_tags` (11). The PDPA notice told every submitter their report would be
"ไม่ระบุตัวตน" (anonymous) and read by "ฝ่าย Student Engagement, อุปนายกสโมฯ
และฝ่ายอื่น ๆ ที่เกี่ยวข้อง" — it promised confidentiality, not a retention
period, and never mentioned deletion.

Decision: VS gets the same `samo_year_be` column + trigger + picker as PR.
Confidential/open tickets default to the CURRENT year view; a dept handler
can still see their own dept's history across years (RLS unchanged — the
year column is a FILTER, never an access boundary) because the PDPA notice's
access list ("ฝ่ายอื่น ๆ ที่เกี่ยวข้อง") already covers continuity of
service, not a yearly reset of who may read what.

Decision: **the SHAPE of retention — anonymise text, never delete the row —
is grounded in the PDPA notice's own wording**; the NUMBER (24 months) is
NOT grounded in anything and is stated as an invented default below, to be
explicit about which part is reasoning and which part is a guess. The notice
promises the data is already anonymous at collection (no name is asked for),
so there is no "personal data" left to delete in the PDPA sense once a
ticket is `เสร็จสิ้น` — what remains identifying is the free-text `problem`
field, which can incidentally contain a name. Proposal: 24 months after
`resolution` is set, a scheduled job scrubs any ชื่อ-นามสกุล-shaped token
(name list already exists — `public.people`) from `problem`/`resolution_note`
on tickets still in the database, but the ROW stays (so year-over-year trend
stats survive). **Rejected alternative A:** delete the row outright after N
years — rejected because `vs_categories` trend analysis ("พัฒนาและปรับปรุงการ
ดำเนินงาน" — the notice's own stated purpose #3) needs the historical COUNT
and category, which a full delete would also destroy; anonymising text while
keeping the structured columns satisfies the notice's stated purpose for
longer. **Rejected alternative B:** anonymise immediately at close instead of
after a delay — rejected because an open dispute or a "เรื่องซ้ำ" merge
needs the original wording for a while after close, and the owner has not
set a policy here, so a 24-month buffer (default elsewhere in this doc, see
`## Deletion`) is the safe default until told otherwise. **Nothing is
deleted or scrubbed by this design doc itself — this is a plan for a job
task 4 may build, not applied tonight.**

⚠️ **Separate, pre-existing gap this doc did not create but should name:**
`modal-vs-consent.html` states WHAT is collected and WHY, but never states a
RETENTION PERIOD or a right to request erasure — both of which PDPA notices
normally carry. Adding a backend scrub job under a notice that promises
neither is better than nothing, but the notice text itself should eventually
be updated to say how long a report is kept; that is a copy change, not a
migration, and is out of this doc's build order (no task above claims it).

Decision: the 119 existing `vs_tickets` get the same one-time
timestamp-derived backfill as PR's 311, in task 4's migration, for the same
reason (no human has chosen a year for them; nothing is overwritten).

Decision: PDPA export-before-delete. Before any anonymisation job runs for
real, it must write its target rows to the per-year export artifact
(`## Export`) first — "nothing is deleted without an export first" per the
night-queue's own instruction — so a ฝ่าย that needs to re-open a pattern
later still can, from cold storage.

---

## SAMO Shop

**Inventory:** `shop_orders` (43, **no `created_at`** — only `placed_at`,
`updated_at`), `shop_order_items`, `shop_products` (3), `shop_pickup_batches`.
Multi-department (Model A, shared access) per existing memory.

Decision: add `shop_orders.samo_year_be smallint`, a BEFORE INSERT trigger
stamping `current_samo_year()` at the moment the row is created — same
insert-time rule as every other table in this doc, never derived from
`placed_at`'s own value. `placed_at` is noted only to confirm there is no
missing `created_at` to add: `place_shop_order()` sets it in the same
INSERT, so "now" and "placed_at" are the same instant for every order made
through the normal checkout RPC. The admin orders table defaults to current
year, shared `samo-year.js` picker to browse history. The 43 existing rows
get the same one-time timestamp-derived backfill as PR/VS above.
⚠️ **One real divergence, flagged rather than silently assumed away**: a
shop admin CAN hand-enter a walk-in order with a `placed_at` the admin
backdates (the admin write path is not required to go through
`place_shop_order`'s INSERT-time stamping the same way). If that ever
happens, the trigger still stamps the CURRENT team's year, not whatever
`placed_at` claims — the row's `samo_year_be` and its `placed_at` can then
legitimately disagree. This is the same "stored at write time, admin may
override" shape as every other table; the admin orders UI should let the
row's `samo_year_be` be corrected explicitly in that case, same affordance
as `fiscal_year_be`.

Decision: **unpaid/in-review orders do NOT inherit a new year at rollover.**
An order opened under last year's team and still `pending`/`review` keeps
its ORIGINAL `samo_year_be` (stored at write time, per the global rule) —
the new shop team sees it in a "ค้างจากปีก่อน" filter state, not silently
folded into "this year's" orders, because the money and the product
commitment are real regardless of which team is now in office. This answers
the owner's explicit "shop preorders spanning the boundary" edge case.
**Rejected alternative:** reassign in-flight orders to the new year at
rollover — rejected because it would make a graduating team's PENDING
revenue invisible on its own books, which is a financial-reporting problem,
not a cosmetic one.

Decision: products (`shop_products`) are NOT year-scoped — a product is
inventory, not a transaction, and the existing Model A access
(`current_user_is_shop_admin()`) already spans every year of shop admins. A
discontinued product is already handled by `is_active=false`; adding a year
dimension on top would create exactly the "scope vs identity" confusion
class 6 warns about (a product is not "from" a year the way a ticket is).

---

## หนังสือโครงการ

**Inventory:** `projects` (42, `fiscal_year_be` BE-ปีงบ, NULL on 36),
`project_documents` (87), `project_files` (155), `project_sign_requests`
(25). **Already has the reference implementation** — `fiscal-year.js`, a
picker, a per-user default pref (`project_user_prefs.default_fiscal_year`).

Decision: **ปีงบ (fiscal year) and the SAMO year stay SEPARATE columns on
`projects`.** หนังสือโครงการ is sent to a university office that runs on the
government's ปีงบประมาณ calendar (1 ต.ค.–30 ก.ย.) — that convention outlives
any SAMO team and must not be touched. Add `projects.samo_year_be smallint`
ALONGSIDE `fiscal_year_be`, same trigger-at-insert pattern, used only for "ทีม
SAMO sent this" grouping (e.g. "what did last year's VP send"), never for the
university-facing workflow. **Rejected alternative:** repurpose
`fiscal_year_be` to mean the SAMO year — rejected because 11 projects
already have it explicitly set to 2570 for the REAL ปีงบ reason, and
conflating the two would silently corrupt a column a university officer
already reads.

Decision: the 36 projects with NULL `fiscal_year_be` are NOT backfilled by
force — `fiscal-year.js`'s own derivation (NULL = compute from `created_at`)
already gives them a correct ปีงบ at read time; only `samo_year_be` (the new
column) gets filled, and only going forward, by the trigger. A one-time
backfill of `samo_year_be` for the 42 existing rows (from `created_at`
against `team_terms` date ranges) is a SEPARATE, explicit migration step —
not automatic — because it is the one case in this whole doc where
"derive from timestamp" is correct: these are PRE-EXISTING rows with no
human having chosen a year for them yet, so there is no stored human
decision to protect (contrast with the "never recompute after write" rule
above, which protects a CHOICE already made).

---

## ทีม SAMO

**Inventory:** `team_nodes` (300), `team_members` (450), `team_terms` (2
years), `team_archive_nodes`/`team_archive_members` (built, EMPTY — nobody
has published an archived-and-then-edited year yet). **This is the system
every other system's year model copies.**

Decision: `team_terms` becomes the shared registry (see `## The SAMO year`)
with zero schema change to its OWN behaviour — `publish_team_term` already
does the right thing. The only addition here is `started_at`/`ended_at` for
other systems to read, and a `start_team_term(year)` RPC that flips
`is_current`, closes the old term's `ended_at`, and opens the new one's
`started_at` in the SAME transaction — **never a gap between two terms**,
exactly the lesson `docs/INVARIANTS.md` already states for passport
seasons ("start the new one before ending the old one"). The symmetry is not
an accident: both are "the currently open row" patterns, and both fail the
same way if there is ever an instant with none open.

Decision: จัดการทีม per year = the EXISTING third admin mode
(`src/js/team/terms.js`) that lets a published year's roster be edited after
the fact. Nothing new to build here — the owner's "the จัดการทีม for each
year" ask is already answered by 0104–0106; this doc's job is to make sure
the OTHER systems' year pickers read the SAME `team_terms` list
(`get_public_team_years()`) so a reader browsing "2569" in PR sees the same
2569 as in ทีม SAMO, never a second list that can drift (class 6).

Decision: **a staffer who leaves mid-year keeps their grants until the NEXT
`start_team_term` call, never revoked retroactively.** Permissions flow from
the LIVE tree (`sync_my_team_permissions()`), not from `team_terms`, so
removing someone from `team_members` already revokes access immediately —
this is unchanged by the year model and is called out here only so a future
reader does not assume "a new year starts" implies "old grants expire";
grants expire when the TREE changes, which may or may not coincide with a
term flip.

**Correction (task 4, migration 0224).** Two things in this section's
original plan did not survive contact with the live function bodies:

1. `start_team_term` (task 2's 0219) gated on `current_user_has_permission
   ('team')`. 0110 (already live, predating this whole queue) made `team` a
   VIEW-only key every ทีม SAMO posting receives for free — 300+ accounts
   today — so the handover RPC was callable by anyone in the tree, not just
   an editor. 0224 regates it on `team_edit`, the same key
   `publish_team_term`/the tree's write policies already use. **Rejected
   alternative:** a brand-new `team_handover` permission, narrower than
   `team_edit` — rejected because `team_edit` is already "effectively root"
   over the tree (0110's own comment: holding it lets you grant anyone,
   including yourself, anything up to and including `team_edit`), so a
   handover gate narrower than that would be a distinction with no
   enforceable difference — anyone who could not call `start_team_term` but
   could edit the tree could simply grant themselves the narrower key too.
2. "จัดการทีม per year … nothing new to build here" undersold the real gap:
   publish and handover were two INDEPENDENT manual actions, and nothing
   enforced the order between them. Since `publish_team_term` always
   snapshots whatever the live tree looks like AT CALL TIME, editing the
   tree for the incoming team BEFORE either calling `start_team_term` or
   re-publishing the outgoing year would silently archive the WRONG team
   under the outgoing year's label. 0224 makes `start_team_term` call
   `publish_team_term` on the outgoing term itself, in the same transaction,
   before closing it — so "prepare next year's team without touching this
   year's" (the owner's own phrasing) is now the ONLY correct order, enforced
   by the function rather than left as a sequencing instruction in a skill
   doc nobody re-reads mid-handover. **Rejected alternative:** a NEW "draft
   tree" the admin edits ahead of time, promoted to live at the boundary —
   rejected as too large and risky for one night's remaining budget (it
   would duplicate every permission-bearing column team_nodes/team_members
   carry, or strip them, in which case it could not actually be "prepared"
   with real grants attached — the same reason `terms.js`'s own header
   already gives for why the ARCHIVE tables carry no permission columns).

---

## เกี่ยวกับเรา

**Inventory:** the public org chart, reading `get_public_team_chart(year)`
over `team_terms`/archive. No own storage.

Decision: no change needed — confirm (task 7) that the public chart's year
selector sources its list from `get_public_team_years()`, the same function
this doc wires every other picker to, rather than a hand-rolled list. If it
already does (likely, since 0105 built it that way), this section is a
NO-OP and the task should say so rather than touching working code.

---

## ระบบบ้าน

**Inventory:** `students` (~1,800), `people`, `houses` (10, fixed), `sais`
(derived), `advisors`. MD49–MD54 tracked; MD49 is ปี 6 now (its LAST year
before graduating, since ชั้นปี caps display at "จบแล้ว" above 6).

Decision: ระบบบ้าน is NOT scoped to the SAMO team year at all — a student's
house placement is a multi-year fact (a รุ่น spans 6 years) and has nothing
to do with which VP is in office. **The relevant rollover here is the
ACADEMIC year** (`study-year.js`'s existing `academicYear()`), which already
handles the ชั้นปี arithmetic correctly. This section's only real ask is
**graduation**, which the owner's queue preamble explicitly scopes to MD49
reaching ปี 7 (i.e., `studyYear() > 6`).

Decision: a graduating รุ่น is ARCHIVED, never deleted. Add
`students.graduated_at timestamptz`, set by a yearly job (or an admin
button) the first time `studyYearLabel()` would read "จบแล้ว" for every
member of a รุ่น. A graduated student's row stays in `students` (their
`person_id` link and ทีม SAMO history must survive — see
`one-person-registry` memory: a person can hold a ทีม SAMO posting for years
after graduating), but the ระบบบ้าน admin's DEFAULT roster view excludes
`graduated_at is not null`, with a "รุ่นที่จบแล้ว" toggle to see them.
**Rejected alternative:** delete graduated students' house placement —
rejected hard: `team_members.person_id` and Discord links both depend on the
person registry row surviving, and `advisors`/สาย history is exactly the
kind of record ฝ่ายข้อมูล has spent months reconciling (สาย 141/256 — see
STATE.md); deleting it now would destroy work already paid for.

Decision: สาย/บ้าน assignment is NEVER re-run at rollover. It is a one-time
university assignment per รหัสนักศึกษา (already documented as "not derivable,
nothing may compute or repair one") — graduation changes nothing about it,
it just stops being the ACTIVE roster's concern.

---

## หน้าฝ่าย

**Inventory:** `dept_content` (few dozen rows across 12 ฝ่าย), identity in
`src/data/depts.js`. Content has no year, no "stale" signal, no version
history.

Decision: **content is NOT year-scoped or versioned.** A ฝ่าย page is a
living document (like a website page, not a ticket) — the owner's own
framing for why `dept_content` exists at all was "content is DATA, tools are
CODE", and versioning every edit would re-introduce exactly the
commit-and-deploy friction 0177 was built to remove. **Rejected
alternative:** snapshot `dept_content` into a `dept_content_archive` at every
`start_team_term` call, mirroring `team_archive_*` — rejected because a ฝ่าย
page is not something a new officer "inherits as a snapshot" the way an org
chart is; they inherit it as a LIVE page to keep editing, and a parallel
archive table nobody reads is the same "a table nothing reads is the one
whose missing protection nothing can reveal" trap from a different angle (a
table nothing reads is also a table nobody maintains).

Decision: the ONE real gap — a new officer has no signal that a page is
"from last year's team" — is answered by surfacing `updated_at` /
`updated_by` (both already exist) more prominently in the editor ("แก้ไขล่าสุด
โดย X เมื่อ ..."), not by adding a year column. This is a UI nudge, not a
schema change, and belongs in task 9's small scope rather than a migration.

---

## Passport

**Inventory:** `passport.samo_years` (1 row, no `ended_at`, meaning it has
never been rolled over since 2026-06-17), `passport.samo_seasons` (1, "Q2"),
`passport.scans` (1,161). **`passport.seasons` (db/0004, department-scoped,
dated windows) is DEAD CODE** — confirmed by grep: nothing in `passport/js/*`
reads from it; only `samo_years`/`samo_seasons` (db/0006) are live.

Decision: Passport keeps its OWN `samo_years`/`samo_seasons` tables —
**do NOT fold them into `team_terms`.** Passport lives in an isolated
Postgres schema specifically because it is a separate product surface with
its own admin model (per `two-supabase-projects` / passport CLAUDE.md), and
its year/season concept already answers a DIFFERENT question (which QR
posters are live, which leaderboard window is open) than ทีม SAMO's term of
office. **Rejected alternative:** replace `passport.samo_years` with reads
against `public.team_terms` across the schema boundary — rejected because
cross-schema FKs between `public` and `passport` do not exist anywhere in
this codebase today (deliberately — the isolation is part of why the
2026-09 schema-move RLS bug stayed contained to `passport.continents`
alone), and because Passport's year boundary (posters, badges) is
operationally decided by ฝ่าย กิจกรรม on their own calendar, not by a VP
handover.

Decision: ADD a nullable bridge column,
`passport.samo_years.team_term_year integer` (no FK, just a loose reference
— same "reference data with a DELETE is fail-open" caution as `team_majors`),
set by hand when an admin opens a new Passport year, so a FUTURE cross-system
report ("how many km did ทีม SAMO term 2570 award") can join the two without
merging the tables. This is the one piece of task 10's scope that touches
schema; everything else in Passport is unchanged.

Decision: **never let a gap exist between two Passport years/seasons** —
already the law (`docs/INVARIANTS.md`), restated here only to confirm this
doc's `start_team_term(year)` pattern for ทีม SAMO deliberately copies
Passport's own proven shape (open-before-close), not the other way around:
Passport had this right first.

Decision: Passport's PDPA posture (179 profiles with no `auth.users` row is
EXPECTED, not a bug — already closed per INVARIANTS) is unaffected by year
rollover; a graduated student's accumulated km/stamps is their own earned
record and is never deleted at rollover, only at the account-deletion policy
in `## Deletion` below (student request, same as any other account).

---

## Announcements

**Inventory:** `announcements` (small), `status IN ('approved','draft',
'archived')` — **it already HAS an `archived` status value that nothing in
the UI uses to filter a view**, confirmed by the CHECK constraint in
`0001_initial_schema.sql`.

Decision: use the EXISTING `archived` status as the year-rollover action,
rather than adding a column. A scheduled (or manual, task's choice) job at
`start_team_term` time flips every `approved` announcement older than the
new term's `started_at` to `archived`. The public feed already should (task
to verify) filter to `approved` only — if it currently also shows
`archived`, that is a pre-existing bug this doc surfaces, not a new design;
flag it for the implementing task rather than silently "fixing" scope not
asked for here. **Rejected alternative:** add `announcements.samo_year_be`
like every ticket table — rejected because an announcement has no workflow
state that needs per-year FILTERING the way a kanban does; it needs a binary
"still current" flag, which `status` already provides unused.

---

## Accounts

**Inventory:** `auth.users` (756), `public.users`, `public.people` (1,698)
— **permanent by design**, per the `one-person-registry` memory: a person's
account must outlive every term, house placement, and ทีม SAMO posting.

Decision: accounts are explicitly OUT OF SCOPE for year-based archival or
deletion. The only lifecycle event here is graduation + eventual account
closure, which is a PERSON decision (did they ask to leave, did they stop
using kkumail), never a YEAR decision — folding account cleanup into "the
year rolled over" would conflate two unrelated triggers and risks deleting
an account that is still legitimately in use (a graduate who stays in ทีม
SAMO as an advisor, an อาจารย์, a returning staff). See `## Deletion` for the
actual account-closure policy, which is person-triggered, not
rollover-triggered.

Decision: the `account_dashboard()` (0211) view gains an OPTIONAL
`samo_year_be` filter on its PR/VS/Shop/Projects activity joins (once those
columns exist from tasks 3–6), so an admin reviewing "what did this person do"
can scope to a year — additive to the existing read-only dashboard, no new
table.

---

## Stats

**Inventory:** whole DB 60 MB of 500 MB (12%). `analytics_events` is the
single biggest and fastest-growing table: 10 MB / 26,266 rows since
2026-07-23, averaging **~3,600–3,900 rows/month** (Jul 3,624 · Aug 12,725 —
an outlier month · Sep 7,766 · Oct 1–13 pace ≈ 8,900/month). At a steady
~8,000 rows/month the table alone would reach ~500 MB (50× its current row
count, i.e. ~1.3M rows) in roughly **13–14 years** at the CURRENT per-row
size — not an emergency, but `claude_usage_samples` is denser (6.8 MB for
3,511 rows since 2026-08-15, i.e. ~2 months) and growing faster per-month in
bytes; at that rate it alone reaches 500 MB in under 3 years if unpruned, and
it is explicitly a ROLLING operational signal (no reason to keep it past a
quota week once it has fed the weekly card).

Decision: **schedule the two retention jobs that already exist as
functions but are not scheduled** — `prune_analytics(days=90)` and
`prune_notify_log` (both named in `docs/INVARIANTS.md` as built, unscheduled).
This is the single highest-leverage, lowest-risk action in this whole doc:
zero new code, a cron/pg_cron entry or a VM systemd timer calling them
weekly. **Rejected alternative:** raise the retention window instead of
scheduling — rejected because 90 days already covers the DAU/WAU/MAU window
`analytics_overview()` needs (it takes a `days` argument, default well under
90), so nothing downstream reads data older than that.

Decision: `claude_usage_samples` gets a NEW prune function,
`prune_claude_usage_samples(weeks=8)` — keep 8 weeks (two quota cycles) of
raw samples for the rail's differential proofs, roll up anything older into
a single `claude_usage_weekly_rollup` row (total used, peak) per week. The
live rail/board functions (`claude_window_loads` etc.) only ever look at the
CURRENT week, so nothing downstream breaks; the rollup exists purely so a
"how has usage trended" chart can exist later without keeping every raw
sample forever.

Decision: `project_notifications` (3,897/1.9 MB) and the general notify
tables are NOT pruned by year — they are per-user "seen/unseen" state read
by a live bell icon; pruning them by age risks deleting an UNREAD
notification a user has not opened yet. If they ever need pruning, the rule
must be age-AND-read, never age alone — noted here, not built tonight (no
migration reserved for it; it is not urgent at 1.9 MB against 500 MB).

---

## Claude booking

**Inventory:** `claude_bookings`, `claude_usage_samples` (covered above),
`claude_settings`. A weekly operational quota, not year-scoped by nature —
"the SAMO year" does not apply to a Wednesday-16:00-ICT reset cycle.

Decision: no `samo_year_be` column here — it would be meaningless (a
booking's "year" is never asked anywhere in the UI, which only ever shows
the current week's rail). The only action this system owes the rollover
effort is the sample-pruning covered in `## Stats` above.

Decision: when ทีม SAMO handover happens, `claude` permission holders are
whoever the live tree currently grants it to — already true, unchanged,
same "grants flow from the tree, not from a year" rule as every other
permission in this doc.

---

## Discord

**Inventory:** `discord_links` (per-person, 1:1 with `people`),
`team_nodes.discord_role`/`discord_role_id`, the `samo-discord-sync`
service. Already LIVE-reconciling continuously (≤15 min) against ทีม SAMO.

Decision: **no schema change — the existing sync already IS the year
rollover mechanism for Discord**, because it derives every role from the
LIVE tree on every pass. The moment a departing officer is removed from
`team_members` (whatever process does that at handover), the sync revokes
their role within 15 minutes, with no special "rollover" code path needed.
This section exists to confirm that fact is true, not to build anything.

Decision: **the one real gap is SERVER-WIDE power, not roles** — a handful
of accounts hold `DISCORD_SYNC_ALLOW_POWER` (named by, not listing, per the
docs-are-published rule), and nothing in the role-sync model revokes THAT
at handover, because it was deliberately granted "by name", outside the
tree-driven model. Recommendation for whoever runs the next handover: review
that allow-list by hand at the same time as the officer handover,
specifically because it is the one Discord privilege this whole
continuously-correcting system does NOT self-heal. **Rejected alternative:**
fold server-wide power into a `team_nodes` permission flag so it
self-revokes too — rejected as a bigger, riskier change than this queue's
budget allows in one night; flagging the manual step is the responsible
scope for tonight.

---

## Drive

**Inventory:** `My Drive/IT Database/{PR,Projects,Shop,Team,Passport}`.
Only `Team/<ปีการศึกษา>/<ฝ่าย>/...` is already year-prefixed (proven live,
`appscript/prform.gs`'s `uploadTeamFile` path). PR/Shop/Projects/Passport are
flat.

Decision: **new uploads get a year-prefixed path; existing files are NOT
moved.** `PR/`, `Shop/`, `Projects/<PRJ-code>/` stay as the stable top-level
folders GAS already resolves by code/name (moving historical files risks
breaking every `drive_file_id`/`drive_view_url` already stored in Postgres —
those are stable Drive FILE ids, not paths, so a folder move does not even
help retrieval and only adds risk). Going forward, GAS should file new
uploads one level deeper, e.g. `PR/2570/<ticket-id>_<file>`, mirroring
Team's pattern. **This requires an Apps Script redeploy, which this night
agent cannot do** (owner/VPN-gated per `skills/deploy-gas.md`) — written as
a design for a human to apply, not shipped tonight.

Decision: หนังสือโครงการ's folder is already effectively self-organizing by
`PRJ-YYMM-NNNN` code (the YYMM is baked into the id), so it needs NO new
year-prefix — it already has one, just expressed as a code prefix rather
than a folder level. Nothing to change here.

Decision: **no blanket Drive storage cleanup.** 2 TB quota against the few
thousand files this system has generated in total is not a capacity problem
(unlike the 500 MB Postgres cap) — Drive-side retention should follow
whatever this doc decides for the ROW that references each file (if a VS
ticket's text is anonymised but the row kept, its Drive attachment, if any,
is unaffected; VS tickets rarely carry Drive attachments per the schema
above). A trashed Drive file is still served publicly (`trashed-drive-file-still-public`
memory) — any future deletion of a Drive file as part of `## Deletion` MUST
revoke sharing BEFORE trashing, never trash alone.

---

## Backup

Decision: the per-year EXPORT this doc specifies (`## Export`) doubles as
the backup artifact for anything that gets anonymised or pruned — there is
no separate "backup system" to build. Supabase's own point-in-time recovery
(if enabled on the paid tier; unconfirmed on the free tier this project
uses) is the disaster-recovery layer; this doc's exports are the
APPLICATION-level "what did last year look like" layer, which PITR cannot
answer once a scrub job has already run (PITR restores the WHOLE database
to a timestamp, not one table's pre-scrub state).

Decision: exports are written to a destination OUTSIDE the Supabase project
— Google Drive, under a NEW top-level folder `My Drive/IT Database/Archives/<ปี>/`,
parallel to the existing five, uploaded via a new GAS action
(`uploadArchiveFile`, same allow-listed-path pattern as every other upload
handler). **Rejected alternative:** keep exports only as local files an
admin downloads — rejected because that re-creates the exact "only you can
restore it" single point of failure `docs/SUCCESSION.md` already exists to
avoid elsewhere in this project; Drive is already the shared, two-holder-succession
storage every other system trusts.

---

## Export

Decision: **one shared export shape, one shared button** — a
`samo-year-export.js` module (reused the same way `samo-year.js`'s picker
is) that, given a table name + year column + a list of columns, produces a
CSV with a UTF-8 BOM (same convention as ทีม SAMO's existing CSV export, for
Thai text in Excel) and triggers the Drive upload above. Built ONCE, called
from PR, VS, Shop and หนังสือโครงการ's admin screens ("ส่งออกข้อมูลปีนี้"
button each). **Rejected alternative:** a bespoke export per system —
rejected for the same reason the shared year-picker is shared: four
near-identical implementations is the class 6 bug waiting to happen the
moment one of them needs a fix.

Decision: export happens BEFORE any destructive action, always, enforced in
code (the scrub/prune functions in `## Stats`/`## Deletion` take an
`already_exported boolean` the caller must prove, not just a comment saying
"export first") — the mechanism-not-prose lesson this repo's own mistakes
file states as a rule ("writing a hazard down makes nobody check it").

---

## Deletion

Decision: **nothing is deleted by a year rollover, ever, in this design.**
Every system above either (a) keeps its rows forever with a year FILTER
(PR/VS/Shop/Projects), (b) archives instead of deleting (ทีม SAMO, ระบบบ้าน
graduation, Announcements via `archived` status), or (c) was already
permanent by design (Accounts, Passport scans). The only PROSE-level
deletion this doc recommends is VS's text-anonymisation after 24 months
(`## VitalSound`), which scrubs a FIELD, not a row.

Decision: the only ROW-level deletion this doc endorses is
PERSON-triggered, not year-triggered: an account-closure request (someone
asks to be forgotten) follows the EXISTING `public.people` deletion semantics
(`person_id` SET NULL on placements, orphan pruned only if no placement +
never signed in + never confirmed — already built, 0132-era). Year rollover
must never be the trigger for this; conflating "a new team started" with
"delete old people's data" is exactly the kind of decision the owner asked
this doc to make explicitly rather than leave ambiguous, and the explicit
answer is: **decoupled. A year ending deletes nothing about a person.**

Decision: retention defaults, where this doc sets one (VS text scrub: 24
months; `claude_usage_samples` raw: 8 weeks; `analytics_events`: 90 days,
already the existing function's default) are PARAMETERS on the prune
functions, not hardcoded, so the owner can tighten or loosen each
independently without a new migration.

---

## Year-end runbook

The ordered checklist for whoever runs a SAMO-year handover, once tasks
2–11 ship. This becomes `skills/year-rollover.md` verbatim (task 2's job to
extract it there).

1. **Export first.** Run the shared export for PR, VS, Shop, หนังสือโครงการ
   for the OUTGOING year (even though nothing will be deleted — this is the
   point-in-time snapshot a graduating team takes with them).
2. **ทีม SAMO: edit the live tree** to reflect the incoming team's people and
   positions (this already happens continuously, not just at rollover).
3. **Call `start_team_term(new_year)`.** This, in one transaction: closes
   the outgoing `team_terms` row (`ended_at = now()`), opens the incoming one
   (`started_at = now()`, `is_current = true`), and is the single moment
   `current_samo_year()` changes for every trigger in this doc.
4. **`publish_team_term(outgoing_year)`** if not already published this
   term — freezes the org chart snapshot a new reader will browse under
   "last year".
5. **Discord**: confirm the sync has reconciled (≤15 min, automatic); by
   hand, review the `DISCORD_SYNC_ALLOW_POWER` allow-list for anyone who
   just left office (`## Discord`).
6. **ระบบบ้าน**: if a รุ่น has reached ปี 7 this cycle, run the graduation
   step (sets `graduated_at`, flips the admin roster's default filter).
7. **Passport**: if ฝ่ายกิจกรรม wants a new Passport year/season (independent
   calendar, their call), open the new row BEFORE closing the old one — never
   a gap.
8. **Announcements**: the archive-flip job runs automatically at step 3; spot
   check the public feed only shows `approved`.
9. **Confirm nothing was deleted.** This step exists on purpose: the runbook
   for "a new year starts" should never include a delete step, and a reader
   half-remembering some OTHER system's year-end routine (where deletion is
   normal) should see this line and stop.
10. **Tell the incoming team** which dashboards now default to the new year
    and how to look at last year's (`samo-year.js` picker, same control
    everywhere).

---

## Edge cases

1. **A ticket (PR/VS) opened in one year, closed in the next.** Stays filed
   under the OPENING year (`samo_year_be` stored at INSERT, never
   recomputed) — see `## The SAMO year`.
2. **A person in two terms at once** (e.g. an advisor who is also a current
   officer). Unaffected — `samo_year_be` is per-ROW (ticket/order/project),
   never per-person; a person's own identity lives in `people`, permanently.
3. **A staffer who leaves mid-year still holding a grant.** Grants come from
   the LIVE tree, not the term; removing them from `team_members` revokes
   immediately regardless of where the term boundary falls (`## ทีม SAMO`).
4. **A PR ticket edited after its year is archived.** Archival here never
   means "frozen" (`## ทีม SAMO` explicitly keeps past terms editable); a
   correction is always possible, flagged `แก้ไขของปีก่อน` for audit
   visibility.
5. **A rollover run twice** (someone calls `start_team_term` again by
   mistake). The partial unique index on `is_current` already prevents two
   current rows; `start_team_term` should be idempotent-safe by checking
   `year <> current_samo_year()` before acting and refusing a no-op call
   with a clear message, not silently re-opening the same term.
6. **A rollover undone** (need to revert to last year because the new term
   was opened by mistake). Because nothing is DELETED, reverting is just
   calling `start_team_term(old_year)` again — the old term's `ended_at` is
   cleared, the erroneous new term's `started_at` stays recorded (so the
   mistake is visible in history, not erased). Any row that already picked
   up the new `samo_year_be` keeps it — this is the one case where a human
   must manually re-file rows created in the mistaken window, exactly like
   correcting any other mis-filed row.
7. **A year with no term published yet.** `get_public_team_chart`/
   `get_public_team_years` already define this precisely (0105): falls back
   to the live tree for the CURRENT term only; a non-current, unpublished
   year is simply absent from the picker.
8. **Drive files of a deleted row.** Since rows are not deleted by this
   design, this mostly does not arise; where a row IS deleted
   (person-triggered, `## Deletion`), the existing `trashed-drive-file-still-public`
   rule applies — revoke sharing before trashing.
9. **Shop preorders spanning the boundary.** Covered in `## SAMO Shop` —
   in-flight orders keep their original year.
10. **A held ระบบบ้าน row across the ACADEMIC rollover** (not the SAMO-team
    rollover — a different calendar). Unaffected by anything in this doc;
    the existing `follow_up` mechanism (0217) already handles held rows
    independent of team handover.
11. **Master holders.** `master` folds to every permission including
    whatever year-scoped admin screens this doc adds — no special case
    needed, since the fold happens at the permission-check layer, below
    where a year filter applies.
12. **Anonymous (username) accounts of people who graduated.** Unaffected —
    `## Accounts` decouples account lifecycle from year rollover entirely;
    a graduated student's login keeps working until THEY ask to stop using
    it or lose kkumail access, independent of any team handover.
13. **Discord roles after handover.** Self-healing within 15 minutes except
    server-wide power grants (`## Discord`).
14. **A VS ticket merged as a duplicate across a year boundary** (canonical
    ticket from last year, a new duplicate filed this year). The existing
    `duplicate_of` mirror (0074) is unaffected by `samo_year_be` — each
    ticket keeps its OWN filing year, and progress still mirrors from the
    canonical regardless of which year it was filed in.
15. **A project (หนังสือโครงการ) whose ปีงบ and SAMO year disagree** (sent in
    ธันวาคม 2569 under the outgoing team, but ปีงบ 2570 because ต.ค. already
    rolled over). Expected and fine — the two columns measure different
    things on purpose (`## หนังสือโครงการ`).
16. **An admin overrides a row's `samo_year_be` to a year that does not
    exist in `team_terms`.** The column should carry a soft FK-like CHECK
    (`exists (select 1 from team_terms where year = samo_year_be)`) enforced
    at the trigger/RPC level rather than a hard FK, mirroring
    `fiscal_year_be`'s own looseness — a hard FK would block seeding a
    far-future year ahead of time.
17. **Export runs on a year that is still the CURRENT year** (someone exports
    "this year so far" mid-year, not at rollover). Fine — the export
    mechanism in `## Export` is just a filtered read, callable any time, not
    gated to rollover.
18. **Two people run the year-end runbook at the same time.** `start_team_term`'s
    idempotency check (edge case 5) and the partial unique index together
    make a double-run a no-op/clear-error rather than a corrupted state.
19. **A graduating รุ่น (MD49) still has an open ระบบบ้าน `student_change_requests`
    row.** Graduation (`graduated_at`) does not touch `student_change_requests` —
    it is independent bookkeeping; an open request stays open and visible
    until resolved, same as any other student's.
20. **`claude_usage_samples` pruning runs while a booking's window spans the
    prune boundary.** The 8-week retention window (`## Stats`) is far longer
    than any single 5-hour session or weekly cycle, so this cannot happen in
    practice; the prune function should still assert it never deletes a
    sample inside the CURRENT open window, as a defensive check.
21. **A ฝ่าย page is edited by someone who is no longer in that ฝ่าย** (the
    grant lagged the tree change). Unaffected by year rollover; this is the
    existing `dept_page` grant's own responsibility (`## หน้าฝ่าย`), which
    already flows from the live tree like every other permission.
22. **An announcement flipped to `archived` by the rollover job needs to be
    un-archived** (it was actually still relevant). Trivial — `archived` is
    just a status value, same table, flip it back; nothing was deleted.
23. **Passport scans during a gap between SAMO years with no team_term_year
    bridge set yet.** The bridge column (`## Passport`) is nullable and
    set BY HAND when convenient — a scan never fails or is blocked by it
    being unset; it is a reporting convenience, never a gate.
24. **A VS ticket's `problem` text, after anonymisation, is needed for a
    reopened dispute.** The 24-month default (`## VitalSound`) should be
    long enough that this is rare, but if it happens, the pre-scrub EXPORT
    (`## Export`/`## Backup`) is the recovery path — this is exactly why
    export-before-scrub is non-negotiable in this design, not a nice-to-have.
25. **The shared `samo-year.js` picker is asked to render a system that has
    rows from a year with NO `team_terms` row at all** (e.g. historical PR
    tickets from before this design shipped, backfilled with a guessed
    year). The picker must render "ก่อนเริ่มระบบปี" or similar for a
    `samo_year_be` that does not resolve to any `team_terms.year` — the
    unresolvable-reference-fails-open class (2) says this must be handled
    explicitly, not silently coalesced to "current".
26. **Someone deletes a `team_terms` row by mistake** (not just ends it).
    `ON DELETE CASCADE` already exists on `team_archive_nodes`/`_members`
    FKs to `team_terms` (per the existing schema) — deleting a term row
    would destroy its archive. This is pre-existing risk, not new; flagged
    here because every system this doc adds now ALSO loosely references
    `team_terms.year`, so a deleted term year would orphan their
    `samo_year_be` values too (handled by the soft-CHECK in edge case 16,
    which tolerates an unresolvable year rather than erroring).
27. **A new SAMO year is declared mid-way through a quota week for Claude
    booking.** No interaction — `## Claude booking` is explicitly
    week-scoped, not year-scoped; nothing changes.

---

## Build order

Mapped to the reserved migration numbers in the night-queue preamble. Each
task's number below is this queue's task number (this doc is task 1).

| Task | System(s) | Migration(s) | What it builds |
|---|---|---|---|
| 2 | Core SAMO-year infra | 0219 | `team_terms.started_at/ended_at`, `current_samo_year()`, `start_team_term(year)` RPC (replaces ad-hoc `is_current` flips), `src/js/samo-year.js` picker + `currentSamoYear()` |
| 3 | PR | 0220 | `pr_tickets.samo_year_be` + trigger, PR Staff Dashboard year picker (the owner's named example), export button |
| 4 | VitalSound | 0221 | `vs_tickets.samo_year_be` + trigger, year picker in VS staff dashboard, the `prune_analytics`-style scrub function for 24-month text anonymisation (function only — scheduling is task 11's job alongside the other prune jobs) |
| 5 | SAMO Shop | 0222 | `shop_orders.samo_year_be` + trigger keyed on `placed_at`, "ค้างจากปีก่อน" admin filter, export button |
| 6 | หนังสือโครงการ | 0223 | `projects.samo_year_be` + trigger (separate from `fiscal_year_be`), one-time backfill of the 42 existing rows from `created_at`, export button |
| 7 | ทีม SAMO + เกี่ยวกับเรา | 0224 | Confirm `get_public_team_years()`/chart already wired correctly (likely a no-op); extract this doc's `## Year-end runbook` into `skills/year-rollover.md` |
| 8 | ระบบบ้าน | 0225 | `students.graduated_at`, graduation job/button, admin roster default-filter |
| 9 | หน้าฝ่าย | 0226 | Surface `updated_at`/`updated_by` more visibly in the editor (UI only — confirm whether a migration is even needed; may be a no-op here too) |
| 10 | Passport + Accounts | 0227 (Passport bridge column), 0228 (Accounts dashboard year filter) | `passport.samo_years.team_term_year`, `account_dashboard()` optional year filter |
| 11 | Stats/retention + Backup/Export + Announcements | 0229 | Schedule `prune_analytics`/`prune_notify_log`, new `prune_claude_usage_samples`, the shared `samo-year-export.js` + `uploadArchiveFile` GAS action (design only — GAS needs owner redeploy), the Announcements `archived`-flip job |

⛔ **Hard dependency: tasks 3–11 all call `current_samo_year()`, which task
2's migration 0219 creates.** If a later task runs before 0219 has been
written (not necessarily applied — the function only needs to exist in the
migration file this branch carries so the later migration can reference it),
its own migration cannot compile. The queue already assumes sequential
continuation of one branch (CLAUDE.md: "every run CONTINUES `agent/2026-10-14`
… read `git log` first"), so this is a restatement of that existing rule for
this specific case, not a new mechanism — but a task that finds 0219 missing
from `git log` should write a minimal stand-in in its own migration rather
than silently skip the dependency.

Each task should re-read this doc's section for its system before starting,
run `scrutinize` on its own diff, and update `docs/state/HANDOFF.md` §22's
table (below) rather than inventing a new status location.
