#!/usr/bin/env node
// ============================================================
// house-import.mjs — run the ระบบบ้าน handover import as ONE transaction, with
// a dry run that shows the real post-state before anything is kept.
//
// WHY THIS EXISTS BESIDE THE ADMIN PANE, which is the normal path and stays the
// normal path. The pane does nine separate HTTP requests — batch, สาย, eight
// chunks of students, missing, held, counts — and there is no transaction
// around them. That is the right trade for a browser (a partial import is
// legible and re-runnable, and the upsert is idempotent), and it is the wrong
// one for the FIRST import of 1,776 real students into an empty table, where
// "it stopped on chunk 4" means a half-populated system and a human deciding
// what to do at 3am.
//
// So this does exactly what src/js/house/index.js runImport() does, in exactly
// the same order, through exactly the same functions — `parseStudentsCsv`,
// `toUpsertRow`, `toUnresolvedRow`, `saiCodesToSeed`, `diffAgainstExisting` are
// IMPORTED from the app, never reimplemented — and wraps the lot in
// `begin … commit`. A second opinion about what the file contains is the drift
// class this repo pays for most; there is exactly one parser and this is not it.
//
// ⛔ IT RUNS AS A REAL ADMIN, NOT AS THE SUPERUSER. Every write goes through
// `set local role authenticated` with that person's jwt claims, so the RLS
// policies and the RPC permission checks are the same ones the pane meets. A
// superuser import would prove nothing about whether the pane can do it, and
// would happily write rows no policy allows.
//
// USAGE
//   node tools/house-import.mjs <file>.import.csv            # DRY RUN, rolls back
//   node tools/house-import.mjs <file>.import.csv --commit   # keeps it
//
// The dry run is not a simulation: it does the real work against the real
// database and then rolls back, reading the post-state from inside the
// transaction. What it prints is what committing would leave behind.
// ============================================================
import { readFileSync, existsSync } from 'node:fs';
import { basename } from 'node:path';
import {
  parseStudentsCsv, toUpsertRow, toUnresolvedRow, saiCodesToSeed,
  diffAgainstExisting, IMPORT_OWNED_COLUMNS,
} from '../src/js/house/io.js';
import { loadEnv, announceTarget, runSql } from './env-lib.mjs';

const file = process.argv[2];
const COMMIT = process.argv.includes('--commit');
if (!file || !existsSync(file)) {
  console.error('usage: node tools/house-import.mjs <path-to-*.import.csv> [--commit]');
  process.exit(1);
}
if (!/\.import\.csv$/.test(file)) {
  // The half labelled `นำเข้าได้` is the one a reader reaches for, and uploading
  // it CLEARS the held list — every held seat deleted, and with it every
  // student's ability to claim one. See docs/mistakes/tooling-proofs.md.
  console.error(`⛔ ${basename(file)} is not the upload file.\n`
    + '   Upload <base>.import.csv — it carries every line of the handover.\n'
    + '   .clean.csv holds only the importable half, and importing it deletes\n'
    + '   the held list along with every held student\'s ability to claim a seat.');
  process.exit(2);
}

const loaded = loadEnv();
const target = announceTarget(loaded);
const q = (v) => (v === null || v === undefined ? 'null' : `'${String(v).replace(/'/g, "''")}'`);
const jsonLit = (v) => `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`;

// ── who we speak as ─────────────────────────────────────────────────────────
// Chosen by the PREDICATE the RPCs test, not by `limit 1` over a table: every
// write below is refused unless this person really holds the house grant, and a
// subject picked by position is a subject that changes under you (house0188
// paid for that three times in one file).
const ACTOR_SQL = `
  select u.id::text as id, lower(btrim(u.email)) as email, u.role
    from public.users u
   where u.email is not null
     and (u.role in ('vp_admin','dev')
          or 'house'  = any (coalesce(u.permissions, '{}'))
          or 'house'  = any (coalesce(u.managed_permissions, '{}'))
          or 'master' = any (coalesce(u.permissions, '{}'))
          or 'master' = any (coalesce(u.managed_permissions, '{}')))
   order by (u.role = 'dev') desc, u.id
   limit 1`;

