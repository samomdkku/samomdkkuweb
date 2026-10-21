// ==============================================
// advisor-import.js — the อาจารย์ที่ปรึกษา sheet, as rows ระบบบ้าน can write.
//
// REQUESTED (owner, 2026-10-21): import the อาจารย์ list into ระบบบ้าน, with
// เบอร์โทรศัพท์. The sheet ฝ่ายข้อมูล keeps has one line per อาจารย์:
//
//   ลงท้ายด้วยเลข | สายรหัส | ตำแหน่ง | ชื่อ | สกุล | เบอร์โทรศัพท์ | สาขาวิชา
//
// `ลงท้ายด้วยเลข` is the บ้าน, written once at the top of each block and blank
// below it, so it is CARRIED DOWN. Every สาย on a line must end in that digit —
// the house IS the last digit — so a code that does not is a typo, and is
// REFUSED rather than corrected: "063/136/263" in บ้าน 3 almost certainly meant
// 163, but guessing would put an อาจารย์ on a สาย in another บ้าน. The problem
// list says what to type by hand instead.
//
// คำนำหน้า: there is no title column (0128), and the editor's own hint is
// "ใส่คำนำหน้ารวมมากับชื่อได้เลย", so the academic rank becomes the same short
// prefix a person would type ("รศ. สมมติ"). An unknown rank is a problem, never
// guessed.
//
// PURE. No DOM, no Supabase. tools/house-advisor-import.mjs writes what this
// returns, the อาจารย์ editor uses the phone helpers; advisor-import.test.js
// pins the rules.
// ==============================================
import { normalizeSai, houseOf, cleanSpace, cleanCell } from './fields.js';

/** Header → field. Matched after trimming, so a stray space does not lose a column. */
export const ADVISOR_SHEET_COLUMNS = {
  'ลงท้ายด้วยเลข': 'house',
  'สายรหัส': 'sais',
  'ตำแหน่ง': 'rank',
  'ชื่อ': 'first',
  'สกุล': 'last',
  'เบอร์โทรศัพท์': 'phone',
  'สาขาวิชา': 'dept',
};

const RANK_PREFIX = {
  'ศาสตราจารย์': 'ศ.',
  'รองศาสตราจารย์': 'รศ.',
  'ผู้ช่วยศาสตราจารย์': 'ผศ.',
  'อาจารย์': 'อ.',
};

/** Thai combining marks typed twice ("อาจารย์์", "ผู้้ช่วย") render as one
 *  and are the same word; anything else is compared as written. */
const collapseMarks = (s) => s.replace(/([ัิ-ฺ็-๎])\1+/g, '$1');

/** The short prefix for a written-out rank, '' for none, null for unknown. */
export function rankPrefix(raw) {
  const v = collapseMarks(cleanSpace(raw));
  if (!v) return '';
  return RANK_PREFIX[v] ?? null;
}

/**
 * A phone number as STORED: digits only, leading 0, 9 or 10 digits.
 * +66 / 66 is the same number with the 0 replaced. Empty is fine (ok, null).
 */
export function normalizePhone(raw) {
  const s = cleanSpace(raw);
  if (!s) return { value: null, ok: true };
  let d = s.replace(/[^\d+]/g, '');
  if (d.startsWith('+66')) d = '0' + d.slice(3);
  else if (d.startsWith('66') && d.length === 11) d = '0' + d.slice(2);
  d = d.replace(/\D/g, '');
  if (!/^0\d{8,9}$/.test(d)) return { value: s, ok: false };
  return { value: d, ok: true };
}

/** A stored phone for display: 081-234-5678 · 02-123-4567 · 043-123-456. */
export function formatPhone(digits) {
  const d = String(digits || '');
  if (/^0\d{9}$/.test(d)) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  if (/^02\d{7}$/.test(d)) return `${d.slice(0, 2)}-${d.slice(2, 5)}-${d.slice(5)}`;
  if (/^0\d{8}$/.test(d)) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  return d;
}

/** The stored phone on an advisor row from fetchAdvisors(), or null.
 *  PostgREST embeds a one-to-one as an object; an array is tolerated too. */
export function advisorPhone(advisor) {
  const p = advisor?.advisor_phones;
  return (Array.isArray(p) ? p[0] : p)?.phone || null;
}

const nameKey = (first, last) => `${cleanSpace(first)}|${cleanSpace(last)}`;

