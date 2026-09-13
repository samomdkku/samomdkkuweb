-- ============================================================
-- team0187-orphaned-accounts.sql — a Discord account that stops being claimed
-- must leave a trace, through EVERY door that can un-claim it.
--
-- WHAT THIS IS DEFENDING. `discord-apply.mjs` implements §5e "never act on
-- absence" as `if (!t) continue;` — a guild member with no link is UNKNOWN and
-- is not in the plan at all. Correct for someone who never linked; wrong for
-- someone who WAS linked, was given ฝ่าย roles for it, and is not linked now,
-- because both states are an absent row. Before 0187 those roles could never be
-- removed by anything.
--
-- THREE DOORS, and the third is the one a fix-per-statement misses:
--   1. unlink            → DELETE
--   2. person deleted    → CASCADE DELETE
--   3. re-link elsewhere → UPDATE of discord_user_id
--
-- BOTH DIRECTIONS EVERYWHERE. Each "a tombstone appears" is paired with the
-- case that must NOT leave one, and with the withdrawal — a tombstone that
-- cannot be removed becomes a permanent false claim the moment somebody
-- re-links (the no-TTL shape from 0167).
--
-- RUN BEFORE 0187 AND IT FAILS AT 01 — the table does not exist. Everything is
-- inside the transaction and rolled back.
--
--   node tools/db-query.mjs tools/team0187-orphaned-accounts.sql
-- ============================================================
begin;

create temporary table probe (step text, expected text, got text) on commit drop;

-- ── Subjects ────────────────────────────────────────────────────────────────
-- Real registry people, so the FK and the cascade behave as they do in life.
-- Their own link rows are created here and rolled back.
create temporary table subj on commit drop as
select id, row_number() over (order by id) as n
  from public.people
 where id not in (select person_id from public.discord_links)
 order by id limit 2;

insert into probe select '00. two real people are available as subjects', '2',
  (select count(*)::text from subj);

insert into probe select '01. the tombstone table exists', 'true',
  (select (to_regclass('public.discord_orphaned_accounts') is not null)::text);

-- `to_regclass` rather than `'public.x'::regclass`, which RAISES on a missing
-- relation. It does NOT make this proof runnable without 0187 — every later
-- assertion selects from the table by name, so the script cannot plan at all —
-- and the pre-migration run is an HTTP 400 naming the relation, which is where
-- the ritual's "watch it fail" lands. That is scored correctly: run-proofs.mjs
-- turns a non-zero exit into FAIL ("errored: …") rather than silence, checked
-- at tools/run-proofs.mjs:265. What the guard buys is that 02 and 03 answer
-- `(no table)` instead of aborting mid-way through a run that HAS the table but
-- lost it to a later migration — the case where a half-finished report is worse
-- than a clean one.
insert into probe select '02. …with row security ON and no policy', 'true,0',
  coalesce((select (c.relrowsecurity)::text || ',' ||
                   (select count(*)::text from pg_policy where polrelid = c.oid)
              from pg_class c
             where c.oid = to_regclass('public.discord_orphaned_accounts')), '(no table)');

insert into probe select '03. …and neither browser role may read it', 'false,false',
  coalesce((select has_table_privilege('anon', c.oid, 'select')::text || ',' ||
                   has_table_privilege('authenticated', c.oid, 'select')::text
              from pg_class c
             where c.oid = to_regclass('public.discord_orphaned_accounts')), '(no table)');

-- ── §A linking leaves no tombstone ──────────────────────────────────────────
insert into public.discord_links (person_id, discord_user_id)
values ((select id from subj where n = 1), '870000000000000001');

insert into probe select '10. a fresh link orphans nothing', '0',
  (select count(*)::text from public.discord_orphaned_accounts
    where discord_user_id = '870000000000000001');

-- ── §B door 1 — unlink ──────────────────────────────────────────────────────
delete from public.discord_links where discord_user_id = '870000000000000001';

insert into probe select '20. DOOR 1 unlink leaves a tombstone', '1',
  (select count(*)::text from public.discord_orphaned_accounts
    where discord_user_id = '870000000000000001');

insert into probe select '21. …naming who it used to be', 'true',
  (select (person_id = (select id from subj where n = 1))::text
     from public.discord_orphaned_accounts where discord_user_id = '870000000000000001');

