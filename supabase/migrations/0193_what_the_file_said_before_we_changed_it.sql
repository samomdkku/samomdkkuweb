-- ============================================================
-- 0193 — what the file said before we changed it
--
-- REPORTED (2026-09-14, the owner, reading the import plan): *"i think you've
-- change like blank someone kkumail because it fill in gmail. change someone
-- name, for the people who doesn't have each name surname studentid kkumail sai
-- or two of it or three or ... i want you to import it the best way that no data
-- loss."*
--
-- THE GAP, and it is real. 0188's table carries this promise in its own header:
-- *"What the file said, after cleaning and NOTHING else. No value here is
-- derived, guessed or filled in from another table: this is the evidence, and a
-- reader has to be able to tell it apart from a repair."* Two kinds of row break
-- it, and both are rows an ADMIN — nobody else — has to resolve:
--
--   1. AN ADDRESS THE CLEANER REMOVED. `tools/clean-house-csv.mjs` blanks an
--      address that provably belongs to somebody else (line 114 carried
--      `thatpicha.k@kkumail.com`, which is 643070034-1's) or that is not a
--      kkumail at all (line 707, a real working `@gmail.com`). Blanking is
--      right — importing either one creates a student row nobody can ever sign
--      in as. But the held row then says `ไม่มี kkumail`, which is not what the
--      file said, and the ONE lead an admin could act on (an address that
--      reaches that person TODAY) exists only in a generated report in a
--      gitignored folder on one laptop.
--
--   2. THE รุ่น OF A ROW WITH NO รหัสนักศึกษา. 11 rows have neither an address
--      nor a รหัส, so `cohort_from_student_id()` has nothing to read and
--      `cohort_year` is null — and those are exactly the rows that can never be
--      self-claimed, so an admin must identify the person by hand. สาย numbers
--      RESTART every รุ่น (สาย 131 exists six times over), so a name and a สาย
--      do not locate anybody. The file states the รุ่น as a block heading.
--
-- WHY NOT WRITE THE รุ่น INTO `cohort_year`. Because 0188 refused that on
-- purpose, and the refusal is right: `cohort_year` is derived from the
-- รหัสนักศึกษา through the same function the database uses, and a value read off
-- whichever block heading a row happens to sit under is a different KIND of
-- fact that no later reader could tell apart from the derived one. So it goes
-- into a text column that is obviously a quotation, beside the address, and
-- `cohort_year` keeps meaning exactly what it has always meant.
--
-- WHAT THESE TWO COLUMNS ARE. Evidence, in the file's own words, written only by
-- the importer and read only by a human. Nothing branches on them: no policy, no
-- claim, no promote, no diff. If a future reader is tempted to make one of them
-- load-bearing, the answer is that `file_kkumail` is an address we have ALREADY
-- decided is not this person's login — that is why it is here rather than in
-- `students`.
-- ============================================================

-- ------------------------------------------------------------
-- §1 — the columns
-- ------------------------------------------------------------
alter table public.student_import_unresolved
  add column if not exists file_kkumail text,
  add column if not exists file_note    text;

comment on column public.student_import_unresolved.file_kkumail is
  'The address cell EXACTLY as the handover file had it, kept only when the '
  'cleaner removed it (it belongs to someone else, or it is not a kkumail). '
  'Evidence, never an identity: this address is already known NOT to be this '
  'person''s login, which is why the row is held. Nothing branches on it.';

comment on column public.student_import_unresolved.file_note is
  'One sentence of what the handover file said that no other column on this row '
  'can carry — the รุ่น of a row with no รหัสนักศึกษา (read off the file''s block '
  'heading, which is why it is NOT in cohort_year), and why an address was '
  'removed. Written by the importer, read by a human, used by nothing.';

-- ------------------------------------------------------------
-- §2 — carry them in
--
-- Everything else about this function is unchanged from 0190. The two new keys
-- are read the same defensive way as the rest (`nullif(btrim(...), '')`), so an
-- older client that sends neither writes two nulls and behaves exactly as before.
-- ------------------------------------------------------------
create or replace function public.record_unresolved_rows(p_batch uuid, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_kept integer := 0;
  v_already integer := 0;
begin
  if not (public.current_user_role() = any (array['vp_admin','dev'])
          or public.current_user_has_permission('house')) then
    raise exception 'ไม่มีสิทธิ์นำเข้าข้อมูลนักศึกษา';
  end if;

  delete from public.student_import_unresolved where resolved_at is null;

  with incoming as (
    select
      nullif(btrim(r->>'student_id'), '')        as student_id,
      nullif(btrim(r->>'first_name_th'), '')     as first_name_th,
      nullif(btrim(r->>'last_name_th'), '')      as last_name_th,
      nullif(btrim(r->>'nickname_imported'), '') as nickname_imported,
      nullif(btrim(r->>'major'), '')             as major,
      nullif(btrim(r->>'sai_code'), '')          as sai_code,
      nullif(r->>'cohort_year', '')::smallint    as cohort_year,
      nullif(btrim(r->>'file_kkumail'), '')      as file_kkumail,
      nullif(btrim(r->>'file_note'), '')         as file_note,
      coalesce(nullif(btrim(r->>'reason'), ''), 'no_kkumail') as reason,
      nullif(r->>'source_line', '')::integer     as source_line
      from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) as r
  ), ranked as (
    select i.*, row_number() over (
             partition by coalesce(public.student_id_key(i.student_id),
                                   'line:' || coalesce(i.source_line::text, '?'))
             order by i.source_line nulls last) as rn
      from incoming i
  ), deduped as (
    select * from ranked where rn = 1
  ), fresh as (
    -- A row whose person is ALREADY a student is not held: the address arrived
    -- some other way (they claimed it, or an admin added them) and the file is
    -- simply behind. Counted separately so the import can say so.
    select d.* from deduped d
     where d.student_id is null
        or not exists (
             select 1 from public.students s
              where public.student_id_key(s.student_id) = public.student_id_key(d.student_id))
  ), ins as (
    insert into public.student_import_unresolved
      (batch_id, source_line, student_id, first_name_th, last_name_th,
       nickname_imported, major, sai_code, cohort_year, file_kkumail, file_note, reason)
    select p_batch, f.source_line, f.student_id, f.first_name_th, f.last_name_th,
           f.nickname_imported, f.major, f.sai_code, f.cohort_year,
           f.file_kkumail, f.file_note, f.reason
      from fresh f
    returning 1
  )
  select (select count(*) from ins),
         (select count(*) from deduped) - (select count(*) from fresh)
    into v_kept, v_already;

  return jsonb_build_object('held', v_kept, 'already_in_system', v_already);
end;
$$;

-- ------------------------------------------------------------
-- §3 — show them
--
-- The pane renders whatever this returns; a column the list does not emit does
-- not exist as far as an admin is concerned, which is how the 0188 evidence
-- promise could be broken without anyone seeing it.
-- ------------------------------------------------------------
create or replace function public.list_unresolved_rows(p_include_resolved boolean default false)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.current_user_role() = any (array['vp_admin','dev'])
          or public.current_user_has_permission('house')) then
    raise exception 'ไม่มีสิทธิ์ดูข้อมูลนักศึกษา';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', u.id,
             'student_id', u.student_id,
             'first_name_th', u.first_name_th,
             'last_name_th', u.last_name_th,
             'nickname', u.nickname_imported,
             'major', u.major,
             'sai', u.sai_code,
             'house', (select s.house_id from public.sais s where s.code = u.sai_code),
             'cohort_year', u.cohort_year,
             'reason', u.reason,
             'note', u.note,
             'file_kkumail', u.file_kkumail,
             'file_note', u.file_note,
             'claimable', u.student_id is not null and u.first_name_th is not null,
             'held_days', extract(day from now() - u.created_at)::int,
             'created_at', u.created_at,
             'resolved_at', u.resolved_at,
             'resolved_how', u.resolved_how)
             order by u.resolved_at nulls first,
                      (u.student_id is not null and u.first_name_th is not null),
                      u.cohort_year, u.sai_code)
      from public.student_import_unresolved u
     where p_include_resolved or u.resolved_at is null
  ), '[]'::jsonb);
end;
$$;
