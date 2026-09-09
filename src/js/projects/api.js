// ==============================================
// PROJECTS API — Supabase CRUD via dbRest()
//
// All writes use prefer: 'return=representation' + a length check so
// RLS denials surface as errors instead of silent success (mistakes.md).
// ==============================================

import { dbRest } from '../db.js';
import { genProjectId, genDocumentId, genSignRequestId } from './data.js';

// ---- Doc types ----

export async function listDocTypes({ activeOnly = true } = {}) {
  const filter = activeOnly ? '&is_active=eq.true' : '';
  const { data, error } = await dbRest(
    `/project_doc_types?select=*${filter}&order=sort_order.asc,label_th.asc`,
  );
  if (error) throw new Error(error.message || 'โหลดประเภทหนังสือไม่สำเร็จ');
  return data || [];
}

export async function upsertDocType(row) {
  if (!row?.id || !row?.label_th) throw new Error('id และ label_th จำเป็น');
  const { data, error } = await dbRest(
    `/project_doc_types?on_conflict=id`,
    {
      method: 'POST',
      body: row,
      prefer: 'return=representation,resolution=merge-duplicates',
    },
  );
  if (error) throw new Error(error.message || 'บันทึกประเภทหนังสือไม่สำเร็จ');
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('บันทึกไม่สำเร็จ (RLS หรือสิทธิ์ไม่พอ)');
  }
  return data[0];
}

// ---- Projects ----

const PROJECT_FIELDS = '*,documents:project_documents(*,sign_requests:project_sign_requests(*))';

export async function listProjects({ status } = {}) {
  const filter = status ? `&status=eq.${encodeURIComponent(status)}` : '';
  const { data, error } = await dbRest(
    `/projects?select=${PROJECT_FIELDS}${filter}&order=created_at.desc`,
  );
  if (error) throw new Error(error.message || 'โหลดโครงการไม่สำเร็จ');
  return data || [];
}

export async function getProject(id) {
  const idEsc = encodeURIComponent(id);
  const { data, error } = await dbRest(
    `/projects?select=${PROJECT_FIELDS}&id=eq.${idEsc}`,
  );
  if (error) throw new Error(error.message || 'โหลดโครงการไม่สำเร็จ');
  return (data && data[0]) || null;
}

export async function createProject({ name, description, createdBy }) {
  if (!name) throw new Error('ต้องระบุชื่อโครงการ');
  let lastErr;
  for (let attempt = 0; attempt < 5; attempt++) {
    const id = genProjectId();
    const row = {
      id,
      name,
      description: description || null,
      status: 'open',
      created_by: createdBy || null,
    };
    const { data, error } = await dbRest(
      '/projects',
      { method: 'POST', body: row, prefer: 'return=representation' },
    );
    if (error) {
      const msg = (error.message || '').toLowerCase();
      if (msg.includes('duplicate') || msg.includes('unique')) { lastErr = error; continue; }
      throw new Error(error.message || 'สร้างโครงการไม่สำเร็จ');
    }
    if (!Array.isArray(data) || data.length === 0) {
      throw new Error('สร้างโครงการไม่สำเร็จ (RLS หรือสิทธิ์ไม่พอ)');
    }
    return data[0];
  }
  throw new Error(lastErr?.message || 'สร้างโครงการไม่สำเร็จ (เลขซ้ำ)');
}

export async function updateProject(id, patch) {
  const idEsc = encodeURIComponent(id);
  const { data, error } = await dbRest(
    `/projects?id=eq.${idEsc}`,
    { method: 'PATCH', body: patch, prefer: 'return=representation' },
  );
  if (error) throw new Error(error.message || 'อัปเดตโครงการไม่สำเร็จ');
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('อัปเดตโครงการไม่สำเร็จ (RLS หรือไม่พบ id)');
  }
  return data[0];
}

