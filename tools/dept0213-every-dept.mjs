#!/usr/bin/env node
// ============================================================
// dept0213-every-dept.mjs — all 12 ฝ่าย have a page, and only ITS people edit
// it (0213).
//
// ONE TRANSACTION, ROLLED BACK. Asks the LIVE database:
//  1. Every (name, key) pair THIS MIGRATION FILE carries — parsed from the
//     .sql, never retyped — resolves to exactly one top-level division node,
//     and that node now carries the matching dept_page. (Read from the
//     authority, not asserted against a copy of the list — class 7.)
//  2. A brand-new leaf, posted under one of the SIX ฝ่าย this migration is
//     actually for (ฝ่ายกิจการภายใน, which had NO grantable editor before
//     0213), inherits exactly {internal} through the chain 0177 built —
//     proving the migration's write reaches `node_effective_dept_pages()`,
//     not just a column nobody reads.
//  3. CONTROL: before that scope is synced onto any account, a plain subject
//     cannot write a single row of dept_content — deny-only would not tell a
//     working guard from `using (true)` (0177's own lesson, reused here).
//  4. ALLOW: once synced, the SAME subject edits ฝ่ายกิจการภายใน's page.
//  5. DENY: the SAME subject is refused on ฝ่ายกิจการภายนอก's page — a
//     member of one ฝ่าย can edit theirs and NOT another's.
//
//   node tools/dept0213-every-dept.mjs            # production (VITE_SUPABASE_URL=… for dev)
// RUN BEFORE 0213 IS APPLIED AND §1b/§1c REPORT dept_page = NULL.
// ============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { announceTarget, runSql } from './env-lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATION = readFileSync(
  join(HERE, '../supabase/migrations/0213_dept_pages_for_every_dept.sql'), 'utf8',
);

// Parsed from the migration's own VALUES list — a hardcoded copy here would be
// a guard written from the same list the code came from, which proves only
// that two copies agree (`.claude/rules/mistakes.md` class 7).
const PAIRS = [...MIGRATION.matchAll(/\(\s*'([^']+)',\s*'([a-z]+)'\s*\)/g)]
  .map(([, name, key]) => ({ name, key }));

const target = announceTarget();

if (PAIRS.length !== 12) {
  console.error(`expected 12 (name, key) pairs parsed out of the migration, got ${PAIRS.length} — `
    + 'did the VALUES list shape change? Fix the regex, not the count.');
  process.exit(2);
}
// The two ฝ่าย the scoped-write half (§2-5) exercises must be IN that parsed
// list, or this proof is testing a pair the migration no longer sets.
for (const name of ['ฝ่ายกิจการภายใน', 'ฝ่ายกิจการภายนอก']) {
  if (!PAIRS.some((p) => p.name === name)) {
    console.error(`the migration's parsed pairs no longer include ${name}`);
    process.exit(2);
  }
}

const expectValues = PAIRS
  .map((p) => `('${p.name.replace(/'/g, "''")}', '${p.key}')`)
  .join(',\n    ');

const SQL = `begin;
create temporary table probe(k text, expected text, got text);

-- ── §1: every pair the migration carries resolves, and lands correctly ─────
create temporary table expect(dept_name text, dept_key text) on commit drop;
insert into expect values
    ${expectValues};

create temporary table resolved on commit drop as
  select e.dept_name, e.dept_key,
         (select count(*) from public.team_nodes tn
           where tn.kind = 'division' and tn.parent_id is null and tn.name = e.dept_name) as n_nodes,
         (select tn.dept_page from public.team_nodes tn
           where tn.kind = 'division' and tn.parent_id is null and tn.name = e.dept_name
           limit 1) as got_key
    from expect e;

insert into probe
  select '1a. exactly one top-level division node named ' || dept_name, '1', n_nodes::text
    from resolved;
insert into probe
  select '1b. ' || dept_name || ' carries dept_page = ' || dept_key, dept_key, coalesce(got_key, 'NULL')
    from resolved;

-- ⚠️ the control: the parse must actually find TWO distinct keys, or the
-- assertion above would be true of an empty or single-row list too.
insert into probe select '1c. control — the parsed list names more than one distinct dept_key', 'true',
  ((select count(distinct dept_key) from expect) > 1)::text;

-- ── §2: a brand-new leaf posted under one of the SIX ฝ่าย this migration
-- newly covers inherits through the chain 0177 built, not a direct grant ─────
create temporary table top_nodes on commit drop as
  select name, id from public.team_nodes
   where kind = 'division' and parent_id is null
     and name in ('ฝ่ายกิจการภายใน', 'ฝ่ายกิจการภายนอก');

insert into probe select '2a. both top nodes for the scoped-write test exist', '2',
  (select count(*) from top_nodes)::text;

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
