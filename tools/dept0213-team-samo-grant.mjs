#!/usr/bin/env node
// ============================================================
// dept0213-team-samo-grant.mjs — a หน้าฝ่าย grant SET IN ทีม SAMO, on one of
// the six ฝ่าย 0213 added, lets that ฝ่าย's people edit its page and not
// another's (0213).
//
// 0213 itself grants nothing (owner, 2026-10-13: who edits a ฝ่าย's page is
// chosen in ทีม SAMO → สิทธิ์ → หน้าฝ่าย). So this proof plays the ADMIN: inside
// one rolled-back transaction it sets `dept_page = 'internal'` on the real
// ฝ่ายกิจการภายใน node — exactly the write the ทีม SAMO picker makes — and
// then asks the live database:
//  1. 0213 is applied (its column comment is installed), and the grant the
//     proof is about to make is not already there by accident.
//  2. A brand-new leaf posted under ฝ่ายกิจการภายใน inherits exactly
//     {internal} through the chain 0177 built.
//  3. CONTROL: before that scope is synced onto any account, a plain subject
//     cannot write a single row of dept_content.
//  4. ALLOW: once synced, the SAME subject edits ฝ่ายกิจการภายใน's page.
//  5. DENY: the SAME subject is refused on ฝ่ายกิจการภายนอก's page.
//
//   node tools/dept0213-team-samo-grant.mjs   # production (VITE_SUPABASE_URL=… for dev)
// ============================================================
import { announceTarget, runSql } from './env-lib.mjs';

const target = announceTarget();

const SQL = `begin;
create temporary table probe(k text, expected text, got text);

-- ── §1: 0213 is applied, and the admin's grant below is not pre-existing ──
insert into probe select '1a. 0213 applied — team_nodes.dept_page carries its comment', 'true',
  (coalesce(col_description('public.team_nodes'::regclass,
     (select attnum from pg_attribute where attrelid = 'public.team_nodes'::regclass and attname = 'dept_page')),
   '') like '%never by a migration (0213)%')::text;

-- ── §2: a brand-new leaf posted under one of the SIX ฝ่าย 0213 added
-- inherits the admin's grant through the chain 0177 built ─────────────────
create temporary table top_nodes on commit drop as
  select name, id from public.team_nodes
   where kind = 'division' and parent_id is null
     and name in ('ฝ่ายกิจการภายใน', 'ฝ่ายกิจการภายนอก');

insert into probe select '2a. both top nodes for the scoped-write test exist', '2',
  (select count(*) from top_nodes)::text;

-- THE ADMIN'S CHOICE, as the ทีม SAMO หน้าฝ่าย picker writes it. Rolled back
-- with everything else; the node keeps whatever an admin really set.
update public.team_nodes set dept_page = 'internal'
 where id = (select id from top_nodes where name = 'ฝ่ายกิจการภายใน');
insert into probe select '2a2. ฝ่ายกิจการภายนอก does not also grant internal (the deny below means something)', 'false',
  ('internal' = any(public.node_effective_dept_pages((select id from top_nodes where name = 'ฝ่ายกิจการภายนอก'))))::text;

insert into public.team_nodes (id, parent_id, name, kind, inherit_permissions)
values ('00000000-0000-4000-8000-000000021301',
        (select id from top_nodes where name = 'ฝ่ายกิจการภายใน'),
        'proof role (0213)', 'role', true);
insert into public.team_members (id, node_id, full_name, kkumail)
values ('00000000-0000-4000-8000-000000021302', '00000000-0000-4000-8000-000000021301',
        'Proof Member 0213', 'proof-dept0213@example.invalid');

insert into probe select '2b. a leaf posted under ฝ่ายกิจการภายใน inherits exactly {internal}', '{internal}',
  public.effective_team_dept_pages_for_email('proof-dept0213@example.invalid')::text;

-- ── Subject + target rows for §3-5 ──────────────────────────────────────────
create temporary table subj on commit drop as
select u.id as uid from public.users u
 where u.role = 'user'
   and coalesce(u.permissions, '{}') = '{}'
   and coalesce(u.managed_permissions, '{}') = '{}'
   and coalesce(u.managed_dept_pages, '{}') = '{}'
 order by u.id limit 1;

insert into probe select '2c. a plain ungranted subject exists for the write test', 'true',
  (select count(*) > 0 from subj)::text;

insert into public.dept_content (id, dept, kind, position, title, href)
values ('00000000-0000-4000-8000-000000021303', 'internal', 'card', 1, 'proof row (internal)', 'https://example.invalid/i'),
       ('00000000-0000-4000-8000-000000021304', 'external', 'card', 1, 'proof row (external)', 'https://example.invalid/e');

create or replace function pg_temp.wr(p_uid uuid, p_sql text)
returns text as $$
declare n int; msg text;
begin
  begin
    perform set_config('request.jwt.claims',
      json_build_object('sub', p_uid::text, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    execute p_sql;
    get diagnostics n = row_count;
    raise exception using errcode = '22000',
      message = 'UNDO:' || case when n > 0 then 'allow' else 'deny-rls' end;
  exception
    when sqlstate '22000' then
      get stacked diagnostics msg = message_text;
      execute 'reset role';
      return replace(msg, 'UNDO:', '');
    when others then
      execute 'reset role';
      return 'ERROR';
  end;
end $$ language plpgsql;

-- ── §3 CONTROL — before any scope is synced, the subject cannot write
-- dept_content at all. A deny-only result from §5 alone would not tell this
-- guard apart from a table nobody can reach (0177's own lesson). ────────────
insert into probe select '3. control — with no grant yet, deny on internal too', 'deny-rls',
  pg_temp.wr((select uid from subj),
    $q$update public.dept_content set title = 'nope' where id = '00000000-0000-4000-8000-000000021303'$q$);

-- ── Sync the resolved scope onto the subject — the SAME function §2b called,
-- never a hardcoded array['internal']. This is the one write
-- sync_my_team_permissions() would make for this person at their next login;
-- users_self_update_guard refuses it from anyone else, so it is disabled only
-- for this one setup statement (mirrors dept0177-page-scope.sql). ──────────
alter table public.users disable trigger users_self_update_guard;
update public.users
   set managed_dept_pages = public.effective_team_dept_pages_for_email('proof-dept0213@example.invalid')
 where id = (select uid from subj);
alter table public.users enable trigger users_self_update_guard;

insert into probe select '4. the subject now carries exactly {internal}', '{internal}',
  (select managed_dept_pages::text from public.users where id = (select uid from subj));

-- ── §5 ALLOW — the subject edits ฝ่ายกิจการภายใน's page ─────────────────────
insert into probe select '5. allow — edits its OWN ฝ่าย (internal)', 'allow',
  pg_temp.wr((select uid from subj),
    $q$update public.dept_content set title = 'edited' where id = '00000000-0000-4000-8000-000000021303'$q$);

-- ── §6 DENY — the SAME subject is refused on ฝ่ายกิจการภายนอก's page ────────
insert into probe select '6. deny — refused on a DIFFERENT ฝ่าย (external)', 'deny-rls',
  pg_temp.wr((select uid from subj),
    $q$update public.dept_content set title = 'stolen' where id = '00000000-0000-4000-8000-000000021304'$q$);

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
