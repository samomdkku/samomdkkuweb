import { setAcademicYear } from './fields.js';
// ==============================================
// HOUSE API — every read/write for ระบบบ้าน, on dbRest.
//
// Two rules this file exists to hold:
//
// 1. EVERY DELETE asks for the deleted rows back and refuses to report success
//    on an empty array. PostgREST answers an RLS-blocked DELETE with 204 and
//    zero rows, NOT an error — the bug that made "ลบสมาชิกไม่ได้" invisible in
//    ทีม SAMO. `src/js/delete-guard.test.js` sweeps this file too.
//
// 2. `sais.house_id` is NEVER written and never computed here. It is a GENERATED
//    STORED column (migration 0116) and the database is the sole authority for
//    the house rule. houseOf() in ./fields.js exists only for the import preview.
// ==============================================
import { dbRest } from '../db.js';
// The สาขา vocabulary is faculty-wide (`team_majors`, migration 0113, widened to
// the `house` permission in 0125) and ทีม SAMO already owns the CRUD for it.
// Re-exported rather than re-queried: this app has three spellings of `MD` in
// its history from the last time one rule had two implementations.
export { fetchMajors } from '../team/api.js';
// The PERSON REGISTRY lookup (0137/0139), re-exported rather than re-queried for
// exactly the same reason as fetchMajors. `search_people` is SECURITY DEFINER and
// already granted to the `house` permission, and it is the only honest way to ask
// "is this person already in the system": a client-side scan of the `students`
// array this pane happens to hold answers "no" for every row RLS filtered out,
// which is a FAIL-OPEN — the shape that has produced three bugs here already.
export { searchPeople } from '../team/api.js';

const fail = (error, msg) => { throw new Error(error?.message || msg); };

// ---- settings ----
// REMOVED. ระบบบ้าน has no settings left: ปีการศึกษา fed ชั้นปี (gone, 0123),
// the roster switch gated a roster that no longer exists (0124), and the
// สายรหัส self-edit switch bounded an edit students can no longer make (0125).
// The `house_settings` row survives with its columns commented as vestigial;
// nothing in the app reads or writes it. Do not re-add a reader "just in case" —
// a settings object nobody uses is how a dead switch gets a UI again.

// ---- houses ----
export async function fetchHouses() {
  const { data, error } = await dbRest('/houses?select=*&order=id.asc');
  if (error) fail(error, 'โหลดข้อมูลบ้านไม่สำเร็จ');
  return data || [];
}

/** Houses are UPDATE-only by design — the ten rows are seeded and the set is
 *  fixed by the rule (one house per digit). There is no createHouse and no
 *  deleteHouse, and the migration revokes INSERT/DELETE so a stray call fails
 *  at the database rather than half-working. */
export async function updateHouse(id, patch) {
  const { data, error } = await dbRest(`/houses?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH', body: patch, prefer: 'return=representation',
  });
  if (error) fail(error, 'บันทึกบ้านไม่สำเร็จ');
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('บันทึกบ้านไม่สำเร็จ — ไม่พบบ้านนี้ หรือคุณไม่มีสิทธิ์แก้ไข');
  }
  return data[0];
}

// ---- สายรหัส ----
export async function fetchSais() {
  const { data, error } = await dbRest('/sais?select=code,house_id,label,note&order=code.asc');
  if (error) fail(error, 'โหลดสายรหัสไม่สำเร็จ');
  return data || [];
}

/**
 * Create any สายรหัส in `codes` that does not exist yet.
 *
 * MUST run before students are upserted: `students.sai_code` has a foreign key
 * to `sais`, and สาย are NOT a seeded range — they run to roughly the size of
 * the largest year (~287 and moving with enrolment), so the set is derived from
 * whatever the import file contains. Idempotent, so it is safe per chunk.
 */
export async function ensureSais(codes) {
  const list = [...new Set((codes || []).filter(Boolean))];
  if (!list.length) return 0;
  const { data, error } = await dbRest('/rpc/ensure_sais', {
    method: 'POST', body: { p_codes: list },
  });
  if (error) fail(error, 'สร้างสายรหัสไม่สำเร็จ');
  return data || 0;
}

// ---- advisors ----
export async function fetchAdvisors() {
  const { data, error } = await dbRest(
    '/advisors?select=*,sai_advisors(sai_code,role,position)&order=full_name.asc');
  if (error) fail(error, 'โหลดรายชื่ออาจารย์ไม่สำเร็จ');
  return data || [];
}

export async function createAdvisor(row) {
  const { data, error } = await dbRest('/advisors', {
    method: 'POST', body: row, prefer: 'return=representation',
  });
  if (error) fail(error, 'เพิ่มอาจารย์ไม่สำเร็จ');
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('เพิ่มอาจารย์ไม่สำเร็จ (สิทธิ์ไม่พอ)');
  }
  return data[0];
}

export async function updateAdvisor(id, patch) {
  const { data, error } = await dbRest(`/advisors?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH', body: patch, prefer: 'return=representation',
  });
  if (error) fail(error, 'บันทึกอาจารย์ไม่สำเร็จ');
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('บันทึกอาจารย์ไม่สำเร็จ (สิทธิ์ไม่พอ)');
  }
  return data[0];
}

