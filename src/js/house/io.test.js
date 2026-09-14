import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  parseStudentsCsv, diffAgainstExisting, toUpsertRow, toUnresolvedRow, saiCodesToSeed,
  buildStudentsCsv,
  buildPreviewRows, PREVIEW_COLUMNS,
  IMPORT_OWNED_COLUMNS, EXPORT_COLUMNS, CSV_COLUMNS,
} from './io.js';

const HEAD = 'student_id,first_name_th,last_name_th,nickname_th,kkumail,major,sai';
const good = [
  HEAD,
  '659999999-9,มานี,ใจดี,นก,manee.j@kkumail.com,MD,017',
  '669999998-8,ปิติ,รักเรียน,ต้น,piti.r@kkumail.com,MD,003',
  '689999996-6,วีระ,ตั้งใจ,,weera.t@kkumail.com,MD,001',
].join('\n');

describe('parseStudentsCsv — the happy file', () => {
  it('parses every row and normalises สาย to three digits', () => {
    const r = parseStudentsCsv(good, ['MD', 'MDI', 'RT']);
    expect(r.fatal).toBeNull();
    expect(r.rows).toHaveLength(3);
    expect(r.rows.map((x) => x.sai_code)).toEqual(['017', '003', '001']);
    expect(r.rows[0].kkumail).toBe('manee.j@kkumail.com');
  });

  it('computes the house for the preview', () => {
    const r = parseStudentsCsv(good, ['MD']);
    expect(r.rows.map((x) => x._house)).toEqual([7, 3, 1]);
  });

  it('puts the nickname in nickname_IMPORTED, never nickname_self', () => {
    const r = parseStudentsCsv(good, ['MD']);
    expect(r.rows[0].nickname_imported).toBe('นก');
    expect(r.rows[0].nickname_self).toBeUndefined();
  });

  it('leaves a blank nickname blank rather than storing a dash', () => {
    const r = parseStudentsCsv(good, ['MD']);
    expect(r.rows[2].nickname_imported).toBeNull();
  });

  it('turns a "-" placeholder into null', () => {
    const t = [HEAD, '659999999-9,ก,ข,-,a@kkumail.com,MD,001'].join('\n');
    expect(parseStudentsCsv(t, ['MD']).rows[0].nickname_imported).toBeNull();
  });
});

describe('parseStudentsCsv — REFUSES the files that corrupt silently', () => {
  it('RECOVERS a mixed-width สาย file, loudly — the house is the last digit', () => {
    // Excel strips LEADING zeros only, so left-padding is information-preserving
    // and the house (last digit) is invariant under it. This was fatal once; it
    // refused real files to protect against a corruption that padding undoes.
    const mixed = [
      HEAD,
      '659999999-9,ก,ข,,a@kkumail.com,MD,17',    // was 017
      '669999998-8,ค,ง,,b@kkumail.com,MD,003',
    ].join('\n');
    const r = parseStudentsCsv(mixed, ['MD']);
    expect(r.fatal).toBeNull();
    expect(r.rows.map((x) => x.sai_code)).toEqual(['017', '003']);
    expect(r.rows.map((x) => x._house)).toEqual([7, 3]);
    // …and still says what it did, as INFO not a warning: short สาย are
    // explicitly allowed by the spec we send out, so the common cause of a
    // mixed-width file is a sender following instructions, not damage.
    const note = r.problems.find((p) => /ยาวไม่เท่ากัน/.test(p.message));
    expect(note.level).toBe('info');
    expect(note.message).toMatch(/ถ้าตั้งใจส่งมาแบบสั้น ถือว่าถูกต้อง/);
  });

  it('refuses a file that is not UTF-8 — the Thai names are already gone', () => {
    const mojibake = [HEAD, '659999999-9,\uFFFD\uFFFD,\uFFFD,,a@kkumail.com,MD,001'].join('\n');
    const r = parseStudentsCsv(mojibake, ['MD']);
    expect(r.fatal).toMatch(/UTF-8/);
    expect(r.rows).toHaveLength(0);
  });

  it('refuses a file whose name is ONE combined column — a split renames people', () => {
    const combined = ['full_name,kkumail,major,sai',
      'สมชาย ณ อยุธยา,a@kkumail.com,MD,001'].join('\n');
    const r = parseStudentsCsv(combined, ['MD']);
    expect(r.fatal).toMatch(/รวมชื่อกับนามสกุล/);
    expect(r.rows).toHaveLength(0);
  });

  it('ACCEPTS a consistently 2-digit file — the width just has to be uniform', () => {
    const two = [
      HEAD,
      '659999999-9,ก,ข,,a@kkumail.com,MD,17',
      '669999998-8,ค,ง,,b@kkumail.com,MD,03',
    ].join('\n');
    const r = parseStudentsCsv(two, ['MD']);
    expect(r.fatal).toBeNull();
    expect(r.rows.map((x) => x.sai_code)).toEqual(['017', '003']);
  });

  it('refuses a file with no kkumail column at all', () => {
    const noMail = ['student_id,first_name_th,sai', '659999999-9,ก,001'].join('\n');
    const r = parseStudentsCsv(noMail, []);
    expect(r.fatal).toMatch(/kkumail/);
  });

  it('refuses an empty file', () => {
    expect(parseStudentsCsv('', []).fatal).toBeTruthy();
  });
});

