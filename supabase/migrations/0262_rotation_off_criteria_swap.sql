-- ============================================================
-- 0262 — แลก Rotation: off-criteria swaps (0.2–0.3, missing GPA, >0.3)
-- with offline agreement + anti-probing GPA edit lock (max 3).
--
-- REQUIREMENT:
-- 1. Support self-declared off-criteria swaps between two students who
--    verbally agreed offline / with academic staff:
--      - 'diff_02_03'  : 0.20 < |diff| <= 0.30
--      - 'missing_gpa' : at least one person has gpa is null
--      - 'diff_over_03': |diff| > 0.30
-- 2. Strictly 1-to-1 (direct target required; never broadcast).
-- 3. Gender match strictly preserved (ward rules).
-- 4. Anti-spam: max 1 pending off-criteria ask per student.
-- 5. Anti-probing: rotation_set_gpa locks after 3 edits (ROTATION_GPA_LOCKED).
-- ============================================================

-- §1 — Schema alterations
alter table public.rotation_requests
  add column if not exists off_criteria boolean not null default false,
  add column if not exists off_criteria_reason text;

alter table public.rotation_requests
  drop constraint if exists rotation_requests_off_criteria_reason_check;

alter table public.rotation_requests
  add constraint rotation_requests_off_criteria_reason_check
  check (off_criteria_reason is null or off_criteria_reason in ('diff_02_03', 'missing_gpa', 'diff_over_03'));

alter table public.rotation_moves
  add column if not exists off_criteria_reason text;

alter table public.rotation_moves
  drop constraint if exists rotation_moves_off_criteria_reason_check;

alter table public.rotation_moves
  add constraint rotation_moves_off_criteria_reason_check
  check (off_criteria_reason is null or off_criteria_reason in ('diff_02_03', 'missing_gpa', 'diff_over_03'));

alter table public.rotation_moves
  drop constraint if exists rotation_moves_kind_check;

alter table public.rotation_moves
  add constraint rotation_moves_kind_check
  check (kind in ('swap', 'admin', 'chain', 'off_criteria'));

-- §2 — Helper functions for off-criteria eligibility
create or replace function public.rotation_pair_off_criteria_reason(
  p_round text, a public.rotation_students, b public.rotation_students)
returns text language sql stable security definer set search_path = public as $$
  select case
           when a.id = b.id or a.round_id <> p_round or b.round_id <> p_round
                or a.current_group = b.current_group or a.gender <> b.gender
                or public.rotation_pair_allowed(p_round, a, b) then null
           when a.gpa is null or b.gpa is null then 'missing_gpa'
           when abs(a.gpa - b.gpa) <= 0.30 then 'diff_02_03'
           else 'diff_over_03'
         end;
$$;
revoke all on function public.rotation_pair_off_criteria_reason(text, public.rotation_students, public.rotation_students) from public, anon, authenticated;

create or replace function public.rotation_pair_off_criteria_allowed(
  p_round text, a public.rotation_students, b public.rotation_students)
returns boolean language sql stable security definer set search_path = public as $$
  select public.rotation_pair_off_criteria_reason(p_round, a, b) is not null;
$$;
revoke all on function public.rotation_pair_off_criteria_allowed(text, public.rotation_students, public.rotation_students) from public, anon, authenticated;

-- §3 — RPC rotation_request with p_off_criteria support
drop function if exists public.rotation_request(text, uuid, text);
drop function if exists public.rotation_request(text, uuid, text, boolean);

create or replace function public.rotation_request(
  p_round text,
  p_target uuid,
  p_to_group text,
  p_off_criteria boolean default false
)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_me_id uuid := public.rotation_my_row_id(p_round);
  v_me    public.rotation_students;
  v_t     public.rotation_students;
  v_round public.rotation_rounds;
  v_id    uuid;
  v_eligible int;
  v_reason text;
