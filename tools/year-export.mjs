#!/usr/bin/env node
// ============================================================
// year-export.mjs — ONE shared export shape, for every system, for one
// SAMO year at a time. Design: docs/YEAR-ROLLOVER.md § Export / § Backup.
// Runbook: skills/backup-and-export.md. Night agent, task 5 of the
// 2026-10-14 queue.
//
// WHY ONE TOOL AND NOT FOUR. The design doc's own § Export decision is
// explicit: "four near-identical implementations is the class 6 bug waiting
// to happen the moment one of them needs a fix." This is that one
// implementation — PR, VS, Shop and หนังสือโครงการ (and ทีม SAMO's own
// archive tables) all go through the SAME registry below.
//
// WHAT "reads through the same column lists the app uses" MEANS HERE. Every
// admin screen in this codebase that lists a whole table already asks
// PostgREST for `select=*` (pr-staff.js, vs-staff.js) or a named constant
// that is itself `*` plus a nested child select (shop/api.js's ORDER_FIELDS
// = '*,items:shop_order_items(*)', projects/api.js's PROJECT_FIELDS =
// '*,documents:project_documents(*,sign_requests:project_sign_requests(*))').
// So "the same column list" is: every column, plus the same nested shape —
// this file does not invent a narrower or wider column set than the
// dashboard the data came from already shows an admin. If either constant
// changes, `year-export.test.js` greps the SOURCE file and fails — the
// mirror this repo's mistakes file (class 6) says every copy needs.
//
// DRY RUN / PLAN BY DEFAULT. Nothing is written to disk, nothing is sent to
// Drive, and nothing is recorded in year_export_log unless --apply is given.
//
// NEVER PRINTS A ROW TO STDOUT. The export FILES contain full data — that is
// the point of exporting — but every console.log in this file prints only
// counts, paths and the destination, never a field value. If you add a new
// log line, it must pass that test too.
//
//   node tools/year-export.mjs --help
//   node tools/year-export.mjs --list
//   node tools/year-export.mjs --system pr_tickets --year 2569
//   node tools/year-export.mjs --system shop_orders --year 2569 --apply --out ./exports
//   node tools/year-export.mjs --system projects --year 2569 --apply --drive
// ============================================================
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { csvGuard } from '../src/js/utils.js';

// ---------------------------------------------------------------------------
// The registry. One entry per exportable system. `yearColumn` is the
// STORED column this tool prefers when it exists on the live table (not
// every system has one yet — PR (0220) does, VS/Shop/Projects do not until
// tasks 6/7/9 ship their own `samo_year_be`). `timestampColumn` is the
// fallback: the same instant-of-creation column each system's own migration
// backfill already uses, fed through `samo_year_for_timestamp()` (0219).
// This means the tool needs NO change when a later task's migration adds
// its own stored column — it starts preferring it automatically.
//
// `children` are nested tables exported ALONGSIDE the parent, selected by
// the parent's own ids — never independently year-filtered, because a line
// item or a signed document belongs to whatever year its PARENT belongs to.
// ---------------------------------------------------------------------------
export const REGISTRY = {
  pr_tickets: {
    table: 'pr_tickets',
    idColumn: 'id',
    yearColumn: 'samo_year_be',
    timestampColumn: 'timestamp',
    children: [],
  },
  vs_tickets: {
    table: 'vs_tickets',
    idColumn: 'id',
    yearColumn: 'samo_year_be',
    timestampColumn: 'timestamp',
    // NOTE: vs_tickets ALREADY has a column literally named `year` — that is
    // the submitter's ชั้นปี (a student's year of study), unrelated to the
    // SAMO year this tool exports by. Never confuse the two; this registry
    // entry never reads that column.
    children: [],
  },
  shop_orders: {
    table: 'shop_orders',
    idColumn: 'id',
    yearColumn: 'samo_year_be',
    // shop_orders has NO created_at (STATE.md, measured 2026-10-13) — the
    // row's birth and `placed_at` are the same instant because
    // place_shop_order() sets both in the one INSERT (docs/YEAR-ROLLOVER.md
    // § SAMO Shop already notes the one way they can diverge: a backdated
    // admin walk-in order, which the trigger still stamps at the CURRENT
    // team's year regardless of what placed_at claims).
    timestampColumn: 'placed_at',
    children: [
      { table: 'shop_order_items', parentColumn: 'order_id' },
    ],
  },
  projects: {
    table: 'projects',
    idColumn: 'id',
    // Deliberately SEPARATE from `fiscal_year_be` (the real university ปีงบ
    // column) — see docs/YEAR-ROLLOVER.md § หนังสือโครงการ. This entry only
    // ever reads/derives `samo_year_be`.
    yearColumn: 'samo_year_be',
    timestampColumn: 'created_at',
    children: [
      {
        table: 'project_documents',
        parentColumn: 'project_id',
        children: [
          { table: 'project_sign_requests', parentColumn: 'document_id', parentOf: 'project_documents' },
        ],
      },
    ],
  },
  // ทีม SAMO's archive tables ALREADY carry a real, stored `year` column
  // (0104) — no derivation needed, and no `samo_year_be` rename: `year` here
  // means the same thing samo_year_be means everywhere else, just named
  // before this queue's convention existed. Exporting these is mostly
  // redundant with get_public_team_chart(year)/publish_team_term's own
  // snapshot, but a cold JSON/CSV copy outside the database is still worth
  // having per this doc's own "the export IS the backup artifact" decision.
  team_archive_nodes: {
    table: 'team_archive_nodes',
    idColumn: 'id',
    yearColumn: 'year',
    timestampColumn: null,
    children: [],
  },
  team_archive_members: {
    table: 'team_archive_members',
    idColumn: 'id',
    yearColumn: 'year',
    timestampColumn: null,
    children: [],
  },
};

