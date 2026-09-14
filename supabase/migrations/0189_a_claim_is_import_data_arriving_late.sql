-- ============================================================
-- 0189 — a claim is IMPORT data arriving late, and must go through the import's
--        gate rather than around it.
--
-- FOUND BY REVIEW of 0188, not by a report. `claim_my_student_seat` and
-- `promote_unresolved_row` insert into `students` without `last_import_batch`,
-- and that column is the signal BOTH mirror triggers key on:
--
--   students_link_person      — `v_import := new.last_import_batch is not null`.
--                               When true, a value the REGISTRY already holds
--                               wins over the file's, and the disagreement is
--                               written to `identity_conflicts`.
--   student_insert_mirror_up  — returns early when it is non-null. When null it
--                               pushes the new row's name UP into `people`.
--
-- So a claim did the opposite of an import with the same data: it overwrote a
-- human-curated registry name with ฝ่ายวิชาการ's spelling and recorded nothing.
-- Measured on samo-dev before this migration — registry `รมิตา`, held row
-- `วรมิตา`, after the claim the registry said `วรมิตา` and
-- `identity_conflicts` was empty.
--
-- AND THE EXAMPLE IS NOT INVENTED. `653070078-2` is exactly that row in the
-- 2026-09-14 handover: the สายรหัส table spells her วรมิตา, ฝ่ายวิชาการ's table
-- spells her รมิตา, and her own kkumail is `ramita.si@` — so the file is the
-- WRONG source for that name, and the claim path was the one that would have
-- let it win.
--
-- THIS IS THE REPO'S MOST REPEATED SHAPE (class 5): a new access channel has to
-- be threaded through EVERY gate the old one used. 0188 added two new ways for
-- handover data to reach `students`, and neither passed the gate the importer
-- passes. The fix is not to restate the precedence rule inside the two RPCs —
-- that is two implementations of one rule, the class this repo pays for most —
-- it is to make the same signal true, because it IS true: the row's data came
-- from that import batch, and the held row has been carrying its id all along.
--
-- §2 makes `batch_id` NOT NULL so the signal cannot go missing. Absence was
-- doing real work here: a null batch_id reads as "not import data", which is
-- precisely the wrong answer for a row that exists only because an import could
-- not use it.
-- ============================================================

-- ------------------------------------------------------------
-- §1 — a held row always comes from an import, so say so in the schema
--
-- `on delete set null` was the wrong reference action for the same reason: it
-- turns "this batch was deleted" into "this was never import data", and the
-- triggers cannot tell those apart. `restrict` instead — a batch that still has
-- held rows is not deletable, which is the honest constraint. Nothing deletes
-- import batches today (there is no such call in src/js/house/api.js); this is
-- here so that a future one cannot silently flip 165 rows into the wrong branch.
-- ------------------------------------------------------------
alter table public.student_import_unresolved
  drop constraint if exists student_import_unresolved_batch_id_fkey;

-- Safe to assert: 0188 shipped today and the table is empty on both projects.
-- If a row without a batch ever exists, this raises rather than guessing one —
-- attributing a row to a batch it did not come from would be a fabricated audit
-- trail, which is worse than a failed migration.
alter table public.student_import_unresolved
  alter column batch_id set not null;

alter table public.student_import_unresolved
  add constraint student_import_unresolved_batch_id_fkey
  foreign key (batch_id) references public.student_import_batches(id) on delete restrict;

-- ------------------------------------------------------------
-- §2 — record_unresolved_rows now requires the batch it is recording for
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
  -- Checked HERE rather than left to the NOT NULL, so the message names the
  -- caller's mistake instead of a constraint. A held row's batch is what makes
  -- its data attributable, and §3 depends on it being present.
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
        or not exists (
          select 1 from public.students s
           where public.student_id_key(s.student_id) = public.student_id_key(d.student_id))
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

