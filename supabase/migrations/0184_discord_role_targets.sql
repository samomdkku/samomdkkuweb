-- 0184_discord_role_targets.sql
--
-- THE ONE FUNCTION THAT DECIDES WHICH ROLES A PERSON SHOULD HOLD.
--
-- §5f of docs/DISCORD-ROLE-SYNC.md: the live-update path and the periodic
-- reconcile "must call ONE function that computes the target set. Two copies of
-- that rule will drift; this repo has paid for that shape more than any other."
-- Putting it in the BOT would satisfy that sentence and nothing else — the
-- portal will eventually want to show a person which roles they are due, and
-- `/whois` answers the same question from a third place. In Postgres there is
-- one implementation and no discipline required to keep it that way.
--
-- IT ALSO REMOVES THE REASON FOR A SECOND DISCORD APPLICATION. A dev bot was
-- proposed on 2026-09-12 so local work could not write, and declined as not
-- worth the upkeep. It is not needed: everything that DECIDES is here, and it
-- is developed and proved against samo-dev with no Discord credential at all.
-- Only the half that READS the live guild needs a token, and that runs on the
-- VM.
--
-- ⛔ THIS FUNCTION IS A PREDICTION, NOT AN INSTRUCTION. It says what a person
-- is DUE. It says nothing about what to remove, and the reconcile must never
-- read an empty result as "remove everything" — see §5e, "never act on
-- absence", and the deliberate RLS behaviour in §3 below.

-- ------------------------------------------------------------
-- §1 — the ancestor walk
--
-- A member receives their own node's role plus every ticked ANCESTOR's. So a
-- `Frontend developer` under `ฝ่าย IT` holds both: @Frontend developer pings
-- only frontend, @ฝ่าย IT still pings all of IT, and the category-level channel
-- overwrites keep working.
--
-- ⛔ WALK parent_id. DO NOT USE DEPTH. Measured on production: ฝ่าย appear at
-- depths 1 through 5 and members attach at depths 1 through 6, so any rule of
-- the form "depth 2 means ฝ่าย" is wrong for about half the org.
--
-- `cycle` is not defensive padding. team_nodes.parent_id has no constraint
-- preventing a cycle — the frontend refuses to move a node under its own
-- descendant, and a frontend check is not a database invariant. Without this
-- clause one bad row would hang every sync rather than report one bad node.
-- ------------------------------------------------------------
create or replace function public.discord_node_ancestry(p_node uuid)
returns table (node_id uuid)
language sql stable as $$
  with recursive up as (
    select n.id, n.parent_id from public.team_nodes n where n.id = p_node
    union all
    select n.id, n.parent_id from public.team_nodes n join up on n.id = up.parent_id
  ) cycle id set looped using path
  select id from up where not looped;
$$;

comment on function public.discord_node_ancestry(uuid) is
  'A node and every ancestor above it, cycle-safe. The ancestry is what decides '
  'Discord roles (0183/0184) — never depth, which is ragged: ฝ่าย sit at depths '
  '1 through 5 on this data.';

