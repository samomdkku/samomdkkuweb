-- 0247 — Passport's ฝ่าย list is managed by its admins, picked from ทีม SAMO
--
-- ASKED (owner, 2026-10-23): the client wants "ฝ่าย รพ. ร่วมผลิต: รพ. ขอนแก่น,
-- รพ. มหาสารคาม, รพ. อุดรธานี" in Passport's เลือกฝ่าย, and more generally "a
-- universal lists of ฝ่าย that every system can pull … This'd be the teamsamo
-- … admin should can has admin config settings lists of ฝ่าย to use, it can
-- search through teamsamo and pick what it'll incoperate to it. so admin can
-- add edit remove". Passport first; PR and VitalSound later (VitalSound routes
-- Discord webhooks by ฝ่าย, so it needs its own care).
--
-- WHAT IT WAS. The ten ฝ่าย and four ฝ่ายย่อย existed FOUR times: these two
-- tables, `passport/js/constants.js`, the option lists hand-typed into
-- `html/admin.html` (four selects), and `SUB_DEPT_OPTIONS` in admin-page.js.
-- Adding a ฝ่าย meant a code change in four files and a deploy — and the copies
-- already disagreed (the table said "อุปนายกฝ่ายบริหารองค์กร", the pages said
-- "บริหารองค์กร").
--
-- THE SHAPE.
--   * These two tables become THE list. The ids are KEPT: they are stamped on
--     every activity and scan and are what a ทีม SAMO Passport grant stores
--     (`d:6`, `s:4` in users.managed_passport_scopes, team_nodes.
--     passport_dept_id). An id is never reused or renumbered.
--   * Each row may link to the ทีม SAMO node it stands for (`team_node_id`) —
--     the universal list the owner named. The NAME is Passport's own label
--     (defaults to the node's name when added from the tree), so renaming here
--     never edits the org chart, and the chart being restructured never
--     renames a ฝ่าย filed on a thousand scans.
--   * "Remove" HIDES (`active = false`): gone from every picker, still named
--     wherever it was used. A row nothing has ever referenced may be deleted.
--   * Writes are definer RPCs for org-wide Passport admins; the tables stay
--     deny-all (RLS on, no policy) as 0011 left them, and the readers keep
--     reading through list_passport_departments().
--   * ทีม SAMO's tree is readable only by team holders, so the picker gets the
--     tree through passport.department_catalog(), gated org-wide.
--
-- BACKFILL: names take the labels the pages showed (constants.js), so nothing a
-- person sees changes; each of the ten ฝ่าย links to the ONE top-level ทีม SAMO
-- division named "ฝ่าย<name>" (measured: exactly one each). The ฝ่ายย่อย are
-- NOT auto-linked — "โครงการ" matches several nodes; an admin links them.
-- รพ. ร่วมผลิต is added through the new RPC, not here (it is data).

begin;

-- ── 1. the columns ────────────────────────────────────────────────────────
alter table passport.departments
  add column if not exists team_node_id uuid references public.team_nodes(id) on delete set null,
  add column if not exists sort_order   integer not null default 0,
  add column if not exists active       boolean not null default true,
  add column if not exists updated_at   timestamptz not null default now();
alter table passport.sub_departments
  add column if not exists team_node_id uuid references public.team_nodes(id) on delete set null,
  add column if not exists sort_order   integer not null default 0,
  add column if not exists active       boolean not null default true,
  add column if not exists updated_at   timestamptz not null default now();

comment on column passport.departments.team_node_id is
  'The ทีม SAMO node this Passport ฝ่าย stands for (0247). The name is Passport''s own label; the id is permanent (stamped on activities, scans and Passport grants).';
comment on column passport.departments.active is
  'false = hidden from every picker, still named where it was used (0247). Never renumber an id.';

-- ids are assigned by the save RPC (max + 1), never by a sequence: a deleted
-- unreferenced row's id must not come back as a different ฝ่าย.

-- ── 2. backfill: the labels people saw, and the ทีม SAMO link ─────────────
update passport.departments d
   set name = v.name
  from (values (1,'บริหารองค์กร'),(2,'ดิจิทัลและสื่อสารองค์กร'),(3,'กิจการภายใน'),
               (4,'กิจการภายนอก'),(5,'กิจการมหาวิทยาลัย'),(6,'วิชาการ'),
               (7,'ยุทธศาสตร์และพัฒนาองค์กร'),(8,'คุณภาพชีวิตและสิ่งแวดล้อม'),
               (9,'เวชนิทัศน์'),(10,'รังสีเทคนิค')) v(id, name)
 where d.id = v.id and d.name is distinct from v.name;

update passport.departments set sort_order = id * 10 where sort_order = 0;
update passport.sub_departments set sort_order = id * 10 where sort_order = 0;

update passport.departments d
   set team_node_id = n.id
  from public.team_nodes n
 where d.team_node_id is null
   and n.parent_id is null and n.kind = 'division'
   and n.name = 'ฝ่าย' || d.name
   and (select count(*) from public.team_nodes m
         where m.parent_id is null and m.kind = 'division' and m.name = 'ฝ่าย' || d.name) = 1;

-- ── 3. the reader every page uses ─────────────────────────────────────────
-- Same name and grants (authenticated only); now carries the link, the order
-- and the hidden flag. Callers decide whether to show hidden rows: a picker
-- for NEW work does not, a label for OLD work does.
create or replace function public.list_passport_departments()
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'passport'
as $fn$
  select jsonb_build_object(
    'departments', coalesce((
      select jsonb_agg(jsonb_build_object('id', d.id, 'name', d.name, 'active', d.active,
               'sort_order', d.sort_order, 'team_node_id', d.team_node_id)
             order by d.sort_order, d.id)
        from passport.departments d), '[]'::jsonb),
    'sub_departments', coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'department_id', s.department_id,
               'name', s.name, 'active', s.active, 'sort_order', s.sort_order,
               'team_node_id', s.team_node_id)
             order by s.sort_order, s.id)
        from passport.sub_departments s), '[]'::jsonb)
  )
