-- 0234 — samo-dev gets production's five auth.users triggers
--
-- SYMPTOM (HANDOFF §19 item 1, accounts0211-dashboard 12/15 on samo-dev):
-- signing up on samo-dev creates NO public.users row and no has_password /
-- email mirror ever runs, because samo-dev has NONE of production's five
-- triggers on auth.users (on_auth_user_created, …_created_passport_link,
-- …_email_change, …_password_sync_insert, …_password_sync_update). Every
-- browser harness that tests sign-up on dev has been writing that
-- public.users row BY HAND to work around the gap — which hides any real
-- bug in the trigger path, which is exactly what dev is for proving.
--
-- WHY THE FUNCTIONS WERE FINE BUT THE TRIGGERS WERE NOT: samo-dev was seeded
-- from a dump of `public` (functions included) that never covered `auth.*`
-- objects, so every function below ALREADY carries its latest production
-- body verbatim (`pg_get_functiondef` on samo-dev matches production's
-- newest migration character-for-character — checked before writing this
-- file) — only the five `create trigger … on auth.users` statements were
-- ever missing. This migration restates both anyway, so a future reseed
-- that drops the functions too is still covered by one file.
--
-- WHY A MIGRATION AND NOT A DEV-ONLY TOOL: these five triggers are PART OF
-- THE SCHEMA on production (defined across 0001, 0026, 0027, 0042, 0060,
-- 0063, 0175, 0211, all already applied there per STATE.md) — a dev-only
-- script would be a SECOND place this trigger set is declared, and class 6
-- ("two implementations of one rule drift") is this repo's most expensive
-- mistake shape. A migration keeps ONE home, journaled like everything else,
-- and running it again anywhere it is already current is inert by
-- construction: every statement here is `create or replace function`
-- (replaces with byte-identical bodies) or `drop trigger if exists` + `create
-- trigger` under the SAME name as the migration that first created it — so
-- on production, which already has every one of these, this migration does
-- not add, remove or change a single trigger or function. Confirmed by
-- reading this file against the migrations list in STATE.md before writing
-- it, not asserted.
--
-- Bodies copied verbatim, newest-first:
--   handle_new_auth_user            — 0211 (adds the raw_app_meta_data.provider
--                                      method fix; 0001/0042 are superseded)
--   handle_auth_user_email_change   — 0026 (never redefined since)
--   handle_auth_user_password_sync  — 0027 (never redefined since)
--   passport_link_user_by_email     — 0175 (re-key only + restates total_km
--                                      after the re-key; 0060/0061/0063
--                                      are superseded)
--
-- CHECK: `accounts0211-dashboard --dev` goes from 12/15 to 15/15 (the three
-- rows this migration exists for: "trigger: on_auth_user_created is
-- installed", "a Google sign-up is born google", "a username sign-up is
-- born password").

-- ── 1. on_auth_user_created → handle_new_auth_user (body = 0211) ───────────
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_display text := coalesce(
    new.raw_user_meta_data->>'display_name',
    new.raw_user_meta_data->>'name',
    new.raw_user_meta_data->>'username',
    split_part(new.email, '@', 1)
  );
  -- 0211: an OAuth sign-up carries its provider in raw_APP_meta_data and never
  -- sets raw_user_meta_data.method, so the old default made every Google
  -- account 'password'.
  v_method text := coalesce(
    new.raw_user_meta_data->>'method',
    case when new.raw_app_meta_data->>'provider' = 'google' then 'google' end,
    'password'
  );
begin
  insert into public.users (id, email, username, display_name, method)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'username', null),
    v_display,
    v_method
  )
  on conflict (id) do nothing;
  return new;
exception
  when unique_violation then
    begin
      insert into public.users (id, display_name, method)
      values (new.id, v_display, v_method)
      on conflict (id) do nothing;
    exception when others then
      raise warning 'handle_new_auth_user: fallback insert failed for %: %', new.id, sqlerrm;
    end;
    return new;
  when others then
    raise warning 'handle_new_auth_user: profile insert failed for %: %', new.id, sqlerrm;
    return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- ── 2. on_auth_user_created_passport_link → passport_link_user_by_email
--      (body = 0175) ─────────────────────────────────────────────────────
create or replace function public.passport_link_user_by_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_id uuid;
begin
  begin
    if new.email is null then
      return new;
    end if;

    select p.id into v_old_id
    from passport.profiles p
    where lower(p.email) = lower(new.email)
      and p.id <> new.id
    limit 1;

    if v_old_id is null then
      return new;  -- no carried passport profile → nothing to re-key (app self-provisions on open)
    end if;

    if exists (select 1 from passport.profiles where id = new.id) then
      raise warning 'passport_link: profile already at % — skip re-key from %',
        new.id, v_old_id;
      return new;
    end if;

    update passport.scans          set user_id = new.id where user_id = v_old_id;
    update passport.season_results set user_id = new.id where user_id = v_old_id;
    update passport.profiles       set id      = new.id where id      = v_old_id;

    update passport.profiles p
       set total_km = coalesce(
             (select sum(s.points_awarded) from passport.scans s where s.user_id = p.id), 0)
     where p.id = new.id;

  exception when others then
    raise warning 'passport_link_user_by_email failed for % (%): %',
      new.id, new.email, sqlerrm;
  end;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_passport_link on auth.users;
create trigger on_auth_user_created_passport_link
  after insert on auth.users
  for each row execute function public.passport_link_user_by_email();

-- ── 3. on_auth_user_email_change → handle_auth_user_email_change
--      (body = 0026) ─────────────────────────────────────────────────────
create or replace function public.handle_auth_user_email_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.email is distinct from old.email then
    update public.users
       set email = new.email
     where id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_email_change on auth.users;
create trigger on_auth_user_email_change
  after update of email on auth.users
  for each row execute function public.handle_auth_user_email_change();

-- ── 4/5. on_auth_user_password_sync_insert / _update →
--         handle_auth_user_password_sync (body = 0027) ────────────────────
create or replace function public.handle_auth_user_password_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.users
     set has_password = (new.encrypted_password is not null)
   where id = new.id
     and has_password is distinct from (new.encrypted_password is not null);
  return new;
end;
$$;

drop trigger if exists on_auth_user_password_sync_insert on auth.users;
create trigger on_auth_user_password_sync_insert
  after insert on auth.users
  for each row
  when (new.encrypted_password is not null)
  execute function public.handle_auth_user_password_sync();

drop trigger if exists on_auth_user_password_sync_update on auth.users;
create trigger on_auth_user_password_sync_update
  after update of encrypted_password on auth.users
  for each row
  execute function public.handle_auth_user_password_sync();
