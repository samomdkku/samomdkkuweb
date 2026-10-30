-- ============================================================
-- 0265 — แลก Rotation: a classmate's kkumail, one at a time.
--
-- REPORTED (owner, 2026-10-30): the off-criteria ask sheet ("ช่องทางติดต่อ
-- นอกรอบ") always printed "KKU Mail: -". The page read `t.kkumail`, which
-- rotation_board() has never sent. Measured on production: 84 of 161 students
-- have no contact filled in, and all 161 have a kkumail — so for half the
-- cohort the address was the ONLY way to reach them, and the sheet asks you to
-- talk first.
--
-- WHY A SEPARATE RPC, NOT A BOARD FIELD: rotation_board() is the hot read that
-- took the site down on 2026-10-24 (0258) and is re-read by every open page on
-- every change. Adding 161 addresses to it would put every address in every
-- payload; this hands out ONE, when a person opens the sheet.
--
-- Who may read whose: a caller on the PUBLISHED roster may read a classmate of
-- the SAME gender in the same round — the only people they could ever swap
-- with (rotation_pair_allowed requires same gender). Rotation admins: anyone.
-- Additive only: no existing function changes.
--
-- Proof: tools/rotation0265-contact-email.sql (ALLOW + DENY, rolls back).
-- ============================================================

create or replace function public.rotation_contact_email(p_round text, p_student uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_admin boolean := public.rotation_is_admin();
  v_me_id uuid    := public.rotation_my_row_id(p_round);
  v_me    public.rotation_students;
  v_t     public.rotation_students;
  v_pub   boolean;
begin
  if auth.uid() is null then raise exception 'ROTATION_NOT_IN_ROSTER'; end if;
  if v_me_id is null and not v_admin then raise exception 'ROTATION_NOT_IN_ROSTER'; end if;

  select * into v_t from public.rotation_students where id = p_student and round_id = p_round;
  if not found then return jsonb_build_object('ok', false, 'reason', 'no_such_student'); end if;

  if not v_admin then
    select published into v_pub from public.rotation_rounds where id = p_round;
    if not coalesce(v_pub, false) then return jsonb_build_object('ok', false, 'reason', 'closed'); end if;
    select * into v_me from public.rotation_students where id = v_me_id;
    if v_t.id = v_me.id or v_t.gender is distinct from v_me.gender then
      return jsonb_build_object('ok', false, 'reason', 'not_eligible');
    end if;
  end if;

  return jsonb_build_object('ok', true, 'kkumail', v_t.kkumail);
end;
$$;

revoke all on function public.rotation_contact_email(text, uuid) from public, anon;
grant execute on function public.rotation_contact_email(text, uuid) to authenticated;
