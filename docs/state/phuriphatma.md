# phuriphatma — session notes

One file per person, as designed in `docs/TEAM-WORKFLOW.md` §6.5. **Write your
own; never rewrite someone else's.**

What belongs here: what I am part-way through, what I tried that did not work,
what I want to pick up next. What does NOT belong here:

- a rule that will still be true next year → `docs/INVARIANTS.md`
- what is true right now for everyone → `STATE.md`
- why something was done the way it was → `docs/state-archive/`
- a bug that was fixed → `docs/mistakes/<area>.md`, then `npm run mistakes:index`

The dead-pointer sweep in `state-handoff.test.js` runs over this file too, so a
path named here must resolve.

---

## ▶ HANDOFF 2026-09-11, END OF SESSION — read this before anything else

**Status of the code: clean.** 1951 tests, build green, all 35 live proofs
green, deployed and verified. Four deploys. Nothing is half-finished in the tree.

### What shipped

1. **The two red proofs are fixed — and the recorded cause was WRONG.**
   `STATE.md` said both could not book a slot because the live 5-hour window was
   claimed. Running 0154 said otherwise: **19 of 20 passing**, one failing case,
   the weekly pool. The real cause was the first real booking anybody has ever
   made (2026-09-07, 70%) landing in the week both proofs had hardcoded as
   quiet. ⚠️ **And 0155's C3 was passing ON THAT STRANGER'S ROW** — a false green
   that only appeared once I cleared the week. Write-up:
   `docs/mistakes/tooling-proofs.md`.
2. **`src/js/gas-post.js`** — six upload call sites did `await res.json()` on
   Google's HTML error page, so a student got `Unexpected token '<'`. One helper
   now, retrying only the safe case. `docs/mistakes/integrations.md`.
3. **The ฝ่าย visual editor was ACCEPTED by the owner and built out** — 8 → 21
   blocks. `HANDOFF` §4. ⏸ **Then PAUSED by the owner the same day**; do not
   extend it unasked.
4. **Discord role sync: designed, nothing built.** `docs/DISCORD-ROLE-SYNC.md`.

### The three things I got wrong, because they are the reusable part

- ⛔ **A SCREENSHOT IS AN INSTRUMENT AND I TRUSTED IT.** A capture appeared to
  prove the ฝ่าย blocks never stack on a phone. I had already rewritten every
  block to grid `auto-fit`, rewritten the header comment to say the flex idiom
  shipped broken, **and rewritten the guard test to forbid it**, before
  measuring the children's rects showed flex had been right all along. The
  harness had no `<meta name="viewport">`, so Chrome laid out at 980px and
  scaled down. All reverted. `docs/mistakes/frontend-ui.md` — and the lesson
  that cost most: *a guard rewritten to match a fresh theory is just the theory
  with a green tick next to it.*
- ⚠️ **I raised a false security alarm on my own pattern.** A loose regex
  reported 74 webhook URLs in git history. There are none: `git log -S` over the
  literal finds only a dummy (`webhooks/1/x…`) in a test. Check the instrument
  before reporting the finding.
- ⚠️ **My first Discord rule was wrong and the owner caught it.** "Mirror ฝ่าย,
  skip the role entries" would have deleted `Frontend developer` — the very
  `@frontend` they asked for. The tree stores a sub-group two different ways, so
  no automatic rule works; §5c is a tick-box instead. **Their short questions
  find real bugs; check before answering.**

### What I found that nobody had looked at

📌 **`docs/` IS SERVED PUBLICLY** — `samo.md.kku.ac.th/docs/state/HANDOFF`
answers 200, and it was naming the Discord bot's application id beside
"Administrator" and "compromised credential" while that bot is still in the
server. Redacted and deployed; verified 0 hits across every served asset with a
control so the grep is not blind. ⚠️ **Treat everything under `docs/` as
published** — `docs/state/*` included. I had been writing session notes as if
they were private. They are not.

### What to pick up

- ⏳ **The Drive → database sweep is STILL OWED** and it FAILED when I tried it:
  `REAL_EXIT=1`, batch 2 of 7 `UNREACHABLE`. Two probes afterwards showed
  Google's `/exec` serving an HTML error page (HTTP 404, 32 s) with nothing else
  touching it. **Probe the endpoint before running the sweep** — `HANDOFF` §13a.
- ⛔ **Discord: nothing may be built until the owner does
  `docs/DISCORD-ROLE-SYNC.md` §7.** They said they will do it in a later session.
- The visual editor has still never had a block dragged and saved end to end.

---

## ▶ HANDOFF 2026-09-10, END OF SESSION — read this before anything else

Started at *"continue work from previous session"*, went to the passport RLS gap,
then to the owner's three 2026-09-09 asks about หนังสือโครงการ. **What is NOT
done is `docs/state/HANDOFF.md` §13a (one half), §13b, §14 and §15**; this is why,
and what will mislead you.

### ⛔ Five things to know before you touch anything

1. **Everything is shipped and verified**, and `npm run deploy:owed` is the
   authority for that — not this sentence. Several deploys, every one ending
   `<== exit 0` with both roots stamped; ⛔ **I am deliberately not counting
   them here.** An earlier draft said "five" while `STATE.md` said "sixth" and
   the VM's own logs held seven — a decaying number with two homes that
   disagreed with each other AND with reality, which is this repo's most
   repeated documentation bug. `ls ~/samo-deploy-logs/20260910T*.log` is the
   count, if anyone ever needs it.
   Apps Script is at **version 12**. ⚠️ **Do not trust any sentence about the
   endpoint's live health**, including one I might have written: ask it —
   `npm run deploy:gas -- --verify` (a SINGLE probe, so retry before believing
   a failure; see `skills/deploy-gas.md`).
2. ⛔ **`tools/proj0183-drive-orphans.mjs` shares its endpoint with every real
   Drive upload in the app, and running it fast BREAKS THOSE UPLOADS.** I did
   this for a few minutes: 2 of 3 replies became Google's HTML error page, and
   `src/js/uploads.js` does `await res.json()` with no retry, so a student's
   upload would have died on work they had just done. It paces itself now.
   **Prefer `--rows-only`; run the full sweep when nobody is submitting.**
3. ⛔ **`npm test` DOES NOT RUN THAT TOOL'S REAL PATH**, only its `SELFTEST=1`
   path. If you change it, RUN it. I shipped a crash into it because
   `node --check` said "syntax OK" and the suite was green.
4. **The two new GAS handlers are read-only and one of them is GATED ON PURPOSE.**
   `listProjectFolderFiles` needs a `knownFileId` that is really in the folder.
   That is security, not ergonomics — the `/exec` URL is public and
   unauthenticated, and ungated listing would let a stranger enumerate signed
   หนังสือ. HANDOFF §13a says why. Do not remove it to make a sweep tidier.
5. **The owner decided two things on 2026-09-10; do not re-raise either.**
   e-sign stays untested for now ("just leave it"), and the duplicate
   `pmphuriphat@gmail.com` account is NOT to be deleted on its own — it belongs
   to a single deliberate problematic-account cleanup.

### Shipped

- **0182 — the last passport table without row security.** `passport.continents`
  (4 theming rows) kept its GRANTs across the monorepo merge and lost its RLS,
  so the public anon key could rewrite or delete all four rows for ~3 months.
  Proof `tools/passport0182-continents-lockdown.sql` (16/16) was run against
  production BEFORE the migration and **failed 6 assertions with
  update/insert/delete each answering `allow`** — the live bug, read by the
  assertions that exist to catch it. §50 keeps the query that FOUND it as an
  assertion, so the next table landing without RLS goes red naming itself.
- **The `return=representation` seam** — HANDOFF §13c's named gap.
  `tools/authz0182-insert-returning-seam.sql` (11/11) reproduces 0181 live from
  nothing, then sweeps every SELECT policy in `public` for the shape, reading the
  exact function each policy calls from `pg_depend`. **No real table has it.**
- **§13a orphan detection is BUILT AND DEPLOYED** — `statProjectFiles` +
  `listProjectFolderFiles` in `appscript/prform.gs`, plus the sweep and
  `src/js/projects/drive-listing-readonly.test.js` (26 assertions).
  ✅ **Database → Drive is VERIFIED CLEAN: all 123 files resolve, none trashed,
  none drifted.** ⏳ The Drive → database half (63 folders) has never printed a
  verdict — that is the one real piece of work left, and it is item 2 above.

### What I got wrong, because it will save you the same detour

**I repeated three lessons that were already written down in this repo**, one of
them in the very file I was appending to:

1. **A control taken from the wrong page.** Verifying a deploy, my "new string"
   greped 1 and my control greped 0 — I had taken the control from a different
   docs page. A control that fails makes the number beside it worthless too.
2. **`/admin/assets/<bundle>.js` answers 200 with `text/html`** (the SPA
   fallback), so grepping it reported a shipped deploy as missing. The real path
   is `/assets/…`. Then I named a content-hashed bundle in `STATE.md` and the
   dead-pointer guard caught me repeating the same shape an hour later.
3. **A brand-new guard read `.env.local` at import time**, so it was green on
   this laptop and red on CI on its first push — the mistake that once kept CI
   red for **19 consecutive pushes**. The dependency is invisible at the
   assertion: it lived in a module-level `readFileSync` three files away. **Move
   the secret aside and run, before pushing a test that spawns a `tools/`
   script.**

Also: a control in my own proof reported `DETECTOR IS BLIND` and the detector was
fine — an earlier step of the same proof had dropped the policy it was asked to
find. **A proof that mutates its own fixtures needs one fixture per claim.** And
`--rows-only` printed `0` for a half it never ran and then claimed "in both
directions": **when a flag legitimately skips part of a check, every summary line
downstream can lie**, because a guard's output is a claim about a SCOPE.

All five are written up in `docs/mistakes/` (`tooling-proofs.md`,
`deploy-hosting.md`, `authz-rls.md`) with the general rule, and guarded.

### Offered, not built — needs the owner

- **One retry in `src/js/uploads.js`** when Google answers with HTML instead of
  JSON. Today a student loses the upload and sees a parse error. It is a change
  to a path students depend on, so I did not make it unasked.

---

## ▶ HANDOFF 2026-09-07, END OF SESSION — read this before anything else

Started at *"how does a contributor receive `.env.local`"* and ended in the
database. Everything below is either shipped or explicitly open. **What is NOT
done is `docs/state/HANDOFF.md` §8 and §8a**; this is why.

### ⛔ Six things that are easy to get wrong — read these before anything else

