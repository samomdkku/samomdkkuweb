# NIGHT-TASKS — 2026-10-13 (written by the owner's session before /clear)
Budget: 6 runs
Until: 2026-10-14T08:00:00Z
Reserve sessions: 1
Branch: agent/2026-10-13

⛔ **CONSTRAINTS THAT APPLY TO EVERY TASK. Read them before you start.**

- **You have NO database access.** `tools/db-query.mjs`, `apply-migration` and
  `.env.local` are denied. You may WRITE a migration and a proof script; you
  cannot RUN either. The owner's next session applies them (dev first, then
  production) and runs the proof. Say "written, not applied" wherever it matters.
- **You cannot push, deploy, or touch production.** Commit on this branch. Every
  run of this queue continues the SAME branch (`agent/2026-10-13`): read
  `git log --oneline origin/main..HEAD` first — an earlier run may already have
  done part of your task. Never reset, rebase or merge the branch.
- **Migration numbers are RESERVED:** task 1 owns `0212`, task 2 owns `0213`.
  A security fix from tasks 3–4 that needs SQL takes `0214`, `0215`, … in order.
  `migration-numbers.test.js` must stay green.
- **`STATE.md` is checked by `state-handoff.test.js`:** its "Migrations through
  NNNN" must equal the highest file on disk, and its live-proof count must
  equal what `tools/run-proofs.mjs` registers. When you add a migration or a
  proof, update those two facts in the SAME commit, and write next to them that
  0212+ are WRITTEN BY THE NIGHT AGENT, NOT APPLIED. Never claim a proof passed.
- **The repo AND `docs/` are PUBLIC** (docs/ is served at samo.md.kku.ac.th/docs).
  Never commit detail of a STILL-OPEN security hole. Security findings go to
  `~/samo-night/reports/` (outside the repo; create the directory). Commit
  messages for security fixes say what was tightened, not how to exploit it.
- **Memory**: ~60 files at the path in your preamble. Read the ones relevant to
  your task — they hold decisions that are nowhere in the repo.
- Follow `CLAUDE.md`: bug write-ups in `docs/mistakes/*.md` for bugs you FIX, a
  `PENDING` entry in `src/data/changelog.js` for anything a person would NOTICE
  (plain Thai, `changelog.test.js` enforces the rules), keep `STATE.md` short.
  Run `npm run mistakes:index` after a write-up. Thai UI text, no emojis in UI,
  light theme only. `npm test` and `npm run build` green before every commit.
- **Commit as you go** (`git commit` per meaningful step). A run can be cut off by
  the quota at any moment; uncommitted work is swept into a WIP commit, but a
  coherent commit is worth more to the morning reviewer.

⛔ **THERE IS NO HUMAN AWAKE. NEVER END A TASK BY ASKING A QUESTION.**
When something is ambiguous, decide, act, and record what you chose, what you
rejected and what would change your mind — in the file you are writing, or in
`docs/state/night-agent.md`. A defended decision the owner can overturn is
worth far more than a question nobody reads until morning.

---

## 1. หนังสือโครงการ: ผู้ส่งหนังสือ tags each โครงการ with ฝ่ายสโม, and everyone can filter by it
Done when: test -f supabase/migrations/0212_project_samo_depts.sql && test -f tools/proj0212-samo-depts.mjs && grep -rq samo_depts src/js/projects && grep -q samo_depts src/js/projects-view.js && npm test --silent && npm run --silent build

ASKED by the owner: "for each โครงการ ผู้ส่งหนังสือ can tag the โครงการ to
ฝ่ายสโม … then they can filter it by ฝ่ายสโม … also do filter for the normal
people view from the samoweb that isn't in the admin".

Facts measured on production 2026-10-13 (you cannot query them):
- `public.projects` (41 rows): id text, name, description, status, created_by,
  created_at, updated_at, drive_folder_url, drive_folder_id, is_public boolean,
  fiscal_year_be smallint. Policies: projects_read, projects_read_public,
  projects_insert, projects_update, projects_delete. anon has SELECT (public
  projects via projects_read_public).
