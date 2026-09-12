-- 0185_discord_link_codes.sql
--
-- HOW A PERSON PROVES THEY ARE THEMSELVES, so `/link` can write discord_links.
--
-- ⛔ THIS DELIBERATELY DOES NOT DO WHAT THE OLD BOT DID. `!verify`
-- (`main.py:711`) asked for the last five digits of a รหัสนักศึกษา and matched
-- any name ending in them. That was defensible for what it did — the old bot
-- only ADDED roles and renamed you — and it is not defensible now, because the
-- same check would hand over that person's roles AND their channels. A
-- รหัสนักศึกษา is on the ID card, on every form, and visible to staff
-- throughout this portal: nobody has to guess it, and the realistic attacker is
-- a classmate, not a brute-forcer. A control is only as strong as what it
-- unlocks, and this one's consequence grew by an order of magnitude.
--
-- So the proof is the identity the portal ALREADY establishes. A student signs
-- in with Google / @kkumail.com, which is the registry's whole basis
-- (`people.kkumail`, unique, one per human — 0132). `my_person_id()` already
-- resolves it. This adds only the short-lived token that carries that proof
-- across to Discord, where the portal's session does not exist.
--
--   portal:  เชื่อมบัญชี Discord  →  issue_discord_link_code()  →  "A1B2C-D3E4F"
--   Discord: /link A1B2C-D3E4F    →  redeem_discord_link_code(code, user_id)
--
-- The code is the ONLY secret in the flow, it lives ten minutes, it is single
-- use, and possessing it proves a LIVE SIGNED-IN SESSION — which five digits
-- printed on a card never did.

-- ------------------------------------------------------------
-- §1 — the codes
--
-- `used_at` and `used_by` are kept rather than the row deleted, so "I linked
-- and it did not work" is answerable. A deleted row and a code that never
-- existed look identical, and that is the support question this table exists
-- to make answerable at all.
-- ------------------------------------------------------------
create table if not exists public.discord_link_codes (
  code        text primary key,
  person_id   uuid not null references public.people(id) on delete cascade,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  used_at     timestamptz,
  used_by     text
);

create index if not exists discord_link_codes_person_idx
  on public.discord_link_codes (person_id) where used_at is null;

comment on table public.discord_link_codes is
  'Single-use, ten-minute proof that a person is signed in to the portal, so '
  '/link can write discord_links without asking for a รหัสนักศึกษา — which is '
  'not a secret (DISCORD-ROLE-SYNC.md §5a).';

-- ------------------------------------------------------------
-- §2 — RLS: deny-all ON PURPOSE, and the definer functions are the only door
--
-- No policy, deliberately. This table holds live bearer tokens; the correct
-- number of clients able to SELECT it is zero, including their own row — a
-- person never needs to READ a code, only to be GIVEN one by §3.
--
-- ⚠️ A table with RLS and no policy denies everyone, which reads exactly like a
-- working policy AND exactly like a broken service (0138). The proof therefore
-- pairs every deny with the ALLOW that shows the door still opens: the definer
-- functions must still reach it. Its neighbours `passport.departments` /
-- `sub_departments` are deny-all on purpose too, and "make these consistent by
-- giving them a read policy" is the edit that would widen this one (0182).
-- ------------------------------------------------------------
alter table public.discord_link_codes enable row level security;
revoke all on public.discord_link_codes from anon, authenticated;

-- ------------------------------------------------------------
-- §3 — issue, as the signed-in person
--
-- The alphabet is HEX, and that is not laziness. A human retypes this into
-- Discord from another screen, so the usual trap is `0/O` and `1/I/l` — and
-- hex cannot contain O, I or L at all, so the ambiguity is removed by the
-- character set instead of by a hand-written exclusion list that someone later
-- "tidies".
--
-- Randomness comes from `gen_random_uuid()`, which is the platform's strong
-- RNG. ⛔ NOT `random()`: that is a seeded PRNG, and a predictable bearer token
-- with a ten-minute window is a guessable one.
--
-- 10 hex characters ≈ 1.1e12 — against a table that holds at most a few live
-- codes at a time, and a bot that can rate-limit, that is ample.
-- ------------------------------------------------------------
create or replace function public.issue_discord_link_code()
returns text
language plpgsql security definer set search_path = public as $$
declare
  p   uuid := public.my_person_id();
  c   text;
  try int := 0;