1. **Migrations do NOT apply themselves.** CI rehearses every migration on a
   blank database that is created and deleted inside the job. Nothing reaches
   samo-dev or production until a person runs
   `node tools/apply-migration.mjs <file>` — add `--dev` for the practice one.
   A green check means *the SQL is valid*, never *a database has it*.
2. **That CI check cannot judge behaviour.** Its database has no accounts, so
   `auth.uid()` is null and no permission rule is exercised. Behaviour is
   `npm run proofs -- --dev`, which needs credentials.
3. **Do not re-open the credential decisions.** `docs/TEAM-WORKFLOW.md` §0 is
   headed DO NOT RE-LITIGATE. **D7**: the dev PAT *is* shareable with whoever
   does migration work — `npm run env:share -- --db`. **D1**: masking student
   data in the dev copy was proposed and declined twice. I contradicted both on
   2026-09-07 and gave two turns of confident wrong advice. Read §0 first.
4. **Do not raise the vault collection naming a third time.** It is written up
   below and in HANDOFF §8. It has been put to the owner twice. It is their call.
5. **`npm run env:pull` works.** Verified end to end on 2026-09-07. Any sentence
   anywhere saying an authenticated fetch has never run is older than that.
6. **samo-dev is in step with production** as of 2026-09-07. Check with
   `npm run migrate:status` and `npm run migrate:status -- --dev` — **the `--`
   matters**, npm eats a bare flag and answers about production either way.

### Shipped

- **`npm run env:pull` works end to end** — the owner ran it on a clean clone:
  sign-in, `bw get item`, `.env.local` written, `env:check` green. The file
  header and HANDOFF no longer say an authenticated fetch has never happened.
  Two bugs on the way, both written up in `docs/mistakes/tooling-proofs.md`:
  it asked for an email on a stream it had captured (silent hang), and `npx`
  re-resolved the CLI on all six calls (5.3 s → 1.75 s, A/B measured).
- **The docs start at the vault now** — `docs/start/vault.md` is the tutorial
  (invite → master password → confirm → collections, plus the maintainer half
  and the FAQ). `prerequisites` §1 asks for an account; `install` §4 is "the
  normal way" and "the fallback". The pasted block is the backup, as asked.
- **CI replays every migration onto an empty database** on any PR touching
  `supabase/migrations/` — `.github/workflows/migrations.yml`, no credential of
  any kind, ~9 s. **180 apply, 65 tables against samo-dev's 66**, the difference
  being `_timeline_backup_0166` from the one migration that refuses on empty
  data. So the schema demonstrably rebuilds from this repo alone, which is also
  the recovery answer. It cost two instrument bugs to get there (a transaction
  boundary, and refusal-vs-break) — `docs/mistakes/tooling-proofs.md`.
- **A migration nobody noticed can no longer reach students quietly**: the
  migrations check writes a summary naming every migration the change adds and
  the commands still owed — on the run's summary page, one click from the PR's
  Checks tab, NOT in the conversation (a bot comment would be stronger; §8a) —
  and
  `npm run deploy:owed` asks PRODUCTION before printing its verdict. `pending`
  has one definition, in `tools/migrations-lib.mjs`.
- **samo-dev brought in step** — 0174–0176 applied, 0177 re-recorded.
- **CI was red for 19 consecutive pushes** (2026-09-06 04:53 → 09-07) and
  nobody had looked: three guards read the maintainer's gitignored `.env.local`.
  Green since `ba2099a`. **If CI names tests that pass locally, ask how long it
  has been red before asking what you broke.**

One small thing changed in `STATE.md` itself: its second heading said **"WHAT
CHANGED MOST RECENTLY (2026-09-01)"**, so on 2026-09-07 the second thing a cold
session read told it nothing had happened for a week. It is "HOW TO EDIT THIS
FILE" now, which is what the section actually is. A date in a heading decays the
moment anything else happens; `git log --oneline` is the answer to "what
changed".

### Open — nobody is blocked, but these are real

1. **The vault's step 3 is not done: no collection is shared with anybody yet.**
   The owner created `Dev` **nested under a collection named `IT`**, so its real
   name is `IT/Dev`. Bitwarden nesting is a name containing `/`, not a
   hierarchy — sharing the `IT` parent grants nothing, and step 3 must share
   `IT/Dev` itself. ⛔ `IT` is the name `skills/vaultwarden.md` says never to
   use (ฝ่าย IT is a real department that turns over yearly). Renaming is one
   edit while nothing is shared; afterwards it is a re-share with everyone.
   **Raised twice, owner's call, do not raise it a third time.**
2. **`env:pull` is unverified on Windows, and on any account with two-step
   login.** The owner's has neither. The first contributor with 2FA is the test.
3. **`tools/db-query.mjs` runs on PRODUCTION and ignores `--dev`** (HANDOFF §9).
   Harmless for contributors, who have no production credentials; a live trap
   for the maintainer's own agent, and more dangerous the more normal SQL work
   becomes. Not fixed.
4. **Offered, not built, no answer yet:** a CI check that reports "N migrations
   are merged but not applied to dev". Read-only, needs no credential.

### What I got wrong, because it will save the next session the same detour

**I invented a credential policy that contradicted one the owner had already
made.** I recommended that `SUPABASE_DEV_ACCESS_TOKEN` and `SUPABASE_DEV_DB_URL`
should never be shared, and proposed per-person sandbox projects seeded with
fake data. `docs/TEAM-WORKFLOW.md` §0 — the section headed **DO NOT
RE-LITIGATE** — already says the opposite in D7 (the separate account exists
partly so its PAT *is* shareable for migration work) and in D1 (masking was
proposed and declined twice). My "fake data" argument was D1 for the third time.

The scrutinize pass caught it, but only after two turns of confident wrong
advice. **Read `docs/TEAM-WORKFLOW.md` §0 before recommending anything about
credentials, access or data handling.** The answer to "can the team change the
database on dev" was always yes, with a mechanism that already exists:
`npm run env:share -- --db` to whoever takes on the work.

Measured while answering, worth keeping: the dev PAT sees **only** samo-dev, the
production PAT does **not** see samo-dev (that control is what makes the first
fact mean something), the dev org has one member, and `SUPABASE_DEV_DB_URL`
connects as the `postgres` superuser.

---

## ▶ SESSION 2026-09-06 — contributor credentials, end to end

Started as *"how should I send the .env credentials, should I use SOPS"*.
Tracing what those credentials actually did answered a different question, and
the session ended four commits later with the whole flow rebuilt. **What is NOT
done is in `docs/state/HANDOFF.md` §8** — this is the reasoning, so the next
session does not re-derive it.

### The three bugs, in the order they were found

1. **The setup guide never worked.** It had contributors fill in
   `SUPABASE_DEV_*`; `src/js/db.js` reads `VITE_SUPABASE_*`; nothing joined
   them. `env:check` printed "✓ You are set up" and `npm run dev` came up with
   no database — while `/passport/` fell back to its HARDCODED PRODUCTION url
   and key, so a volunteer following the guide was reading real student records.
   Invisible because a maintainer's own `.env.local` has `VITE_*` pointing at
   production, so it worked on the one machine it was tried on, by talking to
   the live site. `tools/dev-env.mjs` maps them, prints which database it chose,
   and is gated on `command === 'serve'` so a build can never be repointed.

2. **Two of the four values should never have gone out.**
   `SUPABASE_DEV_ACCESS_TOKEN` can delete the project; `SUPABASE_DEV_DB_URL`
   bypasses every permission rule over an unmasked copy of real student data.
   Only migration tooling reads them. Now commented out in the example, and
   `env:check` reports rather than requires them.

3. **`migrate:status` with `--dev` but no `--` separator answers about
   PRODUCTION.** npm eats the flag. Pre-existing, in README. Measured
   `[PRODUCTION] PENDING: 0` against `[samo-dev] PENDING: 3` for the same line
   with the separator added. (Written descriptively here on purpose:
   `docs-commands.test.js` sweeps this file too, and rightly — HANDOFF §9 holds
   commands people really do run.)
   ⚠️ **samo-dev really did have 3 pending migrations** — nobody knew, because
   the documented command was hiding it. ✅ **CLOSED 2026-09-07**: applied, both
   report `PENDING: 0`. The lesson stays — a flag npm ate hid a real drift for
   an unknown length of time, and the drift included 0176, so anyone testing on
   dev was seeing a bug production had already fixed.

### The design that replaced it

**`.env.local.example` is the contract.** An active `NAME=` line is required, a
commented `# NAME=` line is database-work only, and `tools/env-manifest.mjs`
derives everything from it — `env:check`, `setup`, `env:share`, `env:pull` and
the `npm run dev` drift warning. **Adding a variable is ONE edit to that file**;
every contributor is told by name on their next `npm run dev`.

Four commands: `setup` (paste, it parses), `env:check`, `env:share [-- --copy]`
(maintainer, cannot emit a production name), `env:pull` (from the vault).

### Owner decisions recorded this session — do not re-litigate

- **Vault collections are `Infra` · `Dev` · `Team`**, split by what a leak
  COSTS. ⛔ NOT `IT` — `ฝ่าย IT` is a real SAMO department, so that name reads
  as "the IT department's logins" and the VM password follows it. `Comms` and
  `Handover` were dropped with reasons. One home: `skills/vaultwarden.md`.
- **SOPS was considered and rejected**, reasoning in the chat and summarised in
  `skills/onboard-a-contributor.md`. Short version: the repo is public, so
  ciphertext there is permanent and unrevocable, and it moves key distribution
  rather than solving it.

### Things I got wrong, so nobody trusts them

- I wrote in HANDOFF that the Bitwarden CLI could not work with our `/vault/`
  subpath. **False, from a search result rather than a test.** One command
  disproved it. Corrected in place.
- I committed once with `npm test` RED, because I piped it to `grep` and read
  the pipeline's exit code. That trap is in `.claude/rules/mistakes.md` and I
  did it anyway.
- One unexplained test failure (1 of 1838) that I could not reproduce, because
  I re-ran instead of capturing the output. HANDOFF §9 says what to do if it
  recurs.

### Not done, deliberately

- **Windows is unverified.** Every measurement was on macOS.
- **`env:pull` is verified up to authentication only** — no `Dev` collection
  exists yet, so an authenticated fetch has never run.

---

## ▶ HANDOFF 2026-09-02, END OF SESSION — read this before anything else

**Everything below in this file is history. This block is the state.**

Clean and current at end of session. **Run these rather than believing a
sentence** — no count is written down here on purpose, because nothing guards a
number in prose:

```bash
git status && npm test && npm run proofs
npm run deploy:owed && npm run migrate:status
npm run smoke:browser -- https://samo.md.kku.ac.th
```

