# Claude / Agent Router — samomdkkuweb

Slim entry point. Everything else is read on demand.

## Project

MDKKU SAMO student-portal SPA. Vite + Vanilla JS + Bootstrap on Supabase (auth
+ Postgres + RLS). Apps Script (`appscript/`) survives as a thin proxy for
Discord webhooks, Drive uploads and the หนังสือโครงการ email (`MailApp`,
quota-bound — ceilings in `docs/EMAIL.md`).

Live URLs:
- **Production: `https://samo.md.kku.ac.th` — the KKU VM, `main` branch.**
- `samomdkkuweb.pages.dev` / `samomdkkupassport.pages.dev` are **RETIRED** but
  still RESOLVE and splash-redirect, so a check there looks healthy while the
  real host is stale. Never verify a deploy there. ⛔ Never DELETE the passport
  one — 82% of printed QR posters point at it.

**Pushing `main` does NOT deploy.** `server/deploy.sh` runs ON the VM over ssh —
`skills/deploy-vm.md`, needs VPN. Verify from the SERVED artifact on
`samo.md.kku.ac.th` (the VM builds its own hashes — find the bundle name in the
served HTML).

Supabase project: `fheueuowbchsnsvbcgil`.

## Tech stack (quick)

- **Frontend**: Vite 6, Vanilla ES modules, Bootstrap 5, Quill, d3-org-chart,
  GrapesJS — **DYNAMIC IMPORT ONLY, never an entry bundle**
- **Auth + DB**: Supabase Auth (Google + username/password), Postgres with RLS
- **Files**: Google Drive via GAS `uploadPRFile` (2 TB quota)
- **Discord**: GAS proxy `notifyPROnly` / `notifyVSOnly` / `notifyVSConsult`
- **Hosting**: KKU VM (nginx) via `server/deploy.sh` over ssh. Pages is retired.
- **Env vars**: `VITE_*` baked in at build time on the VM. Every secret and its
  tier is in `.claude/rules/security.md`, already loaded.

## Commands

```bash
npm run dev      # :5174 — uses samo-dev, NOT production, and says so on start
npm run build    # production build → dist/ (takes VITE_* from .env.local)
npm run setup    # write .env.local from a pasted block (env:share sends one)
```

## File placement

| Adding | Goes in |
|---|---|
| New HTML tab/modal | `src/html/*.html` (HTML partial; include from `index.html`) |
| New CSS | `src/css/*.css` (then `@import` from `src/main.css`) |
| New JS module | `src/js/*.js` (ES module) |
| A ฝ่าย tool (launcher + ฝ่าย page) | **one entry in `src/data/tools.js`** — never markup in `tab-tools.html`, which is generated |
| A ฝ่าย's OWN page (they wrote the HTML) | `public/embed/<slug>/` + a `kind:'embed'` entry — copy `starter/` |
| Window-bound fn (for `onclick=""`) | Wire in `src/js/main.js` |
| New Supabase schema | New numbered file in `supabase/migrations/` |
| Backend GAS edit | `appscript/*.gs` (then redeploy — see skills/deploy-gas.md) |
| Any schema change | New numbered migration + a both-directional proof — `skills/ship-a-migration.md` (ADD then deploy; DROP only after the new bundle is SERVED) |
| nginx, Docker, the `/vault/` vault | `skills/vaultwarden.md` |

## UI/UX guidelines

