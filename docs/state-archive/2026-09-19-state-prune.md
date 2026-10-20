# Pruned from STATE.md, 2026-09-19

STATE.md is capped at ~200 lines because it is the first thing a cold session
reads and a long one stops being read. These blocks were true and are now
history; the LESSON from each was kept in STATE.md in one line, the narrative
is here.

## samo-dev drifted while STATE.md said it was in step (2026-09-13)

samo-dev had drifted four migrations behind while a line in STATE.md asserted it
was current. Nobody was lying: the line was written when it was true and never
re-checked, which is what a decaying fact does in a document with no compiler.

Two things changed as a result, and both are mechanisms rather than sentences:
a merged migration nobody applies now shows up in the pull request itself, and
`npm run deploy:owed` asks PRODUCTION before it gives a verdict instead of
reading a line.

**The rule that survives:** ask `npm run migrate:status -- --dev`, never the
prose. Note the `--` — a bare `--dev` is swallowed by npm and the command then
reports PRODUCTION, which is its own entry in the mistakes files.

Why it happened, in full: `docs/state/phuriphatma.md`. What is still owed on the
dev project: `docs/state/HANDOFF.md` §8.

## The roster import's own numbers (2026-09-14)

The import landed 1,611 students and 165 held rows in one transaction, with 306
สาย and ten houses. Those numbers have all moved since — held is smaller every
time a ฝ่าย answers, students larger — which is exactly why STATE.md no longer
carries them and `npm run handoff:check` fails when a document contradicts the
database.

`advisors` being empty is NOT historical and stayed in STATE.md: the two rows it
once held were test data pointing at สาย 100/200, which are real สาย in the file,
so twelve students briefly saw an อาจารย์ who does not exist. Snapshot and
write-up: `docs/mistakes/postgres-schema.md`.

## The migration paragraph STATE.md carried until 2026-09-19

One 1,900-character line listing what every migration from 0183 to 0194 did. It
was accurate and it was in the wrong place: STATE.md is read first by every cold
session and is capped at ~200 lines for that reason, while this is reference
material nobody needs in the first minute. The proofs are the authority for all
of it; `npm run migrate:status` is the authority for what is applied.

- **ระบบบ้าน — the 13 held rows with no รุ่น (pruned from STATE.md 2026-10-19).**
  They carried no รหัสนักศึกษา (`#N/A` in the handover file), so
  `cohortFromStudentId()` — how everyone else gets theirs, 65→MD50, 66→MD51 —
  had nothing to read; 0188 had already given `student_import_unresolved` a
  `cohort_year` for exactly this and the importer never filled it.
  `tools/house-unplaced-cohort.mjs` read it back out of the handover file's
  block headings, refusing any row whose สาย in the file disagreed with the
  database. There is no `_unplaced` population any more — this changed a
  number already reported: `_สายมีปัญหา` dropped to 5 (most "nobody is on
  this สาย" rows were these people, uncounted because the audit groups by
  รุ่น and they had none). What remained real: สาย 256 held twice in MD53 and
  twice in MD54, สาย 141 empty in both. MD50 was promoted via
  `tools/house-kkumail-import.mjs` the same day. See memory
  `house-unplaced-cohort-fixed.md` for the up-to-date "is this stale" check.

- **Migrations through 0194. ALL 43 LIVE PROOFS GREEN** (2026-09-14). **0194: an import may FILL the registry, not overwrite it** — the old guard skipped the write entirely, so 136 people had a NULL ชื่อ in `people` while ระบบบ้าน had it; 20/20, watched failing first. Registry now 0-diff against BOTH placements (§F of that proof asks it live). **0193 keeps what the handover file said in a cell the cleaner emptied** — a removed address and the รุ่น of a row with no รหัส — as EVIDENCE the admin can see and nothing can resolve a row with; 18/18, watched failing first. 0183/0184 are the PORTAL half of Discord role sync — `discord_links`, `team_nodes.discord_role_id` + `discord_role`, plus `discord_role_targets()`, the ONE function that decides what a person is due — applied and proved 23/23 + 18/18, both watched failing first. The seed ticked **107 of 299 nodes**; the rest are the owner's review. **0187 closed a hole where UNLINKING kept your ฝ่าย roles for ever** — §14b, its one home. HANDOFF §11 and §13c both CLOSED. **0188–0190 keep the import lines that have no kkumail** and let the student claim their own seat with รหัสนักศึกษา + ชื่อ — 33/33, each fix watched failing first. 0188's table was born anon-writable (a `pg_default_acl` on `public` grants anon `arwdDxtm` to every NEW table; every other ระบบบ้าน table revokes it per object). 0189/0190 came out of reviewing 0188: a claim reached `students` without `last_import_batch`, so both mirror triggers took the NON-import branch and the file's spelling overwrote a curated registry name silently.
