// ==============================================
// ANNOUNCEMENTS — CRUD for Web Announcements
// Backed by Supabase (public.announcements). Previously hit GAS
// addAnnouncement / editAnnouncement / getAnnouncements actions.
// ==============================================

import { dbRest } from './db.js';
import { deletePRFile, driveIdsInHtml } from './uploads.js';
import { convertDriveUrl } from './uploads.js';
import { escHtml } from './utils.js';

/** In-memory cache of loaded announcements */
let globalAnnouncements = [];

/** ID of announcement currently being edited (null = create mode) */
let editingAnnouncementId = null;

/** ID of announcement currently being viewed in modal */
let viewingAnnouncementId = null;

/** Reference to the creator Quill editor (set by main.js) */
let creatorQuill = null;

/**
 * Initialize this module with the Quill editor instance.
 * Called from main.js after Quill is created.
 */
export function initAnnouncements(quillInstance) {
  creatorQuill = quillInstance;
  // Live char counter under the subhead/excerpt textarea.
  const ex = document.getElementById('creatorExcerpt');
  if (ex) {
    ex.addEventListener('input', updateExcerptCount);
    updateExcerptCount();
  }
}

// --------------------------------------------------
// Cancel / Reset Edit Mode
// --------------------------------------------------

export function cancelEdit() {
  editingAnnouncementId = null;
  const title = document.getElementById('creatorTitle');
  const excerpt = document.getElementById('creatorExcerpt');
  if (title) title.value = '';
  if (excerpt) excerpt.value = '';
  updateExcerptCount();
  if (creatorQuill) creatorQuill.setText('');
  const header = document.getElementById('creatorPageHeader');
  const desc = document.getElementById('creatorPageDesc');
  const btnText = document.getElementById('publishBtnText');
  if (header) header.innerHTML =
    '<i class="bi bi-layout-text-window-reverse me-2 text-pink-custom"></i>เขียนประกาศลงเว็บไซต์';
  if (desc) desc.innerText =
    'กรอกหัวเรื่อง คำโปรย ภาพปก และเนื้อหา — ระบบจะจัดหน้าให้อัตโนมัติ';
  if (btnText) btnText.innerHTML =
    '<i class="bi bi-cloud-arrow-up-fill me-2"></i>เผยแพร่ลงเว็บไซต์';
  document.getElementById('cancelEditBtn')?.classList.add('d-none');
  document.getElementById('deleteEditBtn')?.classList.add('d-none');
  document.getElementById('creatorAlert')?.classList.add('d-none');
  if (typeof window.clearCreatorThumb === 'function') window.clearCreatorThumb();
  // Always return creator UI to edit mode when starting fresh.
  setCreatorMode('edit');
}

// Live character count under the excerpt textarea.
function updateExcerptCount() {
  const ex = document.getElementById('creatorExcerpt');
  const count = document.getElementById('creatorExcerptCount');
  if (ex && count) count.textContent = String(ex.value.length);
}

// Switch the creator between Edit and Preview panes. Preview reuses the
// same renderArticleView() that the public reader tab uses, so authors
// see exactly what visitors will see.
export function setCreatorMode(mode) {
  const editPane = document.getElementById('creatorEditPane');
  const prevPane = document.getElementById('creatorPreviewPane');
  const editBtn = document.getElementById('creatorModeEditBtn');
  const prevBtn = document.getElementById('creatorModePreviewBtn');
  if (!editPane || !prevPane) return;

  const isPreview = mode === 'preview';
  editPane.classList.toggle('d-none', isPreview);
  prevPane.classList.toggle('d-none', !isPreview);
  editBtn?.classList.toggle('active', !isPreview);
  prevBtn?.classList.toggle('active', isPreview);

  if (isPreview) {
    const mount = document.getElementById('creatorPreviewMount');
    if (mount) mount.innerHTML = renderArticleView(readCreatorForm(), { isPreview: true });
  }
}

// Snapshot the creator form into the same post-shape the renderers expect.
function readCreatorForm() {
  return {
    id: 'preview',
    title:      (document.getElementById('creatorTitle')?.value || '').trim() || '(ยังไม่ได้กรอกหัวเรื่อง)',
    department: document.getElementById('creatorDepartment')?.value || 'สโมสรนักศึกษา',
    excerpt:    (document.getElementById('creatorExcerpt')?.value || '').trim(),
    content:    creatorQuill ? creatorQuill.root.innerHTML : '',
    thumbnail:  document.getElementById('creatorThumbUrl')?.value || '',
    date:       new Date().toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' }),
  };
}

// --------------------------------------------------
// Edit an Existing Announcement
// --------------------------------------------------

/** Returns the article id the reader is currently viewing, or null.
 *  Used by main.js to pass the id over to /admin/#creator/{id}. */
export function getViewingAnnouncementId() {
  return viewingAnnouncementId;
}

/** Load a specific article into the creator form. If no id is given,
 *  falls back to the one currently being viewed in the reader. */
export function editAnnouncement(targetId) {
  const wanted = targetId != null ? String(targetId) : viewingAnnouncementId;
  if (!wanted) return false;
  const post = globalAnnouncements.find((p) => String(p.id) === String(wanted));
  if (!post) return false;
  fillCreatorFormForEdit(post);
  return true;
}

export function editCurrentAnnouncement() {
  return editAnnouncement();
}

