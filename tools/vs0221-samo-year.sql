-- ============================================================
-- vs0221-samo-year.sql — vs_tickets.samo_year_be (0221) + the PDPA scrub
-- gate it ships:
--   §0  structural: the column, its index, the INSERT trigger, anonymized_at,
--       and vs_scrub_closed_tickets() all exist
--   §A  a ticket inserted with no samo_year_be gets current_samo_year() —
--       the SAME shared stamping as every other system (0219)
--   §B  an explicit samo_year_be at insert is NOT overwritten by the trigger
--   §C  THE BACKFILL EXPRESSION, across a REAL handover: a ticket stamped
--       while a sentinel term was current keeps resolving to THAT term from
--       its stored `timestamp` even after a later handover makes a DIFFERENT
--       term current (mirrors pr0220-year-filter.sql §C exactly)
--   §D  vs_scrub_closed_tickets() permission gate: a plain subject (no
--       data_admin, not dev) is refused; a data_admin holder is not refused
--       on THIS axis (paired deny+allow, mistakes.md class 7)
--   §E  the EXPORT gate (0222): the SAME data_admin holder is refused when
--       the year has never been exported, and succeeds once
--       record_year_export() puts a row in year_export_log for it — proving
--       0221 actually OPENS 0222's gate rather than merely calling something
--       with the right name
--   §F  WHAT GETS SCRUBBED: a closed (status = 'เสร็จสิ้น'), old
--       (updated_at > months ago) ticket in the target year is anonymised;
--       an OPEN ticket (status not เสร็จสิ้น), same year, same age, is NOT —
--       "open tickets carry over" at the SQL layer too, not just the UI
--       facet; a CLOSED-but-recent ticket is NOT (too young); a
--       DIFFERENT-year closed-and-old ticket is NOT (scoped to p_year only);
--       a REOPENED ticket — status moved OFF เสร็จสิ้น but `resolution`
--       still carries its stale value from the FIRST close, because nothing
--       in this codebase ever clears it (traced submitStaffAction + the 0074
--       cascade trigger) — is NOT scrubbed either: this is the regression
--       case for the bug an earlier draft of 0221 had (keyed on `resolution
--       is not null` alone) before this proof caught it
--   §G  IDEMPOTENCY: running the scrub again over the same year scrubs ZERO
--       additional rows (anonymized_at already set) — never re-counts or
--       re-touches a row twice
--   §H  the public board's own columns (public_title/public_note, when a
--       canonical ticket carries them, 0072) are UNCHANGED by the scrub —
--       "the public board's content stays" is not merely un-tested
--
-- Sentinel team_terms years 2697/2698 — distinct from every other proof's
-- sentinels (year0219: 2691/2692; team0224: 2693/2694; data0222's
-- year_export_log sentinel years: 2695/2696) so none can ever collide.
-- Sentinel export system name 'vs_tickets' is the REAL system key (0222's
-- registry is keyed by table name) but the YEAR (2697) is sentinel, so this
-- proof's year_export_log row can never be mistaken for a real export.
-- Everything rolls back.
--   node tools/db-query.mjs tools/vs0221-samo-year.sql --dev
-- ============================================================
begin;

create temporary table probe (step text, expected text, got text) on commit drop;

-- ── §0 structural ────────────────────────────────────────────────────────
insert into probe select '00. vs_tickets.samo_year_be exists, smallint', '1',
  (select count(*)::text from information_schema.columns
    where table_schema = 'public' and table_name = 'vs_tickets'
      and column_name = 'samo_year_be' and data_type = 'smallint');

insert into probe select '01. an index on samo_year_be exists', 'true',
  (select (count(*) > 0)::text from pg_indexes
    where schemaname = 'public' and tablename = 'vs_tickets'
      and indexdef ilike '%samo_year_be%');

insert into probe select '02. a trigger on vs_tickets calls samo_year_be_default() (fires BEFORE INSERT — proven behaviourally in §A/§B)', 'true',
  (select (count(*) > 0)::text from pg_trigger t
     join pg_proc p on p.oid = t.tgfoid
    where t.tgrelid = 'public.vs_tickets'::regclass
      and p.proname = 'samo_year_be_default');

insert into probe select '03. vs_tickets.anonymized_at exists, timestamptz', '1',
  (select count(*)::text from information_schema.columns
    where table_schema = 'public' and table_name = 'vs_tickets'
      and column_name = 'anonymized_at' and data_type = 'timestamp with time zone');

insert into probe select '04. vs_scrub_closed_tickets(integer, integer) exists', '1',
  (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'vs_scrub_closed_tickets');

