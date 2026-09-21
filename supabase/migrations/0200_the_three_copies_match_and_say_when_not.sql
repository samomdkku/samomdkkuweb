-- 0200_the_three_copies_match_and_say_when_not.sql
--
-- "it should all sync, the main card, teamsamo, ระบบบ้าน, it should able to
-- detect if there's mismatch also." (owner, 2026-09-21)
--
-- WHAT WAS WRONG. Measured on production the same day, every synced column of
-- every placement against its `people` row: 38 disagreements — 32 house
-- photo_focus, 2 house photo_url, 2 house year_offset, 1 ทีม SAMO cohort_year,
-- 1 ทีม SAMO photo_focus. Every one had the SAME shape: one side holds a value,
-- the other is EMPTY — and every row was CONNECTED to an already-existing person
-- on 2026-09-14/15/19 (the duplicate merge, "place 10 more", a new posting).
--
-- WHY. The mirrors are change-driven: people → placements fires on an UPDATE
-- of `people`. Connecting a placement to a person who already exists is a
-- MERGE, but to Postgres it is an INSERT (or a person_id change) on the
-- placement. The up-mirror then pushes the placement's non-empty values into
-- `people` — and when that changes nothing, `people` is never updated, the
-- down-mirror never runs, and the new placement keeps its blanks for ever.
-- (Same "stalled hop" as 0194, from the connect side.)
--
-- Separately, `student_mirror_up` SET photo_url/photo_focus but left both out
-- of its `is distinct from` guard, so a house edit that changed ONLY the photo
-- was judged "nothing changed" and never reached `people`.
--
-- THE FIX, one home for each part:
--   1. public._registry_mismatches(person) — THE definition of "the copies
--      disagree": every column person_mirror_down carries, compared the way a
--      reader sees it (students.nickname is the GENERATED value, see 0134).
--   2. public._registry_sync_person(person) — fill each EMPTY registry field
--      from a placement that has it (house first, then ทีม SAMO), then write
--      `people`, which fires the ONE existing down-mirror to every placement.
--      No second down-mirror is written: a second copy of that rule is exactly
--      the drift being fixed.
--   3. zz_registry_link_sync — AFTER a placement is connected (INSERT, or its
--      person_id changes), if its person now disagrees anywhere, sync it. Named
--      `zz_` so it runs after every other AFTER trigger on the table,
--      including the insert-up mirror whose result it checks.
--   4. student_mirror_up's guard now includes the photo, compared the same way
--      it is SET (coalesce), so the guard stays a termination condition.
--   5. registry_mismatches() / repair_registry_mismatches() — gated wrappers the
--      ระบบบ้าน admin panel reads, so a mismatch is SEEN, not only proved.
--   6. The 38 rows repaired at the end of this file.
--
-- "Empty is filled, a value is kept": a repair never overwrites a value with a
-- blank, and never overwrites the main card with a placement's value — the
-- main card is the registry (0132). Removing a photo still works: that goes
-- through the ทีม SAMO card, whose up-mirror carries the null, and 1 is only
-- run when a placement is CONNECTED, never on an ordinary edit.
-- Proof: tools/house0200-three-copies.sql.

