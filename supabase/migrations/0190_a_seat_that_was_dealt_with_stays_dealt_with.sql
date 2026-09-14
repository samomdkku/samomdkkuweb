-- ============================================================
-- 0190 — a seat that has been dealt with stays dealt with.
--
-- FOUND BY THE PROOF, one migration late. `record_unresolved_rows` drops an
-- incoming held row when a STUDENT already exists with that รหัสนักศึกษา — that
-- is what stops a self-claimed student, whose address the file still does not
-- have, from being re-held on every import for ever (0188 §3).
--
-- It asks the wrong question by ONE HOP. What it needs to know is "has this seat
-- been dealt with"; what it actually asks is "does a student carry this รหัส".
-- Those came apart the moment 0189 landed: the registry now wins on
-- `student_id`, so a claimer whose `people` row carries a DIFFERENT รหัส gets a
-- student row under the registry's number — no student carries the held row's
-- รหัส, the lookup finds nothing, and the seat they just claimed comes straight
-- back into the held list on the next import. Measured on samo-dev: §50 of
-- house0188-unresolved-seat.sql went red the run after 0189 applied.
--
-- The seat is not "not dealt with". It is dealt with, by that person, and the
-- row recording that is sitting in the same table with `resolved_at` set. So ask
-- IT — the resolution is the fact, and the student's รหัส was only ever a proxy
-- for it.
--
-- ANY resolution counts, not just a claim. A dismissal is an answer too ("ลาออก",
-- "ซ้ำชั้น"), and re-raising it next month re-asks a question a human already
-- answered, with no new information to justify it — the faculty sending the same
-- nameless row again is not news. If circumstances change, the person arrives
-- with an address and imports normally, which never touches this path.
-- ============================================================
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
  if p_batch is null then
    raise exception 'ต้องระบุรอบการนำเข้า (batch) ของรายชื่อที่ค้าง';
  end if;
  if not exists (select 1 from public.student_import_batches where id = p_batch) then
    raise exception 'ไม่พบรอบการนำเข้านี้';
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
    select * from deduped d
     where d.student_id is null
        or (
          -- (a) somebody is already in ระบบบ้าน under this รหัส …
          not exists (
            select 1 from public.students s
             where public.student_id_key(s.student_id) = public.student_id_key(d.student_id))
          -- … and (b) this seat has not already been answered. 0190: (a) alone
          -- was the whole test, and it stopped covering a claim the moment the
          -- registry was allowed to win on `student_id` (0189).
          and not exists (
            select 1 from public.student_import_unresolved u
             where u.resolved_at is not null
               and public.student_id_key(u.student_id) = public.student_id_key(d.student_id))
        )
  ), ins as (
    insert into public.student_import_unresolved
      (batch_id, source_line, student_id, first_name_th, last_name_th,
       nickname_imported, major, sai_code, cohort_year, reason)
    select p_batch, source_line, student_id, first_name_th, last_name_th,
           nickname_imported, major, sai_code, cohort_year, reason
      from fresh
    returning 1
  )
  select (select count(*) from ins),
         (select count(*) from deduped) - (select count(*) from fresh)
    into v_kept, v_already;

  return jsonb_build_object('held', v_kept, 'already_in_system', v_already);
end;
$$;

revoke all on function public.record_unresolved_rows(uuid, jsonb) from public, anon;
grant execute on function public.record_unresolved_rows(uuid, jsonb) to authenticated;