-- ── fixtures: three EXISTING accounts, temporarily reshaped — undone by the
--    rollback at the end, same borrow-and-restore shape as team0224's proof. ─
create temporary table subj on commit drop as
  select id, email, role, permissions, managed_permissions
    from public.users where email is not null order by id limit 3;
insert into probe select '05. three existing accounts to borrow for the duration of this proof', '3',
  (select count(*)::text from subj);

create temporary table p_none on commit drop as select id, email from subj order by id limit 1;
create temporary table p_admin on commit drop as select id, email from subj order by id offset 1 limit 1;
create temporary table p_dev on commit drop as select id, email from subj order by id offset 2 limit 1;
grant select on p_none, p_admin, p_dev to authenticated;

alter table public.users disable trigger users_self_update_guard;
-- p_none: ordinary account — no data_admin, not dev. Must be refused §D.
update public.users set role = 'user', permissions = '{}', managed_permissions = '{}'
 where id = (select id from p_none);
-- p_admin: holds the NEW data_admin permission (not dev, no team_edit) — can
-- scrub (§D/§E/§F) once the export gate is open, but CANNOT run
-- start_team_term (needs team_edit/vp_admin/dev, 0224) — §C below uses p_dev.
update public.users set role = 'user', permissions = array['data_admin'], managed_permissions = '{}'
 where id = (select id from p_admin);
-- p_dev: role=dev — satisfies both start_team_term's gate (§C) and
-- vs_scrub_closed_tickets's gate (by role, the OTHER branch of the OR).
update public.users set role = 'dev', permissions = '{}', managed_permissions = '{}'
 where id = (select id from p_dev);
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

delete from public.team_terms where year in (2697, 2698);
delete from public.year_export_log where system = 'vs_tickets' and samo_year_be = 2697;

-- ── §A no explicit year → stamped from current_samo_year() ─────────────────
select pg_temp.as_((select id from p_none), (select email from p_none));
set local role authenticated;
insert into r select 'ins_a',
  pg_temp.try($q$insert into public.vs_tickets (id, problem, target_dept, status)
               values ('VS-TEST0221A', 'proof 0221 — no explicit year', 'SE', 'รอ SE รับเรื่อง')$q$);
reset role;
insert into probe select '10. insert with no samo_year_be succeeds', 'ok', (select v from r where k = 'ins_a');
insert into probe select '11. …and it was stamped with current_samo_year()',
  (select public.current_samo_year()::text),
  (select samo_year_be::text from public.vs_tickets where id = 'VS-TEST0221A');

-- ── §B an explicit year at INSERT is kept, not overwritten ──────────────────
select pg_temp.as_((select id from p_none), (select email from p_none));
set local role authenticated;
insert into r select 'ins_b',
  pg_temp.try($q$insert into public.vs_tickets (id, problem, target_dept, status, samo_year_be)
               values ('VS-TEST0221B', 'proof 0221 — explicit year', 'SE', 'รอ SE รับเรื่อง', 2555)$q$);
reset role;
insert into probe select '20. insert WITH an explicit samo_year_be succeeds', 'ok', (select v from r where k = 'ins_b');
insert into probe select '21. …and the trigger left it alone', '2555',
  (select samo_year_be::text from public.vs_tickets where id = 'VS-TEST0221B');

-- ── §C the backfill expression, across a REAL handover ──────────────────────
select pg_temp.as_((select id from p_dev), (select email from p_dev));
set local role authenticated;
insert into r select 'start_2697', pg_temp.try('select public.start_team_term(2697)');
reset role;
insert into probe select '30. sentinel term 2697 opens', 'ok', (select v from r where k = 'start_2697');

-- now() is frozen for the lifetime of this transaction — backdate 2697's
-- started_at directly so it predates 2698's open by a real interval (see
-- pr0220-year-filter.sql §C for why this is necessary inside one transaction).
update public.team_terms set started_at = now() - interval '2 days' where year = 2697;

select pg_temp.as_((select id from p_dev), (select email from p_dev));
set local role authenticated;
insert into r select 'ins_hist',
  pg_temp.try($q$insert into public.vs_tickets (id, problem, target_dept, status, "timestamp")
               values ('VS-TEST0221C', 'proof 0221 — historical', 'SE', 'รอ SE รับเรื่อง', now() - interval '1 day')$q$);
reset role;
insert into probe select '31. a ticket filed while 2697 is current is stamped 2697 (the trigger reads the LIVE term, not its own timestamp)', '2697',
  (select samo_year_be::text from public.vs_tickets where id = 'VS-TEST0221C');

select pg_temp.as_((select id from p_dev), (select email from p_dev));
set local role authenticated;
insert into r select 'start_2698', pg_temp.try('select public.start_team_term(2698)');
reset role;
insert into probe select '32. handover to 2698 succeeds — 2697 is now history', 'ok', (select v from r where k = 'start_2698');
insert into probe select '33. current_samo_year() now answers 2698', '2698', (select public.current_samo_year()::text);

