# Working as a team

*The plan for several developers — dev database, previews, review flow*

> ## ⚠️ STATUS: phases 0 and 1 are BUILT. Designed 2026-08-26, half-built 2026-08-27.
>
> **This banner said "NOTHING HERE IS BUILT" until 2026-08-27 and it was the most
> misleading line in the repo** — the first thing a cold session reads, listing
> three things that had been built that morning. **Correct it in the same commit
> as the phase it describes, or it will mislead the next person the same way.**
>
> ✅ **REAL — use it, do not re-design it:** `samo-dev` (the ref in `SUPABASE_DEV_URL`,
> loaded from production and verified) · `npm run dev:refresh` · `npm run
> dev:check` · `public.schema_migrations` + `npm run migrate:status` /
> `migrate:new` · branch protection ENFORCING the `build` check and code-owner
> review · `.github/CODEOWNERS` · the PR and issue templates ·
> `docs/INVARIANTS.md` · `docs/state/<handle>.md` · the two subagents in
> `.claude/agents/`.
>
> ✅ **ALSO REAL as of 2026-08-28:** **preview deploys** (they were already
> configured on the `samomdkkuweb` Pages project — no Actions job, no
> `wrangler`) and the **dev Discord channel**, which this document calls
> `#samo-dev-bot` and which actually exists as **`#developer-server-notify`**.
> Preview builds post there, verified with every action and all 12 ฝ่าย.
>
> ❌ **STILL A DESIGN — nothing below about these describes something real:**
> the dev GAS deployment (owner-gated) · `samo-scratch`.
>
> ⚠️ **This list said `dev-grants.json` and the mail trap until 2026-08-30, both
> wrong.** `dev-grants.json` + `npm run dev:grants` shipped 2026-08-28 (guarded
> by `src/js/dev-grants.test.js`), and the mail trap was RETRACTED because its
> NEED is met at the transport — `resolveRecipients` forces dev mail to one test
> inbox, so there is nothing for a trap to catch. §8's phase-2 row had both
> right while this summary had both wrong: **a summary and the table it
> summarises are two implementations of one fact.** Correct them together.
>
> **§0b has the precise line between the two. Read it before building anything.**
>
> **This file is the authoritative record.** A rendered version was published as
> an Artifact for the owner to read
> (`https://claude.ai/code/artifact/50eb9af4-8320-45ed-8b83-b1fa078cf4d7`); it is
> a COPY and may be stale. If the two disagree, this file wins. If you change
> the design, change it here first.
>
> **Before building any phase, re-read §7 (open unknowns).** Two of them can
> only be answered by trying, and one of those (the `pg_dump` credential) blocks
> everything else.

Context: the owner plus **about five other people**, some of whom may come and
go.

⚠️ **This is not a team that has never collaborated — measured 2026-08-26, the
PR workflow already exists and has been used.** The repo has **five `write`
collaborators plus the owner as `admin`** (`Naphawarit`, `panascha`,
`p4ngpond-rhael`, `ZeaHunter`, `Kita1103`), and **16 pull requests** have been
opened, the most recent on 2026-07-11 — six weeks before this design.

⚠️ **Two of them show as CLOSED rather than merged, and that is NOT lost work.**
`#12` and `#13` (Kita1103, 2026-06-16) were **cherry-picked into
`refactor/modular` and closed with a note saying so** — read the PR comments
before concluding anything from the state badge. Their branches are still on
`origin` (`feat/dept-resource-cards`, `feat/mobile-auth-navbar`) and are safe to
delete.

📌 **And the workflow this design proposes is partly a RESTORATION, not an
invention.** `#13`'s thread carries a *"Deploying samomdkkuweb with Cloudflare
Pages"* comment — **per-PR preview URLs used to exist on this repo** and the
team reviewed against them. They went away with the Pages retirement, which was
a decision about *production hosting*. Phase 3 gives back a capability this
workflow was already built around.

So the problem is **not** "introduce a workflow". It is that the existing one
has no dev environment and no preview URL, so every change must be verified by
the owner running it locally, and no contributor can touch the database at all.
`CONTRIBUTING.md` says so plainly: *"There is no preview deploy"*, and it tells
contributors to test against **production** and ask the owner to delete the test
rows. That is what does not survive five people.

---

## §0. Decisions the owner made — DO NOT RE-LITIGATE

Each of these was proposed by the assistant, argued, and then **decided by the
owner** during the 2026-08-26 session. Several reverse an earlier draft of this
same design. They are listed with the reasoning so a later session does not
"fix" them back.

