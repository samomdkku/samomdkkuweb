// ==============================================
// HOUSE IMPORT / EXPORT — pure, testable, no DOM and no network.
//
// The importer's job is not to load a file. It is to REFUSE a file that would
// put students in the wrong house, at the only moment the damage is still
// visible. See auditSaiWidths() in ./fields.js for the failure this is built
// around: after padding, '1' and '001' are identical, so a mixed-width file has
// to be caught here or not at all.
// ==============================================
import { parseCsv } from '../team/io.js';
import { csvGuard } from '../utils.js';
import {
  normalizeSai, normalizeStudentId, normalizeMajor, normalizeKkumail,
  auditSaiWidths, cleanCell, cleanSpace, houseOf, cohortLabel, studyYearLabel,
  cohortFromStudentId,
} from './fields.js';

/**
 * The seven columns the handover spec asks for, in the DATABASE's vocabulary.
 *
 * ONE VOCABULARY, MANY SPELLINGS. The canonical name of every field is its
 * column name in `students` — which is what the CSV EXPORT writes, so an export
 * can be handed straight back to this importer. The friendly spellings a
 * spreadsheet actually arrives with (`sai`, `nickname_th`, `ชื่อ`, `อีเมล`) are
 * ALIASES resolved at the door. Two vocabularies for one field is the drift
 * class this repo pays for most; aliases are how you accept the world's
 * spelling without keeping a second one of your own.
 */
export const CSV_COLUMNS = [
  'student_id', 'first_name_th', 'last_name_th', 'nickname_imported', 'kkumail', 'major', 'sai_code',
];

/** What to CALL each column when talking to a human — the spec's spelling. */
export const CSV_COLUMN_LABEL = {
  student_id: 'student_id (รหัสนักศึกษา)',
  first_name_th: 'first_name_th (ชื่อ)',
  last_name_th: 'last_name_th (นามสกุล)',
  nickname_imported: 'nickname_th (ชื่อเล่น)',
  kkumail: 'kkumail (อีเมล)',
  major: 'major (สาขา)',
  sai_code: 'sai (สายรหัส)',
};

/**
 * Does this name LOOK like it has a คำนำหน้า glued to the front?
 *
 * REPORTS, NEVER STRIPS — and that reversal is the whole point. An earlier
 * version cut the prefix off, which turns "นายก" into "ก" and "นางาม" into "าม":
 * `นาย` and `นาง` are the openings of real Thai names, not just titles, and
 * nothing downstream could ever tell that the row had been renamed. It is the
 * same mistake as splitting a combined "ชื่อ-สกุล" on the first space, which this
 * importer already refuses to do — a guess about a person's name is not
 * recoverable, so the only safe answer is to keep what was sent and say so.
 *
 * A file where every row starts with นาย is a file to send back, and one line
 * per row is exactly how a human notices that.
 */
const TITLE_PREFIXES = ['นางสาว', 'น.ส.', 'นาง', 'นาย', 'ด.ช.', 'ด.ญ.', 'เด็กชาย', 'เด็กหญิง'];

export function looksTitled(raw) {
  const v = cleanSpace(raw);
  // A SPACE after the prefix is the only halfway-reliable signal ("นาย สมชาย"),
  // but plenty of files write "นายสมชาย" with none — so both are reported, and
  // neither is acted on.
  return TITLE_PREFIXES.find((t) => v.startsWith(t) && cleanSpace(v.slice(t.length))) || null;
}

/** Header aliases, so a file that spells a column slightly differently still
 *  lands rather than silently importing blanks. */
const HEADER_ALIAS = {
  student_id: 'student_id', studentid: 'student_id', sid: 'student_id',
  รหัสนักศึกษา: 'student_id', รหัส: 'student_id',
  first_name_th: 'first_name_th', firstname: 'first_name_th',
  first_name: 'first_name_th', ชื่อ: 'first_name_th', ชื่อจริง: 'first_name_th',
  last_name_th: 'last_name_th', lastname: 'last_name_th',
  last_name: 'last_name_th', นามสกุล: 'last_name_th', สกุล: 'last_name_th',
  nickname_th: 'nickname_imported', nickname: 'nickname_imported',
  nick: 'nickname_imported', ชื่อเล่น: 'nickname_imported',
  nickname_imported: 'nickname_imported',
  kkumail: 'kkumail', email: 'kkumail', mail: 'kkumail', อีเมล: 'kkumail',
  major: 'major', สาขา: 'major',
  sai: 'sai_code', sai_code: 'sai_code', สายรหัส: 'sai_code', สาย: 'sai_code',
  // EVIDENCE COLUMNS, carried to the HELD list and nowhere else (0193).
  //
  // They are prefixed with `_` on purpose: every other alias here names a
  // `students` column, and these two must never become one. `file_kkumail` is
  // an address we have ALREADY decided is not this person's login — writing it
  // to `students.kkumail` is precisely the bug the cleaner blanks it to avoid.
  // The `_` keeps them out of IMPORT_OWNED_COLUMNS by construction rather than
  // by anyone remembering, and `house-io.test.js` pins that.
  //
  // Produced by `tools/clean-house-csv.mjs`, which is the only thing that knows
  // WHY a cell was removed. A file without them imports exactly as before.
  file_kkumail: '_file_kkumail', file_note: '_file_note',
  // Recognised ONLY so the file can be refused with the right sentence. A single
  // "ชื่อ-สกุล" column cannot be split: "สมชาย ณ อยุธยา" and "สมชาย ใจดี ดีมาก"
  // both have three tokens and different answers, and guessing renames a real
  // person. See '_combined_name' handling in parseStudentsCsv.
  full_name: '_combined_name', fullname: '_combined_name',
  name: '_combined_name', 'ชื่อ-สกุล': '_combined_name', 'ชื่อ-นามสกุล': '_combined_name',
  ชื่อสกุล: '_combined_name', ชื่อนามสกุล: '_combined_name',
};

