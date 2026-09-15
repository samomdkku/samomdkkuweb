# NIGHT-TASKS — 2026-09-15 → 16

⛔ **CONSTRAINTS THAT APPLY TO EVERY TASK. Read these before task 1 or you will
waste the window discovering them.**

- **You have NO database access.** `tools/db-query.mjs`, `apply-migration` and
  anything reading `.env.local` are denied, and the file is invisible to you.
  You cannot query real students. Anything needing live data must be written as
  a TOOL the owner runs tomorrow with credentials — never as a query you attempt.
- **You have NO Google credentials.** You cannot create a Google Sheet, upload
  one, or call Drive. You CAN write the CSV format, the column spec, the
  protection rules, and step-by-step instructions the owner follows once.
- **You cannot push, deploy, or touch production.** Commit to the branch; a human
  reviews in the morning.
- **You have 51 memory files** at the path named in your preamble. Read the ones
  whose descriptions match what you are doing. They contain decided things that
  are nowhere in the repo, and re-deciding them is the most common way an
  unattended agent wastes a night.
- Follow `CLAUDE.md`'s end-of-turn loop: write up bugs in `docs/mistakes/`, add a
  `PENDING` changelog entry for anything a person would NOTICE, keep `STATE.md`
  short. **Do NOT run `npm run mistakes:index` if it needs network or a secret** —
  if it fails, say so and move on.
- Thai UI text, no emojis in UI strings, light theme only.

⛔ **THERE IS NO HUMAN AWAKE. NEVER END A TASK BY ASKING A QUESTION.**
You are running headless at 2am. Nobody can grant a permission, pick an option
or answer a clarification — a turn that ends in a question has produced NOTHING,
and it is scored as a failure, not as a polite pause. This happened repeatedly
while this setup was being tested.

So: when something is ambiguous, **decide**, act on the decision, and record it —
what you chose, what you rejected, and what would change your mind — in the file
you are writing. A defended decision the owner can overturn in the morning is
worth enormously more than a question they wake up to.
If you are genuinely blocked, do the part you CAN do, then write the question
into `docs/state/agent-notes/2026-09-16-questions.md` with your recommendation,
and move on. Never stop and wait.

---

## 1. PLAN FIRST — no code this task, and say what you cannot do

The owner's goal, in their words: *"I'll ask every admin of every year for these
lists of people. But I need a proper format to send each year like MD50, 51, 52,
49 — lists of people who have issues. Maybe I provide a table/CSV with some cells
blank to fill in. You'll have to set a rule: can they, and should they, modify
name, surname, student id, sai? I think Google Sheets is best — I can see in real
time who fills it in. I'm not afraid of one year's data being visible to another;
we're all coworkers."*

Read first, do not re-derive: `docs/HOUSE-DATA-REPAIR.md`, `docs/house-data-spec-th.md`,
`src/js/house/gaps.js`, `src/js/house/census.js`, `skills/import-the-house-roster.md`,
and the 2026-09-15 blocks in `docs/state/phuriphatma.md`.

Write `docs/HOUSE-YEAR-HANDOVER.md` — the PLAN, covering:

**(a) What each year's admin is actually asked to fix.** Ground this in
`gaps.js`, which already classifies every gap by WHO CAN FIX IT. A year admin is
not the same actor as ฝ่ายข้อมูล or the student themself — be explicit about
which gaps belong to them and which do not.

**(b) The per-รุ่น sheet format.** Exact columns. Which are READ-ONLY context and
which are blank-for-them-to-fill. State the rule for each of ชื่อ, นามสกุล,
ชื่อเล่น, รหัสนักศึกษา, สาย: may they change it, SHOULD they, and what happens
downstream if they do. ⚠️ Two facts that must shape this, both already paid for:
**บ้าน is the last digit of สาย**, so a wrong สาย puts a real student in the wrong
บ้าน; and **kkumail is the identity** — a wrong email means that person signs in
and never finds themselves, which is the one error that cannot be recovered from
(`docs/house-data-spec-th.md` says so explicitly).

**(c) The Google Sheets workflow.** The owner is right that Sheets gives live
visibility, and you should plan for it — but say plainly which steps a human must
do by hand, because you have no Google credentials. Cover: one sheet with a tab
per รุ่น vs one sheet per รุ่น (recommend one, with reasons); which ranges to
protect so an admin cannot overwrite the read-only context columns; how a filled
sheet comes back (File → Download → CSV) and what the owner runs on it. Consider
and REJECT-WITH-REASONS at least one alternative, so the choice is defended
rather than assumed.

**(d) The UI.** The owner wants it in the **นักศึกษา tab**: *"like how the file
has it — e.g. MD50 list from สาย 001, 002… and highlight in colour what
information is missing. Like this สาย has nobody, data missing, error etc."*
Design it: pick รุ่น, list สาย in order, show who occupies each, and colour the
problems. Say which existing module supplies each number (`gaps.js` and
`census.js` already compute most of it — reuse, do not recompute) and how you
will avoid the defect shipped on 2026-09-15, where a LABEL claimed a cause the
arithmetic never checked (`docs/mistakes/frontend-ui.md`).

**(e) A "what I could not verify" section.** Anything you are assuming because
you cannot reach the database. Be specific. This section is the most valuable
part of the document for the person reading it in the morning.

## 2. ANSWER THE TESTING QUESTION — trace it, do not guess

The owner asks: *"How do I test what a person who has a kkumail but is NOT in
ระบบบ้าน sees? How do I test the เจ้าตัวยืนยันเองได้ เมื่อเข้าสู่ระบบ flow? All
of it is weak."*

