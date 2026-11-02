# Email

> What sends it, what the daily ceilings are, and what the server can do

**Status: assessment, 2026-08-28. Nothing here is built beyond the three
`samo-dev` settings noted in §6.** Written after the owner asked whether to
migrate email off Apps Script onto a self-hosted server, and how to raise the
limits without getting flagged.

**The short answer, in one line each:**

- **The VM CAN send mail** — through an authenticated relay on 587/465, proven
  with a real SMTP session, needing nothing from anyone. §3.
- **The VM should not BE a mail server** — not *cannot*: the blockers are KKU
  firewall policy, missing PTR/MX/SPF records, and unearned IP reputation shared
  with the whole campus NAT. Two of those three are askable; the third is not,
  and none of them buys us anything. §3a lays out each layer.
- **The VM cannot RECEIVE mail** — no inbound port but 443. This is what kills
  the Mailpit trap (§7), and it is a separate fact from the two above.
- **The cheapest large win needs no infrastructure at all** — KKU runs Google
  Workspace and we are not using it. §4.
- **The prize is bigger than a quota**: there is no password reset in this app,
  and mail is why. §2.

---

📎 **A plain-language version of this assessment**, written for a reader who is
not a mail specialist (the letter-and-front-desk framing, no jargon):
<https://claude.ai/code/artifact/7b4d7e5b-9ce8-4272-a701-15d326eea064>. Same
conclusions; this file keeps the evidence and the exact numbers.

## 1. What sends email today

Two senders, and only one of them is admitted by `CLAUDE.md`.

| # | Sender | What it sends | Ceiling |
|---|---|---|---|
| 1 | **Apps Script `MailApp.sendEmail`** — `notifyProjectEmail` in `appscript/prform.gs` | the หนังสือโครงการ notification, to the curated address in `project_settings.uni_staff_email` (an `@kku.ac.th` today) | **100 recipients/day** on a consumer account, **1,500/day** on Google Workspace |
| 2 | **Supabase Auth** (built-in service) | nothing, in production, on purpose | 2 messages/hour, **and it refuses to deliver to anyone who is not a project team member** |

Sender 1 is domain-allow-listed (`EMAIL_DOMAIN_ALLOWLIST`), which matters
because the `/exec` URL is public and unauthenticated — without that check the
handler is an open relay under the display name "MDKKU SAMO".

Sender 2 is the interesting one. Production sets `mailer_autoconfirm = true`
and configures no SMTP, so `updateUser({email})` changes the address
immediately and sends nothing — `src/js/auth.js` says so in a comment, and it is
deliberate. **The app has been designed around the built-in service rather than
using it.**

## 2. The consequence nobody wrote down

**There is no password reset.** `resetPasswordForEmail` appears nowhere in
`src/js`. That is not a product decision — it is what falls out of a mail
service that will not deliver to a student address. Anyone who forgets their
password needs a human — the steps that human follows, for a username account,
are `skills/reset-a-username-password.md` (identity confirmed by the owner
first); the decision on a self-service fix is HANDOFF §38.

**That is the strongest argument for doing this work**, and it is a bigger prize
than raising the Apps Script quota.

## 3. What the VM can and cannot do

⚠️ **An earlier version of this section said "do not self-host" without
separating three different things, and that was too broad. The owner pushed
back — "isn't there a way to send email from the VM?" — and they were right.**
The VM is a perfectly good mail *client*. It just cannot be a mail *server*.

Three directions, each probed on the box itself on 2026-08-28:

| Direction | Verdict | Evidence |
|---|---|---|
| **Receive SMTP** (something outside connects in) | ❌ impossible | VM holds only `10.101.111.181`; public `202.28.95.46` has 25/587/465/1025 filtered, **443 open as the control** |
| **Send direct to recipients' MX** (port 25 out) | ❌ blocked | `aspmx.l.google.com:25` refused from the VM — the standard anti-spam egress rule |
| **Send through an authenticated relay** (587/465 out) | ✅ **works** | see below |

**Every relay worth using is reachable from the VM**, verified by TCP connect,
with `github.com:443` as the control:

```
smtp.gmail.com:587              OPEN      smtp-relay.brevo.com:587    OPEN
smtp.gmail.com:465              OPEN      smtp.sendgrid.net:587       OPEN
smtp-relay.gmail.com:587        OPEN      smtp.resend.com:587         OPEN
email-smtp.us-east-1…:587       OPEN      smtp.postmarkapp.com:587    OPEN
api.resend.com:443              OPEN      aspmx.l.google.com:25       blocked
```

