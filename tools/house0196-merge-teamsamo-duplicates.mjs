#!/usr/bin/env node
// ============================================================
// house0196-merge-teamsamo-duplicates.mjs — one human, two `people` rows.
//
// THE DEFECT. `resolve_person_id()` matches on kkumail and ONLY on kkumail —
// that is the architecture enforcing "a person IS their kkumail". A ทีม SAMO row
// entered without one therefore cannot find the student who is already in the
// registry, so it creates a SECOND `people` row instead. Those people then hold
// a ทีม SAMO seat with no สาย and no บ้าน, cannot see themselves after signing
// in, and cannot receive a Discord role — while their student record sits beside
// them, complete.
//
// 25 such pairs were found on 2026-09-15 by matching ชื่อ+นามสกุล. The owner
// reviewed every pair and approved them.
//
// ⛔ WHY MATCHING ON NAME IS SAFE *HERE* AND NOWHERE ELSE. The standing rule is
// never to merge on name (`docs/` + the 673070332-6 case: one mistyped รหัส on
// two humans). It is relaxed for this one repair on measured evidence, not
// preference:
//   · the candidate pool is 1,774 people and holds **1,774 distinct names** —
//     not one pair shares a ชื่อ+นามสกุล;
//   · every one of the 25 matched exactly ONE candidate, never two;
//   · 16 of them are corroborated by an identical ชื่อเล่น;
//   · all 25 are สาขา MD, the same programme as the MD-only roster;
//   · a human read every pair before this ran.
// Re-check the first bullet before ever reusing this script — it is the load
// bearing one, and it is a fact about today's data, not a property of names.
//
// HOW IT MERGES. It does NOT write `person_id`. It sets the ทีม SAMO row's
// **kkumail** to the one its student already carries, and lets the existing,
// tested triggers do the rest: `team_members_repoint_person` moves person_id and
// back-fills the row's nulls from the target, `prune_person_after_repoint`
// deletes the emptied people row (only when it has no user_id, no
// identity_confirmed_at and no remaining placement). That is the same mechanism
// that puts the other 257 dual-placement people in the state we are aiming at —
// verified: all 257 carry the same kkumail on both rows.
//
// ชื่อเล่น: where the two disagree the FILE wins. Owner's decision, 2026-09-15 —
// *"it's from the file, it's more credible"*. Without this the mirror would push
// the ทีม SAMO spelling up over the imported one.
//
//   node tools/house0196-merge-teamsamo-duplicates.mjs            # DRY RUN
//   node tools/house0196-merge-teamsamo-duplicates.mjs --commit   # do it
// ============================================================
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const COMMIT = process.argv.includes('--commit');
const SNAP = 'externaldata/house-import/house0196-snapshot.json';

