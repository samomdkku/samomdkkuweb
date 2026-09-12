-- ============================================================
-- team0183-discord-mapping.sql — a Discord identity cannot be shared, a
-- Discord role cannot be claimed twice, and neither table is readable by the
-- public key.
--
-- 0183 is the portal half of docs/DISCORD-ROLE-SYNC.md phase 1. It stores the
-- three things the bot will read instead of guess:
--
--   discord_links                → WHO somebody is (a snowflake, not a name)
--   team_nodes.discord_role_id   → WHICH Discord role a node mirrors
--   team_nodes.discord_role      → WHETHER a node deserves one at all
--
-- WHAT THIS PROOF IS DEFENDING, and why it is a proof rather than a comment:
-- the bug that made this whole design necessary is that the OLD bot matched on
-- NAMES. `เหรัญญิก` exists six times in team_nodes, one per ฝ่าย, and Discord
-- permits duplicate role names — so a name match collapses all six into one
-- role and hands one ฝ่าย's treasurer the other five ฝ่าย's channels. §B is the
-- assertion that the replacement cannot do that, expressed as a constraint the
-- database enforces rather than a rule the bot is trusted to follow.
--
-- BOTH DIRECTIONS EVERYWHERE. Each refusal below is paired with the write that
-- must SUCCEED. A table whose GRANTs were revoked, or a broken connection,
-- answers "denied" exactly as convincingly as a working constraint — and a
-- deny-only probe cannot tell those apart (docs/mistakes/tooling-proofs.md).
--
-- RUN BEFORE 0183 WAS APPLIED and it failed at 00 — the table did not exist —
-- then green after. Every row is INSIDE the transaction and rolled back; this
-- proof writes nothing that survives it.
--
--   node tools/db-query.mjs tools/team0183-discord-mapping.sql
-- ============================================================
begin;

create temporary table probe (step text, expected text, got text) on commit drop;

-- ── Instrument ──────────────────────────────────────────────────────────────
-- Three answers, not two: a constraint refuses by RAISING, RLS refuses by
-- matching zero rows, and a missing GRANT raises differently again. Scoring
-- them the same is how a broken service reads as a working guard.
create or replace function pg_temp.attempt(p_sql text)
returns text as $$
declare n int; msg text;
begin
  begin
    execute p_sql;
    get diagnostics n = row_count;
    return case when n > 0 then 'ok' else 'deny-rls' end;
  exception when others then
    get stacked diagnostics msg = message_text;
    return case
      when msg like '%duplicate key%'      then 'deny-unique'
      when msg like '%permission denied%'  then 'deny-grant'
      when msg like '%violates row-level%' then 'deny-check'
      when msg like '%violates foreign%'   then 'deny-fk'
      else 'ERROR ' || left(msg, 48) end;
  end;
end $$ language plpgsql;

-- As anon, holding the public key and nothing else.
create or replace function pg_temp.as_anon(p_sql text)
returns text as $$
declare v text; msg text;
begin
  begin
    perform set_config('request.jwt.claims', null, true);
    execute 'set local role anon';
    execute p_sql into v;
    execute 'reset role';
    return coalesce(v, '(null)');
  exception when others then
    get stacked diagnostics msg = message_text;
    execute 'reset role';
    return case when msg like '%permission denied%' then 'deny-grant'
                else 'ERROR ' || left(msg, 48) end;
  end;
end $$ language plpgsql;

-- ── Subjects ────────────────────────────────────────────────────────────────
-- Two REAL people from the registry. Not created here: a proof that invents its
-- own subject proves the constraint against a shape the application never
-- produces, and people_kkumail_uniq plus the full_name trigger mean a
-- hand-built person is not the same object the app writes.
create temporary table subj on commit drop as
select id, row_number() over (order by id) as n from public.people order by id limit 2;

insert into probe select '00. two real people exist to link', '2',
  (select count(*)::text from subj);

