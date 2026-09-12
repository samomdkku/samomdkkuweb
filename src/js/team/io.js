// ==============================================
// TEAM IMPORT / EXPORT — pure (de)serialization + normalization helpers
//
// Kept side-effect-free so they're unit-testable; index.js orchestrates the
// actual create calls + dedupe against the live model. Tolerant on input:
// trims/collapses whitespace, canonicalises รหัสนักศึกษา / ชั้นปี / สาขา through
// ./fields.js, and accepts loose `confirmed` spellings
// (true/TRU/yes/ใช่/เข้าแล้ว…) — flagging only genuinely unrecognized values so
// the caller can warn.
//
// `prefix` (คำนำหน้า) was a column here until migration 0113 dropped it. A CSV
// that still carries the header simply has it ignored, like any other unknown
// column — an old export must not fail to import.
// ==============================================
import {
  normalizeStudentId, normalizeMajor, normalizeYear as normalizeYearField,
} from './fields.js';
// ชั้นปี is COMPUTED for the export column and IGNORED on import (0145) — see
// src/js/study-year.js for why storing it is what made three screens disagree.
import { studyYearLabel } from '../study-year.js';

/**
 * `first_name_th` / `last_name_th` joined `full_name` in 0135, and all three are
 * exported deliberately.
 *
 * `full_name` is DERIVED from the parts wherever they exist, so on a split row
 * it is redundant — but it is the only name a pre-0135 row has, and an export
 * that dropped it would round-trip those people into nothing. Both are here and
 * the importer resolves the precedence in one place (parseMembersCsv): parts
 * win, `full_name` fills in for the rows that have none, and NOTHING is ever
 * split on whitespace to manufacture the parts.
 */
export const CSV_COLUMNS = [
  'path', 'first_name_th', 'last_name_th', 'full_name', 'nickname',
  'student_id', 'year', 'major', 'kkumail', 'confirmed',
];

export const PATH_SEP = ' / ';

// ---- normalization ----

/** ชั้นปี → bare number string. "ปี 5" → "5", "5" → "5", "ปีที่ 3" → "3".
 *  Delegates to ./fields.js — this used to be its own `match(/\d+/)`, i.e. the
 *  same rule implemented twice, which is the class this repo pays for most
 *  often. The wrapper keeps io.js's simpler "value or null" signature for its
 *  existing callers. */
export function normalizeYear(v) {
  return normalizeYearField(v).value;
}
export { normalizeStudentId, normalizeMajor };

/** Loose truthiness for the confirm column. Returns { value, recognized } so
 *  callers can warn on genuinely ambiguous input (e.g. "maybe"). */
export function parseConfirmed(v) {
  const s = String(v ?? '').trim().toLowerCase();
  if (!s) return { value: false, recognized: true };
  if (/^(t|true|y|yes|1|✓|✔|ใช่|ยืนยัน|เข้า)/.test(s)) return { value: true, recognized: true };
  if (/^(f|false|n|no|0|✗|✘|ไม่|ยังไม่|รอ|-)/.test(s)) return { value: false, recognized: true };
  return { value: false, recognized: false };
}

export function isLikelyEmail(s) {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(s ?? '').trim());
}

/** Collapse runs of whitespace and trim. "  A   B " → "A B". */
export function cleanSpace(s) {
  return String(s ?? '').replace(/\s+/g, ' ').trim();
}

/** Split a path on the " / " separator (slash WITH surrounding whitespace) so
 *  that a slash INSIDE a name is preserved — e.g. "ComArt / Art/Graphic" →
 *  ["ComArt", "Art/Graphic"]. A bare "A/B" (no spaces) is one segment by
 *  design; the documented format puts spaces around each level separator. */
export function splitPath(path) {
  return String(path ?? '').split(/\s+\/\s+/).map((s) => cleanSpace(s)).filter(Boolean);
}

// ---- JSON ----

/**
 * Full-fidelity dump for backup / restructure-and-reimport.
 *
 * ⚠ THIS IS AN ALLOW-LIST AND IT IS A BACKUP, so the safe default is the
 * OPPOSITE of the public projection's. get_public_team_chart() names columns so
 * a new one is NOT published by accident; here, a column left out is silently
 * DESTROYED on the next export→import round trip. `is_board`, `photo_url` and
 * `photo_focus` were all missing at first and would have wiped every portrait
 * and the whole คณะกรรมการ grid on any restore.
 *
 * Adding a column to team_nodes / team_members? Add it here, add it to the two
 * create calls in index.js `importJson`, and extend the key list in
 * io.test.js — that test exists to make this a conscious decision.
 *
 * (`shop_source` is deliberately absent: 0094 reverted shop scoping and the
 * column is inert and unread. If it is ever wired up again, add it.)
 */
