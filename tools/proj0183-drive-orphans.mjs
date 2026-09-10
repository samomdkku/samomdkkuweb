#!/usr/bin/env node
// ============================================================
// proj0183-drive-orphans.mjs — compare Google Drive against the database, in
// BOTH directions, and say what only one side knows about.
//
//   node tools/proj0183-drive-orphans.mjs           # report
//   node tools/proj0183-drive-orphans.mjs --json    # machine-readable
//
// WHY THIS EXISTS. It is the gap that let 0181 hide for six days, asked for by
// the owner on 2026-09-09 as *"what is in Drive that we have no row for?"*.
// Three signed หนังสือโครงการ reached Drive while the database row was refused;
// the PDFs were real, correct and referenced by nothing, and no screen, query or
// job in this system could notice. The owner found them by opening Drive by
// hand. This is that question, asked automatically.
//
// IT WRITES NOTHING, EVER. There is no --apply. Deciding which of two files is
// the real signature is not a judgement a script should make — the 2026-09-09
// repair took five checks and a human reading filenames — so this reports and
// `tools/proj0181-repair-orphans.mjs` is what re-attaches, from pinned ids.
//
// BOTH DIRECTIONS, because each answers a different failure:
//   · DB → Drive: a row whose file is gone, moved out of Projects/, or TRASHED.
//     `trashed` matters and is easy to get wrong: DriveApp resolves a trashed
//     file and lh3 still serves it, so "deleted in Drive" is not "gone"
//     (docs/mistakes/integrations.md). A folder listing cannot see it either —
//     Drive omits trashed files from getFiles() — which is why this direction
//     uses statProjectFiles and the other uses listProjectFolderFiles.
//   · Drive → DB: a file in a หนังสือ's folder with no `project_files` row.
//     That is 0181's own signature.
//
// ⛔ THE CONTROLS, because a sweep that examined nothing must not print a clean
// bill of health. This repo has paid for that shape more than once, most
// recently a proof that was green while the thing it measured was switched off.
//   1. Zero rows fetched, or zero folders listed, is a FAILURE, not "0 orphans".
//   2. `folderFound: false` for a folder we hold rows for is a FINDING — the
//      walk failed or somebody moved the folder — never silently "no orphans".
//   3. A folder we could not list at all is counted and reported separately, so
//      "63 of 63 examined" is on the page beside the verdict. "No orphans found"
//      and "the listing failed" must never render the same.
//
// ⚠️ WHAT IT CANNOT SEE, stated rather than implied: a folder in which we hold
// ZERO rows. `listProjectFolderFiles` requires `knownFileId` — a deliberate
// security gate, because that GAS `/exec` URL is public and unauthenticated and
// a bare listing would let anyone enumerate signed หนังสือ (see the handler's
// header) — so this sweep can only look where it already has a foothold. That
// is not the 0181 shape, where the folder held the unsigned original all along.
//
// ⚠️ GAS INTERMITTENTLY RETURNS AN HTML PAGE. Rapid successive POSTs to /exec
// get Google's Thai "ขออภัย ไม่สามารถเปิดไฟล์ได้ในเวลานี้" page instead of JSON —
// four in a row did on 2026-09-10, which briefly looked exactly like a broken
// deploy. Every call here retries with spacing, and a call that never returns
// JSON is reported as UNREACHABLE rather than as an empty folder.
// ============================================================
import { readFileSync } from 'node:fs';
// IMPORTED, never re-implemented: proj0181-repair-orphans.mjs learned this the
// hard way — a hand-written slugify beside the real one got Thai wrong, and a
// wrong path silently lists the wrong folder.
import { buildDocFolderPath } from '../src/js/projects/data.js';

const JSON_OUT = process.argv.includes('--json');
const ROWS_ONLY = process.argv.includes('--rows-only');
const FOLDERS_ONLY = process.argv.includes('--folders-only');

