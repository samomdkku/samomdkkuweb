-- ============================================================
-- 0252 — แลก Rotation: "ฉันอยากอยู่กลุ่มนี้" (I want to stay here).
--
-- REQUESTED (owner, 2026-10-24): "add option to show 'I want to stay here' so
-- that person won't get any more requests."
--
--   rotation_students.staying  set by its OWNER only, via
--                              rotation_set_staying(). Everyone who reads the
--                              board sees it (that is the point: "don't ask").
--   switching it ON            closes what is in flight, in one locked step:
--                              asks NAMING me → 'declined' (it is a no), my own
--                              asks → 'cancelled' (I am not moving).
--   while it is on             nobody can name me (reason 'staying'); a
--                              broadcast to my group does not count me as
--                              eligible and cannot be accepted by me; I cannot
--                              ask (reason 'you_staying'). Switching it off
--                              reopens nothing — old asks stay closed.
--
-- NOT a swap criterion: rotation_pair_allowed() (the faculty's rules) is
-- untouched. "Staying" is a person's choice, so it is checked BESIDE the rule
-- in the three places that ask "may these two swap now": the board's
-- can_swap, rotation_request and rotation_accept.
--
-- Proof: tools/rotation0250-swaps.sql §G.
-- ============================================================

alter table public.rotation_students
  add column if not exists staying boolean not null default false,
  add column if not exists staying_at timestamptz;

comment on column public.rotation_students.staying is
  'The student chose to stay in their current group: no one may ask them, they ask no one. '
  'Owner-written only, via rotation_set_staying(). Public within the round.';

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
  end if;
  insert into public.rotation_events (round_id) values (p_round);
  return jsonb_build_object('ok', true, 'staying', coalesce(p_staying, false),
                            'declined', v_declined, 'cancelled', v_cancelled);
end;
$$;

revoke all on function public.rotation_set_staying(text, boolean) from public, anon;
grant execute on function public.rotation_set_staying(text, boolean) to authenticated;

-- The three readers of "may these two swap now", each now honouring `staying`.
-- (Copied from 0250/0251; the only changes are the lines naming `staying`.
-- create or replace keeps their grants.)

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
      'contact', v_me.contact, 'staying', v_me.staying) end,
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
          'contact', s.contact)
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
  if v_me.staying then return jsonb_build_object('ok', false, 'reason', 'you_staying'); end if;

  if p_target is not null then
    select * into v_t from public.rotation_students where id = p_target and round_id = p_round;
    if not found then return jsonb_build_object('ok', false, 'reason', 'no_such_student'); end if;
    p_to_group := v_t.current_group;
    if not public.rotation_pair_allowed(p_round, v_me, v_t) then
      return jsonb_build_object('ok', false, 'reason', 'not_eligible');
    end if;
    if v_t.staying then return jsonb_build_object('ok', false, 'reason', 'staying'); end if;
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
       and public.rotation_pair_allowed(p_round, v_me, s) and not s.staying;
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
  if v_me.staying then return jsonb_build_object('ok', false, 'reason', 'you_staying'); end if;
  if v_req.staying then return jsonb_build_object('ok', false, 'reason', 'staying'); end if;

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
