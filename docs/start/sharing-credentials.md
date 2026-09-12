# Giving someone the credentials

For whoever hands out access. Everything else under *Getting started* is written
for the person receiving it; this page is the other side.

The goal is that **you stop being involved**. Set it up once and people fetch
their own — no laptop, no message, no repeating it for each person.

## What you are handing out, and what you are not

There are four values in this project. **They are not four of a kind**, and
treating them as one block was a real problem here until 2026-09-06.

| | What it opens | Who should have it |
|---|---|---|
| `SUPABASE_DEV_URL` | the address of the practice database | everyone |
| `SUPABASE_DEV_ANON_KEY` | a visitor key, gated by the same rules as the live site | everyone |
| `SUPABASE_DEV_ACCESS_TOKEN` | **can delete the whole practice project** | only someone doing migrations |
| `SUPABASE_DEV_DB_URL` | **a direct login that ignores every permission rule** — every real name, รหัสนักศึกษา and photograph in one connection | only someone doing migrations |

The first two are the same kind of value the live website already publishes to
every visitor. The last two are not.

⛔ **Send the first two by default.** People will ask for "the full set" because
two feels incomplete — it is not. `npm run env:check` prints a line telling them
a two-value setup is normal.

::: warning The practice database is real student data
`samo-dev` is an unmasked copy of production. Nothing anyone clicks there
reaches a real student, so it is safe to *use* — but the names, ID numbers and
photographs in it belong to real people. Say that when you hand it over.
:::

### The Discord bot token is not on that list, and there is no contributor version

Somebody will eventually ask for it, because the role sync is the one part of
this project a contributor cannot fully run. **The answer is no, and it is not
a judgement about them** — there is no dev copy to send. A second Discord
application was considered on 2026-09-12 and declined: two apps, two invites,
two token resets, and a test server whose role tree quietly stops matching the
real one.

What that leaves a contributor is more than it sounds, because the sync is
deliberately split in half:

| Half | What it does | Needs a Discord token? |
|---|---|---|
| **Deciding** | `public.discord_role_targets()` — which roles a person is due, from their ตำแหน่ง and every ticked ฝ่าย above it | **no.** Runs on `samo-dev` with the two values above |
| **Reading the guild** | who is actually in the server and which roles they hold | yes — and it runs on the VM |

So a contributor can change the rule, prove it against real-shaped data
(`node tools/db-query.mjs tools/team0184-discord-targets.sql`), and open a pull
request — without ever holding a credential that can touch the Discord server.
That was the reason for putting the rule in Postgres rather than in the bot.

⛔ **Never write a step into these pages that needs the bot token.** A
getting-started guide here once told contributors to run `npm run dev:check`,
which needs production credentials they must never be sent — so it failed on a
*correct* setup and blamed the reader. A page that asks for something a
contributor may not have is a page that reports their correct setup as broken.

## Set it up once — then you are out of the loop

This is the part that means you never do this again. **Only you can do it**, and
not because of permissions: Vaultwarden encrypts an item's contents in the
browser before they reach the server, so the server only ever holds scrambled
text. The vault admin password on the VM manages accounts and organisations and
**cannot read or create an item**. There is no back door, by design.

**1. Get the block onto your clipboard without it appearing anywhere:**

```bash
npm run env:share -- --copy
```

It prints the *names* it copied and no values — nothing lands in your terminal
history or scrollback.

**2. In the vault**, create a collection called **`Dev`** and an item in it
called **`samo-dev env`**. Paste into its **Notes** field.

⛔ **`Dev`, never `Infra`.** `Infra` holds the VM password and the live
database. The three collections and why they are what they are:
[`skills/vaultwarden.md`](https://github.com/samomdkku/samomdkkuweb/blob/main/skills/vaultwarden.md).

**3. Share `Dev`** with each person's vault account as a plain **User** — not a
Manager.

Inviting someone, confirming them, and giving them collections is three steps
and one of them is easy to forget: **[How to use the SAMO vault](/start/vault)**
has the whole flow, including why you cannot confirm a person before they have
created their own master password.

```bash
./server/vaultwarden/invite.sh somchai@kkumail.com nattaya@kkumail.com
```

After that, they run:

```bash
npm run env:pull
```

…and fetch their own, today and every time a key changes.

## If they have no vault account

**Give them one** — it is two minutes and it is the last time you are involved:
[inviting people](/start/vault#for-maintainers-inviting-people).

The manual road below still works, and is right for someone passing through
once, or when the invitation is stuck and they need to start today.

```bash
npm run env:share
```

Copy what it prints between the rules and send it. They run `npm run setup` and
paste your whole message — greeting and all; it finds the values inside.

::: danger Not by LINE, Discord, Messenger, email or a shared document
Those keep the value for ever, in a place you do not control, readable by anyone
who later gets that account. Use a link that expires — a one-time-secret service
is free and needs no account from either of you — and send any password for it
by a different route than the link itself.
:::

## When a key changes

```bash
npm run env:share -- --only SUPABASE_DEV_ANON_KEY
```

Send that one line. `npm run setup` **updates only what it is given** and leaves
the rest of their file alone. Nobody redoes their setup.

If the vault item exists, edit it instead — including from the phone app — and
everyone's next `npm run env:pull` picks it up. You send nothing.

## When the project gains a new variable

**You do not have to tell anyone.** Add it to `.env.local.example` — an ordinary
line if everybody needs it, a commented-out line if it is for database work
only. That file is the contract, and everything derives from it.

Every contributor's next `npm run dev` says:

```
⚠️  .env.local is missing 1 value(s) this
    project now needs — you have not been sent them yet:
      SUPABASE_DEV_…
    Run: npm run env:pull   (or ask a maintainer, then: npm run setup)
```

Anyone with a vault account needs nothing from you at all — you edit the item,
their next `env:pull` has it.

## Someone needs database access

**First, check they actually do.** Since 2026-09-07 a pull request that touches
`supabase/migrations/` is checked by CI: every migration is replayed onto a
blank database created and destroyed inside the job. So writing a migration and
finding out whether it applies needs **no credential at all** — that used to be
the main reason to ask.

What still needs the two values is testing **behaviour**: whether a permission
rule does the right thing for a real signed-in person. The CI database has no
accounts, so it cannot answer that.

```bash
npm run env:share -- --db
```

⚠️ **The `--` is required.** Without it npm swallows the flag and quietly sends
the two-value block instead — you would think you had sent four.

This prints a warning of its own, because those two values can delete the
practice project and read every student record. Send them only to someone
actually doing migrations.

## Things the tools will not let you do

- **`env:share` cannot print a production credential.** What it may emit comes
  from `.env.local.example`'s own declarations, so no combination of flags
  reaches `SUPABASE_DB_URL`, `SAMO_VM_SUDO_PASSWORD` or the rest.
- **`env:share` refuses to run into a pipe or a file** unless you pass
  `--force`. The likeliest accident is redirecting secrets somewhere that keeps
  them. (`--copy` is exempt — it prints no values at all.)
- **`npm run setup` refuses a paste containing a production name** and writes
  nothing, telling the person to come back to you. A backstop, not a substitute
  for care: it only recognises names listed in `.env.local.example`.

## If a key is leaked

Rotate it, then say so. Rotating the dev anon key takes about two minutes in the
Supabase dashboard. **Saying nothing is the only expensive option** — and make
sure whoever leaked it hears that from you, or the next person will hide it too.

Next — [Install and run](/start/install), which is what they will be following.