-- ------------------------------------------------------------
-- §2 — the target set, one row per LINKED person
--
-- Shaped for the reconcile's actual question, which is asked once for the whole
-- guild and not once per member: 449 placements over 342 people, and a
-- per-person round trip would be 342 queries against a bot that also has
-- Discord's rate limits to respect.
--
-- FOUR columns, and the last two are why the report can be read by a human:
--
--   role_ids      what to actually apply — ticked AND provisioned.
--   role_names    the same set as text, so a report says `ฝ่าย IT` and not
--                 `1300000000000000001`. A diff nobody can read gets applied
--                 unread, which is the opposite of what phase 2 is for.
--   pending       ticked but NOT yet provisioned. NOT a silent omission: this
--                 is the owner's decision waiting on a role that does not exist
--                 in Discord, and it must appear in the report as work owed
--                 rather than vanish into "no target".
--   placements    how many ตำแหน่ง the person holds. One in four holds more
--                 than one, and a report that cannot show that will read like
--                 duplicate rows.
--
-- ⚠️ A PLACEMENT GRANTS, WHETHER OR NOT IT IS CONFIRMED — 449 placements, 412
-- confirmed. This is a DECISION and it is the one thing here the owner may want
-- to flip. `confirmed` is the PERSON acknowledging their own ตำแหน่ง, not an
-- admin approving it; gating access on it would mean a ฝ่าย admin adding
-- somebody to the tree grants nothing until that person ticks a box they have
-- probably never seen, which will be reported as the sync being broken. If it
-- should be the other way, it is one `and tm.confirmed` here — and
-- team0184-discord-targets.sql asserts the current answer, so changing it is
-- deliberate rather than accidental.
-- ------------------------------------------------------------
create or replace function public.discord_role_targets()
returns table (
  discord_user_id text,
  person_id       uuid,
  role_ids        text[],
  role_names      text[],
  pending         text[],
  placements      int
)
language sql stable as $$
  with linked as (
    select dl.person_id, dl.discord_user_id from public.discord_links dl
  ),
  seats as (
    select l.person_id, l.discord_user_id, tm.node_id
      from linked l
      join public.team_members tm on tm.person_id = l.person_id
  ),
  due as (
    select distinct s.person_id, s.discord_user_id, n.id, n.name, n.discord_role_id
      from seats s
      cross join lateral public.discord_node_ancestry(s.node_id) a
      join public.team_nodes n on n.id = a.node_id
     where n.discord_role
  )
  select
    l.discord_user_id,
    l.person_id,
    coalesce(array_agg(d.discord_role_id order by d.name)
               filter (where d.discord_role_id is not null), '{}') as role_ids,
    coalesce(array_agg(d.name order by d.name)
               filter (where d.discord_role_id is not null), '{}') as role_names,
    coalesce(array_agg(d.name order by d.name)
               filter (where d.discord_role_id is null), '{}')     as pending,
    (select count(distinct tm.node_id)::int from public.team_members tm
      where tm.person_id = l.person_id)                            as placements
  from linked l
  left join due d on d.person_id = l.person_id
  group by l.discord_user_id, l.person_id;
$$;

comment on function public.discord_role_targets() is
  'What every LINKED person is DUE: their own ตำแหน่ง''s Discord role plus every '
  'ticked ancestor''s (DISCORD-ROLE-SYNC.md §5c). A PREDICTION, not an '
  'instruction — it says nothing about removal, and an empty result means "this '
  'caller cannot see team_nodes", never "take everyone''s roles away" (§5e).';

-- ------------------------------------------------------------
-- §3 — access: deliberately SECURITY INVOKER, and the trap that creates
--
-- No DEFINER. The function reads team_nodes and team_members, both of which are
-- RLS'd to the ทีม SAMO editor's audience, so an ordinary signed-in student
-- calling this gets ZERO ROWS rather than the whole directory. That is the
-- correct default and it is why this is not a definer function.
--
-- ⛔ BUT IT MAKES THE EMPTY RESULT AMBIGUOUS, AND THAT AMBIGUITY IS DANGEROUS.
-- "No rows" here means EITHER "nobody is linked yet" OR "you are not allowed to
-- see the tree" — and to a reconcile those are indistinguishable inputs that
-- both look like "remove every mirrored role from everybody". This is class 2
-- exactly: an unresolvable reference answering "allowed".
--
-- So the reconcile MUST refuse to act on an empty or implausibly small target
-- set rather than treating it as a diff. That is §5e's blast-radius cap, and it
-- is not optional politeness — it is the only thing standing between a
-- misconfigured credential and 449 silent role removals.
-- ------------------------------------------------------------
revoke all on function public.discord_node_ancestry(uuid) from public, anon;
revoke all on function public.discord_role_targets()     from public, anon;
grant execute on function public.discord_node_ancestry(uuid) to authenticated;
grant execute on function public.discord_role_targets()      to authenticated;
