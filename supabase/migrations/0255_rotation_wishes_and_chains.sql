-- ============================================================
-- 0255 — แลก Rotation: "อยากไปกลุ่ม…" wishes + แลกต่อเนื่อง (3-person chains).
--
-- REQUESTED (owner, 2026-10-24): "what if i want to be able to swap continuous,
-- like if no one in B swap with E, i'll have to E->A->B" → design
-- docs/ROTATION-CHAINS.md, then "do it" with the recommended answers: at most
-- 3 people, wishes public, legality = consecutive legal 1:1 swaps (each taker
-- passes rotation_pair_allowed against the STARTER — the design's §7.1 names
-- the per-seat alternative the faculty may still ask for).
--
--   rotation_wishes      the groups a student would move to, ranked. Public in
--                        the board (hidden while `staying`).
--   rotation_chains      one proposal: starter in from_group wants to_group, via
--                        via_group. Three distinct groups.
--   rotation_chain_legs  seq 1: someone in VIA moves to FROM (takes my seat);
--                        seq 2: someone in TO moves to VIA. target_id = a named
--                        person, null = "anyone eligible"; taker_id = who said yes.
--
-- ALL OR NOTHING. Saying yes is a COMMITMENT, not a move; the yes that fills
-- the last leg moves all three in one transaction under the round lock, after
-- re-checking every condition. A commitment locks NOBODY: a taker may take a
-- different swap, and rotation_supersede_for (every mover path calls it —
-- accept, admin move, a chain) then fails a chain whose STARTER or NAMED target
-- moved, and re-opens an "anyone" leg whose taker moved. Expiry is lazy: a
-- pending chain past expires_at reads 'expired' and refuses commits; no cron.
--
-- Same shape as 0250: no table readable through the API, definer RPCs only,
-- every write pings rotation_events. Proof: tools/rotation0250-swaps.sql §J.
--
-- ALSO FIXES rotation_admin_move, broken since 0250 (see the note above it).
-- ============================================================

create table if not exists public.rotation_wishes (
  student_id uuid not null references public.rotation_students(id) on delete cascade,
  to_group   text not null check (to_group ~ '^[A-Z]$'),
  rank       smallint not null,
  created_at timestamptz not null default now(),
  primary key (student_id, to_group)
);
create table if not exists public.rotation_chains (
  id          uuid primary key default gen_random_uuid(),
  round_id    text not null references public.rotation_rounds(id) on delete cascade,
  starter_id  uuid not null references public.rotation_students(id) on delete cascade,
  from_group  text not null,
  via_group   text not null,
  to_group    text not null,
  status      text not null default 'pending'
              check (status in ('pending', 'done', 'failed', 'cancelled', 'expired')),
  fail_reason text,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  resolved_at timestamptz,
  check (from_group <> via_group and via_group <> to_group and from_group <> to_group)
);
create index if not exists rotation_chains_round on public.rotation_chains (round_id, status);
create table if not exists public.rotation_chain_legs (
  chain_id     uuid not null references public.rotation_chains(id) on delete cascade,
  seq          smallint not null check (seq in (1, 2)),
  from_group   text not null,
  to_group     text not null,
  target_id    uuid references public.rotation_students(id) on delete cascade,
  taker_id     uuid references public.rotation_students(id) on delete set null,
  committed_at timestamptz,
  primary key (chain_id, seq)
);
alter table public.rotation_moves add column if not exists chain_id uuid
  references public.rotation_chains(id) on delete set null;
alter table public.rotation_moves drop constraint if exists rotation_moves_kind_check;
alter table public.rotation_moves add constraint rotation_moves_kind_check
  check (kind in ('swap', 'admin', 'chain'));

alter table public.rotation_wishes     enable row level security;
alter table public.rotation_chains     enable row level security;
alter table public.rotation_chain_legs enable row level security;
revoke all on public.rotation_wishes, public.rotation_chains, public.rotation_chain_legs
  from public, anon, authenticated;

-- A student's wishes as the board shows them: none while staying, never the
-- group they are already in.
create or replace function public.rotation_wishes_of(s public.rotation_students)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when s.staying then '[]'::jsonb else coalesce((
    select jsonb_agg(w.to_group order by w.rank) from public.rotation_wishes w
     where w.student_id = s.id and w.to_group <> s.current_group), '[]'::jsonb) end;
