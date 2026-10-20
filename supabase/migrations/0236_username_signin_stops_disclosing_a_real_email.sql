-- ============================================================
-- 0236 — username sign-in hardening: lookup_email_by_username stops handing
-- back a REAL email to a caller who has not already proved they hold it.
--
-- NIGHT-AGENT WORK (task 15, 2026-10-20, agent/2026-10-20). Applied to
-- samo-dev ONLY — not production. Memory: open-privacy-username-lookup
-- (reported to the owner 2026-09-21; owner-approved to fix, not yet built).
--
-- THE LEAK, restated structurally rather than by account (this repo and its
-- docs/ are PUBLIC — never commit open-vuln detail; the symptom lived in
-- that memory file, deleted once this migration's proof is green).
-- `lookup_email_by_username(p_username)` was a pure username→email oracle,
-- callable by anon, zero rate limit, zero password check. For the common
-- case (every account `registerWithPassword` ever created) its answer is
-- `<username>@samomdkku.app` — a NO-OP, since any caller can already
-- compute that string themselves (src/js/ticket-ids... the same formula
-- `usernameToEmail()` uses as the fallback when this RPC is unreachable).
-- But an account can also carry a REAL personal address here — either a
-- Google-origin sign-up that later set a username (0026 §1 "add/change a
-- verified email" on a password account reaches the exact same state) — and
-- for those, the RPC handed back NEW information nobody could already
-- derive: a real kkumail/gmail address, to anyone who merely guessed or
-- harvested a username.
--
-- THE FIX. Compare the resolved email against the synthetic form first:
-- equal → return it (unchanged behavior, still a no-op). Different → it is
-- a real address, so only release it to a caller who ALSO supplies the
-- correct password for that exact account (verified against
-- `auth.users.encrypted_password` via pgcrypto's `crypt()`, the same bcrypt
-- scheme GoTrue itself uses) — i.e. the same person GoTrue would have
-- authenticated one call later anyway. Wrong password or none supplied:
-- refused, identically to an unknown username, so this is not a NEW oracle
-- for "does this username exist" either.
--
-- WHY NOT GATE ON `users.method = 'password'` INSTEAD (the simpler-looking
-- fix). Rejected: 0026 explicitly lets a password-native account add a real
-- verified email too, and a Google-origin account can set a password from
-- the profile page (`setUsernameAndPassword`) — `method` records how the
-- account was BORN, not what it can sign in with today, so it cannot tell
-- apart "this address is derivable" from "this address is real". Comparing
-- against the actual synthetic string is the only check that asks the right
-- question.
--
-- WHY NOT MOVE THE WHOLE LOOKUP OFF-DATABASE (the other option the memory
-- names). A VM-side proxy would also close this, but it is a bigger,
-- riskier change (a new unauthenticated HTTP surface relaying into GoTrue's
-- password grant) for the exact same property this one function-level fix
-- already gets, and this agent cannot deploy VM code tonight regardless —
-- written here so it ships the moment the branch does.
--
-- RESIDUAL, NAMED RATHER THAN HIDDEN: this turns an oracle for "which email"
-- into a SECOND password-verification path alongside GoTrue's own
-- `signInWithPassword`, which may carry its own rate-limit/lockout this new
-- SQL path does not. The only account set this matters for is already the
-- rarer one (a real email on file), the check is a single bcrypt compare
-- (no slower than a normal login), and PostgREST's own connection pool
-- bounds how fast anon can hammer it — judged acceptable for this severity
-- (owner-labelled LOW) rather than building a lockout table nobody asked
-- for. Flagged for the owner in the private security report, not hidden.
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
