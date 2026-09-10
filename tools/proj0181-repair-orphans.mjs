#!/usr/bin/env node
// ============================================================
// proj0181-repair-orphans.mjs — re-attach the signed PDFs that reached Google
// Drive while the database refused the row.
//
//   node tools/proj0181-repair-orphans.mjs            # DRY RUN, writes nothing
//   node tools/proj0181-repair-orphans.mjs --apply    # commit the repair
//
// WHY THIS EXISTS, AND WHY IT IS NOT THE PROFESSOR'S JOB.
// Until migration 0181, an อาจารย์ saving a signed file on a หนังสือ whose
// โครงการ was hidden from the public site had the PDF written to Drive and the
// row REFUSED. The file was real, correct and signed; only our record of it was
// missing. Three หนังสือ shipped อนุมัติแล้ว with no signature because of it.
//
// The obvious remedy — "ask him to upload it again" — is the wrong one. It
// bills our defect to the person who already did the work correctly, it creates
// a SECOND Drive file and leaves the first orphaned, and it stamps the history
// with today's date, losing the fact that he signed on 2026-09-03. Re-attaching
// the file that already exists is both kinder and more accurate.
//
// WHAT IT WRITES, per orphan, in ONE transaction:
//   · the `project_files` row that should have been written at the time, with
//     `uploaded_at` taken from the DRIVE FILE'S OWN CREATION TIME, and
//     `uploaded_by` set to the อาจารย์ the request was addressed to;
//   · the `project_sign_requests.timeline` entry the failed run never appended;
//   · the `project_documents.timeline` entry, likewise.
//
// The two timeline entries say plainly that this was a system repair and name
// the date the signature was really made. **We do not write history claiming a
// person did something today that they did on 2026-09-03**, and we do not write
// history that hides that a repair happened — 0166 is this repo's lesson that a
// silent rewrite costs more than it saves.
//
// WHERE THE FILE IDS COME FROM. The owner read them out of Drive by hand,
// because in September 2026 this system had NO way to ask "what is in Drive that
// we have no row for?" — which is precisely why the fault hid for six days. They
// are pinned in ORPHANS below rather than discovered, and every one is
// re-verified against Drive at run time — a pinned id that rots is this repo's
// `proj0092` trap, so the run FAILS rather than proceeding if a check does not
// hold.
//
// ✅ **THAT IS NO LONGER TRUE, AND A FUTURE REPAIR SHOULD NOT ASK THE OWNER FOR
// LINKS.** `tools/proj0183-drive-orphans.mjs` answers the question now (Apps
// Script v12 added the read-only handlers it needs), so the next repair of this
// shape should FIND its orphans with that sweep and paste the ids it reports
// here. Two things it gives you that the 2026-09-09 repair did not have: the
// file's real `createdAt`, so the row can be dated when the work actually
// happened instead of falling back to the approval instant, and `trashed`, so a
// binned file is not mistaken for a healthy one. This paragraph is kept because
// the PINNING and its re-verification are still the right shape — discovery and
// trust are different problems, and a sweep telling you an id exists is not a
// reason to skip the five checks below.
//
// SAFETY
//   · DRY RUN by default. `--apply` is the only thing that writes.
//   · IDEMPOTENT: an orphan whose `drive_file_id` already has a row is skipped,
//     so a second run is a no-op rather than a duplicate.
//   · It only ever considers requests that are `accepted` with NO signed file —
//     the exact damage signature — and only PDFs that are not in Drive's trash.
//   · It never deletes anything. Superseded duplicates are REPORTED for a human
//     to remove, because "which of these two is the real signature" is not a
//     judgement a script should make.
//   · Every insert is checked back by reading the row again, because a refused
//     write returns zero rows rather than an error (this repo's delete-guard
//     rule, and the very fault being repaired).
// ============================================================
import { readFileSync } from 'node:fs';
// IMPORTED, never re-implemented. The first draft of this file hand-wrote a
// slugify beside the real one and got it wrong in every respect — the real one
// lower-cases, KEEPS Thai, and collapses everything else to '-'. A wrong path
// would have listed (or asked GAS to walk toward) the wrong folder. data.js has
// no imports of its own, so Node loads it directly: one home for the rule.
import { buildDocFolderPath } from '../src/js/projects/data.js';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l.trim() && !l.trim().startsWith('#') && l.includes('='))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')];
    }),
);

