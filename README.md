# MDKKU SAMO — Student Portal

Web portal for the Medical Student Union of Khon Kaen University (MDKKU SAMO).
Single-page Vite app for student announcements, public-relations (PR) job
intake, and the Vital Sound grievance/ticket system.

## Live

- **Production**: <https://samo.md.kku.ac.th> — self-hosted on the KKU VM
  (nginx), built from `main`.

⚠️ **`samomdkkuweb.pages.dev` is RETIRED.** It still resolves and
splash-redirects to the VM, so a check against it can look healthy while
production is stale — never verify a deploy there.

The `samomdkkuweb` Cloudflare *project* is very much alive, though: it is what
builds every preview, including the stable `preview.samomdkkuweb.pages.dev`.
Only its bare apex URL is retired. (`refactorsamomdkkuweb` was a second, genuinely
dead project and was deleted on 2026-09-04.)

**Pushing `main` does not deploy.** `server/deploy.sh` runs on the VM and is
triggered over ssh (needs the KKU VPN).

## Key features

- **หน้าฝ่าย — each department edits its own page.** Ten ฝ่าย have a page on the
  site, and until 2026-09 changing a word on one meant a commit and a deploy by
  the owner; five of the six with pages had no content at all because of it. Now
  a granted ฝ่าย member opens **หน้าฝ่าย** in the staff area and builds the page
  from four kinds of block — a **หัวข้อ** heading that groups what follows, a
  **การ์ด** link tile, a **ข้อความ** paragraph, or **their own HTML** — uploading
  covers straight from their machine. On an HTML block there is also
  **แก้แบบเห็นภาพ**, a drag-and-drop editor with 21 ready-made blocks in five
  groups — รายการ, ตาราง, ขั้นตอน, คำถามที่พบบ่อย, กล่องเน้นข้อความ and the rest —
  so nobody has to write markup to get a real page. A new block is a draft until
  they press แสดง, and saving puts it live with no deploy. Their HTML renders inside a sandboxed frame on an opaque
  origin, so it can reach nothing: not the signed-in session, not the database,
  not the rest of the page. That isolation is the reason it is safe to accept
  HTML at all, and the reason it is deliberately **not** filtered. A grant names
  exactly one ฝ่าย, and the database — not the screen — is what enforces it.
- **จองโควตา Claude.** SAMO has one Claude Pro subscription; this is the admin
  page people use to claim a share of it. A week calendar shows who booked what,
  for what, and how much is left. The unit is *session percent* — a 5-hour
  session carries 100% and the week carries 700%. The green frames are the idea:
  a session is opened by the first booking in an area and runs five hours from
  there, and everyone whose block lands inside one frame shares that frame's
  100%. Blocks are at most 5 hours, never overlap, and every cap is enforced by
  the database rather than the form. It **coordinates rather than enforces** —
  everyone shares one login — so `tools/claude-usage-report.mjs` can run where
  the credentials are and post the real usage back for comparison.
- **ระบบบ้าน (House).** Every student in the faculty gets a record they can see
  by signing in with their kkumail — their สายรหัส, their อาจารย์ที่ปรึกษา, and
  their house. There are ten houses and a student's house is the last digit of
  their สายรหัส, so the split is even and needs no manual assignment. **It
  publishes อาจารย์, never students** — a student sees the อาจารย์ที่ปรึกษา of
  their own สาย and of every สาย in their house, and no other student's name
  anywhere. Students can fix their own ชื่อ, ชื่อเล่น, รหัสนักศึกษา, สาขา and
  ชั้นปี, and flag a wrong สายรหัส for an admin to approve — the admin's decision
  and reason come back to them on the same card. Admins import the roster from a CSV
  (previewed before anything is written, and re-runnable without destroying what
  students typed), name and illustrate each house, and assign อาจารย์ per สาย.