export async function deleteAdvisor(id) {
  const { data, error } = await dbRest(`/advisors?id=eq.${encodeURIComponent(id)}`, {
    method: 'DELETE', prefer: 'return=representation',
  });
  if (error) fail(error, 'ลบอาจารย์ไม่สำเร็จ');
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('ลบอาจารย์ไม่สำเร็จ — ไม่พบรายการ หรือคุณไม่มีสิทธิ์ลบ');
  }
}

/** Replace an advisor's สาย assignments wholesale. Delete-then-insert rather
 *  than a diff: the set is at most a handful of rows, and a diff would be more
 *  code with more ways to leave a stale link behind. */
export async function setAdvisorSais(advisorId, saiCodes) {
  const id = encodeURIComponent(advisorId);
  // delete-guard:allow-empty — clearing the links of an advisor who has none
  // yet legitimately deletes zero rows, so this delete must NOT throw on an
  // empty result. Every OTHER delete in this file must. The marker is what
  // exempts it in delete-guard.test.js; do not add it without a reason like
  // this one.
  const { error: delErr } = await dbRest(`/sai_advisors?advisor_id=eq.${id}`, {
    method: 'DELETE', prefer: 'return=representation',
  });
  if (delErr) fail(delErr, 'อัปเดตสายของอาจารย์ไม่สำเร็จ');
  if (!saiCodes.length) return;
  const { error } = await dbRest('/sai_advisors', {
    method: 'POST',
    body: saiCodes.map((code, i) => ({ sai_code: code, advisor_id: advisorId, position: i })),
    prefer: 'return=representation',
  });
  if (error) fail(error, 'อัปเดตสายของอาจารย์ไม่สำเร็จ');
}

/**
 * The สาย-first half of the same link table.
 *
 * `setAdvisorSais` above answers "which สาย does this อาจารย์ look after"; these
 * two answer "which อาจารย์ look after this สาย". Both write `sai_advisors`, and
 * they must stay consistent: one link row, whichever direction created it. That
 * is why this pair adds and removes ONE row instead of replacing a set — a
 * สาย-side "replace everything for this สาย" would silently drop links the
 * advisor-side editor had just made.
 */
export async function addSaiAdvisor(saiCode, advisorId, position = 0) {
  const { data, error } = await dbRest('/sai_advisors', {
    method: 'POST',
    body: { sai_code: saiCode, advisor_id: advisorId, position },
    prefer: 'return=representation',
  });
  if (error) fail(error, 'เพิ่มอาจารย์ให้สายนี้ไม่สำเร็จ');
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('เพิ่มอาจารย์ให้สายนี้ไม่สำเร็จ (สิทธิ์ไม่พอ)');
  }
  return data[0];
}

export async function removeSaiAdvisor(saiCode, advisorId) {
  const { data, error } = await dbRest(
    `/sai_advisors?sai_code=eq.${encodeURIComponent(saiCode)}`
    + `&advisor_id=eq.${encodeURIComponent(advisorId)}`, {
      method: 'DELETE', prefer: 'return=representation',
    });
  if (error) fail(error, 'นำอาจารย์ออกจากสายนี้ไม่สำเร็จ');
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('นำอาจารย์ออกจากสายนี้ไม่สำเร็จ — ไม่พบรายการ หรือคุณไม่มีสิทธิ์ลบ');
  }
}

