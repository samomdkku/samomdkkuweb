# รุ่นรับผิดชอบข้อมูล — ส่งลิสต์ให้ปีการศึกษาไปแก้เอง

**Status: PLAN, with TWO pieces now built, both against §d/§c's design below —
this file is the spec they were built from, kept as the design record.**
Written headless, night of 2026-09-15→16, no database access, no Google
credentials. Every claim about live data is copied from
`docs/state/phuriphatma.md` (2026-09-15 blocks) and `STATE.md`, not re-queried
— see §5 for what that means for trust.

✅ **`tools/house-year-sheets.mjs` exists** (same night, second pass) — the CSV
generator §c step 2 said could not be written yet. It reuses `splitHeld()`
(factored out of `src/js/house/gaps.js` for exactly this) so the sheet and
ข้อมูลไม่ครบ classify a held row identically, dry-runs by default, and refuses to
overwrite an existing file without `--force`. Pinned by
`tools/house-year-sheets.test.js` over fixtures — **the live run against real
data is still unverified**, per §5 below; the owner runs it with credentials
this repo does not have. It does NOT emit the "ไม่มีในไฟล์เลย" empty-สาย row
(§5 assumption 1 is still open) — every row it writes corresponds to an actual
person. A later pass caught it silently dropping ชื่อเล่น for held rows
(`nickname_imported` missing from the SELECT) — fixed, and again reviewed and
source-guarded (a fixture test cannot see a bug that lives only in the SQL
string; a second test now reads the tool's own source text for the column
name). Write-ups: `docs/mistakes/tooling-proofs.md`.

