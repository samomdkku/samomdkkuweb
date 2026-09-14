-- ============================================================
-- 0188 — a student the file cannot name
--
-- REPORTED (2026-09-14): the ฝ่ายข้อมูล handover for ระบบบ้าน arrived with 165
-- of its 1,776 rows carrying no kkumail — 111 of them the whole of รุ่น 66. The
-- importer SKIPS those rows, correctly: `students.kkumail` is NOT NULL and is
-- the conflict target of the upsert, so a row without one cannot exist in the
-- table at all. But skipping is where it ended. The rows were listed in a
-- preview pane and then gone — 165 people's ชื่อ, รหัสนักศึกษา and สายรหัส,
-- sent to us by the faculty, thrown away by us. A student in that set signs in
-- and reads "ยังไม่มีข้อมูลของคุณในระบบบ้าน — แจ้งได้ที่ VitalSound", which is a
-- ticket queue standing in for a missing feature.
--
-- WHAT THIS IS NOT. It is not a `status` column. 0120 dropped `students.status`
-- because an enum nobody supplies is decoration, and that decision stands: this
-- table holds no opinion about whether a person ลาออก, ซ้ำชั้น or was simply
-- never found by ฝ่ายวิชาการ's lookup. It records ONE fact, the only one we
-- actually have — **the file named this seat and could not name a login for
-- it** — plus who resolved it and how. "ค้างมา 8 เดือน" is then a real answer
-- to "did this person leave", derived from evidence rather than from an
-- unfilled dropdown.
--
-- WHY NOT A PLACEHOLDER kkumail IN `students`. Because a synthetic identity is
-- indistinguishable from a real one the moment it is written. `unknown-141@…`
-- would satisfy every NOT NULL, join to no login, and look exactly like a
-- student whose address we simply have — and the repo has paid for this shape
-- before (a sentinel is not a value). The row that cannot be a student is not
-- stored AS a student.
--
-- THE THREE WAYS OUT, in the order they actually happen:
--   1. ฝ่ายข้อมูล sends the address → the next import names them, and
--      `record_unresolved_rows` drops the held row on its own.
--   2. THE STUDENT CLAIMS IT. They are signed in with a kkumail Google has
--      already verified; what is missing is only the link between that address
--      and the seat. They supply their รหัสนักศึกษา and their ชื่อ, and
--      `claim_my_student_seat` makes the row. This is the path that scales:
--      the student is the one person who certainly knows both facts.
--   3. An admin fills the address in by hand (`promote_unresolved_row`), for
--      the 13 rows that have no รหัสนักศึกษา either and so can never be
--      self-claimed.
-- ============================================================

