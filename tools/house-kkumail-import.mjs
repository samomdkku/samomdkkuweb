#!/usr/bin/env node
// ============================================================
// house-kkumail-import.mjs — take the addresses a ฝ่าย sent back and let the
// people they belong to into ระบบบ้าน.
//
// This is the other half of `tools/house-year-sheets.mjs`. That one asks;
// this one reads the answer. `docs/state/HANDOFF.md` §16 owed it, with the
// condition it is built under:
//
//     it must match each returned kkumail to the person by รหัส+ชื่อ before
//     writing, or a copy-paste slip silently swaps two students
//
// ⛔ SO THE NAME IS CHECKED, NOT JUST THE รหัส, and a mismatch is REFUSED
// rather than warned about. A wrong address on a held row is not a typo you
// notice later: the row is PROMOTED into `students` with it, that address
// becomes the person's identity, and the real owner of it can then sign in and
// find someone else's สาย and บ้าน. One transposed row does that silently.
//
// ⛔ AND IT DOES NOT DO THE PROMOTION ITSELF. `promote_unresolved_row()` is
// what the admin pane calls — it checks the address is well formed, refuses one
// that already belongs to somebody, copies exactly the columns a held row
// carries and stamps `resolved_how='admin'`. Re-implementing that here would be
// a second copy of the rule (`.claude/rules/mistakes.md` class 6) that could
// drift from the pane without anyone noticing. This script decides WHICH rows,
// and the database decides what promoting one MEANS.
//
// THE FILE IT READS is whatever the ฝ่าย sends, not a round-trip of our sheet.
// MD50 sent a plain roster — รหัส, ชื่อ-สกุล (with คำนำหน้า), email, ชื่อเล่น —
// covering 320 people to answer 26 questions. That is the normal case, so the
// parser keys on HEADER TEXT rather than column position and ignores every row
// it did not ask about.
//
//   node tools/house-kkumail-import.mjs <returned.csv>           # dry run
//   node tools/house-kkumail-import.mjs <returned.csv> --apply   # promote
// ============================================================
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { loadEnv, announceTarget, runSql } from './env-lib.mjs';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const FILE = args.find((a) => !a.startsWith('--'));
if (!FILE) {
  console.error('usage: node tools/house-kkumail-import.mjs <returned.csv> [--apply]');
  process.exit(1);
}

// ---- CSV ------------------------------------------------------------------
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cur += '"'; i += 1; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
    else if (c !== '\r') cur += c;
  }
  row.push(cur);
  if (row.some((v) => v.trim())) rows.push(row);
  return rows;
}

const TITLES = ['นางสาว', 'น.ส.', 'นาง', 'นาย', 'ด.ช.', 'ด.ญ.', 'เด็กชาย', 'เด็กหญิง'];
/** Comparison key for a Thai name: no spaces, no คำนำหน้า, no punctuation.
 *  The returned file glues the title on ("นางสาวณัฐฐา ดลจิรพิสิฐ") and splits
 *  ชื่อ/สกุล on a space we cannot rely on, so BOTH sides are compared as one
 *  run of characters rather than field by field. */
function nameKey(s) {
  let v = String(s || '').replace(/[\s.​ ]+/g, '');
  for (const t of TITLES) {
    const bare = t.replace(/\./g, '');
    if (v.startsWith(bare)) { v = v.slice(bare.length); break; }
  }
  return v;
}
const digits = (s) => String(s || '').replace(/\D/g, '');

const rows = parseCsv(readFileSync(FILE, 'utf8').replace(/^﻿/, ''));
const header = rows[0].map((h) => h.trim());
const find = (...needles) => header.findIndex((h) => needles.some((n) => h.includes(n)));
// Keyed on header TEXT, not position: the ฝ่าย sends its own layout, and the
// one thing every version of it has is a header row. A column we cannot find is
// named out loud rather than silently read as blank.
const COL = {
  sid: find('รหัส'),
  name: find('ชื่อ'),
  mail: find('Email', 'email', 'อีเมล', 'kkumail'),
  // Not asked for — the owner said ชื่อเล่น is not worth chasing — but the ฝ่าย
  // sent its own roster and it is in there. Carried when the row has none,
  // never over one that exists: `nickname_self` is the person's own answer and
  // `nickname_imported` is the file's, and only the second is ours to write.
  nick: header.findIndex((h) => h.includes('ชื่อเล่น')),
};
// The MD50 file's รหัส column has an EMPTY header, which is why this falls back
// to "the first column" instead of failing: a blank heading is not a missing
// column, and refusing here would reject the very file this was written for.
if (COL.sid < 0) COL.sid = 0;
if (COL.mail < 0) {
  console.error(`⛔ ไม่พบคอลัมน์อีเมลใน ${basename(FILE)} — header: ${header.join(' | ')}`);
  process.exit(2);
}

const returned = new Map();
const conflicts = new Map();
for (const r of rows.slice(1)) {
  const sid = digits(r[COL.sid]);
  const mail = (r[COL.mail] || '').trim().toLowerCase();
  if (!sid || !mail) continue;
  const seen = returned.get(sid);
  // ⛔ ONE รหัส, TWO ADDRESSES IS NOT A ROW TO PICK BETWEEN. A Map would keep
  // whichever came last and say nothing — and the wrong one here does not read
  // as a typo later: the row is promoted with it, that address BECOMES the
  // person, and its real owner signs in to someone else's สาย and บ้าน. The
  // sheet is filled by hand in a spreadsheet, so a duplicated line is an
  // ordinary accident, not an exotic one.
  if (seen && seen.mail !== mail) {
    if (!conflicts.has(sid)) conflicts.set(sid, new Set([seen.mail]));
    conflicts.get(sid).add(mail);
    continue;
  }
  returned.set(sid, {
    mail,
    name: (r[COL.name] || '').trim(),
    nick: COL.nick >= 0 ? (r[COL.nick] || '').trim() : '',
  });
}
console.log(`\n  ${basename(FILE)}: ${returned.size} แถวที่มีทั้งรหัสและอีเมล`);
if (conflicts.size) {
  console.log(`\n  ⛔ ${conflicts.size} รหัสมีอีเมลมากกว่าหนึ่งค่าในไฟล์นี้ — ข้ามทั้งหมด:`);
  for (const [sid, mails] of conflicts) {
    returned.delete(sid);
    console.log(`     ${sid}: ${[...mails].join(' / ')}`);
  }
  console.log('     แก้ในไฟล์ให้เหลือค่าเดียวต่อคน แล้วรันใหม่\n');
}