⚠️ **A TCP handshake is not an SMTP session** — a captive proxy answers one and
not the other. So the session was actually opened, and Gmail really talks:

```
$ openssl s_client -starttls smtp -connect smtp.gmail.com:587
250-smtp.gmail.com at your service, [202.28.118.103]
250-AUTH LOGIN PLAIN XOAUTH2 PLAIN-CLIENTTOKEN OAUTHBEARER XOAUTH
250 SMTPUTF8
```

STARTTLS completes and `AUTH` is offered. **The VM can authenticate and send
today**, with no request to anyone.

📌 The VM's outbound NAT address is **`202.28.118.103`** — a *different* address
from the `202.28.95.46` that serves the website.

### So what is actually ruled out

Only the *independent mail server*, and for two reasons that both still hold:

- **Port 25 outbound is blocked**, so it could not deliver to recipients anyway.
- **`kku.ac.th` publishes `DMARC p=reject`** (`v=DMARC1; p=reject;
  rua=mailto:mail-report@kku.ac.th`) with no `sp=`, so `md.kku.ac.th` inherits
  *reject* and publishes no SPF or MX of its own. Mail claiming either domain
  from an unblessed source is discarded, not spam-foldered. **DNS is
  `ns0`–`ns4.kku.ac.th` (SOA contact `noc.kku.ac.th`)**, so the records that
  would fix that are a request to KKU NOC.

DMARC constrains **which address you send AS**, not which machine sends. Relay
through Google as the SAMO Gmail address and it is aligned today; send as
`@md.kku.ac.th` and you need DKIM records from NOC, whatever host you use.

📌 **Cloudflare is not in the mail path at all** — Pages is retired, Cloudflare
does not send email, and nothing there is limiting or flagging anything.

📌 Postfix runs on the VM already (`inet_interfaces = loopback-only`,
`relayhost` empty) for local delivery only. **The queue is empty and nothing is
deferred**, so it is unused rather than broken — but with port 25 blocked and no
relayhost, any system mail to an outside address today would go nowhere. Setting
`relayhost` gives cron and certbot somewhere to send, and gives the app queuing
and retry for free.

## 3a. "Is it REALLY impossible?" — no, and that word was wrong

Asked 2026-08-28. **Nothing stops the software from running** — Postfix is
already running on that box. What stops the mail from being *accepted* is three
layers, and it matters which of them anyone can actually remove.

### Layer 1 — KKU's firewall. They could change this.

Inbound 25 is not mapped, outbound 25 is blocked. **Both are policy, not
physics.** You could ask, and the ask is not unreasonable — but understand what
you are asking for: blocking 25 is near-universal at universities because one
compromised machine behind it becomes a spam cannon overnight, and opening
inbound 25 puts an internet-facing mail daemon on a box that currently exposes
nothing but nginx.

### Layer 2 — the identity records. KKU NOC could change these.

| Record | State | Consequence |
|---|---|---|
| **PTR for `202.28.118.103`** | ❌ **none** | this is checked first by every large receiver; no reverse DNS is an immediate penalty at Gmail and a rejection at some hosts |
| **PTR for `202.28.95.46`** | ❌ none | — |
| **MX for `md.kku.ac.th`** | ❌ none | nothing would route mail to us even with 25 open |
| **SPF** | authorizes Google, not us | mail from our IP fails alignment |
| **DMARC** | `p=reject`, inherited | so that failure means *discarded* |

⚠️ **The SPF change is the one NOC should refuse, and they would be right.**
`202.28.118.103` is a *shared NAT address* — the VM's own interface is
`10.101.111.181`. Adding that IP to `kku.ac.th`'s SPF authorizes **every machine
behind that NAT** to send as the university.

📌 **The VM's in and out addresses are different** — `202.28.95.46` inbound,
`202.28.118.103` outbound. A mail server's identity has to be coherent: HELO
name, PTR, SPF and MX all naming one address. Split NAT means that has to be
aligned or dedicated before anything else can even be attempted.

### Layer 3 — everyone else's spam filters. Nobody can change this.

A new sending IP has no reputation, and is throttled or spam-foldered for weeks
regardless of correct configuration. Worse here: **that reputation would be
shared with the whole campus NAT.** One compromised machine anywhere behind
`202.28.118.103` and password resets stop arriving, with no notification and no
appeal. *(Checked 2026-08-28: not currently on Spamhaus, SpamCop, SORBS or
Barracuda — with `127.0.0.2` as a positive control proving the lookups work. Not
listed today is not the same as trusted, and it is not a property we control.)*

Layer 3 is what that `r/selfhosted` thread is really about, and it is why even
its success stories relay.

