-- ============================================================
-- team0195-link-source.sql — a Discord link says where it came from, and the
-- web path always upgrades an imported link to oauth.
--
-- BOTH DIRECTIONS: an allowed value is accepted and an unknown one refused; a
-- web re-link over an IMPORTED row resets it to oauth, and an import does not
-- masquerade as oauth. Everything is rolled back.
--
-- RUN BEFORE 0195 AND IT FAILS AT 01 (no column).
--
--   node tools/db-query.mjs tools/team0195-link-source.sql
-- ============================================================
begin;

create temporary table probe (step text, expected text, got text) on commit drop;

create temporary table subj on commit drop as
select id, row_number() over (order by id) as n
  from public.people
 where id not in (select person_id from public.discord_links)
 order by id limit 2;

insert into probe select '00. two real people are available as subjects', '2',
  (select count(*)::text from subj);

insert into probe select '01. discord_links.link_source exists', 'true',
  (select exists (select 1 from information_schema.columns
                   where table_schema = 'public' and table_name = 'discord_links'
                     and column_name = 'link_source')::text);

-- ── §A the column ──────────────────────────────────────────────────────────
insert into public.discord_links (person_id, discord_user_id)
select id, '950000000000000001' from subj where n = 1;
insert into probe select '10. a row written with no source is oauth (the default)', 'oauth',
  (select link_source from public.discord_links where discord_user_id = '950000000000000001');

insert into public.discord_links (person_id, discord_user_id, link_source)
select id, '950000000000000002', 'nickname-import' from subj where n = 2;
insert into probe select '11. an import is recorded as an import, not as oauth', 'nickname-import',
  (select link_source from public.discord_links where discord_user_id = '950000000000000002');

create or replace function pg_temp.try(q text) returns text language plpgsql as $$
begin execute q; return 'ok';
exception when others then return sqlstate; end $$;

insert into probe select '12. an unknown source is REFUSED (check violation)', '23514',
  pg_temp.try($q$update public.discord_links set link_source = 'guess'
                  where discord_user_id = '950000000000000002'$q$);
insert into probe select '13. …and the row kept its value', 'nickname-import',
  (select link_source from public.discord_links where discord_user_id = '950000000000000002');

-- ── §B the web path upgrades an import ─────────────────────────────────────
-- Subject 2 is imported. They now press the button and redeem a code for the
-- SAME account, then subject 2 re-links to a DIFFERENT account — both must end
-- oauth, because both are the stronger proof.
insert into public.discord_link_codes (code, person_id, expires_at)
select 'A1B2C3D4E5', id, now() + interval '10 minutes' from subj where n = 2;
insert into probe select '20. redeem over an imported row succeeds', 'ok',
  pg_temp.try($q$select public.redeem_discord_link_code('A1B2C3D4E5', '950000000000000002')$q$);
insert into probe select '21. …and the link is now oauth', 'oauth',
  (select link_source from public.discord_links d join subj s on s.id = d.person_id where s.n = 2);

update public.discord_links set link_source = 'nickname-import'
 where person_id = (select id from subj where n = 2);
insert into public.discord_link_codes (code, person_id, expires_at)
select 'F6F7F8F9FA', id, now() + interval '10 minutes' from subj where n = 2;
insert into probe select '22. redeem to a DIFFERENT account over an import succeeds', 'ok',
  pg_temp.try($q$select public.redeem_discord_link_code('F6F7F8F9FA', '950000000000000009')$q$);
insert into probe select '23. …is oauth, on the new account', 'oauth,950000000000000009',
  (select link_source || ',' || discord_user_id from public.discord_links d
     join subj s on s.id = d.person_id where s.n = 2);

-- CONTROL for 21/23: a row the web path did NOT touch keeps its import marker,
-- so an expression that simply always said oauth could not pass.
update public.discord_links set link_source = 'nickname-import'
 where person_id = (select id from subj where n = 1);
insert into probe select '24. an import the web never touched is still an import', 'nickname-import',
  (select link_source from public.discord_links d join subj s on s.id = d.person_id where s.n = 1);

-- ── §C the refusal the web path already had still holds ────────────────────
insert into public.discord_link_codes (code, person_id, expires_at)
select 'ABABABABAB', id, now() + interval '10 minutes' from subj where n = 1;
insert into probe select '30. claiming an account another person holds is still refused', '23505',
  pg_temp.try($q$select public.redeem_discord_link_code('ABABABABAB', '950000000000000009')$q$);

select step,
       case when got is not distinct from expected then 'PASS' else 'FAIL' end as result,
       expected, got
  from probe order by step;

rollback;