- "ฝ่ายสโม" = the ฝ่ายของอุปนายก list the site already uses: **`VS_DEPTS` in
  `src/js/team-vocab.js`** (12 values: นายกสโม, SE, อุปนายกฝ่าย…). Use THOSE
  values. Do not invent a second list (mistakes class 6).
- The public view is the `/projects-view` route: `src/js/projects-view.js`,
  which mounts the projects module in role='customer' mode. The admin side is
  `src/js/projects/` (inbox.js, manage.js, index.js, data.js, api.js).
- The ผู้ส่งหนังสือ desk is project seat `vpa` (PROJECT_SEATS in team-vocab.js;
  `current_user_project_seats()` in SQL; `master` folds into every seat — read
  memory `master-grants-all-project-seats.md` and `.claude/rules/mistakes.md`
  class 5 before writing any seat check).

Build:
1. `supabase/migrations/0212_project_samo_depts.sql`: `projects.samo_depts
   text[] not null default '{}'`. Writes go through ONE SECURITY DEFINER RPC
   `set_project_samo_depts(p_project text, p_depts text[])` that checks the
   caller holds the vpa desk (or master), refuses an unknown value, and writes
   only that column. ⛔ `projects_update` is a ROW policy, which grants every
   column (mistakes class 1): make sure a caller who can update a project row
   for another reason cannot set `samo_depts` directly — a column guard in a
   BEFORE UPDATE trigger, exempting the RPC, is the usual shape here. If the
   allowed list is written in SQL, add a vitest that parses the migration and
   asserts it EQUALS `VS_DEPTS` values (a differential test, not a comment).
2. `tools/proj0212-samo-depts.mjs`, in the shape of `tools/discord0208-panel.mjs`
   (rolled-back transaction, DENY beside ALLOW over the same rows): a non-vpa
   user is refused, a vpa holder and a master can tag, an unknown ฝ่าย is
   refused, a direct UPDATE of the column by a non-vpa row-editor changes
   nothing, anon reads tags only on public projects. Register it in
   `tools/run-proofs.mjs`. You cannot run it — say so.
3. Admin (`src/js/projects/`): on a project, a ฝ่าย tag picker (chips, several
   allowed) shown to the vpa desk; tags shown as chips on the project in the
   inbox/list; a "ฝ่าย" filter in the list toolbar that combines (AND) with the
   filters already there and survives the module's URL/hash state if it has one.
4. Public (`/projects-view`): the same chips and a ฝ่าย filter. Read-only.
5. Pure filter logic in a function with vitest coverage (one tag, several tags,
   no tag, unknown tag value from old data still renders).
6. Two `PENDING` changelog entries (staff: tagging; public: filtering).

## 2. หน้าฝ่าย: every ฝ่าย exists, and its people can be given the right to edit it
Done when: test -f supabase/migrations/0213_dept_pages_for_every_dept.sql && node --input-type=module -e "import('./src/data/depts.js').then(({DEPT_DEFS})=>{const have=Object.values(DEPT_DEFS).map(d=>d.title);const want=['สำนักนายกฯ','ฝ่ายบริหารองค์กร','ฝ่ายดิจิทัลและสื่อสารองค์กร','ฝ่ายกิจการภายใน','ฝ่ายกิจการภายนอก','ฝ่ายกิจการมหาวิทยาลัย','ฝ่ายวิชาการ','ฝ่ายยุทธศาสตร์และพัฒนาองค์กร','ฝ่ายคุณภาพชีวิตและสิ่งแวดล้อม','ฝ่ายรังสีเทคนิค','ฝ่ายเวชนิทัศน์','ฝ่าย รพ. ร่วมผลิต'];process.exit(want.every(w=>have.includes(w))?0:1)})" && npm test --silent && npm run --silent build