begin
  if v_me_id is null then raise exception 'ROTATION_NOT_IN_ROSTER'; end if;
  perform pg_advisory_xact_lock(hashtext('rotation:' || p_round));
  if not public.rotation_swaps_live(p_round) then
    return jsonb_build_object('ok', false, 'reason', 'closed');
  end if;
  select * into v_round from public.rotation_rounds where id = p_round;
  select * into v_me from public.rotation_students where id = v_me_id;
  if v_me.staying then return jsonb_build_object('ok', false, 'reason', 'you_staying'); end if;

  if p_off_criteria then
    -- Off-criteria requests MUST be direct to a target, never broadcast.
    if p_target is null then
      return jsonb_build_object('ok', false, 'reason', 'cannot_broadcast_off_criteria');
    end if;
    -- Anti-spam: only 1 pending off-criteria request at a time
    if exists (select 1 from public.rotation_requests where requester_id = v_me.id and off_criteria and status = 'pending') then
      return jsonb_build_object('ok', false, 'reason', 'too_many_off_criteria');
    end if;
    select * into v_t from public.rotation_students where id = p_target and round_id = p_round;
    if not found then return jsonb_build_object('ok', false, 'reason', 'no_such_student'); end if;
    p_to_group := v_t.current_group;
    if v_t.staying then return jsonb_build_object('ok', false, 'reason', 'staying'); end if;
    v_reason := public.rotation_pair_off_criteria_reason(p_round, v_me, v_t);
    if v_reason is null then
      return jsonb_build_object('ok', false, 'reason', 'not_eligible');
    end if;
    if exists (select 1 from public.rotation_requests where requester_id = v_me.id
                 and target_id = p_target and status = 'pending') then
      return jsonb_build_object('ok', false, 'reason', 'duplicate');
    end if;
  else
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
  end if;

  if (select count(*) from public.rotation_requests
       where requester_id = v_me.id and status = 'pending') >= v_round.max_pending then
    return jsonb_build_object('ok', false, 'reason', 'too_many');
  end if;

  insert into public.rotation_requests (
    round_id, requester_id, target_id, from_group, to_group, off_criteria, off_criteria_reason
  ) values (
    p_round, v_me.id, p_target, v_me.current_group, p_to_group, p_off_criteria, v_reason
  ) returning id into v_id;
  insert into public.rotation_events (round_id) values (p_round);
  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

revoke all on function public.rotation_request(text, uuid, text, boolean) from public, anon;
grant execute on function public.rotation_request(text, uuid, text, boolean) to authenticated;

-- §4 — RPC rotation_accept with off_criteria support
create or replace function public.rotation_accept(p_request uuid)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  q     public.rotation_requests;
  v_me_id uuid;
  v_me  public.rotation_students;
  v_req public.rotation_students;
  v_closed int;
  v_kind text;
begin
  select * into q from public.rotation_requests where id = p_request;
  if not found then return jsonb_build_object('ok', false, 'reason', 'no_such_request'); end if;
  v_me_id := public.rotation_my_row_id(q.round_id);
  if v_me_id is null then raise exception 'ROTATION_NOT_IN_ROSTER'; end if;

  perform pg_advisory_xact_lock(hashtext('rotation:' || q.round_id));
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

  if v_req.current_group <> q.from_group or v_me.current_group <> q.to_group then
    if q.target_id is not null or v_req.current_group <> q.from_group then
      update public.rotation_requests set status = 'superseded', resolved_at = now() where id = q.id;
      insert into public.rotation_events (round_id) values (q.round_id);
    end if;
    return jsonb_build_object('ok', false, 'reason', 'stale');
  end if;

  if q.off_criteria then
    if not public.rotation_pair_off_criteria_allowed(q.round_id, v_req, v_me) then
      return jsonb_build_object('ok', false, 'reason', 'not_eligible');
    end if;
    v_kind := 'off_criteria';
  else
    if not public.rotation_pair_allowed(q.round_id, v_req, v_me) then
      return jsonb_build_object('ok', false, 'reason', 'not_eligible');
    end if;
    v_kind := 'swap';
  end if;

  update public.rotation_students set current_group = q.to_group,   updated_at = now() where id = v_req.id;
  update public.rotation_students set current_group = q.from_group, updated_at = now() where id = v_me.id;
  update public.rotation_requests
     set status = 'accepted', accepted_by = v_me.id, resolved_at = now()
   where id = q.id;
  insert into public.rotation_moves (round_id, student_id, from_group, to_group, request_id, kind, off_criteria_reason, by_user)
  values (q.round_id, v_req.id, q.from_group, q.to_group, q.id, v_kind, q.off_criteria_reason, auth.uid()),
         (q.round_id, v_me.id,  q.to_group,   q.from_group, q.id, v_kind, q.off_criteria_reason, auth.uid());
  v_closed := public.rotation_supersede_for(q.round_id, array[v_req.id, v_me.id]);
  insert into public.rotation_events (round_id) values (q.round_id);
  return jsonb_build_object('ok', true, 'requester_group', q.to_group, 'my_group', q.from_group,
                            'closed_other_requests', v_closed);
end;
$$;

revoke all on function public.rotation_accept(uuid) from public, anon;
grant execute on function public.rotation_accept(uuid) to authenticated;

-- §5 — RPC rotation_set_gpa with max 3 edits hard lock
create or replace function public.rotation_set_gpa(p_round text, p_gpa numeric)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_me uuid := public.rotation_my_row_id(p_round);
  v_count int;
