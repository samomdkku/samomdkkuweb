-- ============================================================
-- passport0214-lockdown-committed.sql — is the passport RLS lockdown
-- ACTUALLY COMMITTED right now, independent of migration 0214?
--
-- WHY THIS PROOF EXISTS AND WHAT IT IS NOT. `tools/pass-hardening.mjs`
-- (registered, green on production per STATE.md) APPLIES
-- `passport/db/0011_passport_rls_lockdown.sql` itself, inside its own
-- rolled-back transaction, every time it runs — so its passing tells you the
-- POLICIES ARE CORRECT, never whether they are committed outside that test.
-- `tools/pass-anon-probe.mjs` answers the committed question, but over real
-- HTTPS with the bundled anon key, and is not registered in `run-proofs.mjs`
-- (no record of it running since 2026-07-30). This file asks the same
-- committed-state question through the same channel every other registered
-- `.sql` proof uses (the Management API via `tools/db-query.mjs`), and reads
-- catalog state ONLY — it does not apply anything, so it is meaningful to run
-- BEFORE 0214, to find out whether 0214 is closing a live hole or tightening
-- a tracking gap, and AFTER, as a regression check.
--
-- Full context: ~/samo-night/reports/2026-10-13-security-db.md and migration
-- 0214's header.
--
--   node tools/db-query.mjs tools/passport0214-lockdown-committed.sql
--   node tools/db-query.mjs tools/passport0214-lockdown-committed.sql --dev
-- ============================================================
begin;

create temporary table probe (step text, expected text, got text) on commit drop;

-- ── §A catalog: are the write policies still `:: true`? ────────────────────
-- A `using`/`with_check` of exactly `true` (or NULL, meaning unrestricted for
-- that clause) on a non-SELECT policy is the open-door shape this migration
-- closes. This reads pg_policies directly — no impersonation needed for a
-- catalog read.
insert into probe select '01. no write policy on passport.profiles is unrestricted',
  '(none)',
  coalesce((select string_agg(policyname, ',' order by policyname)
              from pg_policies
             where schemaname = 'passport' and tablename = 'profiles'
               and cmd <> 'SELECT'
               and (qual is null or qual = 'true')
               and (with_check is null or with_check = 'true')), '(none)');

insert into probe select '02. no write policy on passport.scans is unrestricted',
  '(none)',
  coalesce((select string_agg(policyname, ',' order by policyname)
              from pg_policies
             where schemaname = 'passport' and tablename = 'scans'
               and cmd <> 'SELECT'
               and (qual is null or qual = 'true')
               and (with_check is null or with_check = 'true')), '(none)');

insert into probe select
  '03. no write policy on activities/certificates/samo_years/samo_seasons/seasons/season_results/account_migrations is unrestricted',
  '(none)',
  coalesce((select string_agg(tablename || ':' || policyname, ',' order by tablename, policyname)
              from pg_policies
             where schemaname = 'passport'
               and tablename in ('activities', 'certificates', 'samo_years',
                                  'samo_seasons', 'seasons', 'season_results',
                                  'account_migrations')
               and cmd <> 'SELECT'
               and (qual is null or qual = 'true')
               and (with_check is null or with_check = 'true')), '(none)');

-- profiles_read_all (`using(true)`) is the specific policy name 0056 shipped
-- and 0214 drops; a bare "no unrestricted policy" check above could in
-- principle pass if someone renamed it without narrowing it, so name it too.
insert into probe select '04. profiles_read_all does not exist', 'f',
  (select exists (select 1 from pg_policies
                    where schemaname = 'passport' and tablename = 'profiles'
                      and policyname = 'profiles_read_all'))::text;

-- ── §B the admin identity chain resolves ────────────────────────────────────
insert into probe select '10. passport.is_admin() exists, security definer', 'true',
  (select exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                    where n.nspname = 'passport' and p.proname = 'is_admin' and p.prosecdef))::text;

insert into probe select '11. passport.leaderboard_names() is NOT anon-executable', 'f',
  coalesce(has_function_privilege('anon', 'passport.leaderboard_names()', 'execute'), false)::text;

insert into probe select '12. passport.admin_leaderboard() is NOT anon-executable', 'f',
  coalesce((select bool_or(has_function_privilege('anon', p.oid, 'execute'))
              from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'passport' and p.proname = 'admin_leaderboard'), false)::text;

-- ── §C user_tiers respects the caller's RLS ─────────────────────────────────
insert into probe select '20. passport.user_tiers has security_invoker = on', 'true',
  coalesce((select (option = 'on')
              from pg_class c, unnest(c.reloptions) option
             where c.relname = 'user_tiers'
               and c.relnamespace = 'passport'::regnamespace
               and option like 'security_invoker=%'), false)::text;

-- ── §D behaviour, as the bare anon role, over this live session ────────────
-- A catalog that LOOKS closed but is reachable another way (a second
-- permissive policy, a missing `to` clause letting a different grantee
-- through) is exactly the shape this repo has been burned by before — so
-- confirm by actually trying it as anon, not by reading pg_policies alone.
create or replace function pg_temp.as_anon(p_sql text, p_expect_rows boolean)
returns text as $$
declare n int;
begin
  perform set_config('request.jwt.claims', null, true);
  execute 'set local role anon';
  execute p_sql;
  get diagnostics n = row_count;
  execute 'reset role';
  if p_expect_rows then
    return n::text || ' rows';
  end if;
  return case when n > 0 then 'WROTE ' || n::text || ' ROWS' else 'deny-rls (0 rows)' end;
exception when others then
  execute 'reset role';
  return 'deny: ' || sqlstate;
end;
$$ language plpgsql;

insert into probe select '30. anon reading passport.profiles gets nothing', '0 rows',
  pg_temp.as_anon('create temp table t30 on commit drop as select * from passport.profiles', true);

insert into probe select '31. anon cannot write passport.scans.points_awarded', 'deny-rls (0 rows)',
  pg_temp.as_anon('update passport.scans set points_awarded = points_awarded', false);

insert into probe select '32. anon cannot write passport.activities', 'deny-rls (0 rows)',
  pg_temp.as_anon('update passport.activities set name = name', false);

insert into probe select '33. anon CAN still read passport.activities (the control — a dead probe reads deny too)',
  'rows>0',
  case when (pg_temp.as_anon('create temp table t33 on commit drop as select * from passport.activities', true))
            ~ '^0 rows$'
       then 'rows>0 -- GOT 0, proof instrument may be dead, see t33' else 'rows>0' end;

select step,
       case when got is not distinct from expected then 'PASS' else 'FAIL' end as result,
       expected, got
  from probe order by step;

rollback;