$fn$;

-- ── 4. the admin side ─────────────────────────────────────────────────────
/** The list + the ทีม SAMO tree to pick from + how much each row is used —
 *  what the "จัดการรายชื่อฝ่าย" screen needs, org-wide admins only. */
create or replace function passport.department_catalog()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'passport'
as $fn$
begin
  if not passport._org_wide() then
    raise exception 'จัดการรายชื่อฝ่ายต้องมีสิทธิ์ SAMO Passport ทุกฝ่าย';
  end if;
  return public.list_passport_departments() || jsonb_build_object(
    'tree', coalesce((select jsonb_agg(jsonb_build_object('id', n.id, 'name', n.name,
                        'kind', n.kind, 'parent_id', n.parent_id) order by n.position, n.name)
                        from public.team_nodes n), '[]'::jsonb),
    'usage', jsonb_build_object(
      'departments', coalesce((select jsonb_object_agg(d.id, jsonb_build_object(
          'activities', (select count(*) from passport.activities a where a.department_id = d.id),
          'scans',      (select count(*) from passport.scans s where s.department_id = d.id),
          'grants',     (select count(*) from public.users u where ('d:' || d.id) = any (u.managed_passport_scopes))
                      + (select count(*) from public.team_nodes n where n.passport_dept_id = d.id)))
        from passport.departments d), '{}'::jsonb),
      'sub_departments', coalesce((select jsonb_object_agg(s.id, jsonb_build_object(
          'activities', (select count(*) from passport.activities a where a.sub_department_id = s.id),
          'scans',      (select count(*) from passport.scans x where x.sub_department_id = s.id),
          'grants',     (select count(*) from public.users u where ('s:' || s.id) = any (u.managed_passport_scopes))
                      + (select count(*) from public.team_nodes n where n.passport_sub_dept_id = s.id)))
        from passport.sub_departments s), '{}'::jsonb)));
