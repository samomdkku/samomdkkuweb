-- ============================================================
-- dept0177-page-scope.sql — a ฝ่าย edits its OWN page and nobody else's.
--
-- 0177 lets a ฝ่าย edit its page content in the app instead of asking IT for a
-- commit. The whole safety of that rests on one predicate,
-- `current_user_dept_page_scope()`, so this proof asks it from four different
-- identities over the same rows.
--
-- WHY BOTH DIRECTIONS ARE MANDATORY. "The editor can write" is half a property:
-- a policy that was dropped entirely also lets the editor write. The half that
-- says the scope is real is that the SAME editor is refused on ANOTHER ฝ่าย's
-- row, and that a signed-in account with no grant is refused everywhere. A
-- deny-only probe cannot tell a working guard from a broken service, and an
-- allow-only probe cannot tell a scope from `using (true)`.
--
-- THE SUBJECTS ARE CREATED, NOT FOUND. This grant is new, so nobody holds it
-- yet and a proof that searched for a holder would be vacuously green for as
-- long as it took someone to be granted — green while broken. Where a scenario
-- can be absent, CREATE it (docs/mistakes/tooling-proofs.md). Everything is
-- undone: writes raise inside their own subtransaction and the file rolls back.
--
--   node tools/db-query.mjs tools/dept0177-page-scope.sql
-- ============================================================
begin;

create temporary table probe (step text, expected text, got text) on commit drop;

-- ── Subjects ────────────────────────────────────────────────────────────────
-- Three plain accounts, no role, no master: whatever they can do comes from
-- the new dimension and from nothing else. Picked by id so the proof does not
-- name a person, which is how a proof rots.
create temporary table subj on commit drop as
select u.id as uid, row_number() over (order by u.id) as n
  from public.users u
 where u.role = 'user'
   and not ('master' = any (coalesce(u.permissions, '{}')))
   and not ('master' = any (coalesce(u.managed_permissions, '{}')))
   and coalesce(u.managed_permissions, '{}') = '{}'
   and coalesce(u.permissions, '{}') = '{}'
 order by u.id limit 3;

-- ⚠️ THE SETUP IS BLOCKED BY THE THING THE PROOF IS TESTING, which is the
-- first evidence that the guard is real: as the superuser `auth.uid()` is null,
-- so `current_user_is_staff()` is false and users_self_update_guard refuses
-- both of these writes. It is switched off for the two setup statements and
-- switched straight back on — §60 below then asks it the question that matters,
-- from an actual user. Leaving it off would make §60 pass by vacuum.
alter table public.users disable trigger users_self_update_guard;
update public.users set managed_dept_pages = array['digital']
 where id = (select uid from subj where n = 1);
update public.users set permissions = array['dept_pages']
 where id = (select uid from subj where n = 2);
alter table public.users enable trigger users_self_update_guard;

-- ── Target rows, one per ฝ่าย ───────────────────────────────────────────────
insert into public.dept_content (id, dept, kind, position, title, href)
values ('00000000-0000-4000-8000-000000000177', 'digital', 'card', 1, 'proof row (digital)', 'https://example.invalid/d'),
       ('00000000-0000-4000-8000-000000000178', 'academic', 'card', 1, 'proof row (academic)', 'https://example.invalid/a'),
       ('00000000-0000-4000-8000-000000000179', 'digital', 'card', 2, 'proof row (hidden)', 'https://example.invalid/h');
update public.dept_content set visible = false where id = '00000000-0000-4000-8000-000000000179';

