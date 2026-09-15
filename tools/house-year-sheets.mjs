#!/usr/bin/env node
// ============================================================
// house-year-sheets.mjs — one CSV per รุ่น, in the format
// `docs/HOUSE-YEAR-HANDOVER.md` §b specifies, for a year admin to review.
//
// REUSE, NOT A SECOND OPINION. Who is "ค้างนำเข้า" vs "ยืนยันตัวตนเองได้แล้ว" is
// `splitHeld()` from `src/js/house/gaps.js` — the exact predicate
// `computeGaps()` uses for the ข้อมูลไม่ครบ tab. This file does not re-decide
// what counts as a gap; it only lays the same two populations out by รุ่น
// instead of by tone. If the two ever disagree, it will be because one of them
// stopped importing the other, not because the rule was written twice.
//
// WHAT THIS DOES NOT EMIT (a decision, not an oversight): §b's สถานะ column
// lists a fourth value, "ไม่มีในไฟล์เลย", for a สาย slot with nobody on it at
// all. Emitting that needs the full สาย range per รุ่น (1..max), and
// HOUSE-YEAR-HANDOVER.md §e assumption 1 says that range is UNVERIFIED against
// live data — building it in tonight would bake in a guess about สาย density
// this plan explicitly flagged as unchecked. Left to whoever builds the §d
// สาย-grid UI, which owns exactly this question. This tool only ever emits a
// row for a person who actually exists in `students` or the held list.
//
// COLUMNS 1-8 ARE READ-ONLY BY DESIGN (§b) — this tool writes them once, from
// the database, and never reads them back. Column 9 (หมายเหตุ) is left BLANK
// on generation; it is the one cell a year admin fills in, and
// `house-year-notes-import.mjs` (not built — see §c step 6 of the plan) is
// what reads it back, never this script.
//
// ⚠️ OUTPUT IS PII. `externaldata/` is gitignored on purpose — never move a
// generated CSV under `src/`, `docs/` or `tools/`, and never commit one.
//
//   node tools/house-year-sheets.mjs                 # dry run: counts only
//   node tools/house-year-sheets.mjs --apply         # writes the CSVs
//   node tools/house-year-sheets.mjs --apply --force # overwrite existing files
// ============================================================
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { splitHeld } from '../src/js/house/gaps.js';
import { cohortLabel, houseOf } from '../src/js/house/fields.js';
import { FIELDS } from '../src/js/house/census.js';
import { loadEnv, announceTarget, runSql } from './env-lib.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const OUT_DIR = path.join(ROOT, 'externaldata/house-year-sheets');

export const HEADER = [
  'รหัสนักศึกษา', 'ชื่อ (จากระบบ)', 'นามสกุล (จากระบบ)', 'ชื่อเล่น',
  'สาย', 'บ้าน', 'สถานะ', 'kkumail (ถ้ามีในระบบ)', 'หมายเหตุ (เขียนที่นี่ได้)',
];

const STATUS = {
  normal: 'ปกติ',
  heldAdmin: 'ค้างนำเข้า (ไม่มี kkumail)',
  heldSelf: 'ยืนยันตัวตนเองได้แล้ว รอเข้าระบบ',
};

const saiOf = (r) => r.sai_code || r.sai || '';
const nickOf = FIELDS.find((f) => f.key === 'nickname').get;

function toRow(r, status, { includeKkumail }) {
  const sai = saiOf(r);
  const house = houseOf(sai);
  return {
    studentId: r.student_id || '',
    firstName: r.first_name_th || '',
    lastName: r.last_name_th || '',
    nickname: nickOf(r) || '',
    sai,
    house: house == null ? '' : String(house),
    status,
    kkumail: includeKkumail ? (r.kkumail || '') : '',
    note: '',
  };
}

/**
 * PURE. No DOM, no network, no clock. Same shape of input as `computeGaps`
 * expects for `students`/`held`, so a fixture that exercises one exercises
 * both.
 *
 * @param {object} d
 * @param {object[]} d.students
 * @param {object[]} d.held
 * @returns {{ sheets: Map<string, object[]>, unplaced: object[] }}
 *   `sheets` keyed by รุ่น label (MD49, MD50, ...); `unplaced` is every row
 *   `cohortLabel()` cannot place in one — no student_id and no cohort_year to
 *   derive it from, so there is no tab to put them in (§e of the plan already
 *   names this population: the held rows with no รุ่น at all).
 */
