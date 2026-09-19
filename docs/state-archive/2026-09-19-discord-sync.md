# 2026-09-19 — Discord role sync: the day it went live (archived HANDOFF §14b)

**This is HISTORY, not status.** It is `docs/state/HANDOFF.md` §14b exactly as it
stood at the end of 2026-09-19, moved here so the live section could be rewritten
as ONE current picture. It was written in layers across the day, so earlier
blocks say things later blocks overturn — "the apply tool has never written",
"the owner has not agreed to create any role", "NOT READY TO OPEN", "0 add /
0 remove". **Every one of those is false now.** Read this for WHY something was
done; read `HANDOFF.md` §14b for what is TRUE.

The measurements and reasoning worth keeping (the 250-role cap, the three
doors of 0187, the nginx drift, the provisioning collisions) are the reason this
file exists.

---

## (archived) 14b. Discord role sync — LINKING IS LIVE, the apply step is not

### ▶ 2026-09-19 night — DISCORD NOW FOLLOWS ทีม SAMO BY ITSELF

**Status: VERIFIED 2026-09-19 — how:** live on the real guild — a placement
added on the web gave 4 keys in ~8 s and removing it took all 4 back in ~6 s; a
ฝ่าย renamed and renamed back renamed its Discord role both ways; the first full
pass was +0 −0 (identical to `discord-apply.mjs`). Proof `team0197` 17/17.

- **0197** — triggers on `team_members` / `team_nodes` / `discord_links` write
  to `discord_sync_queue` (service role only). Placing, moving, removing a
  person; creating, deleting, moving, ticking, renaming a ตำแหน่ง/ฝ่าย; linking,
  unlinking, re-linking — all enqueue. Sibling ORDER does not (Discord role
  order is a permission hierarchy; not mirrored, on purpose).
- **`samo-discord-sync`** (systemd, VM; `server/discord-sync.mjs`) drains it
  every 5 s and does a full pass every 15 min (catches missed events AND hand
  edits in Discord). `journalctl -u samo-discord-sync -f`. ENABLED at boot;
  `deploy.sh` refreshes + restarts it only if enabled — a deploy never arms it.
- **Brakes, always on:** a removal of more than 10 keys / 5 people in one pass
  is HELD and reported (the adds still go) — an accidental delete of a whole
  ฝ่าย cannot strip Discord; power keys only if named in the unit's
  `DISCORD_SYNC_ALLOW_POWER` (today: `สมาชิก SAMO Buddy`, `📇 ฝ่ายเลขานุการนายกฯ`,
  owner rule); roles above the bot skipped; an empty target set never acted on;
  a ticked ตำแหน่ง whose name only RESEMBLES a role is held, never duplicated.
