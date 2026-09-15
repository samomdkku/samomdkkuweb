# รุ่นรับผิดชอบข้อมูล — ส่งลิสต์ให้ปีการศึกษาไปแก้เอง

**Status: PLAN. Nothing in this file is built.** Written headless, night of
2026-09-15→16, no database access, no Google credentials. Every claim about live
data is copied from `docs/state/phuriphatma.md` (2026-09-15 blocks) and
`STATE.md`, not re-queried — see §5 for what that means for trust.

**The owner's ask, verbatim:** *"I'll ask every admin of every year for these
lists of people... I need a proper format to send each year like MD50, 51, 52,
49 — lists of people who have issues... You'll have to set a rule: can they,
and should they, modify name, surname, student id, sai?... I think Google
Sheets is best... I'm not afraid of one year's data being visible to another;
we're all coworkers."*

Three decisions this plan makes, upfront, so §a–§e below can build on them
without re-arguing:

1. **The audience is a year admin, not ฝ่ายข้อมูล and not the student.**
   `docs/HOUSE-DATA-REPAIR.md` already names two other actors with different
   powers. A year admin is a fourth, and nothing in the repo currently defines
   what one may touch. §a defines it.
2. **One Google Sheet, one tab per รุ่น, not one sheet per รุ่น.** §c defends
   this against the alternative and says what to protect.
3. **The สาย-grid view belongs in the นักศึกษา tab, reusing `gaps.js` and
   `census.js` verbatim** — it computes nothing new. §d.

---

## (a) What a year admin is actually asked to fix

### Who they are, and why they are not one of the existing three actors

`docs/HOUSE-DATA-REPAIR.md` names three: **the student** (self-service via
ข้อมูลของฉัน), **the ระบบบ้าน admin** (approves สาย change requests, promotes
held rows), and **ฝ่ายข้อมูล** (the only source for สายรหัส and the only fix for
an empty seat or an address nobody can supply). A year admin is asked to sit
**between the held-row list and ฝ่ายข้อมูล**: they know their own รุ่น's people
by face and by ชื่อเล่น in a way neither the ระบบบ้าน admin (who has never met
them) nor ฝ่ายข้อมูล (who has a roster, not a classroom) does. That is the whole
justification for looping them in at all — they are a **name resolver**, not a
new data-entry channel.

### The gap classes from `gaps.js`, and which ones a year admin can touch

`src/js/house/gaps.js` already classifies every gap by tone (`act` / `watch` /
`tell` / `setup`). Mapping the row's `key` to what a year admin can do with it:

