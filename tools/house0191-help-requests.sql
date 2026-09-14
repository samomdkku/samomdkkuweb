-- ============================================================
-- house0191-help-requests.sql — a student who cannot get in is heard, without
-- being told anything, and without VitalSound.
--
-- WHAT THIS DEFENDS. 0191 keeps a failed claim as a report. Three properties
-- have to hold together, and two of them pull against each other:
--
--   §A  the table is not a directory        — and the admin CAN read it
--   §B  a miss is RECORDED …                — with what they typed
--   §C  … and the caller is told NOTHING    — same sentence as before 0191
--   §D  repeated misses are ONE row         — the rate limit is the shape
--   §E  a later SUCCESS closes the report   — the half that keeps it readable
--   §F  an admin promoting the held row closes it too
--   §G  the list carries CANDIDATES, not just complaints
--   §H  "this record is not mine" files, and changes nothing
--
-- §C is the one worth stating out loud: recording an attempt must not become a
-- way to learn whether a รหัส exists. The message is compared against the
-- message for a total miss, the same way house0188 §30 does.
--
-- Everything runs inside a transaction that ROLLS BACK.
--
--   node tools/db-query.mjs tools/house0191-help-requests.sql
-- ============================================================
begin;

create temporary table probe (step text, expected text, got text) on commit drop;

insert into probe select '00. the table exists', 'true',
  (to_regclass('public.house_help_requests') is not null)::text;

-- ── §A not a directory ──────────────────────────────────────────────────────
-- It holds verified kkumail addresses beside the รหัสนักศึกษา their owners
-- typed. `authenticated` must reach it only through the admin policy.
insert into probe select '01. row security is ON', 'true',
  (select relrowsecurity::text from pg_class
    where oid = to_regclass('public.house_help_requests'));

insert into probe select '02. anon may not read it', 'false',
  has_table_privilege('anon', to_regclass('public.house_help_requests'), 'select')::text;

-- CONTROL for 02: `authenticated` DOES hold the grant, so the protection is the
-- policy. An assertion that neither role had it would pass while proving nothing.
insert into probe select '03. authenticated holds the grant (the policy gates)', 'true',
  has_table_privilege('authenticated', to_regclass('public.house_help_requests'), 'select')::text;

-- ── subjects ────────────────────────────────────────────────────────────────
insert into public.sais (code) values ('141') on conflict (code) do nothing;

create temporary table batch on commit drop as
  with b as (insert into public.student_import_batches (file_name, row_count)
             values ('house0191-proof.csv', 0) returning id)
  select id from b;

-- A held seat whose ชื่อ matches what our subject will type, and whose
-- รหัสนักศึกษา does NOT — the file-typo shape, and the reason §G exists.
insert into public.student_import_unresolved
  (batch_id, student_id, first_name_th, last_name_th, major, sai_code, cohort_year, reason)
select (select id from batch), '689999881-1', 'สมชาย', 'ใจดี', 'MD', '141', 2568, 'no_kkumail';

create temporary table actor on commit drop as
select u.id, lower(btrim(u.email)) as email,
       row_number() over (order by u.id) as n
  from public.users u
 where u.email ilike '%@kkumail.com'
   and not exists (select 1 from public.students s
                    where lower(btrim(s.kkumail)) = lower(btrim(u.email)))
   and not exists (select 1 from public.house_help_requests h
                    where h.kkumail = lower(btrim(u.email)))
 order by u.id limit 2;

insert into probe select '04. two unused kkumail accounts are available', '2',
  (select count(*)::text from actor);

create or replace function pg_temp.as_actor(p_n integer) returns void
language plpgsql as $$
declare v public.users%rowtype;
begin
  select u.* into v from public.users u join actor a on a.id = u.id where a.n = p_n;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v.id, 'role', 'authenticated', 'email', v.email)::text, true);
end $$;

create or replace function pg_temp.try_claim(p_sid text, p_name text) returns jsonb
language plpgsql as $fn$
begin
  return public.claim_my_student_seat(p_sid, p_name);
exception when others then
  return jsonb_build_object('ok', 'raised', 'message', sqlerrm);
end $fn$;

create temporary table attempt (k text, r jsonb) on commit drop;
grant insert, select on attempt to authenticated;
grant execute on function pg_temp.try_claim(text, text) to authenticated;