### ⛔ ONE THING WAITS ON THE OWNER, AND NOTHING SHOULD BE BUILT UNTIL IT ANSWERS

🧪 **The visual-editor SPIKE is live: `/admin/` → หน้าฝ่าย → an HTML row →
"แก้แบบเห็นภาพ".** GrapesJS 0.23.6, admin-only, lazy, 1.15 MB in its own chunk.

**Do not build the block set until the owner says the feel is right.**

If it is wrong, removing it is five edits — **all five, or the build breaks on a
dangling import**:

```bash
git rm src/js/dept-visual-editor.js \
       src/js/dept-visual-editor.test.js \
       src/css/dept-visual-editor.css
npm uninstall grapesjs
```
then delete, by hand:
- `src/admin.css` — the `@import './css/dept-visual-editor.css';` line
- `src/js/dept-page-admin.js` — the `import { openVisualEditor }` line, the
  `data-dpa-visual` button in `rowEditor`, and the `[data-dpa-visual]` branch in
  the delegated click handler

Then `npm run build && npm test`. Nothing else in the app knows it exists —
`dept-visual-editor.test.js` asserts that `dept-page-admin.js` is the only
importer, so if something else has grown one, that test names it.

⚠️ **A CORRECTION I MADE TO MYSELF, IN THIS FILE, ON THE SAME DAY.** The block
below this one says *"a canvas was rejected, and this should not be re-opened"*.
That was my verdict at 12:00; the owner asked twice more and I built one at
14:00. **The block is kept because its REASONING is still load-bearing — the
block-list model, the mobile argument, the Puck/Craft.js rejection — but its
VERDICT is superseded.** Read it as analysis, not as a decision. This is the
prose-drift class the repo pays for most; correcting it in one place and not the
other is what makes a document lie.

### ✅ THE OWNER ALREADY USED 0179 ON PRODUCTION — better evidence than my proof

Queried at end of session: `dept_content` holds a `kind='section'` row on
ฝ่ายดิจิทัล, created 05:41Z — **three minutes after 0179 was deployed** — with
`updated_by` set. So a real person, on the real site, pressed เพิ่มหัวข้อ
without being told how.

⚠️ **And it is `visible = false`.** The draft default shipped the same day did
its job: unlike the ฝ่ายดิจิทัล card from 2026-09-01, this one did NOT appear on
the public page half-built. That is the change proving itself on a case nobody
staged.

📌 The 2026-09-01 placeholder card (`หัวข้อใหม่`, no link, no cover) is **still
live and visible** — the owner asked for it to be left alone, mid-edit. Do not
delete it; ask before touching it.

### What the spike actually proved, and what it did not

✅ Proved, by looking rather than by reading:
- it imports existing content, opens at **390px**, and shows eight Thai blocks;
- **the output renders correctly in the real BLANK sandbox** (screenshotted at
  900px and 390px) — the columns stack on a phone with no media query;
- the 1.15 MB is a separate chunk with **zero references from the public entry**
  on the SERVED site.

❌ Not proved: nobody has dragged a block and saved through the real editor. The
round trip was verified by composing the blocks in code and wrapping them, not
by driving GrapesJS's drag-and-drop.

⚠️ **Two bugs were found ONLY by screenshotting it**, and both would have shipped:
GrapesJS hides its block panel behind an icon (the empty canvas WAS the
"untuitive" complaint), and Bootstrap classes would have looked perfect in the
editor and unstyled on the real page, because the sandbox is a blank document.

### 📌 A DECISION RECORDED, NOT YET ACTED ON: merge samomdkkupassport into this repo

Asked: *"should samopassport be integrated into the same repo instead of separate
repo with same supabase … i want preview to just be one link"*.

**Answer: yes, merge — but as its own session. It is a one-way door.**

- **Production is ALREADY one link** — `samo.md.kku.ac.th/passport/` answers 200,
  and `deploy.sh` already pulls and builds both repos. Merging buys nothing there.
- **The deciding fact: the two already deploy ATOMICALLY.** Independent release
  cadence is the one thing polyrepo buys, and this project does not use it — so
  it pays every polyrepo cost (two CI setups, two protections, two Pages
  projects, no atomic PR over a shared Supabase project) for no benefit.
- ⛔ **Do NOT reconnect the `samomdkkupassport` Pages project** (STATE.md §A3
  step 1). That entrenches the split that is about to be removed.
- ⛔ **And do not take the cheap fix I proposed first** — having the Cloudflare
  build `git clone` passport at `main`. It makes the preview NOT REPRODUCIBLE
  FROM A COMMIT: same web branch, rebuilt tomorrow, different site. Pinning it
  to a SHA is a git submodule by another name, so following that fix arrives at
  the merge anyway.

**Shape of the work** (~a session, low risk — the repo would be made to match a
deploy that already works): `git subtree add --prefix=passport` to keep history ·
npm workspaces, passport as a second Vite build (`PASSPORT_BASE=/passport/`
already exists) · `deploy.sh` loses one clone and one pull · `CODEOWNERS` gains
`passport/**` · retire the second repo's protection and Pages project · update
`docs/SUCCESSION.md` and `tools/repo-protection.mjs`, which enumerate both today.

### What shipped today, in order

1. The `ไม่พบใครที่ตรงกับ` hint had an entry and no exit (`team/index.js`).
2. **A new หน้าฝ่าย row is a DRAFT** — it used to be published the instant the
   button was pressed, placeholder title and all.
3. **The getting-started docs**, rewritten for someone who has not used git —
   and `npm run env:check`, because the guide told contributors to run
   `dev:check`, which needs PRODUCTION credentials they do not have and must
   never be sent.
4. **The stable preview address was documented** — `preview.samomdkkuweb.pages.dev`
   existed since 2026-08-31 and NOTHING pointed at it, including the tool whose
   job is to print an address.
5. **0179** — `section` and `text` kinds.
6. **Cover/video upload**, with the file it replaces retired.
7. **The GrapesJS spike.**

### ⚠️ Still unresolved, and it is NOT from any of today's changes

The ฝ่าย card grid overflowed horizontally at 390px in a static probe — **but the
pre-0179 control overflows identically**, and `.news-grid--archive` is
`repeat(2, minmax(0,1fr))` below 576px, which cannot overflow. So the probe is
the likelier fault. **Measure the computed grid on the real page before believing
either answer.**

---

## ▶ 2026-09-02 (12:00) — the หน้าฝ่าย editor: the block-list case

> ⚠️ **VERDICT SUPERSEDED THE SAME DAY — see the handoff block above.** The
> owner asked twice more and a GrapesJS spike was built at 14:00. The
> REASONING here is still the best account of the trade-off and of why Puck
> and Craft.js were rejected; the sentence "a canvas was rejected" is not.

**The report.** *"the current is having to fill in each card then it'll appear
on ui. i think it's too bland, like there isn't many component for user to can
do it, they can't position where they want, it's hard to use not like wyswyg …
i want it to be like this web [a screenshot of KKU Moodle], my university can
have professor who isn't so much technical to adjust the e-learning page for
their subject to put what ever they want"*

**The finding that decided it: the reference contradicts the request.** A Moodle
course page is NOT WYSIWYG and has NO free positioning. It is an ordered list of
TYPED items grouped under section headings, each edited through a form. That is
the same model `dept_content` already had. What separated the two was
VOCABULARY, not architecture — Moodle has sections and ~20 types; 0177 shipped a
flat run of two.

⚠️ **[SUPERSEDED — a canvas WAS built at 14:00 the same day; see the handoff
block at the top of this file.]** The reasoning below is why I said no at 12:00,
and it is still the best account of the trade-off — read it as analysis, not
as a decision. Reasons, in order of weight:

1. The screenshot the owner chose is evidence FOR the list-of-blocks model.
2. It is the professional standard for this exact problem. Every mainstream
   editor aimed at a non-technical author is an ordered list of typed blocks —
   WordPress Gutenberg, Notion, Ghost, Confluence. The free-position canvases
   (Webflow, Framer, Wix) are aimed at DESIGNERS.
3. Free positioning breaks on phones, which is most of this site's traffic, and
   it breaks in a way the author cannot see from the laptop they built it on.
4. It would need a second layout engine beside the one the app already has.

**What 0179 shipped.** Two new kinds — `section` (a heading that groups
everything after it, with an optional summary) and `text` (a full-width
paragraph, `white-space: pre-line`, escaped, so a ฝ่าย gets line breaks without
this becoming a second unsandboxed markup path). Plus per-kind coloured chips
with icons in the editor, and the card `description` widened from a
single-line `<input>` to a `<textarea>` — that input was why any ฝ่าย wanting
two sentences had to jump straight to writing HTML.

### ❌ Still owed from that review, in order of payoff

1. **FILE UPLOAD.** `cover_url` and `video_url` are text boxes you paste a URL
   into. A ฝ่าย member has a poster on their laptop. `uploadImageToDrive()`
   exists in `src/js/uploads.js` and is already wired into `admin-main.js` for
   ทีม SAMO photos — this is reuse, not new surface. **I think this is the
   concrete thing behind "hard to use".**
2. **Drag to reorder.** Today it is up/down buttons, one position per click:
   eleven clicks to move the last of twelve to the top. `Sortable` is already a
   dependency, used by the ทีม SAMO tree.
3. **An add-picker.** Four buttons in a row do not show what is possible the way
   Moodle's "Add an activity or resource" modal does.

### ⚠️ What I did NOT verify

- **The editor was never opened in a browser this session.** The four kinds are
  proven by the live SQL proof (`tools/dept0179-kinds.sql`, 10/10 both
  directions on dev and on production) and by a STATIC render of
  `renderDeptContent` against the real built stylesheet at 1200px and 390px.
  Nobody has clicked เพิ่มหัวข้อ.
- ⚠️ **An unresolved question, and it is NOT from 0179.** In that static render
  the card grid overflowed horizontally at 390px. **The control — the same cards
  with the section and text rows stripped out, i.e. the pre-0179 page — overflows
  identically**, so this is not something 0179 introduced. It may also be an
  artefact of the probe page rather than the real one: `.news-grid--archive` is
  `repeat(2, minmax(0, 1fr))` below 576px, which cannot overflow, and the real
  ฝ่าย page nests its container inside Bootstrap columns that the probe did not
  reproduce. **Measure the COMPUTED grid on the real page before believing
  either answer.** I ran out of session before doing that.

---

## ▶ HANDOFF 2026-09-01, END OF SESSION — read this before anything else

**Everything below in this file is history. This block is the state.**

### Nothing is half-finished. Nothing is uncommitted. Nothing is undeployed.

