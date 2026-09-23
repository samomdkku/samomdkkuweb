#!/usr/bin/env node
// ============================================================
// discord0208-panel.mjs — the Discord bot's switch and panel (0208).
//
// One transaction that ROLLS BACK. It asks the LIVE database:
//  1. TABLES: RLS on, and anon/authenticated hold NO privilege on either table
//     (read from has_table_privilege, not from the revoke we wrote).
//  2. DENY beside ALLOW over the same function: a signed-in student without
//     `discord_bot` is refused; a holder (a master) switches the bot off with
//     a reason and back on, and the database stamps WHO — not the client.
//  3. Off without a reason is refused; a direct UPDATE by `authenticated`
//     changes nothing (no grant at all).
//
//   node tools/discord0208-panel.mjs            # production (VITE_SUPABASE_URL=… for dev)
// RUN BEFORE 0208 AND IT ERRORS (no table).
// ============================================================
import { announceTarget, runSql } from './env-lib.mjs';

const target = announceTarget();
const SQL = `begin;
create temporary table probe(k text, expected text, got text);
do $$ begin
  execute format('grant usage on schema %s to authenticated', pg_my_temp_schema()::regnamespace);
end $$;
grant select, insert on probe to authenticated;

insert into probe select 'tables: RLS on both', 'true',
  (select bool_and(relrowsecurity)::text from pg_class where oid in ('public.discord_bot_settings'::regclass, 'public.discord_bot_status'::regclass));
insert into probe select 'tables: authenticated has no privilege', 'false',
  (has_table_privilege('authenticated', 'public.discord_bot_settings', 'select,update,insert,delete')
   or has_table_privilege('authenticated', 'public.discord_bot_status', 'select,update,insert,delete'))::text;
insert into probe select 'tables: anon has no privilege', 'false',
  (has_table_privilege('anon', 'public.discord_bot_settings', 'select,update,insert,delete')
   or has_table_privilege('anon', 'public.discord_bot_status', 'select,update,insert,delete'))::text;
insert into probe select 'acl: anon cannot call the switch', 'false',
  has_function_privilege('anon', 'public.set_discord_bot(boolean,boolean,boolean,text)', 'execute')::text;

create temporary table stu as select u.id from public.users u
  where not ('discord_bot' = any(coalesce(u.permissions,'{}') || coalesce(u.managed_permissions,'{}')))
    and not ('master' = any(coalesce(u.permissions,'{}') || coalesce(u.managed_permissions,'{}')))
  order by u.id limit 1;
create temporary table adm as select u.id from public.users u
  where 'master' = any(coalesce(u.permissions,'{}') || coalesce(u.managed_permissions,'{}'))
  order by u.id limit 1;
grant select on stu, adm to authenticated;

-- DENY
select set_config('request.jwt.claims', json_build_object('sub', (select id from stu), 'role','authenticated')::text, true);
set local role authenticated;
insert into probe values ('subject: the student lacks discord_bot', 'false', public.current_user_has_permission('discord_bot')::text);
do $$ begin
  perform public.set_discord_bot(false, null, null, 'probe off');
  insert into probe values ('deny: a student cannot switch the bot off', 'refused', 'ALLOWED');
exception when others then insert into probe values ('deny: a student cannot switch the bot off', 'refused', case when sqlstate = '42501' then 'refused' else sqlerrm end); end $$;
do $$ begin
  perform public.get_discord_bot_panel();
  insert into probe values ('deny: a student cannot read the panel', 'refused', 'ALLOWED');
exception when others then insert into probe values ('deny: a student cannot read the panel', 'refused', case when sqlstate = '42501' then 'refused' else sqlerrm end); end $$;
do $$ begin
  update public.discord_bot_settings set sync_enabled = false, note = 'direct';
  insert into probe values ('deny: a direct UPDATE is refused', 'refused', 'ALLOWED');
exception when others then insert into probe values ('deny: a direct UPDATE is refused', 'refused', case when sqlstate = '42501' then 'refused' else sqlerrm end); end $$;
reset role;

-- ALLOW
select set_config('request.jwt.claims', json_build_object('sub', (select id from adm), 'role','authenticated')::text, true);
set local role authenticated;
insert into probe values ('subject: the admin holds it (via master)', 'true', public.current_user_has_permission('discord_bot')::text);
do $$ begin
  perform public.set_discord_bot(false, null, null, '');
  insert into probe values ('rule: off without a reason is refused', 'refused', 'ALLOWED');
exception when others then insert into probe values ('rule: off without a reason is refused', 'refused', case when sqlstate = '23514' then 'refused' else sqlerrm end); end $$;
insert into probe select 'allow: a holder switches it off', 'false',
  (public.set_discord_bot(false, null, null, 'probe off') ->> 'sync_enabled');
reset role;
insert into probe select 'stamp: WHO is the caller, set by the database', 'true',
  ((select changed_by from public.discord_bot_settings) = (select id from adm))::text;
set local role authenticated;
insert into probe select 'allow: …and back on, keeping the reason', 'true|probe off',
  (select (p ->> 'sync_enabled') || '|' || (p ->> 'note') from (select public.set_discord_bot(true, null, null, null) p) x);
insert into probe select 'allow: "check everything now" is stamped', 'true',
  ((public.request_discord_full_pass() ->> 'full_pass_requested_at') is not null)::text;
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