const PROJECT_REF = (env.VITE_SUPABASE_URL || '').match(/https:\/\/([a-z0-9]+)\.supabase/)?.[1];
if (!PROJECT_REF || !env.SUPABASE_ACCESS_TOKEN) {
  console.error('need VITE_SUPABASE_URL + SUPABASE_ACCESS_TOKEN in .env.local');
  process.exit(2);
}
console.log(`→ project: ${PROJECT_REF}${PROJECT_REF === 'fheueuowbchsnsvbcgil' ? '  [PRODUCTION]' : ''}`);
console.log(APPLY ? 'mode: APPLY (writes)\n' : 'mode: DRY RUN (writes nothing — pass --apply)\n');

const GAS_API_URL = readFileSync(new URL('../src/js/config.js', import.meta.url), 'utf8')
  .match(/export const GAS_API_URL\s*=\s*\n?\s*'([^']+)'/)?.[1];
if (!GAS_API_URL) { console.error('could not read GAS_API_URL from src/js/config.js'); process.exit(2); }

/** Run SQL through the Management API (superuser — RLS does not apply). */
async function sql(query) {
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    },
  );
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 400)}`);
  return JSON.parse(text);
}

async function gas(body) {
  const res = await fetch(GAS_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(body),
  });
  return res.json();
}

const q = (v) => (v == null ? 'null' : `'${String(v).replace(/'/g, "''")}'`);

/**
 * The orphans, keyed by sign-request id. Supplied by the owner from Drive and
 * VERIFIED before being written down (2026-09-09, read through GAS
 * getProjectFileData from a page-origin fetch):
 *
 *   request     file name returned by Drive                    size    orig size  producer
 *   SGN-6QZUL   เกียรติบัตร โครงการประดับช่อ 2569.pdf          396735   371654    1.6 vs 1.3
 *   SGN-BWZY9   หนังสือโครงการ HYROX101(เสนอ).pdf              262374   181282    1.6 vs 1.5
 *   SGN-L6LBM   โครงการประกวดสื่อสร้างสรรค์ ICEM COMARTS.pdf   294057   227626    1.6 vs 1.5
 *
 * Each is LARGER than the original it signs, carries a different PDF producer
 * version, and fingerprints differently — consistent with a document that was
 * signed and re-exported, and inconsistent with a stray copy of the original.
 * The returned FILE NAMES also independently confirm which orphan belongs to
 * which หนังสือ, so the mapping does not rest on the order they were pasted in.
 */
const ORPHANS = {
  'SGN-6QZUL': '1vhgyF5MsTzly-Vec0kxc4EnLgQ1w3EvT',
  'SGN-BWZY9': '13jPF2VFsQCRuzr_QzxhxH6CCXG4avhHv',
  'SGN-L6LBM': '1Akl5H4ujTT_iy8CeZBuQuxK_-TIwE3tO',
};

// ── 1. the damage list, derived from the fault's own signature ──────────────
const damaged = await sql(`
  select r.id as req_id, r.prof_id, r.decided_at, r.file_ids[1] as orig_file_id,
         d.id as doc_id, d.title as doc_title, d.sequence_no,
         p.id as project_id, p.name as project_name,
         (select f.file_name from public.project_files f where f.id = r.file_ids[1]) as orig_name
  from public.project_sign_requests r
  join public.project_documents d on d.id = r.document_id
  join public.projects p on p.id = d.project_id
  where r.status = 'accepted'
    and not exists (select 1 from public.project_files f
                     where f.sign_request_id = r.id and f.is_signed)
  order by r.decided_at`);

if (damaged.length === 0) {
  console.log('No accepted sign request is missing its signed file. Nothing to repair.');
  process.exit(0);
}
console.log(`${damaged.length} หนังสือ approved with no signed file on record:\n`);

let repaired = 0;
let skipped = 0;
const manual = [];

