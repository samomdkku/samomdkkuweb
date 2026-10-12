-- ============================================================
-- 0211 — บัญชีผู้ใช้: one dashboard over every account, for `master`
--
-- ASKED (owner, 2026-10-12): "the holy account management dashboard on admin
-- tab to see all accounts on database, what were register with username
-- password, what were with google account, what were gmail, kkumail, kkuacth,
-- … what were also in samopassport … update real time … screen for anomaly or
-- bugs".
--
-- SHAPE
--   • account_dashboard() — ONE read, SECURITY DEFINER, `master` only. It
--     returns one compact row per auth.users account joined to everything that
--     hangs off it (public.users, people by kkumail the way my_person_id() does,
--     ทีม SAMO postings, ระบบบ้าน, Discord link, Passport profile + scans), and
--     the sets that have NO account (passport profiles, people per รุ่น).
--     No table grant changes: auth.users stays unreadable to every client role.
--   • account_dashboard_pulse() — a cheap fingerprint of the same sources. The
--     page polls it and re-reads the dashboard only when it changes; that is
--     what "real time" means here (auth.users has no realtime feed, and
--     public.users is self-only under RLS since 0147, so a realtime channel on
--     it would deliver nothing about anyone else).
--   • WHY `master` and not a new key: the payload maps every account's email to
--     what it holds — exactly the map 0147 took away from a full read of
--     public.users. `master` already edits everyone's grants in ทีม SAMO, so it
--     learns nothing new about grants here; a new key would be a NEW channel to
--     thread through every gate (mistakes class 5) for no narrower audience.
--
-- BUG FIXED ALONG THE WAY — public.users.method was 'password' for ~687
-- Google-only accounts. handle_new_auth_user() read the method from
-- raw_USER_meta_data, which an OAuth sign-up never sets, so it defaulted to
-- 'password'; auth.js then preferred that stored value over the real provider,
-- and the account switcher sent a Google account with an expired session to
-- the password form (and labelled it "รหัสผ่าน"). Fixed three ways: the
-- trigger reads raw_APP_meta_data.provider, existing rows are back-filled from
-- it, and auth.js asks auth first. The dashboard's "method drift" check is the
-- guard that it stays fixed.
-- ============================================================

-- ── 1. back-fill users.method from the provider auth actually recorded ─────
-- users_self_update_guard raises on a method change by a non-staff caller,
-- and a migration has no auth.uid() — so it is bypassed for this one
-- statement only, inside this transaction.
alter table public.users disable trigger users_self_update_guard;
update public.users u
   set method = case when a.raw_app_meta_data->>'provider' = 'google' then 'google' else 'password' end
  from auth.users a
 where a.id = u.id
   and u.method is distinct from
       (case when a.raw_app_meta_data->>'provider' = 'google' then 'google' else 'password' end);
alter table public.users enable trigger users_self_update_guard;

-- ── 2. the signup trigger: same body as live (0042), one expression changed ─
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_display text := coalesce(
    new.raw_user_meta_data->>'display_name',
    new.raw_user_meta_data->>'name',
    new.raw_user_meta_data->>'username',
    split_part(new.email, '@', 1)
  );
  -- 0211: an OAuth sign-up carries its provider in raw_APP_meta_data and never
  -- sets raw_user_meta_data.method, so the old default made every Google
  -- account 'password'.
  v_method text := coalesce(
    new.raw_user_meta_data->>'method',
    case when new.raw_app_meta_data->>'provider' = 'google' then 'google' end,
    'password'
  );
begin
  insert into public.users (id, email, username, display_name, method)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'username', null),
    v_display,
    v_method
  )
  on conflict (id) do nothing;
  return new;
exception
  when unique_violation then
    -- An existing row already claims this email or username. Keep the
    -- signup alive: create the profile row without the conflicting
    -- natural keys (id is the PK and is unique for a brand-new user).
    begin
      insert into public.users (id, display_name, method)
      values (new.id, v_display, v_method)
      on conflict (id) do nothing;
    exception when others then
      raise warning 'handle_new_auth_user: fallback insert failed for %: %', new.id, sqlerrm;
    end;
    return new;
  when others then
    -- Never let an unexpected profile-row error abort auth signup.
    raise warning 'handle_new_auth_user: profile insert failed for %: %', new.id, sqlerrm;
    return new;
end;
$$;

-- ── 3. the dashboard read ──────────────────────────────────────────────────
-- Every link is an EQUI-join on a key computed once (ap / ppl), so Postgres
-- can hash it. A lateral per account with `lower(btrim(x)) = k OR …` cannot
-- use an index or a hash, and took 6.5 s on 756 accounts.
create or replace function public.account_dashboard()
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
    -- one person per kkumail, the way my_person_id() picks one
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
  )
  select jsonb_build_object(
    'now', now(),
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
                'emd', nullif(lower(btrim(coalesce(pp.email, ''))), '') is distinct from acc.k)) end
      )) order by acc.created_at)
        from acc
        left join public.users u on u.id = acc.id
        left join ppl p on p.k = acc.k
        left join team_acc ta on ta.aid = acc.id
        left join house_acc ha on ha.aid = acc.id
        left join disc dl on dl.person_id = p.id
        left join passport.profiles pp on pp.id = acc.id
        left join scans sc on sc.user_id = acc.id
    ), '[]'::jsonb),
    -- Carried passport profiles with no account (re-keyed to the account by
    -- passport_link_user_by_email when its owner signs in — EXPECTED, see
    -- docs/INVARIANTS.md "Passport totals").
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
    -- The registry per รุ่น, and how many of them have an account (matched by
    -- kkumail, the way my_person_id() matches).
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

-- ── 4. the pulse: changes whenever anything the dashboard shows changes ────
create or replace function public.account_dashboard_pulse()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.current_user_has_permission('master') then
    raise exception 'ไม่มีสิทธิ์ดูบัญชีผู้ใช้ทั้งหมด' using errcode = '42501';
  end if;
  return jsonb_build_object('now', now(), 'v', md5(concat_ws('|',
    (select count(*) || '/' || max(created_at) || '/' || max(last_sign_in_at) || '/' || max(updated_at) from auth.users),
    (select count(*) || '/' || max(updated_at) from auth.identities),
    (select md5(string_agg(concat_ws(',', id, display_name, username, method, has_password,
                                     permissions::text, managed_permissions::text), ';' order by id))
       from public.users),
    (select count(*) || '/' || max(updated_at) from public.people),
    (select count(*) || '/' || max(updated_at) from public.team_members),
    (select count(*) || '/' || max(updated_at) from public.students),
    (select count(*) || '/' || max(updated_at) from public.discord_links),
    (select count(*) || '/' || max(updated_at) from passport.profiles),
    (select count(*) || '/' || max(scanned_at) from passport.scans),
    (select count(*) || '/' || max(moved_at) from passport.account_migrations))));
end $$;

revoke all on function public.account_dashboard() from public, anon;
revoke all on function public.account_dashboard_pulse() from public, anon;
grant execute on function public.account_dashboard() to authenticated;
grant execute on function public.account_dashboard_pulse() to authenticated;