$$;

create or replace function public.rotation_set_wishes(p_round text, p_groups text[])
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_me public.rotation_students;
  v_id uuid := public.rotation_my_row_id(p_round);
  v_groups text[];
begin
  if v_id is null then raise exception 'ROTATION_NOT_IN_ROSTER'; end if;
  select * into v_me from public.rotation_students where id = v_id;
  select groups into v_groups from public.rotation_rounds where id = p_round;
  p_groups := coalesce(p_groups, '{}');
  if cardinality(p_groups) > 5
     or exists (select 1 from unnest(p_groups) g where not (g = any (v_groups)) or g = v_me.current_group)
     or (select count(distinct g) from unnest(p_groups) g) <> cardinality(p_groups) then
    return jsonb_build_object('ok', false, 'reason', 'bad_group');
  end if;
  delete from public.rotation_wishes where student_id = v_id;
  insert into public.rotation_wishes (student_id, to_group, rank)
  select v_id, g, n from unnest(p_groups) with ordinality u(g, n);
  insert into public.rotation_events (round_id) values (p_round);
  return jsonb_build_object('ok', true, 'wishes', to_jsonb(p_groups));
end;
$$;

-- ⛔ Every mover path calls this (accept, admin move, a chain). Since 0255 it
-- also settles chains and wishes for the people who just moved.
create or replace function public.rotation_supersede_for(p_round text, p_students uuid[])
returns int language plpgsql volatile security definer set search_path = public as $$
declare v int;
begin
  -- A chain is written about where its STARTER and NAMED people are.
  update public.rotation_chains c set status = 'failed', fail_reason = 'moved', resolved_at = now()
   where c.round_id = p_round and c.status = 'pending'
     and (c.starter_id = any (p_students)
          or exists (select 1 from public.rotation_chain_legs l
                      where l.chain_id = c.id and l.target_id = any (p_students)));
  -- An "anyone" leg whose taker moved re-opens for the next person.
  update public.rotation_chain_legs l set taker_id = null, committed_at = null
   where l.target_id is null and l.taker_id = any (p_students)
     and exists (select 1 from public.rotation_chains c where c.id = l.chain_id and c.status = 'pending');
  -- A wish that came true is spent.
  delete from public.rotation_wishes w using public.rotation_students s
   where w.student_id = s.id and s.id = any (p_students) and w.to_group = s.current_group;
  with x as (
    update public.rotation_requests
       set status = 'superseded', resolved_at = now()
     where round_id = p_round and status = 'pending'
       and (requester_id = any (p_students) or target_id = any (p_students))
    returning 1)
  select count(*)::int into v from x;
  return v;
end;
$$;

