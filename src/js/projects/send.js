// ==============================================
// PROJECTS SEND — create-project / send-document flows (VP-Admin)
//
// One Bootstrap modal (`#projectSendModal`) does double duty:
//   - "create + (optional) first document": user fills project name +
//     optionally checks "ส่งหนังสือฉบับแรกตอนนี้เลย" to expose the doc
//     fields. On submit we create the project, then (if doc fields
//     present) create the document + upload files + notify p'nick.
//   - "add document to existing project": project is preselected and
//     locked; only doc fields are shown.
//
// Files are uploaded sequentially with simple progress text. Each upload
// goes to GAS uploadProjectFile under
// `Projects/<projectId>_<slug>/<docId>_<typeId>/`.
// ==============================================

import { escHtml } from '../utils.js';
import { getUser } from '../auth.js';
import {
  createProject,
  createDocument,
  createFile,
  listDocTypes,
  updateDocument,
} from './api.js';
import { uploadProjectFile } from './uploads.js';
import { holdAllInMemory } from '../read-file.js';
import { buildDocFolderPath } from './data.js';
import { notifyUniStaff } from './notify.js';
import { getCachedDocTypes } from './index.js';

let onCreated = () => {};
let modal = null;
let mode = 'create';   // 'create' | 'add-doc'
let lockedProject = null;
let pendingFiles = [];
// Copying the picked files' bytes into memory (read-file.js). Awaited at the
// top of onSubmit, BEFORE the project/หนังสือ rows exist: a file the phone will
// no longer read must fail while nothing has been created, never after a
// หนังสือ is already 'sent' with half its attachments.
let pendingHold = Promise.resolve();

function stageFiles(list) {
  const picked = Array.from(list || []);
  pendingFiles = picked.slice();
  renderFileList();
  const hold = holdAllInMemory(picked).then((held) => {
    const byPicked = new Map(picked.map((f, i) => [f, held[i]]));
    // Removals made while it was copying are kept: swap in place, never re-add.
    pendingFiles = pendingFiles.map((f) => byPicked.get(f) || f);
  });
  hold.catch(() => {}); // reported by onSubmit, where the person is waiting
  pendingHold = hold;
}

export function mountSendFlow({ onCreated: cb } = {}) {
  if (typeof cb === 'function') onCreated = cb;
  const modalEl = document.getElementById('projectSendModal');
  if (!modalEl) return;
  modal = window.bootstrap?.Modal.getOrCreateInstance(modalEl);

  // Toggle "send first doc now"
  document.getElementById('projectSendIncludeDoc')?.addEventListener('change', (e) => {
    document.getElementById('projectSendDocSection')?.classList.toggle('d-none', !e.target.checked);
  });

  // File input
  const fileInput = document.getElementById('projectSendFiles');
  fileInput?.addEventListener('change', () => {
    stageFiles(fileInput.files);
  });

  // Drag-drop
  const drop = document.getElementById('projectSendDropZone');
  if (drop) {
    drop.addEventListener('dragover',  (e) => { e.preventDefault(); drop.classList.add('is-drag'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('is-drag'));
    drop.addEventListener('drop', (e) => {
      e.preventDefault();
      drop.classList.remove('is-drag');
      stageFiles(e.dataTransfer.files);
    });
  }

  // Remove staged file
  document.getElementById('projectSendFileList')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-projects-remove-file]');
    if (!btn) return;
    const idx = parseInt(btn.dataset.projectsRemoveFile, 10);
    pendingFiles.splice(idx, 1);
    // Re-stage what is left: if the removed file was the unreadable one, its
    // failed hold must not keep blocking the send (a held File re-copies fine).
    stageFiles(pendingFiles);
  });

  // Submit
  document.getElementById('projectSendForm')?.addEventListener('submit', onSubmit);

  // Reset state when the modal closes
  modalEl.addEventListener('hidden.bs.modal', () => {
    pendingFiles = [];
    pendingHold = Promise.resolve();
    lockedProject = null;
    mode = 'create';
    document.getElementById('projectSendForm')?.reset();
    document.getElementById('projectSendFileList').innerHTML = '';
    document.getElementById('projectSendStatus').textContent = '';
  });
}

