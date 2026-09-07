# Shipping a schema change on this repo

The loop below was run seven times in one session (0128–0134). Doing it out of
order took production down for ~20 minutes.

## The order, and it is not negotiable

1. **Read the LIVE function body first**, never the migration that defined it:
   `pg_get_functiondef` via `node tools/db-query.mjs`. A later migration has
   almost always changed it, and rebuilding from the original silently reverts
   everything since.
2. **Write the migration** in `supabase/migrations/NNNN_*.sql`, header first:
   what was reported, what the cause was, why THIS shape.
3. **Apply to `samo-dev` FIRST**, then production:

   ```bash
   node tools/apply-migration.mjs supabase/migrations/NNNN_*.sql --dev
   node tools/apply-migration.mjs supabase/migrations/NNNN_*.sql
   ```

   ⚠️ **`--dev` only arrived on 2026-09-01.** Until then this — the one tool in
   the repo that runs DDL — could reach nothing but production, so every
   migration in the history above was first executed against real student data.
   `migrations-lib.credentials()` had understood the flag for weeks; the script
   simply did not use it. If a step here says "run X on dev", check X can.
   ⛔ **`tools/db-query.mjs` still cannot** — it IGNORES `--dev` and runs on
   PRODUCTION. Send a proof to dev by overriding the URL instead:
   `VITE_SUPABASE_URL="$SUPABASE_DEV_URL" SUPABASE_ACCESS_TOKEN="$SUPABASE_DEV_ACCESS_TOKEN" node tools/db-query.mjs …`
   and READ the `→ project:` line it prints — that is the only thing standing
   between you and a proof you think ran on dev.
4. **Prove it live, BOTH directions** — a new `tools/*.mjs` in the shape of
   `house0132-registry.mjs`: a transaction that ROLLS BACK, an ALLOW half and a
   DENY half. A probe that can only print "denied" cannot tell a working guard
   from a broken connection.
5. **`npm run build && npm test`**, then commit, push `main`.
6. **Deploy**: `skills/deploy-vm.md` (which holds the measured duration — do
   not restate it here). **Batch commits — do not deploy
   per commit.**
7. **Verify from the SERVED artifact**, never the local file:
   `curl https://samo.md.kku.ac.th/assets/<bundle>.js | grep -c <marker>`.
   The VM builds its own hashes, so find the name from the served HTML.

## ADD is safe in either order. DROP is not.

Old code does not ask for a column you just added — but it IS still asking for
one you just dropped, and **PostgREST 400s the whole query on an unknown
column**. So:

- **adding** → apply, then deploy.
- **dropping** → deploy the code that stopped reading it, CONFIRM it is the
  version being served, and only then drop.

That is the ordering 0129 got backwards.

## CI replays every migration from empty — read what it says

Since 2026-09-07, opening a PR that touches `supabase/migrations/` runs
`.github/workflows/migrations.yml`: a throwaway Postgres 17 inside the job, all
migrations applied in order from nothing. **It needs no credential**, which is
why it can run on a public repo's pull requests, and it takes about 9 seconds.

What it proves: your migration applies to an empty database, and the whole
schema still rebuilds from this repo alone — the assumption every recovery plan
rests on and which nobody had ever tested before that date.

What it does NOT prove: behaviour. `auth.uid()` is null on that database, so no
policy is exercised. Behaviour is still `npm run proofs -- --dev`.

Two results that are not failures:

- **`⊘ refused — needs data`.** Your migration raised its own exception because
  the database is empty (0166 does this: it backfills timelines, then checks it
  did not lose any). That is a data check and the run continues. Only a
  deliberate `raise exception` (SQLSTATE P0001) is treated this way; a missing
  column or table stops the run.
- **A red run on a migration you did not touch.** Then something earlier in the
  chain broke, or the platform stub in `tools/ci/supabase-platform.sql` is
  missing a Supabase feature a migration started using. ⛔ **Do not edit an
  applied migration to make it green** — the fix is a new migration, or the stub.

## Traps this loop exists to avoid

- **A write and the check that reads it back must be SEPARATE statements**, or
  the subquery sees a pre-write snapshot and the proof reports a false failure.
- **Pick the probe subject on BOTH grant columns.** `current_user_has_permission()`
  reads `permissions` ∪ `managed_permissions` (0081); an account with empty
  `permissions` may hold `master` through the ทีม SAMO tree and will look exactly
  like a fail-open policy.
- **`tools/db-query.mjs` COMMITS.** Wrap anything mutating in
  `begin; … rollback;`.
- **A proof that fails for the wrong reason gets explained away**, and then it
  protects nothing. Fix the probe, do not lower the bar.
