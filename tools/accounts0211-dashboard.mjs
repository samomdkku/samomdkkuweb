#!/usr/bin/env node
// ============================================================
// accounts0211-dashboard.mjs — the บัญชีผู้ใช้ dashboard read (0211).
//
// One transaction that ROLLS BACK. It asks the LIVE database:
//  1. ACL: anon cannot call either function (read from has_function_privilege,
//     not from the revoke we wrote).
//  2. DENY beside ALLOW over the same functions: a signed-in account without
//     `master` is refused BOTH; a master reads every account and every carried
//     passport profile — the counts are compared with the tables themselves, so
//     a join that drops or duplicates an account is red.
//  3. The method bug stays fixed: no public.users row disagrees with the
//     provider auth recorded, and a NEW Google sign-up (a probe auth.users row)
//     is born 'google'; a username sign-up is born 'password'.
//
//   node tools/accounts0211-dashboard.mjs     # production (VITE_SUPABASE_URL=… for dev)
// RUN BEFORE 0211 AND IT ERRORS (no function).
// ============================================================
import { announceTarget, runSql } from './env-lib.mjs';

const target = announceTarget();
const SQL = `begin;
create temporary table probe(k text, expected text, got text);
do $$ begin
  execute format('grant usage on schema %s to authenticated', pg_my_temp_schema()::regnamespace);
end $$;
grant select, insert on probe to authenticated;

-- 0232 changed the signature to account_dashboard(integer default null) and
-- dropped the old zero-arg overload — the OLD signature string here used to
-- raise 42883 ("does not exist") instead of returning false, which is not a
-- caught exception anywhere in this script and killed the whole proof.
insert into probe select 'acl: anon cannot read the dashboard', 'false',
  has_function_privilege('anon', 'public.account_dashboard(integer)', 'execute')::text;
insert into probe select 'acl: anon cannot read the pulse', 'false',
  has_function_privilege('anon', 'public.account_dashboard_pulse()', 'execute')::text;

insert into probe select 'method: no stored method disagrees with auth', '0',
  (select count(*)::text from public.users u join auth.users a on a.id = u.id
    where u.method is distinct from
          (case when a.raw_app_meta_data->>'provider' = 'google' then 'google' else 'password' end));

-- Without this trigger NO sign-up gets a public.users row at all — say so by
-- name, rather than letting the next two read as a method bug. (samo-dev was
-- built from a dump that carried no auth.users triggers: HANDOFF §19.)
insert into probe select 'trigger: on_auth_user_created is installed', 'true',
  exists (select 1 from pg_trigger where tgrelid = 'auth.users'::regclass
           and tgname = 'on_auth_user_created' and tgenabled <> 'D')::text;

-- A NEW sign-up, each way. Synthetic addresses; the transaction rolls back.
insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data)
values ('00000000-0000-4000-8000-000000000211', 'probe0211-g@probe.invalid',
        '{"provider":"google","providers":["google"]}', '{"full_name":"probe"}'),
       ('00000000-0000-4000-8000-000000000212', 'probe0211-p@samomdkku.app',
        '{"provider":"email","providers":["email"]}', '{"username":"probe0211p","method":"password"}');
insert into probe select 'trigger: a Google sign-up is born google', 'google',
  (select method from public.users where id = '00000000-0000-4000-8000-000000000211');
insert into probe select 'trigger: a username sign-up is born password', 'password',
  (select method from public.users where id = '00000000-0000-4000-8000-000000000212');

create temporary table stu as select u.id from public.users u
  where not ('master' = any(coalesce(u.permissions,'{}') || coalesce(u.managed_permissions,'{}')))
    and u.role = 'user'
  order by u.id limit 1;
create temporary table adm as select u.id from public.users u
  where 'master' = any(coalesce(u.permissions,'{}') || coalesce(u.managed_permissions,'{}'))
  order by u.id limit 1;
create temporary table truth as select
  (select count(*) from auth.users) acc,
  (select count(*) from passport.profiles pp where not exists (select 1 from auth.users a where a.id = pp.id)) orph,
  (select count(*) from public.people) ppl;
grant select on stu, adm, truth to authenticated;

-- DENY
select set_config('request.jwt.claims', json_build_object('sub', (select id from stu), 'role','authenticated')::text, true);
set local role authenticated;
insert into probe values ('subject: the student does not hold master', 'false', public.current_user_has_permission('master')::text);
do $$ begin
  perform public.account_dashboard();
  insert into probe values ('deny: a non-master cannot read the dashboard', 'refused', 'ALLOWED');
exception when others then insert into probe values ('deny: a non-master cannot read the dashboard', 'refused', case when sqlstate = '42501' then 'refused' else sqlerrm end); end $$;
do $$ begin
  perform public.account_dashboard_pulse();
  insert into probe values ('deny: a non-master cannot read the pulse', 'refused', 'ALLOWED');
exception when others then insert into probe values ('deny: a non-master cannot read the pulse', 'refused', case when sqlstate = '42501' then 'refused' else sqlerrm end); end $$;
do $$ begin
  perform 1 from auth.users limit 1;
  insert into probe values ('deny: auth.users itself stays unreadable', 'refused', 'ALLOWED');
exception when others then insert into probe values ('deny: auth.users itself stays unreadable', 'refused', case when sqlstate = '42501' then 'refused' else sqlerrm end); end $$;
reset role;

-- ALLOW
select set_config('request.jwt.claims', json_build_object('sub', (select id from adm), 'role','authenticated')::text, true);
set local role authenticated;
create temporary table d as select public.account_dashboard() j;
insert into probe select 'allow: a master sees every account, once each', (select acc::text from truth),
  (select count(distinct x->>'id')::text from d, jsonb_array_elements(j->'accounts') x
    where jsonb_array_length(j->'accounts') = (select acc from truth));
insert into probe select 'allow: …including the two probe sign-ups', '2',
  (select count(*)::text from d, jsonb_array_elements(j->'accounts') x
    where x->>'id' in ('00000000-0000-4000-8000-000000000211', '00000000-0000-4000-8000-000000000212'));
insert into probe select 'allow: every carried passport profile with no account', (select orph::text from truth),
  (select jsonb_array_length(j->'passport_orphans')::text from d);
insert into probe select 'allow: the roster covers every person', (select ppl::text from truth),
  (select sum((r->>'n')::int)::text from d, jsonb_array_elements(j->'roster') r);
insert into probe select 'allow: the pulse answers', 'true',
  ((public.account_dashboard_pulse() ->> 'v') ~ '^[0-9a-f]{32}$')::text;
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