They are right that it is weak — there is no way to see those screens without
being such a person. Trace the ACTUAL code path for both cases: start at
`src/js/house/`, find where a signed-in user with no `students` row is handled,
and find every branch of the self-claim flow (`claim_my_student_seat` is the RPC;
the front-end half is what you can read). Enumerate every distinct outcome a real
person can hit — found, not found, wrong รหัส, right รหัส wrong ชื่อ, already
claimed, not a kkumail account.

Append your findings to `docs/HOUSE-YEAR-HANDOVER.md` as a section **"วิธีทดสอบ"**,
and write a vitest file that exercises every branch you can reach without a
database, using fixtures in the style of `src/js/house/gaps.test.js`. Run it and
make it pass. For the branches that genuinely need a live session, write the
manual steps instead — numbered, so a human can follow them in five minutes.

## 3. BUILD THE GENERATOR — the owner runs it tomorrow, with credentials

Write `tools/house-year-sheets.mjs`: reads the live data the same way
`tools/house-gaps.mjs` does, and emits ONE CSV PER รุ่น in the format task 1
specified, into `externaldata/house-year-sheets/`.

⚠️ `externaldata/` is gitignored and holds PII — never move its contents under
`src/`, `docs/` or `tools/`, and never commit any row.

Requirements: `--dry-run` by default like every other tool here; print a per-รุ่น
count; refuse to overwrite existing files without `--force`; and **reuse
`src/js/house/gaps.js`** so the sheet and the ข้อมูลไม่ครบ tab can never disagree
about what counts as a gap. You cannot run it against the database — so write a
unit test over fixtures that proves the CSV shape, the header, and the
blank-cell rule, and say clearly in your final message that the live run is
unverified and belongs to the owner.

## 4. BUILD THE UI — the นักศึกษา tab, per รุ่น, by สาย

Implement section (d) of your own plan. Follow the repo's shape: a PURE module in
`src/js/house/` computing the rows, a vitest file beside it, and the rendering in
`src/js/house/index.js` with markup in `src/html/tab-house.html`.

Must: pick a รุ่น, list its สาย in numeric order, show occupants, and visibly mark
— สาย with nobody · rows missing a required field · the duplicate-สาย and
skipped-สาย cases `gaps.js` already detects. Colour must not be the ONLY signal
(use an icon or text too). Mobile width 390px must not overflow — most of this
app's traffic is phones.

⛔ Every label you write must claim only what its number actually tests. That
exact defect shipped this morning and the audit in
`docs/state/agent-notes/2026-09-15-label-audit.md` found three more instances —
read it first and do not add a fourth.

Run `npm test` and `npm run build`. Both must pass before you finish.

## 5. SCRUTINIZE YOUR OWN WORK — be your own harshest reviewer

Re-read everything you produced in tasks 1–4 with fresh eyes, as if reviewing
someone else's PR you distrust. For each piece ask: does it do what it claims;
is there a simpler version; what did I assume because I could not reach the
database; what would a careful reviewer object to first.

Then **verify, do not trust**: re-run `npm test` and `npm run build`. For at
least one guard test you wrote, reintroduce the bug it exists for, confirm it
goes RED on the assertion you expect, and restore it — this repo has shipped
guards that were green against broken code, and an unverified guard is worse
than none.

Fix what you can. Write `docs/state/agent-notes/2026-09-16-self-review.md` with:
what you changed and why, what you chose NOT to change and why, and every
weakness you know remains. **A short honest list beats a long reassuring one.**

## 6. THE WHOLE WORKFLOW, END TO END — plan it, no code

The owner: *"I want it to provide the full workflow built and implemented on the
samoweb ระบบบ้าน if it's needed — like download CSV for each to send, or
something else. Be the best way, best practice."*

Tasks 1–5 designed the sheet and the UI. This task designs the LOOP AROUND them,
and it is a PLAN — write no code.

Append a section **"ขั้นตอนการทำงานทั้งหมด"** to `docs/HOUSE-YEAR-HANDOVER.md`
covering the full round trip:

1. **Produce** — who runs what to generate each รุ่น's file, and when.
2. **Send** — how it reaches each year's admin. The owner leans towards Google
   Sheets for live visibility. Decide whether a **download-CSV button inside the
   ระบบบ้าน admin UI** is better, worse, or complementary — a button means no
   manual export step and the file always matches what the app believes, but it
   loses the live "who has filled theirs in" view. Recommend one, defend it, and
   say what would change your mind.
3. **Fill in** — what the admin actually does, in their words, in Thai. Two
   sentences they could be sent verbatim.
4. **Come back** — how the filled file returns and what validates it BEFORE
   anything is written. ⚠️ A wrong สาย moves a real student to the wrong บ้าน and
   a wrong kkumail locks someone out permanently, so say exactly what is checked
   and what is rejected.
5. **Apply** — how corrections reach the database. Read
   `skills/import-the-house-roster.md` and `docs/HOUSE-DATA-REPAIR.md` first:
   there is already an import path with hard-won rules, and a second one that
   ignores them would be a new class of bug. Say whether this reuses that path
   or needs its own, and why.
6. **Chase** — how the owner sees which รุ่น have replied and which have not.

For every step say whether it EXISTS today, needs BUILDING, or is MANUAL FOREVER.
A step marked "needs building" must name the file it would live in.

<!-- The handoff is NOT a task here. It lives in ~/samo-night/HANDOFF.md and runs
     on reserved time after this queue stops, so it cannot be the first thing
     lost when the queue overruns. -->