const one = async (sql) => JSON.parse(await runSql(sql, target));

const [actor] = await one(ACTOR_SQL);
if (!actor) { console.error('no account holds the house grant — nothing may import'); process.exit(3); }

// The MANAGED vocabulary, exactly as the pane passes it — never a hardcoded
// list and never "whatever is already in the table", which is self-ratifying.
const majors = (await one(`select code from public.team_majors order by code`)).map((m) => m.code);

// What is already there. The diff needs `self_edited` — a column the student
// owns is one the import is refused, and counting it as "จะแก้ไข" would promise
// a change that will not happen.
const existing = await one(`
  select id::text, kkumail, student_id, first_name_th, last_name_th,
         nickname_imported, major, sai_code, self_edited
    from public.students`);

// ── parse, through the app's own parser ─────────────────────────────────────
const result = parseStudentsCsv(readFileSync(file, 'utf8'), majors);
if (result.fatal) { console.error('⛔ ' + result.fatal); process.exit(4); }
const diff = diffAgainstExisting(result.rows, existing, result.presentColumns, result.skipped);
const heldRows = (result.skipped || []).map(toUnresolvedRow);
const saiCodes = saiCodesToSeed(result.rows, heldRows);

console.error(`\n→ ${basename(file)}: ${result.rows.length} importable · ${heldRows.length} held`);
console.error(`→ เพิ่ม ${diff.insert} · แก้ไข ${diff.update} · ไม่เปลี่ยน ${diff.same} `
  + `· ไม่พบในไฟล์ ${diff.missing.length} · ถูกนักศึกษาแก้เองไว้ ${diff.kept}`);
console.error(`→ สาย to seed: ${saiCodes.length} · acting as ${actor.email} (${actor.role})\n`);

// ── the report travels WITH the import ──────────────────────────────────────
// It is the only home for several facts — which cells were repaired, which
// decisions a human made, the สายรหัส audit — and it lives in a gitignored
// folder on one laptop. `student_import_batches.notes` puts it beside the run
// it describes, where anybody who can see the import can see its reasoning.
const reportPath = file.replace(/\.import\.csv$/, '.report.md');
const report = existsSync(reportPath) ? readFileSync(reportPath, 'utf8') : null;

// ── the transaction, in the pane's order ────────────────────────────────────
const CHUNK = 200;
const upsertCols = [...IMPORT_OWNED_COLUMNS, 'last_import_batch', 'missing_since'];
const rowsSql = result.rows.map((r) => toUpsertRow(r, null, result.presentColumns));
const chunks = [];
for (let i = 0; i < rowsSql.length; i += CHUNK) chunks.push(rowsSql.slice(i, i + CHUNK));

// `on conflict (kkumail) do update set` over exactly the keys the payload
// carries — the same rule PostgREST's `resolution=merge-duplicates` applies, so
// a column the file did not have keeps whatever the row already has.
const payloadCols = Object.keys(rowsSql[0]);
const setClause = payloadCols.filter((c) => c !== 'kkumail')
  .map((c) => `${c} = excluded.${c}`).join(', ');

