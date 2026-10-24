-- ============================================================
-- 0250 — แลก Rotation: ปี 6 students swap their rotation group (A–F) with
-- each other, and everyone in the cohort watches it happen live.
--
-- REQUESTED (owner, 2026-10-24) from the faculty's PDF "ตาราง Rotation ปี 6
-- Block 1 ปีการศึกษา 2570 (แจ้งนศ. 24-10-69)": 161 students in six groups, each
-- group following the same six 8-week blocks in a different order. A student
-- may swap groups with another student when:
--   1. same gender                                   — ENFORCED
--   2. similar GPA band (2.55–2.99 / 3.00–3.49 / 3.50–4.00)
--                                                    — COLLECTED, NOT ENFORCED
--      The owner is waiting for the faculty's answer ("may a 3.0 swap with a
--      2.8?"). `rotation_rounds.gpa_rule` is the switch; turning it on is ONE
--      update, and `rotation_pair_allowed()` is the ONE home of the rule.
--
-- THE SHAPE
--   rotation_rounds    one row per timetable (this one: 'y6-2570'). `published`
--                      = students can see the page; `swaps_open` = they can
--                      request/accept. Both start FALSE: an admin opens it.
--   rotation_students  the roster, from the PDF, matched to public.people by
--                      รหัสนักศึกษา (tools/rotation-import.mjs — the names are
--                      NOT in this file: the repo is public).
--   rotation_requests  "I (in group X) want to swap into group Y" — either with
--                      one named person (target_id) or with ANYONE eligible in
--                      Y (target_id null, a "broadcast").
--   rotation_moves     every change of group, one row per student moved. The
--                      history everyone can read.
--   rotation_events    one row per change, NO content. It exists only so
--                      Supabase Realtime has something RLS-safe to push; the
--                      page re-reads the board when one arrives.
--
-- ⛔ NO TABLE IS READABLE DIRECTLY by a student (except the content-free
-- events). Every read goes through `rotation_board()`, a definer function that
-- NAMES what it returns, because `gpa` is on the roster row and a GPA is a
-- private number: the student sees their own, an admin sees all, nobody else
-- sees any. Authorization is per-PATH (mistakes.md class 4) — a `select=*`
-- policy on rotation_students would publish 161 GPAs.
--
-- ⛔ EVERY WRITE TAKES ONE LOCK PER ROUND (`pg_advisory_xact_lock`). A swap
-- touches two students, its own request and every OTHER pending request of
-- both people; with row locks, two accepts in flight lock those in opposite
-- orders and deadlock. The cohort is 161 people — serialising its writes costs
-- nothing and makes "two people accept the same broadcast at once" a plain
-- sequence: the second one finds the request already taken. After the lock,
-- every statement re-reads committed state (READ COMMITTED), so the checks
-- below see the first swap's result.
--
-- ⛔ `create table` INHERITS anon's default grant (pg_default_acl, class 6,
-- 0188): every table below revokes from anon/public/authenticated explicitly.
-- Every function revokes EXECUTE from public/anon (Supabase's default ACL
-- grants anon, 0226).
--
-- Proof: tools/rotation0250-swaps.sql. Design + how to extend:
-- docs/ROTATION-SWAP.md.
-- ============================================================

-- ── tables ──────────────────────────────────────────────────────────────────

