-- ============================================================
-- 0191 — the form they already used IS the report.
--
-- OWNER, 2026-09-14: *"i dont want everything to overload on vitalsound too
-- much."* Agreed, and it is worse than a volume problem — **VitalSound is the
-- CONFIDENTIAL SERVICE DESK**. ระบบบ้าน has been sending "I cannot find my house
-- record" into the counselling queue, which is a category error in both
-- directions: the student's data problem sits behind a confidentiality model it
-- does not need, and the people staffing that desk get work that is not theirs.
--
-- WHO ACTUALLY ENDS UP THERE. Everyone the self-claim cannot serve:
--   • the held row's รหัสนักศึกษา is mistyped, so the student's real one misses
--   • their ชื่อ is mistyped in the file, same
--   • they are not in the handover file at all
--   • their row carries somebody ELSE's address, so they look absent
-- Every one of them types their รหัส and ชื่อ into the claim form, gets
-- "ไม่พบรายชื่อ", and is then asked to go and describe all of it again to a
-- different team in free text.
--
-- THE OBSERVATION THIS IS BUILT ON: **a failed claim is already a complete
-- report.** The caller is signed in, so their kkumail is verified by Google —
-- the single fact the file is missing — and they have just typed their own
-- รหัสนักศึกษา and ชื่อ. That is everything an admin needs to find them by hand.
-- Nothing more is asked of the student; the miss is simply kept instead of
-- being thrown away.
--
-- IT DOES NOT WEAKEN THE ANTI-ENUMERATION PROPERTY. The student is still told
-- the same neutral sentence for every miss — no confirmation of whether the
-- รหัส exists. What changes is only that a human can now see the attempt.
-- Silence towards the guesser, not silence towards the admin.
--
-- AND THE OTHER DIRECTION, which had no path at all. A wrong-but-valid kkumail
-- in the file means somebody signs in and sees a record that is not theirs
-- (docs/HOUSE-DATA-REPAIR.md §4 — the one case that fails OPEN). There was no
-- way to say so: `request_my_change` is "change a field on MY record", and this
-- is "none of this is mine". `report_not_my_record` is that sentence.
-- ============================================================

-- ------------------------------------------------------------
-- §1 — one open request per account
--
-- `kkumail` is the key, not a serial id, and that is the rate limit: an account
-- that tries and misses five times leaves ONE row, updated, rather than five.
-- No attempts table, no counter, no cleanup job — the shape does it.
-- ------------------------------------------------------------
create table if not exists public.house_help_requests (
  id            uuid primary key default gen_random_uuid(),
  kkumail       text not null unique,
  kind          text not null check (kind in ('no_record','not_me')),

  -- What the person typed. Kept verbatim: it is their own statement about
  -- themselves, and the whole value of this row is that an admin can compare it
  -- with the held list by eye.
  typed_student_id text,
  typed_first_name text,
  note             text,

  -- For 'not_me' — the row they are looking at and disowning.
  student_ref   uuid references public.students(id) on delete set null,

  attempts      integer not null default 1,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  resolved_at   timestamptz,
  resolved_by   uuid references auth.users(id) on delete set null,
  resolved_how  text check (resolved_how in ('claimed','admin','dismissed'))
);

create index if not exists house_help_requests_open
  on public.house_help_requests (resolved_at, created_at);

drop trigger if exists touch_house_help_requests on public.house_help_requests;
create trigger touch_house_help_requests
  before update on public.house_help_requests
  for each row execute function public.touch_house_updated_at();

alter table public.house_help_requests enable row level security;

-- ⛔ anon is revoked EXPLICITLY. A `pg_default_acl` on schema `public` grants
-- anon `arwdDxtm` on every new table here, so a `create table` is born
-- anon-writable and RLS is the only thing between that grant and the rows —
-- exactly what 0188's own table did before its proof caught it.
revoke all on public.house_help_requests from anon;

drop policy if exists house_help_requests_admin_all on public.house_help_requests;
create policy house_help_requests_admin_all on public.house_help_requests
  for all to authenticated
  using (public.current_user_role() = any (array['vp_admin','dev'])
         or public.current_user_has_permission('house'))
  with check (public.current_user_role() = any (array['vp_admin','dev'])
              or public.current_user_has_permission('house'));

-- ------------------------------------------------------------
-- §2 — a miss is recorded; a hit clears it
--
-- The `else` branch is the half that is easy to leave out and the half that
-- decides whether the list is usable. A student who mistypes their รหัส once and
-- gets it right on the second go must not stay on an admin's worklist for ever —
-- a queue that fills with problems that already solved themselves is a queue
-- nobody reads, which is the same failure as sending them to VitalSound.
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
    -- THE REPORT. Same neutral sentence back to the caller as before — this
    -- cannot become a way to test one guess at a time — but the attempt is now
    -- kept, with the one fact the handover file did not have: an address Google
    -- has already verified belongs to this person.
    insert into public.house_help_requests
      (kkumail, kind, typed_student_id, typed_first_name)
    values (v_email, 'no_record', btrim(p_student_id), btrim(p_first_name))
    on conflict (kkumail) do update
      set kind             = 'no_record',
          typed_student_id = excluded.typed_student_id,
          typed_first_name = excluded.typed_first_name,
          attempts         = public.house_help_requests.attempts + 1,
          -- A NEW attempt REOPENS a request an admin had closed. Closing it was
          -- an answer to the previous attempt; this is a new one, and the person
          -- is evidently still stuck.
          resolved_at      = null,
          resolved_by      = null,
          resolved_how     = null;

    return jsonb_build_object(
      'ok', false,
      'message', 'ยังไม่พบรายชื่อที่ตรงกับรหัสนักศึกษาและชื่อนี้ '
                 || 'ลองตรวจตัวสะกดอีกครั้ง — ถ้ากรอกถูกแล้วยังไม่พบ '
                 || 'ระบบได้แจ้งผู้ดูแลระบบบ้านให้แล้ว ไม่ต้องแจ้งซ้ำที่อื่น');
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

  -- They got in. Close anything they filed on the way.
  update public.house_help_requests
     set resolved_at = now(), resolved_by = v_uid, resolved_how = 'claimed'
   where kkumail = v_email and resolved_at is null;

  return jsonb_build_object('ok', true, 'sai', v_new.sai_code);