// ⛔ THIS TOOL SHARES ONE PUBLIC ENDPOINT WITH EVERY REAL DRIVE UPLOAD IN THE
// APP, AND CALLING IT HARD DEGRADES THAT ENDPOINT FOR STUDENTS. Measured
// 2026-09-10, same probe (`uploadTeamFile` with no argument) throughout:
//
//   while this sweep was running flat out   2 of 3 replies were Google's HTML page
//   with the sweep stopped, 10 s apart      1 of 4
//   with the sweep stopped, 3 s apart       4 of 5 JSON  (both bare and with a
//                                            browser User-Agent + Origin — so it
//                                            tracks RATE, not client identity)
//
// `src/js/uploads.js` does `await res.json()` with no retry and no content-type
// check, so an HTML reply surfaces to a student as a parse error on a real
// upload. That is why this paces itself and why an HTML reply backs off HARD
// rather than retrying promptly: the polite thing and the reliable thing are the
// same thing here. Run it when nobody is submitting, and prefer --rows-only.
const PACE_MS = 2500;

// ⚠️ SMALL ON PURPOSE, and the numbers are measured (2026-09-10, production):
//
//     1 id  → 28.3 s   ← COLD START, not per-file cost. Do not read this one.
//     5 ids → 20.2 s
//    20 ids → 17.4 s   JSON ✓
//   100 ids → 83.2 s   Google's HTML error page ✗ (with a 300 s client timeout,
//                       so this is Apps Script/its frontend giving up, NOT us)
//
// Fitting the two warm points: ~0.8 s PER FILE and ~1 s fixed. The per-file
// cost is `fileLivesUnderProjects_`, which walks each file's ENTIRE ancestor
// chain to enforce the allow-list — several Drive round trips each. So the
// ceiling is Drive's per-file work, not the payload, which is why 20 sits far
// below the handler's own 200-id cap: 200 would be ~2.7 minutes and fail.
//
// ⚠️ THE 1-ID READING IS A TRAP AND IT FOOLED ME FOR A TURN. It was the first
// call after a redeploy, so it carries Apps Script's cold start; taken at face
// value it says fixed overhead dominates and batch size does not matter, which
// is the opposite of the truth. Time a warm call, and time TWO sizes before
// concluding anything about which term dominates.
const STAT_BATCH = 20;

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter((l) => l.trim() && !l.trim().startsWith('#') && l.includes('='))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')]; }),
);
const REF = (env.VITE_SUPABASE_URL || '').match(/https:\/\/([a-z0-9]+)\.supabase/)?.[1];
if (!REF || !env.SUPABASE_ACCESS_TOKEN) {
  console.error('need VITE_SUPABASE_URL + SUPABASE_ACCESS_TOKEN in .env.local');
  process.exit(2);
}
const GAS = readFileSync(new URL('../src/js/config.js', import.meta.url), 'utf8')
  .match(/GAS_API_URL\s*=\s*\n?\s*'([^']+)'/)?.[1];
if (!GAS) { console.error('could not read GAS_API_URL from src/js/config.js'); process.exit(2); }

const log = (...a) => { if (!JSON_OUT) console.log(...a); };
log(`→ project: ${REF}${REF === 'fheueuowbchsnsvbcgil' ? '  [PRODUCTION]' : ''}`);
log('→ read-only: this tool never writes to Drive or the database\n');