| `gaps.js` key | What it is | Year admin can... |
|---|---|---|
| `held_admin` | no รหัส in the file, or held row has no ชื่อ | **Only this one is genuinely theirs.** They recognise the person, supply the missing รหัส or confirm the ชื่อ, or say "this สาย has nobody, ask ฝ่ายข้อมูล." This is the one row of the sheet where they add information, not just check it. |
| `held_self` | held, but has both รหัส and ชื่อ — self-claimable | **Tell the person to sign in.** Nothing to fill in; the sheet cell for these rows should say "ยังไม่เข้าระบบ — บอกให้ล็อกอินด้วย kkumail" and stay READ-ONLY. A year admin who "fixes" this by typing the person's kkumail into the sheet has no authority to create that binding — only the person's own Google sign-in does, per `docs/HOUSE-DATA-REPAIR.md` §3. |
| `no_sai` | student row, no สาย | **Flag it, never fill it.** สาย is university-assigned, never derived (`house-data-spec-th.md`: "ห้ามเดา ห้ามคำนวณเอง"). A year admin does not have the source of truth any more than we do — they can say "I know this person is in สาย 042" only if they are quoting the university's own assignment, and the sheet should record that as a claim for ฝ่ายข้อมูล to confirm, not as a direct write. |
| `no_name` / `no_nick` | student row missing ชื่อ/นามสกุล/ชื่อเล่น | **They may suggest it**, but the student's own edit always wins and is what actually lands in the database (`update_my_identity`, self-service, §b explains why the sheet does not write these fields directly). |
| `sai_shared` / `sai_gap` / `sai_across` | file-level สาย arithmetic anomalies | **Not theirs at all.** These are statements about the uploaded FILE (`gaps.js`'s own comment: "a statement about the FILE, not about the students... แก้ที่ไฟล์แล้วนำเข้าใหม่ อย่าแก้ทีละคน"). A year admin has no way to see the whole file and should never be asked to explain a gap that spans several รุ่น — that is `docs/mistakes` class 6 territory, drifting two owners.
| `no_sid` | student self-fixes | Not the year admin's job; already tell-tone. |

**The one-sentence rule for the whole sheet:** a year admin **confirms identity
and flags absence**; they never author a สาย, and they never substitute for the
person's own sign-in. Every column in §b either follows from this or is
read-only context.

---

## (b) The per-รุ่น sheet format

One tab per รุ่น (MD49, MD50, MD51, MD52, ...). Columns, in order:

| # | Column | Source | Editable by year admin? | Should they? | If they change it |
|---|---|---|---|---|---|
| 1 | รหัสนักศึกษา | `students.student_id` or held row's `student_id` | **No** | — | Read-only anchor column. A year admin who "corrects" a รหัส here has no channel back into the database from a downloaded CSV that touches this column — see §c for why. If they believe it is wrong, they write the correct value into column 9 (หมายเหตุ) instead of overwriting column 1, so ฝ่ายข้อมูล can see BOTH the file's value and the correction side by side. |
| 2 | ชื่อ (จากระบบ) | `students.first_name_th` / held `first_name_th` | **No** | — | Same reasoning as above. This is what the SYSTEM currently has, which may be blank (held row) or self-edited (student row). |
| 3 | นามสกุล (จากระบบ) | ditto | **No** | — | Per `HOUSE-DATA-REPAIR.md` §1, นามสกุล gates nothing — but it still should not be overwritten from a spreadsheet cell with no audit trail. Same หมายเหตุ path. |
| 4 | ชื่อเล่น | `nickOf()` (census.js) | **No, write in หมายเหตุ** | Low stakes (`HOUSE-DATA-REPAIR.md`: "ไม่ต้องทำอะไร เจ้าตัวกรอกเองได้") but still routed through the same single door as the identity fields, so the sheet has ONE rule, not one rule per column that happens to be safe today and unsafe tomorrow if a column's meaning changes. |
| 5 | สาย | `saiOf()` | **No** | **Never** | ⛔ The one column where a casual edit is dangerous: บ้าน is the last digit, so a wrong value here silently misplaces a real student's house if it were ever re-imported blind. The sheet should show it read-only, bold, with a note: "ห้ามแก้ — ถ้าเลขนี้ผิด ให้เขียนใน หมายเหตุ พร้อมแหล่งที่มา (เช่น 'อาจารย์ที่ปรึกษาบอกว่าเป็นสาย 042')." |
| 6 | บ้าน | `houseOf(sai)` | **No** | — | Derived; showing it lets the year admin sanity-check "this person's house looks wrong" without exposing the calculation as editable. |
| 7 | สถานะ | one of: `ปกติ` / `ค้างนำเข้า (ไม่มี kkumail)` / `ยืนยันตัวตนเองได้แล้ว รอเข้าระบบ` / `ไม่มีในไฟล์เลย` | computed from `gaps.js` groups | **No** | — | This is the "highlight the problem" column the owner asked for, in words instead of colour (Sheets colour does not survive a CSV round-trip — see §c). |
| 8 | kkumail (ถ้ามีในระบบ) | `students.kkumail` | **No, and blank for held rows** | — | Shown ONLY if it already exists, so the year admin can visually confirm "yes that's the right person." **Never a fill-in column** — see §c for why kkumail specifically must never travel through this sheet. |
| 9 | หมายเหตุ (เขียนที่นี่ได้) | blank | **Yes — the only writable column** | **Yes, this is the whole point of sending the sheet** | Free text. This is where "ไม่มีคนนี้แล้ว ย้ายคณะไปแล้ว", "รหัสนี้ผิด น่าจะเป็น 659999999-8", "สายรหัสนี้ตามที่แจ้งคืออาจารย์ X" all go. ฝ่ายข้อมูลหรือแอดมินอ่านคอลัมน์นี้แล้วตัดสินใจว่าจะแก้อะไรใน "ระบบจริง" — the sheet never writes back automatically. |

### The rule, stated once, for ชื่อ / นามสกุล / ชื่อเล่น / รหัสนักศึกษา / สาย

**No column in this sheet is a write path.** Every one of the five fields the
owner named is either self-service (student signs in and edits — ชื่อ, นามสกุล,
ชื่อเล่น, รหัส, per `HOUSE-DATA-REPAIR.md` Case A) or admin/ฝ่ายข้อมูล-only
(สาย). A year admin has neither channel. Giving them a spreadsheet cell that
*looks* editable but silently does nothing when the CSV comes back is worse
than not asking — so the sheet does not pretend: five columns are visibly
locked (Sheets range protection, §c), and the ONE column that is writable
(หมายเหตุ) is explicitly a **message to a human**, not a database field.

**Why this is stricter than "should they" implies room for debate.** The owner
asked the right question — can/should they modify these fields — and the
honest answer for all five is "no, not directly," because:
- kkumail wrong is the unrecoverable error (`house-data-spec-th.md`, verbatim);
  routing a kkumail *correction* through a year admin's spreadcell, unaudited,
  recreates exactly the risk the whole self-claim design (§3 of
  `HOUSE-DATA-REPAIR.md`) exists to avoid — a wrong address to a real person.
- สาย wrong misplaces a real house; `docs/mistakes/postgres-schema.md` and this
  repo's own import tooling refuse to let ANYONE, including an ระบบบ้าน admin,
  free-hand it (`sai_self_edit_open` is vestigial by design).
- รหัส/ชื่อ/นามสกุล/ชื่อเล่น are already self-service, and a second write path
  (spreadsheet → some importer) for fields that already have a first one
  (`update_my_identity`) is the exact "two implementations of one rule drift"
  shape `.claude/rules/mistakes.md` class 6 warns about, before a single line
  of code exists to drift.

If a correction genuinely cannot wait for the student to sign in (e.g. someone
who withdrew and will never sign in again), that is a การส่งข้อมูลเพิ่มเติม
matter for ฝ่ายข้อมูล's next file — not a new admin write path built to route
around them.

---

## (c) The Google Sheets workflow

### One sheet, tab per รุ่น — and the alternative rejected

**Rejected: one Google Sheet per รุ่น.** Reasons against:
- Ten-plus sheets to create, share, and track responses on, by hand, every
  cycle — direct multiplication of the owner's own manual step ("I'll ask every
  admin"), for no benefit that a tab doesn't already give.
- The owner explicitly said cross-year visibility is fine ("not afraid of one
  year's data being visible to another; we're all coworkers"), so the one
  reason to split (isolation) does not apply.
- Google Sheets tab-level protection (see below) achieves the SAME per-year
  write boundary a separate file would, without the multiplication.

**Chosen: one spreadsheet, one tab per รุ่น**, named exactly `MD49`, `MD50`,
`MD51`, `MD52` (matching `cohortLabel()`'s output format from `fields.js`, so a
human copying a tab name into anything downstream does not have to translate
it). A ภาพรวม tab at position 1 lists every year admin's name + which tab is
theirs + a one-line version of §a/§b's rules in Thai, so the rules travel with
the file instead of living only in an email.

### What a human does by hand (no Google credentials here)

1. **Create the spreadsheet** — the owner's Google account, not the SAMO
   service account (there isn't one with Sheets access).
2. **One tab per รุ่น**, columns as in §b, generated from the CURRENT database
   state. This plan cannot generate that CSV tonight — §5 says why.
3. **Protect ranges**, per tab: select columns 1–8, `Data → Protected sheets
   and ranges → Protect range`, restrict to "Only you" (the owner) or a small
   admin group, NOT the year admin being sent the tab. Column 9 (หมายเหตุ) stays
   unprotected. This is what makes the "no column is a write path" rule from
   §b actually hold at the tool level rather than only in the instructions
   text a year admin may not read.
4. **Share per tab, not per file** — Google Sheets supports sharing individual
   tabs' edit access differently from the rest only via `File → Share → manage
   access`, tab-level link sharing (or by protecting the OTHER tabs against
   the person being invited). Concretely: invite each year admin with **Editor**
   access to the whole file (so they benefit from the "not afraid to see other
   years" stance) but rely on the range protection in step 3, not tab-level
   restriction, to stop them from touching anyone else's ranges. This is
   simpler to operate than juggling per-tab permission sets and matches what
   the owner actually asked for (visible, not necessarily writable, across
   years).
5. **Collection**: `File → Download → Comma Separated Values (.csv)`, once per
   tab, after admins report they're done (there is no way to poll this without
   Sheets API access, which nobody in this loop has tonight — see §5). Owner
   downloads each tab separately (Sheets does not export multi-tab to one CSV).
6. **What the owner runs on it**: nothing exists yet to consume this CSV. It
   needs a new tool, `tools/house-year-notes-import.mjs` (not built tonight —
   §5), that reads column 9 per row and drops the notes into a new table
   (proposed: `house_year_admin_notes(student_id, sai, note, cohort, imported_at)`)
   for a human to triage — **it must never auto-apply a note as a database
   write**, per §b's core rule.

### Colour, in a downloadable format

The owner asked for Sheets so they "can see in real time who fills it in" —
that live-view benefit is real and this plan keeps it (conditional formatting
rules can shade a row by สถานะ, live, in Sheets itself: `Format → Conditional
formatting → Custom formula`, one rule per สถานะ value). But colour is a
Sheets-only signal — it does **not** survive `File → Download → CSV`, so the
สถานะ column (§b #7) carries the same information in TEXT, which is what
actually matters once the file is downloaded and read by a script or a human.
This is the same principle as (d)'s colour-coded UI: colour is a hint layered
on top of a value that is legible without it, never the only carrier.

---

## (d) The UI — นักศึกษา tab, สาย grid by รุ่น

### What the owner described

*"like how the file has it — e.g. MD50 list from สาย 001, 002… and highlight in
colour what information is missing. Like this สาย has nobody, data missing,
error etc."*

This is a **grid, not a table**: pick a รุ่น, see every สาย in numeric order
(001..N), one cell per สาย, coloured by what's wrong with its occupant(s) — a
different view from the existing นักศึกษา table (which lists people, filterable
but not laid out by สาย) and from ข้อมูลไม่ครบ (which lists gap GROUPS, not a
per-สาย grid). It complements both rather than replacing either.

### Design

- **Control row**: a รุ่น picker (`<input list>` combobox, matching the
  existing `houseFilterYear` convention in `tab-house.html:149` rather than a
  `<select>` — there is no fixed rุ่น count).
- **Grid**: one cell per สาย from `001` to `max(สาย in this รุ่น)`, in a
  responsive wrap (CSS grid or flex-wrap of small badges/cards), sorted
  numerically. Each cell shows the สาย number and, space permitting, the
  occupant's ชื่อ or ชื่อเล่น.
- **Colour states**, reusing the existing tone-to-Bootstrap-class map already
  defined at `src/js/house/index.js:322-325` (`TONE.act` → danger,
  `TONE.watch` → warning, `TONE.tell` → info, `TONE.setup` → secondary) so this
  view does not invent a second colour vocabulary next to the one ข้อมูลไม่ครบ
  already trained the admin on:

| Cell state | Colour (existing class) | Condition, computed from |
|---|---|---|
| ปกติ, มีคนครบ | none / `bg-success-subtle` | a `students` row occupies this สาย with no gap in `fieldHealth()` |
| ไม่มีใครอยู่ | `bg-secondary-subtle` (setup tone) | สาย exists in `sais` for this รุ่น's range but no `students`/`held` row claims it — same set `gaps.js` already computes as `sai_empty`, scoped to this รุ่น |
| มีคนแต่ข้อมูลไม่ครบ | `bg-warning-subtle` (watch tone) | occupant is in `noSai`/`noName`/`noNick` etc. from `gaps.js` |
| ค้างนำเข้า (ไม่มี kkumail) | `bg-danger-subtle` (act tone) | occupant is a held row (`heldAdmin` or `heldSelf`) — this is the group `gaps.js` already marks `act`/`tell` |
| ซ้ำ — สายนี้มีมากกว่าหนึ่งคน | a distinct hatch/border treatment, NOT just a colour, since two people can each individually be "ปกติ" and the problem is only visible as a COUNT | `saiShared` rows from `gaps.js`, scoped to this รุ่น |

### Which module supplies each number — reuse, do not recompute

- **Occupancy per สาย, per รุ่น**: `gaps.js`'s own `byCohort` map (lines 94-103)
  already groups `[...students, ...held]` by `cohortLabel()` and indexes by
  สาย number — this exact structure is what the grid iterates. It is currently
  a local variable inside `computeGaps()`; the grid needs it exported (either
  as a new named export `groupBySaiPerCohort(d)` factored out of the existing
  loop, or by having `computeGaps` return `byCohort` alongside `groups`) rather
  than reimplemented, which is the one code change this plan asks for outside
  the sheet/doc work — and it is a refactor-for-reuse, not new logic.
- **Per-person field completeness**: `census.js`'s `fieldHealth()` — already
  pure, already takes `(students, held)`, already used by ข้อมูลไม่ครบ.
- **บ้าน for a สาย**: `houseOf()` in `fields.js`.
- **รุ่น label for a person**: `cohortLabel()` in `fields.js`.

No new computation is proposed. The grid is a new RENDERING of numbers that
already exist, which is deliberate: this screen's whole reason to exist is to
show the same facts ข้อมูลไม่ครบ already knows, laid out the way a year admin
mentally files their students (by สาย), not as a flat list.

### Avoiding the 2026-09-15 defect (label asserting an unchecked cause)

`docs/mistakes/frontend-ui.md`'s ธีรภัทร entry: a line read "ไม่ได้อยู่ในไฟล์"
(absent from the file) when the actual computation only knew "no สาย, no
บ้าน" — a subtraction that could not distinguish "held, waiting" from "never
sent." The generalisable rule it states: **"A label claims something about
EVERY case it covers. Before writing one, ask which expression tests that
claim."**

Applied here: the grid must never render a cell that says something like "ไม่
เคยส่งมาเลย" (never sent) unless the underlying data can actually distinguish
that from "held, waiting on kkumail" — and per `HOUSE-DATA-REPAIR.md` §4 (Case
C2/C3), there is at least one real state — a wrong-but-existing kkumail — that
LOOKS like "ปกติ" and is not detectable by this grid at all. So:
- Cell labels are named after what was CHECKED (`ค้างนำเข้า` — held, matches a
  real row in `student_import_unresolved`), never after an unverifiable cause
  ("ไม่มีในไฟล์" is banned wording for exactly the reason the mistake write-up
  gives).
- The "ไม่มีใครอยู่" (empty) state must, per `gaps.js`'s own existing warning
  (lines 84-89, "a warning that fires on the healthy case"), be computed
  against `[...students, ...held]`, never `students` alone — reusing
  `byCohort` gets this for free since it is already built that way; a
  from-scratch reimplementation would very likely reintroduce the exact bug
  `gaps.test.js` already guards against.
- A short caption under the grid states the one thing it CANNOT see: "หน้านี้
  แสดงเฉพาะคนที่ไฟล์ระบุสายไว้แล้ว การ์ดที่ดูปกติอาจเป็นคนละคนกับ kkumail ที่ผูก
  ไว้จริง — ดูหัวข้อ 'ยืนยันตัวตนไม่ผ่าน' ประกอบ" (mirroring HOUSE-DATA-REPAIR.md
  §4's C2/C3 caveat, so a year admin reading the grid isn't given false
  confidence about a failure mode the grid structurally cannot show).

### Not building tonight

No code is written for this task — the instruction for task 1 is plan-only.
This section is a spec for whoever picks it up next, sized so that
implementation is "add one export to `gaps.js`, add one render function and
one HTML section to `tab-house.html`/`index.js`, no new query, no migration."

---

## (e) What I could not verify — read this before acting on any number above

**No database access tonight.** Every count in this document (48 MDI/RT, 1
ธีรภัทร-shaped case, 155 held, etc.) is copied from `docs/state/phuriphatma.md`
and `STATE.md`, both dated 2026-09-15, and may already be stale by the time
this is read — house imports and repairs ran multiple times on that single day.
**Before generating the actual per-รุ่น CSVs, re-run `npm run house:gaps`
and cross-check against `phuriphatma.md`'s latest HANDOFF block; do not copy
counts out of this file.**

**Assumptions this plan makes that a live check should confirm or correct:**

1. **สาย numbering is dense per รุ่น (1..N, one person each) except for known
   gaps.** The grid design in §d assumes iterating `001..max` is a reasonable
   grid size. If a รุ่น's สาย numbers are sparse across a wide range (e.g. 001
   and 900 with nothing between), the grid becomes mostly empty cells — worth
   checking `saiGaps`/`max` per รุ่น from a live `npm run house:gaps` output
   before building the UI, not assumed from the one 2026-09-14 import's shape.
2. **The MDI/RT gap (48 people, `phuriphatma.md` "case A") is orthogonal to
   this whole plan.** Those 48 are ทีม SAMO members with no house placement
   because ฝ่ายข้อมูล's roster is 1,775 MD rows and zero MDI/RT — a per-รุ่น
   sheet cannot surface people who were never assigned a รุ่น label at all.
   **This plan does not fix that gap**; it is a separate, already-identified
   ask for ฝ่ายข้อมูล (per the existing handoff note: "ask this in the same
   message as the สาย 141/256 question"). Do not fold it into the year-admin
   sheet rollout without deciding separately whether MDI/RT even HAS
   year-admin equivalents to send a sheet to.
3. **"Year admin" as a role does not exist anywhere in the codebase.** There is
   no `role` value, no `permissions` entry, no seat for it (checked:
   `src/js/team/fields.js`, `docs/CONTEXT.md`'s auth model references only
   `vp_admin` / `dev` / `permissions[]`). This plan assumes the sheet is sent
   OUTSIDE the app entirely (a Google Sheets share, not an in-app grant), which
   sidesteps needing one — confirm that's acceptable before anyone starts
   building an in-app "year admin" login, which would be much bigger than what
   was asked for.
4. **I did not verify how many รุ่น currently have data** (`phuriphatma.md`
   mentions MD49–MD52 by name in the owner's own quote, and STATE.md mentions
   ten houses and 306 สาย, but not how many distinct รุ่น labels exist in
   `students` today). Run `select cohort_year, count(*) from students group by
   1 order by 1` (read-only) before creating tabs, so the spreadsheet has the
   right number of tabs from the start rather than needing tabs added later
   once admins are already looking at it.
5. **Whether year admins already have any kind of shared account or personal
   kkumail-based Google identity to invite to a Sheet is unknown to me** —
   `docs/mistakes/depts-use-shared-accounts.md`-style precedent
   ([[depts-use-shared-accounts]] in memory) suggests ฝ่าย use shared accounts,
   but a "year admin" is a person, not a ฝ่าย, and the owner's own phrasing
   ("I'll ask every admin of every year") implies these are individuals to be
   invited by personal email, which the owner will have and I do not.

---

## วิธีทดสอบ — the two screens the owner asked how to test

**The owner's question, verbatim:** *"How do I test what a person who has a
kkumail but is NOT in ระบบบ้าน sees? How do I test the เจ้าตัวยืนยันเองได้
เมื่อเข้าสู่ระบบ flow? All of it is weak."*

They are right that it was weak — not because the logic was untested, but
because nothing in the repo said WHERE each piece was tested, so the only way
to check any of it looked like "become one of ~1,800 real students." It is
not. This section traces the actual code (front end: `src/js/house/my-house.js`
+ `src/js/house/api.js`; back end: `claim_my_student_seat` and its neighbours in
`supabase/migrations/0188…0192`), lists every distinct outcome, says which
automated test now pins it, and gives numbered steps for the two outcomes that
genuinely need a real signed-in browser.

Written headless, no database access, no live session — the enumeration below
was built by reading the RPC bodies and the render function, not by running
either. Where I could add a test tonight, I did (`git log` on this commit for
the diff); where I could not, I wrote the manual recipe instead.

### 0. The two landing states, and how a signed-in user with no `students` row
   is told apart from one that is simply missing data

`src/js/main.js:844-853` calls
`showMyHouse(houseHost, user.id, { signedIn: true, account: user.email })`
whenever the signed-in user holds no ทีม SAMO posting (a posting paints the
house card differently — `{ mode: 'section' }` — because the identity is
already shown above it; see §(a)/§(b) above for that split). `signedIn` and
`account` are the ONLY two facts `renderMyHouse` (my-house.js:730) is given
about someone with no `students` row — no database read happens before this
decision, because there is nothing to read yet. `emptyHouseHtml()`
(my-house.js:583) then branches on exactly one regex:
`/@kkumail\.com$/i.test(mail) || /@kku\.ac\.th$/i.test(mail)`.

### 1. Every distinct outcome

| # | Outcome | Where it is decided | Message / behaviour | Covered by |
|---|---|---|---|---|
| 1 | **Signed out** | `renderMyHouse(host, null)` with no `opts.signedIn` | Card stays `hidden`, no markup at all | `my-house.test.js` → "renders nothing at all for a student who is not in the table" |
| 2 | **Signed in, NOT a kkumail-looking account** (gmail, or username/password) | `emptyHouseHtml()`'s `isKku` regex | "ระบบบ้านใช้บัญชี kkumail…ออกจากระบบแล้วเข้าสู่ระบบใหม่ด้วย Google" — no claim form offered at all | `my-house.test.js` → "a NON-kkumail account does not get it" |
| 3 | **Signed in, kkumail-looking account, no `students` row yet** | same branch, `isKku` true | Claim form (`data-house-form="claim"`) + a hidden receipt slot | `my-house.test.js` → "a kkumail account gets the claim form" |
| 4 | **Claim form: both fields left blank** | `wireClaim`'s `if (!sid \|\| !first)` | "กรอกทั้งรหัสนักศึกษาและชื่อจริง", no server call | `my-house.test.js` → new "wireClaim — every branch a submit can take" describe block |
| 5 | **Claim form: รหัสนักศึกษา not 10 digits** | `wireClaim`, `normalizeStudentId(sid).ok` false | "รหัสนักศึกษาต้องเป็นตัวเลข 10 หลัก เช่น 659999999-9", no server call — deliberately a DIFFERENT sentence from outcome 8, because this is a typo, not a guess (0191's anti-enumeration property only has to hold once the input is well-formed) | same describe block |
| 6 | **NOT FOUND** — no held row matches | `claim_my_student_seat`, `if not found` (0191 §2) | `{ok:false, message:'ยังไม่พบรายชื่อ…'}`; a `house_help_requests` row is filed server-side with kind `no_record` | `api.test.js` → "NOT FOUND (incl. wrong รหัส / wrong ชื่อ)" |
| 7 | **WRONG รหัส, right ชื่อ** | same branch — the match is `student_id_key(...) AND name_key(...)`, so a mismatch on either half takes the SAME exit | Identical message to outcome 6 — **by design**, so the form cannot be used to test one guess at a time (0191's own comment; proved server-side in `tools/house0191-help-requests.sql` §20-22) | Same `api.test.js` case; the ABSENCE of a test that tries to tell 6/7/right-code-wrong-name apart is itself the assertion (see the comment above that test) |
| 8 | **right รหัส, WRONG ชื่อ** | same branch | Identical message to outcome 6 | Same as above |
| 9 | **ALREADY CLAIMED** — caller's kkumail already has a `students` row | `claim_my_student_seat`, checked BEFORE the held-row lookup (0191 §2, first `if exists`) | Throws `'บัญชีนี้มีข้อมูลนักศึกษาอยู่แล้ว'` — the UI never shows this account the form in the first place (outcome 3's gate is "no row yet"), so this is reachable only by a stale card + a race, or a direct RPC call | `api.test.js` → "ALREADY CLAIMED" |
| 10 | **NOT A KKUMAIL ACCOUNT, at the server** | `claim_my_student_seat`, checked before outcome 9 | Throws `'ต้องเข้าสู่ระบบด้วยบัญชี @kkumail.com ก่อน…'` — again UI-unreachable in the normal flow (outcome 2's gate already hides the form), kept as a server-side belt-and-braces check | `api.test.js` → "NOT A KKUMAIL ACCOUNT" |
| 11 | **NOT SIGNED IN, at the server** | `claim_my_student_seat`, `if v_uid is null` | Throws `'ต้องเข้าสู่ระบบก่อน'` | `api.test.js` → "NOT SIGNED IN" |
| 12 | **FOUND — match succeeds** | `claim_my_student_seat`, `insert into students` | `{ok:true, sai}`; front end clears the module-scope cache and repaints the real card (`clearMyHouseCache()` before `showMyHouse()` — this ordering is what 0188's own regression note calls "the stale-instrument shape" if it is skipped) | `api.test.js` → "FOUND"; `my-house.test.js` → "clears the cache before repainting after a successful claim" |
| 13 | **The receipt: nothing filed yet** | `paintHelpReceipt()`, `fetchMyHelpStatus()` returns `null` | Receipt slot stays `hidden` | `my-house.test.js` → "the empty card reserves a slot for it, hidden until there is one" |
| 14 | **The receipt: a miss was filed, < 7 days ago** | same, `waiting_days < 7` | "ผู้ดูแลระบบบ้านได้รับเรื่องของคุณแล้ว…", no VitalSound link | `my-house.test.js` → "the receipt" describe block |
| 15 | **The receipt: ≥ 7 days waiting** | same, `stale` | Same line + "รอมา N วันแล้ว…VitalSound (เลือกหมวด IT)" | same block, "VitalSound appears ONLY in the receipt path" |
| 16 | **The receipt lookup itself fails** (network, RLS, anything) | `fetchMyHelpStatus()`'s own `catch` in `api.js` | Swallowed to `null` — the empty card is not allowed to show a SECOND error about the receipt for the first missing record | `api.test.js` → "NEVER throws" |
| 17 | **A found record that is not actually theirs** (Case C2, `docs/HOUSE-DATA-REPAIR.md` §4 — the wrong-kkumail case that fails OPEN) | populated card → "ไม่ใช่ข้อมูลของฉัน" → `report_not_my_record` | Files a `house_help_requests` row (`kind:'not_me'`) and changes nothing; "แจ้งแล้ว ผู้ดูแลจะติดต่อกลับ" | `my-house.test.js` → "ไม่ใช่ข้อมูลของฉัน" describe block; `api.test.js` → `reportNotMyRecord` describe block |
| 18 | **Populated card — kkumail correct, `students` row exists** | `renderMyHouse(host, rec)` | Full record, edit form (Case A self-service fields), แจ้งสายรหัสไม่ถูกต้อง | The pre-existing bulk of `my-house.test.js` (unchanged tonight) |

### 2. What still needs a real browser, and exactly how to do it in under five minutes

Everything above outcome 12 in the table is proven either as a rendering
property (a plain-object `host`, no DOM) or as a request/response contract
(`dbRest` mocked). Two things those cannot prove:

**(A) That the empty-card / non-kkumail branches actually PAINT correctly in a
real browser** — needs no database at all, because `renderMyHouse` makes no
network call on its own (only the receipt and the claim submit do). On
`npm run dev` (samo-dev, never production), once signed in as anybody:

1. Open the browser devtools console on the page.
2. `const m = await import('/src/js/house/my-house.js')`
3. `const el = document.getElementById('homeMyHouse')`
4. `m.renderMyHouse(el, null, { signedIn: true, account: 'anything@gmail.com' })`
   → outcome 2, the "switch account" card.
5. `m.renderMyHouse(el, null, { signedIn: true, account: 'anything@kkumail.com' })`
   → outcome 3, the claim form + a receipt slot that will quietly try (and
   likely fail, harmlessly) to load a receipt for whichever account you are
   REALLY signed in as — that failure is outcome 16 and is expected.
6. Refresh the page when done — this only touched the DOM, not the database.

**(B) That a real self-claim round-trip actually works end to end** — this is
the one outcome (12, plus 6-8 as its failed attempts) that needs a genuine
`claim_my_student_seat` call against a held row that exists. It needs no
production data and no real student: `tools/house-claim-flow-manual-seed.sql`
creates one obviously-fake held seat (รหัส `000000001-1`, ชื่อ "ทดสอบ
ระบบบ้าน", สาย `999`) against **samo-dev only**.

1. `VITE_SUPABASE_URL=$SUPABASE_DEV_URL node tools/db-query.mjs tools/house-claim-flow-manual-seed.sql`
   — confirm the stderr line says `(samo-dev)`, not `(PRODUCTION)`, before
   doing anything else (`docs/mistakes/tooling-proofs.md`'s npm-run-flag-trap
   entry is the exact shape of getting this backwards).
2. `npm run dev` (this already targets samo-dev — `docs/state/…` /
   `contributor-credentials`) and sign in with any spare **@kkumail.com**
   account that is not already a student (does not need to be a real MDKKU
   student — only the domain is checked).
3. On the home page, find "บ้านของฉัน" — it should show the claim form
   (outcome 3).
4. Type a wrong รหัส or ชื่อ first (e.g. `000000001-1` / `ไม่ใช่ชื่อนี้`) and
   submit — confirm you get the neutral "ยังไม่พบรายชื่อ…" sentence (outcome
   6/7/8, indistinguishable on purpose).
5. Now type the real pair — รหัส `000000001-1`, ชื่อ `ทดสอบ` — and submit.
   Expect "พบข้อมูลของคุณแล้ว กำลังโหลด…" and then a real การ์ด for สาย 999 /
   MD50 (outcome 12).
6. `VITE_SUPABASE_URL=$SUPABASE_DEV_URL node tools/db-query.mjs tools/house-claim-flow-manual-cleanup.sql`
   to remove the fake seat/student/help-request rows. Re-run the seed script
   to test again (e.g. a second account, to see outcome 9 — sign in with the
   SAME account and submit the claim form again, or call
   `claim_my_student_seat` a second time, and confirm outcome 9's exception
   text).

**Not given a live-session recipe, on purpose:** outcomes 9, 10 and 11 are
server-only guards the UI structurally cannot reach in the ordinary flow (the
form is hidden before the request could ever be sent) — `api.test.js` is the
right and sufficient place to pin them, and a live reproduction would need to
force a race the UI does not have a button for.

### 3. What I did NOT verify

I have not run either SQL script above — no database access tonight. Before
trusting the seed script, read it once; it commits (does not roll back) by
design, since a rolled-back transaction leaves nothing for a browser to see.
If `sais.code = '999'` ever becomes a real assignment, change the seed script's
code before running it — a `999` colliding with a real สาย would misfile a
real house student the moment cleanup ran.