select pg_temp.as_((select id from p_dev), (select email from p_dev));
set local role authenticated;
insert into r select 'clear_hist', pg_temp.try($q$update public.vs_tickets set samo_year_be = null where id = 'VS-TEST0221C'$q$);
reset role;
insert into probe select '34. clearing samo_year_be for the backfill test succeeds', 'ok', (select v from r where k = 'clear_hist');

update public.vs_tickets
   set samo_year_be = public.samo_year_for_timestamp(coalesce("timestamp", created_at))
 where id = 'VS-TEST0221C' and samo_year_be is null;
insert into probe select '35. the backfill resolves it to 2697 (when it REALLY happened), not 2698 (now)', '2697',
  (select samo_year_be::text from public.vs_tickets where id = 'VS-TEST0221C');

-- ── §D vs_scrub_closed_tickets permission gate (year unexported either way) ─
select pg_temp.as_((select id from p_none), (select email from p_none));
set local role authenticated;
insert into r select 'scrub_none', pg_temp.try('select public.vs_scrub_closed_tickets(2697)');
reset role;
insert into probe select '40. a plain subject (no data_admin, not dev) is refused', 'true',
  (select (v like 'raised%' and v like '%ไม่มีสิทธิ์%')::text from r where k = 'scrub_none');

select pg_temp.as_((select id from p_admin), (select email from p_admin));
set local role authenticated;
insert into r select 'scrub_admin_unexported', pg_temp.try('select public.vs_scrub_closed_tickets(2697)');
reset role;
insert into probe select '41. a data_admin holder passes the PERMISSION gate, but is refused on the EXPORT gate (year 2697 never exported)', 'true',
  (select (v like 'raised%' and v not like '%ไม่มีสิทธิ์%')::text from r where k = 'scrub_admin_unexported');

-- ── §E the export gate actually opens once recorded ─────────────────────────
select pg_temp.as_((select id from p_admin), (select email from p_admin));
set local role authenticated;
insert into r select 'record_export', pg_temp.try($q$select public.record_year_export('vs_tickets', 2697, 1, null, 'vs0221 proof')$q$);
reset role;
insert into probe select '50. data_admin records the 2697 export', 'ok', (select v from r where k = 'record_export');
insert into probe select '51. year_export_recorded now answers true for (vs_tickets, 2697)', 'true',
  (select public.year_export_recorded('vs_tickets', 2697)::text);

-- ── §F what actually gets scrubbed, and what does not ───────────────────────
-- A: closed, old, year 2697 → SHOULD be scrubbed.
-- B: open (status not เสร็จสิ้น, resolution null), old, year 2697 → should NOT (open tickets carry over).
-- C: closed, RECENT (updated_at = now()), year 2697 → should NOT (too young).
-- D: closed, old, year 2555 (a DIFFERENT year) → should NOT (scoped to p_year).
-- E: REOPENED — status back to สโมกำลังดำเนินการ, but resolution STILL
--    'fixed' from the original close (nothing clears it) — old, year 2697 →
--    should NOT be scrubbed (status, not resolution, decides "closed").
select pg_temp.as_((select id from p_dev), (select email from p_dev));
set local role authenticated;
insert into r select 'ins_f_a', pg_temp.try($q$
  insert into public.vs_tickets (id, problem, target_dept, status, samo_year_be, resolution, resolution_note, updated_at, public_title, public_note)
       values ('VS-TEST0221F-A', 'ชื่อจริง: สมชาย ใจดี โทร 0812345678', 'SE', 'เสร็จสิ้น', 2697, 'fixed',
               'แก้ไขให้สมชายแล้ว', now() - interval '30 months', 'หัวข้อสาธารณะ F-A', 'บันทึกสาธารณะ F-A')$q$);
insert into r select 'ins_f_b', pg_temp.try($q$
  insert into public.vs_tickets (id, problem, target_dept, status, samo_year_be, resolution, updated_at)
       values ('VS-TEST0221F-B', 'ยังไม่ปิด แต่เก่าแล้ว', 'SE', 'สโมกำลังดำเนินการ', 2697, null, now() - interval '30 months')$q$);
insert into r select 'ins_f_c', pg_temp.try($q$
  insert into public.vs_tickets (id, problem, target_dept, status, samo_year_be, resolution, resolution_note, updated_at)
       values ('VS-TEST0221F-C', 'ปิดแล้วแต่ใหม่', 'SE', 'เสร็จสิ้น', 2697, 'fixed', 'โน้ตใหม่', now())$q$);
