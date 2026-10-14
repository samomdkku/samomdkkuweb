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
// THE FILES IT READS are whatever the ฝ่าย sends, not necessarily a round-trip
// of our sheet. MD50 sent a plain roster (2026-09-19); the 2026-10-13 answer
// was our own sheets with columns MOVED, renamed and a second `kkumail` column
// beside the one we filled in. So the parser keys on HEADER TEXT, prefers the
// column we asked them to fill over the one we filled for them, and ignores
// every row it cannot place.
//
// WHAT THE 2026-10-13 ANSWER TAUGHT IT — each one a row the first version
// would have written wrong or silently dropped:
//   · `kkumail (ในระบบ)` came before `kkumail`, and "first header containing
//     kkumail" read the EMPTY system column: a whole sheet imported nothing.
//   · MD52's held rows had NO รหัส — the sheet asked for one — and matching was
//     by รหัส only, so every answer there was skipped without a word. They now
//     match on รุ่น + สาย + the exact name we sent, and the รหัส they gave is
//     written onto the held row before promotion.
//   · one รหัส + address was pasted onto TWO people. Both had the same address,
//     so the "one รหัส, two addresses" check never fired.
//   · `@kkumaill.com` — promote_unresolved_row checks the SHAPE of an address,
//     not its domain, so it would have become a person's identity.
//   · an address with someone ELSE's initials on a row: the รหัส and the name
//     agreed, because the slip was in the address alone.
//   · a ทีม SAMO member with a `people` row but no kkumail: promotion would have
//     created a SECOND person (resolve_person_id matches on kkumail only), so
//     the address goes on the existing person FIRST.
//
//   node tools/house-kkumail-import.mjs <MD5x.csv> [more.csv …]          # dry run
//   node tools/house-kkumail-import.mjs <MD5x.csv> [more.csv …] --apply  # write
//
// A line with no address but a REMARK ("ติดต่อไม่ได้", "คาดว่าลาออกแล้ว", "ลาออก",
// "เลขนี้ไม่มีตัวตน") is recorded through `set_unresolved_follow_up` (0217):
// the first two keep the seat open, the last two close it. Any other remark is
// kept as a plain note. The mapping is `followUpFromText` — one home.
//
// The dry run is not a simulation: it runs the whole transaction against the
// live database and ROLLS BACK, printing what committing would leave.
// ============================================================
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { loadEnv, announceTarget, runSql } from './env-lib.mjs';
import { normalizeStudentId, studentIdChecksumOk } from '../src/js/team/fields.js';
import { cohortFromStudentId, COHORT_EPOCH } from '../src/js/study-year.js';
import { FOLLOW_UP, followUpFromText } from '../src/js/house/follow-up.js';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const FILES = args.filter((a) => !a.startsWith('--'));
if (!FILES.length) {
  console.error('usage: node tools/house-kkumail-import.mjs <returned.csv> [more.csv …] [--apply]');
  process.exit(1);
}
const TODAY = new Date().toISOString().slice(0, 10);
const DOMAIN = 'kkumail.com';

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
  let v = String(s || '').replace(/[\s.​ ]+/g, '');
  for (const t of TITLES) {
    const bare = t.replace(/\./g, '');
    if (v.startsWith(bare)) { v = v.slice(bare.length); break; }
  }
  return v;
}
const digits = (s) => String(s || '').replace(/\D/g, '');
/** `?` is how our sheet marks a cell to fill, so `?` means "not answered". */
const answered = (s) => { const v = String(s ?? '').trim(); return v === '?' ? '' : v; };