describe('parseStudentsCsv — per-row problems', () => {
  it('skips a row with an unusable email and says which line', () => {
    const t = [HEAD, '659999999-9,ก,ข,,not-an-email,MD,001'].join('\n');
    const r = parseStudentsCsv(t, ['MD']);
    expect(r.rows).toHaveLength(0);
    expect(r.problems[0].level).toBe('skip');
    expect(r.problems[0].message).toMatch(/บรรทัด 2/);
  });

  it('skips a duplicate email and names the first line it saw', () => {
    const t = [HEAD,
      '659999999-9,ก,ข,,a@kkumail.com,MD,001',
      '669999998-8,ค,ง,,a@kkumail.com,MD,002'].join('\n');
    const r = parseStudentsCsv(t, ['MD']);
    expect(r.rows).toHaveLength(1);
    expect(r.problems.some((p) => /ซ้ำกับบรรทัด 2/.test(p.message))).toBe(true);
  });

  it('WARNS but keeps a row whose สาขา is unknown — never blanks it', () => {
    const t = [HEAD, '659999999-9,ก,ข,,a@kkumail.com,ZZ,001'].join('\n');
    const r = parseStudentsCsv(t, ['MD']);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].major).toBe('ZZ');
    expect(r.problems.some((p) => p.field === 'major' && p.level === 'warn')).toBe(true);
  });

  it('accepts Thai and aliased headers', () => {
    const t = ['รหัสนักศึกษา,ชื่อ,นามสกุล,ชื่อเล่น,อีเมล,สาขา,สายรหัส',
      '659999999-9,ก,ข,ค,a@kkumail.com,MD,001'].join('\n');
    const r = parseStudentsCsv(t, ['MD']);
    expect(r.fatal).toBeNull();
    expect(r.rows[0].sai_code).toBe('001');
  });
});

describe('the import/self-edit boundary', () => {
  it('IMPORT_OWNED_COLUMNS contains nothing the student owns', () => {
    for (const forbidden of ['nickname_self', 'photo_url', 'bio', 'year_override',
      'is_listed', 'verified_at', 'sai_locked', 'status']) {
      expect(IMPORT_OWNED_COLUMNS).not.toContain(forbidden);
    }
  });

  it('toUpsertRow emits ONLY import-owned columns plus bookkeeping', () => {
    const row = {
      kkumail: 'a@kkumail.com', first_name_th: 'ก', sai_code: '001',
      nickname_self: 'ห้ามเขียน', photo_url: 'ห้ามเขียน', _line: 2, _house: 1,
    };
    const out = toUpsertRow(row, 'batch-1');
    expect(out.nickname_self).toBeUndefined();
    expect(out.photo_url).toBeUndefined();
    expect(out._line).toBeUndefined();
    expect(Object.keys(out).sort()).toEqual(
      [...IMPORT_OWNED_COLUMNS, 'last_import_batch', 'missing_since'].sort());
  });
});

