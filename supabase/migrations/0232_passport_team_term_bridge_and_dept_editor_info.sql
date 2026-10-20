-- ============================================================
-- 0232 — two small, UNRELATED additions, both task 10 of the 2026-10-18
--        night queue, both deliberately NOT a new year/archival model:
--
--   A. Passport: a loose bridge from passport.samo_years to the SAME
--      SAMO year every other system now stamps (public.team_terms) — see
--      docs/YEAR-ROLLOVER.md § Passport. Passport keeps its OWN year/season
--      tables (rejected: folding them into team_terms — Passport lives in
--      an isolated schema on purpose, see the passport-security-hardening
--      memory) and already has everything else the design doc asked for
--      built: `startNewYear()` opens-before-closes (admin-page.js:1542-1565,
--      no gap — the SAME invariant docs/INVARIANTS.md states), the student
--      AND admin leaderboards already take a year selector
--      (dashboard.js's `lb-year-select`, admin-page.js's `#lb-year`), and the
--      flight log already browses any past year (`fl-year-select`). The ONE
--      thing missing is this column.
--
--   B. หน้าฝ่าย: a read helper so the editor can show "แก้ไขล่าสุดโดย … เมื่อ
--      …" (docs/YEAR-ROLLOVER.md § หน้าฝ่าย — explicitly UI-only, no year
--      column, no versioning table: a ฝ่าย page is a living document, not a
--      ticket). `dept_content.updated_at`/`updated_by` already exist
--      (0177's touch trigger) — what is missing is a way for an editor who
--      holds ONLY a dept_page grant (not team/team_edit/house) to resolve
--      another editor's uuid into a name, since `public.people`/`users` are
--      not readable to that caller (0132/0147). A SECURITY DEFINER function
--      is the standard shape for "let me see ONE fact I'm not otherwise
--      allowed to read directly" in this codebase (e.g. `search_people`,
--      0137) — it is not the versioning table the design doc rejected.
-- ============================================================

-- ------------------------------------------------------------
-- A. passport.samo_years.team_term_year — nullable, NO FK.
--
-- Same "reference data with a DELETE is fail-open" caution as team_majors:
-- a hard FK across the public/passport schema boundary does not exist
-- anywhere in this codebase (deliberately — see the passport-security-
-- hardening memory on why the isolation is load-bearing), and a year
-- number that no longer resolves to a team_terms row must not block or
-- cascade-delete a Passport year that students' real km/scans hang off of.
-- Set BY HAND by whoever opens a new Passport year (the admin UI prompt
-- added below), never derived automatically — Passport's year boundary
-- (QR posters, badges) is decided by ฝ่าย กิจกรรม on their own calendar, not
-- by a ทีม SAMO handover, so the two will not always move together.
-- ------------------------------------------------------------
alter table passport.samo_years
  add column if not exists team_term_year integer;

comment on column passport.samo_years.team_term_year is
  'Loose reference to public.team_terms.year (พ.ศ.) — which ทีม SAMO term was in office when this Passport year opened. NO FK (cross-schema FKs do not exist in this codebase on purpose; see the passport-security-hardening memory) and set BY HAND when an admin starts a new Passport year — a future report can JOIN on it, nothing enforces it. See migration 0232.';

-- No RLS change: this is a plain column on an existing row-secured table: the
-- read policies are row-level, not column-level, and the write path is the
-- same shared-admin-account insert startNewYear() already uses.

