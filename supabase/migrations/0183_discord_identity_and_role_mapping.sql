-- 0183_discord_identity_and_role_mapping.sql
--
-- Phase 1 of docs/DISCORD-ROLE-SYNC.md — THE PORTAL HALF ONLY. No bot code
-- exists yet and none may be written until §7's owner steps are done. What this
-- migration adds is the two things the bot will read, so that when it arrives
-- it reads a fact instead of guessing:
--
--   1. an IDENTITY that nobody can edit   → public.discord_links
--   2. a MAPPING that nobody can collide  → team_nodes.discord_role_id
--   3. a DECISION that no rule can make   → team_nodes.discord_role
--
-- EXPAND-only: every column is nullable or defaulted, nothing reads them yet,
-- and nothing is dropped. Safe to apply before the code that uses it ships.
--
-- ⛔ WHY EACH OF THESE IS A COLUMN AND NOT A NAME. The old bot matched Discord
-- roles by NAME and people by DISPLAY NAME, and both are broken by measurement,
-- not by opinion (DISCORD-ROLE-SYNC.md §3):
--   · `เหรัญญิก` exists SIX times in team_nodes, one per ฝ่าย, and Discord
--     permits duplicate role names — so a name match merges all six into one
--     role and hands one ฝ่าย's treasurer the other five ฝ่าย's channels.
--     11 names collide across 32 nodes; 37 members sit on one.
--   · a display name is a string the member can edit, and the old format
--     embedded ชั้นปี, so every key in the server broke annually.

