# Everything still owed — the cross-session handoff

Written 2026-09-04, restructured 2026-09-05. **This is the one place that lists
what is NOT done.** `STATE.md` says what is true right now; this says what is
left, why, and who can do it. When an item is finished, delete it from here.

⛔ **Nothing below is blocking anything else.** The codebase is in a clean,
shipped, verified state. These are choices and errands, not loose ends.

---

## 0. How to read this file

⚠️ **Section numbers are not strictly in order** (§16b sits before §15;
§18b/§18c come after "Where to look for anything else"). Find a section by its
heading. A section number quoted in an older note or memory may be stale.

📌 **The most recent session's REASONING is in the NEWEST `docs/state/claude-*.md`**
(sort by name; each one says which HANDOFF sections hold its open items).
Older: `docs/state/claude-2026-09-18.md`, `docs/state/phuriphatma.md`. This file
holds only what is NOT done.


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

## 1. Discord bots — the NEW bot is live; the OLD one must still be KICKED

**Status: OWED — two owner-only steps, re-checked 2026-09-19 from the guild.**
✅ The replacement bot (`samomdkkubot`) was created 2026-09-11/12 and now runs the
role sync (§14b). ⏳ **(a) Kick `Role assignment bot for SAMO69`** — still a
member; that is what closes the old leaked credential. ⏳ **(b) Narrow the NEW
bot's role (`samobot`) from Administrator** to what the sync uses (Manage Roles;
Manage Channels only for the channel tools), and keep it at the TOP of the role
list — see the last paragraph of this section. Everything below is the 09-11
reasoning, kept because it explains (a) and (b); where it says "the bot" before
2026-09-12 it means the OLD one.

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

**Status: VERIFIED 2026-09-19 — how: each entry below was reproduced, and the
two added that day were demonstrated by restoring the bug and watching the new
command catch what `npm test` did not.**

⚠️ **`npm test` IS NOT THE TEST CI RUNS.** The suite reads files; `externaldata/`
and `.env.local` are gitignored, so they exist here and not on a runner. That
asymmetry has gone red in BOTH directions (2026-09-18, two pushes; and 19 pushes
earlier over `.env.local`). **`npm run test:clean`** stages exactly what git will
carry into a temp repo and runs the suite there — run it before a push you care
about. Assertions must ask GIT what the repo contains, never `existsSync`.

### The handoff is CONTINUOUS, and three things enforce it

Written after the owner said: *"sometime i forgot to tell you to handoff also,
like sometime i knew it at 92% session token"* and *"make sure to make it sticks
not hallucinate when context getting like 800K/1000K tokens"*.

Both describe the same failure: **the handoff was designed as a terminal step,
and neither the owner nor the agent reliably notices the terminus.** An agent
deep into a long session also misremembers — it will report having written a
handoff it did not write, in good faith.

So nothing depends on noticing or on remembering:

1. **It runs when a UNIT OF WORK LANDS, not at "the end"** (CLAUDE.md's loop
   says so first, before the steps). A session handed off continuously can be
   cut off at any point and lose nothing — including by `/clear`, by auto-compact,
   or by running out.
2. **The agent must never ASSERT the handoff is done — it runs
   `npm run handoff:check` and pastes the verdict.** This is the part that
   survives context degradation: the command reads git, the filesystem and the
   database, so it is right when the agent is not. An assertion from memory at
   800K tokens is worth nothing; a tool result is worth the same at any depth.
3. **`.githooks/pre-push` warns before the work leaves the machine**, listing
   the shipping commits made since STATE.md last moved. Install once per clone:
   `git config core.hooksPath .githooks`. It WARNS rather than blocks — this
   owner ships several times an hour and a refactor changes no state —
   `HANDOFF_STRICT=1 git push` makes it refuse instead.

`handoff:check` itself now answers "are we handed off?" **at any moment**, not
only at the end: it fails when 5+ shipping commits have landed since STATE.md
last moved, and names them so writing it up takes a minute.

✅ **`npm run handoff:check`** is step 6 of the loop and the only step that can
fail: uncommitted work, unpushed HEAD, an unindexed memory file, a
memory naming a file or command that no longer exists, a HANDOFF section with no
`Status:`, STATE.md over budget, production behind the sha STATE.md claims, the
night agent's VM memory out of sync, and **a count in a document that the
database contradicts**. A check it could not RUN is a skip, and a skip is not
green.


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

## 14b. Discord role sync — LIVE and AUTOMATIC: Discord follows ทีม SAMO

**Status: VERIFIED 2026-09-19 — how:** on the real guild, a placement added on
the web gave its keys in ~8 s and its removal took them back in ~6 s; a rename
and its revert renamed the Discord role both ways; a full pass reads +0 −0; every
person's rooms AND server-wide powers were diffed against that morning (0 lost);
Discord's own audit log reconciles with every write made. Proofs `team0183`
`team0184` `team0185` `team0187` `team0195` `team0196` `team0197` `team0198`
all green.

⛔ **The day it was built is HISTORY in
`docs/state-archive/2026-09-19-discord-sync.md`** — layered notes in which early
lines ("never written", "owner has not agreed", "NOT READY TO OPEN") are false
now. This section is the current picture. The DESIGN is
`docs/DISCORD-ROLE-SYNC.md`; the mechanics are `skills/discord-role-sync.md`.

### How it works now

- **Identity.** A person links with **เชื่อมบัญชี Discord** on ข้อมูลของฉัน
  (OAuth2, 0183–0186). 167 were linked once by nickname
  (`ชื่อเล่น_#ปี_XXX-X` → ชื่อเล่น + last 4 of รหัส, exact one-to-one only;
  `tools/discord-nickname-link.mjs`), marked `discord_links.link_source =
  'nickname-import'` (0195); the web button upgrades a row to `oauth`. A link
  stores the Discord USER ID, so renaming yourself on Discord changes nothing.
  Counts: `npm run discord:readiness`, never a number written here.
- **The rule — ONE function.** `discord_role_targets()`: your own ตำแหน่ง's
  key, plus the key of every ticked **ฝ่าย (division)** above you — NOT of a
  ตำแหน่ง above you (0196: `หัวหน้าฝ่าย PR` sits above two sub-ฝ่าย and handed
  its key to 9 members until then). Only ticked nodes (`มี role ใน Discord`)
  hand out keys; `team_nodes.discord_role_id` maps node → Discord role by ID.
- **The service.** `samo-discord-sync` (systemd on the VM,
  `server/discord-sync.mjs` + `discord-sync-core.mjs`). Triggers (0197) queue
  every change that decides a key — placing / moving / removing a person;
  creating / deleting / moving / ticking / renaming a node; linking /
  unlinking / re-linking — into `discord_sync_queue` (service role only), with
  the editor's name and a Thai sentence of the change (0198). The service
  drains it every 5 s and does a full pass every 15 min, which also REVERTS hand
  edits made in Discord. Sibling order is NOT mirrored (Discord role order is a
  permission hierarchy). Enabled at boot; `deploy.sh` refreshes and restarts it
  ONLY if enabled (a deploy never arms it).
- **What it does per person.** Linked with a ตำแหน่ง → exactly their due
  mirrored keys. Linked with none, or unlinked (`discord_orphaned_accounts`,
  0187) → no mirrored keys. Never linked → untouched. Keys no ticked node owns
  (🏅 อุปนายกฯ, Moderator, bots…) are never touched. It never deletes a role
  object and never touches a channel. A ticked node with no role: adopts the one
  unmapped role of exactly that name, else creates one (permissions 0, not
  mentionable), else — if a role only RESEMBLES the name — holds for a human.
  A mapped node renamed on the web renames its Discord role.
- **Brakes.** Removal of >10 keys / >5 people in one pass → HELD and reported
  (the adds still go). A key with server-wide power → only if named in
  `DISCORD_SYNC_ALLOW_POWER` in `server/samo-discord-sync.service` (today
  `สมาชิก SAMO Buddy`, `📇 ฝ่ายเลขานุการนายกฯ`). A role above the bot → skipped.
  An EMPTY target set → nothing applied. Retry-After honoured.
- **The change log.** Every pass that changes Discord posts (a normal message
  since 2026-09-23 — silent is a switch in /admin/ → บอท Discord — pinging
  nobody, people named in text), to `🤖┆samo-role-assignment-bot`: who edited ทีม SAMO, what,
  and whose keys moved. Held items / alerts: there too, once per 6 h. Webhook:
  `DISCORD_SYNC_LOG_WEBHOOK` in `/etc/samo-notify.env` on the VM ONLY — it was
  pasted in a chat once; regenerate it if in doubt. The announcement (how to
  get a missing role: link on the web, then ask your อุป to fix the WEB) and a
  summary of the first day's changes were posted there 2026-09-19.
- **Channels.** A ฝ่าย role opens the rooms its own `สมาชิกฝ่าย X` role opens
  (`tools/discord-channels.mjs`, allow bits only — nobody can lose anything),
  so a new room for a ฝ่าย needs ONE key. Rooms opened ตำแหน่ง-by-ตำแหน่ง
  (`#internat-amsa`, `#internat-ifmsa`, the `#interuni-syringe` set…) were LEFT
  AS THEY ARE on the owner's word — those keys are mirrored and follow the web.
- **Personal passes.** When the first sync removed 30 keys the web does not give
  (16 people), each person got a per-person channel pass for exactly the rooms
  those keys had opened (`tools/discord-keep-access.mjs`, proved bit-for-bit).
  ⚠️ Passes are channel overwrites and do NOT follow the web: if one of those 14
  people leaves, their pass stays until removed by hand. They carry the audit
  reason `ทีม SAMO: keys match the web, access kept`.

### Owner rules — DECIDED 2026-09-19, do not re-ask

- **"Everything should be according to the website, except a bug like the PR
  one."** The web is the truth: change the WEB, never Discord.
- **Nobody loses a room they already had** when Discord is brought in line —
  hence personal passes, never widening a web role (a role follows the ตำแหน่ง
  and would leak to its next holder).
- **Every ฝ่าย gets a role at every level**; the 250 cap is the owner's to manage
  ("I can remove old roles later").
- `ฝ่าย COMART` / `ฝ่ายจัดหาทุน` under เวชนิทัศน์ are SEPARATE teams; the
  top-level ฝ่ายวิชาการ owns the plain `ฝ่ายวิชาการ` role; same-name siblings get
  `<name> · <parent>`. Art/Graphic was made its own ฝ่าย under ComArt.
- Power keys the web assigns are approved (SAMO Buddy; 📇 ADMINISTRATOR — its
  one other web member, เอมมี่, gets it when she links).

### What is OWED

1. **OWNER — kick `Role assignment bot for SAMO69`** (§1). Still in the guild.
2. **OWNER — narrow `samobot` from ADMINISTRATOR** (§1). The sync needs Manage
   Roles; `discord-channels.mjs` / `discord-keep-access.mjs` also need Manage
   Channels + Manage Roles in channels. Keep the bot's role at the TOP of the
   list afterwards — without Administrator the hierarchy starts to bite.
3. **OWNER — 21 keys that open rooms but follow NO ตำแหน่ง** (hand-managed):
   notably `🏅 อุปนายกฯ` (10 holders), `สมาชิกฝ่าย Backend` (7), `สมาชิกฝ่าย
   Frontend` (3). To make one follow the web, the owner names its ตำแหน่ง;
   link it (`team_nodes.discord_role_id`) after checking current holders — the
   service takes the key from anyone the web does not place there.
4. **Old role cleanup** — 238 of 250. The owner said they will delete old roles.
   ⛔ The BOT never deletes a role (channel overwrites die with it).
5. **Personal passes** do not follow the web (above). No tool lists or retires
   them yet.
6. Not built: the bot writing nicknames FROM the registry (§8e.2 of the design).

### Traps — do not re-derive

- ⛔ **Change the web, not Discord.** The service reverts Discord hand edits
  within 15 min. To stop it: `sudo systemctl disable --now samo-discord-sync`.
- ⛔ `discord-apply.mjs` WITHOUT `--add-only` removes keys and TAKES ROOMS.
  Removing on purpose while keeping access is `discord-keep-access.mjs`.
- ⛔ **Before linking an existing Discord role to a ตำแหน่ง**, list its current
  holders: the service will strip everyone the web does not place there within
  seconds. Give passes first if access must persist.
- ⛔ **Audit both axes.** A key grants per-CHANNEL access AND server-wide
  powers; checking only channels missed SAMO Buddy and the 📇 ADMINISTRATOR
  role (`docs/mistakes/authz-grants.md`).
- ⛔ **A tree grant must say which node kinds it passes through** (0196).
- ⛔ **Emoji-prefixed role names** (👑 🏅 📇): normalisers trim before
  stripping the ฝ่าย prefix, or they duplicate (`docs/mistakes/integrations.md`).
- ⛔ **`docs/` is published** — never put the webhook URL, the token or open
  weaknesses here.
- The "what did the bot do" authority is Discord's **audit log** (45 days) —
  every write carries a `ทีม SAMO…` reason. Pre-change snapshots from
  2026-09-19 lived in a session scratchpad and are gone.
