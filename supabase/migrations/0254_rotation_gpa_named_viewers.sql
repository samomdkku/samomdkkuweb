-- ============================================================
-- 0254 — แลก Rotation: everyone's GPA is visible to NAMED people only.
--
-- REQUESTED (owner, 2026-10-24): "don't make every people sees the grades of
-- every people, even masters because some people abuse it, make only for now
-- only me … can see".
--
-- 0251 already took GPA away from admins (role dev, the `rotation` permission,
-- and so every `master`). This adds the one exception the owner wants: a short
-- list of ACCOUNTS — not a role, not a permission — that read every student's
-- GPA on the board. A permission would be folded into `master` like every other
-- (0081: master holds them all), which is exactly what the owner ruled out.
--
--   rotation_gpa_viewers   user_id → auth account. RLS on, NO policy, no grant:
--                          nobody reads or writes it through the API. Rows are
--                          added by hand in SQL (the repo is public, so the
--                          owner's address is not written here):
--     insert into public.rotation_gpa_viewers (user_id, note)
--     select id, 'owner' from public.users where lower(btrim(email)) = '<kkumail>';
--
-- rotation_board() gains `gpa_viewer` and, for such a caller only, `gpa` on
-- every student. Everything else is 0252's board unchanged.
--
-- Proof: tools/rotation0250-swaps.sql §I.
-- ============================================================

create table if not exists public.rotation_gpa_viewers (
  user_id  uuid primary key references auth.users (id) on delete cascade,
  note     text,
  added_at timestamptz not null default now()
);
alter table public.rotation_gpa_viewers enable row level security;
revoke all on public.rotation_gpa_viewers from public, anon, authenticated;

comment on table public.rotation_gpa_viewers is
  'Accounts that may read EVERY rotation student''s GPA on rotation_board(). Owner-curated by SQL; '
  'deliberately not a permission (master would inherit it). No policy: unreadable through the API.';

create or replace function public.rotation_is_gpa_viewer()
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null
     and exists (select 1 from public.rotation_gpa_viewers v where v.user_id = auth.uid());
$$;
revoke all on function public.rotation_is_gpa_viewer() from public, anon, authenticated;
-- internal: called only from inside rotation_board (definer)

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
          'request_id', m.request_id, 'kind', m.kind, 'at', m.at)
        order by m.at desc, m.id desc)
        from public.rotation_moves m where m.round_id = p_round), '[]'::jsonb)
  );
end;
$$;
