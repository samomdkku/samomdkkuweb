// ==============================================
// TEAM API — Supabase CRUD via dbRest()
//
// Backs the SAMO Team org tree (public.team_nodes) and its people
// (public.team_members). RLS gates everything to vp_admin + dev (0046).
//
// Writes use prefer: 'return=representation' + a length check so an RLS
// denial surfaces as a thrown error instead of silent success — same
// discipline as projects/api.js (see .claude/rules/mistakes.md).
// ==============================================

import { dbRest } from '../db.js';
import { deleteTeamFile } from '../uploads.js';

// ---- Photo lifecycle ----

/**
 * Trash a portrait in Drive, but ONLY once nothing points at it any more.
 *
 * The reference check is not defensive padding — `publish_team_term` copies
 * `photo_url` straight into `team_archive_members`, so the instant a
 * ปีการศึกษา is published every live portrait is referenced twice by the SAME
 * Drive file id. Deleting a member's photo without checking would blank their
 * card in an archived year, silently, months later. (The live data does not
 * show this yet only because nothing has been published with photos — the
 * mechanism is already there and will produce it on the next publish.)
 *
 * The same holds within the live table once one person can hold several
 * ตำแหน่ง sharing one photo.
 *
 * CALL THIS AFTER THE ROW IS ALREADY GONE OR ALREADY REPOINTED, never from a
 * form action — otherwise cancelling the editor would have destroyed a photo
 * the database still uses. With the write committed first, the count is simply
 * the truth.
 *
 * Best-effort and never throws: the DB write it follows has already succeeded.
 * Worst case a file lingers, which is exactly the status quo.
 */
/**
 * Which file, if any, this save has just stopped pointing at.
 *
 * ONE RULE, THREE WRITERS. The admin editor, the ข้อมูลของฉัน card and the
 * ระบบบ้าน crest editor all have to answer the same question, and they used to
 * answer it with three inline conditions — of which one (my-seat.js) did not
 * exist at all, which is how "เปลี่ยนรูป leaves the old picture in the drive"
 * shipped.
 *
 * THE KEY-PRESENCE TEST IS LOAD-BEARING. นำรูปออก sets the column to null, and
 * any `??` / `||` fallback reads that null as "the photo was not touched" and
 * skips the cleanup on the one action whose entire point is that the file
 * should be gone. So: absent key ⇒ untouched ⇒ keep; present-and-different ⇒
 * retire, whether the new value is a URL or null.
 *
 * @param {string} prevUrl the URL the row held BEFORE this save
 * @param {object} payload the patch about to be (or just) written
 * @param {string} [key] the column holding the file URL
 * @returns {string|null} the URL to hand to deleteTeamPhotoIfUnused, or null
 */
export function photoToRetire(prevUrl, payload, key = 'photo_url') {
  const prev = String(prevUrl || '').trim();
  if (!prev) return null;
  if (!payload || typeof payload !== 'object' || !(key in payload)) return null;
  const next = String(payload[key] ?? '').trim();
  return next === prev ? null : prev;
}

export async function deleteTeamPhotoIfUnused(photoUrl) {
  const url = String(photoUrl || '').trim();
  if (!url) return false;
  try {
    // ONE SERVER-SIDE COUNT, across all five tables that hold a photo_url
    // (migration 0143). It used to be two REST queries from here, and both
    // halves of that were wrong:
    //
    //  • the LIST was stale. `team_members` + `team_archive_members` was
    //    complete until 0132 gave `people` a photo_url and its mirror copied
    //    the same URL to `students`. Measured: deleting a member whose portrait
    //    had mirrored counted 0 while two other tables still pointed at the
    //    file, so it was trashed and both cards showed a broken image.
    //
    //  • and querying the extra tables from HERE cannot fix it. `students` and
    //    `advisors` are readable only with `house`; the admin who deletes
    //    ทีม SAMO members holds `team_edit`. RLS does not raise — it returns
    //    ZERO ROWS — so for exactly the caller who triggers this cleanup the
    //    extra queries would have answered "no references" and deleted the file
    //    anyway. A fail-open that looks identical to the truth.
    //
    // The definer counts what the caller cannot see and returns an integer,
    // which leaks nothing: they already hold the URL.
    const { data, error } = await dbRest('/rpc/photo_reference_count', {
      method: 'POST', body: { p_url: url },
    });
    // A failed count must NOT be read as "no references" — that is the
    // fail-open shape this repo keeps getting bitten by. Keep the file.
    if (error) {
      console.warn('[team/api] photo ref-count failed, keeping the file');
      return false;
    }
    const refs = Number(data);
    // NOT `refs > 0`. A non-numeric answer (null, undefined, a shape change on
    // the server) must also keep the file — only a definite zero may delete.
    if (!Number.isFinite(refs) || refs !== 0) return false;
    return await deleteTeamFile(url);
  } catch (e) {
    console.warn('[team/api] deleteTeamPhotoIfUnused failed:', e);
    return false;
  }
}

