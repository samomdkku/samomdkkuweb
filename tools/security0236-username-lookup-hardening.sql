-- ============================================================
-- security0236-username-lookup-hardening.sql — lookup_email_by_username
-- (0236) in-database: the crypt() verification itself, and the boundary
-- between "derivable" and "real" addresses, both directions.
--
-- The over-the-wire twin (real anon key, real PostgREST endpoint, no SQL
-- role switch) is tools/security0236-login-flow-probe.mjs — run both; this
-- one is cheaper and needs no network.
--
--   node tools/db-query.mjs tools/security0236-username-lookup-hardening.sql
-- ============================================================
begin;

create temporary table probe (step text, expected text, got text) on commit drop;

create temporary table subj (native_id uuid, google_id uuid, native_user text, native_email text,
  native_pw text, google_user text, google_email text, google_pw text);
insert into subj values (
  '00000000-0000-4000-8000-000000023601', '00000000-0000-4000-8000-000000023602',
  'sec0236native', 'sec0236native@samomdkku.app', 'Native-Pw-1!',
  'sec0236google', 'sec0236-real@probe.invalid', 'Real-Pw-1!'
);

insert into auth.users (id, email, encrypted_password, raw_app_meta_data, raw_user_meta_data)
select native_id, native_email, extensions.crypt(native_pw, extensions.gen_salt('bf')),
  '{"provider":"email","providers":["email"]}'::jsonb,
  jsonb_build_object('username', native_user, 'method', 'password')
from subj
union all
select google_id, google_email, extensions.crypt(google_pw, extensions.gen_salt('bf')),
  '{"provider":"google","providers":["google"]}'::jsonb, '{}'::jsonb
from subj;
update public.users set username = (select google_user from subj) where id = (select google_id from subj);

insert into probe select '0. both throwaway accounts exist with the right username', '2', (
  select count(*)::text from public.users
   where id in ((select native_id from subj), (select google_id from subj))
     and username in ((select native_user from subj), (select google_user from subj))
);

-- §A — the synthetic/native account: a no-op reveal, no password needed.
insert into probe select 'A1. native, no password -> synthetic email', (select native_email from subj),
  coalesce(public.lookup_email_by_username((select native_user from subj)), 'NULL');
insert into probe select 'A2. native, wrong password -> still the synthetic email', (select native_email from subj),
  coalesce(public.lookup_email_by_username((select native_user from subj), 'definitely-wrong'), 'NULL');

-- §B — the real-email account: the leak this migration closes, and the
-- sign-in path it must keep open for the account's own owner.
insert into probe select 'B1. DENY real-email account, no password -> null', 'NULL',
  coalesce(public.lookup_email_by_username((select google_user from subj)), 'NULL');
insert into probe select 'B2. DENY real-email account, wrong password -> null (same shape as B1)', 'NULL',
  coalesce(public.lookup_email_by_username((select google_user from subj), 'definitely-wrong'), 'NULL');
insert into probe select 'B3. ALLOW real-email account, correct password -> the real email', (select google_email from subj),
  coalesce(public.lookup_email_by_username((select google_user from subj), (select google_pw from subj)), 'NULL');

-- §C — unknown username: no oracle for existence either direction.
insert into probe select 'C1. unknown username -> null', 'NULL',
  coalesce(public.lookup_email_by_username('sec0236-does-not-exist'), 'NULL');

-- §D — the OLD one-arg signature is gone, not just shadowed (an overload
-- left behind would make PostgREST's call-with-only-p_username ambiguous).
insert into probe select 'D1. the 1-arg signature no longer exists', '0', (
  select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'lookup_email_by_username'
     and pg_get_function_identity_arguments(p.oid) = 'p_username text'
);

select step, expected, got, case when expected = got then 'PASS' else 'FAIL' end as verdict
  from probe order by step;

rollback;