`git status` clean · `npm test` 1,636 green · `npm run proofs` 29 green ·
`npm run deploy:owed` says production is current · `npm run migrate:status`
0 pending. **Verify these rather than believing them** — that is the point of
naming the commands instead of the numbers.

### What shipped today, in order

1. **The deploy's docs step finally leaves evidence.** It failed 4 of the first
   6 runs with no diagnosis, because the ssh command's own `grep` deleted the
   failing step's output. `deploy.sh` now writes every run to
   `~/samo-deploy-logs/` on the VM. ⛔ **A healthy run is 30 SECONDS** — so the
   "clean ~7-minute runs" the hang was once declared dead on were 14× baseline.
2. **The pages.dev database guard asked ONE project of three.** One of the other
   two (`refactorsamomdkkuweb`, retired but still branch-connected) held the
   LIVE production URL and anon key. Guard + `npm run cf:pin-dev` now enumerate
   the whole Cloudflare account.
3. **The ฝ่าย tool FRAME** (DEPT-TOOLS §13 steps 9–11) — the GitHub road.
4. **หน้าฝ่าย, the admin editor** (0177) — the road that removes the owner.
   0178 taught `photo_reference_count` about ฝ่าย covers.

### ⛔ THE FOUR THINGS MOST LIKELY TO BE MISUNDERSTOOD

1. **"ฝ่าย tools" means TWO different roads and both now exist.** The FRAME is
   for a ฝ่าย that writes a whole page and sends a pull request. หน้าฝ่าย is for
   a ฝ่าย that edits content in the app with no deploy. **Neither needs
   rebuilding.** I built the frame first and the owner's reaction —
   *"so what have you done, i dont see nothing"* — was correct: the frame does
   not remove them from the loop, and §13 is an ORDER, not a priority.
2. **The ฝ่าย HTML is NOT sanitised and MUST NOT BE.** It renders in a frame
   with no `allow-same-origin`. Anyone "hardening" this by filtering the HTML,
   or "simplifying" it with `innerHTML`, has inverted it. `dept-content.test.js`
   goes red both ways.
3. **`docs/NEXT.md` §0 is ALREADY FIXED** (`photo_reference_count` sees
   `houses.icon_url`, since 0146 — read from `pg_get_functiondef` today). Do not
   spend a session on it. NEXT.md has not been corrected; STATE.md says so.
4. **A scoped grant holds NO permission key.** A person granted one ฝ่าย has
   `permissions = {}` and only `managed_dept_pages = {that ฝ่าย}`. Every gate
   must accept both shapes — the eleven of them are itemised in
   `docs/mistakes/authz-grants.md` under "A SIXTH scope dimension".

### What is genuinely OWED — and by whom

**Needs the owner, cannot be done from here:**
- Delete the two retired Cloudflare Pages projects. Repointing their variables
  only affects the NEXT build; existing deployments still serve the old
  database at `<hash>.<project>.pages.dev`. **Destructive, so it was not done.**
- Reconnect `samomdkkupassport` in the Cloudflare dashboard (passport-on-dev
  step 1; steps 3 and 4 are blocked behind it).
- Reset the Discord bot token; the dev Apps Script deployment; the GitHub
  project board; eyes on the dev-channel notification test.
- **§13 step 8 — teach two ฝ่าย people.** The machinery is finished and nobody
  has been taught it, which is the exact state DEPT-TOOLS was written to avoid.
- Decisions: password reset · เกี่ยวกับเรา mobile demo · the boot bar branch ·
  succession step 0 · whether `prof_can_see_document()` should be narrowed.

**Buildable by the next session, nobody blocking:**
- Step 5: check the ฝ่าย pages on a REAL phone (390px headless is clean; a
  device is not the same claim).
- The browser pass: VS staff modal, ประกาศ drafts, อาจารย์ signature queue,
  shop checkout (`docs/NEXT.md` §1).
- `docs/NEXT.md` §0c: two latent role-only policies, deliberately not swept.

### ⚠️ What I did NOT verify, so nobody claims I did

- **My BROWSER run of หน้าฝ่าย was on samo-dev, not production** (the SQL proof
  ran on both). The probe account was deleted afterwards and its absence
  re-queried.
- ✅ **But the OWNER then used it on production, unprompted** — created a card
  on ฝ่ายดิจิทัล at 14:31 and edited it again at 14:41 (`updated_by` =
  phuriphat.ma@kkumail.com). That is better evidence than my probe was: a real
  person, a real account, the real site, without being told how.
- ⚠️ **ONE PLACEHOLDER IS LIVE AND VISIBLE TO STUDENTS.** That card still holds
  the default title `หัวข้อใหม่` with no link and no cover, `visible = true`, so
  the public ฝ่ายดิจิทัล page shows an empty card. **It is the owner's content —
  do not delete it.** Ask; they may be mid-edit. The two ways out are the ซ่อน
  button (keeps it) and ลบ (does not).
- 📌 **A design question that row asks, and it is a real one:** a new card is
  created VISIBLE. Every other authoring surface in this app drafts first. If a
  ฝ่าย is expected to build a page over several sittings, `visible = false` is
  the better default — but that is a product decision, not a bug, and it was
  not made.

---

## ▶ SESSION 2026-09-01c — หน้าฝ่าย: a ฝ่าย edits its own page (0177/0178)

**Read the commit `d8bb52d` message first — it is the real handoff.** This block
is only what a commit cannot carry.

### The correction that produced this work

I built the ฝ่าย tool FRAME (§13 steps 9–11) and reported it as "the ฝ่าย tools
lane". The owner's reply was *"where is the tools that ฝ่าย can edit their own
page… so what have you done, i dont see nothing"* — and they were right twice
over. The frame is the GITHUB road (write a file, open a PR, the owner deploys);
it does not remove the owner from the loop. And I had made the only example
`launcher:false, dept:null`, so from the site nothing looked different at all.

**The lesson worth keeping: "ฝ่าย tools" named two different roads, and I picked
the one the build order listed rather than the one that removes the bottleneck.**
§13 is an order, not a priority. Before starting a numbered step, check the step
is the thing being asked for.

### What is DONE and needs no rework

Backend, UI, grant, guards, browser-driven, deployed, 29/29 proofs green,
1,636 tests. `dept0177-page-scope.sql` is registered in `run-proofs.mjs`.

### ⛔ What I did NOT do, deliberately — read before touching this

1. **No image UPLOAD in the editor.** Cover/video are URL fields. Wiring the
   Drive uploader means a cleanup path for a REPLACED cover, and there is none:
   0178 makes `photo_reference_count` see these columns so nothing is
   DESTROYED, but a replaced file leaks. That is the safe side of the trade and
   it was chosen, not overlooked.
2. **No preview of an UNSAVED html edit.** The preview re-renders from the last
   SAVED rows. Live-previewing the textarea is easy and is the exact place
   someone will reach for `innerHTML`; if you add it, render into the same
   `srcdoc` frame and keep `dept-content.test.js` green.
3. **A page editor can still publish a convincing FAKE SIGN-IN FORM** on a real
   samo.md.kku.ac.th page. The sandbox stops it reading the real session; it
   does not stop a reader typing into it. The controls are the grant and
   `updated_by`. **This is a real consideration before widening the grant, and
   it is the owner's call, not a bug to quietly close.**
4. **`initDeptPageAdmin` keeps module-level `state`.** It is reset on every
   section entry from the CURRENT user, which is what makes an account switch
   safe — do not "optimise" that to a one-time init.

### For whoever is next

- ⚠️ **`apply-migration.mjs` takes `--dev`. `db-query.mjs` DOES NOT** — and it
  ignores the flag silently, so `node tools/db-query.mjs x.sql --dev` runs
  against **PRODUCTION**. It announces its target on stderr, which is the only
  thing that saves you; READ THAT LINE. To send a proof to samo-dev:

  ```bash
  VITE_SUPABASE_URL="$SUPABASE_DEV_URL" \
  SUPABASE_ACCESS_TOKEN="$SUPABASE_DEV_ACCESS_TOKEN" \
  node tools/db-query.mjs tools/<proof>.sql
  ```

  (`env-lib` picks the target by comparing REFS, so overriding the URL is what
  moves it; the flag belongs to `migrations-lib`, a different resolver. Two
  resolvers, one word — worth unifying, not done.)
- Before 2026-09-01 the one tool that runs DDL could ONLY reach production, so
  no migration in this repo's history had ever been tried anywhere else first.
- `npm run migrate:status` reports nothing outstanding.

---

## ▶ SESSION 2026-09-01b — the ฝ่าย tool FRAME (DEPT-TOOLS §13 steps 9–11)

Built and driven. Two things worth carrying forward.

**The bug the browser found and 1,615 tests could not.** The starter reported
`document.documentElement.scrollHeight` as its height. Inside a frame,
`documentElement` IS the frame — so the tool measured the box the host had just
sized and told the host to size the box to that. It could never come out below
the host's 70vh floor, and every tool shorter than that carried the difference
as dead space. Unit tests proved the message was SENT; jsdom has no layout
engine, so nothing could check that the number in it meant anything. **A frame
is a view you have not opened until you have looked at it.** The property is
guarded where it is visible: `smoke:browser` reports the height at two viewport
heights and requires them equal (628/467 with the bug, 467/467 without).

**Two places I deviated from the written §3, on purpose, both recorded there:**
no 2-second fallback timer (the floor is CSS, so it cannot fire on a
slow-but-working load and there is nothing to withdraw), and `BRIEF-TEMPLATE.md`
folded into the starter's README rather than written as a second document about
the same rules.

**What is left is not code.** §13 step 8 — onboard two people, each ending in a
merged practice PR. The lane is finished and nobody has been taught it, which is
the state this whole document exists to prevent. Step 5 (a REAL phone) is also
still owed; 390px in headless Chrome is driven and clean, and that is not the
same claim.

📌 If the ฝ่าย's real Golden Period arrives as an embed, it takes the slug
`golden-period` and the router prefers the EXACT PATH_ROUTES entry — so delete
the native pane and its entry in the same commit, or the old draft keeps
winning silently.

---

## ▶ SESSION 2026-09-01 — the master/professor guard (0176). CLOSED, nothing owed.

Nothing here is half-done. This block exists for the two things a `git log`
entry cannot carry: how the bug was FOUND, and the two wrong turns.

**The report** was one sentence — *"my friend has permission master with
ผู้ส่งคณะ but can't ซ่อนจากเว็บ on each หนังสือ"* — plus, when asked, the
P0001 text. **The error text was worth more than everything I had read up to
that point**; it named the trigger, which turned a UI-gate hunt into a
three-minute answer. Ask for it first, next time.

