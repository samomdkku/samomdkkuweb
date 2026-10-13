-- ============================================================
-- 0217 — what ฝ่ายข้อมูล found out about a held row, kept as a fact.
--
-- REPORTED (owner, 2026-10-13): the second missing-data answer came back with
-- remarks instead of addresses — "ติดต่อไม่ได้", "คาดว่าลาออกแล้ว", "ลาออก",
-- "เลขนี้ไม่มีตัวตน" — and the owner asked for "the entire flow" for those
-- people. Until now a remark could only be free text in `note`, and the only
-- action was a generic ปิด.
--
-- FOUR OUTCOMES, and they split in two by whether the seat is still OWED:
--   unreachable  ติดต่อไม่ได้       stays HELD — still a real student, still
--   maybe_left   คาดว่าลาออกแล้ว    claimable; nobody has confirmed anything
--   left         ลาออก              CLOSES the row: nothing is owed any more
--   no_person    เลขนี้ไม่มีตัวตน     CLOSES it: the สาย has nobody on it, confirmed
-- "คาดว่า" is a guess, so it does not close: closing on a guess is how a real
-- student loses the seat they could still claim. A closed row is REOPENABLE
-- (reopen_unresolved_row) — the answer can be wrong too.
--
-- TWO DEFECTS FOUND WHILE READING THE LIVE BODIES, both fixed here because the
-- flow does not work without them:
--
-- (1) EVERY ROSTER IMPORT ERASES WHAT WE KNOW ABOUT AN OPEN ROW.
--     `record_unresolved_rows` starts with `delete … where resolved_at is null`
--     and re-inserts from the file. Any `note` an admin or this flow wrote on an
--     open row was gone on the next import — so "ติดต่อไม่ได้" would have lasted
--     exactly until the faculty sent a new file. Now carried across, keyed on
--     the รหัส, or, for a row with none, on รุ่น + สาย + ชื่อ.
--
-- (2) 0193 SILENTLY REVERTED 0190. 0193 rebuilt `record_unresolved_rows` from
--     0188's body to add two columns, and dropped 0190's second test ("has this
--     seat already been ANSWERED") and its batch checks. That is why
--     `house0188` case 53 has been red since 2026-09-21 (HANDOFF §16b): a
--     claimer whose registry รหัส differs comes back as held on the next import.
--     Restored — and extended to rows with no รหัส, which 0190 could not match
--     at all: a no-รหัส row closed as ลาออก, or an empty สาย closed as "no such
--     person", would otherwise come back on every import, re-asking a question
--     a human already answered.
-- ============================================================

alter table public.student_import_unresolved
  add column if not exists follow_up    text,
  add column if not exists follow_up_at timestamptz,
  add column if not exists follow_up_by uuid references auth.users(id) on delete set null;

alter table public.student_import_unresolved
  drop constraint if exists student_import_unresolved_follow_up_check;
alter table public.student_import_unresolved
  add constraint student_import_unresolved_follow_up_check
  check (follow_up in ('unreachable', 'maybe_left', 'left', 'no_person'));

-- A closing answer on an OPEN row would be a seat that is both owed and not.
alter table public.student_import_unresolved
  drop constraint if exists student_import_unresolved_follow_up_closes;
alter table public.student_import_unresolved
  add constraint student_import_unresolved_follow_up_closes
  check (follow_up is null or follow_up not in ('left', 'no_person') or resolved_at is not null);

comment on column public.student_import_unresolved.follow_up is
  'What ฝ่ายข้อมูล/an admin found out (0217). unreachable/maybe_left keep the row open; '
  'left/no_person close it. Labels live in src/js/house/follow-up.js.';

-- ------------------------------------------------------------
-- The identity of a held SEAT when there is no รหัส to name it: รุ่น + สาย +
-- the name the file carried, spaces removed. An empty row has no name, so its
-- key is just รุ่น + สาย — which is exactly what "this สาย has nobody" is about.
-- ------------------------------------------------------------
create or replace function public.held_seat_key(p_cohort smallint, p_sai text, p_first text, p_last text)
returns text language sql immutable as $$
  select case
    when p_cohort is null or nullif(regexp_replace(coalesce(p_sai, ''), '\D', '', 'g'), '') is null then null
    else p_cohort::text || ':'
      || lpad(regexp_replace(p_sai, '\D', '', 'g'), 3, '0') || ':'
      || regexp_replace(coalesce(p_first, '') || coalesce(p_last, ''), '\s', '', 'g')
  end
$$;

-- ------------------------------------------------------------
-- Record what was found out. Gate copied from promote/dismiss_unresolved_row.
-- ------------------------------------------------------------
create or replace function public.set_unresolved_follow_up(p_id uuid, p_status text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_row   public.student_import_unresolved%rowtype;
  v_note  text := nullif(btrim(coalesce(p_note, '')), '');
  v_close boolean := p_status in ('left', 'no_person');
begin
  if not (public.current_user_role() = any (array['vp_admin','dev'])
          or public.current_user_has_permission('house')) then
    raise exception 'ไม่มีสิทธิ์จัดการข้อมูลนักศึกษา';
  end if;
  if p_status is not null and p_status not in ('unreachable', 'maybe_left', 'left', 'no_person') then
    raise exception 'สถานะการติดตามไม่ถูกต้อง: %', p_status;
  end if;

  select * into v_row from public.student_import_unresolved where id = p_id for update;
  if not found then raise exception 'ไม่พบรายการนี้'; end if;
  if v_row.resolved_at is not null then
    raise exception 'รายการนี้ปิดไปแล้ว — กดเปิดใหม่ก่อน';
  end if;

  update public.student_import_unresolved
     set follow_up    = p_status,
         follow_up_at = case when p_status is null then null else now() end,
         follow_up_by = case when p_status is null then null else auth.uid() end,
         note         = coalesce(v_note, note),
         resolved_at  = case when v_close then now() end,
         resolved_by  = case when v_close then auth.uid() end,
         resolved_how = case when v_close then 'dismissed' end
   where id = p_id;

  return jsonb_build_object('ok', true, 'closed', v_close);
end;
$$;
revoke all on function public.set_unresolved_follow_up(uuid, text, text) from public, anon;
grant execute on function public.set_unresolved_follow_up(uuid, text, text) to authenticated;

-- ------------------------------------------------------------
-- Undo a CLOSE. Only a dismissal: a promoted or claimed row became a student,
-- and reopening it would hold a seat somebody already sits in.
-- ------------------------------------------------------------
create or replace function public.reopen_unresolved_row(p_id uuid, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_row public.student_import_unresolved%rowtype;
begin
  if not (public.current_user_role() = any (array['vp_admin','dev'])
          or public.current_user_has_permission('house')) then
    raise exception 'ไม่มีสิทธิ์จัดการข้อมูลนักศึกษา';
  end if;
  select * into v_row from public.student_import_unresolved where id = p_id for update;
  if not found then raise exception 'ไม่พบรายการนี้'; end if;
  if v_row.resolved_at is null then raise exception 'รายการนี้ยังไม่ได้ปิด'; end if;
  if v_row.resolved_how is distinct from 'dismissed' then
    raise exception 'รายการนี้กลายเป็นข้อมูลนักศึกษาแล้ว เปิดใหม่ไม่ได้';
  end if;
  -- One open seat per รหัส (student_import_unresolved_open_sid): a later file may
  -- already have raised this person again.
  if v_row.student_id is not null and exists (
       select 1 from public.student_import_unresolved u
        where u.resolved_at is null and u.id <> v_row.id
          and public.student_id_key(u.student_id) = public.student_id_key(v_row.student_id)) then
    raise exception 'มีรายการค้างของรหัสนี้อยู่แล้ว';
  end if;

  update public.student_import_unresolved
     set resolved_at = null, resolved_by = null, resolved_how = null,
         follow_up = null, follow_up_at = null, follow_up_by = null,
         note = coalesce(nullif(btrim(coalesce(p_note, '')), ''), note)
   where id = p_id;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.reopen_unresolved_row(uuid, text) from public, anon;
grant execute on function public.reopen_unresolved_row(uuid, text) to authenticated;

-- ------------------------------------------------------------
-- The list the pane renders — 0193's body plus the follow-up columns.
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
             'follow_up', u.follow_up,
             'follow_up_at', u.follow_up_at,
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

-- ------------------------------------------------------------
-- The import's held list — 0193's columns, 0190's "already answered" test
-- restored, extended to no-รหัส seats, and the open rows' annotations carried.
-- ------------------------------------------------------------
create or replace function public.record_unresolved_rows(p_batch uuid, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_kept    integer := 0;
  v_already integer := 0;
  v_carry   jsonb;
  v_carried integer := 0;
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

  -- (1) what we know about the rows about to be replaced. Held in a variable,
  -- not a temp table: this function may run twice in one transaction.
  select coalesce(jsonb_agg(jsonb_build_object(
           'k', coalesce('sid:' || public.student_id_key(u.student_id),
                         'seat:' || public.held_seat_key(u.cohort_year, u.sai_code,
                                                         u.first_name_th, u.last_name_th)),
           'note', u.note, 'follow_up', u.follow_up,
           'follow_up_at', u.follow_up_at, 'follow_up_by', u.follow_up_by)), '[]'::jsonb)
    into v_carry
    from public.student_import_unresolved u
   where u.resolved_at is null and (u.note is not null or u.follow_up is not null);

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
    select d.* from deduped d
     where (
       d.student_id is null
       or (
         -- (a) somebody is already in ระบบบ้าน under this รหัส …
         not exists (
           select 1 from public.students s
            where public.student_id_key(s.student_id) = public.student_id_key(d.student_id))
         -- … and (b) this seat has not already been answered (0190, restored).
         and not exists (
           select 1 from public.student_import_unresolved u
            where u.resolved_at is not null
              and public.student_id_key(u.student_id) = public.student_id_key(d.student_id))
       ))
       -- (c) a seat with NO รหัส that was already answered, by รุ่น + สาย + ชื่อ.
       -- Any resolution counts — the same reasoning as 0190's (b).
       and not (
         d.student_id is null
         and exists (
           select 1 from public.student_import_unresolved u
            where u.resolved_at is not null
              and public.held_seat_key(u.cohort_year, u.sai_code, u.first_name_th, u.last_name_th)
                = public.held_seat_key(d.cohort_year, d.sai_code, d.first_name_th, d.last_name_th)))
  ), keyed as (
    select f.*, coalesce('sid:' || public.student_id_key(f.student_id),
                         'seat:' || public.held_seat_key(f.cohort_year, f.sai_code,
                                                         f.first_name_th, f.last_name_th)) as k
      from fresh f
  ), ins as (
    insert into public.student_import_unresolved
      (batch_id, source_line, student_id, first_name_th, last_name_th,
       nickname_imported, major, sai_code, cohort_year, file_kkumail, file_note, reason,
       note, follow_up, follow_up_at, follow_up_by)
    select p_batch, f.source_line, f.student_id, f.first_name_th, f.last_name_th,
           f.nickname_imported, f.major, f.sai_code, f.cohort_year,
           f.file_kkumail, f.file_note, f.reason,
           c.note, c.follow_up, c.follow_up_at, c.follow_up_by
      from keyed f
      left join lateral (
        select x.note, x.follow_up, x.follow_up_at, x.follow_up_by
          from jsonb_to_recordset(v_carry)
            as x(k text, note text, follow_up text, follow_up_at timestamptz, follow_up_by uuid)
         where x.k = f.k
         limit 1) c on true
    returning (note is not null or follow_up is not null) as carried
  )
  select (select count(*) from ins),
         (select count(*) from deduped) - (select count(*) from fresh),
         (select count(*) from ins where carried)
    into v_kept, v_already, v_carried;

  return jsonb_build_object('held', v_kept, 'already_in_system', v_already, 'carried', v_carried);
end;
$$;
revoke all on function public.record_unresolved_rows(uuid, jsonb) from public, anon;
grant execute on function public.record_unresolved_rows(uuid, jsonb) to authenticated;

-- ------------------------------------------------------------
-- BACKFILL: the remarks the 2026-10-13 answer left as text become the fact.
-- Only rows whose note was written by the import tool in this shape. Order
-- matters: "คาดว่าลาออก" contains "ลาออก".
-- ------------------------------------------------------------
with m as (
  select id,
         case
           when note ~ 'คาดว่า\s*ลาออก'                 then 'maybe_left'
           when note ~ 'ติดต่อ\s*ไม่ได้'                 then 'unreachable'
           when note ~ 'ไม่มีตัวตน|ไม่มีคนนี้'            then 'no_person'
           when note ~ 'ลาออก'                          then 'left'
         end as fu
    from public.student_import_unresolved
   where follow_up is null and note ~ '^ฝ่ายข้อมูล [0-9]{4}-[0-9]{2}-[0-9]{2}: '
)
update public.student_import_unresolved u
   set follow_up    = m.fu,
       follow_up_at = now(),
       resolved_at  = case when m.fu in ('left', 'no_person') then coalesce(u.resolved_at, now()) else u.resolved_at end,
       resolved_how = case when m.fu in ('left', 'no_person') then coalesce(u.resolved_how, 'dismissed') else u.resolved_how end
  from m
 where u.id = m.id and m.fu is not null
   -- never stamp a CLOSING answer on a row that became a student
   and (u.resolved_how is null or u.resolved_how = 'dismissed');
