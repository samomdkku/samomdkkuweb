# Claude / Agent Router — samomdkkuweb

Slim entry point. Everything else is read on demand.

## Project

MDKKU SAMO student-portal SPA. Vite + Vanilla JS + Bootstrap, backed by
Supabase (auth + Postgres + RLS). Apps Script (`appscript/`) survives as a
thin proxy for Discord webhooks, Drive file uploads and the หนังสือโครงการ
email (`MailApp`, quota-bound — ceilings and options in `docs/EMAIL.md`).

Live URLs:
- **Production: `https://samo.md.kku.ac.th` — the KKU VM, `main` branch.**
- `samomdkkuweb.pages.dev` / `samomdkkupassport.pages.dev` are **RETIRED** but
  still RESOLVE and splash-redirect, so a check there looks healthy while the
  real host is stale. Never verify a deploy on them. ⛔ Never DELETE the passport
  one — 82% of printed QR posters point at it.

**Pushing `main` does NOT deploy.** `server/deploy.sh` runs ON the VM and is
triggered over ssh — `skills/deploy-vm.md`, needs VPN. Verify from the SERVED
artifact on `samo.md.kku.ac.th` (the VM builds its own asset hashes, so find the
bundle name in the served HTML).

Supabase project: `fheueuowbchsnsvbcgil`.

## Tech stack (quick)

- **Frontend**: Vite 6, Vanilla ES modules, Bootstrap 5, Quill (rich text),
  d3-org-chart, GrapesJS — **DYNAMIC IMPORT ONLY, never an entry bundle**
- **Auth + DB**: Supabase Auth (Google + username/password), Postgres with RLS
- **Files**: Google Drive via GAS `uploadPRFile` (chosen for 2 TB quota)
- **Discord**: GAS proxy actions `notifyPROnly` / `notifyVSOnly` / `notifyVSConsult`
- **Hosting**: KKU VM (nginx), deployed by `server/deploy.sh` over ssh.
  Cloudflare Pages is retired.
- **Env vars**: `VITE_*` baked in at build time on the VM. Every secret, and
  which tier it belongs to, is in `.claude/rules/security.md`, already loaded.

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
| A ฝ่าย's OWN page (they wrote the HTML) | `public/embed/<slug>/` + a `kind:'embed'` entry — copy `public/embed/starter/` |
| Window-bound function (for `onclick=""`) | Wire in `src/js/main.js` |
| New Supabase schema | New numbered file in `supabase/migrations/` |
| Backend GAS edit | `appscript/*.gs` (then redeploy — see skills/deploy-gas.md) |
| Any schema change | New numbered migration + a both-directional proof — **see `skills/ship-a-migration.md`** (ADD then deploy; DROP only AFTER the new bundle is SERVED) |
| nginx, Docker, or the `/vault/` vault | `skills/vaultwarden.md` |

## UI/UX guidelines

