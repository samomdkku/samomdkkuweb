#!/usr/bin/env node
// ============================================================
// rotation-import.mjs — put the faculty's rotation PDF into แลก Rotation (0250).
//
//   node tools/rotation-import.mjs <file>.pdf [--round y6-2570] [--dev]            # DRY RUN
//   node tools/rotation-import.mjs <file>.pdf [--round y6-2570] [--dev] --commit   # keeps it
//
// Needs `pdftotext` (poppler: `brew install poppler`). The PDF must be OUTSIDE
// the repo — it lists 161 real students and the repo is public.
//
// WHAT IT DOES, in one transaction (the dry run does it and rolls back):
//   1. parses the PDF with src/js/rotation/roster-parse.js (the one parser)
//   2. matches every row to public.people by รหัสนักศึกษา — never by name
//   3. upserts rotation_students: the REGISTRY's name (the PDF drops ำ and
//      clips long surnames — see roster-parse.js), the PDF's spelling kept in
//      source_name, gender from the prefix, kkumail + person_id from people
//   4. a NEW row starts in its PDF group. An EXISTING row keeps current_group
//      and gpa — re-importing must never undo a swap students already made.
//
// It PRINTS every name difference that is not the ำ artefact, and every row
// with no registry match or no kkumail (those people cannot sign in to see
// the page). Real names go to YOUR terminal only — never paste the output into
// a committed file.
// ============================================================
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve, relative, isAbsolute, join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseRosterText, compareNames } from '../src/js/rotation/roster-parse.js';
import { loadEnv, announceTarget, runSql } from './env-lib.mjs';

const args = process.argv.slice(2);
const COMMIT = args.includes('--commit');
const wantDev = args.includes('--dev');
const roundIdx = args.indexOf('--round');
const ROUND = roundIdx >= 0 ? args[roundIdx + 1] : 'y6-2570';
const known = ['--commit', '--dev', '--round'];
const unknown = args.filter((a) => a.startsWith('-') && !known.includes(a));
const file = args.find((a, i) => !a.startsWith('-') && args[i - 1] !== '--round');
if (!file || unknown.length || !/\.pdf$/i.test(file) || !/^[a-z0-9-]{3,40}$/.test(ROUND || '')) {
  console.error('usage: node tools/rotation-import.mjs <file>.pdf [--round <id>] [--dev] [--commit]'
    + (unknown.length ? `  (unknown: ${unknown.join(' ')})` : ''));
  process.exit(1);
}

const REPO = fileURLToPath(new URL('..', import.meta.url));
const rel = relative(REPO, resolve(file));
if (!rel.startsWith('..') && !isAbsolute(rel)) {
  console.error('⛔ the PDF is inside the repo, which is PUBLIC. Move it out (e.g. ~/Downloads) and re-run.');
  process.exit(2);
}

const loaded = loadEnv();
if (wantDev) {
  const url = loaded.env.SUPABASE_DEV_URL;
  const tok = loaded.env.SUPABASE_DEV_ACCESS_TOKEN;
  if (!url || !tok) { console.error('--dev needs SUPABASE_DEV_URL + SUPABASE_DEV_ACCESS_TOKEN'); process.exit(2); }
  loaded.env = { ...loaded.env, VITE_SUPABASE_URL: url, SUPABASE_ACCESS_TOKEN: tok };
}
const target = announceTarget(loaded);
if (wantDev && !target.isDev) { console.error('--dev was asked for but the target is not samo-dev — refusing'); process.exit(2); }