- **Brand**: white-dominant, gray gradient body, green primary, orange accent
- **Wordmark**: `MDKKU` in `--brand-primary` (#105922), `SAMO` in `--brand-orange` (#FF6F30)
- **Per-tab accents** (scoped via tab-level class on the pane):
  - PR form → pink (`--pink-*` keeps its original pink scale)
  - VS form → teal (`.vs-tab` overrides `--pink-*` to teal scale)
  - Announcements/Creator → slate (`.an-tab` overrides to neutral)
  - Admin → green primary
- **Departments**: 10 unique color identities (see `src/css/base.css` `--dept-*`)
- **Fonts**: Noto Sans Thai (body), Prompt (brand + secondary), via Google Fonts; fallback chain in `src/css/base.css`.
- **Density**: tight on mobile, generous on desktop; Bootstrap utilities.
- **No emojis in UI text** unless the user explicitly asks.

## Memory layout — what loads, what you fetch

**Auto-loaded every session** (`CLAUDE.md` + all of `.claude/rules/`): this
file, `mistakes.md` (the recurring CLASSES + which write-up file holds what),
`security.md` (key hygiene). Budget enforced in BYTES by
`npm run check:context`, which `npm test` runs. **Never put a bug write-up, a
session narrative, or anything that GROWS WITH THE WORK in `.claude/rules/` —
it is charged to every future session.** The per-entry symptom index lives in
`docs/mistakes/INDEX.md`; do not move it back (it reached 18.5k of 30k there).

**READ FIRST — `STATE.md`, `docs/INVARIANTS.md`, `docs/state/HANDOFF.md`.**
HANDOFF is the ONLY list of what is NOT done; every section carries a `Status:`
(VERIFIED *how* / HYPOTHESIS / DECIDED / OWED) saying how far to trust it — a
HYPOTHESIS is a theory to TEST, not a fact. Guarded. FIVE homes; mixing them is
what made the handoff unreadable. **`STATE.md`** = true right now (~200 lines,
guarded) · **`docs/INVARIANTS.md`** = rules outliving a session · **HANDOFF** =
what is NOT done · **`docs/state/<handle>.md`** = one person's notes, never
rewritten by others · **`docs/state-archive/`** = why.

`STATE.md` carries what is in flight, deployed and owed — what changes what you
do FIRST. Everything else below is fetch-when-needed; these two are not, and
skipping them is how a session re-breaks yesterday's work.
⛔ **Write to the right home.** A session narrative appended to `STATE.md` took
it to 1,403 lines against a 200-line target; `state-handoff.test.js` fails the
build if it grows back.

**Read on demand.** Fetch the one you need; don't preload.

- `docs/mistakes/*.md` — the bug write-ups, nine files by area, plus the
  generated `INDEX.md`. `.claude/rules/mistakes.md` says which file to open, but
  `grep -rin "<symptom>" docs/mistakes/` is usually faster — it searches the
  write-ups, not their titles. **Read the matching file BEFORE touching
  `src/js/auth.js`, `src/js/db.js`, any RLS policy / `current_user_*` helper /
  SECURITY DEFINER function, `server/deploy.sh`, or `appscript/*.gs`.**
- `README.md` / `CONTRIBUTING.md` — human onboarding; open only to verify or
  when editing project policy.
- `docs/TEAM-WORKFLOW.md` — multi-dev plan (dev env, previews, credentials).
  **DESIGN ONLY**; §0 = owner decisions, do not re-litigate
- `docs/DEPT-TOOLS.md` — how a ฝ่าย ships a tool without IT (content / embed / native). **DESIGN ONLY**; §10, §13
- `docs/SHOP-GALLERY.md` — shop pictures; read before touching `images`
- `docs/CONTEXT.md` — architecture, RLS, schema, deploy plumbing, workflows
- `docs/HOUSE-DATA-REPAIR.md` — ระบบบ้าน: which broken field a STUDENT fixes, an
  ADMIN must, or only ฝ่ายข้อมูล can; the one case that fails OPEN. READ BEFORE
  promising a data fix or touching the claim / held list
- `docs/EMAIL.md` — who sends mail and the quota ceilings. The VM CAN send via
  a relay (587 out); it cannot BE or RECEIVE mail (25 blocked, no inbound port,
  `p=reject`). READ BEFORE touching mail.
- `docs/SUPABASE-MIGRATION.md` — **HISTORICAL** Sheets→Supabase. Not a status.
- `docs/MERGE-CHECKLIST.md` — merging refactor → main
- `docs/VERSIONING.md` — release numbering + workflow. READ BEFORE bumping a
  version or adding a release note; `npm run release` does the mechanical half
- `docs/AUTH-MODEL.md` — **HISTORICAL** pre-Supabase user model; its "current
  state" is the GAS era
- `docs/KKU-SSO.md` — a login improvement, NOT a data source (no roster, สายรหัส
  or สาขา). Manual: `KKU-SSO-MANUAL.md`
- `docs/PROJECT-ARCHITECTURE.md` — multi-project engine proposal. DEFERRED
- `docs/DISCORD-ROLE-SYNC.md` — ทีม SAMO → Discord roles. **DESIGN ONLY**; §7 is
  owner-only and blocks the rest. READ BEFORE any Discord bot code.
- `docs/demos/*/README.md` — comparisons the owner is choosing between; not
  shipped code
- `skills/*.md` — playbooks for the non-obvious workflows.

## Handoff loop (MANDATORY)

⛔ **Run it when a UNIT OF WORK LANDS — not at "the end", which nobody
controls** (the owner has noticed at 92% of a session, too late to write one).
⛔ **And never ASSERT the handoff is done — RUN step 6 and paste its verdict.**
Late in a long session you will misremember having written it; the command reads
git, the filesystem and the database, so it is right when you are not.

1. **Update `STATE.md`** — only if real state changed (branch HEAD, pending migrations, in-flight work, blockers). No session narrative: `git log` is the archive. Under ~200 lines; if it bloats, prune old sections to `docs/state-archive/YYYY-MM-DD.md`.
2. **If a bug was found and fixed**: write it up in the matching
   `docs/mistakes/*.md` (**Symptom → Cause → Fix → Where it lives now**, ending
   with the general rule; lead with the symptom AS REPORTED — what the next
   reader greps for), then `npm run mistakes:index`. A new instance of one of
   the seven classes gets its site added in `.claude/rules/mistakes.md`. Prefer
   a guard over a paragraph: writing a hazard down makes nobody check it
3. **If a person would NOTICE it** (อัปเดตระบบ / release notes at `/updates`):
   append to `PENDING` in `src/data/changelog.js`, in the same commit. Plain Thai a
   student could read — no table names, no migration numbers, no permission
   keys; `changelog.test.js` enforces that. Write it NOW, not at release time:
   the details that make a good note (what was annoying before, what you no
   longer have to do) are exactly what is forgotten weeks later when someone is
   reconstructing it from `git log`. `npm run release` folds `PENDING` into the
   new version and clears it. A refactor, a test, or a migration nobody
   experiences gets NO entry; a one-line fix that unblocked a real workflow
   does.
4. **If a repeatable multi-step workflow appeared**: add/update `skills/*.md`.
5. **Docs (only if true):** user-visible feature added/removed → `README.md`
   "Key features" · architecture, schema, RLS, deploy or auth changed →
   `docs/CONTEXT.md` · build/install/env changed → `README.md`.
   **Internal-only (refactor, bugfix, test, comment) — SKIP.** Doc edits are a
   side-effect of meaningful change, not a tax on every commit.
6. **RUN `npm run handoff:check`** — the step that can FAIL. Checks the
   mechanical part: uncommitted work, unpushed HEAD, unindexed memories, dead
   pointers in them, a HANDOFF section with no `Status:`, STATE.md over budget
   or behind the work, prod behind the sha STATE.md claims, the VM's agent
   memory out of sync, **a count in a doc the DATABASE contradicts**.
   ⛔ A skip is NOT green. ⚠️ It cannot tell if a sentence is TRUE.
7. Say "Updated STATE.md / docs/mistakes / changelog / skills/* as needed" and
   paste its verdict.

This keeps cold-start agents from re-walking bugs we already paid for, and docs from going stale. **Step 6 exists because 1–5 were a list somebody had to remember, and remembering is what kept failing.**

## Authority model

- Default behavior: ask before destructive ops (force push, dropping a TABLE,
  mass-deleting rows, prod GAS redeploys).
- **The user has authorized, and this is the normal flow — do not ask each
  time:** commit and **push `main`**, apply migrations to the live Supabase
  project (`tools/apply-migration.mjs`), and **deploy to production**
  (`skills/deploy-vm.md`). This session did all three roughly ten times; the
  expectation is that work ships, not that it waits. Batch commits before
  deploying (duration: `skills/deploy-vm.md`, its one home).
- **Dropping a COLUMN is allowed when the owner has asked for it** (0129 dropped
  five on their "shouldn't that be gone"), but it is ordered: **deploy the code
  that stopped reading it FIRST**, confirm that bundle is being SERVED, then
  drop. Reversing that took prod down for ~20 min. See
  `skills/ship-a-migration.md`.
- The user has NOT authorized: force push, amending pushed commits, dropping
  tables, mass-deleting rows.

## Notes that change frequently

Everything that decays — current task, what's in flight, what just broke —
lives in `STATE.md`, not here.
