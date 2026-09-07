# The SAMO vault

SAMO keeps its passwords in one place: **<https://samo.md.kku.ac.th/vault/>**,
running on SAMO's own server. Your database credentials for this project come
from there, and so do the shared logins most of SAMO uses.

**You get an account by being invited.** Nobody can sign up on their own — the
door is closed on purpose — so the first step is always asking a maintainer.

## Why we run our own instead of using Bitwarden

Bitwarden's free organisation holds **two accounts**. With more than two people
that leaves one option: everybody signs in as the same user with the same
password, which means nobody can be removed, nothing can be traced to a person,
and one leak is every leak.

Vaultwarden is the same thing hosted by us, without that cap. **Everyone gets
their own account and their own master password**, and access is given and taken
away per person.

## For everyone: getting in

### 1. Ask, and wait for the email

Ask a maintainer for a vault account. Say which part of SAMO you work in — that
decides which collections you are given.

You will get an email inviting you to join `samomdkku`. If it does not arrive,
check spam, then say so — the invitation can be re-sent.

### 2. Join, and create YOUR master password

Open the invitation and follow it. You will be asked to create a **master
password**. This is yours; it is not sent to you and nobody else knows it.

::: danger Nobody can reset it for you
Your vault is encrypted with your master password *in your browser*, before
anything reaches the server. That is the point — but it means an admin cannot
recover it, cannot read your items, and cannot let you back in. If you lose it,
your account is deleted and re-created and you start again.

Write it in a password manager, or on paper somewhere only you can reach.
:::

### 3. Wait to be confirmed

After you set your master password, an admin has to press **Confirm** once.
Until then you can sign in but you will see nothing shared with you.

This step cannot be done in advance — see [the FAQ](#faq) for why. If you have
been waiting more than a day, ask; it is a manual step and it gets forgotten.

Once confirmed you will see the **samomdkku** organisation and whichever
collections you were given.

## Signing in later

**In a browser** — <https://samo.md.kku.ac.th/vault/>. Nothing to set up.

**In the phone app or the browser extension** — one extra step, and it is the
step everybody gets caught by:

::: warning Set the server BEFORE you type your email
On the login screen, press the **⚙ gear** (top-left in the app, or *Self-hosted*
in the region dropdown) and set the server URL to:

```
https://samo.md.kku.ac.th/vault
```

Skip it and the app talks to `bitwarden.com`, where your account does not exist —
and the error it shows looks exactly like a wrong password.
:::

## Getting your database credentials from it

This is what most people are here for. Once you are confirmed and can see the
**Dev** collection:

```bash
npm run env:pull
```

It signs you in, reads the item `samo-dev env`, and writes your `.env.local`.
Run it again any time a key changes — it is always current, and nobody has to
send you anything.

The first run downloads the Bitwarden command-line tool (about 17 MB) and takes
half a minute or so. Later runs take a few seconds.

::: tip No command line, or you only need it once
Open `samo-dev env` in the web vault, copy the whole **Notes** field, then run
`npm run setup` and paste it. Same result, nothing downloaded.
:::

If neither works, a maintainer can send you the two lines directly — that is the
fallback, not the plan. See [Prerequisites](/start/prerequisites).

## What is in the vault

Three collections, split by **what a leak would cost** rather than by topic:

| Collection | What is in it | Who has it |
|---|---|---|
| **Infra** | the server, the live database, this vault's own admin password | 1–3 people |
| **Dev** | `samo-dev env` — the practice-database credentials | anyone writing code |
| **Team** | ฝ่าย shared accounts, social media, Canva, Drive | most of SAMO |

You see only the collections you were given. If you need something that is in
one you do not have, ask — that is a decision, not an oversight.

## Rules that are not negotiable

- **Your master password is yours alone.** Not shared with your ฝ่าย, not
  written in a LINE group, not the same as your KKU password.
- **Do not copy a password out of the vault into a chat.** The whole point is
  that it lives in one place that can be changed and revoked. A copy in a chat
  cannot be either.
- **Leaving SAMO means saying so.** Access is removed per person; nobody has to
  change a password everyone shares.

## For maintainers: inviting people

### Invite

From your own machine, with the repo checked out (needs VPN and
`SAMO_VM_SUDO_PASSWORD` in `.env.local`):

```bash
./server/vaultwarden/invite.sh somchai@kkumail.com nattaya@kkumail.com
./server/vaultwarden/invite.sh --file team.txt      # one address per line
```

Any number at once, any domain. It creates the accounts and sends the emails; it
deliberately does **not** put anyone in a collection.

The same thing by hand: the web vault → **admin console** (bottom left) →
**Members** → **Invite members** → the email addresses → the role and collections
→ **Save**.

### Confirm

Once each person has created their master password, the web vault shows them
under **Members → Needs confirmation**. Select them and confirm — you can select
all at once.

### Give them their collections

**Members → the person → Collections.** This is the step the script leaves to
you on purpose: deciding who sees **Infra** rather than **Team** is a judgement
about a person, and it should not be automated.

Most people need **Team**. Anyone writing code also needs **Dev**. **Infra** is
one to three people and never a whole ฝ่าย.

::: danger Never give a collection to a department
`ฝ่าย IT` turns over every year. A collection shared with a role rather than a
person outlives the person, and the VM password goes with it. That is also why
the collections are not named after departments — `Infra`, not `IT`.
:::

Removing someone: **Members → Remove**, then rotate whatever they could read
while they were in. The operational detail lives in `skills/vaultwarden.md`.

## FAQ

**Can I invite several people at once?**
Yes — `invite.sh` takes a list or a file, and the web vault's invite box takes
several addresses separated by commas.

**Can I confirm someone before they have created their master password?**
No, and it is not a policy — it is arithmetic. Confirming re-encrypts the
organisation's key to that person's **public key**, which does not exist until
they create a master password. There is nothing to encrypt to yet.

**Can the confirm step be automated so I do not have to do it?**
It could be, and it should not be. Automating it means a machine holding a
master password or the organisation key — putting on the server the one thing
the server is not supposed to have. Today, someone who takes the server gets
ciphertext. After that change, they would get everything. It is a few clicks,
once per person, and it is the step that keeps that true.

**I lost my master password.**
Say so. Your account is deleted and re-invited; anything only you had is gone.
Nothing else is affected.

**Does the vault hold student data?**
No. It holds credentials. The data lives in the database those credentials open.