- ⛔ **The two credentials never meet on a laptop.** `DISCORD_TOKEN` lives only in
  `/etc/samo-discord-bot.env`; anything needing it runs on the VM.

### Tools

```
ssh samo-vm 'journalctl -u samo-discord-sync -f'     # the live sync
npm run discord:readiness                            # counts, no token needed
node tools/discord-nickname-link.mjs --guild <dump>  # one-time nickname linking (plan by default)
tools/discord-apply.mjs      (VM)  plan by default; --add-only; --allow-power '<name>'
tools/discord-provision.mjs  (VM)  adopt/create; --create-near; qualified names
tools/discord-channels.mjs   (VM)  ฝ่าย role gets its สมาชิก role's rooms; lossless-proved
tools/discord-keep-access.mjs (VM) keys to the web, access kept by personal pass
npm run discord:report                               # read-only guild report
node tools/db-query.mjs tools/team019{5,6,7,8}-*.sql # the proofs
```

## 16b. Five live proofs RED on production (found 2026-09-21) — none from shop 0199

**Status: VERIFIED 2026-09-21 — how:** `npm run proofs` against production: 43/48 green, 5 not; house0194 then FIXED by 0200 — 4 remain OWED.
**Re-run 2026-10-20 (after 0230–0233): 70/73** — dept0177 + team0135 as below (the night agent's task 14 rewrote both on `agent/2026-10-20`; not merged yet), plus proj0176 B2, a no-op write fixed the same day. **Re-run 2026-10-13 evening: 60/62 green** — only dept0177 and team0135 (A5, unchanged) remain. **Re-run 2026-10-13 morning:** 53/57 green, the SAME 4 red (the +1 is `accounts0211-dashboard`). **Re-run 2026-10-12:** 52/56 green — the SAME 4 red (house0188, house0191, dept0177, team0135). Two new reds that day (pr0149, shop0206) were proof subjects moved by samomdkkudev's role change and are fixed (`docs/mistakes/tooling-proofs.md`).
None of the five reads a shop table; 0199 touches only shop tables and
functions, and `shop0199-pricing` + `shop0150` are green. They drifted after
the last all-green run (09-14/09-19). Two are REAL data drift, the rest look
like proofs whose SUBJECT went stale — each needs reading before "fixing":

- ✅ **house0194 60/61 — FIXED by 0200 (2026-09-21).** Cause: connecting a
  placement to an existing person never ran the down-mirror; 38 rows repaired,
  `house0194` 20/20 and `house0200-three-copies` 13/13 on production.
- ✅ **house0188 53 — FIXED by 0217 (2026-10-13), 33/33 on production.** It
  was not data: 0193 rebuilt `record_unresolved_rows` from 0188 and reverted
  0190 (`docs/mistakes/postgres-schema.md`).
- ✅ **house0191 — FIXED 2026-10-13, 28/28.** §G read the admin-only list under
  a student's claims; it now chooses an admin by the gate's own grant. Same day,
  `house0200`'s ALLOW half turned out to have been passing on an EMPTY admin
  (`role = 'dev'` matches nobody now) through a NULL-role fail-open, closed by
  0218 (`docs/mistakes/authz-rls.md`); fixed the same way, 14/14.
- **dept0177 70** — expects 4 hardcoded ฝ่ายบริหารองค์กร cards, found 5: someone
  added a card; the assertion counts a SHAPE (class 7 — assert the property).
- **team0135 A5** — "own card writes the split verbatim": got (none) — subject
  or scenario drift, unread.

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

## 16. ระบบบ้าน data handover — MD49 + MD50 done; MD51–MD54 partly answered (2026-10-13)

**Status: VERIFIED 2026-10-13 — how: the 2026-10-13 answer was imported with
`tools/house-kkumail-import.mjs --dismiss-empty --apply`, which asserts inside
its transaction that every address is one student and one person; read back
after commit (19 `admin` + 2 `dismissed` resolutions, 0 orphan people, re-run
writes nothing). Snapshot (gitignored, so not a path CI can see): `2026-10-13-kkumail-import-snapshot.json` in externaldata's house-import folder.**

✅ **SECOND ANSWER IMPORTED (2026-10-13).** The owner forwarded
`รายชื่อระบบบ้านมีปัญหา.xlsx` (one tab per รุ่น; exported per tab to
`externaldata/house-import/2026-10-13-returned/MD*.csv`). Held rows: 129 → 108.
MD49 is now complete. Two answers were REFUSED: an MD52 row whose รหัส + kkumail
were pasted from another student's row (the owner's own warning; the tool kept
the row the address belongs to, by its initials and the รหัส's alphabetical
slot), and an MD51 row whose address carries another student's initials. The
owner settled the second the same day — *"add pakphum.s@kkumail.com to ภาคภูมิ
instead"* — so that address went to the classmate it names (held 108 → 107).
Both students whose rows were WRITTEN ON stay held with no address. Seven MD52 held
rows carry the ฝ่าย's remark as `note` (ติดต่อไม่ได้ / ลาออก / คาดว่าลาออกแล้ว)
and were NOT closed — see the owed table. The two MD54 `empty_row` lines the
ฝ่าย said have no person (*"เลขนี้ไม่มีตัวตน"*) were dismissed with that reason,
so the audit now reports those two สาย as empty, correctly. Everything the old
tool would have got wrong on this file is in `docs/mistakes/app-state.md`.

`node tools/house-year-sheets.mjs --apply --gaps-only --force` writes six CSVs
into `externaldata/house-year-sheets/` (gitignored; 1,776 real students). They
are ready to hand to the data team and that is the next action — **it belongs
to the owner, not to a session.**

✅ **MD50 IS DONE (2026-09-19).** The owner sent the sheet as
`House System Issues.xlsx`; MD50 answered with its own roster (320 rows, not a
round-trip of ours) and `tools/house-kkumail-import.mjs` matched 26 of them by
รหัส+ชื่อ, 0 name mismatches, and promoted all 26 through
`promote_unresolved_row()` in one transaction. Held rows: 155 → 129. MD50 now
has 288 students and **no incomplete records at all** — its file is gone.

| owed | who | why it is not done |
|---|---|---|
| chase what is still blank — MD51 is almost entirely unanswered, MD53 and MD54 have a few; regenerate with `house-year-sheets.mjs --apply --gaps-only --force` (its dry run prints the counts) | owner | the ฝ่าย said "ตอนนี้เหลือ MD51, MD53, MD54 เหลือ 2 คน" — they know |
| the two students whose rows carried someone else's answer (one MD52, one MD51) | ฝ่ายข้อมูล | their own รหัส/kkumail were never given — only the person or their friends know them |
| ~~close or keep the MD52 rows marked ลาออก / คาดว่าลาออกแล้ว~~ | ✅ **BUILT 2026-10-13 (0217)** | Owner: *"handle the flow for … คาดว่าลาออกแล้ว ติดต่อไม่ได้ ลาออก เลขนี้ไม่มีตัวตน, the entire flow"*. Each is now a recorded answer (`follow_up`), set in ยังนำเข้าไม่ได้ or by the import tool from the ฝ่าย's remark: ติดต่อไม่ได้ / คาดว่าลาออกแล้ว keep the seat OPEN and claimable; ลาออก / ไม่มีคนนี้จริง CLOSE it, and the สาย stops counting as a gap; any close can be reopened. Answers survive the next roster import and a closed seat is not re-asked. The 2026-10-13 remarks were backfilled |
| the five คนที่ยืนยันตัวตนไม่ผ่าน (2026-10-13) | owner / ฝ่ายข้อมูล | All five typed a VALID รหัส (check digit passes). Three are MD47/MD48 — outside ระบบบ้าน, owner already decided not to add (§16 table above) — close them with the prefilled reason. Two are MD54 with no line in the faculty's file at all (one numbered past the MD range — likely another สาขา): only ฝ่ายข้อมูล can give their สาย. The pane now says which is which |
| check **สาย 141** against the source file | owner / ฝ่ายข้อมูล | MD53 and MD54 both have nobody on it, and after the 2026-09-19 รุ่น repair NOTHING unplaced can explain either. บ้าน is สาย's last digit, so if a column moved everyone after it is in the wrong บ้าน |
| ~~check สาย 141 / decide สาย 256~~ | ✅ **ANSWERED 2026-09-19 — LEAVE IT** | The MD53 leader: *"ที่หนูจดไว้ตามนี้เลยค่ะ เพื่อนหนูเอาข้อมูลมาจาก 52 อีกที สาย 256 ซ้ำ 2 คนค่ะ แล้วก็ 141 ข้ามตามที่ลงไว้เลยค่ะ"* — transcribed that way from MD52, deliberately. **That rules out the thing worth worrying about**: not a shifted column, so every person's สาย is recorded correctly and NOBODY is in the wrong บ้าน. The owner's call is to leave it: the list is mostly right and they would not change it now. The audit will keep reporting it — that is cosmetic |
| ~~the 11 MD47/MD48 people in MD50's returned roster~~ | ✅ **DECIDED 2026-09-19 — DO NOT ADD** | ระบบบ้าน covers MD49–MD54 only; these were never in ฝ่ายข้อมูล's roster and have no สาย. Owner: *"i'll not put in the system"*. ⛔ Do not re-propose |

| ~~write the import-back tool~~ | ✅ **BUILT 2026-09-19** | `tools/house-kkumail-import.mjs`. Refuses a row whose name does not match the รหัส, promotes through the pane's own `promote_unresolved_row()` rather than re-implementing it, and runs as ONE transaction so a duplicate address cannot leave half a ฝ่าย's answer applied. It also carries a ชื่อเล่น the roster happens to include — never over one that exists |

**What the sheet asks for**: a `?` in a `กรอก: <field>` column, per row.
How many rows want each field is the generator's dry run, not this line (it went 155 → 129 → 108 as answers came back). **The `?` is not
decoration — it is the highlight.** A CSV carries no formatting, so a colour
does not survive export or re-import; a character does.

⚠️ **`ความสำคัญ = ต่ำ` means "do not chase"** — 26 rows missing only a ชื่อเล่น.
The owner said so explicitly. Do not "improve" the sheet by requesting them.

---

## 17. The night agent — RE-ARMED 2026-10-20 for tasks 13–23, the quality queue (history below is older)

**2026-10-20 — NEW QUEUE ARMED. Status: VERIFIED 2026-10-20 — how: `install.sh --arm`
replaced the live queue (old one kept as `.prev`), the live gate printed `เหลือ 9 งาน ·
คืนที่ 1 จาก 30`, no STOPPED file.**
- Tasks 8–12 finished 2026-10-19 21:14 UTC (3 of 5 resumed after a quota cut; runner
  report in the VM log). Their branch `agent/2026-10-18` is still UNREVIEWED and
  unmerged — §22 is its checklist.
- Owner (2026-10-20): spend the reset week on improving samoweb, all 7 sessions
  (`Reserve sessions: 0`, `Revise passes: 6`, `Budget: 30 runs`, `Until`
  2026-10-27 08:00 UTC). Tasks, in priority order: 13 the §18f/§23f leftovers ·
  14 samo-dev auth triggers + the two red proofs · 15 security property guards +
  the open privacy item + Apps Script upload limits · 16 ESLint (correctness
  rules only) · 17 axe + 390px student-flow sweep · 18 phone load speed +
  `check:bundle` · 19 split `src/js/shop/admin.js` and `src/js/team/index.js` (moves only) ·
  20 tests for untested business rules · 21 Passport on a phone (a11y, flaky
  network, speed) · 22 scrutinize · 23 HANDOFF §24. Tasks 20–21 were spliced into
  the LIVE queue mid-run (owner: fill all 7 sessions); the running loop keeps its
  start-time count, so the run that was live then stops after 21 and the next run
  does 22–23.
- `agent/2026-10-20` was created on the VM from `agent/2026-10-18`'s tip
  so it STACKS: review and merge 10-18 first, then 10-20. Its own
  work is `agent/2026-10-18..HEAD`. Migrations 0234–0241 are reserved.
- OWED (owner): nothing until it finishes. If you want a session for yourself
  this week, book it on the board.
- **2026-10-20 07:30 ICT — owner used the free reset. Status: VERIFIED — how: a
  fresh `samo-claude-usage` sample read `five_hour_pct 0`, `seven_day_pct 0`.**
  The week's RESET TIME did not move (still 2026-10-21 08:59 UTC), so this is
  ~32 h, ~6 windows, not a new 7-day week. Owner: stop at that reset — `Until`
  is now 2026-10-21 08:30 UTC (live file + repo; `.prev` kept). Unfinished
  tasks stay queued for a later `--arm`.
