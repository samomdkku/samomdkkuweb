# Vaultwarden — SAMO's password vault

`https://samo.md.kku.ac.th/vault/` · files in `server/vaultwarden/`

Self-hosted Bitwarden-compatible server. Everyone uses the **normal Bitwarden
apps** (extension, phone, desktop) pointed at our server — there is no
"Vaultwarden app" to install.

## Why it is at a PATH and not a subdomain

KKU issues no subdomain (the same wall that put the docs at `/docs`), and the
VM cannot obtain its own public cert — KKU's reverse proxy terminates
`*.md.kku.ac.th` and forwards to `https://10.101.111.181`, where nginx answers
with a self-signed cert under `server_name _`. A path on the main host is the
only address available.

The widely-cited *"the Android app fails on a subpath"* report
([vaultwarden#3096](https://github.com/dani-garcia/vaultwarden/discussions/3096))
turned out to be an **incomplete TLS chain**, not the subpath. KKU's edge serves
a complete DigiCert chain — verify any time with:

```bash
echo | openssl s_client -connect samo.md.kku.ac.th:443 \
  -servername samo.md.kku.ac.th 2>&1 | grep "Verify return code"
# want: Verify return code: 0 (ok)
```

If that ever stops saying 0, **mobile clients break first and browsers keep
working** — which looks like "Vaultwarden is broken on phones". Check this
before believing that.

## ⛔ The nginx config has TWO homes

`server/nginx-samo.conf` (repo) and `/etc/nginx/sites-available/default` (live).
**`deploy.sh` does NOT copy it** — it only runs `nginx -t && systemctl reload`.
Installation is a manual `cp`, documented in that file's own header.

So: **edit the repo file, then copy it up. Never edit the live file only.**
Anyone following the header comment later would otherwise silently delete the
`/vault/` block, `/vault/` would fall through to the SPA catch-all, and every
client would receive `index.html` — which reads as "Vaultwarden is down", not
"nginx was overwritten".

`server/vaultwarden/vault-config.test.js` guards the config's internal
consistency (subpath agreement, `proxy_pass` with no URI part, the `map` at
http level). It cannot see the live file — that part is on you.

## Install (once)

```bash
ssh samo-vm                       # VPN required

# 1. Security updates FIRST. This box did not auto-patch before; a credential
#    vault on an unpatched box is the biggest risk in this whole design.
sudo apt-get update
sudo apt-get install -y unattended-upgrades sqlite3
sudo dpkg-reconfigure -plow unattended-upgrades      # answer Yes
systemctl status unattended-upgrades --no-pager

# 2. Docker
sudo apt-get install -y docker.io docker-compose-v2
sudo systemctl enable --now docker

# 3. Lay the files down
sudo mkdir -p /opt/vaultwarden/data
sudo chmod 700 /opt/vaultwarden
```

From your laptop:

```bash
scp server/vaultwarden/docker-compose.yml samo-vm:/tmp/
scp server/vaultwarden/backup.sh          samo-vm:/tmp/
scp server/vaultwarden/vaultwarden.env.example samo-vm:/tmp/
scp server/vaultwarden/vaultwarden-backup.{service,timer} samo-vm:/tmp/
scp server/nginx-samo.conf                samo-vm:/tmp/
```

Back on the VM:

```bash
sudo mv /tmp/docker-compose.yml /opt/vaultwarden/
sudo mv /tmp/backup.sh /opt/vaultwarden/ && sudo chmod 700 /opt/vaultwarden/backup.sh
sudo mv /tmp/vaultwarden.env.example /opt/vaultwarden/vaultwarden.env
sudo chmod 600 /opt/vaultwarden/vaultwarden.env

# Admin token. ⚠️ `vaultwarden hash` reads /dev/tty, so a PIPE fails with
# `Os { code: 6 }` ENXIO. It needs a pty on the host AND a tty in the
# container — `script` gives the first, `docker -it` the second:
#   printf '%s\n%s\n' "$PW" "$PW" | script -qec \
#     "docker run --rm -it vaultwarden/server:1.37.2-alpine /vaultwarden hash --preset owasp" /dev/null
# Write the hash UNQUOTED into ADMIN_TOKEN= — docker's env_file takes values
# literally, so surrounding quotes become part of the token.
sudo nano /opt/vaultwarden/vaultwarden.env      # ADMIN_TOKEN + SMTP_*

sudo docker compose -f /opt/vaultwarden/docker-compose.yml up -d
# ⚠️ /vault/alive, NOT /alive. DOMAIN carries the subpath, so Vaultwarden mounts
# every route under it INSIDE the container too.
curl -sf http://127.0.0.1:8788/vault/alive && echo "  <- container alive"

# nginx — repo file, copied up (see the TWO HOMES warning above)
sudo cp /tmp/nginx-samo.conf /etc/nginx/sites-available/default
sudo nginx -t && sudo systemctl reload nginx

# backups
sudo mv /tmp/vaultwarden-backup.service /tmp/vaultwarden-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now vaultwarden-backup.timer
```

**Verify the timer is actually SCHEDULED, not merely enabled** — a timer with
only monotonic triggers reports `enabled`/`active` while never firing
(`.claude/rules/mistakes.md` class 7). Ours uses `OnCalendar`, so:

```bash
systemctl list-timers vaultwarden-backup --no-pager
# NEXT must show a real date. "infinity" or a blank NEXT means it is NOT scheduled.
sudo systemctl start vaultwarden-backup.service   # run one now
sudo ls -la /var/backups/vaultwarden/             # an archive must exist
```

## ⚠️ A bash syntax error does NOT mean nothing ran

Bash reads a script INCREMENTALLY, not whole-file-then-execute. When
`set-smtp.sh` died with `unexpected EOF while looking for matching '`, the
statements before that line had already run: the password was written and the
container recreated. Only the verification output was lost.

So after any script that dies mid-way, **read the end state before concluding
anything about it** — and read the instrument correctly. `grep -c
"^SMTP_PASSWORD=$"` returning `0` means "no EMPTY line found", i.e. a value IS
set; it was briefly misread here as confirming the opposite. Print the LENGTH,
which has one meaning:

```bash
docker exec vaultwarden sh -c 'echo ${#SMTP_PASSWORD}'   # 0 = unset, 16 = set
```

## ⚠️ Double every `$` in vaultwarden.env

Compose v2 interpolates `env_file` values. An unescaped argon2 `ADMIN_TOKEN`
reaches the container mangled, and Vaultwarden then treats it as a PLAIN TEXT
token — the admin password stops working and the panel is guarded by a mangled
string. It degrades rather than failing, so it looks like a wrong password.

```bash
docker exec vaultwarden printenv ADMIN_TOKEN | head -c 10   # must print $argon2id$
docker logs vaultwarden 2>&1 | grep -c "plain text"          # must print 0
```

## Config errors are fatal and the message is precise

Vaultwarden validates its whole config on load and exits 12 on the first
problem, so a bad value is a crash loop, not a warning. `docker logs vaultwarden`
names it exactly. Paid for during install: `ORG_CREATION_USERS=admin` is not a
value — that setting takes `all`, `none`, or a comma-separated list of EMAIL
ADDRESSES, and `admin` gave "contains invalid email addresses" for 3 restarts.

## ⚠️ Never probe a gate with the ACTION it gates

Checking "is registration closed?" by POSTing a registration **creates an
account when the answer is no** — paid for on 2026-09-05, when a probe fired
against a container that had not finished reloading and made a real user that
then had to be deleted. `docker exec vaultwarden printenv SIGNUPS_ALLOWED` asks
the RUNNING container and changes nothing; the env FILE can be right while the
container still runs the old value. Read state from the container, and if you
must use the real endpoint, use an address the whitelist will reject anyway.

## ⛔ NEVER set SIGNUPS_DOMAINS_WHITELIST — it OPENS registration

`is_signup_allowed()` consults `signups_allowed` ONLY when the whitelist is
empty. A non-empty whitelist replaces the flag instead of narrowing it, so
`SIGNUPS_ALLOWED=false` + `SIGNUPS_DOMAINS_WHITELIST=kkumail.com` let every
kkumail account at KKU register uninvited. Measured 2026-09-06: `200`, account
created, from the open internet.

Empty whitelist + `SIGNUPS_ALLOWED=false` is the only closed configuration — and
it is also what lets you invite `@gmail.com` and `@kku.ac.th`.

**Check it the only way that means anything — try the forbidden action:**

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  https://samo.md.kku.ac.th/vault/identity/accounts/register \
  -H 'Content-Type: application/json' \
  -d '{"email":"probe@kkumail.com","masterPasswordHash":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=","key":"2.AAAAAAAAAAAAAAAAAAAAAA==|AAAAAAAAAAAAAAAAAAAAAA==|AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=","kdf":0,"kdfIterations":600000,"keys":{"publicKey":"AAAA","encryptedPrivateKey":"2.AAAA|AAAA|AAAA"}}'
# 400 = closed.  200 = OPEN, and you have just made an account — delete it.
# A malformed body returns 422 from the PARSER without reaching the gate, so it
# can never tell you the gate is shut.
```

## Invitations reach any domain — that is why the whitelist is unset

The succession role accounts (`mdstuddata.beta@gmail.com`, `docs/SUCCESSION.md`)
are `@gmail.com`, and with the whitelist UNSET that is fine both ways: nobody can
self-register at all, and an invitation reaches any domain. From 1.37.2's
`src/api/core/accounts.rs`:

```rust
if Invitation::take(&email, &conn).await        // <- invitations come FIRST
    || CONFIG.is_signup_allowed(&email)          // <- the gate, see above
    || pending_emergency_access.is_some()
```

An invitation is checked **before** the signup gate, so `invite.sh` and
`/vault/admin` work for `@gmail.com`, `@kku.ac.th` and anything else. Proven:
both were invited and registered while self-registration was refused 400.

⚠️ **An earlier version of this section said the opposite** — that the whitelist
BLOCKED role accounts, and that the claim "a set whitelist makes SIGNUPS_ALLOWED
ignored" was FALSE. Both were wrong, the second dangerously so; see
`docs/mistakes/authz-grants.md`. The correction is kept visible rather than
quietly deleted, because the wrong version was reasoned from a source summary
and sounded exactly as confident as this one.

## First account, and adding anyone whose mail is broken

**Prefer an invitation.** `./server/vaultwarden/invite.sh <email>` needs no
window, works for any domain, and is the normal path. Everything below is only
for a cold start or a mail outage.

⚠️ **Do NOT hand-toggle `SIGNUPS_ALLOWED`.** With the whitelist unset, flipping
that flag to `true` opens registration to the ENTIRE INTERNET, not to one domain.
The sanctioned path is the window script, which opens by setting the whitelist to
one domain and closes by clearing it — so the widest it can ever be is that
domain, and it closes itself on exit, Ctrl-C or kill alike:

```bash
sudo /opt/vaultwarden/signup-window.sh 15 kkumail.com
```

It verifies the close by attempting a full registration and requiring a 400.
Then: `/vault/` → **New organization** → `SAMO MDKKU` → Collections `IT-Core`,
`Comms`, `Handover`, `Dev` → Members → Invite → Confirm.

**`Dev` is the contributor collection** and it exists to keep contributors OUT of
`IT-Core`. It holds exactly the four `SUPABASE_DEV_*` lines from
`.env.local.example` — a key to a *copy* of the database. `IT-Core` holds
`SUPABASE_DB_URL`, `SAMO_VM_SUDO_PASSWORD` and this vault's own admin password,
which is production and the machine the vault runs on. Share `Dev` with a
contributor as a plain **User**, never Manager, and never share `IT-Core` with
anyone who is not already trusted with production.
`skills/onboard-a-contributor.md` is the other half of this and says when to
hand out an account at all.

## The backup FAILS until someone registers — by design

`backup.sh` refuses to store a vault with zero users, because a valid-but-empty
database passes `PRAGMA integrity_check` and would happily rotate away 14 good
archives. On a fresh install that means the nightly timer fails every night
until the first account exists. That is a true statement, not a bug — but do
register promptly, and re-run `sudo /opt/vaultwarden/backup.sh` afterwards to
watch it pass.

## Test the websocket (UNVERIFIED until you do)

Whether KKU's edge forwards `Upgrade` is unknown — my pre-deploy probe against
`/notify` proved nothing, because that backend does not speak WebSocket and a
200 is the right answer either way.

```bash
curl -s -i -o - -H "Connection: Upgrade" -H "Upgrade: websocket" \
  -H "Sec-WebSocket-Version: 13" -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" \
  https://samo.md.kku.ac.th/vault/notifications/hub | head -1
# 101 Switching Protocols = live sync works
# 401 = the request REACHED Vaultwarden's hub and was refused for lack of a
#       token. That is what an unauthenticated probe gets, and it proves the
#       path and proxy work — it does NOT prove the Upgrade completes. Measured
#       2026-09-05: 401. A definitive answer needs a signed-in client.
# 404 / 502 = the proxy is wrong. 426 / 400 = the edge stripped Upgrade.
```

**Polling is not a failure.** The vault works either way; you lose instant
cross-device sync and "log in with device". Do not spend a day on this.

## `/var/backups/vaultwarden/adhoc/` — snapshots NOTHING rotates

`backup.sh` keeps 14 nightly archives and prunes the rest. **`adhoc/` is outside
that.** It holds one-off `sqlite3 .backup` snapshots taken by hand before
destructive operations (two exist, from deleting test accounts on 2026-09-05).
They are real vault data, encrypted at rest, mode 600 — and nothing will ever
delete them.

Prune them yourself once you are sure the change they guarded is settled:

```bash
sudo ls -la /var/backups/vaultwarden/adhoc/
sudo rm /var/backups/vaultwarden/adhoc/<the one you no longer need>
```

Always take one before editing the database by hand; always remove it after.

## Restore

```bash
sudo systemctl stop vaultwarden-backup.timer
sudo docker compose -f /opt/vaultwarden/docker-compose.yml down
sudo tar -xzf /var/backups/vaultwarden/vaultwarden-<STAMP>.tar.gz -C /opt/vaultwarden/data
# ⚠️ A stale WAL beside a restored db CORRUPTS it as sqlite tries to replay.
sudo rm -f /opt/vaultwarden/data/db.sqlite3-wal /opt/vaultwarden/data/db.sqlite3-shm
sudo docker compose -f /opt/vaultwarden/docker-compose.yml up -d
```

The archive carries `db.sqlite3`, `config.json`, `rsa_key*`, `attachments/` and
`sends/`. **A database-only restore loses every attachment and invalidates
every session** — that is why the script collects all of it.

## Offboarding someone

1. `/vault/admin` → Organizations → SAMO MDKKU → Members → **Remove**
2. Rotate what they could read while a member — not everything SAMO owns, just
   their collections. This short list is the entire reason for per-person
   accounts.

## Where the admin password is

Generated on the VM during install and never printed to a transcript:

```bash
sudo cat /root/vaultwarden-admin-password.txt     # 32 chars, mode 600, root
```

That is the password for `/vault/admin`. The env file holds only its argon2id
hash. Put a copy in the vault itself once the vault exists — and in the
break-glass envelope, since the vault cannot hold its own recovery.

## Break-glass — NOT optional

The VM's sudo password and SSH keys live in a vault **hosted on that VM**. If
the box is down, the credentials to fix it are inside the thing that is down.

Print the SAMO Gmail password + its 2FA backup codes + one working SSH key,
seal it, give it to the อาจารย์ที่ปรึกษา. Re-do it whenever the Gmail password
changes.

## Routine care

```bash
# monthly: update the image (the tag is pinned on purpose — updates are deliberate)
sudo docker compose -f /opt/vaultwarden/docker-compose.yml pull
sudo docker compose -f /opt/vaultwarden/docker-compose.yml up -d

# from your laptop, regularly: get a copy OFF the VM
./server/vaultwarden/pull-backup.sh ~/samo-vault-backups
```

A backup that only exists on the VM is not a backup — the VM dying is the case
you are insuring against.
