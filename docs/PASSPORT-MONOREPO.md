# Passport → samoweb: the REPO merge

> **Read this before touching anything in `passport/` or `server/deploy.sh`.**
> The database merge finished long ago (`docs/PASSPORT-MERGE.md`). This is the
> separate, later job of merging the two **repositories**.
>
> **Status: MERGED to `main` on 2026-09-04.** Passport is the `passport/`
> directory of this repo and ships with it. **Phases 1–6 done; only the two
> OWNER-ONLY items remain (7 and 8), and neither is urgent.** S1 — sign in on
> `/`, click through to `/passport/`, still signed in — was verified by the
> owner before the merge.
>
> **This file is now history plus two open items.** Its reasoning stays useful —
> §3 on the QR posters especially, which governs a decision that has NOT been
> made yet. Do not treat the finished phases as work to redo.

## ⛔ IF YOU ARE HERE TO DO SOMETHING

**Only two things are left, both yours to authorise, neither blocking:**

1. **Phase 7 — archive `samomdkkupassport`.** Do it once production has run on
   the merged build for a while. ⚠️ **Until then that repo still accepts
   pushes**, and anything landing there is NOT in this repo. Its history up to
   `895c7fa` is inside `passport/` here; if something has landed since, bring it
   over with
   `git subtree pull --prefix=passport passport-origin main` BEFORE archiving.
2. **Phase 8 — the QR redirect host. ✅ DECIDED 2026-09-04: LEAVE IT ALONE.**
   ⛔ **Never delete it**, and — reversing the earlier recommendation in §3 —
   **do not replace it with a redirect-only project either.**

   Why the advice changed rather than "was wrong": the redirect-only swap was
   proposed while re-printing was still on the table, i.e. while this host was
   TEMPORARY. The owner then declined re-printing, which makes it permanent and
   removes the fallback — there is no way to recover a broken poster. A change
   whose upside is "one hop instead of two" is not worth that.

   Measured before deciding: the retired host serves
   `location.replace('https://samo.md.kku.ac.th/passport' + pathname + search +
   hash)` — it preserves `aid`/`tk` and goes straight to the VM. **It works.**
   The remaining upside was server-side 301 vs a JS redirect, plus fixing gen-1,
   which has ZERO posters. Small upside, unrecoverable downside.

   ⚠️ One thing left genuinely unresolved, recorded as unknown rather than
   settled: I could not determine which Supabase project that 2026-08-09 build
   has baked in. Six chunks were searched and no URL was found, which is
   INCONCLUSIVE, not proof it reaches nothing. `npm run cf:pin-dev` repointed the
   project's variables, but variables only apply to the NEXT build and no build
   has run since. If that ever matters, the way to settle it is to open the host
   in a browser and watch the network tab, not to grep chunks.

**Anything else you want to know, ask the repo rather than this file:**

```bash
npm run deploy:owed   # what production serves — the ONLY authority
npm test              # expect 1753 pass, 96 files
```

⛔ **No shas are written here on purpose.** An earlier version of this section
named three and two were stale within an hour, because the file kept being
committed after they were typed. A document that makes its reader doubt whether
they have the right state is worse than one that stays quiet. The two shas that
DO appear below are frozen historical anchors, not state.

## Progress

**Merged to `main` 2026-09-04. Phases 1–6 done; 7 and 8 are owner-only.**

- [x] Phase 0 — facts frozen (§2); passport builds on Vite 6, output identical
- [x] Phase 1 — subtree'd into `passport/`; **164 commits added**, old passport
      shas (`9777a67`, `895c7fa`) resolve on this branch
- [x] Phase 2 — one toolchain: passport's `package.json`/lockfile deleted, it
      builds against the root deps; `npm run build` = main → `dist/`, then
      passport → `dist/passport/` at base `/passport/`. Verified: main app
      survives the second pass, all four passport entries emitted, asset URLs
      prefixed, no cross-leakage
- [x] Phase 3 — `_redirects` passport rules and the splash deleted; real files
      now serve `/passport/`