async function sql(query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${t.slice(0, 300)}`);
  return JSON.parse(t);
}

/**
 * POST to GAS, retrying past the HTML interstitial. Returns null if it never
 * answered JSON — which is UNREACHABLE and must not be read as "empty".
 *
 * ⚠️ THE TIMEOUT IS PER CALL SITE, AND THE FIRST VERSION GOT IT WRONG. One
 * 120 s timeout was used for everything, because a 20-file stat batch really
 * does need ~17 s and wants headroom. But a SINGLE-folder listing takes about
 * two seconds, so a stuck one sat for 120 s and then did it three more times:
 *
 *   4 attempts x 120 s + (3+6+9+12) s of backoff = 8.5 MINUTES for one folder,
 *
 * across 63 folders. Read-only and harmless, but it turns a five-minute sweep
 * into something nobody will wait for — and a tool nobody runs guards nothing.
 * So each call site passes its own ceiling, sized from the measurement above.
 */
async function gas(body, { tries = 4, timeoutMs = 30000 } = {}) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(GAS, {
        method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs),
      });
      const t = await r.text();
      if (t.trim().startsWith('{')) { await pace(); return JSON.parse(t); }
      htmlReplies++;
    } catch { /* timeout or network — retry */ }
    // An HTML reply means we are pushing too hard, and pushing harder is what
    // breaks a student's upload. Back off well past the pace, not just past the
    // last attempt.
    await new Promise((res) => setTimeout(res, 8000 * (i + 1)));
  }
  return null;
}

let htmlReplies = 0;
const pace = () => new Promise((res) => setTimeout(res, PACE_MS));

// ── the two sides ───────────────────────────────────────────────────────────
const rows = await sql(`
  select f.id, f.drive_file_id, f.file_name, f.size_bytes, f.is_signed,
         f.document_id, d.title as doc_title, d.project_id,
         p.name as project_name
    from public.project_files f
    join public.project_documents d on d.id = f.document_id
    join public.projects p on p.id = d.project_id
   where f.drive_file_id is not null
   order by f.document_id, f.id`);

// CONTROL 1 — nothing to examine is a failure, not a clean result.
if (rows.length === 0) {
  console.error('✗ CONTROL FAILED: zero project_files rows carry a drive_file_id.');
  console.error('  A sweep with no subject cannot report "no orphans". Check the query.');
  process.exit(1);
}
log(`→ ${rows.length} Drive-backed rows across ${new Set(rows.map((r) => r.document_id)).size} หนังสือ\n`);

// ── direction 1: DB → Drive ─────────────────────────────────────────────────
if (!FOLDERS_ONLY) log('── every row: is its file still there? ───────────────────────────────');
const byId = new Map(rows.map((r) => [r.drive_file_id, r]));
const stats = new Map();
const ids = [...byId.keys()];
for (let i = 0; !FOLDERS_ONLY && i < ids.length; i += STAT_BATCH) {
  const batch = ids.slice(i, i + STAT_BATCH);
  const res = await gas({ action: 'statProjectFiles', fileIds: batch }, { timeoutMs: 90000 });
  if (!res || !res.success) {
    console.error(`✗ statProjectFiles failed for batch ${i / STAT_BATCH + 1}: ${res ? res.message : 'UNREACHABLE (HTML after retries)'}`);
    process.exit(1);
  }
  for (const f of res.files) stats.set(f.fileId, f);
  log(`   batch ${i / STAT_BATCH + 1}/${Math.ceil(ids.length / STAT_BATCH)}: ${res.files.length} file(s) examined`);
}
// CONTROL 3 — every id must have come back with an answer.
const unanswered = ids.filter((id) => !stats.has(id));
const missing  = [...stats.values()].filter((f) => !f.resolves);
const trashed  = [...stats.values()].filter((f) => f.resolves && f.trashed);
const sizeDrift = [...stats.values()].filter((f) => {
  const r = byId.get(f.fileId);
  return f.resolves && r && r.size_bytes != null && Number(f.sizeBytes) !== Number(r.size_bytes);
});

// ── direction 2: Drive → DB (the 0181 question) ─────────────────────────────
if (!ROWS_ONLY) log('\n── every หนังสือ folder: is there a file we have no row for? ──────────');
const docs = new Map();
for (const r of rows) {
  if (!docs.has(r.document_id)) docs.set(r.document_id, { rows: [], ...r });
  docs.get(r.document_id).rows.push(r);
}
const orphans = [];
const notFound = [];
const unreachable = [];
let listed = 0;
for (const [docId, d] of (ROWS_ONLY ? [] : docs)) {
  const path = buildDocFolderPath(d.project_id, d.project_name, docId, d.doc_title);
  const known = d.rows.find((r) => stats.get(r.drive_file_id)?.resolves)?.drive_file_id;
  if (!known) { unreachable.push({ docId, path, why: 'no resolvable row to unlock the folder' }); continue; }
  const res = await gas({ action: 'listProjectFolderFiles', folderPath: path, knownFileId: known }, { timeoutMs: 25000 });
  if (!res) { unreachable.push({ docId, path, why: 'UNREACHABLE (HTML after retries)' }); continue; }
  if (!res.success) { unreachable.push({ docId, path, why: res.message }); continue; }
  // CONTROL 2 — a folder we hold rows for that is not there is a FINDING.
  if (!res.folderFound) { notFound.push({ docId, path, rows: d.rows.length }); continue; }
  listed++;
  const have = new Set(d.rows.map((r) => r.drive_file_id));
  for (const f of res.files) {
    if (!have.has(f.fileId)) {
      orphans.push({ docId, doc: d.doc_title, project: d.project_name, path, ...f });
    }
  }
  if (listed % 10 === 0) log(`   ${listed}/${docs.size} folders listed…`);
}

// CONTROL 1b — listing nothing is a failure, never "no orphans".
if (!ROWS_ONLY && listed === 0) {
  console.error(`\n✗ CONTROL FAILED: 0 of ${docs.size} folders could be listed.`);
  console.error('  "No orphans found" and "the listing never worked" must not look the same.');
  process.exit(1);
}

// ── the verdict ─────────────────────────────────────────────────────────────
const findings = { orphans, missing, trashed, sizeDrift, notFound, unreachable, unanswered };
if (JSON_OUT) {
  console.log(JSON.stringify({ examined: { rows: rows.length, folders: docs.size, listed }, findings }, null, 2));
} else {
  console.log(`\n── examined ─────────────────────────────────────────────────────────`);
  console.log(`   ${stats.size}/${ids.length} rows stat'd · ${listed}/${docs.size} folders listed`);
  console.log(`   ${htmlReplies} HTML reply/replies from GAS (rate pressure — see PACE_MS)`);
  const show = (name, arr, fmt) => {
    console.log(`\n   ${arr.length ? '⚠' : '✓'} ${name}: ${arr.length}`);
    for (const x of arr.slice(0, 20)) console.log(`      ${fmt(x)}`);
    if (arr.length > 20) console.log(`      …and ${arr.length - 20} more`);
  };
  show('Drive files with NO database row (the 0181 shape)', orphans,
    (o) => `${o.fileName}  ${o.sizeBytes}B  created ${o.createdAt}\n         in ${o.path}\n         ${o.url}`);
  show('rows whose file no longer resolves', missing, (m) => `${byId.get(m.fileId)?.file_name} — ${m.reason} (${m.fileId})`);
  show('rows whose file is TRASHED (still publicly served)', trashed, (t) => `${t.fileName} (${t.fileId})`);
  show('rows whose size disagrees with Drive', sizeDrift,
    (s) => `${s.fileName}: db ${byId.get(s.fileId)?.size_bytes} vs drive ${s.sizeBytes}`);
  show('folders we hold rows for that are NOT in Drive', notFound, (n) => `${n.path} (${n.rows} row(s))`);
  show('folders that could not be examined', unreachable, (u) => `${u.path} — ${u.why}`);
  show('ids that came back with no answer at all', unanswered, (i) => i);
}

const total = Object.values(findings).reduce((n, a) => n + a.length, 0);
if (!JSON_OUT) {
  console.log(total === 0
    ? '\n✓ Drive and the database agree, in both directions.'
    : `\n⚠ ${total} finding(s) — read them above. This tool never repairs; see tools/proj0181-repair-orphans.mjs.`);
}
process.exit(total === 0 ? 0 : 1);