- **Brand**: white-dominant, gray gradient body, green primary + orange accent
- **Wordmark**: `MDKKU` in `--brand-primary` (#105922), `SAMO` in `--brand-orange` (#FF6F30)
- **Per-tab accents** (scoped via tab-level class on the pane):
  - PR form → pink (`--pink-*` keeps its original pink scale)
  - VS form → teal (`.vs-tab` overrides `--pink-*` to teal scale)
  - Announcements/Creator → slate (`.an-tab` overrides to neutral)
  - Admin → green primary
- **Departments**: 10 unique color identities (see `src/css/base.css` `--dept-*`)
- **Fonts**: Noto Sans Thai (body), Prompt (brand pill + secondary), via Google Fonts. The system fallback chain lives in `src/css/base.css`.
- **Density**: tight spacing on mobile, generous on desktop. Use Bootstrap utility classes.
- **No emojis in UI text** unless the user explicitly asks.

## Memory layout — what loads, what you fetch

**Auto-loaded into every session** (`CLAUDE.md` + everything in
`.claude/rules/`): this file, `.claude/rules/mistakes.md` (the recurring bug
CLASSES + a nine-line directory of which write-up file holds what),
`.claude/rules/security.md` (key hygiene). Budget enforced in BYTES by
`npm run check:context`, which `npm test` runs. **Never put a bug write-up, a
session narrative, or anything that GROWS WITH THE WORK in `.claude/rules/` —
it is charged to every future session.** The per-entry symptom index lives in
`docs/mistakes/INDEX.md`; do not move it back (it reached 18.5k of 30k there).

**READ FIRST — `STATE.md`, `docs/INVARIANTS.md`, `docs/state/HANDOFF.md`.**
HANDOFF is the ONLY list of what is NOT done; every section carries a
`Status:` (VERIFIED *how* / HYPOTHESIS / DECIDED / OWED) saying how far to
trust it — a HYPOTHESIS is a theory to TEST, not a fact. Guarded.
FIVE homes; mixing them is what made the handoff unreadable. **`STATE.md`** =
true right now (~200 lines, guarded) · **`docs/INVARIANTS.md`** = rules that
outlive a session · **HANDOFF** = what is NOT done · **`docs/state/<handle>.md`**
= one person's notes, never rewritten by others · **`docs/state-archive/`** = why.

`STATE.md` carries what is in flight, what is deployed, and what is owed —
the things that change what you do FIRST. Everything else below is genuinely
fetch-when-needed; these two are not, and skipping them is how a session
re-derives or re-breaks work that was finished yesterday.
⛔ **Write to the right home.** Appending a session narrative to `STATE.md` is
what took it to 1,403 lines against a 200-line target; `state-handoff.test.js`
now fails the build if it grows back past ~200.

**Read on demand** — everything below. Fetch the one you need; don't preload.

- `docs/mistakes/*.md` — the bug write-ups, nine files by area, plus the
  generated `docs/mistakes/INDEX.md` (one symptom line per entry). The directory
  in `.claude/rules/mistakes.md` says which file to open, but
  `grep -rin "<symptom>" docs/mistakes/` is usually faster — it searches the
  write-ups, not their titles. **Read the matching file BEFORE touching
  `src/js/auth.js`, `src/js/db.js`, any RLS policy / `current_user_*` helper /
  SECURITY DEFINER function, `server/deploy.sh`, or `appscript/*.gs`.**
- `README.md` — human onboarding. Not for agents; open only to verify it.
- `CONTRIBUTING.md` — human collaborator guide; same rules. Cross-check when
  editing project policy.
- `docs/TEAM-WORKFLOW.md` — the multi-developer plan (dev env, previews, credentials, review flow). **DESIGN ONLY, nothing built**; its §0 holds owner decisions that must not be re-litigated
- `docs/DEPT-TOOLS.md` — how a ฝ่าย ships a tool without IT writing it (content / sandboxed embed / native). **DESIGN ONLY, nothing built**; §10 self-scrutiny, §13 build order
- `docs/CONTEXT.md` — architecture map, RLS policies, schema, deploy plumbing, developer workflows
- `docs/EMAIL.md` — who sends mail and the quota ceilings. The VM CAN send via
  a relay (587 out works); it cannot BE or RECEIVE mail (25 blocked out, no
  inbound port, `p=reject`). READ BEFORE touching mail.
- `docs/SUPABASE-MIGRATION.md` — **HISTORICAL** Sheets→Supabase; why the schema
  is shaped as it is. Not a status.
- `docs/MERGE-CHECKLIST.md` — when merging refactor → main
- `docs/VERSIONING.md` — release numbering + workflow. READ BEFORE bumping a
  version or adding a release note; `npm run release` does the mechanical half.
- `docs/AUTH-MODEL.md` — **HISTORICAL** pre-Supabase user model; shipped and
  gone past. Its "current state" section is the GAS era.
- `docs/KKU-SSO.md` — KKU SSO assessment: a login improvement, NOT a data source
  (no roster endpoint, no สายรหัส, no สาขา). Manual: `docs/KKU-SSO-MANUAL.md`
- `docs/PROJECT-ARCHITECTURE.md` — multi-project engine proposal — DEFERRED, kept as future reference
- `docs/demos/*/README.md` — built-and-published comparisons the owner is
  choosing between. Not shipped code; each says what is decided and what is not.
- `skills/*.md` — playbooks for the non-obvious workflows

## End-of-turn loop (MANDATORY)

Before sending the final response on any task that modified files:

1. **Update `STATE.md`** — only if real state changed (branch HEAD, pending migrations, in-flight work, blocking issues). Do NOT append a session narrative — `git log` is the archive. Keep STATE.md under ~200 lines; if it bloats, prune past-session sections to `docs/state-archive/YYYY-MM-DD.md` and trust `git log --oneline` for the chronology.
2. **If a bug was found and fixed**: write it up in the matching
   `docs/mistakes/*.md` (**Symptom → Cause → Fix → Where it lives now**, ending
   with the general rule; lead with the symptom AS REPORTED — that is what the
   next reader greps for), then run `npm run mistakes:index`. If it is a new
   instance of one of the seven classes, add the site to that class's list in
   `.claude/rules/mistakes.md`. Prefer a guard test over a paragraph: this repo
   has learned that writing a hazard down does not make anyone check it.
3. **If a person would NOTICE the change** (อัปเดตระบบ / the public release
   notes at `/updates`): append an entry to `PENDING` in
   `src/data/changelog.js`, in the same commit that ships it. Plain Thai a
   student could read — no table names, no migration numbers, no permission
   keys; `changelog.test.js` enforces that. Write it NOW, not at release time:
   the details that make a good note (what was annoying before, what you no
   longer have to do) are exactly what is forgotten weeks later when someone is
   reconstructing it from `git log`. `npm run release` folds `PENDING` into the
   new version and clears it. A refactor, a test, or a migration nobody
   experiences gets NO entry; a one-line fix that unblocked a real workflow
   does.
4. **If a repeatable multi-step workflow appeared**: create or update a file under `skills/`.
5. **Documentation (conditional — only if any of these are true):**
   - User-visible feature added or removed → update the "Key features" list in `README.md`.
   - Architecture, schema, RLS, deploy plumbing, or auth flow changed → update `docs/CONTEXT.md`.
   - Build / install / env setup changed → update `README.md` (Quick start, Commands, Environment).
   - **If the change is internal-only (refactor, bugfix, test, comment) — skip this step.** Doc edits should be a side-effect of meaningful change, not a tax on every commit.
6. State in the user-facing response: "Updated STATE.md / docs/mistakes / changelog / skills/* as needed."

This loop keeps cold-start agents from re-walking the bugs we already paid for, AND keeps human-facing docs from going stale — without taxing routine commits.

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
