-- ============================================================
-- 0208 — the Discord role bot gets a control panel and an on/off switch
--
-- ASKED (owner, 2026-09-23): "i want a admin tab in samoweb, also create
-- permission in the teamsamo admin to can turn on and off the role assign bot
-- like claude booking system". Until now the only switch was
-- `systemctl disable` over ssh behind the VPN — the same situation 0167 fixed
-- for the Claude usage reporter.
--
-- SHAPE, and where it differs from 0167 on purpose:
--   • discord_bot_settings — one row the ADMIN sets: the bot on/off (off needs
--     a reason), nicknames on/off, messages silent or not, and "check
--     everything now". Who/when is stamped by the database.
--   • discord_bot_status — one row the BOT writes: last pass, what it did,
--     last error, last seen. The panel reads it so a dead bot is VISIBLE
--     ("a latest reading with no TTL looks like a fact", 0167) — the tab
--     judges staleness, it is never told.
--   • NO table grant to `authenticated`. 0167 gave claude_settings a row-level
--     UPDATE policy, which grants EVERY column on the row (mistakes class 1);
--     here all access is two SECURITY DEFINER functions that check the
--     permission and write only the columns they name. So an admin cannot
--     forge the stamp or the bot's heartbeat, by construction.
--   • Permission `discord_bot` (ทีม SAMO → สิทธิ์), `master` included as ever
--     through current_user_has_permission().
--
-- The service (server/discord-sync.mjs) reads settings and writes status with
-- the service key — two more pinned paths (src/js/discord-sync.test.js).
-- ============================================================

create table if not exists public.discord_bot_settings (
  id                     boolean primary key default true check (id),
  sync_enabled           boolean not null default true,
  nicknames_enabled      boolean not null default true,
  silent                 boolean not null default false,
  note                   text,
  changed_at             timestamptz,
  changed_by             uuid,
  changed_by_label       text,
  full_pass_requested_at timestamptz,
  constraint discord_bot_off_needs_a_reason
    check (sync_enabled or length(btrim(coalesce(note, ''))) between 3 and 300),
  constraint discord_bot_note_len
    check (note is null or length(btrim(note)) <= 300)
);
insert into public.discord_bot_settings (id) values (true) on conflict do nothing;

create table if not exists public.discord_bot_status (
  id            boolean primary key default true check (id),
  state         text,            -- 'running' | 'paused'
  running_since timestamptz,
  last_seen_at  timestamptz,
  last_pass_at  timestamptz,
  last_summary  text,
  last_error    text,
  last_error_at timestamptz,
  nicknames     text             -- the EFFECTIVE mode: off | plan | apply
);
insert into public.discord_bot_status (id) values (true) on conflict do nothing;

alter table public.discord_bot_settings enable row level security;
alter table public.discord_bot_status   enable row level security;
-- pg_default_acl hands anon/authenticated every privilege on a new public
-- table (mistakes class 6, 0188). Take it back explicitly; no policy is
-- created, so even a stray grant would read nothing.
revoke all on public.discord_bot_settings from anon, authenticated;
revoke all on public.discord_bot_status   from anon, authenticated;

-- ── read: the whole panel, for a holder of `discord_bot` ───────────────────
create or replace function public.get_discord_bot_panel()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s public.discord_bot_settings; t public.discord_bot_status;
begin
  if auth.uid() is null or not public.current_user_has_permission('discord_bot') then
    raise exception 'ไม่มีสิทธิ์ดูบอท Discord' using errcode = '42501';
  end if;
  select * into s from public.discord_bot_settings where id;
  select * into t from public.discord_bot_status where id;
  return jsonb_build_object(
    'sync_enabled', s.sync_enabled, 'nicknames_enabled', s.nicknames_enabled,
    'silent', s.silent, 'note', s.note, 'changed_at', s.changed_at,
    'changed_by_label', s.changed_by_label, 'full_pass_requested_at', s.full_pass_requested_at,
    'state', t.state, 'running_since', t.running_since, 'last_seen_at', t.last_seen_at,
    'last_pass_at', t.last_pass_at, 'last_summary', t.last_summary,
    'last_error', t.last_error, 'last_error_at', t.last_error_at, 'nicknames', t.nicknames,
    'now', now());
end $$;

-- ── write: the switches ─────────────────────────────────────────────────────
-- NULL leaves a switch as it is. The stamp moves only when a switch or the
-- note actually changes, so re-saving does not make an old pause look new.
create or replace function public.set_discord_bot(
  p_sync_enabled boolean default null, p_nicknames_enabled boolean default null,
  p_silent boolean default null, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare o public.discord_bot_settings; n public.discord_bot_settings;
begin
  if auth.uid() is null or not public.current_user_has_permission('discord_bot') then
    raise exception 'ไม่มีสิทธิ์ตั้งค่าบอท Discord' using errcode = '42501';
  end if;
  select * into o from public.discord_bot_settings where id for update;
  n := o;
  n.sync_enabled      := coalesce(p_sync_enabled, o.sync_enabled);
  n.nicknames_enabled := coalesce(p_nicknames_enabled, o.nicknames_enabled);
  n.silent            := coalesce(p_silent, o.silent);
  -- Kept on resume (the "back on" message says what it had been off for).
  n.note              := coalesce(nullif(btrim(p_note), ''), o.note);
  if n.sync_enabled is distinct from o.sync_enabled
     or n.nicknames_enabled is distinct from o.nicknames_enabled
     or n.silent is distinct from o.silent
     or n.note is distinct from o.note then
    n.changed_at := now();
    n.changed_by := auth.uid();
    n.changed_by_label := public.discord_actor_label();
  end if;
  update public.discord_bot_settings
     set sync_enabled = n.sync_enabled, nicknames_enabled = n.nicknames_enabled,
         silent = n.silent, note = n.note, changed_at = n.changed_at,
         changed_by = n.changed_by, changed_by_label = n.changed_by_label
   where id;
  return public.get_discord_bot_panel();
end $$;

-- ── "check everything now" ─────────────────────────────────────────────────
create or replace function public.request_discord_full_pass()
returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.current_user_has_permission('discord_bot') then
    raise exception 'ไม่มีสิทธิ์สั่งบอท Discord' using errcode = '42501';
  end if;
  update public.discord_bot_settings set full_pass_requested_at = now() where id;
  return public.get_discord_bot_panel();
end $$;

revoke all on function public.get_discord_bot_panel() from public, anon;
revoke all on function public.set_discord_bot(boolean, boolean, boolean, text) from public, anon;
revoke all on function public.request_discord_full_pass() from public, anon;
grant execute on function public.get_discord_bot_panel() to authenticated;
grant execute on function public.set_discord_bot(boolean, boolean, boolean, text) to authenticated;
grant execute on function public.request_discord_full_pass() to authenticated;
