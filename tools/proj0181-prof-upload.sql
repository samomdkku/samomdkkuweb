-- ============================================================
-- proj0181-prof-upload.sql — an อาจารย์ can save a signed file on a หนังสือ
-- that is NOT published to the public website.
--
--   node tools/db-query.mjs tools/proj0181-prof-upload.sql     (PRODUCTION)
--
-- WHY THIS EXISTS. Until 0181 the professor's read policy identified a row by
-- looking it up in project_files, so it could not see the row he was creating,
-- and `insert … returning` (PostgREST return=representation, which
-- api.js createFile uses) was refused. project_files_read_public covered for it
-- whenever the โครงการ and the หนังสือ were both public — the default — so all
-- 18 signed uploads in history passed on the PUBLIC-SITE flag, not on the
-- professor's own grant. Three หนังสือ whose visibility was off lost their
-- signature to it, AFTER the PDF had already been written to Google Drive.
--
-- WHAT MAKES THIS A GUARD AND NOT A DEMO — four halves:
--   A  ALLOW  ... the prof CAN save, in all four visibility states.
--   B  DENY   ... someone with no seat still cannot.
--   C  CONTROL. the cases are re-run with project_files_read_public DROPPED,
--      so a green A cannot be scored by the public policy standing in for the
--      grant. That substitution IS the bug; without C this proof would have
--      been green all through August and told us nothing.
--   D  DIFFERENTIAL. prof_can_see_file(id) = prof_can_see_file(id,
--      sign_request_id) over every row already in the table, so the 1-arg
--      lookup wrapper and the 2-arg rule cannot drift (mistakes class 6).
--      D2 is D1's own control: an empty table would also report "agree".
--
-- ⚠️ THE INSTRUMENT NEEDED AN INSTRUMENT — three times. The first version was
-- GREEN against the UNFIXED database — it wrapped `set local role
-- authenticated` inside the plpgsql helper that did the insert, and the role
-- never took effect there, so every case ran as the superuser with RLS
-- bypassed and "saved" meant nothing. The role is therefore set at TOP LEVEL
-- here, the same way tools/authz-sweep-identity.sql does it, and the helper
-- only captures the exception. A second trap in the same version: the helper
-- scored sqlstate 42501 as "RLS refused", which also matched a missing GRANT on
-- this file's own temp fixtures. The third was the subtlest and is called out
-- at the `returning` line below: `returning 1` reads no column of the new row,
-- so Postgres never applies the SELECT policy and the case passes while the
-- feature is broken. All three are why the pre-fix run is recorded in this
-- header — a guard nobody has watched FAIL is a guard nobody has tested.
--
-- MEASURED BEFORE 0181 (production, rolled back): A1 saved, A2/A3/A4 refused,
-- C1/C2 refused, B1/C3 refused (correctly). AFTER 0181: all PASS.
--
-- The scenario needs a หนังสือ with a sign request; it PICKS one and flips the
-- visibility itself rather than hoping a hidden one exists — a proof whose
-- scenario can run out goes red for the wrong reason.
--
-- Everything is inside ONE transaction that ROLLS BACK. Nothing persists: not
-- the probe rows, not the visibility flips, not the dropped policy, not the
-- seat grant.
-- ============================================================
begin;

create temp table probe(step text, expected text, got text) on commit drop;
grant all on probe to authenticated;

-- ── fixtures ───────────────────────────────────────────────────────────────
-- A หนังสือ that really has a sign request, plus the request and the original
-- file that go with it. Taken from live data so the shape is the real one.
create temp table fx on commit drop as
select d.id as doc_id, d.project_id, r.id as req_id, r.file_ids[1] as orig_id
  from public.project_documents d
  join public.project_sign_requests r on r.document_id = d.id
 where array_length(r.file_ids, 1) >= 1
 order by r.requested_at desc
 limit 1;

-- The อาจารย์: a real seat holder, else any bare account granted the seat for
-- the length of this transaction. Derived from the gate's OWN predicate
-- (managed_project_seats), never a hardcoded name that can rot. `master` is
-- excluded deliberately — a master is also a project ACTOR, which would pass
-- project_files_read on its first branch and never exercise the prof branch.
create temp table subj on commit drop as
select coalesce(
  (select u.id from public.users u
    where 'prof' = any(coalesce(u.managed_project_seats,'{}'))
      and not ('master' = any(coalesce(u.managed_permissions,'{}')))
    limit 1),
  (select u.id from public.users u
    where coalesce(u.managed_project_seats,'{}') = '{}'
      and coalesce(u.managed_permissions,'{}')   = '{}'
      and u.role = 'user'
    limit 1)) as uid;

update public.users set managed_project_seats = array['prof']
 where id = (select uid from subj)
   and not ('prof' = any(coalesce(managed_project_seats,'{}')));

-- A user with no grant at all — the DENY half's subject.
create temp table nobody on commit drop as
select u.id as uid from public.users u
 where coalesce(u.managed_project_seats,'{}') = '{}'
   and coalesce(u.managed_permissions,'{}')   = '{}'
   and u.role = 'user'
   and u.id <> (select uid from subj)
 limit 1;

grant all on fx, subj, nobody to authenticated;