function normHeader(h) {
  const key = cleanSpace(h).toLowerCase().replace(/[\s_-]+/g, '');
  // Try the raw cleaned value first (Thai headers), then the squashed form.
  return HEADER_ALIAS[cleanSpace(h).toLowerCase()] || HEADER_ALIAS[key] || null;
}

/**
 * Parse a students CSV into normalized rows plus everything the preview needs.
 *
 * @returns {{
 *   rows: object[], problems: object[], widthAudit: object,
 *   missingColumns: string[], fatal: string|null
 * }}
 *
 * `fatal` non-null means DO NOT IMPORT — the UI refuses rather than warning.
 * Something is fatal only when proceeding would produce a WRONG result that no
 * later reader could detect:
 *   • the file is not UTF-8 (every Thai name is already destroyed),
 *   • no kkumail column (nothing can be matched to a login),
 *   • no ชื่อ column, or only a COMBINED "ชื่อ-สกุล" one (splitting a Thai name
 *     on whitespace renames people: "สมชาย ณ อยุธยา").
 * Everything else is a per-row problem the human can look at and still proceed.
 *
 * NOTE ON LEADING ZEROS — this used to be fatal and no longer is. Excel strips
 * LEADING zeros only ("017" → 17, "007" → 7); it never touches trailing ones,
 * so left-padding back to three digits is information-preserving, and the house
 * — the LAST digit — is invariant under it. A mixed-width file is therefore
 * recoverable, and refusing it cost a real import for no safety. It is now a
 * prominent warning that says exactly what was padded, because it still means
 * the file went through a spreadsheet and the other columns deserve a look.
 */