- [x] Phase 4 — tests. **1753 pass, +37 from this merge.** `host-guard` now
      covers all SIX entries under ONE predicate; new `passport-build`,
      `session-sharing`, `qr-compat`, `season-rollover`; `redirects-order`
      rewritten to assert the build emits passport rather than that a rule
      exists. **Every new guard was reintroduced-as-a-bug, watched fail on the
      intended assertion, and restored.** `env-example`'s anchoring check was
      relaxed from a hardcoded host list to the anchor itself — it went red on a
      correct change, which is a guard pinned to today's shape
- [x] Phase 5 — `deploy.sh` builds from in-tree: one pull, one `npm ci`, one
      build; `--exclude=passport/` on the samo-web publish; nginx untouched
- [x] Phase 6 — merged to `main` and deployed. S1 verified by the owner before
      the merge; the served artifact re-checked after it.
- [x] Phase 7 — old repo **ARCHIVED** 2026-09-04, after verifying its `main` was
      identical to what the subtree holds, so nothing was stranded. Archiving is
      read-only and reversible, and it cannot affect QR codes — the Cloudflare
      project serves its last BUILD, not the repo.
- [x] Phase 8 — **decided: leave the QR redirect host exactly as it is.** Not
      deleted, and not replaced either. Reasoning at the top of this file.

---

## 1. Why — the reasons, so they are not re-litigated

The owner asked for **one address** where you browse samoweb, click into
Passport, and are still signed in.

**That requirement alone forces the merge-or-equivalent**, and the reason is not
taste:

> A Supabase session lives in `localStorage`, which is **per origin**. Both apps
> use project `fheueuowbchsnsvbcgil`, and neither main client sets a custom
> `storageKey` (`src/js/db.js`; passport `js/app.js` — its *legacy-admin* client
> deliberately does set one, `sb-passport-legacy-admin`, and that is correct and
> unrelated). Same origin ⇒ both read `sb-fheueuowbchsnsvbcgil-auth-token` ⇒ the
> session is shared with no code. **Different origins ⇒ two logins, always.**

Production already has one origin — nginx joins the apps (`location /` →
`samo-web`, `location /passport/` → `passport`). Cloudflare Pages has no nginx:
**one project serves one build output**. So two Pages projects can never satisfy
the requirement, no matter which account they live in or how the dashboard is
configured. Reconnecting the old project and creating a project in another
account were both considered and are **ruled out on this ground**, not on style.

Three further reasons, none of which is about the URL:

- **The split silently costs correctness.** samoweb narrowed its
  deprecated-host guard on 2026-08-27. Passport carried the identical guard and
  did not get the fix for **eight days** — found only because it would have
  broken this very preview work (`docs/mistakes/deploy-hosting.md`). Nothing was
  ever going to catch it: a test in one repo cannot see the other.
- **Passport has no safety net.** No tests, no CI, no CODEOWNERS. samoweb has
  1,715 tests plus guard tooling. The merge hands Passport all of it.
- **Passport's Pages git connection is already dead.** Its stored config still
  names the owner's **personal account** as the repo owner, not the org — the
  value it held before the transfer. (Written out rather than pasted, because
  `repo-identity.test.js` rightly refuses any stale `owner/repo` string in
  prose: someone would eventually copy it.) Measured 2026-09-04:
  a real commit was pushed, the mirror workflow ran, and Cloudflare built
  **nothing** in 400 s — last build 2026-08-09. Keeping two projects means
  fixing that first, by hand, in a dashboard with no API.

⛔ **What this does NOT change.** `docs/PASSPORT-MERGE.md`'s "two repos stay
separate" bullet is superseded **only** for the repositories. Its database
decisions stand: one Supabase project, passport data isolated in the `passport`
schema, `idwlabpbwiwgaoqwbozz` frozen and never written.

---

## 2. Measurements this plan rests on

Re-run these before starting; if one disagrees, the plan is stale, not the
database.

