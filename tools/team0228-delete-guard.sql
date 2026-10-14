-- ============================================================
-- team0228-delete-guard.sql — a year in use cannot be deleted (0228);
-- a year seeded ahead and never used still can. DENY paired with ALLOW over
-- the same table. Rolls back.
--   node tools/db-query.mjs tools/team0228-delete-guard.sql [--dev]
-- ============================================================
begin;
create temporary table probe (step text, expected text, got text) on commit drop;
create or replace function pg_temp.try(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return 'ok';
exception when others then return 'raised: ' || sqlerrm; end $$;

delete from public.team_terms where year in (2695, 2696);
create temporary table cur on commit drop as select year from public.team_terms where is_current;

insert into probe select '00. the guard trigger exists', '1',
  (select count(*)::text from pg_trigger where tgname = 'team_terms_delete_guard'
     and tgrelid = 'public.team_terms'::regclass);

-- DENY: the current year
insert into probe select '10. deleting the CURRENT year is refused', 'true',
  (select (pg_temp.try(format('delete from public.team_terms where year = %s', (select year from cur)))
           like 'raised: ลบปี % ไม่ได้ — เป็นปีปัจจุบัน%')::text);

-- DENY: a past year that was in office
insert into public.team_terms (year, started_at, ended_at) values (2695, now() - interval '2 years', now() - interval '1 year');
insert into probe select '11. deleting a year that was ever in office is refused', 'true',
  (select (pg_temp.try('delete from public.team_terms where year = 2695') like 'raised: ลบปี 2695 ไม่ได้ — ปีนี้เคยเป็นปีปัจจุบัน%')::text);

-- DENY: a never-started year that a ticket is filed under
insert into public.team_terms (year) values (2696);
update public.pr_tickets set samo_year_be = 2696 where id = (select id from public.pr_tickets order by id limit 1);
insert into probe select '12. deleting a year a PR ticket is filed under is refused', 'true',
  (select (pg_temp.try('delete from public.team_terms where year = 2696') like 'raised: ลบปี 2696 ไม่ได้ — มีงาน%')::text);

-- ALLOW: the same never-started year, once nothing is filed under it
update public.pr_tickets set samo_year_be = (select year from cur) where samo_year_be = 2696;
insert into probe select '20. a year seeded ahead and never used CAN still be deleted', 'ok',
  (select pg_temp.try('delete from public.team_terms where year = 2696'));
insert into probe select '21. …and it is gone', '0',
  (select count(*)::text from public.team_terms where year = 2696);
insert into probe select '22. the current year is still current', (select year::text from cur),
  (select year::text from public.team_terms where is_current);

select step,
       case when got is not distinct from expected then 'PASS' else 'FAIL' end as result,
       expected, got
  from probe order by step;
rollback;
