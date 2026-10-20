-- ============================================================
-- 0236 — username sign-in hardening.
--
-- NIGHT-AGENT WORK (task 15, 2026-10-20, agent/2026-10-20). Applied to
-- samo-dev ONLY — NOT production, so production's current behaviour is
-- UNCHANGED until this branch is reviewed and deployed. Memory:
-- open-privacy-username-lookup. Full mechanism, severity and exploitability
-- detail is deliberately kept OUT of this public repo until the owner has
-- deployed the fix — see `~/samo-night/reports/2026-10-20-security.md`
-- (outside the repo) for everything this comment omits.
--
-- WHAT CHANGES, in one sentence: `lookup_email_by_username` now only
-- releases an account's real (non-synthetic) email to a caller who ALSO
-- supplies that account's correct password in the same call — verified
-- against `auth.users.encrypted_password` via pgcrypto's `crypt()`, the same
-- bcrypt scheme GoTrue itself uses. The synthetic-email case (every
-- password-native account) is unchanged — that answer was always derivable
-- by the caller without this RPC. An unknown username and a wrong password
-- answer identically (no existence oracle either).
--
-- WHY NOT GATE ON `users.method = 'password'` INSTEAD (the simpler-looking
-- fix). Rejected: `method` records how an account was BORN, not what it can
-- sign in with today (both directions can change after creation), so it
-- cannot tell "this address is derivable" from "this address is real". The
-- fix compares against the actual derivable string instead, which asks the
-- right question regardless of how the account started.
--
-- WHY NOT MOVE THE WHOLE LOOKUP OFF-DATABASE. A VM-side proxy would also
-- close this, but it is a bigger, riskier change for the same property this
-- function-level fix already gets, and this agent cannot deploy VM code
-- tonight regardless — written here so it ships the moment the branch does.
--
-- RESIDUAL, NAMED RATHER THAN HIDDEN: this turns the lookup into a SECOND
-- password-verification path alongside GoTrue's own `signInWithPassword`,
-- which may carry its own rate-limit/lockout this SQL path does not. The
-- check is a single bcrypt compare (no slower than a normal login) and
-- PostgREST's own connection pool bounds how fast anon can hammer it —
-- judged acceptable for this severity (owner-labelled LOW) rather than
-- building a lockout table nobody asked for. Flagged for the owner in the
-- private security report, not hidden.
-- ============================================================

drop function if exists public.lookup_email_by_username(text);

create or replace function public.lookup_email_by_username(p_username text, p_password text default null)
returns text
language plpgsql
stable
security definer
set search_path = public, auth, extensions
as $$
declare
  v_id    uuid;
  v_email text;
  v_hash  text;
  v_synth text;
begin
  select au.id, au.email, au.encrypted_password
    into v_id, v_email, v_hash
    from public.users pu
    join auth.users au on au.id = pu.id
   where pu.username = lower(trim(coalesce(p_username, '')))
   limit 1;

  if v_id is null or v_email is null then
    return null;
  end if;

  v_synth := lower(trim(coalesce(p_username, ''))) || '@samomdkku.app';

  if lower(v_email) = v_synth then
    return v_email;
  end if;

  if p_password is not null and v_hash is not null
     and extensions.crypt(p_password, v_hash) = v_hash then
    return v_email;
  end if;

  return null;
end;
$$;

revoke all on function public.lookup_email_by_username(text, text) from public;
grant execute on function public.lookup_email_by_username(text, text) to anon, authenticated;
