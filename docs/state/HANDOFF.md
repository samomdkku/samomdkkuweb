# Everything still owed — the cross-session handoff

Written 2026-09-04, restructured 2026-09-05. **This is the one place that lists
what is NOT done.** `STATE.md` says what is true right now; this says what is
left, why, and who can do it. When an item is finished, delete it from here.

⛔ **Nothing below is blocking anything else.** The codebase is in a clean,
shipped, verified state. These are choices and errands, not loose ends.

---

## 0. How to read this file

⚠️ **RENUMBERED 2026-09-06.** This file had two sections numbered 7 and two
numbered 8, and "Where to look for anything else" sat in the middle. It is now
**0–10 in order**, with that table at the end. A section number quoted in an
older note or memory may be stale.

📌 **The most recent session's REASONING is in `docs/state/phuriphatma.md`**
(2026-09-06, contributor credentials). This file holds only what is NOT done.


**Every section carries a `Status:` line, and it changes what you should DO.**
`handoff-guard` in `src/js/state-handoff.test.js` fails the build if one is
missing, so you can trust that the marker is present — not that it is right.

| Status | What it means | What you do |
|---|---|---|
| **VERIFIED** *date — how* | somebody ran something, and the line says what | trust it; re-run the named check if you are about to depend on it |
| **HYPOTHESIS** | a theory nobody has tested | ⚠️ **test it before acting on it.** It may be wrong |
| **DECIDED** *date* | the owner chose this | do not re-litigate; do not re-raise |
| **OWED** | work not started | pick it up |

⛔ **Why this exists.** §10 of the previous version of this file explained away
nine failing security checks as "a probe artefact — the API bypasses RLS". It
was stated as fact, was never tested, and was **wrong**: impersonation works
fine, and the real cause was that the probe's "student" was an admin. It sat
here for weeks steering every reader away from a five-minute measurement.

The lesson is not "write more carefully". It is that **an explanation and a
finding looked identical on the page**, so the reader had no way to tell which
one they were holding. If a claim has no `— how`, it is a HYPOTHESIS. Label it
and the next person will test it instead of believing it.

⛔ **The deployed sha does NOT belong in this file.** Its one home is the
✅ DEPLOYED line in `STATE.md`; `npm run deploy:owed` reads it. A second copy
here is the exact multi-home failure that put a two-deploys-stale sha in front
of readers with a diffstat attached. The guard fails the build on one.

---

## 1. Discord bot token — owner declined, do not re-raise

**Status: DECIDED 2026-09-05** — owner was told and chose not to rotate.

**Reset the Discord bot token** — app `1492541609445949465`, *"Role assignment
bot for SAMO69"*, Administrator, pasted into a chat transcript on 2026-08-28.

⛔ **The owner was told and chose not to rotate it (2026-09-05).** That is a
recorded decision, not an oversight. Do not raise it again. Nothing in this repo
uses the token, so nothing here depends on the choice.

---

## 2. Tell the ฝ่าย before Q3 starts

**Status: DECIDED 2026-09-05** — owner is aware and will tell the ฝ่าย; still Q2.

Two things become true the moment somebody presses **Start new Season**, and
both will otherwise arrive as surprises:

- **Every Q2 QR stops scanning.** That is the rule the ฝ่าย asked for
  (*"ถ้าเกิน quater ก็คือสแกนไม่ได้ๆๆ"*), shipped as migration 0180. Concretely
  **เปิดโลกกิจกรรม 2569 had 84 scans in the last 30 days and will stop.**
- **An activity must be created IN the quarter it should count toward.** An
  event spanning the rollover loses its QR.

⛔ Do not "fix" either by falling back to the current season — that restores the
original bug wearing a helpful face. `docs/INVARIANTS.md` says so.

**Owner / ฝ่าย. A conversation, not a task.** ✅ **Owner is aware (2026-09-05)
and will tell the ฝ่าย themselves; it is still Q2, so nothing is urgent.** Do not
re-raise — but do NOT weaken the rule to soften the surprise.

---

## 3. Owner-only errands, none urgent

**Status: OWED** — four small items, none urgent, all owner-only.

| | What |
|---|---|
| Dev Apps Script | under its own Google account + a `DEV` Drive folder — last piece of dev-system phase 2 |
| GitHub project board | phase 0's last piece; the `gh` here lacks the `project` scope |
| One non-owner team add | last box of the org-move checklist: somebody who is not the owner adds a person to a team, once |
| Confirm the dev-channel test | delivery is proved (16×204); a human must confirm the 12 ฝ่าย messages landed in `#developer-server-notify` and none in a real `#vs-*` |

---

## 4. People, not software

**Status: OWED** — nobody has been walked through the ฝ่าย tool flow yet.

- **Teach two ฝ่าย members the tool flow** (`docs/DEPT-TOOLS.md` §13 step 8).
  The design is built and shipped; nobody has been walked through it.
- **Test a ฝ่าย page on a real phone** (step 5). Emulated widths are not a phone.
- **A visual-editor spike awaits a verdict** — "แก้แบบเห็นภาพ" on an html row
  (GrapesJS, admin-only, lazy). ⛔ Build nothing more on it until the owner
  answers; if the feel is wrong, delete `dept-visual-editor.js` and the
  dependency and nothing else knows it existed.

---

## 5. Two screenshots only you can take

**Status: OWED** — optional polish; needs the owner's GitHub session.

The contribute guide is fully photographed **except** where a capture would need
your GitHub session in a way I could not reach from a headless browser. Both
signed-in shots now exist (banner, checks box), so this is optional polish:
a capture of the **Files changed** tab and of **Squash and merge** would finish
the set.

---

## 6. Known-unknown, recorded so it is not rediscovered

**Status: HYPOTHESIS** — six chunks searched, no URL found. That is INCONCLUSIVE, not proof of absence. ⚠️ Settle it with a browser network tab before acting.

**Which Supabase project the frozen `samomdkkupassport` Cloudflare build reaches.**
Six chunks were searched and no URL found — that is *inconclusive*, not proof of
absence. `cf:pin-dev` repointed the variables but they apply to the next build,
and none has run. Settle it with a browser network tab, not grep.