/** Best-effort cache of a project's resolved Drive folder location so the
 *  QR feature can skip the GAS round-trip on every subsequent open
 *  (migration 0039). Silent by design: anon customers (no UPDATE rights)
 *  and pre-migration DBs (column missing → 400) just no-op — the QR still
 *  works via the GAS fallback. `return=minimal` so an owner-scoped SELECT
 *  policy can't turn a successful write into a false failure. */
export async function cacheProjectFolder(id, { folderUrl, folderId } = {}) {
  if (!id || !folderUrl) return;
  try {
    await dbRest(
      `/projects?id=eq.${encodeURIComponent(id)}`,
      {
        method: 'PATCH',
        body: { drive_folder_url: folderUrl, drive_folder_id: folderId || null },
        prefer: 'return=minimal',
      },
    );
  } catch { /* best-effort — never block the QR on the cache write */ }
}

export async function deleteProject(id) {
  const idEsc = encodeURIComponent(id);
  const { data, error } = await dbRest(
    `/projects?id=eq.${idEsc}`,
    { method: 'DELETE', prefer: 'return=representation' },
  );
  if (error) throw new Error(error.message || 'ลบโครงการไม่สำเร็จ');
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('ลบโครงการไม่สำเร็จ (RLS หรือไม่พบ id)');
  }
  return true;
}

// ---- Documents ----

const DOC_FIELDS = '*,files:project_files(*),sign_requests:project_sign_requests(*)';

export async function listDocuments({ projectId, status } = {}) {
  const parts = ['select=' + encodeURIComponent(DOC_FIELDS), 'order=sent_at.desc.nullslast,created_at.desc'];
  if (projectId) parts.push(`project_id=eq.${encodeURIComponent(projectId)}`);
  if (status)    parts.push(`status=eq.${encodeURIComponent(status)}`);
  const { data, error } = await dbRest(`/project_documents?${parts.join('&')}`);
  if (error) throw new Error(error.message || 'โหลดหนังสือไม่สำเร็จ');
  return data || [];
}

export async function getDocument(id) {
  const idEsc = encodeURIComponent(id);
  const { data, error } = await dbRest(
    `/project_documents?select=${DOC_FIELDS}&id=eq.${idEsc}`,
  );
  if (error) throw new Error(error.message || 'โหลดหนังสือไม่สำเร็จ');
  return (data && data[0]) || null;
}

/** Allocate the next sequence_no for a project. */
export async function nextSequenceNo(projectId) {
  const projEsc = encodeURIComponent(projectId);
  const { data, error } = await dbRest(
    `/project_documents?select=sequence_no&project_id=eq.${projEsc}&order=sequence_no.desc&limit=1`,
  );
  if (error) throw new Error(error.message || 'คำนวณลำดับหนังสือไม่สำเร็จ');
  const top = (data && data[0]?.sequence_no) || 0;
  return top + 1;
}

export async function createDocument({ projectId, typeId, title, note, driveFolder, createdBy, status = 'sent' }) {
  if (!projectId) throw new Error('project_id required');
  if (!typeId)    throw new Error('type_id required');
  if (!title)     throw new Error('ต้องระบุชื่อหนังสือ');
  const seq = await nextSequenceNo(projectId);
  const now = new Date().toISOString();
  let lastErr;
  for (let attempt = 0; attempt < 5; attempt++) {
    const id = genDocumentId();
    const row = {
      id,
      project_id: projectId,
      type_id: typeId,
      title,
      note: note || null,
      sequence_no: seq,
      status,
      sent_at: status === 'sent' ? now : null,
      timeline: [{
        at: now,
        by: createdBy || null,
        role: 'vp_admin',
        action: status === 'sent' ? 'sent' : 'draft',
        note: status === 'sent' ? 'ส่งหนังสือ' : 'สร้างฉบับร่าง',
      }],
      drive_folder: driveFolder || null,
      created_by: createdBy || null,
    };
    const { data, error } = await dbRest(
      '/project_documents',
      { method: 'POST', body: row, prefer: 'return=representation' },
    );
    if (error) {
      const msg = (error.message || '').toLowerCase();
      if (msg.includes('duplicate') || msg.includes('unique')) { lastErr = error; continue; }
      throw new Error(error.message || 'สร้างหนังสือไม่สำเร็จ');
    }
    if (!Array.isArray(data) || data.length === 0) {
      throw new Error('สร้างหนังสือไม่สำเร็จ (RLS หรือสิทธิ์ไม่พอ)');
    }
    return data[0];
  }
  throw new Error(lastErr?.message || 'สร้างหนังสือไม่สำเร็จ (เลขซ้ำ)');
}