-- ------------------------------------------------------------
-- B. dept_content_editor_info(p_dept) — "who last touched this ฝ่าย's page,
--    and when", for the editor UI only (never the public page).
--
-- Gated with the EXACT SAME predicate dept_content's own RLS policies use
-- (public.current_user_dept_page_scope(), 0177) — this function sees no row
-- its caller could not already SELECT directly, it only resolves the ONE
-- extra fact (the editor's name) that RLS on `people`/`users` would
-- otherwise hide from a caller who holds nothing but a dept_page grant.
-- ------------------------------------------------------------
create or replace function public.dept_content_editor_info(p_dept text)
returns table(id uuid, updated_at timestamptz, editor_name text)
language plpgsql
stable security definer set search_path = public
as $$
begin
  if not (
    public.current_user_dept_page_scope() is null
    or p_dept = any(public.current_user_dept_page_scope())
  ) then
    raise exception 'dept_content_editor_info: not an editor of %', p_dept using errcode = '42501';
  end if;

  return query
    select dc.id, dc.updated_at,
           coalesce(p.full_name, u.display_name, u.username, 'ไม่ทราบ') as editor_name
      from public.dept_content dc
      left join public.users u on u.id = dc.updated_by
      left join public.people p on p.user_id = dc.updated_by
     where dc.dept = p_dept;
end;
$$;

revoke all on function public.dept_content_editor_info(text) from public, anon;
grant execute on function public.dept_content_editor_info(text) to authenticated;

comment on function public.dept_content_editor_info(text) is
  'Per-row "last edited by, when" for one ฝ่าย''s dept_content, for the EDITOR UI only. Gated identically to dept_content''s own RLS (current_user_dept_page_scope) — resolves updated_by to a name without widening what the caller could otherwise read. See migration 0232.';

-- ------------------------------------------------------------
-- C. account_dashboard(p_samo_year) — the design doc's "gains an OPTIONAL
--    samo_year_be filter on its PR/VS/Shop/Projects activity joins" (§
--    Accounts). 0211's body had NO per-account activity counts at all yet
--    (only team posting / house placement / discord link / passport) — this
--    ADDS that piece (additive, no column removed, old no-arg callers get
--    p_samo_year_be = null = unscoped, same shape as every other
--    "year is a filter" RPC in this queue, e.g. shop_order_totals).
-- ------------------------------------------------------------
-- Drop the old zero-arg signature FIRST: a new overload with one default
-- parameter can be called with zero arguments too, and Postgres would raise
-- "function account_dashboard() is not unique" at call time if both existed.
-- PostgREST's `rpc('account_dashboard')` with no body resolves fine against
-- the single surviving (integer default null) signature below.
drop function if exists public.account_dashboard();