// ---- does the address look like THIS person's? ----------------------------
// A kkumail is the person's romanised name: `<first>.<surname initial…>`. We
// cannot romanise Thai, but we can say which Latin letters a Thai INITIAL may
// become, and an address whose first letter (or first letter after the dot)
// is not among them belongs to somebody else. It is a coarse sieve on purpose:
// it never decides a row is RIGHT, only that it is impossible, and a false
// refusal costs one human look while a false accept costs a person their seat.
const INITIAL = {
  ก: 'kg', ข: 'kc', ฃ: 'k', ค: 'kc', ฅ: 'k', ฆ: 'k', ง: 'n', จ: 'jc', ฉ: 'cs', ช: 'cs',
  ซ: 's', ฌ: 'cs', ญ: 'yn', ฎ: 'd', ฏ: 'td', ฐ: 't', ฑ: 'td', ฒ: 't', ณ: 'n', ด: 'd',
  ต: 'td', ถ: 't', ท: 'ts', ธ: 't', น: 'n', บ: 'b', ป: 'pb', ผ: 'p', ฝ: 'f', พ: 'p',
  ฟ: 'f', ภ: 'p', ม: 'm', ย: 'y', ร: 'r', ฤ: 'r', ล: 'l', ว: 'wv', ศ: 's', ษ: 's',
  ส: 's', ห: 'h', ฬ: 'l', อ: 'aeiou', ฮ: 'h',
};
function initialLetters(thai) {
  const s = String(thai || '').trim().replace(/^[เแโใไ]+/, '');
  const c = s[0];
  if (!c || !INITIAL[c]) return null;           // not Thai — nothing to compare
  let ok = INITIAL[c];
  // ห and อ often only carry the next consonant's tone (หญิง, อยู่).
  if ((c === 'ห' || c === 'อ') && INITIAL[s[1]]) ok += INITIAL[s[1]];
  return ok;
}
/** null = cannot judge · '' = plausible · otherwise the reason it is not. */
function addressInitialsProblem(mail, first, last) {
  const local = mail.split('@')[0].toLowerCase();
  const [a, b] = local.split('.');
  const f = initialLetters(first);
  const l = initialLetters(last);
  if (f && a && !f.includes(a[0])) return `"${a[0]}" ไม่ใช่ตัวแรกของชื่อ ${first}`;
  if (l && b && !l.includes(b[0])) return `"${b[0]}" ไม่ใช่ตัวแรกของนามสกุล ${last}`;
  return (f && a) ? '' : null;
}

// ---- read every file ------------------------------------------------------
const entries = [];
for (const file of FILES) {
  const rows = parseCsv(readFileSync(file, 'utf8').replace(/^﻿/, ''));
  const header = rows[0].map((h) => h.trim());
  const exact = (...names) => { for (const n of names) { const i = header.indexOf(n); if (i >= 0) return i; } return -1; };
  const loose = (pred) => header.findIndex(pred);
  // ⛔ `kkumail (ในระบบ)` is the column WE filled, from the database, and on a
  // held row it is empty by definition. It must never be read as the answer.
  const isSystem = (h) => h.includes('ในระบบ') || h.includes('จากระบบ');
  const COL = {
    mail: exact('กรอก: kkumail', 'kkumail'),
    sidFill: exact('กรอก: รหัสนักศึกษา'),
    sid: loose((h) => h.includes('รหัส') && !h.startsWith('กรอก') && !h.includes('สาย')),
    first: exact('ชื่อ (จากระบบ)'),
    last: exact('นามสกุล (จากระบบ)'),
    name: loose((h) => h.includes('ชื่อ') && !h.includes('ชื่อเล่น') && !h.startsWith('กรอก') && !isSystem(h)),
    nickFill: exact('กรอก: ชื่อเล่น'),
    nick: exact('ชื่อเล่น'),
    sai: exact('สาย', 'สายรหัส'),
    note: loose((h) => h.includes('หมายเหตุ')),
  };
  if (COL.mail < 0) COL.mail = loose((h) => /email|อีเมล|kkumail/i.test(h) && !isSystem(h));
  // The MD50 roster's รหัส column had an EMPTY header — a blank heading is not
  // a missing column, so fall back to the first one rather than refuse it.
  if (COL.sid < 0 && COL.sidFill < 0) COL.sid = 0;
  if (COL.mail < 0) {
    console.error(`⛔ ไม่พบคอลัมน์อีเมลใน ${basename(file)} — header: ${header.join(' | ')}`);
    process.exit(2);
  }
  // รุ่น is needed only to place a line that carries no รหัส; the sheets we
  // send are named after it (`MD52-ข้อมูลไม่ครบ.csv`).
  const md = basename(file).match(/MD(\d{2})/i);
  const cohort = md ? COHORT_EPOCH + Number(md[1]) : null;
  const cell = (r, i) => (i >= 0 ? answered(r[i]) : '');
  rows.slice(1).forEach((r, k) => {
    const first = cell(r, COL.first);
    const last = cell(r, COL.last);
    entries.push({
      file: basename(file),
      line: k + 2,
      cohort,
      sid: digits(cell(r, COL.sidFill) || cell(r, COL.sid)),
      name: first || last ? `${first} ${last}`.trim() : cell(r, COL.name),
      mail: cell(r, COL.mail).replace(/^@/, '').toLowerCase(),
      nick: cell(r, COL.nickFill) || (COL.nickFill < 0 ? cell(r, COL.nick) : ''),
      sai: digits(cell(r, COL.sai)).padStart(3, '0').replace(/^000$/, ''),
      note: cell(r, COL.note),
    });
  });
}
const where = (e) => `${e.file}:${e.line}`;
const refused = [];   // { e, why }
const refuse = (e, why) => { e.refused = why; refused.push({ e, why }); };

