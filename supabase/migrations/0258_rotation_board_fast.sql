-- ============================================================
-- 0258 — EMERGENCY: rotation_board() was ~2 s per call; make it cheap.
--
-- INCIDENT (owner, 2026-10-24 ~21:00 ICT, round open): "that makes the web
-- crash everyone can't use it" — /rotation showed "โหลดข้อมูลไม่สำเร็จ ·
-- signal is aborted without reason" (dbRest's 15 s timeout). Every write pings
-- rotation_events and EVERY open page re-reads the board at once; at ~2 s of
-- database time per read, a burst from the whole cohort queued in PostgREST's
-- small connection pool past 15 s — and that pool serves the WHOLE site.
--
-- Measured on production: per-student `signed_in` subquery scanned public.users
-- with lower(btrim(email)) once PER STUDENT (~0.5 s), rotation_wishes_of() per
-- student (~0.3 s), chain legs re-ran rotation_swaps_live() per leg.
--
-- SAME OUTPUT, set-based: one hashed email set, people joined once, wishes by
-- one lateral aggregate, swaps_live computed once. The rule itself is
-- untouched — can_swap / can_take still ask rotation_pair_allowed().
-- Proof: tools/rotation0250-swaps.sql (unchanged expectations).
-- ============================================================

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
          -- can_swap = "I may ASK them": the criteria AND they have not chosen to stay.
          'can_swap', case when v_me_id is null or s.staying or s.id = v_me_id then false
                           else public.rotation_pair_allowed(p_round, v_me, s) end,
          'staying', s.staying,
          'nickname', nullif(btrim(p.nickname), ''),
          'contact', s.contact,
          'wishes', case when s.staying then '[]'::jsonb else coalesce(w.g, '[]'::jsonb) end)
        -- Everyone's GPA: ONLY a named GPA viewer (0254) — not admins, not master.
        || case when v_gpa then jsonb_build_object('gpa', s.gpa) else '{}'::jsonb end
        order by s.current_group, s.student_id)
        from public.rotation_students s
        left join public.people p on p.id = s.person_id
        left join em on s.kkumail is not null and em.e = lower(btrim(s.kkumail))
        left join lateral (select jsonb_agg(x.to_group order by x.rank) as g from public.rotation_wishes x
                            where x.student_id = s.id and x.to_group <> s.current_group) w on true
       where s.round_id = p_round), '[]'::jsonb),
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