/** Update arbitrary fields on a document. */
export async function updateDocument(id, patch) {
  const idEsc = encodeURIComponent(id);
  const { data, error } = await dbRest(
    `/project_documents?id=eq.${idEsc}`,
    { method: 'PATCH', body: patch, prefer: 'return=representation' },
  );
  if (error) throw new Error(error.message || 'อัปเดตหนังสือไม่สำเร็จ');
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('อัปเดตหนังสือไม่สำเร็จ (RLS หรือไม่พบ id)');
  }
  return data[0];
}

/**
 * Append a timeline entry AND patch the status / timestamps in one PATCH.
 * Re-reads the current row to merge the timeline server-side-safely.
 */
export async function appendDocTimeline(id, entry, extra = {}) {
  const current = await getDocument(id);
  if (!current) throw new Error('ไม่พบหนังสือ');
  const timeline = Array.isArray(current.timeline) ? current.timeline.slice() : [];
  timeline.push({ at: new Date().toISOString(), ...entry });
  return updateDocument(id, { timeline, ...extra });
}

export async function deleteDocument(id) {
  const idEsc = encodeURIComponent(id);
  const { data, error } = await dbRest(
    `/project_documents?id=eq.${idEsc}`,
    { method: 'DELETE', prefer: 'return=representation' },
  );
  if (error) throw new Error(error.message || 'ลบหนังสือไม่สำเร็จ');
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('ลบหนังสือไม่สำเร็จ (RLS หรือไม่พบ id)');
  }
  return true;
}

// ---- Files ----

export async function listFiles(documentId, { includeSuperseded = false } = {}) {
  const docEsc = encodeURIComponent(documentId);
  const sup = includeSuperseded ? '' : '&superseded_by=is.null';
  const { data, error } = await dbRest(
    `/project_files?select=*&document_id=eq.${docEsc}${sup}&order=uploaded_at.asc`,
  );
  if (error) throw new Error(error.message || 'โหลดไฟล์ไม่สำเร็จ');
  return data || [];
}

export async function createFile(row) {
  if (!row?.document_id || !row?.drive_view_url) throw new Error('document_id และ drive_view_url required');
  const { data, error } = await dbRest(
    '/project_files',
    { method: 'POST', body: row, prefer: 'return=representation' },
  );
  // The file is ALREADY in Drive by the time this runs (the caller uploads
  // first), so the message has to tell a human that — 0181 put the raw
  // PostgREST sentence `new row violates row-level security policy for table
  // "project_files"` into an alert() in front of an อาจารย์, which is the exact
  // shape rest-error.js was written to stop. Say what happened and what to do;
  // keep the machine's own words after it for whoever is reading a screenshot.
  const detail = (error?.message || '').trim();
  if (error || !Array.isArray(data) || data.length === 0) {
    throw new Error(
      'บันทึกไฟล์ไม่สำเร็จ — ระบบไม่มีสิทธิ์บันทึกไฟล์นี้ ไฟล์จึงยังไม่ถูกแนบ '
      + 'กรุณาแจ้งผู้ดูแลระบบ'
      + (detail ? `\n\n[${detail}]` : ''),
    );
  }
  return data[0];
}

export async function deleteFile(id) {
  const idEsc = encodeURIComponent(id);
  const { data, error } = await dbRest(
    `/project_files?id=eq.${idEsc}`,
    { method: 'DELETE', prefer: 'return=representation' },
  );
  if (error) throw new Error(error.message || 'ลบไฟล์ไม่สำเร็จ');
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('ลบไฟล์ไม่สำเร็จ (RLS หรือไม่พบ id)');
  }
  return true;
}