export function parseStudentsCsv(text, knownMajors = []) {
  const empty = {
    rows: [], skipped: [], problems: [], widthAudit: null,
    missingColumns: CSV_COLUMNS, presentColumns: [],
  };

  // U+FFFD is what a non-UTF-8 file looks like after FileReader has decoded it
  // as UTF-8. A TIS-620 / Windows-874 export of Thai names arrives ENTIRELY as
  // replacement characters, and every name is already unrecoverable at this
  // point — importing it would write 1,800 rows of "????" that look like data.
  const text0 = String(text || '');
  if (text0.includes('\uFFFD')) {
    // An .xlsx is a ZIP: it starts with the bytes "PK". Reading one as text
    // produces the same replacement characters as a TIS-620 CSV, and the two
    // need completely different advice — so say which one this is.
    return { ...empty,
      fatal: text0.startsWith('PK')
        ? 'ไฟล์นี้เป็น Excel (.xlsx) ไม่ใช่ CSV — เปิดใน Excel แล้วเลือก '
          + '“Save As → CSV UTF-8 (Comma delimited)” ก่อน แล้วค่อยนำเข้าไฟล์ .csv นั้น'
        : 'ไฟล์นี้ไม่ได้บันทึกเป็น UTF-8 ตัวอักษรไทยเสียหายไปแล้วตั้งแต่ในไฟล์ '
          + '— กรุณาขอไฟล์ใหม่ โดยบันทึกจาก Excel เป็น “CSV UTF-8 (Comma delimited)” '
          + 'หรือทำใน Google Sheets แล้วดาวน์โหลดเป็น CSV' };
  }

  const raw = parseCsv(text);
  if (!raw.length) return { ...empty, fatal: 'ไฟล์ว่าง' };

  const header = raw[0].map(normHeader);
  const missingColumns = CSV_COLUMNS.filter((c) => !header.includes(c));
  const problems = [];

  if (!header.includes('kkumail')) {
    return { ...empty, missingColumns,
      fatal: 'ไม่พบคอลัมน์ kkumail — คอลัมน์นี้คือกุญแจที่ใช้จับคู่ตอนนักศึกษาเข้าสู่ระบบ นำเข้าไม่ได้' };
  }

  // A single "ชื่อ-สกุล" column is refused, not split. Thai surnames contain
  // spaces ("ณ อยุธยา") and Thai first names sometimes do too, so whitespace
  // does not mark the boundary — a split would rename real people, silently and
  // irreversibly, and nothing downstream could ever tell.
  //
  // NO name column at all is a DIFFERENT thing and is allowed (0126): the
  // minimum useful file is `kkumail, student_id, sai`, and asking Data Analytics
  // for that instead means 1,800 people's names never leave their department.
  // The student fills their own name in — it is the one field they certainly
  // know. Refusing a combined column while accepting no column looks
  // inconsistent and is not: one would rename people, the other names nobody.
  if (header.includes('_combined_name') && !header.includes('first_name_th')) {
    return { ...empty, missingColumns,
      fatal: 'ไฟล์นี้รวมชื่อกับนามสกุลไว้คอลัมน์เดียว — ระบบแยกให้ไม่ได้ '
        + '(นามสกุลไทยมีเว้นวรรคได้ เช่น “ณ อยุธยา” ถ้าเดาจะได้ชื่อผิดตัว) '
        + 'กรุณาขอไฟล์ที่แยกเป็น first_name_th (ชื่อ) และ last_name_th (นามสกุล) '
        + 'หรือถ้าไม่อยากส่งชื่อเลย ตัดคอลัมน์ชื่อออกทั้งหมดก็ได้ '
        + 'ระบบรับไฟล์ที่มีแค่ kkumail กับสายรหัส' };
  }
  if (!header.includes('first_name_th')) {
    problems.push({ line: 1, level: 'info', field: 'first_name_th',
      message: 'ไฟล์นี้ไม่มีคอลัมน์ชื่อ — นำเข้าได้ ระบบจะเก็บเฉพาะช่องที่มีในไฟล์ '
        + 'และให้นักศึกษากรอกชื่อของตัวเองเมื่อเข้าสู่ระบบ', value: '' });
  }

  // Raw สาย values BEFORE normalisation — the audit is only meaningful on these.
  const saiIdx = header.indexOf('sai_code');
  const rawSais = saiIdx >= 0 ? raw.slice(1).map((cells) => cells[saiIdx] ?? '') : [];
  const widthAudit = auditSaiWidths(rawSais);

  // Columns we did not recognise. Silently ignoring them is how an export gets
  // re-imported and someone believes a self-edited ชื่อเล่น came back with it.
  const unknown = raw[0]
    .filter((h, i) => cleanSpace(h) && !header[i])
    .map((h) => cleanSpace(h));
  if (unknown.length) {
    problems.push({ line: 1, level: 'info', field: '_header',
      message: `คอลัมน์ที่ระบบไม่ได้ใช้ (ข้ามไป): ${unknown.join(', ')}`, value: '' });
  }

  if (saiIdx >= 0 && !widthAudit.consistent) {
    const shape = widthAudit.widths.map((w) => `${w.width} หลัก ${w.count} แถว`).join(' · ');
    // NOT an alarm. Short สาย are explicitly allowed by the spec we send out
    // ("007 ใส่เป็น 7 เฉยๆ ได้"), so the common cause of a mixed-width file is now
    // a sender following instructions — not damage. The message says what was
    // done and why it is safe, and mentions the spreadsheet only as the OTHER
    // possible cause, because that one is worth a second look at the file.
    problems.push({ line: 1, level: 'info', field: 'sai_code',
      message: `สายรหัสในไฟล์ยาวไม่เท่ากัน (${shape}) — ระบบเติมศูนย์ข้างหน้าให้ครบ 3 หลักแล้ว `
        + '(เช่น 7 → 007) บ้านไม่เปลี่ยน เพราะบ้านคิดจากหลักสุดท้าย '
        + 'ถ้าตั้งใจส่งมาแบบสั้น ถือว่าถูกต้อง ไม่ต้องแก้อะไร — '
        + 'แต่ถ้าตั้งใจส่งมาครบ 3 หลัก แปลว่าไฟล์ผ่านโปรแกรมตารางแล้วโดนตัดเลข 0 '
        + 'ควรตรวจคอลัมน์อื่นด้วย', value: '' });
  }

  const seenMail = new Map();
  const seenSid = new Map();
  const dupSids = new Set();
  const rows = [];
  // Lines that will NOT be imported, kept with enough of their content to be
  // shown. The preview used to report skips only as a count and a sentence in a
  // collapsed list, so "3 ข้าม" out of 1,800 was a number with no way to find
  // out WHO — and a skipped row is the one case where a human definitely has to
  // look, because that person simply will not exist in the system afterwards.
  const skipped = [];
  // `code` is structural and `reason` is the sentence shown to a human. They are
  // separate because toUnresolvedRow() used to recover the code by testing the
  // SENTENCE for "ซ้ำ" — so rewording a message, which nobody would think of as a
  // behaviour change, silently filed every duplicate address under the wrong
  // reason in the held list. Matching one spelling is how a guard goes blind.
  const skip = (lineNo, cells, reason, code) => {
    const o = {};
    header.forEach((key, i) => { if (key) o[key] = cells[i] ?? ''; });
    skipped.push({
      _line: lineNo,
      _skip: reason,
      _skipCode: code,
      kkumail: cleanSpace(o.kkumail),
      student_id: cleanSpace(o.student_id),
      first_name_th: cleanCell(o.first_name_th),
      last_name_th: cleanCell(o.last_name_th),
      nickname_imported: cleanCell(o.nickname_imported),
      major: cleanCell(o.major),
      sai_code: cleanSpace(o.sai_code),
      // What the file said before the cleaner touched it (0193). Present only
      // on a SKIPPED row — an imported row's evidence is the row itself.
      _file_kkumail: cleanSpace(o._file_kkumail),
      _file_note: cleanCell(o._file_note),
      _house: null,
    });
  };

  raw.slice(1).forEach((cells, idx) => {
    const lineNo = idx + 2;                     // 1-based, including the header
    const o = {};
    header.forEach((key, i) => { if (key) o[key] = cells[i] ?? ''; });

    const mail = normalizeKkumail(o.kkumail);
    const first = cleanCell(o.first_name_th);
    const last = cleanCell(o.last_name_th);
    const titled = first ? looksTitled(first) : null;
    if (titled) {
      problems.push({ line: lineNo, level: 'warn', field: 'first_name_th',
        message: `บรรทัด ${lineNo}: ชื่อ “${first}” ดูเหมือนมีคำนำหน้า “${titled}” ติดมา `
          + '— เก็บไว้ตามเดิม ไม่ได้ตัดออกให้ (บางคนมีคำนี้อยู่ในชื่อจริง) '
          + 'ถ้าทั้งไฟล์เป็นแบบนี้ ควรขอไฟล์ใหม่ที่ไม่มีคำนำหน้า',
        value: first });
    }

    // A row with no address cannot be matched to a login and cannot be upserted
    // (kkumail is NOT NULL + the unique key). Skip it, loudly.
    if (!mail.ok) {
      problems.push({ line: lineNo, level: 'skip', field: 'kkumail',
        message: `บรรทัด ${lineNo}: ${mail.reason} — ข้ามแถวนี้`, value: cleanSpace(o.kkumail) });
      skip(lineNo, cells, mail.reason, 'no_kkumail');
      return;
    }
    // A blank name no longer skips the row. `first_name_th` is nullable (0126)
    // and kkumail is what the row is FOR — dropping somebody entirely because
    // one cell is empty loses their สายรหัส and their house too. Only worth
    // saying when the file HAS the column and this row is the exception.
    if (!first && header.includes('first_name_th')) {
      problems.push({ line: lineNo, level: 'warn', field: 'first_name_th',
        message: `บรรทัด ${lineNo}: ไม่มีชื่อจริง — นำเข้าให้ แต่ชื่อจะว่างไว้`, value: '' });
    }

    if (seenMail.has(mail.value)) {
      problems.push({ line: lineNo, level: 'skip', field: 'kkumail',
        message: `บรรทัด ${lineNo}: อีเมล ${mail.value} ซ้ำกับบรรทัด ${seenMail.get(mail.value)} — ข้ามแถวนี้`,
        value: mail.value });
      skip(lineNo, cells, `อีเมลซ้ำกับบรรทัด ${seenMail.get(mail.value)}`, 'duplicate_kkumail');
      return;
    }
    // A valid address at the WRONG domain imports fine and then never matches a
    // login — students sign in with kkumail, and get_my_student_record() joins
    // on it. Warn rather than skip: the row is still worth having, and only a
    // human knows whether the address is a typo or a genuine exception.
    if (!mail.value.endsWith('@kkumail.com')) {
      problems.push({ line: lineNo, level: 'warn', field: 'kkumail',
        message: `บรรทัด ${lineNo}: ${mail.value} ไม่ใช่ @kkumail.com — `
          + 'นักศึกษาจะเข้าสู่ระบบแล้วไม่เจอข้อมูลตัวเอง', value: mail.value });
    }
    seenMail.set(mail.value, lineNo);

    const sid = normalizeStudentId(o.student_id);
    if (!sid.ok && sid.value) {
      problems.push({ line: lineNo, level: 'warn', field: 'student_id',
        message: `บรรทัด ${lineNo}: รหัสนักศึกษา “${sid.value}” ไม่ตรงรูปแบบ (เก็บไว้ตามเดิม)`,
        value: sid.value });
    }
    if (sid.value && seenSid.has(sid.value)) {
      // Recorded here, ACTED ON after the loop — see the dedupe pass below.
      // Warning was all this used to do, and a warning was the wrong shape:
      // `students_sid_uniq` is a UNIQUE index, so the second row does not warn
      // at the database, it raises 23505 and takes its whole 200-row chunk with
      // it, partway through an import that has already written the chunks before
      // it. Measured on samo-dev.
      dupSids.add(sid.value);
    } else if (sid.value) seenSid.set(sid.value, lineNo);

    const sai = normalizeSai(o.sai_code);
    if (!sai.ok) {
      // An all-zero value is its own diagnosis: the cell was blank and a
      // spreadsheet filled it in. Saying that is worth more than "อ่านไม่ออก",
      // because the fix is at the source and nobody would guess it.
      const allZero = /^0+$/.test(String(sai.raw ?? '').trim());
      problems.push({ line: lineNo, level: 'warn', field: 'sai_code',
        message: allZero
          ? `บรรทัด ${lineNo}: สายรหัส “${sai.raw}” ไม่ใช่สายที่มีอยู่จริง (สายเริ่มที่ 001) `
            + '— น่าจะเป็นช่องว่างที่โปรแกรมตารางเติมเลข 0 ให้ จะเว้นว่างไว้'
          : `บรรทัด ${lineNo}: สายรหัส “${sai.raw}” อ่านไม่ออก — จะเว้นว่างไว้`,
        value: sai.raw });
    }
    const major = normalizeMajor(o.major, knownMajors);
    if (!major.ok && major.value) {
      problems.push({ line: lineNo, level: 'warn', field: 'major',
        message: `บรรทัด ${lineNo}: สาขา “${major.value}” ไม่อยู่ในรายการ (เก็บไว้ตามเดิม)`,
        value: major.value });
    }

    rows.push({
      _line: lineNo,
      kkumail: mail.value,
      student_id: sid.value,
      first_name_th: first,
      last_name_th: last,
      // NOTE: nickname_IMPORTED, never nickname_self. The student owns the other
      // column and an import must not be able to overwrite what they typed.
      nickname_imported: cleanCell(o.nickname_imported),
      major: major.value,
      sai_code: sai.ok ? sai.value : null,
      _house: sai.ok ? houseOf(sai.value) : null,
    });
  });

  // ── two people, one รหัสนักศึกษา ──────────────────────────────────────────
  //
  // The รหัส is cleared on EVERY row that shares it, and nobody is dropped.
  //
  // WHY NOT KEEP THE FIRST. That is what the duplicate-kkumail rule does, and it
  // is wrong here for the opposite reason: a duplicate address means the two
  // rows cannot both exist, so one has to go; a duplicate รหัส means one of them
  // is a typo, and line order cannot say which. Keeping the earlier row awards a
  // real student's number to whoever the spreadsheet happened to sort first —
  // and รุ่น is derived from it, so the loser silently changes cohort.
  //
  // WHY CLEARING IS SAFE, AND BETTER THAN REFUSING. `student_id` is nullable
  // (0126) and is one of the fields a student may edit for themselves (0125),
  // with `students_sid_uniq` arbitrating — so both people import, both see their
  // บ้าน, and either can put their own number back without an admin. The only
  // thing lost until they do is their รุ่น, which is derived. Refusing the file
  // instead would hold 1,600 people for one typo.
  if (dupSids.size) {
    for (const row of rows) {
      if (!row.student_id || !dupSids.has(row.student_id)) continue;
      problems.push({ line: row._line, level: 'warn', field: 'student_id',
        message: `บรรทัด ${row._line}: รหัสนักศึกษา ${row.student_id} มีมากกว่าหนึ่งคนในไฟล์นี้ `
          + '— เว้นว่างไว้ทั้งคู่ เพราะเดาไม่ได้ว่าเป็นของใคร '
          + 'นำเข้าได้ตามปกติ เจ้าตัวแก้รหัสของตัวเองทีหลังได้ '
          + '(รุ่นจะยังว่างจนกว่าจะแก้)',
        value: row.student_id });
      row.student_id = null;
    }
  }

  // Which import-owned columns this file actually carried. Everything
  // downstream (the diff, the upsert payload) is scoped to it.
  const presentColumns = IMPORT_OWNED_COLUMNS.filter((c) => header.includes(c));

  return { rows, skipped, problems, widthAudit, missingColumns, presentColumns, fatal: null };
}

