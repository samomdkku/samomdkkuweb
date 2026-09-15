#!/usr/bin/env node
// ============================================================
// house0197-promote-teamsamo-held.mjs — the file could not address them, but
// ทีม SAMO can.
//
// 10 ทีม SAMO members sit in ยังนำเข้าไม่ได้ for one reason: the roster file
// carried no kkumail for their line, and `promote_unresolved_row()` needs one.
// ทีม SAMO recorded their address years ago. So the data to place them has been
// in the building the whole time, in the other table.
//
// EVIDENCE PER PERSON — two independent signals, not one:
//   · รหัสนักศึกษา matches exactly between the ทีม SAMO row and the held line;
//   · the full name matches too;
//   · their kkumail is FREE — no student already owns it;
//   · no รหัส matches two different held rows.
// That is the same predicate `claim_my_student_seat` trusts when a student
// claims their own seat (รหัส + ชื่อ), plus an address we did not have to guess.
//
// ⛔ THE ORDERING TRAP, and the reason this script exists instead of ten clicks.
// `promote_unresolved_row()` inserts into `students`, and `students_link_person`
// then calls `resolve_person_id(kkumail)` — which matches on **kkumail only**.
// If the person's `people` row does not already carry that same kkumail, the
// resolver finds nothing and CREATES A SECOND PERSON — re-making the exact
// duplicates house0196 just merged away. Verified before running: all 10 already
// carry their kkumail on their own people row, so each new student row attaches
// to the person they already are.
//
// It replicates promote_unresolved_row's body rather than calling it, because
// that function gates on `current_user_role()` and this runs as the superuser,
// where auth.uid() is null. Same INSERT, same UPDATE, same order.
//
//   node tools/house0197-promote-teamsamo-held.mjs            # DRY RUN
//   node tools/house0197-promote-teamsamo-held.mjs --commit
// ============================================================
import { writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const COMMIT = process.argv.includes('--commit');
const SNAP = 'externaldata/house-import/house0197-snapshot.json';
const sql = (text) => {
  writeFileSync('/tmp/h0197.sql', text);
  const out = execFileSync('node', ['tools/db-query.mjs', '/tmp/h0197.sql'],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return JSON.parse(out.trim().split('\n').pop());
};

// The temp normaliser is its OWN statement; the CTE follows it. (Gluing the two
// with a comma produced `, only_team as (` and a syntax error — the kind of bug
// a dry run catches for free.)
const NRM = `
create or replace function pg_temp.nrm(t text) returns text language sql immutable as
$$ select nullif(regexp_replace(coalesce(t,''), '\\s+', '', 'g'), '') $$;
`;

const PAIRS = `with only_team as (
  select p.* from public.people p
   where exists (select 1 from public.team_members t where t.person_id=p.id)
     and not exists (select 1 from public.students s where s.person_id=p.id)),
pairs as (
  select ot.id as person_id, ot.kkumail, u.id as held_id, u.student_id, u.sai_code
    from only_team ot
    join public.student_import_unresolved u
      on u.resolved_at is null and coalesce(ot.student_id,'') <> ''
     and regexp_replace(coalesce(u.student_id,''),'[^0-9]','','g')
       = regexp_replace(coalesce(ot.student_id,''),'[^0-9]','','g')
   where coalesce(nullif(btrim(ot.major),''),'') not in ('MDI','RT')
     and coalesce(pg_temp.nrm(coalesce(ot.first_name_th,'')||coalesce(ot.last_name_th,'')),
                  pg_temp.nrm(ot.full_name))
       = pg_temp.nrm(coalesce(u.first_name_th,'')||coalesce(u.last_name_th,''))
     and coalesce(ot.kkumail,'') <> ''
     and not exists (select 1 from public.students s
                      where lower(btrim(s.kkumail)) = lower(btrim(ot.kkumail))))`;

const pairs = sql(`${NRM}${PAIRS}
select person_id, held_id, kkumail, student_id, sai_code from pairs order by student_id;`);

console.log(`pairs: ${pairs.length}`);
if (pairs.length !== 10) {
  console.error(`\n✗ expected 10, got ${pairs.length} — the data moved. Re-derive, do not run a stale plan.`);
  process.exit(1);
}
// The precondition that keeps this from re-creating duplicates.
const guard = sql(`${NRM}${PAIRS}
select count(*)::int as n from pairs p
 where not exists (select 1 from public.people pe
                    where pe.id = p.person_id
                      and lower(btrim(pe.kkumail)) = lower(btrim(p.kkumail)));`);
if (guard[0].n !== 0) {
  console.error(`\n✗ ${guard[0].n} of them do NOT carry their kkumail on their own people row.`
    + ` Promoting would create a SECOND person for each. STOP.`);
  process.exit(1);
}
console.log('precondition ok: all carry their kkumail on their own people row');

if (!COMMIT) {
  console.log('\nDRY RUN — nothing written. Re-run with --commit.');
  console.log(`would create ${pairs.length} students rows and resolve ${pairs.length} held rows.`);
  process.exit(0);
}

mkdirSync('externaldata/house-import', { recursive: true });
const before = sql(`${NRM}${PAIRS}
select jsonb_build_object('taken_at', now(),
  'people',   (select jsonb_agg(to_jsonb(p)) from public.people p where p.id in (select person_id from pairs)),
  'held',     (select jsonb_agg(to_jsonb(u)) from public.student_import_unresolved u where u.id in (select held_id from pairs)),
  'counts',   jsonb_build_object('people',(select count(*) from public.people),
                                 'students',(select count(*) from public.students),
                                 'held_open',(select count(*) from public.student_import_unresolved where resolved_at is null))
) as snap;`);
writeFileSync(SNAP, JSON.stringify(before[0].snap, null, 2));
console.log(`snapshot → ${SNAP}`);

const res = sql(`
begin;
${NRM}${PAIRS}, ins as (
  insert into public.students
    (kkumail, student_id, first_name_th, last_name_th, nickname_imported,
     major, sai_code, cohort_year, last_import_batch)
  select pr.kkumail, u.student_id, u.first_name_th, u.last_name_th, u.nickname_imported,
         u.major, u.sai_code, u.cohort_year, u.batch_id
    from pairs pr join public.student_import_unresolved u on u.id = pr.held_id
  returning id, kkumail)
select count(*)::int as students_created from ins;

-- ⛔ CLOSE THE HELD ROWS BY WHAT IS TRUE *AFTER* THE INSERT, NOT BY \`pairs\`.
-- The first version re-derived \`pairs\` here and silently matched ZERO rows:
-- \`pairs\` is built from \`only_team\`, defined as "has a team placement and NO
-- students row" — and the INSERT above had just given all ten a students row, so
-- the set was empty by the time this ran. The students were created and the held
-- rows stayed OPEN, leaving ten people listed as a student AND as still-waiting
-- at the same time. A CTE that describes a precondition cannot be reused as a
-- postcondition. Match on the durable fact instead: a held row whose รหัส and
-- ชื่อ now belong to a real student.
${NRM}
with done as (
  select u.id as held_id, s.id as student_id
    from public.student_import_unresolved u
    join public.students s
      on regexp_replace(coalesce(s.student_id,''),'[^0-9]','','g')
       = regexp_replace(coalesce(u.student_id,''),'[^0-9]','','g')
     and pg_temp.nrm(coalesce(s.first_name_th,'')||coalesce(s.last_name_th,''))
       = pg_temp.nrm(coalesce(u.first_name_th,'')||coalesce(u.last_name_th,''))
   where u.resolved_at is null and coalesce(u.student_id,'') <> ''),
upd as (
  update public.student_import_unresolved u
     set resolved_at = now(), resolved_how = 'admin', resolved_student = d.student_id
    from done d where u.id = d.held_id
  returning u.id)
select count(*)::int as held_rows_resolved from upd;
commit;`);
console.log('result:', JSON.stringify(res));

// ── VERIFY. A promotion that creates a student and leaves the held row open is
// the failure this script already shipped once; assert it did not happen again.
const after = sql(`
select count(*)::int as n
  from public.students s join public.student_import_unresolved u
    on regexp_replace(coalesce(s.student_id,''),'[^0-9]','','g')
     = regexp_replace(coalesce(u.student_id,''),'[^0-9]','','g')
 where u.resolved_at is null and coalesce(u.student_id,'') <> '';`);
if (after[0].n !== 0) {
  console.error(`\n✗ ${after[0].n} people are a student AND still in ยังนำเข้าไม่ได้.`
    + ` The held rows were not closed — fix before anyone reads that tab.`);
  process.exit(1);
}
console.log('verified: nobody is both a student and still held');
