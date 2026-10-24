-- ============================================================
-- 0251 — แลก Rotation: a GPA is seen by its OWNER only; nickname + contact.
--
-- REQUESTED (owner, 2026-10-24, after 0250 shipped):
--   • "don't show the gpa data for other people to view for everyone". 0250 gave
--     every admin (role dev, the `rotation` permission — and so all 48 `master`
--     holders) each student's GPA in `students[]`. Now NOBODY reads another
--     person's GPA through the board: a student sees their own under `me`, an
--     admin sees only `round.gpa_filled` (a count). The band rule still works —
--     it is decided inside rotation_pair_allowed(), which never returned a GPA.
--   • "please fill in nickname" — from public.people.nickname (the one person
--     registry, 0132; all 161 rows carry one). Not copied: a copy would drift
--     from the registry (mistakes.md class 6). A student edits it at /me.
--   • "can fill contact data they can fill the text any like line, ig etc" —
--     `rotation_students.contact`, free text ≤ 200 chars, written by its owner
--     through rotation_set_contact(). Readable by everyone the board is
--     readable by (the cohort + admins) — the page says so beside the field.
--
-- Only rotation_board() changes shape; every other 0250 function is untouched.
-- Proof: tools/rotation0250-swaps.sql (§B now asserts the admin board carries
-- no GPA, and §F covers contact).
-- ============================================================

alter table public.rotation_students
  add column if not exists contact text check (contact is null or char_length(contact) <= 200),
  add column if not exists contact_updated_at timestamptz;

comment on column public.rotation_students.contact is
  'Free text the student writes so classmates can reach them (LINE, IG, phone…). '
  'Visible to everyone who can read rotation_board() for this round. Owner-written only, via rotation_set_contact().';

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
      'contact', v_me.contact) end,
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
                           else public.rotation_pair_allowed(p_round, v_me, s) end,
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

create or replace function public.rotation_set_contact(p_round text, p_contact text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_me uuid := public.rotation_my_row_id(p_round);
  v_c  text := nullif(btrim(regexp_replace(coalesce(p_contact, ''), '\s+', ' ', 'g')), '');
begin
  if v_me is null then raise exception 'ROTATION_NOT_IN_ROSTER'; end if;
  if char_length(v_c) > 200 then return jsonb_build_object('ok', false, 'reason', 'too_long'); end if;
  perform pg_advisory_xact_lock(hashtext('rotation:' || p_round));
  update public.rotation_students
     set contact = v_c, contact_updated_at = now(), updated_at = now()
   where id = v_me;
  insert into public.rotation_events (round_id) values (p_round);
  return jsonb_build_object('ok', true, 'contact', v_c);
end;
$$;

revoke all on function public.rotation_set_contact(text, text) from public, anon;
grant execute on function public.rotation_set_contact(text, text) to authenticated;
-- create or replace keeps rotation_board's 0250 grants (authenticated only).
