-- ============================================================
-- team0185-link-codes.sql — a link code proves a live portal session, is good
-- once, and cannot be used to take over somebody else's Discord account.
--
-- 0185 replaces the old bot's `!verify <last 5 digits of รหัสนักศึกษา>`, which
-- would have handed over a person's roles AND their channels on a number that
-- is printed on their ID card. §D is the assertion that the replacement cannot
-- be turned back into that: the code must be UNGUESSABLE, SINGLE-USE, EXPIRING,
-- and unable to move a link that already belongs to someone else.
--
-- BOTH DIRECTIONS THROUGHOUT. Every refusal is paired with the call that must
-- SUCCEED — a definer function that raises for everyone refuses just as
-- convincingly as one that works, and a deny-only probe cannot tell a working
-- guard from a broken service (docs/mistakes/tooling-proofs.md).
--
-- ⚠️ THE DENY-ALL TABLE IS THE TRAP HERE. discord_link_codes has RLS and NO
-- policy on purpose — it holds live bearer tokens and nobody should read it,
-- not even their own row. That is indistinguishable from a table nothing can
-- reach, so §B pairs "no client can select it" with "the definer functions
-- still do" (0138).
--
--   node tools/db-query.mjs tools/team0185-link-codes.sql
-- ============================================================
begin;

create temporary table probe (step text, expected text, got text) on commit drop;

-- ── Subject ────────────────────────────────────────────────────────────────
-- ⛔ my_person_id() DOES NOT READ THE JWT'S EMAIL. It reads
-- current_user_email(), which is `select email from public.users where id =
-- auth.uid()` — so a synthetic JWT with an email claim resolves to NOTHING, and
-- the first draft of this proof failed at step 10 with the real function
-- working perfectly. public.users.id is also FK'd to auth.users, so a fabricated
-- account is not an option either.
--
-- So the subject is a REAL signed-in account that has no registry row — 469 of
-- 628 accounts are in that state, so the scenario cannot run out — and the test
-- person is created carrying THAT account's email as their kkumail. Every
-- lookup below then travels the path the portal really travels.
create temporary table acct on commit drop as
select u.id as uid, u.email, row_number() over (order by u.id) as n
  from public.users u
 where u.email is not null
   and not exists (select 1 from public.people p
                    where lower(btrim(p.kkumail)) = lower(btrim(u.email)))
 order by u.id limit 2;

insert into public.people (full_name, kkumail)
select 'ผู้ทดสอบ ลิงก์ ' || n, email from acct;

create temporary table who on commit drop as
select p.id from public.people p join acct a on lower(btrim(p.kkumail)) = lower(btrim(a.email))
 where a.n = 1;

create temporary table who2 on commit drop as
select p.id from public.people p join acct a on lower(btrim(p.kkumail)) = lower(btrim(a.email))
 where a.n = 2;

