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

## 1. Discord bot token — MUST be reset now; the 09-05 decision is superseded

**Status: OWED 2026-09-11** — leaked a SECOND time, and the reason the owner
declined the first time no longer holds.

**Replace the Discord bot credential.** The bot is the one named *"Role
assignment bot for SAMO69"* in the server; it is currently over-permissioned.

⛔ **DELIBERATELY VAGUE, AND DO NOT "HELPFULLY" RE-ADD THE DETAIL.** This file is
SERVED PUBLICLY at `samo.md.kku.ac.th/docs/state/HANDOFF` (verified 2026-09-11,
HTTP 200) and the repo is public. Naming the application id beside the words
"compromised credential" and "Administrator" publishes a target while the hole
is still open. The specifics are the owner's to hold until step 5 below is done.

⚠️ **The 2026-09-05 "declined to rotate" decision is SUPERSEDED, and it is worth
saying why rather than just overturning it.** That decision was defensible on
its own terms: the bot was dead on Render and nothing in this repo used it, so
the credential controlled nothing anybody cared about.

**That changed on 2026-09-11**, when the owner asked to bring the bot back on the
VM as the ทีม SAMO → Discord role sync. The credential stops being inert and
becomes the thing that can add and remove roles for 449 people. A dormant risk
is one you can choose to accept; the same risk attached to a live job is not.

⛔ **Do not stand the bot up on the old token.**

✅ **THE OWNER'S CHOSEN PATH (2026-09-11) IS BETTER THAN RESETTING: a NEW bot
application under a role account.** Resetting fixes the leak. A new bot under a
role account fixes the leak *and* the thing that would have bitten later —
**the current app belongs to a personal Discord account**, so when that student
graduates nobody can reset its token, narrow its permissions, or fix it. That is
precisely the failure `docs/SUCCESSION.md` exists to prevent, and it applies to
a Discord application exactly as it applies to a Google account.

📌 **Own it with a Discord Developer TEAM, not a single role account.** Discord
lets an application be owned by a Team with several members; put BOTH role
accounts in it (`mdstuddata.beta` and `samomdkku.ai`). Same two-holder shape as
the Vaultwarden org, and neither a graduation nor a lost phone strands the bot.
⚠️ Per SUCCESSION.md the durable part is the **recovery settings** on those
accounts, not the address — so set 2FA on whichever account creates it and put
the backup codes in the §7 break-glass envelope.

⛔ **AND KICK THE OLD BOT FROM THE SERVER — this is the step that actually closes
the leak, and it is stronger than a token reset.** A reset invalidates the
leaked string; kicking removes the old bot's Administrator from the guild
entirely, so the leaked token logs into an account that can no longer reach
anything of yours. Do this even if you also reset. Deleting the old application
afterwards is optional tidying.

✅ **Nothing is lost by replacing rather than reusing.** Roles members already
hold are untouched — kicking a bot does not revoke what it granted. The ฝ่าย
roles are ordinary roles, not integration-managed (the old code distinguishes
them itself at `main.py:1138` with `is_bot_managed()`), so a new bot can manage
every one of them. The bot stores nothing but flat files.

`.claude/rules/security.md` carries the row saying where the new token lives.

📌 **THE STEP-BY-STEP IS `docs/DISCORD-ROLE-SYNC.md` §7** — six numbered steps,
owner-only, written 2026-09-11 to be followed in a later session. Do not
reconstruct them from this section; §7 is their one home, and it includes the
two that fail silently (the SERVER MEMBERS INTENT, and the bot's position in the
role list).

✅ **Resetting is safe — verified 2026-09-11, not assumed.** Nothing breaks:
every SAMO notification uses **webhook URLs**, which are a separate credential
(`functions/_discord.js`, `functions/notify.js` and the VM's
`/etc/samo-notify.env` are all webhooks; the one `Authorization: Bearer` in that
code is Supabase). Apps Script no longer speaks to Discord at all
(`appscript/prform.gs:18`). The other Discord bot on the owner's machine is a
**different application** (`1493879577238568980`, decoded from its own token's
first segment), so it is unaffected. A reset does not touch the bot's server
permissions, its place in the role hierarchy, or any role a member holds.
⚠️ Check the member list first: if the bot shows **offline**, nothing is using
the token. If it shows online, something still is and will stop.

📌 **While resetting, narrow the permission** — it holds Administrator and needs
only *Manage Roles* + *Manage Nicknames*. ⚠️ **And then the hierarchy starts to
matter**: a non-Administrator bot can only manage roles BELOW its own, so its
role must be dragged above every mirrored ฝ่าย role. Administrator hides that
rule today, which is why the narrowing must happen BEFORE the bot starts
removing roles, not after.

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