-- ------------------------------------------------------------
-- §3 — both writers carry the batch through to `students`
--
-- One added column on each insert, and the two triggers then behave exactly as
-- they do for the importer: the registry wins where it has a value, the
-- disagreement lands in `identity_conflicts`, and nothing is pushed up over a
-- name a human curated. Neither function restates the rule.
-- ------------------------------------------------------------
create or replace function public.claim_my_student_seat(
  p_student_id text, p_first_name text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_email text;
  v_row   public.student_import_unresolved%rowtype;
  v_new   public.students%rowtype;
begin
  if v_uid is null then raise exception 'ต้องเข้าสู่ระบบก่อน'; end if;

  select lower(btrim(email)) into v_email from public.users where id = v_uid;
  if v_email is null or v_email !~ '@kkumail\.com$' then
    raise exception 'ต้องเข้าสู่ระบบด้วยบัญชี @kkumail.com ก่อน จึงจะยืนยันตัวตนได้';
  end if;

  if exists (select 1 from public.students where lower(btrim(kkumail)) = v_email) then
    raise exception 'บัญชีนี้มีข้อมูลนักศึกษาอยู่แล้ว';
  end if;

  if public.student_id_key(p_student_id) is null or public.name_key(p_first_name) is null then
    raise exception 'กรุณากรอกทั้งรหัสนักศึกษาและชื่อจริง';
  end if;

  select * into v_row
    from public.student_import_unresolved
   where resolved_at is null
     and public.student_id_key(student_id) = public.student_id_key(p_student_id)
     and public.name_key(first_name_th)    = public.name_key(p_first_name)
   for update;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'message', 'ไม่พบรายชื่อที่ตรงกับรหัสนักศึกษาและชื่อนี้ '
                 || 'ลองตรวจตัวสะกดอีกครั้ง ถ้ายังไม่พบ แปลว่าฝ่ายข้อมูลยังไม่ได้ส่งชื่อของคุณมา '
                 || 'แจ้งได้ที่หน้าแจ้งปัญหา');
  end if;

  -- `last_import_batch` — the change 0189 exists for. The name, รหัส, สาขา and
  -- สายรหัส on this row came from that import file, so this is import data
  -- reaching `students` late, and both mirror triggers must treat it that way.
  -- Without it the file's spelling overwrote a curated registry name and no
  -- conflict was recorded.
  insert into public.students
    (kkumail, student_id, first_name_th, last_name_th,
     nickname_imported, major, sai_code, cohort_year, last_import_batch)
  values (v_email, v_row.student_id, v_row.first_name_th, v_row.last_name_th,
          v_row.nickname_imported, v_row.major, v_row.sai_code, v_row.cohort_year,
          v_row.batch_id)
  returning * into v_new;

  update public.student_import_unresolved
     set resolved_at = now(), resolved_by = v_uid,
         resolved_student = v_new.id, resolved_how = 'self_claim'
   where id = v_row.id;

  return jsonb_build_object('ok', true, 'sai', v_new.sai_code);
end;
$$;

revoke all on function public.claim_my_student_seat(text, text) from public, anon;
grant execute on function public.claim_my_student_seat(text, text) to authenticated;

create or replace function public.promote_unresolved_row(p_id uuid, p_kkumail text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_row   public.student_import_unresolved%rowtype;
  v_mail  text := lower(btrim(coalesce(p_kkumail, '')));
  v_new   public.students%rowtype;
begin
  if not (public.current_user_role() = any (array['vp_admin','dev'])
          or public.current_user_has_permission('house')) then
    raise exception 'ไม่มีสิทธิ์จัดการข้อมูลนักศึกษา';
  end if;
  if v_mail !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'รูปแบบอีเมลไม่ถูกต้อง';
  end if;
  if exists (select 1 from public.students where lower(btrim(kkumail)) = v_mail) then
    raise exception 'อีเมล % มีเจ้าของอยู่แล้วในระบบบ้าน', v_mail;
  end if;

  select * into v_row from public.student_import_unresolved
   where id = p_id and resolved_at is null for update;
  if not found then raise exception 'ไม่พบรายการค้าง หรือรายการนี้ถูกจัดการไปแล้ว'; end if;

  -- Same reason as the claim above: this is the import file's data, and the
  -- admin supplying the missing address does not make it the admin's assertion
  -- about the person's name.
  insert into public.students
    (kkumail, student_id, first_name_th, last_name_th,
     nickname_imported, major, sai_code, cohort_year, last_import_batch)
  values (v_mail, v_row.student_id, v_row.first_name_th, v_row.last_name_th,
          v_row.nickname_imported, v_row.major, v_row.sai_code, v_row.cohort_year,
          v_row.batch_id)
  returning * into v_new;

  update public.student_import_unresolved
     set resolved_at = now(), resolved_by = auth.uid(),
         resolved_student = v_new.id, resolved_how = 'admin'
   where id = v_row.id;

  return jsonb_build_object('ok', true, 'student', v_new.id);
end;
$$;

revoke all on function public.promote_unresolved_row(uuid, text) from public, anon;
grant execute on function public.promote_unresolved_row(uuid, text) to authenticated;
