# Onboarding a ฝ่าย contributor

Written 2026-08-27. Design: `docs/DEPT-TOOLS.md`.

## First, the thing this file originally got wrong

**Nobody needs permission to contribute.** The repository is public, so anyone
with a GitHub account can fork it and open a pull request — no collaborator
invitation, no owner involvement, no ceremony. This file's first version
treated being added as a collaborator as step one. It is not step one; for most
people it is not a step at all. **The documentation IS the onboarding.**

What being a collaborator actually buys is narrower, and it is worth knowing
exactly:

| | fork → pull request | collaborator → branch on the repo |
|---|---|---|
| Who can | **anyone** | invited people |
| Open a PR, get review, get merged | ✅ | ✅ |
| CI runs | ✅ *(a first-time contributor's first run needs one click from a maintainer — GitHub's default on public repos)* | ✅ |
| **Preview build** | ❌ — a fork's workflow cannot read repository secrets, so the deploy credential is not there (`docs/TEAM-WORKFLOW.md` §7.7) | ✅ |

So: **the fork road is the default and needs nothing but this document.** Invite
someone as a collaborator when they contribute often enough that a preview URL
per pull request is worth it — not as a rite of passage.

⚠️ **Do not "solve" the fork preview with `pull_request_target`.** It runs the
BASE branch's workflow with secrets available, against a fork's code. That is
the standard way repositories leak their own credentials. If fork previews are
ever wanted, the mechanism is a maintainer-triggered deploy on the base repo,
never that trigger.

---

## What you have to SEND them, and how to send it

The one thing a contributor genuinely cannot get for themselves. Everything else
in this repository is public.

### What to send — exactly TWO lines, no more

```
SUPABASE_DEV_URL=…
SUPABASE_DEV_ANON_KEY=…
```

⛔ **IT WAS FOUR UNTIL 2026-09-06, AND THAT WAS THE REAL PROBLEM HERE.** The
pair above is what the built website already publishes: an address and a visitor
key that RLS gates. The other two are a different kind of thing entirely —

- `SUPABASE_DEV_ACCESS_TOKEN` can **delete the samo-dev project**;
- `SUPABASE_DEV_DB_URL` is a **direct database login that ignores every
  permission rule**, over an UNMASKED copy of real student records.

Sending all four meant every volunteer fixing a colour carried both on their
laptop. Send them **only** when someone actually takes on a migration, a proof
run, `dev:check` or `dev:google` — and say what they are when you do.
⚠️ People will ask for "the full set" because two feels incomplete. It is not:
`npm run env:check` prints a line saying their two-value setup is normal.

**Do not open your `.env.local` and select lines out of it by hand.** That file
also holds `SUPABASE_DB_URL` and `SAMO_VM_SUDO_PASSWORD`; hand-picking from it
is a copy-paste operation performed on production credentials, repeated every
time somebody joins or a key rotates. There is a command:

```bash
npm run env:share                                  # the two everyone needs
npm run env:share --db                             # + database-work values, when asked for
npm run env:share --only SUPABASE_DEV_ANON_KEY     # just the one that rotated
```

It prints the exact block to send. It **cannot emit a name that
`.env.local.example` does not offer a contributor**, so no flag combination can
leak a production value, and it refuses to run into a pipe or a file unless you
force it — the likeliest accident is redirecting secrets somewhere that keeps
them.

⚠️ **Rotating a key does not mean re-onboarding anyone.** Send the one changed
line; `npm run setup` updates that value and leaves the rest of their file
alone. And when the PROJECT gains a variable, nobody has to be told: every
contributor's next `npm run dev` names it and tells them to ask.

The names have ONE home, `.env.local.example` — active lines are what everybody
needs, commented lines are database-work only. Adding a variable there is the
whole change; `env:check`, `setup`, `env:share` and the `npm run dev` warning
all derive from it (`tools/env-manifest.mjs`).

