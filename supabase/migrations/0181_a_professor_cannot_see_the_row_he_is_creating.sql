-- ============================================================
-- 0181 — the professor's read rule looked the row up in its own table, so it
--        could not see the row he was CREATING; the public-site flag had been
--        covering for that since 0114
--
-- REPORTED: "some หนังสือโครงการ has been อนุมัติแล้ว but there isn't
-- signature sign on the pdf" — เกียรติบัตร ประดับช่อ, HYROX101, ICEM
-- ประกวดสื่อสร้างสรรค์, all accepted 2026-09-03 02:59-03:02 with no signed
-- file. The owner then found the signed PDFs sitting in Google Drive,
-- referenced by nothing. Drive is written BEFORE the row, so the row is what
-- was refused.
--
-- CAUSE. project_files_read was
--     current_user_is_project_actor() OR prof_can_see_file(id)
-- and prof_can_see_file(id) answers by SELECTing project_files for that id.
-- On `insert … returning` — which is exactly what PostgREST issues for
-- `Prefer: return=representation`, and what api.js createFile() uses — the row
-- is not in the table yet, the lookup finds nothing, the SELECT policy fails,
-- and Postgres rejects the whole statement. A rule that identifies a row by
-- looking it up cannot see a row being created (mistakes class 2/4).
--
-- WHY IT WORKED FOR THREE MONTHS. 0114 added a SECOND, unrelated policy:
--     project_files_read_public  using (project_doc_is_public(document_id))
-- which reads the DOCUMENT's flags and never touches the new row. It passes
-- whenever the โครงการ and the หนังสือ are both public — the default. So a
-- public-WEBSITE feature has been the only thing letting an อาจารย์ save his
-- signature, and all 18 signed uploads in history were on public โครงการ.
-- Hide either flag and signing dies, while reading, commenting, ยอมรับ,
-- notifications and "seen" all keep working — which is why it looked like
-- nothing was wrong.
--
-- MEASURED ON PROD BEFORE THE FIX (rolled-back transaction, tools/db-query),
-- as the อาจารย์ (Prakasit, managed_project_seats={prof}):
--   ประดับช่อ  โครงการ hidden                 insert…returning  REFUSED
--     ↳ same หนังสือ, โครงการ made public                       OK
--   MedQuiz    โครงการ public                                   OK
--     ↳ same หนังสือ, โครงการ made hidden                       REFUSED
--   CONTROL — identical insert as เจ้าหน้าที่, โครงการ hidden    OK
-- and every other write on the professor's path (delete old signed file,
-- sign-request timeline, doc timeline, doc_views, notification) OK in all
-- three visibility states. Exactly one step ever fails.
--
-- A sweep of every SELECT/ALL policy in `public` for "calls a function whose
-- body reads the same table" returned ONE row: this one. The shape is unique.
--
-- THE SHAPE OF THE FIX. Keep ONE home for the rule (class 6): the RULE moves
-- into a two-argument prof_can_see_file(id, sign_request_id) that reads only
-- values the caller already has, and the old one-argument form becomes a thin
-- lookup wrapper that delegates to it — so tools/prof0095-seat-parity.mjs and
-- anything else calling the 1-arg form keep working and cannot drift. The
-- policy passes the ROW's own columns, which exist during `returning`.
--
-- NOT A WIDENING. For every row that already exists the two forms are
-- identical by construction (the wrapper supplies the same sign_request_id the
-- policy reads off the row); tools/proj0181-prof-upload.sql asserts that
-- equality over every row in the table as its differential half.
-- ============================================================

-- §1 — the rule, in one home, reading only what the caller hands it.
--
-- Branch 1: the file is one the เจ้าหน้าที่ ASKED for (it is named in some
-- request's file_ids). Branch 2: the file IS a signed output — it carries a
-- sign_request_id. Neither branch needs the row to be in the table, so both
-- answer correctly for a row being inserted.
create or replace function public.prof_can_see_file(
  p_file_id         bigint,
  p_sign_request_id text
) returns boolean
language sql stable security definer set search_path to 'public' as $$
  select public.current_user_is_prof()
     and (
       exists (
         select 1 from public.project_sign_requests r
          where p_file_id = any (r.file_ids)
       )
       or (
         p_sign_request_id is not null
         and exists (
           select 1 from public.project_sign_requests r
            where r.id = p_sign_request_id
         )
       )
     )
$$;

comment on function public.prof_can_see_file(bigint, text) is
  '0181. THE rule for whether an อาจารย์ may read one project_files row. Takes '
  'the row''s OWN columns so it also answers for a row being INSERTed — the '
  '1-arg form below looks the row up and delegates here, so there is one rule, '
  'not two. Never reintroduce a lookup on project_files in this body.';

-- §2 — the one-argument form keeps its old meaning: resolve the row, then ask
-- the rule. Existing callers (tools/prof0095-seat-parity.mjs) are unaffected.
-- It stays a LOOKUP helper and must not be used in project_files' own policy.
create or replace function public.prof_can_see_file(p_file_id bigint)
returns boolean
language sql stable security definer set search_path to 'public' as $$
  select public.prof_can_see_file(
    p_file_id,
    (select f.sign_request_id from public.project_files f where f.id = p_file_id)
  )
$$;

comment on function public.prof_can_see_file(bigint) is
  '0181. Lookup wrapper over prof_can_see_file(bigint,text). Correct for rows '
  'that EXIST; it cannot answer for a row being created, which is why the '
  'project_files_read policy calls the 2-arg form with the row''s columns.';

revoke all on function public.prof_can_see_file(bigint, text) from public;
grant execute on function public.prof_can_see_file(bigint, text) to anon, authenticated;

-- §3 — the policy now hands the rule the row's own columns.
drop policy if exists project_files_read on public.project_files;
create policy project_files_read on public.project_files
  for select using (
    public.current_user_is_project_actor()
    or public.prof_can_see_file(id, sign_request_id)
  );

comment on policy project_files_read on public.project_files is
  '0181. The prof branch reads the ROW''s id + sign_request_id, never a lookup, '
  'so `insert … returning` (PostgREST return=representation) can see the new '
  'row. Before 0181 it looked the row up and every professor upload depended on '
  'project_files_read_public — i.e. on the โครงการ being published.';