begin
  if v_me is null then raise exception 'ROTATION_NOT_IN_ROSTER'; end if;
  if p_gpa is not null and (p_gpa < 0 or p_gpa > 4) then raise exception 'ROTATION_GPA_RANGE'; end if;
  perform pg_advisory_xact_lock(hashtext('rotation:' || p_round));

  select count(*) into v_count from public.rotation_gpa_audit where student_id = v_me;
  if v_count >= 3 then
    raise exception 'ROTATION_GPA_LOCKED';
  end if;

  update public.rotation_students
     set gpa = round(p_gpa, 2), gpa_updated_at = now(), updated_at = now()
   where id = v_me;
  insert into public.rotation_events (round_id) values (p_round);
  return jsonb_build_object('ok', true, 'gpa', round(p_gpa, 2), 'gpa_band', public.rotation_gpa_band(p_gpa), 'gpa_edit_count', v_count + 1);
end;
$$;

revoke all on function public.rotation_set_gpa(text, numeric) from public, anon;
grant execute on function public.rotation_set_gpa(text, numeric) to authenticated;

-- §6 — RPC rotation_board with off_criteria and gpa_edit_count
create or replace function public.rotation_board(p_round text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_admin boolean := public.rotation_is_admin();
  v_gpa   boolean := public.rotation_is_gpa_viewer();
  v_me_id uuid    := public.rotation_my_row_id(p_round);
  v_me    public.rotation_students;
  v_round public.rotation_rounds;
  v_live  boolean;
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
  v_live := public.rotation_swaps_live(p_round);

  return jsonb_build_object(
    'state', 'ok',
    'is_admin', v_admin,
    'gpa_viewer', v_gpa,
    'round', jsonb_build_object(
      'id', v_round.id, 'title', v_round.title, 'groups', to_jsonb(v_round.groups),
      'published', v_round.published, 'swaps_open', v_round.swaps_open,
      'swaps_close_at', v_round.swaps_close_at, 'gpa_rule', v_round.gpa_rule,
      'swaps_live', v_live,
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
      'gpa_edit_count', coalesce((select count(*) from public.rotation_gpa_audit a where a.student_id = v_me.id), 0),
      'nickname', (select nullif(btrim(p.nickname), '') from public.people p where p.id = v_me.person_id),
      'contact', v_me.contact, 'staying', v_me.staying,
      'wishes', public.rotation_wishes_of(v_me)) end,
    'students', coalesce((
      with em as (select distinct lower(btrim(u.email)) as e from public.users u where u.email is not null)
      select jsonb_agg(jsonb_build_object(
          'id', s.id, 'student_id', s.student_id, 'prefix', s.prefix,
          'first_name', s.first_name, 'last_name', s.last_name, 'gender', s.gender,
          'original_group', s.original_group, 'current_group', s.current_group,
          'signed_in', p.user_id is not null or em.e is not null,
          'can_swap', case when v_me_id is null or s.staying or s.id = v_me_id then false
                           else public.rotation_pair_allowed(p_round, v_me, s) end,
          'can_off_criteria_swap', case when v_me_id is null or s.staying or s.id = v_me_id then false
                                        else public.rotation_pair_off_criteria_allowed(p_round, v_me, s) end,
          'off_criteria_reason', case when v_me_id is null or s.staying or s.id = v_me_id then null
                                      else public.rotation_pair_off_criteria_reason(p_round, v_me, s) end,
          'staying', s.staying,
          'has_gpa', s.gpa is not null,
          'nickname', nullif(btrim(p.nickname), ''),
          'contact', s.contact,
          'wishes', case when s.staying then '[]'::jsonb else coalesce(w.g, '[]'::jsonb) end)
        || case when v_gpa then jsonb_build_object('gpa', s.gpa) else '{}'::jsonb end
        order by s.current_group, s.student_id)
        from public.rotation_students s
        left join public.people p on p.id = s.person_id
        left join em on s.kkumail is not null and em.e = lower(btrim(s.kkumail))
        left join lateral (select jsonb_agg(x.to_group order by x.rank) as g from public.rotation_wishes x
                            where x.student_id = s.id and x.to_group <> s.current_group) w on true
       where s.round_id = p_round), '[]'::jsonb),
    'requests', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', q.id, 'requester_id', q.requester_id, 'target_id', q.target_id,
          'from_group', q.from_group, 'to_group', q.to_group, 'status', q.status,
          'off_criteria', q.off_criteria, 'off_criteria_reason', q.off_criteria_reason,
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
          'request_id', m.request_id, 'chain_id', m.chain_id, 'kind', m.kind,
          'off_criteria_reason', m.off_criteria_reason, 'at', m.at)
        order by m.at desc, m.id desc)
        from public.rotation_moves m where m.round_id = p_round), '[]'::jsonb),
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
                                    and v_me_id <> c.starter_id and not v_me.staying and v_live
                                    and not exists (select 1 from public.rotation_chain_legs l2
                                                     where l2.chain_id = c.id and l2.taker_id = v_me_id)
                                    and case when v_me.current_group = l.from_group
                                             then public.rotation_pair_allowed(p_round, st, v_me) else false end)
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

revoke all on function public.rotation_board(text) from public, anon;
grant execute on function public.rotation_board(text) to authenticated;