create or replace function public.rotation_chain_propose(
  p_round text, p_via text, p_to text, p_via_target uuid default null, p_to_target uuid default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_id    uuid := public.rotation_my_row_id(p_round);
  v_me    public.rotation_students;
  v_round public.rotation_rounds;
  t       public.rotation_students;
  v_chain uuid;
  k       int;
begin
  if v_id is null then raise exception 'ROTATION_NOT_IN_ROSTER'; end if;
  perform pg_advisory_xact_lock(hashtext('rotation:' || p_round));
  if not public.rotation_swaps_live(p_round) then return jsonb_build_object('ok', false, 'reason', 'closed'); end if;
  select * into v_round from public.rotation_rounds where id = p_round;
  select * into v_me from public.rotation_students where id = v_id;
  if v_me.staying then return jsonb_build_object('ok', false, 'reason', 'you_staying'); end if;
  if p_via is null or p_to is null or not (p_via = any (v_round.groups)) or not (p_to = any (v_round.groups))
     or p_via = p_to or p_via = v_me.current_group or p_to = v_me.current_group then
    return jsonb_build_object('ok', false, 'reason', 'bad_group');
  end if;
  -- each leg: a named person must qualify; "anyone" must have at least one who does
  for k in 1..2 loop
    if (case k when 1 then p_via_target else p_to_target end) is not null then
      select * into t from public.rotation_students
       where id = (case k when 1 then p_via_target else p_to_target end) and round_id = p_round;
      if not found or t.current_group <> (case k when 1 then p_via else p_to end) then
        return jsonb_build_object('ok', false, 'reason', 'stale');
      end if;
      if t.staying then return jsonb_build_object('ok', false, 'reason', 'staying'); end if;
      if not public.rotation_pair_allowed(p_round, v_me, t) then
        return jsonb_build_object('ok', false, 'reason', 'not_eligible');
      end if;
    elsif not exists (select 1 from public.rotation_students s
                       where s.round_id = p_round and s.current_group = (case k when 1 then p_via else p_to end)
                         and not s.staying and public.rotation_pair_allowed(p_round, v_me, s)) then
      return jsonb_build_object('ok', false, 'reason', 'nobody_eligible');
    end if;
  end loop;
  if (select count(*) from public.rotation_chains
       where starter_id = v_id and status = 'pending' and expires_at > now()) >= 3 then
    return jsonb_build_object('ok', false, 'reason', 'too_many_chains');
  end if;
  if exists (select 1 from public.rotation_chains c
              where c.starter_id = v_id and c.status = 'pending' and c.expires_at > now()
                and c.via_group = p_via and c.to_group = p_to
                and (select l.target_id from public.rotation_chain_legs l where l.chain_id = c.id and l.seq = 1) is not distinct from p_via_target
                and (select l.target_id from public.rotation_chain_legs l where l.chain_id = c.id and l.seq = 2) is not distinct from p_to_target) then
    return jsonb_build_object('ok', false, 'reason', 'duplicate');
  end if;
  insert into public.rotation_chains (round_id, starter_id, from_group, via_group, to_group, expires_at)
  values (p_round, v_id, v_me.current_group, p_via, p_to,
          least(now() + interval '48 hours', coalesce(v_round.swaps_close_at, 'infinity'::timestamptz)))
  returning id into v_chain;
  insert into public.rotation_chain_legs (chain_id, seq, from_group, to_group, target_id) values
    (v_chain, 1, p_via, v_me.current_group, p_via_target),
    (v_chain, 2, p_to,  p_via,              p_to_target);
  insert into public.rotation_events (round_id) values (p_round);
  return jsonb_build_object('ok', true, 'chain_id', v_chain);
end;
$$;

-- Yes = commit to the leg that starts in MY group; the yes that fills the last
-- leg runs the chain. No = withdraw my commitment, or (named) refuse the chain.
create or replace function public.rotation_chain_respond(p_chain uuid, p_yes boolean)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  c    public.rotation_chains;
  l    public.rotation_chain_legs;
  v_id uuid;
  v_me public.rotation_students;
  st   public.rotation_students;
  t1   public.rotation_students;
  t2   public.rotation_students;
begin
  select * into c from public.rotation_chains where id = p_chain;
  if not found then return jsonb_build_object('ok', false, 'reason', 'no_such_request'); end if;
  v_id := public.rotation_my_row_id(c.round_id);
  if v_id is null then raise exception 'ROTATION_NOT_IN_ROSTER'; end if;
  perform pg_advisory_xact_lock(hashtext('rotation:' || c.round_id));
  select * into c from public.rotation_chains where id = p_chain;
  if c.status <> 'pending' then return jsonb_build_object('ok', false, 'reason', 'not_pending'); end if;
  if c.expires_at <= now() then
    update public.rotation_chains set status = 'expired', resolved_at = now() where id = c.id;
    insert into public.rotation_events (round_id) values (c.round_id);
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;
  if v_id = c.starter_id then return jsonb_build_object('ok', false, 'reason', 'own_request'); end if;
  select * into v_me from public.rotation_students where id = v_id;

  if not coalesce(p_yes, false) then
    if exists (select 1 from public.rotation_chain_legs where chain_id = c.id and target_id = v_id) then
      update public.rotation_chains set status = 'failed', fail_reason = 'declined', resolved_at = now() where id = c.id;
    elsif exists (select 1 from public.rotation_chain_legs where chain_id = c.id and taker_id = v_id) then
      update public.rotation_chain_legs set taker_id = null, committed_at = null where chain_id = c.id and taker_id = v_id;
    else
      return jsonb_build_object('ok', false, 'reason', 'not_yours');
    end if;
    insert into public.rotation_events (round_id) values (c.round_id);
    return jsonb_build_object('ok', true);
  end if;

  if not public.rotation_swaps_live(c.round_id) then return jsonb_build_object('ok', false, 'reason', 'closed'); end if;
  if v_me.staying then return jsonb_build_object('ok', false, 'reason', 'you_staying'); end if;
  if exists (select 1 from public.rotation_chain_legs where chain_id = c.id and taker_id = v_id) then
    return jsonb_build_object('ok', false, 'reason', 'duplicate');
  end if;
  select * into l from public.rotation_chain_legs where chain_id = c.id and from_group = v_me.current_group;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_yours'); end if;
  if l.taker_id is not null then return jsonb_build_object('ok', false, 'reason', 'taken'); end if;
  if l.target_id is not null and l.target_id <> v_id then return jsonb_build_object('ok', false, 'reason', 'not_yours'); end if;
  select * into st from public.rotation_students where id = c.starter_id;
  if st.staying then return jsonb_build_object('ok', false, 'reason', 'staying'); end if;
  if not public.rotation_pair_allowed(c.round_id, st, v_me) then
    return jsonb_build_object('ok', false, 'reason', 'not_eligible');
  end if;
  update public.rotation_chain_legs set taker_id = v_id, committed_at = now() where chain_id = c.id and seq = l.seq;

  if exists (select 1 from public.rotation_chain_legs where chain_id = c.id and taker_id is null) then
    insert into public.rotation_events (round_id) values (c.round_id);
    return jsonb_build_object('ok', true, 'done', false);
  end if;

  -- The last yes: re-check EVERYTHING against the rows as they are now.
  select * into st from public.rotation_students where id = c.starter_id;
  select * into t1 from public.rotation_students where id = (select taker_id from public.rotation_chain_legs where chain_id = c.id and seq = 1);
  select * into t2 from public.rotation_students where id = (select taker_id from public.rotation_chain_legs where chain_id = c.id and seq = 2);
  if st.current_group <> c.from_group or t1.current_group <> c.via_group or t2.current_group <> c.to_group
     or st.staying or t1.staying or t2.staying or t1.id = t2.id
     or not public.rotation_pair_allowed(c.round_id, st, t1)
     or not public.rotation_pair_allowed(c.round_id, st, t2) then
    update public.rotation_chains set status = 'failed', fail_reason = 'changed', resolved_at = now() where id = c.id;
    insert into public.rotation_events (round_id) values (c.round_id);
    return jsonb_build_object('ok', false, 'reason', 'chain_failed');
  end if;
  update public.rotation_students set current_group = c.to_group,   updated_at = now() where id = st.id;
  update public.rotation_students set current_group = c.from_group, updated_at = now() where id = t1.id;
  update public.rotation_students set current_group = c.via_group,  updated_at = now() where id = t2.id;
  update public.rotation_chains set status = 'done', resolved_at = now() where id = c.id;
  insert into public.rotation_moves (round_id, student_id, from_group, to_group, chain_id, kind, by_user) values
    (c.round_id, st.id, c.from_group, c.to_group,   c.id, 'chain', auth.uid()),
    (c.round_id, t1.id, c.via_group,  c.from_group, c.id, 'chain', auth.uid()),
    (c.round_id, t2.id, c.to_group,   c.via_group,  c.id, 'chain', auth.uid());
  perform public.rotation_supersede_for(c.round_id, array[st.id, t1.id, t2.id]);
  insert into public.rotation_events (round_id) values (c.round_id);
  return jsonb_build_object('ok', true, 'done', true, 'my_group', l.to_group);
end;
$$;

create or replace function public.rotation_chain_cancel(p_chain uuid)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare c public.rotation_chains;
begin
  select * into c from public.rotation_chains where id = p_chain;
  if not found then return jsonb_build_object('ok', false, 'reason', 'no_such_request'); end if;
  if c.starter_id is distinct from public.rotation_my_row_id(c.round_id) then
    return jsonb_build_object('ok', false, 'reason', 'not_yours');
  end if;
  perform pg_advisory_xact_lock(hashtext('rotation:' || c.round_id));
  update public.rotation_chains set status = 'cancelled', resolved_at = now()
   where id = c.id and status = 'pending';
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_pending'); end if;
  insert into public.rotation_events (round_id) values (c.round_id);
  return jsonb_build_object('ok', true);
end;
$$;

-- 0252's switch, now also settling chains: mine cancelled, my commitments
-- withdrawn, chains that NAME me refused.
create or replace function public.rotation_set_staying(p_round text, p_staying boolean)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_me uuid := public.rotation_my_row_id(p_round);
  v_declined int := 0;
  v_cancelled int := 0;
begin
  if v_me is null then raise exception 'ROTATION_NOT_IN_ROSTER'; end if;
  perform pg_advisory_xact_lock(hashtext('rotation:' || p_round));
  update public.rotation_students
     set staying = coalesce(p_staying, false),
         staying_at = case when coalesce(p_staying, false) then now() else null end,
         updated_at = now()
   where id = v_me;
  if coalesce(p_staying, false) then
    with x as (update public.rotation_requests set status = 'declined', resolved_at = now()
                where round_id = p_round and status = 'pending' and target_id = v_me returning 1)
    select count(*) into v_declined from x;
    with x as (update public.rotation_requests set status = 'cancelled', resolved_at = now()
                where round_id = p_round and status = 'pending' and requester_id = v_me returning 1)
    select count(*) into v_cancelled from x;
    update public.rotation_chains set status = 'cancelled', resolved_at = now()
     where round_id = p_round and status = 'pending' and starter_id = v_me;
    update public.rotation_chains c set status = 'failed', fail_reason = 'declined', resolved_at = now()
     where c.round_id = p_round and c.status = 'pending'
       and exists (select 1 from public.rotation_chain_legs l where l.chain_id = c.id and l.target_id = v_me);
    update public.rotation_chain_legs l set taker_id = null, committed_at = null
     where l.taker_id = v_me
       and exists (select 1 from public.rotation_chains c where c.id = l.chain_id and c.status = 'pending');
  end if;
  insert into public.rotation_events (round_id) values (p_round);
  return jsonb_build_object('ok', true, 'staying', coalesce(p_staying, false),
                            'declined', v_declined, 'cancelled', v_cancelled);
end;
$$;

create or replace function public.rotation_board(p_round text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_admin boolean := public.rotation_is_admin();
  v_gpa   boolean := public.rotation_is_gpa_viewer();
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
    'gpa_viewer', v_gpa,
    'round', jsonb_build_object(
      'id', v_round.id, 'title', v_round.title, 'groups', to_jsonb(v_round.groups),
      'published', v_round.published, 'swaps_open', v_round.swaps_open,
      'swaps_close_at', v_round.swaps_close_at, 'gpa_rule', v_round.gpa_rule,
      'swaps_live', public.rotation_swaps_live(p_round),
      'max_pending', v_round.max_pending)
      -- Admins get HOW MANY have filled a GPA, never whose or what (owner, 2026-10-24).
      || case when v_admin then jsonb_build_object('gpa_filled',
           (select count(*) from public.rotation_students where round_id = p_round and gpa is not null))
         else '{}'::jsonb end,
    'me', case when v_me_id is null then null else jsonb_build_object(
      'id', v_me.id, 'student_id', v_me.student_id, 'prefix', v_me.prefix,
      'first_name', v_me.first_name, 'last_name', v_me.last_name, 'gender', v_me.gender,
      'original_group', v_me.original_group, 'current_group', v_me.current_group,
      'gpa', v_me.gpa, 'gpa_band', public.rotation_gpa_band(v_me.gpa),
      'gpa_updated_at', v_me.gpa_updated_at,
      'nickname', (select nullif(btrim(p.nickname), '') from public.people p where p.id = v_me.person_id),
      'contact', v_me.contact, 'staying', v_me.staying,
      'wishes', public.rotation_wishes_of(v_me)) end,
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
          -- can_swap = "I may ASK them": the criteria AND they have not chosen to stay.
          'can_swap', case when v_me_id is null then false
                           else public.rotation_pair_allowed(p_round, v_me, s) and not s.staying end,
          'staying', s.staying,
          'nickname', (select nullif(btrim(p.nickname), '') from public.people p where p.id = s.person_id),
          'contact', s.contact,
          'wishes', public.rotation_wishes_of(s))
        -- Everyone's GPA: ONLY a named GPA viewer (0254) — not admins, not master.
        || case when v_gpa then jsonb_build_object('gpa', s.gpa) else '{}'::jsonb end
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
          'request_id', m.request_id, 'chain_id', m.chain_id, 'kind', m.kind, 'at', m.at)
        order by m.at desc, m.id desc)
        from public.rotation_moves m where m.round_id = p_round), '[]'::jsonb),
    -- Chains (0255). Pending + done: everyone. Failed / cancelled / expired:
    -- only the people in it (+ admins), like a declined ask. `can_take` is the
    -- server's answer to "may I fill this leg?" — the page never re-derives it.
    'chains', coalesce((
      select jsonb_agg(x.j order by x.created_at desc) from (
        select c.created_at, jsonb_build_object(
            'id', c.id, 'starter_id', c.starter_id, 'from_group', c.from_group,
            'via_group', c.via_group, 'to_group', c.to_group,
            'status', case when c.status = 'pending' and c.expires_at <= now() then 'expired' else c.status end,
            'fail_reason', case when v_admin or v_me_id = c.starter_id
                                  or exists (select 1 from public.rotation_chain_legs l
                                              where l.chain_id = c.id and v_me_id in (l.taker_id, l.target_id))
                                then c.fail_reason end,
            'created_at', c.created_at, 'expires_at', c.expires_at, 'resolved_at', c.resolved_at,
            'legs', (select jsonb_agg(jsonb_build_object(
                        'seq', l.seq, 'from_group', l.from_group, 'to_group', l.to_group,
                        'target_id', l.target_id, 'taker_id', l.taker_id, 'committed_at', l.committed_at,
                        'can_take', v_me_id is not null and c.status = 'pending' and c.expires_at > now()
                                    and l.taker_id is null and v_me.current_group = l.from_group
                                    and (l.target_id is null or l.target_id = v_me_id)
                                    and v_me_id <> c.starter_id and not v_me.staying
                                    and public.rotation_swaps_live(p_round)
                                    and not exists (select 1 from public.rotation_chain_legs l2
                                                     where l2.chain_id = c.id and l2.taker_id = v_me_id)
                                    and public.rotation_pair_allowed(p_round, st, v_me))
                        order by l.seq)
                       from public.rotation_chain_legs l where l.chain_id = c.id)) as j
          from public.rotation_chains c
          join public.rotation_students st on st.id = c.starter_id
         where c.round_id = p_round
           and ((c.status in ('pending', 'done') and not (c.status = 'pending' and c.expires_at <= now()))
                or v_admin or v_me_id = c.starter_id
                or exists (select 1 from public.rotation_chain_legs l
                            where l.chain_id = c.id and v_me_id in (l.taker_id, l.target_id)))) x), '[]'::jsonb)
  );
