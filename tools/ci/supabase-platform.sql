-- ============================================================
-- supabase-platform.sql — the parts of Supabase our migrations assume.
--
-- A migration in this repo is written against a Supabase database, which is
-- Postgres PLUS things Supabase adds: an `auth` schema holding the accounts,
-- three roles the security rules are written for, and a publication the live
-- team page subscribes to. A bare Postgres has none of that, so replaying our
-- migrations onto one fails on line 1 of the first file — for a reason that
-- says nothing about whether the migrations are correct.
--
-- This file creates exactly those pieces and nothing else. It is not a
-- reimplementation of Supabase; it is the minimum that lets the migrations'
-- OWN sql be judged.
--
-- ⚠️ WHAT A GREEN RUN DOES AND DOES NOT PROVE.
--   PROVES: every migration parses and applies, in order, onto an empty
--           database — so the schema can be rebuilt from this repo alone.
--   DOES NOT PROVE: that a policy behaves correctly for a real signed-in
--           person. `auth.uid()` here reads a setting nobody sets, so it is
--           always null. Behaviour is what `npm run proofs -- --dev` is for,
--           against a real Supabase project.
--
-- Everything below was measured from the migrations themselves on 2026-09-07,
-- not assumed: 217 uses of auth.uid(), 49 of auth.users (columns id, email,
-- encrypted_password), 306 grants to `authenticated`, 295 to `anon`, one
-- `create extension pg_trgm with schema extensions`, and one
-- `alter publication supabase_realtime` in 0048. Nothing references storage,
-- vault, pg_net, cron or graphql outside comments.
-- ============================================================

-- The three roles every policy and grant in this repo is written against.
-- NOLOGIN: nothing connects as them here; they exist to be granted to.
--
-- ⚠️ IDEMPOTENT ON PURPOSE. Postgres has no `create role if not exists`, and
-- roles are CLUSTER-level — `drop schema public cascade` does not remove them.
-- So a second run against the same local database failed on "role already
-- exists", reported as "the platform bootstrap failed". Harmless in CI, where
-- the container is new every time, and a confusing wall for the contributor
-- this tool exists to serve.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end $$;

-- Supabase puts extensions in their own schema and our 0026 says so explicitly.
create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;

-- The accounts table. Only the columns our migrations actually touch — a
-- fuller copy would be a fiction that drifts from the real one.
create schema if not exists auth;

create table if not exists auth.users (
  id                 uuid primary key default gen_random_uuid(),
  email              text unique,
  encrypted_password text,
  raw_user_meta_data jsonb default '{}'::jsonb,
  created_at         timestamptz default now()
);

-- Supabase reads the signed-in person out of the request's JWT claims. With no
-- request, this is null — which is correct for a replay, and is why this run
-- cannot judge behaviour.
create or replace function auth.uid() returns uuid
  language sql stable
  as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

create or replace function auth.role() returns text
  language sql stable
  as $$ select nullif(current_setting('request.jwt.claim.role', true), '') $$;

grant usage on schema auth, extensions to anon, authenticated, service_role;
grant select on auth.users to anon, authenticated, service_role;

-- 0048 adds two tables to this. `alter publication` cannot create it.
-- Same idempotency point as the roles: a publication is not in `public`.
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;