// ---- students ----
// Named, never `select=*` — a future ALTER TABLE must not auto-publish a column
// to the admin table by accident. Five columns left this list in 0129
// (year_override, is_listed, verified_at, sai_locked, sai_self_edits): each was
// the leftover of a feature removed in 0123–0125, and asking PostgREST for a
// column that no longer exists is a 400 on the whole query.
const STUDENT_COLS = [
  'id', 'kkumail', 'student_id', 'first_name_th', 'last_name_th', 'full_name',
  'nickname', 'nickname_imported', 'nickname_self', 'major', 'sai_code',
  'cohort_year', 'year_offset', 'photo_url', 'bio', 'missing_since', 'updated_at',
  // Which columns this person has taken over (0125). Fetched because the import
  // PREVIEW has to say "this row will not be overwritten" BEFORE the write —
  // the table enforces it either way, but a preview that promises a change the
  // trigger will refuse is a preview nobody can trust.
  'self_edited',
].join(',');

/**
 * The registry's confirmation stamp, EMBEDDED rather than duplicated.
 *
 * `identity_confirmed_at` is a fact about the PERSON (0138), not about this
 * placement, and copying it onto `students` would be a second home for one
 * value — the class the whole registry exists to end.
 *
 * ⚠️ SEPARATE from STUDENT_COLS, and `fetchStudents` falls back to the plain
 * list if it fails. An embed depends on a foreign key AND on the caller being
 * able to read the embedded table, and PostgREST answers a bad `select` by
 * failing the WHOLE query — so a mistake here does not lose one column, it
 * loses the นักศึกษา tab. That is not hypothetical: 0129 took this exact tab
 * down for ~20 minutes by naming a column PostgREST did not recognise.
 */
const STUDENT_EMBED = ',people(identity_confirmed_at)';

export async function fetchStudents({ withCheck = true } = {}) {
  // Paged: PostgREST caps a response and ~1,800 rows is comfortably over the
  // default limit on some deployments. Asking explicitly is cheaper than
  // discovering a silently truncated roster.
  const out = [];
  const page = 1000;
  const cols = STUDENT_COLS + (withCheck ? STUDENT_EMBED : '');
  for (let from = 0; ; from += page) {
    const { data, error } = await dbRest(
      `/students?select=${cols}&order=sai_code.asc,full_name.asc`,
      { headers: { Range: `${from}-${from + page - 1}`, 'Range-Unit': 'items' } });
    // The embed is the only part of this select that can fail for a reason
    // outside this file (an FK, a policy on `people`). Losing the ยังไม่ได้ตรวจ
    // filter is a small thing; losing the roster is not.
    if (error && withCheck && from === 0) {
      console.warn('house: identity-check embed failed, loading without it:', error);
      return fetchStudents({ withCheck: false });
    }
    // 416 means the range starts past the last row, which happens whenever the
    // total is an exact multiple of `page` — the loop below would otherwise
    // break only on a SHORT page and ask for one range too many. Treat it as
    // "no more rows", not as a failed load.
    if (error && error.status === 416) break;
    if (error) fail(error, 'โหลดรายชื่อนักศึกษาไม่สำเร็จ');
    const rows = data || [];
    out.push(...rows);
    if (rows.length < page) break;
  }
  return out;
}

export async function createStudent(row) {
  const { data, error } = await dbRest('/students', {
    method: 'POST', body: row, prefer: 'return=representation',
  });
  if (error) fail(error, 'เพิ่มนักศึกษาไม่สำเร็จ');
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('เพิ่มนักศึกษาไม่สำเร็จ (สิทธิ์ไม่พอ)');
  }
  return data[0];
}

