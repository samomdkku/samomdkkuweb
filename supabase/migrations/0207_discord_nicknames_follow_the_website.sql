-- ============================================================
-- 0207 — Discord nicknames follow ทีม SAMO (DISCORD-ROLE-SYNC §8e.2)
--
-- ASKED (owner, 2026-09-23): rename people in Discord to the server's pattern
-- `ชื่อเล่น_#ชั้นปี_XXX-X` from the ทีม SAMO data, and keep it right
-- automatically, in real time. §8e.2 designed exactly this ("the nickname is
-- the OUTPUT: the bot writes it FROM ทีม SAMO") and it was never built.
--
-- WHAT THIS MIGRATION ADDS — the database half only:
--   1. discord_nickname_inputs() — for every LINKED person, the ingredients of
--      the name: ชื่อเล่น, รหัสนักศึกษา, ปีที่เข้า, year_offset. NOT the name:
--      ชั้นปี has ONE implementation, src/js/study-year.js ("THERE IS
--      DELIBERATELY NO SQL TWIN"), and the service imports that file.
--   2. A trigger on public.people that queues a LINKED person when one of those
--      ingredients changes, so an edit reaches Discord in seconds. An unlinked
--      person has no Discord account to rename: nothing is queued for them.
--      The yearly ชั้นปี rollover changes no row — the service's 15-minute full
--      pass picks it up.
--
-- WHO MAY CALL (1): service_role only, like shop_order_totals (0206). SECURITY
-- INVOKER: the service key bypasses RLS and needs no elevation; a student
-- calling it with the grant forced open would read through the RLS they
-- already have — on discord_links, their own row.
-- ============================================================

create or replace function public.discord_nickname_inputs()
returns table (discord_user_id text, person_id uuid, nickname text,
               student_id text, cohort_year smallint, year_offset smallint)
language sql stable
security invoker
set search_path = public
as $$
  select l.discord_user_id, p.id, p.nickname, p.student_id, p.cohort_year, p.year_offset
    from public.discord_links l
    join public.people p on p.id = l.person_id;
$$;

revoke all on function public.discord_nickname_inputs() from public, anon, authenticated;
grant execute on function public.discord_nickname_inputs() to service_role;

-- ── queue a linked person whose name ingredients changed ───────────────────
create or replace function public.discord_enqueue_person_name()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.nickname    is not distinct from old.nickname
     and new.student_id  is not distinct from old.student_id
     and new.cohort_year is not distinct from old.cohort_year
     and new.year_offset is not distinct from old.year_offset then
    return null;
  end if;
  if not exists (select 1 from public.discord_links l where l.person_id = new.id) then
    return null;
  end if;
  insert into public.discord_sync_queue (kind, person_id, reason, actor_name, detail)
  values ('person', new.id, 'people name', public.discord_actor_label(),
          'แก้ข้อมูลของ ' || public.discord_person_label(new.id)
          || case when new.nickname is distinct from old.nickname
                  then ' (ชื่อเล่น ' || coalesce(old.nickname, '—') || ' → ' || coalesce(new.nickname, '—') || ')'
                  else '' end);
  return null;
end $$;

drop trigger if exists discord_enqueue_person_name on public.people;
create trigger discord_enqueue_person_name
  after update of nickname, student_id, cohort_year, year_offset on public.people
  for each row execute function public.discord_enqueue_person_name();

revoke execute on function public.discord_enqueue_person_name() from public, anon, authenticated;
