-- ============================================================
-- passport0182-continents-lockdown.sql — the anon key may READ the passport
-- theming table and may not CHANGE it, and its two deny-all siblings stay
-- deny-all.
--
-- 0182 enables row security on `passport.continents`, the one table the
-- monorepo merge left unprotected (HANDOFF §11). `anon` and `authenticated`
-- hold INSERT/UPDATE/DELETE on it from the Supabase schema default, so before
-- 0182 a holder of the public anon key could rewrite all four rows.
--
-- WHY BOTH DIRECTIONS ARE MANDATORY. "anon cannot write" is half a property —
-- a table whose GRANTs had been revoked, or a broken connection, answers
-- "denied" just as convincingly. The half that says the table is still USABLE
-- is that the same anon principal can still SELECT all four rows. And the half
-- that says the fix was aimed correctly is §C: the two siblings that are
-- deny-all ON PURPOSE must still be deny-all, because the obvious "tidy up the
-- passport reference tables" edit is to give all three a read policy, which
-- would silently widen them from definer-only to world-readable.
--
-- THIS PROOF WAS RUN BEFORE 0182 WAS APPLIED AND FAILED on 10/11/12 with
-- 'allow' against an expected 'deny-*' — the live bug, read by the assertions
-- that exist to catch it. Then applied, then green. A guard nobody has watched
-- fail is a guard nobody has tested (docs/mistakes/tooling-proofs.md).
--
--   node tools/db-query.mjs tools/passport0182-continents-lockdown.sql
-- ============================================================
begin;

create temporary table probe (step text, expected text, got text) on commit drop;

-- ── Instruments ─────────────────────────────────────────────────────────────
-- Three answers, not two. RLS refuses a write by matching ZERO ROWS; a missing
-- INSERT policy RAISES; a missing GRANT raises differently. Scoring them the
-- same is how a broken service reads as a working guard.
create or replace function pg_temp.wr(p_sql text)
returns text as $$
declare n int; msg text;
begin
  begin
    perform set_config('request.jwt.claims', null, true);
    execute 'set local role anon';
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
      get stacked diagnostics msg = message_text;
      execute 'reset role';
      return case
        when msg like '%permission denied%'  then 'deny-grant'
        when msg like '%violates row-level%' then 'deny-check'
        else 'ERROR ' || left(msg, 48) end;
  end;
end $$ language plpgsql;

create or replace function pg_temp.rd(p_sql text)
returns text as $$
declare v text;
begin
  perform set_config('request.jwt.claims', null, true);
  execute 'set local role anon';
  execute p_sql into v;
  execute 'reset role';
  return v;
end $$ language plpgsql;

-- ── §0 the subject is what this proof thinks it is ──────────────────────────
-- The CONTROL for the whole file. If the theming rows were ever emptied, every
-- deny below would still pass while proving nothing about a populated table,
-- and the read in §B would go red for the wrong reason. Read as the superuser,
-- so it reports the table and not a policy.
insert into probe select '00. the four theming rows exist', '4',
  (select count(*)::text from passport.continents);

-- Read from pg_class, the authority — not from the migration that wrote it.
insert into probe select '01. row security is ON for continents', 'true',
  (select c.relrowsecurity::text from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'passport' and c.relname = 'continents');

-- One SELECT policy and NOTHING else. A write policy added later would make
-- every deny in §A pass or fail on its own terms; this is what pins the shape.
insert into probe select '02. exactly one policy, and it is SELECT', 'SELECT',
  (select string_agg(cmd, ',' order by cmd) from pg_policies
    where schemaname = 'passport' and tablename = 'continents');

-- ── §A the anon key CANNOT change the theming ───────────────────────────────
-- These three are the bug. Before 0182 every one of them answered 'allow'.
insert into probe select '10. anon: update a continent colour', 'deny-rls',
  pg_temp.wr($q$update passport.continents set color_hex = '#000000' where name = 'Novatopia'$q$);
insert into probe select '11. anon: insert a continent', 'deny-check',
  pg_temp.wr($q$insert into passport.continents (name, color_hex) values ('Defacia', '#ff0000')$q$);
insert into probe select '12. anon: delete every continent', 'deny-rls',
  pg_temp.wr($q$delete from passport.continents$q$);

-- ── §B the table is still READABLE, which is the point of a read policy ─────
-- Without this, §A is satisfied just as well by a table nobody can touch at
-- all — and `activities.continent_id` is a live foreign key, so the first
-- feature that joins it would break instead of being denied.
insert into probe select '20. anon: reads all four continents', '4',
  pg_temp.rd($q$select count(*)::text from passport.continents$q$);
insert into probe select '21. anon: reads a colour, not just a row count', '#2ecc71',
  pg_temp.rd($q$select color_hex from passport.continents where name = 'Novatopia'$q$);

-- ── §C the two DELIBERATELY deny-all siblings stay deny-all ─────────────────
-- 0056 enabled RLS on departments / sub_departments with NO policy on purpose:
-- they are reached through the SECURITY DEFINER RPC `list_passport_departments`
-- and nothing should read them over the anon key. They sit next to continents in
-- the same reference-table block, so "make the passport reference tables
-- consistent" is exactly the edit that would widen them. This is the assertion
-- that would go red if someone did.
insert into probe select '30. anon: cannot read departments', '0',
  pg_temp.rd($q$select count(*)::text from passport.departments$q$);
insert into probe select '31. anon: cannot read sub_departments', '0',
  pg_temp.rd($q$select count(*)::text from passport.sub_departments$q$);
insert into probe select '32. …and they are NOT empty tables', 'true',
  (select (count(*) > 0)::text from passport.departments);
insert into probe select '33. the definer RPC still reaches them', 'true',
  (select (jsonb_array_length((public.list_passport_departments()->'departments')) > 0)::text);

-- ── §D the containment that makes the TRUNCATE grant unreachable ────────────
-- `anon` and `authenticated` hold TRUNCATE on nearly every table in both
-- schemas (the Supabase schema default), and TRUNCATE is NOT subject to RLS —
-- so 0182 does not restrain it. What makes it unreachable is that neither role
-- can be logged into, and PostgREST never emits a TRUNCATE. That containment is
-- a PROPERTY nobody should change silently, so it is asserted rather than
-- written down: making either role a login role turns this line red.
insert into probe select '40. anon cannot be logged into', 'false',
  (select rolcanlogin::text from pg_roles where rolname = 'anon');
insert into probe select '41. authenticated cannot be logged into', 'false',
  (select rolcanlogin::text from pg_roles where rolname = 'authenticated');
insert into probe select '42. neither role bypasses RLS', 'false,false',
  (select string_agg(rolbypassrls::text, ',' order by rolname) from pg_roles
    where rolname in ('anon', 'authenticated'));

-- ── §E nothing else in the schema slipped ───────────────────────────────────
-- The one-line query that FOUND this bug, kept as the assertion. If a future
-- table lands without RLS, this goes red naming it, instead of waiting for
-- somebody to run the query by hand again.
insert into probe select '50. no passport table is without row security', '(none)',
  coalesce((select string_agg(c.relname, ',' order by c.relname)
              from pg_class c
              join pg_namespace n on n.oid = c.relnamespace
             where n.nspname = 'passport' and c.relkind = 'r'
               and not c.relrowsecurity), '(none)');

select step,
       case when got is not distinct from expected then 'PASS' else 'FAIL' end as result,
       expected, got
  from probe order by step;

rollback;
