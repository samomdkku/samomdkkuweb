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
//   node tools/house-year-sheets.mjs                       # dry run: counts only
//   node tools/house-year-sheets.mjs --apply               # every person, per รุ่น
//   node tools/house-year-sheets.mjs --apply --gaps-only   # ONLY incomplete/held
//   node tools/house-year-sheets.mjs --apply --force       # overwrite existing
// ============================================================
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { splitHeld, groupOccupantsByCohort, groupBySaiNumber } from '../src/js/house/gaps.js';
import { cohortLabel, houseOf } from '../src/js/house/fields.js';
import { FIELDS, has } from '../src/js/house/census.js';
import { loadEnv, announceTarget, runSql } from './env-lib.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const OUT_DIR = path.join(ROOT, 'externaldata/house-year-sheets');

export const HEADER = [
  'รหัสนักศึกษา', 'ชื่อ (จากระบบ)', 'นามสกุล (จากระบบ)', 'ชื่อเล่น',
  'สาย', 'บ้าน', 'สถานะ', 'ความสำคัญ', 'ข้อมูลที่ขาด', 'ปัญหาที่พบ',
  'kkumail (ถ้ามีในระบบ)', 'หมายเหตุ (เขียนที่นี่ได้)',
];

/** The two fields nobody should be asked to chase. ชื่อเล่น is `optional` in
 *  the ข้อมูลครบแค่ไหน panel and the owner said so out loud: "for data like
 *  ชื่อเล่น it's fine to not request". Everything else on a row is worth a
 *  request, which is what ความสำคัญ sorts and filters on. */
export const PRIORITY = { high: 'สูง', low: 'ต่ำ' };

const STATUS = {
  normal: 'ปกติ',
  heldAdmin: 'ค้างนำเข้า (ไม่มี kkumail)',
  heldSelf: 'ยืนยันตัวตนเองได้แล้ว รอเข้าระบบ',
};

/**
 * WHICH fields are empty on this row, by the SAME predicate the ข้อมูลครบแค่ไหน
 * panel counts with — `FIELDS` + `has()` from census.js, imported, never
 * re-typed. A sheet sent to another team to FILL IN has to name what is
 * missing; "สถานะ: ปกติ" with five blank-looking cells makes the reader
 * re-derive the question this column answers.
 *
 * ชื่อเล่น is `optional: true` in that panel and stays optional here — it is
 * listed with a (ไม่บังคับ) marker rather than dropped, because the หมายเหตุ
 * column is exactly where someone would write one in.
 */
export function missingFields(r, status) {
  const out = FIELDS.filter((f) => !has(f.get(r)))
    .map((f) => (f.optional ? `${f.label} (ไม่บังคับ)` : f.label));
  // kkumail is not one of the five FIELDS, but it is the single most valuable
  // cell on this sheet: without it a person is not in `students` at all.
  //
  // ⚠️ THIS LISTS IT FOR **EVERY** HELD ROW, INCLUDING THE SELF-CLAIMABLE ONES,
  // and that is a decision the owner made explicitly on 2026-09-18: *"even they
  // can self claim, I want everyone list that has information missing... waiting
  // for them to selfclaim seems bad, I want to get data from other team as much
  // as possible"*. `docs/HOUSE-DATA-REPAIR.md` §3 says a held row with BOTH
  // รหัส and ชื่อ CAN be closed by the student signing in — that stays true, and
  // สถานะ still says which rows those are. It is a statement about who is ABLE
  // to close it, not a reason to wait: 142 people had been able to for weeks.
  // Collect the address, import them, and the self-claim never has to happen.
  if (status !== STATUS.normal) out.push('kkumail');
  return out;
}

const saiOf = (r) => r.sai_code || r.sai || '';
const nickOf = FIELDS.find((f) => f.key === 'nickname').get;

