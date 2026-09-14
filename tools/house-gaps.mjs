#!/usr/bin/env node
// ============================================================
// house-gaps.mjs — who in ระบบบ้าน is missing something, and who can fix it.
//
// WHY A TOOL AND NOT A QUERY. "Who is missing information" is asked after every
// handover file, and the useful answer is not one list — it is FOUR, split by
// who can act:
//
//   1. the student can fix it themselves        → nothing for anyone to do
//   2. the student can claim their seat         → they need telling, once
//   3. only an admin can                        → a real worklist, and short
//   4. only ฝ่ายข้อมูล can                        → send it back
//
// A single "165 people have problems" number invites someone to work through it
// top to bottom, and three quarters of that work is not theirs to do.
//
// It READS ONLY. No write, no RPC that mutates, nothing to undo.
//
//   node tools/house-gaps.mjs                  # summary to the terminal
//   node tools/house-gaps.mjs --out <file.md>  # full per-person list as well
// ============================================================
import { writeFileSync } from 'node:fs';
import { loadEnv, announceTarget, runSql } from './env-lib.mjs';

const outIdx = process.argv.indexOf('--out');
const outFile = outIdx > -1 ? process.argv[outIdx + 1] : null;
const target = announceTarget(loadEnv());
const ask = async (sql) => JSON.parse(await runSql(sql, target));

const [sum] = await ask(`
select
  (select count(*) from public.students)                                        as imported,
  (select count(*) from public.students where nickname_imported is null
     and nickname_self is null)                                                 as no_nickname,
  (select count(*) from public.students where student_id is null)               as no_student_id,
  (select count(*) from public.students where first_name_th is null
     or last_name_th is null)                                                   as no_name,
  (select count(*) from public.students where sai_code is null)                 as no_sai,
  (select count(*) from public.students where missing_since is not null)        as flagged_missing,
  (select count(*) from public.student_import_unresolved where resolved_at is null
     and student_id is not null and first_name_th is not null)                  as held_claimable,
  (select count(*) from public.student_import_unresolved where resolved_at is null
     and (student_id is null or first_name_th is null))                         as held_admin_only,
  (select count(*) from public.identity_conflicts where status = 'open')        as conflicts,
  (select count(*) from public.house_help_requests where resolved_at is null)   as help_open,
  (select count(*) from public.student_change_requests where status = 'pending') as change_pending,
  (select count(*) from public.houses where name is null)                       as houses_unnamed,
  (select count(*) from public.advisors)                                        as advisors`);

const n = (v) => Number(v).toLocaleString('th-TH');
const line = (label, v, who) => console.log(`  ${label.padEnd(42)} ${n(v).padStart(6)}   ${who}`);

console.log('\n── นำเข้าแล้ว ' + n(sum.imported) + ' คน ────────────────────────────────────────');
line('ไม่มีชื่อเล่น', sum.no_nickname, 'เจ้าตัวกรอกเองได้');
line('ไม่มีรหัสนักศึกษา', sum.no_student_id, 'เจ้าตัวกรอกเองได้');
line('ไม่มีชื่อหรือนามสกุล', sum.no_name, 'เจ้าตัวกรอกเองได้');
line('ไม่มีสายรหัส', sum.no_sai, '⛔ แจ้งฝ่ายข้อมูล — ไม่มีบ้าน');
line('ไม่อยู่ในไฟล์ล่าสุด', sum.flagged_missing, 'แอดมินตรวจ');
line('ชื่อไม่ตรงกับไฟล์', sum.conflicts, 'เจ้าตัวเลือกเองได้ หรือแอดมินเลือกให้');

console.log('\n── ยังนำเข้าไม่ได้ ' + n(Number(sum.held_claimable) + Number(sum.held_admin_only)) + ' คน ──────────────────────────');
line('มีรหัส + ชื่อ → ยืนยันตัวตนเองได้', sum.held_claimable, 'บอกเขาครั้งเดียว');
line('ไม่มีรหัส หรือไม่มีชื่อ', sum.held_admin_only, '⛔ แอดมิน/ฝ่ายข้อมูลเท่านั้น');

console.log('\n── อย่างอื่น ──────────────────────────────────────────');
line('คำขอแก้ข้อมูลที่ยังไม่ตัดสิน', sum.change_pending, 'แอดมิน');
line('คนที่แจ้งว่าเข้าระบบแล้วไม่เจอตัวเอง', sum.help_open, 'แอดมิน');
line('บ้านที่ยังไม่ได้ตั้งชื่อ', sum.houses_unnamed, 'แอดมิน');
line('อาจารย์ที่ปรึกษาในระบบ', sum.advisors, sum.advisors === 0 ? '⛔ ยังไม่มีเลย' : '');

if (!outFile) {
  console.log('\n  (ใส่ --out <file.md> เพื่อได้รายชื่อรายคน)\n');
  process.exit(0);
}