create table if not exists public.rotation_rounds (
  id            text primary key check (id ~ '^[a-z0-9-]{3,40}$'),
  title         text not null,
  groups        text[] not null default array['A','B','C','D','E','F'],
  published     boolean not null default false,
  swaps_open    boolean not null default false,
  swaps_close_at timestamptz,
  gpa_rule      text not null default 'off' check (gpa_rule in ('off', 'same_band')),
  max_pending   int not null default 15 check (max_pending between 1 and 100),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
comment on table public.rotation_rounds is
  'One rotation timetable whose groups students may swap (0250). published = the '
  'cohort can see /rotation; swaps_open (+ swaps_close_at) = they can request and '
  'accept. gpa_rule is the switch for criterion 2 — the rule itself lives ONLY in '
  'rotation_pair_allowed().';

create table if not exists public.rotation_students (
  id             uuid primary key default gen_random_uuid(),
  round_id       text not null references public.rotation_rounds(id) on delete cascade,
  student_id     text not null check (student_id ~ '^[0-9]{9}-[0-9]$'),
  prefix         text not null,
  first_name     text not null,
  last_name      text not null,
  -- The PDF's spelling, kept as evidence when it differs from the registry's.
  source_name    text,
  gender         text not null check (gender in ('M', 'F')),
  original_group text not null check (original_group ~ '^[A-Z]$'),
  current_group  text not null check (current_group ~ '^[A-Z]$'),
  kkumail        text,
  person_id      uuid references public.people(id) on delete set null,
  gpa            numeric(3,2) check (gpa is null or (gpa >= 0 and gpa <= 4)),
  gpa_updated_at timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (round_id, student_id)
);
create unique index if not exists rotation_students_round_kkumail
  on public.rotation_students (round_id, lower(kkumail)) where kkumail is not null;
create index if not exists rotation_students_person on public.rotation_students (person_id);
comment on table public.rotation_students is
  'The roster of one rotation round (0250), imported from the faculty PDF by '
  'tools/rotation-import.mjs. gender comes from the PDF prefix (นาย = M, นางสาว = F). '
  'gpa is SELF-REPORTED and PRIVATE: only rotation_board() reads it, and only for '
  'the student themself or an admin. Never add a select policy to this table.';

create table if not exists public.rotation_requests (
  id           uuid primary key default gen_random_uuid(),
  round_id     text not null references public.rotation_rounds(id) on delete cascade,
  requester_id uuid not null references public.rotation_students(id) on delete cascade,
  target_id    uuid references public.rotation_students(id) on delete cascade,
  from_group   text not null,
  to_group     text not null,
  status       text not null default 'pending'
               check (status in ('pending', 'accepted', 'declined', 'cancelled', 'superseded')),
  accepted_by  uuid references public.rotation_students(id) on delete set null,
  created_at   timestamptz not null default now(),
  resolved_at  timestamptz,
  check (from_group <> to_group),
  check (target_id is null or target_id <> requester_id)
);
-- One pending ask per (person → person) and per (person → whole group).
create unique index if not exists rotation_requests_one_direct
  on public.rotation_requests (requester_id, target_id) where status = 'pending' and target_id is not null;
create unique index if not exists rotation_requests_one_broadcast
  on public.rotation_requests (requester_id, to_group) where status = 'pending' and target_id is null;
create index if not exists rotation_requests_round on public.rotation_requests (round_id, status);
comment on column public.rotation_requests.target_id is
  'NULL = a broadcast: anyone in to_group who passes rotation_pair_allowed() may '
  'accept, and the FIRST accept wins (the round lock makes the second see it taken).';
comment on column public.rotation_requests.status is
  'superseded = closed by the system because one of the two people changed group '
  'through another swap (or an admin move), so the ask no longer describes a swap.';

create table if not exists public.rotation_moves (
  id          bigint generated always as identity primary key,
  round_id    text not null references public.rotation_rounds(id) on delete cascade,
  student_id  uuid not null references public.rotation_students(id) on delete cascade,
  from_group  text not null,
  to_group    text not null,
  request_id  uuid references public.rotation_requests(id) on delete set null,
  kind        text not null check (kind in ('swap', 'admin')),
  by_user     uuid,
  at          timestamptz not null default now()
);
create index if not exists rotation_moves_round on public.rotation_moves (round_id, at desc);

create table if not exists public.rotation_events (
  id       bigint generated always as identity primary key,
  round_id text not null references public.rotation_rounds(id) on delete cascade,
  at       timestamptz not null default now()
);
comment on table public.rotation_events is
  'A content-free "something changed" ping per write (0250), readable by anyone '
  'who may see the round, so Supabase Realtime can deliver it under RLS. The page '
  're-reads rotation_board() on each one. Carries NO data on purpose.';

alter table public.rotation_rounds   enable row level security;
alter table public.rotation_students enable row level security;
alter table public.rotation_requests enable row level security;
alter table public.rotation_moves    enable row level security;
alter table public.rotation_events   enable row level security;

revoke all on public.rotation_rounds, public.rotation_students, public.rotation_requests,
              public.rotation_moves, public.rotation_events
  from public, anon, authenticated;
-- Realtime needs SELECT on the one table it streams; the policy below says which rows.
grant select on public.rotation_events to authenticated;

-- ── helpers ─────────────────────────────────────────────────────────────────

-- Admin = role dev, or the `rotation` permission (which master answers yes to,
-- through current_user_has_permission — 0111). No role list beyond dev: a new
-- channel threaded through one helper, not through every function (class 5).
create or replace function public.rotation_is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select public.current_user_role() = 'dev' or public.current_user_has_permission('rotation');
$$;

-- The caller's roster row in a round, or NULL. Matched on the registry link
-- (people.user_id) OR the kkumail — never on a name. auth.uid() NULL matches
-- nothing (lower(null) = x is null, not true).
create or replace function public.rotation_my_row_id(p_round text)
returns uuid language sql stable security definer set search_path = public as $$
  select rs.id
    from public.rotation_students rs
    left join public.people p on p.id = rs.person_id
   where rs.round_id = p_round
     and auth.uid() is not null
     and ((p.user_id is not null and p.user_id = auth.uid())
          or (rs.kkumail is not null and lower(btrim(rs.kkumail)) = lower(public.current_user_email())))
   order by (p.user_id is not distinct from auth.uid()) desc, rs.id
   limit 1;
$$;

create or replace function public.rotation_can_view(p_round text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.rotation_is_admin()
      or (exists (select 1 from public.rotation_rounds r where r.id = p_round and r.published)
          and public.rotation_my_row_id(p_round) is not null);
$$;

-- GPA band per the faculty's criterion. NULL = no GPA or below 2.55 — a band
-- the criterion does not name, so the rule cannot place it.
create or replace function public.rotation_gpa_band(g numeric)
returns text language sql immutable set search_path = public as $$
  select case
    when g is null      then null
    when g >= 3.50      then '3.50-4.00'
    when g >= 3.00      then '3.00-3.49'
    when g >= 2.55      then '2.55-2.99'
    else null
  end;
$$;

-- ⛔ THE ONE HOME OF THE SWAP CRITERIA. The board's "can swap with me", the
-- request guard and the accept guard all ask this — never restate it.
-- To change the GPA rule (e.g. allow neighbouring bands), edit ONLY this.
create or replace function public.rotation_pair_allowed(
  p_round text, a public.rotation_students, b public.rotation_students)
returns boolean language sql stable security definer set search_path = public as $$
  select a.id <> b.id
     and a.round_id = p_round and b.round_id = p_round
     and a.current_group <> b.current_group
     and a.gender = b.gender
     and case (select gpa_rule from public.rotation_rounds where id = p_round)
           when 'same_band' then public.rotation_gpa_band(a.gpa) is not null
                             and public.rotation_gpa_band(a.gpa) = public.rotation_gpa_band(b.gpa)
           else true
         end;
$$;

create or replace function public.rotation_swaps_live(p_round text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.rotation_rounds r
                  where r.id = p_round and r.published and r.swaps_open
                    and (r.swaps_close_at is null or now() < r.swaps_close_at));
$$;

drop policy if exists rotation_events_read on public.rotation_events;
create policy rotation_events_read on public.rotation_events
  for select to authenticated using (public.rotation_can_view(round_id));

-- ── the board: everything the page shows, in one read ───────────────────────

create or replace function public.rotation_board(p_round text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_admin boolean := public.rotation_is_admin();
  v_me_id uuid    := public.rotation_my_row_id(p_round);
  v_me    public.rotation_students;
  v_round public.rotation_rounds;
begin
  select * into v_round from public.rotation_rounds where id = p_round;
  if not found then
    return jsonb_build_object('state', 'no_round');
  end if;
  if v_me_id is not null then
    select * into v_me from public.rotation_students where id = v_me_id;
  end if;

  if auth.uid() is null then
    return jsonb_build_object('state', 'signed_out');
  end if;
  if not v_admin and v_me_id is null then
    return jsonb_build_object('state', 'not_in_roster', 'title', v_round.title);
  end if;
  if not v_admin and not v_round.published then
    return jsonb_build_object('state', 'not_published', 'title', v_round.title);
  end if;

  return jsonb_build_object(
    'state', 'ok',
    'is_admin', v_admin,
    'round', jsonb_build_object(
      'id', v_round.id, 'title', v_round.title, 'groups', to_jsonb(v_round.groups),
      'published', v_round.published, 'swaps_open', v_round.swaps_open,
      'swaps_close_at', v_round.swaps_close_at, 'gpa_rule', v_round.gpa_rule,
      'swaps_live', public.rotation_swaps_live(p_round),
      'max_pending', v_round.max_pending),
    'me', case when v_me_id is null then null else jsonb_build_object(
      'id', v_me.id, 'student_id', v_me.student_id, 'prefix', v_me.prefix,
      'first_name', v_me.first_name, 'last_name', v_me.last_name, 'gender', v_me.gender,
      'original_group', v_me.original_group, 'current_group', v_me.current_group,
      'gpa', v_me.gpa, 'gpa_band', public.rotation_gpa_band(v_me.gpa),
      'gpa_updated_at', v_me.gpa_updated_at) end,
    'students', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', s.id, 'student_id', s.student_id, 'prefix', s.prefix,
          'first_name', s.first_name, 'last_name', s.last_name, 'gender', s.gender,
          'original_group', s.original_group, 'current_group', s.current_group,
          'signed_in', exists (select 1 from public.people p
                                where p.id = s.person_id and p.user_id is not null)
                       or exists (select 1 from public.users u
                                   where s.kkumail is not null
                                     and lower(btrim(u.email)) = lower(btrim(s.kkumail))),
          'can_swap', case when v_me_id is null then false
                           else public.rotation_pair_allowed(p_round, v_me, s) end)
        -- GPA: admins only, and only here. A student reads their own under `me`.
        || case when v_admin then jsonb_build_object('gpa', s.gpa) else '{}'::jsonb end
        order by s.current_group, s.student_id)
        from public.rotation_students s where s.round_id = p_round), '[]'::jsonb),
    -- Everyone sees pending and accepted asks (owner: "everyone can see who is
    -- requesting to who"). A DECLINE, a cancel and a system close are seen only
    -- by the two people involved (+ admins) — a public "X turned Y down" adds
    -- pressure and tells the cohort nothing it needs.
    'requests', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', q.id, 'requester_id', q.requester_id, 'target_id', q.target_id,
          'from_group', q.from_group, 'to_group', q.to_group, 'status', q.status,
          'accepted_by', q.accepted_by, 'created_at', q.created_at, 'resolved_at', q.resolved_at)
        order by q.created_at desc)
        from public.rotation_requests q
       where q.round_id = p_round
         and (q.status in ('pending', 'accepted') or v_admin
              or (v_me_id is not null and (q.requester_id = v_me_id or q.target_id = v_me_id
                                           or q.accepted_by = v_me_id)))), '[]'::jsonb),
    'moves', coalesce((
      select jsonb_agg(jsonb_build_object(
          'student_id', m.student_id, 'from_group', m.from_group, 'to_group', m.to_group,
          'request_id', m.request_id, 'kind', m.kind, 'at', m.at)
        order by m.at desc, m.id desc)
        from public.rotation_moves m where m.round_id = p_round), '[]'::jsonb)
  );
