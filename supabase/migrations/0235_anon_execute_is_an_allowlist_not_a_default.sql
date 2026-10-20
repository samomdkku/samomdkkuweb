-- 0235 — anon EXECUTE is an allow-list, not whatever CREATE FUNCTION defaulted to
--
-- NIGHT-AGENT WORK (task 15, 2026-10-20, agent/2026-10-20). Applied to
-- samo-dev ONLY — NOT production, so production's current grants are
-- UNCHANGED until this branch is reviewed and deployed. Full severity/
-- exploitability detail for the 4 named functions below is deliberately
-- kept OUT of this public repo until then — see
-- `~/samo-night/reports/2026-10-20-security.md` (outside the repo).
--
-- SYMPTOM. `create function` grants EXECUTE to PUBLIC unless the migration
-- explicitly revokes it — the exact function-level twin of the 0188
-- default-ACL lesson for TABLES (`docs/mistakes/postgres-schema.md`). Nobody
-- here had ever swept for it. A live read of samo-dev's `pg_proc` found 118
-- functions anon can EXECUTE; most are either genuine public RPCs (the
-- public VS board, `get_academic_year`, …) or `current_user_*`/`prof_can_see_*`
-- policy helpers that RLS itself must be able to call when anon evaluates a
-- policy on a table anon has ANY access to — revoking those would turn a
-- quiet "denied" into a hard "permission denied for function" on every
-- anon-reachable table whose policy mentions them, which is worse than the
-- grant. But two shapes in that list had NO reason to be there:
--
-- 1. **51 TRIGGER functions** (`returns trigger`, zero args) — Postgres
--    itself refuses to invoke a function of pseudo-type `trigger` outside
--    trigger context ("trigger functions can only be called as triggers"),
--    so the EXECUTE grant was inert, not exploitable. Revoked anyway: this
--    repo does not want a "harmless by an engine detail nobody chose" line
--    in its own allow-list, and a future trigger function should not have
--    to argue it is safe by the same accident.
-- 2. **Four internal helpers with no legitimate caller outside this
--    schema's own trigger/RPC bodies** (named in the REVOKE statements
--    below — not re-described here; each one's actual risk if called
--    directly is in the private report, not this file). Every one of
--    these is called ONLY from inside another SECURITY DEFINER function
--    OWNED BY `postgres` — ownership grants implicit EXECUTE regardless of
--    ACL, so revoking PUBLIC here breaks no caller. Confirmed live: every
--    caller's owner is `postgres`, same as the revoked function
--    (`tools/security0235-whole-class-sweeps.sql` §2 proves the real
--    callers still work after this migration).
--
-- WHY THIS IS THE DYNAMIC SHAPE (a scan, not a hand-typed DROP list): the
-- trigger-function property ("zero-arg, returns trigger, anon can execute
-- it") is what makes each one safe-to-revoke, not its name — a future
-- trigger function left ungranted-by-convention is caught by this same
-- predicate the day someone re-runs the idea, and this migration itself is
-- idempotent (re-running it against a state where nothing is still granted
-- simply revokes nothing).
--
-- WHAT IS NOT TOUCHED: every `current_user_*` / `prof_can_see_*` / `get_public_*`
-- / public RPC helper keeps its anon grant. `tools/security0235-whole-class-
-- sweeps.sql` §2 is the allow-list — the proof that decides, with a one-line
-- reason per surviving entry, not this migration's comment.
-- ============================================================

do $$
declare
  r record;
begin
  for r in
    select n.nspname, p.proname, p.oid
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'passport')
      and pg_get_function_result(p.oid) = 'trigger'
      and pg_get_function_identity_arguments(p.oid) = ''
      and has_function_privilege('anon', p.oid, 'EXECUTE')
  loop
    -- Supabase's own `alter default privileges` grants EXECUTE to `anon` AND
    -- `authenticated` DIRECTLY on every new function (`pg_default_acl`,
    -- objtype 'f') — not only via PUBLIC. Revoking PUBLIC alone leaves both
    -- of those explicit grants standing, so all three are named.
    execute format('revoke execute on function %I.%I() from public, anon, authenticated',
      r.nspname, r.proname);
  end loop;
end $$;

revoke execute on function public.resolve_person_id(text, text, text, text, text, text, text)
  from public, anon, authenticated;
revoke execute on function public.effective_team_dept_pages_for_email(text)
  from public, anon, authenticated;
revoke execute on function public.node_effective_dept_pages(uuid)
  from public, anon, authenticated;
revoke execute on function public.vs_thread_remarks(text)
  from public, anon, authenticated;