-- ── §B a miss is recorded ───────────────────────────────────────────────────
select pg_temp.as_actor(1);
set local role authenticated;
-- The right ชื่อ, the WRONG รหัส — a student whose handover row was mistyped.
insert into attempt select 'near_miss', pg_temp.try_claim('689999999-9', 'สมชาย');
reset role;

insert into probe select '10. the miss is refused', 'false',
  (select r->>'ok' from attempt where k = 'near_miss');

insert into probe select '11. …and a report exists, with what they typed', '689999999-9,สมชาย',
  (select h.typed_student_id || ',' || h.typed_first_name
     from public.house_help_requests h join actor a on a.n = 1 where h.kkumail = a.email);

-- The one fact the handover file did not have, and the reason the report is
-- worth keeping at all: an address Google already verified.
insert into probe select '12. …carrying the CALLER''s verified address', 'true',
  (select exists (select 1 from public.house_help_requests h join actor a on a.n = 1
                   where h.kkumail = a.email and h.kind = 'no_record'))::text;

-- ── §C the caller is still told nothing ─────────────────────────────────────
select pg_temp.as_actor(2);
set local role authenticated;
insert into attempt select 'total_miss', pg_temp.try_claim('680000000-0', 'ไม่มีใครชื่อนี้');
reset role;

insert into probe select '20. a NEAR miss and a TOTAL miss say the same thing', 'true',
  (select ((select r->>'message' from attempt where k = 'near_miss')
        is not distinct from
           (select r->>'message' from attempt where k = 'total_miss'))::text);

-- CONTROL for 20: both messages are real sentences, so this is not two nulls
-- agreeing — the shape this repo has been bitten by five times.
insert into probe select '21. …and it is a real sentence', 'true',
  (select (length(coalesce(r->>'message','')) > 20)::text from attempt where k = 'near_miss');