| Fact | Value | How it was measured |
|---|---|---|
| Passport size | 92 files, 162 commits | `find`, `git rev-list --count` |
| Passport builds on **Vite 6** | yes, **identical** entry + HTML set vs Vite 5 | built both, diffed normalised filenames |
| `@supabase/supabase-js` | passport `^2.105.4`, samoweb `^2.106.1` — same major | both `package.json` |
| `playwright-core` in passport | **declared, never imported** — drop it | `grep -rn playwright` |
| Passport docs to fold | `CLAUDE.md` 160, `MISTAKES.md` 482, `STATE.md` 172 lines | `wc -l` |
| Activities carrying pages.dev QR URLs | **31 of 38 (82%)** | §3 |

---

## 3. ⛔ QR BACKWARD COMPATIBILITY — READ BEFORE DELETING ANY CLOUDFLARE PROJECT

**This section corrects advice given earlier in the same session it was written.**
"Delete the retired `samomdkkupassport` Pages project" was recommended as
closing an open cleanup item. **It would break most QR posters in existence.**

### Why a printed QR is frozen

`js/admin-page.js:1017` builds the poster URL from **the admin's own origin**:

```js
currentQrUrl = `${window.location.origin}${ROUTES.SCAN}?aid=…&tk=…`;
```

`ROUTES.SCAN` is `import.meta.env.BASE_URL + 'html/scan.html'`. So the host is
whatever the admin was browsing **at the moment the poster was made**, and paper
cannot be re-pointed.

### The three generations, each measured live on 2026-09-04

| Gen | Made when | URL in the QR | What happens today |
|---|---|---|---|
| 1 | before 2026-05-16 (`html/` move) | `pages.dev/scan.html` | 200 → serves **index.html** → splash → needs a CLICK → `/passport/scan.html` → **passport HOME, no scan**. Silently awards nothing. |
| 2 | 2026-05-16 → VM move | `pages.dev/html/scan.html` | 308 → `/html/scan` → real scan page → its guard forwards to the VM **preserving `aid`/`tk`**. **Works — but only because Cloudflare still serves that host.** |
| 3 | VM era → now | `samo.md.kku.ac.th/passport/html/scan.html` | Works natively. No Cloudflare involved. |

Verified by `curl`, checking the `<title>` rather than the status code —
**every one of these paths returns 200**, and three of them return 200 of the
*wrong page*. A status code cannot tell these apart.

### How exposed we actually are

```
activities_total 38 | gen1 0 | gen2 31 | gen3 7   (earliest 2026-06-17)
gen2: 961 scans all-time, 94 in the last 30 days, most recent 2026-08-31
gen3:  86 scans all-time, 86 in the last 30 days, most recent 2026-09-03
```

- **Gen 1 is zero.** The silent-failure path above is real but has no posters.
  Do not spend effort on it beyond the redirect below, which fixes it for free.
- **Gen 2 is 31 of 38 activities (82%) and is ACTIVELY USED** — 94 scans in the
  last 30 days, the most recent four days before this was written.

⚠️ **Honest limit of that number.** The database records a scan, not the host it
arrived through; a gen-2 activity can also be scanned from a regenerated poster
or a direct link. **94 is an upper bound on pages.dev-dependent scans, not a
count.** What it does prove is that those activities are live, not historical.

### The recommendation: SUPPORT, and make it cheaper than it is now

Do **not** retire gen 2, and do **not** keep the current arrangement either.
Replace the whole-app Pages project with a **redirect-only** project on the same
hostname — `_redirects` and nothing else:

```
/html/scan       https://samo.md.kku.ac.th/passport/html/scan  301
/html/scan.html  https://samo.md.kku.ac.th/passport/html/scan  301
/scan.html       https://samo.md.kku.ac.th/passport/html/scan  301
/*               https://samo.md.kku.ac.th/passport/:splat     301
```

Cloudflare preserves the query string on a `_redirects` rule, so `aid`/`tk`
survive. This is strictly better than today:

