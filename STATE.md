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
- ✅ **DEPLOYED = `4024a6c` (2026-09-10)** — v4.7.0 still. 32 s, `<== exit 0 —
  ran to the end` AND `DEPLOY_EXIT=0`; roots stamped 12 s apart, so docs ran.
  **DOCS ONLY — no bundle changed**; 0182 is a DB migration already applied to
  dev and production. Verified from the SERVED artifact: `/docs/INVARIANTS.html`
  and `/docs/mistakes/authz-rls.html` (200) each carry a string added today,
  with an OLD string as the control so a 1 means the grep can see both.
  Prev `333dc63`. ⚠️ nginx config is installed SEPARATELY (`deploy.sh` never
  does it) via `nginx -t` + auto-rollback; not touched today.
  ⚠️ **The run before this one produced NO OUTPUT AT ALL and had not deployed** —
  the VPN had dropped, and `ssh` to `10.101.111.181` times out silently. Empty
  output from the deploy pipeline is that, not success; check the SERVED page.
  The passport MERGE stays live — `/passport/` serves the real app and
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
- **Migrations through 0182. 32 of 34 LIVE PROOFS GREEN** (2026-09-10). 0182 gave `passport.continents` row security; **HANDOFF §11 is CLOSED**.
  ⚠️ Red: `claude0154-quota-guard`, `claude0155-free-now` — **neither a code
  fault**. Both must BOOK a slot; the live 5-hour window is already claimed so
  `claude_booking_guard` refuses — the "SCENARIO needs live geometry that RAN
  OUT" trap (`.claude/rules/mistakes.md` class 7). ⛔ Do NOT relax the scenario;
  make the proof CREATE the geometry. The COUNT is guarded, PASSING is not.

---

### WHAT PROD IS DOING RIGHT NOW

- **Claude usage measurement is ON** since 2026-08-25 17:18 UTC, sampling every
  15 min. ⚠️ This block once said OFF, with a procedure to re-enable something
  already enabled — **ask the DATABASE, never this file, for runtime state**:
  `select monitoring_enabled, monitoring_changed_at from public.claude_settings`.
- `monitoring_note` still holds the old pause reason — not shown while
  measurement is on, used correctly by the monitor-on notice. Leave it.
  `claude_bookings` is deployed and granted but still EMPTY.
- ⚠️ **Ask the DATABASE for runtime state, never this file.** `db-query.mjs` takes a FILE.

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

✅ Shipped, do not rebuild: the passport guard (proof #27) · the docs site and
its restructure (02 above). ⛔ **No polling timer for the docs** — one was
built, verified and REMOVED the same day; reasoning in the archive named in 02.

0. ✅ **ORG MOVE DONE** (2026-08-31); `node tools/repo-protection.mjs` — 18 pass
   (was 27; the sibling-repo loops are inert BY DESIGN since the passport repo
   was archived, and the script now says so — corrected 2026-09-06).
   Traps: `skills/move-the-repo-to-an-organisation.md`. Org 2FA OFF by OWNER
   DECISION. Last box (a non-owner team add) is `HANDOFF` §3; the `*.pages.dev`
   rules moved to `docs/INVARIANTS.md`, their one home.

1. ✅ **A ฝ่าย NOW EDITS ITS OWN PAGE — no commit, no deploy (0177/0178/0179).**
   เมนู "หน้าฝ่าย" in /admin/. **Four kinds since 0179: หัวข้อ · การ์ด · ข้อความ ·
   HTML**, a new row is a DRAFT, and covers UPLOAD from your machine (the file
   they replace is retired).
   ✅ **AND the ฝ่าย tools lane** — `public/embed/starter/` → a `tool/*` PR →
   `/tools/<slug>`. Both are LIVE; do not rebuild either.
   ⛔ **THE ISOLATION OF BOTH IS ONE MISSING WORD** (`allow-same-origin`), and
   the three changes that delete it are now a rule in `docs/INVARIANTS.md` —
   with the owner-facing fake-sign-in risk. Read it before touching the frame.
   🧪 **A VISUAL EDITOR SPIKE IS LIVE AND AWAITS THE OWNER'S VERDICT** —
   "แก้แบบเห็นภาพ" on an html row (GrapesJS 0.23.6, admin-only, lazy, its own
   1.15 MB chunk, zero refs from the public entry). ⛔ **Build NOTHING more on
   it until the owner answers**; if the feel is wrong, delete
   `dept-visual-editor.js` + the dep and nothing else knows it existed.
   ⚠️ An earlier note the SAME DAY said a canvas was REJECTED — superseded, and
   `docs/state/phuriphatma.md` says so at both ends. Why GrapesJS and not
   Puck/Craft.js (React-only), plus the block-set work next: same file.
   ❌ **What is left is NOT code: §13 step 8, teach two people**, and step 5 on
   a REAL phone. Detail: `docs/state/phuriphatma.md` + `docs/DEPT-TOOLS.md`.
2. ⚠️ **THE DEPLOY DOCS STEP — INTERMITTENT, and this entry used to say the
   opposite.** It read "NOT REPRODUCING, treat deploy.sh as working" while the
   block above it counted four failures; an intermittent fault is never
   disproven by successes. ✅ The diagnostic it asked for is now PERMANENT:
   `set -x` inside the script, writing `~/samo-deploy-logs/<stamp>.trace` on the
   VM. **Read the log before forming any theory — every theory so far was
   formed without one.** Status, tally and how to read a log live in ONE place,
   the CURRENT DEPLOY block above; do not restate them here.
3. ✅ **PASSPORT REPO MERGE — COMPLETE.** Passport is `passport/`; one pull, one
   `npm ci`, one build. Old repo ARCHIVED. ⛔ **Never delete OR replace the
   `samomdkkupassport` Cloudflare project** — `docs/INVARIANTS.md` is its home.
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
2. **`docs/INVARIANTS.md`** — the rules. Longer, and it changes slowly.
3. **`docs/state/phuriphatma.md` — its FIRST `## ▶ HANDOFF` block**, whichever
   date that is. It names what is owed, what is waiting on the owner, and what
   was deliberately NOT verified. Everything below it is history, including
   older handoff blocks.
   ⚠️ **Do not name a date here.** This step named "HANDOFF 2026-09-01" and a
   newer block was inserted above it the same day, so the first thing a new
   session was told to read was the superseded one.
4. Only then, the archive file for whatever you are about to touch.

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