for (const row of damaged) {
  console.log(`\u2500\u2500 ${row.req_id}  ${row.doc_title.slice(0, 46)}`);
  const fileId = ORPHANS[row.req_id];
  if (!fileId) {
    console.log('   – no orphan recorded for this request; nothing to re-attach');
    skipped += 1;
    continue;
  }

  // ── verify, every run. A pinned id that has been trashed, replaced or already
  //    attached must stop the run, not be written on trust.
  const meta = await gas({ action: 'getProjectFileData', fileId });
  if (!meta.success) {
    console.log(`   \u2717 Drive rejected the file: ${meta.message}`);
    manual.push({ ...row, why: `Drive: ${meta.message}` }); continue;
  }
  const orig = await sql(`
    select id, file_name, size_bytes, drive_file_id
      from public.project_files where id = ${row.orig_file_id}`);
  const dupe = await sql(`
    select id from public.project_files where drive_file_id = ${q(fileId)}`);

  const checks = [
    ['is a PDF',                       /pdf/i.test(meta.mimeType)],
    ['not already attached',           dupe.length === 0],
    ['not the original itself',        orig[0] && orig[0].drive_file_id !== fileId],
    ['larger than the original',       orig[0] && Number(meta.sizeBytes) > Number(orig[0].size_bytes)],
    ['names match the original',       orig[0] && meta.fileName === orig[0].file_name],
  ];
  const failed = checks.filter(([, ok]) => !ok).map(([n]) => n);
  console.log(`   file: "${meta.fileName}"  ${meta.sizeBytes} bytes  (original ${orig[0]?.size_bytes})`);
  console.log(`   checks: ${checks.map(([n, ok]) => `${ok ? '\u2713' : '\u2717'} ${n}`).join('  ')}`);
  if (failed.length) {
    console.log(`   \u2717 REFUSING — ${failed.join(', ')}`);
    manual.push({ ...row, why: failed.join(', ') }); continue;
  }

  // The exact instant he uploaded is not recoverable — Drive's own creation time
  // is not exposed by any handler this project has, and inventing one would put a
  // false statement in an audit trail. Use the APPROVAL time, which the record
  // already holds, and say in the note that it is the approval time.
  const when = row.decided_at;
  const note = 'กู้คืนไฟล์ที่ลงนามโดยระบบ — อาจารย์อัปโหลดไฟล์นี้สำเร็จขึ้น Drive แล้ว '
             + 'แต่ระบบบันทึกลงฐานข้อมูลไม่สำเร็จเพราะข้อผิดพลาดด้านสิทธิ์ของระบบเอง (แก้แล้ว 2026-09-09) '
             + 'จึงนำไฟล์เดิมมาผูกกับหนังสือย้อนหลัง ไม่ได้ให้อาจารย์เซ็นใหม่ '
             + 'เวลาที่แสดงคือเวลาที่อาจารย์กดอนุมัติ (เวลาอัปโหลดจริงกู้คืนไม่ได้)';
  console.log(`   \u2192 will attach, dated ${when} (approval time), by the requested อาจารย์`);
  if (!APPLY) { repaired += 1; continue; }

  const stmt = `
begin;
insert into public.project_files
  (document_id, file_name, drive_file_id, drive_view_url, mime_type, size_bytes,
   uploaded_by, uploaded_at, sign_request_id, is_signed, signs_file_id)
values (${q(row.doc_id)}, ${q(meta.fileName)}, ${q(fileId)},
        ${q(`https://drive.google.com/file/d/${fileId}/view`)},
        ${q(meta.mimeType)}, ${Number(meta.sizeBytes)}, ${q(row.prof_id)}, ${q(when)},
        ${q(row.req_id)}, true, ${row.orig_file_id});
update public.project_sign_requests
   set timeline = coalesce(timeline, '[]'::jsonb) || jsonb_build_object(
         'at', ${q(when)}, 'by', ${q(row.prof_id)}, 'role', 'sa_prof',
         'action', 'signed_file', 'note', ${q(note)}, 'repaired', true)
 where id = ${q(row.req_id)};
update public.project_documents
   set timeline = coalesce(timeline, '[]'::jsonb) || jsonb_build_object(
         'at', ${q(when)}, 'by', ${q(row.prof_id)}, 'role', 'sa_prof',
         'action', 'signed_file', 'note', ${q(note)}, 'repaired', true)
 where id = ${q(row.doc_id)};
commit;`;
  try {
    await sql(stmt);
    const check = await sql(`
      select id, uploaded_at::text from public.project_files
       where drive_file_id = ${q(fileId)} and is_signed`);
    if (check.length !== 1) throw new Error('row not present after insert');
    console.log(`   \u2713 attached as project_files.id=${check[0].id}, uploaded_at=${check[0].uploaded_at}`);
    repaired += 1;
  } catch (e) {
    console.log(`   \u2717 FAILED: ${e.message}`);
    manual.push({ ...row, why: e.message });
  }
}

console.log(`\n${APPLY ? 'repaired' : 'would repair'}: ${repaired}`
  + `   nothing-in-Drive: ${skipped}   needs a human: ${manual.length}`);
for (const m of manual) console.log(`  ! ${m.req_id} ${m.doc_title.slice(0, 40)} — ${m.why}`);
if (!APPLY) console.log('\nnothing written. re-run with --apply to commit.');