📌 **Send it however is convenient — they do not transcribe it.** They run
`npm run setup` and paste your whole message, covering note and all; it finds
the values, tolerates quotes / `export` / a code fence / a key your chat app
wrapped onto two lines, and writes `.env.local` itself. So do NOT spend effort
formatting the block, and do NOT tell them to edit a file by hand — that step
was removed on 2026-09-06 because it was where every setup failure came from.

⛔ **`npm run setup` REFUSES a paste containing a production name** and writes
nothing, telling them to come back to you. That is a backstop, not permission to
be careless: it can only recognise the names listed in `.env.local.example`.

⛔ **Never send anything else.** Not the production keys, not
`SAMO_VM_SUDO_PASSWORD`, not the Google client secret. A contributor with a
production key can write to real student records; a contributor with these four
can only touch a copy. `.env.local.example` names the maintainer-only variables
explicitly so a file containing them is recognisable — that list is what NOT to
paste.

⚠️ **These are still real student data.** `samo-dev` is an unmasked copy — real
names, real รหัสนักศึกษา, real photographs. Safe to *click*, not safe to
*publish*. Say that when you send them; it is in the docs, but people skim.

### How to send it — never as a message, and the road depends on the person

⛔ **Not by LINE, Discord, Messenger, email, or a shared Google Doc.** Those keep
the value for ever, in a place you do not control, readable by anyone who later
gets that account or that document. This is the whole reason the values are not
simply in the repository.

**There are two correct roads, and which one you take is a judgement about the
PERSON, not about the secret.**

#### Someone who will be back → the vault (SAMO's own, since 2026-09-06)

`https://samo.md.kku.ac.th/vault/` — Vaultwarden, self-hosted on the KKU VM,
free, ours. Full operations in `skills/vaultwarden.md`.

Put the four `SUPABASE_DEV_*` lines in a collection named **`Dev`**, share that
collection with them as a plain **User** (not Manager), and you are done. What
that buys, and why it beats re-sending a link every time:

- **Rotating a key becomes one edit**, not a message to every person who ever
  received it — and today nobody can even list who that is.
- **Offboarding becomes removing one member**, and you know exactly what they
  could read, which is the short list in that one collection.
- They can rebuild a laptop without asking anybody for anything.

⛔ **Never put a contributor in `IT-Core`.** That collection holds
`SUPABASE_DB_URL`, `SAMO_VM_SUDO_PASSWORD` and the vault's own admin password —
production, and the machine the vault itself runs on. A contributor there can
write to real student records and log in to the VM. **Separate collections are
the entire reason the vault is better than a shared file**; one careless share
throws away the whole benefit.

⚠️ **Tell them about the ⚙ gear.** In the Bitwarden app or browser extension they
must set the server to `https://samo.md.kku.ac.th/vault/` on the login screen
*before* typing their email. Everybody misses this, and the symptom — talking to
`bitwarden.com`, where the account does not exist — reads as "my password is
wrong". It is the single most common support question this vault will generate.

⚠️ **Do not hand out vault accounts by default.** Every holder is another
laptop, another phone, another graduation. Start with ฝ่าย leads and people who
have already merged something.

#### A first contact, or somebody passing through → a link that self-destructs

Paste the four lines in, get a URL, send the URL, and it stops working after one
view or after a set time. No account for anyone, nothing to offboard.

| Option | Cost | Good to know |
|---|---|---|
| **A one-time-secret service** (onetimesecret.com and similar) | free | Nobody needs an account — not you, not them. The right default for a first send |
| **Bitwarden Send**, from our own vault | free | ⚠️ **Untested on our instance.** Vaultwarden does not apply bitwarden.com's free-plan "one text Send at a time" limit, so it should be unrestricted — but nobody has created a Send on `/vault/` yet. Try it once before relying on it, and set the expiry down from its 7-day default |
| **A secrets manager** (Doppler, HashiCorp Vault) | paid/complex | The right answer for a company with staff and audit requirements. Not for this |

**Send the link and any password on two different channels** — the link in
Discord, the password by phone — so one compromised account is not enough.

