-- ============================================================
-- 0256 — แลก Rotation: admin (ผู้ดูแล) restricted to NAMED accounts only.
--
-- REQUESTED (owner, 2026-10-24): "only make me the admin ผู้ดูแล of the
-- ระบบแลก rotate" — someone other than the owner gained admin through the
-- `master` permission in the ทีม SAMO tree, which
-- `current_user_has_permission('rotation')` answered yes to (0111: master
-- answers yes to EVERY permission). The owner observed unauthorised
-- ผู้ดูแลย้าย moves on students and wants the gate locked to named accounts.
--
-- Same design as 0254 (rotation_gpa_viewers): a hand-curated table of
-- auth accounts, not a permission. A permission would fold into master via
-- current_user_has_permission (0111), which is exactly the leak this fixes.
--
--   rotation_admins   user_id → auth account. RLS on, NO policy, no grant:
--                     nobody reads or writes it through the API. Rows are
--                     added by hand in SQL:
--     insert into public.rotation_admins (user_id, note)
--     select id, 'owner' from public.users where lower(btrim(email)) = '<kkumail>';
--
-- rotation_is_admin() is redefined to check this table instead of the
-- `rotation` permission. `dev` role is KEPT as a fallback so the owner
-- (who holds dev) still passes, and so a developer can debug.
--
-- ⚠️ This deliberately breaks anyone who was rotation-admin only through
-- `master` or the `rotation` permission. That is the point.
-- ============================================================

-- §1 — the named-admin table.
create table if not exists public.rotation_admins (
  user_id  uuid primary key references auth.users (id) on delete cascade,
  note     text,
  added_at timestamptz not null default now()
);
alter table public.rotation_admins enable row level security;
revoke all on public.rotation_admins from public, anon, authenticated;

comment on table public.rotation_admins is
  'Accounts that are ผู้ดูแล of the rotation swap system. Owner-curated by SQL; '
  'deliberately not a permission (master would inherit it — 0111). No API policy: '
  'unreadable and unwritable through PostgREST. Added by 0256.';

-- §2 — seed the owner's account.
insert into public.rotation_admins (user_id, note)
select id, 'owner (0256)'
  from public.users
 where lower(btrim(email)) = 'phuriphat.ma@kkumail.com'
on conflict (user_id) do nothing;

-- §3 — redefine rotation_is_admin().
-- BEFORE: role dev OR current_user_has_permission('rotation').
-- AFTER:  role dev OR named in rotation_admins.
-- The `rotation` permission key is now DEAD for access-control purposes.
create or replace function public.rotation_is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select public.current_user_role() = 'dev'
      or (auth.uid() is not null
          and exists (select 1 from public.rotation_admins a where a.user_id = auth.uid()));
$$;

comment on function public.rotation_is_admin() is
  'True for role dev or a named entry in rotation_admins (0256). '
  'Deliberately does NOT use current_user_has_permission — master '
  'answers yes to every permission (0111), and the owner restricted '
  'rotation admin to named accounts only.';
