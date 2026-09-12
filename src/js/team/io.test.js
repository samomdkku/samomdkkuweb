import { describe, it, expect } from 'vitest';
import {
  buildMembersCsv, parseCsv, parseMembersCsv, splitPath, buildExportJson,
  normalizeYear, parseConfirmed, isLikelyEmail, cleanSpace, validateExportJson,
} from './io.js';

describe('team/io CSV', () => {
  it('round-trips members through CSV (quoting commas + Thai)', () => {
    const rows = [
      { path: 'ฝ่ายบริหารองค์กร / ฝ่ายเอกสาร / หัวหน้าฝ่ายเอกสาร',
        full_name: 'ณญาดา รัตนวิศิษฏ์กุล', nickname: 'ปูปู้', student_id: '653070301-5',
        year: 'ปี 5', major: 'MD', kkumail: 'nayada.r@kkumail.com', confirmed: true },
      { path: 'A, Inc / B', full_name: 'มี, จุลภาค', nickname: '', student_id: '',
        year: '', major: '', kkumail: '', confirmed: false },
    ];
    const csv = buildMembersCsv(rows);
    const parsed = parseMembersCsv(csv);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].full_name).toBe('ณญาดา รัตนวิศิษฏ์กุล');
    expect(parsed[0].confirmed).toBe(true);
    expect(parsed[1].full_name).toBe('มี, จุลภาค');     // comma survived quoting
    expect(parsed[1].path).toBe('A, Inc / B');
    expect(parsed[1].confirmed).toBe(false);
  });

  it('parses escaped quotes and CRLF', () => {
    const rows = parseCsv('a,b\r\n"he said ""hi""",2\r\n');
    expect(rows).toEqual([['a', 'b'], ['he said "hi"', '2']]);
  });

  it('maps Thai header aliases and confirm synonyms', () => {
    const csv = 'ตำแหน่ง,ชื่อ-สกุล,ชื่อเล่น,ยืนยัน\nฝ่าย/บทบาท,สมชาย ใจดี,ชาย,เข้าแล้ว';
    const [m] = parseMembersCsv(csv);
    expect(m.path).toBe('ฝ่าย/บทบาท');
    expect(m.full_name).toBe('สมชาย ใจดี');
    expect(m.nickname).toBe('ชาย');
    expect(m.confirmed).toBe(true);
  });

  it('drops rows without a full_name', () => {
    expect(parseMembersCsv('full_name\n\n')).toHaveLength(0);
  });

  it('splitPath separates on " / " but keeps a slash inside a name', () => {
    expect(splitPath(' A / B / C ')).toEqual(['A', 'B', 'C']);     // leading/trailing trimmed
    expect(splitPath('A / B / ')).toEqual(['A', 'B']);            // trailing separator dropped
    expect(splitPath('A Inc /  B ')).toEqual(['A Inc', 'B']);      // collapsed inner space
    expect(splitPath('ComArt / Art/Graphic')).toEqual(['ComArt', 'Art/Graphic']); // slash in name kept
    expect(splitPath('Art/Graphic')).toEqual(['Art/Graphic']);    // bare slash = part of name
  });

  it('normalizes year to a bare number', () => {
    expect(normalizeYear('ปี 5')).toBe('5');
    expect(normalizeYear('5')).toBe('5');
    expect(normalizeYear(3)).toBe('3');
    expect(normalizeYear('ปีที่ 3')).toBe('3');
    expect(normalizeYear('')).toBe(null);
    expect(normalizeYear('-')).toBe(null);
  });

  it('parses loose confirm values + flags unrecognized', () => {
    expect(parseConfirmed('true')).toEqual({ value: true, recognized: true });
    expect(parseConfirmed('TRU')).toEqual({ value: true, recognized: true });   // typo, leading t
    expect(parseConfirmed('เข้าแล้ว')).toEqual({ value: true, recognized: true });
    expect(parseConfirmed('รอยืนยัน')).toEqual({ value: false, recognized: true });
    expect(parseConfirmed('')).toEqual({ value: false, recognized: true });
    expect(parseConfirmed('maybe')).toEqual({ value: false, recognized: false });
  });

  it('parseMembersCsv READS the ชั้นปี column but never writes it (0145)', () => {
    const csv = 'path,full_name,year,confirmed\nA/B,สมชาย,ปี 4,เข้าแล้ว\nA/B,สมหญิง,2,หืม';
    const rows = parseMembersCsv(csv);
    // Read, so the import preview can WARN that the column is being ignored —
    // silently dropping a column somebody spent an afternoon filling in is how
    // an import "does nothing" for no visible reason.
    expect(rows[0].yearInFile).toBe('4');
    expect(rows[1].yearInFile).toBe('2');
    // …and never handed to a writer. ชั้นปี is computed from รหัสนักศึกษา.
    expect(rows[0].year).toBeUndefined();
    expect(rows[1].year).toBeUndefined();
    expect(rows[0].confirmed).toBe(true);
    expect(rows[0].confirmedRecognized).toBe(true);
    expect(rows[1].confirmedRecognized).toBe(false);  // "หืม" ⇒ warn
  });

  it('isLikelyEmail / cleanSpace', () => {
    expect(isLikelyEmail('a@kkumail.com')).toBe(true);
    expect(isLikelyEmail('nope')).toBe(false);
    expect(cleanSpace('  a   b ')).toBe('a b');
  });

  it('validateExportJson rejects malformed shapes', () => {
    expect(validateExportJson([]).ok).toBe(false);              // array, not object
    expect(validateExportJson({ nodes: [] }).ok).toBe(false);   // empty nodes
    expect(validateExportJson({ nodes: [{ name: '' }] }).ok).toBe(false); // nameless node
    expect(validateExportJson({ nodes: [{ name: 'X' }], members: {} }).ok).toBe(false); // members not array
    expect(validateExportJson({ nodes: [{ name: 'X' }] }).ok).toBe(true);
  });
});

