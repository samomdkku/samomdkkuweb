-- ============================================================
-- 0216 — tagging a โครงการ with a ฝ่าย adds or removes ONE ฝ่าย, atomically.
--
-- THE GAP (code review, 2026-10-13; owner: "handle the case"). The tag chips
-- called set_project_samo_depts(project, <whole array>), computed in the
-- browser from the tags it last loaded. Two people tagging the SAME โครงการ at
-- the same moment each sent their own whole array; the later write replaced
-- the earlier, silently dropping one ฝ่าย. The per-tab queue (inbox.js) only
-- orders clicks inside ONE tab.
--
-- THE FIX: set_project_samo_dept(project, dept, on). It locks the row
-- (SELECT … FOR UPDATE), reads the tags as they are NOW, adds or removes the
-- one ฝ่าย, and writes. A second caller blocks on the lock and then reads the
-- first one's result, so both changes land. Idempotent: adding a ฝ่าย already
-- there, or removing one that is not, changes nothing — so a retried click is
-- harmless. Same gates as before: the sender side only, and only a value in
-- samo_dept_keys() (0215); the column guard trigger still covers every path.
--
-- set_project_samo_depts (whole array) stays for any caller that really means
-- "replace"; the app no longer calls it.
-- ============================================================

create or replace function public.set_project_samo_dept(p_project text, p_dept text, p_on boolean)
returns public.projects
language plpgsql security definer set search_path = public as $$
declare
  current_tags text[];
  next_tags text[];
  result public.projects;
begin
  if not public.current_user_can_publish_project() then
    raise exception 'set_project_samo_dept: ผู้ส่งหนังสือ (SAMO) เท่านั้นที่กำหนดฝ่ายสโมได้';
  end if;
  -- Only an ADD must name a real ฝ่าย; removing a stale value (a key retired
  -- since it was set) must always be possible.
  if p_on and (p_dept is null or p_dept <> all (public.samo_dept_keys())) then
    raise exception 'set_project_samo_dept: ไม่รู้จักฝ่ายสโม: %', coalesce(p_dept, 'null');
  end if;

  -- ⛔ THE LOCK IS THE FIX. A concurrent caller waits here, then reads the row
  -- as the first one left it.
  select samo_depts into current_tags from public.projects where id = p_project for update;
  if not found then
    raise exception 'set_project_samo_dept: ไม่พบโครงการ %', p_project;
  end if;

  select coalesce(array_agg(distinct d order by d), '{}') into next_tags
    from unnest(
      case when p_on then array_append(coalesce(current_tags, '{}'), p_dept)
           else array_remove(coalesce(current_tags, '{}'), p_dept) end
    ) d
   where d is not null and d <> '';

  update public.projects set samo_depts = next_tags
   where id = p_project
   returning * into result;
  return result;
end;
$$;

revoke all on function public.set_project_samo_dept(text, text, boolean) from public;
grant execute on function public.set_project_samo_dept(text, text, boolean) to authenticated;