- **2026-10-20 12:47 ICT — RUNNING task 15. Status: VERIFIED — how: the VM journal
  printed `[3/11] 15. Security sweep … ทำต่อจากรอบที่ถูกตัด (WIP 1714867)`.** Task 14
  done 09:23 ICT; task 15 was cut by the 5-hour limit at 09:51 ICT and every tick
  until 12:27 ICT logged `not now: รอบ 5 ชั่วโมงนี้ใช้ไป 100%` — silent by design, so
  it LOOKS dead. Ask the VM, not Discord: `journalctl -u samo-night-agent.service
  -n 30 -o cat`, and `cd ~/samo-night && node queue.mjs gate NIGHT-TASKS.md
  usage.json bookings.json` (rc 0 = the next tick runs). Task 13's
  `[needs-review]` is EXPECTED — the owner session wrote its block and merged it
  (§18f "VERIFIED 2026-10-20"); there is nothing to review.
- **Task 13 hit `Reached max turns (200)`** after 29 min with its four parts
  committed but no `## Task 13` block, so it reads "not passed" (attempt 1 of
  2) and re-runs. The VM drop-in `tonight.conf` now sets `TASK_MAX_TURNS=400`
  (`.bak-20261020` kept) — the 200 default is from short tasks.
- **OWED — the booking board does not see a manual reset. Status: VERIFIED
  2026-10-20 00:31 UTC — how: `bookings.json` `right_now.session` read window
  21:00–02:00 UTC, `booked_pct 100`, `free_pct 0`, while the same minute's
  sample read 0% / 0%.** The 21:00–23:00 booking anchored that window, and a
  sample at 0% (no window open) does not replace it, so the agent — an
  unbooked user, by the owner's rule — waits until 02:00 UTC with the quota
  empty. It cost ~1.5 h once; fix it in `get_claude_board()`'s window choice
  only if resets become routine (prove it with the claude quota proofs).

**2026-10-19 — RUNNING TO 100%. Status: VERIFIED 2026-10-19 — how: the live
gate on the VM printed `สัปดาห์ 80% (หยุดที่ 100%)`, `allowance` returned
`"stop":null`, and the journal shows the 19:27 ICT run resuming task 10.**
- The owner asked for the week to be spent to 100%: a one-time free reset has to
  be used before 22/10. Live `~/samo-night/NIGHT-TASKS.md` header: `Reserve
  sessions: 0`, `Revise passes: 6`, `Budget: 20 runs`; `Until` unchanged
  (2026-10-21 08:30 UTC, just before the weekly reset). The previous header is
  kept beside it as `NIGHT-TASKS.md.<stamp>.prev`.
- **OWED (owner):** use the free reset once the week reads 100%. After that the
  agent continues on the next tick, with no action needed. To use it past
  `Until`, edit that line on the VM.
- **HYPOTHESIS until it runs:** revise-only runs once tasks 10–12 are terminal.
  A finished queue with `Revise passes:` now keeps running REVISE.md passes
  instead of writing STOPPED. Tested in `night-queue.test.js` and not yet seen
  live. Check the journal for `รอบทบทวนหาบั๊ก`.
- Reserve 0 is per queue. The next `--arm` with a header lacking the line
  defaults back to 1.
- ✅ **No longer a hypothesis:** a real `claude -p` stopped by the watcher left a
  clean WIP commit (2026-10-19 18:23 ICT), and the next run resumed it. That
  stop was mislabelled as a booking yield; fixed the same day
  (`docs/mistakes/tooling-proofs.md`, "showed nobody booked").
- Noise, not a fault: `deploy:owed` warns that 0224 no longer matches production.
  The 2026-10-14 handover fix added a comment-only "superseded order" note after the migration was
  applied, and 0227 carries the real fix. Leave it.

**Status: VERIFIED 2026-10-18 — how: the live gate refused, the VM code diffs clean, rehearsals and tests green, each listed here:**
- the live gate on the VM, reading the real board, refused with the 21:30–00:00
  booking (journal: `not now: มีคนจอง Claude ไว้ …`)
- the VM's `run-night.sh` and `queue.mjs` diff clean against the repo; the live
  queue file is byte-identical to `server/night-agent/NIGHT-TASKS.md`
- three scratch rehearsals on the VM with a stub `claude`
- 69 tests in `src/js/night-queue.test.js`, each new rule shown red when removed

**HYPOTHESIS until the first real run:** that a real `claude -p` stopped by the
watcher leaves a clean WIP. The rehearsals used a stub.

**What it is doing.** Queue = `server/night-agent/NIGHT-TASKS.md` (its preamble
states every constraint). It obeys the Claude booking board as an unbooked
person would: no new work during a booking, a booked window keeps the
booker's %, and a booking made while a task runs does not stop that task. Rules
and mechanics: `skills/night-agent.md`, top section.

**Morning checklist (owner):**
1. Discord, the night-agent channel: the runner's per-task verdicts (`✓` = clean, `!` = look).
2. `ssh samo-vm 'grep -E "^## |^Status|^Note" ~/samo-night/NIGHT-TASKS.md'`
3. `git fetch samo-vm:samo-agent agent/2026-10-18:refs/remotes/vm/agent/2026-10-18`, then review
   `git log --oneline origin/main..vm/agent/2026-10-18` and `docs/state/night-agent.md` (its
   `## Task N` blocks). ⛔ Nothing it wrote is on production. Apply its migrations only
   after review, in order, proof before and after (§22 rows 8–12).
4. To take the window back NOW: `ssh samo-vm 'pkill -f run-night.sh; pkill -f "claude -p"; touch ~/samo-night/STOPPED'`
   (runner FIRST); `bash server/night-agent/install.sh --arm` resumes.

**Known limits, not bugs:**
- The board copy is ≤15 min old, and the reporter's ticks (:10/:25/:40/:55)
  and the agent's (:07/:27/:47) are not aligned. So a booking's end is acted
  on up to ~30 min late, and a booking made <15 min before a start can be missed.
- `~/.claude` is read-only inside the unit (`ProtectHome=read-only`). The
  October runs completed under it; the reporter owns the OAuth refresh.

**September record below:** its "STOPPED", "fires 15:41" and "fingerprint"
statements are superseded.

### (September) The night agent is STOPPED, and what it is holding (2026-09-18)

**Status: VERIFIED 2026-09-18 — how: `systemctl is-active` returned inactive,
`systemctl list-timers --all` no longer lists the unit at all, and `pgrep -af
claude` on the VM found nothing running.**

It was not a scheduling bug. `OnCalendar=*-*-* 15:41:00` is daily BY DESIGN,
one minute after the 5-hour window resets. The waste was that
**`~/samo-night/NIGHT-TASKS.md` is never consumed**: unchanged since
2026-09-15 23:24, so the same 6 tasks re-ran every night, and tonight's run
had branched from `main` WITHOUT the previous night's 16 commits.

✅ **The stranded work is no longer stranded.** `agent/2026-09-17` is MERGED
(see `git log --oneline --merges` and STATE.md) — the per-รุ่น CSV generator, the ผังตามสาย grid and three
class-6 fixes the agent found in its own earlier work. The older branches
(`2026-09-15*`, `2026-09-16`) are SUPERSEDED by it; `2026-09-18` is empty.
They still exist in `~/samo-agent` on the VM and can be deleted.

✅ **IT CAN NO LONGER REPEAT ITSELF (2026-09-19).** `run-night.sh` now
fingerprints `NIGHT-TASKS.md` and **refuses to start** if the file has not
changed since the last run that REACHED THE END — it posts why to Discord and
exits 0. The stamp is written at the END on purpose: a night abandoned half way
(quota gone, box rebooted) has NOT been done and the next night must pick it up.
`NIGHT_FORCE=1` re-runs a queue deliberately, and having to type it is the whole
difference. Proved four ways: fresh queue RAN · same queue REFUSED · same queue
with FORCE RAN · edited queue RAN.

⚠️ **The script on the VM is a COPY.** The guard is in git; `~/samo-night/` has
its own. `bash server/night-agent/install.sh` is what puts the new one there —
until that runs, the VM still has the version that repeats.

✅ **THE CONTINUATION WORKFLOW IS BUILT (2026-09-19).** The queue is STATE now:
`Budget: N nights` that the human writes and the runner decrements, and per task
a `Done when: <shell command>` that the RUNNER executes — its exit code is the
status. The agent never writes its own verdict. The check also runs BEFORE the
task, and a check already passing means the task is skipped, not credited. `Done
when: once` is the honest escape for a plan task: one attempt, then
needs-review, never retried. Format and reasoning: `skills/night-agent.md`;
state machine + 15 tests: `src/js/night-queue.test.js`.

**Still write a new queue before re-enabling.** Then
`bash server/night-agent/install.sh` (syncs memory + ships queue.mjs) and only
then `bash server/night-agent/install.sh --arm` — installing no longer arms.

---

## 18. SAMO Shop + registry sync — what the 2026-09-21 session left open

**Status: VERIFIED 2026-09-21 — how:** each item below says how it was checked; the WHY and the full measurements are in `docs/state/claude-2026-09-21.md`. Shipped and live: kita's redesign, per-size prices (0199), server-side prices, Discord order messages, `core-*` chunk rename, registry sync + mismatch panel (0200), pickup picture (0201), preorder popup, phone navbar overlap.

**Owner-only**
- **OWED — rotate the shop Discord webhook.** The owner pasted its URL into the
  chat on 2026-09-21; it now lives only in the VM's `/etc/samo-notify.env`
  (`DISCORD_SHOP_WEBHOOK`). Discord → channel → Integrations → Webhooks →
  regenerate; replace the value with sudo, never printing it (lengths only);
  `sudo systemctl restart samo-notify`.
- **OWED — see one real Discord order message.** Never observed in the channel:
  no web order has been placed since it shipped. The live service was checked
  only by its refusals (no token; bogus token → `order read HTTP 401`). A marked
  test message was offered, not sent. First real order = first real check.
- **HYPOTHESIS — Stay/Userscripts blocked the old `analytics-*.js` chunk.** The
  fragility is MEASURED (block that one file → portal dead; renamed `core-*`
  now). That Stay was the blocker is NOT: five standard lists match nothing.
  Needs: owner's iPad with extensions ON → if the bar appears, its
  "ดูรายละเอียด" now names each file 200/404/BLOCKED.
- **OWED (shop team) — a picture for the live pickup announcement.**
  "น้องอุ่นใจผลิตเสร็จแล้ว" links a product that was DELETED, so it shows the
  stripe until an admin adds a picture in the announcement editor.
- **OWED (shop team) — spec the first promotion** before anything is built.
  Recommended design (not built): session notes §10.

**Buildable, small**
- **OWED — CSV export carries only the latest slip.** `admin.js` export writes
  `slip_count` + `slip_url` (newest). Add all slip URLs if the shop team uses it.
- **HYPOTHESIS — checkout QR can disagree with the order if an admin edits a
  price DURING someone's checkout.** The cart re-prices on every product load and
  the server charges `shop_unit_price`; the window is between load and "place".
  Not measured; accepted as rare.
- **OWED — "เพิ่มสลิป only works after deleting" was NOT reproduced** (DB replay
  as the buyer: accepted; headless page: 2 slips saved). Slips now upload ~7×
  smaller, which removes the ~60 s upload the timeline showed. If it recurs, get
  the toast text and the device before theorising.
- **VERIFIED 2026-09-21 — how: stubbed headless Chrome only** — the ระบบบ้าน
  mismatch panel + ซิงก์ให้ตรงกัน button, and the announcement-picture editor,
  have NOT been driven signed in as a real admin. First real use is the check.

**Decided — do not re-open**
- **DECIDED 2026-09-21** — the shop's espresso/milk/sky look is what the SAMO
  Shop team wants; the shop identity lives INSIDE the shop pane, never the navbar.
- **DECIDED 2026-09-21** — a buyer may attach several slips (two transfers, a
  clearer re-take); admins see every slip with its time.
- **DECIDED 2026-09-21** — the Discord order message never carries phone, email
  or the slip image; the title links the order in /admin/.
- **DECIDED 2026-09-21** — main card / ทีม SAMO / ระบบบ้าน must always match; a
  repair fills blanks and the main card wins, never overwriting a value with a blank.

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

## 18b. SAMO Shop full bug sweep (2026-09-22) — what is left

**Status: VERIFIED 2026-09-22 — how:** three code reviewers plus a database
review; every finding re-traced before it was fixed. 0202 is applied on dev AND
production: `shop0202-stock-rule` is 22/22 on both, 14/14 of its refusals red on
the pre-0202 bodies, and `shop0199` is 20/20. Unit tests: `read-file`,
`reserved-rule`, `data` (cartLineProblems, bannerLinkTarget, CSV cells), `qr`,
`utils` (safeUrl), all mutation-checked. The write-ups name each bug.
⚠️ NOT driven in a browser signed in as a buyer or admin. The checkout lock,
the unsure-network lookup and the before-payment block are traced and
unit-tested, not clicked.

**Owner-only**
- **OWED — the Apps Script upload handler for shop files needs server-side
  limits** beyond the existing top-folder allow-list (what it accepts, and
  exactly where it may write). It needs a production
  Apps Script redeploy, which is owner-approved per CLAUDE.md. The detail
  stays out of `docs/` until it is fixed (the repo and `docs/` are public).

**Shop team decisions**
- **OWED — the "รายรับสะสม" card now counts ONLY orders whose slip was
  checked** (it used to include slips waiting for review, and rejected ones).
  The number went DOWN on purpose; tell the shop team why.