**Status: OWED** — five small items, none urgent, all owner-only.

| | What |
|---|---|
| **`PASSPORT_GAS_SCRIPT_ID`** | one line in the repo root `.env.local`, so `npm run deploy:gas:passport` can DEPLOY (it can already `--verify`). The id is the samopassport Apps Script project's — ⚠️ **NOT** the bare `GAS_SCRIPT_ID` already in that file, which is samoweb's; pushing over that one takes down PR/shop uploads and the projects email. Guarded by `src/js/gas-project-isolation.test.js`. Until it is set, a committed `passport/gas/Upload.gs` fix stays undeployed — the 2026-08-09 failure, again |
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
- ✅ **THE VISUAL EDITOR IS ACCEPTED (owner, 2026-09-11): "i've tested it, do
  it".** It is no longer a spike. ⏸ **AND IT IS PAUSED AGAIN THE SAME DAY, BY
  THE OWNER, mid-build** — "pause the work of this หน้าฝ่าย for now". What
  shipped is below; do not extend it without being asked.

  **Built and deployed 2026-09-11:** the block set went 8 → 21, in five Thai
  categories (ข้อความ · รูปภาพ · กล่องและการ์ด · ปุ่มและลิงก์ · จัดวาง), adding
  รายการ · ขั้นตอน · คำพูด · รูปคู่ข้อความ · รูปหลายรูป · การ์ดพร้อมรูป ·
  กล่องสำคัญ · คำถามที่พบบ่อย · ข้อมูลติดต่อ · ตาราง · หัวข้อย่อย ·
  ปุ่มหลายปุ่ม · ระยะห่าง. Verified by screenshot at 390px and 900px.

  **Three real bugs were fixed on the way, all found by LOOKING, not reading:**
  1. **The owner could not find how to set a link** — "i don't even know how to
     attach link to the button". The field existed as a GrapesJS trait, behind a
     gear icon, so selecting a button showed the Style Manager and no way to
     type a URL. A feature that cannot be found is not different from a missing
     one. The settings panel now opens on selection and the traits are labelled
     in Thai (`ลิงก์`), not `href`.
  2. **Every link would have hijacked the ฝ่าย page.** The frame is sandboxed
     without `allow-same-origin` or `allow-top-navigation`, so a bare `<a href>`
     loads the target INSIDE the little embedded box. `forceExternalLinks()` now
     pins `target="_blank" rel="noopener"` on the way out — on SAVE, so it also
     catches markup an author pastes.
  3. **The image blocks fetched placeholders from placehold.co** — a third-party
     request from a student-facing page, broken wherever that host is blocked.
     Now inline SVG data URIs, which is what "self-contained" required anyway.

  ⚠️ **ONE NEAR-MISS WORTH READING BEFORE ANY LAYOUT WORK HERE** — a screenshot
  appeared to prove the columns never stack on a phone, and the fix was half
  written (every block moved to grid `auto-fit`, the header comment rewritten,
  the guard test rewritten to FORBID the old idiom) before measurement showed
  the flex idiom had been right the whole time. The capture harness had no
  `<meta name="viewport">`, so Chrome laid the page out at 980px and scaled it
  down. All of it was reverted. `docs/mistakes/frontend-ui.md` has the write-up;
  the rule is that a screenshot is an instrument and gets the same suspicion as
  a SQL proof.

  **What is NOT done, if this is ever resumed:** nobody has dragged a block and
  saved through the real editor end to end — the round trip is still verified by
  composing blocks in code. And the two teaching items above stand.

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

### ⛔ `.claude/rules/mistakes.md` is FULL — 29,997 of 30,000 bytes

Three bytes of headroom as of 2026-09-13. **The next entry will not fit**, and
`npm run check:context` (which `npm test` runs) will fail on it.

⛔ **Do not raise the cap** — it is charged to every future session, and the
index that used to live there reached 18.5k before it blocked a write-up from
being added at all. Do not shave the seven CLASSES either: they are the only
part that generalises to code nobody has written yet.

**What to do instead:** compress the most recently added SITES — the one- or
two-line examples appended to a class — since the write-up in `docs/mistakes/`
carries the detail and the class only needs enough to be recognised. Two sites
added today were each compressed twice to fit, and one was folded into a
neighbouring sentence rather than standing alone. That is the intended pressure
working; it just means budgeting a few minutes for it.

### ⛔ `passport-link-on-signup.sql` is RED on samo-dev and GREEN on production