⛔ **Never delete that Cloudflare project** — 82% of printed QR posters name it.
Do not replace it with redirects either; that was considered, measured and
rejected (`docs/PASSPORT-MONOREPO.md` §3).

---

## 7. Vaultwarden — LIVE, and what it still owes (2026-09-06)

**Status: VERIFIED — how:** curl from the public internet against
`samo.md.kku.ac.th`: `/vault/` and `/vault/alive` 200 and the served content is
Vaultwarden (not the SPA fallback); admin login POST 200; admin test-email POST
200 with zero SMTP errors in `docker logs`; `backup.sh` run by hand exits OK with
`1 user(s)` then `2`; a full well-formed registration POST refused 400 while
`/vault/alive` still answers 200 as the allow-control; `sqlite3` on the live DB
shows both accounts `status 2` with a 346-byte org key. Operations, install
and every trap: **`skills/vaultwarden.md`** — read that before touching it.

**Who is in it:** `phuriphat.ma@kkumail.com` and `mdstuddata.beta@gmail.com`,
both **Owners** of org `samomdkku`, both confirmed. The role account is the
succession anchor: a personal kkumail dies at graduation, the role account is
handed over (`docs/SUCCESSION.md`).

**OWED, owner-only:**

1. **The sealed break-glass envelope.** Print the studbeta Gmail password, its
   2FA backup codes, and the vault admin password
   (`sudo cat /root/vaultwarden-admin-password.txt`), seal it, give it to the
   อาจารย์ที่ปรึกษา. ⚠️ **The vault holds the credentials to the VM it runs
   on** — if the box is down, what you need to fix it is inside the thing that
   is down. This envelope is the only way out of that, and nobody but the owner
   can make it.
2. **Delete the `newtest` org** left over from experimenting.
3. **Rotate the Gmail app password** — 8 of its 16 characters were exposed in a
   session transcript on 2026-09-05. Mail works; this is hygiene, not breakage.
4. **Decide who actually needs the vault.** 50 people was floated. Most SAMO
   members need a handful of shared logins, not a vault holding `SUPABASE_DB_URL`
   and the VM sudo password. Start with ฝ่าย leads; every extra holder is another
   laptop, another phone, another graduation.
5. **Create the three collections and the `samo-dev env` item.** ⛔ Its ONE home
   is **§8 below** — do not restate the steps here. It is the single thing
   blocking `npm run env:pull`, and it changes item 4 above: `Dev` holds two
   values the built website already publishes, so handing out a vault account is
   a much smaller decision than it was when this list was written.

**NOT DONE, and nobody is blocked on it — the survival work:**

- **Discord alert when the backup fails.** *This is the important one.*
  Everything else about this system fails loudly; backups fail silently, and the
  only witness today is a systemd unit nobody reads. The VM's notify service
  already has `DISCORD_CLAUDE_WEBHOOK` configured, so the plumbing exists.
  ⚠️ It needs its OWN action (`notifyVaultAlert`) — reusing `notifyClaudeAlert`
  would send an embed whose fixed วิธีแก้ says "run `claude login`", which is the
  two-authors-of-one-instruction bug in `.claude/rules/mistakes.md` class 7.
- **Monthly container image pull.** The tag is pinned on purpose, so updates are
  deliberate — but nothing currently reminds anyone.
- **A vault section in `docs/SUCCESSION.md`'s yearly handover list.** The
  decision to record: hand over the ROLE, not the master password. Two Owners at
  all times, the role account's master password rotated at each handover and
  living only in the envelope. Also worth enabling **Emergency Access**, which
  Vaultwarden gives free and which is the real answer to "the holder vanished".
- **A Thai member-facing page in `docs/`.** The ⚙-gear self-hosted-URL step is
  the one everybody misses; without it the app talks to bitwarden.com and it
  looks like their password is wrong.

**Status: UNVERIFIED, do not claim either way:**

- **Websocket `Upgrade` through KKU's edge.** The probe returns 401, which
  proves the request reaches Vaultwarden's hub but NOT that the upgrade
  completes. Needs a signed-in client. Polling fallback works; do not sink a day
  into it.
- **Restore.** `backup.sh` verifies its own output (integrity_check on the copy,
  a non-empty user count, a full archive walk) and `pull-backup.sh` now pulls a
  real archive off the box — but **a restore has never been run**. A backup you
  have never restored is a hypothesis.
- **The browser extension and phone app.** Only the web vault has been exercised.
  Set up the extension yourself before inviting anyone, so a subpath problem
  surfaces to you and not to nine ฝ่าย members at once.

---

## 8. Contributor credentials — rebuilt 2026-09-06; ONE owner-only step left

**Status: VERIFIED 2026-09-06 — how:** built a contributor's `.env.local` from
`.env.local.example` and asked Vite's own loader what it exposed (`{}` before,
the samo-dev URL after); started the dev server and read the served `db.js`
(`xibugtlsphcfuvstnxxh`, not production); ran `npm run build` and confirmed
`dist/` still carries production ONLY and the dev ref appears nowhere; piped
nine realistic paste shapes through `npm run setup` end to end, including a
maintainer's file that must not lose its production keys. Both bugs were
reintroduced and each failed on its own assertion before restoring.

`docs/mistakes/tooling-proofs.md` has the full write-up. What is left:

1. **Re-send the two lines to anyone already onboarded.** Nobody has been
   walked through this yet (§4), so the likely answer is nobody — but if you
   sent anyone the four-value block, they hold `SUPABASE_DEV_DB_URL`, which
   reads every real student record. Ask them to delete it; rotate if unsure.
2. **Handing out a vault account is now a smaller decision** than §7 item 4
   assumed: `Dev` holds two values the built website already publishes, not
   four. Worth re-reading that item with this in mind.

⚠️ **NOT verified:** whether `npm run dev` and `npm run setup` behave the same
on Windows. Every measurement above was on macOS. The paste path is plain stdin
so it should, but nobody has run it there.

**The ongoing-change story is now closed without any new infrastructure**
(2026-09-06): `.env.local.example` is the single contract, so adding a variable
is one edit and every tool derives from it. A rotated key is one line sent and
one `npm run setup`, not a re-onboarding.