**The observation that was the whole diagnosis**: the โครงการ-level ซ่อนจากเว็บ
worked and the per-หนังสือ one did not. `projects` has no prof guard;
`project_documents` does. A difference between two buttons that *should* behave
identically is a better lead than either button on its own.

### Two wrong turns, both caught by the repo's own rules

1. **I nearly closed "was any data damaged?" as NO.** I asked for
   `drive_folder like '%//%'` — a placeholder shape I had guessed rather than
   derived — and got zero rows. Printing the actual rows instead (the rule in
   `.claude/rules/mistakes.md`: *print the ROWS behind the extreme value*)
   showed three paths ending in a bare `_`. The right predicate is
   "does not end in its own id", which needs no guess at all.

2. **The proof's §B was green for the wrong reason, then red for the right
   one.** It asserted a prof-only account is refused, and it was — by RLS, not
   by the guard, because `prof_can_see_document()` needs the หนังสือ to have a
   sign request and the newest one has none. The tell was §B5, which asserts
   the professor CAN comment, coming back `deny-rls` too. The instrument now
   distinguishes `guard` from `deny-rls`, and the proof CREATES the sign
   request rather than relaxing what it asks.

   Related: `A2. master may change a status` was written as `status = status ||
   ''`, which is not distinct from the old value, so the guard was never
   consulted — it passed with the bug reintroduced. Found only by running the
   reintroduce-the-bug ritual and noticing which assertions did NOT go red.
   **The ritual's value is in the rows that stay green.**

### What I did not do, on purpose

- **Did not narrow `current_user_project_seats()`.** Removing `prof` from
  master's seats fixes both triggers and closes five GRANTS
  (`project_settings` read, `project_doc_types` read, sign-request
  read/insert, signed-file insert). The guards are the right place.
- **Did not touch the UI gate.** A master whose STORED seat is `staff`
  resolves to `uni_staff` in `projectSeatRole()` and never sees the
  ซ่อนจากเว็บ button at all, on either level, even though the database would
  let them. That is `projects/index.js`'s stated design — *"under-showing
  relative to RLS is safe; the reverse is not"* — not a bug. If the owner ever
  wants master to reach every control, the fix is a desk SWITCHER, not a
  wider gate.

### The sweep afterwards — what it found, and one thing I did NOT fix

**SQL is clean, and I can say that from an enumeration rather than a hunch.**
Every function in `public` + `passport` that raises AND reads a caller identity:
30 — 6 triggers, 24 RPCs. All 24 RPCs are `if NOT <privileged> then raise`
(deny-by-default; an extra identity only admits). Four of the six triggers are
exemption-first (`if <privileged> then return new`). The inverting shape existed
in exactly two places, both fixed. No RESTRICTIVE policies exist at all, and
every `is_prof` inside a policy is an OR-grant. **Re-run that query before
adding any grant that folds one account into several identities** — it is in
`docs/mistakes/authz-rls.md` under the 0176 entry.

**JS was not clean**, and the second commit fixes it: `db.js`, `vs-form.js`,
`pr-form.js` each formatted PostgREST errors their own way and all three put the
raw JSON body where a person reads it. Now one home, `src/js/rest-error.js`.
`docs/mistakes/supabase-client.md`.

**⚠️ FOUND, DELIBERATELY NOT FIXED — `prof_can_see_document()` is broader than
its name.**

```sql
select public.current_user_is_prof()
   and exists (select 1 from public.project_sign_requests r
                where r.document_id = p_doc_id)
```

It asks whether the หนังสือ has **any** sign request — never whether the request
is addressed to **this** อาจารย์. It gates both `project_documents_read` and the
prof branch of `project_documents_update`, so any prof-seat holder can read and
comment on all 18 หนังสือ that have a sign request, including ones sent to a
different อาจารย์. `project_files` has the same shape via `prof_can_see_file`.

**There is exactly ONE prof-seat holder today (and zero `sa_prof` roles), so
nothing is currently exposed between people.** It becomes a real
cross-visibility question the moment a second อาจารย์ is added — which is why it
is written here rather than left for someone to rediscover.

**It is the owner's call, not a bug to quietly close**: อาจารย์ผู้ลงนาม may well
be *supposed* to see each other's หนังสือ (co-signing, cover during absence).
Narrowing it to `r.prof_id = auth.uid()` is a one-line change to one function —
but it silently removes access somebody may be relying on, and the ask has never
been made. **Ask before changing it.**

### One thing for whoever is next, unrelated to this bug

`npm run migrate:status` prints **EDITED AFTER RECORDING** for
`0173_gas_count_real_uploads_not_sentinels_or_imports.sql`. Not mine, and not
touched this session. A migration is a record of what ran; if the edit changed
behaviour it needs a NEW migration, and if it was only a comment the warning
should be cleared deliberately rather than lived with.

## ▶ SESSION 2026-08-31 (org move day) — WHAT IS HALF-DONE, AND EXACTLY WHERE

Read `STATE.md` first. This block is the part that does not fit there: the
things that are **started and not finished**, with the next action written out
so nobody re-derives it.

### 1. PASSPORT ON THE DEV SERVER — 1 of 5 steps done

⛔ **OBSOLETE, corrected 2026-09-06 — do not work from this section.** It was
written when Passport lived in a separate repo and previews had no `/passport/`.
The monorepo merge (`dc84164`) made `/passport/` real everywhere and DELETED
`public/passport-elsewhere.html`, so steps naming that file cannot be done and
should not be. `npm run dev` has served both apps on one address since
2026-09-04 (`docs/start/install.md`). Kept for its evidence about samo-dev
holding passport's data, which is still true.

**Why anyone wants this:** the dev site (`preview.samomdkkuweb.pages.dev`) has
no `/passport/`, so Passport cannot be tested there. `public/passport-elsewhere.html`
explains that honestly instead of silently serving the wrong app.

✅ **The blocker is gone.** samo-dev held passport's data all along —
`dev-refresh.mjs` dumps `--schema=public --schema=passport`, structure AND rows.
What was missing was one setting: production exposed
`public,graphql_public,passport` to PostgREST, dev exposed only the first two,
so every passport table answered **406 on dev, 200 on production** — which
reads as *missing data* rather than a config gap. Dev now exposes all three and
answers identically (scans 200/200, profiles 200/200, houses 404/404).
`npm run dev:check` diffs exposed schemas from now on.

✅ **Owner did Part A** — the Cloudflare GitHub App can now see the passport repo.

**THE STEPS — 2 of 4 now done (2026-09-01).**

1. ❌ **OWNER, dashboard only** (no Cloudflare API exists for it): Workers &
   Pages → **`samomdkkupassport`** → Settings → Build → reconnect the git
   repository to the org's passport repo. Build command `npm run build`, output
   **`dist`**, production branch `main`.
2. ✅ **DONE — variables repointed to samo-dev** (both production and preview),
   by `npm run cf:pin-dev`. They had named `idwlabpbwiwgaoqwbozz`, the frozen
   old passport database.
3. ❌ Copy `.github/workflows/preview-mirror.yml` into the passport repo and
   push a `preview` branch, giving `preview.samomdkkupassport.pages.dev`.
4. ❌ Change `public/passport-elsewhere.html` to link at that preview instead of
   production, and re-run `node tools/repo-protection.mjs`.

✅ **The Cloudflare database guard now covers the whole ACCOUNT, not one named
project — and finding out why is what turned step 2 up.** It reported 18/18
green while THREE projects existed and two were wired elsewhere; the worst was
`refactorsamomdkkuweb`, retired but still connected to a branch, holding the
LIVE production URL and a production anon key with `VITE_ENV_NAME` unset — the
exact shape of the 2026-08-31 incident. All 27 pass now.
`docs/mistakes/deploy-hosting.md`.

⛔ **STILL OPEN, and it is the owner's call because it is destructive.**
Repointing a variable only affects the NEXT build. Existing deployments keep
the URL baked into their bundle and `<hash>.<project>.pages.dev` serves them
directly — the apex splash does not cover those. Measured:
`05dc3a2a.samomdkkupassport.pages.dev` answers 200 with the frozen database in
its bundle. **Deleting the two retired projects is the only complete fix.**

### 2. WHY THE PASSPORT PREVIEW NEEDS A SECOND URL AT ALL — the owner's question, and it is a good one

Asked: *"can't passport preview use the same one, like samo.md.kku.ac.th — is
this why you should merge?"* **Yes. That is the strongest argument for merging
the two repositories, and it is better than the two I had given.**

Production serves both apps under ONE hostname because **nginx** joins them at
serve time: `root /var/www` with `location /` → `samo-web` and `location
/passport/` → `passport` (`server/nginx-samo.conf`). Cloudflare Pages has no
nginx — **one project serves exactly one build output**. So
`preview…/passport/` can only work if the samoweb BUILD contains
`dist/passport/`, which requires passport's source at build time — i.e. one
repository.

**So the two-preview-URL arrangement is a workaround for a split that
production itself does not have**, and it means the preview is structurally
unlike production. That is a real cost, because looking unlike production is the
one thing a preview must not do.

⛔ Still **not a reason to merge in a hurry**, and `docs/PASSPORT-MERGE.md`
records "two repos stay separate" as decided (its reason — a code firewall
against an agent — is weaker now). If the merge is ever planned, this is the
argument to lead with, plus: passport had NO branch protection until today, and
none of this repo's guards cover it.

### 3. ฝ่าย TOOLS — step 6 done, the frame is not

✅ **`src/data/tools.js` is real.** One registry, one renderer
(`src/js/tool-card.js`), rendered by both the launcher and every ฝ่าย page;
`tab-tools.html` ships an empty grid. `dept-tool-mirror.test.js` is GONE,
replaced by `tools-registry.test.js`. Driven in a real browser, 18 checks.

❌ **Not built:** `public/embed/` and the frame, the starter kit, boundary CI
(`docs/DEPT-TOOLS.md` §13 steps 9–11), and step 5's check on a real phone.

📌 `docs/contributing.md` said "`src/data/tools.js` is a planned location, not a
directory you can add a file to today". That became FALSE the moment the file
landed and was corrected today — **when the frame ships, that page needs the
same treatment.** It is the live contributor-facing claim about this work.

### 4. WHAT I GOT WRONG TODAY, so it is not re-derived

- **"Deploy a tag instead of `main` HEAD" — I called it a small change. It is
  not.** `git checkout <tag>` leaves the VM in detached HEAD and the next
  `git pull --ff-only` (`server/deploy.sh:82`) fails outright. The script also
  re-execs itself after pulling, and passport has no tags. **Do not do it.**
  The risk it addressed — shipping work you did not mean to — is already covered
  by `npm run deploy:owed`, which lists every shipping file.