const sql = (text) => {
  writeFileSync('/tmp/h0196.sql', text);
  const out = execFileSync('node', ['tools/db-query.mjs', '/tmp/h0196.sql'],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const line = out.trim().split('\n').pop();
  return JSON.parse(line);
};

// The pairs, derived live — never from a hardcoded list of people.
const MATCH_CTE = `
create or replace function pg_temp.nrm(t text) returns text language sql immutable as
$$ select nullif(regexp_replace(coalesce(t,''), '\\s+', '', 'g'), '') $$;
with only_team as (
  select p.* from public.people p
   where exists (select 1 from public.team_members t where t.person_id=p.id)
     and not exists (select 1 from public.students s where s.person_id=p.id)),
c as (select ot.* from only_team ot
       where coalesce(nullif(btrim(ot.major),''),'') not in ('MDI','RT')
         and (ot.student_id is null or btrim(ot.student_id)='')),
pairs as (
  select c.id as person_id, c.nickname as team_nick,
         s.id as student_row, s.kkumail as student_mail,
         coalesce(s.nickname_self, s.nickname_imported) as file_nick,
         s.sai_code, s.student_id
    from c join public.students s
      on pg_temp.nrm(coalesce(s.first_name_th,'')||coalesce(s.last_name_th,''))
         in (pg_temp.nrm(c.full_name),
             pg_temp.nrm(coalesce(c.first_name_th,'')||coalesce(c.last_name_th,''))))
`;

const pairs = sql(`${MATCH_CTE}
select person_id, student_row, student_mail, sai_code,
       coalesce(team_nick,'') as team_nick, coalesce(file_nick,'') as file_nick,
       (coalesce(team_nick,'') <> '' and coalesce(file_nick,'') <> ''
        and regexp_replace(team_nick,'\\s','','g') <> regexp_replace(file_nick,'\\s','','g')) as nick_differs
  from pairs order by student_id;`);

console.log(`pairs found: ${pairs.length}`);
if (pairs.length !== 24) {
  console.error(`\n✗ expected 24 pairs, got ${pairs.length}. The data moved since the owner`
    + ` reviewed it — STOP and re-derive the list rather than running a stale plan.`);
  process.exit(1);
}
const nickFixes = pairs.filter((p) => p.nick_differs);
console.log(`ชื่อเล่น to take from the file: ${nickFixes.length}`);
if (nickFixes.length > 2) {
  console.error('\n✗ more than the two reviewed ชื่อเล่น disagreements — STOP.');
  process.exit(1);
}
for (const p of pairs) {
  if (!p.student_mail) { console.error('✗ a pair has no student kkumail — STOP.'); process.exit(1); }
}

if (!COMMIT) {
  console.log('\nDRY RUN — nothing written. Re-run with --commit.');
  console.log(`would set kkumail on ${pairs.length} team_members rows,`);
  console.log(`would take ${nickFixes.length} ชื่อเล่น from the file,`);
  console.log(`expect people to drop by ${pairs.length} as the emptied rows are pruned.`);
  process.exit(0);
}

// ── SNAPSHOT FIRST. Everything the merge touches, before it touches it. ──────
mkdirSync('externaldata/house-import', { recursive: true });
const before = sql(`${MATCH_CTE}
select jsonb_build_object(
  'taken_at', now(),
  'people',        (select jsonb_agg(to_jsonb(p)) from public.people p
                     where p.id in (select person_id from pairs)),
  'team_members',  (select jsonb_agg(to_jsonb(t)) from public.team_members t
                     where t.person_id in (select person_id from pairs)),
  'students',      (select jsonb_agg(to_jsonb(s)) from public.students s
                     where s.id in (select student_row from pairs)),
  'counts', jsonb_build_object(
     'people',   (select count(*) from public.people),
     'students', (select count(*) from public.students),
     'team_members', (select count(*) from public.team_members))
) as snap;`);
writeFileSync(SNAP, JSON.stringify(before[0].snap, null, 2));
console.log(`snapshot → ${SNAP}`);

// ── THE MERGE. One transaction. ─────────────────────────────────────────────
const res = sql(`
begin;
${MATCH_CTE}, up_nick as (
  -- ชื่อเล่น: the FILE wins where they disagree (owner's decision).
  update public.team_members t set nickname = pr.file_nick
    from pairs pr
   where t.person_id = pr.person_id and pr.file_nick <> ''
     and coalesce(t.nickname,'') <> '' 
     and regexp_replace(coalesce(t.nickname,''),'\\s','','g')
         <> regexp_replace(pr.file_nick,'\\s','','g')
  returning t.id)
select count(*)::int as nicknames_taken_from_file from up_nick;
${MATCH_CTE}, up_mail as (
  -- THE MERGE ITSELF. Setting kkumail fires team_members_repoint_person, which
  -- moves person_id; prune_person_after_repoint then removes the emptied row.
  update public.team_members t set kkumail = pr.student_mail
    from pairs pr where t.person_id = pr.person_id
  returning t.id)
select count(*)::int as rows_repointed from up_mail;
commit;`);
console.log('result:', JSON.stringify(res));