✅ **`npm run env:pull` IS BUILT (2026-09-06) — and my earlier note here was
WRONG.** I wrote that the Bitwarden CLI "expects a bare HTTPS root" and could
not work with our `/vault/` subpath. That came from a search result, not a test.
Measured against the LIVE vault:

```
bw config server https://samo.md.kku.ac.th/vault   → Saved setting `config`.
bw login <nonexistent user>                        → "Username or password is
                                                      incorrect" — it REACHED
                                                      the identity endpoint
bw status  → {"serverUrl":"https://samo.md.kku.ac.th/vault", ...}
```

The vault publishes the same shape itself at `/vault/api/config`
(`"api":".../vault/api"`, `"identity":".../vault/identity"`), which is exactly
`<base>/api` and `<base>/identity`. No special configuration needed. `bw` is run
via `npx` at a pinned version, so nobody downloads 17 MB who does not use it.

⚠️ **Verified up to authentication ONLY.** An authenticated `bw get item` has
never run, because of the owner-only steps below. ✅ **The failure path HAS now
been run** (2026-09-06): with no account it exits 1 and names the step, and
running it is what found that it was writing to the user's GLOBAL Bitwarden
config — now pinned to a gitignored `.bw/` inside the project
(`docs/mistakes/tooling-proofs.md`). **It does not touch a personal `bw` setup.**

✅ **THE WHOLE PATH IS VERIFIED END TO END (2026-09-07).** The owner ran it on a
clean clone with no `.env.local`: sign-in, `bw get item`, two values written, and
`npm run env:check` answering *"the development database answered"*. This section
is no longer a hypothesis — `npm run env:pull` works, and the last unknown named
below is closed. Steps 1–3 of the owner-only list are done. **Still unmeasured:
Windows, and an account with two-step login enabled.**

⚡ **It was also slow, and that was ours.** `npx` re-resolves the package on
every call (2.7 s against 1.5 s for the same binary direct, measured) and the
tool made six calls. It now notes the resolved path in `.bw/` and skips
`bw config server` when the server is already right: 5.3 s → 1.75 s on the
start-to-prompt segment, A/B'd against the previous commit.

✅ **THE INTERACTIVE SIGN-IN WAS BROKEN AND IS FIXED (2026-09-07).** The first
real run of the path never got as far as a password: the tool piped `bw`'s
stderr, which is the stream `bw` prompts on, so it printed "Signing in." and
then blocked for ever on an invisible `? Email address:`. Fixed with a
`stdioFor()` that inherits stderr for `login`/`unlock` only, guarded both ways in
`src/js/env-pull.test.js`, written up in `docs/mistakes/tooling-proofs.md`. A
sign-in that cannot ask now fails at the step that failed instead of four steps
later. (That was written when an authenticated `bw get item` had never run. It
has — see the ✅ block above; this paragraph is kept for the BUG, not its
status.)

**⛔ ONLY THE OWNER CAN DO THESE. Steps 1 and 2 are DONE (2026-09-07);
step 3 is the one still outstanding — nothing is shared with anybody yet:**

1. Create the collections. **Three, decided 2026-09-06 — `Infra` · `Dev` ·
   `Team`**, split by what a leak COSTS rather than by topic. The full table and
   the reasoning (including why NOT to call the first one `IT`, why `Comms` and
   `Handover` were dropped, and why not one per ฝ่าย) is in
   `skills/vaultwarden.md`, its one home. This step creates `Dev`.
2. Create an item in it called **`samo-dev env`** whose **Notes** field holds the
   output of `npm run env:share -- --copy` — that flag puts it straight on the
   clipboard and prints nothing, so the values never cross a screen.
3. Share `Dev` with each contributor's account as a plain **User**.

✅ **Steps 1–2 were done by the owner on 2026-09-07.** ⚠️ With `Dev` created
**nested under a collection named `IT`** — so the collection's real name is
`IT/Dev`. Two things follow, neither of which the tooling cares about
(`bw get item` matches the ITEM name, so the fetch works either way):

- **Bitwarden nesting is a NAME containing `/`, not a hierarchy.** Access is not
  inherited in either direction, so step 3 must share **`IT/Dev`** itself.
  Sharing the `IT` parent grants nothing and produces "could not read
  samo-dev env" from a clean login.