// ---- what the file says about itself, before the database is asked -------
for (const e of entries) {
  if (!e.mail) continue;
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e.mail)) { refuse(e, `อีเมล "${e.mail}" รูปแบบไม่ถูกต้อง`); continue; }
  if (e.sid) {
    const s = normalizeStudentId(e.sid);
    if (!s.ok) { refuse(e, `รหัส "${e.sid}" ไม่ครบ 10 หลัก`); continue; }
    if (studentIdChecksumOk(s.value) === false) { refuse(e, `รหัส ${s.value} — เลขตรวจท้ายไม่ตรง (พิมพ์ผิด?)`); continue; }
  }
}

// ⛔ ONE รหัส OR ONE ADDRESS ON TWO PEOPLE. The sheet is filled by hand in a
// spreadsheet, so a pasted-twice line is an ordinary accident. Two rows with
// the SAME รหัส and the SAME address passed the old check, which only asked
// whether one รหัส carried two different addresses.
for (const key of ['mail', 'sid']) {
  const groups = new Map();
  for (const e of entries) {
    if (!e[key] || e.refused) continue;
    if (!groups.has(e[key])) groups.set(e[key], []);
    groups.get(e[key]).push(e);
  }
  for (const [value, group] of groups) {
    const people = new Set(group.map((e) => nameKey(e.name) || `${e.sai}|${e.sid}`));
    if (people.size < 2) continue;
    // When the address is someone's OWN name for exactly one of them, that one
    // is the original and the rest are the copy. Any other shape is a guess.
    const own = group.filter((e) => e.mail && addressInitialsProblem(e.mail, ...e.name.split(' ')) === '');
    for (const e of group) {
      if (own.length === 1 && own[0] === e) {
        e.dupNote = `${key === 'mail' ? 'อีเมล' : 'รหัส'}นี้ถูกใส่ไว้กับอีก ${group.length - 1} แถวด้วย — เก็บแถวนี้เพราะอีเมลตรงกับชื่อ`;
        continue;
      }
      refuse(e, `${key === 'mail' ? 'อีเมล' : 'รหัส'} ${value} ซ้ำกับ ${group.filter((o) => o !== e).map((o) => `${o.name} (${where(o)})`).join(', ')}`);
    }
  }
}

// ---- the rows we are waiting on ------------------------------------------
const target = announceTarget(loadEnv());
const ask = async (sql) => JSON.parse(await runSql(sql, target));
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const list = (xs) => (xs.length ? xs.map(q).join(',') : 'null');

const held = await ask(`
  select id::text, student_id, first_name_th, last_name_th, sai_code, cohort_year,
         nickname_imported, reason, note, follow_up
    from public.student_import_unresolved
   where resolved_at is null`);

// Match each line to ONE held row: by รหัส when the held row has one, else by
// รุ่น + สาย + the exact name we sent. Never by name alone, never fuzzily.
const bySid = new Map(held.filter((h) => digits(h.student_id)).map((h) => [digits(h.student_id), h]));
const heldName = (h) => `${h.first_name_th || ''} ${h.last_name_th || ''}`.trim();
for (const e of entries) {
  let h = e.sid ? bySid.get(e.sid) : null;
  if (h) {
    const ours = nameKey(heldName(h));
    const theirs = nameKey(e.name);
    // Substring either way: the file may carry a middle name or a shortened
    // สกุล. What is NOT tolerated is two names that share nothing.
    if (!(ours && theirs && (theirs.includes(ours) || ours.includes(theirs)))) {
      if (e.mail && !e.refused) refuse(e, `รหัสตรงแต่ชื่อไม่ตรง — ในระบบ "${heldName(h)}" / ในไฟล์ "${e.name}"`);
      continue;
    }
  } else if (e.cohort && e.sai) {
    const cands = held.filter((x) => !digits(x.student_id) && x.cohort_year === e.cohort && x.sai_code === e.sai
      && (nameKey(heldName(x)) === nameKey(e.name)));
    if (cands.length === 1) [h] = cands;
  }
  if (!h) continue;                       // this line is not one we are waiting on
  e.held = h;
  e.ours = heldName(h);
}