ASKED by the owner: "the หน้าฝ่าย tab, currently there's not all ฝ่าย exist,
people have complaint that there isnt their ฝ่าย and cant go in to edit, add all
ฝ่าย, and the permission".

Facts measured on production 2026-10-13: the ทีม SAMO tree (`team_nodes`, kind
'division', parent NULL) has these 12 top-level ฝ่าย, EXACT names:
สำนักนายกฯ · ฝ่ายบริหารองค์กร · ฝ่ายดิจิทัลและสื่อสารองค์กร · ฝ่ายกิจการภายใน ·
ฝ่ายกิจการภายนอก · ฝ่ายกิจการมหาวิทยาลัย · ฝ่ายวิชาการ ·
ฝ่ายยุทธศาสตร์และพัฒนาองค์กร · ฝ่ายคุณภาพชีวิตและสิ่งแวดล้อม · ฝ่ายรังสีเทคนิค ·
ฝ่ายเวชนิทัศน์ · ฝ่าย รพ. ร่วมผลิต
(also at top level and NOT ฝ่าย: อาจารย์, เจ้าหน้าที่คณะแพทย์, and a test node
"เอิงtesting" — leave those out). `DEPT_DEFS` in `src/data/depts.js` has only 6
(admin, digital, academic, strategy, media, rt). Missing: สำนักนายกฯ,
กิจการภายใน, กิจการภายนอก, กิจการมหาวิทยาลัย, คุณภาพชีวิตและสิ่งแวดล้อม,
รพ. ร่วมผลิต. `src/css/base.css` already has `--dept-internal`,
`--dept-external`, `--dept-university`, `--dept-quality`; สำนักนายกฯ and
รพ. ร่วมผลิต need tokens of their own (distinct from the other ten). The SQL
side deliberately does NOT hardcode the key list (0177 line 58).

Build:
1. Add the six to `DEPT_DEFS` (stable lowercase keys, e.g. office, internal,
   external, university, quality, hospital; titles EXACTLY as above). Everything
   that derives from DEPT_DEFS (the ฝ่าย page grant picker DEPT_PAGES in
   team-vocab.js, the public หน้าฝ่าย routes in `src/js/departments.js`, the
   tools registry `src/data/tools.js`, `src/html/tab-departments.html` if it
   lists ฝ่าย) must show all 12. A new ฝ่าย with no content yet shows a calm
   empty state, never a broken page. Check `src/js/dept-page-admin.js`: the
   /admin/ → หน้าฝ่าย picker must offer the new ones to a scoped editor.
