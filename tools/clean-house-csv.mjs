#!/usr/bin/env node
// ============================================================
// clean-house-csv.mjs — turn a ฝ่ายข้อมูล handover file into something
// src/js/house/io.js can import, and SAY what it changed.
//
// WHY THIS IS A TOOL AND NOT A ONE-OFF EDIT.
// The file comes back. The 2026-09-14 handover needed four corrections before
// it could be imported, and the answers to two of its questions arrive from
// another department days later — which means the file is re-sent, and every
// correction has to be re-applied identically. A hand-edited CSV cannot be
// re-applied and cannot be reviewed: the diff is 1,776 lines of Thai names and
// nobody can see which nine cells moved. This script is the diff.
//
// WHAT IT WILL NOT DO — the line that decides every rule below.
// It repairs only what is provably wrong AND has exactly one possible right
// answer. `@kkumail.con` is a domain that does not exist and 1,604 of the file's
// 1,613 addresses are `@kkumail.com`, so the intended value is not in question.
// A missing address, a สายรหัส that collides with another person's, a name that
// two sources spell differently — those have more than one possible answer, and
// a guess there is not recoverable: the wrong kkumail is a login nobody can ever
// claim, and the wrong สายรหัส puts a real student in the wrong บ้าน, which is
// the exact failure src/js/house/fields.js was built around. Those are REPORTED
// and routed out of the import, never patched.
//
// OUTPUTS (all under the same directory as the input, which is gitignored —
// this is 1,776 real students' names, รหัส and addresses, and the repo is
// PUBLIC):
//   <base>.clean.csv    the rows that can be imported, in io.js's vocabulary
//   <base>.pending.csv  the rows that cannot, each with the reason why
//   <base>.report.md    what changed, what was routed out, what to ask
//
//   node tools/clean-house-csv.mjs externaldata/house-import/<file>.csv
// ============================================================
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

const src = process.argv[2];
if (!src) {
  console.error('usage: node tools/clean-house-csv.mjs <path-to-raw.csv>');
  process.exit(1);
}

// ------------------------------------------------------------
// CSV in / out. Deliberately local rather than imported from src/js/team/io.js:
// that module is an ES module in the browser bundle and this is a Node script,
// but more importantly the REAL parser is the one the importer will use, and
// this script must not become a second opinion about what the file contains.
// Its job is only to move cells; every value it writes is re-parsed and
// re-validated by io.js at import time.
// ------------------------------------------------------------
function parseCsv(text) {
  const rows = [];
  let row = [], cur = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else quoted = false; }
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\r') { /* swallowed; \n ends the row */ }
    else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
    else cur += c;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