// What the database already holds for every address and รหัส in play.
const live = entries.filter((e) => e.held && e.mail && !e.refused);
const mails = [...new Set(live.map((e) => e.mail))];
const typoFixes = mails.filter((m) => m.split('@')[1] !== DOMAIN).map((m) => `${m.split('@')[0]}@${DOMAIN}`);
const sids = [...new Set(live.map((e) => e.sid || digits(e.held.student_id)).filter(Boolean))];
const [state] = await ask(`
  select
    (select coalesce(json_agg(lower(btrim(kkumail))), '[]') from public.students
      where lower(btrim(kkumail)) in (${list([...mails, ...typoFixes])})) as student_mails,
    (select coalesce(json_agg(regexp_replace(student_id, '\\D', '', 'g')), '[]') from public.students
      where regexp_replace(student_id, '\\D', '', 'g') in (${list(sids)})) as student_sids,
    (select coalesce(json_agg(lower(email)), '[]') from auth.users
      where lower(email) in (${list(typoFixes)})) as signed_in,
    (select coalesce(json_agg(json_build_object('id', id, 'sid', regexp_replace(student_id, '\\D', '', 'g'),
       'mail', lower(btrim(kkumail)), 'name', full_name)), '[]') from public.people
      where regexp_replace(coalesce(student_id, ''), '\\D', '', 'g') in (${list(sids)})
         or lower(btrim(kkumail)) in (${list([...mails, ...typoFixes])})) as people`);

const plan = [];
for (const e of live) {
  const h = e.held;
  // An address on the wrong DOMAIN is corrected only when the corrected one
  // is PROVEN: somebody has signed in with it. Otherwise it is refused.
  if (e.mail.split('@')[1] !== DOMAIN) {
    const fixed = `${e.mail.split('@')[0]}@${DOMAIN}`;
    if (!state.signed_in.includes(fixed)) { refuse(e, `โดเมน "${e.mail.split('@')[1]}" ไม่ใช่ ${DOMAIN}`); continue; }
    e.fixedFrom = e.mail;
    e.mail = fixed;
  }
  const initials = addressInitialsProblem(e.mail, h.first_name_th, h.last_name_th);
  if (initials) { refuse(e, `อีเมล ${e.mail} ไม่น่าใช่ของ ${e.ours} — ${initials}`); continue; }
  const sid = e.sid || digits(h.student_id);
  if (e.sid && !digits(h.student_id) && cohortFromStudentId(e.sid) !== h.cohort_year) {
    refuse(e, `รหัส ${e.sid} เป็นรุ่น ${cohortFromStudentId(e.sid)} แต่แถวนี้อยู่รุ่น ${h.cohort_year}`); continue;
  }
  if (state.student_mails.includes(e.mail)) { refuse(e, `อีเมล ${e.mail} มีเจ้าของในระบบบ้านแล้ว`); continue; }
  if (e.sid && !digits(h.student_id)) {
    if (state.student_sids.includes(e.sid)) { refuse(e, `รหัส ${e.sid} มีเจ้าของในระบบบ้านแล้ว`); continue; }
    if (held.some((x) => x !== h && digits(x.student_id) === e.sid)) { refuse(e, `รหัส ${e.sid} เป็นของแถวค้างอีกแถว`); continue; }
  }
  // The ORDERING RULE (docs/state/phuriphatma.md): resolve_person_id matches on
  // kkumail ONLY, so a person who already exists without this address must be
  // given it FIRST or promotion makes them twice.
  const pSid = sid ? state.people.filter((p) => p.sid === sid) : [];
  const pMail = state.people.filter((p) => p.mail === e.mail);
  if (pSid.length > 1) { refuse(e, `รหัส ${sid} มีอยู่ใน people ${pSid.length} แถว`); continue; }
  let linkPerson = null;
  if (pSid.length === 1) {
    const [p] = pSid;
    if (p.mail && p.mail !== e.mail) { refuse(e, `คนรหัส ${sid} มีอีเมล ${p.mail} อยู่แล้ว ไม่ใช่ ${e.mail}`); continue; }
    if (nameKey(p.name) !== nameKey(e.ours)) { refuse(e, `รหัส ${sid} ใน people เป็นชื่อ "${p.name}"`); continue; }
    if (!p.mail) linkPerson = p.id;
  }
  if (pMail.some((p) => p.sid && sid && p.sid !== sid)) { refuse(e, `อีเมล ${e.mail} เป็นของคนรหัสอื่นใน people`); continue; }
  plan.push({ e, h, sid, linkPerson });
}