- **The deploy "hang" did not reproduce** in two full runs (~7 min each). The
  PTY theory I proposed is dead, alongside the sudo theory before it. NOT a root
  cause — two clean runs are not one.
- **"Merging the repos is now worth planning"** — overstated when I said it;
  the passport-on-dev work needs two dashboard clicks, not a merge. The
  argument in §2 above is the honest version.

## ▶ Golden Period — BUILT, SHIPPED, LIVE

✅ **Built as `3b92df5`, deployed in `7405712`, and two deploys behind us now.**
No deploy is owed for it. This block said "DEPLOY IS OWED" for a day after it
had gone out — never trust a deploy claim in a hand-written file; run
`npm run deploy:owed`, which reads the one sha in `STATE.md` and answers from
the working tree.

If you ever do need to verify it in a served bundle, the marker is the string
`gp-tab` or `ช่วงเวลาที่เหมาะกับการจัดกิจกรรม`, NOT a function name (the
minifier renames those).

What shipped: `/tools/golden-period` under **ฝ่ายยุทธศาสตร์และพัฒนาองค์กร**
(`strategy` — NOT `admin`; that was a wrong guess from a screenshot, corrected
by the owner). วิธีอ่านค่า as four bands, the สโมฯ calendar embedded, a button
to the GPC Dashboard sheet, and a release note in `PENDING`.

**Verified in headless Chrome at 390 px and 1280 px** (`skills/drive-the-browser.md`):
pane activates from the route, calendar mode is AGENDA on the phone and MONTH on
desktop, the band dot is actually painted, no horizontal overflow, no console
errors, and the calendar returns real data.

📌 **It is the file the ฝ่าย open a PR against, not a placeholder to replace.**
Its header says so in Thai and names what is safe to change. `id="gpCalendar"`
and the `.gp-tab` class are the two things that must not move.

⚠️ ~~**`dept-tool-mirror.test.js` is new**~~ — **SUPERSEDED. That test no longer
exists** (corrected 2026-09-06): the single registry it was waiting for shipped
on 2026-08-31 and `src/js/tools-registry.test.js` replaced it, keeping both of
its properties. `DEPT_DEFS` and `tab-tools.html` are no longer two
hand-maintained copies. ⛔ This paragraph contradicted a *later* one in this same
file for six days — when you supersede something, strike the older mention too.

## ▶ SESSION 2026-08-28 — WHAT I DID, AND WHAT WOULD MISLEAD YOU

Read `STATE.md` first; this is the part that does not fit there. **Six commits,
all deployed or docs-only, working tree clean, 1394 tests green.**

### The three things most likely to be misunderstood

1. **"The VM cannot do email" is FALSE and I wrote it that way first.** It can
   SEND, through a relay on 587, proven with a live SMTP session. It cannot BE a
   mail server (port 25 out is blocked, `DMARC p=reject`) and cannot RECEIVE (no
   inbound port but 443). Those are three separate facts — `docs/EMAIL.md` §3.
   The owner pushed back on the sloppy version twice; do not re-flatten it.

2. **`npm run deploy:owed` is the ONLY way to ask whether a deploy is owed.**
   Do NOT retype a sha into a `git diff` — that is the bug this session opened
   with (STATE.md's own "check, do not trust this line" command named a sha two
   deploys stale and reported already-shipped code as owed).
   `state-handoff.test.js` now forbids the shape.

3. **The สถิติ email/GAS numbers are FLOORS and one was 12× wrong before I
   checked the rows.** `file_url is not null` counted the sentinel
   `ไม่มีไฟล์แนบ` and pasted links as uploads, and a bulk import (25 rows in
   2.86 s) as live traffic. Real peak is 2 calls/minute of 30. **Before you
   trust or extend those panels, read `docs/mistakes/tooling-proofs.md`.**

### Two gaps closed only after being asked "are you sure"

Worth knowing that the first handoff was incomplete, and how:

- **`npm run email:smoke`** now exists. Before it, the only end-to-end email
  test was a throwaway scratchpad script — the capability existed for one
  session and would have died with it. It sends one marked message AND requires
  an unlisted address to be refused, because that `/exec` URL is public and the
  allow-list is all that stops it being an open relay.
- **`npm run dev:check` now compares auth config.** The `mailer_autoconfirm` /
  `site_url` / `uri_allow_list` drift was fixed BY HAND, and a hand fix has no
  memory — those are dashboard settings, outside git, and nothing would have
  noticed them coming back.

**The lesson for the next handoff:** ask what only exists in THIS session's
context — a capability exercised once, a fix applied by hand, a number verified
in a scratchpad. Those are the things that vanish silently.

### ✅ THE สถิติ PANELS HAVE NOW BEEN LOOKED AT — and two things were wrong

Driven 2026-08-29 at 390 px and 1280 px, deployed as `f9584e5`. The previous
handoff called this "the last honest step" and it was: **two faults were
visible in the first screenshot**, and every instrument that had been used to
verify these panels was blind to both.

- `มองไม่เห็น` wrapped to two lines in 8 of the 12 action rows.
- `แยกตามระบบ` showed `ไฟล์หนังสือโคร…` and `SAMO Pass…` — the full text sat in
  a `title` tooltip, **and a phone has no hover**. The panel's whole purpose is
  to say which system spends the shared quota, and that was the cut-off part.

What was NOT wrong, so nobody needs to re-check it: the `--fill` meter renders
at 6% and 7% (the `min-width: 3px` already covers a 0% reading — that was the
worried-about case and it is fine), no horizontal overflow at either width, no
console errors, the 12-row table fits 390 px without scrolling, and 186/186
chart bars paint.

📌 **Method, if you drive another gated pane.** `skills/drive-the-browser.md` §7
works, but reproduce the pane's REAL ancestry — my first harness put the pane in
a bare div and it rendered 660 px wide inside a 1280 px viewport, which would
have hidden the truncation entirely. The real one is
`.workspace-shell > main.workspace-main > section[data-admin-pane]`, and the
payload comes from `analytics_overview(30)` under an impersonated JWT
(`set_config('request.jwt.claims', …)`; a bare superuser call is refused with
"requires an admin grant").

### What is genuinely un-started (not blocked, just not begun)

- `src/data/tools.js`, the one-source ฝ่าย tool registry — `DEPT_DEFS` and
  `tab-tools.html` are still two hand-maintained copies held in step only by
  `dept-tool-mirror.test.js`. `docs/DEPT-TOOLS.md` §13 has the order.
- The browser pass — `docs/NEXT.md` §1; VS staff modal, ประกาศ drafts, อาจารย์
  signature queue, SHOP CHECKOUT are still undriven.
- **Password reset does not exist in the app**, and mail config is why
  (`docs/EMAIL.md` §2). Fixing it is small and is the biggest user-visible win
  available — but it needs a sending credential, which is owner-gated.

### Do NOT redo these — they are decided

- Previews are per-PR on Cloudflare Pages. Decided, built, proven.
- Apps Script STAYS for email. 100/day against a busiest day of 7 is not a
  problem; the Workspace move is an option to reach for IF volume changes, not
  work to do. I recommended it before measuring, and measuring retired it.
- The Mailpit trap is withdrawn AND its need is met.

## ▶ PHASE 6 — the proofs now run against samo-dev (2026-08-29)

⚠️ **Half of this is stale (corrected 2026-09-06): `.github/workflows/proofs.yml`
WAS DELETED** in `8b46ade` when CI was fixed, so proofs no longer run in CI at
all. `npm run proofs:dev` still exists and still works — run it by hand.
Original note follows.

✅ **`npm run proofs:dev`** and `.github/workflows/proofs.yml` (PRs touching
`supabase/**`). **All 23 database proofs pass against `samo-dev`** — that is the
first direct evidence for §7.3's assumption, the one the un-gated preview URLs
rest on. The two non-database proofs (`repo-protection`, `notify-exposure`) are
SKIPPED with the reason printed, never silently dropped.

⛔ **NOT WIRED INTO CI, and that is the decision — do not re-open it.** A CI job
needs the Supabase management token in GitHub Actions secrets. That token runs
arbitrary SQL, `samo-dev` holds real student data, and this repo is PUBLIC with
five write-access collaborators — secrets are hidden from FORK PRs but readable
by any workflow pushed on a BRANCH. The secrets were added on 2026-08-29 and
**removed within minutes** when the owner said to take the safe default; the
workflow file was deleted with them, and PR #18 (which proved the job fires) was
closed. The reasoning and the safe alternative (a GitHub Environment with the
owner as required reviewer) are in `docs/TEAM-WORKFLOW.md` §7.9.

📌 **Nothing of value was lost.** The job was only ever a scheduler; the two
things worth having — `npm run proofs:dev`, and a runner that fails a proof
which answered from the wrong database — are local and shipped.

📌 **What building it found, and why it matters more than the CI job.** The
documented dev targeting was broken: two proofs parsed `.env.local` themselves,
so `VITE_SUPABASE_URL=$SUPABASE_DEV_URL npm run proofs` ran them against
PRODUCTION and printed one green summary over the mixture. The fix is NOT the
two files — it is that `run-proofs.mjs` reads each proof's own `→ project:`
line back and fails any proof that answered from the wrong database. Write-up:
`docs/mistakes/tooling-proofs.md`.

✅ **PHASE 6 IS COMPLETE.** `tools/smoke-browser.mjs` — nine checks, Chrome over
CDP, **no npm dependency and no credential** — runs on every Cloudflare preview
(`.github/workflows/smoke.yml`). It exists because `npm test` and
`npm run build` BOTH PASS for a build whose entry module never reaches the
browser, which is this app's signature failure: Bootstrap is a CDN script, so
every menu still opens while ~90 inline `onclick` handlers are dead.

Run it by hand against anything: `npm run smoke:browser -- https://samo.md.kku.ac.th --expect-no-ribbon`.

📌 **The design decision worth keeping.** It loads the page as an anonymous
visitor, so it needs no key — and that is precisely why it is allowed in CI when
the proofs job was not (§7.9). If you extend it to anything behind sign-in, you
have changed that property and the whole §7.9 argument applies again.
`src/js/ci-workflows.test.js` now fails the build if ANY workflow reads a stored
secret, so that decision is a mechanism rather than a paragraph.

## ▶ DEV SYSTEM — ONE ITEM LEFT, and it needs you

✅ **`dev-grants.json` is built** (2026-08-28) — `npm run dev:grants`, and step 8
of `dev:refresh` so a rebuild cannot drop it. Refuses any project but `samo-dev`
BY REF before it writes; every entry must carry an expiry and a reason; it
reports expired entries and emails matching no account at each run, because a
list of people rots and a typo grants nothing while looking like success.
The file ships EMPTY, which is the correct steady state.