function toRow(r, status, { includeKkumail, problems = [] }) {
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
    missing: missingFields(r, status),
    problems,
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
/**
 * Per-person problems that are not "a cell is empty" — the ERROR half of
 * "ข้อมูลขาดหรือผิด".
 *
 * Only what can be attributed to a NAMED person, computed with the SAME
 * grouping `computeGaps`'s สายรหัส audit uses (`groupOccupantsByCohort` +
 * `groupBySaiNumber`, imported), so the sheet and the ข้อมูลไม่ครบ tab cannot
 * disagree about who shares a สาย.
 *
 * ⛔ A SKIPPED สาย IS DELIBERATELY NOT HERE. "รุ่นนี้ไม่มีใครอยู่สาย 007" is a
 * fact about a รุ่น, not about a person, and there is no row to write it on —
 * `computeGaps` reports it per รุ่น and that is the right place. Putting it on
 * the nearest person's row would accuse them of something the arithmetic never
 * tested.
 *
 * @returns {Map<object, string[]>} row-object → problems, keyed by IDENTITY so
 *   two people with the same name never collide.
 */
export function findProblems(occupants = []) {
  const out = new Map();
  const add = (r, msg) => {
    if (!out.has(r)) out.set(r, []);
    out.get(r).push(msg);
  };
  for (const r of occupants) {
    // Stamped by the importer when a person the database holds was NOT in the
    // newest file: either they left, or the file dropped them. Both need a human.
    if (r.missing_since) add(r, 'หายจากไฟล์รายชื่อล่าสุด');
  }
  for (const [, rows] of groupOccupantsByCohort(occupants)) {
    for (const [n, people] of groupBySaiNumber(rows)) {
      if (people.length < 2) continue;
      const sai = String(n).padStart(3, '0');
      for (const p of people) {
        const others = people.filter((q) => q !== p)
          .map((q) => [q.first_name_th, q.last_name_th].filter(Boolean).join(' ').trim())
          .filter(Boolean).join(', ');
        // บ้าน is the LAST DIGIT of สาย, so a duplicate means at least one of
        // them is in the wrong บ้าน — which is why this is an error and not a
        // tidiness note.
        add(p, `สาย ${sai} ซ้ำกับ ${others || '(ไม่มีชื่อ)'}`);
      }
    }
  }
  return out;
}

export function buildYearSheets(d = {}) {
  const students = d.students || [];
  const held = (d.held || []).filter((h) => !h.resolved_at);
  const { heldAdmin, heldSelf } = splitHeld(held);

  const sheets = new Map();
  const unplaced = [];

  // One pass over EVERYONE first: a duplicate สาย is a fact about a PAIR, so it
  // cannot be computed while placing one row at a time.
  const problems = findProblems([...students, ...held]);

  const place = (r, status, opts) => {
    const label = cohortLabel(r);
    const row = toRow(r, status, { ...opts, problems: problems.get(r) || [] });
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

/**
 * The rows a HANDOVER is actually about: someone whose record is incomplete, or
 * who is not in the system properly yet.
 *
 * Two independent reasons, and they are NOT the same question:
 *   • `missing` — a field the ข้อมูลครบแค่ไหน panel counts as empty, and
 *   • a สถานะ other than ปกติ — the person is held, so there is no row to fill
 *     a field ON until they are imported or claim their seat.
 * A row can have either without the other, so this is an OR. Emitting only the
 * first would silently drop the 165 held people, who are the population the
 * handover exists for.
 */
export function hasIssue(row) {
  return row.missing.length > 0 || row.problems.length > 0 || row.status !== STATUS.normal;
}

/**
 * How hard it is worth chasing. ONE rule, stated once, and the sheet sorts on
 * it: everything except a lone missing ชื่อเล่น is worth a request, because
 * every other field either identifies the person (ชื่อ, นามสกุล, รหัสนักศึกษา),
 * places them (สาย → บ้าน is its last digit) or lets them into the system at
 * all (kkumail).
 */
export function priorityOf(row) {
  if (row.problems.length > 0) return PRIORITY.high;
  const required = row.missing.filter((m) => !m.includes('(ไม่บังคับ)'));
  return required.length > 0 ? PRIORITY.high : PRIORITY.low;
}

const csvCell = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
export function toCsv(rows) {
  const lines = [HEADER, ...rows.map((r) => [
    r.studentId, r.firstName, r.lastName, r.nickname,
    r.sai, r.house, r.status, priorityOf(r), r.missing.join(' · '),
    r.problems.join(' · '), r.kkumail, r.note,
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
  // --gaps-only emits ONLY the rows a handover is about. The full roster stays
  // the default: it is the file a year admin reads to check a สาย, and the two
  // land under different names so one can never be mistaken for the other.
  const GAPS = args.includes('--gaps-only');

  const target = announceTarget(loadEnv());
  const ask = async (sql) => JSON.parse(await runSql(sql, target));

  // Same columns house-gaps.mjs reads, for the same reason: a column missing
  // here reads as "nobody has one", a silent wrong answer instead of an error.
  const [students, held] = await Promise.all([
    ask(`select student_id, first_name_th, last_name_th, nickname,
                nickname_imported, nickname_self, sai_code, cohort_year, kkumail
           from public.students`),
    ask(`select id::text, student_id, first_name_th, last_name_th, nickname_imported,
                sai_code as sai, cohort_year, resolved_at
           from public.student_import_unresolved`),
  ]);

  const built = buildYearSheets({ students, held });
  let { sheets, unplaced } = built;

  // Report BOTH numbers whichever mode is running — "43 rows" means nothing
  // without "out of 305", and a filter is exactly the place a silent
  // over-match hides.
  const labelsAll = [...sheets.keys()].sort();
  console.log(`\n  รุ่น        แถว  ${GAPS ? '(ข้อมูลไม่ครบ / ทั้งหมด)' : ''}`);
  console.log('  ──────────  ────');
  for (const label of labelsAll) {
    const rows = sheets.get(label);
    const n = GAPS ? rows.filter(hasIssue).length : rows.length;
    console.log(`  ${label.padEnd(10)}  ${String(n).padStart(4)}`
      + (GAPS ? `  / ${rows.length}` : ''));
  }
  if (GAPS) {
    // สูง first: this file is a work queue, and the สาย order the full roster
    // needs is the wrong order for one. Within a priority it stays as built,
    // which is สาย ascending.
    const byPriority = (a, b) => (priorityOf(a) === priorityOf(b) ? 0
      : (priorityOf(a) === PRIORITY.high ? -1 : 1));
    sheets = new Map(labelsAll
      .map((l) => [l, sheets.get(l).filter(hasIssue).sort(byPriority)])
      .filter(([, rows]) => rows.length > 0));
    unplaced = unplaced.filter(hasIssue).sort(byPriority);
  }
  const labels = [...sheets.keys()].sort();
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
  const suffix = GAPS ? '-ข้อมูลไม่ครบ' : '';
  const toWrite = [...labels.map((l) => [`${l}${suffix}.csv`, sheets.get(l)]),
    ...(unplaced.length ? [[`_unplaced${suffix}.csv`, unplaced]] : [])];

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