end;
$$;

revoke all on function public.claim_my_student_seat(text, text) from public, anon;
grant execute on function public.claim_my_student_seat(text, text) to authenticated;

-- ------------------------------------------------------------
-- §3 — "this record is not mine"
--
-- The only path for the case that fails OPEN. It deliberately does NOT let the
-- caller change or delete anything: a person looking at a stranger's record must
-- not be able to act on it, and the person who owns that address may yet turn
-- out to be the rightful owner after all. It files a sentence and stops.
-- ------------------------------------------------------------
create or replace function public.report_not_my_record(p_note text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_email text;
  s       public.students%rowtype;
begin
  if v_uid is null then raise exception 'ต้องเข้าสู่ระบบก่อน'; end if;
  select lower(btrim(email)) into v_email from public.users where id = v_uid;
  if v_email is null then raise exception 'บัญชีนี้ไม่มีอีเมล'; end if;

  select * into s from public.students where lower(btrim(kkumail)) = v_email;
  if not found then raise exception 'บัญชีนี้ยังไม่มีข้อมูลนักศึกษา'; end if;

  insert into public.house_help_requests
    (kkumail, kind, student_ref, note)
  values (v_email, 'not_me', s.id, nullif(btrim(coalesce(p_note, '')), ''))
  on conflict (kkumail) do update
    set kind         = 'not_me',
        student_ref  = excluded.student_ref,
        note         = excluded.note,
        attempts     = public.house_help_requests.attempts + 1,
        resolved_at  = null, resolved_by = null, resolved_how = null;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.report_not_my_record(text) from public, anon;
grant execute on function public.report_not_my_record(text) to authenticated;

-- ------------------------------------------------------------
-- §4 — what the admin reads
--
-- It returns CANDIDATES, not just complaints. The admin's actual job is
-- matching a person to a seat, and every fact needed to guess the match is
-- already in the database: the held rows whose รหัส OR whose ชื่อ agrees with
-- what this person typed. A list that made someone re-derive that by eye, 165
-- rows at a time, would be a worklist in name only.
-- ------------------------------------------------------------
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
             'note', r.note,
             'attempts', r.attempts,
             'waiting_days', extract(day from now() - r.created_at)::int,
             'created_at', r.created_at,
             'resolved_at', r.resolved_at,
             'resolved_how', r.resolved_how,
             -- For a 'not_me' report: whose record they are actually looking at.
             'showing', (select jsonb_build_object(
                                  'name', concat_ws(' ', st.first_name_th, st.last_name_th),
                                  'student_id', st.student_id, 'sai', st.sai_code)
                           from public.students st where st.id = r.student_ref),
             -- For a 'no_record' report: held seats that agree on EITHER half of
             -- what they typed. A row agreeing on both would have been claimed,
             -- so every candidate here is a near miss — which is exactly the
             -- shape of a typo in the handover file.
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

revoke all on function public.list_house_help_requests(boolean) from public, anon;
grant execute on function public.list_house_help_requests(boolean) to authenticated;

create or replace function public.resolve_house_help_request(p_id uuid, p_note text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not (public.current_user_role() = any (array['vp_admin','dev'])
          or public.current_user_has_permission('house')) then
    raise exception 'ไม่มีสิทธิ์จัดการรายการนี้';
  end if;
  update public.house_help_requests
     set resolved_at = now(), resolved_by = auth.uid(), resolved_how = 'dismissed',
         note = coalesce(nullif(btrim(coalesce(p_note, '')), ''), note)
   where id = p_id and resolved_at is null;
  if not found then raise exception 'ไม่พบรายการ หรือถูกจัดการไปแล้ว'; end if;
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.resolve_house_help_request(uuid, text) from public, anon;
grant execute on function public.resolve_house_help_request(uuid, text) to authenticated;

-- ------------------------------------------------------------
-- §5 — promoting a held row closes the request it answers
--
-- Without this the admin does the work and the request stays open, so the list
-- grows with items that are already done and stops being read. The join is the
-- address: the admin types the one from the request, which is the whole point of
-- the request carrying it.
-- ------------------------------------------------------------
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

  update public.house_help_requests
     set resolved_at = now(), resolved_by = auth.uid(), resolved_how = 'admin'
   where kkumail = v_mail and resolved_at is null;

  return jsonb_build_object('ok', true, 'student', v_new.id);
end;
$$;

revoke all on function public.promote_unresolved_row(uuid, text) from public, anon;
grant execute on function public.promote_unresolved_row(uuid, text) to authenticated;