- **OWED — checkout has no note box, but the code still sends one** (always
  empty). Restore the field, or drop the dead code. It is a shop-team call.

**Buildable, small**
- ~~the cart drawer's + button is capped at 99, not at stock~~ → DONE
  2026-09-23: capped at what is left of that size/colour (the popup's rule,
  `availableForVariant`); disabled at the cap. Checkout still re-checks.
- ~~HYPOTHESIS — the team/house CSV exports may have the same formula-injection
  shape~~ → **CONFIRMED and FIXED 2026-09-23**: one `csvGuard`/`csvUnguard` in
  `utils.js` for all three exports, undone on import (`docs/mistakes/app-state.md`).
- **VERIFIED 2026-09-22 — how: `npm run deploy:gas -- --verify` → "live
  endpoint runs the NEW code"; `--dry-run` → remote code matches
  `appscript/prform.gs` byte for byte.** The Apps Script is fully deployed; no
  `.gs` changed today. (The probe now retries Google's intermittent HTML "busy"
  page; before, one such page read as "unrecognised response".) The upload
  limits above are the only Apps Script work owed.
- **VERIFIED 2026-09-22 — how: a fresh reviewer read the whole day's diff
  cold, beside my own pass.** No blocker. Fixed in the commit
  "second-pass review of the sweep":
  - the retry lookup now runs before the stock check;
  - a 5xx counts as an unsure write;
  - the image in-use check reads the server;
  - the verify queue now sees the new `updated_at` after a note edit;
  - one stock fetch at a time;
  - projects send re-stages the files after one is removed;
  - safeUrl encodes UTF-8 correctly.

  Checked on live data and clean: 0 banner links in an odd format, and 0 colours
  without an id.
- **HYPOTHESIS — QR scanner double-fire / camera left on** were PLAUSIBLE in
  review and fixed defensively (a per-open session with a latch). They were not
  reproduced on a device.

## 18c. SAMO Shop — product gallery (several pictures, zoom, colour pictures)

**Status: VERIFIED 2026-09-22 — how: `shop0203-gallery` 20/20 on dev and production (0203 + 0204, the RLS allow beside the deny), headless Chrome on the popup, and `tools/browser/shop-admin-strip.mjs` driving the admin strip SIGNED IN.** In detail:
- migration 0203 is applied to dev and production. Before the migration the
  proof errors, as documented;
- the popup gallery and lightbox were driven in headless Chrome at 390 px and
  1280 px:
  - the pictures load, the colour jump and the swipe work;
  - tapping opens the viewer inside the modal, and Esc and the back button each
    close only the viewer;
  - no console errors;
- a reader-registry test, mutation-checked.