-- ------------------------------------------------------------
-- §1 — IDENTITY. A person, not a placement.
--
-- One in four people in ทีม SAMO holds more than one placement (64 hold two,
-- 13 hold three, one holds six). The Discord account belongs to the HUMAN, so
-- the link hangs off public.people — the one registry (0132) — and not off
-- team_members, where it would have to be written N times and could disagree
-- with itself.
--
-- `discord_user_id` is the SNOWFLAKE, stored as text. Not bigint: it is an
-- opaque identifier that is never arithmetic, JSON parsers lose precision on
-- it past 2^53, and every Discord API path takes it as a string.
-- ------------------------------------------------------------
create table if not exists public.discord_links (
  person_id        uuid primary key references public.people(id) on delete cascade,
  discord_user_id  text not null,
  -- Who vouched for this link. A self-link through the bot's /link command
  -- records the person themselves; an admin repair records the admin.
  linked_by        uuid references public.users(id) on delete set null,
  linked_at        timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- BOTH directions are unique, and both matter. person_id is the PK, so a person
-- cannot hold two Discord accounts. This index is the other half: one Discord
-- account cannot be claimed by two people, which is what stops somebody linking
-- to a colleague's row and inheriting their roles.
create unique index if not exists discord_links_user_uniq
  on public.discord_links (discord_user_id);

drop trigger if exists touch_discord_links_updated_at on public.discord_links;
create trigger touch_discord_links_updated_at
  before update on public.discord_links
  for each row execute function public.touch_updated_at();

comment on table public.discord_links is
  'Which Discord account belongs to which human (DISCORD-ROLE-SYNC.md §5a). '
  'The old bot identified people by their editable Discord DISPLAY NAME, which '
  'meant a rename deleted them from the sync and an annual ชั้นปี change broke '
  'every key at once. This stores the user snowflake instead.';
comment on column public.discord_links.discord_user_id is
  'The Discord user snowflake as TEXT — opaque, never arithmetic, and past '
  '2^53 a JSON number loses precision.';

-- ------------------------------------------------------------
-- §2 — RLS. Admin-only, both ways, and deliberately no self-branch yet.
--
-- Same audience as the ทีม SAMO editor these rows are read beside. There is
-- NO "a person may read their own link" branch, because there is no
-- auth.uid() → people.id helper in this schema and inventing one here — to
-- serve a screen that does not exist — is how a fail-open reference gets
-- written (mistakes class 2). Add it WITH the screen that needs it.
--
-- The bot does not come through here at all: it connects server-side and
-- bypasses RLS, so these policies govern the PORTAL only.
-- ------------------------------------------------------------
alter table public.discord_links enable row level security;

drop policy if exists "discord_links_read" on public.discord_links;
create policy "discord_links_read" on public.discord_links
  for select to authenticated
  using (public.current_user_role() = any (array['vp_admin','dev'])
         or public.current_user_has_permission('team_edit')
         or public.current_user_has_permission('team'));

drop policy if exists "discord_links_write" on public.discord_links;
create policy "discord_links_write" on public.discord_links
  for all to authenticated
  using (public.current_user_role() = any (array['vp_admin','dev'])
         or public.current_user_has_permission('team_edit'))
  with check (public.current_user_role() = any (array['vp_admin','dev'])
         or public.current_user_has_permission('team_edit'));

-- anon has no business enumerating who is in the Discord server.
revoke all on public.discord_links from anon;

-- ------------------------------------------------------------
-- §3 — THE MAPPING. node_id → discord_role_id.
--
-- This column IS the managed set (§5d): the roles the reconciler is allowed to
-- remove are exactly the ones named here, derived — never a name prefix, never
-- a hardcoded exclusion list, neither of which can see the role somebody adds
-- next month. Master, Waiting room, moderators and bot integrations are absent
-- from it and are therefore untouchable by construction.
--
-- Written by the bot's PROVISIONING command, which is explicit and prints what
-- it would create. The sync path never creates a role: the old bot's
-- auto-create is what forked a second `ฝ่าย…` role on every rename and orphaned
-- the first one with all its channel overwrites still attached.
-- ------------------------------------------------------------
alter table public.team_nodes
  add column if not exists discord_role_id text;

create unique index if not exists team_nodes_discord_role_uniq
  on public.team_nodes (discord_role_id)
  where discord_role_id is not null;

comment on column public.team_nodes.discord_role_id is
  'The Discord role snowflake this node mirrors, or NULL if it has none yet '
  '(DISCORD-ROLE-SYNC.md §5b). Unique: two nodes may share a NAME — เหรัญญิก '
  'exists six times — but never a role. The set of non-null values is also the '
  'MANAGED set: a role absent from this column is one the reconciler may never '
  'remove from anybody.';

-- ------------------------------------------------------------
-- §4 — THE DECISION. Which nodes deserve a role at all.
--
-- ⛔ THERE IS NO RULE FOR THIS AND WE MUST NOT INVENT ONE. Measured on
-- production: ฝ่าย appear at depths 1 through 5 and members attach at depths 1
-- through 6, so "depth 2 means ฝ่าย" is wrong for about half the org. And
-- `kind` does not answer it either — 26 ฝ่าย hold sub-ฝ่าย stored as
-- kind='division' while ฝ่าย IT holds `Frontend developer` stored as
-- kind='role'. A rule of "mirror divisions, skip roles" would have deleted the
-- frontend-only channel the owner explicitly asked for.
--
-- So it is a tick-box the owner sets once per node, in the ทีม SAMO editor.
-- ------------------------------------------------------------
alter table public.team_nodes
  add column if not exists discord_role boolean not null default false;

comment on column public.team_nodes.discord_role is
  'Does this node get its own Discord role? A DECISION, not a derivation — '
  'neither depth nor kind can answer it (DISCORD-ROLE-SYNC.md §4/§5c). A '
  'member receives their own node''s role plus every ticked ANCESTOR''s, so a '
  'Frontend developer under ฝ่าย IT holds both and @ฝ่าย IT still pings all '
  'of IT.';

-- ------------------------------------------------------------
-- §5 — The starting state, from facts the owner already curated.
--
-- §5c asks for a sensible seed "to be reviewed, not trusted". It names
-- "every leadership role" — but identifying leadership by NAME is the same
-- class of guess this whole migration exists to avoid (`หัวหน้าฝ่ายวิชาการ`
-- alone exists four times). So the seed uses only markings a human already
-- made deliberately:
--
--   · kind='division' — a ฝ่าย is by definition a group of people, and a
--     group of people is what a channel is for;
--   · is_board — 0104's "แสดงในกริดคณะกรรมการ", which the owner ticked to mean
--     exactly "this is a leadership position".
--
-- Everything else starts UNTICKED. is_public = false is excluded: those nodes
-- are อาจารย์ / เจ้าหน้าที่คณะ, who are not in the student Discord.
--
-- Idempotent, and it only ever turns ticks ON for rows still at the default —
-- re-running after the owner has reviewed cannot undo their decisions, because
-- an untick is a deliberate false and this would set it true again. That is why
-- the guard is `not discord_role` ... and why this block must never be edited
-- into a plain UPDATE. It is a SEED; run once, reviewed after.
-- ------------------------------------------------------------
do $$
declare seeded int;
begin
  -- Only ever seed a table nobody has reviewed yet. Once a single node carries
  -- a discord_role_id the provisioning has run and the ticks are real answers.
  if exists (select 1 from public.team_nodes where discord_role_id is not null) then
    raise notice 'discord_role seed SKIPPED — roles are already provisioned';
    return;
  end if;

  update public.team_nodes
     set discord_role = true
   where not discord_role
     and is_public
     -- `in (division, department)` mirrors isDivision() in src/js/node-kind.js,
     -- NOT normalizeKind's output. 0151 rewrote every live row to 'division'
     -- and writes are normalised, but read is deliberately lenient there
     -- because an old bundle or a hand-edited import can still say
     -- 'department' — and a ฝ่าย this seed could not classify would silently
     -- start life unticked.
     and (kind in ('division', 'department') or is_board);

  get diagnostics seeded = row_count;
  raise notice 'discord_role seeded on % node(s) — the owner reviews these, they are not a verdict', seeded;
end $$;
