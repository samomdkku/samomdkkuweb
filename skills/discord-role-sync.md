# Working on the Discord role sync

**Read `docs/state/HANDOFF.md` §14b first** — it is what is TRUE NOW and what is
OWED. `docs/DISCORD-ROLE-SYNC.md` is the design. This file is only the
mechanics, because they are non-obvious in three ways that cost time to
rediscover.

## ⛔ NOTHING HAS EVER BEEN WRITTEN TO DISCORD — keep it that way until asked

No role has been created, assigned or removed by this system. Verified
2026-09-13 from the guild itself: 183 roles, 48 mappings, newest written by the
session before. **Every tool here plans by default and that is not an accident —
do not pass `--apply` without the owner asking for that specific run in words.**

The one thing outstanding is ONE role (`ฝ่าย รพ. ร่วมผลิต`, covers the 27 people
who would otherwise get nothing). It has been put to the owner and **not
answered**. `HANDOFF` §14b holds it.

## ⛔ The two credentials live in different places, and neither may move

| | where | why it cannot move |
|---|---|---|
| `DISCORD_TOKEN` | the VM, `/etc/samo-discord-bot.env` (root, 0600) | leaked into a chat transcript THREE times; every leak was a copy in transit |
| Supabase | your laptop (`.env.local`) or the VM (`/etc/samo-notify.env`) | the maintainer PAT must never reach the VM |

So anything needing both runs **on the VM**, and the read-only report runs in two
halves with only a **dump** crossing between them:

```bash
# on the VM — needs the token, touches no database
ssh samo-vm
sudo bash -c 'set -a; . /etc/samo-discord-bot.env; set +a; node <tool> --fetch /tmp/g.json'

# here — needs Supabase, touches no Discord
scp samo-vm:/tmp/g.json /tmp/ && npm run discord:report -- --report /tmp/g.json
```

The dump holds ids and role names and no credential. **Copying the TOKEN to the
machine that has the database is the move that leaked it three times.**

## Running the tools

```bash
npm run discord:report -- --report <dump>     # read-only, guarded: no verb but GET
node tools/discord-provision.mjs              # plan only; prints the recommended command
node tools/discord-provision.mjs --apply --adopt-only --adopt N --create 0
node tools/discord-provision.mjs --only 'ฝ่าย รพ. ร่วมผลิต'   # plan ONE ตำแหน่ง
node tools/discord-apply.mjs                  # plan only; the one that changes members
node tools/discord-apply.mjs --apply --add N --remove M --only <discord-user-id>
```

⚠️ `--apply` requires the counts you just read. If the plan changed since — a
node ticked, a role renamed — it refuses. That is deliberate: an `--apply` that
recomputes can do something nobody saw. Both writing tools work this way.

`discord-apply.mjs` needs BOTH credentials, so unlike the report it does not
split in half — **it only runs on the VM**:

```bash
scp tools/discord-apply.mjs samo-vm:/tmp/          # it imports nothing — one file
{ printf '%s\n' "$PW"; sleep 5; } | ssh -tt samo-vm \
  'sudo -v && sudo bash -c "set -a; . /etc/samo-discord-bot.env; . /etc/samo-notify.env; set +a; node /tmp/discord-apply.mjs"'
```

⛔ **A 0/0 PLAN IS NOT A GREEN WRITE PATH.** As of 2026-09-13 the plan is 0 add,
0 remove — one person is linked and already holds both roles they are due — so
the PUT and the DELETE have never executed **against the real guild**. The first
run that writes must be `--only <one discord-user-id>`, watched.

✅ **They HAVE executed against a stub.** `npx vitest run
src/js/discord-apply.run.test.js` runs the real file as a child process against
a fake Discord + PostgREST (`src/js/discord-apply.fixture.js`) and asserts the
exact requests it emits. **Change the tool's write path and run that first** —
it is the only thing here that can see a swapped id or a wrong verb, and it is
what caught `X-Audit-Log-Reason` being Thai (a header value is latin-1, so
`fetch` threw before any request existed and every write died). The same defect
was shipped in `discord-provision.mjs`'s never-run CREATE branch.
⚠️ The tool honours `DISCORD_API_BASE` **only** for `127.0.0.1` — that is what
makes the override safe in a process holding the bot token. Do not widen it.

✅ **The step that fails silently is checked by the tool now.** §7 step 4 (the
bot must sit ABOVE every role it manages; Administrator does not exempt it) was
a thing a human had to remember. `discord-apply.mjs` reads the bot's highest
role position and refuses, naming each role in the plan that sits at or above
it. Measured 2026-09-13: `samomdkkubot` is at position 182 of 183, i.e. the top.
A mirrored role created LATER can land above it, which is why this is a per-run
check and not a one-off confirmation.

## ⛔ "Not linked" is two states, and only one may be left alone

`discord-apply.mjs` skips a guild member with no link — §5e, absence is UNKNOWN.
But a person who UNLINKED is also absent, and before 0187 that meant their ฝ่าย
roles could never be removed by anything. `discord_orphaned_accounts` records
the withdrawal through all three doors (unlink · person deleted · **re-link to a
different account, which is an UPDATE**), and the plan now prints
**WITHDRAWN, AND STILL HOLDING ฝ่าย ROLES**.

⛔ **It still does not remove them** — that is the owner's undecided leaver
policy. Do not "finish the job" by stripping them; read HANDOFF §14b item 4.

## Are we ready to open this to real people?

```bash
npm run discord:readiness      # no Discord token — runs on a laptop
```

