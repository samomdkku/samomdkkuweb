-- ============================================================
-- 0222 — the data-safety layer every system uses (night agent, task 5 of the
-- 2026-10-14 queue). Design: docs/YEAR-ROLLOVER.md § Backup / § Export /
-- § Deletion. Runbook: skills/backup-and-export.md. Tool: tools/year-export.mjs.
--
-- WHAT THIS DOES NOT DO. It does not delete or anonymise a single row of
-- PR/VS/Shop/หนังสือโครงการ data. Each of those systems' own retention rule
-- is a LATER task's job (VS text-scrub: task 6; Shop/Projects: tasks 7/9),
-- against a `samo_year_be` column some of them do not have yet. Building a
-- per-system anonymiser here, ahead of the column that makes it meaningful,
-- would be exactly the "decide a system's own policy from outside that
-- system's own task" mistake this queue's per-task boundaries exist to
-- avoid — and it would create a SECOND place VS's 24-month rule lives the
-- moment task 6 writes the real thing (class 6).
--
-- WHAT THIS DOES ship: the one MECHANISM every later anonymise/delete RPC
-- must open before it may act, proven here against a throwaway pg_temp
-- function so the CONTRACT is verified without touching any table another
-- task owns:
--
--   1. year_export_log — a durable, append-only record that "system S's
--      year Y was actually exported, N rows, to destination D, at time T".
--      Never a boolean flag on another table — a flag could be set once and
--      then the data could change under it; a LOG is a fact about history
--      that a later re-export only ADDS to, never erases.
--   2. year_export_recorded(system, year) — the GATE. Returns a plain
--      boolean (leaks nothing but existence) so any future deletion RPC can
--      check it regardless of what table-level grants that RPC's caller
--      personally holds.
--   3. record_year_export(...) — the gated WRITE path, for a future browser
--      admin screen's "export now" button. FAILS CLOSED: raises for anyone
--      without `data_admin` (a new permission key, same shape as every
--      other one in this codebase — granted through ทีม SAMO → สิทธิ์ once a
--      human decides who holds it; this migration grants it to nobody) or
--      the `dev` role.
--
-- WHY THE NODE TOOL DOES NOT CALL record_year_export(). tools/year-export.mjs
-- runs through the Supabase Management API (the same PAT path every other
-- admin tool here uses — db-query.mjs's own header already explains why:
-- that connection is the Postgres SUPERUSER, auth.uid() is NULL there, and
-- RLS is bypassed outright). A SECURITY DEFINER gate keyed on auth.uid()
-- would REFUSE the one caller that is SUPPOSED to write this row. So the
-- tool inserts into year_export_log directly — the same "a migration tool
-- writes schema_migrations directly, no RPC" shape apply-migration.mjs
-- already uses for exactly this reason. record_year_export() exists for the
-- OTHER caller: a signed-in admin clicking a button in a browser, where
-- auth.uid() is real and the gate means something.
--
-- WHY A LOG TABLE AND NOT A COLUMN ON team_terms. A system's export and a
-- team's handover are unrelated events — PR might be exported three times
-- in one team's term (a cautious ฝ่าย backing up early, then again before
-- handover), and Shop might never be exported at all if nobody asks. One row
-- per system per year per attempt is the only shape that cannot lose that.
-- ============================================================

-- ---------------------------------------------------------------------------
-- 1. year_export_log
-- ---------------------------------------------------------------------------
create table if not exists public.year_export_log (
  id bigint generated always as identity primary key,
  system text not null,
  samo_year_be smallint not null,
  exported_at timestamptz not null default now(),
  exported_by uuid references auth.users(id) on delete set null,
  row_count integer not null,
  destination text,
  note text
);

comment on table public.year_export_log is
  'One row per export actually taken of one system''s one SAMO year. '
  '`year_export_recorded()` is the gate every deletion/anonymisation RPC in '
  'this database must call before it may touch a row — see '
  'docs/YEAR-ROLLOVER.md § Deletion and skills/backup-and-export.md. '
  'Append-only by convention (no UPDATE/DELETE policy is defined for any '
  'role) — a correction is a NEW row, never an edit of an old one, so the '
  'history of what was exported when can never be rewritten.';