// Not in the registry, and why (so a reader does not assume an oversight):
// vs_public_comments/vs_followers/vs_tags — task 6 (0221) deliberately did
// NOT add samo_year_be to any of these three; a public comment or a me-too
// follow belongs to whatever year the TICKET it hangs off belongs to, not an
// independent filing year of its own, so exporting vs_tickets already
// carries their parent id for a human to join against if ever needed —
// project_files (the app's own PROJECT_FIELDS select does not nest it either
// — it is read through Drive-backed GAS handlers, not this shape, per
// docs/YEAR-ROLLOVER.md § Drive), shop_pickup_batches (operational state,
// not named in the design doc's per-year decision).

// ---------------------------------------------------------------------------
// Pure helpers — no DB, no fs, no network. Exercised directly by
// year-export.test.js.
// ---------------------------------------------------------------------------

/** One CSV cell: RFC4180-quoted, formula-safe (csvGuard, src/js/utils.js) —
 *  same rule every CSV export in this repo already uses (pr-year.js,
 *  shop/data.js), reimplemented here because the rule is shared, not the
 *  quoting mechanics, which is the repo's own accepted shape (pr-year.js's
 *  own comment says so). */
export function csvCell(v) {
  if (v == null) return '""';
  const s = csvGuard(typeof v === 'object' ? JSON.stringify(v) : String(v));
  return `"${s.replace(/"/g, '""')}"`;
}

/** Rows (array of plain objects) + an explicit column order → one CSV
 *  string. UTF-8 BOM + CRLF, same convention as every export in this repo. */
export function rowsToCsv(rows, columns) {
  const header = columns.map((c) => csvCell(c)).join(',');
  const body = (rows || []).map((row) => columns.map((c) => csvCell(row[c])).join(','));
  return '﻿' + [header, ...body].join('\r\n');
}

/** The WHERE-clause fragment that selects one system's one SAMO year —
 *  prefers the STORED column when the live table has it, falls back to
 *  deriving from the timestamp column via samo_year_for_timestamp() (0219).
 *  Pure: told whether the column exists rather than checking itself, so this
 *  is testable with no database. */