-- ── §0 the subject is what this proof thinks it is ──────────────────────────
-- Read from pg_class / information_schema, the authorities — never from the
-- migration that wrote them.
insert into probe select '01. discord_links has row security ON', 'true',
  coalesce((select c.relrowsecurity::text from pg_class c
              join pg_namespace n on n.oid = c.relnamespace
             where n.nspname = 'public' and c.relname = 'discord_links'), '(no table)');

insert into probe select '02. team_nodes carries both new columns', 'discord_role,discord_role_id',
  coalesce((select string_agg(column_name, ',' order by column_name)
              from information_schema.columns
             where table_schema = 'public' and table_name = 'team_nodes'
               and column_name in ('discord_role', 'discord_role_id')), '(none)');

-- The tick-box must default to FALSE. A boolean that defaulted true would mean
-- every ตำแหน่ง created after today silently asks for its own Discord role.
insert into probe select '03. the tick-box defaults to false', 'false',
  coalesce((select column_default from information_schema.columns
             where table_schema = 'public' and table_name = 'team_nodes'
               and column_name = 'discord_role'), '(none)');

-- ── §A IDENTITY: one person, one account — in BOTH directions ───────────────
-- The ALLOW half first. Without it every refusal below is satisfied just as
-- well by a table nothing can write at all.
insert into probe select '10. a person CAN be linked', 'ok',
  pg_temp.attempt($q$insert into public.discord_links (person_id, discord_user_id)
                     select id, '100000000000000001' from subj where n = 1$q$);

-- A person holding two Discord accounts. Refused by the primary key — which is
-- why person_id IS the key rather than a surrogate id with an index beside it.
insert into probe select '11. …but not to a SECOND account', 'deny-unique',
  pg_temp.attempt($q$insert into public.discord_links (person_id, discord_user_id)
                     select id, '100000000000000002' from subj where n = 1$q$);

-- The direction that matters for access: linking to somebody else's Discord
-- account would inherit their roles. Refused by discord_links_user_uniq.
insert into probe select '12. …and a second person cannot claim that account', 'deny-unique',
  pg_temp.attempt($q$insert into public.discord_links (person_id, discord_user_id)
                     select id, '100000000000000001' from subj where n = 2$q$);

-- The control for 12: the SAME second person, a DIFFERENT account, succeeds.
-- Without this, 12 passes equally well if person 2 simply cannot be written.
insert into probe select '13. …though that person links fine to their own', 'ok',
  pg_temp.attempt($q$insert into public.discord_links (person_id, discord_user_id)
                     select id, '100000000000000003' from subj where n = 2$q$);

-- The snowflake must survive as it was written. 19 digits is past 2^53, so any
-- path that rounds it through a float points the bot at a user who does not
-- exist — and "the bot ignores one person" is invisible.
insert into probe select '14. a 19-digit snowflake is stored exactly', '100000000000000003',
  (select discord_user_id from public.discord_links dl
     join subj s on s.id = dl.person_id where s.n = 2);

-- ── §B ROLES: two nodes may share a NAME, never a role ──────────────────────
-- This is the six-เหรัญญิก bug, asserted. §B0 first proves the collision is
-- REAL on this database rather than a story from a design document — if the org
-- is ever restructured so no name repeats, this line goes red and tells the
-- reader the scenario changed, instead of passing while testing nothing.
insert into probe select '20. duplicate ตำแหน่ง names really exist', 'true',
  (select (count(*) > 0)::text from (
     select name from public.team_nodes group by name having count(*) > 1) d);

create temporary table twins on commit drop as
select id, row_number() over (order by id) as n
  from public.team_nodes
 where name = (select name from public.team_nodes
                group by name having count(*) > 1 order by count(*) desc, name limit 1);

insert into probe select '21. …and the worst one is held by 2+ nodes', 'true',
  (select (count(*) > 1)::text from twins);

insert into probe select '22. one of the twins CAN be mapped to a role', 'ok',
  pg_temp.attempt($q$update public.team_nodes set discord_role_id = '200000000000000001'
                      where id = (select id from twins where n = 1)$q$);