/** Mark an old file superseded by a new one (non-destructive replace). */
export async function supersedeFile(oldId, newId) {
  const oldIdEsc = encodeURIComponent(oldId);
  const { data, error } = await dbRest(
    `/project_files?id=eq.${oldIdEsc}`,
    { method: 'PATCH', body: { superseded_by: newId }, prefer: 'return=representation' },
  );
  if (error) throw new Error(error.message || 'แทนที่ไฟล์ไม่สำเร็จ');
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('แทนที่ไฟล์ไม่สำเร็จ (RLS หรือไม่พบ id)');
  }
  return data[0];
}

// ---- Sign requests (professor signing workflow) ----

const SIGN_FIELDS = '*';

/** Create a signing request: a bundle of selected files from one หนังสือ,
 *  addressed to the professor (prof_id). Caller is uni_staff/dev — a
 *  project actor — so the SELECT policy (`actor OR prof_id=auth.uid()`)
 *  passes and return=representation is safe here (unlike createNotification). */
export async function createSignRequest({ documentId, profId, fileIds, note, requestedBy }) {
  if (!documentId) throw new Error('document_id required');
  if (!Array.isArray(fileIds) || fileIds.length === 0) throw new Error('เลือกไฟล์อย่างน้อย 1 ไฟล์');
  const now = new Date().toISOString();
  let lastErr;
  for (let attempt = 0; attempt < 5; attempt++) {
    const id = genSignRequestId();
    const row = {
      id,
      document_id: documentId,
      prof_id: profId || null,
      status: 'pending',
      note: note || null,
      file_ids: fileIds,
      requested_by: requestedBy || null,
      requested_at: now,
      timeline: [{ at: now, by: requestedBy || null, role: 'uni_staff', action: 'requested', note: note || 'ส่งให้อาจารย์ลงนาม' }],
    };
    const { data, error } = await dbRest(
      '/project_sign_requests',
      { method: 'POST', body: row, prefer: 'return=representation' },
    );
    if (error) {
      const msg = (error.message || '').toLowerCase();
      if (msg.includes('duplicate') || msg.includes('unique')) { lastErr = error; continue; }
      throw new Error(error.message || 'สร้างคำขอลงนามไม่สำเร็จ');
    }
    if (!Array.isArray(data) || data.length === 0) {
      throw new Error('สร้างคำขอลงนามไม่สำเร็จ (RLS หรือสิทธิ์ไม่พอ)');
    }
    return data[0];
  }
  throw new Error(lastErr?.message || 'สร้างคำขอลงนามไม่สำเร็จ (เลขซ้ำ)');
}

export async function getSignRequest(id) {
  const idEsc = encodeURIComponent(id);
  const { data, error } = await dbRest(
    `/project_sign_requests?select=${SIGN_FIELDS}&id=eq.${idEsc}`,
  );
  if (error) throw new Error(error.message || 'โหลดคำขอลงนามไม่สำเร็จ');
  return (data && data[0]) || null;
}

export async function updateSignRequest(id, patch) {
  const idEsc = encodeURIComponent(id);
  const { data, error } = await dbRest(
    `/project_sign_requests?id=eq.${idEsc}`,
    { method: 'PATCH', body: patch, prefer: 'return=representation' },
  );
  if (error) throw new Error(error.message || 'อัปเดตคำขอลงนามไม่สำเร็จ');
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('อัปเดตคำขอลงนามไม่สำเร็จ (RLS หรือไม่พบ id)');
  }
  return data[0];
}

/** Append a timeline entry AND patch the request in one round-trip
 *  (re-reads to merge timeline server-side-safely, like appendDocTimeline). */