export function yearWhereClause(entry, year, hasStoredColumn) {
  const y = Number(year);
  if (!Number.isFinite(y)) throw new Error(`yearWhereClause: bad year ${year}`);
  if (hasStoredColumn) return `${entry.yearColumn} = ${y}`;
  if (!entry.timestampColumn) {
    throw new Error(`yearWhereClause: ${entry.table} has no stored ${entry.yearColumn} and no timestampColumn to derive from`);
  }
  return `public.samo_year_for_timestamp(${entry.timestampColumn}) = ${y}`;
}

/** Drive destination path for an archive, mirroring docs/YEAR-ROLLOVER.md
 *  § Backup's decision: a NEW top-level folder, parallel to PR/Shop/Team/
 *  Projects/Passport, never inside any of them (an archive is not that
 *  system's live working folder). */
export function archiveFolderPath(year) {
  return `Archives/${year}`;
}

export function archiveFileName(system, year, ext) {
  return `${system}_${year}.${ext}`;
}

/** The exact GAS POST body for handleUploadArchiveFile (appscript/prform.gs).
 *  Pure — the seam year-export.test.js stubs to assert what would be SENT,
 *  without ever calling the real (unauthenticated, rate-limited) endpoint. */
export function buildGasUploadPayload({ system, year, fileName, mimeType, fileData }) {
  return {
    action: 'uploadArchiveFile',
    folderPath: archiveFolderPath(year),
    fileName,
    mimeType,
    fileData,
  };
}

/** Flatten one table's rows for CSV: nested child arrays (the way PostgREST
 *  returns `items:shop_order_items(*)`) are dropped from the FLAT csv (each
 *  child gets its OWN csv file, written separately) — only JSON keeps the
 *  nested shape. Returns the column list in first-row-key order, union'd
 *  across all rows so a row missing an optional key does not shift columns. */
export function csvColumnsFor(rows) {
  const cols = [];
  const seen = new Set();
  for (const row of rows || []) {
    for (const k of Object.keys(row)) {
      if (Array.isArray(row[k]) && row[k].length && typeof row[k][0] === 'object') continue; // nested child
      if (!seen.has(k)) { seen.add(k); cols.push(k); }
    }
  }
  return cols;
}

/** The plan: what WOULD be written/sent, computed from counts alone — never
 *  from row contents, so printing this plan can never leak personal data. */
export function buildPlan({ system, year, baseCount, childCounts }) {
  const files = [
    { path: `${system}/${year}/${system}_${year}.json`, rows: baseCount },
    { path: `${system}/${year}/${system}_${year}.csv`, rows: baseCount },
  ];
  for (const [childTable, count] of Object.entries(childCounts || {})) {
    files.push({ path: `${system}/${year}/${childTable}_${year}.csv`, rows: count });
  }
  return { system, year, baseCount, childCounts: childCounts || {}, files };
}

// ---------------------------------------------------------------------------
// IO — everything below actually touches the database, the filesystem or
// Drive. Each piece takes its dependency as an argument so tests can stub
// it (the "stub it and assert what comes OUT" rule, .claude/rules/
// mistakes.md class 7) instead of mocking a module.
// ---------------------------------------------------------------------------

export async function columnExists(table, column, target, runSqlFn) {
  const body = await runSqlFn(
    `select exists (select 1 from information_schema.columns
       where table_schema = 'public' and table_name = '${table}' and column_name = '${column}') as e`,
    target,
  );
  const rows = JSON.parse(body);
  return Boolean(rows?.[0]?.e);
}

async function fetchRows(table, whereSql, runSqlFn, target) {
  const body = await runSqlFn(`select * from public.${table} where ${whereSql}`, target);
  const rows = JSON.parse(body);
  if (!Array.isArray(rows)) throw new Error(`unexpected result reading ${table}: ${body.slice(0, 300)}`);
  return rows;
}

async function fetchChildren(child, parentIds, runSqlFn, target) {
  if (!parentIds.length) return [];
  const idList = parentIds.map((id) => `'${String(id).replace(/'/g, "''")}'`).join(',');
  const body = await runSqlFn(`select * from public.${child.table} where ${child.parentColumn} in (${idList})`, target);
  const rows = JSON.parse(body);
  if (!Array.isArray(rows)) throw new Error(`unexpected result reading ${child.table}: ${body.slice(0, 300)}`);
  return rows;
}