-- The whole point. Under the old name-matching bot these two nodes resolved to
-- one Discord role; here the second claim is refused by the database.
insert into probe select '23. …and its same-named twin CANNOT take the same one', 'deny-unique',
  pg_temp.attempt($q$update public.team_nodes set discord_role_id = '200000000000000001'
                      where id = (select id from twins where n = 2)$q$);

insert into probe select '24. …but it takes a role of its OWN', 'ok',
  pg_temp.attempt($q$update public.team_nodes set discord_role_id = '200000000000000002'
                      where id = (select id from twins where n = 2)$q$);

-- NULL is not a value. Every node that has not been provisioned yet is NULL,
-- and a unique index that treated those as equal would allow exactly one
-- unprovisioned node in the entire tree.
insert into probe select '25. many nodes may share "no role yet"', 'true',
  (select (count(*) > 1)::text from public.team_nodes where discord_role_id is null);

-- ── §C the MANAGED set is derived, never listed ─────────────────────────────
-- §5d: the roles the reconciler may remove are exactly the non-null values of
-- discord_role_id. Master, Waiting room, moderators and bot integrations are
-- absent from it and are therefore untouchable BY CONSTRUCTION — there is no
-- exclusion list to forget to update when somebody adds a role next month.
-- This asserts the property that makes that true: the column holds nothing but
-- snowflakes, so it can never be matched against a name.
insert into probe select '30. every mapped value is a bare snowflake', '(none bad)',
  coalesce((select string_agg(discord_role_id, ',')
              from public.team_nodes
             where discord_role_id is not null
               and discord_role_id !~ '^[0-9]{15,25}$'), '(none bad)');

-- ── §D the public key reaches none of it ────────────────────────────────────
-- Who is in the Discord server is not public information, and the anon key is
-- printed in every bundle.
insert into probe select '40. anon cannot read discord_links', 'deny-grant',
  pg_temp.as_anon($q$select count(*)::text from public.discord_links$q$);

-- `returning` so as_anon's INTO has something to read: without it plpgsql
-- raises on the SHAPE of the statement rather than on the GRANT, and the proof
-- reports a refusal it never actually tested. (It did exactly that on the first
-- run — 'INSERT has more target columns than expressions' scored as a FAIL,
-- which is the right outcome only by accident.)
insert into probe select '41. anon cannot write discord_links', 'deny-grant',
  pg_temp.as_anon($q$insert into public.discord_links (person_id, discord_user_id)
                     values ('00000000-0000-0000-0000-000000000001', '900000000000000001')
                     returning discord_user_id$q$);

-- The ALLOW half of §D, and the reason it is not enough to stop at 40: anon
-- legitimately reads the PUBLIC org chart, so this proves the lockdown was
-- aimed at the new table rather than applied to the tree by accident.
insert into probe select '42. …while the public org chart still answers', 'true',
  (select (jsonb_array_length(public.get_public_team_chart()->'nodes') > 0)::text);

-- ── §E the seed is a starting point, not a verdict ──────────────────────────
-- 0183 ticks only ฝ่าย and the คณะกรรมการ positions the owner had already
-- marked — never a name pattern. These two say the seed RAN and that it did not
-- run away with the whole tree; if a later edit turned the seed into "tick
-- everything", 51 would go red.
insert into probe select '50. the seed ticked something', 'true',
  (select (count(*) > 0)::text from public.team_nodes where discord_role);

insert into probe select '51. …and left the majority untouched', 'true',
  (select (count(*) filter (where not discord_role) > count(*) filter (where discord_role))::text
     from public.team_nodes);

-- No hidden node got a role. อาจารย์ / เจ้าหน้าที่คณะ are not in the student
-- Discord, and a ticked hidden node would hand them a channel.
insert into probe select '52. no is_public=false node was ticked', '0',
  (select count(*)::text from public.team_nodes where discord_role and not is_public);

select step,
       case when got is not distinct from expected then 'PASS' else 'FAIL' end as result,
       expected, got
  from probe order by step;

rollback;