⚠️ **A one-time link is delivery, not storage.** Once sent, you no longer know
who holds the value or where they put it. That is acceptable for `samo-dev` keys
and for nothing else — and it is why the second person to ask should probably
just get a vault account.

### Best practice this project already follows

Worth knowing so nobody "improves" it:

- **The repository holds the NAMES, never the values** (`.env.local.example`).
  New people learn what they need without anyone leaking anything, and the list
  cannot drift from the code because a test compares them.
- **`.env.local` is gitignored** and the ignore rule is itself asserted.
- **Contributors get a separate database account** (`samo-dev`), not production.
  A leak is then an embarrassment, not an incident.

### If a key is leaked

Rotate it, then say so. Rotating the dev anon key takes a maintainer about two
minutes in the Supabase dashboard. **Saying nothing is the only expensive
option** — and make sure whoever leaked it hears that from you, or the next
person will hide it too.

---

## The session, when you do sit with someone

Optional, and worth it for the one or two people who will contribute often. It
ends when they have **merged** a pull request that changes one word — a person
who has merged one will open a second; a person handed a document will not.

⚠️ **Onboard TWO people, not one.** SAMO turns over every year and medical
students disappear into ward rotations without notice. One trained contributor
is a bottleneck with less accountability than IT and no handover — the exact
thing this workflow exists to remove, relocated. Teach the successor **before**
the incumbent leaves.

---

### Before they arrive (owner, 5 min)

- Confirm they have a GitHub account and know its password.
- **Only if they will contribute often**, add them as a collaborator with
  `write` — that is what makes per-pull-request previews possible. Otherwise
  they fork, which needs nothing from you.

### On their laptop (35 min)

Everything here is typed by **them**, not by you. That is the point — the muscle
memory is the deliverable.

1. **Node 22.** `node -v`. Node 20 hard-throws on this repo's test suite
   (`supabase-js` needs a global WebSocket).
2. **Claude Code**, signed in.
3. `gh auth login` — browser flow, HTTPS.
4. **Clone.** Collaborator: `gh repo clone samomdkku/samomdkkuweb`.
   Everyone else: `gh repo fork samomdkku/samomdkkuweb --clone` — same result,
   their own copy, and `gh pr create` still opens the PR against this repo.
   Then `cd samomdkkuweb && npm ci`.
5. `npm run dev` → open `localhost:5174`. **They must see the real site running
   on their own machine.** This is the moment the whole thing becomes real to
   them; do not skip it to save five minutes.
6. **The practice pull request.** Have them ask Claude, in their own words, to
   change one visible word somewhere harmless, then:
   `git checkout -b tool/practice-<their-name>` → commit → `gh pr create`.
7. CI runs. **Show them the red/green.** Show them that red means it cannot be
   merged — this is what `required_status_checks` buys, enabled 2026-08-27.
8. You approve, they press merge. **They merge it, not you.**
9. Show them that the site has NOT changed. Merging is not publishing; the
   owner deploys, in batches (`skills/deploy-vm.md`). Say the words *"ขึ้นเว็บ
   จริงในรอบ deploy ถัดไป"* out loud, once, here — or it will be asked every
   time forever.

### The five sentences they leave with (5 min)

Say these; do not email them.

1. **"แก้ได้เฉพาะในโฟลเดอร์ของเครื่องมือตัวเอง"** — a pull request that touches
   anything else will be stopped, and that is a feature. `CODEOWNERS` names the
   protected paths.
2. **"อยากได้เครื่องมือใหม่ เปิด issue ก่อน"** — the tool-request template. The
   issue is the agreement; the review compares the work to it.
3. **"อยากเพิ่มทีหลัง เปิด issue ใหม่ ไม่ต่อในอันเดิม"**.
4. **"ห้ามใส่ชื่อจริง รหัสนักศึกษา หรือรูปคนจริงลงใน commit หรือใน screenshot"**
   — the repository is PUBLIC and git history is permanent. GitHub's scanner
   catches API keys; **it does not catch a person's name.**