export async function appendSignTimeline(id, entry, extra = {}) {
  const current = await getSignRequest(id);
  if (!current) throw new Error('ไม่พบคำขอลงนาม');
  const timeline = Array.isArray(current.timeline) ? current.timeline.slice() : [];
  timeline.push({ at: new Date().toISOString(), ...entry });
  return updateSignRequest(id, { timeline, ...extra });
}

export async function deleteSignRequest(id) {
  const idEsc = encodeURIComponent(id);
  const { data, error } = await dbRest(
    `/project_sign_requests?id=eq.${idEsc}`,
    { method: 'DELETE', prefer: 'return=representation' },
  );
  if (error) throw new Error(error.message || 'ยกเลิกคำขอลงนามไม่สำเร็จ');
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('ยกเลิกคำขอลงนามไม่สำเร็จ (RLS หรือไม่พบ id)');
  }
  return true;
}

// ---- Notifications ----

export async function listMyNotifications(userId, { limit = 50, unreadOnly = false } = {}) {
  if (!userId) return [];
  const idEsc = encodeURIComponent(userId);
  const unread = unreadOnly ? '&is_read=eq.false' : '';
  const { data, error } = await dbRest(
    `/project_notifications?select=*&user_id=eq.${idEsc}${unread}&order=created_at.desc&limit=${limit}`,
  );
  if (error) throw new Error(error.message || 'โหลดการแจ้งเตือนไม่สำเร็จ');
  return data || [];
}

export async function countMyUnread(userId) {
  if (!userId) return 0;
  const idEsc = encodeURIComponent(userId);
  const { data, error } = await dbRest(
    `/project_notifications?select=id&user_id=eq.${idEsc}&is_read=eq.false`,
    { headers: { Prefer: 'count=exact' } },
  );
  if (error) return 0;
  return Array.isArray(data) ? data.length : 0;
}

export async function createNotification(row) {
  if (!row?.user_id || !row?.kind || !row?.body) throw new Error('user_id, kind, body required');
  // NOTE: do NOT ask for return=representation. The row's user_id is the
  // RECIPIENT (uni_staff), but the SELECT policy on project_notifications
  // is `user_id = auth.uid()`. Postgres requires INSERT...RETURNING rows
  // to pass the SELECT policy too, so the post-insert read would fail
  // for the SENDER (vp_admin) and the whole INSERT is rejected with
  // "new row violates row-level security policy" — same wording as a
  // WITH CHECK failure, which makes it look like an RLS-WITH-CHECK bug.
  // Fire-and-forget: callers ignore the return value.
  const { error } = await dbRest(
    '/project_notifications',
    { method: 'POST', body: row, prefer: 'return=minimal' },
  );
  if (error) { console.warn('[projects] notification insert failed:', error.message); return null; }
  return null;
}

export async function markNotificationRead(id) {
  const idEsc = encodeURIComponent(id);
  const { error } = await dbRest(
    `/project_notifications?id=eq.${idEsc}`,
    { method: 'PATCH', body: { is_read: true } },
  );
  return !error;
}

export async function markAllNotificationsRead(userId) {
  if (!userId) return false;
  const idEsc = encodeURIComponent(userId);
  const { error } = await dbRest(
    `/project_notifications?user_id=eq.${idEsc}&is_read=eq.false`,
    { method: 'PATCH', body: { is_read: true } },
  );
  return !error;
}

// ---- Settings ----

export async function getSettings() {
  const { data, error } = await dbRest('/project_settings?id=eq.1&select=*');
  if (error) throw new Error(error.message || 'โหลดการตั้งค่าไม่สำเร็จ');
  return (data && data[0]) || null;
}

export async function saveSettings(patch) {
  const { data, error } = await dbRest(
    '/project_settings?id=eq.1',
    { method: 'PATCH', body: patch, prefer: 'return=representation' },
  );
  if (error) throw new Error(error.message || 'บันทึกการตั้งค่าไม่สำเร็จ');
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('บันทึกการตั้งค่าไม่สำเร็จ (RLS หรือสิทธิ์ไม่พอ)');
  }
  return data[0];
}