- ✅ **Change log → `🤖┆samo-role-assignment-bot`** (owner's channel, 2026-09-19):
  `DISCORD_SYNC_LOG_WEBHOOK` in `/etc/samo-notify.env` (VM only; it was pasted
  in a chat — regenerate if in doubt). Every pass that changes Discord posts
  WHO edited ทีม SAMO, WHAT, and whose keys moved (0198), silently, pinging
  nobody. Held items and alerts go there too, once per 6 h. The announcement
  (how to get a missing role: link on the web, then ask the อุป to fix the WEB)
  and a summary of the day's changes (112 people) were posted the same night.
- ✅ The two near-matches were confirmed by the owner and LINKED + renamed to
  the web names (`ฝ่ายประชาสัมพันธ์ฝ่าย AMSA`, `หัวหน้าฝ่าย IT (Tech lead)`);
  nobody lost anything (the IT key's only holder is its web head).
- ⛔ `discord-apply.mjs` / `discord-keep-access.mjs` still work by hand, but the
  service will undo anything the web does not say within 15 min. Change the
  WEB, not Discord.

### ▶ 2026-09-19 — owner decisions, and the first writes to the guild

**Status: VERIFIED 2026-09-19 — how:** each role read back from the guild by id
after creation; `npm run discord:readiness` re-run after the batch.

**Decided by the owner, in words, this session — do not re-ask:**
- **Every ฝ่าย gets a Discord role, at every level** — not only the top 11
  (27 of 28 existing sub-ฝ่าย roles open channels their top ฝ่าย does not, so
  top-only would leave sub-ฝ่าย members without their channels).
- **The 250 cap is the owner's to manage** ("I can remove old role later").
- `ฝ่าย COMART` and `ฝ่ายจัดหาทุน` under ฝ่ายเวชนิทัศน์ are **SEPARATE teams**
  from the ComArt / Fundraising roles they resemble.
- **ฝ่ายวิชาการ: the TOP-LEVEL node owns the Discord role** (21 of its 23
  holders sit there). The link was on the EMPTY one under ฝ่ายรังสีเทคนิค — it
  won the 09-12 adoption race by sorting first — and was MOVED. Same-name
  siblings get `<name> · <parent>` roles (§5b), now in `discord-provision.mjs`.
- **Role writes to MEMBERS start ADD-ONLY.** Removal waits on item 4 (leavers).
- **One-time link by NICKNAME — DONE 2026-09-19: 167 linked** by
  `tools/discord-nickname-link.mjs` (ชื่อเล่น + last 4 of รหัส, exact and
  one-to-one only; never an account in `discord_orphaned_accounts`). Each row
  says `link_source = 'nickname-import'` (0195, proof `team0195` 12/12); the
  web button resets it to `oauth`. A link stores the Discord user ID, so a
  later rename changes nothing. ⏳ **7 near-matches await the owner** — the
  tool prints them; link with `--confirm <discord ids>`. 3 match nobody, 18
  nicknames are not in the shape (they use the button).
- **Rename, not copy**, to give an adopted role its web name: channel
  overwrites belong to the role ID. Owner leaned towards copy-to-new-role;
  rename was recommended and not refused. Copy only for a SPLIT.

**Done:** 56 roles created (183 → 239 of 250), all `permissions: 0`, bottom of
the list, uncoloured — so they gate NO channel yet. `เอิงtesting` UNTICKED (test
data). 340 of 342 would now get a role; the 2 left are the two same-team
near-matches (`ฝ่ายประชาสัมพันธ์ฝ่าย AMSA`, `หัวหน้าฝ่าย IT (Tech lead)`), owed
the rename step.

**✅ RAN 2026-09-19 (VPN): the 90 adopted (0 new roles; all five Discord proofs
green after) · first real member write on ONE person, re-read 0/0 · then ADD-ONLY
for all: 181 more, ✓ 181 of 181 across 91 members.** Re-read after: add-only plan
0 to add. **The live guild now holds every role ทีม SAMO says a linked person
is due.** First writes by this system to members — ever.

⛔ **2026-09-19 evening — the owner caught a wrong grant: 9 people held
`หัวหน้าฝ่าย PR`.** Fixed (0196: only ฝ่าย pass their role down; a ตำแหน่ง
used as a folder no longer does), the 9 reverted to their morning access. The
audit it triggered found the sync never looked at SERVER-WIDE power:
`สมาชิก SAMO Buddy` (manage all channels + roles) was given to หงส์ —
REVERTED; `📇 ฝ่ายเลขานุการนายกฯ` (ADMINISTRATOR) had been linked to the
website's ฝ่ายเลขานุการนายกฯ that afternoon — UNLINKED before anyone else
received it. `discord-apply.mjs` now refuses any power key without
`--allow-power '<name>'`. Every person was diffed against the morning: 0 lost.
✅ **FULL SCAN vs THIS MORNING (2026-09-19, owner asked "scan for bugs,
overpermission"), every human × every room + server-wide:** 0 lost · 0 keys
held that the web does not give · 0 server-wide powers gained · every room
gained comes from a key the web gives (180 person×room, 28 people) · 5
per-room powers gained, all from web-given keys (บอส manages the 2 VS rooms via
ฝ่ายยุทธศาสตร์, as its other members already did; ผักหวาน + เปียโน are heads).
Discord's AUDIT LOG (45 days, 467 entries) reconciles: 57 created, 1 deleted,
242 member key changes (202 given + 40 removed), 29 key room grants, 57
personal passes (7 not logged — all channels synced to a category; each exists
and grants nothing beyond that person's morning). **The bot changed no
pre-existing key's settings.** `📇 ฝ่ายเลขานุการนายกฯ` (ADMINISTRATOR) and
`สมาชิก SAMO Buddy` had those powers before 12 Aug (no change in the log) —
they PERSIST, as do their holders. **One over-permission was mine and is
fixed:** the 56 created keys were @-mentionable by everyone (server
convention: 1 of 179) — set to false, and provisioning now creates them so.
✅ **OWNER RULE (2026-09-19, in words): "everything should be according to the
website, except a bug like the PR one."** So: หงส์ was GIVEN `สมาชิก SAMO
Buddy` (the web places her there) with `--allow-power 'สมาชิก SAMO Buddy'`, and
the web's ฝ่ายเลขานุการนายกฯ was RE-LINKED to `📇 ฝ่ายเลขานุการนายกฯ`. On the
web that ฝ่าย holds ก้อง (already has it) and เอมมี่ (หัวหน้าฝ่ายเลขาฯนายกฯ, NOT
linked yet). ⚠️ When เอมมี่ links, the plan will list that key as ADMINISTRATOR
and refuse without `--allow-power '📇 ฝ่ายเลขานุการนายกฯ'` — the owner's rule
approves it; the guard stays so a BUG (the PR shape) can never hand out power
unseen. Plan after both: 0 add / 0 remove.
(superseded) ⏳ **OWNER:** does หงส์ get SAMO Buddy (and its server-wide power)? Should
ฝ่ายเลขานุการนายกฯ have a Discord key at all, given that one is Administrator?
Write-up: `docs/mistakes/authz-grants.md`.

**Owed next:**
1. ✅ **The 30 extra keys — RESOLVED 2026-09-19, owner's rule: "the web is the
   absolute truth" AND "if they previously got permission, it should persist".**
   `tools/discord-keep-access.mjs`: each extra mirrored key removed, and a
   PERSONAL channel pass (member overwrite) for exactly the bits it had opened
   — 56+1 passes, 28+2 keys, one person first. Re-read from Discord after:
   **access changed for 0 person × channel, sync unchanged**; full apply plan
   now **0 add / 0 remove**. ⛔ **Why a personal pass and not "give the web
   role the room"**: a mirrored role follows the ตำแหน่ง, so that would hand
   e.g. `#รวม-head` to every future SMST PR member. ⚠️ **The passes do not
   follow the web** — if one of these 15 people leaves, their pass stays until
   removed by hand; they are member overwrites with the audit reason
   `ทีม SAMO: keys match the web, access kept`. `ปลา` (the leaver) was placed
   instead (`confirmed = false`).
   ✅ **Art/Graphic restructured (owner: "if best practice, do it")**: new
   division `ฝ่าย Art/Graphic` under ฝ่าย ComArt, its หัวหน้า + สมาชิก moved
   in; every website permission for both ตำแหน่ง checked IDENTICAL before and
   after (node_effective_* + managed_permissions). Discord: role created, given
   the 4 rooms `สมาชิกฝ่าย Art/Graphic` opened (0 lost), handed to 15.
   ⏸ **Tier 2 (AMSA-style rooms opened ตำแหน่ง-by-ตำแหน่ง) — owner: KEEP AS IS.**
   Those keys are mirrored and follow the web; a new room there needs each
   ตำแหน่ง key. **21 of 178 room-opening keys are NOT mirrored** (hand-managed,
   do not follow the web): notably `🏅 อุปนายกฯ` (10 people), `สมาชิกฝ่าย
   Backend` (7) / `Frontend` (3) — no ตำแหน่ง of that name on the web — and the
   two near-matches `หัวหน้าฝ่าย IT`, `ประชาสัมพันธ์ฝ่าย AMSA`.
2. ✅ **Nickname near-matches — CLOSED 2026-09-19, owner decided each.** Linked:
   `Pru`, `ธิเบธ`, `Erin_#3_139-0` (the owner first said wrong — a SECOND
   account `เอิร์น_#2_093-9` is the กิจการภายนอก one; the role check settled
   it), `ฟิวส์`. Left alone: `ส้มซ่า`, `oil` (not in ทีม SAMO, no roles) and
   `สุขใจ` (not approved) — they use the web button. The owner's check —
   compare the account's Discord roles with the person's ฝ่าย on the web —
   over all 167 imports found **0 that share nothing** (148 share a role; the
   other 19 had no roles or no placement to compare).
3. Rename the 2 same-team near-matches to their web names, then adopt.
4. ✅ **CHANNELS, TIER 1 — DONE 2026-09-19** (`tools/discord-channels.mjs`): a
   ฝ่าย role gets the channels its OWN `สมาชิกฝ่าย X` role opens — allow bits
   only, so nobody can lose anything, and the tool recomputes every human ×
   every channel and refuses on any loss or broken category sync. 25 grants /
   18 ฝ่าย; re-read from the REAL guild after: **0 lost, sync 36 → 36**, one
   person gained 2 channels (`หงส์`, whom ทีม SAMO places in that ฝ่าย).
   The earlier add-only run was checked the same way: 0 lost across 95 members.
   ⛔ **A duplicate role was created by provisioning and REMOVED the same day**:
   `📇 ฝ่ายเลขานุการนายกฯ` (5 channels) was missed because the emoji was
   stripped but its space kept; an empty `ฝ่ายเลขานุการนายกฯ` was created beside
   it. The node now points at the 📇 role, the empty one was deleted (it had
   permissions 0, no overwrite, and its one holder had the 📇 role), and the
   matcher trims first (test in `discord-provision.run.test.js`). 238 roles.
   ⏳ **TIER 2 — OWNER.** 32 ฝ่าย roles still open nothing. 10 have a "team
   channel" opened separately to most of their ตำแหน่ง (`#internat-amsa`,
   `#internat-ifmsa`, `#internat-interclub`, `#interuni-smst`, the
   `#interuni-syringe` set, `#pr-contentcreator`, and ฝ่ายจัดการโครงการ's
   โครงการ category). Adding the ฝ่าย role there OPENS them to members who do
   not see them today — so it is a decision, not a rule. 22 have no channel.
   The 30 withheld removals are unchanged by tier 1 (58 channel accesses):
   they are real disagreements about who is in which ฝ่าย.
5. ⚠️ **The bot's role (`samobot`) holds ADMINISTRATOR** — read from the
   guild. The design asked for Manage Roles only, and this token has leaked
   before. Nothing done so far needed more than Manage Roles + (for tier 1)
   Manage Channels/Permissions. Owner's call; raised, not changed.
6. (was 4) The remaining channels work: tier 2 above, then new channels
   need ONE role — the ฝ่าย's. (115 of 151 channels carry custom overwrites; 56 overwrites name a
   single person and are out of scope). Owner still owes: kick
`Role assignment bot for SAMO69`.

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

⚠️ **SUPERSEDED 2026-09-19 — the owner agreed; 56 roles now exist (top of this
section).** Kept for the reasoning. No MEMBER has been given or stripped a role
yet. Everything below is a 2026-09-13 measurement, not a task list.

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

