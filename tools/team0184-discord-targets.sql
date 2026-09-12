-- ============================================================
-- team0184-discord-targets.sql — what each person is DUE in Discord, computed
-- in one place, over the real org tree.
--
-- 0184 puts the "which roles should this person hold" rule in Postgres rather
-- than in the bot. §5f of the design requires the live path and the periodic
-- reconcile to call ONE function; in the database that is structural instead of
-- a promise, and it is also what made a second Discord application
-- unnecessary — every line below is proved with no Discord credential at all.
--
-- WHAT THIS IS DEFENDING:
--   §B  the ancestor rule, on a REAL two-level branch of the live tree, not a
--       synthetic one — @Frontend developer and @ฝ่าย IT must BOTH arrive.
--   §C  the ragged-tree trap. A depth rule is wrong for about half the org, so
--       this asserts ancestry is what is followed, at a depth that would break
--       any "depth 2 = ฝ่าย" shortcut.
--   §D  a ticked-but-unprovisioned node appears as PENDING and never silently
--       disappears — the owner's decision waiting on a role that does not exist.
--   §E  the empty result is AMBIGUOUS by construction, which is the one thing
--       about this function a reconcile can get fatally wrong.
--
-- Every subject is built inside the transaction and rolled back. Nothing here
-- survives, and it links no real person to a real Discord account.
--
--   node tools/db-query.mjs tools/team0184-discord-targets.sql
-- ============================================================
begin;

create temporary table probe (step text, expected text, got text) on commit drop;

-- ── Subjects: a REAL branch of the live tree ────────────────────────────────
-- A ฝ่าย that is ticked and has a ticked-or-tickable child. Built from the
-- database rather than named, because a proof whose subject is a hardcoded name
-- rots the first time somebody renames it (class 7).
create temporary table branch on commit drop as
select parent.id as parent_id, parent.name as parent_name,
       child.id  as child_id,  child.name  as child_name
  from public.team_nodes parent
  join public.team_nodes child on child.parent_id = parent.id
 where parent.discord_role
 order by parent.name, child.name
 limit 1;

insert into probe select '00. a real ฝ่าย with a child exists', 'true',
  (select (count(*) = 1)::text from branch);

-- Provision both ends, and tick the child, so the two-level case is REAL.
update public.team_nodes set discord_role_id = '700000000000000001'
 where id = (select parent_id from branch);
update public.team_nodes set discord_role = true, discord_role_id = '700000000000000002'
 where id = (select child_id from branch);

-- A third node, ticked but NOT provisioned — §D's subject.
create temporary table unprov on commit drop as
select id, name from public.team_nodes
 where id <> (select parent_id from branch) and id <> (select child_id from branch)
 order by id limit 1;
update public.team_nodes set discord_role = true, discord_role_id = null
 where id = (select id from unprov);

-- One real person, placed on the CHILD node and on the unprovisioned node, then
-- linked. Two placements, because one in four people really has more than one
-- and a target set that cannot union them is wrong for 82 people.
-- ⛔ THE SUBJECT IS CREATED, NOT FOUND — twice over, and both drafts are worth
-- recording because they are the same trap from opposite sides.
--
-- Draft 1 took the first row of `people` and asserted 2 placements; it got 3,
-- because that person already sits in ทีม SAMO and the proof was counting its
-- own two inserts plus a real one. The fastest way to green would have been to
-- write 3 — which is how a guard stops meaning anything.
--
-- Draft 2 then looked for a person holding NO placement. There is no such row:
-- all 342 people hold one, measured. So the scenario this proof needs does not
-- merely RISK running out, it never existed — and the rule for that is to
-- CREATE the geometry rather than relax what the scenario asks for
-- (docs/mistakes/tooling-proofs.md). Nothing about the person's own columns
-- matters here; the function keys on person_id and placements.
insert into public.people (full_name) values ('ผู้ทดสอบ ซิงก์ดิสคอร์ด');

create temporary table who on commit drop as
select id from public.people where full_name = 'ผู้ทดสอบ ซิงก์ดิสคอร์ด';

insert into probe select '01. the subject exists, and is this proof''s own', '1',
  (select count(*)::text from who);

insert into public.team_members (node_id, full_name, person_id, confirmed)
select (select child_id from branch), 'ทดสอบ ศูนย์ศูนย์', (select id from who), false;
insert into public.team_members (node_id, full_name, person_id, confirmed)
select (select id from unprov), 'ทดสอบ ศูนย์ศูนย์', (select id from who), true;

insert into public.discord_links (person_id, discord_user_id)
select id, '800000000000000001' from who;

create temporary table got on commit drop as
select * from public.discord_role_targets()
 where discord_user_id = '800000000000000001';

-- ── §A the person resolves at all ───────────────────────────────────────────
-- The CONTROL for everything below. Without it every "the array contains X"
-- assertion is satisfied by a function that returns nothing for anybody.
insert into probe select '10. the linked person is returned exactly once', '1',
  (select count(*)::text from got);

insert into probe select '11. …and their placements are counted, not merged', '2',
  (select placements::text from got);

-- ── §B the ancestor rule: OWN role AND the ฝ่าย above it ────────────────────
-- This is the owner's stated requirement — a frontend-only channel AND an
-- @ฝ่าย IT that still pings all of IT — expressed as an assertion.
insert into probe select '20. holds its OWN node''s role', 'true',
  (select ('700000000000000002' = any (role_ids))::text from got);

insert into probe select '21. …AND the ticked ฝ่าย above it', 'true',
  (select ('700000000000000001' = any (role_ids))::text from got);

