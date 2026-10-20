-- ============================================================
-- pr0220-year-filter.sql — pr_tickets.samo_year_be (0220):
--   §0  structural: the column, its index and its INSERT trigger exist
--   §A  a ticket inserted with no samo_year_be gets current_samo_year(),
--       through the SAME insert-time stamping as every other system (0219)
--   §B  an explicit samo_year_be at insert is NOT overwritten by the trigger
--   §C  THE BACKFILL EXPRESSION, run against a REAL handover: a ticket
--       stamped while a sentinel term was current keeps resolving to THAT
--       term from its stored `timestamp` even after a later handover makes
--       a DIFFERENT term current — proving the backfill reads history, not
--       wall-clock "now" (the one way this could silently misfile every
--       legacy PR ticket the owner's own example named)
--   §D  RLS is UNCHANGED by this column — year is a FILTER, not an access
--       boundary: a submitter still reads their own ticket from a past
--       sentinel year (ALLOW), a stranger still cannot read someone else's
--       (DENY, same past year — year is not an access escape), and pr desk
--       staff still read every year (ALLOW) while a stranger with no
--       public.users row reads nothing (DENY) — paired, not deny-only
--   §E  a staff UPDATE may move a ticket's year explicitly, and that is NOT
--       re-clobbered by the INSERT-only trigger
--
-- Every subject is RESOLVED FROM THE DATA (pr0149's convention), and the one
-- account this proof needs — PR desk AND team-handover capable in one
-- credential, so a single admin can both open a sentinel term and manage a
-- PR ticket — is synthesised inside this rolled-back transaction if nothing
-- on samo-dev already holds it (pr0149 hit exactly this: samomdkkudev's role
-- moved to 'user'+master and silently dropped a control's only subject).
--
-- Sentinel years 2693/2694 — far from 2691/2692 (year0219) and anything real
-- — so this proof's own handovers cannot collide with another proof's.
-- Everything rolls back.
--   node tools/db-query.mjs tools/pr0220-year-filter.sql
-- ============================================================
begin;

create temporary table probe (step text, expected text, got text) on commit drop;

-- ── §0 structural ────────────────────────────────────────────────────────
insert into probe select '00. pr_tickets.samo_year_be exists, smallint', '1',
  (select count(*)::text from information_schema.columns
    where table_schema = 'public' and table_name = 'pr_tickets'
      and column_name = 'samo_year_be' and data_type = 'smallint');

insert into probe select '01. an index on samo_year_be exists', 'true',
  (select (count(*) > 0)::text from pg_indexes
    where schemaname = 'public' and tablename = 'pr_tickets'
      and indexdef ilike '%samo_year_be%');

insert into probe select '02. a trigger on pr_tickets calls samo_year_be_default() (fires BEFORE INSERT — proven behaviourally in §A/§B)', 'true',
  (select (count(*) > 0)::text from pg_trigger t
     join pg_proc p on p.oid = t.tgfoid
    where t.tgrelid = 'public.pr_tickets'::regclass
      and p.proname = 'samo_year_be_default');

-- ── principal: PR desk AND team-handover capable, one credential ──────────
create temporary table admin_all on commit drop as
select u.id, lower(btrim(u.email)) as email from public.users u
 where u.role = 'dev'
    or 'master' = any (coalesce(u.permissions,'{}') || coalesce(u.managed_permissions,'{}'))
 order by u.id limit 1;

set local session_replication_role = replica;
insert into admin_all
select u.id, lower(btrim(u.email))
  from public.users u
 where not exists (select 1 from admin_all)
   and u.role = 'user'
   and coalesce(array_length(u.permissions, 1), 0) = 0
 order by u.id limit 1;
update public.users set role = 'dev'
 where id = (select id from admin_all) and role <> 'dev'
   and exists (select 1 from admin_all);
set local session_replication_role = origin;

insert into probe select '03. a PR-desk + team-handover admin exists (made here if none did)', '1',
  (select count(*)::text from admin_all);

create or replace function pg_temp.as_admin() returns void language sql as $$
  select set_config('request.jwt.claims',
    (select json_build_object('sub', id, 'role', 'authenticated', 'email', email)::text from admin_all), true);
$$;
create or replace function pg_temp.as_stranger() returns void language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', gen_random_uuid(), 'role', 'authenticated',
                      'email', 'nobody-0220@kkumail.com')::text, true);
$$;
create or replace function pg_temp.try(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return 'ok';
exception when others then return 'raised: ' || sqlerrm; end $$;
grant execute on function pg_temp.try(text) to authenticated;

-- A normal signed-in submitter — no pr/team/master channel at all.
create temporary table subj_none on commit drop as
select u.id as uid from public.users u
 where u.role not in ('pr_staff', 'dev')
   and not ('pr' = any(coalesce(u.permissions, '{}') || coalesce(u.managed_permissions, '{}')))
   and not ('team' = any(coalesce(u.permissions, '{}') || coalesce(u.managed_permissions, '{}')))
   and not ('master' = any(coalesce(u.permissions, '{}') || coalesce(u.managed_permissions, '{}')))
   and u.id not in (select id from admin_all)
 order by u.id limit 1;
insert into probe select '04. an ordinary submitter (no pr/team/master) exists', '1',
  (select count(*)::text from subj_none);
grant select on subj_none to authenticated;

create temporary table r (k text, v text) on commit drop;
grant insert, select on r to authenticated;

delete from public.team_terms where year in (2693, 2694);

-- ── §A no explicit year → stamped from current_samo_year() ─────────────────
select pg_temp.as_admin();
set local role authenticated;
insert into r select 'ins_a',
  pg_temp.try($q$insert into public.pr_tickets (id, department, content_name, status)
               values ('PR-TEST0220A', 'ฝ่ายดิจิทัลและสื่อสารองค์กร', 'proof 0220 — no explicit year', 'รอ PR รับเรื่อง')$q$);
reset role;
insert into probe select '10. insert with no samo_year_be succeeds', 'ok', (select v from r where k = 'ins_a');
insert into probe select '11. …and it was stamped with current_samo_year()',
  (select public.current_samo_year()::text),
  (select samo_year_be::text from public.pr_tickets where id = 'PR-TEST0220A');

-- ── §B an explicit year at INSERT is kept, not overwritten ──────────────────
select pg_temp.as_admin();
set local role authenticated;
insert into r select 'ins_b',
  pg_temp.try($q$insert into public.pr_tickets (id, department, content_name, status, samo_year_be)
               values ('PR-TEST0220B', 'ฝ่ายดิจิทัลและสื่อสารองค์กร', 'proof 0220 — explicit year', 'รอ PR รับเรื่อง', 2555)$q$);
reset role;
insert into probe select '20. insert WITH an explicit samo_year_be succeeds', 'ok', (select v from r where k = 'ins_b');
insert into probe select '21. …and the trigger left it alone', '2555',
  (select samo_year_be::text from public.pr_tickets where id = 'PR-TEST0220B');

-- ── §C the backfill expression, across a REAL handover ──────────────────────
select pg_temp.as_admin();
set local role authenticated;
insert into r select 'start_2693', pg_temp.try('select public.start_team_term(2693)');
reset role;
insert into probe select '30. sentinel term 2693 opens', 'ok', (select v from r where k = 'start_2693');

-- now() is FROZEN for the lifetime of this transaction (it returns the
-- transaction's start time, not wall-clock time) — so two start_team_term
-- calls in the SAME transaction would otherwise stamp 2693 and 2694 with the
-- EXACT SAME started_at, collapsing the very boundary §C exists to cross.
-- Backdating 2693's started_at directly (an admin correcting a term's start
-- date is itself a real, supported action — the override shape every column
-- in this design doc has) manufactures the two distinct instants a real
-- handover, days apart, would have for free.
-- MINUTES, not days, and the term start_team_term just closed is closed at
-- the same instant: `now() - 2 days` collided with any REAL term started in
-- the last two days (samo-dev's 2571, 2026-10-18) — shop0230's write-up in
-- docs/mistakes/tooling-proofs.md.
update public.team_terms set ended_at = now() - interval '2 minutes'
 where year <> 2693 and ended_at = now();
update public.team_terms set started_at = now() - interval '2 minutes' where year = 2693;

select pg_temp.as_admin();
set local role authenticated;
insert into r select 'ins_hist',
  pg_temp.try($q$insert into public.pr_tickets (id, department, content_name, status, "timestamp")
               values ('PR-TEST0220C', 'ฝ่ายดิจิทัลและสื่อสารองค์กร', 'proof 0220 — historical', 'รอ PR รับเรื่อง', now() - interval '1 minute')$q$);
reset role;
insert into probe select '31. a ticket submitted while 2693 is current is stamped 2693 (the trigger reads the LIVE term, not the ticket''s own timestamp)', '2693',
  (select samo_year_be::text from public.pr_tickets where id = 'PR-TEST0220C');

select pg_temp.as_admin();
set local role authenticated;
insert into r select 'start_2694', pg_temp.try('select public.start_team_term(2694)');
reset role;
insert into probe select '32. handover to 2694 succeeds — 2693 is now history', 'ok', (select v from r where k = 'start_2694');
insert into probe select '33. current_samo_year() now answers 2694', '2694', (select public.current_samo_year()::text);

-- Simulate "never backfilled" (what every one of the 311 real rows looked
-- like before this migration's own backfill ran), then run the EXACT
-- expression the migration uses — after the handover, so "now" would give
-- the wrong answer if the backfill secretly used it instead of history.
select pg_temp.as_admin();
set local role authenticated;
insert into r select 'clear_hist', pg_temp.try($q$update public.pr_tickets set samo_year_be = null where id = 'PR-TEST0220C'$q$);
reset role;
insert into probe select '34. clearing samo_year_be for the backfill test succeeds', 'ok', (select v from r where k = 'clear_hist');

update public.pr_tickets
   set samo_year_be = public.samo_year_for_timestamp(coalesce("timestamp", created_at))
 where id = 'PR-TEST0220C' and samo_year_be is null;
insert into probe select '35. the backfill resolves it to 2693 (when it REALLY happened), not 2694 (now)', '2693',
  (select samo_year_be::text from public.pr_tickets where id = 'PR-TEST0220C');

-- ── §D RLS is unchanged: year is a filter, never an access boundary ─────────
select pg_temp.as_admin();
set local role authenticated;
insert into r select 'ins_mine',
  pg_temp.try(format($q$insert into public.pr_tickets (id, department, content_name, status, samo_year_be, submitter_id)
               values ('PR-TEST0220D', 'ฝ่ายดิจิทัลและสื่อสารองค์กร', 'proof 0220 — mine, past year', 'รอ PR รับเรื่อง', 2693, %L)$q$,
               (select uid from subj_none)));
reset role;
insert into probe select '40. a submitter-owned ticket, filed under the past sentinel year, is created', 'ok', (select v from r where k = 'ins_mine');

select pg_temp.as_stranger();
set local role authenticated;
insert into r select 'deny_stranger_mine', pg_temp.try($q$select 1/count(*) from public.pr_tickets where id = 'PR-TEST0220D'$q$);
insert into r select 'deny_stranger_hist', pg_temp.try($q$select 1/count(*) from public.pr_tickets where id = 'PR-TEST0220C'$q$);
reset role;
insert into probe select '41. a stranger (no users row) reads NEITHER past-year ticket', 'true|true',
  (select (v like 'raised%')::text from r where k = 'deny_stranger_mine') || '|'
  || (select (v like 'raised%')::text from r where k = 'deny_stranger_hist');

create or replace function pg_temp.as_subj_none() returns void language sql as $$
  select set_config('request.jwt.claims',
    (select json_build_object('sub', uid, 'role', 'authenticated', 'email', 'subj-none-0220@kkumail.com')::text from subj_none), true);
$$;
select pg_temp.as_subj_none();
set local role authenticated;
insert into r select 'allow_mine', pg_temp.try($q$select 1/count(*) from public.pr_tickets where id = 'PR-TEST0220D'$q$);
insert into r select 'deny_hist', pg_temp.try($q$select 1/count(*) from public.pr_tickets where id = 'PR-TEST0220C'$q$);
reset role;
insert into probe select '42. the submitter reads THEIR OWN past-year ticket', 'ok', (select v from r where k = 'allow_mine');
insert into probe select '43. …but NOT someone else''s, same past year — year is not an access escape',
  'true', (select (v like 'raised%')::text from r where k = 'deny_hist');

select pg_temp.as_admin();
set local role authenticated;
insert into r select 'staff_sees_mine', pg_temp.try($q$select 1/count(*) from public.pr_tickets where id = 'PR-TEST0220D'$q$);
insert into r select 'staff_sees_hist', pg_temp.try($q$select 1/count(*) from public.pr_tickets where id = 'PR-TEST0220C'$q$);
reset role;
insert into probe select '44. PR desk reads the submitter''s past-year ticket too', 'ok', (select v from r where k = 'staff_sees_mine');
insert into probe select '45. …and the OTHER past-year ticket — staff sees every year', 'ok', (select v from r where k = 'staff_sees_hist');

-- ── §E a staff correction overrides the year; the INSERT trigger is silent on UPDATE ─
select pg_temp.as_admin();
set local role authenticated;
insert into r select 'move_year', pg_temp.try($q$update public.pr_tickets set samo_year_be = 2694 where id = 'PR-TEST0220D'$q$);
reset role;
insert into probe select '50. staff moves a ticket to a different year', 'ok', (select v from r where k = 'move_year');
insert into probe select '51. the move stuck — an UPDATE is never re-stamped by the INSERT-only trigger', '2694',
  (select samo_year_be::text from public.pr_tickets where id = 'PR-TEST0220D');

select step,
       case when got is not distinct from expected then 'PASS' else 'FAIL' end as result,
       expected, got
  from probe order by step;

rollback;