// ---- Reads ----

/** Load the whole tree + members in two flat queries. The caller builds
 *  the parent→child structure in memory. */
export async function fetchTree() {
  const [nodesRes, membersRes] = await Promise.all([
    dbRest('/team_nodes?select=*&order=position.asc,name.asc'),
    dbRest('/team_members?select=*&order=position.asc,full_name.asc'),
  ]);
  if (nodesRes.error) throw new Error(nodesRes.error.message || 'โหลดโครงสร้างทีมไม่สำเร็จ');
  if (membersRes.error) throw new Error(membersRes.error.message || 'โหลดสมาชิกทีมไม่สำเร็จ');
  return { nodes: nodesRes.data || [], members: membersRes.data || [] };
}

// ---- Nodes ----

export async function createNode(row) {
  if (!row?.name?.trim()) throw new Error('ต้องระบุชื่อตำแหน่ง/ฝ่าย');
  const { data, error } = await dbRest('/team_nodes', {
    method: 'POST',
    body: row,
    prefer: 'return=representation',
  });
  if (error) throw new Error(error.message || 'เพิ่มไม่สำเร็จ');
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('เพิ่มไม่สำเร็จ (สิทธิ์ไม่พอ)');
  }
  return data[0];
}

export async function updateNode(id, patch) {
  const { data, error } = await dbRest(`/team_nodes?id=eq.${id}`, {
    method: 'PATCH',
    body: patch,
    prefer: 'return=representation',
  });
  if (error) throw new Error(error.message || 'บันทึกไม่สำเร็จ');
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('บันทึกไม่สำเร็จ (สิทธิ์ไม่พอ)');
  }
  return data[0];
}

// An RLS-blocked DELETE is NOT an error — PostgREST returns 204 with zero rows
// deleted, so `if (error)` alone scores "you have no permission" as success and
// the row silently returns on the next reload (mistakes.md, "supabase-js
// silent-success on RLS-blocked updates / deletes"). Every delete below asks for
// the deleted rows back and refuses to report success on an empty set — the same
// shape createMember/updateMember above already use, and the one
// projects/api.js, vs-staff.js and announcements.js already use for DELETE.
export async function deleteNode(id) {
  const { data, error } = await dbRest(`/team_nodes?id=eq.${id}`, {
    method: 'DELETE',
    prefer: 'return=representation',
  });
  if (error) throw new Error(error.message || 'ลบไม่สำเร็จ');
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('ลบไม่สำเร็จ — ไม่พบตำแหน่งนี้ หรือคุณไม่มีสิทธิ์ลบ (ต้องมีสิทธิ์ ทีม SAMO (แก้ไข))');
  }
}

// ---- Members ----

export async function createMember(row) {
  if (!row?.node_id) throw new Error('ต้องระบุตำแหน่งของสมาชิก');
  // 0135 dropped `full_name`'s NOT NULL so the mirrors can carry a nameless
  // registry row without raising a 23502 from inside a trigger. The refusal
  // moved HERE, where it can say something a human can read — a new member
  // still needs a name, and the form asks for it as ชื่อ + นามสกุล.
  if (!row?.full_name?.trim() && !row?.first_name_th?.trim()) {
    throw new Error('ต้องระบุชื่อ-สกุล');
  }
  const { data, error } = await dbRest('/team_members', {
    method: 'POST',
    body: row,
    prefer: 'return=representation',
  });
  if (error) throw new Error(error.message || 'เพิ่มสมาชิกไม่สำเร็จ');
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('เพิ่มสมาชิกไม่สำเร็จ (สิทธิ์ไม่พอ)');
  }
  return data[0];
}