- **Server-side 301** instead of load-app-then-JS-redirect: faster, works with
  JS disabled, one hop instead of two.
- **Fixes gen 1**, which currently fails silently.
- **Removes the entire passport app from a retired public host** — and with it
  the standing problem that `<hash>.samomdkkupassport.pages.dev` serves old
  bundles with a stale database baked in.
- Frozen by nature: nothing to build, nothing to drift, nothing to guard.

**The cost of supporting, stated plainly:** you keep one Cloudflare project
alive for as long as the posters exist. That is the whole disadvantage. It is a
permanent dependency on a hostname you no longer develop.

**The cost of retiring:** 82% of QR posters stop awarding points, with no error
a student can act on — they scan, a page loads, nothing happens. You cannot
recall printed paper.

### Are NEW posters still affected? No — and it becomes impossible after Phase 8

New posters are generated from the admin's current address, and admins work on
the VM, so they are gen 3 and involve Cloudflare not at all. The retired host
also bounces an admin away before they could generate one there, and after
Phase 8 the app will not exist on that host to open. **The gen-2 population is
closed and can only shrink.**

⚠️ **Correction to the 82% figure above, stated so nobody over-trusts it.** The
poster URL is fixed when the **poster is generated**, not when the activity is
created, and *the URL is stored nowhere* — it exists only on paper. So
classifying by `created_at` is an INFERENCE, not a measurement. It is the best
available proxy and it is directionally right, but an old activity whose poster
was re-downloaded from the VM is already gen 3 and is counted as gen 2 here.

### ⚠️ A SEASON CHANGE RETIRES NOTHING — asked by the owner, checked in the live function

**A QR code never expires.** Read from the live `passport.stamp_scan` body (not
the migration): it checks signed-in, kkumail, account-not-moved, activity
exists, and `static_token = p_token`. It then resolves whichever season is
**currently open** and stamps the scan with it. **It never asks whether the
activity belongs to that season.** `activities` has no end date and no closed
flag; `token_expires_at` belongs to the removed dynamic-token flow and
`stamp_scan` does not read it.

Two consequences:

1. **Waiting for Q3 does not solve the old-poster problem.** The retired host
   stays needed until posters are physically replaced or deliberately cut off.
   Do not plan around the season boundary fixing anything.
2. **A leftover poster from a finished event will award km into the NEW season.**
   `UNIQUE (user_id, activity_id)` means once per person per activity, so no
   farming — but someone who never attended a Q2 event can scan a poster still
   on a wall (or a photo of one) during Q3 and collect km that count toward the
   new season's leaderboard. **This is a fairness question for the owner, not a
   bug to quietly close** — and it exists today, independently of this merge.

**The mechanism to retire a QR already exists and is one statement**: set that
activity's `static_token` to null (or rotate it). `stamp_scan` then raises
`INVALID_TOKEN`. It invalidates every poster for that activity, old and new,
which is exactly what "retire" means. Worth considering as a season-rollover
step for finished events. ⛔ Do not do this to the seven activities in the list
below without asking — some are still in use.

### The shrink path — re-printing is SAFE, and much smaller than it looks

`generateStaticQR()` does `let staticToken = act?.static_token; if (!staticToken)
{ …mint and save… }` — **an existing token is reused, never rotated**. So
re-printing a poster produces the same `aid`/`tk` with a new host: the old
poster keeps working and the new one stops depending on Cloudflare. There is no
cutover moment and no window where either is dead.

That makes retirement a small job rather than a wait. Of 31 gen-2 activities,
**only 7 were scanned in the last 30 days**, and ONE of them is 84 of the 94
scans:

```
84 scans/30d  เปิดโลกกิจกรรม 2569          ← 89% of all gen-2 traffic
 3            Music on ward
 2            พิธีไหว้ครู
 2            HRD's MDKKU Landmark (July 2/2026)
 1            โครงการรับน้องบ้านเขียว 2569
 1            อาสาสมัครถ่ายทอดสดรายการพิเศษ
 1            MDKKU Community
```