export function buildExportJson(nodes, members) {
  return {
    version: 1,
    exported_at: new Date().toISOString(),
    nodes: nodes.map((n) => ({
      id: n.id, parent_id: n.parent_id || null, name: n.name, kind: n.kind,
      position: n.position ?? 0, permissions: n.permissions || [],
      inherit_permissions: n.inherit_permissions !== false,
      vs_dept: n.vs_dept || null,
      project_seat: n.project_seat || null,
      is_public: n.is_public !== false,
      is_board: !!n.is_board,
      // 0152. An export that drops this re-imports every ฝ่าย back to the
      // name-derived colour — silently, since a derived colour looks like a
      // colour rather than like a loss.
      color: n.color || null,
      // 0153. Same shape: dropped, every ฝ่าย re-imports with all its ตำแหน่ง
      // on one rung, which looks like a chart rather than like a loss.
      tier: n.tier ?? null,
      passport_dept_id: n.passport_dept_id ?? null,
      passport_sub_dept_id: n.passport_sub_dept_id ?? null,
      // 0177. Same shape as every grant above: an export that drops it
      // re-imports the tree with nobody able to edit their ฝ่าย page, and the
      // loss looks like "nobody was granted it" rather than like a loss.
      dept_page: n.dept_page || null,
      // 0183, and the two halves do NOT travel together on the way back in.
      //
      // `discord_role` is a fact about the ORG — "this group needs its own
      // channel" — so it round-trips like every grant above; dropped, a restore
      // comes back with ~90 owner decisions silently reset to false, which
      // looks like "nobody had ticked any" rather than like a loss.
      //
      // `discord_role_id` names ONE Discord role object, and importJson
      // APPENDS with new ids rather than restoring in place. Carrying it
      // through an append would have two nodes claiming one role — so the
      // import deliberately drops it (the unique index would refuse the second
      // claim anyway, which is the loud failure we want and not a design). It
      // is exported because an export is also a BACKUP: without it a true
      // restore re-provisions every role from scratch and orphans the old ones
      // with all their channel overwrites still attached — the exact fork the
      // old bot's auto-create produced on every rename. If a restore-in-place
      // path is ever built, re-attaching this is part of it.
      discord_role: !!n.discord_role,
      discord_role_id: n.discord_role_id ?? null,
    })),
    members: members.map((m) => ({
      id: m.id, node_id: m.node_id, position: m.position ?? 0,
      full_name: m.full_name,
      first_name_th: m.first_name_th || null, last_name_th: m.last_name_th || null,
      nickname: m.nickname || null,
      // NO `year` (0145). ชั้นปี is derived from student_id + the registry's
      // cohort_year/year_offset, and those are MIRROR columns the registry owns —
      // restoring them from a backup would be undone on the next write. The
      // รหัสนักศึกษา is what round-trips; the ชั้นปี follows from it.
      student_id: m.student_id || null, major: m.major || null,
      kkumail: m.kkumail || null, confirmed: !!m.confirmed,
      photo_url: m.photo_url || null,
      photo_focus: m.photo_focus || null,
      permissions: m.permissions || [],
      inherit_permissions: m.inherit_permissions !== false,
      vs_dept: m.vs_dept || null,
      project_seat: m.project_seat || null,
      passport_dept_id: m.passport_dept_id ?? null,
      passport_sub_dept_id: m.passport_sub_dept_id ?? null,
      dept_page: m.dept_page || null,
    })),
  };
}

/** Validate a parsed export object. Returns { ok, error } — a hard structural
 *  problem is a fail (JSON is machine-generated; malformed ⇒ abort with a
 *  clear message rather than partial import). */
export function validateExportJson(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, error: 'ต้องเป็น JSON ที่ส่งออกจากระบบ (object ที่มี nodes/members) — ถ้าเป็นรายชื่อให้ใช้ CSV' };
  }
  if (!Array.isArray(data.nodes) || !data.nodes.length) {
    return { ok: false, error: 'JSON ไม่มี nodes' };
  }
  const badNode = data.nodes.find((n) => !n || typeof n.name !== 'string' || !n.name.trim());
  if (badNode) return { ok: false, error: 'มี node ที่ไม่มีชื่อ (name) — ไฟล์อาจเสียหาย' };
  if (data.members && !Array.isArray(data.members)) {
    return { ok: false, error: 'members ต้องเป็น array' };
  }
  return { ok: true };
}

// ---- CSV ----

