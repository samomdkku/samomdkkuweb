#!/usr/bin/env node
// ============================================================
// house-unplaced-cohort.mjs — give the 13 held rows their รุ่น back.
//
// REPORTED: "the data in unplaced ข้อมูลไม่ครบ you not know what md รุ่น it is?
// but the file already order รุ่น md, why don't you know it".
//
// Correct, and the database already had a place for the answer.
// `student_import_unresolved.cohort_year` was added by 0188 with this comment:
//
//     Carried explicitly rather than derived. `students.cohort_year` comes from
//     cohort_from_student_id(), which needs a รหัสนักศึกษา — and 13 of these
//     rows have none. The handover file states the รุ่น as a block heading, so
//     for exactly the rows that cannot derive it, the file is the only source
//     there is.
//
// The column is there, the file says it, and the importer never carried it —
// so `cohortLabel()` returned nothing and 13 real people landed in a file called
// `_unplaced` that reads like "we do not know who these are". We did know.
//
// HOW THE FILE SAYS IT. `2026-09-14-raw-from-data-dept.csv` is 1,776 lines and
// `source_line` indexes it exactly. Column 9 (`รุ่น`) is written ONCE, on the
// first line of each block, and left blank for the rest of it:
//
//     line    2  MD49        line  864  MD52
//     line  289  MD50        line 1168  MD53
//     line  577  MD 51       line 1473  MD54     ← note the space in "MD 51"
//
// So a row's รุ่น is the nearest heading AT OR ABOVE its own line.
//
// ⛔ TWO SIGNALS MUST AGREE BEFORE ANYTHING IS WRITTEN, because this is a
// repair of real students' records and a walk-up is only as good as the line
// number it starts from:
//
//   1. the block heading above the row's `source_line`, and
//   2. the row's สาย, read back OUT of that same line in the file, matching the
//      สาย the database holds.
//
// A row whose file line names a different สาย than the database does is NOT
// repaired — it is printed and skipped, because then `source_line` is pointing
// somewhere other than where we think and every conclusion after it is noise.
//
// MD→ปี IS NOT HARDCODED. It is derived from the block's own members: every
// OTHER line in the block carries a รหัสนักศึกษา, and `cohortFromStudentId()` —
// the app's one implementation, imported — reads the year off it. The heading's
// year is what the overwhelming majority of its own rows say. A hardcoded
// `MD49 = 2564` would be a second implementation of that rule and would rot the
// first time a รุ่น is added.
//
// ⚠️ IT READS THE FILE, NOT THE DATABASE, and that is the fix to the first
// version of this script: deriving from held rows that HAVE a cohort meant MD52
// — the one block whose held rows are exactly the 11 with no รหัส — got no
// votes at all and every one of them was refused. The block with the most to
// repair was the one the evidence was missing for.
//
//   node tools/house-unplaced-cohort.mjs <raw.csv>            # dry run
//   node tools/house-unplaced-cohort.mjs <raw.csv> --apply    # write it
// ============================================================
import { readFileSync } from 'node:fs';
import { cohortFromStudentId } from '../src/js/study-year.js';
import { loadEnv, announceTarget, runSql } from './env-lib.mjs';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const FILE = args.find((a) => !a.startsWith('--'));

if (!FILE) {
  console.error('usage: node tools/house-unplaced-cohort.mjs <raw-handover.csv> [--apply]');
  process.exit(1);
}

/** Minimal CSV row splitter — the handover file has quoted cells with commas. */
function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i += 1; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

const RUN_COL = 8;   // 'รุ่น'
const SAI_COL = 6;   // 'สายรหัส'

const lines = readFileSync(FILE, 'utf8').split(/\r?\n/);
// `source_line` is 1-based over the file INCLUDING its header, which is how the
// importer recorded it — index 0 of this array is line 1.
const rows = lines.map(splitCsvLine);

/** The nearest รุ่น heading at or above `line`, and the line it came from. */
function blockOf(line) {
  for (let i = line - 1; i >= 0; i -= 1) {
    const v = (rows[i]?.[RUN_COL] || '').trim();
    // The header's own cell literally reads "รุ่น"; it is a label, not a block.
    if (v && v !== 'รุ่น') return { label: v.replace(/\s+/g, ''), at: i + 1 };
  }
  return null;
}

const target = announceTarget(loadEnv());
const ask = async (sql) => JSON.parse(await runSql(sql, target));

const held = await ask(`
  select id::text, source_line, student_id, first_name_th, last_name_th,
         sai_code, cohort_year
    from public.student_import_unresolved
   where resolved_at is null and source_line is not null
   order by source_line`);