-- ⛔ THE WITHDRAWAL. Without this the tombstone is a claim with no expiry: the
-- person re-links, the account is live again, and the report keeps naming it
-- for ever (0167's "latest reading with no TTL looks like a fact").
insert into public.discord_links (person_id, discord_user_id)
values ((select id from subj where n = 1), '870000000000000001');

insert into probe select '22. …and re-linking the SAME account withdraws it', '0',
  (select count(*)::text from public.discord_orphaned_accounts
    where discord_user_id = '870000000000000001');

-- ── §C door 3 — re-link to a DIFFERENT account (an UPDATE, not a delete) ────
-- The door an `after delete` trigger would have missed entirely.
update public.discord_links set discord_user_id = '870000000000000002'
 where person_id = (select id from subj where n = 1);

-- ⚠️ 30 AND 31 ARE A PAIR, AND 31 IS THE LOAD-BEARING HALF. Measured against a
-- trigger reduced to AFTER DELETE: 30 still PASSED, because §B's tombstone for
-- this same account was never withdrawn (22 caught that) and happened to
-- satisfy the count. 31 is what fails, because the `reason` is then the
-- delete-door's rather than the re-link's. Counting rows is not enough when an
-- earlier step can leave one behind.
insert into probe select '30. DOOR 3 re-link orphans the OLD account', '1',
  (select count(*)::text from public.discord_orphaned_accounts
    where discord_user_id = '870000000000000001');

insert into probe select '31. …and says so, distinguishably from an unlink', 're-linked',
  (select reason from public.discord_orphaned_accounts
    where discord_user_id = '870000000000000001');

insert into probe select '32. …while the NEW account is not orphaned', '0',
  (select count(*)::text from public.discord_orphaned_accounts
    where discord_user_id = '870000000000000002');

-- An UPDATE that does not move the account must orphan nothing. Without this,
-- a trigger firing on every UPDATE would tombstone a live link on any unrelated
-- edit — green on the tests above and wrong in production.
update public.discord_links set updated_at = now()
 where person_id = (select id from subj where n = 1);

insert into probe select '33. an unrelated UPDATE orphans nothing', '0',
  (select count(*)::text from public.discord_orphaned_accounts
    where discord_user_id = '870000000000000002');

-- ── §D door 2 — the person is deleted, and the link cascades ────────────────
-- ⛔ THE TOMBSTONE MUST SURVIVE THE CASCADE. A foreign key on person_id would
-- be the natural thing to write and would delete this row as part of the very
-- event it exists to witness.
insert into public.discord_links (person_id, discord_user_id)
values ((select id from subj where n = 2), '870000000000000003');

insert into probe select '40. the second subject is linked', '1',
  (select count(*)::text from public.discord_links
    where discord_user_id = '870000000000000003');

delete from public.people where id = (select id from subj where n = 2);

insert into probe select '41. DOOR 2 person deleted cascades the link away', '0',
  (select count(*)::text from public.discord_links
    where discord_user_id = '870000000000000003');

insert into probe select '42. …and the tombstone SURVIVES the cascade', '1',
  (select count(*)::text from public.discord_orphaned_accounts
    where discord_user_id = '870000000000000003');

insert into probe select '43. …with a dangling person_id, which is allowed', 'true',
  (select (person_id is not null
           and not exists (select 1 from public.people p where p.id = person_id))::text
     from public.discord_orphaned_accounts where discord_user_id = '870000000000000003');

-- ── §E the point of all of it ───────────────────────────────────────────────
-- An orphaned account is now DISTINGUISHABLE from one that never linked, which
-- is the whole reason this exists. Before 0187 both answered "no row anywhere".
insert into probe select '50. an orphan is distinguishable from a stranger', 'orphan,stranger',
  (select
     (case when exists (select 1 from public.discord_orphaned_accounts
                         where discord_user_id = '870000000000000003')
           then 'orphan' else 'stranger' end)
     || ',' ||
     (case when exists (select 1 from public.discord_orphaned_accounts
                         where discord_user_id = '879999999999999999')
           then 'orphan' else 'stranger' end));

-- CONTROL for 50: it must be able to answer 'stranger'. An expression that
-- always said 'orphan' would pass the left half for ever.
insert into probe select '51. …and the right half really can say stranger', 'stranger',
  (select case when exists (select 1 from public.discord_orphaned_accounts
                             where discord_user_id = '870000000000000000')
               then 'orphan' else 'stranger' end);

select step,
       case when got is not distinct from expected then 'PASS' else 'FAIL' end as result,
       expected, got
  from probe order by step;

rollback;
