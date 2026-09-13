-- 0187_a_discord_account_nobody_claims.sql
--
-- UNLINKING YOUR DISCORD ACCOUNT IS CURRENTLY A PERMANENT ROLE GRANT.
--
-- The sync's central safety rule is §5e, "never act on absence": a guild member
-- with no link is UNKNOWN, never "entitled to nothing". `discord-apply.mjs`
-- implements it as `if (!t) continue;` — the person is not in the plan at all.
-- That is right for someone who has never linked. It is WRONG for someone who
-- WAS linked, held ฝ่าย roles because of it, and is now not, because those two
-- states are today indistinguishable: both are simply an absent row.
--
-- So the roles stay, and NOTHING CAN EVER REMOVE THEM. A student who leaves
-- SAMO and presses ยกเลิกการเชื่อมต่อ keeps ฝ่าย channel access for as long as
-- the account exists. That is the exact outcome this whole project exists to
-- prevent, reachable by a button the student presses themselves.
--
-- ⛔ THREE DOORS, ONE HOLE. The first draft of this fix only closed the first:
--
--   1. UNLINK         → delete from discord_links       (unlink_my_discord)
--   2. PERSON DELETED  → cascade delete                 (discord_links_person_id_fkey)
--   3. RE-LINK         → UPDATE of discord_user_id      (redeem_discord_link_code
--                        `on conflict (person_id) do update`) — the person moves
--                        to a new Discord account and the OLD one is orphaned
--                        holding every role it was ever given. 0185 §76 already
--                        asserts "the OLD account is free for its real owner",
--                        so this door is not a bug, it is the design — but
--                        nothing was written down about the roles left on it.
--
-- A fix per door is this repo's most repeated defect (`fix-every-path-not-one`).
-- Door 3 is an UPDATE, so an `after delete` trigger — the obvious shape — would
-- have closed 1 and 2 and silently left 3 open. Hence ONE trigger on the TABLE,
-- covering insert, update and delete.
--
-- ⛔ THIS RECORDS, IT DOES NOT REMOVE. What should happen to an orphaned
-- account's roles is the owner's undecided "what makes a leaver" question
-- (HANDOFF §14b item 4), and §5e wants a ศิษย์เก่า SAMO role rather than a
-- stripped member. Deciding that here would be inventing policy. What cannot
-- wait is that TODAY the information is DESTROYED: after an unlink there is no
-- way, anywhere, to learn that a Discord account was ever ours. Every unlink
-- between now and that decision is unrecoverable. This keeps the evidence so
-- the decision has something to act on.

-- ------------------------------------------------------------
-- §1 — the tombstone
--
-- Keyed on the DISCORD account, not the person: the account is the thing still
-- holding roles, and in door 2 the person no longer exists.
--
-- ⛔ NO FOREIGN KEY ON person_id, deliberately — and the reason is worse than
-- "the tombstone would be deleted with the person".
--
-- MEASURED by adding one (2026-09-13): the trigger fires DURING the cascade,
-- when the people row is already gone, so its insert raises
--   23503 … Key (person_id)=(01e37e4d…) is not present in table "people"
-- and the whole DELETE aborts. A foreign key here does not lose the record —
-- IT MAKES DELETING A PERSON FAIL. The natural, tidy-looking constraint breaks
-- an unrelated operation, and it would have been found by someone trying to
-- remove a student, not by anyone testing Discord.
--
-- person_id is a breadcrumb for whoever reads the report, and it is allowed to
-- dangle. §D of the proof asserts that it dangles rather than that it resolves.
-- ------------------------------------------------------------
create table if not exists public.discord_orphaned_accounts (
  discord_user_id text primary key,
  person_id       uuid,
  reason          text        not null,
  orphaned_at     timestamptz not null default now()
);