/** Fetch one level of children (and, recursively, THEIR children) against
 *  the ids a parent level just produced. `child.parentOf` is read here — it
 *  is NOT redundant with the tree position: it names which ANCESTOR table's
 *  ids a child is keyed against, which for a plain two-level nest (the one
 *  case this registry has today, project_sign_requests under
 *  project_documents) happens to equal the immediate parent, but a nest
 *  added later that needs to skip a level (or share one id set across two
 *  siblings) would silently use the WRONG ids if this ever stopped being
 *  read — so it is read explicitly, not assumed. */
async function fetchChildLevel(nodes, parentTable, idsByTable, runSqlFn, target, children) {
  for (const node of nodes || []) {
    const parentIds = idsByTable[node.parentOf || parentTable] || [];
    const rows = await fetchChildren(node, parentIds, runSqlFn, target);
    children[node.table] = rows;
    const nextIds = { ...idsByTable, [node.table]: rows.map((r) => r.id).filter((v) => v != null) };
    await fetchChildLevel(node.children, node.table, nextIds, runSqlFn, target, children);
  }
}

/** Resolve one system's nested shape for one year — the DB half. Returns
 *  { base: rows[], children: { table: rows[] } }, fetched top-down so a
 *  grandchild's ids come from its own level, never guessed from the root. */
export async function fetchExport(entry, year, { runSqlFn, target }) {
  const hasStored = await columnExists(entry.table, entry.yearColumn, target, runSqlFn);
  const where = yearWhereClause(entry, year, hasStored);
  const base = await fetchRows(entry.table, where, runSqlFn, target);
  const baseIds = base.map((r) => r[entry.idColumn]);

  const children = {};
  await fetchChildLevel(entry.children, entry.table, { [entry.table]: baseIds }, runSqlFn, target, children);
  return { base, children };
}

/** Every line the CLI prints about a plan — built ONLY from `plan` (which
 *  `buildPlan` builds from counts alone), never from a row. This is the seam
 *  year-export.test.js checks for the "never prints personal data" rule: if
 *  a future edit starts interpolating a row value in here, the test that
 *  feeds buildPlan a count-only object and greps these lines for anything
 *  that is not a number/path/system name will catch it. */
export function planLines(plan, outDir, apply) {
  const lines = [
    `${plan.system} / ${plan.year}: ${plan.baseCount} row(s)`
      + (Object.keys(plan.childCounts).length ? `, children: ${JSON.stringify(plan.childCounts)}` : ''),
  ];
  for (const f of plan.files) {
    lines.push(`  ${apply ? 'write' : 'would write'}  ${join(outDir, f.path)}  (${f.rows} row(s))`);
  }
  return lines;
}

function usage() {
  return [
    'year-export.mjs — export one system, one SAMO year, to JSON + CSV.',
    '',
    'Usage:',
    '  node tools/year-export.mjs --help',
    '  node tools/year-export.mjs --list',
    '  node tools/year-export.mjs --system <name> --year <BE> [--out DIR] [--apply] [--drive]',
    '',
    `Known systems: ${Object.keys(REGISTRY).join(', ')}`,
    '',
    'Plan only by default (nothing written). --apply writes JSON+CSV under',
    '<out>/<system>/<year>/ and records the export in year_export_log.',
    '--apply --drive ALSO uploads the written files to',
    'My Drive/IT Database/Archives/<year>/ via GAS (appscript/prform.gs,',
    'action uploadArchiveFile) — requires a deployed GAS bundle; this',
    'environment has no Drive credential, so --drive is written but never',
    'exercised here (see skills/backup-and-export.md).',
  ].join('\n');
}