-- ⛔ NOT A COUNT. The first version asserted "exactly 2" and was green until
-- 2026-09-12, when 48 real nodes were mapped to Discord roles and the subject's
-- ancestry legitimately gained more provisioned ancestors. It went red for a
-- change that was CORRECT — the classic hardcoded-scenario failure: a proof
-- describing the data it happened to see rather than the rule.
--
-- The rule is that every role returned belongs to a node in this member's own
-- ancestry. That stays true however much of the tree is provisioned.
insert into probe select '22. …and nothing from OUTSIDE the ancestry crept in', '(none)',
  coalesce((select string_agg(r, ',') from (
    select unnest(role_ids) as r from got
    except
    select n.discord_role_id from public.team_members tm
      cross join lateral public.discord_node_ancestry(tm.node_id) a
      join public.team_nodes n on n.id = a.node_id
     where tm.person_id = (select id from who) and n.discord_role
       and n.discord_role_id is not null) x), '(none)');

-- Names travel beside ids, or the phase-2 report is unreadable and gets applied
-- unread — which is the opposite of what a report-only phase is for.
insert into probe select '23. the ฝ่าย''s NAME travels with its id', 'true',
  (select ((select parent_name from branch) = any (role_names))::text from got);

-- ── §C the tree is ragged, so ancestry is followed and not depth ────────────
insert into probe select '30. ฝ่าย really do sit at several depths', 'true',
  (select (count(distinct d) > 2)::text from (
     select (select count(*) from public.discord_node_ancestry(n.id)) as d
       from public.team_nodes n where n.discord_role) x);

-- A cycle would hang every sync rather than report one bad node. parent_id has
-- no constraint against one, so the walk must terminate on its own.
insert into probe select '31. the ancestor walk terminates on every node', 'true',
  (select (count(*) = (select count(*) from public.team_nodes))::text
     from (select n.id from public.team_nodes n
            where (select count(*) from public.discord_node_ancestry(n.id)) >= 1) y);

-- ── §D ticked but not provisioned is PENDING, never silence ─────────────────
-- The owner ticks ~90 nodes; the bot provisions them later. A node in between
-- must be visible as work owed, not absent from the answer.
insert into probe select '40. the unprovisioned node is reported as pending', 'true',
  (select ((select name from unprov) = any (pending))::text from got);

-- Same correction as §22: assert the PROPERTY (an unprovisioned node's role is
-- not applicable, because it does not exist) rather than a count of everything
-- else, which the rest of the tree is free to change.
insert into probe select '41. …and its role is NOT applicable, because there is none', 'false',
  (select ((select name from unprov) = any (role_names))::text from got);

-- ── §E the empty result is ambiguous, and that is the dangerous part ────────
-- discord_role_targets is SECURITY INVOKER, so a caller who cannot read
-- team_nodes gets ZERO ROWS — indistinguishable, to a reconcile, from "nobody
-- should hold anything". This asserts the ambiguity EXISTS so that the
-- blast-radius cap is never treated as optional politeness (§5e, class 2).
-- ⚠️ `set_config` ALONE MEASURES NOTHING, and the first draft of this line did
-- exactly that: this session connects as the superuser, RLS does not apply to
-- it, and setting a JWT claim without `set local role` leaves the connection
-- exactly as privileged as before. It reported 1 row and looked like a finding
-- about the function. The role switch is the instrument; the claim is only its
-- argument (docs/mistakes/tooling-proofs.md — a guard's instrument needs a
-- guard too).
create or replace function pg_temp.as_student()
returns int as $$
declare n int;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"00000000-0000-0000-0000-000000000009","role":"authenticated"}', true);
  execute 'set local role authenticated';
  select count(*) into n from public.discord_role_targets();
  execute 'reset role';
  return n;
exception when others then
  execute 'reset role';
  return -1;
end $$ language plpgsql;

insert into probe select '50. an unprivileged caller sees NOTHING, not a diff', '0',
  pg_temp.as_student()::text;

-- The CONTROL for 50. A count of zero is also what a broken connection, a
-- revoked GRANT or a typo'd function name returns, and -1 is what this
-- instrument reports when the call RAISED. Without this the line above passes
-- while proving nothing.
insert into probe select '50b. …because it was REFUSED rows, not an error', 'true',
  (pg_temp.as_student() >= 0)::text;

-- And the other half: the same function, called by THIS session, does answer.
-- A deny that is really "nobody can read it" is not the property being claimed.
insert into probe select '50c. …while a privileged caller still gets the row', '1',
  (select count(*)::text from public.discord_role_targets()
    where discord_user_id = '800000000000000001');

insert into probe select '51. anon cannot execute it at all', 'false',
  (select has_function_privilege('anon', 'public.discord_role_targets()', 'execute')::text);

insert into probe select '52. …and cannot walk the tree either', 'false',
  (select has_function_privilege('anon', 'public.discord_node_ancestry(uuid)', 'execute')::text);

-- ── §F the confirmed DECISION, asserted so a change is deliberate ───────────
-- A placement grants whether or not it is confirmed. The person linked above
-- holds one UNCONFIRMED placement and it is the one carrying both roles in §B,
-- so if anybody adds `and tm.confirmed`, 20/21/22 go red and this line says why.
insert into probe select '60. an UNCONFIRMED placement still grants', 'true',
  (select (count(*) = 1)::text from public.team_members tm
    where tm.person_id = (select id from who) and not tm.confirmed
      and tm.node_id = (select child_id from branch));

select step,
       case when got is not distinct from expected then 'PASS' else 'FAIL' end as result,
       expected, got
  from probe order by step;

rollback;