`npm run proofs:dev` reports `3 failed — signing in re-keys the carried
profile`. **You did not break it.** It passes 12/12 on production with the
identical migrations. It names no Discord object and deletes no `people`, so
nothing 0183–0187 added is reachable from it; it wants a "carried student" that
dev's data copy may not have. ⚠️ **Not diagnosed, and not certified harmless** —
that is reasoning, not proof. Recorded 2026-09-13 so the next session does not
spend an hour assuming it is their change.

### ⛔ RUN `migrate:status` FOR **BOTH** PROJECTS AFTER ANY MIGRATION

Two failures found on 2026-09-13 that nothing else could see — not tests, not
the build, not the app:

- **A migration was EDITED after it ran.** `migrate:status` says
  `EDITED AFTER RECORDING — the file no longer matches what was applied`. It was
  comments over idempotent DDL, so re-applying fixed the record. ⛔ **If the edit
  touches DDL, re-applying is the WRONG move** — write a new migration.
- **samo-dev had drifted four migrations** while `STATE.md` said "in step". Ask
  `npm run migrate:status -- --dev`, never the sentence.

⚠️ **Read the WHOLE pending list before applying.** A `tail -6` hid 0183, so
0185 applied without its parent table. A migration that succeeds out of order
leaves a database no file describes.

### ⛔ `grep` IS THE WRONG INSTRUMENT FOR PROSE

Markdown wraps sentences, so a line-based search cannot see a phrase split
across a newline. On 2026-09-13 it returned 0 twice for a safety warning that
WAS present, and both times the next step would have been to "correct" a file
that was already right. Normalise first — `re.sub(r'\s+', ' ', text)` — then
search. Same discipline for a mutation test: confirm the edit landed before
concluding a guard is blind (`perl s///` without `/g` took the first of two
matches, twice).

### ⛔ `STATE.md` has ZERO lines of headroom

258 lines, and `state-handoff.test.js` asserts `split('\n').length < 260` — which
is 259 today. **The next line added makes `npm test` red.** Prune an old block
first (the file itself says which), do not raise the number.

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

✅ **The gap that let this hide for six days is CLOSED (2026-09-10).** It read
"still open" until then: nothing in this system could ask *"what is in Drive that
we have no row for?"*, which is why the owner had to find those three PDFs by
opening Drive by hand. `listProjectFolderFiles` and `statProjectFiles` are now
deployed (Apps Script **version 12**) with `tools/proj0183-drive-orphans.mjs` —
**§13a is the record**. ⚠️ Two sentences that stood here are now wrong and are
removed rather than left to mislead: the handler is no longer "NOT in git", and
`git log -S listProjectFolderFiles` no longer "finds nothing".

## 13. Owner asked for three things on 2026-09-09 — one BUILT, one part-closed, one declined

**Status (2026-09-10): 13a BUILT AND DEPLOYED** (one half of its sweep still
owed) · **13b answered without building it** — recommend NOT doing it · **13c's
named gap CLOSED**, the rest of it open. Each subsection carries its own status;
this heading said "none of them started" until 2026-09-10 and that is the line a
skimmer would have believed.

**Original framing — asked for explicitly at the end of the 0181 session, after the
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
* `tools/proj0183-drive-orphans.mjs` — CAN do both directions (only the
  database→Drive one has actually been RUN — see below), **writes nothing, ever**
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

✅ **THE DATABASE → DRIVE HALF IS VERIFIED CLEAN (2026-09-10).** Ran against
production, `REAL_EXIT=0`:

```
123/123 rows stat'd · folders: SKIPPED
0 HTML reply/replies from GAS
  ✓ rows whose file no longer resolves: 0
  ✓ rows whose file is TRASHED (still publicly served): 0
  ✓ rows whose size disagrees with Drive: 0
  ✓ ids that came back with no answer at all: 0
✓ Drive and the database agree — database → Drive ONLY (--rows-only).
  ⚠ THE OTHER DIRECTION WAS NOT EXAMINED. This is not a clean bill of health for it.
```

So every one of the 123 Drive-backed หนังสือ files still resolves, none is
trashed, none has drifted in size — the 0181 repair holds and nothing new has
been lost on that side. **0 HTML replies also proves the pacing works**; the
degradation described below was entirely the unpaced first version.

⏳ **STILL OWED: the DRIVE → DATABASE half** (the 63-folder listing, i.e. the
orphan question itself). It has never printed a verdict. It is the half that
pressures the shared endpoint, so run it when nobody is submitting:

```bash
node tools/proj0183-drive-orphans.mjs                 # both halves
node tools/proj0183-drive-orphans.mjs --folders-only  # just the owed one
```

⚠️ **Do not read a killed run as a clean result**, and do not read a
single-direction run as covering both — the tool now says so itself on the last
line. It exits non-zero on any finding AND on any control failure, so only a
printed verdict counts.

