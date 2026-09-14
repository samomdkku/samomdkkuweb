# Importing the ฝ่ายข้อมูล roster into ระบบบ้าน

The handover file comes back. It came back on 2026-09-14 with 1,776 students in
it, and it will come back every time a รุ่น enrols, a สาย is re-cut, or an answer
to a question in the report arrives days later. This is the loop.

⛔ **The first import is the one that cannot be undone quietly.** บ้าน is the
LAST DIGIT of สายรหัส. A สาย column that shifted by one puts a real student in a
different บ้าน, every downstream screen agrees with it, and nobody feels a thing.
Step 2 exists for that and nothing else.

## 1. Put the raw file where it cannot be committed

```
externaldata/house-import/<YYYY-MM-DD>-raw-from-<who>.csv
```

`externaldata/` is gitignored (`.gitignore:18`) and **this repo is PUBLIC**. The
file is ~1,800 real students' ชื่อ, รหัสนักศึกษา and addresses. Never move it
under `src/`, `docs/` or `tools/`, and never paste a row of it into chat.

The raw file is **never edited**. Every correction is a line in the cleaner, so
it re-applies identically to the next file — a hand-edited CSV cannot be
reviewed, because the diff is 1,800 lines of Thai names.

## 2. Clean it and READ THE REPORT

```bash
node tools/clean-house-csv.mjs externaldata/house-import/<file>.csv
```

Four files come out; `<base>.report.md` is the one a human reads.

| File | What it is |
|---|---|
| **`<base>.import.csv`** | ⭐ **the file you upload** — every line, in file order |
| `<base>.clean.csv` | the rows that become students (for reading) |
| `<base>.pending.csv` | the rows that cannot (for reading) |
| `<base>.report.md` | what changed, what was routed out, what to ask |

⛔ **Upload `.import.csv`, never `.clean.csv`.** The clean half looks like the
file you want and silently throws the other half away:

- `record_unresolved_rows` (0188) **replaces** the held list with whatever the
  uploaded file could not address, so a file holding nobody **clears it** — every
  held seat gone, and with it every student's ability to claim their own
  (`claim_my_student_seat` reads that table).
- `diffAgainstExisting` counts a **skipped** line as the file mentioning that
  person. Drop the skipped lines and everyone who already claimed a seat is
  stamped `missing_since` on the next import — flagged absent from a file that
  names them.

Neither shows up in the run: it says `นำเข้าเรียบร้อยแล้ว` either way. Guarded by
`src/js/house/clean-csv.test.js`, which runs the real cleaner and feeds the real
importer.

**§2 of the report is a BLOCKER, not a warning.** It prints, per รุ่น, the สาย
that are missing and the สาย held twice. A รุ่น that runs 1..N with no gap and no
repeat is healthy; one that does not is a question for ฝ่ายข้อมูล **before**
importing, because the answer may move people between บ้าน. If they confirm the
list is right as it stands, import as it stands — that is a decision, and it
belongs in `docs/state/<handle>.md` with the date and who said it.

## 3. Import

Two ways, and they do the same work in the same order through the same code.

### 3a. `tools/house-import.mjs` — one transaction, dry run first

```bash
node tools/house-import.mjs externaldata/house-import/<base>.import.csv          # DRY RUN
node tools/house-import.mjs externaldata/house-import/<base>.import.csv --commit
```

Use this for a LARGE or FIRST import. The pane does nine unsynchronised HTTP
requests; this wraps the identical sequence in `begin … commit`, so a failure
leaves nothing behind instead of a half-populated table. It imports the app's own
parser (`parseStudentsCsv`, `toUpsertRow`, `toUnresolvedRow`) rather than
reimplementing it, and it runs as a **real admin** through `set local role
authenticated` — the same RLS policies and RPC permission checks the pane meets,
never as the superuser.

The dry run is not a simulation: it does the real work against the real database
and rolls back, reading the post-state from inside the transaction. What it
prints is what committing would leave.

It also stores the generated report in `student_import_batches.notes`, so the
reasoning travels with the run instead of living only in a gitignored folder.

⛔ It refuses any file not named `*.import.csv` — see the warning above.

### 3b. The admin pane

`/admin/` → **ระบบบ้าน** → **นำเข้า CSV** → pick `<base>.import.csv`.

The preview is evidence, so read it before pressing the button:

- **จะเพิ่ม / จะแก้ไข / ไม่เปลี่ยน** — on a first import almost everything is
  "เพิ่ม". A large "แก้ไข" on a file nobody expected to change is the tell.
- **ไม่พบในไฟล์ล่าสุด** — these are stamped `missing_since`, never deleted. A
  number bigger than a handful means the file is wrong, not the students.
- **ข้าม N แถว** — these become the held list. It should equal the
  `pending.csv` row count.

The run does, in order: create the batch row → seed สาย (`ensure_sais`, both
lists) → upsert students in chunks of 200 → mark missing → record the held rows →
stamp the batch's real counts. It never deletes.

## 4. Verify from the database, not from the green banner

```sql
select count(*) from public.students;
select count(*) from public.students where missing_since is not null;
select reason, count(*) from public.student_import_unresolved group by reason;
select house_id, count(*) from public.sais s join public.students t
  on t.sai_code = s.code group by house_id order by house_id;
```

(`node tools/db-query.mjs <file.sql>` — it takes a FILE and runs on
**PRODUCTION**.)

The last one is the คนละบ้าน check: ten houses, and with ~1,600 students each
should hold roughly a tenth. A house that is empty or double is a สาย column
that moved.

## 4b. Who is still missing something

```bash
npm run house:gaps                                        # summary
npm run house:gaps -- --out externaldata/house-import/gaps.md   # per-person
```

⚠️ The `--` is not optional. Without it npm swallows the flag, and you get the
summary with no file and no error — the same trap that made `migrate:status`
answer about PRODUCTION for months (`docs/mistakes/tooling-proofs.md`). Or call
the script directly: `node tools/house-gaps.mjs --out <file>`.

It splits the answer by **who can act**, because one number invites somebody to
work through a list that is three-quarters not theirs:

| | who closes it |
|---|---|
| no รหัส in the file | ⛔ only an admin or ฝ่ายข้อมูล — there is nothing to match on |
| ชื่อ disagrees with the file | the person themselves, on their next sign-in |
| held but has รหัส + ชื่อ | the person themselves — tell them once |
| no ชื่อเล่น | nobody: they fill it in, or they don't |

Read-only. It never writes.

## 5. What the held rows carry, and what they cannot

Since 0193 a held row also shows **what the file said in a cell the cleaner
emptied** — an address that belongs to somebody else, or a real address that is
not a kkumail — and the **รุ่น of a row with no รหัสนักศึกษา**, read off the
file's block heading. Both are quotations. Neither can resolve a row:
`file_kkumail` is an address already known NOT to be that person's login, which
is the whole reason the row is held.

⚠️ The รุ่น deliberately does NOT go in `cohort_year`. That column is derived from
the รหัสนักศึกษา, and a reader has to be able to tell a derived value from a
quoted one.

## 6. What is left over, and who can close it

Only ฝ่ายข้อมูล can close a held row with no รหัสนักศึกษา — there is nothing to
match on. Everyone else closes themselves: a student signs in with their real
kkumail, types รหัส + ชื่อ, and takes their seat. `docs/HOUSE-DATA-REPAIR.md` is
the matrix of which broken field the student fixes, the admin must, or only
ฝ่ายข้อมูล can.