### And what would we gain?

Nothing this project needs. Mailboxes — staff already have Google ones at
`@kku.ac.th`. Independence — we would be newly dependent on KKU's firewall,
KKU's DNS, and a shared IP's reputation, all outside our control. That is more
fragile than a relay, not less.

**If the goal is genuinely to own the infrastructure, the KKU VM is the wrong
box.** The right one is a €4–5/month VPS with a dedicated IP and rDNS you set
yourself — which is exactly what everyone in that thread who succeeded actually
did. Note that even they relay outbound.

## 3b. "Is there a way around it?" — yes, for two of the three layers

Asked 2026-08-28, straight after §3a. Taking the layers in order:

### Layer 1 — already worked around, and by design

**Port 587 is the way around a blocked port 25.** That is what submission ports
exist for. KKU blocks 25 and leaves 587 open — that is not an oversight, it is
the network telling you which door to use: *authenticated* mail through an
accountable relay, rather than anonymous direct delivery. Using a smarthost is
not a workaround here; it is the sanctioned path, and it already works from the
VM today.

⛔ **What is NOT worth doing is evading the 25 block itself** — tunnelling out
to deliver directly. Not mainly because it is against the spirit of a control
KKU put there deliberately, but because **it buys nothing**: you would still have
no PTR and no IP reputation (§3a layers 2 and 3), so the mail would be discarded
at the far end anyway. The block is not what is stopping you.

### Layer 2 — worked around completely, by owning a domain

**This is the real unlock, and it removes KKU NOC from the critical path.**

Every identity problem in §3a is a problem *because the DNS belongs to someone
else*. Register a domain — roughly $10–15/year at Cloudflare or Namecheap — and
SPF, DKIM and DMARC become records you add yourself in five minutes. No request,
no waiting, no asking anyone to widen the university's SPF.

| | `md.kku.ac.th` | a domain we own |
|---|---|---|
| add DKIM/SPF | a request to KKU NOC | five minutes, self-service |
| DMARC policy | inherited `p=reject`, not ours | ours to set |
| institutional trust | **high** — students know it | has to be earned |
| time to first send | unknown, depends on NOC | today |

⚠️ **The trade is trust, and in a university it is a real cost.** A password
reset from `noreply@samo-mdkku.org` can read as phishing to a student who has
only ever seen `@kku.ac.th` — and teaching students to trust an unfamiliar
domain for password mail is a genuinely bad habit to instil.

**So do both, in this order:** own a domain to unblock the work now, and make the
NOC request for a `mail.samo.md.kku.ac.th` subdomain in parallel. Move the
sending identity across when it lands. Nothing is wasted — the relay, the code
and the templates are identical either way; only the DKIM records change.

### Layer 3 — no way around, for anyone

Reputation cannot be bypassed, bought quickly, or tunnelled. **The way "around"
it is to borrow someone else's**, which is exactly what sending through Google,
Brevo, Resend or SES does — their IPs, their standing, built over years.

That is the whole reason the recommendation is a relay. Not because self-hosting
is hard, but because **reputation is the one component you cannot build, and
renting it is free.**

### If we ever do need to RECEIVE mail

We do not today (§6a), but the pattern exists and is what the `r/selfhosted`
thread's successful self-hosters actually run: **a small VPS holds the public MX
and the port 25 the world connects to, and the VM reaches it over a tunnel the
VM opens outward** (WireGuard or SSH — outbound, which works). Mail arrives at
the VPS and is handed down to us. It is a genuine solution to a blocked inbound
port, and it costs a second machine to maintain forever. Worth it only if
receiving becomes a real requirement.

## 4. What KKU already has, and why it is the cheap win

`MX` for both `kku.ac.th` and `kkumail.com` points at `ASPMX.L.GOOGLE.COM`:
**KKU runs Google Workspace**, and `include:_spf.google.com` is already in the
`kku.ac.th` SPF record.

So mail sent *through Google, from a KKU account* is aligned, DKIM-signed and
trusted **today, with no DNS request and no new service**. The ceilings:

| Path | Recipients/day | Needs |
|---|---|---|
| Apps Script `MailApp`, consumer account | 100 | (what we have now, if the account is consumer) |
| Apps Script `MailApp`, Workspace account | **1,500** | move the script's owner account |
| `smtp.gmail.com` + app password, consumer | 500 | an app password |
| `smtp.gmail.com` + app password, Workspace | 2,000 | an app password |
| `smtp-relay.gmail.com` (Workspace) | 10,000 | a Workspace admin to enable the relay |

**First thing to check, one line, no deploy needed once you can run the script:**

