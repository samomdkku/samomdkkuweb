# Discord role sync — ทีม SAMO as the source of truth

**Status: DESIGN ONLY. NOTHING IS BUILT.** Written 2026-09-11 from a scan of the
existing bot and measurements against production. No code in this repo touches
Discord as a bot, and none should be written until §7's owner steps are done.

⛔ **Do not start building from the middle of this file.** §1 is the goal, §3 is
why the obvious approach fails, §6 is the build order, §7 is what only the owner
can do, and **§8b is a decision nobody has made yet**. §7 and §8b both block §6.
A session that starts coding at §5 will build a sync that cannot identify
anybody, in a directory nobody agreed on.

📌 The same material, formatted for reading rather than for agents:
`https://claude.ai/code/artifact/cfd900a6-3f6b-42ab-a8d4-13cf013065de`
That link is a convenience, **not the record** — this file is.

---

## 1. The goal, in one sentence

A person's ฝ่าย and ตำแหน่ง in **ทีม SAMO** should decide their Discord roles —
and therefore which channels they can see — continuously, with the bot running
on the KKU VM instead of the dead Render service.

**Why now:** the owner reports that many people's Discord roles do not match
their ทีม SAMO position. §3 explains that this is not drift.

---

## 2. What exists today

**The bot**: `/Users/xeno/development/samodevmdkku69/discord_bot_assign_role`
— Python, `discord.py`, one 1,300-line `main.py`. Not in this repo, not on
GitHub. It ran on Render's free tier and is **down**.

| Thing | Where | Note |
|---|---|---|
| Source of truth | a **Google Sheet** | `SHEET_ID` at `main.py:15`, downloaded to CSV |
| Identity | the Discord **display name** | `main.py:170`, format `ชื่อเล่น_#ชั้นปี_รหัส5ตัวท้าย` |
| Sync trigger | a 2-hour poll | `main.py:217` |
| Channel access | role-based overwrites | `main.py:1025` |
| Keep-alive | a Flask server on `:8080` | `keep_alive.py` — exists only for Render |

**Discord applications** — there are **two**, and they must not be confused:

- the **role bot**, *"Role assignment bot for SAMO69"*, which is being replaced
  (`docs/state/HANDOFF.md` §1);
- the owner's separate **file-limit / Telegram bot**, a *different application*,
  unaffected by anything here. Verified by decoding the application id out of
  the first segment of each token and comparing.

⛔ **The application ids are deliberately not written here, and neither is the
state of the old credential.** `docs/` is SERVED PUBLICLY at
`samo.md.kku.ac.th/docs` (verified 2026-09-11) and this repo is public, so
naming a target beside a known weakness publishes the weakness. The owner holds
those details; §7 step 5 is what closes it.

---

## 3. Why the roles drifted — four causes, none of them "drift"

**Status: VERIFIED 2026-09-11 — how:** each line traced in `main.py`, and each
number measured against production with `tools/db-query.mjs`.

### 3a. The bot has never removed a role

There is no removal path in the sync at all. `main.py:183` builds `roles_to_add`;
`main.py:200` calls `add_roles`. Nothing calls `remove_roles` outside the manual
`!clear` command (`main.py:1124`), which nothing invokes.

**So every reorganisation since the bot started is still in the role list.** The
mismatch is the design working as written, not decay.

### 3b. The Sheet stores applications, not placements