-- ------------------------------------------------------------
-- §1 — the table
-- ------------------------------------------------------------
create table if not exists public.student_import_unresolved (
  id            uuid primary key default gen_random_uuid(),
  batch_id      uuid references public.student_import_batches(id) on delete set null,
  source_line   integer,

  -- What the file said, after cleaning and NOTHING else. No value here is
  -- derived, guessed or filled in from another table: this is the evidence, and
  -- a reader has to be able to tell it apart from a repair.
  student_id        text,
  first_name_th     text,
  last_name_th      text,
  nickname_imported text,
  major             text,
  sai_code          text references public.sais(code),
  -- Carried explicitly rather than derived. `students.cohort_year` comes from
  -- cohort_from_student_id(), which needs a รหัสนักศึกษา — and 13 of these rows
  -- have none. The handover file states the รุ่น as a block heading, so for
  -- exactly the rows that cannot derive it, the file is the only source there is.
  cohort_year   smallint,

  reason        text not null
                check (reason in ('no_kkumail','no_kkumail_no_student_id',
                                  'duplicate_kkumail','empty_row')),
  note          text,

  resolved_at      timestamptz,
  resolved_by      uuid references auth.users(id) on delete set null,
  resolved_student uuid references public.students(id) on delete set null,
  resolved_how     text check (resolved_how in ('self_claim','admin','import','dismissed')),

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- The natural key of an OPEN row, and the reason it is partial.
--
-- A รหัสนักศึกษา identifies a person; two open rows for one รหัส would mean two
-- seats for one student and would make the self-claim ambiguous — which row does
-- it consume? So รหัส is unique among open rows, and only among open rows: once
-- resolved, a row is history and a later file may legitimately raise the same
-- person again (they moved cohort, their address changed back to absent).
-- The 13 rows with no รหัส are excluded rather than squeezed into a synthetic
-- key; they are resolvable only by a human, who is looking at the list anyway.
create unique index if not exists student_import_unresolved_open_sid
  on public.student_import_unresolved (student_id)
  where resolved_at is null and student_id is not null;

create index if not exists student_import_unresolved_open
  on public.student_import_unresolved (resolved_at, cohort_year, sai_code);

drop trigger if exists touch_student_import_unresolved on public.student_import_unresolved;
create trigger touch_student_import_unresolved
  before update on public.student_import_unresolved
  for each row execute function public.touch_house_updated_at();

alter table public.student_import_unresolved enable row level security;

-- ⛔ REVOKE FROM anon EXPLICITLY, AND DO NOT ASSUME A NEW TABLE IS CLOSED.
-- This project carries a `pg_default_acl` on schema `public` granting anon and
-- authenticated `arwdDxtm` — ALL privileges, insert and delete included — on
-- every table created here. So a `create table` is born anon-writable, and RLS
-- being ON is the only thing between that grant and the rows. Every other
-- ระบบบ้าน table (students, sais, student_import_batches, houses, advisors,
-- sai_advisors, student_change_requests, people) has anon revoked; the first
-- draft of this one did not, and house0188-unresolved-seat.sql §03 is what said
-- so. It is 0182's finding in the other schema — a property that is written per
-- object and therefore missed per object — so the assertion is in the proof,
-- where a future table cannot quietly skip it.
revoke all on public.student_import_unresolved from anon;

-- Same gate as every other ระบบบ้าน admin table. The rows are 165 real
-- students' ชื่อ, รหัสนักศึกษา and สายรหัส; there is deliberately NO read policy
-- for `authenticated`, so the student-facing path below cannot be turned into a
-- directory by anyone who works out the table name. `claim_my_student_seat` is
-- SECURITY DEFINER and answers one question about one row the caller already
-- named — it never returns a list.
drop policy if exists student_import_unresolved_admin_all on public.student_import_unresolved;
create policy student_import_unresolved_admin_all on public.student_import_unresolved
  for all to authenticated
  using (public.current_user_role() = any (array['vp_admin','dev'])
         or public.current_user_has_permission('house'))
  with check (public.current_user_role() = any (array['vp_admin','dev'])
              or public.current_user_has_permission('house'));

-- ------------------------------------------------------------
-- §2 — comparison helpers, defined ONCE
--
-- Both the claim and the import reconciliation ask "is this the same รหัส" and
-- "is this the same ชื่อ". Two implementations of one comparison is the class
-- this repo pays for most often, so both live here and every caller below goes
-- through them.
-- ------------------------------------------------------------

-- A รหัสนักศึกษา with its dashes and spaces removed. `653070071-6`,
-- `6530700716` and ` 653070071 - 6 ` are one person, and the handover spec says
-- so out loud ("ใส่ขีดหรือไม่ใส่ขีดก็ได้").
create or replace function public.student_id_key(p text)
returns text language sql immutable as $$
  select nullif(regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g'), '')
$$;

-- A ชื่อ reduced to what two people typing the same name will agree on: no
-- spaces, no คำนำหน้า, case-folded. It is NOT a fuzzy match — one wrong letter
-- still fails, which is the point. It exists so that "กันต์ปภัส" and
-- "นางสาวกันต์ปภัส" (both spellings are in the 2026-09-14 file) are one name.
create or replace function public.name_key(p text)
returns text language sql immutable as $$
  select nullif(lower(regexp_replace(
           regexp_replace(coalesce(p, ''),
             '^(นางสาว|น\.ส\.|นาง|นาย|ด\.ช\.|ด\.ญ\.|เด็กชาย|เด็กหญิง)', ''),
           '\s+', '', 'g')), '')
$$;

-- ------------------------------------------------------------
-- §3 — the import writes what it could not use
--
-- REPLACE, not append. "Unresolved" is a statement about the NEWEST file, not a
-- log: if the next handover names somebody, the held row must disappear without
-- anyone remembering to close it. Resolved rows are never touched — they are
-- the audit trail of who was let in and by whom.
--
-- THE LEAK THIS CLOSES. A student who self-claims is in `students` with the
-- address they signed in with, and the file STILL does not have that address —
-- so the next import would hold them again, for ever, and every import after
-- that would re-ask a question already answered. Any row whose รหัสนักศึกษา
-- already belongs to a student is therefore dropped on the way in, silently and
-- by construction, rather than by a rule someone has to remember.
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
      coalesce(nullif(btrim(r->>'reason'), ''), 'no_kkumail') as reason,
      nullif(r->>'source_line', '')::integer     as source_line
      from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) as r
  ), ranked as (
    -- One open row per รหัส, enforced here as well as by the index: a file that
    -- lists somebody twice must not fail the whole import on a unique violation.
    -- Rows with NO รหัส are outside the index and must all survive, so they are
    -- partitioned by their own line number rather than folded together.
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
-- §4 — the student claims their own seat
--
-- WHAT IS BEING PROVED, AND WHAT IS NOT. The address is NOT being proved — that
-- already happened, at Google, before this function can run: `auth.uid()` is a
-- kkumail Google signed. What the caller must prove is that the SEAT is theirs,
-- and the proof is two facts from the handover file: the รหัสนักศึกษา and the
-- ชื่อจริง on that row.
--
-- WHY TWO AND NOT ONE. A รหัสนักศึกษา alone is a 300-wide space per รุ่น behind
-- a known prefix — enumerable in an afternoon, and a claimed seat is a place in
-- someone else's บ้าน under someone else's name. Requiring the name as well
-- means an attacker must already know who they are targeting, which is the point
-- at which no automated check helps and the audit trail is the answer instead.
--
-- WHY NOT A RATE LIMIT TABLE. Three properties make one redundant here, and
-- each is load-bearing: the caller must hold a verified @kkumail.com; a claim
-- can only ever be made ONCE per account (a caller who already has a student row
-- is refused before the lookup); and every claim is stamped with `resolved_by`
-- and shown in the admin pane. A wrong claim is visible and reversible, and the
-- real student noticing they cannot claim is itself the alarm.
--
-- WHAT A FAILURE MAY SAY. Nothing that distinguishes "no such รหัส is held"
-- from "that รหัส is held but the ชื่อ does not match" — otherwise the function
-- confirms membership one guess at a time, which is the directory this table has
-- no read policy in order to avoid.
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
  -- ระบบบ้าน matches a person to their record on kkumail and nothing else
  -- (get_my_student_record joins on it). A claim from any other address would
  -- write a row its own owner could never read.
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
    -- Deliberately one message for both misses. See the header.
    return jsonb_build_object(
      'ok', false,
      'message', 'ไม่พบรายชื่อที่ตรงกับรหัสนักศึกษาและชื่อนี้ '
                 || 'ลองตรวจตัวสะกดอีกครั้ง ถ้ายังไม่พบ แปลว่าฝ่ายข้อมูลยังไม่ได้ส่งชื่อของคุณมา '
                 || 'แจ้งได้ที่หน้าแจ้งปัญหา');
  end if;

  -- The row is written with the CALLER's address — the one fact the file did
  -- not have and the one fact the caller has already proved.
  insert into public.students
    (kkumail, student_id, first_name_th, last_name_th,
     nickname_imported, major, sai_code, cohort_year)
  values (v_email, v_row.student_id, v_row.first_name_th, v_row.last_name_th,
          v_row.nickname_imported, v_row.major, v_row.sai_code, v_row.cohort_year)
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

-- ------------------------------------------------------------
-- §5 — an admin fills in the address by hand
--
-- For the 13 rows of the 2026-09-14 file that carry no รหัสนักศึกษา at all and
-- so can never be self-claimed, and for anyone whose address arrives by other
-- means. Same write as the claim, different proof: the admin's own grant.
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
  -- Said HERE rather than left to the unique index, because the index reports
  -- `students_kkumail_key` and an admin's next move depends on WHOSE address it
  -- already is — the same reason the create form looks the person up (0138).
  if exists (select 1 from public.students where lower(btrim(kkumail)) = v_mail) then
    raise exception 'อีเมล % มีเจ้าของอยู่แล้วในระบบบ้าน', v_mail;
  end if;

  select * into v_row from public.student_import_unresolved
   where id = p_id and resolved_at is null for update;
  if not found then raise exception 'ไม่พบรายการค้าง หรือรายการนี้ถูกจัดการไปแล้ว'; end if;

  insert into public.students
    (kkumail, student_id, first_name_th, last_name_th,
     nickname_imported, major, sai_code, cohort_year)
  values (v_mail, v_row.student_id, v_row.first_name_th, v_row.last_name_th,
          v_row.nickname_imported, v_row.major, v_row.sai_code, v_row.cohort_year)
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

-- Closing a row WITHOUT creating a student: the person ลาออก, ซ้ำชั้น, or was
-- never a student here. It carries no enum — `note` is free text written by
-- whoever knows, which is the honest shape for a fact the system cannot verify.
create or replace function public.dismiss_unresolved_row(p_id uuid, p_note text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not (public.current_user_role() = any (array['vp_admin','dev'])
          or public.current_user_has_permission('house')) then
    raise exception 'ไม่มีสิทธิ์จัดการข้อมูลนักศึกษา';
  end if;
  if nullif(btrim(coalesce(p_note, '')), '') is null then
    -- A dismissal with no reason is indistinguishable from a mis-click a month
    -- later, and this row is the only record that the person was ever sent to us.
    raise exception 'กรุณาระบุเหตุผลที่ปิดรายการนี้';
  end if;
  update public.student_import_unresolved
     set resolved_at = now(), resolved_by = auth.uid(),
         resolved_how = 'dismissed', note = btrim(p_note)
   where id = p_id and resolved_at is null;
  if not found then raise exception 'ไม่พบรายการค้าง หรือรายการนี้ถูกจัดการไปแล้ว'; end if;
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.dismiss_unresolved_row(uuid, text) from public, anon;
grant execute on function public.dismiss_unresolved_row(uuid, text) to authenticated;

-- ------------------------------------------------------------
-- §6 — what the admin pane reads
--
-- An RPC rather than a view because the pane needs the two numbers that make
-- the list actionable — how long a row has been held, and whether the person
-- can ever self-claim — and both are derived.
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
             -- Only a row with a รหัสนักศึกษา can ever be self-claimed. The pane
             -- sorts on this: the rows WITHOUT one are the admin's actual
             -- worklist, because nobody else can close them.
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

revoke all on function public.list_unresolved_rows(boolean) from public, anon;
grant execute on function public.list_unresolved_rows(boolean) to authenticated;