| # | Proposed | **Decided** | Why |
|---|---|---|---|
| D1 | Mask names / emails / รหัส in the dev copy (PDPA, five people holding student PII) | ❌ **No masking. Dev holds production data as it is.** | *"don't worry about the data privacy"* — it is the owner's own organisation's data, the team are friends, and the owner carries the accountability. Raised twice, declined twice. |
| D2 | An email allow-list (Cloudflare Access) on the preview URLs | ❌ **No door gate.** Unpublished, `noindex`, PREVIEW ribbon only | *"would be a big hassle"*. What makes it safe is that **RLS behaves identically on dev** — see the risk in §7. |
| D3 | Give developers only their normal permissions on production; grant `master` on dev via a file | ❌ **`master` in the real ทีม SAMO tree is fine for the team** | *"the team is trustable"*. The `dev-grants.json` file survives for guests only (§3). |
| D4 | Dev sends to a dev Discord channel + `DEV` Drive folder + a mail trap | ✅ **Accepted**, after the owner asked why real channels were not simply used | The deciding argument was **not** safety: *the destination is not part of the code path*. A dev channel exercises the identical builder, payload, `allowed_mentions`, error handling. The real channel proves only that one URL string is still valid — a config fact, answered by the post-deploy smoke test. |
| D5 | Turn auth email OFF on dev | ❌ **Wrong — use a mail trap instead** | The owner pushed back that sign-up / login must be testable. "Off" would leave the signup, email-change and reset paths untested until production. Custom SMTP → Mailtrap/Mailpit means the mail is really sent and really readable, and never reaches a student. |
| D6 | Block the VitalSound form on dev unless the submitter holds `master` | ❌ **No special case. Both forms behave identically to production.** | *"it's our friend, everyone knows that when you test, they have to clean up"*. The residual risk is handled by a habit — the dev link is never published — not by code. **This is the better design anyway: no environment-dependent branch exists in the app.** |
| D7 | Use a second Supabase project on the existing account | ❌ **A separate Supabase ACCOUNT** | A third project on the current account pauses another (the owner has hit this). The separate account has a second benefit: its Management PAT is safe to share with all five, so they run migrations and proofs with the existing tooling. |
| D8 | Preview builds on the KKU VM | ❌ **Off the production box** | The VM serves students; it is on a private address so GitHub Actions cannot reach it, meaning the VM would have to *poll* — the same systemd shape that already produced a timer reporting `enabled`/`active` while scheduling `infinity` (`docs/mistakes/deploy-hosting.md`). |