describe('diffAgainstExisting — the preview must be right before anything writes', () => {
  const parsed = parseStudentsCsv(good, ['MD']).rows;

  it('counts everything as an insert against an empty database', () => {
    const d = diffAgainstExisting(parsed, []);
    expect(d).toMatchObject({ insert: 3, update: 0, same: 0 });
  });

  it('detects an unchanged row as "same", not as an update', () => {
    const existing = parsed.map((r) => ({ ...r }));
    const d = diffAgainstExisting(parsed, existing);
    expect(d.same).toBe(3);
    expect(d.update).toBe(0);
  });

  it('names which columns changed', () => {
    const existing = parsed.map((r) => ({ ...r }));
    existing[0].sai_code = '099';
    const d = diffAgainstExisting(parsed, existing);
    expect(d.update).toBe(1);
    expect(d.verdicts[0]._changed).toContain('sai_code');
  });

  it('reports rows absent from the file as MISSING — never as a delete', () => {
    const existing = [...parsed.map((r) => ({ ...r })),
      { kkumail: 'ghost@kkumail.com', first_name_th: 'ผี' }];
    const d = diffAgainstExisting(parsed, existing);
    expect(d.missing).toHaveLength(1);
    expect(d.missing[0].kkumail).toBe('ghost@kkumail.com');
  });

  it('matches case-insensitively on kkumail', () => {
    const existing = parsed.map((r) => ({ ...r, kkumail: r.kkumail.toUpperCase() }));
    expect(diffAgainstExisting(parsed, existing).insert).toBe(0);
  });
});

describe('export is a BACKUP allow-list', () => {
  // The name-for-name version of the round-trip guard lived here. It has been
  // replaced by "loses no import-owned column on an export → import round trip"
  // below, which asks the PARSER which columns a header reaches instead of
  // asserting the two lists are spelled the same — the version that could only
  // ever be right while every column happened to share one name.

  it('includes the derived house so a human reading the file can see it', () => {
    const csv = buildStudentsCsv([{ kkumail: 'a@kkumail.com', sai_code: '017' }]);
    const [head, row] = csv.split('\r\n');
    expect(head.split(',')).toEqual(EXPORT_COLUMNS);
    expect(row.split(',')[EXPORT_COLUMNS.indexOf('house')]).toBe('7');
  });

  it('quotes a value containing a comma', () => {
    const csv = buildStudentsCsv([{ kkumail: 'a@kkumail.com', first_name_th: 'ก,ข' }]);
    expect(csv).toContain('"ก,ข"');
  });

  it('names its columns the way the TABLE does, so an export re-imports', () => {
    // One vocabulary — the schema's. The spec's friendlier spellings (`sai`,
    // `nickname_th`, ชื่อ, อีเมล) are aliases resolved at the door.
    expect(CSV_COLUMNS).toEqual([
      'student_id', 'first_name_th', 'last_name_th', 'nickname_imported',
      'kkumail', 'major', 'sai_code']);
  });

  it('loses no import-owned column on an export → import round trip', () => {
    // THE REAL INVARIANT, and it is not "the two lists are equal". The export is
    // a BACKUP: a column it omits is destroyed the next time the file is handed
    // back. What matters is that every import-owned column is REACHABLE from the
    // exported header — by its own name, or through an alias the importer
    // resolves. `nickname` is the case that forced this to be checked properly
    // rather than by eye: the export writes the effective nickname, and the
    // importer resolves that header to `nickname_imported`.
    //
    // Asked of the IMPORTER, not of a hand-written list of aliases — two
    // implementations of one rule drift, and the parser is the authority.
    const parsed = parseStudentsCsv(`${EXPORT_COLUMNS.join(',')}\n`, ['MD']);
    const reachable = new Set(parsed.presentColumns);
    for (const c of IMPORT_OWNED_COLUMNS) expect([...reachable]).toContain(c);
  });

  it('exports the nickname a person actually has, not the two it is built from', () => {
    // REPORTED: "i don't understand why when i export csv, there's
    // nickname_imported nickname_self, it should show the information that the
    // current system holds, what the user see." The pair is how the database
    // keeps an import from overwriting what a student typed; it is not
    // information about the student, and it does not belong in a file a human
    // reads. nickname_self still wins on every screen, so the round trip that
    // folds it into the import slot changes nothing anybody can see.
    expect(EXPORT_COLUMNS).toContain('nickname');
    expect(EXPORT_COLUMNS).not.toContain('nickname_self');
    expect(EXPORT_COLUMNS).not.toContain('nickname_imported');
    const csv = buildStudentsCsv([{
      kkumail: 'a@kkumail.com', nickname_imported: 'ต้อม', nickname_self: 'ตั้ม',
    }]);
    expect(csv.split('\r\n')[1]).toContain('ตั้ม');
    expect(csv).not.toContain('ต้อม');
  });

  it('carries รุ่น and บ้าน as words a person can read, and nothing dead', () => {
    // The five columns the report asked about — year_override, is_listed,
    // sai_locked, verified_at and the raw cohort_year — were each the leftover
    // of a removed feature and are gone from the TABLE too (0129). What replaces
    // cohort_year is the label: ปีที่เข้า 2565 is not what anyone calls it.
    for (const dead of ['cohort_year', 'year_override', 'is_listed',
      'sai_locked', 'sai_self_edits', 'verified_at', 'status', 'full_name']) {
      expect(EXPORT_COLUMNS).not.toContain(dead);
    }
    const csv = buildStudentsCsv([{
      kkumail: 'a@kkumail.com', student_id: '659999999-9', sai_code: '017',
    }]);
    const cells = csv.split('\r\n')[1].split(',');
    expect(cells[EXPORT_COLUMNS.indexOf('cohort')]).toBe('MD50');
    expect(cells[EXPORT_COLUMNS.indexOf('house')]).toBe('7');
  });
});

