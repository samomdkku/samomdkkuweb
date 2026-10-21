-- ============================================================
-- 0243 — อาจารย์ที่ปรึกษา get a เบอร์โทรศัพท์, readable by house admins ONLY.
--
-- REQUESTED (owner, 2026-10-21): import the อาจารย์ list into ระบบบ้าน with
-- their phone numbers — "make sure this will not get leak, this is sensitive
-- information".
--
-- WHY A TABLE OF ITS OWN, NOT A COLUMN ON `advisors`. Today the two would be
-- readable by exactly the same people (`advisors_admin_all`). The difference
-- is what happens NEXT time somebody widens `advisors`:
--
--   • `advisors` already reaches students — `get_my_student_record()` returns
--     name / email / ภาควิชา / photo of every อาจารย์ in the caller's house.
--     That function names its columns, so a new column would not ride along
--     today; but the next reader of `advisors` (a directory, an export, a
--     `select=*` in a definer RPC) carries every column the row has, and
--     authorization is per-PATH, not per-table (mistakes.md class 4).
--   • A row in `advisor_phones` reaches a reader only through a path that
--     NAMES this table. Widening `advisors` widens nothing here.
--
-- So the phone is a fact you have to ask for by name, held behind a policy
-- that has never had a student branch and never should.
--
-- ⛔ `create table` INHERITS anon's default grant (`pg_default_acl` on public
-- gives anon arwdDxtm — class 6, 0188). RLS would still refuse every row, but
-- this table is the one place that must not depend on a single layer: the
-- grant is revoked from anon AND public, and the proof asserts the privilege
-- itself, not the revoke written here (class 7).
--
-- Stored as digits only (`0812345678`, `043123456`): formatting is display,
-- and a number typed with dashes, spaces or +66 is the same number.
-- Proof: tools/house0243-advisor-phones.sql.
-- ============================================================

create table if not exists public.advisor_phones (
  advisor_id uuid primary key references public.advisors(id) on delete cascade,
  phone      text not null check (phone ~ '^0[0-9]{8,9}$'),
  updated_at timestamptz not null default now()
);

comment on table public.advisor_phones is
  'เบอร์โทรศัพท์ of an อาจารย์ที่ปรึกษา. SENSITIVE: house admins only — the same '
  'predicate as advisors_admin_all, and NO student or anon path. Never add it to '
  'get_my_student_record() or any definer RPC without the owner asking. A table '
  'of its own (0243) so that widening `advisors` can never widen this.';
comment on column public.advisor_phones.phone is
  'Digits only, leading 0, 9–10 digits. Formatting is the display''s job.';

alter table public.advisor_phones enable row level security;

revoke all on public.advisor_phones from public;
revoke all on public.advisor_phones from anon;
revoke all on public.advisor_phones from authenticated;
grant select, insert, update, delete on public.advisor_phones to authenticated;

drop policy if exists advisor_phones_admin_all on public.advisor_phones;
create policy advisor_phones_admin_all on public.advisor_phones
  for all to authenticated
  using (current_user_role() = any (array['vp_admin','dev'])
         or current_user_has_permission('house'))
  with check (current_user_role() = any (array['vp_admin','dev'])
              or current_user_has_permission('house'));
