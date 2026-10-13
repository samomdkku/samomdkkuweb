#!/usr/bin/env node
// ============================================================
// proj0212-samo-depts.mjs — ฝ่ายสโม tags on a โครงการ (0212).
//
// One transaction that ROLLS BACK. It asks the LIVE database:
//  1. DENY: a plain student (no project seat, not master) cannot call
//     set_project_samo_depts.
//  2. DENY: a staff-desk-only account — who CAN update the project row for
//     other reasons (projects_update is current_user_is_project_actor()) —
//     still cannot change samo_depts through a DIRECT UPDATE. 'guard', not
//     'deny-rls': the row-level policy admits the write, the column trigger
//     refuses it (mistakes class 1 — a row policy is not a column policy).
//  3. ALLOW: a vpa-seat holder tags a โครงการ; an unknown ฝ่ายสโม value is
//     refused on the SAME call path. A role=dev account with NO stored seat
//     and NO master permission can tag too — the guard asks
//     current_user_can_publish_project() (0114), not a raw vpa-seat check,
//     specifically because that bare check would exclude dev (0111: master
//     is explicitly NOT role='dev').
//  4. ALLOW: a master with no stored seat tags one too (0111's fold).
//  5. anon reads the tags on a PUBLIC โครงการ and cannot see a HIDDEN one
//     at all (existing is_public policy, 0114 — nothing new to this column).
//
//   node tools/proj0212-samo-depts.mjs            # production (VITE_SUPABASE_URL=… for dev)
// RUN BEFORE 0212 AND IT ERRORS (no column / function).
// ============================================================
import { announceTarget, runSql } from './env-lib.mjs';