/** The columns an upsert is allowed to write. Everything a STUDENT owns is
 *  deliberately absent — this list is the mechanism behind "a re-import can
 *  never destroy a self-edit". Pinned by house-io.test.js. */
export const IMPORT_OWNED_COLUMNS = [
  'kkumail', 'student_id', 'first_name_th', 'last_name_th',
  'nickname_imported', 'major', 'sai_code',
];

/**
 * Strip a parsed row down to the import-owned columns THIS FILE ACTUALLY HAD.
 *
 * `present` is why this takes a third argument. The upsert writes every key in
 * the payload, so including a column the file did not contain wrote NULL over
 * it for everyone in the file: a corrected name-list that happened to omit the
 * `sai` column would have silently cleared ~1,800 สายรหัส — and with them every
 * house placement — while the preview cheerfully said "แก้ไข 1,800". An import
 * must never destroy a field it was not given.
 *
 * Omitting the key is enough: PostgREST's `merge-duplicates` builds its
 * `ON CONFLICT DO UPDATE SET` from the keys present in the body, so an absent
 * column keeps whatever the row already has. All rows in one import share the
 * same key set (`present` is file-level), which PostgREST also requires.
 *
 * A column that IS in the file but empty on a row still writes NULL — that is a
 * real "this person has no ชื่อเล่น any more", not a gap in the file.
 */
