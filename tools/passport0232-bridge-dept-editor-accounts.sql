-- ============================================================
-- passport0232-bridge-dept-editor-accounts.sql — the three independent
-- pieces migration 0232 shipped (task 10, night queue 2026-10-18):
--
--   §0  structural: the bridge column, the new RPC and account_dashboard's
--       single surviving signature all exist as documented
--   §A  passport.samo_years.team_term_year — settable, reads back exactly,
--       and carries NO FK (a team_terms year that does not exist is still
--       accepted — reference data, not a boundary; see 0232's own header)
--   §B  dept_content_editor_info(p_dept) — gated with the EXACT SAME
--       predicate as dept_content's own RLS (current_user_dept_page_scope,
--       0177/dept0177-page-scope.sql): a scoped editor reads their OWN
--       ฝ่าย's last-edit, is refused on ANOTHER ฝ่าย, the blanket
--       ('dept_pages') key reads any ฝ่าย, and an ungranted signed-in
--       account is refused same as dept_content itself — paired ALLOW/DENY
--       over the SAME predicate, never a deny-only probe (class 7). The
--       editor's name resolves through public.people/users even though
--       NEITHER table is directly readable to a dept_page-only grantee
--       (0132/0147) — proven by giving the synthetic editor an EXACT,
--       unique display_name and asserting the function returns precisely
--       that string, not merely "non-null".
--   §C  account_dashboard(p_samo_year_be) — the new OPTIONAL filter scopes
--       PR/VS/Shop/Projects activity counts for one account; p_samo_year_be
--       omitted (old zero-arg call shape) still works and is UNSCOPED,
--       exactly 0211's original behaviour, so nothing that already calls
--       account_dashboard() broke
--
-- Sentinel SAMO years 2697/2698 — distinct from every other proof's own
-- range (year0219 2691/2692, pr0220/vs0221 2693/2694, proj0223's own,
-- shop0230 2695/2696). Everything here is created inside this transaction
-- and rolled back at the end; nothing is left behind.
--
--   node tools/db-query.mjs tools/passport0232-bridge-dept-editor-accounts.sql --dev
-- ============================================================
begin;

create temporary table probe (step text, expected text, got text) on commit drop;

-- ── §0 structural ────────────────────────────────────────────────────────
insert into probe select '00. passport.samo_years.team_term_year exists, nullable integer', '1',
  (select count(*)::text from information_schema.columns
    where table_schema = 'passport' and table_name = 'samo_years'
      and column_name = 'team_term_year' and data_type = 'integer' and is_nullable = 'YES');
insert into probe select '01. no FK from team_term_year to public.team_terms', '0',
  (select count(*)::text from pg_constraint
    where conrelid = 'passport.samo_years'::regclass and contype = 'f'
      and pg_get_constraintdef(oid) ilike '%team_term_year%');
insert into probe select '02. dept_content_editor_info(text) exists', 'true',
  (select (count(*) > 0)::text from pg_proc
    where proname = 'dept_content_editor_info' and pronamespace = 'public'::regnamespace);
insert into probe select '03. account_dashboard has exactly ONE signature (integer, default null)', '1',
  (select count(*)::text from pg_proc
    where proname = 'account_dashboard' and pronamespace = 'public'::regnamespace);
insert into probe select '04. acl: anon cannot call dept_content_editor_info', 'false',
  has_function_privilege('anon', 'public.dept_content_editor_info(text)', 'execute')::text;
insert into probe select '05. acl: anon cannot call account_dashboard', 'false',
  has_function_privilege('anon', 'public.account_dashboard(integer)', 'execute')::text;

-- ── §A passport.samo_years.team_term_year ───────────────────────────────
insert into passport.samo_years (id, name, team_term_year)
values ('00000000-0000-4000-8000-000000023201', 'proof-0232-with-bridge', 2699);
insert into passport.samo_years (id, name)
values ('00000000-0000-4000-8000-000000023202', 'proof-0232-no-bridge');

insert into probe select '10. set at insert reads back exactly', '2699',
  (select team_term_year::text from passport.samo_years
    where id = '00000000-0000-4000-8000-000000023201');