-- Sign in AS that account — by uid, which is what auth.uid() returns and what
-- current_user_email() joins on.
create or replace function pg_temp.as_uid(p_uid uuid, p_sql text)
returns text as $$
declare v text; msg text;
begin
  begin
    perform set_config('request.jwt.claims',
      json_build_object('sub', coalesce(p_uid::text, ''), 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    execute p_sql into v;
    execute 'reset role';
    return coalesce(v, '(null)');
  exception when others then
    get stacked diagnostics msg = message_text;
    execute 'reset role';
    return case when msg like '%permission denied%' then 'deny-grant'
                when msg like '%ต้องเข้าสู่ระบบ%'    then 'deny-not-in-registry'
                else 'ERROR ' || left(msg, 44) end;
  end;
end $$ language plpgsql;

create or replace function pg_temp.try(p_sql text)
returns text as $$
declare v text; msg text;
begin
  begin execute p_sql into v; return coalesce(v, '(null)');
  exception when others then
    get stacked diagnostics msg = message_text;
    return 'RAISED: ' || left(msg, 44);
  end;
end $$ language plpgsql;

-- ── §0 the subject is what this proof thinks it is ─────────────────────────
insert into probe select '00. two real accounts with no registry row exist', '2',
  (select count(*)::text from acct);

insert into probe select '00b. …and each now has a test person', '1',
  (select count(*)::text from who);

insert into probe select '01. the codes table has row security ON', 'true',
  (select c.relrowsecurity::text from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'discord_link_codes');

-- Deny-all by design: a policy appearing here later is a widening, not a tidy-up.
insert into probe select '02. …and NO policy on it, deliberately', '0',
  (select count(*)::text from pg_policies
    where schemaname = 'public' and tablename = 'discord_link_codes');

-- ── §A issuing, as the signed-in person ────────────────────────────────────
insert into probe select '10. a signed-in person CAN mint a code', 'true',
  (select pg_temp.as_uid((select uid from acct where n = 1),
    $q$select (issue_discord_link_code() ~ '^[0-9A-F]{5}-[0-9A-F]{5}$')::text$q$));

-- The control that makes 10 mean something: an account with no registry row is
-- refused, and refused with the message that says WHICH thing is wrong.
-- The control that makes 10 mean something: an account whose email is in NO
-- registry row is refused, with the message naming WHICH of the two things is
-- wrong. 469 of 628 real accounts are in exactly this state today.
insert into probe select '11. …and an account with no registry row cannot', 'deny-not-in-registry',
  (select pg_temp.as_uid((select u.id from public.users u
                           where u.email is not null
                             and not exists (select 1 from public.people p
                                              where lower(btrim(p.kkumail)) = lower(btrim(u.email)))
                           order by u.id desc limit 1),
    $q$select issue_discord_link_code()$q$));

-- HEX, so the alphabet cannot contain O, I or L — the characters a human
-- retyping from another screen confuses with 0 and 1.
insert into probe select '12. the alphabet excludes O/I/L by construction', '0',
  (select count(*)::text from public.discord_link_codes where code ~ '[OIL]');

-- ONE live code per person. Re-opening the screen must invalidate the last one,
-- or the trail of still-valid bearer tokens grows all day.
-- Mint as the PERSON; count as the superuser. The count cannot run inside
-- as_uid — `authenticated` holds no grant on this table, which is the point of
-- §B — and the first draft did exactly that and reported deny-grant.
insert into probe select '13. minting again succeeds', 'true',
  (select pg_temp.as_uid((select uid from acct where n = 1),
                         $q$select issue_discord_link_code()$q$) is not null)::text;

insert into probe select '13b. …counted from outside the grant boundary', '1',
  (select count(*)::text from public.discord_link_codes
    where person_id = (select id from who) and used_at is null);

-- ── §B the table is unreadable, and the door still opens ───────────────────
-- 'deny-grant', not '0'. The REVOKE is what refuses, before RLS is consulted at
-- all — and saying so matters, because "RLS with no policy" and "no GRANT" are
-- two different mechanisms and only one of them survives a later `grant select`
-- somebody adds while adding a policy (0138).
insert into probe select '20. a signed-in person cannot READ the codes', 'deny-grant',
  (select pg_temp.as_uid((select uid from acct where n = 1),
    $q$select count(*)::text from public.discord_link_codes$q$));

insert into probe select '21. …and neither grant exists to be relied on', 'false,false',
  (select string_agg(has_table_privilege(r, 'public.discord_link_codes', 'select')::text, ',' order by r)
     from unnest(array['anon','authenticated']) r);

-- The ALLOW half. Without it, §20 is satisfied by a table nothing can reach —
-- which is also what a broken feature looks like (0138).
insert into probe select '22. …while the definer path still sees it', 'true',
  (select (count(*) >= 1)::text from public.discord_link_codes);

-- ── §C redeeming ───────────────────────────────────────────────────────────
create temporary table live on commit drop as
select code from public.discord_link_codes
 where person_id = (select id from who) and used_at is null;

insert into probe select '30. a live code links the person', 'true',
  pg_temp.try(format($q$select (public.redeem_discord_link_code(%L, '910000000000000001')
                               = (select id from who))::text$q$,
                     (select code from live)));

insert into probe select '31. …and the link is actually written', '910000000000000001',
  (select discord_user_id from public.discord_links where person_id = (select id from who));

-- SINGLE USE. This is the assertion that stops a code shared in a group chat
-- from linking three people.
insert into probe select '32. the SAME code cannot be used twice', 'true',
  (position('ถูกใช้ไปแล้ว' in
    pg_temp.try(format($q$select public.redeem_discord_link_code(%L, '910000000000000002')::text$q$,
                       (select code from live)))) > 0)::text;

insert into probe select '33. a code that never existed is refused', 'true',
  (position('รหัสไม่ถูกต้อง' in
    pg_temp.try($q$select public.redeem_discord_link_code('DEADB-EEF00', '910000000000000003')::text$q$)) > 0)::text;

-- ── §D the takeover the old design would have allowed ──────────────────────
-- A second person with a VALID code of their own must NOT be able to claim a
-- Discord account that already belongs to someone else. Under `!verify` the
-- equivalent required only knowing five digits off an ID card.
insert into probe select '40. the second person mints their own code', 'true',
  (select pg_temp.as_uid((select uid from acct where n = 2),
    $q$select (issue_discord_link_code() is not null)::text$q$));

insert into probe select '41. …and CANNOT take the first person''s Discord account', 'true',
  (position('เชื่อมกับคนอื่น' in
   pg_temp.try(format($q$select public.redeem_discord_link_code(%L, '910000000000000001')::text$q$,
    (select code from public.discord_link_codes
      where person_id = (select id from who2) and used_at is null)))) > 0)::text;

-- The CONTROL for 41: the same person, an UNUSED Discord account, succeeds. So
-- 41 is a refusal about the TARGET, not a code that had stopped working.
insert into probe select '42. …but links fine to an unclaimed account', 'true',
  pg_temp.try(format($q$select (public.redeem_discord_link_code(%L, '910000000000000009') is not null)::text$q$,
    (select code from public.discord_link_codes
      where person_id = (select id from who2) and used_at is null)));

-- ── §E the grant boundary ──────────────────────────────────────────────────
insert into probe select '50. anon cannot issue', 'false',
  (select has_function_privilege('anon', 'public.issue_discord_link_code()', 'execute')::text);

-- Bot-only. A signed-in student's only use for redeem() would be binding a code
-- to a Discord account other than the one that typed it.
insert into probe select '51. authenticated cannot REDEEM', 'false',
  (select has_function_privilege('authenticated',
     'public.redeem_discord_link_code(text,text)', 'execute')::text);

insert into probe select '52. …though it CAN issue', 'true',
  (select has_function_privilege('authenticated',
     'public.issue_discord_link_code()', 'execute')::text);

-- ── §G re-linking to a DIFFERENT account, without unlinking first ──────────
-- ⛔ THE ONE BRANCH A REAL HUMAN DID NOT REACH. The owner completed the round
-- trip on 2026-09-12 as link → UNLINK → link, so `on conflict (person_id) do
-- update` never ran: the surviving row had linked_at = updated_at. People lose
-- Discord accounts and will re-link without thinking to unlink, and the wrong
-- behaviour here is not an error — it is a SECOND row, or a silent no-op that
-- leaves the sync pointing at an account the person no longer has.
create temporary table before_g on commit drop as
select discord_user_id, updated_at from public.discord_links where person_id = (select id from who);

insert into probe select '70. the subject is linked to start with', '910000000000000001',
  (select discord_user_id from before_g);

insert into probe select '71. re-linking to a NEW account succeeds', 'true',
  (select pg_temp.as_uid((select uid from acct where n = 1),
                         $q$select issue_discord_link_code()$q$) is not null)::text;

insert into probe select '72. …and the row is REPLACED, not added', 'true',
  pg_temp.try(format($q$select (public.redeem_discord_link_code(%L, '910000000000000077') is not null)::text$q$,
    (select code from public.discord_link_codes
      where person_id = (select id from who) and used_at is null)));

insert into probe select '73. exactly ONE row for that person', '1',
  (select count(*)::text from public.discord_links where person_id = (select id from who));

insert into probe select '74. …and it points at the NEW account', '910000000000000077',
  (select discord_user_id from public.discord_links where person_id = (select id from who));

-- ⛔ THE TIMING OF updated_at IS NOT OBSERVABLE FROM IN HERE, and two drafts
-- tried before that was understood. `now()` is the TRANSACTION timestamp, so an
-- upsert later in the same transaction writes the value the insert already had;
-- backdating the row first does not help either, because 0183's
-- touch_discord_links_updated_at trigger rewrites it to now() on any UPDATE.
-- Both drafts read "false" as the function forgetting the column. It had not —
-- the instrument could not see time pass, which is the shape in
-- docs/mistakes/tooling-proofs.md where a proof needs geometry it cannot have.
--
-- So assert the MECHANISM, which is what actually guarantees the behaviour in
-- production: updated_at belongs to the TABLE, not to each writer remembering
-- it. A future writer that forgets cannot break it, and a dropped trigger goes
-- red here instead of silently freezing every link's date.
insert into probe select '75. updated_at is maintained by a TRIGGER, not by callers', 'touch_updated_at',
  coalesce((select p.proname from pg_trigger t
              join pg_proc p on p.oid = t.tgfoid
             where t.tgrelid = 'public.discord_links'::regclass
               and not t.tgisinternal
             limit 1), '(none)');

-- And the old account is genuinely released, so its real owner can claim it.
insert into probe select '76. the OLD account is free for its real owner', '0',
  (select count(*)::text from public.discord_links where discord_user_id = '910000000000000001');

select step,
       case when got is not distinct from expected then 'PASS' else 'FAIL' end as result,
       expected, got
  from probe order by step;

rollback;