describe('an import never destroys a column the file did not carry', () => {
  // The bug this pins: toUpsertRow used to emit EVERY import-owned column, so a
  // corrected name-list that omitted `sai` wrote null over ~1,800 สายรหัส — and
  // every house placement with them — while the preview said "แก้ไข 1,800".
  const NO_SAI = ['kkumail,first_name_th,last_name_th',
    'a@kkumail.com,ก,ข'].join('\n');

  it('omits the missing column from the upsert payload entirely', () => {
    const r = parseStudentsCsv(NO_SAI, ['MD']);
    expect(r.fatal).toBeNull();
    expect(r.presentColumns).not.toContain('sai_code');
    const row = toUpsertRow(r.rows[0], 'batch-1', r.presentColumns);
    // Absent, NOT null: PostgREST builds ON CONFLICT DO UPDATE SET from the keys
    // present, so an absent key keeps the stored value while null overwrites it.
    expect('sai_code' in row).toBe(false);
    expect('major' in row).toBe(false);
    expect(row.kkumail).toBe('a@kkumail.com');
    expect(row.first_name_th).toBe('ก');
  });

  it('still writes null for a column that IS in the file but empty', () => {
    const withBlank = ['kkumail,first_name_th,nickname_th',
      'a@kkumail.com,ก,'].join('\n');
    const r = parseStudentsCsv(withBlank, ['MD']);
    const row = toUpsertRow(r.rows[0], 'b', r.presentColumns);
    expect('nickname_imported' in row).toBe(true);
    expect(row.nickname_imported).toBeNull();
  });

  it('does not report a change in a column the import will not touch', () => {
    const r = parseStudentsCsv(NO_SAI, ['MD']);
    const existing = [{ id: 'x', kkumail: 'a@kkumail.com', first_name_th: 'ก',
      last_name_th: 'ข', sai_code: '017', major: 'MD' }];
    const d = diffAgainstExisting(r.rows, existing, r.presentColumns);
    expect(d.same).toBe(1);
    expect(d.update).toBe(0);
  });
});

describe('the MINIMUM useful file — kkumail + สาย, no names at all (0126)', () => {
  // Asking Data Analytics for three columns instead of seven means 1,800
  // people's names never leave their department. The two things ระบบบ้าน cannot
  // derive are the สายรหัส and the address that identifies the person; a name is
  // not one of them, because the student can type their own.
  const MINIMAL = ['kkumail,student_id,sai',
    'a@kkumail.com,659999999-9,017',
    'b@kkumail.com,649999998-8,003'].join('\n');

  it('imports a file with no name column', () => {
    const r = parseStudentsCsv(MINIMAL, ['MD']);
    expect(r.fatal).toBeNull();
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0].sai_code).toBe('017');
    expect(r.rows[0].first_name_th).toBeNull();
    // …and says so once, at file level, rather than 1,800 times per row.
    const notes = r.problems.filter((p) => p.field === 'first_name_th');
    expect(notes).toHaveLength(1);
    expect(notes[0].level).toBe('info');
  });

  it('writes only those three columns, so names already stored survive', () => {
    const r = parseStudentsCsv(MINIMAL, ['MD']);
    const row = toUpsertRow(r.rows[0], 'b', r.presentColumns);
    expect('first_name_th' in row).toBe(false);
    expect('nickname_imported' in row).toBe(false);
    expect(row.sai_code).toBe('017');
    expect(row.student_id).toBe('659999999-9');
  });

  it('still refuses a COMBINED name column — that one renames people', () => {
    // No name column names nobody; one combined column would rename everybody
    // whose surname has a space. The distinction is the whole point.
    const combined = ['full_name,kkumail,sai', 'สมชาย ณ อยุธยา,a@kkumail.com,017'].join('\n');
    expect(parseStudentsCsv(combined, ['MD']).fatal).toMatch(/รวมชื่อกับนามสกุล/);
  });

  it('keeps a row whose name cell is blank in a file that HAS the column', () => {
    const gap = [HEAD, '659999999-9,,,,a@kkumail.com,MD,017'].join('\n');
    const r = parseStudentsCsv(gap, ['MD']);
    expect(r.rows).toHaveLength(1);          // was: skipped entirely, losing the สาย
    expect(r.problems.some((p) => p.level === 'warn' && p.field === 'first_name_th')).toBe(true);
  });
});

