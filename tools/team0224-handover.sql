-- ============================================================
-- team0224-handover.sql — 0224's two fixes to start_team_term():
--   §A  a VIEW-only 'team' holder (what EVERY ทีม SAMO posting gets for free
--       since 0110 — hundreds of accounts) is DENIED a handover; an EDIT
--       ('team_edit') holder is ALLOWED — the exact bug 0219 shipped with,
--       paired DENY+ALLOW so neither assertion can pass by coincidence
--       (mistakes.md class 7: a deny-only probe cannot tell a working guard
--       from a broken service).
--   §B  the handover auto-archives the OUTGOING term — team_archive_nodes/
--       _members for the year that WAS current get filled from the live
--       tree, with no separate publish_team_term call, so "prepare next
--       year's team without touching this year's" holds by construction.
--   §B2 …but ONLY when that year has never been published: an existing
--       archive (and the corrections made on it) is never re-snapshotted.
--   §C  Discord role sync stays decoupled from team_terms (a regression
--       guard: the function body must still name zero 'team_terms' — if it
--       ever does, Discord roles would stop being "always the current
--       term by construction" and this proof is the only thing that would
--       notice).
--
-- Two sentinel years nowhere near anything real (2693/2694), distinct from
-- year0219-samo-year.sql's own sentinels (2691/2692) so the two proofs never
-- collide if ever run back to back without a commit between them. Runs
-- inside a transaction that ROLLS BACK — nothing here survives.
--   node tools/db-query.mjs tools/team0224-handover.sql --dev
-- ============================================================
begin;

create temporary table probe (step text, expected text, got text) on commit drop;

insert into probe select '00. 0224 redefined start_team_term and it still exists', '1',
  (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'start_team_term');

insert into probe select '01. the live body checks team_edit, not the bare team view grant', 'true',
  (select (
     pg_get_functiondef('public.start_team_term(integer)'::regprocedure) ~ 'team_edit''\)'
     and pg_get_functiondef('public.start_team_term(integer)'::regprocedure)
         !~ 'has_permission\(''team''\)'
   )::text);

-- ── fixtures: two EXISTING accounts, temporarily reshaped, never restored
--    by hand — the rollback at the end undoes every UPDATE below. ──────────
create temporary table subj on commit drop as
  select id, email, role, permissions, managed_permissions
    from public.users where email is not null order by id limit 2;
insert into probe select '02. two existing accounts to borrow for the duration of this proof', '2',
  (select count(*)::text from subj);

create temporary table p1 on commit drop as select id, email from subj order by id limit 1;
create temporary table p2 on commit drop as select id, email from subj order by id offset 1 limit 1;
grant select on p1, p2 to authenticated;

alter table public.users disable trigger users_self_update_guard;
-- p1: exactly what 0110 hands anyone merely posted in the tree — VIEW only.
update public.users set role = 'user', permissions = '{}', managed_permissions = array['team']
 where id = (select id from p1);
-- p2: holds the EDIT key, the one start_team_term should actually ask for.
update public.users set role = 'user', permissions = array['team_edit'], managed_permissions = '{}'
 where id = (select id from p2);
alter table public.users enable trigger users_self_update_guard;