export async function openCreateProject() {
  mode = 'create';
  lockedProject = null;
  pendingFiles = [];
  pendingHold = Promise.resolve();
  await populateDocTypes();
  const projWrap = document.getElementById('projectSendProjectFields');
  const lockWrap = document.getElementById('projectSendLockedProject');
  const includeCk = document.getElementById('projectSendIncludeDoc');
  const docSection = document.getElementById('projectSendDocSection');
  if (projWrap) projWrap.classList.remove('d-none');
  if (lockWrap) lockWrap.classList.add('d-none');
  if (includeCk) { includeCk.checked = false; }
  if (docSection) docSection.classList.add('d-none');
  document.getElementById('projectSendIncludeDocWrap')?.classList.remove('d-none');
  document.getElementById('projectSendTitle').textContent = 'สร้างโครงการใหม่';
  modal?.show();
}

export async function openSendDocument({ project }) {
  if (!project) return openCreateProject();
  mode = 'add-doc';
  lockedProject = project;
  pendingFiles = [];
  pendingHold = Promise.resolve();
  await populateDocTypes();
  const projWrap = document.getElementById('projectSendProjectFields');
  const lockWrap = document.getElementById('projectSendLockedProject');
  if (projWrap) projWrap.classList.add('d-none');
  if (lockWrap) {
    lockWrap.classList.remove('d-none');
    lockWrap.innerHTML = `
      <div class="alert alert-light border d-flex align-items-center gap-2 small mb-0" role="alert">
        <i class="bi bi-folder2-open fs-5 text-success"></i>
        <div>
          <div class="text-muted" style="font-size: 0.78rem;">เพิ่มหนังสือในโครงการ</div>
          <div class="fw-bold">${escHtml(project.name)} <span class="text-muted ms-1">${escHtml(project.id)}</span></div>
        </div>
      </div>
    `;
  }
  // In add-doc mode, the "include doc" toggle is meaningless — always show.
  document.getElementById('projectSendIncludeDocWrap')?.classList.add('d-none');
  document.getElementById('projectSendDocSection')?.classList.remove('d-none');
  document.getElementById('projectSendTitle').textContent = 'ส่งหนังสือใหม่';
  modal?.show();
}

async function populateDocTypes() {
  const sel = document.getElementById('projectSendDocType');
  if (!sel) return;
  let types = getCachedDocTypes();
  if (!types || types.length === 0) {
    try { types = await listDocTypes({ activeOnly: true }); } catch { types = []; }
  }
  sel.innerHTML = '<option value="">— เลือกประเภทหนังสือ —</option>'
    + (types || []).filter((t) => t.is_active).map((t) =>
      `<option value="${escHtml(t.id)}">${escHtml(t.label_th)}</option>`
    ).join('');
}

function renderFileList() {
  const wrap = document.getElementById('projectSendFileList');
  if (!wrap) return;
  if (pendingFiles.length === 0) {
    wrap.innerHTML = '';
    return;
  }
  wrap.innerHTML = pendingFiles.map((f, i) => `
    <div class="projects-staged-file">
      <i class="bi bi-paperclip me-2 text-muted"></i>
      <span class="flex-grow-1 text-truncate">${escHtml(f.name)}</span>
      <span class="text-muted small mx-2">${escHtml(humanSize(f.size))}</span>
      <button type="button" class="btn btn-sm btn-ghost text-danger" data-projects-remove-file="${i}" aria-label="ลบ">
        <i class="bi bi-x-lg"></i>
      </button>
    </div>
  `).join('');
}

