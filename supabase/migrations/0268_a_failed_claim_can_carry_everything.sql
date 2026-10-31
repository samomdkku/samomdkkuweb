-- ============================================================
-- 0268 — a failed claim can carry EVERYTHING, สาย included, for an admin to check.
--
-- OWNER, 2026-10-31, reading คนที่ยืนยันตัวตนไม่ผ่าน (seven people, every one
-- "ไม่มีใครใกล้เคียงในรายการค้าง": three MD47/MD48, four MD51/MD54 not in the
-- file): *"these people should be able to fill all information for admin to
-- check later, fill everything including สาย, because some รุ่น
-- หัวหน้าชั้นปีส่งข้อมูลมาไม่ครบ"*.
--
-- Until now the claim form took two facts (รหัส + ชื่อ) and, on a miss, kept
-- them. That is enough to MATCH a typo against the held list; it is not enough
-- to ADD somebody the file never named — the admin had to go and find นามสกุล
-- and สาย elsewhere, which is the "back to ฝ่ายข้อมูล" rung of
-- docs/HOUSE-DATA-REPAIR.md §5. The person stuck has those facts. Ask them.
--
-- WHAT THIS DOES NOT CHANGE — the two properties the claim was built around:
--   1. NO MEMBERSHIP ORACLE. submit_my_house_details never reads the held list
--      or `students` beyond "does THIS account already have a row". Its answer
--      is the same whatever the file holds. (The miss message the claim returns
--      is still one sentence for every miss.)
--   2. A STUDENT NEVER SETS THEIR OWN สาย. What they type is a STATEMENT, stored
--      on the request; it reaches `students` only when an admin saves it through
--      the ordinary add-student path, which RLS already governs. สาย decides
--      บ้าน — it is the one field with a reason to lie about (§2 of the doc).
--
-- AND ONE CLOSE FOR EVERY DOOR. A request used to be closed by whichever path
-- added the person remembering to (claim, promote_unresolved_row); an admin
-- adding them by hand, or a re-import, left it open for ever — a worklist of
-- solved problems is a worklist nobody reads. The trigger below closes it from
-- the TABLE, on any insert or address change that gives that kkumail a row.
-- ============================================================

-- §1 — what the person says about themselves, verbatim
alter table public.house_help_requests
  add column if not exists typed_last_name text,
  add column if not exists typed_nickname  text,
  add column if not exists typed_major     text,
  add column if not exists typed_sai_code  text,
  add column if not exists details_at      timestamptz;

-- §2 — the miss message names the next step, still one sentence for every miss
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
    insert into public.house_help_requests
      (kkumail, kind, typed_student_id, typed_first_name)
    values (v_email, 'no_record', btrim(p_student_id), btrim(p_first_name))
    on conflict (kkumail) do update
      set kind             = 'no_record',
          typed_student_id = excluded.typed_student_id,
          typed_first_name = excluded.typed_first_name,
          attempts         = public.house_help_requests.attempts + 1,
          resolved_at      = null,
          resolved_by      = null,
          resolved_how     = null;

    -- 0268: the SAME sentence for every miss (the anti-enumeration property),
    -- now naming what to do: fill in the rest, and ask the class head to
    -- confirm it in the sheet. `details` tells the card to open that form.
    return jsonb_build_object(
      'ok', false,
      'details', true,
      'message', 'ไม่พบข้อมูลของคุณในข้อมูลที่หัวหน้าชั้นปีของรุ่นส่งมา '
                 || '(ถ้าพิมพ์ผิด แก้แล้วกดยืนยันอีกครั้งได้) — กรอกข้อมูลที่เหลือด้านล่างให้ครบ '
                 || 'แล้วรบกวนแจ้งหัวหน้าชั้นปีและผู้ที่เกี่ยวข้องให้กรอกข้อมูลของคุณใน sheet '
                 || 'ที่ผู้ดูแลระบบส่งให้แต่ละชั้นปีแล้ว เพื่อยืนยันว่าสายรหัสที่คุณกรอกเป็นข้อมูลจริง');
  end if;

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

  -- (The trigger in §5 has already closed their request, as 'claimed'. Kept
  -- as a no-op guard so this function does not depend on the trigger existing.)
  update public.house_help_requests
     set resolved_at = now(), resolved_by = v_uid, resolved_how = 'claimed'
   where kkumail = v_email and resolved_at is null;

  return jsonb_build_object('ok', true, 'sai', v_new.sai_code);