const csvCell = (v) => (/[",\n]/.test(v) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
const toCsv = (rows) => rows.map((r) => r.map(csvCell).join(',')).join('\n') + '\n';

// ------------------------------------------------------------
// CELL HYGIENE
// ------------------------------------------------------------

/**
 * Invisible characters, removed before anything else looks at the value.
 *
 * U+200B ZERO WIDTH SPACE is in this file, on the END of two addresses
 * ("...@kkumail.com​") and inside four Thai names. It survives a trim, it
 * survives a visual review, and it makes a kkumail that looks perfect fail to
 * match the same address typed by a human at login — which is the single most
 * expensive kind of wrong here, because it looks right in every screenshot of
 * the problem. NBSP is included for the same reason.
 */
const INVISIBLE = /[​-‏⁠﻿]/g;
const clean = (v) => String(v ?? '').replace(INVISIBLE, '').replace(/ /g, ' ')
  .replace(/\s+/g, ' ').trim();

/**
 * Spreadsheet error values, treated as EMPTY.
 *
 * `#N/A` in this file is not a status and not a person's data — it is a failed
 * VLOOKUP. The proof is in the file itself: every one of the 114 rows whose
 * address is `#N/A` or blank has a matching row in the วิชาการ table on the
 * right, and that row's address is blank too. The lookup ran, found nothing,
 * and wrote `#N/A`. It carries no information beyond "empty", and the handover
 * spec already asks for empty.
 *
 * Keeping it would be worse than dropping it: io.js would import `#N/A` as a
 * ชื่อเล่น for 38 people and refuse `#N/A` as an address for 49 more with a
 * message about the address being malformed, which sends the reader looking for
 * a typo instead of a missing person.
 */
const ERRORS = /^#(N\/A|VALUE!|REF!|NAME\?|DIV\/0!|NULL!|NUM!|GETTING_DATA)$/i;
const cell = (v) => { const s = clean(v); return ERRORS.test(s) ? '' : s; };

/**
 * Domain typos with exactly one possible intended value.
 *
 * Every entry here is a domain that DOES NOT EXIST, in a file where 1,604 of
 * 1,613 addresses are @kkumail.com. The local part — the half that identifies
 * the person and that nobody could reconstruct — is never touched.
 *
 * `nutsara2869@gmail.com` is deliberately NOT in this list. gmail.com is a real
 * domain and that is a real address; it is simply not a kkumail, so the student
 * will import fine and then never match their login. That is a question for a
 * human, and io.js already asks it per-row.
 */
const DOMAIN_FIX = {
  'kkumail.con': 'kkumail.com',
  'kkumaik.com': 'kkumail.com',
  'kkumaul.com': 'kkumail.com',
  'kkumil.com': 'kkumail.com',
  'kumail.com': 'kkumail.com',
  'kkumail.co': 'kkumail.com',
  'kkumail.cm': 'kkumail.com',
  'kkumali.com': 'kkumail.com',
};

function fixMail(raw) {
  const v = cell(raw).toLowerCase();
  if (!v) return { value: '', fixed: null };
  const at = v.lastIndexOf('@');
  if (at < 1) return { value: v, fixed: null };
  const local = v.slice(0, at), domain = v.slice(at + 1);
  const want = DOMAIN_FIX[domain];
  if (!want) return { value: v, fixed: null };
  return { value: `${local}@${want}`, fixed: { from: v, to: `${local}@${want}` } };
}

/** รหัสนักศึกษา → the dashed canonical form. Digits only are re-dashed; anything
 *  that is not exactly ten digits is handed back untouched for io.js to judge,
 *  because a รหัส of the wrong length is a question, not a formatting problem. */
function fixSid(raw) {
  const v = cell(raw).replace(/[^\d-]/g, '');
  const digits = v.replace(/-/g, '');
  if (digits.length !== 10) return { value: cell(raw), ok: false };
  return { value: `${digits.slice(0, 9)}-${digits.slice(9)}`, ok: true };
}

// ------------------------------------------------------------
// DECISIONS A HUMAN MADE — the only place this file is allowed to guess,
// because here it is not guessing.
//
// Everything above repairs what has exactly ONE possible right answer. The
// entries below have an answer too, but the tool could not have reached it: a
// person read the row, weighed it, and decided. They live here rather than in a
// hand-edited CSV for the reason this whole script exists — the file comes back,
// and a correction that is not written down has to be re-made from memory on a
// file 1,776 lines long.
//
// ⚠️ EVERY ENTRY IS REPORTED WHEN IT DOES NOT MATCH. A decision keyed to a
// รหัสนักศึกษา rots the moment the next handover fixes the row it was about, and
// a stale override that quietly matches nothing is how a list like this turns
// into folklore. §1 of the report prints the ones that did not apply, so they
// can be deleted.
// ------------------------------------------------------------

/**
 * Who an address belongs to, when two rows carry the same one.
 *
 * A duplicate kkumail is two people and one login, and the importer's own rule —
 * keep the first line, skip the rest — decides it by LINE ORDER, which is right
 * by luck or wrong by luck and looks identical either way. Naming the owner here
 * means the other holders get the address blanked instead, so they land in the
 * held list as "no kkumail" and can claim their own record later. Nobody is
 * dropped, and the person who genuinely owns the address is not punished for
 * somebody else's copy-paste.
 */
const MAIL_OWNER = {
  // `thatpicha.k` is ทัตพิชา ก— . ธีร์ธวัช's row carried her address; his own is
  // not reconstructible (KKU uses the given name plus one to three surname
  // letters, and the count varies to disambiguate — `kanokpornol`,
  // `pichsinee.kh` and `phiraphat.pr` are all in this file), so his is blanked
  // rather than invented. Decided by the owner, 2026-09-14.
  'thatpicha.k@kkumail.com': '643070034-1',
};

/**
 * A name where the two tables disagree AND a third source settles it.
 *
 * The third source is the local part of the person's own kkumail: the university
 * built it from the name it holds, so it is the one spelling neither department
 * typed into this spreadsheet. It is not a proof — transliteration swallows ณิ/ณ
 * and น์/ต์ — which is why only the unambiguous one is here and the rest stay in
 * §4 for a human.
 */
const NAME_FIX = {
  // Left table "วรมิตา", right table "รมิตา", her address `ramita.si@` — not
  // `woramita.si@`. The left table carries a ว nobody else has. Decided by the
  // owner, 2026-09-14, after the report gained the email column.
  '653070078-2': { first_name_th: 'รมิตา' },
};

/**
 * An address at any other domain is not an identity for ระบบบ้าน.
 *
 * `students.kkumail` is what a login is matched on, and the handover spec asks
 * for kkumail. One row of the 2026-09-14 file carries a real, working
 * `@gmail.com` address — not a typo, so nothing above touches it — and importing
 * it would put a student in the system holding an address that only matches if
 * they happen to sign in with that gmail rather than their university account.
 *
 * So it is BLANKED and the row is held. That is the better outcome for the
 * person, not a worse one: held rows carry a รหัสนักศึกษา, and a held row with a
 * รหัส is exactly what the student can claim for themselves with their REAL
 * kkumail. The address is not lost — it is named in §3 of the report and it is
 * still in the raw file, which is never modified.
 */
const IDENTITY_DOMAIN = /@kkumail\.com$/;

// ------------------------------------------------------------
// COLUMN LAYOUT
//
// The handover sheet carries TWO tables side by side. Columns 0-8 are the
// สายรหัส roster that was asked for; columns 10-14 are ฝ่ายวิชาการ's own
// database, pasted in as the source the Email column was VLOOKUP'd from.
//
// The right table is READ (to prove what the #N/A means) and then DROPPED. It
// can fill nothing: of the 163 rows missing an address, 114 appear in it with a
// blank address and 36 do not appear at all. Carrying it into the clean file
// would give the importer a second, disagreeing spelling of four people's names
// and one คำนำหน้า glued to a first name.
// ------------------------------------------------------------
const IN = { sid: 0, first: 1, last: 2, nick: 3, mail: 4, major: 5, sai: 6, status: 7, cohort: 8 };
const RIGHT = { sid: 10, first: 11, last: 12, nick: 13, mail: 14 };

/** io.js's own header spelling, so the clean file needs no aliasing at all. */
const OUT_HEADER = ['student_id', 'first_name_th', 'last_name_th', 'nickname_th',
  'kkumail', 'major', 'sai'];
const PENDING_HEADER = [...OUT_HEADER, 'source_line', 'cohort', 'reason'];

// ------------------------------------------------------------
// MAIN
// ------------------------------------------------------------
const text = readFileSync(src, 'utf8').replace(/^﻿/, '');
if (text.includes('�')) {
  console.error('ไฟล์ไม่ใช่ UTF-8 — ชื่อไทยเสียหายไปแล้วตั้งแต่ในไฟล์ ขอไฟล์ใหม่');
  process.exit(2);
}
const raw = parseCsv(text);
const data = raw.slice(1).filter((r) => r.some((c) => clean(c)));

const report = {
  invisible: [], errorCells: 0, mailFixed: [], sidRedashed: 0,
  dupMail: [], offDomain: [], titled: [], nameDiff: [],
  droppedCols: [], rightOnly: [],
  decided: [], staleDecisions: [], blankedDomain: [],
};

// ---- cohort blocks, from the รุ่น column's section markers -----------------
// The รุ่น column is not per-row data: it holds one label at the first row of
// each cohort's block (MD49…MD54) and is blank for the other 1,770 rows. It is
// used HERE, to name each block in the report, and then dropped — the database
// derives cohort_year from the รหัสนักศึกษา itself (cohort_from_student_id), so
// importing a รุ่น column would be a second, hand-maintained copy of a fact the
// รหัส already carries.
const marks = [];
data.forEach((r, i) => { const v = cell(r[IN.cohort]); if (v) marks.push({ i, label: v.replace(/\s+/g, '') }); });
const blocks = marks.map((m, k) => ({
  label: m.label, from: m.i, to: k + 1 < marks.length ? marks[k + 1].i - 1 : data.length - 1,
}));
const blockOf = (i) => blocks.find((b) => i >= b.from && i <= b.to)?.label || '?';

// ---- pass 1: clean every row ------------------------------------------------
const rows = data.map((r, i) => {
  const line = i + 2;                            // 1-based, header included
  r.forEach((c, j) => {
    const hit = String(c).match(INVISIBLE);
    if (hit) report.invisible.push({ line, col: j, n: hit.length });
    if (ERRORS.test(clean(c))) report.errorCells++;
  });
  const mail = fixMail(r[IN.mail]);
  if (mail.fixed) report.mailFixed.push({ line, ...mail.fixed });
  const sid = fixSid(r[IN.sid]);
  if (sid.ok && cell(r[IN.sid]) !== sid.value) report.sidRedashed++;

  const row = {
    line,
    cohort: blockOf(i),
    student_id: sid.value,
    first_name_th: cell(r[IN.first]),
    last_name_th: cell(r[IN.last]),
    nickname_th: cell(r[IN.nick]),
    kkumail: mail.value,
    major: cell(r[IN.major]).toUpperCase(),
    sai: cell(r[IN.sai]),
  };

  // ── the three decisions, applied in the one place a row is built ──────────
  // Order matters only between the first two: an address is blanked either
  // because it belongs to someone else or because it is not a kkumail, and a
  // row must not be reported under both headings.

  // 1. This address has a named owner and it is not this row.
  const owner = MAIL_OWNER[row.kkumail];
  if (owner && row.student_id && owner !== row.student_id) {
    report.decided.push({ line, what: 'mail_owner', key: `mail_owner:${row.kkumail}`,
      who: `${row.first_name_th} ${row.last_name_th}`,
      detail: `${row.kkumail} เป็นของ ${owner} — เว้นอีเมลของแถวนี้ไว้` });
    row.kkumail = '';
  } else if (row.kkumail && !IDENTITY_DOMAIN.test(row.kkumail)) {
    // 2. A real address at the wrong domain. Blanked, never repaired — the
    //    domain is not a typo, so there is nothing to correct; it is simply not
    //    the thing ระบบบ้าน identifies a student by.
    report.blankedDomain.push({ line, who: `${row.first_name_th} ${row.last_name_th}`,
      sid: row.student_id, mail: row.kkumail });
    row.kkumail = '';
  }

  // 3. A name the two tables spell differently, settled by a third source.
  const fix = NAME_FIX[row.student_id];
  if (fix) {
    for (const [k, v] of Object.entries(fix)) {
      const field = k === 'first_name_th' ? 'first_name_th' : k;
      if (row[field] !== v) {
        report.decided.push({ line, what: 'name_fix', key: `name_fix:${row.student_id}`,
          who: `${row.first_name_th} ${row.last_name_th}`,
          detail: `${field}: “${row[field]}” → “${v}”` });
        row[field] = v;
      }
    }
  }

  return row;
});

// A decision that CHANGED NOTHING, which is the only definition of stale that
// matters — and not the one the first version of this check used. It asked
// whether the named owner was still in the file, which stays true long after the
// next handover fixes the duplicate the override was written for: the entry then
// sits there matching a row it no longer alters, reading like a correction still
// being applied. `report.decided` is written only when a value actually moved,
// so asking it is asking the right question.
const fired = new Set(report.decided.map((d) => d.key));
for (const [mail, owner] of Object.entries(MAIL_OWNER)) {
  if (!fired.has(`mail_owner:${mail}`)) {
    report.staleDecisions.push(`MAIL_OWNER ${mail} → ${owner} (ไม่ได้เปลี่ยนอะไรในไฟล์นี้)`);
  }
}
for (const sidKey of Object.keys(NAME_FIX)) {
  if (!fired.has(`name_fix:${sidKey}`)) {
    report.staleDecisions.push(`NAME_FIX ${sidKey} (ไม่ได้เปลี่ยนอะไรในไฟล์นี้)`);
  }
}

// ---- pass 2: route each row to clean or pending -----------------------------
//
// The ONE rule that decides which file a row lands in: can this row be matched
// to a login? `students.kkumail` is NOT NULL and is the conflict target of the
// upsert, so a row without one cannot exist in the table at all — io.js skips
// it. Skipping is correct and silent-by-default is not: the skipped rows are
// people, they hold a สายรหัส seat, and a list that exists only in a preview
// pane disappears the moment the tab is closed. They go to a file.
const byMail = new Map();
rows.forEach((r) => {
  if (!r.kkumail) return;
  if (!byMail.has(r.kkumail)) byMail.set(r.kkumail, []);
  byMail.get(r.kkumail).push(r);
});

const clean_ = [], pending = [];
for (const r of rows) {
  if (!r.kkumail) {
    // Two shapes, and the difference decides whether anyone can ever resolve
    // the row: with a รหัสนักศึกษา the student can identify themselves later;
    // without one, only a human who knows them can.
    const has = r.student_id || r.first_name_th;
    pending.push({ ...r,
      reason: !has ? 'ว่างทั้งแถว — มีแต่สายรหัส ไม่มีคน'
        : r.student_id ? 'ไม่มี kkumail'
          : 'ไม่มีทั้ง kkumail และรหัสนักศึกษา' });
    continue;
  }
  const dup = byMail.get(r.kkumail);
  if (dup.length > 1) {
    // A duplicate address is two people and one login. io.js keeps the FIRST
    // and skips the rest, which happens to be right in this file and is right
    // by accident — the surviving row is decided by line order, not by which
    // person the address belongs to. Both rows are routed out instead, so the
    // choice is made by someone who can ask.
    if (!report.dupMail.some((d) => d.mail === r.kkumail)) {
      report.dupMail.push({ mail: r.kkumail, rows: dup.map((x) => ({ line: x.line, name: `${x.first_name_th} ${x.last_name_th}`, sai: x.sai })) });
    }
    pending.push({ ...r, reason: `kkumail ซ้ำกับบรรทัด ${dup.filter((x) => x !== r).map((x) => x.line).join(', ')}` });
    continue;
  }
  if (!/@kkumail\.com$/.test(r.kkumail)) report.offDomain.push({ line: r.line, mail: r.kkumail, name: `${r.first_name_th} ${r.last_name_th}` });
  clean_.push(r);
}

// ---- pass 3: the สายรหัส audit ---------------------------------------------
//
// This is the check the whole script exists for, and it is a FILE-level check —
// invisible one row at a time. บ้าน is the LAST DIGIT of สายรหัส, so a สาย that
// is wrong by one puts a student in a different บ้าน, and nothing downstream can
// tell. Four of this file's six cohorts number their สาย 1..N with no gap and no
// repeat; if two do not, that difference is the signal.
const saiAudit = blocks.map((b) => {
  const rs = rows.slice(b.from, b.to + 1);
  const nums = rs.map((r) => Number(r.sai)).filter((n) => Number.isFinite(n) && n > 0);
  const seen = new Map();
  nums.forEach((n) => seen.set(n, (seen.get(n) || 0) + 1));
  const max = Math.max(...nums);
  const gaps = []; for (let n = 1; n <= max; n++) if (!seen.has(n)) gaps.push(n);
  const dups = [...seen.entries()].filter(([, c]) => c > 1).map(([n]) => n);
  const dupRows = dups.flatMap((n) => rs.filter((r) => Number(r.sai) === n));
  return { label: b.label, count: rs.length, max, gaps, dups, dupRows };
});

// ---- pass 4: what the right-hand table knows that the left does not ---------
const leftSids = new Set(rows.map((r) => r.student_id.replace(/-/g, '')).filter(Boolean));
data.forEach((r, i) => {
  const sid = cell(r[RIGHT.sid]).replace(/-/g, '');
  if (sid && !leftSids.has(sid)) {
    report.rightOnly.push({ line: i + 2, sid: cell(r[RIGHT.sid]), name: `${cell(r[RIGHT.first])} ${cell(r[RIGHT.last])}`, mail: cell(r[RIGHT.mail]) });
  }
});
// Names the two tables spell differently. Reported, never merged: the left table
// is the one that was asked for, and in every one of this file's four cases the
// right table is the damaged spelling (one carries a คำนำหน้า glued to the first
// name). A name is not recoverable from a guess.
const rightByS = new Map();
data.forEach((r) => { const s = cell(r[RIGHT.sid]).replace(/-/g, ''); if (s) rightByS.set(s, [cell(r[RIGHT.first]), cell(r[RIGHT.last])]); });
rows.forEach((r) => {
  const o = rightByS.get(r.student_id.replace(/-/g, ''));
  if (o && r.first_name_th && o[0] && r.first_name_th !== o[0]) {
    // THE LOCAL PART OF THE PERSON'S OWN ADDRESS IS A THIRD WITNESS, and it is
    // the only one of the three that neither department typed into this
    // spreadsheet — the university issued it from the name it holds.
    //
    // It earned its place immediately: 653070078-2 is `ramita.si@`, not
    // `woramita.si@`, so the RIGHT table's "รมิตา" is the spelling her own
    // address was built from and the left table's "วรมิตา" carries a ว nobody
    // else has. The first version of this report printed the two names alone
    // and said "ใช้ตารางซ้าย" — a rule that is right three times out of four
    // here, which is exactly the kind of rule that gets believed.
    //
    // Still REPORTED, not acted on: transliteration is not a proof (ณิ/ณ and
    // น์/ต์ both survive it), so this narrows a human's question instead of
    // answering it.
    report.nameDiff.push({
      line: r.line, sid: r.student_id,
      left: `${r.first_name_th} ${r.last_name_th}`,
      right: `${o[0]} ${o[1]}`,
      mail: (r.kkumail || '').split('@')[0],
    });
  }
});

// ---- write ------------------------------------------------------------------
const dir = dirname(src);
const base = basename(src).replace(/\.csv$/i, '');
const out = (suffix) => join(dir, `${base}${suffix}`);

writeFileSync(out('.clean.csv'), toCsv([OUT_HEADER,
  ...clean_.map((r) => OUT_HEADER.map((k) => r[k] ?? ''))]), 'utf8');
writeFileSync(out('.pending.csv'), toCsv([PENDING_HEADER,
  ...pending.map((r) => PENDING_HEADER.map((k) => (k === 'source_line' ? r.line : r[k]) ?? ''))]), 'utf8');

const L = [];
const say = (s = '') => L.push(s);
say(`# รายงานการตรวจไฟล์รายชื่อสายรหัส`);
say();
say(`ไฟล์: \`${basename(src)}\` · ${data.length} แถว · ${blocks.length} รุ่น`);
say(`สร้างโดย \`tools/clean-house-csv.mjs\` — รันซ้ำได้ ผลลัพธ์เหมือนเดิมทุกครั้ง`);
say();
say(`| ผลลัพธ์ | จำนวน |`);
say(`|---|---|`);
say(`| นำเข้าได้ (\`${base}.clean.csv\`) | **${clean_.length}** |`);
say(`| ค้างไว้ก่อน (\`${base}.pending.csv\`) | **${pending.length}** |`);
say();
say(`## 1. สิ่งที่แก้ให้อัตโนมัติ`);
say();
say(`| แก้อะไร | จำนวน |`);
say(`|---|---|`);
say(`| ลบอักขระล่องหน (zero-width space) ออกจากเซลล์ | ${report.invisible.length} |`);
say(`| \`#N/A\` → ช่องว่าง | ${report.errorCells} |`);
say(`| แก้โดเมนอีเมลที่พิมพ์ผิด | ${report.mailFixed.length} |`);
say(`| ใส่ขีดในรหัสนักศึกษาให้เหมือนกันหมด | ${report.sidRedashed} |`);
say(`| ตัดคอลัมน์ สถานะ (ว่างทั้งไฟล์) และ รุ่น (เป็นหัวข้อคั่นบล็อก ไม่ใช่ข้อมูลรายคน) | 2 |`);
say(`| ตัดตารางฝ่ายวิชาการทางขวา (ไม่มีอีเมลที่ตารางซ้ายขาดอยู่เลยสักแถว) | 5 |`);
if (report.mailFixed.length) {
  say();
  say(`อีเมลที่แก้ — แก้เฉพาะ**โดเมน**ที่ไม่มีอยู่จริง ส่วนหน้า \`@\` ไม่แตะเลย:`);
  say();
  say(`| บรรทัด | เดิม | แก้เป็น |`);
  say(`|---|---|---|`);
  report.mailFixed.forEach((m) => say(`| ${m.line} | \`${m.from}\` | \`${m.to}\` |`));
}
say();
if (report.decided.length || report.blankedDomain.length) {
  say(`### สิ่งที่ "ตัดสินใจ" ไม่ใช่แก้อัตโนมัติ`);
  say();
  say(`รายการด้านล่างเครื่องเดาเองไม่ได้ — เป็นการตัดสินใจของคนที่อ่านแถวนั้นแล้ว `
    + `บันทึกไว้ในสคริปต์ (\`MAIL_OWNER\` / \`NAME_FIX\`) เพื่อให้ไฟล์รอบหน้าได้ผลเหมือนเดิม `
    + `ไม่ต้องมานั่งจำ **ไฟล์ต้นฉบับไม่เคยถูกแก้**`);
  say();
  report.decided.forEach((d) => say(`- บรรทัด ${d.line} · ${d.who} — ${d.detail}`));
  report.blankedDomain.forEach((d) => say(
    `- บรรทัด ${d.line} · ${d.who} — \`${d.mail}\` ไม่ใช่ @kkumail.com `
    + `จึงเว้นอีเมลไว้แล้วย้ายไปรายการค้าง เจ้าตัวยืนยันตัวตนเองด้วย kkumail จริงได้ `
    + `(อีเมลเดิมยังอยู่ในไฟล์ต้นฉบับและในบรรทัดนี้)`));
  say();
}
if (report.staleDecisions.length) {
  say(`⚠️ **การตัดสินใจที่ไม่ตรงกับไฟล์นี้แล้ว** — ไฟล์ใหม่น่าจะแก้ให้แล้ว ลบออกจากสคริปต์ได้:`);
  say();
  report.staleDecisions.forEach((d) => say(`- \`${d}\``));
  say();
}
say(`## 2. ⛔ ต้องถามฝ่ายข้อมูลก่อนนำเข้า`);
say();
const bad = saiAudit.filter((b) => b.gaps.length || b.dups.length);
if (!bad.length) say(`สายรหัสครบทุกรุ่น ไม่มีเลขขาดและไม่มีเลขซ้ำ — นำเข้าได้เลย`);
else {
  say(`**สายรหัสของบางรุ่นไม่ครบ** และเรื่องนี้ต้องตอบก่อน เพราะ**บ้านคิดจากหลักสุดท้ายของสายรหัส** `
    + `ถ้าสายเลื่อนไป 1 คนจะไปอยู่ผิดบ้าน และเปลี่ยนทีหลังไม่ได้แบบไม่มีใครรู้สึก`);
  say();
  say(`| รุ่น | จำนวนคน | สายสูงสุด | เลขที่ขาด | เลขที่ซ้ำ |`);
  say(`|---|---|---|---|---|`);
  saiAudit.forEach((b) => say(`| ${b.label} | ${b.count} | ${b.max} | ${b.gaps.join(', ') || '—'} | ${b.dups.join(', ') || '—'} |`));
  say();
  say(`คนที่ถือสายซ้ำ — ขอให้ฝ่ายข้อมูลชี้ว่าใครคือสายที่ขาดไป:`);
  say();
  say(`| รุ่น | บรรทัด | รหัสนักศึกษา | ชื่อ | สายที่ระบุ |`);
  say(`|---|---|---|---|---|`);
  bad.forEach((b) => b.dupRows.forEach((r) => say(`| ${b.label} | ${r.line} | ${r.student_id || '—'} | ${r.first_name_th} ${r.last_name_th} | ${r.sai} |`)));
}
say();
say(`## 3. แถวที่ยังนำเข้าไม่ได้ (${pending.length} คน)`);
say();
say(`ระบบบ้านใช้ **kkumail เป็นตัวระบุตัวตน** — เป็นทั้ง unique key ของตาราง `
  + `และเป็นสิ่งที่ใช้จับคู่ตอนนักศึกษาล็อกอิน แถวที่ไม่มี kkumail จึงสร้างแถวในระบบไม่ได้เลย `
  + `ไม่ได้ "นำเข้าแล้วเว้นว่าง" แต่คือ**ไม่มีตัวตนในระบบ**`);
say();
const reasons = new Map();
pending.forEach((p) => reasons.set(p.reason.replace(/บรรทัด .*/, 'อื่น'), (reasons.get(p.reason.replace(/บรรทัด .*/, 'อื่น')) || 0) + 1));
say(`| สาเหตุ | จำนวน |`);
say(`|---|---|`);
[...reasons.entries()].sort((a, b) => b[1] - a[1]).forEach(([k, v]) => say(`| ${k} | ${v} |`));
say();
const byCohort = new Map();
pending.forEach((p) => byCohort.set(p.cohort, (byCohort.get(p.cohort) || 0) + 1));
say(`แยกตามรุ่น: ${[...byCohort.entries()].map(([k, v]) => `${k} ${v} คน`).join(' · ')}`);
if (report.dupMail.length) {
  say();
  say(`**kkumail ซ้ำ แต่ยังไม่มีเจ้าของที่ระบุไว้** — คนละคนแต่ได้อีเมลเดียวกัน `
    + `ทั้งสองแถวถูกพักไว้ เพราะตัดสินจากลำดับบรรทัดคือการเดา `
    + `ถ้ารู้ว่าอีเมลเป็นของใคร แจ้งมาแล้วจะบันทึกไว้ให้ถาวร:`);
  say();
  report.dupMail.forEach((d) => {
    say(`- \`${d.mail}\` — ${d.rows.map((r) => `บรรทัด ${r.line} ${r.name} (สาย ${r.sai})`).join(' · ')}`);
  });
}
say();
say(`## 4. ข้อสังเกตอื่น`);
say();
if (report.rightOnly.length) {
  say(`**${report.rightOnly.length} คนอยู่ในตารางฝ่ายวิชาการ แต่ไม่มีในรายชื่อสายรหัส** — `
    + `ถ้ายังเป็นนักศึกษาอยู่ แปลว่ายังไม่ถูกจัดสาย:`);
  say();
  report.rightOnly.forEach((r) => say(`- ${r.sid} · ${r.name}${r.mail ? ` · \`${r.mail}\`` : ' · (ไม่มีอีเมล)'}`));
  say();
}
if (report.nameDiff.length) {
  say(`**ชื่อไม่ตรงกันระหว่างสองตาราง** — ไฟล์ที่นำเข้าใช้ชื่อจาก**ตารางซ้าย** (ตารางที่ขอไป) `
    + `ไม่ได้รวมสองตารางให้ ถ้าแถวไหนควรใช้ชื่อจากตารางขวา รบกวนแจ้งกลับมา`);
  say();
  say(`คอลัมน์สุดท้ายคือ**ส่วนหน้า @ ของอีเมลเจ้าตัว** ซึ่งมหาวิทยาลัยตั้งจากชื่อจริง `
    + `จึงเป็นพยานที่สามที่ไม่ได้มาจากตารางไหนเลย — ใช้ดูประกอบได้ว่าตารางไหนสะกดตรง `
    + `(แต่ไม่ใช่ข้อพิสูจน์ เพราะการถอดเป็นอังกฤษกลืนสระและตัวสะกดบางตัว)`);
  say();
  say(`| บรรทัด | รหัสนักศึกษา | ตารางซ้าย (ที่นำเข้า) | ตารางขวา | อีเมลเจ้าตัว |`);
  say(`|---|---|---|---|---|`);
  report.nameDiff.forEach((n) => say(
    `| ${n.line} | ${n.sid} | ${n.left} | ${n.right} | \`${n.mail}\` |`));
}
writeFileSync(out('.report.md'), L.join('\n') + '\n', 'utf8');

console.log(`clean   ${String(clean_.length).padStart(5)}  → ${out('.clean.csv')}`);
console.log(`pending ${String(pending.length).padStart(5)}  → ${out('.pending.csv')}`);
console.log(`report         → ${out('.report.md')}`);
const blocking = saiAudit.filter((b) => b.gaps.length || b.dups.length);
if (blocking.length) {
  console.log(`\n⛔ สายรหัสไม่ครบใน ${blocking.map((b) => b.label).join(', ')} — อ่าน §2 ของรายงานก่อนนำเข้า`);
}