// ── the per-person lists ───────────────────────────────────────────────────
// Ordered so the SHORTEST and most actionable list is first: a worklist nobody
// else can do beats a long list of things that resolve themselves.
const adminOnly = await ask(`
  select coalesce(first_name_th,'') || ' ' || coalesce(last_name_th,'') as name,
         coalesce(student_id,'—') as sid, coalesce(sai_code,'—') as sai,
         coalesce(file_note,'') as note, coalesce(file_kkumail,'') as file_mail,
         reason, source_line
    from public.student_import_unresolved
   where resolved_at is null and (student_id is null or first_name_th is null)
   order by source_line`);

const claimable = await ask(`
  select coalesce(first_name_th,'') || ' ' || coalesce(last_name_th,'') as name,
         student_id as sid, coalesce(sai_code,'—') as sai, cohort_year,
         coalesce(file_kkumail,'') as file_mail, source_line
    from public.student_import_unresolved
   where resolved_at is null and student_id is not null and first_name_th is not null
   order by cohort_year nulls last, sai_code`);

const conflicts = await ask(`
  select c.field, c.mine, c.theirs, p.kkumail,
         coalesce(p.first_name_th,'') || ' ' || coalesce(p.last_name_th,'') as name
    from public.identity_conflicts c join public.people p on p.id = c.person_id
   where c.status = 'open' order by c.created_at`);

const noNick = await ask(`
  select first_name_th || ' ' || last_name_th as name, student_id as sid, sai_code as sai
    from public.students
   where nickname_imported is null and nickname_self is null
   order by sai_code`);

const md = [];
const push = (s = '') => md.push(s);
push('# ใครในระบบบ้านที่ข้อมูลยังไม่ครบ');
push('');
push(`สร้างโดย \`tools/house-gaps.mjs\` เมื่อ ${new Date().toISOString()}`);
push('');
push('เรียงตาม **ใครแก้ได้** ไม่ใช่ตามจำนวน — รายการแรกสั้นที่สุดและเป็นงานที่ไม่มีใครทำแทนได้');
push('');

push(`## 1. ⛔ ${adminOnly.length} คน — มีแต่แอดมินหรือฝ่ายข้อมูลที่ปิดได้`);
push('');
push('ไม่มีรหัสนักศึกษาในไฟล์ จึงยืนยันตัวตนเองไม่ได้ ต้องมีคนที่รู้จักเขาเติมอีเมลให้');
push('');
push('| บรรทัดในไฟล์ | ชื่อ | สาย | สิ่งที่ไฟล์บอก |');
push('|---|---|---|---|');
adminOnly.forEach((r) => push(`| ${r.source_line} | ${r.name.trim() || '*(ไม่มีชื่อ)*'} | ${r.sai} | ${r.note || (r.reason === 'empty_row' ? 'แถวว่าง มีแต่สายรหัส' : '—')} |`));
push('');

push(`## 2. ${conflicts.length} คน — ชื่อในระบบไม่ตรงกับไฟล์`);
push('');
push('ระบบเก็บชื่อเดิมไว้ ไม่ทับด้วยไฟล์ และบันทึกไว้ว่าไม่ตรงกัน');
push('**เจ้าตัวเลือกเองได้เมื่อเข้าสู่ระบบ** หรือแอดมินเลือกให้ก็ได้');
push('');
push('| ชื่อในระบบ (ที่ใช้อยู่) | ไฟล์เขียนว่า | ช่อง | อีเมล |');
push('|---|---|---|---|');
conflicts.forEach((r) => push(`| ${r.mine} | ${r.theirs} | ${r.field === 'first_name_th' ? 'ชื่อ' : r.field === 'last_name_th' ? 'นามสกุล' : r.field} | ${r.kkumail} |`));
push('');

push(`## 3. ${claimable.length} คน — ยืนยันตัวตนเองได้ ไม่ต้องรอใคร`);
push('');
push('ไฟล์มีรหัสนักศึกษาและชื่อ แต่ไม่มี kkumail');
push('เข้าสู่ระบบด้วย kkumail ของตัวเอง แล้วกรอกรหัสนักศึกษากับชื่อจริงที่หน้าแรก');
push('');
push('| รุ่น | สาย | ชื่อ | รหัสนักศึกษา |');
push('|---|---|---|---|');
claimable.forEach((r) => push(`| ${r.cohort_year ? 'MD' + (Number(r.cohort_year) - 2516) : '—'} | ${r.sai} | ${r.name.trim()} | ${r.sid} |`));
push('');

push(`## 4. ${noNick.length} คน — ไม่มีชื่อเล่น`);
push('');
push('ไม่ต้องทำอะไร เจ้าตัวกรอกเองได้ที่หน้าข้อมูลของฉัน');
push('');
push('| สาย | ชื่อ | รหัสนักศึกษา |');
push('|---|---|---|');
noNick.forEach((r) => push(`| ${r.sai} | ${r.name} | ${r.sid} |`));
push('');

writeFileSync(outFile, md.join('\n') + '\n', 'utf8');
console.log(`\n  → ${outFile}  (${adminOnly.length} + ${conflicts.length} + ${claimable.length} + ${noNick.length} คน)\n`);