export function buildYearSheets(d = {}) {
  const students = d.students || [];
  const held = (d.held || []).filter((h) => !h.resolved_at);
  const { heldAdmin, heldSelf } = splitHeld(held);

  const sheets = new Map();
  const unplaced = [];

  const place = (r, status, opts) => {
    const label = cohortLabel(r);
    const row = toRow(r, status, opts);
    if (!label) { unplaced.push(row); return; }
    if (!sheets.has(label)) sheets.set(label, []);
    sheets.get(label).push(row);
  };

  for (const s of students) place(s, STATUS.normal, { includeKkumail: true });
  for (const h of heldAdmin) place(h, STATUS.heldAdmin, { includeKkumail: false });
  for (const h of heldSelf) place(h, STATUS.heldSelf, { includeKkumail: false });

  // สาย ascending within a tab; blank สาย (no_sai students) sorts last so it
  // does not silently land at 001. Name is only a tiebreak, for a stable order
  // across re-runs.
  const bySai = (a, b) => {
    const an = Number(a.sai); const bn = Number(b.sai);
    const aValid = a.sai && Number.isFinite(an);
    const bValid = b.sai && Number.isFinite(bn);
    if (aValid && bValid) return an - bn || a.lastName.localeCompare(b.lastName);
    if (aValid !== bValid) return aValid ? -1 : 1;
    return a.lastName.localeCompare(b.lastName);
  };
  for (const rows of sheets.values()) rows.sort(bySai);
  unplaced.sort((a, b) => a.lastName.localeCompare(b.lastName));

  return { sheets, unplaced };
}

const csvCell = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
export function toCsv(rows) {
  const lines = [HEADER, ...rows.map((r) => [
    r.studentId, r.firstName, r.lastName, r.nickname,
    r.sai, r.house, r.status, r.kkumail, r.note,
  ])];
  return lines.map((line) => line.map(csvCell).join(',')).join('\n') + '\n';
}

// ------------------------------------------------------------------
// CLI — only this part touches the filesystem or the network.
// ------------------------------------------------------------------
async function main() {
  const args = process.argv.slice(2);
  const APPLY = args.includes('--apply');
  const FORCE = args.includes('--force');

  const target = announceTarget(loadEnv());
  const ask = async (sql) => JSON.parse(await runSql(sql, target));

  // Same columns house-gaps.mjs reads, for the same reason: a column missing
  // here reads as "nobody has one", a silent wrong answer instead of an error.
  const [students, held] = await Promise.all([
    ask(`select student_id, first_name_th, last_name_th, nickname,
                nickname_imported, nickname_self, sai_code, cohort_year, kkumail
           from public.students`),
    ask(`select id::text, student_id, first_name_th, last_name_th,
                sai_code as sai, cohort_year, resolved_at
           from public.student_import_unresolved`),
  ]);

  const { sheets, unplaced } = buildYearSheets({ students, held });

  const labels = [...sheets.keys()].sort();
  console.log('\n  รุ่น        แถว');
  console.log('  ──────────  ────');
  for (const label of labels) console.log(`  ${label.padEnd(10)}  ${String(sheets.get(label).length).padStart(4)}`);
  if (unplaced.length) {
    console.log(`  ${'(ไม่มีรุ่น)'.padEnd(10)}  ${String(unplaced.length).padStart(4)}`
      + '  — ไม่มีรหัสนักศึกษาที่ระบุรุ่นได้ ไม่มีแท็บให้ลง (ดูคอมเมนต์ท้ายไฟล์นี้)');
  }
  const totalRows = labels.reduce((n, l) => n + sheets.get(l).length, 0) + unplaced.length;
  console.log(`\n  รวม ${labels.length} รุ่น, ${totalRows} แถว\n`);

  if (!APPLY) {
    console.log('  (dry run — ยังไม่เขียนไฟล์ ใส่ --apply เพื่อสร้าง CSV จริง)\n');
    return;
  }

  mkdirSync(OUT_DIR, { recursive: true });
  const toWrite = [...labels.map((l) => [`${l}.csv`, sheets.get(l)]),
    ...(unplaced.length ? [['_unplaced.csv', unplaced]] : [])];

  const blocked = toWrite.filter(([name]) => !FORCE && existsSync(path.join(OUT_DIR, name)));
  if (blocked.length) {
    console.log(`  ข้ามไฟล์ที่มีอยู่แล้ว (ใส่ --force เพื่อเขียนทับ): ${blocked.map(([n]) => n).join(', ')}\n`);
  }

  for (const [name, rows] of toWrite) {
    if (!FORCE && existsSync(path.join(OUT_DIR, name))) continue;
    writeFileSync(path.join(OUT_DIR, name), toCsv(rows), 'utf8');
    console.log(`  → ${path.join('externaldata/house-year-sheets', name)}`);
  }
  console.log('');
}

// Only run the network/filesystem path when invoked directly — a test imports
// buildYearSheets/toCsv without ever reaching main().
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