insert into r select 'ins_f_d', pg_temp.try($q$
  insert into public.vs_tickets (id, problem, target_dept, status, samo_year_be, resolution, resolution_note, updated_at)
       values ('VS-TEST0221F-D', 'ปิดแล้วเก่าแล้วแต่คนละปี', 'SE', 'เสร็จสิ้น', 2555, 'fixed', 'โน้ตปีอื่น', now() - interval '30 months')$q$);
insert into r select 'ins_f_e', pg_temp.try($q$
  insert into public.vs_tickets (id, problem, target_dept, status, samo_year_be, resolution, resolution_note, updated_at)
       values ('VS-TEST0221F-E', 'เปิดใหม่หลังปิดไปแล้ว', 'SE', 'สโมกำลังดำเนินการ', 2697, 'fixed', 'โน้ตเก่าก่อนเปิดใหม่', now() - interval '30 months')$q$);
reset role;
insert into probe select '60. all five §F fixtures insert cleanly', 'ok|ok|ok|ok|ok',
  (select v from r where k = 'ins_f_a') || '|' || (select v from r where k = 'ins_f_b') || '|'
  || (select v from r where k = 'ins_f_c') || '|' || (select v from r where k = 'ins_f_d') || '|'
  || (select v from r where k = 'ins_f_e');

select pg_temp.as_((select id from p_admin), (select email from p_admin));
set local role authenticated;
insert into r select 'scrub_run1', pg_temp.try('select public.vs_scrub_closed_tickets(2697, 24)');
reset role;
insert into probe select '61. the scrub runs without error now the year is exported', 'ok', (select v from r where k = 'scrub_run1');

insert into probe select '62. A (closed, old, this year) IS scrubbed — problem overwritten', '[ข้อมูลถูกลบตามนโยบาย PDPA]',
  (select problem from public.vs_tickets where id = 'VS-TEST0221F-A');
insert into probe select '63. A resolution_note is also overwritten', '[ข้อมูลถูกลบตามนโยบาย PDPA]',
  (select resolution_note from public.vs_tickets where id = 'VS-TEST0221F-A');
insert into probe select '64. A anonymized_at is now set', 'true',
  (select (anonymized_at is not null)::text from public.vs_tickets where id = 'VS-TEST0221F-A');
insert into probe select '65. B (OPEN, old, this year) is UNTOUCHED — open tickets carry over, even in SQL', 'ยังไม่ปิด แต่เก่าแล้ว',
  (select problem from public.vs_tickets where id = 'VS-TEST0221F-B');
insert into probe select '66. B anonymized_at stays null', 'true',
  (select (anonymized_at is null)::text from public.vs_tickets where id = 'VS-TEST0221F-B');
insert into probe select '67. C (closed, but RECENT) is untouched — too young', 'ปิดแล้วแต่ใหม่',
  (select problem from public.vs_tickets where id = 'VS-TEST0221F-C');
insert into probe select '68. D (closed, old, but a DIFFERENT year) is untouched — scoped to p_year', 'ปิดแล้วเก่าแล้วแต่คนละปี',
  (select problem from public.vs_tickets where id = 'VS-TEST0221F-D');
insert into probe select '69. E (REOPENED — status moved off เสร็จสิ้น, resolution still stale ''fixed'') is untouched — status decides, not resolution', 'เปิดใหม่หลังปิดไปแล้ว',
  (select problem from public.vs_tickets where id = 'VS-TEST0221F-E');

-- ── §H the public board's own curated columns are never touched ────────────
insert into probe select '70. public_title is unchanged by the scrub', 'หัวข้อสาธารณะ F-A',
  (select public_title from public.vs_tickets where id = 'VS-TEST0221F-A');
insert into probe select '71. public_note is unchanged by the scrub', 'บันทึกสาธารณะ F-A',
  (select public_note from public.vs_tickets where id = 'VS-TEST0221F-A');

-- ── §G idempotency: a second run over the same year touches NOTHING new ────
select pg_temp.as_((select id from p_admin), (select email from p_admin));
set local role authenticated;
insert into r select 'scrub_run2', pg_temp.try('select public.vs_scrub_closed_tickets(2697, 24)');
reset role;
insert into probe select '80. a second scrub of the same year succeeds (not an error to re-run)', 'ok', (select v from r where k = 'scrub_run2');
-- the function RETURNS the row count; capture it directly rather than via try().
insert into probe select '81. the second run scrubs ZERO rows — A is already anonymized_at, not re-counted', '0',
  (select public.vs_scrub_closed_tickets(2697, 24)::text);

select step,
       case when got is not distinct from expected then 'PASS' else 'FAIL' end as result,
       expected, got
  from probe order by step;

rollback;
