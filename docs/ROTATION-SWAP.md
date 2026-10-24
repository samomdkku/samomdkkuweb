# แลก Rotation — ปี 6 swap their rotation group

Built 2026-10-24 from the faculty's PDF *ตาราง Rotation ปี 6 Block 1
ปีการศึกษา 2570 (แจ้งนศ. 24-10-69)*. This file is the map for whoever works on it
next, human or AI (Antigravity, Gemini, Claude). Read it end to end before
changing anything; every section names the file that owns the thing.

> ⚠️ `docs/` is served publicly at `samo.md.kku.ac.th/docs`. Never put a student's
> name, รหัส or GPA in this file.

## 1. What it does

- A ปี 6 student signs in with their **kkumail** and opens **`/rotation`**.
- They see **who they are**: name, รหัส, เพศ, **current group (A–F)**, and a **GPA
  field they fill in themselves** (private: only they and admins see it).
- **ตารางของฉัน** — their 6 blocks (dates, courses, Sec.01/02), current block
  highlighted.
- **ทุกกลุ่ม** — a 6 × 6 overview (groups × blocks) and every group's members,
  with **ขอแลก** next to each person they may swap with, and **ขอแลกกับทุกคนที่แลกได้**
  per group (a *broadcast*).
- The other person **accepts** → both move **instantly**; everyone's page updates
  live. Every other open ask that names either of them is closed automatically.
- **ความเคลื่อนไหว** — who is asking whom, and every completed swap. Declines and
  cancels are visible only to the two people involved.

### The criteria

| # | Rule | Status |
|---|---|---|
| 1 | Same gender (from the PDF prefix: นาย = M, นางสาว/นาง = F) | **ENFORCED** |
| 2 | GPA in the same band: 2.55–2.99 · 3.00–3.49 · 3.50–4.00 | **COLLECTED, NOT ENFORCED** — waiting on the faculty |

To switch rule 2 on: admin panel on `/rotation` → เกณฑ์ GPA → *ต้องอยู่ช่วงเดียวกัน*.
That sets `rotation_rounds.gpa_rule = 'same_band'`. If the faculty answers with a
different rule (e.g. "a neighbouring band is fine"), change **only**
`public.rotation_pair_allowed()` in a new migration — it is the one home of the
criteria; the board, the request guard and the accept guard all call it, and the
page reads its answer (`can_swap`) instead of re-deriving it.

## 2. Files

| Thing | File |
|---|---|
| Schema, RLS, every RPC | `supabase/migrations/0250_rotation_swap.sql` (read its header) |
| DB proof (43 checks, rolls back) | `tools/rotation0250-swaps.sql` — `node tools/db-query.mjs tools/rotation0250-swaps.sql [--dev]` |
| Roster import from the PDF | `tools/rotation-import.mjs` (dry run by default; `--commit`) |
| The one PDF parser | `src/js/rotation/roster-parse.js` |
| The timetable (no people) | `src/data/rotation-2570.js` |
| Timetable → dates (pure) | `src/js/rotation/schedule.js` + `schedule.test.js` |
| Board → what the page draws (pure) | `src/js/rotation/model.js` + `model.test.js` |
| The page (DOM, RPC calls, realtime) | `src/js/rotation/page.js` |
| Markup frame | `src/html/tab-rotation.html` |
| Styles | `src/css/rotation.css` (all rules under `.rot-`) |
| Route `/rotation` | `src/js/main.js` `PATH_ROUTES` + the dynamic import in `shown.bs.tab` |
| Hidden nav button | `src/html/navbar.html` `pills-rotation-tab` |
| Tools launcher entry | `src/data/tools.js` slug `rotation-swap` (hidden until opened — §5) |
| Browser test (two accounts, real swap) | `tools/browser/rotation-page.mjs` (samo-dev only) |

## 3. Data model (0250)

```
rotation_rounds    id 'y6-2570' · published · swaps_open · swaps_close_at · gpa_rule · max_pending
rotation_students  one row per student: รหัส, name, gender, original_group, current_group,
                   kkumail, person_id → people, gpa (PRIVATE)
rotation_requests  requester → target (a person) OR target NULL = broadcast to to_group
                   status: pending · accepted · declined · cancelled · superseded
rotation_moves     every change of group (2 rows per swap; 'admin' for a hand move)
rotation_events    content-free ping per write — what Realtime streams
```

**Security shape — do not break it:**

- No student can `select` any rotation table except `rotation_events` (which has
  no content). All reads go through `rotation_board(p_round)`, which **names** its
  columns. `gpa` is returned only as `me.gpa` (yourself) or to admins. Adding a
  `select` policy on `rotation_students` would publish every GPA.
- Identity = `rotation_my_row_id()`: the roster row whose `person_id` links to the
  signed-in account, or whose `kkumail` equals the account's email. Never a name.
- Every write takes `pg_advisory_xact_lock(hashtext('rotation:'||round))`, so two
  accepts never interleave. That is what makes "two people accept the same
  broadcast at once" safe: the second sees `status = 'accepted'` → `reason: 'taken'`.