comment on column public.year_export_log.system is
  'A table name or a short system key (''pr_tickets'', ''vs_tickets'', '
  '''shop_orders'', ''projects''...) — whatever tools/year-export.mjs''s own '
  'registry calls it. Not a foreign key: this log must still mean something '
  'if a table is ever renamed.';
comment on column public.year_export_log.exported_by is
  'NULL for every export this queue''s Node tooling takes (the '
  'Management-API connection has no auth.uid()) — NOT NULL only for an export '
  'taken through record_year_export() by a real signed-in admin.';
comment on column public.year_export_log.row_count is
  'What the export itself counted, never a number recomputed later — this is '
  'the "return=representation-style count" the task asked for: a caller '
  'that cannot see HOW MANY rows an action touched cannot tell "nothing to '
  'export" from "the query silently matched zero".';

create index if not exists year_export_log_lookup_idx
  on public.year_export_log (system, samo_year_be);

alter table public.year_export_log enable row level security;

-- SELECT only, and only to an operator who could plausibly need to check
-- "has this been exported" — `data_admin` (new key, granted to nobody by
-- this migration) or `dev`. No INSERT/UPDATE/DELETE policy exists for ANY
-- role: the only sanctioned writers are record_year_export() below (which
-- bypasses RLS as SECURITY DEFINER, after its own gate) and the Management
-- API tooling (which bypasses RLS as Postgres superuser, by design).
create policy year_export_log_select on public.year_export_log
  for select
  using (public.current_user_has_permission('data_admin') or public.current_user_role() = 'dev');

revoke all on public.year_export_log from anon, authenticated;
grant select on public.year_export_log to authenticated;

-- ---------------------------------------------------------------------------
-- 2. year_export_recorded(system, year) — the gate.
-- ---------------------------------------------------------------------------
create or replace function public.year_export_recorded(p_system text, p_year integer)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.year_export_log
     where system = p_system and samo_year_be = p_year
  );
$$;

comment on function public.year_export_recorded(text, integer) is
  'THE CONTRACT: any deletion or anonymisation RPC written for ANY system '
  'must call this FIRST and raise if it returns false. "Exported" means at '
  'least one matching row exists in year_export_log — a system may '
  're-export the same year any number of times; the LOG, never a single '
  'flag, is the record, so a second export can never un-mark the first, and '
  'this function can never be fooled into forgetting an export happened.';

grant execute on function public.year_export_recorded(text, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. record_year_export(...) — gated write path for a future admin UI
-- button. Fails CLOSED on both permission AND bad input — raises, never
-- returns a sentinel (class 2 in .claude/rules/mistakes.md generalises past
-- "an unresolvable reference" to "a caller must never read refusal as
-- absence"). Returns the new row's id so a caller can tell "this call did
-- something" from "this call did nothing" — never a plain void RPC, same
-- "return=representation" discipline delete-guard.test.js enforces on the
-- frontend's own DELETE calls.
-- ---------------------------------------------------------------------------
create or replace function public.record_year_export(
  p_system text, p_year integer, p_row_count integer,
  p_destination text default null, p_note text default null
) returns bigint language plpgsql security definer set search_path = public as $$
declare
  v_id bigint;
begin
  if not (public.current_user_has_permission('data_admin') or public.current_user_role() = 'dev') then
    raise exception 'record_year_export: permission denied';
  end if;
  if p_system is null or length(trim(p_system)) = 0 then
    raise exception 'record_year_export: system is required';
  end if;
  if p_year is null then
    raise exception 'record_year_export: year is required';
  end if;
  if p_row_count is null or p_row_count < 0 then
    raise exception 'record_year_export: row_count must be >= 0';
  end if;

  insert into public.year_export_log (system, samo_year_be, exported_by, row_count, destination, note)
  values (p_system, p_year, auth.uid(), p_row_count, p_destination, p_note)
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.record_year_export(text, integer, integer, text, text) is
  'The gated write a future "export now" admin button calls. tools/'
  'year-export.mjs does NOT call this — it writes year_export_log directly '
  'through the Management API (superuser, bypasses RLS) — see this '
  'migration''s header for why a SECURITY DEFINER gate keyed on auth.uid() '
  'would refuse that caller.';

grant execute on function public.record_year_export(text, integer, integer, text, text) to authenticated;