export async function updateMember(id, patch) {
  const { data, error } = await dbRest(`/team_members?id=eq.${id}`, {
    method: 'PATCH',
    body: patch,
    prefer: 'return=representation',
  });
  if (error) throw new Error(error.message || 'บันทึกสมาชิกไม่สำเร็จ');
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('บันทึกสมาชิกไม่สำเร็จ (สิทธิ์ไม่พอ)');
  }
  return data[0];
}

export async function deleteMember(id) {
  const { data, error } = await dbRest(`/team_members?id=eq.${id}`, {
    method: 'DELETE',
    prefer: 'return=representation',
  });
  if (error) throw new Error(error.message || 'ลบสมาชิกไม่สำเร็จ');
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('ลบสมาชิกไม่สำเร็จ — ไม่พบสมาชิกนี้ หรือคุณไม่มีสิทธิ์ลบ (ต้องมีสิทธิ์ ทีม SAMO (แก้ไข))');
  }
}

/** Persist a batch of {id, position[, parent_id|node_id]} updates after a
 *  drag. Runs them in parallel; rejects if any fail. */
export async function patchNodePositions(updates) {
  await Promise.all(updates.map((u) => {
    const { id, ...patch } = u;
    return updateNode(id, patch);
  }));
}

export async function patchMemberPositions(updates) {
  await Promise.all(updates.map((u) => {
    const { id, ...patch } = u;
    return updateMember(id, patch);
  }));
}

// ---- ปีการศึกษา + the archive (0104) ----
//
// The live tree is always the CURRENT term and carries no year. Past terms are a
// frozen snapshot in team_archive_nodes / team_archive_members, holding only the
// columns the public projection publishes — so an archived row has no column any
// permission resolver reads and cannot grant anything.

export async function fetchTerms() {
  const { data, error } = await dbRest('/team_terms?select=*&order=year.desc');
  if (error) throw new Error(error.message || 'โหลดปี SAMO ไม่สำเร็จ');
  return data || [];
}

export async function createTerm(year, label = null) {
  const { data, error } = await dbRest('/team_terms', {
    method: 'POST',
    body: { year, label },
    prefer: 'return=representation',
  });
  if (error) throw new Error(error.message || 'เพิ่มปี SAMO ไม่สำเร็จ');
  if (!Array.isArray(data) || !data.length) throw new Error('เพิ่มปี SAMO ไม่สำเร็จ (สิทธิ์ไม่พอ)');
  return data[0];
}

export async function updateTerm(year, patch) {
  const { data, error } = await dbRest(`/team_terms?year=eq.${year}`, {
    method: 'PATCH',
    body: patch,
    prefer: 'return=representation',
  });
  if (error) throw new Error(error.message || 'บันทึกไม่สำเร็จ');
  if (!Array.isArray(data) || !data.length) throw new Error('บันทึกไม่สำเร็จ (สิทธิ์ไม่พอ)');
  return data[0];
}

export async function deleteTerm(year) {
  // Cascades to team_archive_nodes → team_archive_members.
  const { data, error } = await dbRest(`/team_terms?year=eq.${year}`, {
    method: 'DELETE',
    prefer: 'return=representation',
  });
  if (error) throw new Error(error.message || 'ลบไม่สำเร็จ');
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('ลบไม่สำเร็จ — ไม่พบปีนี้ หรือคุณไม่มีสิทธิ์ลบ (ต้องมีสิทธิ์ ทีม SAMO (แก้ไข))');
  }
}