The source column is `ฝ่ายที่เปิดรับสมัคร` — what someone *applied to*. When one
student submitted the form several times the bot merges every submission and
grants the union (`main.py:136`: *"Bot will assign all roles across all
submissions"*). A student who applied to three ฝ่าย wears three ฝ่าย roles.

**Expect this to be the largest bucket in the first report.**

### 3c. Identity is a string the user can edit

`main.py:170` is `if member.display_name in user_roles`. Rename yourself and you
stop existing to the bot. Worse for the new plan: the key contains **ชั้นปี**, so
every key in the server would break at once, annually.

### 3d. Names are not unique, and the bot matches on names

⛔ **This is the finding that breaks the obvious design.** Measured on
production:

```
11 node names are duplicated, across 32 nodes
37 members sit on a node whose name is not unique

เหรัญญิก x6 — one each under:
  ฝ่าย IFMSA · ฝ่ายรังสีเทคนิค · ฝ่ายอำนวยการ
  รพ. ขอนแก่น · รพ. มหาสารคาม · รพ. อุดรธานี

ฝ่ายวิชาการ x3 — one top-level, one under ฝ่ายรังสีเทคนิค,
                 one under ฝ่ายเวชนิทัศน์
หัวหน้าฝ่ายวิชาการ x4 · หัวหน้าฝ่ายประชาสัมพันธ์ x4 · เลขานุการ x3
```

Mirror by name and all six เหรัญญิก collapse into **one** Discord role. Give it
to one ฝ่าย's treasurer and they can see the other five ฝ่าย's channels. Discord
permits duplicate role names, so nothing errors.

It also makes renaming impossible: rename a ฝ่าย and the bot no longer finds
"its" role, so `main.py:192` **creates a second one** and orphans the first —
with every channel permission still attached to the orphan.

---

## 4. What the portal actually holds

**Status: VERIFIED 2026-09-11 — how:** `information_schema` and counts against
production. ⚠️ These are decaying numbers; re-measure before depending on one.

```
team_members   449 placements · 412 confirmed · 418 with a kkumail
team_nodes     299 nodes = 92 kind='division' + 207 kind='role'
people         342 distinct people hold those 449 placements
discord        ZERO columns anywhere in the schema
```

**One in four people works in more than one ฝ่าย** — and the design must treat
that as normal, not as an edge case:

```
260 people  1 placement
 64 people  2
 13 people  3
  4 people  4
  1 person  6   (across 5 distinct ฝ่าย)
```

⛔ **THE TREE IS RAGGED — DO NOT USE DEPTH AS A LEVEL.** ฝ่าย appear at depths 1
through 5 and members attach at depths 1 through 6 (233 at depth 3, 153 at
depth 4). Any rule of the form "depth 2 means ฝ่าย" is wrong for about half the
org. **A member's ฝ่าย is their nearest `kind='division'` ancestor, or
themselves.**

⛔ **AND `kind` DOES NOT TELL YOU WHAT DESERVES A ROLE.** A sub-group is stored
two different ways:

```
ฝ่าย 7 คณะวิทยาศาสตร์สุขภาพ → ฝ่าย OPH, ฝ่ายกีฬา, ฝ่ายดนตรี    ← children are division
ฝ่าย IT                    → Developer, Frontend developer,
                             หัวหน้าฝ่าย IT (Tech lead)         ← children are role
```

26 ฝ่าย contain sub-ฝ่าย; others contain sub-*roles*. Both mean "a group of
people who may need their own channel". **The owner raised exactly this case**
— wanting a frontend-only channel and an `@frontend` mention — and a rule of
"mirror divisions, skip roles" would have deleted the very role they asked for.

**Conclusion: no automatic rule can decide this. It is a fact about how the team
works, and it is not written down anywhere.** See §5c.

---

## 5. The design

### 5a. Identity: store an id, never a name

Add `discord_links` (`person_id`, `discord_user_id`, `linked_at`, `linked_by`).
A table, not a column on `team_members`, because a person holds several
placements and the link belongs to the **person**.

Populate with a `/link` slash command that verifies the way `!verify`
(`main.py:711`) already does, but stores the **user id** — the snowflake, which
nobody can edit — instead of renaming them.

### 5b. Roles: store a mapping, never match on a name

Store `node_id → discord_role_id`. The name becomes a label the bot keeps
updated, never the identity. Then a rename renames the role instead of forking
it, and the six เหรัญญิก can never merge.

Qualify a display name **only when the plain one is taken**:
`เหรัญญิก · รพ.ขอนแก่น`, `ฝ่ายวิชาการ · รังสีเทคนิค`. Most roles keep clean
names; only 11 names out of ~92 collide.

### 5c. Which nodes get a role: a tick-box, not a rule

⛔ **Do not invent a heuristic — §4 shows every one of them fails.** Add a
boolean to `team_nodes` (working name `discord_role`, label *"มี role ใน
Discord"*) and let the owner decide once per node, in the ทีม SAMO editor.

Sensible starting state, to be reviewed not trusted: every `division` ticked,
every leadership `role` ticked (นายก, อุปนายก, รองอุปนายก, หัวหน้า…), every
`สมาชิก…` **unticked**. That is ~90 entries to review, not 300.

A member receives their own node's role **plus every ticked ancestor's**. So a
`Frontend developer` under `ฝ่าย IT` gets both — `@Frontend developer` pings
only frontend, `@ฝ่าย IT` pings all of IT — which is what the owner asked for,
and it also gives the category-level access the current overwrites expect.

⚠️ This is **new work in the portal** (a migration plus a checkbox in the ทีม
SAMO editor), not just bot work.

### 5d. Managed vs unmanaged roles — the whole safety story

| Class | Example | Owner | Bot may remove |
|---|---|---|---|
| Mirrored | ฝ่าย IT, Frontend developer, หัวหน้าฝ่ายเอกสาร | ทีม SAMO | **yes** |
| Unmanaged | Master, Waiting room, moderators, bot integrations | humans | **never** |

`role_hierarchy.txt` already carries `Master` and `Waiting room`, and
`ignored_users.txt` lists 5 people to leave alone. Derive the mirrored set from
the `node_id → discord_role_id` mapping — **not** from a name prefix, and not
from a hardcoded exclusion list, which cannot see the role somebody adds next
month. Assert the property in a test: *every role the reconciler would remove
appears in the mapping.*

### 5e. Removal rules

- **Never act on absence.** Someone missing from the query result is equally a
  broken join or a dropped link. Only an explicit case counts: a linked person
  who resolves to no current placement.
- A leaver gets their mirrored roles removed and **one `ศิษย์เก่า SAMO` role
  added** — not stripped bare. A person with zero roles is indistinguishable
  from a person the bot failed to match, which destroys the member list as a
  thing you can read.
- **Blast-radius cap**: refuse the run if it would remove more than N roles or
  touch more than X% of members. Yearly turnover must require an explicit flag,
  not arrive as 400 quiet removals.
- **Never delete a Discord role object.** Deleting takes its channel
  permission overwrites with it, irreversibly. Remove it from members instead.

### 5f. Freshness

Supabase Realtime on `team_members` for "immediately", **plus** a periodic full
reconcile as the backstop — event streams drop messages; the reconcile is what
makes it eventually correct rather than eventually wrong.

⚠️ Both must call **one** function that computes the target set. Two copies of
that rule will drift; this repo has paid for that shape more than any other
(`.claude/rules/mistakes.md` class 6).

### 5g. Legibility

Roles are for **access**, not for reading the org chart.

- Turn **off** "display separately" for ฝ่าย roles, or the member list grows one
  section per ฝ่าย. Hoist leadership only.
- Add `/whois @someone`, which reads ทีม SAMO and prints their real placements.
  That is the question people actually ask, and Discord will never answer it.

### 5h. Moving to the VM

- Delete `keep_alive.py` — it exists only to stop Render sleeping. Use a
  systemd unit with `Restart=always`.
- Drop `pandas`; it is there to read one CSV. The VM is 2 GB and already runs
  nginx, the notify service and Vaultwarden.
- `ignored_users.txt` and the exceptions file must move into Postgres, or a
  redeploy loses them.
- Remove auto-create (`main.py:192`) from the sync path entirely. Provisioning
  becomes an explicit command that prints what it would create and waits.

---

## 6. Build order — each phase earns the next

**⛔ §7 blocks phase 1. Do not start before it is done.**

0. **Decide where the code lives — §8b.** Undecided, and it determines where
   every later line gets written. Do this first, it costs one conversation.
1. **Identity + the tick-box.** `discord_links`, the `/link` command, the
   `team_nodes.discord_role` flag and its checkbox. Nothing syncs yet.
2. **Report-only reconcile.** For every guild member print: who they are in ทีม
   SAMO, which mirrored roles they should hold, which they hold, what *would* be
   added, what *would* be removed, and which unmanaged roles were untouched.
   **Writes nothing.** This is the deliverable that answers "who is mismatched?"
3. **Apply, with the blast-radius cap.** Only after the owner has read the
   report. Re-print the diff at apply time rather than trusting the earlier run;
   pace against Discord's rate limits across 449 members.
4. **Live updates.** Realtime, with the periodic reconcile kept underneath.

---

## 7. ⛔ OWNER-ONLY, AND IT BLOCKS EVERYTHING — step by step

**Status: OWED. Decided 2026-09-11; the owner will do this in a later session.**

The owner chose to create a **new bot under a role account** rather than reset
the leaked token. That is the better call: the current app belongs to a
**personal** Discord account, so it graduates with the student — the failure
`docs/SUCCESSION.md` exists to prevent.

### Step 1 — Create the application

1. Sign in to Discord as the **role account**, not a personal one.
2. Go to `https://discord.com/developers/applications` → **New Application**.
3. Name it plainly: **SAMO Role Sync**.
4. ✅ **Move it to a Team** (Developer Portal → Teams → create one → transfer the
   app to it) and add **both** role accounts — `mdstuddata.beta@gmail.com` and
   `samomdkku.ai@gmail.com`. Same two-holder shape as the Vaultwarden org, so no
   graduation or lost phone strands the bot.
5. Turn on **2FA** for whichever account owns it, and put the backup codes in the
   break-glass envelope that `docs/state/HANDOFF.md` §7 already owes.

### Step 2 — Create the bot and take the token ONCE

1. In the app → **Bot** → **Add Bot**.
2. Under *Privileged Gateway Intents*, enable **SERVER MEMBERS INTENT**.
   ⚠️ Without it the bot sees no members and every sync silently does nothing.
3. **Reset Token**, and copy it **straight into the VM**, never into chat:

   ```bash
   ssh samo-vm
   sudo install -m 600 /dev/null /etc/samo-discord-bot.env
   sudo nano /etc/samo-discord-bot.env      # one line: DISCORD_TOKEN=...
   ```

   ⛔ Never `.env.local`, never a git-tracked file, never a chat message — the
   previous credential was lost exactly that way, more than once.

### Step 3 — Invite it with the narrow permission set

1. App → **OAuth2 → URL Generator**.
2. Scopes: **`bot`** and **`applications.commands`**.
3. Bot permissions: **Manage Roles**, **Manage Nicknames**, **View Channels**,
   **Send Messages**. ⛔ **Not Administrator.**
4. Open the generated URL and add it to the SAMO server.

### Step 4 — ⛔ THE STEP THAT SILENTLY BREAKS EVERYTHING

Server Settings → **Roles** → drag **SAMO Role Sync** so it sits:

- **above** every ฝ่าย / ตำแหน่ง role it will manage, and
- **below** your own staff and admin roles.

A bot without Administrator can only manage roles **below** its own, and it
fails **quietly** rather than erroring. Administrator hides this rule, which is
exactly why the narrowing has to happen before the bot ever removes a role.

### Step 5 — Close the old leak

1. Server Settings → Members → find the **old** bot → **Kick**.
   ⛔ **This is the step that actually closes it, and it is more complete than a
   token reset.** A reset invalidates a string; a kick removes the old bot's
   permissions from the server entirely, so the old credential logs into an
   account that can no longer reach anything of yours.
2. Delete the old application afterwards.
3. ⚠️ **Until this step is done the exposure is open**, which is why the public
   documents above name no application id.

✅ **Nothing is lost.** Kicking a bot does not revoke roles it granted. The ฝ่าย
roles are ordinary roles, not integration-managed (the old code distinguishes
them itself at `main.py:1138`), so the new bot can manage every one of them.

### Step 6 — Tell the next session

Say which of steps 1–5 are done. Until step 4 is confirmed, **no phase-3 apply
run may be attempted** — a bot below the roles it manages will report success
and change nothing.

---

## 8. Verified safe, so nobody re-derives it

**Resetting or replacing the bot token breaks no SAMO system.**
Verified 2026-09-11 by reading each path, not by assuming:

- Every SAMO notification uses **webhook URLs**, a separate credential:
  `functions/_discord.js`, `functions/notify.js`, and the VM's
  `/etc/samo-notify.env` (`DISCORD_PR_WEBHOOK`, `DISCORD_PROJECTS_WEBHOOK`,
  `DISCORD_VS_WEBHOOKS`, `DISCORD_CLAUDE_WEBHOOK`). The single
  `Authorization: Bearer` in that code is **Supabase**, not Discord.
- Apps Script no longer speaks to Discord at all (`appscript/prform.gs:18`).
- The owner's other Discord bot is a different application (§2).
- No bot token and no real webhook URL has **ever** been committed to this repo
  — searched at HEAD and across all history. The only match is a dummy
  (`webhooks/1/x…`) in `functions/notify.test.js`.

---

## 8b. ⚠️ UNDECIDED — where does the bot's code live?

§5h says "use a systemd unit with `Restart=always`" and never says **what that
unit runs, or how the code reaches the VM.** Nothing is decided. The options:

| | Where | Cost |
|---|---|---|
| **A — in this repo** *(recommended)* | `discord-bot/` beside `passport/` | `deploy.sh` already pulls and builds this repo on the VM, so the bot ships with everything else and CI sees it. ⚠️ It is **Python in a JS repo** — `npm ci` installs nothing for it, so `deploy.sh` needs a venv step and a `systemctl restart`, and that is real work in the one script this project cannot afford to break |
| B — its own repo, cloned on the VM | a second checkout | Keeps the toolchains apart, but creates a **second deploy path** nobody will remember exists — and this project has already been bitten by a thing that only updates when somebody remembers it |
| C — rewrite it in Node | `server/` | Removes the Python problem entirely and matches the notify service, at the cost of rewriting 1,300 lines of working `discord.py` |

**Recommended: A, and decide it BEFORE phase 1**, because it determines where
the new code gets written. The precedent is the passport merge — the deciding
argument there was that the two already deploy atomically, and the same is true
here: a role sync that reads `team_members` should ship with the schema it reads.

⚠️ **This repo is PUBLIC.** That is fine for the bot's source — the token lives
in the VM's systemd environment file and never in the tree (`§7 step 2`) — but
it is one more reason no identifier or credential may be written into it.

---

## 9. Open questions the owner has NOT answered

- **Does the Google Sheet survive as the intake form?** The bot reads ทีม SAMO
  either way — that part is decided — but if applications still arrive by Sheet,
  somebody must move an accepted applicant into ทีม SAMO by hand. A process
  question, not a code one.
- **How many people are actually mismatched?** ⚠️ **Unknown, and every number in
  this file comes from the database and the source — never from Discord.** There
  is no bot token in this environment, so the live guild has never been
  inspected: not the role list, not the member count, not how far the categories
  have drifted from `data.json`. Phase 2 is what turns this into a number.