**Re-print one poster and 89% of the exposure is gone; re-print seven and it is
effectively all of it** — for any of those still physically displayed. The rest
are past events whose posters are down.

**When it may be deleted — ✅ OWNER DECIDED 2026-09-04: NOT by re-printing.**
The owner declined the re-print path: the posters are already up and printed, and
swapping them is real-world work for a problem nobody is experiencing. So the
gen-2 population does not shrink deliberately — **it decays only as those events
end and their posters come down naturally.**

That makes the redirect host effectively **permanent**, and that is an accepted
cost, not an oversight. It is four lines of `_redirects` with nothing to build,
nothing to drift and nothing to guard, so the price of keeping it is close to
zero — much lower than the price of getting the deletion wrong.

⛔ **Do not re-propose re-printing.** It was offered, considered and declined
with a reason. If you want to check whether the host has become unnecessary on
its own, re-run the §2 query and look at `scans_30d` for gen-2 activities; when
that has been 0 for a term, the host has no job left. Until then, leave it.
Until then keep it — it costs four lines of `_redirects`.

---

## 4. Phases

### Phase 1 — bring the source in, with its history

```bash
git remote add passport-origin https://github.com/samomdkku/samomdkkupassport.git
git fetch passport-origin main
git subtree add --prefix=passport passport-origin main
```

`subtree`, **not** submodule — a submodule keeps two repos and therefore keeps
every problem in §1. All 162 commits are preserved and `git log -- passport/`
works.

Passport's own `CLAUDE.md`, `STATE.md`, `MISTAKES.md`, `AGENTS.md`, `.claude/`
land under `passport/` and collide with nothing. **Do not delete them in this
phase** — folding them into `docs/mistakes/` is Phase 4's job, and deleting 814
lines of write-ups to "tidy" the merge is exactly the data loss this plan exists
to prevent.

### Phase 2 — one toolchain, two builds, one output

- Delete `passport/package.json` + `passport/package-lock.json`; passport builds
  against the root `node_modules` (proved: Vite 6, identical output).
- Drop `playwright-core` (unused).
- Root `package.json`:
  ```
  "build":          "vite build && npm run build:passport",
  "build:passport": "vite build --config passport/vite.config.js",
  "deploy:gas:passport": "node passport/tools/deploy-gas.mjs"
  ```
- `passport/vite.config.js`: set `base` to `/passport/` and `outDir` to
  `../dist/passport`, with `emptyOutDir: false` so it cannot wipe the main build.

⚠️ `passport/vite.config.js` uses `__dirname` and a local plugin
(`vite-plugin-html-includes.js`). Both keep working from the subdirectory, but
check the four entries still resolve — that is what the Phase 4 build test is
for.

⚠️ **Two Apps Script projects stay two.** Different script ids; keep
`GAS_SCRIPT_ID` (samoweb) and passport's own separate in `.env.local`.

⚠️ **Passport's `db/*.sql` stays at `passport/db/`.** Its `0001–0010` collide
numerically with `supabase/migrations/0001–0179`, they are already applied, and
renumbering would corrupt `migrate:status` tracking for no gain.

### Phase 3 — the preview serves `/passport/`

In `public/_redirects`, delete the two `/passport…` rules and the comment
explaining why Passport is absent — the premise is gone. Delete
`public/passport-elsewhere.html`.

Order matters and already does in that file: `/admin/*` before `/*`. Add nothing
for `/passport/*`; real files now exist there and Pages serves a real file ahead
of the SPA catch-all.

### Phase 4 — tests (see §5)

### Phase 5 — `deploy.sh` builds from in-tree

Delete `PASS_DIR` and its `git pull` + `npm ci` + build block (lines ~154-162);
build passport from `passport/` and `publish dist/passport /var/www/passport`.
**Nginx is untouched** — same roots, same locations, production layout
unchanged.