begin
  -- Fail CLOSED and say which of the two things is wrong, because they have
  -- completely different remedies and the person cannot see either from here.
  if p is null then
    raise exception 'ยังเชื่อมบัญชีไม่ได้ — ต้องเข้าสู่ระบบด้วยอีเมล @kkumail.com ที่อยู่ในทะเบียน ทีม SAMO'
      using errcode = '28000';
  end if;

  -- Housekeeping without a scheduler: an expired code is worthless and a spent
  -- one is history. Only unused-and-expired rows go.
  delete from public.discord_link_codes where used_at is null and expires_at < now();

  -- ONE live code per person. Re-opening the screen invalidates the previous
  -- code rather than leaving a trail of valid bearer tokens behind — the thing
  -- on screen is the only one that works, which is also what a user assumes.
  delete from public.discord_link_codes where person_id = p and used_at is null;

  loop
    try := try + 1;
    c := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
    begin
      insert into public.discord_link_codes (code, person_id, expires_at)
      values (c, p, now() + interval '10 minutes');
      exit;
    exception when unique_violation then
      if try >= 5 then raise; end if;   -- 1-in-1e12 twice is a broken RNG, not luck
    end;
  end loop;

  -- Grouped for reading aloud; redeem() strips this again.
  return substr(c, 1, 5) || '-' || substr(c, 6, 5);
end $$;

revoke all on function public.issue_discord_link_code() from public, anon;
grant execute on function public.issue_discord_link_code() to authenticated;

comment on function public.issue_discord_link_code() is
  'Mint a ten-minute single-use code for the SIGNED-IN person. Invalidates '
  'their previous unused code, so the one on screen is the only one that works.';

-- ------------------------------------------------------------
-- §4 — redeem, as the bot
--
-- ⛔ NOT callable by `authenticated`. A signed-in student has no reason to
-- redeem a code directly, and the only thing that could achieve is binding a
-- code to a Discord account other than the one that typed it. The bot connects
-- with a service credential, which bypasses these grants.
--
-- Every failure raises with a DISTINCT message, because "it did not work" is
-- the single most expensive support answer and these four causes have four
-- different remedies.
-- ------------------------------------------------------------
create or replace function public.redeem_discord_link_code(p_code text, p_discord_user_id text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  row_c public.discord_link_codes%rowtype;
  owner uuid;
begin
  if nullif(btrim(coalesce(p_discord_user_id, '')), '') is null
     or p_discord_user_id !~ '^[0-9]{15,25}$' then
    raise exception 'discord_user_id must be a snowflake' using errcode = '22023';
  end if;

  -- Accept what a human typed: dashes, spaces, lower case.
  select * into row_c from public.discord_link_codes
   where code = upper(regexp_replace(coalesce(p_code, ''), '[^0-9A-Fa-f]', '', 'g'))
   for update;

  -- `not found` here DENIES, which is the safe direction — unlike the
  -- `if not found then <allow>` shape that fails open (mistakes class 2).
  if not found then
    raise exception 'รหัสไม่ถูกต้อง' using errcode = '22023';
  end if;
  if row_c.used_at is not null then
    raise exception 'รหัสนี้ถูกใช้ไปแล้ว — ขอรหัสใหม่จากหน้าเว็บ' using errcode = '22023';
  end if;
  if row_c.expires_at < now() then
    raise exception 'รหัสหมดอายุแล้ว — ขอรหัสใหม่จากหน้าเว็บ' using errcode = '22023';
  end if;

  -- Somebody else already holds this Discord account. Refuse rather than MOVE
  -- the link: moving it would let anyone with a valid code of their own take
  -- over an account that is not theirs, which is the opposite of the point.
  select person_id into owner from public.discord_links
   where discord_user_id = p_discord_user_id;
  if owner is not null and owner <> row_c.person_id then
    raise exception 'บัญชี Discord นี้ถูกเชื่อมกับคนอื่นอยู่แล้ว — ติดต่อฝ่าย IT'
      using errcode = '23505';
  end if;

  -- Re-linking your OWN person to a new Discord account is allowed: people
  -- lose accounts. person_id is the PK, so this replaces rather than duplicates.
  insert into public.discord_links (person_id, discord_user_id, linked_at, updated_at)
  values (row_c.person_id, p_discord_user_id, now(), now())
  on conflict (person_id) do update
    set discord_user_id = excluded.discord_user_id, updated_at = now();

  update public.discord_link_codes
     set used_at = now(), used_by = p_discord_user_id
   where code = row_c.code;

  return row_c.person_id;
end $$;

revoke all on function public.redeem_discord_link_code(text, text) from public, anon, authenticated;

comment on function public.redeem_discord_link_code(text, text) is
  'Exchange a live code for a discord_links row. Bot-only — deliberately NOT '
  'granted to authenticated, whose only use for it would be binding a code to '
  'a Discord account other than the one that typed it.';