- **The admin strip, driven signed in** on samo-dev with a throwaway account
  and every Apps Script call intercepted. Command:
  `node tools/browser/shop-admin-strip.mjs` (needs `npm run dev`). What it
  checked:
  - pick 3, styled (the tiles' computed width is asserted);
  - reorder and a colour tag;
  - save: 3 uploads, the cover is derived, the tag is kept;
  - reopen, remove 1, save: exactly 1 delete;
  - no console errors, and cleanup to 0.
- **A cold review of the build found and fixed**:
  - the strip's CSS was on a page that never loads it;
  - a stale-tab trigger gap (0204);
  - a double-open of the lightbox;
  - late file reads when several files are picked;
  - saving while pictures were still being prepared;
  - leaked previews and drag handlers;
  - Drive-style URLs;
  - colour labels on old order lines;
  - duplicate colour ids.

  `docs/SHOP-GALLERY.md` header has them.

⚠️ **Still NOT checked:**
- pinch-zoom on a real iPhone;
- a REAL Drive upload from the strip (the tool intercepts Apps Script by
  design). The first real admin upload is that check.

~~Earlier status: DECIDED 2026-09-22 — design only.~~ The owner asked for
several pictures per product, tap-to-zoom, and a picture that follows the chosen
colour. The full design, with the measured facts it rests on, is
`docs/SHOP-GALLERY.md`:

- an `images jsonb` column, with `image_url` kept as a cover that a trigger
  maintains;
- PhotoSwipe loaded with a dynamic import;
- picking a colour jumps to that colour's picture and never filters the rest;
- five steps, each shippable on its own (§9).

- **BUILT — all five steps of §9.** Where each piece lives is in the header of
  `docs/SHOP-GALLERY.md`.
- **OWED (owner / shop team) — one REAL upload.** Add a picture to a real
  product in `/admin/` and save, then check it shows on the storefront. This is
  the only part no test covers: the real Apps Script → Drive path for product
  pictures.
- **VERIFIED 2026-09-22 — how: `curl` from the KKU LAN timed out around 10:31Z
  and answered 200 again by 11:10Z; check-host.net got 200 from outside
  throughout.** Nothing is owed. It recovered by itself, with nothing changed
  on our side. The CAUSE (KKU's reverse proxy failing KKU-internal clients) is a
  hypothesis, and the recipe for next time is in `skills/deploy-vm.md`. How it was narrowed down:
  - `curl https://samo.md.kku.ac.th` timed out from a laptop on the KKU LAN;
  - check-host.net got **200** from Canada, Germany and Spain, and timed out
    from Moscow;
  - on the VM, nginx answers locally, and tcpdump showed the inbound SYNs
    arriving and the VM answering;
  - the VM serves a self-signed certificate for 10.101.111.181. The public
    certificate is on KKU's reverse proxy at 202.28.95.46, so the break is in
    that proxy's route back to KKU-internal clients.

  Nothing in the deploy touched nginx. To verify from inside KKU when it
  happens: `ssh -L 8443:127.0.0.1:443 samo-vm`, then Chrome with
  `--host-resolver-rules="MAP samo.md.kku.ac.th:443 127.0.0.1:8443"
  --ignore-certificate-errors`. If it lasts, tell KKU IT.
- **DECIDED — the three §10 defaults were built:**
  - ~~at most 8 pictures~~ → UNLIMITED (owner, 2026-09-22; 0205 applied dev+prod; picking >20 at once asks first);
  - picking a colour jumps to its picture and never filters the others;
  - cart and order thumbnails follow the chosen colour.

  The owner can override any of them.
- ✅ **DONE — the picture in-use check reads `images[]`**
  (`trashImageIfUnused` in `admin.js` flattens every product's pictures, and
  reads the server, not `state.*`). `pictures-readers.test.js` asserts it.

## 18d. Shop pictures: unlimited — what the session ran out before finishing

**Status: OWED 2026-09-22 — the session hit its token limit mid-change.** Done and deployed: 0205 (no count check, dev + prod,
`shop0203-gallery` 19/19), the admin strip with no cap (counter "N รูป", a confirm above 20 files at once). NOT done:
- ~~one DOT per picture on a phone~~ → DONE 2026-09-23: above `DOTS_MAX` (8) a "3 / N" counter (driven in a browser: 6 → dots, 12 → "3 / 12");
- ~~uploads on save not paced~~ → DONE 2026-09-23: `UPLOAD_GAP_MS` 500 between uploads in `saveProductForm`;
- ~~docs still say 8 in places~~ → DONE 2026-09-23 (README, CONTEXT, SHOP-GALLERY §2/§3/§10, and the
  release note, which shipped in v4.8.0 saying "ไม่จำกัดจำนวน").

## 18e. Discord bot: nicknames, the admin panel — what is left (2026-09-23)

**Status: OWED 2026-09-23 — owner decision on one link; everything else VERIFIED how: 0207 `discord0207-nicknames` 9/9 and 0208 `discord0208-panel` 14/14 on dev + production; the live bot's first pass after apply renamed 4, the next renamed 0 (idempotent); `discord_bot_status` heartbeat read back from production.**

- **Check the ธิเบธ → เซฟ link (owner / ฝ่าย data).** Discord account `…6758`
  was linked on 19 Sep by the nickname import as a HAND-CONFIRMED near match
  (same last 4 digits, 334-2, different ชื่อเล่น). The bot has now named it
  `เซฟ_#3_334-2` from the website. If that is a different person, the link is
  wrong and has been steering that account's ROLES too since 19 Sep: unlink in
  ทีม SAMO, and have the right person press เชื่อมบัญชี Discord.
- **Grant `discord_bot`** to whoever should run the bot from /admin/ →
  บอท Discord (masters already can).
- The Claude page's `card-soft` class has no CSS rule anywhere (found while
  building the bot panel) — decorative dead class, harmless; delete or style.

## 18f. Cold review of 2026-09-23's work — findings NOT yet fixed on main

**Status: VERIFIED 2026-10-20 — how: night agent task 13 (unit tests, each fix red with it reverted), reviewed and merged to main by the owner session 2026-10-20; the nginx line is in the repo but is installed by hand (see below).** Two independent reviewers read the 2026-09-23 diff cold; each finding below was theirs, re-read against the code. `npm test` and `npm run build` are green on `agent/2026-10-20` with every CONFIRMED item fixed. See `docs/state/night-agent.md` "Task 13" for the full account.

Discord bot (`server/discord-sync.mjs`) — ~~fixed on `wip/discord-review-fixes`, not merged~~ → **cherry-picked onto `agent/2026-10-20` (the one commit on `wip/discord-review-fixes`); its 2 red tests fixed to the restructured design, not reverted** (`docs/mistakes/integrations.md`):
1. a pause does not stop a pass already running (write() now re-checks the switch every 3 s; `Paused` is not a failure);
2. empty `discord_role_targets()` counted as success (posts "recovered", retries every 5 s, no heartbeat) → now a failure;
3. web text (edit detail, editor name, pause reason) posted unescaped → `mdLine` (a ชื่อเล่น `<@id>` / `[x](url)` renders);
4. start-up failure crash-loops with no alert → boot() inside the retry loop;
5. `alerted` stuck across a pause → one `succeeded()` for every good round;
6. failed nickname writes re-posted after every restart → posted only for a person a web edit named;
7. "check now" compared two machines' clocks → compares the request value;
9. missing settings row fails OPEN → now paused. (8, queue rows dropped on a failed write — **checked 2026-10-20, left on purpose**: the next 15-min full pass re-scans everyone regardless of the queue, so a row dropped after a held/failed write still heals itself; no code change.)

Front end:
- ~~**CONFIRMED** popup: with no colour picked, + goes to 99…~~ **FIXED 2026-10-20** — `qtyCeilingFor`/`isColorMissing` (pure, exported) replace the inline cap; wired into both the `+` handler and the colour-click handler. `src/js/shop/products.test.js`. `docs/mistakes/frontend-ui.md`.
- ~~**CONFIRMED** cart: `addItem` merges quantities with no stock check…~~ **FIXED 2026-10-20** — `addItem(item, maxQty)`; the popup passes `qtyCeilingFor(...)`. `src/js/shop/state.test.js`. `docs/mistakes/app-state.md`.
- ~~**CONFIRMED** บอท Discord tab: every 20 s poll `say('')` clears a save error…~~ **FIXED 2026-10-20** — `load({ silent })`; `paint()` skips the DOM write when unchanged. Checked `src/js/accounts/admin.js`'s same-shaped `pulse()` too — not the same bug there (no mutating action to collide with); no change made. `src/js/discord-bot-admin.test.js`. `docs/mistakes/frontend-ui.md`.
- ~~**CONFIRMED** CSV: a real value `'=x` exports unchanged and imports as `=x`…~~ **FIXED 2026-10-20** — `csvGuard` escapes a leading `'` too (doubling it); `csvUnguard` always strips exactly one, no guessing. 2000-case property test. `docs/mistakes/app-state.md`.
- **PLAUSIBLE, still OWED 2026-10-20 — could not reproduce: no headless Chrome in this sandbox** (no Chrome/Chromium binary, no `puppeteer`/`playwright` dependency, and this sandbox's network tool calls are denied, so `npx playwright install` is not an option either). Both need a REAL browser's Canvas/WebP encoder, which jsdom does not have — these are unverified, not disproven:
  - news covers forced to JPEG (`-rj`) — a transparent PNG logo would go black; the no-alpha check was measured on shop pictures only.
  - `image-resize.js`: Safari's JPEG-on-white fallback now applies to EVERY caller (dept pages, crop, banners, slips) — flattens a transparent PNG; the fallback also ignores the caller's quality.
  - **What would close this**: on a machine with Chrome (or `npx playwright install chromium`), load a transparent PNG File, stub `HTMLCanvasElement.prototype.toBlob` so the `image/webp` call returns `null` (simulating Safari), run it through `downscaleImage`, then decode the result and sample a pixel that was transparent in the source — confirms/refutes the "flattens to white, ignores caller quality" claim precisely.
- ~~**PLAUSIBLE** nginx `/img/`: default cache key includes the query string…~~ **FIXED (written, NOT installed) 2026-10-20** — `proxy_cache_key "$1=$2";`. Owner installs by hand: `scp server/nginx-samo.conf samo-vm:/tmp/… && ssh samo-vm 'sudo cp … && sudo nginx -t && sudo systemctl reload nginx'`. `src/js/nginx-routes.test.js`. `docs/mistakes/deploy-hosting.md`.
- minor: ~~the lh3 `preconnect` in index.html is now unused~~ **CHECKED 2026-10-20, NOT unused** — `me-page.js`'s `paintAvatar` sets the home page's signed-in avatar to `user.picture` (a Google OAuth URL, almost always `lh3.googleusercontent.com`) directly, on every host including production. Left in. The other half (`?authuser=0` breaking through `/img/`) is still untouched — out of this task's scope.

Also still owed from §18e: the ธิเบธ → เซฟ link (owner) and granting `discord_bot`.
Unreleased notes are staged in `PENDING` (the popup colour change, news covers, cart cap, admin dialogs, CSV) — 2026-10-20 added entries for the 4 CONFIRMED front-end fixes actually landed this session.

## 18g. SAMO Shop admin — ยอดขาย, ต้องจัดการ, the slip queue, order ประวัติ (2026-10-15)

**Status: VERIFIED 2026-10-15 — how:** unit tests (`sales.test.js`, `order-facts.test.js`, mutation-checked: a `review` order counted as revenue and string-compared timestamps each turn them red); `tools/browser/shop-admin-tour.mjs` signed in as a throwaway `samoshop` account on samo-dev at 1280 and 390 px (no sideways scroll, no console error; period filter, chart arrow keys, jump-to-orders, the A/R keys reaching the button, dead while typing, dead on another admin page; the last one red with the old check restored); two independent code reviews (10 findings on the attention/queue/popup commit, 6+ on the ยอดขาย commits) with every finding fixed and tested; served bundle grepped on production (the sha: STATE.md). No schema change, no new read path: everything reads the rows `listAllOrders()` already loads under the existing admin RLS. Session note: `docs/state/claude-2026-10-15.md`.

**OWED — the first REAL slip at full size.** samo-dev has no slip files, so the
queue's big slip was only ever seen in its "โหลดรูปสลิปไม่ได้" state. The first
real check on production is the shop team's first slip. If a slip renders
blank, `slipSrc()` (admin.js) asks lh3 for `=w1600-rj`; a Drive file that is
not public returns an HTML page — the fallback note should appear.

**OWED — the shop team sees ยอดขาย with real data.** Production-shaped data was
drawn from an in-page fixture (`FIXTURE=1` on the tour), never production
itself. A six-size product in บาท is wider than a phone; the grid scrolls inside
its card — not yet seen.

**OWED (shop team) — the order of the slip queue changed.** It is oldest slip
first now (it was newest order first). Tell them; a "newest first" preference
is one sort in `reviewQueue()` (order-facts.js).

**DECIDED 2026-10-15** — revenue on ยอดขาย = checked-slip lines (`isRevenueOrder`,
the รายรับสะสม / 0206 rule); unchecked money is shown aside, never in. A fee or a
hand-edited total shows as its own line, never folded into a product.

**DECIDED 2026-10-15** — a tile's count is the predicate of the filter its click
applies, within the admin's แหล่งที่มา; the รอตรวจสลิป tile is NOT scoped (the
queue is not). มีปัญหา = PAID orders with a line flagged issue.

**HYPOTHESIS — pickup is not frozen on an order.** `shop_orders.pickup_location`
is null on all 44 production orders; checkout sends null and the place comes
from the product's CURRENT `pickup_location_id`. The popup says "จุดรับตอนนี้"
for that reason. Freezing it at order time would be a migration + a
`place_shop_order` change — not asked for, not built.

## 19. บัญชีผู้ใช้ dashboard (0211) — what it leaves open (2026-10-13)

**Status: VERIFIED 2026-10-13 — how:** `accounts0211-dashboard` 15/15 on production; `tools/browser/accounts-dashboard.mjs` 14/14 signed in as a throwaway master on samo-dev (the total on screen = `auth.users`, a sign-in written to the database appears with no reload, a 390px phone does not scroll sideways, no console error). The anomaly checks were run against the real production payload before shipping (`bug` checks all 0). The items below are OWED.

1. **samo-dev has NO triggers on `auth.users`** (production has five: `on_auth_user_created`, `…_passport_link`, `…_email_change`, `…_password_sync_insert/_update`). On dev a sign-up creates NO `public.users` row, and the has-password mirror never runs. Every harness that registers an account on dev writes that row by hand, which hides the gap. Fix: re-create the five on samo-dev from production's `pg_get_functiondef`/`pg_get_triggerdef`. Check: `accounts0211-dashboard` on dev goes from 13/15 (its row "on_auth_user_created is installed" says why) to 15/15.
2. **Managing accounts is read-only for now.** The page shows, filters, explains and exports; it does not delete, ban, reset passwords or merge. Those write to `auth.users`, which needs its own definer RPCs with a confirm step, a log, and a both-direction proof. Ask the owner which actions they actually want before building any.
3. **What the first production read found** (counts move; re-read the page, not this line): 2 people moved Passport to kkumail and still hold their old gmail account (`ย้ายไปบัญชีใหม่แล้ว แต่บัญชีเก่ายังอยู่`); 5 accounts created 2026-05-22 never signed in (test names: Ung, Qwerty, Dog, se); 94 kkumail accounts are not in the person registry; 158 carried Passport profiles have no account (EXPECTED, see INVARIANTS "Passport totals"). Deleting any of them is the owner's call, not a session's.

## 20. Night agent run of 2026-10-13 — reviewed and shipped; what is left

**Status: VERIFIED 2026-10-13** — how: `node tools/run-proofs.mjs proj0212|dept0213|passport0214` (and `-- --dev`), `npm test`, the VM rehearsal below. Branch merged into `main`; 0212, 0213, 0214 applied to samo-dev then production, each proof green on BOTH (`proj0212` 15/15, `dept0213` 9/9, `passport0214` 12/12 — three of the agent's proofs were broken and fixed on first run); `npm test` 2615/2615, build green. The runner's interrupted-task bug is fixed and rehearsed on the VM (`docs/mistakes/tooling-proofs.md`, "all 6 tasks done, nothing was skipped").

What changed from the agent's version, and why:
- **0213 grants nothing** (owner: "it's config from the permission of teamsamo หน้าฝ่าย"). The draft set `dept_page` on all 12 top-level ฝ่าย, assuming the first six already had one; production had NONE, so it would have let ~240 accounts edit and publish at once. All 12 ฝ่าย are now choosable in ทีม SAMO → สิทธิ์ → หน้าฝ่าย; `depts.test.js` fails if any migration writes a `dept_page`.
- **The tag list is the 12 ฝ่าย of หน้าฝ่าย** (0215, owner: "it shouldn't have SE"). The agent had borrowed VitalSound's routing desks (นายกสโม, SE, อุปนายก…). Stored as DEPT_DEFS keys; `samo_dept_keys()` is the one SQL copy, pinned by `samo-depts.test.js`; the trigger now refuses an unknown value on every path (`proj0212` 16/16 dev + prod).
- **Code review of the merged work (same day)**: 10 findings, 9 fixed with a failing-first test each; the agent's "public mirror never refreshed" fix was WRONG (it already refreshed) and is reverted. The last one (two people tagging the SAME โครงการ at once could lose a tag) is CLOSED by 0216: each click sends one add/remove, applied under a row lock; `tools/proj0216-race.mjs` (samo-dev only) ran two real parallel sessions — the old whole-array write lost a tag, the new call kept both.
- **0214 changed nothing on production** — every policy and function it recreates already matched live (compared by body, not name). The agent's "run pass-anon-probe FIRST, possible HIGH" is CLOSED.

**Still owed — Status: OWED (owner / ทีม SAMO admins):**
1. Choose who edits each ฝ่าย's page in ทีม SAMO → สิทธิ์ → หน้าฝ่าย. Until then only `dept_pages` holders (blanket) and the one scoped account can edit; the six new ฝ่าย show an empty page.
1b. **11 โครงการ have no ฝ่าย tag** — 33 of 44 were tagged 2026-10-13 from descriptions that name a ฝ่าย; these name none (or "ฝ่ายประชาสัมพันธ์", not one of the 12): สัมมนาสมาพันธ์นักศึกษาวิทยาศาสตร์สุขภาพ, ICEM 2027, แต่งตั้งสภานักศึกษา, หนังสือขออนุญาตใช้ตราสัญลักษณ์, SAMOxCAFE, Music Therapy, ชุมนุมล่าดาว, MDKKU Cooking Together, ดนตรีออร์เคสตรา, ไหว้ครู, หนังสือประกาศค่าตอบแทนตราสัญลักษณ์. ผู้ส่งหนังสือ tags them on each โครงการ's page; nothing guesses.
2. HSTS was deliberately NOT added with the framing headers — only after confirming the KKU edge never serves this host over plain HTTP.
3. Open, low, already known (private report `~/samo-night/reports/2026-10-13-security-*.md` on the VM — never copy into the repo): 0212's trigger checks WHO, not WHAT (inert: every render escapes), plus the three items in memory (`open-privacy-username-lookup`, passport per-ฝ่าย write scope, `activities.static_token`).

Re-arming later: write a new queue in `server/night-agent/NIGHT-TASKS.md`, then `bash server/night-agent/install.sh --arm` (clears STOPPED, syncs the runner and memory).

## 21. Dark mode — BUILT, DORMANT; what it owes before it is switched on (2026-10-13)

**Status: DECIDED 2026-10-13** — owner: "dark mode still not polish enough, i think the web should still show light". Everyone gets light; there is no switch; the device's setting is ignored. Preview it by hand: `localStorage.setItem('samo.theme','dark')` and reload.

What exists: every neutral colour literal in `src/css/` is a token or a color-mix (`tools/theme-tokens-codemod.mjs`), EXACT in light — pixel-diffed against the previous CSS, 0 px changed below the navbar on 8 pages. Dark values: `src/css/theme.css`. Switch + device-following: `src/js/theme.js` (`DARK_FOLLOWS_DEVICE = false`). Guards: `src/js/theme.test.js` (a new raw neutral colour fails the build).

**Owed before switching it on — Status: OWED:** a page-by-page dark polish, seen at 390/820/1440 (`tools/browser/projects-ui.mjs` for หนังสือโครงการ; the public sweep is the pattern in skills/drive-the-browser.md): the striped shop image placeholder stays bright; the admin notifications bell is a black square in both themes; images and ฝ่าย sandboxed pages stay light by design (say so or adapt); passport (separate app) is untouched. To turn on: `DARK_FOLLOWS_DEVICE = true`, restore the head scripts' device test in BOTH entries, put back the three `data-theme-switch` slots (navbar desktop, mobile menu `segmented`, admin top bar) — the CSS for them is still in theme.css — and re-add the release note.

## 22. SAMO-year handover — night agent 2026-10-14

**Status: VERIFIED on PRODUCTION — how: 0219–0224 applied 2026-10-14 in order
0219, 0220, 0222, 0221, 0223, 0224, then the six proofs below run with
`node tools/db-query.mjs tools/<proof>.sql` against production, 143/143 PASS (145/145 after 0226 added two privilege checks to year0219; full `npm run proofs` on production 2026-10-14: 67/69, the two red are §16b's dept0177 + team0135)
(and on samo-dev with `--dev`); team0224's §B2 also shown RED on the agent's
original function. Bundle deployed the same day; Apps Script v13 deployed after a scan tightened (now v16: per-request memo of the top-folder ids; a year folder `Projects/2569` is a container the public folder handlers never trash or share)
its handlers (owner asked, 2026-10-14).** The night agent was STOPPED
after task 7; rows 8–12 never ran — RE-QUEUED 2026-10-18 (`server/night-agent/NIGHT-TASKS.md`, branch `agent/2026-10-18`, migrations 0229–0233).

**Update 2026-10-19 — tasks 8–12 are now ALL DONE on branch `agent/2026-10-18`,
NOTHING of theirs applied to production.** Migrations 0230 (shop), 0231
(stats retention), 0232 (passport/หน้าฝ่าย/accounts) exist on samo-dev ONLY;
0229 and 0233 are intentional gaps (no SQL needed by those tasks). See
"**Rows 8–12 — the owner's apply-in-order checklist**" immediately below the
OWED paragraph for the exact commands, in order, plus every overturnable
decision tasks 8–11 made. Task 12 (this update) is the dedicated handoff pass
`docs/state/night-agent.md`'s Task 11 block flagged as still missing for
task 10 specifically — row 10 below was still reading "QUEUED" despite two
full migrations and a 31/31 + 22/22 proof pair already sitting on samo-dev;
fixed below, not just noted.

**Owner-session review, 2026-10-14 — what changed on branch `year-rollover`
(supersedes the agent's text in the rows below where they disagree):**
- **0219** gates `start_team_term` on `team_edit` itself, so 0219 applied alone
  can no longer let a VIEW-only 'team' holder switch the year. 0224 still
  re-states it; the "apply 0219 first" order is now safe.
- **0224** auto-archives the outgoing year ONLY if it was never published.
  `publish_team_term` deletes and rebuilds, so the agent's unconditional call
  would replace a correct archive (and every correction made on it) after an
  edit-then-handover or an undo/redo. Proof §B2.
- **0223** no longer backfills `fiscal_year_be` (NULL means "ask the clock" —
  `fiscal-year.js`; guard: `fiscal-year.test.js` §6) and keeps the
  `drive_layout` DEFAULT at 'flat'; the new bundle's `createProject` sends
  'year'. A 'year' default would have mislabelled every โครงการ the OLD bundle
  created between applying the migration and deploying.
- **PR**: an UNFINISHED ticket from a past year always shows and is never
  locked (same rule as VitalSound); only finished past-year tickets are
  filtered/locked. The first version hid the open queue from the new team.
- **`tools/year-export.mjs`** writes to `~/samo-exports` and refuses any
  `--out` inside the repo (an export is `select *` of real people; the repo is
  public). `exports/` is also gitignored.
- **`tools/db-query.mjs`** now honours `--dev` (it silently ignored it and ran
  on PRODUCTION — `docs/mistakes/tooling-proofs.md`).
- 0221: `vs_scrub_closed_tickets` refuses a retention under 24 months — it
  was a default any caller could lower, and `master` (41 accounts) holds
  `data_admin` by fold, so two console calls could have blanked last month's
  complaints. Proof step 99.
- **Workflow review (2026-10-14):** the handover order is **publish → edit →
  switch** (`skills/year-rollover.md` step 2), not the agent's "switch first":
  a PUBLISHED current year is shown publicly from its archive, so the public
  page keeps the outgoing team while the tree is edited; switching first
  labels the half-edited live tree as the new team. Pane lead, confirm
  dialog, release note and the function comment (0227) all say so now.
  The trap inside that order: during the edit the current year's badge said
  "ควรเผยแพร่ซ้ำ" — re-publishing then would file the NEW team as the outgoing
  year's history. Badge and re-publish dialog now say "only if it is still
  this year's team".
  ⚠️ Grants follow the LIVE tree during the edit — inherent, documented, not
  built around (a per-term draft tree would be the real fix; not wanted yet).
- 0228: the "ลบปี" button was disabled for the current year in the UI only;
  the API deleted any year. Since team_terms is now every system's year
  registry, a year that is current / was in office / has PR·VS·โครงการ rows
  cannot be deleted (`team0228` 7/7, red before: it deleted the current year).
- 0226 (after deploy): `samo_year_for_timestamp` still answered anon — 0219's
  `revoke … from public` leaves Supabase's EXPLICIT default anon grant; found
  by calling it with the anon key, fixed, `year0219` asserts the privilege.
- 0222: EXECUTE revoked from public/anon on both RPCs; `record_year_export`
  fails closed on NULL; its policy is drop-if-exists so it re-applies.

**Still OWED:** the export gate opens on an export
recorded to LOCAL disk, before any Drive copy succeeds — fine while a human
runs it, not before anything scheduled calls `vs_scrub_closed_tickets`.
`server/supabase-backup.*` is written, never run. Apps Script v13 IS deployed (live: v16)
(2026-10-14): new PR uploads land in `PR/<year>`; `movePRFileToYear` and
`uploadArchiveFile` are live but only accept `<top>/<year>` (2500–2700), and
archives are PRIVATE — `src/js/gas-drive-scope.test.js` runs the real file
against a fake Drive. `fileLivesUnderTop_` (every PR/Shop/Team/Projects
delete/move/read) now needs a REAL top folder, not just the name. Verified
live: the three bad shapes are refused with the new messages, and 40 random
production `project_files` ids still resolve through `statProjectFiles`. `tools/pr-organize-drive-by-year.mjs` (sorting the OLD
flat PR files) and `year-export --drive` have NOT been run — both optional. Edge, not fixed: a tab still on the OLD bundle can
switch the year with the old two-PATCH write, which skips started_at/ended_at
(only a future backfill would notice). Full design: `docs/YEAR-ROLLOVER.md` — read it
before touching any of the rows below; this section is only the per-task
tracking table the queue's own rules require. Branch `agent/2026-10-14`,
migrations 0219–0229 reserved (one block per task), samo-dev only (this
agent has no production credential). Next owner session: review the branch,
push it as a preview branch, decide whether/when to apply each migration to
production per `docs/YEAR-ROLLOVER.md`'s `## Year-end runbook`.

### Rows 8–12 — the owner's apply-in-order checklist (2026-10-18 queue, written by task 12)

**✅ DONE 2026-10-20 by the owner session — the checklist below is HISTORY.
Status: VERIFIED 2026-10-20 — how: tasks 8–13 merged to `main` (task 14 is WIP
and stayed on `agent/2026-10-20`); 0230 → 0231 → 0232 → 0233 applied to
PRODUCTION in that order; proofs on production AND samo-dev: `shop0230` 32/32,
`stats0231-retention` 31/31, `stats0233-no-split-day` 7/7, `passport0232` 22/22,
`accounts0211-dashboard` 15/15 (prod); `npm test` + build green; bundle deployed
(the sha: STATE.md).**

Review of the merged work (two independent reviewers + the SQL read by hand)
found and FIXED before deploy — each in `docs/mistakes/`:
- an edit/delete could trash a picture an ARCHIVED announcement still used;
  reloads painted the wrong list under the manage filter; bulk archive stopped
  after one row under เก็บเข้าคลัง; archiving kept the pin;
- ⌘-click on /shop, /news, /me regressed (the agent removed a "dead" selector);
- shop facet counts ignored the year; the open-work tiles hid last year's
  unpaid / problem orders behind the current-year default (now all years, and
  the click switches to ทุกปี); a `?scan=` link to an old order opened empty;
  the popup cap lost cart.js's 99 ceiling;
- discord-sync posted "Discord ปฏิเสธ" for every change on a Supabase blip;
- 4 of the agent's proofs were green on samo-dev and wrong on production.

**Still OWED from this work — Status: OWED:**
- ⛔ **Do NOT install `server/stats-retention.*` as written** — it uses the
  Postgres superuser on the false premise that service_role cannot run the
  prune functions (it can: `proacl` = `{postgres=X, service_role=X}`). Rebuild
  on a narrow login role or the VM's existing service key, add `OnFailure=`.
  Until then nothing prunes `analytics_events` (DB is 64 MB of 500 — not urgent).
- `tools/browser/shop-checkout-navigate-away.mjs` has never run and is
  unreliable as written (no fixture slip, a Linux Chrome path, a check that
  matches any sign-in trigger). Fix before trusting it.
- Discord sync: fixes #1–#5 and #9 of §18f have no behavioural test; only the
  mid-pass settings blip does now.
- `csvUnguard` strips any leading `'`: a value that REALLY began with `'`, in a
  file exported BEFORE this deploy, loses it on re-import (rare).
- Two-tab race: tab A's checkout `clearCart()` can drop an item tab B added
  mid-checkout (PLAUSIBLE, not reproduced).
- Null-year rule differs: the shop counts a null-year order under every year,
  `account_dashboard(p_year)` drops it. Pick one if it ever matters.
- Not seen in a browser: the announcements archive/bulk flow, the shop year
  picker with real orders, the accounts year filter, หน้าฝ่าย "แก้ไขล่าสุดโดย".


Everything below is **WRITTEN, proved on samo-dev, NOT on production.** Task 8
shipped no migration (ระบบบ้าน graduation is derived in JS, nothing to apply).
Tasks 9–10 together reserved 0229–0233; 0229 was unused on purpose (ระบบบ้าน
graduation needed no SQL). **0233 is no longer unused** — a 2026-10-18
revision pass found a real bug in 0231 (below, Step B2) and used 0233 for the
fix.

**1. Migrations — apply in this exact order, proof after each (dev, then prod):**

```bash
# 0219 is a PREREQUISITE already on production (2026-10-14, row 2) — confirm
# before starting, do not re-apply:
node tools/db-query.mjs tools/year0219-samo-year.sql          # expect PASS on prod already

# Step A — 0230 (task 9, SAMO Shop gets a SAMO year). Depends on 0219.
node tools/apply-migration.mjs supabase/migrations/0230_shop_orders_get_a_samo_year.sql --dev
node tools/db-query.mjs tools/shop0230-samo-year.sql --dev     # expect 32/32
node tools/apply-migration.mjs supabase/migrations/0230_shop_orders_get_a_samo_year.sql
node tools/db-query.mjs tools/shop0230-samo-year.sql           # expect 32/32 on production

# Step B — 0231 (task 10, stats retention rollups). No dependency on 0230.
node tools/apply-migration.mjs supabase/migrations/0231_stats_retention_rollups.sql --dev
node tools/db-query.mjs tools/stats0231-retention.sql --dev    # expect 31/31
node tools/apply-migration.mjs supabase/migrations/0231_stats_retention_rollups.sql
node tools/db-query.mjs tools/stats0231-retention.sql          # expect 31/31 on production

# Step B2 — 0233 (revision pass, 2026-10-18). MUST come after 0231 — it
# redefines prune_analytics(), which 0231 creates. Fixes a real bug: 0231's
# cutoff was a raw timestamp, not day-aligned, so the WEEKLY VM timer would
# split a calendar day across two runs and silently lose the earlier half's
# count forever (reproduced live on samo-dev before fixing; see migration
# header and docs/mistakes/postgres-schema.md). Apply this BEFORE installing
# or first-running the stats-retention VM timer (step 3 below) — the bug
# needs a real weekly cadence to bite, so it is invisible in a one-off run.
node tools/apply-migration.mjs supabase/migrations/0233_prune_analytics_never_splits_a_day.sql --dev
node tools/db-query.mjs tools/stats0233-no-split-day.sql --dev   # expect 7/7
node tools/apply-migration.mjs supabase/migrations/0233_prune_analytics_never_splits_a_day.sql
node tools/db-query.mjs tools/stats0233-no-split-day.sql         # expect 7/7 on production

# Step C — 0232 (task 10, Passport bridge + หน้าฝ่าย editor info + accounts
# year filter). MUST come after 0230 — its account_dashboard() rewrite reads
# shop_orders.samo_year_be, which 0230 is what creates.
node tools/apply-migration.mjs supabase/migrations/0232_passport_team_term_bridge_and_dept_editor_info.sql --dev
node tools/db-query.mjs tools/passport0232-bridge-dept-editor-accounts.sql --dev   # expect 22/22
node tools/apply-migration.mjs supabase/migrations/0232_passport_team_term_bridge_and_dept_editor_info.sql
node tools/db-query.mjs tools/passport0232-bridge-dept-editor-accounts.sql         # expect 22/22 on production
```

Every one of these proofs has been RUN against samo-dev during this queue
(most recently by task 12's own re-run, below) — the "expect" counts above
are not a guess. None has ever run against production; that is the one thing
only the owner can do (no production credential exists in this agent's
environment). ⛔ **`shop0230-samo-year.sql` is actually 32 steps, not the
31/31 tasks 9 and 11 recorded** (row 9 and row 11 below still say 31/31 —
left as each task's own historical account, not rewritten; this is the
correction) — counted directly off a fresh live run during this task, not
off either row's prose. `stats0231-retention` (31/31) and
`passport0232-bridge-dept-editor-accounts` (22/22) were independently
re-counted the same way and matched what was already recorded.

**2. Apps Script — nothing to do.** Tasks 8–12 touched no `appscript/*.gs`
file (confirmed: `git diff origin/main..HEAD -- appscript/` is empty).
`npm run deploy:gas` is NOT part of this queue's checklist.

**3. VM timer to install by hand (task 10, stats retention) — optional, not
blocking anything:**

```bash
sudo cp server/stats-retention.env.example /etc/stats-retention.env
sudo chown root:root /etc/stats-retention.env && sudo chmod 600 /etc/stats-retention.env
sudo nano /etc/stats-retention.env   # paste the SAME SUPABASE_DB_URL already in /etc/supabase-backup.env — do not mint a second one
sudo cp server/stats-retention.service server/stats-retention.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now stats-retention.timer
systemctl list-timers stats-retention.timer   # confirm a real NEXT, not infinity (.claude/rules/mistakes.md class 7)
```

Decided over enabling `pg_cron` (Database → Extensions, a one-click the
owner could take instead) — see the migration 0231 header for the full
reasoning; if the owner prefers pg_cron, `select cron.schedule(...)` calling
`prune_analytics()` / `prune_claude_usage_samples()` / `prune_notify_log()` is
a one-line swap, nothing here needs rewriting first. **Until one of the two
is installed, `analytics_events`/`claude_usage_samples`/`notify_log` keep
growing unpruned — exactly today's behaviour, nothing regresses by waiting.**

**4. Deploy the frontend bundle** (`skills/deploy-vm.md`) — ships, in one
bundle: ระบบบ้าน's graduated-รุ่น switch + empty-state hint (task 8, no
migration needed first); the shop admin year picker on both the orders table
and ยอดขาย, plus the cross-tab cart fix (task 9, needs 0230 live first or the
picker's RPC call 404s); the ทีม SAMO → สิทธิ์ `data_admin` checkbox wording
is already live from task 6 (2026-10-14), unaffected here; the หน้าฝ่าย
editor's "แก้ไขล่าสุดโดย … เมื่อ …" line (task 10, needs 0232 live first);
the announcements เก็บเข้าคลัง/เผยแพร่อีกครั้ง toggle on the manage pane
(task 10, needs NO migration — it only flips the existing `status` column);
the accounts (บัญชีผู้ใช้) กิจกรรม-by-year picker (task 10, needs 0232 live
first, defaults to "ทุกปี" so it degrades gracefully if clicked before 0232
is live — it will just show empty activity counts, not error).

**5. Browser verification — what to click, at both desktop and 390px width:**

| System | Where | What to look for |
|---|---|---|
| ระบบบ้าน | /admin/ → ระบบบ้าน → นักศึกษา | Roster hides a graduated รุ่น by default; "แสดงรุ่นที่จบแล้ว (N คน)" switch reveals them; the ปีการศึกษา bump card shows "N คนอยู่ปี 6 ตอนนี้"; a search that only matches a graduated person (with the switch off) shows the new hint text, not the generic "no match" |
| SAMO Shop admin | /admin/ → SAMO Shop → คำสั่งซื้อ / ยอดขาย | Year `<select>` on both tabs, defaults to current year, kept in sync; ต้องจัดการ tile counts match what clicking into them shows (the bug task 9 fixed) |
| SAMO Shop customer | the shop tab, add to cart in two browser tabs | Both tabs see both items after either reloads/re-renders (the cross-tab fix) |
| หน้าฝ่าย editor | /admin/ → หน้าฝ่าย → pick a ฝ่าย | "แก้ไขล่าสุดโดย … เมื่อ …" line under the ฝ่าย picker, once 0232 is live |
| Announcements | /admin/ → ประกาศ → จัดการ | Status filter (เผยแพร่/เก็บเข้าคลัง/ทั้งหมด); เก็บเข้าคลัง button on a card removes it from the public `/updates`-adjacent archive feed; เผยแพร่อีกครั้ง restores it; editing an archived post's text no longer silently republishes it (task 11's fix) |
| บัญชีผู้ใช้ (master only) | /admin/ → บัญชีผู้ใช้ | กิจกรรมปี `<select>` next to โหลดใหม่; opening an account's detail card shows PR/VS/Shop/หนังสือโครงการ counts scoped to the picked year |
| Passport admin | passport admin → เปิดปีใหม่ (startNewYear) | Prompts for a `team_term_year` bridge value when opening a new Passport year (0232 part A) |

**6. Every decision tasks 8–11 made that the owner may want to overturn —
one line each, with the consequence of flipping it:**

- **(8) ระบบบ้าน graduation is DERIVED (`isGraduated()` in `study-year.js`),
  not a stored `students.graduated_at` column** — the design doc's
  first draft proposed the column. *Flip it* → write a migration, backfill,
  and keep it re-derived on every ลาพัก correction or an admin moving
  ปีการศึกษา backwards (a second thing to keep in step, which is exactly
  why it was rejected).
- **(8) Held rows and help requests are NEVER hidden or auto-closed by
  graduation** — they stay actionable until a human writes
  ติดต่อไม่ได้/ลาออก/etc. *Flip it* → a held row for a long-graduated รุ่น
  would stop surfacing, which quietly drops a real person ฝ่ายข้อมูล never
  finished placing.
- **(8) สายรหัส assignment audit is NEVER filtered by graduation** —
  matches the pre-existing "สาย is never re-run" rule. *Flip it* → breaks
  that existing invariant for no stated benefit.
- **(9) `shop_order_totals()` is rescoped to the CURRENT year, with a
  fallback to all-time only if `current_samo_year()` is ever NULL** — the
  design doc didn't specify this; chosen so Discord's "how's the shop doing"
  ping doesn't balloon with every past team's orders after a handover, same
  complaint PR had one system over. *Flip it* → revert to unscoped (0206's
  original shape) — simpler, but reintroduces that exact complaint.
- **(9) SAMO Shop products stay un-scoped by year** — a product is
  inventory, not a transaction. *Flip it* → would need a per-year product
  catalogue, a materially bigger feature nobody asked for.
- **(9) No admin UI control yet to correct a mis-filed order's
  `samo_year_be`** (OWED, not built — the column is admin-overridable at
  the DB level already). *Decide*: build it now, or leave it to whenever an
  order actually needs correcting — nothing depends on it existing sooner.
- **(10) `passport.samo_years.team_term_year` is a loose column with NO
  foreign key, set by hand when an admin opens a new Passport year** —
  matches this codebase's deliberate public/passport schema isolation
  (passport-security-hardening memory). *Flip it* → would need to break
  that isolation or build a sync job; neither is free, and nothing today
  needs the two calendars to move together.
- **(10) `dept_content_editor_info()` is UI-only ("last edited by"), not a
  real version-history table** — the design doc explicitly said a ฝ่าย
  page is a living document, not a ticket. *Flip it* → build real
  versioning, a materially bigger feature than this queue's three-task
  scope.
- **(10) Stats retention scheduling is a NEW VM systemd timer, not
  `pg_cron`** — pg_cron needs a one-click dashboard enable only the owner
  can take; the timer needed nothing new (the VM already holds
  `SUPABASE_DB_URL` for the backup job). *Flip it* → enable pg_cron, then
  `select cron.schedule(...)` the same three functions — a one-line swap,
  not a rewrite (migration 0231's own header says so).
- **(10) Announcement archiving reuses the existing `status` column**
  (flips between `'approved'`/`'archived'`, both already valid per the 0001
  CHECK constraint) **— no new column, no new table.** *Flip it* → would
  need a reason beyond what's built; the public feed already filters
  `status=eq.approved`, so this was the smallest change that worked.
- **(10) `account_dashboard()`'s new year filter defaults to "ทุกปี"
  (unscoped)**, matching 0211's original unscoped behaviour, rather than
  defaulting to the current year like PR/VS/Shop's own admin pickers do.
  *Flip it* → change `acctYearValue`'s initial value in
  `src/js/accounts/admin.js` from `ALL_YEARS` to "current" — a one-line
  change, not reconsidered here because บัญชีผู้ใช้ is a cross-system
  lifetime view by nature (unlike a single system's own order/ticket list),
  so "ทุกปี" is arguably the more useful default, not just the lazier one.
- **(11) The owner's own already-shipped code (shop admin, home/`/me`,
  `terms.js`) was reviewed by a background subagent instead of by hand** —
  deliberate: that code had already been through one review when it
  shipped, and task 10 (never reviewed at all, two WIP/cut-off commits) was
  judged the higher-value use of this task's budget. *If the owner wants a
  from-scratch review of that code too*: it was not skipped out of
  oversight, it was a budget call — ask for it explicitly and it's a normal
  `/code-review` or `/scrutinize` run.
- **(11) Migration 0233 was reserved and left unused** — task 11 needed no
  SQL of its own; everything it reviewed belonged to tasks 9/10's own
  migrations. No consequence either way; the number stays retired.

| Task | System | Migration | Proof | Applied? | Owner action |
|---|---|---|---|---|---|
| 1 | Design doc | — (no migration) | `scrutinize` pass on the doc | N/A | Read `docs/YEAR-ROLLOVER.md`; it is the plan every later row implements |
| 2 | Core SAMO-year infra | 0219 | `year0219` 29/29 prod + samo-dev | ✅ PRODUCTION 2026-10-14 | Review `skills/year-rollover.md`; apply 0219 to production (`node tools/apply-migration.mjs supabase/migrations/0219_one_samo_year_for_every_system.sql`) before task 3+'s migrations land there, since they attach triggers that call `current_samo_year()` |
| 3 | PR | 0220 | `pr0220` 23/23 prod + samo-dev | ✅ PRODUCTION 2026-10-14 | Apply 0219 to production FIRST (task 2's row), then `node tools/apply-migration.mjs supabase/migrations/0220_pr_tickets_get_a_samo_year.sql`, then `node tools/db-query.mjs tools/pr0220-year-filter.sql` to prove it there too. Deploy the frontend bundle (ships the year picker/export/past-year lock) + run `npm run deploy:gas` (ships the per-year Drive folder + `movePRFileToYear`). AFTER that bundle is served, the owner may run `node tools/pr-organize-drive-by-year.mjs` (dry-run) to see how many existing flat `PR/` files would move, then `--apply --move N` to sort them — never required, purely organizational, and paced to avoid degrading the live upload endpoint |
| 4 | VitalSound | 0221 | `vs0221` 35/35 prod + samo-dev | ✅ PRODUCTION 2026-10-14 | Apply 0219 to production FIRST (task 2's row), then `node tools/apply-migration.mjs supabase/migrations/0219_one_samo_year_for_every_system.sql` if not already there, then `node tools/apply-migration.mjs supabase/migrations/0221_vs_tickets_get_a_samo_year.sql`, then `node tools/db-query.mjs tools/vs0221-samo-year.sql` to prove it there too. Also depends on 0222 (task 5's export-log gate) already applied — `vs_scrub_closed_tickets()` calls `year_export_recorded()`. Ships `vs_tickets.samo_year_be` + a year facet on the VS staff kanban (NO past-year edit lock, unlike PR — see the migration header) + `vs_scrub_closed_tickets(year, months=24)`, a PDPA anonymiser that is FUNCTION ONLY — nothing calls or schedules it yet (task 11's job). Also added `data_admin` to `PERM_CATALOG` (team-vocab.js) so a human can actually be granted the permission 0222 and this migration both gate on — deploy the frontend bundle for that checkbox to appear in ทีม SAMO → สิทธิ์. Deploy the frontend bundle (ships the year picker/chip in the VS staff kanban) |
| 5 ‡| Backup/Export/Deletion data-safety layer | 0222 | `data0222` 18/18 prod + samo-dev | ✅ PRODUCTION 2026-10-14 | Apply 0219 to production FIRST, then `node tools/apply-migration.mjs supabase/migrations/0222_year_export_log_and_the_deletion_gate.sql`, then `node tools/db-query.mjs tools/data0222-export-gate.sql` to prove it there too. Ships `year_export_log` + the gate every future per-system deletion/anonymisation RPC must call, NOT a per-system anonymiser (VS/Shop/Projects retention stays each own task's job) — details in `docs/state/night-agent.md`'s "Task 5" block and `skills/backup-and-export.md`. Review + install `server/supabase-backup.sh`/`.timer`/`.service` (whole-DB backup, WRITTEN, NEVER RUN — needs `SUPABASE_DB_URL` on the VM and a decision on IPv6 reachability, see that skill). Run `npm run deploy:gas` before `tools/year-export.mjs --drive` can reach Drive (new action `uploadArchiveFile`) |
| 6 | หนังสือโครงการ | 0223 | `proj0223` 21/21 prod + samo-dev | ✅ PRODUCTION 2026-10-14 | Apply 0219 to production FIRST (task 2's row), then `node tools/apply-migration.mjs supabase/migrations/0223_projects_get_a_samo_year_and_a_drive_layout.sql`, then `node tools/db-query.mjs tools/proj0223-fiscal-year-and-samo-year.sql` to prove it there too. Ships `projects.samo_year_be` (stamped at insert) + `projects.drive_layout` (default 'flat'; the new bundle's createProject sends 'year' — review 2026-10-14; the agent's `fiscal_year_be` backfill was REMOVED) so a per-year Drive folder can ship WITHOUT relocating any existing project's real folder. Run `npm run deploy:gas` (ships `walkProjectsPathByCode_`'s optional year segment in `appscript/prform.gs`) before any new โครงการ's upload actually lands in `Projects/<year>/...` — until then every upload keeps landing exactly where it does today. Project seats (vpa/staff/prof) need NO migration — confirmed via `recompute_team_managed_permissions()` (newest def 0177): they resync LIVE from `team_nodes`/`team_members`, so reassigning the ตำแหน่ง in จัดการทีม already carries a seat across any handover with no code to write; see `docs/YEAR-ROLLOVER.md` § หนังสือโครงการ, point 3 |
| 7 †| ทีม SAMO + เกี่ยวกับเรา | 0224 | `team0224` 19/19 prod + samo-dev | ✅ PRODUCTION 2026-10-14 | Apply 0219 to production FIRST, then `node tools/apply-migration.mjs supabase/migrations/0224_team_handover_edit_gated_self_archiving.sql`, then `node tools/db-query.mjs tools/team0224-handover.sql` to prove it there too. Fixes a real authz bug (the handover RPC was callable by ~300 VIEW-only accounts, not just editors) and makes the handover auto-archive the outgoing term — read `docs/state/night-agent.md`'s "Task 4" block before deploying. Deploy the frontend bundle (ships the corrected จัดการทีม confirm-dialog copy in `terms.js`) |
| 8 | ระบบบ้าน + ข้อมูลของฉัน | none (deliberately — see below) | `gaps.test.js` (new describe block, 4 cases) | DONE on branch `agent/2026-10-18`, samo-dev/prod untouched (no schema change) | Review and deploy the bundle. No migration: graduation is `isGraduated()` in `study-year.js`, computed live from the existing ชั้นปี arithmetic — NOT the `students.graduated_at` column `docs/YEAR-ROLLOVER.md` originally proposed (rejected on build, see that doc's `## ระบบบ้าน` + `docs/state/night-agent.md`'s Task 8 block for why). ระบบบ้าน's นักศึกษา tab now hides a graduated รุ่น by default (switch to show it); `gaps.js`'s per-person worklists + scope denominator exclude graduated students; สายรหัส audit still includes them (สาย is never re-run). MD55+ and `/me`'s own house card need no code change — checked by grep, no hardcoded MD49–MD54 literal drives any branch |
| 9 | SAMO Shop (orders per year + customer flow) | 0230 | `shop0230` 31/31 samo-dev | DONE on branch `agent/2026-10-18`, samo-dev ONLY — NOT production | Review, then apply 0219 to production FIRST if not already (task 2's row), then `node tools/apply-migration.mjs supabase/migrations/0230_shop_orders_get_a_samo_year.sql`, then `node tools/db-query.mjs tools/shop0230-samo-year.sql` to prove it there too. Ships `shop_orders.samo_year_be` (stamped at insert, backfilled from `placed_at`) + `shop_order_totals()` (0206) rescoped to the current year (falls back to counting everything if `current_samo_year()` is ever null) + the shared `samo-year.js` picker on the admin orders table AND the ยอดขาย tab, current year by default, one predicate (`orderMatchesYearFilter`, `src/js/shop/data.js`). Products stay un-scoped (design). **Separately, fixed a real bug found while tracing the customer checkout flow** (the owner's "navigate away mid-purchase" worry): `src/js/shop/state.js`'s cart loaded into memory once per browser TAB and persisted the whole array on every write, so two tabs open on the shop could silently clobber each other's added item with no error — fixed with a `storage`-event listener, test in `src/js/shop/state.test.js`, write-up in `docs/mistakes/app-state.md`. The rest of that worry (navigating via `/me`/the home banner/the shop tab) checked out fine by code trace — this app is a client-side router, nothing on that path calls `location.reload()`. **Resumed after a quota cut-off (same day): `/scrutinize` on the task's own diff found the year picker had broken the "ต้องจัดการ" tiles' own invariant** — their counts read every year while the views they open into (orders table, ยอดขาย) were year-filtered, so a past-year pending order could inflate a tile with no way to reach it. Fixed: `renderStats()`'s `scoped`/`revenue` now read `yearFilteredOrders()`; the slip-review count stays all-years on purpose (its destination is never year-filtered). Write-up: `docs/mistakes/app-state.md`. **OWED**: a live-browser run of the full flow (`tools/browser/shop-checkout-navigate-away.mjs`, WRITTEN, NEVER RUN — no Chrome/network in the night agent's sandbox) and an admin UI control to correct a mis-filed order's `samo_year_be` (`docs/YEAR-ROLLOVER.md` § SAMO Shop) |
| 10 | Passport + หน้าฝ่าย + Announcements + Stats retention + Accounts | 0231 (stats retention), 0232 (passport bridge + หน้าฝ่าย editor info + accounts year filter) | `stats0231-retention` 31/31 samo-dev · `passport0232-bridge-dept-editor-accounts` 22/22 samo-dev — both RE-RUN live during task 11's review, not just read off `STATE.md` | DONE on branch `agent/2026-10-18`, samo-dev ONLY — NOT production (built across two WIP commits, both "cut off by the quota" per their own messages — `git log --oneline` on this branch; never got its own `/scrutinize` pass or this row's update until task 12) | Apply 0230 FIRST if not already (row 9 — `account_dashboard()`'s rewrite reads `shop_orders.samo_year_be`), then `node tools/apply-migration.mjs supabase/migrations/0231_stats_retention_rollups.sql`, proof `tools/stats0231-retention.sql`; then `node tools/apply-migration.mjs supabase/migrations/0232_passport_team_term_bridge_and_dept_editor_info.sql`, proof `tools/passport0232-bridge-dept-editor-accounts.sql`. Install the VM timer (`server/stats-retention.*`, see the checklist above — pg_cron is NOT installed on this project, so nothing prunes `analytics_events`/`claude_usage_samples` until either the timer or pg_cron exists). Deploy the bundle for the หน้าฝ่าย "แก้ไขล่าสุดโดย" line, the announcements เก็บเข้าคลัง/เผยแพร่อีกครั้อง toggle (no migration needed, reuses the `status` column), and the accounts กิจกรรม-by-year picker. Full detail + every decision: the apply-in-order checklist above |
| 11 | Scrutinize + bug scan (tasks 8–10 + the owner's work since 2026-10-14) | none (0233 left unused — no SQL needed) | `stats0231-retention` 31/31 + `passport0232-bridge-dept-editor-accounts` 22/22 + `shop0230-samo-year` 31/31, all RE-RUN live on samo-dev during this review (not just read off STATE.md) | DONE on branch `agent/2026-10-18` — review-only, no schema touched | Full report: the 2026-10-18 review note (kept on the VM checkout under agent-notes, not in git). Found + fixed one real bug (editing an archived ประกาศ silently republished it — `nextAnnouncementStatus()` in `announcements.js`, test + write-up in `docs/mistakes/app-state.md`) and one cosmetic dead-selector cleanup in the owner's `departments.js`. Everything else checked (0231/0232's RLS, tasks 8–9's own prior scrutinize fixes, the owner's shop-admin math + home banner + `terms.js` handover order, login cache for both sign-in kinds, cross-tab account switching, the shop customer flow) came back clean. 0 security findings. Task 10's own write-up/row-update gap (noted here) is closed by row 10 above, done by task 12 |
| 12 | Handoff checklist for rows 8–11 | — (no SQL — pure docs) | Re-ran `shop0230-samo-year`/`stats0231-retention`/`passport0232-bridge-dept-editor-accounts` live on samo-dev rather than trusting the recorded counts — found and fixed a real miscount (`shop0230` is 32/32, not the 31/31 tasks 9+11 recorded; see `docs/state/night-agent.md` Task 12) | DONE on branch `agent/2026-10-18` — docs only, no schema touched | Read the apply-in-order checklist above top to bottom: migrations 0230→0231→0232 on samo-dev then production (with proofs each step — note the corrected 32/32 for shop0230), no GAS step, install the optional stats-retention VM timer, deploy the bundle, click through the browser-verification table, then read the per-decision list before overturning anything. `npm test` and `npm run build` both green on this commit |

⛔ **Every later task must update its OWN row above** (migration/proof
numbers, applied y/n, the exact command the owner runs next) — never rewrite
another task's row, and never mark a row applied unless a proof actually ran
green on samo-dev this session.

† **Task-numbering mismatch, flagged rather than silently reconciled.** The
live night-queue (`~/samo-night/NIGHT-TASKS.md` on the VM) calls the
ทีม SAMO + จัดการทีม + permissions-handover + Discord work "task 4"; this
table — written by task 1 before the real queue was finalized — provisionally
numbered the SAME system "task 7" and reserved it migration 0224. The
MIGRATION NUMBER is the ground truth tying the two together (0224 was
reserved for ทีม SAMO in both places), so this row is updated under its
original "7", not renumbered to "4" — do not assume the two numbering
schemes otherwise agree; check which system a task actually built, not its
number alone, before touching any other row above.

‡ **A second instance of the same mismatch, caught before anything shipped
under the wrong label.** This table's row "5" originally guessed "SAMO Shop"
(task 1's provisional scheme) and reserved it migration 0222 — but the real
night-queue's own task 5 (`~/samo-night/NIGHT-TASKS.md`) is "Backup, export,
deletion — the data-safety layer every system uses", and ITS preamble
independently reserved the SAME number, 0222, for that unrelated system. No
row above had actually built anything under the old guess (Migration/Proof/
Applied were all blank), so this row was corrected in place rather than
left to collide later — SAMO Shop's real build, whenever it happens, ships
under the real queue's task 9, which the real preamble reserves migration
0226 for (NOT 0222). Same rule as the † note: the MIGRATION NUMBER actually
used is the ground truth; check what a migration file's own header claims
before trusting either numbering scheme.

## 23. Home page + ข้อมูลของฉัน (/me) — what the 2026-10-16 session leaves open

**Status: VERIFIED 2026-10-16 — how: `tools/browser/home-hero.mjs` 34/34 against production after the last deploy (banner gestures, keyboard, autoplay/pause, tool rail, ⌘-click, `/tools`, the MDI ฝ่าย page, `/admin/`), `tools/browser/me-page.mjs` 17/17 on samo-dev signed in; every fixed code bug falsified.** Why each piece is the way it is: `docs/state/claude-2026-10-16.md`. Below is only what is NOT done.

**a. White glyphs on pale icon colours — Status: DECIDED 2026-10-16** (owner: "make the icon white"). Measured white-on-colour contrast; 3:1 is the usual floor for an icon: Golden Period `#ffd077` **1.44:1**, SAMO Booking `#bdc96c` 1.79:1, SAMO Passport `#8dc3e1` 1.90:1, PR Form `#ff8bbf` 2.17:1 (VitalSound 4.36, SAMO Project 4.11, the rest higher). A soft drop-shadow gives the glyph an edge. Do not re-propose a coloured glyph unless the owner raises legibility; if they do, the deep same-hue ink was built once and is in git (`git log -S toolInk`).

**b. Phone top bar: Logout → your avatar (opens /me) — Status: OWED, owner to confirm.** Shipped as part of "design the workflow properly", but it removes a one-tap sign-out the owner had chosen earlier (navbar.html comment). Sign-out is now on `/me` and in the drawer. If they want it back, restore the old `#navAuthSignedInMobile` button and keep the avatar elsewhere.

**c. Golden Period — Status: OWED, owner to confirm.** The "ตารางข้อมูลเต็ม" heading and its lead were removed; the "เปิดชีท GPC Dashboard" button was KEPT because only the text was pasted.

**d. Never seen on a real phone — Status: HYPOTHESIS that it works on iOS Safari.** Headless Chrome with emulated touch passed the swipes, autoplay and the rail; iOS's scroller (scroll-snap with programmatic smooth `scrollTo`, `scroll-snap-stop: always`) has not been looked at on a device. Open the home page on an iPhone: swipe the banner, let it autoplay a full cycle, scroll the tool row, tap the avatar.

**e. /me with a REAL ทีม SAMO + ระบบบ้าน record has not been looked at on production — Status: OWED.** The signed-in driver refuses production by design (it creates an account); the full page was rendered with a synthetic person through the real renderers on samo-dev. One look by a team member at `samo.md.kku.ac.th/me` closes it.

**f. `discord-sync.test.js` › "after a pass the panel is told when and what" — Status: HYPOTHESIS: timing flake, unrelated.** Failed once during a full `npm test` while headless Chrome was also running; passed 3/3 alone and CI is green. It spawns the sync service with a fixed 1500 ms window (`loop(1500)`). If it fails again, give it the event-based ending its sibling loop test got (`git log --grep "waits for events"`), not a longer timer.

## 25. The ปี admin page (/admin/#years) — what the 2026-10-20 session leaves open

**Status: VERIFIED 2026-10-20 — how: `tools/year0242-start-samo-year.sql` 23/23 on production AND samo-dev (red in six cases with the Passport gate removed, restored to 0 FAIL); `tools/browser/year-page.mjs` 26/26 on samo-dev signed in as a master — hero = `current_samo_year()`, ปีการศึกษา = `house_settings`, no "2,569" anywhere, the start request's exact payload captured with fetch INTERCEPTED (nothing written), ทีม SAMO → ทีมแต่ละปี offers no switch, 390px no sideways scroll, no console errors.** Owner asks this answers: "changing ปี … should be ui ux distinct in the admin, not just hiding in the ทีมsamo"; "ปีการศึกษา isn't the same as ปีsamo — make a unified ui ux"; Passport "Move it in the same click".

**a. The real switch has never been pressed through the page — Status: OWED (handover day).** The RPC is proved in a rolled-back transaction on production; the page's click is proved up to the request. Production today: ปี SAMO 2569 current and NEVER published (so step 1 shows as due), a 2570 row seeded, Passport "MDKKU SAMO'69" open with a NULL bridge (the start fills it with 2569 as it closes it). On handover day: step 1 → step 2 → step 3, then check `/admin/#years`, the top-bar chip, a new PR's year, and Passport admin.

**b. Who may move Passport — Status: DECIDED (no new access channel).** The Passport half asks `passport_admin_context()->'all_departments'`, Passport's own org-wide test. A `team_edit` holder without it starts the ปี SAMO alone and the page says so. Every `master` holds both. Do not widen this to `team_edit` alone without the owner: it would let a VP reset the Passport leaderboard.

**c. `tools/browser/accounts-dashboard.mjs` probably breaks on samo-dev now — Status: HYPOTHESIS.** samo-dev gained the `auth.users` triggers (night agent 0234, dev only), so the users row exists before the harness grants `master`, and `users_self_update_guard` refuses that write — exactly what `year-page.mjs` hit first (fixed there by disabling the guard around the fixture write). Run it before trusting it; same fix if red.