⛔ **ATTEMPTED 2026-09-11 ~19:56 ICT AND IT FAILED — the folders half is STILL
OWED, and this is new information about WHEN it can run.** `REAL_EXIT=1`. Batch
1 of 7 examined 20 files; **batch 2 came back `UNREACHABLE (HTML after retries)`**
— four attempts, backing off to 8/16/24 s — and the tool aborted before the
folder listing ever started. The endpoint was degraded independently of the
pacing that worked the day before: two single probes AFTER the sweep had
stopped, spaced minutes apart, both got Google's HTML error page (**HTTP 404,
32 s**), where the 2026-09-10 measurement had it recovering as soon as the sweep
stopped. Nothing else was touching `/exec`.

**So there is a condition in which this tool cannot run at all, and it is not
one the pacing controls.** Two things follow for whoever picks this up:

* **Probe first, then decide.** One `uploadTeamFile` call with no argument costs
  nothing and tells you whether `/exec` is answering JSON. If it is not, the
  sweep will burn four retries per batch and abort — and every one of those
  retries is pressure on the endpoint students upload through.
* ⚠️ **It also means real uploads were failing at that moment**, which is what
  `src/js/gas-post.js` now exists for (`docs/mistakes/integrations.md`). Before,
  a student in that window got `SyntaxError: Unexpected token '<'`.

⚠️ **The run reported "exit code 0" to the shell and that was a lie** — the
command ended in an `echo`, so the pipeline's status was the echo's. The
`REAL_EXIT=` line the tool writes is the only trustworthy verdict, which is
exactly why it is written. Same shape as the deploy pipeline whose status was
`tail`'s (`docs/mistakes/deploy-hosting.md`).

⚠️ **The report itself had three bugs, all shipped green, all now guarded** by
`src/js/projects/drive-orphans-report.test.js` (13 assertions via `SELFTEST=1`,
no network, ~200 ms): a skipped half printed `0` and then claimed "in both
directions"; the fix for that crashed on its next real run because **nothing in
the suite ran the tool** (`node --check` is not a run); and `--folders-only`
could never work, while `unanswered` from the skipped pass made the count
contradict the list above it. Write-up:
`docs/mistakes/tooling-proofs.md`. **If you extend this tool, run it — the suite
alone will not tell you it is broken.**

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

✅ **THE SMALL FIX THIS EXPOSED IS NOW BUILT (2026-09-11)** — and it was needed
sooner than expected: the endpoint was serving that HTML page the same evening
(see the failed run above). It turned out to be SIX call sites across four
files, not one, including `pr-form.js`, the PUBLIC form a guest uses.

`src/js/gas-post.js` is the one helper they all go through now. It retries a
non-JSON reply and then throws Thai that says **the file was not saved**; it
deliberately does **NOT** retry a timeout, because that case is ambiguous — the
upload may have landed with only the answer lost, and retrying writes the same
file to Drive twice, which is 0181's orphan mess from the other end. A
well-formed `success:false` passes through untouched, which `uploadTeamPhoto`'s
"Unknown action" fallback depends on. Guarded by `src/js/gas-post.test.js`
(8 assertions, all three behaviours falsified before being trusted), whose last
test asserts the PROPERTY — no module reaches GAS with a raw `fetch` — so a
seventh call site cannot quietly appear. Write-up:
`docs/mistakes/integrations.md`.

### 13a-original. The design as written on 2026-09-09 — ⛔ HISTORICAL

⛔ **THIS SECTION IS THE 2026-09-09 PLAN, NOT THE BUILT THING. Do not implement
from it.** It is kept because the implementation was checked against its
reasoning, and every sentence below was written while the feature did not exist —
including "it is still open", which stopped being true on 2026-09-10. What was
actually built is §13a above. **Three places where the build deliberately
diverged, so nobody "fixes" the code back toward this text:**

1. **It says to use `walkProjectsPathByCode_` + `canonTopFolder_`.** The build
   does NOT: that helper get-or-CREATEs at every segment, and also renames and
   moves, so a reader built on it would restructure the Drive tree of whoever ran
   it — which is the trap this very section warns about two bullets later. There
   are read-only twins (`findProjectsPathByCode_`, `findTopFolder_`,
   `findProjectSubfolderByCode_`) and `drive-listing-readonly.test.js` keeps them
   read-only.
2. **It expects `trashed` from the folder listing. That is impossible** — Drive
   omits trashed files from `getFiles()` entirely. `trashed` comes from
   `statProjectFiles`, which is why the sweep needs TWO calls and not one.
3. **It does not mention a gate, and the built listing REQUIRES `knownFileId`.**
   That is a security decision, not an omission: see §13a.

