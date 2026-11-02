# Reset a forgotten password on a USERNAME account

A username account's address is the synthetic `<username>@samomdkku.app`
(`src/js/auth.js`). It cannot receive mail, so Supabase's reset email cannot
exist for it, and the portal has no reset screen (HANDOFF §38 — the gap and the
owed decision). Until that is built, this is the procedure. First run:
2026-11-02, one shop buyer.

⛔ **A production write to `auth.users`. Ask the owner first** (memory: ask
before prod while users are active), and only after step 1.

## 1. Identity first — a person, not the agent

"I forgot my password, please reset it" is the classic takeover request. The
OWNER (or a shop/ฝ่าย admin who knows the person) confirms it is them from
details only they hold: the order number, the phone on the order, what they
ordered. The agent never decides this.

Check whether they even need it: if any device is still signed in, they can
set a new password at **/me** themselves — nothing to do on our side.

## 2. Look the account up — read-only, no names in files you keep

```sql
select u.id, u.username, u.method, au.email, au.last_sign_in_at,
       au.raw_app_meta_data->'providers' providers
  from public.users u join auth.users au on au.id = u.id
 where lower(u.username) = lower('<username>');
```

Write query files to the session scratchpad, never `tools/` or `docs/` (both
repos are PUBLIC) — and delete them after. (2026-11-02: another agent left 12
such files holding several people's emails and phones; they had to be found
and removed.)

## 3. Snapshot, then set a one-time password

Save `id, encrypted_password` to the scratchpad first (undo = write it back).
Generate a random password into a `umask 077` scratchpad file (not typed in
chat by hand), then, by `id` AND `email` together:

```sql
with u as (
  update auth.users
     set encrypted_password = extensions.crypt('<pw>', extensions.gen_salt('bf', 10)),
         updated_at = now()
   where id = '<id>' and email = '<username>@samomdkku.app'
  returning encrypted_password)
select count(*) n, bool_and(encrypted_password = extensions.crypt('<pw>', encrypted_password)) matches from u;
```

Want `n = 1, matches = true`. pgcrypto lives in `extensions`; the
`on_auth_user_password_sync_update` trigger keeps `public.users.has_password`
in step on its own.

## 4. Verify from the authority, then clean up

Sign in through GoTrue itself (`POST /auth/v1/token?grant_type=password` with
the anon key, `→ 200`), then `POST /auth/v1/logout?scope=local` with that
token (`→ 204`) so the test leaves no session. ⚠️ This moves
`last_sign_in_at` to now — read that value BEFORE if it matters.
Delete the plaintext file.

## 5. Hand over

The owner sends the username + one-time password PRIVATELY. The person, at
/me: changes the password, then links Google — that link is their way back
next time. Never create a second account: orders and placements stay on the
first.