⛔ **§1's preview row IS a decision, not a sketch — it was re-opened once and
should not be again.** On 2026-08-27 a session presented "per-PR preview URLs
vs one always-on dev site" to the owner as an open question, recommended the
always-on site, and was corrected by the owner (*"haven't we decided there'll be
dev web to view … on cloudflare?"*). They had. §1 says
`<pr>.samo-preview.pages.dev`, deployed by **GitHub Actions, per PR**, and D8
says off the VM. The session had read the owner's phrase "the dev server" as a
preference and never opened §1.

**The habit that prevents it: before calling anything an open question, grep §0
and §1.** A settled decision restated as a question costs the owner a reply,
teaches them the plan is not trustworthy, and risks reversing a call that had
reasons behind it.

**Two assistant errors from that session, recorded because the reasoning matters
more than the fix:**

- **"Deleting `auth.identities` means nothing can sign in"** — wrong, and the
  wrong *kind* of claim. Traced live: `pr_tickets_insert_anyone` and
  `vs_tickets_insert_anyone` are both granted to **`public`**, so guest
  submission needs no account at all. A control on the login path was described
  as though it covered every path — class 4 in `.claude/rules/mistakes.md`,
  walked into while writing a document about avoiding it.
- **SVG `<text>` with no `fill` renders black** — invisible on a dark artifact
  theme. `fill` is inherited, so `fill="currentColor"` on the `<svg>` root fixes
  every label at once. Strokes were `currentColor`; text was forgotten.

### §0b. What is BUILT and what is still only a name — corrected 2026-08-27

⚠️ **This section said "none of them exist yet" and listed five things that now
DO exist.** A cold session reading it would have re-designed work already
finished. **When you build one, move it up here in the same commit.**

✅ **BUILT — do not re-design, use them:**
`npm run dev:refresh` · `npm run dev:check` · `npm run migrate:status` (takes
`--dev`) · `npm run migrate:new` · `public.schema_migrations` (0169, applied and
backfilled on BOTH databases) · `tools/migrations-lib.mjs` ·
`src/js/migration-numbers.test.js` · **the `samo-dev` project**
(the ref in `SUPABASE_DEV_URL`, loaded and verified) · `docs/INVARIANTS.md` ·
`docs/state/<handle>.md` · `.gitattributes` · `skills/build-the-dev-database.md`
· `skills/onboard-a-contributor.md`

❌ **Still only a name in this document:**
`npm run dev:who` · `npm run dev:cleanup` · the `samo-scratch` project ·
`samo-preview.pages.dev` (previews come from the EXISTING `samomdkkuweb`
project instead)

✅ **BUILT since that list was written — checked against the repo 2026-08-29,
not against this document:** `tools/dev-grants.json` + `npm run dev:grants`
(which supersedes the singular `dev:grant` named above) · `src/js/env-ribbon.js`
(the PREVIEW ribbon) · `functions/notify.js` (the `/notify` dev stub) ·
`tools/env-lib.mjs` + `npm run proofs:dev` + `.github/workflows/proofs.yml`
(phase 6's first half). The `noindex` on previews needed nothing built —
Cloudflare Pages sets `x-robots-tag: noindex` on preview deployments itself
(measured 2026-08-27, recorded in `public/robots.txt`).

📌 **`VITE_ENV_NAME` is BUILT**, with the polarity deliberately reversed —
`docs/INVARIANTS.md`. **`#samo-dev-bot` is BUILT**, under the real name
**`#developer-server-notify`**; wherever this document says `#samo-dev-bot`,
that is the channel it means.

Everything else named in this file — `tools/apply-migration.mjs`,
`tools/db-query.mjs`, `npm run proofs`, `npm run check:context`,
`skills/deploy-vm.md`, `skills/ship-a-migration.md`, `functions/notify.js`,
`.claude/agents/*`, `.github/CODEOWNERS` — **does** exist today.


---

## §1. The three environments

| | local | preview | production |
|---|---|---|---|
| Address | `localhost:5174` | `<pr>.samo-preview.pages.dev` | `samo.md.kku.ac.th` |
| Database | `samo-dev` (copy of prod) | `samo-dev` | the live project |
| Who deploys | the developer, on save | GitHub Actions, per PR | **the owner only**, `skills/deploy-vm.md` |
| Discord | printed to the terminal | `#samo-dev-bot` | the real ฝ่าย channels |
| Drive | GAS dev deployment → `IT Database/DEV` | same | the live GAS deployment |
| Mail | mail trap | mail trap | real inboxes |
| Marker | PREVIEW ribbon | PREVIEW ribbon | none |

**Everything else is identical** — same code, same data, same permissions, same
RLS, same forms, same login. `VITE_ENV_NAME` is `production` only on the VM
build; anywhere else the app paints one global ribbon. There are **no other
environment-dependent branches in the app**, and adding one should be treated as
a design smell (see D6).

Cleanup on dev is `npm run dev:refresh`, not deleting rows.

---

## §2. Data: one-way copy, structure the other way

- **Data flows production → dev**, on demand, run by the owner. Never nightly
  (a refresh destroys whatever people were doing), never automated (it would put
  production credentials in a CI secret).
- **Structure flows dev → production.** A migration is applied to `samo-dev`
  while the PR is open and to production only after it merges. **Dev leads,
  production follows** — so "works on dev, breaks on prod" can never be a schema
  problem.
- **The reverse data direction is impossible, not merely forbidden**: different
  Supabase accounts, different keys. The script must additionally refuse if the
  target ref is production's.

`npm run dev:refresh`, in order:

1. `pg_dump` production (**needs a credential that does not exist yet — §7.1**)
2. load into `samo-dev`
3. point every outward channel at its dev destination, then `npm run dev:check`
4. apply `tools/dev-grants.json`
5. **re-apply every migration in the repo that the dump predates**, then post to
   `#samo-dev-bot`

**Step 5 is the one that gets forgotten.** The dump carries *production's*
schema, which is behind whatever is in review — without it a refresh silently
reverts everyone's unmerged migrations.

**No incremental sync.** Copying only what changed is a second implementation of
the same rules, which drift (class 6). The database is 38 MB (measured
2026-08-26; re-measure with `select pg_size_pretty(pg_database_size(current_database()))`).

---

## §3. Access and permissions

### §3a. Google sign-in on `samo-dev` — OFF, and what it would take

Reported from a preview on 2026-08-29: the Google button lands on

```
{"code":400,"error_code":"validation_failed",
 "msg":"Unsupported provider: provider is not enabled"}
```

Read from the live config, not assumed: `external_google_enabled: false`,
`external_email_enabled: true`, and `uri_allow_list` **already** contains
`https://*.samomdkkuweb.pages.dev/**` — so the redirect side is ready and only
the provider is missing. Until it is enabled, **sign in on previews with a
username/password account**; the app now says so rather than navigating into
that error page.

**To turn it on** (owner — it needs the Google Cloud console):

1. In the Google Cloud project, create a **NEW** OAuth 2.0 Client ID (Web).
2. Authorised redirect URI — the **"Authorised redirect URIs"** box:
   `$SUPABASE_DEV_URL/auth/v1/callback`

   ⚠️ **Not the "Authorised JavaScript origins" box above it**, which rejects it
   with *"Invalid Origin: URIs must not contain a path"* — hit for real on
   2026-08-31. Origins may not carry a path, and Supabase needs none: its flow
   is a server-side redirect, so leave that box EMPTY.
3. Put the client id and secret in `.env.local` as `GOOGLE_DEV_CLIENT_ID` /
   `GOOGLE_DEV_CLIENT_SECRET` — **not into chat**, and not into git.
4. `npm run dev:google` — it does the rest and reads the result back from the
   API rather than trusting its own 200. `npm run dev:google -- --check`
   reports without changing anything, and with no credentials present it prints
   step 2's exact redirect URI for this project.

📌 **Step 1 is the only part that cannot be automated, and that is Google's
design, not an omission.** The sole programmatic path is the IAP one, and
clients created that way are locked to IAP — the redirect URI cannot be set,
which is the one field Supabase needs. `tools/dev-google-signin.mjs` refuses to
write if `SUPABASE_DEV_URL` resolves to the production project, checked before
any write and against the env rather than a hardcoded ref.

⛔ **Do NOT reuse production's OAuth client for dev.** It is the tempting
shortcut and it is the wrong trade: `samo-dev`'s credentials are deliberately
**shareable with the dev team** (`.claude/rules/security.md`, D7), so putting
production's client secret there hands five people a credential that can
impersonate the real site's Google sign-in.

📌 **Refinement, 2026-09-06 — D7 STANDS, this is not a re-litigation.** D7's
reason (a PAT the five can run migrations and proofs with) is unchanged and the
PAT is still theirs. What changed is the DEFAULT for people outside that five:
`SUPABASE_DEV_ACCESS_TOKEN` and `SUPABASE_DEV_DB_URL` are no longer sent to
every contributor, because a volunteer changing a colour does not run
migrations. The two remaining values are the pair the built site already
publishes. `.claude/rules/security.md` has the tiers. A second client costs two minutes
and keeps the blast radius where it belongs.


**The mechanism to keep in your head:** dev is a copy *including permissions*.
There is no such thing as granting someone access "on dev" by editing the
ทีม SAMO tree — that grant is live on the real site the moment it is saved, and
the copy inherits it later. The owner has accepted this for the team (D3).

| Credential | Who | Note |
|---|---|---|
| `samo-dev` URL + anon key | everyone | in the team vault, not in git |
| dev account PAT + dev DB URL | everyone | safe *because* that account holds nothing but disposable projects |
| production PAT · service_role | **owner only** | account-wide; unchanged by any of this |
| KKU VPN · ssh · `SAMO_VM_SUDO_PASSWORD` | **owner only** | developers never reach the VM. If a second deployer is ever needed the mechanism is a sudoers drop-in for the one command, never a shared password |
| clasp — **production** Apps Script | **owner only** | re-authorising grants a token that can read the whole SAMO Drive (`.claude/rules/security.md`) |
| clasp — **dev** Apps Script | whoever works on it | put the dev script + `DEV` folder under a **separate Google account**; its credential then reaches nothing real. This is the only way GAS work becomes shareable |
| Cloudflare API token | GitHub Actions secret | scope to Pages:Edit. `CLOUDFLARE_ACCOUNT_ID` / `CLOUDFLARE_API_TOKEN` already exist in `.env.local` |

`tools/dev-grants.json` — dev-only extra permissions, applied at step 4 of the
refresh, for a reviewer who should see one feature for one week without becoming
an administrator of the live system. It will rot like every list of people;
review it at each refresh.

---

## §4. Branches, review, and not blocking each other

Trunk-based, short-lived branches, squash merge. `main` protected: PR required,
CI green, one approval, no force-push, linear history. (Branch protection is
free on this repo because it is public.)

**The reframe that removes the bottleneck: merging is not publishing.** Pushing
`main` does not deploy — the site changes only when the owner runs the deploy.
So approving is cheap and reversible, and the careful gate stays where it
already is: one deploy per batch.

Dependency chains (feature 2 needs feature 1, which is in review):

- **Branch off the branch** and rebase when 1 merges (stacked branches), or
- **merge 1 early but unreachable** — not linked in the nav, or behind a
  permission nobody holds. Ordinary trunk-based development.
- CSS / copy / layout PRs never reach the owner: `CODEOWNERS` routes only
  `auth.js`, `db.js`, `notify.js`, `supabase/`, `server/`, `appscript/`,
  `CLAUDE.md`, `.claude/rules/` to them; everything else merges on one peer
  approval.

**Migration numbering**: `npm run migrate:new "<slug>"` takes the next number
from `origin/main`; a CI check fails any PR whose number already exists.
Renaming an unapplied migration is free.

**How the owner learns about a schema change and what they run:**

| Moment | What tells them | What they run |
|---|---|---|
| PR opened | `CODEOWNERS` on `supabase/` → automatic review request | nothing, they read it |
| before deploying | `npm run migrate:status` diffs repo files against each database's `schema_migrations` | `node tools/apply-migration.mjs supabase/migrations/NNNN_….sql` |
| two people used one number | CI fails the second PR | nothing — they rename |

Order is unchanged: **add before deploying the code that reads it; drop only
after the new bundle is confirmed served** (`skills/ship-a-migration.md`).

---

## §5. Testing tiers, and where each question is answered

| Tier | What | Runs where |
|---|---|---|
| unit + guards | `npm test` | every laptop, every push |
| build | `npm run build` | CI |
| live proofs | `npm run proofs` | today the owner against prod; **should run against `samo-dev` in CI** on any PR touching `supabase/` — see the risk in §7.3 |
| browser smoke | **`npm run smoke:browser -- <url>`** — 9 checks, no credential | ✅ **automatic on every preview** (`.github/workflows/smoke.yml`), and runnable against production by hand |
| browser, in depth | headless Chrome / Playwright WebKit, `skills/drive-the-browser.md` | by hand, against the preview URL |

| Question | Answered on |
|---|---|
| sign-in / sign-up / reset | dev, with the mail trap |
| Discord embed, skip-notify path | dev, `#samo-dev-bot` |
| VitalSound end to end | dev — the form is unmodified (D6) |
| upload lands with the right sharing | dev, `Drive/DEV` |
| **does the real webhook still exist after I rotated it** | **production**, once, as a post-deploy smoke test |
| does the migration work | dev, always |

The deploy routine already in `skills/deploy-vm.md` — grep the served bundle,
read `/build.json`, `curl /notify` — **is** a post-deploy smoke test. The only
addition is: after rotating a webhook or redeploying GAS, send one real ticket,
confirm the channel, delete it.

---

## §6. How Claude works on this repo, with several people

### 6.1 Which model does what

The handoff medium is a **file**, and the file is the pull request. Do **not**
have models talk to each other: agent-to-agent chat is unauditable, evaporates
at session end, and doubles the burn on a subscription the team already books
slots on (`/admin#claude`).

| Step | Model | What survives |
|---|---|---|
| Plan the change | **Opus** | a checklist in the issue — files to touch, the guard test, the rollback |
| Implement it | **Sonnet** | commits on the branch, ticking that checklist |
| Review the diff | **Opus**, `/code-review` | PR comments |
| auth · RLS · migrations · deploy · anything in the seven mistake classes | **Opus throughout** | — |

Haiku is deliberately absent: the bottleneck on this repo is judgement, not
throughput, and a cheap model on `auth.js` is a false economy.

### 6.2 Subagents — when they pay for themselves

A subagent **starts cold and re-derives context**, so it is not a way to think
faster. It pays in exactly two situations:

1. **Fan-out search** — a question answered by sweeping many files where only
   the conclusion is wanted.
2. **Keeping large output out of the main context** — a query whose result is
   3,000 lines of JSON and whose *answer* is one sentence.

Both are common here, so two definitions live in **`.claude/agents/`** (shared
via git — `.gitignore` excludes `.claude/*` but allows `rules/` and `agents/`):

- **`mistake-finder`** — searches the write-ups in `docs/mistakes/` for a
  symptom and returns the two or three that actually apply, summarised. Without
  it, `grep -rin` over that directory floods a session with near-matches.
- **`db-inspector`** — runs a **read-only** query through `tools/db-query.mjs`
  and returns the answer rather than the dump. This repo's rule is "verify from
  the authority" (`pg_policy`, `pg_proc.proacl`, the live function body), and the
  authority is verbose.

**Do not** delegate: anything needing `STATE.md` context, any design decision,
anything touching auth or RLS, or "review this diff" (that is `/code-review`).

⚠️ **Both definitions are UNVERIFIED BY EXECUTION.** They were written from the
documented frontmatter shape and committed, but no session has invoked one yet —
a malformed header fails by the agent simply not appearing, which is silent. The
check takes ten seconds in a fresh session: the agent list should name
`mistake-finder` and `db-inspector`. If it does not, the frontmatter is wrong,
not the prose. **Do this before relying on either.**

### 6.3 Memory — three layers, and only two are shared

| Layer | Where | Shared with the team? |
|---|---|---|
| Personal auto-memory | `~/.claude/projects/<path-hash>/memory/` | ❌ **No.** Per machine, and keyed by the clone's path — five developers have five disjoint memories, and none of them is in git |
| Always loaded | `CLAUDE.md`, `.claude/rules/*` | ✅ yes — byte-capped by `npm run check:context`, changed by PR |
| Read on demand | `STATE.md` (read first), `docs/*`, `docs/mistakes/*`, `skills/*` | ✅ yes |

⛔ **The rule that matters with more than one developer: if another person
needs to know it, it goes in the repo.** A fact recorded only in a personal
memory is invisible to everyone else and to the same person on another machine —
and it will be *confidently* recalled by one session while another re-derives it
wrongly.

Where each kind of thing belongs:

- a bug that was fixed → `docs/mistakes/<area>.md`, then `npm run mistakes:index`
- a rule that will still be true next year → `docs/INVARIANTS.md` (planned) or
  the class list in `.claude/rules/mistakes.md`
- what is deployed / in flight → `STATE.md`
- a repeatable multi-step procedure → `skills/*.md`
- "how this person likes to work" → personal memory, and nowhere else

### 6.4 Efficiency habits, in rough order of what they save

- **`/clear` between unrelated tasks.** The always-loaded layer is ~8.5k tokens
  before anyone types; a stale 200k-token context is far more expensive than
  re-reading `STATE.md`.
- **One session per working tree.** Two things in flight means `git worktree`;
  two agents in one checkout is the fastest way to lose work.
- **Grep `docs/mistakes/`, do not read it.** `grep -rin "<symptom>"` searches the
  write-ups; `docs/mistakes/INDEX.md` scans the headings.
- **`npm test` before every commit.** It runs the whole unit suite *and*
  `check:context` *and* `state-handoff.test.js`, so it catches a bloated rules
  file and a broken pointer in the handoff at the same time.
- **Batch commits before deploying** — a VM deploy takes minutes (measured
  figure: `skills/deploy-vm.md`); a `docs/`- or
  `tools/`-only commit needs no deploy at all.
- **Do not re-read a file you just edited** to confirm the edit landed.

### 6.5 Splitting `STATE.md` — ✅ DONE 2026-08-27

It was unmergeable because it held three lifetimes at once, and at 1,403 lines
it was also the biggest fixed cost in every session. **Done: `STATE.md` is 204
lines, `docs/INVARIANTS.md` and `docs/state/<handle>.md` exist, and the narrative
went to `docs/state-archive/2026-08-27-state-split.md`.** The shape that was
designed here, for the record:

- status → `STATE.md`, ≤200 lines, deploy block **written by the deploy**
- durable invariants → `docs/INVARIANTS.md`
- "what my session was" → `docs/state/<github-handle>.md`, one per person
- narrative → `docs/state-archive/` (exists)

Rule for agents: *write your own state file; never rewrite someone else's; never
touch the deploy block unless you deployed.*

✅ Both follow-ups are done too: `state-handoff.test.js` now sweeps
`docs/INVARIANTS.md` and every `docs/state/*.md` for dead pointers, and enforces
the ~200-line ceiling — **its old assertion was `STATE.length > 20000`, which
described the bloat rather than checking anything, and would have gone RED on the
split that fixed it.** `.gitattributes` gives `docs/mistakes/*.md` `merge=union`,
and deliberately gives it to nothing else: where two people edit the same lines
of `STATE.md` or `CLAUDE.md`, one of them is usually correcting a claim the other
still believes, and silently keeping both is how this repo ends up asserting a
fact and its opposite.

## §7. Open unknowns — read before building

**7.1 — ✅ FULLY RESOLVED 2026-08-27. This no longer blocks anything.** The
owner supplied the database password, it was verified against the live project
(`current_user=postgres`, server 17.6), `SUPABASE_DB_URL` is in `.env.local`,
and **the schema has been dumped** — 64 tables, 165 functions, 156 policies, 64
triggers, 592 GRANTs. The recipe and the four traps found while doing it are in
**`skills/build-the-dev-database.md`**; read that rather than the two bullets
below, which are kept for the record.

⛔ **The trap worth carrying forward: the first dump used `--no-privileges` and
produced ZERO grants.** RLS policies with no GRANT deny everyone and read
exactly like the policies working (0138). Count the GRANTs after every dump.

*The original text of this section:*
This read "there is no way to dump the database from this machine, and it blocks
phases 1, 2 and 6" and named two gaps. The second was never real. Measured
2026-08-26, re-measured 2026-08-27:

1. **No credential.** `.env.local` has `SUPABASE_ACCESS_TOKEN` (Management API —
   it runs SQL but **cannot** `pg_dump`) and `PASSPORT_B_DB_URL` for the *old
   passport* project. There is **no `SUPABASE_DB_URL` for the live project**.
   Get the password from Supabase → Settings → Database.
2. ~~**No client tools.**~~ ✅ **CORRECTED 2026-08-27 — the client was there all
   along, and the INSTRUMENT could not see it.** This bullet said `pg_dump`,
   `psql` and the `supabase` CLI were "all absent — `which` finds none of them",
   and it blocked three phases for a day. `which` searches `PATH`; **`libpq` is
   keg-only, so Homebrew deliberately does not put it on `PATH`.**
   Measured: `brew list --versions libpq` → **18.4**, and
   `/opt/homebrew/opt/libpq/bin/pg_dump --version` → **pg_dump (PostgreSQL)
   18.4**. A NEWER client dumps an OLDER server, so 18.4 against the server's
   17.6 is fine — the refusal only runs the other way.
   **Use the full path, or `export PATH="/opt/homebrew/opt/libpq/bin:$PATH"`.**
   *(Class 7 in `.claude/rules/mistakes.md`: check that the instrument can SEE
   the thing. `which` answers a question about `PATH`, not about the disk, and
   the answer was read as if it were about the disk.)*

Alternative worth trying first, since it needs no local client at all:
`npx supabase db dump`. It is still a Postgres client under the hood, so confirm
which version it ships.

**7.2 — Do NOT replay the migration chain to create the dev schema.**
(168 files as of 2026-08-26 — `ls supabase/migrations | wc -l`.) Nothing
proves the chain reproduces production: there is no `schema_migrations` table,
function bodies have been edited live (`STATE.md` says to read the LIVE body,
not the migration that defined it), and a replay that differs silently would
make dev wrong in ways nobody notices. **Take the schema from `pg_dump`
instead** — dev is then identical by construction. "Does the chain replay from
zero?" becomes a valuable *optional* proof, not a dependency.
*(Checked 2026-08-26: the migrations are otherwise portable — the only extension
is `pg_trgm with schema extensions` in 0068, and every `pg_cron` / `storage.` /
`supabase_admin` hit in `grep` is inside a comment.)*

**7.3 — With no door gate (D2), RLS is carrying the whole design.** Openness is
safe *because* the policies behave identically on dev. A branch that loosens a
policy "just to test", or a definer function that skips a check, is no longer a
dev-only mistake: it is a public URL serving real rows. This is the strongest
argument for running the authorization proofs against dev in CI (§5).

**7.4 — `wrangler pages deploy dist` will not upload `functions/`.**
`functions/notify.js` sits at the repo root, so a naive direct upload produces a
preview where **every Discord notification silently no-ops** — and silence is
indistinguishable from "no notification was due". Pass the functions directory
explicitly and verify with one real submission on the first preview.

**7.5 — Rebuilding `auth.users` in the dev project.** GoTrue's admin API cannot
create a user with a chosen id, and those ids are foreign keys across 64 tables,
so the load must write `auth.users` directly over the superuser connection. That
couples the copy to the dev project's auth schema version, which may be newer
than production's. Copy only the columns both have and let defaults fill the
rest, then **prove it by signing in as a copied account before declaring the
refresh good**. Do this step first in the refresh phase; everything else depends
on it.

**7.6 — Supabase's current free-tier limits.** The owner's experience (a third
project pauses another) is better evidence than anything quotable. Confirm on
the new account before assuming two projects.

**7.7 — Fork PRs get no secrets.** The preview build needs the `samo-dev` keys
from GitHub secrets; a PR from a fork cannot read them. Keep the five as repo
collaborators pushing branches, not forks.

**7.9 — Running the live proofs in CI would put a powerful credential where
five people can read it, so it is NOT done.** The Supabase management token can
run arbitrary SQL, and `samo-dev` holds REAL student data (D1, unmasked). This
repo is PUBLIC and five people have write access; GitHub Actions secrets are
withheld from FORK PRs but are readable by any workflow pushed on a BRANCH, so
storing it would hand that token to all five. It was added on 2026-08-29 and
**removed within minutes** on the owner's instruction to prefer the safe
default. What was kept is the part that carries the value: `npm run proofs:dev`
locally, and the mechanism that makes its answer trustworthy.

If CI-side proofs are ever wanted, the safe shape is a GitHub **Environment**
with the owner as a required reviewer, so a run must be approved before it can
read the secret. That is a decision, not a task — do not build it unprompted.

**7.8 — "The team is trusted" is a statement about today's team.** `master` in
the real tree (D3) is fine while the five are the five. Nothing will ever tell
the owner when that stops being true. Habit: read the master list once a term
(`select … from public.users where 'master' = any(permissions)` — 42 holders and
153 `claude` holders in August 2026; re-run, never quote) and remove who is no
longer building.

---

## §8. Build order

Effort estimates assume one session each, and every phase is independently
useful. **Phases 0–3 are what actually unblock five people.**

| # | Phase | Effort | Prerequisite |
|---|---|---|---|
| 0 | ✅ **DONE 2026-08-27** — repo guardrails. `required_status_checks` (`build`) and `require_code_owner_reviews` both ON, read back from the API; `CODEOWNERS` extended; `enforce_admins` deliberately still `false`. Only the project board is outstanding | — | — |
| 1 | ✅ **DONE 2026-08-27.** `samo-dev` = the ref in `SUPABASE_DEV_URL` on the separate account (D7). Schema + data loaded and verified against production: 66 tables, 0 row diffs, 0 grant diffs either way. `public.schema_migrations` + `migrate:status --dev` + `migrate:new` built. Sign-in as a copied account PROVEN end to end. One command: `CONFIRM=1 npm run dev:refresh` | — | — |
| 2 | ⏳ **NEARLY DONE** — ✅ `dev:refresh` / `dev:check` built and in use; ✅ §7.5 answered; ✅ `#samo-dev-bot` exists (it is `#developer-server-notify`); ✅ **`dev-grants.json` + `npm run dev:grants` shipped 2026-08-28** — refuses any project but samo-dev by ref, expires every entry, re-applied as step 8 of the refresh; ✅ **the mail trap is RETRACTED and its NEED is met** — dev mail is forced to one test inbox at the transport (`resolveRecipients`), so no trap is required to keep test mail off real people (`docs/EMAIL.md`). ❌ Still to do: **the dev GAS deployment under its own Google account** — the last item, and it needs the owner | ~30 min left, owner-gated | — |
| 3 | ⏳ **MOSTLY DONE 2026-08-27 — and most of it never needed building.** ✅ Per-PR previews were ALREADY configured on the `samomdkkuweb` Pages project (`preview_deployment_setting: all`, `pr_comments_enabled: true`) — **no Actions job and no `wrangler` are needed**, so §7.4's `functions/` trap does not apply. ✅ Preview env now points at `samo-dev`. ✅ The `pages.dev` guard is narrowed to the two EXACT retired hosts. ✅ Proven end to end on a throwaway PR. ✅ **COMPLETE — corrected 2026-08-29.** All three items this row listed as outstanding were already built and are in the repo today: `src/js/env-ribbon.js` (the ribbon), `functions/notify.js` (the dev `/notify`), and the `noindex`, which Cloudflare sets on preview deployments itself. **This row said "❌ Left" while `STATE.md` and §0b both said BUILT** — the drift §0b warns about, in §0b's own file | done | — |
| 4 | The `STATE.md` split (§6) | ~2 h | none |
| 5 | ✅ **DONE 2026-08-30, RESTRUCTURED 2026-08-31** — **https://samo.md.kku.ac.th/docs** (served from the VM, built by `deploy.sh`), mirrored at **https://samomdkku.github.io/samomdkkuweb/** by `.github/workflows/docs.yml`. Sidebar is generated from the filesystem but ORDERED by hand (`SIDEBAR` in the VitePress config), grouped by what a reader wants to DO rather than by document type, with the agent/maintainer material collapsed at the bottom; `src/js/docs-site.test.js` fails when a doc is unclassified. **Chosen over Docusaurus and Material for MkDocs on measurements, not taste** — MDX v3 parses `{` as JSX and `docs/` holds 307 bare `{` outside code across 50 of 72 files; Material for MkDocs entered maintenance mode in Nov 2025. Building it found three places where GitHub's own renderer was silently DELETING text (`docs/mistakes/deploy-hosting.md`), so `npm run docs:build` is now part of the required `build` check | done | — |
| 6 | ✅ **DONE 2026-08-29.** ✅ The live proofs run against `samo-dev`: **`npm run proofs:dev`**, and a proof can no longer lie about which database answered (`run-proofs.mjs` reads its `→ project:` line back). **All 23 database proofs pass against dev** — the first direct evidence for §7.3's assumption that RLS behaves identically there. Building it found a live bug: two proofs ignored the dev override and answered from PRODUCTION inside a green run (`docs/mistakes/tooling-proofs.md`). ⛔ **NOT in CI, deliberately** — see §7.9. ✅ **The browser smoke is DONE** — `tools/smoke-browser.mjs`, run automatically on every Cloudflare preview. It needs **no credential** (it loads the site as an anonymous visitor), which is what makes it safe on a public repo where §7.9's job was not | done | phases 1–3 |

### §8a. What phase 0 still needs — measured 2026-08-26, not assumed

Read from the GitHub API rather than assumed. **Most of phase 0 already exists**:

| Guardrail | State today | Action |
|---|---|---|
| Repo is public | ✅ `"visibility":"public"` | — (branch protection is therefore available on the free plan) |
| Collaborators | ✅ five `write` + owner `admin` | — |
| PR required, 1 approval | ✅ `required_approving_review_count: 1` | — |
| Force-push / delete blocked | ✅ both `false` | — |
| **CI must pass before merge** | ❌ **`required_status_checks` returns 404 — NOT ENABLED** | **the single highest-value fix here.** `build.yml` runs on every PR and nothing enforces its result: a PR with the entire suite failing can be merged today |
| `CODEOWNERS` | ⚠️ **file written 2026-08-26**; `require_code_owner_reviews` still `false` | the file already makes GitHub REQUEST the owner's review on those paths. Enabling the flag makes it BLOCK — do that once someone confirms the path list is right |
| PR / issue templates | ✅ **written 2026-08-26** — `pull_request_template.md`, `ISSUE_TEMPLATE/{bug,task}.md` | — |
| Project board | ❌ | add |
| Linear history | ❌ `required_linear_history: false` | optional — squash-merge by convention achieves it |

⚠️ **`enforce_admins` is `false`, and leave it that way.** That is what lets the
owner commit and push `main` directly, which is the normal flow here (the
authority model in `CLAUDE.md` says so, and this very design was pushed that
way). Turning it on would route the owner's own deploy commits through PRs for
no benefit.


---

## §9. What must be corrected in OTHER files when this ships

Left alone deliberately — today they describe today's reality, and a document
that describes a plan as though it were real is the failure this repo keeps
paying for. **When the phase lands, correct them in the same commit:**

- **`CONTRIBUTING.md`** — currently says *"There is no preview deploy"* and
  tells contributors to test against production and ask the owner to delete the
  rows. Both become false at phase 3 and phase 1 respectively. Its Quick start
  must point at `samo-dev`, not at a `.env.local` from the owner.
- **`README.md`** — Quick start / env section, at phase 1.
- **`docs/CONTEXT.md`** — deploy plumbing and environment map, at phase 3.
- **`.claude/rules/security.md`** — add rows for the dev account PAT, the dev DB
  URL, the dev GAS credential and the Cloudflare token, at phases 1–3.
- **`skills/deploy-vm.md`** — add `npm run migrate:status` to the pre-deploy
  checklist and the smoke-test line, at phase 1.
- **`STATE.md`** — the pointer in the next-session prompt, every phase.

---

## §10. First session after a `/clear` — start here

**Read in this order:** `STATE.md` → this file's **§0** (the decisions) → **§7**
(the unknowns). Then:

### If the owner says "build it"

✅ **Phase 0 and phase 1 are DONE (2026-08-27). Do not start there.**
Branch protection now requires the `build` check AND code-owner review — both
read back from the GitHub API, with `enforce_admins` deliberately left `false`
so the owner can still push `main`. `samo-dev` exists, is loaded from
production, and was verified table by table with sign-in proven end to end.

⚠️ **This section used to say "start at §8a — make CI blocking. Today a PR can
merge with the entire suite failing."** That was true until the morning of
2026-08-27 and is now false; a session following it would re-do finished work.

**Start instead at `STATE.md`, then `docs/state/<handle>.md`.** The next
unstarted pieces are **phase 3** (previews — DECIDED, per-PR on Cloudflare
Pages, §1 + D8, `CLOUDFLARE_*` already in `.env.local`) and **the rest of phase
2** (mail trap, `#samo-dev-bot`, the dev GAS deployment, `dev-grants.json`).

**The one guardrail still missing** is a check that the two protection settings
are still on — they live on GitHub, outside git, so switching them off turns
every contributor rule back into a suggestion with nothing going red.

**b. `.github/CODEOWNERS` is already written** (2026-08-26) with no default
owner line — a `*` rule would route everything to the owner and lose the point.
It currently reads:

```
/src/js/auth.js      @phuriphatma
/src/js/db.js        @phuriphatma
/src/js/notify.js    @phuriphatma
/src/js/uploads.js   @phuriphatma
/supabase/           @phuriphatma
/server/             @phuriphatma
/appscript/          @phuriphatma
/tools/              @phuriphatma
/.github/            @phuriphatma
/.claude/            @phuriphatma
/CLAUDE.md           @phuriphatma
/STATE.md            @phuriphatma
```

Check the path list still matches reality, then set
`require_code_owner_reviews: true` to make it blocking rather than advisory.
Everything not listed keeps needing one approval from **any** collaborator —
that is what stops the owner being the bottleneck for CSS and copy.

**c. The project board.** PR and issue templates are already written.

### Before phase 1 can start, the owner must supply one thing

**The database password** (Supabase dashboard → Settings → Database) so
`SUPABASE_DB_URL` can go in `.env.local` — the Management PAT already there
**cannot** `pg_dump`.

And one thing the session can do itself while waiting: **install a PostgreSQL 17
client.** Measured 2026-08-26, this machine has no `pg_dump`, no `psql` and no
`supabase` CLI, and the server is 17.6 — a client older than the server refuses
to dump. Until both exist, phases 1, 2 and 6 cannot begin (§7.1).

### What NOT to do in that session

- **Do not edit `CONTRIBUTING.md` or `README.md` "to match this plan".** They
  correctly describe today. §9 says which phase corrects which file.
- **Do not re-argue §0.** Those seven were decided by the owner, several against
  the assistant's recommendation, and the reasoning is recorded.
- **Do not build the dev schema by replaying the migration chain** — §7.2.
- **Do not put the plan's numbers into `STATE.md`.** They decay; this file
  carries them once, with the command that re-measures them.
