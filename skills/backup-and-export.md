# Backing up, exporting and (eventually) deleting SAMO data

The data-safety layer `docs/YEAR-ROLLOVER.md` § Backup/§ Export/§ Deletion
designs and migration `0222_year_export_log_and_the_deletion_gate.sql`
implements. Night agent, task 5 of the 2026-10-14 queue. Three SEPARATE
questions, kept separate on purpose — read `## Which one do I need?` first.

## Which one do I need?

| I want to… | Use | Scope |
|---|---|---|
| Take a snapshot of one system's one SAMO year (for a graduating team, or before any future deletion) | `tools/year-export.mjs` | one table (+its children), one year |
| Protect against losing the WHOLE database (deleted project, corrupted table, fat-fingered migration) | `server/supabase-backup.sh` + its systemd timer | everything, nightly |
| Delete or anonymise rows for a year that is over | **Not built yet for any system** — docs/YEAR-ROLLOVER.md § Deletion decided NOTHING is deleted by a year rollover; only VS's text-scrub (24 months, task 6's job) and person-triggered account closure (already built, 0132-era) ever remove anything, and both must open the gate below first | — |

## Per-year export — `tools/year-export.mjs`

```bash
node tools/year-export.mjs --help
node tools/year-export.mjs --list                         # which systems are registered
node tools/year-export.mjs --system pr_tickets --year 2569              # PLAN ONLY — prints counts, writes nothing
node tools/year-export.mjs --system pr_tickets --year 2569 --apply      # writes JSON+CSV under ~/samo-exports/ (never inside the repo — it is public; the tool refuses), records year_export_log
node tools/year-export.mjs --system projects   --year 2569 --apply --drive  # ALSO uploads to Drive (needs deploy:gas first — see below)
```

Registered systems today: `pr_tickets`, `vs_tickets`, `shop_orders` (+
`shop_order_items`), `projects` (+ `project_documents` + `project_sign_requests`),
`team_archive_nodes`, `team_archive_members`. Each export reads through the
SAME column shape the system's own admin screen already fetches (`select=*`,
or the exact nested shape `ORDER_FIELDS`/`PROJECT_FIELDS` already define in
`src/js/shop/api.js`/`src/js/projects/api.js` — `tools/year-export.test.js`
greps those files so a change there cannot silently drift from this tool).

**Plan-only by default.** Nothing is written to disk, nothing reaches Drive,
and nothing is recorded as "exported" unless you pass `--apply`. The plan
print only ever shows COUNTS and file paths — never a row's contents, by
construction (`buildPlan`/`planLines` take counts, not rows;
`year-export.test.js` asserts this).

**What `--apply` does, in order:**
1. Writes `<out>/<system>/<year>/<system>_<year>.json` (full nested shape —
   the one place a re-import or a "what did this look like" question can be
   answered completely) and a flat `.csv` per table (parent + each child,
   RFC4180-quoted, formula-guarded, UTF-8 BOM — the same convention every
   other CSV export in this repo already uses).
2. Inserts one row into `public.year_export_log` — the durable "yes, this
   happened" record (see `## The deletion gate` below). The Node tool writes
   this DIRECTLY (not through the gated `record_year_export()` RPC) because
   it runs through the Management API as the Postgres superuser, where
   `auth.uid()` is null — see the migration's own header for why a gate keyed
   on that would refuse the one caller meant to write it.
3. Only with `--drive`: uploads every written file to
   `My Drive/IT Database/Archives/<year>/` via a new GAS action,
   `uploadArchiveFile` (`appscript/prform.gs`). **This needs
   `npm run deploy:gas` first** — the action does not exist on the live
   endpoint until that runs, and this night agent has no Drive credential to
   have ever exercised it. Archive files are NOT shared "anyone with the
   link" (unlike PR/Shop/Team uploads) — an export can carry PDPA-covered VS
   text or a buyer's address, so they stay visible only to the owner's
   Google account.

**Which Drive folder, and why not inside PR/Shop/Team.** A new top-level
`Archives/<year>/` folder, parallel to the existing five — never nested
inside a system's own live folder, because an archive snapshot is not that
system's working tree (`docs/YEAR-ROLLOVER.md` § Backup's decision).

## Whole-database backup — `server/supabase-backup.sh`

Mirrors `server/vaultwarden/backup.sh`'s discipline exactly — read that
file's header if you have not already, this one repeats nothing it already
explains well: verify the COPY not the hope, assert content (not just exit
0), never prune until the new one is verified, exit non-zero so the systemd
unit shows FAILED instead of succeeding silently.

**Install (owner, on the VM, needs ssh/VPN — this night agent cannot do this
step):**
```bash
sudo cp server/supabase-backup.env.example /etc/supabase-backup.env
sudo chown root:root /etc/supabase-backup.env && sudo chmod 600 /etc/supabase-backup.env
sudo nano /etc/supabase-backup.env   # fill in the real SUPABASE_DB_URL

sudo cp server/supabase-backup.service server/supabase-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now supabase-backup.timer
systemctl list-timers supabase-backup.timer   # confirm a real NEXT, not infinity
```