// ---- Per-user doc-seen marker (cross-device sync) ----

/** Fetch every doc-view row for this user. Returns [] if migration 0031
 *  hasn't been applied yet (table missing) so the seenAt path can
 *  gracefully fall back to localStorage on legacy databases. */
export async function listMyDocViews(userId) {
  if (!userId) return [];
  const idEsc = encodeURIComponent(userId);
  const { data, error } = await dbRest(
    `/project_doc_views?select=document_id,seen_at&user_id=eq.${idEsc}`,
  );
  if (error) {
    const tableMissing = error.status === 404
      || /project_doc_views/i.test(error.message || '');
    if (tableMissing) {
      if (!window.__samoWarnedDocViews) {
        window.__samoWarnedDocViews = true;
        console.warn('[projects] project_doc_views missing — apply migration 0031 for cross-device seen-marker sync.');
      }
      return [];
    }
    console.warn('[projects] doc views fetch failed:', error.message);
    return [];
  }
  const rows = data || [];
  // One-shot diagnostic so cross-device sync failures show up in the
  // console without the user having to instrument anything. Zero rows
  // on a user who has actively been using the app on another device
  // means the upsert path is broken (RLS, FK, or schema mismatch).
  console.debug('[projects] loaded', rows.length, 'seenAt rows from project_doc_views for user', userId);
  return rows;
}

/** Upsert one user/doc view (used after every markDocSeen). Fire-and-
 *  forget: the localStorage write happened synchronously so the UI
 *  is already correct on this device; the server upsert is for the
 *  user's OTHER devices. Silently swallows table-missing errors so
 *  pre-0031 envs keep working off localStorage.
 *
 *  Uses return=representation + length check (mistakes.md "silent-
 *  success on RLS-blocked writes"). The SELECT policy on
 *  project_doc_views is `user_id = auth.uid()`, which matches the
 *  inserted row — so reading the row back succeeds for the owner.
 *  If length is 0 here, the row didn't land — that's a hard sync
 *  failure worth logging loudly so cross-device staleness is
 *  catchable from the console instead of being invisible. */
export async function upsertMyDocView(userId, documentId, seenAt) {
  if (!userId || !documentId) return;
  const row = {
    user_id:     userId,
    document_id: documentId,
    seen_at:     seenAt || new Date().toISOString(),
  };
  const { data, error } = await dbRest(
    '/project_doc_views?on_conflict=user_id,document_id',
    {
      method: 'POST',
      body: row,
      prefer: 'return=representation,resolution=merge-duplicates',
    },
  );
  if (error) {
    const tableMissing = error.status === 404
      || /project_doc_views/i.test(error.message || '');
    if (!tableMissing) {
      console.warn('[projects] doc view upsert failed:', error.status, error.message);
    }
    return;
  }
  if (!Array.isArray(data) || data.length === 0) {
    // Silent-success: PostgREST returned 2xx + empty array. With
    // return=representation that almost always means RLS hid the
    // inserted row from the SELECT (column constraint, identity mis-
    // match, JWT carrying a different sub). Cross-device sync is
    // BROKEN at this point — surface loudly so it's not invisible.
    console.warn('[projects] doc view upsert returned 0 rows — cross-device sync NOT working for', documentId, '(user', userId, ')');
  }
}

/** Bulk upsert (used on first-run-after-upgrade to migrate the legacy
 *  localStorage seenAt map up to the server in one round-trip). Same
 *  graceful fallback as upsertMyDocView on missing-table errors. */
export async function bulkUpsertMyDocViews(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return { migrated: 0 };
  const { error } = await dbRest(
    '/project_doc_views?on_conflict=user_id,document_id',
    {
      method: 'POST',
      body: rows,
      prefer: 'return=minimal,resolution=merge-duplicates',
    },
  );
  if (error) {
    const tableMissing = error.status === 404
      || /project_doc_views/i.test(error.message || '');
    if (!tableMissing) {
      console.warn('[projects] bulk doc-view upsert failed:', error.message);
    }
    return { migrated: 0, error };
  }
  return { migrated: rows.length };
}

