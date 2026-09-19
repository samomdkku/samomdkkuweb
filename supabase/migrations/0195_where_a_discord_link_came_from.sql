-- 0195_where_a_discord_link_came_from.sql
--
-- A LINK MADE BY MATCHING A NICKNAME MUST NOT LOOK LIKE ONE MADE BY OAUTH.
--
-- 2026-09-19 the owner asked for a one-time bulk link: the server's nicknames
-- follow `ชื่อเล่น_#ชั้นปี_XXX-X`, and ชื่อเล่น + the last four digits of
-- รหัสนักศึกษา pick out exactly one registry person for 168 of 196 members (0
-- ambiguous, 0 two-accounts-to-one-person). Waiting for 342 people to press
-- เชื่อมบัญชี Discord would take a term.
--
-- That link is a WEAKER claim than the button's. OAuth proves Discord
-- authenticated that account to that signed-in person; a nickname match proves
-- somebody once typed a nickname that matches (DISCORD-ROLE-SYNC.md §5a says why
-- a รหัส is not a secret). The owner accepted that trade for a one-time snapshot
-- of nicknames that already exist. What must not happen is for the two to become
-- the same observable — the 0187 lesson: "absent" meant two things and a whole
-- class of roles became irrevocable. So each row says where it came from.
--
-- ⛔ THE WEB PATH MUST RESET IT. `redeem_discord_link_code` UPSERTS; without the
-- change below, a person who later links properly through the web would keep
-- `nickname-import` for ever — the stronger proof recorded as the weaker one.
-- Body copied from the LIVE `pg_get_functiondef` (2026-09-19), not from 0185;
-- the only change is `link_source` in the insert and in the conflict update.
--
-- EXPAND-only: a defaulted column, nothing dropped. Safe before or after deploy.
-- Proof: tools/team0195-link-source.sql.

alter table public.discord_links
  add column if not exists link_source text not null default 'oauth';

alter table public.discord_links
  drop constraint if exists discord_links_link_source_chk;
alter table public.discord_links
  add constraint discord_links_link_source_chk
  check (link_source in ('oauth', 'nickname-import'));

comment on column public.discord_links.link_source is
  'How this link was established. oauth = the person signed in to the portal '
  'and Discord authenticated the account (the button). nickname-import = the '
  'owner-approved one-time bulk match of the server''s ชื่อเล่น_#ปี_XXX-X '
  'nicknames against the registry, 2026-09-19. Re-linking through the web '
  'always resets it to oauth.';

CREATE OR REPLACE FUNCTION public.redeem_discord_link_code(p_code text, p_discord_user_id text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  row_c public.discord_link_codes%rowtype;
  owner uuid;
begin
  if nullif(btrim(coalesce(p_discord_user_id, '')), '') is null
     or p_discord_user_id !~ '^[0-9]{15,25}$' then
    raise exception 'discord_user_id must be a snowflake' using errcode = '22023';
  end if;

  select * into row_c from public.discord_link_codes
   where code = upper(regexp_replace(coalesce(p_code, ''), '[^0-9A-Fa-f]', '', 'g'))
   for update;

  if not found then
    raise exception 'รหัสไม่ถูกต้อง' using errcode = '22023';
  end if;
  if row_c.used_at is not null then
    raise exception 'รหัสนี้ถูกใช้ไปแล้ว — ขอรหัสใหม่จากหน้าเว็บ' using errcode = '22023';
  end if;
  if row_c.expires_at < now() then
    raise exception 'รหัสหมดอายุแล้ว — ขอรหัสใหม่จากหน้าเว็บ' using errcode = '22023';
  end if;

  select person_id into owner from public.discord_links
   where discord_user_id = p_discord_user_id;
  if owner is not null and owner <> row_c.person_id then
    raise exception 'บัญชี Discord นี้ถูกเชื่อมกับคนอื่นอยู่แล้ว — ติดต่อฝ่าย IT'
      using errcode = '23505';
  end if;

  insert into public.discord_links (person_id, discord_user_id, linked_at, updated_at, link_source)
  values (row_c.person_id, p_discord_user_id, now(), now(), 'oauth')
  on conflict (person_id) do update
    set discord_user_id = excluded.discord_user_id, updated_at = now(),
        link_source = 'oauth';

  update public.discord_link_codes
     set used_at = now(), used_by = p_discord_user_id
   where code = row_c.code;

  return row_c.person_id;
end $function$;