// Lines that did not answer, but SAID something. A remark that names one of the
// four answers becomes that answer (0217); any other remark is kept as a note —
// a held row is the only record the person was ever sent to us, so the ฝ่าย's
// word goes on it, never over one.
const said = entries.filter((e) => e.held && !e.mail && e.note);
const follow = said.map((e) => ({ e, status: followUpFromText(e.note) }))
  .filter((f) => f.status && f.e.held.follow_up !== f.status);
const notes = said.filter((e) => !followUpFromText(e.note) && !e.held.note);

// ---- report ---------------------------------------------------------------
const md = (y) => (y ? `MD${y - COHORT_EPOCH}` : '—');
const answeredCount = entries.filter((e) => e.mail).length;
console.log(`\n  ${FILES.length} ไฟล์ · ${entries.length} แถว · ตอบอีเมลมา ${answeredCount}`
  + ` · ยังค้างอยู่ทั้งหมด ${held.length}\n`);
for (const { e, h, sid, linkPerson } of plan) {
  console.log(`  ✓ ${md(h.cohort_year)} สาย ${String(h.sai_code || '-').padEnd(4)} ${e.ours.padEnd(28)} → ${e.mail}`
    + (e.sid && !digits(h.student_id) ? `  (+ รหัส ${normalizeStudentId(sid).value})` : '')
    + (e.nick && !h.nickname_imported ? `  (+ ชื่อเล่น ${e.nick})` : '')
    + (e.fixedFrom ? `\n      แก้โดเมนจาก ${e.fixedFrom} — มีคนเข้าสู่ระบบด้วย ${e.mail} แล้ว` : '')
    + (linkPerson ? '\n      ใส่อีเมลให้ people ที่มีอยู่ก่อน (ทีม SAMO) — กันคนซ้ำ' : '')
    + (e.dupNote ? `\n      ⚠ ${e.dupNote}` : ''));
}
for (const { e, why } of refused) {
  console.log(`  ✗ ${where(e).padEnd(12)} ${(e.ours || e.name).padEnd(28)} ${e.mail || ''} — ${why} — ไม่เขียน`);
}
for (const { e, status } of follow) {
  console.log(`  ${FOLLOW_UP[status].closes ? '⊘' : '✎'} ${md(e.held.cohort_year)} สาย ${e.held.sai_code} `
    + `${e.ours || '(แถวว่าง)'} — ${FOLLOW_UP[status].label}${FOLLOW_UP[status].closes ? ' — ปิดรายการ' : ''}`);
}
for (const e of notes) console.log(`  ✎ ${md(e.held.cohort_year)} สาย ${e.held.sai_code} ${e.ours} — หมายเหตุ: ${e.note}`);
const unanswered = entries.filter((e) => e.held && !e.mail && !e.note);
const perFile = [...new Set(unanswered.map((e) => e.file))]
  .map((f) => `${f} ${unanswered.filter((e) => e.file === f).length}`).join(', ');
const closing = follow.filter((f) => FOLLOW_UP[f.status].closes).length;
console.log(`\n  นำเข้า ${plan.length} · ปฏิเสธ ${refused.length} · สถานะ ${follow.length - closing}`
  + ` · ปิด ${closing} · หมายเหตุ ${notes.length}`
  + ` · ยังไม่ได้คำตอบ ${unanswered.length}${perFile ? ` (${perFile})` : ''}`);
if (!plan.length && !notes.length && !follow.length) { console.log('\n  ไม่มีอะไรให้ทำ\n'); process.exit(0); }