It answers the question the other two tools cannot: they describe people who ARE
linked, and one person is, so both are green and neither tells you what happens
at 342. This asks the portal instead — who can link, who is owed what, which
ตำแหน่ง can grant anything today.

⛔ **Do not offer "create only the ตำแหน่ง with people in them" as a cheaper
option — it saves ONE role** (58 of 59 have people). The cheap option is
different: only the people with NO provisioned ancestor get nothing, and one
role covers all of them. The readiness report computes it and prints the
`--only` command; never eyeball this.

⚠️ **`my_person_id()` matches on the signed-in EMAIL against `people.kkumail`.**
So having a portal account is NOT the gate and counting `people.user_id` is
measuring the wrong thing (28, versus 308 who can actually link). The gate is a
kkumail on the ทีม SAMO row.

## ⛔ Re-run the proofs after ANY provisioning run

```bash
node tools/db-query.mjs tools/team0183-discord-mapping.sql
node tools/db-query.mjs tools/team0184-discord-targets.sql
node tools/db-query.mjs tools/team0185-link-codes.sql
node tools/db-query.mjs tools/team0187-orphaned-accounts.sql
```

⚠️ **Run ALL of them, not the ones about what you touched.** Adding 0187's
trigger turned `team0185` §75 red — it asserted `limit 1` over the table's
trigger list with no ORDER BY, i.e. "the first trigger, whichever that is". And
`shop0150`, which nobody had edited, was already erroring because it copies a
template `shop_orders` row and that table is now empty. `npm run proofs` is the
only thing that finds either.

⛔ **No expected count here on purpose — every row must say PASS.** The counts
used to be written beside each line, and they had FOUR homes between this file,
STATE.md, the handoff and the design doc; adding one assertion meant correcting
all four, which is how one of them goes stale and starts lying.

`team0184` went 18/18 → 16/2 on 2026-09-12 **because a provisioning run
succeeded** — it asserted an exact role count, describing the data it happened
to see rather than the rule. This file used to add that the other two "plausibly
have the same shape and nobody has provoked it". **Provoked 2026-09-13, and
team0183 had it twice:**

- **§51 asserted a RATIO** (`untouched > ticked`) over the live tree — 107 of
  299, so 42 more ticks would have turned it red, and ticking the rest is
  exactly what the owner is asked to do. Now asserts the rule its own comment
  states (the seed did not sweep the whole tree), with a control.
- **§22-24 FOUND their two same-named nodes in production** instead of creating
  them — and §14b item 2 asks the owner to rename the contested ฝ่าย. Forced
  into a duplicate-free world it went red with `deny-rls` on three assertions,
  pointing the reader at a row-security problem that does not exist. It now
  builds the pair if production has none.

`team0185` was read for the same shape and its assertions are properties or its
own fixtures.

## ⛔ nginx is NOT deployed from this repo — but it is no longer UNGUARDED

`deploy.sh` never installs nginx config; that is always a separate step. So the
live `/etc/nginx/sites-available/default` and `server/nginx-samo.conf` can
diverge, and `/discord/config` + `/discord/callback` were added to the live one
by hand.

✅ **Diffed 2026-09-13: they are in step** — same 267 lines, the only difference
being comment prose. An install from the repo copy is safe today. (This file
previously said they had drifted and that a reinstall would drop both routes.
It was stale, and it discouraged the safe action for as long as it stood.)

⛔ **A MISSING `location` DOES NOT 404.** nginx falls through to `location /`
and serves the public SPA: measured, **200 `text/html`, 217,928 bytes**, a page
that looks entirely fine. That is why this failure has no log line and why
"I opened it and it came up" proves nothing.

```bash
npm run check:routes     # asks the SERVED host; exits 1 if a route fell through
```

It identifies each route by a marker only that route produces — `/admin/` by
the `assets/admin-` bundle its HTML names, `/discord/callback` by being a
redirect rather than a page — and it probes a path that has NEVER existed first,
so if the host stops falling through it says the verdicts cannot be trusted
instead of reporting success. `src/js/nginx-routes.test.js` covers the other
half, which no live probe can: that the repo copy still declares every route.

To change nginx: back the live file up, edit it, `nginx -t`, reload — then make
the same edit in the repo copy and run both guards.

## Where each piece lives

```
supabase/migrations/0183…0186    identity · the rule · link codes · self-read
tools/discord-report.mjs         read-only reconcile (phase 2)
tools/discord-provision.mjs      adopt/create roles (phase 3a)
tools/discord-apply.mjs          add/remove roles on MEMBERS (phase 3) — the only writer
src/js/discord-apply.test.js     its five safety properties, each watched failing
server/discord-oauth.mjs         the OAuth callback, on the notify service
src/js/discord-link.js           the card on ข้อมูลของฉัน
server/check-env-file.sh         inspect a secret env file WITHOUT printing it
```

`public.discord_role_targets()` is the ONE function that decides which roles a
person is due. Never recompute that rule anywhere else — a second copy in the
bot or the portal is the shape this repo has paid for most.

## ⛔ Clean up after yourself on the VM

Running a tool there means `scp`-ing it to `/tmp` and leaving a copy behind. Two
reasons that matters: a **stale copy of a tool** can be run by a later session
that does not know it is out of date, and a **guild dump is data** — member
snowflakes and nicknames, world-readable in `/tmp` if you chmod'd it to move it.

```bash
sudo rm -f /tmp/*.mjs /tmp/*.sh /tmp/g*.json
```

The nginx backups (`/etc/nginx/sites-available/default.bak-*`) are the opposite:
**leave them.** They are the only way back if a hand edit breaks the config.
