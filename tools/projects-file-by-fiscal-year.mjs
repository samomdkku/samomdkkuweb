#!/usr/bin/env node
// ============================================================
// projects-file-by-fiscal-year.mjs — put every หนังสือโครงการ's Drive folder
// into the year folder of the ปีงบ it counts in (0269; owner 2026-10-31:
// "File them by ปีงบ", the 46 flat folders included).
//
//   node tools/projects-file-by-fiscal-year.mjs            # dry run: the plan
//   CONFIRM=1 node tools/projects-file-by-fiscal-year.mjs  # do it
//   … --dev                                                 # plan against samo-dev (never moves)
//
// ORDER — run it only when ALL of these are true, or files split in two:
//   1. 0269 is applied (projects.drive_year_be exists);
//   2. the bundle that reads drive_year_be is SERVED (the old bundle builds
//      paths from drive_layout + samo_year_be and would recreate the old
//      folder on the next upload);
//   3. Apps Script with `moveProjectFolderToYear` is deployed (npm run deploy:gas).
//
// Per โครงการ: target = projectFiscalYear (the label, the same function the
// ปีงบ filter uses), from = projectDriveYear (where the folder is recorded).
// Apps Script moves the folder (ids kept, so every file link still works),
// THEN drive_year_be is written — never before, so the column can only ever
// say where the files really are. A refusal leaves that row untouched and is
// listed at the end. Safe to re-run: a folder already moved answers
// alreadyThere, a โครงการ with no folder yet answers notFound (the new year
// then applies to its first upload).
//
// Paced (PACE_MS): hammering the /exec URL makes Google serve HTML to REAL
// uploads (memory: gas-is-an-unauthenticated-api).
// ============================================================
import { readFileSync } from 'node:fs';
import { projectFiscalYear } from '../src/js/projects/fiscal-year.js';
import { projectDriveYear } from '../src/js/projects/data.js';

const DEV = process.argv.includes('--dev');
const CONFIRM = process.env.CONFIRM === '1';
const PACE_MS = 2500;

const readEnvFile = () => {
  try { return readFileSync(new URL('../.env.local', import.meta.url), 'utf8'); }
  catch { return ''; }
};
const env = Object.fromEntries(
  readEnvFile()
    .split('\n').filter((l) => l.trim() && !l.trim().startsWith('#') && l.includes('='))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')]; }),
);
const URL_KEY = DEV ? 'SUPABASE_DEV_URL' : 'VITE_SUPABASE_URL';
const PAT_KEY = DEV ? 'SUPABASE_DEV_ACCESS_TOKEN' : 'SUPABASE_ACCESS_TOKEN';
const REF = (env[URL_KEY] || '').match(/https:\/\/([a-z0-9]+)\.supabase/)?.[1];
if (!REF || !env[PAT_KEY]) {
  console.error(`need ${URL_KEY} + ${PAT_KEY} in .env.local`);
  process.exit(2);
}
const GAS = readFileSync(new URL('../src/js/config.js', import.meta.url), 'utf8')
  .match(/GAS_API_URL\s*=\s*\n?\s*'([^']+)'/)?.[1];
if (!GAS) { console.error('could not read GAS_API_URL from src/js/config.js'); process.exit(2); }

console.log(`→ project: ${REF}${REF === 'fheueuowbchsnsvbcgil' ? '  [PRODUCTION]' : ''}`);
console.log(CONFIRM ? '→ CONFIRM=1: moving folders and recording them\n' : '→ dry run: nothing is moved or written (CONFIRM=1 to do it)\n');
// There is ONE Drive. Moving real folders while recording the move in samo-dev
// would leave PRODUCTION's rows pointing at the folders' old place — every
// later upload would recreate it and split the files. --dev is a dry run only.
if (DEV && CONFIRM) {
  console.error('✗ --dev is plan-only: Apps Script moves the ONE real Drive, so the record must go to production.');
  process.exit(2);
}

async function sql(query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env[PAT_KEY]}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${t.slice(0, 300)}`);
  return JSON.parse(t);
}

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

/** POST to Apps Script; null when it never answered JSON (UNREACHABLE — never
 *  read as success). */
async function gas(body, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(GAS, {
        method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(body), signal: AbortSignal.timeout(60000),
      });
      const t = await r.text();
      if (t.trim().startsWith('{')) return JSON.parse(t);
    } catch { /* timeout or network — retry */ }
    await sleep(8000 * (i + 1));
  }
  return null;
}

const cols = await sql(`select column_name from information_schema.columns
  where table_schema = 'public' and table_name = 'projects' and column_name = 'drive_year_be'`);
if (!cols.length) { console.error('✗ projects.drive_year_be does not exist — apply 0269 first.'); process.exit(2); }

const rows = await sql(`select id, name, created_at, fiscal_year_be, drive_layout, samo_year_be, drive_year_be
  from public.projects order by created_at`);

const plan = [];
for (const p of rows) {
  const to = projectFiscalYear(p);
  const from = projectDriveYear(p);
  if (to == null || Number(from) === Number(to)) continue;
  plan.push({ p, from: from == null ? null : Number(from), to: Number(to) });
}

console.log(`${rows.length} โครงการ · ${plan.length} to file · ${rows.length - plan.length} already in their ปีงบ folder\n`);
for (const { p, from, to } of plan) {
  console.log(`  ${p.id}  ${from == null ? 'Projects/' : `Projects/${from}/`} → Projects/${to}/   ${String(p.name || '').slice(0, 50)}`);
}
if (!CONFIRM || !plan.length) process.exit(0);

const failed = [];
let moved = 0, notFound = 0, already = 0;
for (const { p, from, to } of plan) {
  const res = await gas({ action: 'moveProjectFolderToYear', projectId: p.id, fromYear: from == null ? '' : String(from), toYear: String(to) });
  if (!res) { failed.push(`${p.id}: Apps Script unreachable`); await sleep(PACE_MS); continue; }
  if (!res.success) { failed.push(`${p.id}: ${res.message}`); await sleep(PACE_MS); continue; }
  if (res.moved) moved++; else if (res.alreadyThere) already++; else if (res.notFound) notFound++;
  // Drive answered: the folder is in `to` now (or will be created there).
  // `is not distinct from` on the old value: if someone moved it in the app
  // meanwhile, do not overwrite their record.
  const fromSql = from == null ? 'null' : String(from);
  const upd = await sql(`update public.projects set drive_year_be = ${to}
    where id = '${p.id.replace(/'/g, "''")}' and drive_year_be is not distinct from ${p.drive_year_be == null ? 'null' : Number(p.drive_year_be)}
    returning id`);
  if (!upd.length) failed.push(`${p.id}: Drive moved to ${to} (from ${fromSql}) but the row changed meanwhile — check it by hand`);
  console.log(`  ✓ ${p.id} → ${to}${res.moved ? '' : res.alreadyThere ? ' (already there)' : ' (no folder yet)'}`);
  await sleep(PACE_MS);
}

console.log(`\nmoved ${moved} · already there ${already} · no folder yet ${notFound} · failed ${failed.length}`);
for (const f of failed) console.log(`  ✗ ${f}`);
process.exit(failed.length ? 1 : 0);