5. **"ข้างในกล่องเป็นของฝ่าย"** — layout, colour, wording. IT reviews and
   publishes; IT does not redesign.

---

## The owner's habit, and it is the one that decides whether this works

**Send it back; do not fix it yourself.**

A contributed page will look slightly foreign — spacing a little off, a green
that is nearly the brand green. Asking for a change in a review comment costs a
sentence and keeps the work theirs. Opening the file and fixing it yourself
costs a session and takes the pen back permanently — which is the bottleneck
this whole workflow was built to remove, rebuilt by hand.

*(This started life as a question — "can you live with a page you did not
design?" — and it was the wrong shape. Nothing ships without the owner's
approval and the owner's deploy, so control was never at stake. It is a habit,
not a decision.)*

## Reviewing their pull request

The owner does not have to read it. In a **fresh** Claude session:

```
/code-review <PR#>
```

- **Fresh matters.** A session that helped write the change reviews its own
  assumptions. Start a new one.
- **Give it the spec**: paste the tool-request issue, and ask it to compare the
  diff *to the issue*, not just to itself. Claude reads the diff; only the issue
  says what was supposed to be built.
- **What this covers safely**: anything under `public/embed/**`. Worst case is
  one broken page inside a frame that reaches nothing.
- **What it does NOT cover**: the data doors in `src/js/data/`, and anything in
  the `CODEOWNERS` list. Those decide who may see what, that rule lives in the
  database rather than in the diff, and the owner reads those personally.

---

## Working on the test site — where the link is, and how to get in

**The question everyone asks first: "where do I see my change?"** Three places,
and the first is the one people forget:

| Where | Address | When to use it |
|---|---|---|
| **Your own machine** | `npm run dev` → `localhost:5174` | almost always. Instant reload, no waiting for a build |
| **Your branch's preview** | `npm run preview:url` | showing someone else, or testing on a real phone |
| Production | `samo.md.kku.ac.th` | never for testing |

📌 **The preview address is NOT random and you do not have to hunt for it in
GitHub.** It is your branch name with the slashes turned into dashes:

```
branch   feat/shop-checkout
preview  https://feat-shop-checkout.samomdkkuweb.pages.dev
```

It is **stable** — the same address for the whole life of the branch, updating
on every push — so bookmark it once and refresh. `npm run preview:url` prints
it, and asks Cloudflare for the real one rather than trusting the pattern when a
build already exists. Cloudflare also posts the link into the pull request, so
that is a second way in if you are already there.

⚠️ **The preview runs against `samo-dev`, not the real database.** Nothing you
click there can touch real data. That is the point, and it is also why a preview
carries a PREVIEW ribbon across the page — if you do not see the ribbon, you are
on the live site.

### Signing in on a preview

⚠️ **The Google button does not work on previews**, because Google sign-in is
not enabled on `samo-dev`. Clicking it used to dump a raw Supabase error page
(`"Unsupported provider: provider is not enabled"`, reported 2026-08-29); it now
says so in Thai and points you at the alternative instead.

**Use a username/password account on previews.** Google sign-in on dev needs an
OAuth client of its own — see the note in `docs/TEAM-WORKFLOW.md` §3. Do NOT
solve this by copying production's Google client into the dev project: that
would put a credential which can impersonate the real site's sign-in into the
environment whose keys are deliberately shared with the whole team.

## Two things that will confuse someone later

- **The owner cannot approve their own pull request.** GitHub forbids it, and
  `require_code_owner_reviews` is now on — so an owner PR touching an
  owner-owned path (`supabase/`, `auth.js`, `STATE.md`, …) can never collect the
  approval it asks for. That is not a misconfiguration: `enforce_admins` is
  `false` on purpose, so the owner merges with the admin bypass or pushes `main`
  directly, which is the normal flow here. **Do not turn `enforce_admins` on to
  "make it consistent".**
- **A red CI check on a contributor's PR is usually not their change.** Ask them
  to run `npm test` locally first; the suite also enforces the agent-context
  byte budget and the handoff's pointers, so an unrelated edit elsewhere can be
  what is red.