/**
 * Make `year` the live term — the SAMO-year handover (0219).
 *
 * This used to be two separate PATCH requests (clear the old current, then
 * set the new one), which this function's own comment flagged as "not atomic
 * — a failure between the two leaves NO current term". `start_team_term` does
 * both in ONE database transaction, and additionally stamps `started_at` /
 * `ended_at` so every other system's `samo_year_be` trigger can tell which
 * year a historical row actually belongs to (docs/YEAR-ROLLOVER.md).
 */
/** Start `year` as the ปี SAMO (start_samo_year, 0242). With `passport`
 *  ({ name, season }) the next Passport วาระสโม opens in the SAME transaction —
 *  both move or neither does. Omit it to move the ปี SAMO alone. */
export async function startSamoYear(year, passport = null) {
  const { data, error } = await dbRest('/rpc/start_samo_year', {
    method: 'POST',
    body: {
      p_year: year,
      p_passport_name: passport?.name || null,
      p_season_name: passport?.season || null,
    },
  });
  if (error) throw new Error(error.message || 'เริ่มปี SAMO ไม่สำเร็จ');
  return data;
}

/** Passport's open วาระสโม and its open season — the newest open row of each,
 *  the same rule passport.stamp_scan and passport/js/samo.js use. Both tables
 *  are world-readable (samo_years_read / samo_seasons_read = true). */
export async function fetchPassportTerm() {
  const h = { 'Accept-Profile': 'passport' };
  // season_status FIRST (0245): it applies a quarter boundary that passed with
  // nobody scanning, so the reads below never show yesterday's quarter. Its
  // answer also carries the schedule — what this page says changes next.
  const st = await dbRest('/rpc/season_status', {
    method: 'POST', body: {}, headers: { 'Content-Profile': 'passport' },
  });
  const [y, s] = await Promise.all([
    dbRest('/samo_years?select=id,name,started_at,team_term_year&ended_at=is.null&order=started_at.desc&limit=1', { headers: h }),
    dbRest('/samo_seasons?select=id,name,quarter,samo_year_id,started_at&ended_at=is.null&order=started_at.desc&limit=1', { headers: h }),
  ]);
  if (y.error) throw new Error(y.error.message || 'อ่านวาระสโมของ Passport ไม่สำเร็จ');
  return {
    term: (y.data || [])[0] || null,
    season: (s.data || [])[0] || null,
    status: st.error ? null : st.data || null,
  };
}

/** May this account open a Passport วาระ? Asked of the database's own answer
 *  (passport_admin_context, the test start_samo_year makes), not re-derived. */
export async function fetchPassportOrgWide() {
  const { data, error } = await dbRest('/rpc/passport_admin_context', { method: 'POST', body: {} });
  if (error) return false;
  return !!data?.all_departments;
}

/** Freeze the live tree into `year`'s archive. Re-runnable; replaces wholesale. */
export async function publishTerm(year) {
  const { data, error } = await dbRest('/rpc/publish_team_term', {
    method: 'POST',
    body: { p_year: year },
  });
  if (error) throw new Error(error.message || 'เผยแพร่ไม่สำเร็จ');
  return data;
}

/** The editable view of one archived year. */
export async function fetchArchive(year) {
  const [nodesRes, membersRes] = await Promise.all([
    dbRest(`/team_archive_nodes?year=eq.${year}&select=*&order=position.asc,name.asc`),
    dbRest(`/team_archive_members?year=eq.${year}&select=*&order=position.asc,full_name.asc`),
  ]);
  if (nodesRes.error) throw new Error(nodesRes.error.message || 'โหลดผังปีนี้ไม่สำเร็จ');
  if (membersRes.error) throw new Error(membersRes.error.message || 'โหลดรายชื่อปีนี้ไม่สำเร็จ');
  return { nodes: nodesRes.data || [], members: membersRes.data || [] };
}

export async function updateArchiveMember(id, patch) {
  const { data, error } = await dbRest(`/team_archive_members?id=eq.${id}`, {
    method: 'PATCH',
    body: patch,
    prefer: 'return=representation',
  });
  if (error) throw new Error(error.message || 'บันทึกไม่สำเร็จ');
  if (!Array.isArray(data) || !data.length) throw new Error('บันทึกไม่สำเร็จ (สิทธิ์ไม่พอ)');
  return data[0];
}

