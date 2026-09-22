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
- ✅ **DEPLOYED = `332d09c` (2026-09-22)** — v4.7.0 still, read back from the VM's
  own HEAD, not retyped. `<== exit 0 — ran to the end` + `DEPLOY_EXIT=0`. Includes the gallery review fixes (`a720728`: strip CSS on /admin/, lightbox, 0204's client half) — SERVED: the admin stylesheet carries `.shop-img-strip`; production storefront drive (gallery + lightbox, no console errors); the published SHOP-GALLERY/HANDOFF/CONTEXT pages carry this pass's text. The day's work and how each was checked: `docs/state/claude-2026-09-22.md`. Previous: `95a31e0` (`docs/state/claude-2026-09-21.md`).
- ✅ **`main` being AHEAD of the deployed sha is the NORMAL state** — tests and
  session notes reach nothing. ⚠️ **`docs/` DOES ship now** (the VM serves
  `/docs`), so "it is only docs" stopped being a reason to skip a deploy on
  2026-08-31. Do not judge by eye and do not retype the sha: **`npm run
  deploy:owed`** reads the ✅ DEPLOYED line above — the sha's only home — and
  compares it with the WORKING TREE. ⛔ **Never paste a `git diff <sha>..HEAD`
  snippet back in**: the sha had four homes here and one got corrected.

- ⚠️ **Verify from the SERVED artifact**, and grep the RIGHT one — both traps
  live once, in `docs/INVARIANTS.md` and `docs/mistakes/deploy-hosting.md`.
- **Apps Script = prform v12** (2026-09-10), `/exec` unchanged — the two
  read-only Drive handlers §13a needs. ⛔ Calling them hard degrades the endpoint
  real uploads SHARE; measured in `docs/state/HANDOFF.md` §13a.
- **Migrations through 0204. 47 of 51 LIVE PROOFS GREEN on production (2026-09-22) — the 4 red are house/team/dept proof-subject drift: `docs/state/HANDOFF.md` §16b.** 0202 shop sweep: stock shown = stock sold, colour/slip/qty checked, a buyer's own-order edits limited to what the slip flows write (`shop0202-stock-rule` 22/22). 0203 product gallery — several pictures, cover derived by trigger; 0204 a pre-gallery tab cannot drop or duplicate a picture (`shop0203-gallery` 20/20). 0199 shop per-size pricing (`shop0199-pricing` 20/20); 0200 the three copies of a person stay in sync + admin mismatch panel (`house0200-three-copies` 13/13, `house0194` back to 20/20), both dev AND production — what each one changed and which hole it closed is `docs/state-archive/2026-09-19-state-prune.md`; the proofs themselves are the authority. ⛔ Ask `npm run migrate:status`, never this line.
  ⚠️ A proof can be GREEN WHILE BROKEN because the environment happened to be
  quiet — both Claude quota proofs were, until they CONSTRUCTED the absence
  they assume (`docs/mistakes/tooling-proofs.md`; counts live in the proofs).

---

### WHAT PROD IS DOING RIGHT NOW

⛔ **ASK THE DATABASE FOR RUNTIME STATE, NEVER THIS FILE.** This block once said
Claude measurement was OFF and gave a procedure to re-enable what was already
enabled. `select monitoring_enabled, … from public.claude_settings`
(`db-query.mjs` takes a FILE). Same for `claude_bookings`, which is not empty,
and `monitoring_note`, which holds an old pause reason on purpose — leave it.

---

### CONTRIBUTOR CREDENTIALS — rebuilt 2026-09-06

`npm run dev` now uses **samo-dev, not production**, and says so on every start.
`.env.local.example` is the contract; adding a variable is ONE edit there.
⚠️ **samo-dev: ASK `npm run migrate:status -- --dev`, NEVER this file.** It had
drifted four migrations while a line here said it was in step. `deploy:owed`
asks PRODUCTION before it answers. Archive: `docs/state-archive/2026-09-19-state-prune.md`.

### What is owed

✅ **ระบบบ้าน ROSTER IMPORTED (2026-09-14)** via `tools/house-import.mjs` (dry-run first; loop in `skills/import-the-house-roster.md`). ⚠️ **`advisors` is EMPTY** — its two rows were TEST data pointing at REAL สาย, so 12 students briefly saw a fake อาจารย์; no release note may promise อาจารย์ until real ones exist. Counts move: ask the database, not this line.
✅ **ทีม SAMO ↔ ระบบบ้าน IN SYNC** (2026-09-14) — 0 diffs on every column, 0 duplicate people, 0 mis-pointed placements; 9 humans held TWO registry rows (merged), `people` 1705 → 1696. Re-check/repair after any import: `node tools/house-sync-registry.mjs`. ⛔ **25 ทีม SAMO members have NO kkumail anywhere** — all hold real ตำแหน่ง, none matchable to a student; only a human can fill those.
✅ **ข้อมูลไม่ครบ tab** (/admin/ ระบบบ้าน) — everything missing/mismatched/odd, grouped by who can fix it; badge counts ONLY admin work. One definition, shared with `npm run house:gaps`: `src/js/house/gaps.js`. **+ ผังตามสาย view, built 2026-09-16** (list/grid toggle in the same tab) — per-รุ่น สาย grid, spec `docs/HOUSE-YEAR-HANDOVER.md` §(d), `src/js/house/sai-grid.js` reuses `gaps.js`/`census.js`. Tests+build green; ⚠️ unseen in a real browser (no DB creds tonight).
⛔ **สาย 141/256 NOT SETTLED** — สาย is a contiguous 1..N counter in four of six
รุ่น; MD53+MD54 both skip 141 and repeat 256, 115 positions each, รหัส running
straight through the gap — the new tab states it as arithmetic: สาย 141 is missing from THREE รุ่น while one held row can account for one. If it is a drag-fill slip **230 students' บ้าน is wrong**. ฝ่ายข้อมูล have not answered. Fix = ONE corrected re-import: no student
can self-edit a สาย (`sai_self_edit_open` VESTIGIAL since 0125) and บ้าน is
generated from it. ⚠️ Houses 1–9 have no `name` — the UI shows `บ้าน N` to 1,611 people.

✅ **SAMO SHOP (2026-09-21, all live):** kita's redesign (look DECIDED by the shop team) · identity = "samo shop" wordmark INSIDE the pane, never the navbar · per-size prices, and the DATABASE now sets every price (0199 — `place_shop_order` had trusted the browser) · Discord message per web order, built from the DB (`DISCORD_SHOP_WEBHOOK`, VM only) · pickup-card picture (0201) · core chunk renamed `core-*` (an `analytics-*` name let a tracking blocker kill the portal). **Registry (0200): main card / ทีม SAMO / ระบบบ้าน auto-sync on connect; mismatches listed + fixable in ระบบบ้าน → ข้อมูลไม่ครบ.** Why + how each was checked: `docs/state/claude-2026-09-21.md`. Open items (webhook rotation, Stay hypothesis, never-seen Discord message): `HANDOFF.md` §18. **2026-09-22 full shop bug sweep** (≈40 findings, all fixed but the ones in §18b): checkout double-order lock + unsure-network check + cart checked BEFORE the QR, safeUrl safe bare, admin stale-state fixes, CSV safe; write-ups in `docs/mistakes/` (frontend-ui, app-state, authz-rls, postgres-schema, tooling-proofs).

⛔ **START HERE: `docs/state/HANDOFF.md` is the full list of what is NOT done, with reasons and owners. Read it first; below is detail.**

### A. NEXT SESSION — buildable now, nobody is blocking you

✅ Shipped, do not rebuild: the passport guard (proof #27) · the docs site (02) ·
the ORG MOVE (2026-08-31, traps in `skills/move-the-repo-to-an-organisation.md`,
`HANDOFF` §3). ⛔ **No polling timer for the docs** — built and REMOVED same day.

1. ✅ **A ฝ่าย EDITS ITS OWN PAGE — no commit, no deploy (0177/0178/0179).**
   เมนู "หน้าฝ่าย" in /admin/; four kinds (หัวข้อ · การ์ด · ข้อความ · HTML), a new
   row is a DRAFT, upload included. ✅ **AND the ฝ่าย tools lane** —
   `public/embed/starter/` → `tool/*` PR → `/tools/<slug>`. Both LIVE.
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
   disproven by successes; this entry once claimed the opposite. Read the VM's
   `~/samo-deploy-logs` trace before theorising. Status: CURRENT DEPLOY, above.
3. ✅ **PASSPORT REPO MERGE — COMPLETE**, old repo ARCHIVED. ⛔ Never delete the `samomdkkupassport` Cloudflare project — `docs/INVARIANTS.md`.
4. ✅ **DISCORD ROLE SYNC — LIVE AND AUTOMATIC (2026-09-19).** Discord follows
   ทีม SAMO by itself: the `samo-discord-sync` service (VM) applies a web change
   in ~5–10 s, re-checks everything every 15 min (reverting hand edits in
   Discord), and posts who changed what to `🤖┆samo-role-assignment-bot`.
   ⛔ **Change the WEB, not Discord.** How it works, the owner's rules, what is
   owed and the traps: **`HANDOFF` §14b** (the day's history is archived in
   `docs/state-archive/2026-09-19-discord-sync.md`). Owner still owes: kick the
   old bot, narrow the new bot's Administrator (HANDOFF §1).

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
  CHECKOUT. `docs/NEXT.md` §1. The auth blocker is solved; §4b of that skill has
  the recipe and both traps.
- **ทีม SAMO restructure — read `docs/INVARIANTS.md` before reparenting a ฝ่าย.**
- `docs/NEXT.md` carries the rest. Genuinely un-started: §0c (two latent
  role-only policies, deliberately not swept), §0a (ทีม SAMO admin model, PARKED
  by the owner), §0b2 + §1 (the browser pass). ⚠️ Its §0
  (`photo_reference_count()` cannot see `houses.icon_url`) is **already FIXED**
  — read from `pg_get_functiondef`, 2026-09-01. 0178 added the ฝ่าย covers too.

---

## ระบบบ้าน — EVERY held row now has a รุ่น (2026-09-19)

✅ **The 13 held rows with no รุ่น are fixed.** They carry no รหัสนักศึกษา (`#N/A`
in the file), so `cohortFromStudentId()` — how everyone else gets theirs,
65→MD50, 66→MD51 — had nothing to read; 0188 had already given
`student_import_unresolved` a `cohort_year` for exactly this and the importer
never filled it. `tools/house-unplaced-cohort.mjs` reads it back out of the
handover file's block headings, refusing any row whose สาย in the file disagrees
with the database. **There is no `_unplaced` population any more.**

⚠️ **That CHANGED a number already reported.** `_สายมีปัญหา` dropped to **5**:
most "nobody is on this สาย" rows were these people, uncounted because the audit
groups by รุ่น and they had none. Any older note saying 18 is stale. What remains
is real — สาย 256 held twice in MD53 and twice in MD54, สาย 141 empty in both,
and **nothing unplaced can explain 141 any more**.
✅ **MD50 ANSWERED AND IS DONE (2026-09-19)** — promoted via
`tools/house-kkumail-import.mjs`; five รุ่น still owed, `HANDOFF.md` §16.

## ✅ THE HANDOFF IS A COMMAND NOW (2026-09-19)

`npm run handoff:check` — step 6 of CLAUDE.md's loop and the only one that can
FAIL. Uncommitted work · unpushed HEAD · an unindexed memory · a memory naming a
dead file or command · a HANDOFF section with no `Status:` · this file over
budget · prod behind the sha this file claims · the VM's agent memory out of
sync · **a count in a document the database contradicts**. A check it could not
RUN is a skip, and a skip is NOT green. It cannot tell whether a sentence is
true. Detail: `HANDOFF.md` §9.

⚠️ **`npm test` is NOT the test CI runs** — the suite reads gitignored files, and
that asymmetry went red in both directions. `npm run test:clean` runs it over
exactly what git will carry. Both live in `HANDOFF.md` §9.

## ⛔ THE NIGHT AGENT IS OFF (2026-09-18)

Stopped, timer disabled, nothing scheduled. Daily was BY DESIGN; the waste was
that its task file is never consumed, so the same 6 tasks re-ran nightly. Its
work is MERGED, not stranded. **Write a new queue before re-enabling** —
`HANDOFF.md` §17, its one home.

## ✅ VAULTWARDEN — LIVE at `/vault/` (2026-09-06)

Ops `skills/vaultwarden.md` · architecture `docs/CONTEXT.md` · what it owes HANDOFF §7 (incl. restore, NEVER run). ⛔ **`SIGNUPS_DOMAINS_WHITELIST` must stay UNSET** — a non-empty value overrides `SIGNUPS_ALLOWED=false` and opened registration to every KKU kkumail for ~6 h (`docs/mistakes/authz-grants.md`).

## NEXT SESSION — start here

1. **This file**, top to bottom. Read all of it.
2. **`docs/state/HANDOFF.md`** — the ONLY list of what is not done, each
   section carrying a `Status:` saying how far to trust it.
3. **`docs/INVARIANTS.md`** — the rules. Longer, and it changes slowly.
4. **The newest `docs/state/claude-*.md` and `docs/state/phuriphatma.md` — each one's FIRST `## ▶ HANDOFF` block**, whichever
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

**⚠️ A DOCS-ONLY DEPLOY IS OWED (2026-09-22, end of session).** The last commit
before this STATE edit changed only wording in published docs (SHOP-GALLERY,
HANDOFF, CONTEXT, the session notes). It is pushed but NOT deployed: the
laptop moved to a network without a route to the VM (ssh and the public URL
both timed out; the VPN is needed). The served docs lag that wording by three
small edits; code, database and Apps Script are all current. Run
`skills/deploy-vm.md` on the VPN, then update the ✅ DEPLOYED line. Check, do
not trust this line — and note that it names no sha, on purpose. Retyping one into a `git diff` is the bug that opened
2026-08-28, and `state-handoff.test.js` now forbids the shape:
```bash
npm run deploy:owed
```