// pdftotext into a private temp dir, read, delete.
const tmp = mkdtempSync(join(tmpdir(), 'rotation-'));
let text;
try {
  execFileSync('pdftotext', ['-raw', resolve(file), join(tmp, 'raw.txt')]);
  text = readFileSync(join(tmp, 'raw.txt'), 'utf8');
} catch (e) {
  console.error('⛔ pdftotext failed — install poppler (`brew install poppler`).', e.message);
  process.exit(3);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

const { rows, problems } = parseRosterText(text);
if (problems.length) {
  console.error('⛔ the PDF did not parse cleanly — nothing imported:');
  for (const p of problems) console.error('   ' + p);
  process.exit(4);
}
const byGroup = rows.reduce((m, r) => ((m[r.group] = (m[r.group] || 0) + 1), m), {});
console.error(`\n→ ${rows.length} students · ` + Object.entries(byGroup).map(([g, n]) => `${g}:${n}`).join(' ')
  + ` · M ${rows.filter((r) => r.gender === 'M').length} / F ${rows.filter((r) => r.gender === 'F').length}`);

const q = (v) => (v === null || v === undefined ? 'null' : `'${String(v).replace(/'/g, "''")}'`);
const digits = (s) => String(s).replace(/\D/g, '');

// ── match against the registry first (read-only) ───────────────────────────
const reg = JSON.parse(await runSql(`
  select p.id, p.student_id, p.first_name_th, p.last_name_th, p.kkumail
    from public.people p
   where regexp_replace(coalesce(p.student_id,''), '\\D', '', 'g') = any (array[${rows.map((r) => q(digits(r.student_id))).join(',')}])`, target));
const regBySid = new Map();
const dupSid = new Set();
for (const p of reg) {
  const k = digits(p.student_id);
  if (regBySid.has(k)) dupSid.add(k);
  regBySid.set(k, p);
}

const report = { same: 0, sara_am: 0, cut: [], different: [], missing: [], noMail: [], dup: [] };
const payload = rows.map((r) => {
  const k = digits(r.student_id);
  if (dupSid.has(k)) { report.dup.push(r); return null; }
  const p = regBySid.get(k);
  if (!p) report.missing.push(r);
  else if (!p.kkumail) report.noMail.push(r);
  let first = r.first_name; let last = r.last_name;
  if (p) {
    const cmp = compareNames(r, { first_name: p.first_name_th, last_name: p.last_name_th });
    if (cmp === 'same') report.same++;
    else if (cmp === 'sara_am') report.sara_am++;
    else if (cmp === 'cut') report.cut.push([r, p]);
    else report.different.push([r, p]);
    if (p.first_name_th && p.last_name_th) { first = p.first_name_th; last = p.last_name_th; }
  }
  return {
    student_id: r.student_id, prefix: r.prefix, first_name: first, last_name: last,
    source_name: `${r.prefix}${r.first_name} ${r.last_name}`, gender: r.gender, group: r.group,
    kkumail: p?.kkumail ? p.kkumail.trim().toLowerCase() : null, person_id: p?.id || null,
  };
}).filter(Boolean);

const show = (r) => `${r.group} ${r.student_id} ${r.prefix}${r.first_name} ${r.last_name}`;
console.error(`→ names: ${report.same} identical · ${report.sara_am} differ only by the PDF's ำ→า artefact`);
if (report.cut.length) {
  console.error(`→ ${report.cut.length} surname(s) CLIPPED in the PDF — the registry's full name is used:`);
  for (const [r, p] of report.cut) console.error(`    ${show(r)}   registry: ${p.first_name_th} ${p.last_name_th}`);
}
if (report.different.length) {
  console.error(`→ ${report.different.length} name(s) DIFFER — registry used, a person should confirm:`);
  for (const [r, p] of report.different) console.error(`    ${show(r)}   registry: ${p.first_name_th} ${p.last_name_th}`);
}
if (report.missing.length) {
  console.error(`→ ${report.missing.length} รหัส NOT in the registry — imported with the PDF name, cannot sign in until linked:`);
  for (const r of report.missing) console.error('    ' + show(r));
}
if (report.noMail.length) {
  console.error(`→ ${report.noMail.length} in the registry with NO kkumail — cannot sign in to see the page:`);
  for (const r of report.noMail) console.error('    ' + show(r));
}
if (report.dup.length) {
  console.error(`⛔ ${report.dup.length} รหัส match TWO registry rows — skipped, fix the registry first:`);
  for (const r of report.dup) console.error('    ' + show(r));
}

const json = JSON.stringify(payload).replace(/'/g, "''");
const sql = `
begin;
create temporary table _in on commit drop as
  select * from jsonb_to_recordset('${json}'::jsonb)
    as x(student_id text, prefix text, first_name text, last_name text, source_name text,
         gender text, "group" text, kkumail text, person_id uuid);

create temporary table _before on commit drop as
  select (select count(*) from public.rotation_students where round_id = ${q(ROUND)}) as n;

insert into public.rotation_students
  (round_id, student_id, prefix, first_name, last_name, source_name, gender,
   original_group, current_group, kkumail, person_id)
select ${q(ROUND)}, i.student_id, i.prefix, i.first_name, i.last_name, i.source_name, i.gender,
       i."group", i."group", i.kkumail, i.person_id
  from _in i
on conflict (round_id, student_id) do update
   set prefix = excluded.prefix, first_name = excluded.first_name, last_name = excluded.last_name,
       source_name = excluded.source_name, gender = excluded.gender,
       original_group = excluded.original_group,
       kkumail = excluded.kkumail, person_id = excluded.person_id, updated_at = now();
-- current_group and gpa are NOT in the update list on purpose (header, step 4).

select 'roster rows (before → after)' as what,
       (select n from _before) || ' → ' || (select count(*) from public.rotation_students where round_id = ${q(ROUND)}) as n
union all select 'can sign in (kkumail or registry link)',
       (select count(*)::text from public.rotation_students where round_id = ${q(ROUND)} and (kkumail is not null or person_id is not null))
union all select 'already signed in to the website once',
       (select count(*)::text from public.rotation_students s join public.people p on p.id = s.person_id
         where s.round_id = ${q(ROUND)} and p.user_id is not null)
union all select 'now in a different group than the PDF (swapped)',
       (select count(*)::text from public.rotation_students where round_id = ${q(ROUND)} and current_group <> original_group)
union all select 'per group now', (select string_agg(g || ':' || n, ' ' order by g) from
       (select current_group g, count(*) n from public.rotation_students where round_id = ${q(ROUND)} group by 1) t);
${COMMIT ? 'commit;' : 'rollback;'}
`;
console.error(`\n→ round ${ROUND} · ${COMMIT ? '⚠️  COMMITTING' : 'DRY RUN — this transaction will ROLL BACK'}\n`);
const out = JSON.parse(await runSql(sql, target));
for (const r of out) console.log(`  ${String(r.what).padEnd(48)} ${r.n}`);
console.error(COMMIT ? '\n✓ committed.' : '\n✓ rolled back — nothing was kept. Re-run with --commit.');