The historical text follows.

**The gap this described** — the signed PDFs existed in Drive the whole time; no
screen, query or job in this system could notice, and the OWNER found them by
opening Drive by hand.

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
* A sweep script under `tools/` (unnamed here on purpose at the time, because an
  exemption for a not-yet-written file outlives the absence and then hides a REAL
  broken pointer — **it exists now and is
  `tools/proj0183-drive-orphans.mjs`; do not write a second one**) that walks
  every หนังสือ's folder
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

⛔ **A PENDING RELEASE NOTE ALREADY TELLS STAFF THIS BUTTON WORKS — and `npm run
release` will publish it.** Found 2026-09-10 while auditing the handoff.
`src/data/changelog.js` PENDING carries, from the 0181 session:

> *หนังสือโครงการ: ปุ่ม "ลงนาม" ที่ให้อาจารย์เซ็นบนหน้าจอได้เลย **ใช้งานได้จริงแล้ว***

That says "it really works now", and this section says nobody has ever completed
the flow on any environment. **Both cannot be true.** The note is defensible —
every piece was measured and the thing that broke it was genuinely fixed — but it
is a claim to STAFF about a path no human has finished, and if it is wrong the
people who read it are the ones who find out.

**This is the owner's call, not a silent edit** (it is user-facing Thai copy from
another session's fix, and the owner has decided to leave e-sign untested for
now). Two ways to resolve it, whichever the owner prefers:

* **Test it before releasing** — one signature on one of the two pending
  requests, and the note becomes simply true; or
* **Soften the note** to say the error was fixed rather than that the button is
  proven — e.g. *"…แก้ข้อความผิดพลาดที่ทำให้กดไม่ได้แล้ว"* — and keep the
  stronger wording for after someone has actually signed with it.

⚠️ **Do not just delete the note.** The underlying fix is real and a person WAS
affected by the bug; the problem is only the strength of the claim.

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
system. ⚠️ **This decays — do not quote it, ask:**
`select id, status, requested_at from public.project_sign_requests where status = 'pending';` Either is the live test case. Also measured: **21 accepted requests, 21
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

## 14b. Discord role sync — LINKING IS LIVE, the apply step is not

**Status: VERIFIED 2026-09-13 — how:** every claim below was read from the live
system, not from a plan. Migrations 0183–0186 applied to production; proofs
`team0183` 23/23, `team0184` 18/18, `team0185` 29/29; the OAuth flow completed
by a real human (the owner); the guild read with `npm run discord:report`; the
48 mappings written by `tools/discord-provision.mjs --adopt-only`; and on
2026-09-13 the apply tool run read-only against the live guild, which is where
the bot's name, its permission and its position in the role list below come
from.

⛔ **ONE HOME FOR THE DESIGN: `docs/DISCORD-ROLE-SYNC.md`.** Do not restate it
here. This section is only what is TRUE NOW and what is OWED.

### Where it actually is

```
linked people          1 of 196 in the guild      (the owner, by OAuth2)
ticked ทีม SAMO nodes  107 of 299
mapped to a role        48                        (adopt only; 0 roles created)
guild roles            180 of 250                 UNCHANGED by any of this
```

✅ **BUILT AND LIVE** — a person signs in, presses **เชื่อมบัญชี Discord** on
ข้อมูลของฉัน, approves on Discord, and is linked. One account per person
(§8f, owner-decided). Unlink works. Re-link to a different account works.

🟡 **THE APPLY TOOL EXISTS AND HAS NEVER WRITTEN ANYTHING** (2026-09-13).
`npm run discord:apply` — plan by default, `--apply` required, and every §5e
refusal checked before the first write. Run against the live guild it reports
**0 to add, 0 to remove**: the single linked person already holds both roles
they are due, so there is genuinely nothing to apply until more people link.

✅ **THE WRITE PATH IS NOW EXERCISED — against a STUB guild, not the real one**
(2026-09-13). `src/js/discord-apply.run.test.js` runs the real file as a child
process against a fake Discord + PostgREST and asserts the exact list of HTTP
requests: the PUT and the DELETE name the right member and the right role, an
unlinked member and a leaver appear in no request, an unmanaged role is never
touched, and every refusal exits non-zero **and** writes nothing.

⛔ **IT FOUND A BUG THAT WOULD HAVE KILLED EVERY WRITE.** `X-Audit-Log-Reason`
was Thai; an HTTP header value is latin-1, so `fetch` threw
`Cannot convert argument to a ByteString` before any request existed. The live
read-only run could not see it (plan mode builds no header) and neither could
eight source assertions. **`tools/discord-provision.mjs` had the identical bug,
shipped** — its header is in the CREATE branch, and every run so far was
`--adopt-only`. Both fixed, both pinned. Write-up:
`docs/mistakes/integrations.md`.