✅ **The mail trap is retracted AND its need is met.** Dev mail is forced to one
test inbox at the transport, so no trap is needed to keep test mail off real
people. `docs/EMAIL.md` has the whole assessment.

❌ **LAST ITEM: the dev Apps Script deployment under its own Google account.**
Owner-gated — see item 2 below. Everything else in phase 2 is done.

## ▶ The old passport project — DONE, and it is now safe to delete (2026-08-29)

`idwlabpbwiwgaoqwbozz` was the frozen pre-move backup. Checked before deleting,
and the one thing it held that the live project did not has been restored.

- **Frozen since 2026-07-22** — last write of any kind. Nothing in five weeks.
- **All 469 profiles are represented**, except the 5 gmail accounts merged into
  kkumail identities (`passport.account_migrations` names all five).
- **537 scans. Two were absent; now ONE is**, and that one is correct:
  - `213` — kedsaraporn's gmail scan of an activity her kkumail account also
    scanned. **The live table has `unique (user_id, activity_id)`**, so after
    the merge made them one person the second row could not exist. That is the
    constraint working, not a loss. (Found by accident, when a rollback-wrapped
    trigger proof tripped it.)
  - `157` — **RESTORED 2026-08-29.** kanyapat.ki@kkumail.com,
    โครงการรับน้องบ้านเขียว ปีการศึกษา 2569, 200 pts, 2026-06-21 12:24:55.
    She now reads **300 km, 2 stamps**, and her scan sum matches her stored
    total (the profiles-with-drift count went 12 → 11).

📌 **How the restore was done, if it is ever needed again.** `passport.scans`
has an `on_new_scan` trigger that ADDS `points_awarded` to `profiles.total_km`.
Her total ALREADY included the 200, so a plain insert would have taken her to
500. The insert ran with the trigger disabled inside one transaction —
`alter table … disable trigger` is transactional, so a failure would have rolled
the disable back with everything else. **Then the trigger was proved to still
FIRE** (rollback-wrapped insert → 300+7=307), because `tgenabled = 'O'` is a
flag, not a behaviour: a passport whose trigger silently stopped firing would
award nobody any points and look fine.