const sql = `
begin;

-- Speak as the admin, at TOP LEVEL. Set inside a plpgsql helper it never takes
-- effect, and every write below would silently run as the superuser — which is
-- the one way this script could pass while the pane cannot do the same thing.
select set_config('request.jwt.claims',
  json_build_object('sub', ${q(actor.id)}, 'role', 'authenticated',
                    'email', ${q(actor.email)})::text, true);

-- §1 the batch row FIRST: students carry last_import_batch, so it has to exist
-- before they are written. Counts are stamped at the END — a row created with
-- the planned counts claims a successful import of N people after a run that
-- died partway.
set local role authenticated;
insert into public.student_import_batches (file_name, uploaded_by, row_count, problem_count)
values (${q(basename(file))}, ${q(actor.id)}::uuid, ${result.rows.length}, ${result.problems.length});
reset role;

create temporary table _batch on commit drop as
  select id from public.student_import_batches
   where file_name = ${q(basename(file))} order by uploaded_at desc limit 1;
grant select on _batch to authenticated;

-- §2 สาย BEFORE students: students.sai_code is a foreign key and สาย are not a
-- seeded range. BOTH lists — a สาย whose only member in this file has no
-- address is never seeded by the students half, and record_unresolved_rows then
-- dies with 23503 at the very END, after every student row is already written.
set local role authenticated;
select public.ensure_sais(array[${saiCodes.map(q).join(',')}]::text[]);
reset role;

-- §3 the students, in the pane's chunks of ${CHUNK}
set local role authenticated;
${chunks.map((chunk) => `insert into public.students (${payloadCols.join(', ')})
values ${chunk.map((r) => `(${payloadCols.map((c) => (c === 'last_import_batch'
    ? '(select id from _batch)'
    : c === 'missing_since' ? 'null' : q(r[c]))).join(', ')})`).join(',\n       ')}
on conflict (kkumail) do update set ${setClause};`).join('\n\n')}
reset role;

-- §4 rows in the database this file does not mention. Flagged, never deleted —
-- and "mention" is about the PERSON: a รหัสนักศึกษา on a SKIPPED line counts,
-- which is what keeps a student who claimed a held seat from being marked gone.
${diff.missing.length ? `set local role authenticated;
update public.students set missing_since = now()
 where id in (${diff.missing.map((m) => `${q(m.id)}::uuid`).join(',')});
reset role;` : '-- (nothing in the database is unmentioned by this file)'}

-- §5 the lines this file NAMED and could not address. Written on EVERY import,
-- including one that held nobody — the table describes the NEWEST file.
set local role authenticated;
create temporary table _held on commit drop as
  select public.record_unresolved_rows((select id from _batch), ${jsonLit(heldRows)}) as v;
reset role;

-- §6 what the import ACTUALLY did, plus the report that explains it
set local role authenticated;
update public.student_import_batches
   set inserted_count = ${diff.insert},
       updated_count  = ${diff.update},
       unchanged_count = ${diff.same}${report ? `,
       notes = ${q(report)}` : ''}
 where id = (select id from _batch);
reset role;

-- ── what the database looks like from inside the transaction ───────────────
select 'students'            as what, count(*)::text as n from public.students
union all select 'students missing_since', count(*)::text from public.students where missing_since is not null
union all select 'students with a สาย',    count(*)::text from public.students where sai_code is not null
union all select 'สาย rows',               count(*)::text from public.sais
union all select 'held (open)',            count(*)::text from public.student_import_unresolved where resolved_at is null
union all select 'held answer',            (select v::text from _held)
union all select 'identity conflicts',     count(*)::text from public.identity_conflicts
union all select 'people rows',            count(*)::text from public.people
union all select 'batch notes bytes',      coalesce(length(notes)::text,'0') from public.student_import_batches where id = (select id from _batch)
union all select 'houses represented',     count(distinct s.house_id)::text from public.students t join public.sais s on s.code = t.sai_code
order by what;

${COMMIT ? 'commit;' : 'rollback;'}
`;

console.error(`→ SQL: ${(sql.length / 1024).toFixed(0)} KB · ${chunks.length} student chunks`);
console.error(COMMIT ? '→ ⚠️  COMMITTING\n' : '→ DRY RUN — this transaction will ROLL BACK\n');

const out = await runSql(sql, target);
const rows = JSON.parse(out);
for (const r of rows) console.log(`  ${String(r.what).padEnd(24)} ${r.n}`);
console.error(COMMIT ? '\n✓ committed.' : '\n✓ rolled back — nothing was kept. Re-run with --commit.');