-- ⚠️ §20 IS A TAUTOLOGY TODAY, AND SAYING SO IS THE POINT. Both calls reach the
-- same `if not found` branch and the same single return, so the equality cannot
-- fail while the function has one exit for a miss — it is a REGRESSION guard
-- against a future "ไม่พบรหัสนี้ / พบรหัสแต่ชื่อไม่ตรง" helpfulness, not a
-- measurement of anything now. A guard whose subject is guaranteed is a guard
-- that has stopped meaning something, so the CONSTRUCTION is what gets asserted:
-- exactly one place in the function can hand a miss back to the caller. Add a
-- second and this goes red before §20 ever could.
insert into probe select '22. …because a miss has exactly ONE exit (what makes 20 real)', '1',
  (select (length(d) - length(replace(d, '''ok'', false', '')))
          / length('''ok'', false')
     from (select pg_get_functiondef('public.claim_my_student_seat(text,text)'::regprocedure) as d) x)::text;

-- ── §D repeated misses are ONE row ──────────────────────────────────────────
select pg_temp.as_actor(1);
set local role authenticated;
insert into attempt select 'again1', pg_temp.try_claim('689999777-7', 'สมชาย');
insert into attempt select 'again2', pg_temp.try_claim('689999666-6', 'สมชาย');
reset role;

insert into probe select '30. five tries leave ONE row, not five', '1',
  (select count(*)::text from public.house_help_requests h join actor a on a.n = 1
    where h.kkumail = a.email);

insert into probe select '31. …and it counts the attempts', '3',
  (select attempts::text from public.house_help_requests h join actor a on a.n = 1
    where h.kkumail = a.email);

insert into probe select '32. …and holds the LATEST thing they typed', '689999666-6',
  (select typed_student_id from public.house_help_requests h join actor a on a.n = 1
    where h.kkumail = a.email);

-- ── §G the list gives the admin a candidate, not just a complaint ───────────
-- Actor 1 typed ชื่อ "สมชาย" and a รหัส that matches nothing. The held seat
-- above agrees on the ชื่อ, which is precisely the near miss a human can settle
-- in one glance and a list of 165 rows cannot.
insert into probe select '40. the request carries the near-miss held row', 'ชื่อตรง รหัสไม่ตรง',
  (select c->>'matched' from (
     select jsonb_array_elements(x->'candidates') as c
       from (select jsonb_array_elements(public.list_house_help_requests(true)) as x) e
      where x->>'kkumail' = (select email from actor where n = 1)) d
   limit 1);

-- CONTROL for 40: the request from actor 2 typed a name nothing matches, so the
-- candidate list must be able to come back EMPTY. Without this, a query that
-- attached every held row to every request would pass 40 for ever.
insert into probe select '41. …and a request with no near miss gets none', '0',
  (select jsonb_array_length(x->'candidates')::text
     from (select jsonb_array_elements(public.list_house_help_requests(true)) as x) e
    where x->>'kkumail' = (select email from actor where n = 2));

-- ── §E a later success closes the report ────────────────────────────────────
-- The half that decides whether the list stays readable. A student who mistypes
-- and then gets it right must leave the worklist on their own.
insert into public.student_import_unresolved
  (batch_id, student_id, first_name_th, last_name_th, major, sai_code, cohort_year, reason)
select (select id from batch), '689999882-9', 'สมชาย', 'ใจดี', 'MD', '141', 2568, 'no_kkumail';

select pg_temp.as_actor(1);
set local role authenticated;
insert into attempt select 'hit', pg_temp.try_claim('689999882-9', 'สมชาย');
reset role;

insert into probe select '50. the correct try succeeds', 'true',
  (select r->>'ok' from attempt where k = 'hit');

insert into probe select '51. …and closes the report they left behind', 'claimed',
  (select resolved_how from public.house_help_requests h join actor a on a.n = 1
    where h.kkumail = a.email);

-- CONTROL for 51: actor 2 never succeeded, so THEIR report must still be open.
-- Without this, a resolver that closed every row would pass 51.
insert into probe select '52. …and leaves the one that did NOT succeed open', 'true',
  (select (resolved_at is null)::text from public.house_help_requests h join actor a on a.n = 2
    where h.kkumail = a.email);

-- ── §H "this record is not mine" ────────────────────────────────────────────
-- The only path for the case that fails OPEN. It must file a sentence and touch
-- nothing: a person looking at a stranger's record must not be able to act on it.
select pg_temp.as_actor(1);   -- actor 1 now HAS a student row, from §E
set local role authenticated;
create temporary table notme on commit drop as
  select public.report_not_my_record('นี่ไม่ใช่ข้อมูลของฉัน') as v;
reset role;

insert into probe select '60. the report files', 'true', (select v->>'ok' from notme);

insert into probe select '61. …as not_me, pointing at the row they are shown', 'not_me,true',
  (select h.kind || ',' || (h.student_ref is not null)::text
     from public.house_help_requests h join actor a on a.n = 1 where h.kkumail = a.email);

insert into probe select '62. …and the student row is UNCHANGED by it', 'true',
  (select exists (select 1 from public.students s join actor a on a.n = 1
                   where lower(btrim(s.kkumail)) = a.email
                     and s.sai_code = '141'))::text;

-- ── §F an admin promoting the held row closes the request too ───────────────
create temporary table importer on commit drop as
select u.id, lower(btrim(u.email)) as email from public.users u
 where u.role in ('vp_admin','dev')
    or 'house' = any (coalesce(u.permissions,'{}') || coalesce(u.managed_permissions,'{}'))
    or 'master' = any (coalesce(u.permissions,'{}') || coalesce(u.managed_permissions,'{}'))
 order by u.id limit 1;

insert into probe select '68. an account holding the house grant exists', 'true',
  (select (count(*) = 1)::text from importer);

insert into public.student_import_unresolved
  (batch_id, student_id, first_name_th, last_name_th, major, sai_code, cohort_year, reason)
select (select id from batch), '689999883-7', 'สมหญิง', 'ใจงาม', 'MD', '141', 2568, 'no_kkumail';

select set_config('request.jwt.claims',
  (select json_build_object('sub', id, 'role','authenticated','email',email)::text
     from importer), true);
select public.promote_unresolved_row(
  (select id from public.student_import_unresolved where student_id = '689999883-7'),
  (select email from actor where n = 2));

insert into probe select '70. the admin''s promote closes actor 2''s open request', 'admin',
  (select resolved_how from public.house_help_requests h join actor a on a.n = 2
    where h.kkumail = a.email);

select step,
       case when got is not distinct from expected then 'PASS' else 'FAIL' end as result,
       expected, got
  from probe order by step;

rollback;