// ---- the rows we are waiting on ------------------------------------------
const target = announceTarget(loadEnv());
const ask = async (sql) => JSON.parse(await runSql(sql, target));

const held = await ask(`
  select id::text, student_id, first_name_th, last_name_th, sai_code, cohort_year,
         nickname_imported
    from public.student_import_unresolved
   where resolved_at is null
   order by cohort_year, sai_code`);

const matched = [];
const refused = [];
for (const h of held) {
  const sid = digits(h.student_id);
  if (!sid) continue;                       // no รหัส to match on at all
  const got = returned.get(sid);
  if (!got) continue;                       // this file did not answer for them
  const ours = nameKey(`${h.first_name_th || ''}${h.last_name_th || ''}`);
  const theirs = nameKey(got.name);
  // Substring either way: the file may carry a middle name or a shortened
  // สกุล. What is NOT tolerated is two names that share nothing.
  const same = ours && theirs && (theirs.includes(ours) || ours.includes(theirs));
  const rec = { h, got, ours: `${h.first_name_th || ''} ${h.last_name_th || ''}`.trim() };
  if (same) matched.push(rec);
  else refused.push(rec);
}

const md = (y) => (y ? `MD${y - 2515}` : '—');
console.log(`\n  ตรงกัน ${matched.length} · ชื่อไม่ตรง ${refused.length}`
  + ` · ยังค้างอยู่ทั้งหมด ${held.length}\n`);
for (const m of matched) {
  console.log(`  ✓ ${md(m.h.cohort_year)} สาย ${String(m.h.sai_code || '-').padEnd(4)}`
    + ` ${m.ours.padEnd(28)} → ${m.got.mail}`
    + (m.got.nick && !m.h.nickname_imported ? `  (+ ชื่อเล่น ${m.got.nick})` : ''));
}
for (const r of refused) {
  console.log(`  ✗ ${md(r.h.cohort_year)} สาย ${String(r.h.sai_code || '-').padEnd(4)}`
    + ` รหัสตรงแต่ชื่อไม่ตรง — ในระบบ "${r.ours}" / ในไฟล์ "${r.got.name}" — ไม่เขียน`);
}

if (!matched.length) { console.log('\n  ไม่มีอะไรให้ทำ\n'); process.exit(0); }
if (!APPLY) {
  console.log('\n  (dry run — ยังไม่เขียน ใส่ --apply เพื่อนำเข้าจริง)\n');
  process.exit(0);
}

// ---- promote, through the pane's own function -----------------------------
const [actor] = await ask(`
  select u.id::text as id, lower(btrim(u.email)) as email, u.role
    from public.users u
   where u.email is not null
     and (u.role in ('vp_admin','dev')
          or 'house'  = any (coalesce(u.permissions, '{}'))
          or 'house'  = any (coalesce(u.managed_permissions, '{}'))
          or 'master' = any (coalesce(u.permissions, '{}'))
          or 'master' = any (coalesce(u.managed_permissions, '{}')))
   order by (u.role = 'dev') desc, u.id
   limit 1`);
if (!actor) { console.error('ไม่มีบัญชีที่ถือสิทธิ์ house — นำเข้าไม่ได้'); process.exit(3); }
console.log(`\n  acting as ${actor.email} (${actor.role})`);

const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
// ONE transaction: promote_unresolved_row raises on a duplicate address or a
// row somebody resolved while this was running, and a partial import would
// leave half the ฝ่าย's answer applied with no record of which half.
//
// `set_config(..., true)` is transaction-local and set at TOP LEVEL — inside a
// plpgsql helper it never takes effect and every call would run as the
// superuser, which is the one way this could pass while the pane cannot do the
// same thing (the lesson `tools/house-import.mjs` carries).
// The nickname is written onto the HELD row first, so the promotion copies it
// the same way it copies every other column. Setting it afterwards on
// `students` would be a second path into the same field.
const calls = matched.map((m) => {
  const nick = m.got.nick && !m.h.nickname_imported
    ? `update public.student_import_unresolved set nickname_imported = ${q(m.got.nick)}\n`
      + `  where id = ${q(m.h.id)}::uuid and nickname_imported is null;\n`
    : '';
  return `${nick}select public.promote_unresolved_row(${q(m.h.id)}::uuid, ${q(m.got.mail)});`;
}).join('\n');
const sql = `
begin;
select set_config('request.jwt.claims',
  json_build_object('sub', ${q(actor.id)}, 'role', 'authenticated',
                    'email', ${q(actor.email)})::text, true);
${calls}
commit;`;

try {
  await runSql(sql, target);
  console.log(`  นำเข้าแล้ว ${matched.length} คน\n`);
} catch (e) {
  console.error(`\n⛔ ไม่ได้เขียนอะไรเลย (ทั้งชุดถูกยกเลิก): ${e.message}\n`);
  process.exit(4);
}