Side benefit, measured this session: the two slow deploys were *entirely*
`npm ci`, and this removes one of the two outright, plus a `git pull` and a
second clone.

### Phase 6 — production

Deploy only after Phase 3's preview has been driven by hand (§5, scenario S1).
Verify from the SERVED artifact per `skills/deploy-vm.md`, then update
`STATE.md`'s DEPLOYED line.

### Phase 7 & 8 — owner only, both destructive, neither blocks the merge

7. **Archive `samomdkku/samomdkkupassport`** (read-only) so drift cannot resume.
   Do this only after production has run off the merged repo for a while.
   ⚠️ Archiving does **not** affect the Pages project or any QR code.
8. **The QR redirect host — §3.** Replace the app with the redirect-only
   project. ⛔ **Never simply delete it.**

---

## 5. Test plan

Guard tests go in the samoweb suite (`npm test`), which passport has never had.

**Reintroduce-the-bug ritual applies to every guard here**: break it, watch it
fail on the assertion you expect, restore. A guard written from the same list as
the code passes itself.

### Extend `src/js/host-guard.test.js` — 2 entries becomes 6

`ENTRIES` currently holds `index.html`, `admin/index.html`. Add passport's four
built entries: `passport/index.html`, `passport/html/{dashboard,admin,scan}.html`.

Assert per entry, against the **executable** `.test(location.hostname)` line,
never the file text — `passport/index.html`'s comment *quotes* the old broken
regex, so a substring check matches the comment and calls a correct file broken.
Table (all seven already pass against the fixed source):

| hostname | must bounce |
|---|---|
| `samomdkkupassport.pages.dev` | yes |
| `SAMOMDKKUPASSPORT.PAGES.DEV` | yes (case) |
| `preview.samomdkkupassport.pages.dev` | **no** |
| `<hash>.samomdkkupassport.pages.dev` | **no** |
| `evilsamomdkkupassport.pages.dev` | **no** (prefix attack) |
| `samo.md.kku.ac.th` | no |
| `localhost` | no |

Plus a **control**: the sweep found a guard in every entry, so a renamed file
goes red instead of passing by finding nothing.

Once these run locally, **delete the cross-repo GitHub-API check** added to
`tools/repo-protection.mjs` on 2026-09-04 — after the merge its subject is an
archived repo, and a guard whose subject has rotted is worse than none
(`house0116`, `proj0092`).

### New `src/js/passport-build.test.js`

- All four entries emitted under `dist/passport/`, plus `moved.html` and
  `qr-poster-template.png`.
- Every asset URL in `dist/passport/index.html` starts `/passport/` — catches a
  base regression that would 404 every asset.
- `dist/index.html` and `dist/admin/index.html` still exist and are unchanged in
  shape — the passport build must not wipe the main one (`emptyOutDir`).
- `dist/passport-elsewhere.html` does **not** exist.

### New `src/js/session-sharing.test.js` — the requirement itself

- Neither main client sets `storageKey` (assert on source): same origin + same
  project ref ⇒ one shared session. **This is the property the whole merge is
  for, and nothing else asserts it.**
- Passport's legacy-admin client **does** set `sb-passport-legacy-admin` —
  assert it still does, so a future tidy-up cannot silently make the admin door
  clobber a student's Google session.

### New `src/js/qr-compat.test.js`

- `ROUTES.SCAN` still resolves to `html/scan.html` — the path burned into 31
  activities' posters. If a refactor moves it, **every printed poster dies**;
  this test is the tripwire.
- `scan.html`'s guard redirects to the VM **and preserves `location.search`** —
  losing `aid`/`tk` is a silent no-points failure.
- `scan.html` forwards **straight to the VM**, never to `/moved.html` — a scan is
  transactional, and an interstitial with a countdown breaks it.

### New `src/js/season-rollover.test.js` — ⚠️ OWED, the fix shipped UNGUARDED

