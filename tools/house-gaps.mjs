#!/usr/bin/env node
// ============================================================
// house-gaps.mjs — who in ระบบบ้าน is missing something, and who can fix it.
//
// THE SAME ANSWER AS THE ADMIN PANE, FROM THE SAME FUNCTION. `computeGaps()`
// in src/js/house/gaps.js is imported, never reimplemented: this script fetches
// the rows over SQL and the pane fetches them over PostgREST, and after that
// there is one definition of "incomplete" for both. The first version of this
// file did decide for itself, and it retyped the รุ่น epoch as 2516 where
// `cohortLabel()` says 2515 — every รุ่น in the report was off by one, from a
// constant that already had one home.
//
// It READS ONLY. No write, no mutating RPC, nothing to undo.
//
//   node tools/house-gaps.mjs                  # summary
//   node tools/house-gaps.mjs --out <file.md>  # plus the per-person lists
//   npm run house:gaps -- --out <file.md>      # the `--` is NOT optional
// ============================================================
import { writeFileSync } from 'node:fs';
import { computeGaps, TONE } from '../src/js/house/gaps.js';
import { cohortLabel } from '../src/js/house/fields.js';
import { loadEnv, announceTarget, runSql } from './env-lib.mjs';

const outIdx = process.argv.indexOf('--out');
const outFile = outIdx > -1 ? process.argv[outIdx + 1] : null;
const target = announceTarget(loadEnv());
const ask = async (sql) => JSON.parse(await runSql(sql, target));

// The same COLUMNS the pane loads, because computeGaps reads them by name. A
// column missing here reads as "nobody has one", which is a silent wrong answer
// rather than an error — so this list is short on purpose and every field in it
// is one the function actually asks for.
const [students, held, helpReqs, requests, houses, sais, advisors, conflicts] = await Promise.all([
  ask(`select id::text, kkumail, student_id, first_name_th, last_name_th,
              nickname, nickname_imported, nickname_self, major, sai_code,
              cohort_year, missing_since
         from public.students`),
  ask(`select id::text, student_id, first_name_th, last_name_th,
              nickname_imported as nickname, sai_code as sai, reason, file_note,
              resolved_at
         from public.student_import_unresolved`),
  ask(`select id::text, kkumail, resolved_at from public.house_help_requests`),
  ask(`select id::text, status from public.student_change_requests`),
  ask(`select id, name from public.houses`),
  ask(`select code from public.sais`),
  ask(`select id::text, full_name from public.advisors`),
  ask(`select count(*)::int as n from public.identity_conflicts where status = 'open'`),
]);

const { groups, actionable } = computeGaps({
  students, held, helpReqs, requests, houses, sais, advisors,
  conflicts: conflicts[0]?.n || 0,
});

const TONE_TH = {
  [TONE.act]: '⛔ ต้องมีคนทำ',
  [TONE.watch]: '👀 น่าจะผิดที่ไฟล์',
  [TONE.tell]: '📣 เจ้าตัวทำเองได้',
  [TONE.setup]: '⚙️  ยังตั้งค่าไม่เสร็จ',
};

if (!groups.length) {
  console.log('\n  ✓ ไม่มีอะไรค้าง\n');
  process.exit(0);
}

for (const tone of [TONE.act, TONE.watch, TONE.tell, TONE.setup]) {
  const inTone = groups.filter((g) => g.tone === tone);
  if (!inTone.length) continue;
  console.log(`\n── ${TONE_TH[tone]} ──────────────────────────────────`);
  for (const g of inTone) {
    console.log(`  ${String(g.count).padStart(5)}  ${g.title}`);
  }
}
console.log(`\n  ต้องมีคนทำทั้งหมด ${actionable} อย่าง\n`);

if (!outFile) {
  console.log('  (ใส่ --out <file.md> เพื่อได้รายชื่อรายคน)\n');
  process.exit(0);
}

// ── the per-person file ────────────────────────────────────────────────────
// The pane shows the first few of each group and hides the rest behind a
// switch; a file has no such constraint, so it carries everybody. The groups
// with no `rows` are the ones whose worklist lives on another screen — listing
// them here too would be the second copy this refactor exists to remove.
const md = ['# ใครในระบบบ้านที่ข้อมูลยังไม่ครบ', '',
  `สร้างโดย \`tools/house-gaps.mjs\` เมื่อ ${new Date().toISOString()}`, '',
  'เรียงตาม **ใครแก้ได้** ไม่ใช่ตามจำนวน', ''];

for (const tone of [TONE.act, TONE.watch, TONE.tell, TONE.setup]) {
  const inTone = groups.filter((g) => g.tone === tone);
  if (!inTone.length) continue;
  md.push(`## ${TONE_TH[tone]}`, '');
  for (const g of inTone) {
    md.push(`### ${g.title} — ${g.count}`, '', g.why, '');
    if (g.rows.length) {
      md.push('| | | |', '|---|---|---|');
      g.rows.forEach((r) => md.push(`| ${r.name} | ${r.detail || ''} | ${r.hint || ''} |`));
      md.push('');
    } else {
      md.push(`*(รายชื่ออยู่ในแท็บ ${g.goto || '—'} ของหน้าระบบบ้าน)*`, '');
    }
  }
}

// The held rows that CAN be self-claimed have no per-person list in computeGaps
// — the pane sends you to the tab that already has one. A file is the one place
// it is worth writing them out, because chasing 152 people is done from a list
// somebody can print, not from a screen.
const claimable = held
  .filter((h) => !h.resolved_at && h.student_id && h.first_name_th)
  .map((h) => ({ ...h, cohort: cohortLabel(h) || '—' }))
  .sort((a, b) => a.cohort.localeCompare(b.cohort) || String(a.sai).localeCompare(String(b.sai)));
if (claimable.length) {
  md.push(`## ภาคผนวก — ${claimable.length} คนที่ยืนยันตัวตนเองได้`, '',
    'บอกเขาครั้งเดียว: เข้าสู่ระบบด้วย kkumail แล้วกรอกรหัสนักศึกษากับชื่อจริงที่หน้าแรก', '',
    '| รุ่น | สาย | ชื่อ | รหัสนักศึกษา |', '|---|---|---|---|');
  claimable.forEach((h) => md.push(
    `| ${h.cohort} | ${h.sai || '—'} | ${[h.first_name_th, h.last_name_th].filter(Boolean).join(' ')} | ${h.student_id} |`));
  md.push('');
}

writeFileSync(outFile, md.join('\n') + '\n', 'utf8');
console.log(`  → ${outFile}\n`);