end;
$$;

-- ── writes ──────────────────────────────────────────────────────────────────

create or replace function public.rotation_set_gpa(p_round text, p_gpa numeric)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_me uuid := public.rotation_my_row_id(p_round);
begin
  if v_me is null then raise exception 'ROTATION_NOT_IN_ROSTER'; end if;
  if p_gpa is not null and (p_gpa < 0 or p_gpa > 4) then raise exception 'ROTATION_GPA_RANGE'; end if;
  perform pg_advisory_xact_lock(hashtext('rotation:' || p_round));
  update public.rotation_students
     set gpa = round(p_gpa, 2), gpa_updated_at = now(), updated_at = now()
   where id = v_me;
  insert into public.rotation_events (round_id) values (p_round);
  return jsonb_build_object('ok', true, 'gpa', round(p_gpa, 2), 'gpa_band', public.rotation_gpa_band(p_gpa));
end;
$$;

-- p_target NULL = broadcast to every eligible person in p_to_group.
create or replace function public.rotation_request(p_round text, p_target uuid, p_to_group text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_me_id uuid := public.rotation_my_row_id(p_round);
  v_me    public.rotation_students;
  v_t     public.rotation_students;
  v_round public.rotation_rounds;
  v_id    uuid;
  v_eligible int;
begin
  if v_me_id is null then raise exception 'ROTATION_NOT_IN_ROSTER'; end if;
  perform pg_advisory_xact_lock(hashtext('rotation:' || p_round));
  if not public.rotation_swaps_live(p_round) then
    return jsonb_build_object('ok', false, 'reason', 'closed');
  end if;
  select * into v_round from public.rotation_rounds where id = p_round;
  select * into v_me from public.rotation_students where id = v_me_id;

  if p_target is not null then
    select * into v_t from public.rotation_students where id = p_target and round_id = p_round;
    if not found then return jsonb_build_object('ok', false, 'reason', 'no_such_student'); end if;
    p_to_group := v_t.current_group;
    if not public.rotation_pair_allowed(p_round, v_me, v_t) then
      return jsonb_build_object('ok', false, 'reason', 'not_eligible');
    end if;
    if exists (select 1 from public.rotation_requests where requester_id = v_me.id
                 and target_id = p_target and status = 'pending') then
      return jsonb_build_object('ok', false, 'reason', 'duplicate');
    end if;
  else
    if p_to_group is null or not (p_to_group = any (v_round.groups)) then
      return jsonb_build_object('ok', false, 'reason', 'no_such_group');
    end if;
    if p_to_group = v_me.current_group then
      return jsonb_build_object('ok', false, 'reason', 'same_group');
    end if;
    select count(*) into v_eligible from public.rotation_students s
     where s.round_id = p_round and s.current_group = p_to_group
       and public.rotation_pair_allowed(p_round, v_me, s);
    if v_eligible = 0 then return jsonb_build_object('ok', false, 'reason', 'nobody_eligible'); end if;
    if exists (select 1 from public.rotation_requests where requester_id = v_me.id
                 and target_id is null and to_group = p_to_group and status = 'pending') then
      return jsonb_build_object('ok', false, 'reason', 'duplicate');
    end if;
  end if;

  if (select count(*) from public.rotation_requests
       where requester_id = v_me.id and status = 'pending') >= v_round.max_pending then
    return jsonb_build_object('ok', false, 'reason', 'too_many');
  end if;

  insert into public.rotation_requests (round_id, requester_id, target_id, from_group, to_group)
  values (p_round, v_me.id, p_target, v_me.current_group, p_to_group)
  returning id into v_id;
  insert into public.rotation_events (round_id) values (p_round);
  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

-- The requester withdraws (cancel), or the named target says no (decline).
-- A broadcast cannot be declined — nobody is named; it just waits.
create or replace function public.rotation_respond_no(p_request uuid)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  q public.rotation_requests;
  v_me uuid;
begin
  select * into q from public.rotation_requests where id = p_request;
  if not found then return jsonb_build_object('ok', false, 'reason', 'no_such_request'); end if;
  v_me := public.rotation_my_row_id(q.round_id);
  if v_me is null then raise exception 'ROTATION_NOT_IN_ROSTER'; end if;
  perform pg_advisory_xact_lock(hashtext('rotation:' || q.round_id));
  select * into q from public.rotation_requests where id = p_request;   -- after the lock
  if q.status <> 'pending' then return jsonb_build_object('ok', false, 'reason', 'not_pending'); end if;
  if q.requester_id = v_me then
    update public.rotation_requests set status = 'cancelled', resolved_at = now() where id = q.id;
  elsif q.target_id = v_me then
    update public.rotation_requests set status = 'declined', resolved_at = now() where id = q.id;
  else
    return jsonb_build_object('ok', false, 'reason', 'not_yours');
  end if;
  insert into public.rotation_events (round_id) values (q.round_id);
  return jsonb_build_object('ok', true);
end;
$$;

-- Internal: close every pending ask that names a person who just moved. Their
-- `from_group`/`to_group` no longer describe a swap anyone could make.
create or replace function public.rotation_supersede_for(p_round text, p_students uuid[])
returns int language sql volatile security definer set search_path = public as $$
  with x as (
    update public.rotation_requests
       set status = 'superseded', resolved_at = now()
     where round_id = p_round and status = 'pending'
       and (requester_id = any (p_students) or target_id = any (p_students))
    returning 1)
  select count(*)::int from x;
$$;

create or replace function public.rotation_accept(p_request uuid)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  q     public.rotation_requests;
  v_me_id uuid;
  v_me  public.rotation_students;
  v_req public.rotation_students;
  v_closed int;
begin
  select * into q from public.rotation_requests where id = p_request;
  if not found then return jsonb_build_object('ok', false, 'reason', 'no_such_request'); end if;
  v_me_id := public.rotation_my_row_id(q.round_id);
  if v_me_id is null then raise exception 'ROTATION_NOT_IN_ROSTER'; end if;

  perform pg_advisory_xact_lock(hashtext('rotation:' || q.round_id));
  -- Everything below reads what is committed AFTER the lock: if another accept
  -- got here first, this is where we see it.
  select * into q from public.rotation_requests where id = p_request;
  if not public.rotation_swaps_live(q.round_id) then
    return jsonb_build_object('ok', false, 'reason', 'closed');
  end if;
  if q.status = 'accepted' then return jsonb_build_object('ok', false, 'reason', 'taken'); end if;
  if q.status <> 'pending' then return jsonb_build_object('ok', false, 'reason', 'not_pending'); end if;
  if q.requester_id = v_me_id then return jsonb_build_object('ok', false, 'reason', 'own_request'); end if;
  if q.target_id is not null and q.target_id <> v_me_id then
    return jsonb_build_object('ok', false, 'reason', 'not_yours');
  end if;

  select * into v_me  from public.rotation_students where id = v_me_id;
  select * into v_req from public.rotation_students where id = q.requester_id;

  -- The ask was written about where both people WERE. If either has moved
  -- since (another swap, an admin), it is no longer this swap.
  if v_req.current_group <> q.from_group or v_me.current_group <> q.to_group then
    if q.target_id is not null or v_req.current_group <> q.from_group then
      update public.rotation_requests set status = 'superseded', resolved_at = now() where id = q.id;
      insert into public.rotation_events (round_id) values (q.round_id);
    end if;
    return jsonb_build_object('ok', false, 'reason', 'stale');
  end if;
  if not public.rotation_pair_allowed(q.round_id, v_req, v_me) then
    return jsonb_build_object('ok', false, 'reason', 'not_eligible');
  end if;

  update public.rotation_students set current_group = q.to_group,   updated_at = now() where id = v_req.id;
  update public.rotation_students set current_group = q.from_group, updated_at = now() where id = v_me.id;
  update public.rotation_requests
     set status = 'accepted', accepted_by = v_me.id, resolved_at = now()
   where id = q.id;
  insert into public.rotation_moves (round_id, student_id, from_group, to_group, request_id, kind, by_user)
  values (q.round_id, v_req.id, q.from_group, q.to_group, q.id, 'swap', auth.uid()),
         (q.round_id, v_me.id,  q.to_group,   q.from_group, q.id, 'swap', auth.uid());
  v_closed := public.rotation_supersede_for(q.round_id, array[v_req.id, v_me.id]);
  insert into public.rotation_events (round_id) values (q.round_id);
  return jsonb_build_object('ok', true, 'requester_group', q.to_group, 'my_group', q.from_group,
                            'closed_other_requests', v_closed);
end;
$$;

-- ── admin ───────────────────────────────────────────────────────────────────

create or replace function public.rotation_admin_update_round(
  p_round text, p_published boolean, p_swaps_open boolean,
  p_swaps_close_at timestamptz, p_gpa_rule text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
begin
  if not public.rotation_is_admin() then raise exception 'ROTATION_ADMIN_ONLY'; end if;
  perform pg_advisory_xact_lock(hashtext('rotation:' || p_round));
  update public.rotation_rounds
     set published = coalesce(p_published, published),
         swaps_open = coalesce(p_swaps_open, swaps_open),
         swaps_close_at = p_swaps_close_at,
         gpa_rule = coalesce(p_gpa_rule, gpa_rule),
         updated_at = now()
   where id = p_round;
  if not found then return jsonb_build_object('ok', false, 'reason', 'no_round'); end if;
  insert into public.rotation_events (round_id) values (p_round);
  return jsonb_build_object('ok', true);
end;
$$;

-- A correction by hand (the faculty moved someone). Unbalances group sizes on
-- purpose if asked to; logs it; closes the person's pending asks.
create or replace function public.rotation_admin_move(p_student uuid, p_group text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  s public.rotation_students;
begin
  if not public.rotation_is_admin() then raise exception 'ROTATION_ADMIN_ONLY'; end if;
  select * into s from public.rotation_students where id = p_student;
  if not found then return jsonb_build_object('ok', false, 'reason', 'no_such_student'); end if;
  perform pg_advisory_xact_lock(hashtext('rotation:' || s.round_id));
  select * into s from public.rotation_students where id = p_student;
  if not (p_group = any ((select groups from public.rotation_rounds where id = s.round_id))) then
    return jsonb_build_object('ok', false, 'reason', 'no_such_group');
  end if;
  if s.current_group = p_group then return jsonb_build_object('ok', true, 'unchanged', true); end if;
  update public.rotation_students set current_group = p_group, updated_at = now() where id = s.id;
  insert into public.rotation_moves (round_id, student_id, from_group, to_group, kind, by_user)
  values (s.round_id, s.id, s.current_group, p_group, 'admin', auth.uid());
  perform public.rotation_supersede_for(s.round_id, array[s.id]);
  insert into public.rotation_events (round_id) values (s.round_id);
  return jsonb_build_object('ok', true);
end;
$$;

-- ── grants ──────────────────────────────────────────────────────────────────

do $$
declare f text;
begin
  foreach f in array array[
    'public.rotation_is_admin()',
    'public.rotation_my_row_id(text)',
    'public.rotation_can_view(text)',
    'public.rotation_gpa_band(numeric)',
    'public.rotation_pair_allowed(text, public.rotation_students, public.rotation_students)',
    'public.rotation_swaps_live(text)',
    'public.rotation_board(text)',
    'public.rotation_set_gpa(text, numeric)',
    'public.rotation_request(text, uuid, text)',
    'public.rotation_respond_no(uuid)',
    'public.rotation_supersede_for(text, uuid[])',
    'public.rotation_accept(uuid)',
    'public.rotation_admin_update_round(text, boolean, boolean, timestamptz, text)',
    'public.rotation_admin_move(uuid, text)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
  end loop;
end $$;

-- What the page calls. The helpers stay callable by authenticated only because
-- the RLS policy on rotation_events invokes rotation_can_view as the caller.
grant execute on function public.rotation_board(text)                       to authenticated;
grant execute on function public.rotation_set_gpa(text, numeric)            to authenticated;
grant execute on function public.rotation_request(text, uuid, text)         to authenticated;
grant execute on function public.rotation_respond_no(uuid)                  to authenticated;
grant execute on function public.rotation_accept(uuid)                      to authenticated;
grant execute on function public.rotation_admin_update_round(text, boolean, boolean, timestamptz, text) to authenticated;
grant execute on function public.rotation_admin_move(uuid, text)            to authenticated;
grant execute on function public.rotation_can_view(text)                    to authenticated;
grant execute on function public.rotation_is_admin()                        to authenticated;
grant execute on function public.rotation_my_row_id(text)                   to authenticated;
-- rotation_supersede_for / rotation_pair_allowed / rotation_swaps_live /
-- rotation_gpa_band: internal — called from inside the definer functions above
-- (which run as their owner), never from the page. pair_allowed takes a whole
-- roster row, so exposing it would be a GPA oracle.
revoke all on function public.rotation_supersede_for(text, uuid[]) from authenticated;
revoke all on function public.rotation_pair_allowed(text, public.rotation_students, public.rotation_students) from authenticated;

-- ── realtime ────────────────────────────────────────────────────────────────
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                      where pubname = 'supabase_realtime' and schemaname = 'public'
                        and tablename = 'rotation_events') then
    execute 'alter publication supabase_realtime add table public.rotation_events';
  end if;
end $$;

-- ── the round itself (no people — tools/rotation-import.mjs adds them) ──────
insert into public.rotation_rounds (id, title)
values ('y6-2570', 'Rotation ปี 6 ปีการศึกษา 2570')
on conflict (id) do nothing;