end;
$$;

-- ⛔ FIX (found by this migration's proof): 0250's rotation_admin_move wrote
-- `p_group = any ((select groups …))`, which Postgres reads as ANY(subquery) —
-- comparing text with a whole text[] row — so EVERY admin move raised
-- "operator does not exist: text = text[]" from the day it shipped. The admin
-- "ย้ายกลุ่ม" select on /rotation has never worked. Read the array first.
create or replace function public.rotation_admin_move(p_student uuid, p_group text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  s public.rotation_students;
  v_groups text[];
begin
  if not public.rotation_is_admin() then raise exception 'ROTATION_ADMIN_ONLY'; end if;
  select * into s from public.rotation_students where id = p_student;
  if not found then return jsonb_build_object('ok', false, 'reason', 'no_such_student'); end if;
  perform pg_advisory_xact_lock(hashtext('rotation:' || s.round_id));
  select * into s from public.rotation_students where id = p_student;
  select groups into v_groups from public.rotation_rounds where id = s.round_id;
  if p_group is null or not (p_group = any (v_groups)) then
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

revoke all on function public.rotation_wishes_of(public.rotation_students) from public, anon, authenticated;
revoke all on function public.rotation_supersede_for(text, uuid[]) from public, anon, authenticated;
revoke all on function public.rotation_set_wishes(text, text[]) from public, anon;
revoke all on function public.rotation_chain_propose(text, text, text, uuid, uuid) from public, anon;
revoke all on function public.rotation_chain_respond(uuid, boolean) from public, anon;
revoke all on function public.rotation_chain_cancel(uuid) from public, anon;
grant execute on function public.rotation_set_wishes(text, text[]) to authenticated;
grant execute on function public.rotation_chain_propose(text, text, text, uuid, uuid) to authenticated;
grant execute on function public.rotation_chain_respond(uuid, boolean) to authenticated;
grant execute on function public.rotation_chain_cancel(uuid) to authenticated;