- Admin = `role = 'dev'` or the `rotation` permission (and `master`, which holds
  every permission). Grant `rotation` in ทีม SAMO → สิทธิ์ to a ฝ่ายวิชาการ person.

### RPCs the page calls

| RPC | Who | Returns |
|---|---|---|
| `rotation_board(p_round)` | anyone signed in | `{state:'ok', is_admin, round, me, students[], requests[], moves[]}` or `{state:'signed_out'│'not_in_roster'│'not_published'│'no_round'}` |
| `rotation_set_gpa(p_round, p_gpa)` | roster member | `{ok, gpa, gpa_band}`; `null` clears |
| `rotation_request(p_round, p_target, p_to_group)` | roster member | `{ok, id}` / `{ok:false, reason}`; `p_target` null = broadcast |
| `rotation_accept(p_request)` | the target / an eligible member of the broadcast's group | `{ok, my_group, requester_group, closed_other_requests}` |
| `rotation_respond_no(p_request)` | requester (= cancel) or named target (= decline) | `{ok}` |
| `rotation_admin_update_round(...)` | admin | `{ok}` |
| `rotation_admin_move(p_student, p_group)` | admin | `{ok}` |

Every `reason` has Thai in `model.js` `REASON_TH`; `model.test.js` fails if the
migration grows a reason with no translation.

## 4. Edge cases, and what happens

| Case | Behaviour |
|---|---|
| Two people accept the same broadcast at the same moment | Serialised by the round lock; the first swaps, the second gets *มีคนตอบรับคำขอนี้ไปก่อนแล้ว* |
| A has asks out to B and C; B accepts | A and B swap; A's ask to C (and any ask naming A or B) → `superseded` |
| Someone moved since the ask was made | Accept returns `stale` and the ask is closed |
| Ask to a different gender / own group / duplicate | Refused: `not_eligible` / `same_group` / `duplicate` |
| Spamming asks | At most `max_pending` (15) open asks per person |
| Round closed (switch off, or `swaps_close_at` passed) | Every write returns `closed`; the page shows "ดูได้อย่างเดียว" |
| Student never signed in | Still listed (badge *ยังไม่เคยเข้าเว็บ*); can be asked; sees it when they sign in |
| Realtime socket dies (backgrounded phone, stale token) | Page re-reads every 60 s while visible and on returning to the tab |
| Re-importing the PDF | Updates names/kkumail; **never** resets `current_group` or `gpa` |

Not supported, on purpose: three-way chains (A→B→C→A). Every swap is 1:1, so group
sizes never change unless an admin moves someone by hand.

## 5. Going live (owner checklist)

The round ships **closed and hidden**: `published = false`, `swaps_open = false`,
and the tools-launcher entry is hidden.

1. Open `/rotation` as an admin, check the roster and timetable.
2. Tick **นักศึกษาเห็นหน้านี้** (students can look) — optionally leave
   **เปิดให้แลก** off for a day so people can check their data first.
3. Tick **เปิดให้แลก**, optionally set **ปิดรับอัตโนมัติ**.
4. Make it findable: in `src/data/tools.js` set the `rotation-swap` entry's
   `dept: 'academic'` and remove `launcher: false`; add a release note to
   `PENDING` in `src/data/changelog.js`; deploy. Or just send the class the link
   `https://samo.md.kku.ac.th/rotation`.

## 6. Extending it

- **GPA rule**: §1. One function, one migration, re-run the proof (§2) — §D of the
  proof already covers `same_band`; add a case for whatever new rule you write.
- **Next year's round**: new `src/data/rotation-25xx.js` (same shape; the tests in
  `schedule.test.js` check it), insert a `rotation_rounds` row in a migration,
  `node tools/rotation-import.mjs <pdf> --round <id> --commit`, and point
  `page.js`'s `ROUND` import at the new file.
- **Notifications** (Discord/email when someone asks you): not built. If added, do
  it server-side from `rotation_requests`, and remember the request list is
  already public within the cohort, so a notification may say who asked.
- **Admin bulk tools** (export the final groups as CSV): read `rotation_board()` as
  an admin — it carries GPA for admins — or query `rotation_students` from a
  `tools/` script.

### Working rules for an AI editor in this repo

- Run `npm run build && npm test` before every commit. `npm test` includes guards
  that will fail on a raw colour in CSS (run `node tools/theme-tokens-codemod.mjs
  --write`), a `year:` key, an undeclared global, or STATE.md drift.
- A schema change is a **new numbered migration**; never edit 0250 after it is
  applied. Apply with `node tools/apply-migration.mjs <file> --dev` first, run the
  proof with `--dev`, then production.
- `npm run dev` uses **samo-dev**, not production. `tools/browser/rotation-page.mjs`
  drives a real swap there and cleans up after itself.
- The repo is **public**: the PDF and the roster never go into git.