`startNewYear` / `startNewSeason` in `passport/js/admin-page.js` were reordered
on 2026-09-04 to **create the new วาระ/season before ending the old one**
(previously they ended first, leaving a four-round-trip window with nothing open
— see `docs/INVARIANTS.md`). Passport has no test runner, so that fix went in
verified only by inspection and a throwaway script. **This is the standing test
it still owes**, and it is cheap once passport is in-tree:

- In each function, the first `.insert(` must appear **before** the
  `ended_at: now` update. That is the property; assert the order, not a spelling.
- Each closing update must carry `.neq('id', …)` excluding the row just created
  — without it the function **ends the season it just made**, which is worse
  than the bug being fixed.
- The failure paths must not end anything: an insert error returns before any
  `ended_at` write.

⛔ Do not "simplify" these two functions back into end-then-create. It reads
tidier and it is the bug.

### `_redirects` test

No `/passport` rule remains; `/admin/*` still precedes `/*`.

### Manual scenarios — must be driven by hand, not asserted

- **S1 (the acceptance test).** On the branch preview: sign in on the main site
  → click Passport → **still signed in**, no second login. This is the deliverable.
- **S2.** `preview…/passport/html/scan?aid=<real>&tk=<real>` reaches the scan
  page (use a disposable activity; do **not** scan a live one on dev).
- **S3.** Production, after Phase 6: a real gen-2 QR still awards a point.
- **S4.** `/passport` with no trailing slash still redirects (nginx rule).

### Edge cases to check explicitly

- Deep link straight into `/passport/html/dashboard` while signed out.
- Signed in on Passport first, then navigating to the main site (reverse of S1).
- Sign **out** on one app signs out **both**. ✅ **DECIDED by the owner
  2026-09-04: this is wanted, not a side effect to design around.** Test that it
  actually happens — one shared token means it should — and do NOT "fix" it
  later by giving either app its own `storageKey`, which would also delete
  single sign-on (see Traps).
- The legacy `admin/1234` door still gets its own session and does not clobber a
  signed-in Google user.

---

## 6. Data-loss analysis

| Asset | Risk | Mitigation |
|---|---|---|
| Passport git history (162 commits) | lost if copied instead of subtree'd | `git subtree add` |
| Passport docs (814 lines) | deleted as "duplicates" | keep under `passport/`; fold deliberately |
| Student km points / scans | **none — no database change at all** | this is a frontend/repo merge only |
| Printed QR posters (31 activities) | **broken by deleting the Pages project** | §3 — never delete, replace with redirects |
| Applied migration tracking | corrupted by renumbering `passport/db` | leave the numbering alone |
| The old repo | — | untouched until Phase 7, and archived not deleted |

**Rollback**: until Phase 7, the old repo and Pages project are untouched, so
rollback is `git revert` of the merge commit plus a redeploy. After Phase 5,
`deploy.sh` is the only production-affecting change; keep the previous version
one commit away.

---

## 7. Traps — things that look like improvements

- ⛔ **Submodule instead of subtree.** Keeps two repos; re-creates §1 entirely.
- ⛔ **Renumbering `passport/db/*.sql`** into `supabase/migrations/`.
- ⛔ **Deleting the passport Pages project** — §3, 82% of posters.
- ⛔ **Relaxing any host guard back to `/\.pages\.dev$/`** — that is the bug this
  session fixed; it makes the preview bounce itself to production.
- ⛔ **Giving passport's main client its own `storageKey`** "for isolation" —
  that deletes single sign-on, the entire point of the merge.
- ⛔ **`emptyOutDir: true` on the passport build** — wipes the main app's `dist/`.

## Two Pages projects would mean two logins — a preview trick that does not exist

⛔ **Any plan built on "one Cloudflare Pages project for the portal and another
for the passport, so a preview gets both" is dead.** A Supabase session is
per-ORIGIN, so two Pages projects are two separate logins no matter what the
dashboard offers. Moved here from `STATE.md` on 2026-09-10; the steps it
invalidates are in `docs/state/phuriphatma.md`, which is one person's notes and
is never rewritten by others — so this correction lives here instead.