// ---- Recipient lookup ----

/** Everyone who can be sent a document to sign: role `sa_prof` PLUS anyone
 *  granted the 'prof' seat through the SAMO Team tree (migration 0086).
 *  Goes through an RPC rather than a `users?role=eq.sa_prof` read because a
 *  seat lives in `managed_project_seats` (which that filter can't see) and
 *  because the RPC returns ONLY id + display name — a professor's email is
 *  not the sender's to read.
 *  Falls back to the pre-0086 role-only read if the RPC isn't there yet. */
/** Everyone occupying a หนังสือโครงการ seat — by role OR by ทีม SAMO grant
 *  (0091). Used to address notifications, which previously resolved every
 *  audience by role and so silently skipped seat holders.
 *  Falls back to the pre-0091 role-only read. */
/** Both of these used to fall back to a raw `/users?role=eq.<role>` read when
 *  the RPC was missing. That fallback is GONE (0147): `public.users` is
 *  self-read-only now, so the query it made would return an empty array anyway —
 *  but a "fallback" that reads the table we closed is the hole with a longer
 *  name, and it also could never see a tree-granted seat holder, which is the
 *  whole reason these RPCs were written. An RPC failure is now an empty
 *  audience, which is the honest answer. */
export async function listProjectSeatUsers(seat) {
  const { data, error } = await dbRest('/rpc/list_project_seat_users',
    { method: 'POST', body: { p_seat: seat } });
  if (!error && Array.isArray(data)) return data;
  console.error('[projects] list_project_seat_users failed:', error?.message || error);
  return [];
}

export async function listProjectProfs() {
  const { data, error } = await dbRest('/rpc/list_project_profs', { method: 'POST', body: {} });
  if (!error && Array.isArray(data)) return data;
  console.error('[projects] list_project_profs failed:', error?.message || error);
  return [];
}

// ---- Per-person inbox preferences (migration 0165) ----

/** The viewer's own ปีงบประมาณ default, or null when they have never set one.
 *
 *  Fails to null on EVERY error path on purpose: an absent row, an
 *  un-migrated DB and a network blip must all land on the app's
 *  pre-preference behaviour (ทุกปีงบ) rather than on an empty screen.
 *  RLS is own-row-only, so the `user_id=eq.` filter is belt-and-braces —
 *  it also keeps the request cheap. */
export async function getMyProjectPrefs(userId) {
  if (!userId) return null;
  const idEsc = encodeURIComponent(userId);
  const { data, error } = await dbRest(
    `/project_user_prefs?select=default_fiscal_year&user_id=eq.${idEsc}`,
  );
  if (error) {
    const tableMissing = error.status === 404
      || /project_user_prefs/i.test(error.message || '');
    if (!tableMissing) console.warn('[projects] prefs fetch failed:', error.message);
    return null;
  }
  return (data && data[0]) || null;
}

/** Save the viewer's ปีงบประมาณ default. Upsert on the pk so the second save
 *  updates rather than 409s. `return=representation` + a length check so an
 *  RLS denial surfaces as an error instead of a silent success (the standing
 *  rule in this file). */
export async function saveMyProjectDefaultFY(userId, value) {
  if (!userId) throw new Error('ไม่พบบัญชีผู้ใช้');
  const { data, error } = await dbRest(
    '/project_user_prefs?on_conflict=user_id',
    {
      method: 'POST',
      body: { user_id: userId, default_fiscal_year: value, updated_at: new Date().toISOString() },
      prefer: 'return=representation,resolution=merge-duplicates',
    },
  );
  if (error) throw new Error(error.message || 'บันทึกค่าเริ่มต้นไม่สำเร็จ');
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('บันทึกค่าเริ่มต้นไม่สำเร็จ (RLS หรือสิทธิ์ไม่พอ)');
  }
  return data[0];
}