insert into probe select '11. omitted at insert defaults to null', 'null',
  coalesce((select team_term_year::text from passport.samo_years
    where id = '00000000-0000-4000-8000-000000023202'), 'null');
-- A team_term_year that resolves to NO row in public.team_terms is still
-- accepted — it is reference data (same caution as team_majors), not an FK
-- boundary. 9999 พ.ศ. cannot exist as a real ทีม SAMO term.
update passport.samo_years set team_term_year = 9999
 where id = '00000000-0000-4000-8000-000000023202';
insert into probe select '12. a team_term_year with no matching team_terms row is accepted (no FK)', '9999',
  (select team_term_year::text from passport.samo_years
    where id = '00000000-0000-4000-8000-000000023202');

delete from passport.samo_years where id in
  ('00000000-0000-4000-8000-000000023201', '00000000-0000-4000-8000-000000023202');

-- ── §B dept_content_editor_info — subjects ──────────────────────────────
-- Four accounts, created fresh (not found): this grant shape already has
-- holders in production, but a proof that searched for one would be green
-- for as long as nobody happened to be named 'ไม่ทราบ' by accident. Minimal
-- auth.users row + a public.users row UPSERTED (production's
-- on_auth_user_created trigger — and samo-dev's since 0234 — already made one;
-- a plain insert errored with users_pkey there) with an
-- EXACT, unique, synthetic display_name — nothing here is a real person.
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-000000023210', 'proof0232-editor@probe.invalid'),
  ('00000000-0000-4000-8000-000000023211', 'proof0232-other@probe.invalid'),
  ('00000000-0000-4000-8000-000000023212', 'proof0232-blanket@probe.invalid'),
  ('00000000-0000-4000-8000-000000023213', 'proof0232-none@probe.invalid');

alter table public.users disable trigger users_self_update_guard;
insert into public.users (id, display_name, role, managed_dept_pages) values
  ('00000000-0000-4000-8000-000000023210', 'Proof0232 Editor Digital', 'user', array['digital'])
  on conflict (id) do update set display_name = excluded.display_name, role = excluded.role, managed_dept_pages = excluded.managed_dept_pages;
insert into public.users (id, display_name, role, managed_dept_pages) values
  ('00000000-0000-4000-8000-000000023211', 'Proof0232 Editor Academic', 'user', array['academic'])
  on conflict (id) do update set display_name = excluded.display_name, role = excluded.role, managed_dept_pages = excluded.managed_dept_pages;
insert into public.users (id, display_name, role, permissions) values
  ('00000000-0000-4000-8000-000000023212', 'Proof0232 Blanket', 'user', array['dept_pages'])
  on conflict (id) do update set display_name = excluded.display_name, role = excluded.role, permissions = excluded.permissions;
insert into public.users (id, display_name, role) values
  ('00000000-0000-4000-8000-000000023213', 'Proof0232 Ungranted', 'user')
  on conflict (id) do update set display_name = excluded.display_name, role = excluded.role;
alter table public.users enable trigger users_self_update_guard;

insert into probe select '20. four fresh subjects exist', '4',
  (select count(*)::text from public.users
    where id in ('00000000-0000-4000-8000-000000023210', '00000000-0000-4000-8000-000000023211',
                 '00000000-0000-4000-8000-000000023212', '00000000-0000-4000-8000-000000023213'));

-- As the DIGITAL editor, save a row on 'digital' — the touch trigger
-- (dept_content_touch, 0177) stamps updated_by = auth.uid() ONLY when the
-- write happens as that authenticated user, same as the real app, so this
-- is also §A of a correctness proof the editor-info RPC does not duplicate.
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-000000023210', 'role', 'authenticated')::text, true);
set local role authenticated;
insert into public.dept_content (id, dept, kind, position, title, href)
values ('00000000-0000-4000-8000-000000023220', 'digital', 'card', 1, 'proof 0232 row', 'https://example.invalid/0232');
reset role;
reset session authorization;

insert into probe select '21. the probe row was stamped with the editor who wrote it', '00000000-0000-4000-8000-000000023210',
  (select updated_by::text from public.dept_content where id = '00000000-0000-4000-8000-000000023220');