-- ── 1. what "disagree" means ───────────────────────────────────────────────
create or replace function public._registry_mismatches(p_person uuid default null)
returns table (kind text, placement_id text, person_id uuid, columns text[])
language sql stable security definer set search_path = public as $$
  select 'team'::text, m.id::text, p.id,
    array_remove(array[
      case when m.full_name     is distinct from p.full_name     then 'full_name' end,
      case when m.first_name_th is distinct from p.first_name_th then 'first_name_th' end,
      case when m.last_name_th  is distinct from p.last_name_th  then 'last_name_th' end,
      case when m.nickname      is distinct from p.nickname      then 'nickname' end,
      case when m.major         is distinct from p.major         then 'major' end,
      case when m.photo_url     is distinct from p.photo_url     then 'photo_url' end,
      case when m.photo_focus   is distinct from p.photo_focus   then 'photo_focus' end,
      case when m.student_id    is distinct from p.student_id    then 'student_id' end,
      case when m.cohort_year   is distinct from p.cohort_year   then 'cohort_year' end,
      case when m.year_offset   is distinct from p.year_offset   then 'year_offset' end,
      case when m.kkumail       is distinct from p.kkumail       then 'kkumail' end
    ]::text[], null)
    from public.team_members m join public.people p on p.id = m.person_id
   where (p_person is null or p.id = p_person)
     and (m.full_name, m.first_name_th, m.last_name_th, m.nickname, m.major,
          m.photo_url, m.photo_focus, m.student_id, m.cohort_year, m.year_offset, m.kkumail)
         is distinct from
         (p.full_name, p.first_name_th, p.last_name_th, p.nickname, p.major,
          p.photo_url, p.photo_focus, p.student_id, p.cohort_year, p.year_offset, p.kkumail)
  union all
  select 'house'::text, s.id::text, p.id,
    array_remove(array[
      case when s.first_name_th is distinct from p.first_name_th then 'first_name_th' end,
      case when s.last_name_th  is distinct from p.last_name_th  then 'last_name_th' end,
      case when s.nickname      is distinct from p.nickname      then 'nickname' end,
      case when s.student_id    is distinct from p.student_id    then 'student_id' end,
      case when s.major         is distinct from p.major         then 'major' end,
      case when s.cohort_year   is distinct from p.cohort_year   then 'cohort_year' end,
      case when s.year_offset   is distinct from p.year_offset   then 'year_offset' end,
      case when s.photo_url     is distinct from p.photo_url     then 'photo_url' end,
      case when s.photo_focus   is distinct from p.photo_focus   then 'photo_focus' end,
      case when s.bio           is distinct from p.bio           then 'bio' end
    ]::text[], null)
    from public.students s join public.people p on p.id = s.person_id
   where (p_person is null or p.id = p_person)
     and (s.first_name_th, s.last_name_th, s.nickname, s.student_id, s.major,
          s.cohort_year, s.year_offset, s.photo_url, s.photo_focus, s.bio)
         is distinct from
         (p.first_name_th, p.last_name_th, p.nickname, p.student_id, p.major,
          p.cohort_year, p.year_offset, p.photo_url, p.photo_focus, p.bio)
$$;
revoke all on function public._registry_mismatches(uuid) from public, anon, authenticated;

-- ── 2. sync ONE person: fill the registry's blanks, then let the one
--       down-mirror carry it to every placement ─────────────────────────────
create or replace function public._registry_sync_person(p_person uuid)
returns void language plpgsql security definer set search_path = public as $$
declare s public.students; m public.team_members;
begin
  select * into s from public.students     where person_id = p_person order by updated_at desc nulls last limit 1;
  select * into m from public.team_members where person_id = p_person order by updated_at desc nulls last limit 1;
  -- Every column people_mirror_down listens to is in this SET list, so the
  -- trigger fires even when nothing was blank, and pushes the registry down.
  -- kkumail is the identity key and is never filled from a placement.
  update public.people p set
    first_name_th = coalesce(p.first_name_th, s.first_name_th, m.first_name_th),
    last_name_th  = coalesce(p.last_name_th,  s.last_name_th,  m.last_name_th),
    full_name     = coalesce(p.full_name,     m.full_name),
    nickname      = coalesce(p.nickname,      s.nickname,      m.nickname),
    student_id    = coalesce(p.student_id,    s.student_id,    m.student_id),
    major         = coalesce(p.major,         s.major,         m.major),
    cohort_year   = coalesce(p.cohort_year,   s.cohort_year,   m.cohort_year),
    year_offset   = coalesce(p.year_offset,   s.year_offset,   m.year_offset),
    photo_url     = coalesce(p.photo_url,     s.photo_url,     m.photo_url),
    photo_focus   = coalesce(p.photo_focus,   s.photo_focus,   m.photo_focus),
    bio           = coalesce(p.bio,           s.bio)
  where p.id = p_person;
end;
$$;
revoke all on function public._registry_sync_person(uuid) from public, anon, authenticated;

-- ── 3. connecting a placement is a merge: finish it ────────────────────────
create or replace function public.registry_link_sync()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.person_id is null then return null; end if;
  if tg_op = 'UPDATE' and old.person_id is not distinct from new.person_id then return null; end if;
  if exists (select 1 from public._registry_mismatches(new.person_id)) then
    perform public._registry_sync_person(new.person_id);
  end if;
  return null;