end;
$$;

revoke all on function public.claim_my_student_seat(text, text) from public, anon;
grant execute on function public.claim_my_student_seat(text, text) to authenticated;

-- §3 — the person hands over everything they know
create or replace function public.submit_my_house_details(
  p_student_id text, p_first_name text, p_last_name text,
  p_nickname text, p_major text, p_sai_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_email text;
  v_sai   text := regexp_replace(coalesce(p_sai_code, ''), '\D', '', 'g');
  v_first text := nullif(btrim(coalesce(p_first_name, '')), '');
  v_last  text := nullif(btrim(coalesce(p_last_name, '')), '');
  v_nick  text := nullif(btrim(coalesce(p_nickname, '')), '');
  v_major text := nullif(btrim(coalesce(p_major, '')), '');
begin
  if v_uid is null then raise exception 'ต้องเข้าสู่ระบบก่อน'; end if;
  select lower(btrim(email)) into v_email from public.users where id = v_uid;
  if v_email is null or v_email !~ '@kkumail\.com$' then
    raise exception 'ต้องเข้าสู่ระบบด้วยบัญชี @kkumail.com ก่อน';
  end if;
  -- The one read of `students`, and it is about the CALLER: a person who
  -- already has a record fixes it on their card, not here.
  if exists (select 1 from public.students where lower(btrim(kkumail)) = v_email) then
    raise exception 'บัญชีนี้มีข้อมูลนักศึกษาอยู่แล้ว';
  end if;

  if public.student_id_key(p_student_id) is null then raise exception 'กรอกรหัสนักศึกษา'; end if;
  if public.name_key(v_first) is null then raise exception 'กรอกชื่อจริง'; end if;
  if v_last is null then raise exception 'กรอกนามสกุล'; end if;
  if v_sai = '' or length(v_sai) > 3 or v_sai ~ '^0+$' then
    raise exception 'สายรหัสต้องเป็นตัวเลข 1–3 หลัก (001–999)';
  end if;
  if length(v_first) > 80 or length(v_last) > 80 or length(coalesce(v_nick, '')) > 40
     or length(coalesce(v_major, '')) > 40 or length(btrim(p_student_id)) > 20 then
    raise exception 'ข้อมูลยาวเกินไป';
  end if;

  insert into public.house_help_requests
    (kkumail, kind, typed_student_id, typed_first_name, typed_last_name,
     typed_nickname, typed_major, typed_sai_code, details_at)
  values (v_email, 'no_record', btrim(p_student_id), v_first, v_last,
          v_nick, v_major, lpad(v_sai, 3, '0'), now())
  on conflict (kkumail) do update
    set kind             = 'no_record',
        typed_student_id = excluded.typed_student_id,
        typed_first_name = excluded.typed_first_name,
        typed_last_name  = excluded.typed_last_name,
        typed_nickname   = excluded.typed_nickname,
        typed_major      = excluded.typed_major,
        typed_sai_code   = excluded.typed_sai_code,
        details_at       = excluded.details_at,
        student_ref      = null,
        -- new information reopens a request an admin had closed
        resolved_at      = null,
        resolved_by      = null,
        resolved_how     = null;

  return public.my_house_help_status();
end;
$$;

revoke all on function public.submit_my_house_details(text, text, text, text, text, text) from public, anon;
grant execute on function public.submit_my_house_details(text, text, text, text, text, text) to authenticated;

-- §4 — the receipt shows the person what THEY sent (theirs, so no oracle)
create or replace function public.my_house_help_status()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_email text;
  r       public.house_help_requests%rowtype;
begin
  if v_uid is null then return null; end if;
  select lower(btrim(email)) into v_email from public.users where id = v_uid;
  if v_email is null or length(v_email) = 0 then return null; end if;

  select * into r from public.house_help_requests
   where kkumail = v_email and resolved_at is null;
  if not found then return null; end if;

  -- Still NOT returned: candidates or anything about the held list (0192).
  -- The typed_* fields are the caller's own words, read back to them.
  return jsonb_build_object(
    'kind',       r.kind,
    'created_at', r.created_at,
    'updated_at', r.updated_at,
    'attempts',   r.attempts,
    'waiting_days', extract(day from now() - r.created_at)::int,
    'details_at', r.details_at,
    'typed', jsonb_build_object(
      'student_id', r.typed_student_id, 'first_name', r.typed_first_name,
      'last_name', r.typed_last_name, 'nickname', r.typed_nickname,
      'major', r.typed_major, 'sai_code', r.typed_sai_code));
end;
$$;

-- §5 — any path that gives this address a record closes its request
create or replace function public.close_help_request_on_student()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_mail text := lower(btrim(coalesce(new.kkumail, '')));
  v_by   text;
begin
  if v_mail = '' then return new; end if;
  if tg_op = 'UPDATE' and lower(btrim(coalesce(old.kkumail, ''))) = v_mail then return new; end if;
  select lower(btrim(email)) into v_by from public.users where id = auth.uid();
  update public.house_help_requests
     set resolved_at  = now(),
         resolved_by  = auth.uid(),
         resolved_how = case when v_by = v_mail then 'claimed' else 'admin' end
   where kkumail = v_mail and kind = 'no_record' and resolved_at is null;
  return new;
end;
$$;

revoke all on function public.close_help_request_on_student() from public, anon, authenticated;

drop trigger if exists students_close_help_request on public.students;
create trigger students_close_help_request
  after insert or update of kkumail on public.students
  for each row execute function public.close_help_request_on_student();

-- §6 — the admin's list carries what was submitted
create or replace function public.list_house_help_requests(
  p_include_resolved boolean default false)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.current_user_role() = any (array['vp_admin','dev'])
          or public.current_user_has_permission('house')) then
    raise exception 'ไม่มีสิทธิ์ดูรายการนี้';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', r.id,
             'kkumail', r.kkumail,
             'kind', r.kind,
             'typed_student_id', r.typed_student_id,
             'typed_first_name', r.typed_first_name,
             'typed_last_name', r.typed_last_name,
             'typed_nickname', r.typed_nickname,
             'typed_major', r.typed_major,
             'typed_sai_code', r.typed_sai_code,
             'details_at', r.details_at,
             'note', r.note,
             'attempts', r.attempts,
             'waiting_days', extract(day from now() - r.created_at)::int,
             'created_at', r.created_at,
             'resolved_at', r.resolved_at,
             'resolved_how', r.resolved_how,
             'showing', (select jsonb_build_object(
                                  'name', concat_ws(' ', st.first_name_th, st.last_name_th),
                                  'student_id', st.student_id, 'sai', st.sai_code)
                           from public.students st where st.id = r.student_ref),
             'candidates', coalesce((
               select jsonb_agg(jsonb_build_object(
                        'id', u.id,
                        'name', concat_ws(' ', u.first_name_th, u.last_name_th),
                        'student_id', u.student_id,
                        'sai', u.sai_code,
                        'matched', case
                          when public.student_id_key(u.student_id)
                               = public.student_id_key(r.typed_student_id) then 'รหัสตรง ชื่อไม่ตรง'
                          else 'ชื่อตรง รหัสไม่ตรง' end))
                 from public.student_import_unresolved u
                where u.resolved_at is null
                  and (public.student_id_key(u.student_id)
                         = public.student_id_key(r.typed_student_id)
                    or public.name_key(u.first_name_th)
                         = public.name_key(r.typed_first_name))), '[]'::jsonb))
             order by r.resolved_at nulls first, r.created_at)
      from public.house_help_requests r
     where p_include_resolved or r.resolved_at is null
  ), '[]'::jsonb);
end;
$$;
