# Building `samo-dev` from production

`docs/TEAM-WORKFLOW.md` phase 1. **Measured 2026-08-27 against the live
project** — every number and every trap below came from running it, not from
reading documentation.

⚠️ **Do NOT build the dev schema by replaying the 169 migrations.** Nothing
proves the chain reproduces production: function bodies have been edited live,
and a replay that differs silently makes dev wrong in ways nobody notices. Take
it from `pg_dump`; dev is then identical by construction. §7.2.

---

## 0. The connection facts, because each one cost a wrong guess

- **`pg_dump` is NOT on `PATH`.** Homebrew's `libpq` is keg-only. It is at
  `/opt/homebrew/opt/libpq/bin/` — **18.4**, and a NEWER client dumps an OLDER
  server, so 18.4 against the server's 17.6 is correct. (`which pg_dump` finding
  nothing is a statement about `PATH`, not about the disk —
  `docs/mistakes/tooling-proofs.md`.)
- **The direct host is IPv6-ONLY.** `db.<ref>.supabase.co` has an AAAA record
  and no A record. It works from this machine because it has IPv6 egress; on a
  v4-only network it will not resolve, and **that failure looks exactly like a
  wrong password.** Check `dig +short <host> AAAA` before blaming the credential.
- **The pooler is not a drop-in.** `aws-0-ap-southeast-1.pooler.supabase.com`
  refuses `postgres.<ref>` with `(ENOTFOUND) tenant/user not found`. Use the
  direct host; the pooler's tenant format is a separate rabbit hole.
- Credential: `SUPABASE_DB_URL` in `.env.local` (gitignored — confirmed with
  `git check-ignore`). Prefer `PGPASSWORD` in the environment over a password in
  `argv`, which is visible in `ps`.

Confirm the credential before anything else, and read the ANSWER, not the exit
code:

```bash
PGPASSWORD='…' /opt/homebrew/opt/libpq/bin/psql \
  "postgresql://postgres@db.<ref>.supabase.co:5432/postgres?sslmode=require" \
  -tAc "select current_user || ' · ' || split_part(version(),' ',2);"
```

## 1. Dump the schema — and keep the privileges

```bash
/opt/homebrew/opt/libpq/bin/pg_dump "$SUPABASE_DB_URL" \
  --schema-only --no-owner \
  --schema=public --schema=passport \
  -f schema.sql
```

⛔ **Never add `--no-privileges`.** It strips every `GRANT`, and **RLS policies
with no GRANT deny everyone while reading exactly like the policies working** —
this repo has already paid for that once (0138). The first dump taken here had
`--no-privileges` and produced **0 GRANTs**; the correct one has **592**:
79 to `authenticated`, 65 to `anon`, 62 to `service_role`, 1 to `postgres`.
**Count the GRANTs after every dump.** A dev copy that denies everything is the
worst possible dev copy, because every test "passes" by refusing.

`--no-owner` is fine and wanted: ownership differs between projects.

What the live project holds (2026-08-27): **64 tables · 165 functions · 156
policies · 64 triggers · 1 view**, across `public` (52 tables) and `passport`
(13). `auth` has 23 more that Supabase creates itself.

## 2. Prepare the target BEFORE loading

The dump names things the platform must already provide:

- **`pg_trgm`** — 6 uses (`gin_trgm_ops`, `similarity`). Not on by default:
  `create extension if not exists pg_trgm with schema extensions;`
- `gen_random_uuid` — 25 uses, built into PostgreSQL 13+; nothing to install.
- **No `uuid-ossp`, no `pgcrypto` calls** in the schema. Do not enable them
  because production has them; enable what is USED.
- `auth`, `storage`, `realtime`, `vault` are created by Supabase on any project.

## 3. `auth.users` comes FIRST — seven tables depend on it

`public.people`, `public.users`, `public.students`, `public.team_nodes`,
`public.student_change_requests`, `public.student_import_batches` and
`public.shop_promptpay_qrs` all carry a foreign key to `auth.users`. Load the
accounts before any of them or every insert fails.

⚠️ **GoTrue's admin API cannot create a user with a chosen id**, and those ids
are the foreign keys — so the accounts must be written into `auth.users`
directly over the superuser connection (§7.5). That couples the load to the dev
project's auth schema version, which may be newer than production's: **copy only
the columns both sides have and let defaults fill the rest.**

**Then prove it before declaring the refresh good: sign in as a copied account.**
Nothing else settles whether the auth load worked.

## 3b. ⛔ THE ONE THAT ALMOST GOT THROUGH — a restore is MORE permissive than the source

**Measured 2026-08-27 on the real restore.** After loading the dump, dev had
**134 grants production does not have, and 0 that it was missing.** Sixteen
tables — including `students`, `people`, `student_change_requests`,
`student_import_batches` and `_timeline_backup_0166` — had been granted to
**`anon`**, which production grants nothing on.

**Cause.** Supabase ships `ALTER DEFAULT PRIVILEGES` granting everything to
`anon` / `authenticated` / `service_role` on newly created tables. `pg_dump`
emits the GRANTs a database has, but no REVOKEs — it assumes stock PostgreSQL
defaults, where nothing is granted. So every table the dump CREATES picks up the
platform defaults, and the dump has nothing to take them back off.