```js
Logger.log(MailApp.getRemainingDailyQuota());   // 100 → consumer · 1500 → Workspace
```

If it prints ~100, moving the Apps Script project to a `@kku.ac.th` Workspace
account is a **15× quota increase for zero cost and zero new infrastructure.**

⚠️ Moving the script account is not free of consequences: `prform.gs` uses
`DriveApp`, and the whole Drive tree (`My Drive/IT Database`) lives in the
current account. Moving the *script* means either moving that tree or putting it
on a Shared Drive first — which `.claude/rules/security.md` already recommends
for a different reason (the OAuth grant reaches the entire Drive).

## 5. If you want password reset — the one thing that needs an outside service

Supabase needs SMTP credentials of its own; `MailApp` cannot serve it. With
custom SMTP configured the auth rate limit goes from 2/hour to 30/hour, tunable.

| Option | Free tier | Honest catch |
|---|---|---|
| **Brevo** | 300/day (~9,000/mo) | best free tier; needs DKIM/SPF records |
| **Resend** | 3,000/mo, 100/day | nicest API; needs DKIM/SPF records |
| **Amazon SES** | ~$0.10 per 1,000 | cheapest at scale, most setup, sandbox to escape |
| **SendGrid** | none — free plan discontinued | 60-day trial, then $19.95/mo |
| **Gmail SMTP app password** | 500/day (consumer) | **no DNS request at all**; sends as the gmail address, not as SAMO's domain |

**Recommended order:**

1. **Gmail SMTP app password as the pilot** — it is the only option that needs
   nothing from KKU NOC, so it proves the reset flow end to end this week. Mail
   arrives from the SAMO Gmail address; deliverability is Google's.
2. **Then one request to KKU NOC** for a dedicated sending subdomain (e.g.
   `mail.samo.md.kku.ac.th`) with the SPF/DKIM records Brevo or Resend generates.
   That is what buys mail that says SAMO and passes `p=reject`. Ask for the
   subdomain rather than records on `md.kku.ac.th` — it is a smaller ask and it
   keeps our sending reputation off the faculty domain.

## 5a. The option §3 opens up — let the VM send the notification itself

Because the VM can reach every relay on 587, **`notifyProjectEmail` does not have
to live in Apps Script at all.** `samo-notify.service` is already a Node service
on `:8787` behind nginx, already the place Discord notifications go. Adding mail
to it means:

- **the Apps Script mail quota stops mattering** — the ceiling becomes the
  relay's (Gmail 500/day, Workspace relay 10,000/day, Brevo 300/day free);
- **one notification path instead of two.** Today a หนังสือโครงการ notification
  fans out to Discord through the VM and to email through Apps Script — two
  services, two failure modes, two places to look;
- **the recipient allow-list moves off a public unauthenticated endpoint.** The
  GAS `/exec` URL ships in the browser bundle, which is why `sendProjectEmail`
  needs `EMAIL_DOMAIN_ALLOWLIST` at all — it is guarding an open relay. The
  notify service is not public in the same way.

**This competes with "move the Apps Script to a Workspace account", it does not
follow it.** Moving the script is smaller (an account change, no code) and keeps
Drive and mail together; moving the mail to the VM is more work but retires the
GAS mail path and its quota permanently. Both are defensible — **the Workspace
move is the right first step**, because it is reversible, needs no code review,
and buys 15× immediately.

⚠️ Whichever wins, `MailApp` stays for nothing else — Apps Script keeps the Drive
uploads regardless.

## 6. What was actually changed on 2026-08-28

`samo-dev` only — production untouched. Three keys, verified by diffing the full
242-key auth config before and after:

| key | was | now | why |
|---|---|---|---|
| `mailer_autoconfirm` | `false` | `true` | production has had it `true` all along, and `src/js/auth.js` **depends** on it: with it `false`, `updateEmail()` on a preview leaves the change pending instead of applying it. Dev was diverging from prod on a flow previews exist to test. |
| `site_url` | `http://localhost:3000` | `http://localhost:5174` | port 3000 is not one this repo has ever used |
| `uri_allow_list` | *(empty)* | localhost 5174/4173 + `*.samomdkkuweb.pages.dev` | empty meant every redirect fell back to `site_url` — so no preview could complete a redirect flow |

**Still true of `samo-dev`, and needing the owner:** `external_google_enabled`
is `false`, so **Google sign-in does not work on dev at all**. Previews can only
exercise username/password. Fixing it needs a Google OAuth client for the dev
project.

## 6a. "What about Mailcow / a proper mail stack?" — asked 2026-08-28