create or replace function public.account_dashboard(p_samo_year_be integer default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if auth.uid() is null or not public.current_user_has_permission('master') then
    raise exception 'ไม่มีสิทธิ์ดูบัญชีผู้ใช้ทั้งหมด' using errcode = '42501';
  end if;

  with ident as (
    select user_id, array_agg(distinct provider order by provider) pv
      from auth.identities group by user_id
  ), scans as (
    select user_id, count(*) n, max(scanned_at) last
      from passport.scans group by user_id
  ), acc as (
    select a.id, nullif(lower(btrim(a.email)), '') k, a.email, a.created_at, a.last_sign_in_at,
           a.email_confirmed_at, a.banned_until, a.deleted_at,
           a.raw_app_meta_data->>'provider' provider,
           coalesce(a.encrypted_password, '') <> '' pw,
           coalesce(i.pv, '{}') pv
      from auth.users a left join ident i on i.user_id = a.id
  ), ppl as (
    select distinct on (lower(btrim(kkumail))) lower(btrim(kkumail)) k, p.*
      from public.people p
     where nullif(btrim(kkumail), '') is not null
     order by lower(btrim(kkumail)), created_at
  ), ap as (
    select acc.id aid, acc.k, ppl.id pid from acc left join ppl on ppl.k = acc.k
  ), team_hits as (
    select ap.aid, t.id tid from ap join public.team_members t on t.person_id = ap.pid
    union select ap.aid, t.id from ap join public.team_members t on lower(btrim(t.kkumail)) = ap.k
    union select ap.aid, t.id from ap join public.team_members t on t.user_id = ap.aid
  ), team_acc as (
    select h.aid, jsonb_agg(coalesce(nullif(btrim(nd.name), ''), 'ทีม SAMO') order by nd.name) pos
      from team_hits h join public.team_members t on t.id = h.tid
      left join public.team_nodes nd on nd.id = t.node_id
     group by h.aid
  ), house_hits as (
    select ap.aid, s.id sid from ap join public.students s on s.person_id = ap.pid
    union select ap.aid, s.id from ap join public.students s on lower(btrim(s.kkumail)) = ap.k
  ), house_acc as (
    select h.aid, min(s.sai_code) sai
      from house_hits h join public.students s on s.id = h.sid group by h.aid
  ), disc as (
    select distinct person_id from public.discord_links
  ), acc_keys as (
    select distinct k from acc where k is not null
  -- ── activity counts, OPTIONALLY scoped to p_samo_year_be (0232) ────────
  ), pr_counts as (
    select submitter_id aid, count(*) n from public.pr_tickets
     where deleted_at is null and (p_samo_year_be is null or samo_year_be = p_samo_year_be)
     group by submitter_id
  ), vs_counts as (
    select submitter_id aid, count(*) n from public.vs_tickets
     where deleted_at is null and (p_samo_year_be is null or samo_year_be = p_samo_year_be)
     group by submitter_id
  ), shop_counts as (
    select buyer_id aid, count(*) n from public.shop_orders
     where (p_samo_year_be is null or samo_year_be = p_samo_year_be)
     group by buyer_id
  ), proj_counts as (
    select created_by aid, count(*) n from public.projects
     where (p_samo_year_be is null or samo_year_be = p_samo_year_be)
     group by created_by
  )
  select jsonb_build_object(
    'now', now(),
    'samo_year_be', p_samo_year_be,
    'accounts', coalesce((
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'id', acc.id, 'e', acc.email, 'u', u.username, 'n', u.display_name,
        'c', acc.created_at, 's', acc.last_sign_in_at,
        'cf', acc.email_confirmed_at is not null,
        'b', coalesce(acc.banned_until > now(), false),
        'del', acc.deleted_at is not null,
        'pr', acc.provider, 'pv', to_jsonb(acc.pv), 'pw', acc.pw,
        'm', u.method, 'hp', u.has_password, 'nou', u.id is null,
        'pm', nullif(to_jsonb(coalesce(u.permissions, '{}')), '[]'::jsonb),
        'mp', nullif(to_jsonb(coalesce(u.managed_permissions, '{}')), '[]'::jsonb),
        'emd', u.id is not null and nullif(lower(btrim(coalesce(u.email, ''))), '') is distinct from acc.k,
        'p', case when p.id is not null then jsonb_strip_nulls(jsonb_build_object(
               'id', p.id, 'n', p.full_name, 'nk', p.nickname, 'sid', p.student_id,
               'co', p.cohort_year, 'mj', p.major,
               'ok', p.identity_confirmed_at is not null)) end,
        'lc', p.user_id is not null and p.user_id <> acc.id,
        't', ta.pos,
        'h', ha.sai, 'hs', ha.aid is not null,
        'd', dl.person_id is not null,
        'pp', case when pp.id is not null then jsonb_strip_nulls(jsonb_build_object(
                'km', pp.total_km, 'sc', coalesce(sc.n, 0), 'ls', sc.last,
                'emd', nullif(lower(btrim(coalesce(pp.email, ''))), '') is distinct from acc.k)) end,
        'act', jsonb_build_object(
                'pr', coalesce(prc.n, 0), 'vs', coalesce(vsc.n, 0),
                'shop', coalesce(shc.n, 0), 'proj', coalesce(pjc.n, 0))
      )) order by acc.created_at)
        from acc
        left join public.users u on u.id = acc.id
        left join ppl p on p.k = acc.k
        left join team_acc ta on ta.aid = acc.id
        left join house_acc ha on ha.aid = acc.id
        left join disc dl on dl.person_id = p.id
        left join passport.profiles pp on pp.id = acc.id
        left join scans sc on sc.user_id = acc.id
        left join pr_counts prc on prc.aid = acc.id
        left join vs_counts vsc on vsc.aid = acc.id
        left join shop_counts shc on shc.aid = acc.id
        left join proj_counts pjc on pjc.aid = acc.id
    ), '[]'::jsonb),
    'passport_orphans', coalesce((
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
               'e', pp.email, 'n', pp.full_name, 'km', pp.total_km,
               'sc', coalesce(sc.n, 0), 'ls', sc.last)) order by pp.total_km desc nulls last)
        from passport.profiles pp
        left join scans sc on sc.user_id = pp.id
        left join auth.users a on a.id = pp.id
       where a.id is null
    ), '[]'::jsonb),
    'migrations', coalesce((
      select jsonb_agg(jsonb_build_object(
               'from', m.from_email, 'to', m.to_email, 'at', m.moved_at,
               'from_exists', exists (select 1 from acc_keys x where x.k = lower(btrim(m.from_email))),
               'to_exists',   exists (select 1 from acc_keys x where x.k = lower(btrim(m.to_email))))
             order by m.moved_at)
        from passport.account_migrations m
    ), '[]'::jsonb),
    'roster', coalesce((
      select jsonb_agg(jsonb_build_object('co', co, 'n', n, 'acc', acc_n) order by co nulls last)
        from (select p.cohort_year co, count(*) n, count(x.k) acc_n
                from public.people p
                left join acc_keys x on x.k = nullif(lower(btrim(p.kkumail)), '')
               group by p.cohort_year) r
    ), '[]'::jsonb)
  ) into v;
  return v;
end $$;

revoke all on function public.account_dashboard(integer) from public, anon;
grant execute on function public.account_dashboard(integer) to authenticated;

comment on function public.account_dashboard(integer) is
  'Staff-only (master) read of every account. p_samo_year_be (0232, default null = unscoped) additionally reports each account''s PR/VS/Shop/Projects activity COUNT filed under that year — additive to 0211''s original payload, which had no per-account activity counts at all.';