describe('a คำนำหน้า is REPORTED, never stripped', () => {
  // Reported by the owner: "some people has นาย in their names". They are right
  // — นาย and นาง open real Thai names, so cutting them off renames a person
  // irreversibly and nothing downstream can tell. Same class as splitting a
  // combined "ชื่อ-สกุล", which this importer already refuses to do.
  it('keeps "นายก" intact — it is a NAME, not a title plus a name', () => {
    const t = [HEAD, '659999999-9,นายก,ใจดี,,a@kkumail.com,MD,017'].join('\n');
    const r = parseStudentsCsv(t, ['MD']);
    expect(r.rows[0].first_name_th).toBe('นายก');
  });

  it('keeps "นายสมชาย" intact too, and says so', () => {
    const t = [HEAD, '659999999-9,นายสมชาย,ใจดี,,a@kkumail.com,MD,017'].join('\n');
    const r = parseStudentsCsv(t, ['MD']);
    expect(r.rows[0].first_name_th).toBe('นายสมชาย');   // NOT 'สมชาย'
    const warn = r.problems.find((p) => p.field === 'first_name_th');
    expect(warn.level).toBe('warn');
    expect(warn.message).toMatch(/คำนำหน้า/);
  });

  it('does not flag an ordinary name', () => {
    const t = [HEAD, '659999999-9,สมชาย,ใจดี,,a@kkumail.com,MD,017'].join('\n');
    const r = parseStudentsCsv(t, ['MD']);
    expect(r.problems.some((p) => p.field === 'first_name_th')).toBe(false);
  });
});

describe('kkumail case is flattened, and that is load-bearing', () => {
  it('lowercases the address the file sent', () => {
    // Not a style rule: students_kkumail_key is a plain UNIQUE index and every
    // identity lookup compares lower(kkumail) = lower(email), so two spellings
    // of one address would be two rows for one human. The database enforces it
    // as well (normalize_kkumail, migration 0119).
    const t = [HEAD, '659999999-9,ก,ข,,Somchai.J@KKUmail.com,MD,017'].join('\n');
    const r = parseStudentsCsv(t, ['MD']);
    expect(r.rows[0].kkumail).toBe('somchai.j@kkumail.com');
  });

  it('still matches an existing row that differs only in case', () => {
    const t = [HEAD, '659999999-9,ก,ข,,Somchai.J@kkumail.com,MD,017'].join('\n');
    const r = parseStudentsCsv(t, ['MD']);
    const d = diffAgainstExisting(r.rows, [{ id: 'x', kkumail: 'somchai.j@kkumail.com',
      first_name_th: 'ก', last_name_th: 'ข', student_id: '659999999-9',
      major: 'MD', sai_code: '017' }], r.presentColumns);
    expect(d.insert).toBe(0);   // one person, not two
    expect(d.same).toBe(1);
  });
});

