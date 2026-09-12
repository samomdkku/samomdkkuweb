# Discord role sync — ทีม SAMO as the source of truth

**Status: PHASE 1's PORTAL HALF IS BUILT (0183, 2026-09-12). NO BOT CODE
EXISTS.** Written 2026-09-11 from a scan of the existing bot and measurements
against production. No code in this repo touches Discord as a bot, and none
should be written until §7's owner steps are done — which is still true.

⛔ **Do not start building from the middle of this file.** §1 is the goal, §3 is
why the obvious approach fails, §6 is the build order, §7 is what only the owner
can do. A session that starts coding at §5 will build a sync that cannot
identify anybody.

✅ **§8b is DECIDED (2026-09-12): option A** — the bot lives in `discord-bot/`
in this repo. ✅ **Phase 1's portal half is APPLIED and PROVED**: migration 0183
and `tools/team0183-discord-mapping.sql`, 22/22, watched failing before the
migration went in. ⛔ **§7 still blocks every line of bot code**, and phase 2
cannot be attempted before §7 step 4 is confirmed.

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

✅ **BUILT — migration 0183.** `discord_links` exists, is RLS'd to the ทีม SAMO
editor's audience, unreadable by the anon key, and unique in BOTH directions
(a person cannot hold two accounts; an account cannot be claimed by two people).
The `/link` command below is bot work and is NOT written.

Add `discord_links` (`person_id`, `discord_user_id`, `linked_at`, `linked_by`).
A table, not a column on `team_members`, because a person holds several
placements and the link belongs to the **person**.

⛔ **DO NOT COPY `!verify`'S CHECK. Read 2026-09-12, and it does not survive
the change of consequence.** `main.py:711` asks for *the last five digits of
your รหัสนักศึกษา* and matches any Sheet name ending in them. That was
defensible for what it did — the old bot only ADDED roles and renamed you — but
a รหัสนักศึกษา is **not a secret**. It is on the ID card, on every form, and
visible to staff throughout this portal. Under the new design the same check
grants that person's **roles and their channels**, including leadership ones.
A control is only as strong as what it now unlocks, and this one's consequence
just grew by an order of magnitude.

It is also weak in the way that matters least for a brute-forcer and most for a
colleague: nobody needs to guess. Anyone who can see a classmate's student ID
can become them.

**Use the identity the portal already proves.** A student signs in with Google
/ @kkumail.com — that is the registry's whole basis (`people.kkumail`, one
person, unique). So:

1. signed in on the portal, the person opens **เชื่อมบัญชี Discord** and gets a
   short single-use code with a few minutes' life;
2. in Discord they run `/link <code>`;
3. the bot exchanges the code for the `person_id` that generated it, and writes
   `discord_links`.

Nothing guessable, no new authentication, no email quota
(`docs/EMAIL.md` — the VM can send through a relay but it is quota-bound and
this does not need it), and the code proves a *live signed-in session*, which
five digits printed on a card never did. It also gives the portal the natural
place to show **"เชื่อมแล้วกับ @name"** and an unlink button.

⚠️ **This is a change to the plan, not a detail** — it adds a table (or a column
pair) for pending codes and a small portal screen, both of which belong to
phase 1's tail rather than to the bot. Decide it before writing `/link`.

Store the **user id** — the snowflake, which nobody can edit — and never a
display name.

### 5b. Roles: store a mapping, never match on a name

✅ **BUILT — 0183** as `team_nodes.discord_role_id`, uniquely indexed where not
null, so two same-named ตำแหน่ง can never resolve to one Discord role. Proved
against the real collision on production, not a synthetic one: the proof first
asserts that duplicate names still exist, so it goes red rather than quietly
testing nothing if the org is ever restructured.

Store `node_id → discord_role_id`. The name becomes a label the bot keeps
updated, never the identity. Then a rename renames the role instead of forking
it, and the six เหรัญญิก can never merge.

Qualify a display name **only when the plain one is taken**:
`เหรัญญิก · รพ.ขอนแก่น`, `ฝ่ายวิชาการ · รังสีเทคนิค`. Most roles keep clean
names; only 11 names out of ~92 collide.

