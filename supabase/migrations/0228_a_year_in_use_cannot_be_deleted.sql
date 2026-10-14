-- ============================================================
-- 0228 — a SAMO year that is current, was ever in office, or has rows filed
-- under it cannot be deleted.
--
-- Since 0219 team_terms is the year REGISTRY for every system, not only the
-- ทีม SAMO archive: current_samo_year() stamps every new PR / VitalSound /
-- โครงการ row, the year pickers list current + published years, and
-- samo_year_for_timestamp() reads started_at/ended_at. The "ลบปี" button was
-- disabled for the current year in the UI only (terms.js) — team_terms_write
-- (team_edit) lets the same DELETE through the API for ANY year (mistakes
-- class 4: a gate on the widget is not a gate on the route). Deleting:
--   - the current year → current_samo_year() is NULL: new rows get no year;
--   - a past year with rows filed under it → it leaves the pickers, its
--     tickets are reachable only under "ทุกปี", and its dates leave the range
--     lookup a later backfill depends on (class 2: a DELETE on reference data
--     creates the unresolvable reference).
-- A year seeded ahead of time and never used (no dates, no rows) can still be
-- deleted — that is the case the button exists for.
-- ============================================================
create or replace function public.team_terms_delete_guard()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.is_current then
    raise exception 'ลบปี % ไม่ได้ — เป็นปีปัจจุบัน ตั้งปีอื่นเป็นปีปัจจุบันก่อน', old.year
      using errcode = 'P0001';
  end if;
  if old.started_at is not null or old.ended_at is not null then
    raise exception 'ลบปี % ไม่ได้ — ปีนี้เคยเป็นปีปัจจุบันแล้ว งานของทุกระบบอ้างถึงปีนี้', old.year
      using errcode = 'P0001';
  end if;
  if exists (select 1 from public.pr_tickets where samo_year_be = old.year)
     or exists (select 1 from public.vs_tickets where samo_year_be = old.year)
     or exists (select 1 from public.projects   where samo_year_be = old.year) then
    raise exception 'ลบปี % ไม่ได้ — มีงาน PR / VitalSound / หนังสือโครงการ ที่นับเป็นปีนี้', old.year
      using errcode = 'P0001';
  end if;
  return old;
end;
$$;

revoke all on function public.team_terms_delete_guard() from public, anon, authenticated;

drop trigger if exists team_terms_delete_guard on public.team_terms;
create trigger team_terms_delete_guard
  before delete on public.team_terms
  for each row execute function public.team_terms_delete_guard();