export async function deleteArchiveMember(id) {
  const { data, error } = await dbRest(`/team_archive_members?id=eq.${id}`, {
    method: 'DELETE',
    prefer: 'return=representation',
  });
  if (error) throw new Error(error.message || 'ลบไม่สำเร็จ');
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('ลบไม่สำเร็จ — ไม่พบสมาชิกนี้ หรือคุณไม่มีสิทธิ์ลบ (ต้องมีสิทธิ์ ทีม SAMO (แก้ไข))');
  }
}

export async function updateArchiveNode(id, patch) {
  const { data, error } = await dbRest(`/team_archive_nodes?id=eq.${id}`, {
    method: 'PATCH',
    body: patch,
    prefer: 'return=representation',
  });
  if (error) throw new Error(error.message || 'บันทึกไม่สำเร็จ');
  if (!Array.isArray(data) || !data.length) throw new Error('บันทึกไม่สำเร็จ (สิทธิ์ไม่พอ)');
  return data[0];
}

/**
 * Which snapshots are behind the live tree (0105).
 *
 * Only the CURRENT year can be "stale" — a past year is SUPPOSED to diverge from
 * the live tree; that is what an archive is. Server-side because it needs
 * max(updated_at) across both team tables.
 */
export async function fetchTermStatus() {
  const { data, error } = await dbRest('/rpc/team_term_status', { method: 'POST', body: {} });
  if (error) throw new Error(error.message || 'อ่านสถานะปี SAMO ไม่สำเร็จ');
  return data || { terms: [] };
}

// ---- สาขา vocabulary (migration 0113) ----
//
// A PICKER LIST, not a foreign key. `team_members.major` is plain text and this
// table only decides what the choosers offer, which is why `deleteMajor` below
// can be a one-liner with no cascade to reason about: removing a สาขา from the
// list leaves every person who has it exactly as they were. The migration
// header explains why an FK was rejected (removing reference data is what turns
// a resolver into a fail-open — the class logged in docs/mistakes/authz-rls.md).

export async function fetchMajors() {
  const { data, error } = await dbRest('/team_majors?select=*&order=position.asc,code.asc');
  if (error) throw new Error(error.message || 'โหลดรายการสาขาไม่สำเร็จ');
  return data || [];
}

export async function createMajor(row) {
  const { data, error } = await dbRest('/team_majors', {
    method: 'POST', body: row, prefer: 'return=representation',
  });
  if (error) throw new Error(error.message || 'เพิ่มสาขาไม่สำเร็จ');
  if (!Array.isArray(data) || !data.length) throw new Error('เพิ่มสาขาไม่สำเร็จ (สิทธิ์ไม่พอ)');
  return data[0];
}

export async function updateMajor(id, patch) {
  const { data, error } = await dbRest(`/team_majors?id=eq.${id}`, {
    method: 'PATCH', body: patch, prefer: 'return=representation',
  });
  if (error) throw new Error(error.message || 'บันทึกสาขาไม่สำเร็จ');
  if (!Array.isArray(data) || !data.length) throw new Error('บันทึกสาขาไม่สำเร็จ (สิทธิ์ไม่พอ)');
  return data[0];
}

export async function deleteMajor(id) {
  const { data, error } = await dbRest(`/team_majors?id=eq.${id}`, {
    method: 'DELETE',
    prefer: 'return=representation',
  });
  if (error) throw new Error(error.message || 'ลบสาขาไม่สำเร็จ');
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('ลบสาขาไม่สำเร็จ — ไม่พบสาขานี้ หรือคุณไม่มีสิทธิ์ลบ (ต้องมีสิทธิ์ ทีม SAMO (แก้ไข))');
  }
}