The owner brought a `r/selfhosted` thread on running Mailcow, Mailu, Stalwart,
mail-in-a-box, or a hand-rolled postfix/dovecot/rspamd stack. Worth answering
carefully, because **the thread's own top-voted advice is the test that settles
it**: *"You should test to see if your ISP blocks port 25 outbound though."*

We ran it. **KKU blocks 25 outbound** (§3). And nothing can reach us inbound.
So on this box a full mail server is crippled at both ends:

| What Mailcow is for | On this VM |
|---|---|
| deliver mail to recipients | ❌ port 25 outbound blocked — it must relay anyway |
| receive mail into mailboxes | ❌ nothing can connect in |
| host mailboxes / IMAP / webmail | ⚠️ a need we do not have — see below |
| spam + antivirus filtering | ⚠️ only matters if you receive |

What would be left running is the *relay client* — which is three lines of
configuration, not a Docker stack with ClamAV, rspamd, Dovecot and SOGo.

**But read what the people in that thread who SUCCEED actually do.** Every one
of them relays outbound through a reputable provider — smtp2go, SES, Brevo,
Mailgun, MXRoute, AuthSMTP, Google Workspace relay — and the ones who tried to
deliver directly from their own IP got blacklisted and gave up. *"Outbound was a
problem. Despite doing everything right… I eventually routed outbound mail
through Amazon SES."* **The thread agrees with §5.** It just arrives there after
building a mail server first, and we can skip that step.

**And we need strictly less than they do.** They are hosting *mailboxes* —
their identity, IMAP, storage, spam, and the disaster recovery of the address
that resets every other password they own. SAMO needs to **send transactional
mail**: a password reset, a notification. Nobody replies to those. Staff already
have `@kku.ac.th` and `@kkumail.com` mailboxes on Google. **The entire inbound
half — the hard, permanently-staffed half — is a need this project does not
have.**

📌 One comment in that thread is worth keeping for a reason beyond email:
ClamAV was not ready when rspamd checked for it, so rspamd silently ran with **no
virus scanning**, reported nowhere except one line in a startup log, for months.
That is this repo's own recurring failure — a guard that fails GREEN — in
someone else's stack, and it is a fair sample of the maintenance surface a mail
system brings.

### So: no mail server. A relay credential, and nothing else.

- **Supabase auth mail** — set custom SMTP in the Supabase dashboard. Supabase
  connects out to the relay itself; **the VM is not in this path at all.**
- **The หนังสือโครงการ notification** — the Workspace account move (§4), or
  `samo-notify` using the same relay credential (§5a).

Free tiers, for the record: Brevo 300/day (~9,000/mo) · Resend 3,000/mo ·
SMTP2GO 1,000/mo (200/day) · SES ~$0.10 per 1,000 · Gmail app password 500/day
and **no DNS request at all**. Brevo has the largest free allowance; Gmail is
the one that works this week.

⚠️ The relay password is a credential like any other: `/etc/samo-notify.env` or
the Supabase dashboard. Never a `VITE_*` var, never anything under `src/`.

## 6b. How to test the email path

```bash
npm run email:smoke                       # to the dev test inbox
npm run email:smoke -- --to a@kku.ac.th   # to a specific allowed address
```

⚠️ **It DOES send.** It also attempts one send to an address that is NOT on the
Apps Script allow-list and requires that to be refused — without that control a
success proves only that something answered, not that the guard still works.
That matters more than usual here: the `/exec` URL is public and
unauthenticated, so the allow-list is the only thing between it and being an
open relay able to send mail as "MDKKU SAMO".

Nothing it reports proves DELIVERY — only that Apps Script accepted the message.
Check the inbox.

📌 `npm run dev:check` also compares the auth settings the app branches on
(`mailer_autoconfirm` and friends), because the drift in §6 was fixed by hand
and a hand fix has no memory.

## 7. The abandoned idea, recorded so it is not re-proposed

`docs/state/phuriphatma.md` recorded "run **Mailpit** on the VM, point
`samo-dev`'s SMTP at it". Mailpit is a good tool and the reasoning was sound —
it just cannot work here, for blocker 1 in §3: Supabase Cloud cannot open a TCP
connection to a box with no public inbound port but 443.

**If a browsable trap is still wanted, the transport is HTTPS, not SMTP.**
Supabase's *Send Email Hook* (`hook_send_email_uri`) POSTs every auth email to
an endpoint instead of sending it, and 443 is the one port that reaches the VM.
It would follow the pattern already on the box — nginx `location = /notify` →
Node on `:8787` → a systemd unit. Not built; it is a new public endpoint on the
production VM and wants an explicit decision first.