export function toUpsertRow(row, batchId, present = IMPORT_OWNED_COLUMNS) {
  const out = {};
  for (const c of IMPORT_OWNED_COLUMNS) {
    // kkumail is the conflict target and must always be sent.
    if (c === 'kkumail' || present.includes(c)) out[c] = row[c] ?? null;
  }
  out.last_import_batch = batchId || null;
  out.missing_since = null;      // present in this file ⇒ not missing
  return out;
}

/**
 * Compare parsed rows against what is already stored.
 * Returns counts + the per-row verdict, so the preview can say
 * "จะเพิ่ม N · แก้ไข M · ไม่เปลี่ยน K" BEFORE anything is written.
 */
const pick = (row, cols) => {
  const out = {};
  for (const c of cols) out[c] = row[c] ?? null;
  return out;
};

export function diffAgainstExisting(rows, existing, present = IMPORT_OWNED_COLUMNS, skipped = []) {
  const byMail = new Map(
    (existing || []).map((s) => [String(s.kkumail || '').toLowerCase(), s]));
  let insert = 0, update = 0, same = 0;
  // Only the columns the file carries — the same set toUpsertRow will write.
  // Diffing a column the import will not touch reports a change that will not
  // happen, which is how a preview stops being evidence.
  const compared = IMPORT_OWNED_COLUMNS.filter((c) => present.includes(c));
  const verdicts = rows.map((r) => {
    const cur = byMail.get(r.kkumail);
    if (!cur) { insert += 1; return { ...r, _verdict: 'insert' }; }
    const differs = compared.filter((c) => {
      const a = r[c] ?? null;
      const b = cur[c] ?? null;
      return String(a ?? '') !== String(b ?? '');
    });
    // COLUMNS THIS PERSON HAS TAKEN OVER (0125). The table refuses to let an
    // import overwrite them and records the disagreement instead (0138), so a
    // preview that counted them as "จะแก้ไข" would be promising a change that
    // will not happen — and the row might then show as unchanged afterwards,
    // which reads as the import having failed. They are reported as their own
    // thing: kept, and about to become a question for the person.
    const owned = new Set(Array.isArray(cur.self_edited) ? cur.self_edited : []);
    const kept = differs.filter((c) => owned.has(c));
    const changed = differs.filter((c) => !owned.has(c));
    if (!changed.length && !kept.length) {
      same += 1;
      return { ...r, _verdict: 'same', _id: cur.id };
    }
    if (!changed.length) {
      // Everything this file would have changed is owned by the student. The
      // row is not an update; it is a conflict waiting to be asked.
      same += 1;
      return { ...r, _verdict: 'same', _id: cur.id, _kept: kept, _keptBefore: pick(cur, kept) };
    }
    update += 1;
    // The stored values of exactly the columns that will change. The preview
    // said "จะแก้ไข 412" and stopped there, which is a number you can only
    // either trust or not — showing ของเดิม → ของใหม่ per row is what makes it
    // checkable before anything is written.
    const before = {};
    for (const c of changed) before[c] = cur[c] ?? null;
    return {
      ...r, _verdict: 'update', _changed: changed, _before: before, _id: cur.id,
      ...(kept.length ? { _kept: kept, _keptBefore: pick(cur, kept) } : {}),
    };
  });
  // Rows in the DB that this file does NOT mention. Reported, never deleted.
  // Rows in the DB that this file does NOT mention — but "mention" is about the
  // PERSON, not about the address.
  //
  // THE LEAK. A student who self-claimed a held seat (0188) is in the table
  // under the address they signed in with, and the handover file still does not
  // have that address — it never did, which is why their row was held. Matching
  // on kkumail alone therefore stamps `missing_since` on exactly the people the
  // claim flow just repaired, every import, for ever: they would be flagged as
  // "ไม่พบในไฟล์ล่าสุด" in the admin pane for the rest of the system's life, and
  // the flag would be RIGHT about the address and WRONG about the person.
  //
  // So a รหัสนักศึกษา in the file counts as a mention, and the SKIPPED lines
  // count too. That is the whole point: a skipped line is a person the file
  // named and could not address, which is the opposite of a person the file
  // omitted.
  const fileMails = new Set(rows.map((r) => r.kkumail));
  const sidKey = (v) => String(v ?? '').replace(/\D/g, '') || null;
  const fileSids = new Set(
    [...rows, ...(skipped || [])].map((r) => sidKey(r.student_id)).filter(Boolean));
  const missing = (existing || []).filter(
    (s) => !fileMails.has(String(s.kkumail || '').toLowerCase())
        && !fileSids.has(sidKey(s.student_id)));
  // How many rows carry a value the import will NOT be allowed to write. This
  // is the number the person running the import actually needs before pressing
  // the button: it is how many people are about to be asked a question, and if
  // it is unexpectedly large the file is probably wrong rather than 400 students
  // being wrong.
  const kept = verdicts.filter((v) => (v._kept || []).length).length;
  return { verdicts, insert, update, same, missing, kept };
}

