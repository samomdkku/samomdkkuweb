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

**⛔ THE ONE THING BLOCKING ALL OF THIS, and only the owner can do it:**

1. Create the collections. **Three, decided 2026-09-06 — `Infra` · `Dev` ·
   `Team`**, split by what a leak COSTS rather than by topic. The full table and
   the reasoning (including why NOT to call the first one `IT`, why `Comms` and
   `Handover` were dropped, and why not one per ฝ่าย) is in
   `skills/vaultwarden.md`, its one home. This step creates `Dev`.
2. Create an item in it called **`samo-dev env`** whose **Notes** field holds the
   output of `npm run env:share -- --copy` — that flag puts it straight on the
   clipboard and prints nothing, so the values never cross a screen.
3. Share `Dev` with each contributor's account as a plain **User**.

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

## 11. One passport RLS gap — found 2026-09-06, details deliberately withheld

**Status: VERIFIED 2026-09-06 — how:** `pg_policies` and `pg_class.relrowsecurity`
read from the LIVE database via `tools/db-query.mjs`, plus `has_table_privilege`
for the `anon` role.

⛔ **This repository is PUBLIC, so the mechanism is NOT written down** — that is
the standing rule in `.claude/rules/security.md`, and it has been broken here
before. One line re-derives it:

```sql
select t.tablename from pg_tables t join pg_class c on c.relname = t.tablename
 where t.schemaname = 'passport' and not c.relrowsecurity;
```

**What it is, in the safe amount of detail:** one small passport lookup table —
**4 rows, no personal data, theming only** — kept the grants it had before the
monorepo merge but lost the row-level protection its old project's
`0011_passport_rls_lockdown.sql` had given it. Everything else in the schema is
covered (11 of 12 tables).

**Severity, judged honestly: LOW.** No student data is reachable through it and
nothing is exposed that was not already public. The worst case is defacement of
a colour/name that shows in the UI, visible immediately and reverted by one
`update`. **It is not urgent and it should not be rushed at the end of a
session** — which is why it was recorded rather than patched on 2026-09-06.

**The fix, when someone picks it up:** a numbered migration enabling RLS with a
read-only policy, mirroring the `*_read` policies the sibling tables already
carry — then `skills/ship-a-migration.md`'s ordering. ⚠️ **Check nothing writes
to it first**; a grep of `passport/js` and `src/js` on 2026-09-06 found only
reads and a foreign key.

**The wider lesson, already paid for:** the old project had this locked and the
merge silently dropped it. **A schema move does not carry RLS with it** — after
any merge, ask `pg_class.relrowsecurity` for every table rather than assuming the
policies came along.

---

## Where to look for anything else

**Status: VERIFIED 2026-09-05** — how: every path below is checked by the guard in `src/js/state-handoff.test.js`.

| | |
|---|---|
| what is true now | `STATE.md` |
| rules that outlive a session | `docs/INVARIANTS.md` |
| the passport merge, start to finish | `docs/PASSPORT-MONOREPO.md` |
| bugs already paid for | `docs/mistakes/*.md` — `grep -rin "<symptom>" docs/mistakes/` |
| what production serves | `npm run deploy:owed` — **the only authority** |