⚠️ **Still NO role has ever been added or removed in the real server.** The
stub proves the logic and the requests; it cannot prove the credential, the
permission or the hierarchy. The first live run must be
`--only <discord-user-id>`, on one person, watched.

✅ **§7 STEPS 1–4 ARE DONE, and this was read from the guild rather than
asked.** The bot is **`samomdkkubot`**, it holds **Manage Roles**, and its role
sits at **position 182 of 183** — above every mirrored role, so step 4's silent
failure ("reports success, changes nothing") is not present today. The apply
tool re-checks it every run and refuses rather than trusting it, because a
mirrored role created later can land above the bot.

⛔ **§7 STEP 5 IS NOT DONE.** `Role assignment bot for SAMO69` is still a member
of this server (role position 181). Until it is kicked, the leaked credential
still reaches the guild — §1, and item 6 below.

### ⛔ WHAT IS LEFT BEFORE THIS CAN BE OPENED TO REAL PEOPLE

⛔ **THE OWNER HAS NOT AGREED TO CREATE ANY ROLE. Do not create one.** Nothing
has ever been written to Discord by this system — no role created, assigned or
removed — and that is a fact worth keeping true until somebody says otherwise in
words. Everything below is a measurement, not a task list.

**Status: MEASURED 2026-09-13 — `npm run discord:readiness`, which needs no
Discord token and re-runs this whole section in two seconds. Do not retype these
numbers; run it.**

```
ทีม SAMO holds 342 people in a ตำแหน่ง
  308 can link today          kkumail on file, so signing in resolves them
   34 cannot                  no kkumail — a sign-in makes a STRANGER
    1 actually linked

ตำแหน่ง ticked for a role  107
  48 can grant something today (45%)
  59 grant nothing — no Discord role exists

IF ALL 342 LINKED TOMORROW
  313 get at least one role            (92%)
   27 get NOTHING though owed something
  219 are short a role that does not exist yet   (64%)
```

⛔ **ALL TWELVE of the largest unprovisioned ตำแหน่ง have real people under
them** — 32 under ฝ่ายวิชาการ, 27 under ฝ่าย รพ. ร่วมผลิต, 25 under
ฝ่าย SMST Syringe, and so on. Each is somebody who links, is told it worked,
and receives nothing. **Provision before announcing, not after** — the first
impression of this feature is the one 342 people form at once.

⚠️ **`my_person_id()` matches on EMAIL, not on an account existing beforehand**
(read from `pg_get_functiondef`). So "has a portal account" is NOT the gate —
only 28 do, and that number is irrelevant. The gate is a kkumail on the ทีม SAMO
row. The 34 without one need data entry, and nothing else will fix them: they
would sign in, match nothing, and be unable to link at all.

⛔ **"CREATE ONLY THE POPULATED ONES" IS NOT A MIDDLE PATH — it saves ONE
role.** 58 of the 59 unprovisioned ตำแหน่ง have people under them. That was
recommended to the owner before it was measured; the measurement killed it.

✅ **THE REAL MIDDLE PATH IS ONE ROLE, AND IT IS A 50× DIFFERENCE.** Most people
who are "short a role" still RECEIVE one, from a ticked ancestor that is already
provisioned — short means missing the *specific* role, not missing everything.
Only the 27 with no provisioned ancestor get zero, and in a tree they are covered
by creating the node highest in their ancestry:

```
27 people   ฝ่าย รพ. ร่วมผลิต   (top level)
```

| | roles spent | outcome |
|---|---|---|
| 1 role | 183 → **184** of 250 | nobody who links gets nothing |
| 51 roles | 183 → **234** of 250 | everyone gets every role they are due |

One buys ACCESS for everybody; the other fifty buy PRECISION for people who
already have a role. `npm run discord:readiness` recomputes this and prints the
exact command, so it stays true as ทีม SAMO is edited.

**So, in order, before opening:**

1. **Provision.** Either the one role above, or all 51 (→ 234 of 250; the cap
   cannot be raised and the spend is undone only by deleting roles, which takes
   their channel permissions with them). `--only '<ชื่อ>'` on
   `discord-provision.mjs` creates a named subset; a name matching nothing
   REFUSES rather than provisioning zero and exiting 0.
2. **The 4 near-matches and the contested ฝ่ายวิชาการ** — items 2 and 3 below.
3. **One real apply run**, `--only <one id>`, watched. The write path has never
   executed against the guild.
4. **The 34 missing kkumail**, or accept that those people cannot link.
5. Only then announce. Linking is self-service and irreversible in perception:
   somebody who tries it once and gets nothing does not try again.