-- ── Instruments ─────────────────────────────────────────────────────────────
-- Three answers, not two. RLS refuses by matching ZERO ROWS; a CHECK or a
-- trigger RAISES. Scoring them the same is how a broken service reads as a
-- working guard.
create or replace function pg_temp.wr(p_uid uuid, p_sql text)
returns text as $$
declare n int; msg text;
begin
  begin
    if p_uid is null then
      perform set_config('request.jwt.claims', null, true);
      execute 'set local role anon';
    else
      perform set_config('request.jwt.claims',
        json_build_object('sub', p_uid::text, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
    end if;
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
        when msg like '%permission denied%'     then 'deny-grant'
        when msg like '%violates row-level%'    then 'deny-check'
        else 'ERROR ' || left(msg, 48) end;
  end;
end $$ language plpgsql;

create or replace function pg_temp.rd(p_uid uuid, p_sql text)
returns text as $$
declare v text;
begin
  if p_uid is null then
    perform set_config('request.jwt.claims', null, true);
    execute 'set local role anon';
  else
    perform set_config('request.jwt.claims',
      json_build_object('sub', p_uid::text, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
  end if;
  execute p_sql into v;
  execute 'reset role';
  return v;
end $$ language plpgsql;

-- ── §0 the subjects are what this proof thinks they are ─────────────────────
insert into probe select '00. three ungranted subjects exist', '3',
  (select count(*) from subj)::text;
insert into probe select '01. scoped subject sees exactly its own ฝ่าย', '{digital}',
  pg_temp.rd((select uid from subj where n=1), 'select public.current_user_dept_page_scope()::text');
insert into probe select '02. blanket key means EVERY ฝ่าย (null, not a list)', 'ALL',
  coalesce(pg_temp.rd((select uid from subj where n=2), 'select public.current_user_dept_page_scope()::text'), 'ALL');
insert into probe select '03. an ungranted account has NO ฝ่าย', '{}',
  pg_temp.rd((select uid from subj where n=3), 'select public.current_user_dept_page_scope()::text');

-- ── §A the scoped editor CAN work their own ฝ่าย ────────────────────────────
insert into probe select '10. scoped: update own ฝ่าย row', 'allow',
  pg_temp.wr((select uid from subj where n=1),
    $q$update public.dept_content set title = 'edited' where id = '00000000-0000-4000-8000-000000000177'$q$);
insert into probe select '11. scoped: insert into own ฝ่าย', 'allow',
  pg_temp.wr((select uid from subj where n=1),
    $q$insert into public.dept_content (dept, kind, title) values ('digital','card','new')$q$);
insert into probe select '12. scoped: publish HTML on own ฝ่าย', 'allow',
  pg_temp.wr((select uid from subj where n=1),
    $q$insert into public.dept_content (dept, kind, html) values ('digital','html','<p>hi</p>')$q$);
insert into probe select '13. scoped: delete own ฝ่าย row', 'allow',
  pg_temp.wr((select uid from subj where n=1),
    $q$delete from public.dept_content where id = '00000000-0000-4000-8000-000000000177'$q$);
insert into probe select '14. scoped: reads its own HIDDEN row (ซ่อน is not delete)', '1',
  pg_temp.rd((select uid from subj where n=1),
    $q$select count(*)::text from public.dept_content where id = '00000000-0000-4000-8000-000000000179'$q$);

-- ── §B the SAME editor is refused on another ฝ่าย ───────────────────────────
-- Without this block, §A would pass just as well against `using (true)`.
insert into probe select '20. scoped: update ANOTHER ฝ่าย row', 'deny-rls',
  pg_temp.wr((select uid from subj where n=1),
    $q$update public.dept_content set title = 'stolen' where id = '00000000-0000-4000-8000-000000000178'$q$);
insert into probe select '21. scoped: insert into ANOTHER ฝ่าย', 'deny-check',
  pg_temp.wr((select uid from subj where n=1),
    $q$insert into public.dept_content (dept, kind, title) values ('academic','card','x')$q$);
insert into probe select '22. scoped: delete ANOTHER ฝ่าย row', 'deny-rls',
  pg_temp.wr((select uid from subj where n=1),
    $q$delete from public.dept_content where id = '00000000-0000-4000-8000-000000000178'$q$);

-- ── §C the COLUMN guard: a row cannot be walked to another ฝ่าย ─────────────
-- Class 1: a per-row UPDATE policy gates WHICH ROW and then grants every column
-- in it — including `dept`. So an editor could keep one of their own rows and
-- change its ฝ่าย, landing their content on a page they may not touch. The
-- `with check` clause is what refuses that, and this is the only assertion that
-- can tell whether the clause is doing anything.
--
-- ⚠️ IT MUST BE THE **VISIBLE** ROW, AND THE FIRST DRAFT USED THE HIDDEN ONE.
-- That version passed against `with check (true)` — a guard that fails green.
-- Measured cause: when a HIDDEN row is moved out of the editor's scope, the new
-- row satisfies neither SELECT policy (not visible=true, no longer their ฝ่าย),
-- so Postgres refuses it whatever the UPDATE policy says. The assertion was
-- reading that refusal and scoring the column guard as present. On a visible
-- row — which is what ฝ่าย page content normally is — the same statement
-- SUCCEEDS the moment the check is weakened. Falsified both ways before this
-- line was trusted.
insert into probe select '30. scoped: move own VISIBLE row to ANOTHER ฝ่าย', 'deny-check',
  pg_temp.wr((select uid from subj where n=1),
    $q$update public.dept_content set dept = 'academic' where id = '00000000-0000-4000-8000-000000000177'$q$);

-- ── §D the blanket key really is every ฝ่าย ─────────────────────────────────
insert into probe select '40. blanket: update ฝ่าย A', 'allow',
  pg_temp.wr((select uid from subj where n=2),
    $q$update public.dept_content set title = 'ok' where id = '00000000-0000-4000-8000-000000000178'$q$);
insert into probe select '41. blanket: update ฝ่าย B', 'allow',
  pg_temp.wr((select uid from subj where n=2),
    $q$update public.dept_content set title = 'ok' where id = '00000000-0000-4000-8000-000000000179'$q$);

-- ── §E an account with no grant, and anon ───────────────────────────────────
insert into probe select '50. ungranted signed-in: update', 'deny-rls',
  pg_temp.wr((select uid from subj where n=3),
    $q$update public.dept_content set title = 'x' where id = '00000000-0000-4000-8000-000000000178'$q$);
insert into probe select '51. ungranted signed-in: insert', 'deny-check',
  pg_temp.wr((select uid from subj where n=3),
    $q$insert into public.dept_content (dept, kind, title) values ('digital','card','x')$q$);
insert into probe select '52. anon: cannot write', 'deny-grant',
  pg_temp.wr(null,
    $q$insert into public.dept_content (dept, kind, title) values ('digital','card','x')$q$);
-- The ALLOW half over the same rows. A deny-only probe cannot tell a working
-- policy from a table nobody can reach at all (0138: policies without a GRANT).
insert into probe select '53. anon: CAN read a visible row — the page is public', '1',
  pg_temp.rd(null,
    $q$select count(*)::text from public.dept_content where id = '00000000-0000-4000-8000-000000000178'$q$);
insert into probe select '54. anon: canNOT read a hidden row', '0',
  pg_temp.rd(null,
    $q$select count(*)::text from public.dept_content where id = '00000000-0000-4000-8000-000000000179'$q$);
insert into probe select '55. ungranted signed-in: cannot read a hidden row either', '0',
  pg_temp.rd((select uid from subj where n=3),
    $q$select count(*)::text from public.dept_content where id = '00000000-0000-4000-8000-000000000179'$q$);

-- ── §F the tree-managed column stays server-managed ─────────────────────────
-- The grant is only as strong as the impossibility of granting it to yourself.
-- ⚠️ Matched on a prefix, not on the sentence: pg_temp.wr() truncates a raised
-- message to 48 characters, and the first draft looked for 'server-managed' —
-- which falls off the end. The instrument had cut the evidence away before the
-- assertion could read it, and the proof reported a working guard as broken.
insert into probe select '60. a user cannot grant themselves a ฝ่าย', 'ERROR-guard',
  case when pg_temp.wr((select uid from subj where n=3),
    $q$update public.users set managed_dept_pages = array['admin'] where id = auth.uid()$q$)
    like 'ERROR users_self_update_guard%' then 'ERROR-guard' else 'NOT REFUSED' end;

-- ── §G the seeded content actually arrived, and the property SURVIVES a new
--    card being added beside it ────────────────────────────────────────────
-- ⚠️ WAS A SHAPE, NOT A PROPERTY (class 7 — production went red for this).
-- The first version counted every admin card (`count(*) where dept='admin'
-- and kind='card'` = 4) — but 0177 exists precisely so a ฝ่าย can ADD its own
-- cards through the self-service editor §A already proves works, and
-- ฝ่ายบริหารองค์กร did: production grew a 5th card and the hardcoded count
-- went red for the GOOD reason this migration shipped. The property that
-- actually matters is narrower and does not move when a card is added: these
-- four SPECIFIC seeded rows — identified by the href the seed migration
-- (0177 §5) itself uses as its idempotency key — are still present.
create temporary table seeded_hrefs (href text) on commit drop;
insert into seeded_hrefs values
  ('https://canva.link/vjavei9c6thy5wl'),
  ('https://canva.link/hlmz649y2e7se85'),
  ('https://canva.link/1ej1lt111zjy079'),
  ('https://docs.google.com/forms/d/e/1FAIpQLSc2J4O7sUcUYjNpPeFhbRZMreIBaAAVggUS7U0oFMX7KF_fxQ/viewform?pli=1');

insert into probe select '70. every seeded ฝ่ายบริหารองค์กร card is still present', '4',
  (select count(*)::text from public.dept_content d join seeded_hrefs h on h.href = d.href
    where d.dept = 'admin' and d.kind = 'card');

-- Reintroduce the exact event that broke the old count — an admin-scoped
-- editor adding a 5th card through the same path §A proved — and show the
-- new assertion does not move.
insert into probe select '71. an editor with admin-page access adds a 5th card', 'allow',
  pg_temp.wr((select uid from subj where n=2),
    $q$insert into public.dept_content (dept, kind, title, href)
       values ('admin', 'card', 'card someone added later', 'https://example.invalid/a-fifth-admin-card')$q$);
insert into probe select '72. …and the four seeded cards still count as 4, unmoved', '4',
  (select count(*)::text from public.dept_content d join seeded_hrefs h on h.href = d.href
    where d.dept = 'admin' and d.kind = 'card');

select step,
       case when got is not distinct from expected then 'PASS' else 'FAIL' end as result,
       expected, got
  from probe order by step;

rollback;