function fillCreatorFormForEdit(post) {
  editingAnnouncementId = post.id;
  document.getElementById('creatorTitle').value = post.title;
  document.getElementById('creatorDepartment').value = post.department;
  const ex = document.getElementById('creatorExcerpt');
  if (ex) ex.value = post.excerpt || '';
  updateExcerptCount();
  creatorQuill.root.innerHTML = post.content;

  // Populate the thumbnail picker if the announcement has one stored.
  const thumbUrl = post.thumbnail || '';
  document.getElementById('creatorThumbUrl').value = thumbUrl;
  const preview = document.getElementById('creatorThumbPreview');
  const clearBtn = document.getElementById('creatorThumbClearBtn');
  if (thumbUrl) {
    if (preview) preview.innerHTML = `<img src="${thumbUrl}" alt="thumbnail">`;
    if (clearBtn) clearBtn.classList.remove('d-none');
  } else if (typeof window.clearCreatorThumb === 'function') {
    window.clearCreatorThumb();
  }

  document.getElementById('creatorPageHeader').innerHTML =
    '<i class="bi bi-pencil-square me-2 text-pink-custom"></i>แก้ไขประกาศ';
  document.getElementById('creatorPageDesc').innerText =
    'ระบบจะทำการบันทึกข้อมูลทับประกาศเดิมของคุณ';
  document.getElementById('publishBtnText').innerHTML =
    '<i class="bi bi-save-fill me-2"></i>บันทึกการแก้ไข';
  document.getElementById('cancelEditBtn').classList.remove('d-none');
  document.getElementById('deleteEditBtn')?.classList.remove('d-none');
  setCreatorMode('edit');
  // Activate the creator tab if it's a Bootstrap pill (public site uses
  // pills routing). In admin the sidebar routes sections — caller is
  // expected to have already opened the creator pane.
  const creatorTabBtn = document.getElementById('pills-creator-tab');
  if (creatorTabBtn && window.bootstrap) {
    window.bootstrap.Tab.getOrCreateInstance(creatorTabBtn).show();
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// --------------------------------------------------
// Publish (Create / Update) Announcement
// --------------------------------------------------


// --------------------------------------------------
// DRIVE CLEANUP — the cover and the images inside the body
//
// `uploadPRFile` had no delete counterpart until now, so every re-crop of a
// cover and every image dropped from an article body stayed in Drive, shared
// "anyone with the link", forever. An article edited five times left five
// covers, four of them reachable by anyone who ever saw the URL.
//
// A body is rich text, so "which files does this article use" is a question
// about its HTML rather than about a column — hence the id-set diff below.
// --------------------------------------------------

/**
 * Which Drive files this edit orphaned.
 *
 * @param {{thumbnail?:string, content?:string}|null} before the article as it was
 * @param {{thumbnail?:string, content?:string}|null} after  as it now is (null = deleted)
 * @param {Array} others every OTHER article still live
 * @returns {string[]} Drive file ids nothing points at any more
 *
 * IDS, NEVER URLS. One file appears as `=w1200`, `=w600` and a bare `/view`
 * depending on when it was inserted, so comparing URL strings would call two
 * spellings of one file two different files — and then delete a picture the
 * article still shows.
 *
 * `others` is not paranoia: an editor who duplicates an article to make next
 * year's version has two rows pointing at ONE cover, and deleting the first
 * would blank the second. Announcements are publicly readable, so this list is
 * complete for every caller — unlike a client-side count over an RLS-gated
 * table, which answers "unreferenced" for exactly the person doing the delete.
 */
export function filesToRetire(before, after, others = []) {
  const idsOf = (o) => new Set([
    ...driveIdsInHtml(o?.content),
    ...driveIdsInHtml(o?.thumbnail || o?.thumbnail_url),
  ]);
  const old = idsOf(before);
  if (!old.size) return [];
  const keep = idsOf(after);
  for (const o of others || []) for (const id of idsOf(o)) keep.add(id);
  return [...old].filter((id) => !keep.has(id));
}

/** Trash them, best-effort. Always AFTER the row is written or gone. */
function retireDriveFiles(ids) {
  for (const id of ids || []) {
    // The viewer form is what extractDriveId_ on the GAS side parses most
    // directly; any of the three shapes would work.
    deletePRFile(`https://drive.google.com/file/d/${id}/view`).catch(() => {});
  }
}

export async function publishAnnouncement() {
  const title = document.getElementById('creatorTitle').value.trim();
  const dept = document.getElementById('creatorDepartment').value;
  const excerpt = (document.getElementById('creatorExcerpt')?.value || '').trim();
  const contentHtml = creatorQuill.root.innerHTML;
  const contentText = creatorQuill.getText().trim();
  const thumbnail = document.getElementById('creatorThumbUrl')?.value || '';
  const alertBox = document.getElementById('creatorAlert');
  const publishBtn = document.getElementById('publishBtn');
  const publishBtnText = document.getElementById('publishBtnText');

  if (!title || contentText.length === 0) {
    alertBox.className = 'alert alert-danger shadow-sm';
    alertBox.innerHTML =
      '<i class="bi bi-exclamation-circle-fill me-2"></i>กรุณากรอกหัวเรื่องและเนื้อหาประกาศให้ครบถ้วน';
    setCreatorMode('edit');
    return;
  }
  if (!thumbnail) {
    alertBox.className = 'alert alert-danger shadow-sm';
    alertBox.innerHTML =
      '<i class="bi bi-image me-2"></i>กรุณาเลือกภาพปกของบทความ — ภาพปกเป็นองค์ประกอบสำคัญของเลย์เอาต์';
    setCreatorMode('edit');
    return;
  }

  publishBtn.disabled = true;
  publishBtnText.innerHTML =
    '<span class="spinner-border spinner-border-sm me-2"></span>กำลังประมวลผล...';

  const isEditing = editingAnnouncementId !== null;
  // The article as it stands BEFORE this save — the cover and body images it is
  // about to stop using. Captured here because the write and the reload below
  // both overwrite the cached row.
  const beforeRow = isEditing
    ? globalAnnouncements.find((p) => String(p.id) === String(editingAnnouncementId)) || null
    : null;
  const beforeSnapshot = beforeRow
    ? { thumbnail: beforeRow.thumbnail || beforeRow.thumbnail_url || '', content: beforeRow.content || '' }
    : null;
  const row = {
    title,
    department: dept,
    content: contentHtml,
    thumbnail_url: thumbnail,
    status: 'approved',
  };
  // Only include excerpt if we know the column exists. The loader's
  // graceful fallback sets __samoWarnedExcerpt when the SELECT 400s on
  // the missing column — same DB will also reject an INSERT/UPDATE
  // that names that column.
  if (!window.__samoWarnedExcerpt) {
    row.excerpt = excerpt || null;
  }

  // Self-heal POST/PATCH for the missing-excerpt-column case. The read
  // path already retries without `excerpt`; the write path needs the
  // same fallback so this user flow doesn't depend on loadAnnouncements
  // having run first to trip the gate. Apply 0008_announcements_excerpt.sql
  // to remove the need for this retry.
  const writeWithExcerptFallback = async (path, opts) => {
    let res = await dbRest(path, opts);
    const looksLikeExcerptMissing = res.error
      && String(res.error.status) === '400'
      && /excerpt/i.test(res.error.message || '')
      && opts.body && Object.prototype.hasOwnProperty.call(opts.body, 'excerpt');
    if (looksLikeExcerptMissing) {
      if (!window.__samoWarnedExcerpt) {
        window.__samoWarnedExcerpt = true;
        console.warn('[announcements] excerpt column missing on publish — retrying without it. Apply migration 0008_announcements_excerpt.sql.');
      }
      const { excerpt: _drop, ...bodyWithoutExcerpt } = opts.body;
      res = await dbRest(path, { ...opts, body: bodyWithoutExcerpt });
    }
    return res;
  };

  try {
    let result;
    if (isEditing) {
      // Use Prefer: return=representation so PostgREST sends back the
      // updated row(s). If no row matched (RLS or id mismatch), data
      // will be an empty array — we surface that as a clear error
      // rather than the silent no-op the previous code had.
      const idEsc = encodeURIComponent(editingAnnouncementId);
      result = await writeWithExcerptFallback(`/announcements?id=eq.${idEsc}`, {
        method: 'PATCH',
        body: row,
        prefer: 'return=representation',
      });
      if (!result.error && (!Array.isArray(result.data) || result.data.length === 0)) {
        throw new Error('อัปเดตไม่สำเร็จ — ไม่พบประกาศนี้ หรือบัญชีของคุณไม่มีสิทธิ์ “เขียนประกาศ” (id='
          + editingAnnouncementId + ')');
      }
    } else {
      result = await writeWithExcerptFallback('/announcements', {
        method: 'POST',
        body: row,
        prefer: 'return=representation',
      });
    }
    if (result.error) {
      throw new Error(`${result.error.status || ''} ${result.error.message || 'unknown'}`.trim());
    }

    alertBox.className = 'alert alert-success shadow-sm';
    alertBox.innerHTML = `<i class="bi bi-check-circle-fill me-2"></i>${isEditing ? 'อัปเดตประกาศสำเร็จ!' : 'เผยแพร่ประกาศสำเร็จ!'} กำลังพากลับไปหน้าประกาศ...`;
    // Snapshot the published id BEFORE cancelEdit() resets editingAnnouncementId.
    // For new publishes, the inserted row id comes back via Prefer=representation
    // (we add it below); for edits, reuse the id we were editing.
    const publishedId = isEditing
      ? editingAnnouncementId
      : (Array.isArray(result?.data) && result.data[0]?.id) || null;
    cancelEdit();
    setTimeout(async () => {
      alertBox.classList.add('d-none');
      await loadAnnouncements();
      // AFTER the reload, so `others` is the live list — a cover shared with a
      // duplicated article must not be trashed on this one's behalf. Only runs
      // for an EDIT: a brand-new article replaced nothing.
      if (beforeSnapshot) {
        const others = globalAnnouncements.filter((p) => String(p.id) !== String(publishedId));
        retireDriveFiles(filesToRetire(beforeSnapshot, { thumbnail, content: contentHtml }, others));
      }
      // Let the admin shell react (close the editor popup, refresh the
      // manage cards). No-op on the public site (no listener bound there).
      document.dispatchEvent(new CustomEvent('announcement:changed'));
      // In the admin editor popup, the listener above closes it; only the
      // public/standalone flow falls through to opening the article reader.
      if (document.getElementById('articleContainer') && publishedId != null) {
        // Open the new article directly so the author sees the rendered result.
        viewAnnouncement(String(publishedId));
      } else if (document.getElementById('pills-announcements-tab')) {
        bootstrap.Tab.getOrCreateInstance(document.getElementById('pills-announcements-tab')).show();
      }
    }, 1200);
  } catch (error) {
    alertBox.className = 'alert alert-danger shadow-sm';
    alertBox.innerHTML = `<i class="bi bi-wifi-off me-2"></i> บันทึกไม่สำเร็จ: ${error.message || error}`;
  } finally {
    publishBtn.disabled = false;
    // Only restore the spinner-replaced label on error; on success
    // cancelEdit() already set it to the create-mode label and we
    // must not stomp it back to "Update" using the stale isEditing flag.
    const stillEditing = editingAnnouncementId !== null;
    if (document.getElementById('publishBtnText')) {
      document.getElementById('publishBtnText').innerHTML = stillEditing
        ? '<i class="bi bi-save-fill me-2"></i>บันทึกการแก้ไข'
        : '<i class="bi bi-cloud-arrow-up-fill me-2"></i>เผยแพร่ลงเว็บไซต์';
    }
  }
}

// --------------------------------------------------
// Delete Announcement (staff-only)
// --------------------------------------------------

/** Delete a specific announcement by id. Confirms first, deletes via
 *  dbRest with return=representation (so RLS no-ops surface as a real
 *  error per mistakes.md), then reloads. Returns true on success. */
export async function deleteAnnouncement(targetId) {
  const wanted = targetId != null ? String(targetId) : viewingAnnouncementId;
  if (!wanted) return false;
  const post = globalAnnouncements.find((p) => String(p.id) === String(wanted));
  const titleHint = post ? `"${post.title}"` : '';
  if (!confirm(`ลบประกาศ ${titleHint} ใช่หรือไม่? ไม่สามารถกู้คืนได้`)) return false;

  const idEsc = encodeURIComponent(wanted);
  const { data, error } = await dbRest(
    `/announcements?id=eq.${idEsc}`,
    { method: 'DELETE', prefer: 'return=representation' },
  );
  if (error) {
    alert('ลบไม่สำเร็จ: ' + (error.message || 'unknown'));
    return false;
  }
  if (!Array.isArray(data) || data.length === 0) {
    alert('ลบไม่สำเร็จ — ไม่พบประกาศนี้ หรือบัญชีของคุณไม่มีสิทธิ์ “เขียนประกาศ”');
    return false;
  }

  // If we were viewing this article in the public reader, exit it.
  // If we were editing it in the admin creator, clear the form.
  if (String(viewingAnnouncementId) === String(wanted)) {
    closeArticleView();
  }
  if (String(editingAnnouncementId) === String(wanted)) {
    cancelEdit();
  }
  // The row as the SERVER had it (return=representation), not as the client
  // cached it — the cache can be a page-load old, and a cover swapped in
  // between would otherwise survive the delete.
  const deletedRow = data[0] || post || null;

  // Reload list — safe on both public and admin (loadAnnouncements is
  // DOM-resilient).
  await loadAnnouncements();
  // The article is gone, so everything it used is orphaned — except anything a
  // surviving article also points at. `after` is null: nothing keeps these.
  retireDriveFiles(filesToRetire(deletedRow, null, globalAnnouncements));
  // Admin shell hook: close the editor popup (if open) + refresh manage cards.
  document.dispatchEvent(new CustomEvent('announcement:changed'));
  return true;
}

export async function deleteCurrentAnnouncement() {
  return deleteAnnouncement();
}

/** Delete the article currently loaded into the admin editor form. */
export async function deleteEditingAnnouncement() {
  if (!editingAnnouncementId) return false;
  return deleteAnnouncement(editingAnnouncementId);
}

// --------------------------------------------------
// Reorder (admin only)
//
// Topmost item in the rendered list maps to the HIGHEST display_order
// integer so the sort `display_order desc nulls last, created_at desc`
// puts it first. We PATCH each row's display_order; for ~10–20 articles
// this is a tolerable burst.
// --------------------------------------------------

/** Persist a new ordering given the list of ids from top to bottom. */
export async function saveAnnouncementOrder(orderedIds) {
  if (!Array.isArray(orderedIds) || orderedIds.length === 0) return false;
  const n = orderedIds.length;
  // top = n, second = n-1, …, last = 1 (avoid 0 so the sort sees a
  // distinct value vs. unset rows that we might have later)
  const ops = orderedIds.map((id, idx) => ({ id, order: n - idx }));
  for (const { id, order } of ops) {
    const { error } = await dbRest(
      `/announcements?id=eq.${encodeURIComponent(id)}`,
      { method: 'PATCH', body: { display_order: order }, prefer: 'return=minimal' },
    );
    if (error) {
      console.error('[announcements] saveAnnouncementOrder failed for id', id, error);
      alert('บันทึกลำดับไม่สำเร็จ: ' + (error.message || 'unknown'));
      return false;
    }
  }
  // Refresh local cache + any visible lists.
  await loadAnnouncements();
  return true;
}

/**
 * Pin (or unpin) an announcement. Pinning makes it the single large
 * featured post on the home page. Enforces the "at most one pinned"
 * invariant in the app: when pinning a post, every other currently-pinned
 * row is unpinned first. Toggling an already-pinned post simply unpins it
 * (home falls back to all-small with no featured).
 */
export async function togglePinAnnouncement(targetId) {
  if (window.__samoWarnedPinned) {
    alert('ฟีเจอร์ปักหมุดยังไม่พร้อมใช้งาน — ต้องอัปเดตฐานข้อมูลก่อน (migration 0054)');
    return false;
  }
  const id = String(targetId);
  const target = globalAnnouncements.find((p) => p.id === id);
  if (!target) return false;
  const willPin = !target.pinned;
  try {
    if (willPin) {
      // Move the pin: clear any other pinned rows so only one stays featured.
      const others = globalAnnouncements.filter((p) => p.pinned && p.id !== id);
      for (const p of others) {
        const { error } = await dbRest(
          `/announcements?id=eq.${encodeURIComponent(p.id)}`,
          { method: 'PATCH', body: { pinned: false }, prefer: 'return=minimal' },
        );
        if (error) throw new Error(error.message || 'unpin failed');
      }
    }
    const { data, error } = await dbRest(
      `/announcements?id=eq.${encodeURIComponent(id)}`,
      { method: 'PATCH', body: { pinned: willPin }, prefer: 'return=representation' },
    );
    if (error) throw new Error(`${error.status || ''} ${error.message || 'unknown'}`.trim());
    if (!Array.isArray(data) || data.length === 0) {
      throw new Error('ไม่พบประกาศนี้ หรือบัญชีของคุณไม่มีสิทธิ์ “เขียนประกาศ”');
    }
  } catch (e) {
    alert('ปักหมุดไม่สำเร็จ: ' + (e.message || e));
    return false;
  }
  await loadAnnouncements();
  return true;
}

/** Render the admin manage view — each announcement as an editorial card
 *  (same 3:4 image + text the public archive uses), with a drag handle and
 *  pin chip overlaid on the image. Clicking a card opens it in the editor
 *  popup; the handle reorders; the pin chip toggles the featured home post.
 *  Caller attaches SortableJS to the grid (handle `.order-card-handle`,
 *  items `.order-card`). */
export function renderAnnouncementOrderList(rootEl) {
  if (!rootEl) return;
  if (globalAnnouncements.length === 0) {
    rootEl.innerHTML = '<p class="text-muted small text-center py-4 mb-0 order-grid-empty">ยังไม่มีประกาศที่เผยแพร่</p>';
    return;
  }
  rootEl.innerHTML = globalAnnouncements.map(renderOrderCard).join('');
}

function renderOrderCard(post) {
  const cover = pickCover(post);
  return `
    <div class="news-card order-card${post.pinned ? ' is-pinned' : ''}" data-id="${escHtml(post.id)}"
      onclick="editAnnouncementById('${escHtml(post.id)}')" title="คลิกเพื่อแก้ไขประกาศนี้">
      <div class="news-card-media">
        <img src="${escHtml(cover)}" alt="" loading="lazy">
        <span class="order-card-handle" aria-label="ลากเพื่อจัดเรียง"
          onclick="event.stopPropagation();">
          <i class="bi bi-grip-vertical"></i>
        </span>
        <button type="button"
          class="order-card-pin${post.pinned ? ' is-pinned' : ''}"
          title="${post.pinned ? 'เลิกปักหมุด' : 'ปักหมุดเป็นโพสต์เด่นบนหน้าแรก'}"
          aria-pressed="${post.pinned ? 'true' : 'false'}"
          onclick="event.stopPropagation(); togglePinAnnouncement('${escHtml(post.id)}');">
          <i class="bi ${post.pinned ? 'bi-pin-angle-fill' : 'bi-pin-angle'}"></i>
          <span>${post.pinned ? 'ปักหมุดอยู่' : 'ปักหมุด'}</span>
        </button>
      </div>
      <div class="news-card-body">
        <span class="news-eyebrow">${escHtml(post.department || 'ประกาศ')}</span>
        <h4 class="news-card-title">${escHtml(post.title)}</h4>
        <div class="news-meta">
          <time>${escHtml(formatEditorialDate(post))}</time>
          <span class="order-card-edit"><i class="bi bi-pencil"></i> แก้ไข</span>
        </div>
      </div>
    </div>
  `;
}

// --------------------------------------------------
// Load Announcements from Server
// --------------------------------------------------

export async function loadAnnouncements() {
  // These elements only exist on the public site's archive page —
  // admin calls this function purely to populate globalAnnouncements
  // (so editAnnouncement(id) can find the row). Guard all DOM writes
  // so the fetch path runs regardless of where it's called from.
  const container = document.getElementById('announcementsGrid');
  const emptyState = document.getElementById('emptyState');

  if (container) {
    container.innerHTML =
      '<div class="col-12 text-center text-muted py-5"><div class="spinner-border text-pink-custom mb-3" role="status"></div><p>กำลังดึงข้อมูลประกาศล่าสุด...</p></div>';
  }
  if (emptyState) emptyState.classList.add('d-none');

  try {
    // Try fetching with `excerpt` (post-migration-0008 column). If the
    // DB hasn't had 0008 applied yet, PostgREST returns 400 because the
    // column is in the select list. Retry without `excerpt` so the site
    // keeps working — renderers already fall back to the extracted
    // snippet when excerpt is empty. Log once so the dev sees the
    // pending migration.
    // `pinned` (0054) is appended only until we learn the column is missing;
    // the home featured slot reads it. Like excerpt/display_order it
    // self-heals — a 400 naming `pinned` drops it and disables pin until the
    // migration is applied.
    // baseSelect deliberately EXCLUDES `pinned` so the excerpt/display_order
    // fallbacks below never re-request a column we already know is missing.
    // Only the first query appends `pinned`; if it 400s we retry off baseSelect.
    const baseSelect = 'id,title,content,department,thumbnail_url,created_at,display_order';
    const pinnedCol = window.__samoWarnedPinned ? '' : ',pinned';
    const orderBy = 'display_order.desc.nullslast,created_at.desc';
    let { data, error } = await dbRest(
      `/announcements?select=${baseSelect}${pinnedCol},excerpt&status=eq.approved&order=${orderBy}`
    );
    if (error && error.status === 400 && /pinned/i.test(error.message || '')) {
      if (!window.__samoWarnedPinned) {
        window.__samoWarnedPinned = true;
        console.warn('[announcements] pinned column missing — apply migration 0054_announcement_pinned.sql to enable the home featured pin.');
      }
      ({ data, error } = await dbRest(
        `/announcements?select=${baseSelect},excerpt&status=eq.approved&order=${orderBy}`
      ));
    }
    // Cascade graceful fallbacks: try `excerpt` first (0008 column).
    // If that 400s on excerpt, retry without it. If THAT also 400s on
    // display_order (0017 column), retry with the original minimal
    // select. Same self-healing pattern the publish path uses.
    if (error && error.status === 400 && /excerpt/i.test(error.message || '')) {
      if (!window.__samoWarnedExcerpt) {
        window.__samoWarnedExcerpt = true;
        console.warn('[announcements] excerpt column missing — apply migration 0008_announcements_excerpt.sql.');
      }
      ({ data, error } = await dbRest(
        `/announcements?select=${baseSelect}&status=eq.approved&order=${orderBy}`
      ));
    }
    if (error && error.status === 400 && /display_order/i.test(error.message || '')) {
      if (!window.__samoWarnedOrder) {
        window.__samoWarnedOrder = true;
        console.warn('[announcements] display_order column missing — apply migration 0017_announcement_order.sql to enable drag-reorder.');
      }
      const minimalSelect = 'id,title,content,department,thumbnail_url,created_at';
      ({ data, error } = await dbRest(
        `/announcements?select=${minimalSelect},excerpt&status=eq.approved&order=created_at.desc`
      ));
      if (error && error.status === 400 && /excerpt/i.test(error.message || '')) {
        ({ data, error } = await dbRest(
          `/announcements?select=${minimalSelect}&status=eq.approved&order=created_at.desc`
        ));
      }
    }
    if (error) throw new Error(`${error.status || ''} ${error.message || 'unknown'}`.trim());

    // Map DB rows to the shape the renderers expect. excerpt is the
    // author-written subhead; cards/article fall back to extracted
    // snippet if null (post-0008 column, see migration for context).
    globalAnnouncements = (data || []).map((row) => ({
      id: row.id.toString(),
      date: row.created_at
        ? new Date(row.created_at).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' })
        : '',
      title: row.title,
      department: row.department,
      excerpt: row.excerpt || '',
      content: row.content,
      thumbnail: row.thumbnail_url || '',
      displayOrder: row.display_order ?? null,
      pinned: row.pinned === true,
    }));

    if (container) container.innerHTML = '';

    if (globalAnnouncements.length === 0) {
      if (emptyState) emptyState.classList.remove('d-none');
    } else {
      if (emptyState) emptyState.classList.add('d-none');
      if (container) {
        const cards = globalAnnouncements.map(renderNewsCard).join('');
        container.innerHTML = `<div class="news-grid news-grid--archive">${cards}</div>`;
      }
    }
    renderHomeAnnouncements();
    // If the page loaded with #article/{id} before data was ready, open it now.
    handleArticleHash();
  } catch (error) {
    if (container) {
      container.innerHTML =
        '<div class="col-12 text-center text-danger py-5"><i class="bi bi-exclamation-triangle fs-1"></i><p class="mt-3">เกิดข้อผิดพลาดในการโหลดข้อมูลประกาศ กรุณาลองใหม่อีกครั้ง</p></div>';
    }
    renderHomeAnnouncements({ error: true });
    throw error; // let admin's tryCreatorDeepLink see the failure
  }
}

/**
 * Render announcements into the home page editorial layout: 1 featured
 * (large, image+excerpt) + up to 6 secondary cards (grid). Triggered after
 * loadAnnouncements() resolves so home and archive reflect the same data.
 */
function renderHomeAnnouncements({ error = false } = {}) {
  const featured = document.getElementById('homeNewsFeatured');
  const grid     = document.getElementById('homeNewsGrid');
  const empty    = document.getElementById('homeNewsEmpty');
  if (!featured || !grid) return;

  if (error) {
    featured.innerHTML = '';
    grid.innerHTML = '';
    if (empty) {
      empty.classList.remove('d-none');
      empty.innerHTML = '<i class="bi bi-exclamation-circle"></i><p>โหลดประกาศไม่สำเร็จ — ลองรีเฟรชอีกครั้ง</p>';
    }
    return;
  }

  if (globalAnnouncements.length === 0) {
    featured.innerHTML = '';
    grid.innerHTML = '';
    if (empty) {
      empty.classList.remove('d-none');
      empty.innerHTML = '<i class="bi bi-inbox"></i><p>ยังไม่มีประกาศในขณะนี้</p>';
    }
    return;
  }

  if (empty) empty.classList.add('d-none');

  // Featured slot is driven by the explicit `pinned` flag — NOT by list
  // position. If an admin has pinned a post, it becomes the single large
  // card and the rest render small. If nothing is pinned, every post shows
  // at the same small size (no featured). At most one row is pinned (the
  // toggle unpins others); find() picks the first if a stale extra exists.
  const pinned = globalAnnouncements.find((p) => p.pinned);
  if (pinned) {
    // Pinned = the single large card at the top, then the 2 most recent
    // other posts as small cards below it.
    featured.innerHTML = renderNewsFeatured(pinned);
    const rest = globalAnnouncements.filter((p) => p.id !== pinned.id);
    grid.innerHTML = rest.slice(0, 2).map(renderNewsCard).join('');
  } else {
    featured.innerHTML = '';
    grid.innerHTML = globalAnnouncements.slice(0, 8).map(renderNewsCard).join('');
  }
}

// --------------------------------------------------
// EDITORIAL CARD RENDERERS — used by home + archive
// --------------------------------------------------

const PLACEHOLDER_IMG =
  'https://images.unsplash.com/photo-1576091160550-2173ff9e5ee5?w=600&h=400&fit=crop';

/** A post's HTML, parsed where nothing in it can load. A DETACHED <div> is not
 *  that: `div.innerHTML = html` fetches every <img> in it at once. These two
 *  run for every post on every page load, so the shop tab downloaded ~45 MB of
 *  news pictures nobody could see (docs/mistakes/frontend-ui.md). */
function inertBody(html) {
  return new DOMParser().parseFromString(html || '', 'text/html').body;
}

function pickCover(post) {
  const firstImg = inertBody(post.content).querySelector('img');
  return convertDriveUrl(post.thumbnail)
    || convertDriveUrl(firstImg?.getAttribute('src'))
    || PLACEHOLDER_IMG;
}

function extractSnippet(content, max = 140) {
  let text = (inertBody(content).textContent || '').replace(/\s+/g, ' ').trim();
  if (text.length > max) text = text.slice(0, max).trim() + '…';
  return text;
}

function formatEditorialDate(post) {
  // post.date is already 'dd/mm/yy HH:MM' from the loader. Reformat to a
  // restrained '28 พ.ค. 2569' string when we can parse it back; otherwise
  // fall through as-is so we never show 'Invalid Date' to users.
  const raw = post.date || '';
  const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (!m) return raw;
  const day = parseInt(m[1], 10);
  const month = parseInt(m[2], 10);
  const months = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  const monthLabel = months[month - 1] || raw;
  let year = parseInt(m[3], 10);
  if (year < 100) year += 2500;          // 25 → 2525 (BE short form)
  else if (year < 2400) year += 543;     // 1981 → 2524 (CE → BE)
  return `${day} ${monthLabel} ${year}`;
}

function renderNewsFeatured(post) {
  const cover = pickCover(post);
  // Author-written subhead wins; fall back to extracted snippet for pre-0008 posts.
  const blurb = (post.excerpt || '').trim() || extractSnippet(post.content, 180);
  return `
    <a class="news-featured" onclick="viewAnnouncement('${escHtml(post.id)}')">
      <div class="news-featured-media">
        <img src="${escHtml(cover)}" alt="" loading="eager">
        <span class="news-featured-pin"><i class="bi bi-pin-angle-fill"></i> ปักหมุด</span>
      </div>
      <div class="news-featured-body">
        <span class="news-eyebrow">${escHtml(post.department || 'ประกาศ')}</span>
        <h3 class="news-featured-title">${escHtml(post.title)}</h3>
        ${blurb ? `<p class="news-featured-excerpt">${escHtml(blurb)}</p>` : ''}
        <div class="news-meta">
          <time>${escHtml(formatEditorialDate(post))}</time>
          <span class="news-meta-cta">อ่านต่อ <i class="bi bi-arrow-right"></i></span>
        </div>
      </div>
    </a>
  `;
}

function renderNewsCard(post) {
  const cover = pickCover(post);
  return `
    <a class="news-card" onclick="viewAnnouncement('${escHtml(post.id)}')">
      <div class="news-card-media"><img src="${escHtml(cover)}" alt="" loading="lazy"></div>
      <div class="news-card-body">
        <span class="news-eyebrow">${escHtml(post.department || 'ประกาศ')}</span>
        <h4 class="news-card-title">${escHtml(post.title)}</h4>
        <div class="news-meta">
          <time>${escHtml(formatEditorialDate(post))}</time>
        </div>
      </div>
    </a>
  `;
}

// --------------------------------------------------
// View Announcement — full-page article tab
// --------------------------------------------------

/**
 * Render the editorial article view HTML for a post (used by both the
 * reader tab and the creator's live preview pane).
 *
 *   options.isPreview — when true, suppresses the staff edit/delete
 *     action row and the loading state (everything is local).
 *
 * Quill-produced post.content is intentionally rendered raw. WHO that trusts
 * is a security boundary, so state it accurately: `announcements_write` is
 * `current_user_role() in ('pr_staff','dev') OR
 * current_user_has_permission('creator')`. The permission channel is the live
 * one — a ทีม SAMO node grants it as **เขียนประกาศ**, and `master` answers yes
 * to it — so the set that can publish raw HTML here is LARGER than two staff
 * roles and grows whenever someone is granted เขียนประกาศ.
 *
 * It is still a GRANTED set, never self-service: probed live 2026-08-26, a
 * creator-permission holder and a master holder can insert / update / delete,
 * and an account with neither is refused all three.
 *
 * title / department / excerpt are plain text and run through escHtml.
 */
export function renderArticleView(post, { isPreview = false } = {}) {
  if (!post) return '';
  const cover = pickCover(post);
  const dept = post.department || 'ประกาศ';
  const dateLabel = formatEditorialDate(post);
  const blurb = (post.excerpt || '').trim();
  return `
    <header class="article-header">
      <span class="article-eyebrow">${escHtml(dept)}</span>
      <h1 class="article-headline">${escHtml(post.title || '')}</h1>
      ${blurb ? `<p class="article-subhead">${escHtml(blurb)}</p>` : ''}
      <div class="article-byline">
        <span class="article-byline-item"><i class="bi bi-building"></i><span>${escHtml(dept)}</span></span>
        <span class="article-byline-item"><i class="bi bi-calendar3"></i><time>${escHtml(dateLabel)}</time></span>
      </div>
    </header>
    <div class="article-hero">
      <figure>
        <img src="${escHtml(cover)}" alt="" loading="eager">
      </figure>
    </div>
    <div class="article-body">${post.content || ''}</div>
    ${isPreview ? '' : `
      <footer class="article-foot">
        <a class="article-foot-back" href="#" onclick="event.preventDefault(); closeArticleView();">
          <i class="bi bi-arrow-left"></i> ดูประกาศทั้งหมด
        </a>
      </footer>
    `}
  `;
}

/**
 * Open a post in the full-page article tab. Updates the hash so the URL
 * is shareable, sets viewingAnnouncementId for the edit/delete buttons,
 * and rewrites any legacy Drive image URLs inside the rendered content.
 */
export function viewAnnouncement(id) {
  const post = globalAnnouncements.find((p) => p.id === String(id));
  if (!post) return;
  viewingAnnouncementId = post.id;

  // Activate the article tab first so the container is visible/sized.
  const tabBtn = document.getElementById('pills-article-tab');
  if (tabBtn && window.bootstrap) {
    window.bootstrap.Tab.getOrCreateInstance(tabBtn).show();
  }

  const container = document.getElementById('articleContainer');
  if (container) {
    container.innerHTML = renderArticleView(post);
    // Rewrite legacy Drive URLs so embedded images render.
    container.querySelectorAll('img').forEach((img) => {
      const fixed = convertDriveUrl(img.getAttribute('src'));
      if (fixed) img.setAttribute('src', fixed);
    });
  }

  // Reveal staff-only actions (the role gating elsewhere flips d-none
  // based on [data-role-only]; we just have to make them present in DOM).
  // They're already in tab-article.html — nothing to inject here.

  // Sync the path so this view is shareable: /news/{id}.
  // pushState (not replaceState) so the browser back button returns
  // to the previous tab/path naturally.
  const want = `/news/${encodeURIComponent(post.id)}`;
  if (location.pathname !== want) history.pushState(null, '', want);

  window.scrollTo({ top: 0, behavior: 'auto' });
}

/** Return from the article reader back to the announcement archive. */
export function closeArticleView() {
  viewingAnnouncementId = null;
  // Prefer browser-back so we don't disturb the rest of the history
  // stack. Falls back to /news if the user landed directly on the
  // article URL (no entry to go back to).
  if (location.pathname.startsWith('/news/')) {
    if (window.history.length > 1) {
      window.history.back();
      return;
    }
    history.replaceState(null, '', '/news');
  }
  const tabBtn = document.getElementById('pills-announcements-tab');
  if (tabBtn && window.bootstrap) {
    window.bootstrap.Tab.getOrCreateInstance(tabBtn).show();
  }
}

/**
 * Article routing:
 *   /news/{id}    — new path form (used by viewAnnouncement)
 *   #article/{id} — legacy hash form (backward compat for shared links)
 *
 * Runs on initial load (after loadAnnouncements resolves), on hashchange
 * (covers legacy links), and on popstate (covers back/forward). Other
 * hash patterns (e.g. #projects/...) are left to their own modules.
 */
function handleArticleHash() {
  // Legacy hash → redirect to path
  const hashMatch = location.hash.match(/^#article\/(.+)$/);
  if (hashMatch) {
    const id = decodeURIComponent(hashMatch[1]);
    history.replaceState(null, '', `/news/${encodeURIComponent(id)}`);
    if (globalAnnouncements.length === 0) return; // wait for next load
    viewAnnouncement(id);
    return;
  }
  // Path form
  const pathMatch = location.pathname.match(/^\/news\/(.+)/);
  if (pathMatch) {
    const id = decodeURIComponent(pathMatch[1]);
    if (globalAnnouncements.length === 0) return;
    viewAnnouncement(id);
  }
}

// Register once — survives loadAnnouncements calls.
if (typeof window !== 'undefined' && !window.__samoArticleHashBound) {
  window.__samoArticleHashBound = true;
  window.addEventListener('hashchange', handleArticleHash);
}
