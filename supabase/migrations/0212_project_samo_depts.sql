-- ============================================================
-- 0212 — ผู้ส่งหนังสือ tags a โครงการ with ฝ่ายสโม; everyone can filter by it
--
-- ASKED (owner, night queue 2026-10-13): "for each โครงการ ผู้ส่งหนังสือ can
-- tag the โครงการ to ฝ่ายสโม … then they can filter it by ฝ่ายสโม … also do
-- filter for the normal people view from the samoweb that isn't in the admin".
--
-- ⛔ WRITTEN BY THE NIGHT AGENT, NOT APPLIED. No database access this run —
-- the owner's next session applies this to samo-dev first, then production,
-- and runs tools/proj0212-samo-depts.mjs. See STATE.md.
--
-- SHAPE
--   • projects.samo_depts text[] — zero or more values from the SAME list the
--     VS desk already filters by: VS_DEPTS in src/js/team-vocab.js (12
--     ฝ่ายของอุปนายก values). Not a new taxonomy (mistakes class 6) — the
--     allowed array below is pinned to VS_DEPTS by samo-depts.test.js, which
--     parses THIS file and compares, not a comment either side could drift
--     from.
--   • `projects_update` (0005) is `current_user_is_project_actor()` — true for
--     ANY project seat (vpa/staff/prof), so that row policy alone would let a
--     เจ้าหน้าที่คณะ or an อาจารย์ set samo_depts through an unrelated edit
--     (mistakes class 1: a row policy is not a column policy). A BEFORE
--     UPDATE trigger restricts the COLUMN to the sender side, independent of
--     which path reaches the UPDATE (RPC or a direct PATCH) — same
--     exemption-first shape as users_self_update_guard (0028).
--   • "the sender side" is `current_user_can_publish_project()` (0114) — role
--     vp_admin/dev OR the `vpa` seat, which already folds `master` in via
--     current_user_project_seats(). This is the SAME predicate 0114 uses to
--     gate is_public and project create/delete, reused rather than
--     re-derived: a bare `'vpa' = any(current_user_project_seats())` check
--     would silently exclude role=dev, which holds no stored seat and no
--     `master` permission by default (0111 is explicit that master is NOT
--     role='dev') but IS the sender side by every other gate in this table.
--   • set_project_samo_depts(project, depts) is the one write path the UI
--     calls: SECURITY DEFINER so it can give a friendly Thai error instead of
--     a raw RLS/trigger exception, but it is NOT what makes the write safe —
--     the trigger is, and a direct PATCH is refused the same way.
--   • Reads need nothing new: projects is already world-readable for public
--     rows (projects_read_public, 0032/0114) and `*` already covers this
--     column, so anon sees tags on public projects and nothing else, same as
--     every other projects column.
-- ============================================================

alter table public.projects
  add column if not exists samo_depts text[] not null default '{}';

comment on column public.projects.samo_depts is
  'ฝ่ายสโม this โครงการ is tagged with — zero or more values from VS_DEPTS '
  '(src/js/team-vocab.js). Written only through set_project_samo_depts(); a '
  'BEFORE UPDATE trigger refuses a direct change by anyone but the sender '
  'side (current_user_can_publish_project(), 0114).';

-- ── column guard — the sender side only, whichever path reaches the UPDATE ─
create or replace function public.projects_samo_depts_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.samo_depts is distinct from old.samo_depts
     and not public.current_user_can_publish_project() then
    raise exception 'projects_samo_depts_guard: ผู้ส่งหนังสือ (SAMO) เท่านั้นที่กำหนดฝ่ายสโมได้';
  end if;
  return new;
end;
$$;

drop trigger if exists projects_samo_depts_guard on public.projects;
create trigger projects_samo_depts_guard
  before update on public.projects
  for each row execute function public.projects_samo_depts_guard();

-- ── the one write path ──────────────────────────────────────────────────
create or replace function public.set_project_samo_depts(p_project text, p_depts text[])
returns public.projects
language plpgsql security definer set search_path = public as $$
declare
  -- ONE HOME: VS_DEPTS values, src/js/team-vocab.js. samo-depts.test.js
  -- parses this literal and asserts it equals that list — never a comment.
  allowed text[] := array[
    'นายกสโม',
    'SE',
    'อุปนายกฝ่ายบริหารองค์กร',
    'อุปนายกฝ่ายดิจิทัลและสื่อสารองค์กร',
    'อุปนายกฝ่ายกิจการภายใน',
    'อุปนายกฝ่ายกิจการภายนอก',
    'อุปนายกฝ่ายกิจการมหาวิทยาลัย',
    'อุปนายกฝ่ายวิชาการ',
    'อุปนายกฝ่ายยุทธศาสตร์และพัฒนาองค์กร',
    'อุปนายกฝ่ายคุณภาพชีวิตและสิ่งแวดล้อม',
    'อุปนายกฝ่ายเวชนิทัศน์',
    'อุปนายกฝ่ายรังสีเทคนิค'
  ];
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
    from unnest(cleaned) d where d <> all (allowed);
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