-- ── §B instrument — call the RPC as each subject, catch + classify ──────
create or replace function pg_temp.call_editor_info(p_uid uuid, p_dept text)
returns text as $$
declare n int; names text; msg text;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*), string_agg(editor_name, '|')
    into n, names
    from public.dept_content_editor_info(p_dept);
  execute 'reset role';
  return 'ok:' || n || ':' || coalesce(names, '');
exception
  when others then
    get stacked diagnostics msg = message_text;
    execute 'reset role';
    return case when msg like '%not an editor of%' then 'refused' else 'ERROR ' || left(msg, 60) end;
end $$ language plpgsql;

-- ALLOW: the scoped editor reads their OWN ฝ่าย, name resolved exactly.
insert into probe select '30. digital editor reads digital: 1 row, exact editor_name', 'ok:1:Proof0232 Editor Digital',
  pg_temp.call_editor_info('00000000-0000-4000-8000-000000023210', 'digital');

-- DENY: the SAME predicate dept_content's own RLS uses — a scoped editor
-- refused on ANOTHER ฝ่าย. Without this, §30 would pass just as well
-- against a function with no scope check at all.
insert into probe select '31. academic editor reads digital: refused', 'refused',
  pg_temp.call_editor_info('00000000-0000-4000-8000-000000023211', 'digital');

-- ALLOW over an EMPTY result is a different answer from refused: the
-- academic editor asking about their OWN (empty) ฝ่าย gets zero rows, not
-- an exception — the predicate passed, there is just nothing to report yet.
insert into probe select '32. academic editor reads academic (no row yet): allowed, empty', 'ok:0:',
  pg_temp.call_editor_info('00000000-0000-4000-8000-000000023211', 'academic');

-- ALLOW: the blanket key (scope = null) reads ANY ฝ่าย.
insert into probe select '33. blanket key reads digital', 'ok:1:Proof0232 Editor Digital',
  pg_temp.call_editor_info('00000000-0000-4000-8000-000000023212', 'digital');

-- DENY: an ungranted signed-in account — same shape as dept_content's own
-- RLS refusing it (dept0177 §50-55).
insert into probe select '34. ungranted account reads digital: refused', 'refused',
  pg_temp.call_editor_info('00000000-0000-4000-8000-000000023213', 'digital');

-- ── §C account_dashboard(p_samo_year_be) ────────────────────────────────
-- One synthetic buyer/submitter whose PR/VS/Shop/Projects activity is
-- split across two sentinel years — 2697 (3 PR, 2 VS, 2 shop, 1 project)
-- and 2555 (2 PR, 1 VS, 0 shop, 1 project) — so a year filter that silently
-- ignored samo_year_be (returning the SAME total for every year argument)
-- is caught, not just "a number came back".
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-000000023230', 'proof0232-actor@probe.invalid');
alter table public.users disable trigger users_self_update_guard;
insert into public.users (id, display_name, role) values
  ('00000000-0000-4000-8000-000000023230', 'Proof0232 Actor', 'user')
  on conflict (id) do update set display_name = excluded.display_name, role = excluded.role;
alter table public.users enable trigger users_self_update_guard;

insert into public.pr_tickets (id, department, content_name, status, submitter_id, samo_year_be) values
  ('PR-TEST0232A', 'ฝ่ายดิจิทัลและสื่อสารองค์กร', 'proof 0232 — 2697 a', 'รอ PR รับเรื่อง', '00000000-0000-4000-8000-000000023230', 2697),
  ('PR-TEST0232B', 'ฝ่ายดิจิทัลและสื่อสารองค์กร', 'proof 0232 — 2697 b', 'รอ PR รับเรื่อง', '00000000-0000-4000-8000-000000023230', 2697),
  ('PR-TEST0232C', 'ฝ่ายดิจิทัลและสื่อสารองค์กร', 'proof 0232 — 2697 c', 'รอ PR รับเรื่อง', '00000000-0000-4000-8000-000000023230', 2697),
  ('PR-TEST0232D', 'ฝ่ายดิจิทัลและสื่อสารองค์กร', 'proof 0232 — 2555 a', 'รอ PR รับเรื่อง', '00000000-0000-4000-8000-000000023230', 2555),
  ('PR-TEST0232E', 'ฝ่ายดิจิทัลและสื่อสารองค์กร', 'proof 0232 — 2555 b', 'รอ PR รับเรื่อง', '00000000-0000-4000-8000-000000023230', 2555);

