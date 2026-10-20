-- ============================================================
-- proj0176-master-desk.sql — a `master` works the ผู้ส่ง desk, and the
-- professor's column guard still holds against an actual professor.
--
-- WHAT WENT WRONG (0176). 0111 folds `master` into
-- current_user_project_seats() as {vpa,staff,prof} so a master can work any
-- of the three desks. Every other reader of current_user_is_prof() is an OR
-- branch in a policy, where an extra `true` only widens. The two BEFORE
-- UPDATE column guards are RESTRICTIONS, and they read the extra prof desk
-- as a disqualification: all 41 master holders could change NOTHING on a
-- หนังสือ except a comment. Reported as "can't ซ่อนจากเว็บ on each หนังสือ"
-- because that is the button a ผู้ส่ง reaches for; status, title and note
-- were equally dead.
--
-- WHY BOTH DIRECTIONS ARE MANDATORY HERE. The guard is the ONLY thing
-- stopping a professor from rewriting a หนังสือ — project_documents_update
-- admits him at ROW level and a row-level policy grants every column in the
-- row (class 1). So "master can now write" is half the property; "a
-- prof-only account still cannot" is the half that says the fix widened the
-- guard instead of deleting it. §A and §B are that pair over the same
-- columns.
--
-- SUBJECTS ARE RESOLVED FROM GRANTS, NEVER NAMED. A proof pinned to a person
-- rots the day the org chart moves (docs/mistakes/tooling-proofs.md).
--
-- Nothing is left changed: every write raises inside its own subtransaction
-- to undo itself, and the whole file rolls back.
--
--   node tools/db-query.mjs tools/proj0176-master-desk.sql
-- ============================================================
begin;

create temporary table probe (step text, expected text, got text) on commit drop;

-- ── Subjects ────────────────────────────────────────────────────────────────

-- The reporter's case: master, no role. All 41 are role='user'.
create temporary table subj_master on commit drop as
select u.id as uid from public.users u
 where u.role = 'user'
   and ('master' = any (coalesce(u.permissions, '{}'))
     or 'master' = any (coalesce(u.managed_permissions, '{}')))
 order by u.id limit 1;

-- ONLY the signing desk. The control that must stay refused — without it
-- "allowed" proves nothing, because a guard that was dropped allows everyone.
create temporary table subj_prof on commit drop as
select u.id as uid from public.users u
 where 'prof' = any (coalesce(u.managed_project_seats, '{}'))
   and not (coalesce(u.managed_project_seats, '{}') && array['vpa', 'staff'])
   and u.role = 'user'
   and not ('master' = any (coalesce(u.permissions, '{}')))
   and not ('master' = any (coalesce(u.managed_permissions, '{}')))
 order by u.id limit 1;

-- A plain ผู้ส่งหนังสือ seat, no master. The reporter asked whether their
-- colleagues holding only the seat were hit too; this is that question.
create temporary table subj_vpa on commit drop as
select u.id as uid from public.users u
 where 'vpa' = any (coalesce(u.managed_project_seats, '{}'))
   and u.role = 'user'
   and not ('master' = any (coalesce(u.permissions, '{}')))
   and not ('master' = any (coalesce(u.managed_permissions, '{}')))
 order by u.id limit 1;

-- The target row. Newest, so it exists for as long as the system is used —
-- a proof whose scenario can run out is a proof that goes red on its own
-- (docs/mistakes/tooling-proofs.md).
create temporary table tgt on commit drop as
select d.id, d.project_id from public.project_documents d
 order by d.created_at desc limit 1;

-- §B NEEDS GEOMETRY §A DOES NOT, and the first draft of this file did not
-- notice: prof_can_see_document() requires the หนังสือ to have a sign
-- request, so on a หนังสือ that has none, a professor is refused by RLS
-- BEFORE the column guard is consulted. Every §B row came back 'deny-rls'
-- — including B5, which asserts he CAN comment — so the block was proving
-- the row was invisible to him, not that the guard held. Refused rows are
-- not a passing guard.
--
-- The remedy is to CREATE the scenario, not to relax what it asserts: a
-- sign request on the target หนังสือ, inserted here as the superuser and
-- rolled back with everything else. Unconditional, so the proof does not
-- quietly change shape on the day production happens to have one.
insert into public.project_sign_requests (id, document_id, prof_id, status, requested_by)
select 'SR-PROOF-0176', t.id, (select uid from subj_prof), 'pending', (select uid from subj_master)
  from tgt t;