function csvCell(v) {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** rows: [{ path, full_name, ... }] */
export function buildMembersCsv(rows) {
  const lines = [CSV_COLUMNS.join(',')];
  for (const r of rows) {
    lines.push(CSV_COLUMNS.map((c) => csvCell(
      // ชั้นปี is COMPUTED (0145), so the file carries the answer a human would
      // read on the screen rather than a stored column that no longer exists.
      // It is EXPORT-ONLY: parseMembersCsv ignores the column on the way back
      // in, because writing a ชั้นปี is what let two systems disagree.
      // eslint-disable-next-line no-nested-ternary
      c === 'year' ? (studyYearLabel(r) || '')
        : c === 'confirmed' ? (r.confirmed ? 'true' : 'false') : r[c],
    )).join(','));
  }
  return lines.join('\r\n');
}

/** RFC-4180-ish CSV parser: handles quoted fields, escaped quotes, CRLF/LF. */
export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQ = false;
  const s = String(text || '').replace(/^﻿/, '');  // strip BOM
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQ) {
      if (ch === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; } else inQ = false;
      } else field += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (ch === '\r') { /* swallow; \n ends the row */ }
    else field += ch;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.length && !(r.length === 1 && r[0] === ''));
}

/** Parse a members CSV into normalized objects keyed by canonical header.
 *  Tolerates Thai header aliases, column reordering, stray whitespace. Each
 *  row carries `confirmedRecognized` so the caller can warn on ambiguous
 *  confirm values. Rows without a full_name are dropped. */
export function parseMembersCsv(text, knownMajors = []) {
  const rows = parseCsv(text);
  if (!rows.length) return [];
  const header = rows[0].map((h) => normHeader(h));
  return rows.slice(1).map((cells, idx) => {
    const o = { _row: idx + 2 };  // 1-based incl header, for messages
    header.forEach((key, i) => { if (key) o[key] = cleanSpace(cells[i] ?? ''); });
    const c = parseConfirmed(o.confirmed);
    o.confirmed = c.value;
    o.confirmedRecognized = c.recognized;
    // ชั้นปี is READ so the preview can say what it will ignore, and NEVER
    // written (0145). `yearIgnored` is what the import preview warns on.
    o.yearInFile = normalizeYear(o.year);
    o.year = undefined;
    // Canonicalise the two free-text identity fields on the way in, so an
    // import cannot be the thing that reintroduces `md` next to `MD`. Unreadable
    // values are KEPT (never blanked) and reported, so a spreadsheet full of
    // `ปี5` lands clean while a genuine oddity stays visible.
    const sid = normalizeStudentId(o.student_id);
    o.student_id = sid.value;
    o.studentIdRecognized = sid.ok;
    const mj = normalizeMajor(o.major, knownMajors);
    o.major = mj.value;
    o.majorRecognized = mj.ok;
    // THE NAME, and the one rule that governs every name in this repo: the
    // PARTS are authoritative and the whole is derived from them; a stored
    // whole is never cut up to manufacture parts. So a file carrying ชื่อ and
    // นามสกุล rebuilds full_name here, and a file carrying only ชื่อ-สกุล lands
    // as a combined name with the parts left empty — exactly the shape a
    // pre-0135 row already has.
    if (o.first_name_th || o.last_name_th) {
      o.full_name = [o.first_name_th, o.last_name_th].filter(Boolean).join(' ');
    }
    return o;
  }).filter((o) => o.full_name);
}

const HEADER_ALIASES = {
  path: ['path', 'ตำแหน่ง', 'สังกัด', 'ฝ่าย', 'role', 'สายงาน'],
  // NOTE — `ชื่อ` moved from full_name to first_name_th in 0135, so this module
  // and house/io.js now read the same Thai header the same way. Before that,
  // one importer took `ชื่อ` to mean the whole name and the other took it to
  // mean the given name: one word, two meanings, which is exactly how a file
  // lands in the wrong column and nobody can tell afterwards.
  full_name: ['full_name', 'fullname', 'name', 'ชื่อ-สกุล', 'ชื่อสกุล', 'ชื่อ-นามสกุล'],
  first_name_th: ['first_name_th', 'first_name', 'firstname', 'ชื่อ', 'ชื่อจริง'],
  last_name_th: ['last_name_th', 'last_name', 'lastname', 'นามสกุล', 'สกุล'],
  nickname: ['nickname', 'ชื่อเล่น'],
  student_id: ['student_id', 'studentid', 'รหัสนักศึกษา', 'รหัส'],
  year: ['year', 'ชั้นปี', 'ปี'],
  major: ['major', 'สาขา'],
  kkumail: ['kkumail', 'email', 'kku mail', 'อีเมล', 'e-mail'],
  confirmed: ['confirmed', 'ยืนยัน', 'สถานะ'],
};

function normHeader(h) {
  const t = cleanSpace(h).toLowerCase();
  for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
    if (aliases.some((a) => a.toLowerCase() === t)) return key;
  }
  return '';  // unknown column → ignored
}