/**
 * How many member rows carry a given สาขา code — asked BEFORE a rename or a
 * remove, so the confirm can say "this touches 348 people" instead of leaving
 * the admin to guess.
 *
 * `eq`, NOT `ilike`. An ilike filter makes the value a PATTERN (the class logged
 * in docs/mistakes/authz-rls.md as "an ILIKE lookup makes the id a pattern, not
 * a capability"): a สาขา code containing `_` or `%` would silently match — and
 * on the rename below, silently REWRITE — other people's rows. Exact match is
 * correct because migration 0113 canonicalised every stored value to the
 * vocabulary's own spelling, and both writers normalise through fields.js.
 */
export async function countMembersWithMajor(code) {
  const c = String(code || '').trim();
  if (!c) return 0;
  const { data, error } = await dbRest(
    `/team_members?select=id&major=eq.${encodeURIComponent(c)}`,
  );
  if (error) throw new Error(error.message || 'นับจำนวนสมาชิกไม่สำเร็จ');
  return (data || []).length;
}

/** Rename a สาขา ON THE PEOPLE — the vocabulary row is renamed separately.
 *  Two writes, deliberately: the member rows are the data, the vocabulary row is
 *  only the picker, and doing them in one place makes the order explicit. */
export async function renameMajorOnMembers(fromCode, toCode) {
  const from = String(fromCode || '').trim();
  const to = String(toCode || '').trim();
  if (!from || !to || from === to) return 0;
  const { data, error } = await dbRest(
    `/team_members?major=eq.${encodeURIComponent(from)}`,
    { method: 'PATCH', body: { major: to }, prefer: 'return=representation' },
  );
  if (error) throw new Error(error.message || 'เปลี่ยนชื่อสาขาไม่สำเร็จ');
  return (data || []).length;
}

/**
 * Resolve ONE exact kkumail against ระบบบ้าน's student registry.
 *
 * The interim bridge between the two person tables (migration 0130): ทีม SAMO
 * and ระบบบ้าน hold the same fields for the same humans, keyed on the same
 * kkumail, and the ทีม SAMO form used to make an admin retype what the
 * university had already sent — which is where the two copies diverge.
 *
 * Exact match, one row or null, and a hand-built column list on the server
 * side. It is NOT a directory: there is no listing, no prefix search and no
 * count, so it can only confirm an address the caller already has. The full
 * merge is docs/PERSON-REGISTRY.md.
 *
 * @returns {Promise<object|null>} null when the address is not in ระบบบ้าน.
 */
export async function lookupStudentByKkumail(kkumail) {
  const v = String(kkumail || '').trim();
  if (!v) return null;
  const { data, error } = await dbRest('/rpc/lookup_student_by_kkumail', {
    method: 'POST', body: { p_kkumail: v },
  });
  if (error) throw new Error(error.message || 'ค้นข้อมูลจากระบบบ้านไม่สำเร็จ');
  return data || null;
}

/**
 * Find a person in the registry by anything a human actually knows about them.
 *
 * The counterpart to `lookupStudentByKkumail`, and the reason that one was not
 * enough: an exact kkumail lookup answers "confirm this address", but nobody
 * adding a member to ฝ่าย IT has the address — they have a name, a ชื่อเล่น or a
 * รหัสนักศึกษา. Asking for the one field the admin does not have is what made
 * them retype the other five, which is where two copies of one person diverge.
 *
 * Searches ชื่อ, นามสกุล, ชื่อเล่น, รหัสนักศึกษา (with or without its dash), สาขา
 * and kkumail across `public.people` (migration 0137). The server escapes the
 * wildcards, requires two characters, caps the result at 50 and publishes NO
 * placement facts — no สายรหัส and no บ้าน.
 *
 * Each hit carries `in_team` / `team_nodes` so the picker can say "already in
 * ฝ่าย X" instead of letting someone create the duplicate posting the registry
 * exists to prevent.
 *
 * @returns {Promise<object[]>} [] for a query too short to mean anything.
 */
export async function searchPeople(q, limit = 20) {
  const v = String(q || '').trim();
  if (v.length < 2) return [];
  const { data, error } = await dbRest('/rpc/search_people', {
    method: 'POST', body: { p_q: v, p_limit: limit },
  });
  if (error) throw new Error(error.message || 'ค้นหาบุคคลไม่สำเร็จ');
  return Array.isArray(data) ? data : [];
}