describe('buildPreviewRows — the file, one row per line', () => {
  // REQUESTED: "when import csv, it should show preview of what information
  // it'll be import like i can scroll through what it'll be import. and show
  // who that is duplicate, error prone, detect edge case etc". The preview was
  // four counters and a list of sentences ordered by severity — so "412 จะแก้ไข"
  // named nobody, and "บรรทัด 1408" could not be matched to a person without
  // counting lines by hand.
  const MESSY = [
    HEAD,
    '659999999-9,มานี,ใจดี,นก,manee.j@kkumail.com,MD,017',
    '669999998-8,ปิติ,รักเรียน,ต้น,manee.j@kkumail.com,MD,003',  // duplicate mail
    '689999996-6,วีระ,ตั้งใจ,,not-an-email,MD,001',               // bad mail
    '679999997-7,นายก,ดีงาม,กก,somchai@kkumail.com,MD,7',         // padded สาย + คำนำหน้า
  ].join('\n');

  it('keeps every line of the file, in file order', () => {
    const r = parseStudentsCsv(MESSY, ['MD']);
    const rows = buildPreviewRows(r, diffAgainstExisting(r.rows, [], r.presentColumns));
    expect(rows.map((x) => x._line)).toEqual([2, 3, 4, 5]);
  });

  it('INCLUDES the rows that will be skipped — they are the ones to look at', () => {
    // The old preview could not show these at all: a skipped row never reaches
    // `rows`, so a person dropped for a duplicate address was a number in a
    // counter and nothing else. That person will simply not exist afterwards.
    const r = parseStudentsCsv(MESSY, ['MD']);
    const rows = buildPreviewRows(r, diffAgainstExisting(r.rows, [], r.presentColumns));
    const skipped = rows.filter((x) => x._verdict === 'skip');
    expect(skipped.map((x) => x._line)).toEqual([3, 4]);
    expect(skipped[0]._skip).toMatch(/ซ้ำ/);
    // …and with enough content to identify WHO, not just that a line was lost.
    expect(skipped[0].first_name_th).toBe('ปิติ');
    expect(skipped[1].kkumail).toBe('not-an-email');
  });

  it('attaches each problem to the row it is about', () => {
    const r = parseStudentsCsv(MESSY, ['MD']);
    const rows = buildPreviewRows(r, diffAgainstExisting(r.rows, [], r.presentColumns));
    const titled = rows.find((x) => x._line === 5);
    expect(titled._problems.some((p) => p.field === 'first_name_th')).toBe(true);
  });

  it('leaves FILE-level findings off the rows — they belong above the fold', () => {
    // line 1 is the header, and its "problems" describe the whole file (the สาย
    // padding notice, unrecognised columns). Hanging them on a row would put a
    // statement about 1,800 people next to one of them.
    const r = parseStudentsCsv(MESSY, ['MD']);
    const rows = buildPreviewRows(r, diffAgainstExisting(r.rows, [], r.presentColumns));
    expect(rows.every((x) => x._problems.every((p) => p.line !== 1))).toBe(true);
  });

  it('carries ของเดิม for exactly the columns an update will change', () => {
    const r = parseStudentsCsv(good, ['MD']);
    const existing = [{ id: 'x', kkumail: 'manee.j@kkumail.com', first_name_th: 'มานี',
      last_name_th: 'ใจดี', nickname_imported: 'นก', student_id: '659999999-9',
      major: 'MD', sai_code: '099' }];
    const d = diffAgainstExisting(r.rows, existing, r.presentColumns);
    const rows = buildPreviewRows(r, d);
    const changed = rows.find((x) => x._verdict === 'update');
    expect(changed._changed).toEqual(['sai_code']);
    expect(changed._before).toEqual({ sai_code: '099' });
  });

  it('shows only columns the import can actually write', () => {
    // A preview column the import cannot write would promise something the
    // confirm button does not do.
    for (const c of PREVIEW_COLUMNS) expect(IMPORT_OWNED_COLUMNS).toContain(c);
  });
});