2. Permission. Read `current_user_dept_page_scope()` (0177, ~line 130) and
   decide from the CODE whether a `dept_page` set on a node is inherited by
   everyone posted under it. Write `supabase/migrations/0213_dept_pages_for_every_dept.sql`
   (NOT applied) that sets `team_nodes.dept_page` on each of the 12 top-level
   ฝ่าย nodes, matched by EXACT name, only where it is NULL, so the people of a
   ฝ่าย can edit that ฝ่าย's page. If inheritance would also let someone edit a
   page they should not, or let a member PUBLISH without review, narrow it and
   say why. Record the decision at the top of the migration. A proof
   `tools/dept0213-every-dept.mjs` (rolled back; a member of one ฝ่าย can edit
   theirs and NOT another's), registered in run-proofs.
3. vitest: DEPT_DEFS ⊇ the 12 titles; every key has a colour token that exists
   in base.css; DEPT_PAGES offers all 12.
4. A `PENDING` changelog entry: every ฝ่าย has its page now.

## 3. SECURITY REVIEW (deep) — the database
Done when: test -s "$HOME/samo-night/reports/2026-10-13-security-db.md" && grep -q '^## Verdict' "$HOME/samo-night/reports/2026-10-13-security-db.md" && npm test --silent

Thorough and adversarial. The owner asked for "thoroughly intensive".
Scope: every RLS policy, every SECURITY DEFINER function, every GRANT/REVOKE,
every trigger, across `supabase/migrations/` — take the LATEST definition of
each object (a later migration replaces an earlier one; build an index first).
Include this branch's 0212/0213 and 0211 (`account_dashboard`, master-only).
`passport` schema too (memory `passport-security-hardening-inflight.md`).
Method: the seven classes in `.claude/rules/mistakes.md` are your checklist —
go object by object, not class by class. Read `docs/mistakes/authz-rls.md` and
`authz-grants.md` first; do not re-report what they record as fixed.
For each finding: severity (critical/high/medium/low), object + file:line,
who can do what to whom, the fix. FIX what you can safely fix: frontend code
directly; SQL as a new migration (0214+, NOT applied) with a proof script.
Report: `~/samo-night/reports/2026-10-13-security-db.md` (OUTSIDE the repo —
it may describe open holes), ending with `## Verdict` (what is fixed on the
branch, what is open, what the owner must do first).

## 4. SECURITY REVIEW (deep) — the app, the servers, Apps Script
Done when: test -s "$HOME/samo-night/reports/2026-10-13-security-app.md" && grep -q '^## Verdict' "$HOME/samo-night/reports/2026-10-13-security-app.md" && npm test --silent && npm run --silent build

Scope: `src/` (every `innerHTML`/template with data in it, `safeUrl`, iframes
and the ฝ่าย tool sandbox — memory and `docs/INVARIANTS.md` "A ฝ่าย's own HTML is
ISOLATED", auth flows in `auth.js`, open redirects, CSV injection, anything that
trusts a client-side role), `server/*.mjs` (notify, discord oauth + sync —
injection, SSRF, auth on every route), `server/nginx-samo.conf`, `appscript/*.gs`
(memory `gas-is-an-unauthenticated-api.md`: Execute-as-Me + Anyone — every
handler that takes an id or address), `passport/js/`, secrets in tracked files.
Same reporting and fixing rules as task 3; report
`~/samo-night/reports/2026-10-13-security-app.md` ending `## Verdict`.

## 5. BUG REVIEW (deep) — the admin app
Done when: test -s docs/state/agent-notes/2026-10-13-bug-review-admin.md && grep -q '^## Verdict' docs/state/agent-notes/2026-10-13-bug-review-admin.md && npm test --silent && npm run --silent build

Scope: `admin/index.html`, `src/js/admin-main.js` and every admin module —
projects, shop admin, team, house, VS/PR, creator/announcements, dept pages,
discord bot, accounts (บัญชีผู้ใช้, new this week), and this branch's own work
from tasks 1–2. Hunt REAL bugs: wrong results, stale state across re-renders
and account switches, listeners added per render, a message turned on and never
off, a filter that loses rows, a count that disagrees with its list, error
paths that fail silently, mobile overflow. `docs/mistakes/frontend-ui.md` and
`app-state.md` hold the shapes this repo keeps repeating — read them first.
For each CONFIRMED bug: fix it with a test that fails without the fix (do the
mutation ritual: break it, see red, restore), write it up in `docs/mistakes/`.
Report `docs/state/agent-notes/2026-10-13-bug-review-admin.md` (public — fixed
bugs only; anything security-flavoured goes to the private report of task 4),
ending `## Verdict`.

## 6. BUG REVIEW (deep) — the public site and Passport
Done when: test -s docs/state/agent-notes/2026-10-13-bug-review-public.md && grep -q '^## Verdict' docs/state/agent-notes/2026-10-13-bug-review-public.md && npm test --silent && npm run --silent build

Scope: `index.html`, `src/js/main.js` and every public module (home, news,
VS/PR forms, shop storefront + checkout, my-seat/my-house, about/org chart,
projects-view including task 1's filter, dept pages including task 2's new
ones), and `passport/` (scan, dashboard, admin). Same method and rules as task
5; report `docs/state/agent-notes/2026-10-13-bug-review-public.md` ending
`## Verdict`.
