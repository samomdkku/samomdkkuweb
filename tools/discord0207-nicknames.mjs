#!/usr/bin/env node
// ============================================================
// discord0207-nicknames.mjs — the database half of bot-set nicknames.
//
// One transaction that ROLLS BACK. What it asks of the LIVE database:
//  1. ACL, from pg_proc: discord_nickname_inputs() is service_role only.
//  2. INPUTS: one row per discord_links row — every linked person, no one else.
//  3. TRIGGER, both directions: changing a LINKED person's ชื่อเล่น queues
//     them (kind 'person', with a readable detail); the same change on an
//     UNLINKED person queues nothing; a non-name column on a linked person
//     queues nothing.
//
//   node tools/discord0207-nicknames.mjs      # production (VITE_SUPABASE_URL=… for dev)
// RUN BEFORE 0207 AND IT ERRORS (no function).
// ============================================================
import { announceTarget, runSql } from './env-lib.mjs';

const target = announceTarget();
const SQL = `begin;
create temporary table probe(k text, expected text, got text);
insert into probe values ('acl: service_role can execute', 'true',
  has_function_privilege('service_role', 'public.discord_nickname_inputs()', 'execute')::text);
insert into probe values ('acl: authenticated cannot', 'false',
  has_function_privilege('authenticated', 'public.discord_nickname_inputs()', 'execute')::text);
insert into probe values ('acl: anon cannot', 'false',
  has_function_privilege('anon', 'public.discord_nickname_inputs()', 'execute')::text);
-- (2) is asked AFTER the created link, so it is never 0 = 0.
create temporary table ins_marker as select 1;

-- The subjects are CREATED, not found: dev has no linked account at all, and a
-- proof whose subject can run out goes silent (tooling-proofs.md).
create temporary table up as select p.id from public.people p
  where not exists (select 1 from public.discord_links l where l.person_id = p.id) order by p.id limit 2;
create temporary table lp as select id from up order by id desc limit 1;
delete from up where id = (select id from lp);
insert into public.discord_links (person_id, discord_user_id) select id, '999000000000020701' from lp;
create temporary table q0 as select coalesce(max(id), 0) m from public.discord_sync_queue;

update public.people set nickname = coalesce(nickname, '') || 'zz' where id = (select id from lp);
insert into probe select 'trigger: a linked person''s ชื่อเล่น change is queued', '1',
  (select count(*)::text from public.discord_sync_queue, q0 where id > q0.m and person_id = (select id from lp) and kind = 'person' and detail like '%ชื่อเล่น%');
update public.people set nickname = coalesce(nickname, '') || 'zz' where id = (select id from up);
insert into probe select 'trigger: an UNLINKED person''s change queues nothing', '0',
  (select count(*)::text from public.discord_sync_queue, q0 where id > q0.m and person_id = (select id from up));
update public.people set bio = coalesce(bio, '') || ' ' where id = (select id from lp);
insert into probe select 'trigger: a non-name column queues nothing more', '1',
  (select count(*)::text from public.discord_sync_queue, q0 where id > q0.m and person_id = (select id from lp));
insert into probe values ('inputs: one row per linked account (created link included)',
  (select count(*)::text from public.discord_links),
  (select count(*)::text from public.discord_nickname_inputs()));
insert into probe values ('inputs: the created link is there', '1',
  (select count(*)::text from public.discord_nickname_inputs() where discord_user_id = '999000000000020701'));
insert into probe select 'subject: the two people exist', 'true',
  ((select count(*) from lp) = 1 and (select count(*) from up) = 1)::text;

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