-- ── the write, exactly as api.js createFile issues it ───────────────────────
-- `returning id` is not decoration: it IS the bug. Drop it and the insert
-- passes even while the feature is broken.
--
-- This helper ONLY captures the exception. It must NOT switch role — see the
-- header. The caller sets the role first.
create or replace function pg_temp.save_signed() returns text
language plpgsql as $$
declare n bigint;
begin
  insert into public.project_files
    (document_id, file_name, drive_file_id, drive_view_url, mime_type,
     size_bytes, uploaded_by, sign_request_id, is_signed, signs_file_id)
  select f.doc_id, 'proof (ลงนาม).pdf', 'proof-'||floor(random()*1e12)::text,
         'https://drive.example/proof', 'application/pdf', 1,
         auth.uid(), f.req_id, true, f.orig_id
    from fx f
  -- `returning id`, not `returning 1`. Postgres only applies the SELECT policy
  -- to RETURNING when the returned expression reads a COLUMN of the new row —
  -- `returning 1` reads none, passes, and made the first two versions of this
  -- proof green against the broken database. PostgREST's return=representation
  -- issues `RETURNING *`, so the guard has to read a column too.
  returning id into n;
  return case when n is not null then 'saved' else 'no row' end;
exception when others then
  -- Only an RLS rejection may read as "refused". Any other error — a missing
  -- GRANT on a fixture, a broken column list — must surface as itself, or the
  -- proof scores its own breakage as the verdict it is hunting for.
  return case
    when sqlerrm like '%row-level security%' then 'refused'
    else 'error:'||sqlstate||' '||left(sqlerrm, 60) end;
end $$;
grant execute on function pg_temp.save_signed() to authenticated;

-- Visibility is flipped as the superuser with no JWT, so project_public_flag_guard
-- exempts on a null auth.uid(). Never called while a role is set.
create or replace function pg_temp.vis(p_project boolean, p_doc boolean)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  update public.projects          set is_public = p_project
   where id = (select project_id from fx);
  update public.project_documents set is_public = p_doc
   where id = (select doc_id from fx);
end $$;

create or replace function pg_temp.claims(p_who uuid) returns void
language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', p_who::text, 'role','authenticated')::text, true)::void $$;

-- ============================================================
-- A · ALLOW — the professor can save, whatever the public site is showing
-- ============================================================
select pg_temp.vis(true, true);
select pg_temp.claims((select uid from subj));
set local role authenticated;
insert into probe select 'A1 · prof saves · โครงการ public · หนังสือ public', 'saved', pg_temp.save_signed();
reset role;

select pg_temp.vis(false, true);
select pg_temp.claims((select uid from subj));
set local role authenticated;
insert into probe select 'A2 · prof saves · โครงการ HIDDEN', 'saved', pg_temp.save_signed();
reset role;

select pg_temp.vis(true, false);
select pg_temp.claims((select uid from subj));
set local role authenticated;
insert into probe select 'A3 · prof saves · หนังสือ HIDDEN', 'saved', pg_temp.save_signed();
reset role;

select pg_temp.vis(false, false);
select pg_temp.claims((select uid from subj));
set local role authenticated;
insert into probe select 'A4 · prof saves · both HIDDEN', 'saved', pg_temp.save_signed();
reset role;

-- ============================================================
-- B · DENY — no seat, no save. A proof that only ever asserts "allowed" cannot
--     tell a working grant from a policy that admits everyone.
-- ============================================================
select pg_temp.claims((select uid from nobody));
set local role authenticated;
insert into probe select 'B1 · a user with no seat cannot save', 'refused', pg_temp.save_signed();
reset role;

-- ============================================================
-- C · CONTROL — the same cases with project_files_read_public GONE. This is
--     the half that would have caught 0181: before the fix A1 passed here only
--     because the public policy answered for the professor.
-- ============================================================
drop policy if exists project_files_read_public on public.project_files;

select pg_temp.vis(true, true);
select pg_temp.claims((select uid from subj));
set local role authenticated;
insert into probe select 'C1 · no public policy · both public', 'saved', pg_temp.save_signed();
reset role;

select pg_temp.vis(false, false);
select pg_temp.claims((select uid from subj));
set local role authenticated;
insert into probe select 'C2 · no public policy · both HIDDEN', 'saved', pg_temp.save_signed();
reset role;

select pg_temp.claims((select uid from nobody));
set local role authenticated;
insert into probe select 'C3 · no public policy · no seat still refused', 'refused', pg_temp.save_signed();
reset role;

-- ============================================================
-- D · DIFFERENTIAL — the 1-arg lookup wrapper and the 2-arg rule must agree on
--     every row that EXISTS, or they are two implementations of one rule. Run
--     as the professor: both forms gate on current_user_is_prof().
-- ============================================================
select pg_temp.claims((select uid from subj));
set local role authenticated;
insert into probe
select 'D1 · prof_can_see_file(id) agrees with (id, sign_request_id)',
       'agree',
       case when count(*) filter (
              where public.prof_can_see_file(f.id)
                is distinct from public.prof_can_see_file(f.id, f.sign_request_id)) = 0
            then 'agree' else 'DRIFT' end
  from public.project_files f;
insert into probe
select 'D2 · that comparison saw rows (D1 is not vacuous)',
       'saw rows',
       case when count(*) > 0 then 'saw rows' else 'EMPTY' end
  from public.project_files;
reset role;

-- ── verdict ────────────────────────────────────────────────────────────────
select step,
       case when got = expected then 'PASS' else 'FAIL' end as verdict,
       expected, got
  from probe
 order by step;

rollback;