describe('team/io JSON export', () => {
  it('normalizes node + member shape', () => {
    const out = buildExportJson(
      [{ id: 'n1', parent_id: null, name: 'Div', kind: 'division', position: 0,
         permissions: ['pr'], inherit_permissions: false }],
      [{ id: 'm1', node_id: 'n1', position: 0, full_name: 'X', confirmed: true }],
    );
    expect(out.version).toBe(1);
    expect(out.nodes[0]).toMatchObject({ id: 'n1', permissions: ['pr'], inherit_permissions: false });
    expect(out.members[0]).toMatchObject({ id: 'm1', full_name: 'X', confirmed: true });
    // คำนำหน้า is gone from the schema (0113) — an export must not resurrect it.
    expect('prefix' in out.members[0]).toBe(false);
  });

  it('carries the VS dept binding on BOTH nodes and members (0082/0083)', () => {
    const out = buildExportJson(
      [{ id: 'n1', name: 'ฝ่าย IT', kind: 'role', vs_dept: 'อุปนายกฝ่ายวิชาการ' }],
      [{ id: 'm1', node_id: 'n1', full_name: 'A', vs_dept: 'SE' },
       { id: 'm2', node_id: 'n1', full_name: 'B' }],
    );
    expect(out.nodes[0].vs_dept).toBe('อุปนายกฝ่ายวิชาการ');
    expect(out.members[0].vs_dept).toBe('SE');
    expect(out.members[1].vs_dept).toBe(null);
  });
});