end $fn$;

/** Add (p_id null) or edit a ฝ่าย. Returns the catalog. */
create or replace function passport.save_department(
  p_id integer, p_name text, p_team_node_id uuid default null,
  p_active boolean default true, p_sort_order integer default null)
returns jsonb
language plpgsql
security definer
set search_path to 'passport'
as $fn$
declare
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_id   int;
begin
  if not passport._org_wide() then
    raise exception 'จัดการรายชื่อฝ่ายต้องมีสิทธิ์ SAMO Passport ทุกฝ่าย';
  end if;
  if v_name is null or length(v_name) > 80 then raise exception 'ใส่ชื่อฝ่าย (ไม่เกิน 80 ตัวอักษร)'; end if;
  if p_team_node_id is not null and not exists (select 1 from public.team_nodes where id = p_team_node_id) then
    raise exception 'ไม่พบตำแหน่ง/ฝ่ายนี้ใน ทีม SAMO';
  end if;
  if exists (select 1 from passport.departments
              where active and lower(name) = lower(v_name) and id is distinct from p_id)
     and coalesce(p_active, true) then
    raise exception 'มีฝ่ายชื่อ "%" อยู่แล้ว', v_name;
  end if;

  if p_id is null then
    lock table passport.departments in share row exclusive mode;   -- two adds cannot take one id
    select coalesce(max(id), 0) + 1 into v_id from passport.departments;
    insert into passport.departments (id, name, team_node_id, active, sort_order)
         values (v_id, v_name, p_team_node_id, coalesce(p_active, true),
                 coalesce(p_sort_order, (select coalesce(max(sort_order), 0) + 10 from passport.departments)));
  else
    update passport.departments
       set name = v_name, team_node_id = p_team_node_id, active = coalesce(p_active, active),
           sort_order = coalesce(p_sort_order, sort_order), updated_at = now()
     where id = p_id;
    if not found then raise exception 'ไม่พบฝ่าย #%', p_id; end if;
  end if;
  return passport.department_catalog();
end $fn$;

/** Add (p_id null) or edit a ฝ่ายย่อย under a ฝ่าย. Returns the catalog. */
create or replace function passport.save_sub_department(
  p_id integer, p_department_id integer, p_name text, p_team_node_id uuid default null,
  p_active boolean default true, p_sort_order integer default null)
returns jsonb
language plpgsql
security definer
set search_path to 'passport'
as $fn$
declare
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_id   int;
  v_old  int;
begin
  if not passport._org_wide() then
    raise exception 'จัดการรายชื่อฝ่ายต้องมีสิทธิ์ SAMO Passport ทุกฝ่าย';
  end if;
  if v_name is null or length(v_name) > 80 then raise exception 'ใส่ชื่อฝ่ายย่อย (ไม่เกิน 80 ตัวอักษร)'; end if;
  if not exists (select 1 from passport.departments where id = p_department_id) then
    raise exception 'ไม่พบฝ่าย #%', p_department_id;
  end if;
  if p_team_node_id is not null and not exists (select 1 from public.team_nodes where id = p_team_node_id) then
    raise exception 'ไม่พบตำแหน่ง/ฝ่ายนี้ใน ทีม SAMO';
  end if;
  if coalesce(p_active, true) and exists (select 1 from passport.sub_departments
              where active and department_id = p_department_id and lower(name) = lower(v_name)
                and id is distinct from p_id) then
    raise exception 'ฝ่ายนี้มีฝ่ายย่อยชื่อ "%" อยู่แล้ว', v_name;
  end if;

  if p_id is null then
    lock table passport.sub_departments in share row exclusive mode;
    select coalesce(max(id), 0) + 1 into v_id from passport.sub_departments;
    insert into passport.sub_departments (id, department_id, name, team_node_id, active, sort_order)
         values (v_id, p_department_id, v_name, p_team_node_id, coalesce(p_active, true),
                 coalesce(p_sort_order, (select coalesce(max(sort_order), 0) + 10 from passport.sub_departments)));
  else
    select department_id into v_old from passport.sub_departments where id = p_id;
    if not found then raise exception 'ไม่พบฝ่ายย่อย #%', p_id; end if;
    -- A ฝ่ายย่อย that has been USED cannot change parent: its activities and
    -- scans carry both ids, and a sub under the wrong ฝ่าย reads as two answers.
    if v_old is distinct from p_department_id
       and (exists (select 1 from passport.activities where sub_department_id = p_id)
            or exists (select 1 from passport.scans where sub_department_id = p_id)) then
      raise exception 'ฝ่ายย่อยนี้มีกิจกรรมแล้ว จึงย้ายไปฝ่ายอื่นไม่ได้ — ซ่อนแล้วเพิ่มใหม่ใต้ฝ่ายที่ถูกต้องแทน';
    end if;
    update passport.sub_departments
       set department_id = p_department_id, name = v_name, team_node_id = p_team_node_id,
           active = coalesce(p_active, active), sort_order = coalesce(p_sort_order, sort_order),
           updated_at = now()
     where id = p_id;
  end if;
  return passport.department_catalog();