async function main(argv = process.argv.slice(2)) {
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(usage());
    return;
  }
  if (argv.includes('--list')) {
    for (const [key, entry] of Object.entries(REGISTRY)) {
      console.log(`  ${key}  (table: ${entry.table}${entry.children.length ? `, +${entry.children.length} child table(s)` : ''})`);
    }
    return;
  }

  const get = (flag) => { const i = argv.indexOf(flag); return i === -1 ? null : argv[i + 1]; };
  const system = get('--system');
  const year = get('--year');
  const outDir = get('--out') || './exports';
  const apply = argv.includes('--apply');
  const drive = argv.includes('--drive');

  if (!system || !REGISTRY[system]) {
    console.error(`--system is required and must be one of: ${Object.keys(REGISTRY).join(', ')}`);
    process.exit(1);
  }
  // A plain integer ONLY — not just "finite": `Number("2569.5")` and
  // `Number(" 2569 ")` both pass Number.isFinite, and if the raw string
  // continued downstream into a folder name while the DB side coerces with
  // Number() too, "2569.5" would open a folder next to a database row filed
  // under the ROUNDED year 2570 — a silent, confusing mismatch for a typo
  // nobody would otherwise notice until the export was already on disk.
  if (!year || !/^\d+$/.test(year)) {
    console.error('--year is required and must be a plain integer, e.g. 2569');
    process.exit(1);
  }

  const { loadEnv, announceTarget, runSql } = await import('./env-lib.mjs');
  const target = announceTarget(loadEnv());
  const entry = REGISTRY[system];

  const { base, children } = await fetchExport(entry, year, { runSqlFn: runSql, target });
  const childCounts = Object.fromEntries(Object.entries(children).map(([t, rows]) => [t, rows.length]));
  const plan = buildPlan({ system, year, baseCount: base.length, childCounts });

  console.log('');
  for (const line of planLines(plan, outDir, apply)) console.log(line);

  if (!apply) {
    console.log('\nPLAN ONLY — nothing written, nothing recorded. Add --apply to write.');
    return;
  }

  const dir = join(outDir, system, String(year));
  mkdirSync(dir, { recursive: true });

  const jsonPath = join(dir, `${system}_${year}.json`);
  writeFileSync(jsonPath, JSON.stringify({ system, year: Number(year), exportedAt: new Date().toISOString(), rows: base, children }, null, 2));

  const csvPath = join(dir, `${system}_${year}.csv`);
  writeFileSync(csvPath, rowsToCsv(base, csvColumnsFor(base)));

  const writtenPaths = [jsonPath, csvPath];
  for (const [table, rows] of Object.entries(children)) {
    const childPath = join(dir, `${table}_${year}.csv`);
    writeFileSync(childPath, rowsToCsv(rows, csvColumnsFor(rows)));
    writtenPaths.push(childPath);
  }

  console.log(`\n✓ wrote ${writtenPaths.length} file(s) under ${dir}`);

  // Record the export FIRST — before any Drive upload — so a human
  // re-running after a Drive failure can tell "exported" from "exported AND
  // archived off-box" by the `destination` column, never by guessing.
  await runSql(
    `insert into public.year_export_log (system, samo_year_be, row_count, destination, note)
     values ('${system}', ${Number(year)}, ${base.length}, 'local:${dir.replace(/'/g, "''")}', 'tools/year-export.mjs')`,
    target,
  );
  console.log(`✓ recorded in year_export_log (system=${system}, year=${year}, row_count=${base.length})`);

  if (drive) {
    console.log('\n--drive requested: uploading to Drive Archives/<year>/ via GAS…');
    const gasUrl = readFileSync(new URL('../src/js/config.js', import.meta.url), 'utf8')
      .match(/GAS_API_URL\s*=\s*\n?\s*'([^']+)'/)?.[1];
    if (!gasUrl) { console.error('could not read GAS_API_URL from src/js/config.js — skipping Drive upload'); return; }
    for (const p of writtenPaths) {
      const fileName = p.split('/').pop();
      const mimeType = fileName.endsWith('.json') ? 'application/json' : 'text/csv';
      const fileData = `data:${mimeType};base64,${Buffer.from(readFileSync(p)).toString('base64')}`;
      const payload = buildGasUploadPayload({ system, year, fileName, mimeType, fileData });
      const res = await fetch(gasUrl, {
        method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload),
      }).then((r) => r.text()).catch((e) => `network error: ${e.message}`);
      console.log(`  ${fileName}: ${res.slice(0, 120)}`);
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(e.message || e); process.exit(1); });
}