create or replace function pg_temp.as_(p_id uuid, p_email text) returns void language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', p_id, 'role', 'authenticated', 'email', p_email)::text, true);
$$;
create or replace function pg_temp.try(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return 'ok';
exception when others then return 'raised: ' || sqlerrm; end $$;
grant execute on function pg_temp.try(text) to authenticated;

create temporary table r (k text, v text) on commit drop;
grant insert, select on r to authenticated;

delete from public.team_terms where year in (2693, 2694);

create temporary table orig_current on commit drop as
  select year from public.team_terms where is_current;
grant select on orig_current to authenticated;

-- publish_team_term archives only the PUBLIC subtree (is_public, walking
-- from the public roots) — the same recursive shape as get_public_team_chart
-- and publish_team_term itself use. Comparing against the TOTAL team_nodes/
-- team_members count would fail on any private node, which this live tree
-- has (297 of 299 nodes, 447 of 449 members are public on samo-dev today).
create temporary table orig_counts on commit drop as
  with recursive live as (
      select n.id from public.team_nodes n where n.parent_id is null and n.is_public
    union all
      select c.id from public.team_nodes c join live l on c.parent_id = l.id where c.is_public
  )
  select (select count(*) from live) as nodes,
         (select count(*) from public.team_members m join live l on l.id = m.node_id) as members;
grant select on orig_counts to authenticated;

-- ── §A1 DENY: the view-only 'team' holder may not hand over ────────────────
select pg_temp.as_((select id from p1), (select email from p1));
set local role authenticated;
insert into r select 'deny_view_only', pg_temp.try('select public.start_team_term(2693)');
reset role;
insert into probe select '10. a VIEW-only "team" holder is REFUSED (the 0219 bug this migration closes)', 'true',
  (select (v like 'raised: start_team_term: ไม่มีสิทธิ์%')::text from r where k = 'deny_view_only');
insert into probe select '11. …and the real current term is untouched', (select year::text from orig_current),
  (select year::text from public.team_terms where is_current);
insert into probe select '12. …and 2693 was never created', '0',
  (select count(*)::text from public.team_terms where year = 2693);

-- §B precondition, made rather than assumed: the outgoing year has NO archive
-- yet — production's state (published_at NULL on every term, 2026-10-13).
-- samo-dev may already hold one; without this §B would pass or fail on
-- whatever an earlier session left behind.
update public.team_terms set published_at = null where year = (select year from orig_current);
delete from public.team_archive_nodes where year = (select year from orig_current);

-- ── §A2 ALLOW: the SAME action, a team_edit holder, same sentinel year ────
select pg_temp.as_((select id from p2), (select email from p2));
set local role authenticated;
insert into r select 'allow_edit', pg_temp.try('select public.start_team_term(2693)');
reset role;
insert into probe select '13. a team_edit holder (no vp_admin/dev role) IS allowed', 'ok',
  (select v from r where k = 'allow_edit');
insert into probe select '14. 2693 is now the current term', 'true',
  (select is_current::text from public.team_terms where year = 2693);
insert into probe select '15. exactly one current term — the splice did not break the atomic close/open', '1',
  (select count(*)::text from public.team_terms where is_current);

-- ── §B the OUTGOING term (the real one, e.g. 2569) self-archived ───────────
-- No publish_team_term call anywhere in this proof — if the archive exists
-- and matches the live tree's counts, start_team_term made it happen alone.
insert into probe select '20. the outgoing term now HAS an archive (team_archive_nodes), with no explicit publish call', 'true',
  (select (count(*) > 0)::text from public.team_archive_nodes
    where year = (select year from orig_current));
insert into probe select '21. the archived node/member counts match what the live tree held at handover time', 'true',
  (select (
     (select count(*) from public.team_archive_nodes where year = (select year from orig_current))
       = (select nodes from orig_counts)
     and
     (select count(*) from public.team_archive_members where year = (select year from orig_current))
       = (select members from orig_counts)
   )::text);
insert into probe select '22. the outgoing term is marked published (published_at set)', 'true',
  (select (published_at is not null)::text from public.team_terms
    where year = (select year from orig_current));

-- ── §B2 an ALREADY-PUBLISHED outgoing year is NEVER re-snapshotted ────────
-- publish_team_term deletes and rebuilds a year's archive. 2693 is current
-- now: publish it by hand (the "เผยแพร่ปีนี้" button), correct one archived
-- name the way an admin would, then hand over to 2694. The correction must
-- survive — before the fix the handover re-published 2693 and erased it.
select pg_temp.as_((select id from p2), (select email from p2));
set local role authenticated;
insert into r select 'manual_publish', pg_temp.try('select public.publish_team_term(2693)');
reset role;
insert into probe select '23. a manual publish of the current year (2693) succeeds', 'ok',
  (select v from r where k = 'manual_publish');
update public.team_archive_members set full_name = 'KEEP-0224-CORRECTION'
 where id = (select id from public.team_archive_members where year = 2693 order by id limit 1);
insert into probe select '24. one archived name in 2693 corrected (fixture)', '1',
  (select count(*)::text from public.team_archive_members
    where year = 2693 and full_name = 'KEEP-0224-CORRECTION');
select pg_temp.as_((select id from p2), (select email from p2));
set local role authenticated;
insert into r select 'handover_2694', pg_temp.try(
  'insert into r select ''handover_json'', public.start_team_term(2694)::text');
reset role;
insert into probe select '25. hand over 2693 → 2694', 'ok',
  (select v from r where k = 'handover_2694');
insert into probe select '26. the corrected name in 2693''s archive SURVIVED the handover (not re-snapshotted)', '1',
  (select count(*)::text from public.team_archive_members
    where year = 2693 and full_name = 'KEEP-0224-CORRECTION');
insert into probe select '27. …and the handover reports it did not archive (it already was)', 'false',
  (select (v::jsonb ->> 'archived_outgoing') from r where k = 'handover_json');

-- ── §C Discord role sync stays decoupled from team_terms (regression guard) ─
insert into probe select '30. discord_role_targets() names zero references to team_terms — it is "the current term" only because it reads the LIVE tree, not because anything ties it to a term row', 'true',
  (select (pg_get_functiondef('public.discord_role_targets()'::regprocedure) !~ 'team_terms')::text);

-- ── cleanup check: the sentinel year rejects out-of-range input too ────────
select pg_temp.as_((select id from p2), (select email from p2));
set local role authenticated;
insert into r select 'bad_year', pg_temp.try('select public.start_team_term(9999)');
reset role;
insert into probe select '40. an out-of-range year is still refused after the splice', 'true',
  (select (v like 'raised: start_team_term: bad year%')::text from r where k = 'bad_year');

select step,
       case when got is not distinct from expected then 'PASS' else 'FAIL' end as result,
       expected, got
  from probe order by step;

rollback;