end $fn$;

/** Delete a ฝ่าย / ฝ่ายย่อย nothing has ever used. Anything referenced can only
 *  be HIDDEN — its id is on activities, scans or a ทีม SAMO grant. */
create or replace function passport.delete_department(p_kind text, p_id integer)
returns jsonb
language plpgsql
security definer
set search_path to 'passport'
as $fn$
begin
  if not passport._org_wide() then
    raise exception 'จัดการรายชื่อฝ่ายต้องมีสิทธิ์ SAMO Passport ทุกฝ่าย';
  end if;
  if p_kind = 'department' then
    if exists (select 1 from passport.activities where department_id = p_id)
       or exists (select 1 from passport.scans where department_id = p_id)
       or exists (select 1 from passport.sub_departments where department_id = p_id)
       or exists (select 1 from public.users where ('d:' || p_id) = any (managed_passport_scopes))
       or exists (select 1 from public.team_nodes where passport_dept_id = p_id) then
      raise exception 'ฝ่ายนี้ถูกใช้แล้ว (กิจกรรม คะแนน ฝ่ายย่อย หรือสิทธิ์ใน ทีม SAMO) — ใช้ "ซ่อน" แทน';
    end if;
    delete from passport.departments where id = p_id;
  elsif p_kind = 'sub_department' then
    if exists (select 1 from passport.activities where sub_department_id = p_id)
       or exists (select 1 from passport.scans where sub_department_id = p_id)
       or exists (select 1 from public.users where ('s:' || p_id) = any (managed_passport_scopes))
       or exists (select 1 from public.team_nodes where passport_sub_dept_id = p_id) then
      raise exception 'ฝ่ายย่อยนี้ถูกใช้แล้ว — ใช้ "ซ่อน" แทน';
    end if;
    delete from passport.sub_departments where id = p_id;
  else
    raise exception 'ชนิดไม่ถูกต้อง';
  end if;
  if not found then raise exception 'ไม่พบรายการ #%', p_id; end if;
  return passport.department_catalog();
end $fn$;

-- ── 5. grants ─────────────────────────────────────────────────────────────
revoke all on function passport.department_catalog()                                         from public, anon;
revoke all on function passport.save_department(integer, text, uuid, boolean, integer)        from public, anon;
revoke all on function passport.save_sub_department(integer, integer, text, uuid, boolean, integer) from public, anon;
revoke all on function passport.delete_department(text, integer)                              from public, anon;
grant execute on function passport.department_catalog()                                      to authenticated;
grant execute on function passport.save_department(integer, text, uuid, boolean, integer)     to authenticated;
grant execute on function passport.save_sub_department(integer, integer, text, uuid, boolean, integer) to authenticated;
grant execute on function passport.delete_department(text, integer)                           to authenticated;

commit;