📌 **Why 157 dropped is still NOT determined.** Ruled out: the activity exists ·
the season is absent for all 537 equally · her profile exists · id 157 was free ·
her auth account was created in the same batch as controls that copied fine
(#180 of 247, 67 created after her). The migration was a hand-run script, not in
this repo, and left no log. **Do not invent a cause for it.**

⛔ **The old project can now be deleted** — it holds nothing the live one does
not. `docs/INVARIANTS.md` says to rotate its DB password first.

**Separately**: 11 profiles still have `total_km` disagreeing with the sum of
their scans. Pre-existing, unexplained, not chased.

## ▶ PASSPORT — CLOSED 2026-08-29. Read this before touching passport data.

**All of it is done. Do not re-open, re-investigate, or "fix" the totals again.**

### What was wrong, and what was done

1. **`passport.scans` had only a BEFORE INSERT trigger** (since 0056), so a
   deleted scan left its points on `profiles.total_km` for ever. Proved by
   deleting a scan in a rolled-back transaction: total stayed 300 while scans
   summed to 100. → **Migration 0174** adds AFTER DELETE and AFTER UPDATE.
   Proof #26 `tools/passport0174-total-km-symmetry.sql`, falsified by dropping
   the trigger.
2. **The app contradicted itself.** `admin_leaderboard` sums SCANS;
   the `user_tiers` view and the student's own page read `total_km`. Both are
   readable by `authenticated`, so a student saw 3,600 km / "The Voyager" on one
   screen and 750 on another. **The owner caught this — I had assumed the
   leaderboard used `total_km` and recommended the wrong thing off it.**
3. **11 profiles drifted; the scan sum was proved correct** (see below), so
   `total_km` was recalculated from scans for all 11. Verified: **drift 0,
   1,016 scans untouched, no leaderboard position moved**, `profiles_guard`
   re-enabled afterwards. 7 students lost an inflated tier badge; 2 of those
   were test accounts and 1 was the owner's.
4. **One scan was genuinely lost in the July migration** — kanyapat.ki's
   โครงการรับน้องบ้านเขียว stamp (200 pts). **Restored** (id 157), with the
   insert trigger held off so her total stayed correct at 300.

### How "the scan sum is correct" was PROVED — this is the part not to redo

The old project `idwlabpbwiwgaoqwbozz` was deleted by the owner on 2026-08-29.
**Its full 537-row scan dump was captured hours earlier and survives at**

    ~/samo-passport-old-db-backup-2026-08-29/

⚠️ **NOT in git — both repos are PUBLIC and it holds real student emails.**

With it: **not one of the 11 drifters is missing an old scan.** Control: the
same sweep over all 537 finds exactly ONE unmatched row (a deliberate
account-merge collapse), so the method detects a miss. Their totals were
therefore already unbacked in the OLD database, whose identical one-way trigger
let deleted scans leave points behind.

⚠️ **What is NOT knowable:** WHY each old deletion happened. Normally deleting a
scan is deliberate, but if any were accidental those points were genuinely
earned. The record is gone. Do not assert a reason.

### ✅ NOT A BUG — 179 orphan profiles are the EXPECTED state (checked 2026-08-29)

**Read this before acting on any earlier claim.** An earlier draft of this file
said 144 students would fail to sign in. **That was wrong, and it was wrong
because I read `passport.handle_new_user` and never checked what is actually
attached to `auth.users`.**

179 of 630 passport profiles have no `auth.users` row — students carried over
from the old database who have not signed into the new project yet. 144 hold km
or scans (25,150 km). That is normal, and it is handled:

`auth.users` carries **`on_auth_user_created_passport_link` →
`public.passport_link_user_by_email()`**, which on signup finds a passport
profile with the same email and a different id, then re-keys
`passport.scans.user_id`, `passport.season_results.user_id` and
`passport.profiles.id` to the new auth id. The student keeps their km and
stamps.

📌 **`passport.handle_new_user` is NOT attached to `auth.users`** — it is not in
the trigger list on that table. Reading it and assuming it fires is exactly how
the false alarm happened. **Check `pg_trigger` on `auth.users`, never the
function's own body.**

⚠️ **One REAL residual risk, small and unverified.** The whole re-key sits in
`exception when others then raise warning …`. It fails SILENTLY: if a re-key
ever breaks, signup still succeeds and the student gets an empty passport while
their old profile is orphaned — and nothing surfaces it. A warning in the
Postgres log is not something anyone reads. Worth a guard that counts profiles
whose email matches an `auth.users` row with a different id (should be 0 after
that user signs in). ✅ **BUILT 2026-08-30** — `tools/passport-link-on-signup.sql`,
proof #27. See the block below: it found a live regression on its first run.

### ✅ OWNER DECISION 2026-08-29 — the tier demotions are ACCEPTED. Do not re-open.

Reconciling the totals dropped 7 tier badges (2 test accounts, 1 the owner's,
**4 real students**), mostly Voyager → Novice. The owner was told and decided:
*"this is ok, if it shows in passport correctly it's fine. don't need to tell
them anything."*

**So: no student is to be contacted, and no total is to be re-inflated.** The
badge now matches the scans, which is what the leaderboard always showed.
`user_tiers` was read back afterwards and returns the corrected tier
(`phuriphat.ma` = 400 km → Novice Traveler). A stale badge in a browser is a
CACHE — hard-refresh before believing it.

### Other open items, NOT investigated### Other open items, NOT investigated

- **`chayaphat.t@kkumail.com` has a passport profile but NO auth account** —
  none by id, none by email. **They cannot sign in.**
- **`mintonaurak@gmail.com` ("Mint N")** — gmail, so cannot stamp (kkumail-only
  gate), never in `account_migrations`, and now reads 0 km. Possibly a real
  student locked out. 12 other non-kkumail profiles hold 0 km, so nothing is at
  stake for them.

## ▶ SESSION 2026-08-30 — the guard found a bug on its first run

I built the passport silent-failure guard that yesterday's handoff owed
(`tools/passport-link-on-signup.sql`, proof #27). It went red on a step I had
written for a completely different reason, and the red was real: **0174, applied
the day before, would have zeroed the km of any carried student on their first
signup.** Migration 0175 fixes it. Nobody was affected — 144 carried profiles
were exposed and none of them signed in inside the window.

The full mechanism is in `docs/mistakes/postgres-schema.md`; what belongs here is
the part that would mislead the next person:

1. **I did not go looking for this.** The owed item was "the re-key fails
   silently". The bug I found is the re-key SUCCEEDING and losing the number.
   Both end with the student on an empty passport, which is why one guard covers
   both — but do not read the write-up as if the silent-failure risk is now gone.
   `passport_link_user_by_email` still swallows its own exceptions. The guard
   makes the RESULT visible; it does not make the failure loud.

2. **The step that caught it is the one I nearly left out.** "The km and the
   stamps follow the student" felt redundant next to "signing in re-keys the
   carried profile" — the row moved, what else is there. The row moving and the
   row arriving INTACT are two different claims, and only the second one was
   false. When a proof asserts that something moved, assert what it is worth
   when it lands.

3. **Do not reorder the three updates in that function** to "fix" this. Moving
   the profile first makes `on_scan_points_changed` DOUBLE the total instead —
   the no-op just swaps ends. 0175 restates the invariant after the move, which
   is why a fourth trigger cannot reopen it.

4. **The exposure numbers came from the database, not from arithmetic.** 0174
   was applied 2026-08-29 15:00 UTC; 2 signups happened after it, neither a
   carried student; 0 profiles drift from their scan sum. If you need to re-check
   any of that, ask the database again — do not quote these.

## ▶ SESSION 2026-08-30 (late) — scoped grants, the docs site, and succession

Long session, four themes. What would mislead the next reader:

1. **`passport` is passport ADMIN rights, NOT permission to open the app.**
   Every kkumail student can open SAMO Passport and collect stamps — that was
   never gated. `passport_admin_context()` is the authority: `is_admin` = the
   blanket key OR any scope; `all_departments` = the blanket key alone. **I got
   this wrong for an hour and described a missing shortcut button as "42 people
   locked out".** The owner corrected me. Do not re-derive it from the
   permission's NAME.

2. **A scoped grant carries NO capability key** (`readPermInputs` drops it —
   0083). Four readers tested for the key and so showed nothing; a fifth
   understated master. All fixed and deployed. **The sweep is one grep** —
   `includes('vs')`, `includes('passport')` — and it is written up in
   `docs/mistakes/authz-grants.md`. Do that grep the day a dropping rule is
   invented.

3. **My first investigation of the report was WRONG and nearly called an
   outage.** I swept for `'passport' = any(permissions)`, which by construction
   cannot match a scoped grant, and concluded nobody had access. The tell was
   in the data: `permissions: ['claude']` on that node is exactly what a
   correctly-saved scoped grant looks like. **Ask whether a thing does not
   EXIST or does not DISPLAY before touching anything.**

4. **The docs site is live and `npm run docs:build` is in the required CI
   check.** Markdown that breaks it cannot merge. Building it found three
   places where GitHub's renderer was silently DELETING words from `docs/`.

5. **Succession is not a GitHub question.** `npm run succession:audit`. The
   two role gmails handed down each year are the right shape; whether they
   survive depends on their RECOVERY SETTINGS, not their addresses. The VM ssh
   key on one Mac and `.env.local` on one machine are the two highest-damage
   items, and neither is fixed by anything on GitHub.

⚠️ **Two things I did NOT do, both asked for:**
- **A readable "how to contribute" page for non-developers** (STATE.md A2).
  `CONTRIBUTING.md` is developer-facing and lives on GitHub, which is the
  surface the ฝ่าย find intimidating. The docs site is the natural home. Do not
  just re-render CONTRIBUTING.md.
- **The GitHub organisation move** — runbook is written and ready
  (`skills/move-the-repo-to-an-organisation.md`); the owner wants to discuss
  and plan it further before executing.

## ▶ ASKED FOR AND NOT DONE — pick these up first

1. **A `DEV` folder inside `IT Database` on Drive.** The owner asked for it
   (2026-08-27) and it was never created — the Discord webhook incident took the
   rest of the session. Parent folder id: **`1_VQXAVh4ZMoj7_TLiHJFe4HM223Q0oLW`**.
   Purpose: a dev Apps Script deployment writes uploads there instead of into the
   real tree (`docs/TEAM-WORKFLOW.md` §1). ⚠️ The clasp token on this machine is
   `drive.file` + `drive.metadata.readonly` and EXPIRES hourly, so it may not be
   able to create inside a folder it did not make — **it is 30 seconds by hand in
   the Drive UI**, and that is the sane path.

2. **The dev Apps Script deployment.** `samoweb` (`1lENmMdToG_P…`) is the LIVE
   one — confirmed by matching its deployment v11 to the `/exec` id in
   `src/js/config.js`. A dev copy should live under **its own Google account** so
   its credential reaches nothing real (`.claude/rules/security.md` explains why:
   `prform.gs` uses `DriveApp`, so re-authorising grants the whole Drive).

3. ~~**A mail server on the VM — run Mailpit, point `samo-dev`'s SMTP at it.**~~
   **RETRACTED 2026-08-28 — but only the RECEIVING half.** A trap needs
   Supabase to connect IN, and nothing can: the VM holds only
   `10.101.111.181`, and the public `202.28.95.46` has 25/587/465/1025 filtered
   (443 open as the control).
   ⚠️ **Do not read that as "the VM cannot do mail" — it CAN send.**
   `smtp.gmail.com:587` and every other relay answer from the box, proven with a
   real STARTTLS session that offered `AUTH`. What is blocked is port 25
   OUTBOUND (so it cannot be an independent server) and the domain's
   `DMARC p=reject` (so it cannot send AS `@md.kku.ac.th` without KKU NOC).
   **The whole assessment — both senders, every quota ceiling, and the
   recommendation — is `docs/EMAIL.md`.** Read that, not this bullet.
   Headline: there is no password reset in this app, and mail is why; the
   cheapest large win is moving the Apps Script to a KKU Workspace account
   (100 → 1,500 recipients/day, no DNS request, no new service). If a browsable
   trap is still wanted, the transport is Supabase's Send Email Hook over
   HTTPS — 443 is the only port that reaches the VM — and it is NOT built.

## In flight

- ✅ **The database password is in `.env.local` and verified.** Schema dumped:
  64 tables, 165 functions, 156 policies, 592 GRANTs. Recipe and traps in
  `skills/build-the-dev-database.md`. **The dump is a build artifact and is NOT
  in the repo** — it lives in the session scratchpad and goes stale; re-run the
  dump rather than reusing an old file.
- ✅ **`samo-dev` is BUILT, LOADED and PROVEN** (the ref in `SUPABASE_DEV_URL`).
  Rebuild any time with `CONFIRM=1 npm run dev:refresh`; check it with
  `npm run dev:check`. Credentials are the `SUPABASE_DEV_*` block in
  (⚠️ split 2026-09-06: only URL + ANON_KEY are a default share)
  `.env.local` and are safe to share with the team — that account holds nothing
  but disposable projects.
- ~~**The one-source tool registry is un-started**~~ — **DONE 2026-08-31**,
  `docs/DEPT-TOOLS.md` §6. One renderer (`src/js/tool-card.js`) serves both
  consumers, `tab-tools.html` ships an empty grid, and `dept-tool-mirror.test.js`
  is GONE — replaced by `src/js/tools-registry.test.js`, which keeps both of its
  properties and additionally ratchets that no card is hand-written beside the
  registry. ⚠️ **This bullet stayed stale for six days and named a test that no
  longer exists**; corrected 2026-09-06. It is the third time this file has
  carried a "un-started" claim about something already shipped — when you finish
  something, come back here and strike the bullet.

## Next time I have an hour

- The project board (the last outstanding piece of `TEAM-WORKFLOW` phase 0).
- ~~Decide whether previews are per-PR or one always-on dev site.~~ **DECIDED
  and BUILT: per-pull-request, on Cloudflare Pages** (`docs/TEAM-WORKFLOW.md`
  §1, D8), proven end to end on 2026-08-27. Left here struck through because a
  session re-opened it from this very bullet and wasted a round trip.

---

## 2026-09-12 — Discord role sync: linking is live, nothing syncs yet

**Status: VERIFIED 2026-09-12.** Everything below was read from the live system.
What is OWED is in `docs/state/HANDOFF.md` §14b; the design is
`docs/DISCORD-ROLE-SYNC.md`. This file is only the reasoning that would
otherwise be lost.

### What shipped

Migrations **0183–0186**, all applied to production and proved:
identity + role mapping + the tick-box (0183, 22/22) · `discord_role_targets()`,
the one function that decides what a person is due (0184, 18/18) · link codes
(0185, 29/29) · self-read and unlink (0186).

Plus `tools/discord-report.mjs` (read-only, guarded),
`tools/discord-provision.mjs`, `server/discord-oauth.mjs`, and
`src/js/discord-link.js` with the card on ข้อมูลของฉัน.

**48 of 107 ticked nodes are mapped to Discord roles. ZERO roles were created.
The guild is still at 180 of 250.**

### The four decisions that changed during the session, and why

1. **`/link` must NOT copy the old `!verify`.** It asked for the last five
   digits of a รหัสนักศึกษา. Defensible when the consequence was a nickname;
   not when the same answer hands over a person's roles and channels. A student
   ID is on the card and on every form — the attacker is a classmate, not a
   brute-forcer. **A control is only as strong as what it now unlocks.**
2. **Then even the typed code was wrong.** The owner asked whether it was the
   standard, and it is not — Discord OAuth2 is. It is also STRONGER: a typed
   code proves a portal session and nothing about the Discord account, and can
   be pasted to a friend. 0185 was not wasted: its code became the OAuth
   **state**, which is exactly what state should be.
   ⚠️ **The lesson is not about Discord.** 0185 was designed carefully against
   the right threat and still reached for a mechanism the platform provides.
   *"Is there a standard way to do this"* belongs BEFORE designing a credential.
3. **The nickname was never the problem — using it as the KEY was.** The old bot
   made 196 people rename themselves, annually. But it bought a readable member
   list, which OAuth2 does not. Keep both: identity from OAuth2, nickname as an
   OUTPUT the bot writes from ทีม SAMO. The bot already holds Manage Nicknames.
4. **§8b's premise was wrong and it is worth re-opening.** Option A was chosen
   accepting "Python in a JS repo, so deploy.sh grows a venv step". That cost
   was assumed because a bot needs a gateway connection. **Nothing here does** —
   report, provisioning, role changes and slash commands are all REST or an HTTP
   interactions endpoint, and phase 4's trigger is Supabase Realtime. §8b-bis
   recommends C. Not re-decided; the owner chose A.

### The role cap, and why "adopt only"

Discord allows **250 roles per guild, hard**. The server is at 180. Both obvious
levers were measured before recommending anything and **both are dead ends**:
158 of 179 roles gate a channel, only 4 are dead; and 106 of 107 ticked nodes
have real people. Deleting buys four roles.

What settled it: **49 of the 50 adoptable roles already gate a channel.** So
adopting costs ZERO and lands the whole feature where access actually happens,
while creating 53 spends 76% of the remaining headroom on groups that gate
nothing yet. **A role earns its place by gating a channel or being @mentioned.
Provision on demand, never in bulk.**

### Mistakes made in this session, each now guarded

- **I leaked the bot token into the transcript** with a script written to
  prevent exactly that: its mask keyed on `=`, and the file's defect was a bare
  value with no key, so the substitution matched nothing. Token reset;
  `server/check-env-file.sh` replaces it and has no code path that can print a
  line. Write-up: `docs/mistakes/tooling-proofs.md`.
- **Provisioning checked one side of a name collision.** It verified that one
  DISCORD ROLE had the name, never that one ทีม SAMO NODE did — three
  ฝ่ายวิชาการ claimed one role and 0183's unique index refused it mid-run, after
  30 writes. The constraint did its job; the tool did not.
- **The report said "LINKED AND CORRECT" about a person due four roles**, because
  with nothing provisioned everyone is vacuously correct. Worst possible
  direction: "correct" is what someone reads before applying.
- **I pushed with two tests red**, and one of those tests was itself wrong — it
  counted `res.writeHead(` across a FILE when the property was about a FUNCTION.
- **`npm test` green while `npm run build` broken** (`db.js` exports `db`, not
  `supabase`). Both, every time.
- **I typed an invented sha into STATE.md's DEPLOYED line** and caught it only by
  asking the VM. That line is the sha's one home.

### The thing with no guard on it

`/discord/config` and `/discord/callback` exist **only** in the VM's
`/etc/nginx/sites-available/default`, added by hand. `server/nginx-samo.conf` in
this repo is not what nginx serves, the two have drifted, and a reinstall from
the repo copy would silently drop both routes — เชื่อมบัญชี Discord would stop
working with nothing in any log. It bit once already mid-session, when
`/discord/config` was in the repo copy and not the live one and fell through to
the SPA, returning HTML where the browser wanted JSON.