// ---- derive MD-label → ปี from the FILE's own rows ----
const SID_COL = 0;
const votes = new Map();
for (let i = 1; i < rows.length; i += 1) {
  const year = cohortFromStudentId(rows[i]?.[SID_COL] || '');
  if (!year) continue;
  const b = blockOf(i + 1);
  if (!b) continue;
  if (!votes.has(b.label)) votes.set(b.label, new Map());
  const m = votes.get(b.label);
  m.set(year, (m.get(year) || 0) + 1);
}
const yearOf = new Map();
console.log('\n  รุ่น → ปี (อ่านจากรหัสนักศึกษาของแถวอื่นในบล็อกเดียวกัน)');
for (const [label, m] of [...votes.entries()].sort()) {
  const ranked = [...m.entries()].sort((a, b) => b[1] - a[1]);
  const [year, n] = ranked[0];
  const total = ranked.reduce((s, [, c]) => s + c, 0);
  yearOf.set(label, year);
  console.log(`  ${label.padEnd(6)} → ${year}   (${n}/${total} of its rows agree`
    + `${ranked.length > 1 ? `, others: ${ranked.slice(1).map(([y, c]) => `${y}×${c}`).join(' ')}` : ''})`);
}

// ---- propose a รุ่น for every row that has none ----
const todo = held.filter((r) => !r.cohort_year);
console.log(`\n  ${todo.length} แถวที่ยังไม่มีรุ่น\n`);

const ok = [];
const refused = [];
for (const r of todo) {
  const b = blockOf(r.source_line);
  const fileSai = (rows[r.source_line - 1]?.[SAI_COL] || '').trim();
  const dbSai = (r.sai_code || '').trim();
  const name = [r.first_name_th, r.last_name_th].filter(Boolean).join(' ') || '(ไม่มีชื่อในไฟล์)';
  const year = b ? yearOf.get(b.label) : null;

  // Two different faults, said differently — lumping them cost a debugging
  // round: every MD52 row reported "no heading above this line" when the
  // heading was found and it was the YEAR that was missing.
  if (!b) { refused.push([r, name, 'ไม่พบหัวข้อรุ่นเหนือบรรทัดนี้']); continue; }
  if (!year) { refused.push([r, name, `พบหัวข้อ ${b.label} แต่หาปีของบล็อกนี้ไม่ได้`]); continue; }
  // THE CROSS-CHECK. Both readings are of the same line; if they disagree,
  // source_line is not pointing where we think and the walk-up is worthless.
  if (fileSai !== dbSai) {
    refused.push([r, name, `สายในไฟล์ (${fileSai || 'ว่าง'}) ไม่ตรงกับในฐานข้อมูล (${dbSai || 'ว่าง'})`]);
    continue;
  }
  ok.push({ r, name, label: b.label, at: b.at, year, sai: dbSai });
}

for (const o of ok) {
  console.log(`  ✓ line ${String(o.r.source_line).padStart(5)}  สาย ${o.sai.padEnd(4)}`
    + `  ${o.name.padEnd(28)} → ${o.label} (${o.year})   [หัวข้อที่บรรทัด ${o.at}]`);
}
for (const [r, name, why] of refused) {
  console.log(`  ✗ line ${String(r.source_line).padStart(5)}  ${name.padEnd(28)} — ${why}`);
}
console.log(`\n  ระบุได้ ${ok.length} · ระบุไม่ได้ ${refused.length}\n`);

if (!APPLY) {
  console.log('  (dry run — ยังไม่เขียนฐานข้อมูล ใส่ --apply เพื่อบันทึก)\n');
  process.exit(0);
}
if (!ok.length) {
  console.log('  ไม่มีอะไรให้บันทึก\n');
  process.exit(0);
}

// One statement, so a partial write cannot happen. `is null` in the WHERE is
// not decoration: it means a re-run can only ever fill a blank, never overwrite
// a รุ่น somebody has since corrected by hand.
const values = ok.map((o) => `('${o.r.id}'::uuid, ${o.year}::smallint)`).join(', ');
const sql = `
  with v(id, year) as (values ${values})
  update public.student_import_unresolved u
     set cohort_year = v.year, updated_at = now()
    from v
   where u.id = v.id and u.cohort_year is null and u.resolved_at is null
  returning u.id::text, u.cohort_year, u.sai_code`;
const written = await ask(sql);
console.log(`  เขียนแล้ว ${written.length} แถว\n`);
if (written.length !== ok.length) {
  console.log(`  ⚠️ ตั้งใจเขียน ${ok.length} แถว แต่เขียนได้ ${written.length}`
    + ' — บางแถวอาจมีรุ่นอยู่แล้วหรือถูกแก้ไปแล้ว\n');
}