### What is OWED, in order

1. ✅ **THE APPLY STEP — BUILT 2026-09-13**, `tools/discord-apply.mjs`, with
   the brake in the same file rather than as a follow-up. What is left is the
   first real run, and it is **waiting on data, not on code**: the diff is 0/0
   because one person is linked and already correct. ⛔ **Do not treat a green
   0/0 plan as proof the write path works** — run it `--only <one id>` first,
   and the run that finally writes should be watched, not scheduled.
   Its refusals, all before the first write: empty target set · recomputed
   counts that differ from the ones passed · `MAX_REMOVALS = 50` /
   `MAX_PERCENT = 25` (`--allow-large` to override) · a role at or above the bot
   in the role list · no Manage Roles · a role outside the managed mapping. An
   unlinked member never enters the plan, and a leaver is never stripped while
   item 4 is undecided. `src/js/discord-apply.test.js`, 17 assertions, each
   watched failing first, plus 15 behavioural ones in
   `discord-apply.run.test.js` that run the tool against a stub guild.
2. **OWNER — five contested ฝ่าย, and one of them ALREADY TOOK THE ROLE.**
   Two ticked nodes cannot share one Discord role; 0183's unique index refuses
   it. Re-measured live 2026-09-13:
   ```
   ฝ่ายประสานงาน  under ฝ่ายบริหารกิจการภายนอก  0 people   no role
   ฝ่ายประสานงาน  under ฝ่ายบริหารกิจการภายใน   2 people   no role
   ฝ่ายวิชาการ    top-level                      0 people   no role
   ฝ่ายวิชาการ    under ฝ่ายรังสีเทคนิค          0 people   ⛔ HOLDS THE ROLE
   ฝ่ายวิชาการ    under ฝ่ายเวชนิทัศน์           0 people   no role
   ```
   ⛔ **The ฝ่ายวิชาการ that won the adoption race has NOBODY in it.** It was
   not chosen; it sorted first. If a different ฝ่ายวิชาการ was meant to own
   `ฝ่ายวิชาการ` in Discord, that has to be moved by hand before anyone links.
   Four of the five hold nobody, so this is mostly org-chart tidying: rename
   them distinct, or untick the empty ones, in ทีม SAMO admin.
   ⚠️ The provisioning plan reports **4** contested, not 5 — a node that already
   holds a role is counted as `already mapped`. Both numbers are right; they
   count different things.
3. **OWNER — four near-matches**, a rename the exact match cannot see.
   Re-measured live 2026-09-13: unchanged, still these four. Confirm by hand or
   the tool will CREATE a duplicate empty role beside the one holding the
   channel. `ฝ่าย ComArt (Communication Art)` has 16 members.
   ```
   ฝ่าย COMART                ≈ ฝ่าย ComArt (Communication Art)
   ฝ่ายจัดหาทุน                ≈ ฝ่ายจัดหาทุน (Fundraising)
   ฝ่ายประชาสัมพันธ์ฝ่าย AMSA  ≈ ประชาสัมพันธ์ฝ่าย AMSA
   หัวหน้าฝ่าย IT (Tech lead)  ≈ หัวหน้าฝ่าย IT
   ```
4. **OWNER — what makes someone a LEAVER.** Undecided and it blocks removal
   design. Removed from the tree? End of ปีการศึกษา? §5e says a leaver keeps a
   `ศิษย์เก่า SAMO` role rather than being stripped bare.
5. **OWNER — §8b, worth re-opening.** Decided as option A (`discord-bot/`,
   Python). ⚠️ **Its premise turned out to be wrong**: nothing in this design
   needs a Discord gateway connection — the report, provisioning, role changes
   and even slash commands are all REST or an HTTP interactions endpoint, and
   phase 4's trigger is Supabase Realtime. §8b-bis recommends **C** (`server/`,
   Node, beside the notify service). Nothing built depends on either answer yet.
6. **OWNER — kick the old bot. STILL THERE, re-checked 2026-09-13** (role
   position 181, and it is one of three bot members). The report warns about it
   every run. This is what closes the old
   leaked credential, and also the application id that was in the public repo.
7. **Then: the remaining 51 roles**, on demand only — §8g.2. Adopt was free;
   creating spends 51 of 70 remaining under Discord's hard 250 cap, on groups
   that gate no channel yet. Create one when a ฝ่าย asks for a channel or a ping.

### ⛔ 0187 — unlinking used to keep your ฝ่าย roles for ever

**Status: FIXED 2026-09-13, and the removal POLICY is still owed (item 4).**