// ---- the transaction ------------------------------------------------------
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
console.log(`  acting as ${actor.email} (${actor.role})`);

// Everything runs as `authenticated` with the admin's claims, set at TOP LEVEL
// (inside a plpgsql helper `set local role` never takes effect), so the same
// RLS and RPC checks the pane meets apply here. ONE transaction: a duplicate
// address or a row resolved meanwhile aborts all of it, never half a ฝ่าย.
const steps = plan.map(({ e, h, sid, linkPerson }) => [
  linkPerson && `update public.people set kkumail = ${q(e.mail)} where id = ${q(linkPerson)}::uuid and kkumail is null;`,
  // Written onto the HELD row first so the promotion copies them the same way it
  // copies every other column; setting them on `students` afterwards would be a
  // second path into the same field.
  e.sid && !digits(h.student_id) && `update public.student_import_unresolved set student_id = ${q(normalizeStudentId(sid).value)}
    where id = ${q(h.id)}::uuid and student_id is null;`,
  e.nick && !h.nickname_imported && `update public.student_import_unresolved set nickname_imported = ${q(e.nick)}
    where id = ${q(h.id)}::uuid and nickname_imported is null;`,
  `select public.promote_unresolved_row(${q(h.id)}::uuid, ${q(e.mail)});`,
].filter(Boolean).join('\n')).join('\n');
const noteSql = notes.map((e) => `update public.student_import_unresolved
  set note = ${q(`ฝ่ายข้อมูล ${TODAY}: ${e.note}`)} where id = ${q(e.held.id)}::uuid and note is null;`).join('\n');
const followSql = follow.map(({ e, status }) => `select public.set_unresolved_follow_up(${q(e.held.id)}::uuid,
  ${q(status)}, ${q(`ฝ่ายข้อมูล ${TODAY}: ${e.note}`)});`).join('\n');

// The postcondition, asserted INSIDE the transaction so a failure undoes it:
// each address is one student and ONE person, and that person holds the รหัส.
const checks = plan.map(({ e, sid }) => `(${q(e.mail)}, ${q(sid ? normalizeStudentId(sid).value : '')})`).join(',');
const sql = `
begin;
select set_config('request.jwt.claims',
  json_build_object('sub', ${q(actor.id)}, 'role', 'authenticated',
                    'email', ${q(actor.email)})::text, true);
set local role authenticated;
${steps}
${noteSql}
${followSql}
reset role;
create temporary table _after on commit drop as
  select c.mail, c.sid,
         (select count(*) from public.students s where lower(btrim(s.kkumail)) = c.mail) as students,
         (select count(*) from public.people p where lower(btrim(p.kkumail)) = c.mail) as people_by_mail,
         (select count(*) from public.people p where c.sid <> '' and p.student_id = c.sid) as people_by_sid,
         (select s.person_id is not null and s.student_id is not distinct from nullif(c.sid, '')
            from public.students s where lower(btrim(s.kkumail)) = c.mail) as linked
    from (values ${checks || "('', '')"}) c(mail, sid) where c.mail <> '';
do $$ declare bad text; begin
  select string_agg(mail, ', ') into bad from _after
   where students <> 1 or people_by_mail <> 1 or (sid <> '' and people_by_sid <> 1) or not linked;
  if bad is not null then raise exception 'postcondition failed for: %', bad; end if;
end $$;
select json_build_object(
  'promoted', (select count(*) from _after),
  'held_open', (select count(*) from public.student_import_unresolved where resolved_at is null),
  'people_dup_sids', (select count(*) from (select student_id from public.people
     where student_id is not null group by student_id having count(*) > 1) d)) as after;
${APPLY ? 'commit;' : 'rollback;'}`;

try {
  const [{ after }] = JSON.parse(await runSql(sql, target));
  console.log(`\n  หลังทำ: นำเข้า ${after.promoted} · ยังค้าง ${after.held_open}`
    + ` · รหัสซ้ำใน people ${after.people_dup_sids}`);
  console.log(APPLY ? '  ✓ committed\n' : '  (dry run — rolled back; ใส่ --apply เพื่อเขียนจริง)\n');
} catch (e) {
  console.error(`\n⛔ ไม่ได้เขียนอะไรเลย (ทั้งชุดถูกยกเลิก): ${e.message}\n`);
  process.exit(4);
}