- **`IT` is the name this layout was explicitly designed to avoid** — `ฝ่าย IT`
  is a real SAMO department that turns over yearly, so the name invites a future
  maintainer to share it with them (`skills/vaultwarden.md`, "Do NOT name the
  first one `IT`"). Renaming costs one edit while nothing is shared yet, and a
  re-share with every contributor afterwards. Owner's call; raised 2026-09-07.

⛔ **Nobody can do steps 1–2 for the owner, and it is not a permissions
problem.** Vaultwarden encrypts item contents in the browser before they reach
the server, so the server holds only ciphertext; the `/vault/admin` password on
the VM manages accounts and organisations and **cannot read or create an item**.
It needs somebody signed in with a master password. Do not go looking for a
back door — there is not one, by design.

After that, contributors run `npm run env:pull` and the owner is out of the loop
permanently — no laptop, no per-person send, and a rotated key is one edit to
that item from the phone app. `tools/vault-config.mjs` holds the address and the
item name; changing the item name means changing it there.

---

## 8a. Letting the team run SQL on samo-dev — DECIDE, not yet done (2026-09-07)

**Status: VERIFIED 2026-09-07** — how: `GET /v1/projects` and
`/v1/organizations/<slug>/members` on the Management API with each PAT in turn,
and the dev DB URL parsed for its role. ⚠️ The table below is measured; the
recommendation under it is a PROPOSAL nobody has decided yet.

The owner wants contributors able to run and test SQL against samo-dev (not
production). Measured before recommending anything:

| | Result |
|---|---|
| `SUPABASE_DEV_ACCESS_TOKEN` → `/v1/projects` | **`samo-dev` only** (1 project) |
| `SUPABASE_ACCESS_TOKEN` → `/v1/projects` | `samomdkkuweb` + `samomembermanager`, **not** samo-dev — the control that proves the two accounts are separate |
| dev org `vrsptgvvbrijcvgpxgsr` (`samomdkkuaiorg`) members | **1** — Owner `samomdkkuai` |
| `SUPABASE_DEV_DB_URL` connects as | **`postgres`** — the superuser |

So the account split is real and the blast radius of dev credentials is dev.
**Neither existing value may be handed out**: the PAT can delete the project,
and the DB URL is a superuser that bypasses every RLS policy.

**Recommended, in order:**

1. **Supabase dashboard members** — invite each person to the *dev org* as
   `Developer`; they use the SQL Editor signed in as themselves. That org holds
   only samo-dev, so org-level access is already dev-only. No new secret exists,
   nothing goes in the vault, and removing someone is one click instead of a
   rotation. ⚠️ **Unverified: the free plan's member limit** — the Management
   API does not report it; check the dashboard before promising seats. This is
   the same wall that pushed the password manager off Bitwarden's free org.
2. **A least-privilege Postgres role** (`dev_sql`: `NOSUPERUSER NOCREATEDB
   NOCREATEROLE`) — only if people need `psql` or the repo's own tooling rather
   than the browser. Its URL becomes a second item in the vault's `Dev`. ⚠️ A
   plain role is SUBJECT to RLS with `auth.uid()` null, so most tables read
   empty and the console feels broken; `BYPASSRLS` is what makes it usable, and
   that is the trade to make deliberately — it exposes the same unmasked data
   the project already accepts on samo-dev, while still not being able to drop
   the project.
3. **Never** `SUPABASE_DEV_ACCESS_TOKEN` or the `postgres` URL.

✅ **PART OF THIS IS NOW BUILT (2026-09-07): CI replays every migration onto an
empty database on any PR touching `supabase/migrations/`** —
`.github/workflows/migrations.yml`. It needs **no credential**, so it runs on
pull requests from a public repo, and it answers the question nobody had ever
asked. Measured 2026-09-07: all 180 migrations then in the repo applied to an
empty Postgres 17 in ~9 s, producing 65 tables against the real samo-dev's 66
— the difference being
`_timeline_backup_0166`, created by the one migration that refuses on an empty
database. **So the schema CAN be rebuilt from this repo alone**, which is also
the recovery answer. It does not prove behaviour (`auth.uid()` is null there);
that stays `npm run proofs -- --dev`. Two instrument bugs found on the way are
in `docs/mistakes/tooling-proofs.md`.

This changes the contributor question: someone can now be told their migration
is broken without holding any credential at all.

**Offered, not built, no answer yet (2026-09-07):** (a) a CI check reporting
*"N migrations are merged but not applied to dev"*; (b) turning the migration
notice into a **comment on the pull request**. Today it writes to
`$GITHUB_STEP_SUMMARY`, which renders on the workflow RUN's summary page — one
click from the Checks tab, and invisible to anyone who only reads the
conversation. A comment needs `pull-requests: write` and does not work from
fork PRs, so it is a real choice rather than a strict upgrade. Item (a): samo-dev drifted 3 behind
production without anyone noticing, and one of the three was 0176 — so anyone
testing on dev was seeing a bug production had already fixed. Read-only and
needs no credential, same as the replay. The production side of this is already
covered: `npm run deploy:owed` asks before it gives a verdict.

**Related trap:** `tools/db-query.mjs` runs on PRODUCTION and ignores `--dev`
(§9 below). Harmless for a contributor, who has no production credentials — but
if SQL becomes a normal team activity, that tool should require an explicit
target rather than defaulting to the live database.

---

## 9. Tooling that WILL bite you — learned the hard way on 2026-09-04

**Status: VERIFIED 2026-09-04** — how: every item cost real time in-session and is reproduced from that run.

None of this is in the tools' own help text. Each cost real time.

### `tools/db-query.mjs` runs on PRODUCTION and ignores `--dev`

There is no guard. To send a read to samo-dev you must override the URL, and
**read the `→ project:` line it prints** — that line is the only thing standing
between you and a proof you think ran on dev:

```bash
VITE_SUPABASE_URL="$SUPABASE_DEV_URL" SUPABASE_ACCESS_TOKEN="$SUPABASE_DEV_ACCESS_TOKEN" \
  node tools/db-query.mjs tools/whatever.sql
```

`tools/apply-migration.mjs` **does** honour `--dev`. The two differ; do not
assume.

### A SQL proof must emit ROWS whose verdict starts with `PASS`

Three separate ways one correct proof failed in a row:

1. **`RAISE NOTICE` returns nothing** through the Management API — you get `[]`.
   Every case runs and none can be read. Insert into a temp table and `select`.
2. **`format()` uses `%s`; `RAISE` uses `%`.** Mixing them errors at runtime.
3. **`run-proofs.mjs` counts a case as passing only if the verdict STARTS WITH
   `PASS`.** Emitting `'ok'` reports six green cases as "6 failed".

And **adding the file is not adding the proof** — `PROOFS` in `run-proofs.mjs`
is a list. It now errors on an unlisted `tools/*.sql`, but only because that gap
was found; check your proof's name appears in the run output.

### Enum fields that reject silently-plausible values

- `changelog.js` — `type` is **`new` | `improved` | `fixed`** (not `changed`),
  `audience` is **`public` | `staff`** (not `all`). I typed invalid values
  **twice in one day** by guessing instead of reading. `changelog.test.js`
  catches both; read the constants first.

### Budgets that trip on almost every edit

- **`STATE.md` must be under 260 lines** and the test counts one more than
  `wc -l` does. Expect to trim your own addition two or three times. **Never
  raise the limit** — move durable facts to `docs/INVARIANTS.md`.
- **`CLAUDE.md` is at 100% of its 12,000-byte budget.** Any addition needs an
  equal deletion. Thai is 3 bytes/char, so trimming English frees less than it
  looks.

### One unexplained test failure, 2026-09-06 — evidence destroyed by re-running

`npm test` reported **1 failed / 1832 passed** once, on a run that also took
17 s against a 7 s baseline. I then ran the suite AGAIN to see which test it
was — so the failing output was gone, and the new run passed. Eight consecutive
clean runs since; the identity of the failing test is unknown.

⚠️ **If this recurs, capture the output BEFORE re-running** (`npm test > /tmp/t
2>&1`). Re-running to investigate a flake destroys the only evidence there was,
which is the same shape as the deploy pipeline that discarded its failing step's
output for six runs (`docs/mistakes/deploy-hosting.md`).

### `head -N` on a grep is not a search

Twice I reported a string "missing" from a fresh build because the file sorted
below my `head -2`. Both times the alarm was my instrument. If a result looks
alarming, re-run it **without** the truncation before believing it.

### The Chrome extension is usually available — try it

`skills/drive-the-browser.md` says it is "usually not connected". On 2026-09-04
it was connected and I did not try for hours, capturing logged-out GitHub with
headless Chrome instead. `list_connected_browsers` costs one call. Use it before
concluding you cannot reach a signed-in page.

---

## 10. How this owner works — worth knowing on day one

**Status: VERIFIED 2026-09-05** — how: observed across this and prior sessions; each bullet cites the moment it came from.

- **When they ask "why not do it", they are usually right.** "Because the build
  does it that way" was not a reason the dev server could not; pushing back
  produced the one-address dev server. Treat the question as a real one.
- **They ask short questions that find real bugs.** "isn't production
  samo.md.kku.ac.th" exposed half the Cloudflare build spend going to a retired
  host. "i thought you have connection to this" got the signed-in screenshots.
  Do not answer these defensively — check.
- **They want plain language.** They have asked twice for less jargon. Say the
  consequence, not the mechanism.
- **They delegate decisions but want a recommendation**, not a survey. "you can
  decide" means decide, and say why.
- **Ship it.** Commit, push and deploy are the normal flow, not events to ask
  about. Batch commits, then deploy once.
- **Verify, then say so.** Claims land better with the command that proved them.
  This repo has been burned by confident prose more than by bad code.

---

---

## 12. ✅ CLOSED 2026-09-09 — the three signed PDFs are re-attached

**Status: VERIFIED 2026-09-09 — how: `node tools/proj0181-repair-orphans.mjs --apply` wrote rows 391/392/393; a follow-up query shows each request with signed=1 dated 2026-09-03 and one `signed_file` doc-timeline entry; re-running the tool prints "No accepted sign request is missing its signed file". Kept because the REASONING is the reusable part, not because anything is owed.**

Three หนังสือโครงการ were approved 2026-09-03 with no signed file: the
professor's upload reached Google Drive and the database row was refused (0181).
The PDFs sat in Drive, shared, referenced by nothing.

**The first plan was wrong and the owner rejected it, rightly.** It was "ask
อ.ประกาศิต to upload them again". That bills our defect to the person who had
already done the work correctly, creates a SECOND Drive file while orphaning the
first, and stamps the history with today's date — losing the fact that he signed
on 3 September. **When our bug destroys a record, we repair the record.** Asking
the user to redo it is only acceptable when the artefact is genuinely gone; here
it never was.

**What was done**: `tools/proj0181-repair-orphans.mjs --apply`, which re-attaches
the EXISTING Drive file, dated the approval instant, attributed to the อาจารย์
the request named, with a timeline entry on both the request and the document
saying plainly that this was a system repair and why. Rows 391/392/393.

**Two judgements worth keeping.**
· *The timestamp.* Drive's own creation time is not exposed by any handler this
  project has, so the repair uses the APPROVAL time and the note SAYS that is
  what it is. Inventing a plausible upload time would have put a false statement
  in an audit trail that nobody would ever have questioned.
· *The evidence.* The owner supplied three Drive links; they were not taken on
  trust. Each was read back through GAS and had to pass five checks — is a PDF,
  not already attached, not the original itself, LARGER than the original, and
  the same filename. All three are bigger than their originals and carry a
  different PDF producer version (1.6 vs 1.3/1.5), which is what signing and
  re-exporting produces and a stray copy would not. The returned filenames also
  independently confirmed which orphan belonged to which หนังสือ, so the mapping
  never rested on the order they were pasted in.

**Re-running the tool is a no-op** (it matches on `drive_file_id`), and it now
reports "No accepted sign request is missing its signed file."

⚠️ **The gap that let this hide for six days is still open**: nothing in this
system can ask *"what is in Drive that we have no row for?"*. A read-only
`listProjectFolderFiles` GAS handler was written for the repair and then
REVERTED, because it needs a production Apps Script redeploy (an ask-first
operation) and the owner's links made it unnecessary. If orphan detection is
ever wanted, §13 below carries the design. ⛔ It is NOT in git — it was reverted
before it was ever committed, so `git log -S listProjectFolderFiles` finds
nothing. An earlier draft of this section said "see this commit's parent", which
was simply false.

## 13. Owner asked for three things on 2026-09-09 — none of them started

**Status: OWED — asked for explicitly at the end of the 0181 session, after the
repair had shipped. Nothing here is begun; all three are greenfield.**

### 13a. ✅ BUILT AND DEPLOYED 2026-09-10 — orphan detection exists

**Status: VERIFIED 2026-09-10** — how: two read-only handlers deployed to the
prod Apps Script project as **version 12** (`npm run deploy:gas`, `/exec`
unchanged), each probed live in both directions — a real `drive_file_id`
returns `resolves:true` with metadata, a bogus id returns
`resolves:false, "not found"`, and the enumeration gate refuses without
`knownFileId`. `tools/proj0183-drive-orphans.mjs` then ran against production
over all 123 Drive-backed rows in 63 หนังสือ.

**What exists now**

* `statProjectFiles` — database→Drive. Metadata for ids we already hold,
  including **`trashed`**, which is the state most likely to be real and which a
  folder listing cannot see (Drive omits trashed files from `getFiles()`, and a
  trashed file still serves publicly). Safe on an unauthenticated endpoint
  because it is strictly LESS disclosure than `getProjectFileData`, which
  already returns the BYTES of any `Projects/` file to anyone with its id.
* `listProjectFolderFiles` — Drive→database, with `createdAt`, so a future
  repair can date an orphan when the work really happened instead of falling
  back to the approval time as the 2026-09-09 repair had to.
* `tools/proj0183-drive-orphans.mjs` — both directions, **writes nothing, ever**
  (no `--apply`): which of two files is the real signature is not a script's
  judgement. Controls: zero rows or zero folders examined is a FAILURE, not
  "0 orphans"; `folderFound:false` for a folder we hold rows for is a FINDING;
  and unlistable folders are counted separately, so "no orphans" and "the
  listing failed" cannot render the same.
* `src/js/projects/drive-listing-readonly.test.js` — 26 assertions keeping the
  reader read-only and the gate in place. All three failure modes were
  reintroduced and watched to fail before being restored.

⛔ **THE ENUMERATION GATE IS SECURITY, NOT ERGONOMICS — do not remove it.**
`listProjectFolderFiles` requires a `knownFileId` that is really in that folder.
That `/exec` URL is public, unauthenticated and shipped in the browser bundle,
and this repo is public; a bare listing would turn a guessed
`Projects/<PRJ-…>/<DOC-…>` path into every file id inside it, and
`getProjectFileData` turns an id into a signed หนังสือ carrying student names
and a professor's signature. Anyone who can already name a file in the folder
could already read it, so the gate costs nothing real. **Its one cost:** the
sweep cannot examine a folder we hold ZERO rows for. That is not the 0181 shape,
where the folder held the unsigned original all along.

⚠️ **Sized by measurement, not guess** (all in the tool's header): 20 ids →
17.4 s, 100 ids → 83 s and Google's HTML error page, so `STAT_BATCH = 20`. The
1-id reading of 28.3 s is a COLD START and briefly convinced me batch size did
not matter — the opposite of the truth. And each call site now carries its own
timeout: one shared 120 s ceiling made a single stuck folder listing cost 8.5
minutes across four retries, which is how a sweep becomes a tool nobody runs.

**The original design note is kept below, because its reasoning is what the
implementation was checked against.**

⏳ **OWED: the first FULL run has not completed.** The handlers are deployed and
each was probed live in BOTH directions (a real `drive_file_id` →
`resolves:true` with metadata; a bogus id → `resolves:false, "not found"`; the
gate refuses without `knownFileId`), and the sweep's own database side is
verified — 123 rows across 63 หนังสือ, and its first run stat'd all 123 in 7
batches. But **no run has yet printed the verdict**, because by then I had
degraded the shared `/exec` endpoint (see the table below) and stopping was the
right call — a student's upload matters more than my report finishing today.

**How to finish it**, when nobody is submitting:

```bash
node tools/proj0183-drive-orphans.mjs --rows-only     # cheap: 7 paced calls
node tools/proj0183-drive-orphans.mjs                 # both, ~63 more calls
```

⚠️ **Do not read a killed run as a clean result.** The tool exits non-zero on any
finding AND on any control failure, so only a printed verdict counts — and if
`0 of 63 folders` could be listed it FAILS rather than reporting "no orphans".

⚠️ **RUNNING IT HARD DEGRADES THE ENDPOINT REAL UPLOADS USE — measured, and it
is the most important operational fact about this tool.** Same probe throughout
(`uploadTeamFile` with no argument, so a fast validation error):

| condition | Google's HTML page instead of JSON |
|---|---|
| sweep running flat out | **2 of 3** |
| sweep stopped, 10 s apart | 1 of 4 |
| sweep stopped, 3 s apart | **1 of 5** (i.e. 4/5 healthy) |

A browser `User-Agent` + `Origin` made **no** difference (4/5 either way), so it
tracks **request RATE, not client identity**, and it recovered as soon as the
sweep stopped. Normal use — a student making one upload — is unaffected. The tool
now paces itself (`PACE_MS`), backs off HARD on an HTML reply rather than
retrying promptly, reports how many it got, and takes `--rows-only` /
`--folders-only`. **Run it when nobody is submitting, and prefer `--rows-only`.**

📌 **A SMALL FIX THIS EXPOSED, NOT DONE, NOT MINE TO DECIDE.** `src/js/uploads.js`
does `await res.json()` with no retry and no content-type check, so if a real
upload draws that HTML page the student gets a JSON parse error on work they just
did — the same class of loss as 0181, from the other end. One retry on a
non-JSON reply would cover it. Offered, not built.

### 13a-original. The design as written on 2026-09-09

**This is the gap that let 0181 hide for six days, and it is still open.** The
signed PDFs existed in Drive the whole time; no screen, query or job in this
system could notice. The OWNER found them by opening Drive by hand.

The design, written and tested by hand during the repair and then deliberately
NOT committed (it needs a production Apps Script redeploy, which is an ask-first
operation, and the owner's links made it unnecessary that day):

* `appscript/prform.gs` — a read-only `listProjectFolderFiles` action beside
  `getProjectFileData`, allow-listed to `Projects/` like every other handler,
  using the existing `walkProjectsPathByCode_` + `canonTopFolder_` helpers.
  Returns per file: `fileId, fileName, mimeType, sizeBytes, createdAt, trashed,
  url`. **`createdAt` is the point** — a repair that re-attaches an orphan must
  date it when the work really happened, and its absence is why the 2026-09-09
  repair had to fall back to the approval time and say so.
  ⚠️ It must NOT create the folder if missing: a listing call with a side effect
  is a trap, and `walkProjectsPathByCode_` creates by default.
* A sweep script under `tools/` (name it when you write it — this file does not
  pre-book paths, because an exemption for a not-yet-written file outlives the
  absence and then hides a REAL broken pointer) that walks every หนังสือ's folder
  and reports Drive files with no `project_files` row, and rows whose
  `drive_file_id` no longer resolves (the other direction; a deny-only sweep
  cannot tell a healthy tree from a broken listing call).
* ⚠️ Its CONTROL: the sweep must go red if it examined nothing. "0 orphans" and
  "the listing failed" must never print the same verdict — that failure mode is
  what `tools/asset-mime-check.mjs` guards against and is worth copying.

⚠️ **Do NOT try to do this with the EXISTING handler instead — measured
2026-09-10.** The tempting shortcut is to skip the redeploy and sweep the other
direction (every `project_files` row, does its `drive_file_id` still resolve?)
using `getProjectFileData`, which is already deployed. Two reasons it is a poor
substitute, both read from `appscript/prform.gs`:
* **It returns the file's BYTES**, base64-encoded, not metadata. Answering a
  metadata question about all **123** Drive-backed rows would download every PDF
  through the webhook.
* **It cannot see `trashed`.** `DriveApp.getFileById` succeeds on a trashed
  file and the handler returns no trashed flag — and this repo already knows a
  trashed Drive file still serves publicly
  (`docs/mistakes/integrations.md`). So the sweep would report a trashed file as
  healthy, which is the single most likely real state.
The metadata handler in the design above is what makes this cheap AND able to
answer; that is the argument for spending the redeploy, not a reason to skip it.

Adding the handler requires `npm run deploy:gas` (`skills/deploy-gas.md`) — ASK
FIRST, per CLAUDE.md.

### 13b. Give Claude read access to Google Drive — MOSTLY ANSWERED by 13a

⚠️ **Re-read this in the light of 13a (2026-09-10) before doing anything.** The
stated motivation was *"so a future session can check Drive itself instead of
asking the owner to paste links"* — and that is now true, with **no token, no
OAuth and no new scope**: `statProjectFiles` and `listProjectFolderFiles` let a
session ask Drive about any `Projects/` file it can already reach from the
database. The 2026-09-09 repair needed the owner to paste three links; the same
repair today would find them itself.

What a real Drive token would ADD is the ability to look outside `Projects/`,
and to enumerate a folder with no database foothold. Weigh that against the row
in `.claude/rules/security.md`: re-authorising `clasp` for this account yields a
token reaching the **entire Drive of the SAMO account, exam keys included**,
because `prform.gs` uses `DriveApp` and Google has no folder-scoped Drive scope.
The only real containment is still moving the app tree to a **Shared Drive with
its own identity**. **So this is now a small gain for a large blast radius —
recommend NOT doing it unless the Shared Drive move happens first.**

**The original note:**

Wanted so a future session can check Drive itself instead of asking the owner to
paste links. **Read the security implications before designing this**: per
`.claude/rules/security.md`, `clasp`/Drive OAuth for this account is NOT
folder-scopeable — because `prform.gs` uses `DriveApp`, re-authorising yields a
token that reaches the **entire Drive of the SAMO account, exam keys included**,
and Google has no folder-scoped Drive scope. The row in that table already names
the only real containment: move the app tree to a **Shared Drive with its own
identity**. 13a is the cheaper 80% and does not need any of this — it reaches
Drive through the existing public GAS webhook and never hands Claude a token.

### 13c. More rigorous tests — the named gap is CLOSED; the rest is open

**Status: the third bullet below is DONE (2026-09-10).** `Prefer:
return=representation` — "the seam between them, exactly where the bug lived,
and nothing covers it" — is now covered by
`tools/authz0182-insert-returning-seam.sql` (11/11, registered in
`run-proofs.mjs`). It does three things:

* **Reproduces 0181's mechanism live, from nothing.** A synthetic table with a
  self-looking-up SELECT policy: the bare INSERT is ALLOWED and the same
  `INSERT … RETURNING *` is REFUSED, same principal, same transaction — then the
  policy is rewritten against the new row's own columns and `RETURNING` starts
  working. So the pattern is demonstrated to cause the failure, not asserted to.
* **Sweeps EVERY SELECT policy in `public`** for that shape, reading the exact
  function each policy calls from `pg_depend`. ✅ **Measured result: no real
  table has a self-lookup SELECT policy** — all 23 representation-insert tables
  are clean, and 0181's fix is confirmed from the live predicate
  (`prof_can_see_file(bigint,text)`) rather than from the migration. It also
  asserts no policy reaches the hazardous 1-arg wrapper 0181 kept for other
  callers — **the assertion that would have caught 0181 on the day it shipped.**
* **Proves the detector is not blind**, both directions, because a green sweep
  otherwise cannot be told apart from a sweep that sees nothing.

⚠️ **It follows ONE level.** A self-lookup inside a function called BY a
policy's function is not detected: these have string bodies, so Postgres records
no dependency for what they call. 0181 lived at level one. Stated in the file.

⚠️ **A regex on `pg_policies.qual` is NOT good enough and was tried first** — it
reported `project_files_read` as broken, because it matched the body of the
1-arg overload while the policy calls the 2-arg one. A Postgres function's name
is not its identity; `pg_depend` gives the identity.

**Still open from the original ask:**
* Every guard written here had to be broken and watched to fail before it could
  be trusted — three of them were green over the live bug first
  (`tools/proj0181-prof-upload.sql` header, `docs/mistakes/tooling-proofs.md`).
  Any new test work should adopt that ritual as the default, not the exception.
* **The e-sign flow has still never been driven end to end by a human.** See §14.
* ✅ DONE — see above. (Kept here as the ORIGINAL wording, because it is the
  clearest statement of what the gap was.)

## 14. e-sign works now, and nobody has ever completed it

**Status: HYPOTHESIS — every PIECE is measured, the WHOLE has never run.**

The in-app **ลงนาม** button was dead from the day it shipped (nginx served
pdf.js's `.mjs` worker as `application/octet-stream`;
`docs/mistakes/deploy-hosting.md`). It was fixed and deployed 2026-09-09.

Measured on production that day: the module worker LOADS and posts back (it
answered `ERROR: worker error` hours earlier), the dynamic-import fallback
resolves, GAS `getProjectFileData` returns a real 241 KB PDF from a page-origin
fetch, and pdf-lib is in the same chunk.

**But draw → place → ทุกหน้า → ยืนยันลงนาม → upload has never been completed by
anyone, on any environment.** It is months-old code executing for the first
time. One bug behind it was already found and fixed by reading
(`frontend-ui.md`, the zero-height signature) — that one produced a PDF marked
ลงนามแล้ว with nothing visible on it, i.e. the same symptom as the original
report, and it would have been diagnosed as a relapse.

**Next session: have อ.ประกาศิต (the `prof` seat) sign one real หนังสือ with the
button while someone watches, and open the resulting PDF.** Until then, treat
e-sign as untested and keep the upload path as the documented route.

⏸ **DECIDED 2026-09-10 — the owner was offered this and said "just leave it".**
Do not push it again; the upload route works, so nothing is blocked. Recorded
so the next session does not re-raise it as though it were an oversight.

📌 **Measured 2026-09-10, and this is the occasion when someone does want it:
TWO real หนังสือ are sitting unsigned with อ.ประกาศิต, requested 2026-09-07.**
`SGN-UE6GR` (หนังสือโครงการ First aid training 2026) and `SGN-7WEMQ`
(หนังสือ โครงการ Music Therapy) — the only two `pending` sign requests in the
system. Either is the live test case. Also measured: **21 accepted requests, 21
signed files, ZERO accepted-with-no-file**, so the 0181 repair holds and no new
orphan has appeared; and **no signed file has been written since 2026-09-09**
(newest is 2026-09-03, the repair itself), which is what keeps this section a
HYPOTHESIS rather than a verified flow.

⚠️ **The seat note below is wrong about อ.ภูริภัทร and was corrected 2026-09-10.**
`phuriphat.ma@kkumail.com` holds `master` (in `managed_permissions`, which
`current_user_has_permission()` reads as a union) but has **NO ผู้ส่ง seat** —
two `team_members` rows, both with a null `project_seat`. Its desk comes from the
master floor, not from a stored seat. The instruction to change the seat to
**อาจารย์ (ลงนาม)** in ทีม SAMO still works; the configuration it is described
against is not the one that account has.

⚠️ A master holder cannot do this from the UI, deliberately — `projectSeatRole()`
lets an explicit seat beat the master floor, so a master with the ผู้ส่ง seat
gets the ผู้ส่ง screen. Change the seat to **อาจารย์ (ลงนาม)** in ทีม SAMO to
test. Do not widen the UI gate; `src/js/projects/index.js` §MASTER_SEATS explains
why under-showing relative to RLS is the safe direction.

## 15. Two loose ends from the 0181 session

**Status: OWED — small, unblocked, neither urgent.**

* **อ.ภูริภัทร has two accounts**: `phuriphat.ma@kkumail.com` (the real one —
  `master`, and NO stored project seat: see the correction in §14) and
  `pmphuriphat@gmail.com`. Merging is governed by `docs/mistakes` one-person
  registry rules — kkumail identifies the person, so the gmail row is the one to
  retire.
  ⏸ **DECIDED 2026-09-10 — DO NOT delete it on its own.** The owner's reason:
  *"there's many things to clean with problematic accounts that left on the db"*
  — so this belongs to a single deliberate problematic-account cleanup, not a
  one-off deletion. Do not raise it as an isolated errand again.
  ✅ **Measured 2026-09-10 so the cleanup does not have to re-derive it**, and
  it is inert on every axis checked: `permissions` and `managed_permissions`
  both empty, **no `public.people` row** (the kkumail one owns
  `people.id=4d024bf7…`), 0 sign requests as either prof or requester, and 0
  uploaded files. Nothing references it, so whenever the cleanup happens this
  row costs nothing to remove — the caution is about doing account deletions as
  a considered batch, not about this row being risky.
* **`logSignToDoc` / `appendSignTimeline` swallow their failures to
  `console.warn`.** Deliberate — a log line must not fail an upload — but that
  silence is what made 0181 take six days: the doc timeline showed NO upload
  event, and its absence was taken as proof no upload had been attempted. It was
  not. If this is ever changed, the requirement is a visible non-fatal signal,
  not a throw.

## 11. ✅ CLOSED 2026-09-10 — the last passport table has row security

**Status: VERIFIED 2026-09-10 — how:** `tools/passport0182-continents-lockdown.sql`
run against PRODUCTION **before** the migration, where it failed 6 assertions
with update/insert/delete each answering `allow` — the live bug read by the
assertions that exist to catch it — then applied to samo-dev, re-run 16/16, then
applied to production and re-run **16/16**. Kept because the REASONING and the
two things deliberately NOT done are the reusable part; nothing is owed.

The gap was `passport.continents` — 4 rows of theming, no personal data — which
kept its GRANTs across the monorepo merge and lost the row security its old
project's `0011_passport_rls_lockdown.sql` had given it. `anon` could rewrite or
delete all four rows. Severity was judged LOW and it held up: nothing reads the
table (`grep -rni continent passport/ src/js` → one CSS comment, no query) and
`activities.continent_id` is non-null on 0 rows.

**Fixed by `0182_the_last_passport_table_without_row_security.sql`** — RLS on
plus one `continents_read` policy `for select using (true)`, the exact shape its
ten siblings carry. The absence of a write policy is what closes it; the GRANTs
were deliberately left alone. Write-up: `docs/mistakes/authz-rls.md`. The rule it
produced is in `docs/INVARIANTS.md` ("A schema move carries the GRANTS and drops
the ROW SECURITY") — **that pointer used to be a claim this file made and the
file did not contain; it does now.**

**Two things were deliberately NOT done. Read these before "tidying up":**

1. ⛔ **`departments` / `sub_departments` stay RLS-on with ZERO policies.** That
   is on purpose (0056 says so): they are reached only through the definer RPC
   `list_passport_departments`. Giving all three reference tables a read policy
   for consistency would widen two definer-only tables to world-readable. The
   proof asserts they stay at 0 rows **and** that they are not empty.
2. **`anon` holds `TRUNCATE` on nearly every table in `public` and `passport`**
   (the Supabase schema default), and TRUNCATE is **not** subject to RLS, so
   0182 does not restrain it. It is *unreachable* rather than restrained: both
   `anon` and `authenticated` are `NOLOGIN` (read from `pg_roles`), so nothing
   can connect as them, and PostgREST never emits a TRUNCATE. **That containment
   is asserted by the proof**, so making either a login role turns it red.
   A schema-wide grant sweep is its own piece of work with its own blast radius
   and is NOT owed — recorded so the next reader does not rediscover it as a
   panic.

**Also learned while measuring, so nobody re-investigates it:** the one-line
query in the old version of this section could only see tables with RLS *off*.
Running it with the policy count beside it is what surfaced the two deliberate
deny-all siblings, which is the thing most likely to be broken by a well-meaning
edit. `select relrowsecurity, (policy count)` — ask for both.

## Where to look for anything else

**Status: VERIFIED 2026-09-05** — how: every path below is checked by the guard in `src/js/state-handoff.test.js`.

| | |
|---|---|
| what is true now | `STATE.md` |
| rules that outlive a session | `docs/INVARIANTS.md` |
| the passport merge, start to finish | `docs/PASSPORT-MONOREPO.md` |
| bugs already paid for | `docs/mistakes/*.md` — `grep -rin "<symptom>" docs/mistakes/` |
| what production serves | `npm run deploy:owed` — **the only authority** |