`discord-apply.mjs` implements §5e "never act on absence" as `if (!t) continue`.
Right for someone who never linked; **wrong for someone who WAS linked**, was
given roles for it, and is not now — and both were the same observable, an
absent `discord_links` row. So pressing ยกเลิกการเชื่อมต่อ was a permanent ฝ่าย
role grant that nothing could undo.

⛔ **Three doors, and the third is an UPDATE** — a fix written around the word
"delete" closes two of them and looks complete:

| | how the link goes away | shape |
|---|---|---|
| 1 | the person unlinks | `DELETE` |
| 2 | the person is deleted from the registry | `DELETE` (cascade) |
| 3 | the person re-links to a **different** account | **`UPDATE`** — the old account keeps every role |

0187 puts one trigger on the TABLE (insert/update/delete) maintaining
`discord_orphaned_accounts`, and the apply tool now names those accounts and the
roles they still hold. ⛔ **It RECORDS, it does not remove** — that is item 4,
undecided. What could not wait is that the information was being DESTROYED:
before 0187 there was no way, anywhere, to learn an account had ever been ours.

Two things measured that contradict the natural instinct, both in
`docs/mistakes/authz-grants.md`: a foreign key on `person_id` **breaks deleting
a person** (the trigger fires mid-cascade and raises), and the `is distinct
from` guard is *not* what protects an unrelated UPDATE — the withdrawal branch
is.

### ⛔ Traps a next session must not re-derive

- ✅ **THE NGINX DRIFT IS CLOSED — and this entry was STALE, which is worth
  saying.** It read "`/discord/config` and `/discord/callback` exist ONLY in the
  VM's config … the two have drifted … **no guard exists for this**". Diffed on
  2026-09-13: the repo copy has both routes, both files are 267 lines, and the
  ONLY difference is comment prose (`→` vs `->`). A reinstall from
  `server/nginx-samo.conf` is safe today. **An untested constraint in a doc
  closes off the right action for as long as it survives** — here, "never
  reinstall from the repo".
  ⛔ **WHAT MAKES IT SILENT IS WORTH KEEPING**: a missing `location` does not
  404. nginx falls through to `location /` and serves the public SPA —
  measured, **200 `text/html`, 217,928 bytes** of a page that renders perfectly.
  So "I opened it and the site came up" is the symptom, not the check.
  Two guards now, because neither reaches the other's half:
  `src/js/nginx-routes.test.js` asserts the REPO copy still declares each route
  (which is what makes an install safe), and **`npm run check:routes`** asks the
  SERVED host, identifying each route by a marker only it produces — with a
  control that refuses to report a clean run if the host stops falling through.
- **`SUPABASE_SERVICE_ROLE_KEY` is on the VM** (`/etc/samo-notify.env`, 0600),
  re-introduced after being unused. It bypasses every RLS policy and is pinned
  to ONE rpc, asserted by `src/js/discord-oauth.test.js`.
- **Provisioning must check BOTH sides of a name collision.** The first run
  mapped 30 nodes then hit 0183's unique index because three ฝ่ายวิชาการ nodes
  claimed one role. Fixed, but the shape is the one this whole design exists to
  prevent and it will return in another costume.
- **`npm test` was GREEN while `npm run build` was BROKEN** (`db.js` exports
  `db`, not `supabase`). Run both.
- **A PROOF WENT RED BECAUSE THE WORK SUCCEEDED.** `team0184` asserted "exactly
  2 roles" and was green until 48 nodes were mapped, at which point the
  subject's ancestry legitimately gained provisioned ancestors. It described the
  data it happened to see, not the rule. Fixed to assert the PROPERTY — every
  role returned belongs to a node in that member's own ancestry — which holds
  however much of the tree is provisioned. **Expect the other proofs to have the
  same shape somewhere; re-run all three after any provisioning run.**
- **The report once said "LINKED AND CORRECT" about a person due four roles** —
  with nothing provisioned, every linked person was vacuously correct. Fixed;
  the lesson is in `docs/mistakes/tooling-proofs.md`.

### Tools — and `skills/discord-role-sync.md` is the mechanics

```
npm run discord:report                     # read-only; --fetch on the VM, --report here
node tools/discord-provision.mjs           # plan only; --apply --adopt-only to map
npm run discord:readiness                  # no token, runs anywhere: are we ready?
npm run discord:apply                      # plan only; --apply --add N --remove M to write
npm run check:routes                       # the SERVED nginx routes, incl. /discord/*
node tools/db-query.mjs tools/team0187-orphaned-accounts.sql
node tools/db-query.mjs tools/team018{3,4,5}-*.sql
```
The report needs the Discord token (VM) and Supabase (here), so it runs in two
halves and **neither credential ever moves** — copying the token is what leaked
it three times.

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