// ============================================================
// THE LINES THE FILE NAMED AND COULD NOT ADDRESS (0188)
// ============================================================
//
// 165 of the 2026-09-14 handover's 1,776 rows carry no kkumail — 111 of them
// the whole of รุ่น 66. `students.kkumail` is NOT NULL and is the upsert's
// conflict target, so those rows cannot be students; the parser skips them, and
// before 0188 that was the end of it. These assert what is kept instead, and
// what is NOT invented on the way.
describe('toUnresolvedRow — what a skipped line becomes', () => {
  const skipOf = (csv) => parseStudentsCsv(csv, ['MD']).skipped;

  it('a line with a รหัส but no address is held as no_kkumail, with its สาย', () => {
    const [row] = skipOf([HEAD, '659999999-9,มานี,ใจดี,นก,,MD,017'].join('\n'));
    const u = toUnresolvedRow(row);
    expect(u.reason).toBe('no_kkumail');
    expect(u.student_id).toBe('659999999-9');
    expect(u.sai_code).toBe('017');
    // Derived through the SAME function the database uses, never read off a
    // block heading — a รุ่น guessed from the row's position is a value no later
    // reader could tell apart from a fact.
    expect(u.cohort_year).toBe(2565);
  });

  it('a line with neither รหัส nor address says so — the two are different jobs', () => {
    const [row] = skipOf([HEAD, ',มานี,ใจดี,นก,,MD,017'].join('\n'));
    const u = toUnresolvedRow(row);
    // This is the distinction the admin pane sorts on: a row WITH a รหัส can be
    // closed by the student it names, from the home page, with nobody's help. A
    // row without one can be closed by an admin and by nobody else, ever.
    expect(u.reason).toBe('no_kkumail_no_student_id');
    expect(u.student_id).toBeNull();
    expect(u.cohort_year).toBeNull();
  });

  it('a duplicate address is held as duplicate_kkumail, not as a missing one', () => {
    const rows = skipOf([HEAD,
      '659999999-9,มานี,ใจดี,นก,same@kkumail.com,MD,017',
      '669999998-8,ปิติ,รักเรียน,ต้น,same@kkumail.com,MD,003'].join('\n'));
    expect(rows).toHaveLength(1);
    expect(toUnresolvedRow(rows[0]).reason).toBe('duplicate_kkumail');
  });

  it('a row with only a สาย is an empty seat, not a person', () => {
    const [row] = skipOf([HEAD, ',,,,,MD,017'].join('\n'));
    expect(toUnresolvedRow(row).reason).toBe('empty_row');
  });

  it('NEVER carries an unreadable สาย through — sai_code has a foreign key', () => {
    // The column references `sais`, and a made-up สาย is how a real student ends
    // up in the wrong บ้าน: บ้าน is the last digit. Null is the honest answer.
    const [row] = skipOf([HEAD, '659999999-9,มานี,ใจดี,นก,,MD,ABCD'].join('\n'));
    expect(toUnresolvedRow(row).sai_code).toBeNull();
  });
});

describe('diffAgainstExisting — a person the file NAMES is not missing', () => {
  // THE LEAK. A student who self-claimed a held seat is in the table under the
  // address they signed in with, and the handover file still does not have that
  // address — it never did, which is why their row was held in the first place.
  // Matching on kkumail alone stamps `missing_since` on exactly the people the
  // claim flow just repaired, on every import, for ever.
  const existing = [{
    id: 'u1', kkumail: 'claimed.by.me@kkumail.com', student_id: '659999999-9',
    first_name_th: 'มานี', sai_code: '017', self_edited: [],
  }];

  it('does not mark someone missing whose รหัส is on a SKIPPED line', () => {
    const r = parseStudentsCsv([HEAD, '659999999-9,มานี,ใจดี,นก,,MD,017'].join('\n'), ['MD']);
    expect(r.rows).toHaveLength(0);
    expect(r.skipped).toHaveLength(1);
    const d = diffAgainstExisting(r.rows, existing, r.presentColumns, r.skipped);
    expect(d.missing).toHaveLength(0);
  });

  // CONTROL. Without this the assertion above is satisfied by a `missing` that
  // is always empty, which is exactly how a guard stops meaning anything.
  it('…but DOES mark someone the file does not mention at all', () => {
    const r = parseStudentsCsv([HEAD, '669999998-8,ปิติ,รักเรียน,ต้น,piti.r@kkumail.com,MD,003'].join('\n'), ['MD']);
    const d = diffAgainstExisting(r.rows, existing, r.presentColumns, r.skipped);
    expect(d.missing.map((m) => m.id)).toEqual(['u1']);
  });

  it('matches the รหัส with or without its dash, as the handover spec allows', () => {
    // "รหัสนักศึกษาใส่ขีดหรือไม่ใส่ขีดก็ได้" — the file may write either, and a
    // comparison that saw them as two people would re-hold a claimed student.
    const r = parseStudentsCsv([HEAD, '6599999999,มานี,ใจดี,นก,,MD,017'].join('\n'), ['MD']);
    const d = diffAgainstExisting(r.rows, existing, r.presentColumns, r.skipped);
    expect(d.missing).toHaveLength(0);
  });
});

