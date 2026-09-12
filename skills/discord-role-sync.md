# Working on the Discord role sync

**Read `docs/state/HANDOFF.md` §14b first** — it is what is TRUE NOW and what is
OWED. `docs/DISCORD-ROLE-SYNC.md` is the design. This file is only the
mechanics, because they are non-obvious in three ways that cost time to
rediscover.

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
```

⚠️ `--apply` requires the counts you just read. If the plan changed since — a
node ticked, a role renamed — it refuses. That is deliberate: an `--apply` that
recomputes can do something nobody saw.

## ⛔ Re-run the proofs after ANY provisioning run

```bash
node tools/db-query.mjs tools/team0183-discord-mapping.sql   # 22
node tools/db-query.mjs tools/team0184-discord-targets.sql   # 18
node tools/db-query.mjs tools/team0185-link-codes.sql        # 29
```

`team0184` went 18/18 → 16/2 on 2026-09-12 **because a provisioning run
succeeded** — it asserted an exact role count, which described the data it
happened to see rather than the rule. Fixed to assert the property, but the
other two plausibly have the same shape somewhere and nobody has provoked it.

## ⛔ nginx is NOT deployed from this repo

`/discord/config` and `/discord/callback` exist only in the VM's
`/etc/nginx/sites-available/default`, added by hand. **`server/nginx-samo.conf`
in this repo is not what nginx serves** and the two have drifted. A reinstall
from the repo copy silently drops both routes and เชื่อมบัญชี Discord stops
working with nothing in any log. No guard exists for this.

To change nginx: back the live file up, edit it, `nginx -t`, then reload — and
make the same edit in the repo copy so the drift does not widen.

## Where each piece lives

```
supabase/migrations/0183…0186    identity · the rule · link codes · self-read
tools/discord-report.mjs         read-only reconcile (phase 2)
tools/discord-provision.mjs      adopt/create roles (phase 3a)
server/discord-oauth.mjs         the OAuth callback, on the notify service
src/js/discord-link.js           the card on ข้อมูลของฉัน
server/check-env-file.sh         inspect a secret env file WITHOUT printing it
```

`public.discord_role_targets()` is the ONE function that decides which roles a
person is due. Never recompute that rule anywhere else — a second copy in the
bot or the portal is the shape this repo has paid for most.