-- ── Instruments ─────────────────────────────────────────────────────────────
-- A column guard RAISES; RLS does not — it matches zero rows. So the answer
-- has three values, not two, and 'deny-rls' must never be scored the same as
-- 'guard'. Conflating them is how a broken service reads as a working guard.
create or replace function pg_temp.wr(p_uid uuid, p_sql text)
returns text as $$
declare n int; msg text;
begin
  begin
    perform set_config('request.jwt.claims',
      json_build_object('sub', p_uid::text, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
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
      return case when msg like '%prof_guard%' then 'guard' else 'ERROR ' || left(msg, 40) end;
  end;
end $$ language plpgsql;

create or replace function pg_temp.helper(p_uid uuid, p_expr text)
returns text as $$
declare v text;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  execute 'select (' || p_expr || ')::text' into v;
  execute 'reset role';
  return v;
end $$ language plpgsql;

-- ── §0 the subjects are what the proof thinks they are ──────────────────────
-- Without this, §A passing could mean "the master branch works" or "this
-- account is a vp_admin by role and never touched the code path".
insert into probe select '00. a master subject exists', 'true',
  (select count(*) > 0 from subj_master)::text;
insert into probe select '01. a prof-only subject exists (the control is not vacuous)', 'true',
  (select count(*) > 0 from subj_prof)::text;
insert into probe select '02. master holds all three desks (0111 §2 still stands)', '{vpa,staff,prof}',
  pg_temp.helper((select uid from subj_master), 'public.current_user_project_seats()');
insert into probe select '03. master IS a professor at the DB — the fix does not deny that', 'true',
  pg_temp.helper((select uid from subj_master), 'public.current_user_is_prof()');
insert into probe select '04. master is ALSO an actor — which is what the guard must notice', 'true',
  pg_temp.helper((select uid from subj_master), 'public.current_user_is_project_actor()');
insert into probe select '05. the prof-only control is a prof and NOT an actor', 'true',
  (pg_temp.helper((select uid from subj_prof), 'public.current_user_is_prof()') = 'true'
   and pg_temp.helper((select uid from subj_prof), 'public.current_user_is_project_actor()') = 'false')::text;

-- ── §A ALLOW — the master's desk works ──────────────────────────────────────
-- The reported button first, then the three the report never mentioned and
-- that were just as dead. A fix verified only on the reported symptom is how
-- the other three would have shipped still broken.
insert into probe select 'A1. master may ซ่อนจากเว็บ ONE หนังสือ (the report)', 'allow',
  pg_temp.wr((select uid from subj_master),
    format('update public.project_documents set is_public = not is_public where id = %L', (select id from tgt)));
-- The value must really CHANGE. The first draft wrote `status || ''`, which
-- is not distinct from the old value, so the guard was never consulted and
-- the row passed with the bug reintroduced — a green assertion measuring
-- nothing (skills/write-a-guard.md).
insert into probe select 'A2. master may change a หนังสือ status', 'allow',
  pg_temp.wr((select uid from subj_master),
    format('update public.project_documents set status = case when status = %L then %L else %L end where id = %L',
           'completed', 'sent', 'completed', (select id from tgt)));
insert into probe select 'A3. master may edit a หนังสือ title', 'allow',
  pg_temp.wr((select uid from subj_master),
    format('update public.project_documents set title = title || %L where id = %L', 'x', (select id from tgt)));
insert into probe select 'A4. master may set drive_folder (the silent one — §3 of 0176)', 'allow',
  pg_temp.wr((select uid from subj_master),
    format('update public.project_documents set drive_folder = coalesce(drive_folder, %L) || %L where id = %L', '', 'x', (select id from tgt)));
insert into probe select 'A5. master may ซ่อนจากเว็บ the whole โครงการ (never broken — regression pin)', 'allow',
  pg_temp.wr((select uid from subj_master),
    format('update public.projects set is_public = not is_public where id = %L', (select project_id from tgt)));
insert into probe select 'A6. a plain vpa seat is unaffected (the reporter''s second question)', 'allow',
  pg_temp.wr((select uid from subj_vpa),
    format('update public.project_documents set is_public = not is_public where id = %L', (select id from tgt)));

-- ── §B DENY — the guard still guards ────────────────────────────────────────
-- Same columns, an account that is a professor and NOTHING else. 'guard' —
-- not 'deny-rls': the professor CAN reach this row (project_documents_update
-- admits him), so a deny-rls here would mean his comment access broke too.
insert into probe select 'B1. a prof-only account still may not ซ่อนจากเว็บ', 'guard',
  pg_temp.wr((select uid from subj_prof),
    format('update public.project_documents set is_public = not is_public where id = %L', (select id from tgt)));
-- The value must CHANGE, as in A2: a literal 'completed' was a no-op the day
-- the newest หนังสือ was completed (2026-10-20), so the guard was never
-- consulted and B2 read 'allow' — red, but for a reason that said nothing.
insert into probe select 'B2. a prof-only account still may not move the status', 'guard',
  pg_temp.wr((select uid from subj_prof),
    format('update public.project_documents set status = case when status = %L then %L else %L end where id = %L',
           'completed', 'sent', 'completed', (select id from tgt)));
insert into probe select 'B3. a prof-only account still may not rewrite the title', 'guard',
  pg_temp.wr((select uid from subj_prof),
    format('update public.project_documents set title = title || %L where id = %L', 'x', (select id from tgt)));
insert into probe select 'B4. a prof-only account still may not repoint the โครงการ', 'guard',
  pg_temp.wr((select uid from subj_prof),
    format('update public.project_documents set project_id = %L where id = %L', 'PRJ-NOPE', (select id from tgt)));
insert into probe select 'B5. the professor keeps the one thing the guard exists to allow', 'allow',
  pg_temp.wr((select uid from subj_prof),
    format('update public.project_documents set timeline = timeline where id = %L', (select id from tgt)));

-- ── §C the twin guard, fixed in the same commit ─────────────────────────────
-- Latent, not a live break — the app only ever patches the decision columns.
-- It is here because "the first fix landing alone" is how these two drift.
insert into probe select 'C1. sign_requests: the actor exemption is in the LIVE body', 'true',
  (pg_get_functiondef('public.sign_requests_prof_guard'::regproc)
     ~ 'current_user_is_prof\(\) and not public\.current_user_is_project_actor\(\)')::text;
insert into probe select 'C2. project_documents: the actor exemption is in the LIVE body', 'true',
  (pg_get_functiondef('public.project_documents_prof_guard'::regproc)
     ~ 'current_user_is_prof\(\) and not public\.current_user_is_project_actor\(\)')::text;
insert into probe select 'C3. is_public is still one of the columns the guard names', 'true',
  (pg_get_functiondef('public.project_documents_prof_guard'::regproc)
     ~ 'new\.is_public\s+is distinct from old\.is_public')::text;

-- ── §D the data repair, and that it cannot recur ────────────────────────────
-- send.js patches drive_folder AFTER the insert (the folder name needs the id
-- the insert mints). For a master that PATCH raised, inside `catch {}`, so
-- three หนังสือ kept `…/<slug>_` while their files went to `…/<slug>_DOC-…`.
insert into probe select 'D1. every หนังสือ Drive path ends in its own id', '0',
  (select count(*)::text from public.project_documents
    where drive_folder is not null and drive_folder !~ ('_' || id || '$'));
insert into probe select 'D2. control — D1 is scanning real paths, not an empty set', 'true',
  ((select count(*) from public.project_documents where drive_folder is not null) > 20)::text;

select step, expected, got,
       case when expected = got then 'PASS' else 'FAIL' end as result
from probe order by step;

rollback;
