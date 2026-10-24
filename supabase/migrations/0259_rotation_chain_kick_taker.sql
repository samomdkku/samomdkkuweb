-- ============================================================
-- 0259 — แลก Rotation: คนตั้งคำชวนแลกต่อเนื่องสามารถกดปฏิเสธ/เตะคนที่เข้ามาร่วมขาเปิดได้
--
-- REQUESTED (owner, 2026-10-24): "make คนตั้งคำชวนสามารถ 'กดปฏิเสธ / เตะคนที่เข้ามาร่วมขาเปิด'
-- ได้โดยไม่ต้องกดยกเลิกทั้ง chain แล้วตั้งใหม่"
--
-- Previously: If someone took an open leg in a chain ("ใครก็ได้ในกลุ่ม X") that the
-- starter didn't want to swap with, the starter had to cancel the entire chain
-- and restart.
--
-- Now: rotation_chain_kick(p_chain uuid, p_seq smallint) clears taker_id and
-- committed_at for that leg while keeping the chain pending and other legs intact,
-- re-opening the leg for anyone else eligible in that group to take.
--
-- Guards:
-- - Must be caller's chain (starter_id = my_row_id) or rotation admin.
-- - Chain must be pending and unexpired.
-- - Leg must exist and have a taker (taker_id is not null).
-- - Must be an open leg (target_id is null) — named invitees cannot be kicked
--   this way because the starter explicitly targeted them.
-- ============================================================

create or replace function public.rotation_chain_kick(p_chain uuid, p_seq smallint)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  c public.rotation_chains;
  l public.rotation_chain_legs;
  v_me uuid;
  v_admin boolean := public.rotation_is_admin();
begin
  select * into c from public.rotation_chains where id = p_chain;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_such_request');
  end if;

  v_me := public.rotation_my_row_id(c.round_id);
  if v_me is null and not v_admin then
    raise exception 'ROTATION_NOT_IN_ROSTER';
  end if;

  if c.starter_id <> v_me and not v_admin then
    return jsonb_build_object('ok', false, 'reason', 'not_yours');
  end if;

  perform pg_advisory_xact_lock(hashtext('rotation:' || c.round_id));

  select * into c from public.rotation_chains where id = p_chain;
  if c.status <> 'pending' then
    return jsonb_build_object('ok', false, 'reason', 'not_pending');
  end if;

  if c.expires_at <= now() then
    update public.rotation_chains set status = 'expired', resolved_at = now() where id = c.id;
    insert into public.rotation_events (round_id) values (c.round_id);
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;

  select * into l from public.rotation_chain_legs where chain_id = c.id and seq = p_seq;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_such_leg');
  end if;

  if l.taker_id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_taker');
  end if;

  if l.target_id is not null then
    return jsonb_build_object('ok', false, 'reason', 'not_open_leg');
  end if;

  update public.rotation_chain_legs
     set taker_id = null, committed_at = null
   where chain_id = c.id and seq = p_seq;

  insert into public.rotation_events (round_id) values (c.round_id);
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.rotation_chain_kick(uuid, smallint) from public, anon;
grant execute on function public.rotation_chain_kick(uuid, smallint) to authenticated;
