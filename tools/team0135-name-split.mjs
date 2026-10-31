#!/usr/bin/env node
// ============================================================
// team0135-name-split.mjs — the split reaches all three, and nothing guesses.
//
// 0135 closes the one gap 0132/0133 left open: a name edited in ทีม SAMO could
// not reach ระบบบ้าน, because ทีม SAMO stored one string and ระบบบ้าน stores two,
// and the only way to convert is to guess where the surname starts.
//
// ALLOW — the split propagates in every direction:
//   A1  parts written on team_members derive full_name
//   A2  a ทีม SAMO split edit reaches the registry AS A SPLIT
//   A3  …and lands in ระบบบ้าน (this is the gap that was open)
//   A4  a ระบบบ้าน split edit lands in ทีม SAMO as two columns + the whole
//   A5  update_my_identity writes the split without reconstructing it
//   A6  a member may edit their OWN ชื่อ / นามสกุล (the allow-list grew)
//   A7  get_my_team_seat() publishes the two new keys
//
// DENY — nothing manufactures a boundary:
//   D1  a COMBINED edit in ทีม SAMO never overwrites a person's SPLIT
//   D2  …and never overwrites ระบบบ้าน's first_name_th either
//   D3  a legacy combined name is not blanked by an unrelated edit
//   D4  sai_code is still never mirrored (0132's invariant, re-checked because
//       this migration rewrote both mirrors)
//   D5  a member still may NOT edit an admin-owned column
//
// The deny half is the point. Every failure this migration exists to prevent is
// a WRITE THAT SUCCEEDS with the wrong value, so a probe that only checks that
// syncing works would pass on the broken version too.
//
// Runs inside a transaction it ROLLS BACK.
// ============================================================
import { writeFileSync, unlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SQL = `
begin;

create temporary table probe(step text, expected text, got text);

-- A person who exists in BOTH systems — the only case where a mirror can be
-- observed at all.
create temporary table subj as
select p.id as pid, p.kkumail,
       (select s.id from public.students s where s.person_id = p.id limit 1)     as sid,
       (select m.id from public.team_members m where m.person_id = p.id limit 1) as mid,
       (select s.sai_code from public.students s where s.person_id = p.id limit 1) as sai0
  from public.people p
 where exists (select 1 from public.students s where s.person_id = p.id)
   and exists (select 1 from public.team_members m where m.person_id = p.id)
 limit 1;

insert into probe values ('A0. found a person in both systems', '1',
  (select count(*)::text from subj));

-- ---- A1/A2/A3 — the ทีม SAMO door, with a split ----
update public.team_members
   set first_name_th = 'สมชาย', last_name_th = 'ณ อยุธยา'
 where id = (select mid from subj);

insert into probe
select 'A1. parts derive full_name on team_members', 'สมชาย ณ อยุธยา',
       coalesce((select m.full_name from public.team_members m
                  where m.id = (select mid from subj)), '(none)');

insert into probe
select 'A2. the split reaches the registry', 'สมชาย|ณ อยุธยา',
       coalesce((select p.first_name_th || '|' || p.last_name_th from public.people p
                  where p.id = (select pid from subj)), '(none)');

insert into probe
select 'A3. …and lands in ระบบบ้าน as two columns', 'สมชาย|ณ อยุธยา',
       coalesce((select s.first_name_th || '|' || s.last_name_th from public.students s
                  where s.id = (select sid from subj)), '(none)');

-- ---- D1/D2 — a COMBINED edit must not overwrite a split ----
-- This is the case that renames a real person if it is got wrong. The row now
-- holds a split; writing only full_name (as a pre-0135 form or an old CSV would)
-- must leave both columns exactly as they are on BOTH sides.
update public.team_members set full_name = 'ชื่อรวมช่องเดียว'
 where id = (select mid from subj);

insert into probe
select 'D1. combined edit leaves the registry split intact', 'สมชาย|ณ อยุธยา',
       coalesce((select p.first_name_th || '|' || p.last_name_th from public.people p
                  where p.id = (select pid from subj)), '(none)');

insert into probe
select 'D2. …and ระบบบ้าน keeps its first_name_th', 'สมชาย',
       coalesce((select s.first_name_th from public.students s
                  where s.id = (select sid from subj)), '(none)');

-- ---- A4 — the ระบบบ้าน door ----
update public.students
   set first_name_th = 'มานี', last_name_th = 'ใจดี'
 where id = (select sid from subj);

insert into probe
select 'A4. ระบบบ้าน split lands in ทีม SAMO (parts)', 'มานี|ใจดี',
       coalesce((select m.first_name_th || '|' || m.last_name_th from public.team_members m
                  where m.id = (select mid from subj)), '(none)');

insert into probe
select 'A4b. …and rebuilds its full_name', 'มานี ใจดี',
       coalesce((select m.full_name from public.team_members m
                  where m.id = (select mid from subj)), '(none)');

-- ---- D4 — identity only, still ----
insert into probe
select 'D4. sai_code never mirrored', coalesce((select sai0 from subj), '(null)'),
       coalesce((select s.sai_code from public.students s
                  where s.id = (select sid from subj)), '(null)');

-- ---- D3 — a legacy combined row survives an unrelated edit ----
-- The trigger only derives full_name when a part is present. A member with no
-- split editing their ชื่อเล่น must keep the name they have; blanking it would
-- be the worst possible outcome of this migration and the easiest to ship.
create temporary table legacy as
select m.id, m.full_name from public.team_members m
 where m.first_name_th is null and m.last_name_th is null
   and coalesce(btrim(m.full_name), '') <> ''
 limit 1;

update public.team_members set nickname = 'แก้เฉพาะชื่อเล่น'
 where id = (select id from legacy);

insert into probe
select 'D3. legacy combined name survives an unrelated edit',
       coalesce((select full_name from legacy), '(no legacy row)'),
       coalesce((select m.full_name from public.team_members m
                  where m.id = (select id from legacy)),
                (select '(no legacy row)' from legacy having count(*) = 0));

-- ---- A5/A6/A7/D5 — the person's own card ----
-- WHO IS CREATED, NOT FOUND. The old version searched for a student+login+
-- team_members triple that happened to already exist — on production nothing
-- satisfies all three at once today (A5 came back '(none)': subject drift,
-- not a bug), so the proof went quietly dark on the exact case it exists to
-- protect (class 7, the mirror of "the setup is blocked by the thing being
-- tested": a search can go EMPTY just as easily as it can go vacuously green).
-- update_my_identity/get_my_team_seat resolve "self" purely through
-- public.users.email → students.kkumail / team_members.kkumail (0145 §5/§6,
-- no role branch) — so ANY login can BE subj for the life of this rolled-back
-- transaction. Reuse subj's own login if it has one; otherwise borrow any
-- other account's identity and point its email at subj's for the duration.
create temporary table carrier as
select coalesce(
  (select id from public.users
    where lower(btrim(email)) = lower(btrim((select kkumail from subj))) limit 1),
  (select id from public.users order by id limit 1)
) as uid;

update public.users set email = (select kkumail from subj)
 where id = (select uid from carrier)
   and lower(btrim(email)) is distinct from lower(btrim((select kkumail from subj)));

create temporary table who as
select (select kkumail from subj) as kkumail, (select uid from carrier) as uid;
grant select on who to authenticated;
grant insert, select on probe to authenticated;

select set_config('role','authenticated',true),
       set_config('request.jwt.claims',
         json_build_object('sub',(select uid::text from who),'role','authenticated')::text, true);
set local role authenticated;

-- A5 — the RPC takes the two parts and never reassembles them from a whole.
select public.update_my_identity('{"first_name_th":"ปิติ","last_name_th":"รัก เรียน"}'::jsonb);

insert into probe
select 'A5. own card writes the split verbatim', 'ปิติ|รัก เรียน',
       coalesce((select s.first_name_th || '|' || s.last_name_th from public.students s
                  where lower(btrim(s.kkumail)) = lower(btrim((select kkumail from who)))), '(none)');

-- A7 — the payload the card is painted from carries the two keys. Without them
-- the form would have to read the split back off full_name, i.e. split it.
insert into probe
select 'A7. get_my_team_seat publishes the split', 'yes',
       case when (select count(*) from public.team_members m
                   where lower(btrim(m.kkumail)) = lower(btrim((select kkumail from who)))) = 0
              then 'yes'   -- no posting; nothing to publish, not a failure
            when public.get_my_team_seat()->'postings'->0 ? 'first_name_th'
             and public.get_my_team_seat()->'postings'->0 ? 'last_name_th'
              then 'yes' else 'no' end;
reset role;

-- A6 / D5 — the self-update guard. Two directions, because a probe that can
-- only report "denied" cannot tell a working guard from a broken connection.
-- Impersonate a member with NO admin grant, or the guard returns early and both
-- halves pass vacuously. 'permissions' AND 'managed_permissions' are both
-- checked: an account picked on 'permissions = '{}'' alone may hold master
-- through the ทีม SAMO tree (0081) and would look exactly like a fail-open.
--
-- No such account exists today — every member with a login holds something —
-- so the subject is MANUFACTURED inside the transaction rather than searched
-- for. That is the difference between a test and a test that reports "nothing
-- to check" and gets read as a pass: the first version of this probe printed
-- 'ok (no plain member to test)' for both halves, which is exactly the shape of
-- a proof that protects nothing.
-- The subject must genuinely LACK team_edit, or the guard returns early and
-- both halves pass without testing anything. 102 of the 116 members with a
-- login qualify.
--
-- Note the filter reads the UNION of 'permissions' AND 'managed_permissions'
-- (0081) — an account picked on 'permissions' alone may hold the grant through
-- the ทีม SAMO tree, which reads exactly like a fail-open policy and is the
-- grant engine working. And note what this does NOT do: stripping the columns
-- to manufacture a subject is refused by users_self_update_guard
-- ('tree-managed columns are server-managed'), which is the correct answer —
-- a real subject is better than a synthetic one anyway.
create temporary table plain as
select m.id as mid, u.id as uid
  from public.team_members m
  join public.users u on lower(btrim(u.email)) = lower(btrim(m.kkumail))
 where u.role not in ('vp_admin','dev')
   -- master (0111) folds into current_user_has_permission(team_edit), so a
   -- master holder is privileged for this write even without the literal key --
   -- exclude it too, or the guard returns early and D5 tests nothing. This is
   -- exactly what surfaced on 2026-08-17 when the account purge shifted the
   -- unordered pick onto one of the ~42 master holders. order-by pins the
   -- subject so the pick can never silently drift again.
   and not (array['team_edit','master'] && (coalesce(u.permissions, '{}')
                                          || coalesce(u.managed_permissions, '{}')))
 order by u.id
 limit 1;

-- ⚠️ BOTH halves below are scored on the STORED VALUE, never on whether an
-- exception was raised. RLS does not raise on UPDATE — a blocked write simply
-- matches zero rows — so "no exception" scores a fully-blocked write as
-- permitted. That is an entry in docs/mistakes/tooling-proofs.md and the first
-- version of this probe made it anyway: D5 reported ALLOWED for a write that
-- had in fact been refused, and would have reported the same for a working
-- guard. Read the row back.
do $do$
declare
  v_uid uuid; v_mid uuid;
  v_pos0 int; v_first0 text;
  v_ok text; v_denied text;
begin
  select uid, mid into v_uid, v_mid from plain;
  if v_uid is null then
    insert into probe values ('A6. member may edit own ชื่อ/นามสกุล', 'ok', 'NO SUBJECT');
    insert into probe values ('D5. member may NOT edit an admin column', 'denied', 'NO SUBJECT');
    return;
  end if;
  select position, first_name_th into v_pos0, v_first0
    from public.team_members where id = v_mid;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid::text, 'role','authenticated')::text, true);
  set local role authenticated;
  -- Not decoration: the guard returns early for vp_admin/dev, for team_edit,
  -- and for app.team_sync='1'. If any of those were true the deny half above
  -- would pass while testing nothing. 0136 exists because this line caught
  -- app.team_sync leaking in as '1'.
  insert into probe values ('D5y. the subject really is unprivileged', 'user|false|',
    coalesce(public.current_user_role(),'null') || '|'
    || public.current_user_has_permission('team_edit')::text || '|'
    || coalesce(current_setting('app.team_sync', true), ''));

  begin
    update public.team_members set first_name_th = 'ชูใจ', last_name_th = 'ดีงาม' where id = v_mid;
  exception when others then null;
  end;

  begin
    update public.team_members set position = coalesce(v_pos0, 0) + 7 where id = v_mid;
    insert into probe values ('D5x. the GUARD refused it, not RLS', 'P0001', 'UPDATE SUCCEEDED');
  exception when others then
    -- P0001 is team_members_self_update_guard raising. A row simply not
    -- matching (RLS) would show up as success-with-zero-rows here and as
    -- 'denied' in D5 — indistinguishable from a working guard, which is why
    -- the two are asserted separately.
    insert into probe values ('D5x. the GUARD refused it, not RLS', 'P0001', sqlstate);
  end;

  reset role;

  -- The write LANDED: the row says what the member typed.
  select case when first_name_th = 'ชูใจ' and last_name_th = 'ดีงาม' then 'ok'
              else 'BLOCKED (still ' || coalesce(first_name_th, 'null') || ')' end
    into v_ok from public.team_members where id = v_mid;

  -- The admin column did NOT move — whether the guard raised or RLS silently
  -- matched nothing, the fact that matters is the same.
  select case when position is not distinct from v_pos0 then 'denied' else 'ALLOWED' end
    into v_denied from public.team_members where id = v_mid;

  insert into probe values ('A6. member may edit own ชื่อ/นามสกุล', 'ok', v_ok);
  insert into probe values ('D5. member may NOT edit an admin column', 'denied', v_denied);
end
$do$;

reset role;

select step, expected, got,
       case when expected = got then 'PASS' else 'FAIL' end as verdict
  from probe order by step;

rollback;
`;

const file = join(tmpdir(), `team0135-${process.pid}.sql`);
writeFileSync(file, SQL);
let out;
try {
  out = execFileSync('node', [new URL('./db-query.mjs', import.meta.url).pathname, file],
    { encoding: 'utf8' });
} finally {
  unlinkSync(file);
}

const rows = JSON.parse(out.trim().split('\n').filter(Boolean).pop());
let failed = 0;
for (const r of rows) {
  if (r.verdict !== 'PASS') failed += 1;
  console.log(`${r.verdict === 'PASS' ? '✓' : '✗'} ${r.step}: expected ${r.expected}, got ${r.got}`);
}
console.log(failed ? `\n${failed} FAILED` : `\nall ${rows.length} pass`);
process.exit(failed ? 1 : 0);