**Why it matters more than it looks.** RLS is still on, so rows are still
filtered. But production refuses `anon` at the GRANT — before any policy runs —
and dev would refuse only at the policy. **Two databases, two different gates,
and the preview URL has no door on it.** (The 12 `permission denied to change
default privileges` errors during the load are unrelated and harmless: the dump
tries to re-assert defaults it does not own.)

**Fix, and never from a hand-written list — from the measured difference:**

```bash
# every (schema, table, grantee, privilege) dev has that prod does not
comm -13 <(sort grants.prod) <(sort grants.dev) \
  | awk -F'|' '{printf "revoke %s on %s.%s from %s;\n", $4, $1, $2, $3}' > revoke.sql
```

Then re-measure until **extra = 0 and missing = 0**. It took 134 revokes here.

**`npm run dev:check` is the ratchet for this**, and it is the thing to run after
every refresh — not this paragraph. It compares the anon key's HTTP status on
both databases across allow-subjects AND deny-subjects. *Falsified by granting
`anon` SELECT on `students` on dev alone: it reported `students deny 401 200 ←
DRIFT` and exited 1, then went green on the revoke.*

## 4. After loading — the check that matters

RLS behaves identically on dev, or the whole design (`docs/TEAM-WORKFLOW.md`
§7.3 — no door gate on the preview) is unsafe. So:

- `npm run proofs` against dev. All of them are both-directional.
- One ALLOW and one DENY over the same rows with the **anon key**. A deny-only
  probe cannot tell a working guard from a broken service.
- `npm run dev:check` — the grant/RLS parity check above. Run it every refresh.
- `npm run migrate:status -- --dev` (⚠️ the `--` is REQUIRED — npm swallows the flag otherwise and you get PRODUCTION's answer) — **confirmed 2026-08-27: after a schema-only
  restore the table EXISTS and is EMPTY, so all 169 migrations read as
  PENDING.** Run `node tools/migrate-status.mjs --dev --backfill` once. Both
  tools take `--dev`; the DEFAULT IS PRODUCTION on purpose, and each prints
  which one it chose, because a tool that silently defaults to dev is a tool
  that reports production healthy while looking elsewhere.

## 4b. It is now one command — `CONFIRM=1 npm run dev:refresh`

Everything above is encoded in `tools/dev-refresh.mjs`. Three guards protect
production, and each was falsified rather than assumed: the dev connection must
point at the dev project (tested by aiming it at production — refused), it must
not contain the production ref, and `CONFIRM=1` is required (tested — refused).
Production is only ever opened with `pg_dump`.

⛔ **Two defects the first run had, both worth knowing because they will recur
in any refresh script:**

1. **It did not refresh `auth`.** Step 2 drops `public` and `passport`; `auth`
   is a different schema and survives, so `COPY auth.users` aborted at line 1 on
   duplicate ids and dev kept its old accounts. Now: `truncate auth.users
   cascade` first.
2. **The verification could not see that.** It compared 64 tables —
   `public` + `passport` — so it never looked where the failure was, and printed
   "identical to production". Now 66, including `auth.users` and
   `auth.identities`.

Note that `truncate auth.users cascade` cascades into `team_members`,
`vs_followers`, `vs_public_comments` and `shop_order_items`; that is harmless
here only because step 2 has already emptied them. **Order matters: truncate,
then auth, then app.**

📌 **`schema_migrations` is excluded from the data copy** (`--exclude-table-data`).
It describes the database it lives in, not the application — copying it makes
dev claim production's apply history, and it is what collided on the first
hand-run.

📌 **After a `drop schema public cascade`, the grant drift does not appear** —
Supabase's `ALTER DEFAULT PRIVILEGES` are attached to the schema and go with it.
The revoke step still ran and reported 0. Keep it: it is needed whenever the
schema is loaded into a project whose defaults are intact, which is what a fresh
project is.

## 4c. Two things that will waste someone's afternoon

- **The dev database password exists in ONE place: `SUPABASE_DEV_DB_URL` in
  `.env.local`.** It was generated at project creation and written nowhere else.
  If that file is lost, do not go looking — reset it in the dev project's
  dashboard (Settings → Database) and update the line. Nothing depends on the
  old value.
- **Do not pick `claude-reporter@samomdkku.app` as the account to prove sign-in
  with.** Measured 2026-08-27: it has **no `auth.identities` row at all**
  (`providers=none`) on production, so it is copied faithfully and still cannot
  do a password sign-in. That is correct — it is a service identity, not a
  login. Use `samomdkkudev@samomdkku.app`, which has an `email` identity and a
  matching `public.users` row with `role=dev`.

## 5. Still unknown — do not plan around these as if settled

- Whether the free tier allows two active projects on a new account (§7.6). The
  owner has hit a pause before. **A third project on the LIVE account is already
  INACTIVE** (`letuxetrbejoqsnaqdgl`, ap-southeast-1) — evidence the limit is
  real, and the reason `samo-dev` goes on a SEPARATE account (D7).
- ~~The auth schema version skew in §3.~~ ✅ **Measured 2026-08-27: there is
  none.** `auth.users` + `auth.identities` have **44 shared columns and zero on
  either side alone** between the live project and a project created today. The
  §7.5 worry did not materialise — but it is a fact about two projects on the
  same platform version, so re-measure rather than assume it stays true.
- Whether `storage` objects need copying at all — nothing in the app's schema
  references `storage.*` (measured: 0 hits), so probably not.
