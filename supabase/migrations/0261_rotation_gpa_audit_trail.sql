-- ============================================================
-- 0261 — แลก Rotation: silent audit trail for GPA edits.
--
-- INCIDENT / CONTEXT (2026-10-26):
-- Students were observed calling rotation_set_gpa() in rapid succession
-- (e.g. 44 times, 18 times, 14 times, changing grades every few seconds)
-- to probe the eligibility status of peers and deduce their private GPAs.
--
-- Requirement:
-- 1. Track every GPA change with full fidelity:
--      (round_id, student_id, user_id, old_gpa, new_gpa, changed_at).
-- 2. Do NOT lock or restrict the editing flow yet (allow probing behaviour to
--    be observed without alerting or blocking students).
-- 3. Gated RPC for rotation admins (0256 named list) to inspect the audit log.
-- 4. RLS enabled, table completely unreadable / unwritable via PostgREST.
-- ============================================================

-- §1 — Audit table
create table if not exists public.rotation_gpa_audit (
  id          bigint generated always as identity primary key,
  round_id    text not null references public.rotation_rounds(id) on delete cascade,
  student_id  uuid not null references public.rotation_students(id) on delete cascade,
  user_id     uuid references auth.users(id) on delete set null,
  old_gpa     numeric(3,2),
  new_gpa     numeric(3,2),
  changed_at  timestamptz not null default now()
);

create index if not exists rotation_gpa_audit_round_idx
  on public.rotation_gpa_audit (round_id, changed_at desc);

create index if not exists rotation_gpa_audit_student_idx
  on public.rotation_gpa_audit (student_id, changed_at desc);

alter table public.rotation_gpa_audit enable row level security;
revoke all on public.rotation_gpa_audit from public, anon, authenticated;

comment on table public.rotation_gpa_audit is
  'Audit trail of every GPA edit on rotation_students. Populated by trigger; '
  'readable only through rotation_admin_gpa_audit() by named rotation_admins.';

-- §2 — Trigger function on rotation_students
create or replace function public.rotation_log_gpa_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.gpa is distinct from new.gpa then
    insert into public.rotation_gpa_audit (round_id, student_id, user_id, old_gpa, new_gpa)
    values (new.round_id, new.id, auth.uid(), old.gpa, new.gpa);
  end if;
  return new;
end;
$$;

revoke all on function public.rotation_log_gpa_change() from public, anon, authenticated;

drop trigger if exists trg_rotation_log_gpa_change on public.rotation_students;
create trigger trg_rotation_log_gpa_change
  after update of gpa on public.rotation_students
  for each row execute function public.rotation_log_gpa_change();

-- §3 — Admin inspection RPC
create or replace function public.rotation_admin_gpa_audit(p_round text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.rotation_is_admin() then
    raise exception 'ROTATION_ADMIN_ONLY';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', a.id,
      'student_id', s.student_id,
      'name', s.first_name || ' ' || s.last_name,
      'group', s.current_group,
      'email', s.kkumail,
      'old_gpa', a.old_gpa,
      'new_gpa', a.new_gpa,
      'changed_at', a.changed_at,
      'user_id', a.user_id
    ) order by a.changed_at desc, a.id desc)
    from public.rotation_gpa_audit a
    join public.rotation_students s on s.id = a.student_id
    where a.round_id = p_round
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.rotation_admin_gpa_audit(text) from public, anon;
grant execute on function public.rotation_admin_gpa_audit(text) to authenticated;
