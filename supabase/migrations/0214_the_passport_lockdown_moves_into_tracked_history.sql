-- ============================================================
-- 0214 — the passport RLS lockdown moves from an untracked SQL-editor file
--        into tracked migration history.
--
-- ⛔ WRITTEN BY THE NIGHT AGENT, NOT APPLIED. No database access this run — the
-- owner's next session applies this to samo-dev first, then production. See
-- STATE.md and ~/samo-night/reports/2026-10-13-security-db.md for the full
-- audit this came out of.
--
-- WHAT THIS IS. `passport/db/0010_passport_authz_hardening.sql` and
-- `passport/db/0011_passport_rls_lockdown.sql` are NOT supabase migrations —
-- `passport/CLAUDE.md` has always said to run `passport/db/*.sql` by hand in
-- the Supabase SQL editor, a parallel track to this directory's CLI-applied
-- history. `docs/NEXT.md` §3 records db/0010+0011+0012 as APPLIED on
-- 2026-07-30 (tools/pass-anon-probe.mjs 9/9 against the live anon key).
--
-- WHY IT IS BEING PORTED ANYWAY, applied-or-not. This repo has already paid
-- once for exactly this shape: `passport.continents` lost its RLS during the
-- 2026-09 schema work and sat anon-writable for ~3 months before 0182 caught
-- it (docs/mistakes/authz-rls.md — "a schema move carries what is attached to
-- every object and drops what is written per object"). Nothing here PROVES
-- db/0010+0011 similarly reverted — but nothing DISPROVES it either:
-- `tools/pass-anon-probe.mjs`, the one proof that reads the LIVE committed
-- state rather than simulating inside a rolled-back transaction, is not
-- registered in `tools/run-proofs.mjs` and has no record of being re-run since
-- 2026-07-30. `tools/pass-hardening.mjs` (which IS registered, and green)
-- APPLIES the lockdown itself inside its own rolled-back transaction every
-- time, so its passing tells us the POLICIES ARE CORRECT, not that they are
-- ALREADY COMMITTED. Every statement below is a verbatim `drop policy if
-- exists` + `create policy` / `create or replace function`, so re-applying it
-- against an already-hardened database is a no-op — the only possible effect
-- of running this migration is to CLOSE the gap if it is open, and to put the
-- whole thing under `npm run migrate:status` from now on so a future schema
-- operation cannot silently drop it again without the usual drift check
-- noticing.
--
-- FIRST THING THE OWNER'S NEXT SESSION SHOULD DO, before applying this or
-- anything else: `node tools/pass-anon-probe.mjs` against production, to find
-- out which of the two states is actually true. That number determines
-- whether this migration is closing a live critical hole or tightening a
-- tracking gap — but the fix is identical either way, so it is written now
-- rather than waiting on an answer this session cannot get (no DB access).
--
-- `passport.is_admin()` is rebuilt to call `public.passport_admin_context()`
-- (samoweb migration 0087), the ทีม SAMO tree-resolved identity — NOT a
-- `passport.admins` table, which never existed in this schema. This is what
-- db/0010 itself already specified; nothing is reinterpreted here.
-- ============================================================

-- ── 1. admin identity (db/0010 §1) ──────────────────────────────────────
create or replace function passport.is_admin()
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((public.passport_admin_context() -> 'is_admin')::boolean, false);
$$;
revoke all on function passport.is_admin() from public;
grant execute on function passport.is_admin() to anon, authenticated;

create or replace function passport.admin_covers_dept(p_dept_id int, p_sub_dept_id int default null)
returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  v_ctx jsonb := public.passport_admin_context();
begin
  if not coalesce((v_ctx -> 'is_admin')::boolean, false) then return false; end if;
  if coalesce((v_ctx -> 'all_departments')::boolean, false) then return true; end if;

  if p_dept_id is not null
     and coalesce((v_ctx -> 'departments') @> to_jsonb(p_dept_id), false) then
    return true;
  end if;

  if p_sub_dept_id is not null then
    if coalesce((v_ctx -> 'sub_departments') @> to_jsonb(p_sub_dept_id), false) then
      return true;
    end if;
    if exists (
      select 1 from passport.sub_departments sd
       where sd.id = p_sub_dept_id
         and coalesce((v_ctx -> 'departments') @> to_jsonb(sd.department_id), false)
    ) then
      return true;
    end if;
  end if;

  return false;
end$$;
revoke all on function passport.admin_covers_dept(int, int) from public;
grant execute on function passport.admin_covers_dept(int, int) to anon, authenticated;

-- ── 2. profiles column guard (db/0010 §3) — total_km is server-managed ──
create or replace function passport.profiles_guard()
returns trigger
language plpgsql security definer set search_path = passport as $$
begin
  if pg_trigger_depth() > 1 then return new; end if;   -- server path (stamp_scan -> on_new_scan)
  if passport.is_admin() then return new; end if;
  if new.total_km is distinct from old.total_km then
    raise exception 'total_km is server-managed';
  end if;
  if new.tier_override is distinct from old.tier_override then
    raise exception 'tier_override is admin-managed';
  end if;
  if new.id is distinct from old.id then
    raise exception 'id is immutable';
  end if;
  return new;
end$$;

drop trigger if exists profiles_guard on passport.profiles;
create trigger profiles_guard before update on passport.profiles
  for each row execute function passport.profiles_guard();

-- ── 3. the two name/points projections (db/0010 §4 / §4b) ───────────────
create or replace function passport.admin_leaderboard(
  p_samo_year_id uuid default null,
  p_season_id    uuid default null,
  p_dept_id      int  default null,
  p_sub_dept_id  int  default null
)
returns table (user_id uuid, full_name text, email text, points bigint)
language plpgsql stable security definer set search_path = passport as $$
declare
  v_ctx jsonb := public.passport_admin_context();
begin
  if not coalesce((v_ctx -> 'is_admin')::boolean, false) then
    raise exception 'NOT_AUTHORIZED';
  end if;

  return query
  with in_scope as (
    select s.user_id, s.points_awarded
      from passport.scans s
     where (p_samo_year_id is null or s.samo_year_id = p_samo_year_id)
       and (p_season_id    is null or s.season_id    = p_season_id)
       and (p_dept_id      is null or s.department_id = p_dept_id)
       and (p_sub_dept_id  is null or s.sub_department_id = p_sub_dept_id)
       and passport.admin_covers_dept(s.department_id, s.sub_department_id)
  )
  select p.id,
         coalesce(p.full_name, '(unknown)')::text,
         p.email::text,
         sum(i.points_awarded)::bigint
    from in_scope i
    join passport.profiles p on p.id = i.user_id
   group by p.id, p.full_name, p.email
   order by 4 desc, 2 asc;
end$$;
revoke all on function passport.admin_leaderboard(uuid, uuid, int, int) from public;
revoke all on function passport.admin_leaderboard(uuid, uuid, int, int) from anon;
grant execute on function passport.admin_leaderboard(uuid, uuid, int, int) to authenticated;

create or replace function passport.leaderboard_names()
returns table (id uuid, full_name text)
language sql stable security definer set search_path = passport as $$
  select p.id, p.full_name
    from passport.profiles p
   where auth.uid() is not null
     and exists (select 1 from passport.scans s where s.user_id = p.id);
$$;
revoke all on function passport.leaderboard_names() from public;
revoke all on function passport.leaderboard_names() from anon;
grant execute on function passport.leaderboard_names() to authenticated;

-- ── 4. user_tiers must respect the caller's RLS (db/0010 §5) ────────────
alter view passport.user_tiers set (security_invoker = on);

-- ── 5. the lockdown itself (db/0011) ─────────────────────────────────────

-- scans: reads stay public, writes close. stamp_scan() is SECURITY DEFINER
-- and so unaffected by having no INSERT policy at all.
drop policy if exists scans_insert on passport.scans;

drop policy if exists scans_delete on passport.scans;
create policy scans_delete on passport.scans for delete to public
  using (passport.is_admin() or (auth.uid() is not null and user_id = auth.uid()));

drop policy if exists scans_update on passport.scans;
create policy scans_update on passport.scans for update to public
  using (passport.is_admin()) with check (passport.is_admin());

-- profiles: own row + admin; email stops being world-readable.
drop policy if exists profiles_read_all on passport.profiles;
drop policy if exists profiles_read_self_or_admin on passport.profiles;
create policy profiles_read_self_or_admin on passport.profiles for select to public
  using ((auth.uid() is not null and id = auth.uid()) or passport.is_admin());

drop policy if exists profiles_update_own on passport.profiles;
create policy profiles_update_own on passport.profiles for update to public
  using (auth.uid() is not null and auth.uid() = id)
  with check (auth.uid() is not null and auth.uid() = id);
drop policy if exists profiles_update_admin on passport.profiles;
create policy profiles_update_admin on passport.profiles for update to public
  using (passport.is_admin()) with check (passport.is_admin());

drop policy if exists profiles_insert_own on passport.profiles;
create policy profiles_insert_own on passport.profiles for insert to authenticated
  with check (auth.uid() is not null and auth.uid() = id);

-- catalog / seasons / certificates / season_results: reads stay public
-- (the scan page resolves an activity before sign-in; badges/certs are public
-- assets), writes become admin-only.
do $$
declare t text;
begin
  foreach t in array array['activities','samo_years','samo_seasons','seasons',
                           'certificates','season_results']
  loop
    execute format('drop policy if exists %I_insert on passport.%I', t, t);
    execute format('drop policy if exists %I_update on passport.%I', t, t);
    execute format('drop policy if exists %I_delete on passport.%I', t, t);
    execute format(
      'create policy %I_insert on passport.%I for insert to public
         with check (passport.is_admin())', t, t);
    execute format(
      'create policy %I_update on passport.%I for update to public
         using (passport.is_admin()) with check (passport.is_admin())', t, t);
    execute format(
      'create policy %I_delete on passport.%I for delete to public
         using (passport.is_admin())', t, t);
  end loop;
end $$;

-- season_results carries name + email; narrow its read the same way profiles
-- was narrowed.
drop policy if exists season_results_read on passport.season_results;
create policy season_results_read on passport.season_results for select to public
  using ((auth.uid() is not null and user_id = auth.uid()) or passport.is_admin());

-- account_migrations: read stays public (getPassportAccess needs it before
-- the user is fully resolved), writes close.
drop policy if exists account_migrations_insert on passport.account_migrations;
create policy account_migrations_insert on passport.account_migrations
  for insert to public with check (passport.is_admin());
drop policy if exists account_migrations_update on passport.account_migrations;
create policy account_migrations_update on passport.account_migrations
  for update to public using (passport.is_admin()) with check (passport.is_admin());
drop policy if exists account_migrations_delete on passport.account_migrations;
create policy account_migrations_delete on passport.account_migrations
  for delete to public using (passport.is_admin());

-- ── 6. deliberately NOT touched here, same as db/0011 §5 ────────────────
-- * continents / departments / sub_departments: already handled (0182,
--   plus RLS-on-no-policy by design for the latter two).
-- * activities.static_token stays anon-readable — a known, tracked,
--   low-severity follow-up (docs/NEXT.md §3 follow-up 1), not this migration.
-- * per-ฝ่าย WRITE scoping (a dept-scoped admin writing another dept's
--   activity) stays unenforced — docs/NEXT.md §3 follow-up 2, a real feature,
--   not a lockdown gap: is_admin() is "any admin at all", which is what every
--   one of the policies above asks, matching db/0011 exactly.