insert into public.vs_tickets (id, problem, target_dept, status, submitter_id, samo_year_be) values
  ('VS-TEST0232A', 'proof 0232 — 2697 a', 'SE', 'รอ SE รับเรื่อง', '00000000-0000-4000-8000-000000023230', 2697),
  ('VS-TEST0232B', 'proof 0232 — 2697 b', 'SE', 'รอ SE รับเรื่อง', '00000000-0000-4000-8000-000000023230', 2697),
  ('VS-TEST0232C', 'proof 0232 — 2555 a', 'SE', 'รอ SE รับเรื่อง', '00000000-0000-4000-8000-000000023230', 2555);

insert into public.shop_orders (id, buyer_id, status, subtotal, fee, total, samo_year_be) values
  ('SH-TEST0232A', '00000000-0000-4000-8000-000000023230', 'paid', 100, 0, 100, 2697),
  ('SH-TEST0232B', '00000000-0000-4000-8000-000000023230', 'paid', 100, 0, 100, 2697);

insert into public.projects (id, name, status, created_by, samo_year_be) values
  ('PRJ-TEST0232A', 'proof 0232 — 2697', 'open', '00000000-0000-4000-8000-000000023230', 2697),
  ('PRJ-TEST0232B', 'proof 0232 — 2555', 'open', '00000000-0000-4000-8000-000000023230', 2555);

-- As master, read the dashboard three ways: scoped to 2697, scoped to
-- 2555, and unscoped (the old zero-arg call shape — null, the default).
create temporary table adm as
  select u.id from public.users u
   where 'master' = any(coalesce(u.permissions, '{}') || coalesce(u.managed_permissions, '{}'))
   order by u.id limit 1;
insert into probe select '40. a master account exists (for the ALLOW probe)', '1', (select count(*)::text from adm);

create or replace function pg_temp.actor_act(p_year int) returns jsonb as $$
declare j jsonb;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', (select id from adm)::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  if p_year is null then
    select public.account_dashboard() into j;
  else
    select public.account_dashboard(p_year) into j;
  end if;
  execute 'reset role';
  return (select x->'act' from jsonb_array_elements(j->'accounts') x
           where x->>'id' = '00000000-0000-4000-8000-000000023230');
end $$ language plpgsql;

-- jsonb_build_object's own storage order is by KEY LENGTH then lexically
-- (pr/vs before proj/shop, proj before shop) — not insertion order — so the
-- expected literal is written in THAT order, not the order act's own
-- jsonb_build_object() call lists them in the function body.
insert into probe select '50. scoped to 2697: pr=3 vs=2 proj=1 shop=2', '{"pr": 3, "vs": 2, "proj": 1, "shop": 2}',
  pg_temp.actor_act(2697)::text;
insert into probe select '51. scoped to 2555: pr=2 vs=1 proj=1 shop=0', '{"pr": 2, "vs": 1, "proj": 1, "shop": 0}',
  pg_temp.actor_act(2555)::text;
insert into probe select '52. unscoped (old zero-arg call shape, p_samo_year_be omitted): pr=5 vs=3 proj=2 shop=2', '{"pr": 5, "vs": 3, "proj": 2, "shop": 2}',
  pg_temp.actor_act(null)::text;
-- A year nothing was filed under: zero, not an error and not the total.
insert into probe select '53. a year with NO activity for this account: all zero', '{"pr": 0, "vs": 0, "proj": 0, "shop": 0}',
  pg_temp.actor_act(1111)::text;

-- DENY: a non-master still cannot call the year-scoped form either.
insert into probe values ('54. non-master refused even with a year argument', 'refused', null);

do $$
declare ok boolean := false;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', '00000000-0000-4000-8000-000000023213', 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform public.account_dashboard(2697);
    ok := true; -- reached here = NOT refused
  exception when others then
    ok := false;
  end;
  execute 'reset role';
  update probe set got = case when ok then 'ALLOWED' else 'refused' end
   where step = '54. non-master refused even with a year argument';
end $$;

select step,
       case when got is not distinct from expected then 'PASS' else 'FAIL' end as result,
       expected, got
  from probe order by step;

rollback;