/**
 * Every line of the file, in file order, with its verdict and its problems.
 *
 * REQUESTED: "when import csv, it should show preview of what information it'll
 * be import like i can scroll through what it'll be import. and show who that is
 * duplicate, error prone, detect edge case etc".
 *
 * The preview it replaces was four counters and a collapsed list of sentences.
 * Both halves of that were unusable for the actual job: the counters say 412
 * rows will change without saying which, and the problem list is ordered by
 * SEVERITY, so "บรรทัด 1408" in it cannot be matched up with the person on line
 * 1408 without counting. This puts the finding on the row it is about.
 *
 * SKIPPED LINES ARE INCLUDED, and that is the point of `result.skipped`. A row
 * dropped for a bad or duplicate address is the one row a human must look at —
 * that person will simply not be in the system afterwards — and it was the only
 * row the old preview could not show at all.
 *
 * Pure: takes what parse + diff already produced, returns rows. No DOM.
 */
export function buildPreviewRows(result, diff) {
  const byLine = new Map();
  for (const p of result.problems || []) {
    if (p.line === 1) continue;                // file-level; shown above the fold
    if (!byLine.has(p.line)) byLine.set(p.line, []);
    byLine.get(p.line).push(p);
  }
  const all = [
    ...(diff?.verdicts || result.rows || []),
    ...(result.skipped || []).map((r) => ({ ...r, _verdict: 'skip' })),
  ];
  return all
    .map((r) => ({ ...r, _problems: byLine.get(r._line) || [] }))
    .sort((a, b) => a._line - b._line);
}