function humanSize(n) {
  const b = Number(n) || 0;
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

async function onSubmit(e) {
  e.preventDefault();
  const btn = document.getElementById('projectSendSubmit');
  const status = document.getElementById('projectSendStatus');
  const original = btn.innerHTML;
  btn.disabled = true;
  status.textContent = '';

  const includeDoc = mode === 'add-doc'
    || document.getElementById('projectSendIncludeDoc')?.checked;
  const user = getUser();

  try {
    if (includeDoc) await pendingHold;

    // 1) Project (create or use locked)
    let project = lockedProject;
    if (mode === 'create') {
      btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>กำลังสร้างโครงการ…';
      const name = document.getElementById('projectSendProjectName').value.trim();
      const desc = document.getElementById('projectSendProjectDesc').value.trim();
      if (!name) throw new Error('กรุณากรอกชื่อโครงการ');
      project = await createProject({ name, description: desc, createdBy: user?.id || null });
    }

    // 2) Document (optional)
    let doc = null;
    if (includeDoc) {
      const typeId = document.getElementById('projectSendDocType').value;
      const title = document.getElementById('projectSendDocTitle').value.trim();
      const note  = document.getElementById('projectSendDocNote').value.trim();
      if (!typeId) throw new Error('กรุณาเลือกประเภทหนังสือ');
      if (!title)  throw new Error('กรุณากรอกชื่อหนังสือ');
      // Require at least one attached file — dev role can submit without
      // (so we can smoke-test the create/send flow against the seed db).
      if (pendingFiles.length === 0 && user?.role !== 'dev') {
        throw new Error('กรุณาแนบไฟล์อย่างน้อย 1 ไฟล์');
      }

      btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>กำลังบันทึกหนังสือ…';
      doc = await createDocument({
        projectId: project.id,
        typeId,
        title,
        note,
        // Drive folder path uses the human-readable title; placeholder
        // doc id is filled in after createDocument returns.
        driveFolder: buildDocFolderPath(project.id, project.name, '', title),
        createdBy: user?.id || null,
        status: pendingFiles.length === 0 ? 'sent' : 'sent',  // sent even with 0 files
      });

      // 3) Files (upload + insert rows)
      if (pendingFiles.length > 0) {
        const folder = buildDocFolderPath(project.id, project.name, doc.id, title);
        // Patch the document's drive_folder now that we have the real doc id.
        // (createDocument received an empty placeholder doc id segment.)
        //
        // NOT `catch {}`. This PATCH raised for every `master` sender from
        // 0111 until 0176 — the professor column guard read their third desk
        // as a disqualification — and an empty catch meant three หนังสือ kept
        // the placeholder path `…/<slug>_` while their files went to
        // `…/<slug>_DOC-XXXXX`, for eight days, with nothing anywhere saying
        // so. The upload below uses `folder` directly, so the send itself is
        // still correct without this patch and must not be aborted; what was
        // missing is any trace at all.
        try {
          await updateDocument(doc.id, { drive_folder: folder });
        } catch (err) {
          console.warn('[projects] drive_folder patch failed — the row keeps the placeholder path:',
            doc.id, err?.message || err);
        }

        for (let i = 0; i < pendingFiles.length; i++) {
          const f = pendingFiles[i];
          btn.innerHTML = `<span class="spinner-border spinner-border-sm me-2"></span>กำลังอัปโหลด ${i + 1}/${pendingFiles.length}…`;
          status.textContent = `${f.name}`;
          const up = await uploadProjectFile(f, folder);
          await createFile({
            document_id: doc.id,
            file_name: f.name,
            drive_file_id: up.fileId,
            drive_view_url: up.url,
            mime_type: up.mimeType,
            size_bytes: up.sizeBytes,
            uploaded_by: user?.id || null,
          });
        }
      }

      // 4) Notify p'nick
      btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>กำลังแจ้งเตือน…';
      await notifyUniStaff({
        kind: 'sent',
        project,
        document: doc,
        body: `หนังสือใหม่ #${doc.sequence_no} "${doc.title}" — ${pendingFiles.length} ไฟล์แนบ${note ? `\n\nโน้ตจากผู้ส่ง: ${note}` : ''}`,
        subject: `[MDKKU SAMO] หนังสือใหม่: ${project.name} — ${doc.title}`,
      });
    }

    status.textContent = 'สำเร็จ';
    modal?.hide();
    // Pass the new/updated ids so the caller can auto-select the project
    // and (if applicable) jump to the freshly-sent document.
    onCreated({ projectId: project?.id || null, documentId: doc?.id || null });
  } catch (err) {
    status.textContent = '';
    alert(err.message || 'ไม่สามารถบันทึกได้');
  } finally {
    btn.disabled = false;
    btn.innerHTML = original;
  }
}