- **One account across the portal.** A person is one record
  (`public.people`): fixing your name or ชื่อเล่น anywhere — your own card, the
  ทีม SAMO admin pane, the ระบบบ้าน admin pane — updates everywhere. Signed-in
  users see a single **ข้อมูลของฉัน** card with their identity once, then a
  ทีม SAMO section and a ระบบบ้าน section.
- **Announcements board.** Public read; staff post via a Quill-based rich-text
  editor. Per-department thumbnails and theming.
- **PR submission.** Form-based job intake with file upload, deadline mode,
  multi-platform targets, and idempotent submit (safe to retry on network blip).
- **Vital Sound tickets.** Confidential intake with dynamic department routing,
  remarks thread, and cross-department consult/transfer for staff. A PDPA
  consent popup appears every time a report is sent — only ยินยอม proceeds;
  declining cancels that submission. On close, staff record a resolution reason
  (fixed / forwarded to faculty / can't-do + reason / duplicate) that the
  submitter sees as a plain-language outcome instead of a bare "completed".
  For triage, each department keeps its own internal, staff-only tags (colour
  chips, filterable on the kanban) — separate from the shared public category.
- **Vital Sound public board.** A curated, student-facing board of ongoing
  "Problems" unified into the VitalSound tab (browse/sort/filter, 4-phase
  status). SE publishes a canonical ticket with a hand-written public title
  (the raw report is never shown); signed-in @kkumail students hit "เจอเหมือนกัน"
  (me-too aggregation) and add pseudonymous comments. Confidential categories
  never appear on the board.
- **ทีม SAMO org chart.** Public page (`/team`) showing the whole structure —
  ฝ่าย, ตำแหน่ง, and who holds each — with a search that keeps the branch a match
  sits in. TWO views over the one dataset: **แผนผัง**, a page of ฝ่าย panels that
  reflow at any width (each ฝ่าย opens with the ตำแหน่ง it holds, grouped by
  ระดับ, and its sub-ฝ่าย as cards you tap to open), and **ผังรวม**, the whole
  organisation as one real top-down chart on a zoom/pan canvas drawn by
  `d3-org-chart`. The canvas reads the structure as a REPORTING chart: a ฝ่าย's
  sub-ฝ่าย hang off its head ตำแหน่ง rather than sitting beside it. It carries
  per-ตำแหน่ง expand, a **แสดงถึง** selector whose rungs are ฝ่ายหลัก / ฝ่ายย่อย
  / ตำแหน่ง / ทั้งหมด (a kind, not a depth — this org's branches are not the
  same shape), and a full-screen toggle (a CSS overlay, not the Fullscreen API,
  which iPadOS only honours for `<video>`). Each ฝ่าย carries a colour the
  admin can choose, used on both the public chart and the admin tree. There is
  deliberately no separate คณะกรรมการ portrait grid: the chart already states
  rank by position, so a second larger rendering of the same people was both a
  duplicate and a competing ranking.
  Switchable by **ปีการศึกษา**: the current year renders from the live tree, past
  years from a published snapshot that stays editable in the admin. Fed by one
  SECURITY DEFINER projection (`get_public_team_chart`), so it can only ever show
  name, nickname and photo: no email, student id, year, major or permissions, and
  nodes marked non-public hide their whole subtree. Portraits are uploaded per
  member in ทีม SAMO — downscaled in the browser, filed in Drive by year and ฝ่าย,
  and served as server-cropped WebP. In the admin tree a ตำแหน่ง is placed
  directly under its ฝ่าย and given a **ระดับ** with one tap, rather than being
  nested inside another ตำแหน่ง to make the chart rank it — so the stored tree
  says who is IN a ฝ่าย and ระดับ says who is drawn above whom.
- **Release notes.** A public changelog at `/updates`, reached from the footer
  and from the version chip in the footer bar. Curated entries (not a git-log
  dump) grouped ใหม่ / ปรับปรุง / แก้ไข, tagged by product area, filterable by
  audience (นักศึกษา / ทีมงาน), laid out on a timeline that draws itself as you
  scroll, and anchored per release so a version can be linked directly.
  Versioned `MAJOR.MINOR.PATCH` with MAJOR redefined for a product with no API
  consumers — see **`docs/VERSIONING.md`** for the policy, the
  Conventional-Commit mapping and the release workflow. Cut one with
  `npm run release`. Content lives in `src/data/changelog.js`; `npm test`
  enforces that each bump matches its tier, that `package.json` agrees, and
  that no entry leaks a table name or migration number into user-facing copy.
- **"เบื้องหลังการพัฒนา" panel.** On the landing page: systems opened, versions
  released, changes shipped and weeks elapsed, over a timeline of when each
  system opened. It deliberately shows **no commit counts, lines of
  code, streaks or contribution heatmap**: those measure effort rather than
  result, are discredited even inside engineering, and read to a non-developer
  as either noise or grinding. A test enforces their absence. The raw history is
  still frozen into `src/data/dev-activity.json` by `npm run gen:activity` (no
  GitHub API call at render time, and no committer emails in the bundle); the
  page reads only the date range from it. It also makes no "built entirely
  in-house" claim and promises no release cadence — both are asserted by tests,
  because both would be overstatements.
- **Kanban dashboard.** Status-column board for PR staff with department filter
  and quick-edit modal.
- **SAMO Shop.** Product catalogue (filter by source / admin-managed type,
  sort, search), cart with localStorage persistence, checkout with required
  name+email+phone contact step (phone auto-fills from the signed-in
  profile), admin-managed PromptPay accounts assignable per product (a
  mixed-account cart splits into one order + slip per account) and per-product
  pickup locations shown at buy-time, slip upload to Drive, order timeline
  (pending → review → paid → produce → ready → done), per-order QR codes
  (customers show, admins scan via the camera viewfinder in the orders
  tab — `/admin/?scan=<id>` also opens the order directly), pickup-batch
  announcements, an admin-curated swipe-banner carousel for both
  เปิดตัวล่าสุด and ประกาศ (upload + reorder + per-placement), and full
  admin (orders table with size/colour variant dropdowns on order
  create/edit, slip-verify queue, batches, product CRUD, QR settings).
- **Project-document tracking.** SAMO VP-Administration sends "หนังสือโครงการ"
  (projects containing multiple documents) to a designated university officer.
  Document workflow: sent → received → in progress → completed (with off-path
  returned + cancelled). Files (Word / PDF / etc.) upload to Drive under
  organised per-project folders; replace is non-destructive (old versions
  kept). Receiver gets in-app + email notifications; sender gets in-app +
  Discord webhook on every status change / comment. Bookmarkable deep links
  (`#projects/PRJ-XXXX-NNNN/doc/DOC-…`). Per-project QR code generates a
  scannable link to the Drive folder so the whole project (organised as
  one subfolder per หนังสือ, each with its file attachments) can be
  shared in one tap. **Customer mirror** at `/projects-view` exposes the
  same surface read-only to anonymous visitors (gated by migration 0032);
  reuses the admin renderers via `role='customer'` so admin UI changes
  flow through without drift. The sender picks what that mirror shows:
  a ซ่อน/แสดง toggle per โครงการ and per หนังสือ, enforced in RLS
  (migration 0114), defaulting to shown. Hiding a โครงการ hides every
  หนังสือ and file under it; signed-in staff keep seeing everything.
  **Professor signing (migration 0050).** The
  university officer can send a chosen subset of a หนังสือ's files to a
  professor (the `อาจารย์` seat) who signs them — either in-browser (draw a
  signature and place it on the PDF) or by uploading an externally-signed
  file — or rejects them back. The officer can also add / replace / remove
  files like the sender; the professor sees only the documents sent to him.
- **Departments tab (`ฝ่าย`).** Top-level navbar entry showing all 10
  ฝ่ายในสโมสร with per-dept tool drill-down. Each ฝ่าย links to its
  own tools (SAMOShop + customer หนังสือโครงการ for บริหารองค์กร,
  PR Form for ดิจิทัล, VitalSound + SAMO Passport for ยุทธศาสตร์,
  Notion resource DB for วิชาการ, external sites for เวชนิทัศน์ /
  รังสีเทคนิค). All links are also surfaced in the เครื่องมือ launcher
  search.
- **SAMO Team directory.** Admin section (vp_admin + dev) managing the org as
  an editable tree — divisions → departments → roles → subroles at unlimited
  depth — with people under each role (KKU mail, name, nickname, student id,
  year, สาขา, confirm). Add / edit / move / delete and drag-and-drop reparent +
  reorder for both roles and members; per-role app-permission tagging with
  inheritance (in a separate "จัดการสิทธิ์" mode). Live multi-editor sync
  (Supabase Realtime) and JSON / CSV import-export. Responsive
  desktop / iPad / phone.
- **Global auth.** One sign-in, two routes: **any Google account** (a KKU
  address is not required — that misreading was reported six times and the
  screen is now written to prevent it), or a **username/password account for
  people who would rather not be identified**. The password route has no email,
  so ระบบบ้าน — which matches `users.email` against `students.kkumail` — stays
  empty for it; that is the tradeoff, stated on the screen where the choice is
  made.
  Access is granted by **two channels, not one**: the legacy roles (`pr_staff`,
  `vs_staff`, `shop_admin`, `vp_admin`, `uni_staff`, `sa_prof`, `dev`) **and**
  per-capability permissions carried on the account or inherited from a ทีม SAMO
  ตำแหน่ง (`pr`, `vs`, `samoshop`, `projects`, `creator`, `team`, `house`,
  `master`). 85 accounts hold a permission while carrying a non-staff role, so
  **anything that gates on the role list alone silently excludes them** — the
  Admin tab, the project tab + bell and every feature gate go through
  `canUseAdmin()` / `userCanAccess()`, never a bare role check.
- **Profile self-edit.** Every signed-in user can change their display
  name, add/verify a real email (Supabase magic-link), and link a Google
  identity to a username/password account so they can sign in with
  either after verifying.
- **Usage analytics.** Cookieless, anonymous page/tab tracking
  (`analytics_events`, migration 0065) feeding two views: an animated
  "SAMO Portal ในตัวเลข" social-proof strip on the public landing page
  (`public_stats()` RPC) and a staff-only สถิติการใช้งาน dashboard
  (`analytics_overview()` RPC — signups/requests/visitors over time,
  DAU/WAU/MAU, top tabs, role split).

## Tech stack

- **Frontend**: Vite 6 + Vanilla ES modules + Bootstrap 5 + Quill (rich text)
  + d3-org-chart (the ผังรวม view, lazy-loaded)
  + GrapesJS 0.23.6 (the หน้าฝ่าย visual editor, lazy-loaded, admin only —
    1.15 MB, so it must never reach an entry bundle)
- **Auth + DB**: Supabase (Auth, Postgres, Row-Level Security)
- **Files**: Google Drive via Apps Script proxy (chosen for 2 TB quota)
- **Discord**: one `/notify` proxy for PR / Vital Sign / หนังสือโครงการ webhooks.
  The same Node service also serves `/discord/callback` and `/discord/config`
  for **เชื่อมบัญชี Discord** — a student links their Discord account from
  ข้อมูลของฉัน with one click (OAuth2), and their ฝ่าย/ตำแหน่ง roles follow from
  ทีม SAMO. ⚠️ Those two nginx routes live only in the VM's live config, not in
  `server/nginx-samo.conf` — see `skills/discord-role-sync.md`.
  In production that is the **`samo-notify` Node service on the KKU VM**, which
  nginx proxies at `/notify`. `functions/notify.js` is its Cloudflare Pages twin,
  kept in the repo because the two must stay behaviourally identical
- **Hosting**: the **KKU VM** (nginx), deployed by `server/deploy.sh` over ssh.
  ⚠️ Cloudflare Pages is RETIRED — see the warning at the top of this file.
  **Pushing `main` does not deploy**

For the full architecture map, schema, and deploy plumbing see
`docs/CONTEXT.md`.

## Quick start

Prerequisites: Node 22+ (Node 20 lacks a global WebSocket, which supabase-js
now hard-requires at import — `npm test` fails on it; CI runs Node 22).

```bash
git clone https://github.com/samomdkku/samomdkkuweb.git
cd samomdkkuweb
npm install
```

Create `.env.local` with your Supabase credentials:

```bash
VITE_SUPABASE_URL=https://<your-project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon key from Supabase Settings → API>
```

Contributors should point these at **`samo-dev`**, the shared development
database — a full copy of production on a separate Supabase account. Ask a
maintainer for **an account on the [SAMO vault](https://samo.md.kku.ac.th/vault/)
with the `Dev` collection**, then `npm run env:pull` writes your `.env.local` and
keeps it current ([how to use the vault](docs/start/vault.md)). If that is not
an option, a maintainer can send the two shareable `SUPABASE_DEV_*` lines
directly (`npm run env:share`) and `npm run setup` takes them; the other two
values are migration-only — `.claude/rules/security.md`. Either way you never
have to test against the live student data.

Apply the SQL migrations in `supabase/migrations/` to your project — or, if you
have the maintainer credentials, use the tooling instead of the SQL editor:

```bash
npm run migrate:status        # what does production have, what is pending?
npm run migrate:status -- --dev   # the same question, against samo-dev
# ⚠️ the `--` is REQUIRED. Without it npm swallows the flag and this answers
#    about PRODUCTION while looking like it answered about dev.
npm run migrate:new "<slug>"  # take the next number without colliding
```

```bash
npm run dev    # http://localhost:5174 with HMR
```

To test Google sign-in locally, add `http://localhost:5174` to your Supabase
project's URL Configuration and to the Google Cloud Console OAuth client's
Authorized JavaScript origins.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server on :5174 with HMR |
| `npm run build` | Production build → `dist/` |
| `npm run preview` | Serve `dist/` locally on :4173 |
| `npm run docs:dev` | The documentation site (`docs/`) with live reload. Published at **https://samo.md.kku.ac.th/docs** (rebuilt by `server/deploy.sh`, so it updates on a deploy) and at https://samomdkku.github.io/samomdkkuweb/ (rebuilt on every push) |
| `npm run docs:build` | Build the documentation site. Part of the required CI check — markdown that breaks the site cannot merge |
| `npm test` | Vitest suite (run this and `build` before every commit) |
| `npm run email:smoke` | Send one clearly-marked test email through the real Apps Script path, and prove the recipient allow-list still refuses an address that is not on it. Both directions on purpose: that `/exec` URL is public and unauthenticated, so without the allow-list it is an open relay able to send as "MDKKU SAMO". `--to <addr>` picks a recipient. It DOES send. |
| `npm run dev:grants` | Apply `tools/dev-grants.json` — dev-only guest permissions that expire — to `samo-dev`. Refuses production and any unknown project by ref before it writes. Also runs as the last step of `dev:refresh`, since a rebuild wipes anything applied by hand. |
| `npm run deploy:owed` | Is production serving current code? Reads the deployed sha from the one place it is written (`STATE.md`'s ✅ DEPLOYED line) and compares that commit with your WORKING TREE — so uncommitted and never-added files count too. Ignores docs, write-ups and tests, which never reach a bundle. Exit 0 = nothing owed. |
| `npm run release` | Cut a release — derives the version bump from the commits since the last tag and drafts the changelog stub. Dry run unless `--write`; never pushes. See `docs/VERSIONING.md`. |
| `npm run proofs` | Run every live database proof (RLS boundaries, column guards, definer-function authorization) against the real project in rolled-back transactions, and print one verdict each. Needs `SUPABASE_ACCESS_TOKEN` in `.env.local`, so it is a maintainer step, not a CI one. `npm run proofs <substring>` runs a subset. |
| `npm run dev:refresh` | Rebuild `samo-dev` from production — schema, data and permissions — then verify the two match. Needs `CONFIRM=1`; refuses to run against production. Maintainer step. |
| `npm run env:check` | **Contributors start here.** Checks your own `.env.local`: the two `SUPABASE_DEV_*` values needed to run the site are present and filled in rather than left as placeholders, and the dev database answers. Reports the two database-work values without requiring them. |
| `npm run dev:check` | **Maintainers.** Ask production and `samo-dev` the same questions with the anon key and compare the answers. Both directions: subjects that must be allowed AND subjects that must be denied. ⚠️ Needs PRODUCTION credentials, so it fails for a contributor in a way that looks like their own keys are wrong — that is what `env:check` is for. |
| `npm run migrate:status` | What migrations this database has, and what is pending. `--dev` targets `samo-dev`; the default is production, on purpose. |
| `npm run migrate:new "<slug>"` | Create the next migration file, numbering from the higher of your working tree and `origin/main` so two branches cannot take one number. |
| `npm run gen:activity` | Refresh `src/data/dev-activity.json` from git history. Deliberately NOT part of `build` — a build should not rewrite a tracked source file. Run it when you want the landing-page numbers to move; `--check` fails if the file is stale. |

## Project layout

```text
src/
  html/        HTML partials inlined into index.html at build time
  css/         Brand tokens (base.css) + per-tab CSS, all @imported from main.css
  js/          ES modules — one file per concern
index.html     Slim shell; tabs/modals/navbar pulled from src/html/
supabase/
  migrations/  SQL migrations (canonical schema)
appscript/     Slim Apps Script source — file upload + Discord webhook proxy
docs/          Architecture, schema, deploy plumbing — read on demand
skills/        Procedure playbooks (deploy-gas)
.claude/       Rules + memory for AI agents working in this repo
```

For per-module detail see the Frontend module map in `docs/CONTEXT.md`.

## Contributing

See **[CONTRIBUTING.md](./CONTRIBUTING.md)** — branch model, touch-zone
table (what you can self-merge vs. what needs review), test-without-
spamming-prod tips, hard "don'ts" from past bugs.

Short version:

1. New visual components (tabs, modals) go in `src/html/` and are included
   from `index.html` via the Vite partial plugin.
2. No inline CSS or JS in `index.html`. CSS lives in `src/css/`, JS in
   `src/js/` as ES modules.
3. Functions wired into HTML attributes (e.g. `onclick="..."`) must be
   exposed on `window` from `src/js/main.js`.
4. Before touching `src/js/auth.js` or `src/js/db.js`, read
   `docs/mistakes/supabase-client.md` first — those modules carry hard-won
   workarounds.

## Where to look next

- **Contributor onboarding (read first):** `CONTRIBUTING.md`
- **Current state / what just shipped:** `STATE.md`
- **Agent / day-to-day work router:** `CLAUDE.md`
- **Architecture + schema + deploy:** `docs/CONTEXT.md`
- **Migration history & open phases:** `docs/SUPABASE-MIGRATION.md`
- **Merge protocol (refactor → main):** `docs/MERGE-CHECKLIST.md`
- **Anti-patterns (READ before touching auth/network/RLS):** `docs/mistakes/*.md`
  — 117 write-ups in nine files by area; the index is `.claude/rules/mistakes.md`
- **Procedure playbooks:** `skills/*.md`

## License

Internal student-association project. No public license assigned. Contact the
maintainers before reusing or forking.
