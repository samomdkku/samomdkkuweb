-- ============================================================
-- 0215 — a โครงการ's ฝ่ายสโม tags are the 12 ฝ่าย of หน้าฝ่าย, not VitalSound's
--        routing list; and the database checks the VALUE on every path.
--
-- OWNER, 2026-10-13: "the ฝ่าย in หนังสือโครงการ should only be these"
-- (สำนักนายกฯ … ฝ่าย รพ. ร่วมผลิต) — "it shouldn't have SE". 0212 (written by
-- the night agent) took VS_DEPTS, the list a VitalSound report is ROUTED by:
-- นายกสโม, SE and ten อุปนายกฝ่าย… seats. Those are desks, not ฝ่าย.
--
-- THE VALUES ARE DEPT_DEFS KEYS (src/data/depts.js) — office, admin, … hospital
-- — the same keys dept_content.dept and team_nodes.dept_page already use, so
-- one ฝ่าย has one identifier across the site, and renaming a ฝ่าย's title
-- never orphans a tag. The app shows the title.
--
-- ONE HOME IN SQL: samo_dept_keys(). Both the RPC and the trigger ask it, and
-- src/js/projects/samo-depts.test.js parses THIS function and asserts it equals
-- DEPT_KEYS. 0212's trigger checked only WHO wrote the column; it now also
-- refuses an unknown VALUE, so a direct PATCH cannot store one either (the app
-- security review's informational finding, 2026-10-13).
--
-- No data to move: 0 โครงการ carried a tag on production when this was written
-- (0212 had been live ~30 minutes). Any stray value is cleared rather than
-- guessed at, so the new check can hold for every row.
-- ============================================================

create or replace function public.samo_dept_keys()
returns text[] language sql immutable as $$
  select array[
    'office',
    'admin',
    'digital',
    'internal',
    'external',
    'university',
    'academic',
    'strategy',
    'quality',
    'rt',
    'media',
    'hospital'
  ]::text[];
$$;
grant execute on function public.samo_dept_keys() to anon, authenticated;

-- Clear anything outside the new list (expected: nothing). The guard below is
-- dropped and re-created around this so the cleanup is not refused by it.
drop trigger if exists projects_samo_depts_guard on public.projects;
update public.projects
   set samo_depts = coalesce(
     (select array_agg(d order by d) from unnest(samo_depts) d where d = any (public.samo_dept_keys())),
     '{}')
 where not (samo_depts <@ public.samo_dept_keys());

create or replace function public.projects_samo_depts_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  bad text[];
begin
  if new.samo_depts is distinct from old.samo_depts then
    if not public.current_user_can_publish_project() then
      raise exception 'projects_samo_depts_guard: ผู้ส่งหนังสือ (SAMO) เท่านั้นที่กำหนดฝ่ายสโมได้';
    end if;
    select coalesce(array_agg(d), '{}') into bad
      from unnest(new.samo_depts) d where d is null or d <> all (public.samo_dept_keys());
    if array_length(bad, 1) > 0 then
      raise exception 'projects_samo_depts_guard: ไม่รู้จักฝ่ายสโม: %', array_to_string(bad, ', ');
    end if;
  end if;
  return new;
end;
$$;

create trigger projects_samo_depts_guard
  before update on public.projects
  for each row execute function public.projects_samo_depts_guard();

create or replace function public.set_project_samo_depts(p_project text, p_depts text[])
returns public.projects
language plpgsql security definer set search_path = public as $$
declare
  cleaned text[];
  bad text[];
  result public.projects;
begin
  if not public.current_user_can_publish_project() then
    raise exception 'set_project_samo_depts: ผู้ส่งหนังสือ (SAMO) เท่านั้นที่กำหนดฝ่ายสโมได้';
  end if;

  select coalesce(array_agg(distinct d order by d), '{}') into cleaned
    from unnest(coalesce(p_depts, '{}')) d where d is not null and d <> '';

  select coalesce(array_agg(d), '{}') into bad
    from unnest(cleaned) d where d <> all (public.samo_dept_keys());
  if array_length(bad, 1) > 0 then
    raise exception 'set_project_samo_depts: ไม่รู้จักฝ่ายสโม: %', array_to_string(bad, ', ');
  end if;

  update public.projects set samo_depts = cleaned
    where id = p_project
    returning * into result;
  if result.id is null then
    raise exception 'set_project_samo_depts: ไม่พบโครงการ %', p_project;
  end if;
  return result;
end;
$$;

grant execute on function public.set_project_samo_depts(text, text[]) to authenticated;

comment on column public.projects.samo_depts is
  'ฝ่ายสโม this โครงการ is tagged with — zero or more DEPT_DEFS keys '
  '(src/data/depts.js; the list is public.samo_dept_keys(), 0215). Written '
  'through set_project_samo_depts(); a BEFORE UPDATE trigger refuses anyone '
  'but the sender side (current_user_can_publish_project(), 0114) and any '
  'value outside the list, on every path.';