export async function updateStudent(id, patch) {
  const { data, error } = await dbRest(`/students?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH', body: patch, prefer: 'return=representation',
  });
  if (error) fail(error, 'บันทึกนักศึกษาไม่สำเร็จ');
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('บันทึกนักศึกษาไม่สำเร็จ (สิทธิ์ไม่พอ)');
  }
  return data[0];
}

/**
 * What deleting this ระบบบ้าน row will ACTUALLY remove (migration 0144).
 *
 * Asked SERVER-SIDE and not computed here on purpose: the admin who deletes a
 * student holds `house`, while `team_members` needs `team` — and RLS answers a
 * caller without it with ZERO ROWS rather than an error. A client-side "does
 * this person have a ตำแหน่ง?" check would therefore answer "no" for exactly the
 * person doing the delete, and the dialog would promise total erasure for
 * someone whose posting is about to survive (the 0143 fail-open, again).
 *
 * Best-effort: on any failure the caller falls back to the cautious wording.
 * The confirmation must never be BLOCKED by this lookup — it is there to make
 * the sentence more accurate, not to become a new way for ลบ to do nothing.
 */
export async function fetchDeleteImpact(id) {
  try {
    const { data, error } = await dbRest('/rpc/student_delete_impact', {
      method: 'POST', body: { p_student_id: id },
    });
    if (error || !data || data.found === false) return null;
    return data;
  } catch { return null; }
}

export async function deleteStudent(id) {
  const { data, error } = await dbRest(`/students?id=eq.${encodeURIComponent(id)}`, {
    method: 'DELETE', prefer: 'return=representation',
  });
  if (error) fail(error, 'ลบนักศึกษาไม่สำเร็จ');
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('ลบนักศึกษาไม่สำเร็จ — ไม่พบรายการ หรือคุณไม่มีสิทธิ์ลบ');
  }
}

/**
 * Upsert a chunk of imported rows on kkumail.
 *
 * `merge-duplicates` + the kkumail unique index means a re-import UPDATES rather
 * than duplicating. The body must only ever carry IMPORT-OWNED columns — never
 * nickname_self / photo_url / bio, which belong to the student. Enforced by the
 * caller building the payload, and by `io.test.js` asserting the key set.
 */
export async function upsertStudents(rows) {
  const { data, error } = await dbRest('/students?on_conflict=kkumail', {
    method: 'POST',
    body: rows,
    prefer: 'resolution=merge-duplicates,return=representation',
  });
  if (error) fail(error, 'นำเข้าข้อมูลไม่สำเร็จ');
  return data || [];
}

/**
 * Mark the students that the newest import file did NOT mention.
 *
 * The importer never deletes — a blind sync would wipe self-edits and anyone the
 * source happened to omit. It stamps `missing_since` instead so the gap is
 * visible and reversible. Chunked because the `in.()` filter goes in the URL and
 * a few hundred uuids would blow past the practical URL length.
 */
export async function markMissing(ids, when = new Date().toISOString()) {
  const CHUNK = 100;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const list = ids.slice(i, i + CHUNK).map((x) => `"${x}"`).join(',');
    const { error } = await dbRest(`/students?id=in.(${encodeURIComponent(list)})`, {
      method: 'PATCH', body: { missing_since: when }, prefer: 'return=minimal',
    });
    if (error) fail(error, 'บันทึกสถานะ “ไม่พบในไฟล์ล่าสุด” ไม่สำเร็จ');
  }
}

export async function createImportBatch(row) {
  const { data, error } = await dbRest('/student_import_batches', {
    method: 'POST', body: row, prefer: 'return=representation',
  });
  if (error) fail(error, 'บันทึกประวัติการนำเข้าไม่สำเร็จ');
  return (data && data[0]) || null;
}

/**
 * Stamp what the import ACTUALLY did.
 *
 * The batch row has to exist before the students are written (they carry
 * `last_import_batch`), so it is created with zeroed counts. Writing the
 * PLANNED counts at creation time would leave an audit row claiming a
 * successful import of N people after a run that died on chunk 3 — an audit
 * trail that lies is worse than none.
 */
export async function finishImportBatch(id, counts) {
  if (!id) return;
  const { error } = await dbRest(`/student_import_batches?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH', body: counts, prefer: 'return=minimal',
  });
  // Non-fatal: the students are already in. A failed bookkeeping write must not
  // report the import itself as failed.
  if (error) console.warn('[house] could not stamp import batch:', error.message);
}

// ---- change requests ----
export async function fetchRequests() {
  const { data, error } = await dbRest(
    '/student_change_requests?select=*,students(full_name,kkumail,sai_code)'
    + '&order=status.asc,created_at.desc');
  if (error) fail(error, 'โหลดคำขอแก้ไขไม่สำเร็จ');
  return data || [];
}

/**
 * Record the outcome of one คำขอแก้ไข.
 *
 * `applied` is what the admin ACTUALLY saved, and it is written only when it
 * differs from what the student asked for (0128). The student's card reads all
 * of status / decision_note / applied_value back through
 * `get_my_student_record()` — before 0128 an admin could type a reason into a
 * column that no student had any way to read.
 */