/** The columns the preview table shows, in the order it shows them. Import-owned
 *  only — a preview that displayed a column the import cannot write would be
 *  promising something it does not do. */
export const PREVIEW_COLUMNS = [
  'kkumail', 'student_id', 'first_name_th', 'last_name_th',
  'nickname_imported', 'major', 'sai_code',
];

export const PREVIEW_COLUMN_LABEL = {
  kkumail: 'kkumail',
  student_id: 'รหัสนักศึกษา',
  first_name_th: 'ชื่อ',
  last_name_th: 'นามสกุล',
  nickname_imported: 'ชื่อเล่น',
  major: 'สาขา',
  sai_code: 'สาย',
};

const csvCell = (v) => {
  const s = csvGuard(v);   // utils.js — a student-typed "=…" must not run as a formula
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/**
 * Admin export — WHAT THE SYSTEM HOLDS, as the person reading the file sees it.
 *
 * REPORTED: "i don't understand why when i export csv, there's
 * nickname_imported nickname_self, it should show the information that the
 * current system holds, what the user see. i don't know why there're
 * cohort_year, year_override, shouldn't that not exist because we change to use
 * รุ่น like MD50, and why are there is_listed, why are there sai_locked,
 * verified_at shouldn't that be gone".
 *
 * All of it correct. Five of those columns were dead — the leftovers of ชั้นปี,
 * the roster, the สายรหัส self-edit and ยืนยันข้อมูล — and migration 0129 has
 * now dropped them from the table. The other two were an implementation detail
 * of ONE field leaking into a file meant for a human.
 *
 * ⚠️ THIS IS STILL A BACKUP, and the old warning stands: a column left OUT here
 * is silently destroyed on the next export→re-import round trip, whereas a
 * column left out of a public projection is merely unpublished. Adding a real
 * column to `students`? Add it here too. What changed is that the list is now
 * the columns that EXIST and MEAN something, which is a much easier list to
 * keep true than "everything, in case".
 *
 * THE NICKNAME, and a reversal. `nickname` is generated as
 * `coalesce(nickname_self, nickname_imported)`, and the importer reads a
 * `nickname` header as the IMPORTED one — so exporting the effective value and
 * re-importing writes it into the import slot. That was previously the reason
 * to export BOTH columns instead. It is the wrong trade: the round trip changes
 * nothing anyone can see (nickname_self still wins wherever it is set, so the
 * displayed nickname is identical before and after), and the price of avoiding
 * it was two columns on every row of a file whose whole purpose is to be read
 * by a person. What is lost is the original imported string on a row where the
 * student has overridden it — a value no screen in this app displays.
 *
 * TWO DERIVED COLUMNS, deliberately. `house` (the last digit of สาย) and
 * `cohort` (MD50, from the รหัส) are computed, not stored, and the importer has
 * no alias for either — so they round-trip as ignored columns and cost nothing,
 * while sparing a human the arithmetic. `cohort` is the answer to "why is
 * cohort_year in here": ปีที่เข้า 2565 is not what anybody calls it.
 */
export const EXPORT_COLUMNS = [
  'kkumail', 'student_id', 'first_name_th', 'last_name_th',
  'nickname', 'major', 'sai_code', 'house', 'cohort', 'study_year',
  'year_offset',
];

/** Values the export computes rather than reads. Kept beside the column list
 *  so the two cannot disagree about which names are derived. */
const EXPORT_DERIVED = {
  house: (r) => houseOf(r.sai_code) ?? '',
  cohort: (r) => cohortLabel(r) ?? '',
  // ชั้นปี as of the moment the file is written — a snapshot, like `house`.
  // `year_offset` travels beside it as the DURABLE half: the label is what a
  // human reads, the offset is what would have to be restored. The importer has
  // no alias for either, so both round-trip as ignored columns and a re-import
  // cannot clear the offset it did not carry.
  study_year: (r) => studyYearLabel(r) ?? '',
  // The effective nickname, in case the caller passed rows that carry only the
  // two source columns (the generated one is normally present).
  nickname: (r) => r.nickname
    ?? (String(r.nickname_self ?? '').trim() || r.nickname_imported || ''),
};

export function buildStudentsCsv(rows) {
  const lines = [EXPORT_COLUMNS.join(',')];
  for (const r of rows) {
    lines.push(EXPORT_COLUMNS.map((c) => csvCell(
      EXPORT_DERIVED[c] ? EXPORT_DERIVED[c](r) : r[c],
    )).join(','));
  }
  return lines.join('\r\n');
}

/**
 * The lines this file NAMED but could not address, shaped for 0188's
 * `record_unresolved_rows`.
 *
 * WHY THESE ROWS ARE KEPT AT ALL. `students.kkumail` is NOT NULL and is the
 * upsert's conflict target, so a line without an address cannot become a
 * student — the parser skips it, correctly. Skipping is where it used to end:
 * 165 people's ชื่อ, รหัสนักศึกษา and สายรหัส, sent to us by the faculty,
 * listed in a preview pane and then gone when the tab closed. The line is
 * evidence, and it is the only evidence that a seat exists at all.
 *
 * NOTHING HERE IS INVENTED. `cohort_year` is derived from the รหัสนักศึกษา
 * through the SAME function the database uses, and is simply absent when there
 * is no รหัส to derive it from — the alternative, reading the รุ่น off the
 * block heading the row happens to sit under, would put a guess in a column a
 * later reader cannot tell apart from a fact.
 *
 * A row with an unreadable สาย carries `sai_code: null` rather than its raw
 * text: the column has a foreign key to `sais`, and inventing a สาย is how a
 * real student ends up in the wrong บ้าน.
 */
export function toUnresolvedRow(row) {
  const sid = normalizeStudentId(row.student_id);
  const sai = normalizeSai(row.sai_code);
  // The parser's own code decides, never its message. The two shapes it cannot
  // know apart — a row with nobody on it, and a person with no รหัส — are
  // resolved here from the row's CONTENT, which is where that distinction lives.
  const reason = row._skipCode === 'duplicate_kkumail'
    ? 'duplicate_kkumail'
    : (!sid.value && !cleanCell(row.first_name_th))
      ? 'empty_row'
      : sid.value ? 'no_kkumail' : 'no_kkumail_no_student_id';
  return {
    source_line: row._line ?? null,
    student_id: sid.value || null,
    first_name_th: cleanCell(row.first_name_th) || null,
    last_name_th: cleanCell(row.last_name_th) || null,
    nickname_imported: cleanCell(row.nickname_imported) || null,
    major: cleanCell(row.major) || null,
    sai_code: sai.ok ? sai.value : null,
    cohort_year: sid.value ? (cohortFromStudentId(sid.value) ?? null) : null,
    // Evidence, passed through untouched (0193). `cohort_year` above stays
    // DERIVED-or-null; a รุ่น the file stated as a block heading travels in
    // `file_note` instead, where a reader can see it is a quotation.
    file_kkumail: cleanSpace(row._file_kkumail) || null,
    file_note: cleanCell(row._file_note) || null,
    reason,
  };
}


/**
 * Every สาย this import must seed before it writes anything.
 *
 * IT IS A FUNCTION, not an expression at the call site, and that is the whole
 * point. `students.sai_code` and `student_import_unresolved.sai_code` BOTH carry
 * a foreign key to `sais`, and สาย are not a seeded range — they come from the
 * file. The first version of runImport passed `result.rows` only, so a สาย whose
 * only member in the file has no kkumail was never created and the held-row
 * insert died with 23503 at the END of the import, after every student row was
 * already written.
 *
 * The first guard written for that bug asserted the UNION and stayed green while
 * the call site was reverted to one list — it was checking a union the test
 * built, not the one the importer passes. A rule that lives in an expression at
 * a call site cannot be tested; moving it here is what makes the assertion below
 * mean something.
 */
export function saiCodesToSeed(rows = [], heldRows = []) {
  return [...new Set(
    [...rows, ...heldRows].map((r) => r?.sai_code).filter(Boolean))];
}
