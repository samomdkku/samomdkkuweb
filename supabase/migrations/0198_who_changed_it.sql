-- 0198_who_changed_it.sql
--
-- "When someone edits the admin ทีม SAMO and it triggers a Discord change, it
-- should send [to the role-bot channel] who did it, what role is being
-- changed" (owner, 2026-09-19).
--
-- The sync service (0197) only knew THAT something changed. WHO and WHAT exist
-- only inside the editor's own request — auth.uid() / the JWT email — and are
-- gone by the time the service reads the queue. So the triggers capture them at
-- the moment of the write: `actor_name` (the editor, via my_person_id(), the
-- identity the portal already uses everywhere) and `detail` (a Thai sentence a
-- member of the channel can read). A write with no web session — a script, an
-- import, the SQL console — says so instead of naming someone.
--
-- Bodies REPLACE 0197's three trigger functions; the enqueue conditions are
-- unchanged (proof team0197 still passes) and the new columns are asserted by
-- tools/team0198-who-changed-it.sql.

alter table public.discord_sync_queue add column if not exists actor_name text;
alter table public.discord_sync_queue add column if not exists detail text;

-- "ชื่อเล่น (ชื่อ นามสกุล)" for a person id, or a stated unknown.
create or replace function public.discord_person_label(p uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(
    (select case when nullif(btrim(pe.nickname), '') is not null
                 then pe.nickname || coalesce(' (' || nullif(btrim(pe.full_name), '') || ')', '')
                 else coalesce(nullif(btrim(pe.full_name), ''), pe.kkumail) end
       from public.people pe where pe.id = p),
    '(ไม่ทราบชื่อ)')
$$;

-- Who is making THIS request.
create or replace function public.discord_actor_label()
returns text language sql stable security definer set search_path = public as $$
  select coalesce(
    public.discord_person_label(public.my_person_id()) || ' — ' || public.current_user_email(),
    nullif(public.current_user_email(), ''),
    'ไม่ได้แก้ผ่านหน้าเว็บ (สคริปต์ / ผู้ดูแลระบบ)')
$$;

create or replace function public.discord_node_label(n uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select name from public.team_nodes where id = n), '(ตำแหน่งที่ถูกลบ)')
$$;

-- ── team_members ───────────────────────────────────────────────────────────
create or replace function public.discord_enqueue_member()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  actor text := public.discord_actor_label();
  who   text := public.discord_person_label(coalesce(new.person_id, old.person_id));
  what  text;
begin
  if tg_op = 'INSERT' then
    what := 'เพิ่ม ' || who || ' เข้า ' || public.discord_node_label(new.node_id);
  elsif tg_op = 'DELETE' then
    what := 'เอา ' || who || ' ออกจาก ' || public.discord_node_label(old.node_id);
  elsif new.node_id is distinct from old.node_id then
    what := 'ย้าย ' || who || ' จาก ' || public.discord_node_label(old.node_id)
            || ' ไป ' || public.discord_node_label(new.node_id);
  else
    what := 'เปลี่ยนเจ้าของตำแหน่ง ' || public.discord_node_label(new.node_id);
  end if;

  if tg_op in ('UPDATE', 'DELETE') and old.person_id is not null then
    insert into public.discord_sync_queue (kind, person_id, reason, actor_name, detail)
    values ('person', old.person_id, 'team_members ' || lower(tg_op), actor, what);
  end if;
  if tg_op in ('INSERT', 'UPDATE') and new.person_id is not null
     and (tg_op = 'INSERT' or new.person_id is distinct from old.person_id) then
    insert into public.discord_sync_queue (kind, person_id, reason, actor_name, detail)
    values ('person', new.person_id, 'team_members ' || lower(tg_op), actor, what);
  end if;
  return null;
end $$;

-- ── discord_links ──────────────────────────────────────────────────────────
create or replace function public.discord_enqueue_link()
returns trigger language plpgsql security definer set search_path = public as $$
declare who text := public.discord_person_label(coalesce(new.person_id, old.person_id));
begin
  if tg_op = 'UPDATE' and new.discord_user_id is not distinct from old.discord_user_id then
    return null;
  end if;
  insert into public.discord_sync_queue (kind, person_id, reason, actor_name, detail)
  values ('structure', coalesce(new.person_id, old.person_id), 'discord_links ' || lower(tg_op),
          public.discord_actor_label(),
          case tg_op when 'INSERT' then who || ' เชื่อมบัญชี Discord'
                     when 'DELETE' then who || ' ยกเลิกการเชื่อม Discord'
                     else who || ' เปลี่ยนบัญชี Discord' end);
  return null;
end $$;

-- ── team_nodes ─────────────────────────────────────────────────────────────
create or replace function public.discord_enqueue_node()
returns trigger language plpgsql security definer set search_path = public as $$
declare actor text := public.discord_actor_label(); what text;
begin
  if tg_op = 'UPDATE' then
    if new.name is distinct from old.name and new.discord_role_id is not null then
      insert into public.discord_sync_queue (kind, node_id, reason, actor_name, detail)
      values ('rename', new.id, 'team_nodes rename', actor,
              'เปลี่ยนชื่อ ' || old.name || ' → ' || new.name);
    end if;
    if new.parent_id is not distinct from old.parent_id
       and new.kind is not distinct from old.kind
       and new.discord_role is not distinct from old.discord_role
       and new.discord_role_id is not distinct from old.discord_role_id then
      return null;
    end if;
    what := case
      when new.parent_id is distinct from old.parent_id
        then 'ย้าย ' || new.name || ' ไปอยู่ใต้ ' || coalesce(public.discord_node_label(new.parent_id), 'ระดับบนสุด')
      when new.discord_role is distinct from old.discord_role
        then case when new.discord_role then 'เปิด' else 'ปิด' end || ' role Discord ของ ' || new.name
      when new.kind is distinct from old.kind then 'เปลี่ยนประเภทของ ' || new.name
      else 'ผูก role Discord ของ ' || new.name || ' ใหม่' end;
  elsif tg_op = 'INSERT' then what := 'สร้าง ' || new.name;
  else what := 'ลบ ' || old.name;
  end if;
  insert into public.discord_sync_queue (kind, node_id, reason, actor_name, detail)
  values ('structure', coalesce(new.id, old.id), 'team_nodes ' || lower(tg_op), actor, what);
  return null;
end $$;

revoke execute on function public.discord_person_label(uuid) from public, anon, authenticated;
revoke execute on function public.discord_actor_label() from public, anon, authenticated;
revoke execute on function public.discord_node_label(uuid) from public, anon, authenticated;
revoke execute on function public.discord_enqueue_member() from public, anon, authenticated;
revoke execute on function public.discord_enqueue_link() from public, anon, authenticated;
revoke execute on function public.discord_enqueue_node() from public, anon, authenticated;