/**
 * @param {Array<Array<unknown>>} table  header row first, as parseCsv returns it
 * @returns {{ fatal?: string,
 *             advisors: Array<{ first_name_th: string, last_name_th: string|null,
 *                               dept: string|null, phone: string|null,
 *                               sai_codes: string[], lines: number[] }>,
 *             problems: Array<{ line: number, message: string }> }}
 *   `line` is the spreadsheet's own row number (header = 1).
 */
export function parseAdvisorSheet(table) {
  const [header = [], ...body] = table || [];
  const col = {};
  header.forEach((h, i) => {
    const f = ADVISOR_SHEET_COLUMNS[cleanSpace(h)];
    if (f && col[f] === undefined) col[f] = i;
  });
  const missing = Object.entries(ADVISOR_SHEET_COLUMNS)
    .filter(([, f]) => col[f] === undefined).map(([h]) => h);
  if (missing.length) {
    return { fatal: `ไม่พบคอลัมน์: ${missing.join(', ')}`, advisors: [], problems: [] };
  }

  const problems = [];
  const byName = new Map();
  let house = null;

  body.forEach((cells, i) => {
    const line = i + 2;
    const cell = (f) => cleanCell(cells?.[col[f]] == null ? '' : String(cells[col[f]]));
    const h = cell('house');
    if (h !== null) {
      const n = Number(h);
      house = Number.isInteger(n) && n >= 0 && n <= 9 ? n : null;
      if (house === null) problems.push({ line, message: `ลงท้ายด้วยเลข “${h}” ไม่ใช่เลข 0–9` });
    }
    const first = cell('first');
    const last = cell('last');
    if (!first && !last && !cell('sais')) return;           // a blank line
    if (!first) { problems.push({ line, message: 'ไม่มีชื่อ — ข้ามแถวนี้' }); return; }

    const prefix = rankPrefix(cell('rank'));
    if (prefix === null) {
      problems.push({ line, message: `ไม่รู้จักตำแหน่ง “${cell('rank')}” — ข้ามแถวนี้` });
      return;
    }

    const codes = [];
    for (const part of String(cell('sais') || '').split(/[/,\s]+/).filter(Boolean)) {
      const n = normalizeSai(part);
      if (!n.ok || !n.value) { problems.push({ line, message: `สายรหัส “${part}” ไม่ถูกต้อง — ไม่ได้ใส่` }); continue; }
      if (house !== null && houseOf(n.value) !== house) {
        problems.push({ line, message: `สาย ${n.value} ไม่ได้อยู่บ้าน ${house} (ลงท้ายด้วย ${houseOf(n.value)}) — ไม่ได้ใส่ ตรวจแล้วเพิ่มเอง` });
        continue;
      }
      if (codes.includes(n.value)) { problems.push({ line, message: `สาย ${n.value} ซ้ำในแถวเดียวกัน` }); continue; }
      codes.push(n.value);
    }

    const phone = normalizePhone(cell('phone'));
    if (!phone.ok) problems.push({ line, message: 'เบอร์โทรศัพท์ไม่ใช่เลข 9–10 หลัก — ไม่ได้ใส่' });

    const row = {
      first_name_th: prefix ? `${prefix} ${first}` : first,
      last_name_th: last,
      dept: cell('dept'),
      phone: phone.ok ? phone.value : null,
      sai_codes: codes,
      lines: [line],
    };

    // The same person on two lines is one อาจารย์ with both lines' สาย.
    const key = nameKey(row.first_name_th, row.last_name_th);
    const prev = byName.get(key);
    if (!prev) { byName.set(key, row); return; }
    prev.lines.push(line);
    for (const c of codes) if (!prev.sai_codes.includes(c)) prev.sai_codes.push(c);
    for (const f of ['phone', 'dept']) {
      if (row[f] && prev[f] && row[f] !== prev[f]) {
        problems.push({ line, message: `ชื่อซ้ำกับแถว ${prev.lines[0]} แต่${f === 'phone' ? 'เบอร์โทรศัพท์' : 'สาขาวิชา'}ไม่ตรงกัน — ใช้ของแถว ${prev.lines[0]}` });
      } else if (row[f] && !prev[f]) prev[f] = row[f];
    }
  });

  const advisors = [...byName.values()];
  for (const a of advisors) a.sai_codes.sort();
  return { advisors, problems };
}