export async function decideRequest(id, status, note, userId, applied = null) {
  const { data, error } = await dbRest(
    `/student_change_requests?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: {
        status,
        decision_note: note || null,
        applied_value: applied || null,
        decided_by: userId || null,
        decided_at: new Date().toISOString(),
      },
      prefer: 'return=representation',
    });
  if (error) fail(error, 'บันทึกผลคำขอไม่สำเร็จ');
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('บันทึกผลคำขอไม่สำเร็จ (สิทธิ์ไม่พอ)');
  }
  return data[0];
}

// ---- the signed-in student's own record (public side) ----
export async function fetchMyStudentRecord() {
  const { data, error } = await dbRest('/rpc/get_my_student_record', { method: 'POST', body: {} });
  if (error) throw new Error(error.message || 'โหลดข้อมูลไม่สำเร็จ');
  return data || null;
}

/**
 * Save the caller's own identity — through the ONE writer (0132).
 *
 * It used to call `update_my_student_record` directly, which writes ระบบบ้าน and
 * nothing else. So a student who was also in ทีม SAMO could fix their ชื่อเล่น
 * here and their ทีม SAMO row would still say the old one — the exact "changing
 * user data on the web should sync with the teamsamo data and sync with the
 * ระบบบ้าน data" gap. `update_my_identity` writes the house placement, every
 * ทีม SAMO posting AND the registry row, and it still runs
 * update_my_student_record inside itself, so every validation rule (the รหัส
 * format, the uniqueness race, the สาขา vocabulary, "you may not erase a name
 * that exists") is unchanged and still raises before anything is written.
 *
 * It returns the whole profile; this unwraps the `house` half so every existing
 * caller keeps the shape it already expects.
 */
export async function saveMyStudentRecord(patch) {
  const { data, error } = await dbRest('/rpc/update_my_identity', {
    method: 'POST', body: { p_patch: patch },
  });
  if (error) throw new Error(error.message || 'บันทึกไม่สำเร็จ');
  return data?.house || null;
}

/** File a correction request for the CALLER's own record. The RPC resolves the
 *  student from auth.uid(), so there is no id to pass and no way to file one on
 *  someone else's behalf. */
export async function requestMyChange(field, requested, reason) {
  const { data, error } = await dbRest('/rpc/request_my_change', {
    method: 'POST',
    body: { p_field: field, p_requested: requested, p_reason: reason || null },
  });
  if (error) throw new Error(error.message || 'ส่งคำขอไม่สำเร็จ');
  return data || null;
}

// There is deliberately NO house-roster reader here. ระบบบ้าน publishes อาจารย์,
// never students: `get_house_roster()` was dropped in migration 0124 along with
// the setting that gated it. A student's card lists their own record and the
// อาจารย์ที่ปรึกษา of every สาย in their house — nobody else's name.


/**
 * The ปีการศึกษา every ชั้นปี is derived from (0141), primed into fields.js.
 *
 * Called once per page. A failure is not fatal and deliberately quiet: the
 * fallback is the clock, which is exactly what the app did before 0141, so a
 * bad network gives a possibly-stale ชั้นปี rather than none at all.
 */
export async function primeAcademicYear() {
  try {
    const { data, error } = await dbRest('/rpc/get_academic_year', { method: 'POST', body: {} });
    if (error) throw new Error(error.message || `HTTP ${error.status}`);
    setAcademicYear(data);
    return data;
  } catch (err) {
    console.warn('house: ปีการศึกษา lookup failed, falling back to the clock:', err);
    return null;
  }
}

/** Stored value + what the clock would have said + whether a move is due. */
export async function fetchAcademicYearStatus() {
  const { data, error } = await dbRest('/rpc/academic_year_status', { method: 'POST', body: {} });
  if (error) fail(error, 'อ่านปีการศึกษาไม่สำเร็จ');
  return data || null;
}

export async function saveAcademicYear(year) {
  const { data, error } = await dbRest('/rpc/set_academic_year', {
    method: 'POST', body: { p_year: Number(year) },
  });
  if (error) fail(error, 'เปลี่ยนปีการศึกษาไม่สำเร็จ');
  return data || null;
}


/**
 * How the data check is going — counts only.
 *
 * A LIST of who has not checked would be a roster projection, and publishing
 * one of those by accident is its own entry (0086/0103/0108). WHO is answered
 * per-row by the นักศึกษา table, which is already gated; this answers HOW MANY,
 * which is the question a week before an event.
 */
export async function fetchIdentityCheckSummary() {
  const { data, error } = await dbRest('/rpc/identity_check_summary', {
    method: 'POST', body: {},
  });
  if (error) fail(error, 'อ่านสถานะการตรวจสอบข้อมูลไม่สำเร็จ');
  return data || null;
}


/**
 * WHO has checked their record and who has not — over `people`, the same
 * population `identity_check_summary()` counts.
 *
 * ⚠️ NOT over `students`. That was the bug: the count read the registry (~300
 * humans, every ทีม SAMO member among them) and the list read house placements
 * (3 rows), so the screen showed a number in the hundreds beside a list of
 * three. Who-has-checked is a question about a person, not about where they
 * live.
 */
export async function fetchIdentityCheckList({
  status = 'all', q = '', limit = 100, offset = 0,
} = {}) {
  const { data, error } = await dbRest('/rpc/list_identity_check', {
    method: 'POST',
    body: {
      p_status: status, p_q: q, p_limit: limit, p_offset: offset,
    },
  });
  if (error) fail(error, 'โหลดรายชื่อการตรวจสอบข้อมูลไม่สำเร็จ');
  return data || { rows: [], total: 0 };
}

// ============================================================
// HELD SEATS — the lines the file named and could not address (0188)
// ============================================================

/**
 * Replace the open held list with what THIS file could not use.
 *
 * Called on every import, including one that held nothing: the table describes
 * the NEWEST file, so a run that resolves everybody has to be able to say so by
 * clearing it. An import that skipped this step when the list was empty would
 * leave last month's held rows standing as a claim about a file that no longer
 * mentions them.
 */
export async function recordUnresolved(batchId, rows) {
  const { data, error } = await dbRest('/rpc/record_unresolved_rows', {
    method: 'POST', body: { p_batch: batchId || null, p_rows: rows || [] },
  });
  if (error) fail(error, 'บันทึกรายชื่อที่ยังนำเข้าไม่ได้ไม่สำเร็จ');
  return data || { held: 0, already_in_system: 0 };
}

export async function fetchUnresolved(includeResolved = false) {
  const { data, error } = await dbRest('/rpc/list_unresolved_rows', {
    method: 'POST', body: { p_include_resolved: !!includeResolved },
  });
  if (error) throw new Error(error.message || 'โหลดรายชื่อที่ค้างไม่สำเร็จ');
  return Array.isArray(data) ? data : [];
}

/** Give a held row the address it was missing, turning it into a student. */
export async function promoteUnresolved(id, kkumail) {
  const { data, error } = await dbRest('/rpc/promote_unresolved_row', {
    method: 'POST', body: { p_id: id, p_kkumail: kkumail },
  });
  if (error) fail(error, 'เพิ่มนักศึกษาจากรายการค้างไม่สำเร็จ');
  return data;
}

/** Close a held row WITHOUT creating a student. The note is required by the RPC
 *  — this row is the only record that the person was ever sent to us, and a
 *  dismissal with no reason is indistinguishable from a mis-click a month on. */
export async function dismissUnresolved(id, note) {
  const { data, error } = await dbRest('/rpc/dismiss_unresolved_row', {
    method: 'POST', body: { p_id: id, p_note: note },
  });
  if (error) fail(error, 'ปิดรายการไม่สำเร็จ');
  return data;
}

/**
 * The signed-in student claims the seat the file held for them.
 *
 * Returns `{ ok: false, message }` for a miss rather than throwing: a miss is an
 * ordinary answer ("we do not have you yet"), not an error, and it deliberately
 * says the same thing whether the รหัส is unknown or the ชื่อ did not match —
 * otherwise the form becomes a way to test one guess at a time against a list of
 * 165 real students. A THROW here means something else went wrong (not signed
 * in, wrong domain, already has a record), and those do say which.
 */
export async function claimMySeat(studentId, firstName) {
  const { data, error } = await dbRest('/rpc/claim_my_student_seat', {
    method: 'POST', body: { p_student_id: studentId, p_first_name: firstName },
  });
  if (error) throw new Error(error.message || 'ยืนยันตัวตนไม่สำเร็จ');
  return data || { ok: false, message: 'ยืนยันตัวตนไม่สำเร็จ' };
}