end;
$$;

drop trigger if exists zz_registry_link_sync on public.students;
create trigger zz_registry_link_sync after insert or update on public.students
  for each row execute function public.registry_link_sync();
drop trigger if exists zz_registry_link_sync on public.team_members;
create trigger zz_registry_link_sync after insert or update on public.team_members
  for each row execute function public.registry_link_sync();

-- ── 4. a photo-only house edit is a change ─────────────────────────────────
-- Body is the LIVE one (read 2026-09-21), guard extended; SET unchanged.
create or replace function public.student_mirror_up()
 returns trigger language plpgsql security definer set search_path to 'public'
as $function$
begin
  if new.person_id is null then return new; end if;
  update public.people p
     set first_name_th = new.first_name_th,
         last_name_th  = new.last_name_th,
         -- students.nickname is GENERATED from nickname_self/nickname_imported;
         -- the registry takes the effective value, which is what every screen
         -- shows anyway.
         nickname      = new.nickname,
         student_id    = new.student_id,
         major         = new.major,
         cohort_year   = new.cohort_year,
         year_offset   = new.year_offset,
         bio           = new.bio,
         photo_url     = coalesce(new.photo_url, p.photo_url),
         photo_focus   = coalesce(new.photo_focus, p.photo_focus)
   where p.id = new.person_id
     and (p.first_name_th, p.last_name_th, p.nickname, p.student_id, p.major,
          p.cohort_year, p.year_offset, p.bio, p.photo_url, p.photo_focus)
         is distinct from
         (new.first_name_th, new.last_name_th, new.nickname, new.student_id,
          new.major, new.cohort_year, new.year_offset, new.bio,
          -- compared exactly as SET, or the guard stops terminating (0133)
          coalesce(new.photo_url, p.photo_url), coalesce(new.photo_focus, p.photo_focus));
  return new;
end;
$function$;

-- ── 5. what the admin panel reads ──────────────────────────────────────────
create or replace function public._registry_admin_ok()
returns boolean language sql stable security definer set search_path = public as $$
  select public.current_user_role() = any (array['vp_admin','dev'])
      or public.current_user_has_permission('house')
      or public.current_user_has_permission('team_edit')
$$;

create or replace function public.registry_mismatches()
returns table (kind text, placement_id text, person_id uuid, who text, columns text[])
language plpgsql stable security definer set search_path = public as $$
begin
  if not public._registry_admin_ok() then
    raise exception 'ไม่มีสิทธิ์ดูรายการนี้' using errcode = 'P0001';
  end if;
  return query
    select r.kind, r.placement_id, r.person_id,
           coalesce(nullif(btrim(p.nickname), '') || ' — ', '') ||
           coalesce(nullif(btrim(p.full_name), ''), p.kkumail, '(ไม่ทราบชื่อ)'),
           r.columns
      from public._registry_mismatches(null) r join public.people p on p.id = r.person_id
     order by 4;
end;
$$;
revoke all on function public.registry_mismatches() from public, anon;
grant execute on function public.registry_mismatches() to authenticated;

create or replace function public.repair_registry_mismatches()
returns integer language plpgsql security definer set search_path = public as $$
declare v uuid; n int := 0;
begin
  if not public._registry_admin_ok() then
    raise exception 'ไม่มีสิทธิ์แก้รายการนี้' using errcode = 'P0001';
  end if;
  -- Capped: each registry write cascades through ~11 triggers (0194 measured
  -- ~0.9 s per person). The panel re-reads and can press again.
  for v in select distinct r.person_id from public._registry_mismatches(null) r limit 100 loop
    perform public._registry_sync_person(v);
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke all on function public.repair_registry_mismatches() from public, anon;
grant execute on function public.repair_registry_mismatches() to authenticated;

-- ── 6. the rows that already drifted ───────────────────────────────────────
do $$
declare v uuid;
begin
  for v in select distinct person_id from public._registry_mismatches(null) loop
    perform public._registry_sync_person(v);
  end loop;
end $$;