// ---------------------------------------------------------------------------
// Round-trip fidelity.
//
// buildExportJson is an allow-list feeding a BACKUP, so a column left out is not
// "not exported" — it is DESTROYED the next time someone exports, restructures
// and re-imports. is_board / photo_url / photo_focus were all missing when first
// written, which would have wiped every portrait and the whole คณะกรรมการ grid
// on any restore.
//
// These pin the key sets so adding a column to team_nodes / team_members is a
// conscious decision here rather than a silent omission. If one of these fails,
// the fix is to add the field to buildExportJson AND to the two create calls in
// index.js importJson — not to update the expectation alone.
// ---------------------------------------------------------------------------
describe('buildExportJson round-trip fidelity', () => {
  const NODE = {
    id: 'n1', parent_id: null, name: 'ฝ่ายทดสอบ', kind: 'division', position: 3,
    permissions: ['pr'], inherit_permissions: false, vs_dept: 'SE',
    project_seat: 'vpa', is_public: true, is_board: true,
    passport_dept_id: 0, passport_sub_dept_id: 7, color: '#2F5F9C', tier: 2,
    discord_role: true, discord_role_id: '1300000000000000001',
  };
  const MEMBER = {
    id: 'm1', node_id: 'n1', position: 2, full_name: 'ทดสอบ ระบบ',
    nickname: 'เทส', student_id: '123', year: '5', major: 'MD',
    kkumail: 'a@kkumail.com', confirmed: true,
    photo_url: 'https://lh3.googleusercontent.com/d/ABC=w2000',
    photo_focus: 'top',
    permissions: [], inherit_permissions: true, vs_dept: null,
    project_seat: null, passport_dept_id: null, passport_sub_dept_id: null,
  };

  it('exports every persisted node field', () => {
    const [n] = buildExportJson([NODE], []).nodes;
    expect(Object.keys(n).sort()).toEqual([
      'color', 'dept_page', 'discord_role', 'discord_role_id', 'id',
      'inherit_permissions', 'is_board', 'is_public',
      'kind', 'name', 'parent_id', 'passport_dept_id', 'passport_sub_dept_id',
      'permissions', 'position', 'project_seat', 'tier', 'vs_dept',
    ]);
    expect(n.tier, 'the rung must survive a round trip, not just the key').toBe(2);
    // The VALUE too, not just the key. `color: n.color || null` would export
    // the key and drop the choice if the mapping were ever written as a bare
    // spread of a subset — and a ฝ่าย re-imported to its name-derived colour
    // looks like a colour, not like a loss.
    expect(n.color).toBe('#2F5F9C');
  });

  it('exports every persisted member field', () => {
    const [m] = buildExportJson([], [MEMBER]).members;
    expect(Object.keys(m).sort()).toEqual([
      // first_name_th / last_name_th joined in 0135. They are exported BESIDE
      // full_name, not instead of it: a pre-0135 row has only the combined
      // name and dropping it would round-trip those people into nothing.
      'confirmed', 'dept_page', 'first_name_th', 'full_name', 'id', 'inherit_permissions',
      'kkumail', 'last_name_th', 'major',
      'nickname', 'node_id', 'passport_dept_id', 'passport_sub_dept_id',
      // NO `year` since 0145 — ชั้นปี is derived, and the ingredients it is
      // derived from (cohort_year / year_offset) belong to the person registry,
      // which mirrors them down. Restoring them from a backup would be undone
      // on the next write, so the backup carries the รหัสนักศึกษา instead.
      'permissions', 'photo_focus', 'photo_url', 'position',
      'project_seat', 'student_id', 'vs_dept',
    ]);
  });

  it('preserves the portrait and the board flag by VALUE, not just by key', () => {
    const out = buildExportJson([NODE], [MEMBER]);
    expect(out.nodes[0].is_board).toBe(true);
    expect(out.members[0].photo_url).toBe(MEMBER.photo_url);
    expect(out.members[0].photo_focus).toBe('top');
  });

  it('does not turn a false/absent board flag into true', () => {
    const [n] = buildExportJson([{ ...NODE, is_board: undefined }], []).nodes;
    expect(n.is_board).toBe(false);
  });

  it('keeps passport_dept_id 0 (a real id) rather than nulling it as falsy', () => {
    const [n] = buildExportJson([NODE], []).nodes;
    expect(n.passport_dept_id).toBe(0);
  });

  // 0183. The Discord snowflake is 19 digits, which is past 2^53 — if this ever
  // stops being a string somewhere between the column and the file, the id
  // silently changes VALUE and the export points at a role that does not exist.
  it('carries the Discord role id as an unrounded STRING', () => {
    const [n] = buildExportJson([NODE], []).nodes;
    expect(n.discord_role_id).toBe('1300000000000000001');
    expect(typeof n.discord_role_id).toBe('string');
  });

  it('does not turn an absent Discord tick into true', () => {
    const [n] = buildExportJson(
      [{ ...NODE, discord_role: undefined, discord_role_id: undefined }], []).nodes;
    expect(n.discord_role).toBe(false);
    expect(n.discord_role_id).toBe(null);
  });
});