describe('the สาย a HELD row needs are seeded too', () => {
  // THE BUG, found by review and reproduced against samo-dev as a live 23503.
  // `student_import_unresolved.sai_code` carries the same foreign key to `sais`
  // that `students.sai_code` does, but runImport fed ensureSais() only
  // `result.rows` — so a สาย whose ONLY member in the file has no kkumail was
  // never seeded, and record_unresolved_rows died at the very END of the import,
  // after all 1,611 student rows were already written.
  //
  // The 2026-09-14 file does not trigger it, purely because รุ่น 49 covers
  // สาย 001–287 with no gaps. That is luck, not design, and it is exactly the
  // kind of luck that changes when the next file arrives.
  const HEAD_ = 'student_id,first_name_th,last_name_th,nickname_th,kkumail,major,sai';
  const csv = [HEAD_,
    '659999999-9,มานี,ใจดี,นก,manee.j@kkumail.com,MD,017',   // imported, สาย 017
    '669999998-8,ปิติ,รักเรียน,ต้น,,MD,099',                  // HELD, สาย 099 — nobody else has it
  ].join('\n');

  it('the สาย set sent to ensureSais covers held rows, not just imported ones', () => {
    const r = parseStudentsCsv(csv, ['MD']);
    expect(r.rows).toHaveLength(1);
    expect(r.skipped).toHaveLength(1);

    const sent = saiCodesToSeed(r.rows, r.skipped.map(toUnresolvedRow));
    expect(sent).toContain('017');
    expect(sent, 'a held row\'s สาย must be seeded or its insert 23503s').toContain('099');
  });

  it('and the IMPORTER calls that function — not its own inline expression', () => {
    // The assertion above tests a union this file builds. The bug was at the
    // CALL SITE, which no unit test can reach without a DOM and a network — so
    // the rule was moved into saiCodesToSeed() and this reads the source to
    // confirm runImport goes through it. A source check is a review, not a test;
    // it is here because the thing it reviews is a single named call, which is
    // the most a review can reliably see.
    const src = readFileSync(new URL('./index.js', import.meta.url), 'utf8');
    const call = src.match(/await ensureSais\(([^;]*)\);/);
    expect(call, 'runImport no longer calls ensureSais at all').toBeTruthy();
    expect(call[1], 'ensureSais must be fed saiCodesToSeed(), which includes held rows')
      .toContain('saiCodesToSeed(');
  });

  it('…and an unreadable สาย on a held row is not sent at all', () => {
    // ensure_sais filters to ^[0-9]{3}$ server-side, but sending junk would mean
    // the row's own sai_code is junk too, and THAT is what hits the foreign key.
    // toUnresolvedRow nulls it instead, which is the honest answer.
    const bad = parseStudentsCsv([HEAD_, '659999999-9,มานี,ใจดี,นก,,MD,ZZZ'].join('\n'), ['MD']);
    const held = bad.skipped.map(toUnresolvedRow);
    expect(held[0].sai_code).toBeNull();
    expect(held.map((x) => x.sai_code).filter(Boolean)).toHaveLength(0);
  });
});

describe('a skipped row reports its reason by CODE, never by its Thai sentence', () => {
  // toUnresolvedRow used to recover "this was a duplicate address" by testing
  // the human-facing message for "ซ้ำ". Rewording a message — which nobody would
  // think of as a behaviour change — would then file every duplicate under the
  // wrong reason, silently. Matching one spelling is how a guard goes blind.
  const HEAD_ = 'student_id,first_name_th,last_name_th,nickname_th,kkumail,major,sai';

  it('the parser stamps a structural code beside the sentence', () => {
    const dup = parseStudentsCsv([HEAD_,
      '659999999-9,มานี,ใจดี,นก,same@kkumail.com,MD,017',
      '669999998-8,ปิติ,รักเรียน,ต้น,same@kkumail.com,MD,003'].join('\n'), ['MD']);
    expect(dup.skipped[0]._skipCode).toBe('duplicate_kkumail');

    const none = parseStudentsCsv([HEAD_, '659999999-9,มานี,ใจดี,นก,,MD,017'].join('\n'), ['MD']);
    expect(none.skipped[0]._skipCode).toBe('no_kkumail');
  });

  it('the reason survives a reworded message', () => {
    const dup = parseStudentsCsv([HEAD_,
      '659999999-9,มานี,ใจดี,นก,same@kkumail.com,MD,017',
      '669999998-8,ปิติ,รักเรียน,ต้น,same@kkumail.com,MD,003'].join('\n'), ['MD']);
    // The sentence rewritten with no "ซ้ำ" in it — what a copy edit looks like.
    const reworded = { ...dup.skipped[0], _skip: 'this address belongs to an earlier line' };
    expect(toUnresolvedRow(reworded).reason).toBe('duplicate_kkumail');
  });
});