comment on table public.discord_orphaned_accounts is
  'Discord accounts that WERE linked to a ทีม SAMO person and are not any more '
  '— by unlink, by the person being deleted, or by that person re-linking to a '
  'different account. They may still hold mirrored ฝ่าย roles that no code path '
  'can remove, because an absent link is indistinguishable from never having '
  'linked (§5e, "never act on absence"). A RECORD, not an instruction: what to '
  'do with those roles is undecided (HANDOFF §14b item 4).';

-- Deny-all and ungranted, like discord_link_codes. Nobody needs to read this
-- from a browser, and it maps a Discord account to a person — the same
-- disclosure as discord_links itself. The reconcile reaches it with the service
-- key, which bypasses RLS; a future admin screen gets a definer function.
alter table public.discord_orphaned_accounts enable row level security;
revoke all on public.discord_orphaned_accounts from anon, authenticated;

-- ------------------------------------------------------------
-- §2 — one trigger, both directions
--
-- Bidirectional because the tombstone must be WITHDRAWN as well as written: a
-- person who re-links to the account they previously abandoned must not be left
-- marked as orphaned, or the report keeps naming a live link for ever. That is
-- the "latest reading with no TTL" shape from 0167, and the cure is that the
-- same function that can turn the state ON can turn it OFF.
-- ------------------------------------------------------------
create or replace function public.discord_links_track_orphans()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- An id LEAVING a link row is orphaned — but only if nobody else now holds
  -- it. On a re-link the person moves A → B, and A is free; if some other
  -- person legitimately holds A (they cannot, 0183's unique index, but ask
  -- rather than assume) there is nothing orphaned about it.
  --
  -- ⚠️ HONEST ABOUT WHAT IS LOAD-BEARING: `is distinct from` here is DEFENSIVE,
  -- not the thing that protects an unrelated UPDATE. Removing it and keeping
  -- the withdrawal below leaves the proof fully green — because the second
  -- branch deletes the row the first just wrote, within the same statement.
  -- What actually catches that case is the WITHDRAWAL; remove both and the
  -- proof's §33 goes red. Recorded so nobody defends the wrong line.
  if tg_op in ('DELETE', 'UPDATE')
     and old.discord_user_id is not null
     and (tg_op = 'DELETE' or new.discord_user_id is distinct from old.discord_user_id)
     and not exists (select 1 from public.discord_links
                      where discord_user_id = old.discord_user_id)
  then
    insert into public.discord_orphaned_accounts (discord_user_id, person_id, reason, orphaned_at)
    values (old.discord_user_id, old.person_id,
            case when tg_op = 'DELETE' then 'unlinked-or-person-deleted' else 're-linked' end,
            now())
    on conflict (discord_user_id) do update
      set person_id = excluded.person_id,
          reason = excluded.reason,
          orphaned_at = excluded.orphaned_at;
  end if;

  -- An id ARRIVING in a link row is claimed again, so it is not orphaned.
  if tg_op in ('INSERT', 'UPDATE') and new.discord_user_id is not null then
    delete from public.discord_orphaned_accounts where discord_user_id = new.discord_user_id;
  end if;

  return null;   -- AFTER trigger; the return value is ignored
end $$;

comment on function public.discord_links_track_orphans() is
  'Keeps discord_orphaned_accounts in step with discord_links in BOTH '
  'directions. On the TABLE rather than inside unlink_my_discord(), because the '
  'same hole has three doors — unlink, person-deleted (cascade) and re-link '
  '(an UPDATE) — and a fix written for one statement misses the others.';

drop trigger if exists discord_links_track_orphans on public.discord_links;
create trigger discord_links_track_orphans
after insert or update or delete on public.discord_links
for each row execute function public.discord_links_track_orphans();

-- ------------------------------------------------------------
-- §3 — backfill what is already lost
--
-- Nothing. There is no record of any past link to recover — that is the defect.
-- Stated explicitly so the next reader does not go looking for the backfill
-- they would reasonably expect to find here. Only ONE person has ever linked
-- (read live, 2026-09-13) and they are still linked, so nothing is known to
-- have escaped through any of the three doors yet. This closes the hole before
-- 195 more people walk through it.
-- ------------------------------------------------------------