✅ **The สาย-grid UI (§d below) is built** (2026-09-16, `src/js/house/sai-grid.js`
+ `tab-house.html`'s ผังตามสาย toggle) — matches this spec: reuses
`groupOccupantsByCohort`/`splitHeld` from `gaps.js` and `FIELDS`/`has` from
`census.js`, worst-state-wins per cell, a separate `duplicate` flag rather than
collapsing two occupants into one state, and the same "name only what was
checked" label discipline §d asks for. Tests + build green.
⚠️ **Still unseen in a real browser** — no DB credentials tonight, so nobody has
loaded it against production data; do that before telling a year admin about it.
⚠️ **Three review passes found the same drift shape three times**:
`computeCensus()` (census.js) and, separately, `computeSaiGrid()`
(sai-grid.js) each initially re-typed `splitHeld()`'s two-line predicate
instead of importing it; a THIRD pass then found `computeSaiGrid()` had also
re-typed the numeric-สาย grouping `computeGaps()` already ran for its
`sai_gap`/`sai_shared` groups, and that its own file header mis-cited that
state as matching `sai_empty` (a different table, a different question) —
all three harmless only because nobody had touched the copies since they were
written. All fixed to import the real function (`splitHeld()`, now also
`groupBySaiNumber()`, both exported from `gaps.js`); all three now carry a
differential test in `sai-grid.test.js`. Write-ups: `docs/mistakes/app-state.md`
(three entries, same feature).

**Not yet built**: the Sheet itself (§c — needs a human with a Google account),
the admin-UI download button that would let any admin generate the CSVs
without a terminal + DB credentials (§"ขั้นตอนการทำงานทั้งหมด" step 1), and the
import-back tool for หมายเหตุ notes (§c step 6 — and §5 of that section argues
against ever building it as an auto-apply path).

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
   state. ✅ **Now: `npm run house:year-sheets -- --apply`** writes one CSV per
   รุ่น into `externaldata/house-year-sheets/` (gitignored — never move a
   generated file under `src/`/`docs/`/`tools/`, never commit one); paste each
   into its own tab, named to match the CSV's filename. Copy row 1 in as the
   header exactly — `HEADER` in the tool is the source of truth for the nine
   column names, not this table. Held rows with no รหัสนักศึกษา and no
   cohort_year land in `_unplaced.csv`, not a รุ่น tab (§5 point 2's 13-ish
   people) — hand that one to ฝ่ายข้อมูล directly, not to a year admin.
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

### Built — update, not the original plan-only claim

This section was originally written as a spec for "whoever picks it up next,"
with no code planned that night. It was in fact picked up the following night
(2026-09-16): `src/js/house/sai-grid.js` + a ผังตามสาย toggle in
`tab-house.html`/`index.js`, matching the design above (occupancy from
`groupOccupantsByCohort`, completeness from `FIELDS`/`has`, no new query, no
migration, colour states scoped to a WORST-WINS per-cell rule this spec did not
fully pin down but the implementation had to choose — see `sai-grid.js`'s own
file header for the resulting priority order). The label-defect avoidance
described below was followed. ⚠️ `sai-grid.js`'s header also cites a
`docs/state/agent-notes/2026-09-15-label-audit.md` as having found three more
sites of the same shape — **that file does not exist on this branch** (it
lives only on a sibling branch, `agent/2026-09-15-real-run`, never merged
here); `docs/state/agent-notes/2026-09-16-notes.md` already recorded this gap
and the decision to proceed on `.claude/rules/mistakes.md` class 4 plus this
very §(d) instead. Anyone merging that sibling branch in should diff its
findings against `sai-grid.js`'s labels before trusting them fully cross-checked.
What is still open regardless: a real browser has not loaded this view against
production data (no DB credentials tonight either time), so treat "built" as
"built and tested against fixtures," not "verified live."

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

---

## ขั้นตอนการทำงานทั้งหมด — the loop around the sheet and the grid

Task 6, written headless, no database access, no Google credentials, no code.
§(a)-(e) above designed the sheet and the rules; §"วิธีทดสอบ" pinned the
self-claim flow. This section is the ROUND TRIP those pieces sit inside — every
turn of the crank, once a term, for as long as ฝ่ายข้อมูล keeps sending files.

**One line of context for the SEND decision below, since it drives most of the
labels:** the owner already said Sheets is what they want ("I think Google
Sheets is best... can see in real time who fills it in"), so this section
treats §c's spreadsheet design as decided and asks only where a download-CSV
button fits AROUND it, not instead of it.

### 1. Produce

| Piece | Status | Detail |
|---|---|---|
| CSV generator, run from a terminal | ✅ **EXISTS** | `npm run house:year-sheets -- --apply` → `tools/house-year-sheets.mjs`, built task 1. Needs `.env.local` DB credentials. |
| **When to run it** | MANUAL FOREVER, but pin the trigger | Not a calendar cadence — a รุ่น's data only changes when a new roster file is imported (`skills/import-the-house-roster.md`) or a หมายเหตุ correction from a PRIOR round lands (§5 below). **Run it as the last step of an import**, right after `tools/house-sync-registry.mjs --commit` (§4c of that skill) — never before, since the registry sync is what fills in the ชื่อเล่น/ชื่อ the sheet's whole justification depends on (see the 0fdc125 fix tonight: the sheet already had one bug from an unsynced field). Whoever runs an import adds one more command to the sequence; nothing here proposes a scheduled job. |
| **An admin-UI download button**, so producing the CSVs does not require terminal + DB-credential access | 🔧 **NEEDS BUILDING** | Factor `buildYearSheets`, `toCsv`, `HEADER`, `STATUS` out of `tools/house-year-sheets.mjs` into a new shared module `src/js/house/year-sheets.js` (pure — no `fs`, no network in any of those four; only `main()` touches the filesystem and that part stays in the CLI script, importing the moved functions back — the same direction `tools/house-year-sheets.mjs` already imports `gaps.js`/`fields.js`/`census.js` from `src/`, per the file-placement rule in `CLAUDE.md`: shared logic lives under `src/js/`, a CLI tool imports FROM it, never the reverse). Then add one function beside `exportCsv()` in `src/js/house/index.js` (`downloadYearSheets()`) and one button in `src/html/tab-house.html` next to the existing `#houseExportCsv` ("ดาวน์โหลด CSV รายรุ่น (สำหรับส่งให้รุ่น)"). **No new query** — `index.js` already holds `students` and `held` in module state from `reload()` (`src/js/house/index.js:74,81`), the same arrays `gaps.js` and the สาย-grid already read, so the button runs `buildYearSheets({students, held})` against whatever the admin is already looking at and downloads one CSV per รุ่น (mirroring `exportCsv()`'s blob-and-anchor pattern, one `a.click()` per file — browsers do not need a zip library for eight-or-so small text files). |

**Why the button is worth building even though the CLI already works**: the CLI
needs a laptop with `.env.local`'s production DB credentials — today that is
the owner alone. A button any admin can click, using data the browser already
has, is strictly wider access with **no wider trust**: it shows nothing the
admin's own screen doesn't already show them in ข้อมูลไม่ครบ or the สาย-grid.
It also removes the one way the CLI file can silently drift from what the app
believes: a browser button always reflects whatever `reload()` last fetched.

### 2. Send — Sheets is primary; the button is a produce-time convenience, not a competitor

**Recommendation: keep Google Sheets as the send mechanism (§c, decided).
Build the download button above as an improvement to the PRODUCE step, feeding
INTO Sheets — never as an alternative distribution channel that skips Sheets.**

Why not let the button replace Sheets entirely (download eight CSVs, email
each to its year admin, skip the spreadsheet):
- It throws away the one thing the owner explicitly asked for and explained
  the reason for — **live visibility of who has filled theirs in**. An emailed
  CSV that comes back as a reply-attachment gives no signal until it arrives;
  a Sheets tab shows partial progress the moment a year admin types anything.
- Sheets deployment already needs a human in the loop every cycle anyway (§c
  steps 1-4: create/paste/protect/share) — a downloaded CSV does not remove
  the human, it only changes what they paste it into. It would be strictly
  worse on the one axis (visibility) for no reduction in manual effort on the
  other (a human still has to open eight files and do something with each).

Why build the button anyway, rather than leaning only on the CLI:
- **Producing** and **sending** are different steps done by potentially
  different people at different times, and the CLI ties producing to whoever
  holds DB credentials. Once the button exists, producing the eight files no
  longer gates on the owner personally running a terminal command — anyone
  with the ระบบบ้าน admin pane can generate a fresh set the morning a new
  roster lands, then the owner (or anyone) does the fifteen-minute Sheets
  paste-and-protect ritual whenever convenient.
- It is genuinely complementary, not redundant: the CLI writes to
  `externaldata/` on whatever machine runs it (fine for the owner's own
  laptop, where the Sheets paste happens right after); the button writes to
  whichever admin's Downloads folder they're sitting at, which may not be the
  same machine that has the Google account signed in. Both stay useful.

**What would change this recommendation**: if year admins turn out to have no
personal Google identity to invite (§e assumption 5 — genuinely unknown
tonight), Sheets sharing cannot work at all and the emailed-CSV-only path
becomes the only option, chase-ability lost. Also, if the number of รุ่น grows
large enough that the manual paste-protect-share ritual (§c steps 1-4) becomes
the actual bottleneck rather than a fifteen-minute task, that argues for
someone eventually provisioning a Google Sheets API service account so the
paste step itself can be scripted — not attempted tonight, no credential for
it exists, and it is a bigger ask than anything else in this section.

### 3. Fill in — what to send the year admin, verbatim

Two sentences, in Thai, ready to paste into the message that shares the tab:

> **"ในแท็บของรุ่นคุณ ทุกคอลัมน์ล็อกไว้ห้ามแก้ ยกเว้นคอลัมน์สุดท้าย 'หมายเหตุ'
> — ถ้าเจอแถวไหนที่รหัส ชื่อ หรือสายดูผิด ให้เขียนอธิบายในหมายเหตุแทน
> อย่าลบหรือพิมพ์ทับคอลัมน์อื่น"**
>
> **"คอลัมน์ 'สถานะ' บอกว่าใครยังเข้าระบบไม่ได้ — ถ้าเห็นคำว่า
> 'ยืนยันตัวตนเองได้แล้ว รอเข้าระบบ' แปลว่าคนนั้นแค่ต้องล็อกอินด้วยอีเมล kkumail
> ของตัวเองแล้วกรอกรหัส+ชื่อ ไม่ต้องรอให้ใครช่วย — บอกเขาไปได้เลย."**

The second sentence is not filler: §a's whole table shows `held_self` rows need
nothing FROM the year admin except a nudge, and sending that sentence up front
should shrink how many หมายเหตุ rows are just "คนนี้ยังไม่เข้าระบบ" restated.

MANUAL FOREVER — this is a message a human sends: there is no notification
channel between "a Sheet is shared" and "the assigned person reads it" that
this repo could build without knowing who each year admin is by kkumail, which
nobody has told this agent tonight (§e assumption 5, again).

### 4. Come back — what is checked before anything downstream happens

**Collecting the file**: MANUAL FOREVER. `File → Download → CSV`, once per tab
(§c step 5) — Sheets has no multi-tab CSV export and no API credential exists
here to script around that.

**Validation, and why it is entirely human, on purpose:**

The sheet's own design (§b) already did most of the validation BEFORE this
step exists — eight of nine columns are range-protected and read-only, so the
only thing that can come back changed is free text in หมายเหตุ. That column is
read as a **claim about the database**, never as a value to write into it, so
"validation" here does not mean a parser checking a CSV shape; it means a
human deciding, per note, which of two existing paths (§5) it belongs to. What
must be checked, in order, before anyone acts on a note:

1. **Did the range protection actually hold?** Google Sheets "Editor" access
   (§c step 4's chosen sharing level) can still add rows, reorder, or paste
   over an unprotected cell inside a protected RANGE's own row if the row
   itself was inserted fresh — protection is per-range, not structural. Before
   trusting column 1 (รหัสนักศึกษา) as an anchor for a note in column 9,
   confirm the row's รหัส still matches what the generator wrote (cross-check
   against a fresh `--apply` run's own file, or against `npm run house:gaps`
   directly) rather than assuming eight months of untouched protection.
2. **Is the note about สาย?** ⛔ **Never act on it directly, ever, regardless
   of how specific or confident it reads.** สาย is never guessed or
   admin-typed (`docs/HOUSE-DATA-REPAIR.md` §2 — no self-service path exists
   for it and none should be built here to route around that). Forward it to
   ฝ่ายข้อมูล as a question about their SOURCE file; it is only real once it
   shows up in the next authoritative roster.
3. **Is the note about a wrong or missing kkumail on a held row** (the
   `held_admin` case §a identifies as the one row a year admin genuinely
   resolves)? Do not copy the address out of the sheet cell into the database
   directly. Use the EXISTING held-row promotion control in the admin pane
   (ระบบบ้าน → ยังนำเข้าไม่ได้ → search by รหัส or ชื่อ → กรอกอีเมล) so the
   admin doing the promotion re-confirms รหัส+ชื่อ themselves at the point of
   writing, the same discipline `claim_my_student_seat`'s neutral-failure
   message exists to enforce for a student's own attempt (§b's "one door"
   rule, restated: a sheet cell is a tip pointing at the door, never a second
   door).
4. **Is the note "this person doesn't exist / already graduated / duplicate"**?
   No automated path — a human confirms with ฝ่ายข้อมูล and, if correct, it
   becomes a note on the NEXT roster file exchange, not a live delete (this
   repo's import path never deletes; §6 of `import-the-house-roster.md`).
5. **Anything else** (a ชื่อ/นามสกุล/ชื่อเล่น correction) is lowest priority —
   it is already self-service (`docs/HOUSE-DATA-REPAIR.md` §2 Case A) for
   every row that can sign in, so a year admin's note is at best a heads-up to
   mention to the person, never a database write on its own.

⛔ **Nothing above is a step this repo should ever automate into "read column
9, write to the database."** §b's core rule is that the sheet has exactly ONE
writable column and it writes to a human, not a table — an importer that
closed that loop automatically would be exactly the second write path
`.claude/rules/mistakes.md` class 6 warns about, built to route around rules
(สาย most of all) that exist specifically to require a human in the loop.

### 5. Apply — reuse the existing import path; do not build a second one

**Decision: reuse. No new writer.** Every corrected fact ends up going through
one of two paths that already exist and are already hardened:

- **A สาย or roster-level correction** (§4 point 2, and point 4's
  no-longer-a-student case) becomes part of ฝ่ายข้อมูล's NEXT handover file,
  which flows through the existing, hardened pipeline: `tools/clean-house-csv.mjs`
  → read `<base>.report.md`, especially its §2 สาย-density check → `tools/house-import.mjs`
  (dry run, then `--commit`) → `tools/house-sync-registry.mjs --commit` →
  regenerate the year sheets (back to step 1). This is `skills/import-the-house-roster.md`
  end to end, unmodified — a year-admin note is just one more INPUT to that
  file, the same as any other correction ฝ่ายข้อมูล already receives.
- **A held-row kkumail correction** (§4 point 3) uses the admin pane's
  existing promotion control (ระบบบ้าน → ยังนำเข้าไม่ได้), which already writes
  through the same guarded path a student's own successful claim would.

**Why not build `house-year-notes-import.mjs`** (the tool §c step 6 named as
"not built tonight"): having designed the validation checklist above, every
single note category routes to one of the two existing mechanisms and needs a
human decision first — there is no step where a note could be mechanically
"imported" without that judgment call already having been made. A staging
table (`house_year_admin_notes`) would only be worth building if the volume of
notes ever gets large enough that reading raw CSV cells by eye becomes the
bottleneck — not knowable tonight, and not needed for the first cycle of
eight-ish tabs. **What would change this**: if a future round produces
hundreds of notes across many รุ่น at once (e.g. a full re-verification sweep),
revisit — but build the staging table then, sized to the actual note volume,
not now against a guess.

### 6. Chase — who has replied

**In Sheets itself, no code, built once by the owner (or whoever manages the
sheet) using features Sheets already has:**

- A row-level visual cue already exists for free: Sheets conditional
  formatting on the หมายเหตุ column (`Format → Conditional formatting → “is
  not empty”` → any highlight colour) marks every row a year admin has
  actually touched, live, as they type.
- A one-glance "who's done" view: a formula on the ภาพรวม tab (already
  planned in §c as tab 1),
  one row per รุ่น: `=COUNTA(MD49!I2:I999)` (nonblank หมายเหตุ cells) next to
  `=COUNTA(MD49!A2:A999)` (total rows), so the owner reads "12 / 214 filled"
  per รุ่น without opening each tab. Copy the formula pair down once per รุ่น
  row when the ภาพรวม tab is built — a Sheets formula, not a script, so it
  needs no credential this repo could hold anyway.

**MANUAL FOREVER, and deliberately not built as an in-app feature.** An
in-repo "reply status" view would need the Google Sheets API (read access to
the live spreadsheet), which is a credential nobody has issued yet
(`.claude/rules/security.md` has no row for one) — and even if it existed, it
would duplicate the exact live view Sheets already renders for free, which is
the entire reason §c chose Sheets over anything else. **What would change
this**: if the owner later wants the "who's filled in" state to show up
somewhere OTHER than the spreadsheet itself (e.g., folded into the ระบบบ้าน
admin pane's own overview alongside the existing gap counts), that is the
point a Sheets API service account becomes worth provisioning — not before.
