# STATE — what is true RIGHT NOW

**Split 2026-08-27.** This file was 1,403 lines against a ~200-line target
because it held three lifetimes at once. It now holds one: **status**.

| Looking for | It is in |
|---|---|
| rules that outlive a session | **`docs/INVARIANTS.md`** |
| what a past session did, and why | **`docs/state-archive/`** — newest `2026-08-27-state-split.md` |
| what one person is working on | `docs/state/<github-handle>.md` |
| the chronology | `git log --oneline` |
| bugs already paid for | `docs/mistakes/*.md`, indexed by `.claude/rules/mistakes.md` |
| architecture, RLS, schema, deploy | `docs/CONTEXT.md` |
| the backlog | `docs/NEXT.md` |

## HOW TO EDIT THIS FILE

Everything older was drained on 2026-09-01 (and the 09-01 "settled" list on
09-05, after confirming each pointer resolves) — reasoning in
`docs/state-archive/2026-08-30-status-prune.md`, durable items in
`docs/INVARIANTS.md`.

**Rules for editing this file, each paid for:** give a decaying fact ONE home ·
grep the WHOLE file before correcting anything · never touch the deploy block
unless you deployed · **do not append a session narrative** — write
`docs/state/<your-handle>.md` instead, and never rewrite someone else's.
`state-handoff.test.js` pins what is mechanically checkable (dead pointers,
disagreeing counts, this file's length); it cannot judge whether a sentence is
TRUE. That is what the grep is for.

---

## CURRENT DEPLOY

- Prod = KKU VM `samo.md.kku.ac.th`. Deploy = commit → push `main` →
  `skills/deploy-vm.md`. **Needs VPN. Pushing does NOT deploy.**
- ✅ **DEPLOYED = `62b7c68` (2026-09-12)** — v4.7.0 still, and read back from the
  VM's own HEAD, not retyped. `<== exit 0 — ran to the end` + `DEPLOY_EXIT=0`.
  **31 s — the healthy baseline** — and the docs step RAN. Carries the Discord
  tick-box: `มี role ใน Discord` greps 1 in the served `/admin/`, its JS half
  and `team-discord-linked` grep 1 in the served `admin-*` bundle and CSS, each
  beside a string that already shipped as the control. Roots 12 s apart.
  ⚠️ Code lives in DIFFERENT artefacts: `postGAS` in the shared `analytics-*`
  chunk (NOT the public bundle, 0145), ฝ่าย blocks in `admin-*`.
  ⚠️ Empty output from the pipeline means a DROPPED VPN, not success —
  `skills/deploy-vm.md`, its one home. The passport MERGE stays live — `/passport/` serves the real app and
  `/var/www/samo-web/passport` does NOT exist, which the nginx rule needs.
  ⚠️ **`npm ci` is the whole duration anomaly** — exactly ONE of the two stalls
  ~5 min per run and **which one alternates**, so it is not either repo's
  lockfile. Cause unknown; disk, memory, registry, CPU all measured healthy.
  **Duration alone is not the known hang** — table in `skills/deploy-vm.md`.
  ⛔ **THE DOCS STEP IS INTERMITTENT — AND IT EXITS 0.** The run tally lives in
  `skills/deploy-vm.md`, its ONE home — do not restate it here. `deploy.sh`
  writes every run to `~/samo-deploy-logs` on the VM plus an xtrace naming the
  line reached. Read the log before theorising.
  ⛔ **A HEALTHY RUN IS ~30 SECONDS.** A run taking MINUTES is already the fault
  — the two "clean ~7-minute runs" the hang was once declared dead on were 14×
  baseline, not controls.
  ⚠️ **After every deploy, check the ARTEFACT** — root write times must agree
  (`stat -c "%y %n" /var/www/samo-web /var/www/docs`), then curl-grep a SERVED
  page for a string added today, with an old one as control (`skills/deploy-vm.md`).
  ⛔ Falsified, do not re-open: sudo expiry · the `timeout` ceiling · the PTY.
  Two clean runs were NOT a root cause — `docs/mistakes/deploy-hosting.md`, and
  the whole recipe is `skills/deploy-vm.md`.
- ✅ **`main` being AHEAD of the deployed sha is the NORMAL state** — tests and
  session notes reach nothing. ⚠️ **`docs/` DOES ship now** (the VM serves
  `/docs`), so "it is only docs" stopped being a reason to skip a deploy on
  2026-08-31. Do not judge this by eye and do not retype the sha:

  ```bash
  npm run deploy:owed
  ```

  It reads the ✅ DEPLOYED line above, which is the sha's only home, and
  compares that commit with the WORKING TREE. Exit 0 = prod is current.
  ⛔ **Never paste a `git diff <sha>..HEAD` snippet back in** — the sha had four
  homes here and only one got corrected.

- ⚠️ **Verify from the SERVED artifact**, and grep the RIGHT one — both traps
  live once, in `docs/INVARIANTS.md` and `docs/mistakes/deploy-hosting.md`.
- **Apps Script = prform v12** (2026-09-10), `/exec` unchanged — the two
  read-only Drive handlers §13a needs. ⛔ Calling them hard degrades the endpoint
  real uploads SHARE; measured in `docs/state/HANDOFF.md` §13a.
- **Migrations through 0184. ALL 37 LIVE PROOFS GREEN** (2026-09-12). 0183/0184 are the PORTAL half of Discord role sync — `discord_links`, `team_nodes.discord_role_id` + `discord_role`, plus `discord_role_targets()`, the ONE function that decides what a person is due — applied and proved 22/22 + 18/18, both watched failing first. The seed ticked **107 of 299 nodes**; the rest are the owner's review. **No bot code exists and none may be written until `docs/DISCORD-ROLE-SYNC.md` §7 is done.** HANDOFF §11 and §13c both CLOSED.
  ✅ `claude0154` 21/21 + `claude0155` 23/23, fixed 2026-09-11. ⚠️ **The cause
  recorded here was WRONG**: the first real booking (2026-09-07) landed in the
  week both hardcoded as quiet, and 0155 had a FALSE GREEN on that stranger's
  row. Both now CONSTRUCT the absence and assert it (`docs/mistakes/tooling-proofs.md`).

---

### WHAT PROD IS DOING RIGHT NOW

- **Claude usage measurement is ON** since 2026-08-25 17:18 UTC, sampling every
  15 min. ⚠️ This block once said OFF, with a procedure to re-enable something
  already enabled — **ask the DATABASE, never this file, for runtime state**:
  `select monitoring_enabled, … from public.claude_settings` (`db-query.mjs` takes a FILE).
- `monitoring_note` still holds the old pause reason — not shown while
  measurement is on, used correctly by the monitor-on notice. Leave it.
  `claude_bookings` holds its FIRST REAL BOOKING (2026-09-07) — not empty. Ask
  the database, not this line.

---

### CONTRIBUTOR CREDENTIALS — rebuilt 2026-09-06

`npm run dev` now uses **samo-dev, not production**, and says so on every start.
`.env.local.example` is the contract; adding a variable is ONE edit there.
✅ **samo-dev is IN STEP with production (2026-09-07)** — the 3 pending were
applied (0174–0176) plus 0177 re-recorded; both report `PENDING: 0`. A merged
migration nobody applies is now visible in two places: the pull request itself,
and `npm run deploy:owed`, which asks PRODUCTION before it gives its verdict.
Why: `docs/state/phuriphatma.md`. What is left: `HANDOFF` §8.

### What is owed

⛔ **START HERE: `docs/state/HANDOFF.md` is the full list of what is NOT done, with reasons and owners. Read it first; below is detail.**

### A. NEXT SESSION — buildable now, nobody is blocking you

✅ Shipped, do not rebuild: the passport guard (proof #27) · the docs site (02).
⛔ **No polling timer for the docs** — built, verified and REMOVED the same day.

0. ✅ **ORG MOVE DONE** (2026-08-31); `repo-protection.mjs` 18 pass (was 27:
   sibling-repo loops inert BY DESIGN). Org 2FA OFF by OWNER DECISION. Traps:
   `skills/move-the-repo-to-an-organisation.md`; last box `HANDOFF` §3.

1. ✅ **A ฝ่าย NOW EDITS ITS OWN PAGE — no commit, no deploy (0177/0178/0179).**
   เมนู "หน้าฝ่าย" in /admin/. **Four kinds since 0179: หัวข้อ · การ์ด · ข้อความ ·
   HTML**, a new row is a DRAFT, and covers UPLOAD from your machine (the file
   they replace is retired).
   ✅ **AND the ฝ่าย tools lane** — `public/embed/starter/` → a `tool/*` PR →
   `/tools/<slug>`. Both are LIVE; do not rebuild either.
   ⛔ **THE ISOLATION OF BOTH IS ONE MISSING WORD** (`allow-same-origin`), and
   the three changes that delete it are now a rule in `docs/INVARIANTS.md` —
   with the owner-facing fake-sign-in risk. Read it before touching the frame.
   ✅ **THE VISUAL EDITOR IS ACCEPTED AND BUILT OUT** (owner 2026-09-11, "do
   it") — 21 blocks in 5 Thai categories, the link field now findable, links
   pinned to `_blank`, placeholders inlined. ⏸ **PAUSED by the owner the same
   day; do not extend it unasked.** Still no end-to-end drag-and-save by a
   human. HANDOFF §4 — read its viewport near-miss before any layout work.
   ⚠️ An earlier note the SAME DAY said a canvas was REJECTED — superseded, and
   `docs/state/phuriphatma.md` says so at both ends. Why GrapesJS and not
   Puck/Craft.js (React-only), plus the block-set work next: same file.
   ❌ **What is left is NOT code: §13 step 8, teach two people**, and step 5 on
   a REAL phone. Detail: `docs/state/phuriphatma.md` + `docs/DEPT-TOOLS.md`.
2. ⚠️ **THE DEPLOY DOCS STEP — INTERMITTENT.** An intermittent fault is never
   disproven by successes; this entry once claimed the opposite. `set -x` now
   writes `~/samo-deploy-logs/<stamp>.trace` on the VM — **read the log before
   forming any theory.** Status and tally: the CURRENT DEPLOY block, their one
   home.
3. ✅ **PASSPORT REPO MERGE — COMPLETE.** One pull, one `npm ci`, one build. Old
   repo ARCHIVED. ⛔ **Never delete OR replace the `samomdkkupassport` Cloudflare
   project** — `docs/INVARIANTS.md` is its home.
4. 🟡 **DISCORD ROLE SYNC — PHASE 2 RAN AGAINST THE LIVE GUILD (2026-09-12).**
   ⛔ ONE HOME: `docs/DISCORD-ROLE-SYNC.md`. Bot live, token on the VM, ordered
   top. **196 people · 183 roles · 107 ticked · 0 provisioned · 0 LINKED** —
   so the bottleneck is `/link`, not the sync. `npm run discord:report`.
   ⛔ The OLD bot is STILL in the server; §7 step 5 closes the leak. `HANDOFF` §14b.

### B. OWNER ONLY

⛔ **One home: `docs/state/HANDOFF.md` §1 and §3.** This section used to restate
those four items and drifted from them; do not re-add a copy here.

- ✅ **Nothing owed on Claude measurement, the `claude` grant, or ประกาศ.** Ask
  the DATABASE for runtime state; this file must not carry it.
- ⏸ **The boot bar's first-failure branch — OFFERED, owner decides.**
- ✅ **DEV SYSTEM — phases 1, 3, 4, 5 and 6 are DONE.** Only phase 2's last
  item remains and it is OWNER-GATED (§B1). Plan + per-phase status:
  `docs/TEAM-WORKFLOW.md` §8; procedure and every trap
  `skills/build-the-dev-database.md`. **`samo-dev`'s ref is in
  `SUPABASE_DEV_URL`** (separate account, D7); creds are the `SUPABASE_DEV_*`
  block in `.env.local`, shareable with the team, **URL never published — dev
  holds REAL student data**. Rebuild `CONFIRM=1 npm run dev:refresh`; check
  `npm run dev:check`; proofs `npm run proofs:dev`. **Google sign-in is OFF on dev.**
- **The docs site is `docs/` RENDERED.** Nothing secret goes in `docs/`.
- **ฝ่าย tools — WORKFLOW, REGISTRY AND FRAME ARE ALL LIVE.** Read
  `docs/DEPT-TOOLS.md` (§0a = owner decisions, do not re-litigate). Also live:
  branch protection, `CODEOWNERS`, the Thai request template,
  `skills/onboard-a-contributor.md`, and **Golden Period at
  `/tools/golden-period`, THEIRS to PR against**.
  ⛔ Lane C (a tool that reads real data) is still HARD-BLOCKED on §13 step 15.
- **เกี่ยวกับเรา on mobile — WAITING ON THE OWNER'S PICK.** Read
  `docs/demos/about-3d/README.md`, not a bullet.
- **The browser pass, continued — `skills/drive-the-browser.md`.** Still
  undriven: VS staff modal, ประกาศ drafts, อาจารย์ signature queue, SHOP
  CHECKOUT. `docs/NEXT.md` §1. The auth blocker is solved; §4 of that skill has
  the recipe and both traps.
- **ทีม SAMO restructure — read `docs/INVARIANTS.md` before reparenting a ฝ่าย.**
- `docs/NEXT.md` carries the rest. Genuinely un-started: §0c (two latent
  role-only policies, deliberately not swept), §0a (ทีม SAMO admin model, PARKED
  by the owner), §0b2 + §1 (the browser pass). ⚠️ Its §0
  (`photo_reference_count()` cannot see `houses.icon_url`) is **already FIXED**
  — read from `pg_get_functiondef`, 2026-09-01. 0178 added the ฝ่าย covers too.

---

## ✅ VAULTWARDEN — LIVE at `/vault/` (2026-09-06)

Free self-hosted team password vault. Two Owners of org `samomdkku`: the owner's kkumail and the
`mdstuddata.beta@gmail.com` ROLE account (succession anchor). **Operations `skills/vaultwarden.md` ·
architecture `docs/CONTEXT.md` · what it owes HANDOFF §7.** Do not re-derive any of it here.
⛔ **`SIGNUPS_DOMAINS_WHITELIST` must stay UNSET** — a non-empty value overrides `SIGNUPS_ALLOWED=false`
and opened public registration to every kkumail at KKU for ~6 h today (`docs/mistakes/authz-grants.md`).
**Two host-wide wins came with it:** `unattended-upgrades` enabled (the box had NEVER auto-patched —
~90 pending security updates, applied) and nginx really compresses now (`gzip on` alone covers only
text/html): cold `/vault/` 8.26 MB → 2.26 MB, main bundle 293 KB → 112 KB.
**Owner owes:** break-glass envelope · delete `newtest` org · rotate the Gmail app password.
**Unverified:** websocket Upgrade through KKU's edge · **restore has never been run**.

## NEXT SESSION — start here

1. **This file**, top to bottom. Read all of it.
2. **`docs/state/HANDOFF.md`** — the ONLY list of what is not done, each
   section carrying a `Status:` saying how far to trust it.
3. **`docs/INVARIANTS.md`** — the rules. Longer, and it changes slowly.
4. **`docs/state/phuriphatma.md` — its FIRST `## ▶ HANDOFF` block**, whichever
   date that is. It names what is owed, what is waiting on the owner, and what
   was deliberately NOT verified. Everything below it is history, including
   older handoff blocks.
   ⚠️ **Never name a date here** — one was, and a newer block landed above it.
5. Only then, the archive file for whatever you are about to touch.

**What waits on the owner is section B above — do not restate it here.** These
are DECISIONS rather than credentials, and none should be built unprompted. Ask
in plain language:

| # | Question | Where | Recommendation on file |
|---|---|---|---|
| 1 | **Turn on password reset?** It does not exist today and mail config is why — the biggest user-visible win available | `docs/EMAIL.md` §2/§5 | start with a Gmail app password; needs nothing from KKU |
| 2 | Should the Claude usage reporter poll more often than every 15 min? | `docs/NEXT.md` | **leave it at 15** |
| 3 | Build the boot bar's first-failure branch? | ⏸ above | offered, not urgent |
| 4 | เกี่ยวกับเรา on mobile — which of the demos? | above | read `docs/demos/about-3d/README.md`, do not summarise it |
| 4b | **Merge `samomdkkupassport`?** ✅ **DONE 2026-09-04** — subtree'd, tested, deployed, old repo archived. Full record + the two traps that remain: `docs/PASSPORT-MONOREPO.md`. ⛔ Do NOT reconnect the passport Pages project and ⛔ never delete it (QR posters) | done | — |
| 5 | **SUCCESSION.** The two role gmails (studbeta, samomdkku.ai) handed down each year are the RIGHT shape — ⛔ decided, do not re-litigate. But **studbeta alone holds prod Supabase + the Google sign-in OAuth client + Cloudflare**, its Cloudflare member is Super Administrator with **2FA OFF**, and the VM ssh key is on one Mac | `docs/SUCCESSION.md`, `npm run succession:audit` | **step 0 is the recovery settings on both gmails** — "it does not graduate" is a property of those, not of the address. Then cross-add each account to the other's systems. The GitHub move is step 7 of 8 |
| 6 | ~~Move to a GitHub organisation?~~ ✅ **DONE 2026-08-31 except Cloudflare.** Both repos are in the org, `CODEOWNERS` names a team, Copilot is unaffected (org holds 0 seats — never buy any). ⛔ Do not re-litigate | `skills/move-the-repo-to-an-organisation.md` §0a | **One thing left needs the dashboard: reconnect Cloudflare Pages (§5a), or previews stay dead** |
| 7 | ~~What URL should the docs site have?~~ ✅ **ANSWERED AND BUILT 2026-08-31 — nothing owed.** `https://samo.md.kku.ac.th/docs` serves the real pages from the VM. (HOW they get rebuilt is status, not a decision — the CURRENT DEPLOY block above is its one home; do not restate it here.) ⛔ **Do not re-open this and do not ask KKU for a subdomain** — the owner confirmed KKU gives one VM and one hostname, so `docs.samo.md.kku.ac.th` was never available and the CNAME plan that stood here was dead on arrival | `server/nginx-samo.conf`, `server/deploy.sh` | Serving docs at a PATH is mainstream, not a compromise: nextjs.org/docs, tailwindcss.com/docs, supabase.com/docs and kubernetes.io/docs all answer 200 at the path (measured). ⛔ **And do not re-add a polling timer.** One was built and removed the same day: its whole justification was "otherwise publishing needs someone on VPN", and the owner's answer was that deploy-time updates are fine. Pull-based deploy is a real pattern (ArgoCD, Flux) but it is for keeping an app current, not a docs page — **the lesson is that the requirement was assumed, not asked** |

⛔ **Previews are NOT on this list — they were DECIDED long ago** (§1 + D8:
per-PR, Cloudflare Pages). A session re-opened them on 2026-08-27 and wasted a
round trip. **Check `docs/TEAM-WORKFLOW.md` §0/§1 before asking anything.**

⛔ **Do not offer to "build the ฝ่าย tools frame" — it is BUILT** (2026-09-01),
and so is the หน้าฝ่าย editor beside it. What is left there is §13 step 8:
teaching two people. See A1.
📌 Golden Period itself is THEIRS — IT only drafted it; hand the route over when
their version lands. An IT-built page is a page IT owns, which is the bottleneck
that design removes.

**No deploy is owed.** Check, do not trust this line — and note that it names
no sha, on purpose. Retyping one into a `git diff` is the bug that opened
2026-08-28, and `state-handoff.test.js` now forbids the shape:

```bash
npm run deploy:owed
```
