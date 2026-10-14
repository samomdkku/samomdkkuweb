-- ============================================================
-- 0218 — a signed-in caller with no `users` row is NOBODY, not everybody.
--
-- FOUND BY house0217's DENY half (2026-10-13): a signed-in stranger — a JWT
-- whose `sub` has no public.users row — passed `set_unresolved_follow_up` and
-- `reopen_unresolved_row`. The gate, copied from every ระบบบ้าน RPC since 0188:
--
--     if not (current_user_role() = any (array['vp_admin','dev'])
--             or current_user_has_permission('house')) then raise …
--
-- `current_user_role()` is NULL for that caller, `NULL = any(...)` is NULL,
-- `NULL or false` is NULL, `not NULL` is NULL, and `if NULL` does NOT raise.
-- The check fails OPEN. 0045 found exactly this in 2026 and fixed the two
-- functions in front of it; twelve newer ones were written in the old shape
-- (dismiss/promote/list/record_unresolved_rows, ensure_sais, the help-request
-- and identity-check readers, lookup_student_by_kkumail, search_people,
-- set_academic_year) — `.claude/rules/mistakes.md` class 2.
--
-- NOT exploitable on 2026-10-13, measured: users.role is NOT NULL default
-- 'user', `on_auth_user_created` gives every auth user a row, and 0 auth users
-- lack one. It takes an auth user whose users row is gone — which a careless
-- account cleanup is enough to produce.
--
-- FIXED AT THE SOURCE rather than at twelve call sites, because twelve call
-- sites is how it came back: the role is '' when there is none. Measured
-- before changing it — no function, policy or view on production negates the
-- role or tests it for NULL outside these gates, and the nine that already
-- wrap it do so as `coalesce(<comparison>, false)`, which '' leaves unchanged.
-- The sweep in tools/authz0218-null-role.sql calls every gated function as a
-- stranger, so a thirteenth written in the old shape is caught too.
-- ============================================================
create or replace function public.current_user_role()
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select role from public.users where id = auth.uid()), '')
$$;