const target = announceTarget();
const SQL = `begin;
create temporary table probe(k text, expected text, got text);
-- The probe table is the proof's own scratchpad, written while acting AS the
-- subjects below. Without this every DENY case errors with "permission denied
-- for table probe" — the night agent wrote this proof without a database and
-- its first real run (2026-10-13) failed exactly there.
grant all on probe to authenticated, anon;

-- Two synthetic โครงการ rows, rolled back with everything else — real
-- target geometry beats pulling a live project and risking its real tags
-- (docs/mistakes/tooling-proofs.md: a scenario the proof NEEDS, created,
-- not borrowed).
insert into public.projects (id, name, status, is_public, created_by)
values ('PRJ-PROOF-0212A', 'proof — public', 'open', true, null);
insert into public.projects (id, name, status, is_public, created_by)
values ('PRJ-PROOF-0212B', 'proof — hidden', 'open', false, null);

-- Subjects resolved from grants, never named (docs/mistakes/tooling-proofs.md).
create temporary table subj_none as
select u.id as uid from public.users u
 where u.role = 'user'
   and coalesce(u.managed_project_seats, '{}') = '{}'
   and not ('master' = any (coalesce(u.permissions, '{}') || coalesce(u.managed_permissions, '{}')))
 order by u.id limit 1;
create temporary table subj_staff as
select u.id as uid from public.users u
 where ('staff' = any (coalesce(u.managed_project_seats, '{}')) or u.role = 'uni_staff')
   and not ('vpa' = any (coalesce(u.managed_project_seats, '{}')))
   and not ('master' = any (coalesce(u.permissions, '{}') || coalesce(u.managed_permissions, '{}')))
 order by u.id limit 1;
create temporary table subj_vpa as
select u.id as uid from public.users u
 where ('vpa' = any (coalesce(u.managed_project_seats, '{}')) or u.role = 'vp_admin')
   and not ('master' = any (coalesce(u.permissions, '{}') || coalesce(u.managed_permissions, '{}')))
 order by u.id limit 1;
create temporary table subj_master as
select u.id as uid from public.users u
 where u.role = 'user'
   and ('master' = any (coalesce(u.permissions, '{}')) or 'master' = any (coalesce(u.managed_permissions, '{}')))
 order by u.id limit 1;
-- role=dev, no stored vpa/staff/prof seat, and NOT also holding master —
-- isolates "the sender side BY ROLE" from "the sender side by seat/fold".
-- ⛔ CREATED, NOT FOUND: production has no such account (every dev holds
-- master, 2026-10-13), so a lookup came back empty and §3d raised. A plain
-- account (not the §1 subject) is made role=dev inside this rolled-back
-- transaction; users_self_update_guard refuses that write from anyone, so it
-- is disabled for this one setup statement (as dept0177/dept0213 do).
create temporary table subj_dev as
select u.id as uid from public.users u
 where u.role = 'user'
   and coalesce(u.managed_project_seats, '{}') = '{}'
   and coalesce(u.permissions, '{}') = '{}'
   and coalesce(u.managed_permissions, '{}') = '{}'
   and u.id <> (select uid from subj_none)
 order by u.id limit 1;
alter table public.users disable trigger users_self_update_guard;
update public.users set role = 'dev' where id = (select uid from subj_dev);
alter table public.users enable trigger users_self_update_guard;

-- §0 subjects are what the proof thinks they are.
insert into probe select '00. a plain student subject exists (no seat, no master)', 'true',
  (select count(*) > 0 from subj_none)::text;
insert into probe select '01. a staff-desk-only subject exists', 'true',
  (select count(*) > 0 from subj_staff)::text;
insert into probe select '02. a vpa-desk subject exists', 'true',
  (select count(*) > 0 from subj_vpa)::text;
insert into probe select '03. a master (no stored seat) subject exists', 'true',
  (select count(*) > 0 from subj_master)::text;
insert into probe select '03b. a role=dev subject exists with no seat and no master permission', 'true',
  (select count(*) > 0 from subj_dev)::text;

-- §1 DENY — a plain student.
select set_config('request.jwt.claims', json_build_object('sub', (select uid from subj_none)::text, 'role','authenticated')::text, true);
set local role authenticated;
do $$ begin
  perform public.set_project_samo_depts('PRJ-PROOF-0212A', array['SE']);
  insert into probe values ('1. a plain student cannot tag a โครงการ', 'refused', 'ALLOWED');
exception when others then
  insert into probe values ('1. a plain student cannot tag a โครงการ', 'refused',
    case when sqlerrm like '%ผู้ส่งหนังสือ%' then 'refused' else sqlerrm end);
end $$;
reset role;

-- §2 DENY — a staff-desk-only account, who CAN update the row for other
-- reasons. The control that must stay true, or a refusal here proves nothing
-- (it could be RLS hiding the row, not the column guard).
select set_config('request.jwt.claims', json_build_object('sub', (select uid from subj_staff)::text, 'role','authenticated')::text, true);
set local role authenticated;
insert into probe select '2a. control — the staff subject IS a project actor (can reach the row)', 'true',
  public.current_user_is_project_actor()::text;
do $$ begin
  update public.projects set samo_depts = array['SE'] where id = 'PRJ-PROOF-0212A';
  insert into probe values ('2b. a staff-desk-only account cannot set samo_depts directly', 'refused', 'ALLOWED');
exception when others then
  insert into probe values ('2b. a staff-desk-only account cannot set samo_depts directly', 'refused',
    case when sqlerrm like '%ผู้ส่งหนังสือ%' then 'refused' else sqlerrm end);
end $$;
reset role;

-- §3 ALLOW — a vpa-desk holder tags a โครงการ, and an unknown value is refused
-- on the same call path.
select set_config('request.jwt.claims', json_build_object('sub', (select uid from subj_vpa)::text, 'role','authenticated')::text, true);
set local role authenticated;
insert into probe select '3a. a vpa holder tags PRJ-PROOF-0212A with {SE, นายกสโม}', '{SE,นายกสโม}',
  (public.set_project_samo_depts('PRJ-PROOF-0212A', array['SE', 'นายกสโม', 'SE'])).samo_depts::text;
do $$ begin
  perform public.set_project_samo_depts('PRJ-PROOF-0212A', array['ไม่มีฝ่ายนี้']);
  insert into probe values ('3b. an unknown ฝ่ายสโม value is refused', 'refused', 'ALLOWED');
exception when others then
  insert into probe values ('3b. an unknown ฝ่ายสโม value is refused', 'refused',
    case when sqlerrm like '%ไม่รู้จักฝ่ายสโม%' then 'refused' else sqlerrm end);
end $$;
insert into probe select '3c. the refused call left 3a''s tags untouched', '{SE,นายกสโม}',
  (select samo_depts from public.projects where id = 'PRJ-PROOF-0212A')::text;
reset role;

-- §3d ALLOW — role=dev, NO stored seat and NO master permission, can tag
-- too: current_user_can_publish_project() is role-OR-seat, not seat alone.
-- Targets B (not A) and asserts the function's OWN return value, so §4's
-- later overwrite of B by a master doesn't need to leave this undone.
select set_config('request.jwt.claims', json_build_object('sub', (select uid from subj_dev)::text, 'role','authenticated')::text, true);
set local role authenticated;
insert into probe select '3d. a role=dev account with no seat and no master can tag too', '{อุปนายกฝ่ายกิจการภายใน}',
  (public.set_project_samo_depts('PRJ-PROOF-0212B', array['อุปนายกฝ่ายกิจการภายใน'])).samo_depts::text;
reset role;

-- §4 ALLOW — a master with no stored seat (0111's fold into vpa).
select set_config('request.jwt.claims', json_build_object('sub', (select uid from subj_master)::text, 'role','authenticated')::text, true);
set local role authenticated;
insert into probe select '4. a master (no stored seat) tags PRJ-PROOF-0212B', '{อุปนายกฝ่ายวิชาการ}',
  (public.set_project_samo_depts('PRJ-PROOF-0212B', array['อุปนายกฝ่ายวิชาการ'])).samo_depts::text;
reset role;

-- §5 anon — reads tags on the PUBLIC โครงการ, cannot see the HIDDEN one at all.
select set_config('request.jwt.claims', 'null', true);
set local role anon;
insert into probe select '5a. anon reads samo_depts on a public โครงการ', '{SE,นายกสโม}',
  (select samo_depts from public.projects where id = 'PRJ-PROOF-0212A')::text;
insert into probe select '5b. anon cannot see the hidden โครงการ row at all (not column-specific)', '0',
  (select count(*) from public.projects where id = 'PRJ-PROOF-0212B')::text;
reset role;

select k, expected, got, case when expected = got then 'PASS' else 'FAIL' end as verdict from probe;
rollback;
`;
const rows = JSON.parse(await runSql(SQL, target));
let failed = 0;
for (const r of rows) {
  const ok = r.verdict === 'PASS';
  if (!ok) failed += 1;
  console.log(`${ok ? '✓' : '✗'} ${r.k}: expected ${r.expected}, got ${r.got}`);
}
console.log(`\n${rows.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