**Run it once by hand BEFORE trusting the timer:**
```bash
sudo -u ubuntu /home/ubuntu/samo-projects/samomdkkuweb/server/supabase-backup.sh
```
Read the output. `==> OK <timestamp>` means a `.dump` landed in
`/var/backups/supabase/`, its table-of-contents was read back successfully,
and it lists at least 50 tables (this project has 200+ migrations behind
it — a near-empty dump means a wrong connection string, not a clean
database).

### The IPv6 question — unresolved, and why

`SUPABASE_DB_URL`'s direct host (`db.<ref>.supabase.co`) is **IPv6-only**
(confirmed in `skills/build-the-dev-database.md`, from a machine that has
IPv6 egress). **Whether the KKU VM has IPv6 egress has never been tested** —
this night agent has no access to the VM to check, and no production
`SUPABASE_DB_URL` to try it with even if it did. Decide this BEFORE trusting
the timer, not after a silent month of failed nightly runs:

```bash
# on the VM:
curl -6 https://ifconfig.co          # has an address → IPv6 egress exists
dig +short db.<ref>.supabase.co AAAA  # confirms the Supabase side resolves
```

- **If IPv6 egress exists**: the direct host in the `.env.example` template
  works as-is.
- **If it does not**: switch `SUPABASE_DB_URL` to Supabase's own IPv4 answer
  — the **Session mode connection pooler** string, from the dashboard
  (Project Settings → Database → "Connection pooling"). `
  skills/build-the-dev-database.md` records ONE earlier attempt at a pooler
  host failing with `tenant/user not found` — that is a username/region
  mismatch, not proof the pooler mechanism itself is broken for this
  project; get the exact string from the dashboard rather than reusing the
  one that failed.

Either way, **this is a decision for whoever installs the timer to verify
once, by running the backup by hand and reading its output** — it is written
here as a plan, not as a tested fact, because testing it needs VM access
this agent does not have.

### Restoring (NEVER run this against the live project by accident)

```bash
pg_restore --list samo-db-<timestamp>.dump   # inspect first — always
# pg_restore --dbname <TARGET-CONNECTION-STRING> samo-db-<timestamp>.dump
```

Same rule as `server/vaultwarden/`'s restore: this is written for completeness
and has never been exercised. `--dbname` must point at a **recovery target**,
never the live project, unless you have already decided to overwrite it and
said so out loud to the owner first.

## The deletion gate — for the NEXT task that writes a real anonymiser

Migration `0222` ships the mechanism, not a policy for any one system (VS's
24-month text-scrub, Shop's and หนังสือโครงการ's own retention — each is a
later task's job, against a `samo_year_be` column some of those tables do
not have yet). Any future deletion/anonymisation RPC, for any system, MUST:

```sql
if not public.year_export_recorded('<system>', <year>) then
  raise exception '<rpc name>: % % has not been exported — refusing', '<system>', <year>;
end if;
```

**Why a log, not a flag.** `year_export_log` is append-only (no UPDATE/DELETE
policy exists for any role) — a system may be exported any number of times,
and a second export can never un-mark the first. `year_export_recorded(system,
year)` just asks "does at least one row exist".

**Who may call `record_year_export(...)` directly** (the gated RPC, for a
future browser "export now" button): a holder of the new `data_admin`
permission, or the `dev` role — granted to nobody by migration 0222; a human
decides who holds `data_admin` through ทีม SAMO → สิทธิ์, the same way every
other permission key in this codebase is granted. The Node tool
(`tools/year-export.mjs`) does NOT call this RPC — see `## Per-year export`
above for why.

**Every future RPC must also**: take an explicit `dry_run boolean default
true` parameter (never mutate on the default call), and RETURN the count of
rows it touched (or would touch) — never a bare success flag. This mirrors
`delete-guard.test.js`'s frontend rule (`return=representation` + a
`data.length` check) at the RPC layer: a caller that cannot see HOW MANY rows
an action affected cannot tell "nothing to delete" from "the filter matched
zero by mistake".

## Proof

`tools/data0222-export-gate.sql` (`node tools/run-proofs.mjs data0222`,
rolled back, nothing left behind) covers: `year_export_log`'s RLS (a plain
subject sees and writes nothing directly), `record_year_export` failing
closed for a stranger and for bad input while succeeding for `data_admin`
and for `dev`, re-exporting a year adding a row rather than overwriting one,
`year_export_recorded` staying specific to the exact (system, year) pair, and
— the actual contract in practice — a throwaway demo RPC shaped exactly like
a future per-system anonymiser refusing an unexported year and succeeding
once it is recorded.

`tools/year-export.test.js` covers the tool's pure logic with a stubbed
database (asserting the EXACT SQL sent, never the result) and a stubbed
Drive payload (asserting the exact JSON `uploadArchiveFile` would receive) —
the "stub it and assert what comes OUT" rule
(`.claude/rules/mistakes.md` class 7), applied to a tool capable of writing
real files and real Drive uploads.

Both applied to samo-dev only; production gets migration 0222 when the owner
reviews and applies this branch (`skills/ship-a-migration.md`). The backup
script and the Drive `--drive` path are WRITTEN, NOT RUN — see each file's
own header for exactly what has and has not been exercised.
