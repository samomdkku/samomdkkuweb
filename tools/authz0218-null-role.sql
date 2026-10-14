-- ============================================================
-- authz0218-null-role.sql — a signed-in caller with no users row is refused
-- by EVERY function that gates on the role, not just the ones we remembered.
--
-- THE PROPERTY, not a list: every public function whose body contains
-- `if not (... current_user_role() ...` is called as (a) a signed-in stranger
-- — must raise — and (b) a real house admin — must NOT fail on the gate.
-- (b) is the control: a sweep that only sees raises cannot tell a working gate
-- from a function that raises for every caller.
--
-- Rolls back.   node tools/db-query.mjs tools/authz0218-null-role.sql
-- ============================================================
begin;
create temporary table probe (step text, expected text, got text) on commit drop;
create temporary table gated on commit drop as
  select p.oid::regprocedure::text as sig, p.proname, p.pronargs
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
     and pg_get_functiondef(p.oid) ~ 'if not \(\s*(public\.)?current_user_role\(\)';
grant select on gated to authenticated;

insert into probe select '00. the sweep found the gated functions (control: not empty)', 'true',
  (select (count(*) >= 10)::text from gated);
insert into probe select '01. the role of a caller with no users row is not NULL', 'false',
  (select (public.current_user_role() is null)::text
     from (select set_config('request.jwt.claims',
             json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true)) s);

create temporary table out (who text, sig text, msg text) on commit drop;
grant insert, select on out to authenticated;
create or replace function pg_temp.call_all(p_who text) returns void language plpgsql as $$
declare g record; v_sql text;
begin
  for g in select * from gated loop
    v_sql := format('select %s(%s)', g.proname,
               (select coalesce(string_agg('null', ','), '') from generate_series(1, g.pronargs)));
    begin
      execute v_sql;
      insert into out values (p_who, g.sig, 'ok');
    exception when others then
      insert into out values (p_who, g.sig, sqlerrm);
    end;
  end loop;
end $$;
grant execute on function pg_temp.call_all(text) to authenticated;

select set_config('request.jwt.claims',
  json_build_object('sub', gen_random_uuid(), 'role', 'authenticated', 'email', 'nobody-0218@kkumail.com')::text, true);
set local role authenticated;
select pg_temp.call_all('stranger');
reset role;

select set_config('request.jwt.claims',
  (select json_build_object('sub', u.id, 'role', 'authenticated', 'email', lower(u.email))::text
     from public.users u
    where u.role in ('vp_admin','dev')
       or 'house'  = any (coalesce(u.permissions,'{}') || coalesce(u.managed_permissions,'{}'))
       or 'master' = any (coalesce(u.permissions,'{}') || coalesce(u.managed_permissions,'{}'))
    order by u.id limit 1), true);
set local role authenticated;
select pg_temp.call_all('admin');
reset role;

insert into probe
select '10. stranger refused: ' || sig, 'refused',
       case when msg ~ '^(ไม่มีสิทธิ์|ต้องเข้าสู่ระบบ)' then 'refused' else msg end
  from out where who = 'stranger';
-- CONTROL: the admin gets PAST the gate (any other error — a null argument —
-- is fine; a permission refusal is not).
insert into probe
select '20. admin passes the gate: ' || sig, 'passed',
       case when msg ~ '^ไม่มีสิทธิ์' then msg else 'passed' end
  from out where who = 'admin';

select step,
       case when got is not distinct from expected then 'PASS' else 'FAIL' end as result,
       expected, got
  from probe order by step;
rollback;