### 5c. Which nodes get a role: a tick-box, not a rule

✅ **BUILT — 0183** as `team_nodes.discord_role`, with **มี role ใน Discord** in
the ทีม SAMO node editor. ⚠️ **The seed is narrower than what this section
asked for, on purpose.** §5c below says "every leadership role" — but
identifying leadership BY NAME is the same class of guess this design exists to
avoid (`หัวหน้าฝ่ายวิชาการ` alone exists four times). So the seed used only
markings a human had already made deliberately: `kind='division'`, and
`is_board` (0104's "แสดงในกริดคณะกรรมการ", which means exactly "this is a
leadership position"). Hidden nodes — อาจารย์ / เจ้าหน้าที่คณะ — were excluded.
**The remaining ตำแหน่ง are unticked and the owner reviews them in the editor.**

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

✅ **BUILT — 0184, and it lives in POSTGRES, not in the bot.**
`public.discord_role_targets()` returns one row per linked person: the role ids
to apply, their names so the report is readable, the ticked-but-unprovisioned
nodes as `pending`, and how many ตำแหน่ง they hold. In the database "one
function" is structural rather than a promise — `/whois` and any future portal
screen ask the same question and cannot answer it differently.

⛔ **IT IS A PREDICTION, NOT AN INSTRUCTION.** It is SECURITY INVOKER, so a
caller who cannot read `team_nodes` gets ZERO ROWS — which to a reconcile is
indistinguishable from "nobody should hold anything". That is class 2 exactly,
and it is why §5e's blast-radius cap is not optional politeness: it is the only
thing between a misconfigured credential and 449 silent removals. The proof
asserts the ambiguity EXISTS so nobody mistakes it for a safe default.

⚠️ **A placement grants whether or not it is CONFIRMED** (449 placements, 412
confirmed) — a decision, not an oversight: `confirmed` is the person
acknowledging their own ตำแหน่ง, not an admin approving it. One line to flip,
and `team0184-discord-targets.sql` §F pins the current answer.

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

0. ✅ **DONE 2026-09-12 — §8b is option A**, `discord-bot/` in this repo.
1. 🟡 **PARTLY DONE — the PORTAL half shipped (0183).** `discord_links`, the
   `team_nodes.discord_role` flag and its checkbox all exist and are proved.
   ❌ **Still owed: the `/link` slash command**, which is bot code and therefore
   blocked on §7. Nothing syncs yet.
2. **Report-only reconcile.** For every guild member print: who they are in ทีม
   SAMO, which mirrored roles they should hold, which they hold, what *would* be
   added, what *would* be removed, and which unmanaged roles were untouched.
   **Writes nothing.** This is the deliverable that answers "who is mismatched?"
3. **Apply, with the blast-radius cap.** Only after the owner has read the
   report. Re-print the diff at apply time rather than trusting the earlier run;
   pace against Discord's rate limits across 449 members.
4. **Live updates.** Realtime, with the periodic reconcile kept underneath.

⛔ **NO SECOND DISCORD APPLICATION.** A dev app invited without `Manage Roles`
was proposed on 2026-09-12 and declined by the owner as not worth the upkeep.
Do not re-propose it. What replaces it is 0184: everything that DECIDES runs in
Postgres and is developed and proved against samo-dev with no Discord
credential, and only the half that reads the live guild needs a token — which
runs on the VM. Writes stay gated by `--apply` defaulting off, the
blast-radius cap, and an assertion that the reconcile module contains no
Discord write call at all.

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
   **Leave PRESENCE and MESSAGE CONTENT off.** Nothing in this design reads
   either: the commands are slash commands (`/link`, `/whois`), which deliver
   their arguments directly, and only the OLD bot's `!` prefix commands needed
   message content. Message Content is a read of every message anybody sends in
   the server — not something to hold because it was one click away.
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
   **Send Messages**.
4. Open the generated URL and add it to the SAMO server.

⚠️ **Administrator is not a shortcut, and it does not save a future step.** The
owner asked for it on 2026-09-12 to avoid ever editing permissions again —
which is not what it buys, for two reasons:

- **A bot's permissions are editable at any time**, in Server Settings → Roles →
  the bot's role, with no re-invite. So choosing the narrow set now costs
  nothing later; the only thing that needs a fresh invite URL is a new OAuth
  *scope*, and Administrator does not help with that either.
- **Administrator does NOT exempt a bot from role hierarchy** (see step 4).
  Only the guild owner is exempt. So the drag in step 4 is mandatory either way,
  and it is the step that actually determines whether the sync works.

What Administrator does change is the blast radius of the one credential this
project has already lost twice: an Administrator bot can delete every channel,
delete every role, and ban every member. The narrow set cannot. That is the
whole trade — the owner's call, and reversible in both directions.

### Step 4 — ⛔ THE STEP THAT SILENTLY BREAKS EVERYTHING

Server Settings → **Roles** → drag **SAMO Role Sync** so it sits:

- **above** every ฝ่าย / ตำแหน่ง role it will manage, and
- **below** your own staff and admin roles.

A bot can only manage roles **below** its own highest role, and it fails
**quietly** rather than erroring.

⛔ **ADMINISTRATOR DOES NOT EXEMPT IT.** This was stated backwards here until
2026-09-12. Role hierarchy is checked for Manage Roles, Kick, Ban and Manage
Nicknames regardless of Administrator; the only account exempt from it is the
guild **owner**. So a bot sitting below `ฝ่าย IT` cannot grant or remove
`ฝ่าย IT` even with every permission in Discord — it will report success and
change nothing, which is the failure this whole step exists to prevent. Do this
drag whichever permission set you chose in step 3.

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

## 8b-bis. ⚠️ THE PREMISE OF 8b CHANGED — reopen it before phase 3

**Status: VERIFIED 2026-09-12 — how:** read `server/notify-server.mjs` and
`server/nginx-samo.conf` on the live VM, and traced what each phase actually
needs from Discord.

**8b was decided against a cost that may not exist.** Option A was chosen
knowing it meant "Python in a JS repo, so `deploy.sh` grows a venv step and a
`systemctl restart`" — real work in the one script this project cannot afford to
break. That cost was assumed because a bot needs a **gateway connection**, which
is what `discord.py` is for.

**Check what each piece actually needs:**

| Piece | Discord mechanism | Needs a gateway? |
|---|---|---|
| the report (phase 2) | `GET /guilds/…/members` | no — **built, and it is 200 lines of Node** |
| provisioning (phase 3) | `POST/PATCH /guilds/…/roles` | no |
| add / remove a role | `PUT/DELETE /guilds/…/members/…/roles/…` | no |
| `/link`, `/whois` | **an HTTP interactions endpoint** | **no** |
| live updates (phase 4) | Supabase Realtime → REST | no — the trigger is the DATABASE, not Discord |

⛔ **Nothing in this design requires a persistent gateway connection.** Slash
commands can arrive as ordinary HTTPS POSTs to a URL registered with Discord,
Ed25519-signed. **The VM already runs exactly that shape**: nginx
reverse-proxies `POST /notify` to a Node service on `127.0.0.1:8787` under
systemd with its secrets in a `0600` env file. A `/discord` location beside it
is one nginx block and one route — no venv, no second deploy path, no new
service topology.

**And the argument that made C expensive was wrong.** §8b priced option C as
"rewriting 1,300 lines of working `discord.py`". There is nothing to port: the
identity model, the role mapping, the removal rules and the trigger are all
being replaced, and §3 is four measured reasons the old logic must not be
carried over. The 1,300 lines are being deleted either way.

**Recommendation: C — `server/`, beside the notify service.** Same language,
same deploy, same systemd pattern, same secret handling, and the tests already
cover that directory. Option A remains defensible if a gateway is ever wanted
(presence, message events, live member joins), but nothing here wants one.

⚠️ **Not re-decided unilaterally — the owner chose A and this is a request to
look again, before phase 3 writes the first resident process.** Phase 2 is
unaffected either way: it is a `tools/*.mjs` report and always was.

---

## 8b. ✅ DECIDED 2026-09-12 — OPTION A: `discord-bot/` in this repo

§5h says "use a systemd unit with `Restart=always`" and never says **what that
unit runs, or how the code reaches the VM.** Nothing is decided. The options:

| | Where | Cost |
|---|---|---|
| **A — in this repo** *(recommended)* | `discord-bot/` beside `passport/` | `deploy.sh` already pulls and builds this repo on the VM, so the bot ships with everything else and CI sees it. ⚠️ It is **Python in a JS repo** — `npm ci` installs nothing for it, so `deploy.sh` needs a venv step and a `systemctl restart`, and that is real work in the one script this project cannot afford to break |
| B — its own repo, cloned on the VM | a second checkout | Keeps the toolchains apart, but creates a **second deploy path** nobody will remember exists — and this project has already been bitten by a thing that only updates when somebody remembers it |
| C — rewrite it in Node | `server/` | Removes the Python problem entirely and matches the notify service, at the cost of rewriting 1,300 lines of working `discord.py` |

**Chosen: A** (owner, 2026-09-12), before phase 1 as intended, because it
determines where the new code gets written. ⚠️ **The cost named in the table is
now OWED work, not a hypothetical**: `deploy.sh` has no venv step and no
`systemctl restart samo-discord-bot`, so the first bot commit must add both —
and `server/deploy.sh` is the one script this project cannot afford to break
(its docs step is already intermittent; see STATE.md). The precedent is the passport merge — the deciding
argument there was that the two already deploy atomically, and the same is true
here: a role sync that reads `team_members` should ship with the schema it reads.

⚠️ **This repo is PUBLIC.** That is fine for the bot's source — the token lives
in the VM's systemd environment file and never in the tree (`§7 step 2`) — but
it is one more reason no identifier or credential may be written into it.

---

## 8e. ⚠️ LINKING SHOULD BE DISCORD OAuth2, NOT A TYPED CODE

**Status: RECOMMENDED 2026-09-12, owner not yet asked.** Raised by the owner:
*"is that the best practice standard way to do it instead of make people change
their names"*. The answer is that the typed code is better than the old
name-matching and is still **not** the standard.

**The standard is Discord OAuth2 with `scope=identify`.** A button in the
portal → `discord.com/oauth2/authorize` → the person clicks Authorize → Discord
redirects back with a `code` → the server exchanges it and `GET /users/@me`
returns the Discord user id. That is what Patreon, Twitch, Ko-fi and every game
integration do. **One click, nothing typed.**

It is also *stronger* than 0185's code, not merely easier:

| | typed code (0185) | OAuth2 |
|---|---|---|
| proves a live portal session | yes | yes |
| proves control of the **Discord** account | **no** — a code can be pasted to a friend | **yes**, Discord authenticates them |
| steps for the user | open portal, copy, switch app, type | one click |
| failure modes | expired, mistyped, already used | none worth naming |
| **needs a bot process at all** | **yes**, to receive `/link` | **no** |

⛔ **THE LAST ROW IS THE BIG ONE.** With OAuth2, linking is a PORTAL feature. It
needs no slash command, so it needs no interactions endpoint and no resident
process — which removes linking from §8b's scope entirely. The bot's first real
job becomes provisioning and reconciling, both plain REST.

**What it costs:** a `DISCORD_CLIENT_SECRET` on the VM (the notify service
already holds server-side secrets in a `0600` env file), one callback route
beside `/notify`, and a redirect URI registered in the Developer Portal — an
owner step. The callback must carry a `state` bound to the signed-in session, or
it is a CSRF that links the attacker's Discord to the victim's person.

**What happens to 0185.** The table and both functions stay and become the
FALLBACK, which is worth keeping for exactly one case: a person who cannot
complete a redirect. Nothing downstream changes — `discord_links` is the same
row either way, and `discord_role_targets()` never knew how the link was made.
⚠️ It is not free to keep: a second path into the same table is a second thing
to reason about, so if the fallback is never used it should be dropped rather
than left as decoration.

**Honest note on how this was arrived at.** 0185 was designed carefully against
the right threat — `!verify`'s five ID digits — and still reached for a
mechanism the platform already provides. *"Is there a standard way to do this"*
is a question worth asking BEFORE designing a credential, not after.

### 8e.1 — Discord Linked Roles does NOT fit, and someone will suggest it

Discord's own first-party answer (2022) is OAuth2 plus **role connection
metadata**: an app publishes verified attributes and the server admin defines
roles with requirements over them. It is the right shape for a *"verified
subscriber"* badge and the wrong shape here, for three reasons that are limits,
not opinions: metadata is capped at **5 keys** of boolean / integer / datetime,
so 107 ฝ่าย cannot be expressed; the member **opts into each role themselves**,
so nothing is ever removed; and the criteria live in Discord's UI, not in ทีม
SAMO, which puts the source of truth back in the place this whole design moves
it out of.

### 8e.2 — what the old bot got RIGHT, and how to keep it

Name-matching was cheap — no secret, no callback, no database — and for a
volunteer server running off a Sheet that was a defensible hack. It failed in
the four measured ways of §3. But it produced something OAuth2 does not: **a
member list a human can read.** `ปูปู้_#5_03015` says who somebody is;
`xX_shadow_Xx` with an anime avatar does not. Across 196 people that is real.

⛔ **The error was not the nickname. It was using the nickname as the KEY.**

| | old bot | correct |
|---|---|---|
| identity | the nickname — user-editable, user-supplied | OAuth2; Discord authenticates them |
| nickname | the **input**: rename yourself and you vanish from the sync | the **output**: the bot writes it FROM ทีม SAMO |
| who maintains it | every member, forever, and everyone at once each year | nobody |

The bot already carries **Manage Nicknames** in §7 step 3's permission set —
this is what it is for. After linking, the bot sets the nickname from the
registry and it stays correct because ทีม SAMO is the source. ⚠️ It cannot
rename anyone whose top role sits above the bot's (§7 step 4), and it fails
QUIETLY there, so the reconcile must REPORT the nicknames it could not set
rather than skipping them silently.

**The whole answer: OAuth2 for identity · bot-set nickname for legibility ·
`/whois` for the detail neither one shows.**

---

## 8c. Who can work on this — and what the docs may ask for

**Status: DECIDED 2026-09-12.** The owner's concern was never their own laptop;
it was **contributors and the documentation**, and for those the rule is strict
and unchanged: the bot token is never sent to a contributor, never written into
a `docs/` page, never in git, never in a chat message.

That is affordable because §5f's function lives in Postgres. The split:

| Half | Needs the token? | Where a contributor works |
|---|---|---|
| **Deciding** — `discord_role_targets()` | no | `samo-dev`, with the two shareable values. Proved by `tools/team0184-discord-targets.sql` |
| **Reading the live guild** | yes | the VM only |

So a contributor can change the rule, prove it against real-shaped data and open
a pull request without ever holding a credential that can touch Discord.

⛔ **A contributor-facing page may NAME the token to refuse it, and may never
INSTRUCT its use.** `docs/start/sharing-credentials.md` carries the refusal and
the reason. The property is guarded in `src/js/env-example.test.js`: the
forbidden list is read from `.env.local.example`'s maintainers-only block —
never retyped — the detector distinguishes an assignment or `$expansion` from a
mention, it has a control so an empty sweep cannot pass silently, and it was
watched failing on a planted `DISCORD_TOKEN=` before being restored.

**The precedent it generalises:** `docs/start/install.md` once told contributors
to verify their setup with `npm run dev:check`, which needs PRODUCTION
credentials they must never be sent. It failed on a *correct* setup and blamed
the reader at the exact moment they had no way to tell which of the two was
wrong. The role sync is the next place that mistake is easy to make.

---

## 8d. A rename before adoption, and why it is not where the loss is

**Status: VERIFIED 2026-09-12 — how:** measured against the live guild with
`npm run discord:report`. The owner asked: *"if channel attach to role A, if
role A isn't in the teamsamo because it got renamed, that person would lose
access"*. Three different cases hide in that sentence and only one is a problem.

**After adoption, a rename is safe.** 0183 stores `discord_role_id`, a
snowflake. The bot renames that same role OBJECT, and channel overwrites belong
to the object, so they follow it. This is the entire reason the mapping is an id
and not a name.

**An unmanaged role is never touched at all.** 131 Discord roles are claimed by
no ticked node. There is no code path that can remove them, because the managed
set is derived from non-null `discord_role_id` values — not from an exclusion
list somebody has to maintain.

**Before adoption, a rename causes a MISS — and that is the real one.** A ทีม
SAMO name that no longer matches its Discord role falls into CREATE. You get a
NEW, EMPTY role beside the one that actually holds the channel permission. The
members given it gain nothing; the old role keeps working, so **nobody is locked
out** — but it reads as the sync being broken, and it leaves a duplicate for
somebody to clean up later without knowing which is which.

Measured: **4 of 57 "new" roles are renames, covering 26 people.**
`ฝ่าย ComArt (Communication Art)` — 16 members — would have been duplicated as
an empty `ฝ่าย COMART`.

The report now has a **NEAR MATCH** bucket that normalises away emoji, brackets
and the `ฝ่าย` prefix. ⛔ **It DETECTS, it does not ADOPT.** A heuristic that
silently binds a role is how the wrong เหรัญญิก gets someone else's channels; it
goes in front of a human, beside the ambiguous bucket.

⚠️ **THE ACTUAL ACCESS-LOSS RISK IS ELSEWHERE, and it is bigger.** 368 role
grants across 153 of 196 people exist in DISCORD today. Wherever ทีม SAMO's tree
is incomplete or out of date relative to that, an apply run removes the
difference — correctly, by its own rule, and wrongly in fact. That is what the
report-only phase, the blast-radius cap and "link people first" are for.

---

## 8f. ✅ ONE DISCORD ACCOUNT PER PERSON — decided 2026-09-12

**Status: DECIDED 2026-09-12.** The owner: *"i think 1 account per person for
now is ok"*. Do not re-litigate; "for now" is noted, and the shape below is what
makes revisiting it cheap.

Already how it is built, so nothing changes: `discord_links.person_id` is the
PRIMARY KEY, and `redeem_discord_link_code` upserts on it — so linking a second
Discord account REPLACES the first rather than adding one. That is also why the
round trip is idempotent: the owner's own link was redeemed twice on
2026-09-12 and produced one row.

⚠️ **If it is ever revisited, the change is not "drop the primary key".** Several
accounts per person means deciding which one the bot writes a NICKNAME to, and
what `/whois` prints; the reconcile itself is unaffected because it iterates
guild members and asks per Discord id. Widening the key without answering those
two produces a bot that renames an arbitrary one of somebody's accounts.

---

## 8g. ⛔ THE ROLE CAP — 250, hard, and you would land at 233

**Status: MEASURED 2026-09-12 — how:** `tools/discord-provision.mjs` against the
live guild.

```
GUILD roles now:   180 of 250
after provisioning: 233 of 250   (93%)
```

**Discord's limit is 250 roles per guild. It is not raised by boosting and
there is no appeal.** Provisioning the 107 ticked nodes spends 53 of the 70
remaining, leaving 17 for everything this organisation does from now on — every
new ฝ่าย, every committee, every one-off.

⚠️ It is also a wall that arrives MID-RUN. Discord refuses role 251 outright, so
a run that overshoots leaves some nodes mapped and some not, which is the
messiest state to reason about afterwards. The tool therefore checks the total
BEFORE creating anything and refuses, rather than catching the failure.

**Where the room is.** 131 Discord roles are claimed by no ticked node. Some are
load-bearing — moderators, integrations, `Master`, `Waiting room` — and some are
leftovers the old bot created on renames and never cleaned up, because it had no
removal path at all (§3a). ⛔ **The BOT may never delete a role** (deleting takes
its channel overwrites with it, and the role that looks unused is the one
holding a channel nobody has opened this month) — but a HUMAN can, deliberately,
having checked what each one grants. That is the cheapest way to buy headroom,
and it is a decision, not a script.

The other lever is the tick-box: 107 ticked out of 299 nodes is already a
choice, and every un-tick is a role not spent.

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
