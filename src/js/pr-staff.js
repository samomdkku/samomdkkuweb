// ==============================================
// PR STAFF — Dashboard, Modal, Agent Management
// ==============================================

import { renderTimeline, escHtml } from './utils.js';
import { renderPrAttachments, parsePrAttachments } from './pr-attachments.js';
import { db, dbRest } from './db.js';
import { canonicalPrDept, fillPrDeptSelect } from './pr-depts.js';

// ----------------------------------------------------
// DB row → camelCase ticket shape used by the kanban renderer + modal.
// ----------------------------------------------------
function rowToTicket(r) {
  const submitDate = r.timestamp ? new Date(r.timestamp) : null;
  const publishDate = r.publish_date ? new Date(r.publish_date) : null;
  const fmt = (d) => d
    ? d.toLocaleString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).replace(',', '')
    : '-';
  return {
    id: r.id,
    date: fmt(submitDate),
    // Normalize superseded spellings so the dept filter (and the card) agree
    // with the canonical option values — the stored column is never rewritten.
    dept: canonicalPrDept(r.department),
    contact: r.contact || '-',
    contentName: r.content_name,
    jobType: r.job_type || '-',
    platforms: Array.isArray(r.platforms) ? r.platforms.join(', ') : (r.platforms || '-'),
    postingChannel: r.posting_channel || '-',
    publishDate: fmt(publishDate),
    deadline: r.deadline_status || 'ปกติ',
    rushReason: r.rush_reason || '-',
    brief: r.brief || '-',
    caption: r.caption || '-',
    fileUrl: r.file_url || 'ไม่มีไฟล์แนบ',
    projectAccount: r.project_account || '-',
    copostWith: r.copost_with || '-',
    submitter: r.submitter_label || '',
    status: r.status,
    remarks: Array.isArray(r.remarks) ? r.remarks : [],
    assignees: Array.isArray(r.assignees) ? r.assignees : [],
    otherPlatforms: Array.isArray(r.other_platforms) ? r.other_platforms.join(', ') : (r.other_platforms || '-'),
    otherPlatformReason: r.other_platform_reason || '-',
  };
}

let prStaffTicketsCache = [];
let currentActivePrTicketId = null;
let globalPrAgents = [];
let currentPrAssignees = [];

// --------------------------------------------------
// Staff Entry
// PR staff login is handled globally via the navbar sign-in modal
// (see auth.js). The legacy in-form login box was removed when the
// dashboard moved to the Admin tab.
// --------------------------------------------------

/**
 * Enter the PR staff dashboard. Used by the admin tab once the user has
 * been verified as pr_staff (or dev) via the global auth modal.
 */
export async function enterPRStaffDashboard() {
  // Single source of truth for the ฝ่าย list (src/js/pr-depts.js).
  fillPrDeptSelect(document.getElementById('prStaffDeptFilter'),
    { allOption: 'ดูทุกฝ่าย (All Departments)' });
  await loadGlobalAgents();
  await fetchPRStaffTickets();
}

// --------------------------------------------------
// Fetch & Render Staff Tickets
// --------------------------------------------------

export async function fetchPRStaffTickets() {
  const loading = document.getElementById('prStaffLoading');
  const board = document.getElementById('prStaffKanban');
  if (loading) loading.classList.remove('d-none');
  if (board) board.innerHTML = '';

  try {
    // dbRest (raw fetch via PostgREST) instead of db.from(...). The
    // supabase-js client serialises requests behind a session lock
    // that the periodic auth refresh in db.js + the new dbRest
    // JWT-auto-refresh path both contend for, so a heavy / well-used
    // tab can stall the dashboard fetch for several seconds even on
    // a healthy network. dbRest skips supabase-js entirely (raw fetch
    // + AbortController timeout + single-flight JWT refresh) so the
    // load completes as fast as PostgREST can answer.
    //
    // Order by `timestamp` (submission time we explicitly set on both
    // live submissions and the legacy CSV migration). `created_at` can
    // default to migration-time for legacy rows, putting them in an
    // arbitrary order within their kanban column.
    const { data, error } = await dbRest(
      '/pr_tickets?select=*&deleted_at=is.null&order=timestamp.desc',
    );
    if (error) throw new Error(error.message || 'โหลดไม่สำเร็จ');
    if (loading) loading.classList.add('d-none');
    prStaffTicketsCache = (data || []).map(rowToTicket);
    if (prStaffTicketsCache.length > 0) {
      filterPRStaffTickets();
    } else {
      renderPRStaffKanban([]);
    }
  } catch (e) {
    if (loading) loading.classList.add('d-none');
    if (board) board.innerHTML = `<div class="text-danger text-center py-4">เกิดข้อผิดพลาดในการโหลด: ${e.message || e}</div>`;
  }
}

// Canonical kanban statuses (order = column order). Tickets whose status
// is anything else get bucketed via bucketStatus() below.
const KANBAN_STATUSES = [
  'รอ PR รับเรื่อง',
  'PR รับเรื่อง',
  'รับบรีฟแล้ว (กำลังดำเนินการ)',
  'รอโพสต์ตามกำหนดการ',
  'โพสต์เรียบร้อย (เสร็จสิ้น)',
  'ตีกลับให้แก้ไขงาน',
  'กำลังแก้ไขงาน',
];

const STATUS_COLOR = {
  'รอ PR รับเรื่อง': '#fbbf24',                      // amber
  'PR รับเรื่อง': '#3b82f6',                          // blue
  'รับบรีฟแล้ว (กำลังดำเนินการ)': '#8b5cf6',          // violet
  'รอโพสต์ตามกำหนดการ': '#f59e0b',                    // orange
  'โพสต์เรียบร้อย (เสร็จสิ้น)': '#10b981',            // green
  'ตีกลับให้แก้ไขงาน': '#ef4444',                     // red
  'กำลังแก้ไขงาน': '#f97316',                         // bright orange
};

function bucketStatus(rawStatus) {
  const s = (rawStatus || '').toString();
  if (KANBAN_STATUSES.includes(s)) return s;
  // Substring fallbacks for legacy / variant wording
  if (s.includes('เสร็จสิ้น') || s.includes('โพสต์เรียบร้อย')) return 'โพสต์เรียบร้อย (เสร็จสิ้น)';
  if (s.includes('ตีกลับ')) return 'ตีกลับให้แก้ไขงาน';
  if (s.includes('กำลังแก้ไข') || s.includes('แก้ไขงาน')) return 'กำลังแก้ไขงาน';
  if (s.includes('รอโพสต์')) return 'รอโพสต์ตามกำหนดการ';
  if (s.includes('บรีฟ') || s.includes('ดำเนินการ')) return 'รับบรีฟแล้ว (กำลังดำเนินการ)';
  if (s.includes('รับเรื่อง') && !s.includes('รอ')) return 'PR รับเรื่อง';
  return 'รอ PR รับเรื่อง';
}

export function filterPRStaffTickets() {
  const filterEl = document.getElementById('prStaffDeptFilter');
  const filterValue = filterEl ? filterEl.value : 'all';
  const q = (document.getElementById('prStaffSearch')?.value || '').trim().toLowerCase();

  let filtered = filterValue === 'all'
    ? prStaffTicketsCache
    : prStaffTicketsCache.filter((t) => t.dept === filterValue);

  // Free-text search across Ticket ID + ชื่องาน (content name).
  if (q) {
    filtered = filtered.filter((t) =>
      (t.id || '').toLowerCase().includes(q)
      || (t.contentName || '').toLowerCase().includes(q));
  }
  renderPRStaffKanban(filtered);
}

function renderPRStaffKanban(tickets) {
  const board = document.getElementById('prStaffKanban');
  if (!board) return;
  board.innerHTML = '';

  // Bucket tickets by status column
  const buckets = new Map(KANBAN_STATUSES.map((s) => [s, []]));
  tickets.forEach((t) => {
    const col = bucketStatus(t.status);
    buckets.get(col).push(t);
  });

  KANBAN_STATUSES.forEach((status) => {
    const list = buckets.get(status) || [];
    const color = STATUS_COLOR[status] || '#94a3b8';

    const column = document.createElement('section');
    column.className = 'pr-kanban-column';
    column.style.setProperty('--col-color', color);

    let cardsHtml;
    if (list.length === 0) {
      cardsHtml = '<div class="pr-kanban-empty">ไม่มีงาน</div>';
    } else {
      cardsHtml = list.map((t) => renderKanbanCard(t)).join('');
    }

    column.innerHTML = `
      <header class="pr-kanban-column-header">
        <span class="pr-kanban-column-dot"></span>
        <span class="pr-kanban-column-title">${escapeHtml(status)}</span>
        <span class="pr-kanban-column-count">${list.length}</span>
      </header>
      <div class="pr-kanban-column-body">${cardsHtml}</div>
    `;

    board.appendChild(column);
  });
}

function renderKanbanCard(t) {
  const originalIndex = prStaffTicketsCache.indexOf(t);
  const rushFlag = t.deadline && t.deadline.includes('ด่วน')
    ? '<span class="pr-kanban-card-rush"><i class="bi bi-rocket-takeoff"></i> ด่วน</span>'
    : '';
  // Attachment count on the CARD: a ticket's images and its pasted ลิงก์
  // are the thing staff open Discord to look for, so say on the board
  // whether there is anything to open before they click into the modal.
  const attachments = parsePrAttachments(t.fileUrl);
  const attachFlag = attachments.length > 0
    ? `<span><i class="bi bi-paperclip me-1"></i>${attachments.length} ไฟล์/ลิงก์</span>`
    : '';
  const assigneesHtml = (t.assignees && t.assignees.length > 0)
    ? `<div class="pr-kanban-card-assignees">${t.assignees.map(a => `<span class="pr-kanban-card-assignee"><i class="bi bi-person-fill me-1"></i>${escapeHtml(a)}</span>`).join('')}</div>`
    : '<div class="pr-kanban-card-noassign"><i class="bi bi-person me-1"></i>ยังไม่มีผู้รับผิดชอบ</div>';

  return `
    <article class="pr-kanban-card" tabindex="0" onclick="openPRStaffModal(${originalIndex})"
      onkeydown="if(event.key==='Enter'){openPRStaffModal(${originalIndex});}">
      <div class="d-flex justify-content-between align-items-start gap-2">
        <span class="pr-kanban-card-id">${escapeHtml(t.id)}</span>
        ${rushFlag}
      </div>
      <h6 class="pr-kanban-card-title">${escapeHtml(t.contentName || '(ไม่มีชื่องาน)')}</h6>
      <div class="pr-kanban-card-dept"><i class="bi bi-building"></i> ${escapeHtml(t.dept || '-')}</div>
      ${assigneesHtml}
      <div class="pr-kanban-card-meta">
        <span><i class="bi bi-clock me-1"></i>${escapeHtml(t.date || '')}</span>
        ${attachFlag}
      </div>
    </article>
  `;
}

// Local alias — kept so we don't have to touch every call site. The
// canonical implementation lives in utils.js (`escHtml`) so all
// renderers across the app share one definition.
const escapeHtml = escHtml;

// --------------------------------------------------
// Open PR Staff Modal
// --------------------------------------------------

export function openPRStaffModal(idx) {
  const t = prStaffTicketsCache[idx];
  if (!t) return;
  currentActivePrTicketId = t.id;
  document.getElementById('prStaffModalTitle').innerText = t.id;
  document.getElementById('prStaffModalCurrentStatus').innerText = `สถานะปัจจุบัน: ${t.status}`;
  document.getElementById('prStaffModalDept').innerText = t.dept;
  document.getElementById('prStaffModalPubDateText').innerText = t.publishDate;

  // Convert dd/MM/yyyy HH:mm -> yyyy-MM-ddTHH:mm
  let pubDateVal = '';
  if (t.publishDate && t.publishDate !== '-') {
    const m = t.publishDate.match(/(\d{2})\/(\d{2})\/(\d{4})\s(\d{2}:\d{2})/);
    if (m) { pubDateVal = `${m[3]}-${m[2]}-${m[1]}T${m[4]}`; }
    else { pubDateVal = t.publishDate.replace(' ', 'T'); if (pubDateVal.length > 16) pubDateVal = pubDateVal.substring(0, 16); }
  }
  document.getElementById('prStaffActionDate').value = pubDateVal;
  document.getElementById('prStaffModalJobType').innerText = t.jobType;
  document.getElementById('prStaffModalPlatform').innerText = t.platforms;
  document.getElementById('prStaffModalChannel').innerText = t.postingChannel;
  document.getElementById('prStaffModalProjectInfo').innerText = t.projectAccount + ' / ' + t.copostWith;
  document.getElementById('prStaffModalContact').innerText = t.contact;
  document.getElementById('prStaffModalEmail').innerText = t.submitter;

  // Other Platform
  if (t.otherPlatforms && t.otherPlatforms !== '-') {
    document.getElementById('prStaffModalOtherPlatBox').classList.remove('d-none');
    document.getElementById('prStaffModalOtherPlat').innerText = t.otherPlatforms;
    if (t.otherPlatformReason && t.otherPlatformReason !== '-') {
      document.getElementById('prStaffModalOtherPlatReasonBox').classList.remove('d-none');
      document.getElementById('prStaffModalOtherPlatReason').innerText = t.otherPlatformReason;
    } else {
      document.getElementById('prStaffModalOtherPlatReasonBox').classList.add('d-none');
    }
  } else {
    document.getElementById('prStaffModalOtherPlatBox').classList.add('d-none');
  }

  document.getElementById('prStaffModalBrief').innerText = t.brief;
  document.getElementById('prStaffModalCaption').innerText = t.caption;

  if (t.deadline && t.deadline.includes('ด่วน')) {
    document.getElementById('prStaffModalRushReasonBox').classList.remove('d-none');
    document.getElementById('prStaffModalRushReason').innerText = t.rushReason;
  } else {
    document.getElementById('prStaffModalRushReasonBox').classList.add('d-none');
  }

  // File links — one shared reading of file_url (src/js/pr-attachments.js).
  // This block used to require the blob to START with 'http', so a ticket
  // whose only attachment was a pasted ลิงก์เสริม read "ไม่มีไฟล์แนบ" here
  // while Discord and the submitter's tracking page both showed the link.
  // safeUrl + escHtml live in that module: guests submit largeFileLink as
  // free text, so the href needs the guard.
  document.getElementById('prStaffModalLinkBox').innerHTML = renderPrAttachments(t.fileUrl);

  renderTimeline('prStaffModalTimeline', t.remarks, t.date);
  document.getElementById('prStaffActionStatus').value = t.status;
  let currentDeadline = (t.deadline && t.deadline.includes('ด่วน')) ? 'ด่วน (PR Review)' : 'ปกติ';
  document.getElementById('prStaffActionDeadlineStatus').value = currentDeadline;
  document.getElementById('prStaffActionRemark').value = '';
  currentPrAssignees = t.assignees ? [...t.assignees] : [];
  renderPRStaffAssignees();
  bootstrap.Tab.getOrCreateInstance(document.getElementById('pr-staff-detail-tab')).show();
  new bootstrap.Modal(document.getElementById('prStaffManageModal')).show();
}

// --------------------------------------------------
// Submit PR Staff Action
// --------------------------------------------------

export async function submitPRStaffAction() {
  const newStatus = document.getElementById('prStaffActionStatus').value;
  const newDeadlineStatus = document.getElementById('prStaffActionDeadlineStatus').value;
  const remark = document.getElementById('prStaffActionRemark').value.trim();
  const rawDateVal = document.getElementById('prStaffActionDate').value;
  const newPublishDate = rawDateVal.replace('T', ' ');

  const ticket = prStaffTicketsCache.find((t) => t.id === currentActivePrTicketId);
  let autoLogs = [];
  if (ticket) {
    if (newStatus && newStatus !== ticket.status) autoLogs.push(`เปลี่ยนสถานะเป็น: ${newStatus}`);
    if (newDeadlineStatus && newDeadlineStatus !== ticket.deadline) autoLogs.push(`อัปเดตสถานะความด่วนเป็น: ${newDeadlineStatus}`);
    let newDateDisplay = newPublishDate;
    const dtMatch = newPublishDate.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}:\d{2})/);
    if (dtMatch) newDateDisplay = `${dtMatch[3]}/${dtMatch[2]}/${dtMatch[1]} ${dtMatch[4]}`;
    let oldDateClean = ticket.publishDate && ticket.publishDate !== '-' ? ticket.publishDate.substring(0, 16) : 'ไม่มีกำหนดการเดิม';
    if (newPublishDate && newDateDisplay !== oldDateClean) autoLogs.push(`เปลี่ยนวัน-เวลาโพสต์จาก ${oldDateClean} เป็น ${newDateDisplay}`);
  }

  const btn = document.querySelector('#prStaffManageModal .btn-dark');
  btn.disabled = true; btn.innerHTML = 'กำลังบันทึก...';

  try {
    // Fetch current remarks from DB so we don't clobber server-side
    // updates that happened since the modal was opened.
    const { data: existing, error: fetchErr } = await db
      .from('pr_tickets')
      .select('remarks')
      .eq('id', currentActivePrTicketId)
      .maybeSingle();
    if (fetchErr) throw fetchErr;

    const remarks = Array.isArray(existing?.remarks) ? [...existing.remarks] : [];
    const time = new Date().toLocaleString('en-GB', {
      day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
    }).replace(',', '');
    autoLogs.forEach((text) => remarks.push({ time, by: 'ระบบ', text, type: 'log' }));
    if (remark) remarks.push({ time, by: 'ทีม PR', text: remark });

    const update = {
      remarks,
      assignees: currentPrAssignees,
    };
    if (newStatus) update.status = newStatus;
    if (newDeadlineStatus) update.deadline_status = newDeadlineStatus;
    if (newPublishDate) {
      // Convert "YYYY-MM-DD HH:mm" → ISO
      const isoCandidate = newPublishDate.replace(' ', 'T');
      const d = new Date(isoCandidate);
      if (!isNaN(d.getTime())) update.publish_date = d.toISOString();
    }

    // dbRest + return=representation so we can detect RLS no-ops:
    // supabase-js returns { data:null, error:null } when zero rows
    // update, which silently fakes success. See mistakes.md.
    const idEsc = encodeURIComponent(currentActivePrTicketId);
    const { data: updated, error: updErr } = await dbRest(
      `/pr_tickets?id=eq.${idEsc}`,
      { method: 'PATCH', body: update, prefer: 'return=representation' },
    );
    if (updErr) throw new Error(updErr.message || 'update failed');
    if (!Array.isArray(updated) || updated.length === 0) {
      throw new Error('อัปเดตไม่สำเร็จ — ไม่พบ ticket หรือคุณไม่มีสิทธิ์แก้ไข');
    }

    alert('อัปเดตสถานะงาน PR สำเร็จ!');
    bootstrap.Modal.getInstance(document.getElementById('prStaffManageModal')).hide();
    fetchPRStaffTickets();
  } catch (e) { alert('เกิดข้อผิดพลาดในการบันทึก: ' + (e.message || e)); }
  finally { btn.disabled = false; btn.innerHTML = 'บันทึกอัปเดต'; }
}

// --------------------------------------------------
// Delete PR Ticket
// --------------------------------------------------

export async function deletePRStaffAction() {
  // Soft-delete via the RPC (recoverable by admin — but we DON'T surface
  // that to staff, who'd otherwise ask to undo casual deletes). The confirm
  // shows the ticket id + name so you can't nuke the wrong one.
  const t = prStaffTicketsCache.find((x) => x.id === currentActivePrTicketId);
  const name = (t?.contentName || '').slice(0, 60);
  if (!confirm(`⚠️ ลบงาน PR นี้?\n\n${currentActivePrTicketId}${name ? ' — ' + name : ''}\n\nข้อมูลจะไม่สามารถกู้คืนได้`)) return;
  const btn = document.querySelector('#prStaffManageModal .btn-danger');
  const ogText = btn.innerHTML;
  btn.disabled = true; btn.innerHTML = 'กำลังลบ...';

  try {
    const { data, error } = await dbRest(
      '/rpc/soft_delete_pr_ticket',
      { method: 'POST', body: { p_id: currentActivePrTicketId } },
    );
    if (error) throw new Error(error.message || 'delete failed');
    if (!data || !data.id) {
      throw new Error('ลบไม่สำเร็จ — ไม่พบ ticket หรือคุณไม่มีสิทธิ์ลบ');
    }
    alert('ลบงาน PR เรียบร้อยแล้ว!');
    bootstrap.Modal.getInstance(document.getElementById('prStaffManageModal')).hide();
    fetchPRStaffTickets();
  } catch (e) { alert('เกิดข้อผิดพลาดในการลบ: ' + (e.message || e)); }
  finally { btn.disabled = false; btn.innerHTML = ogText; }
}

// --------------------------------------------------
// Agent Management
// --------------------------------------------------

async function loadGlobalAgents() {
  try {
    const { data, error } = await db
      .from('pr_agents')
      .select('agents')
      .eq('id', 1)
      .maybeSingle();
    if (error) throw error;
    globalPrAgents = (data?.agents) || [];
    populateAssigneeDropdown();
  } catch (e) { console.error('Failed to load agents', e); }
}

async function saveGlobalAgents() {
  try {
    const { data, error } = await dbRest(
      `/pr_agents?id=eq.1`,
      {
        method: 'PATCH',
        body: { agents: globalPrAgents, updated_at: new Date().toISOString() },
        prefer: 'return=representation',
      },
    );
    if (error) throw new Error(error.message || 'save failed');
    if (!Array.isArray(data) || data.length === 0) {
      throw new Error('บันทึกไม่สำเร็จ — ไม่พบ agent roster หรือคุณไม่มีสิทธิ์แก้ไข');
    }
  } catch (e) { console.error('Failed to save agents', e); }
}

export async function openManageAgentsModal() {
  const btn = document.querySelector('button[onclick="openManageAgentsModal()"]');
  const ogText = btn.innerHTML;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> กำลังโหลด...'; btn.disabled = true;
  await loadGlobalAgents();
  btn.innerHTML = ogText; btn.disabled = false;
  renderManageAgentsList();
  new bootstrap.Modal(document.getElementById('manageAgentsModal')).show();
}

function renderManageAgentsList() {
  const listUI = document.getElementById('globalAgentsListUI');
  listUI.innerHTML = '';
  if (globalPrAgents.length === 0) {
    listUI.innerHTML = '<li class="list-group-item text-center text-muted small py-3">ยังไม่มีรายชื่อทีม</li>';
    return;
  }
  globalPrAgents.forEach((agent, index) => {
    listUI.insertAdjacentHTML('beforeend', `
      <li class="list-group-item d-flex justify-content-between align-items-center bg-light">
        <span class="fw-bold text-secondary">${escapeHtml(agent)}</span>
        <button class="btn btn-sm btn-outline-danger border-0" onclick="removeAgent(${index})"><i class="bi bi-trash-fill"></i></button>
      </li>
    `);
  });
}

export function addNewAgent() {
  const input = document.getElementById('newAgentNameInput');
  const name = input.value.trim();
  if (name && !globalPrAgents.includes(name)) {
    globalPrAgents.push(name);
    input.value = '';
    renderManageAgentsList();
    populateAssigneeDropdown();
    saveGlobalAgents();
  }
}

export function removeAgent(index) {
  globalPrAgents.splice(index, 1);
  renderManageAgentsList();
  populateAssigneeDropdown();
  saveGlobalAgents();
}

function populateAssigneeDropdown() {
  const select = document.getElementById('prStaffAssigneeSelect');
  if (!select) return;
  select.innerHTML = '<option value="" disabled selected>-- เลือกผู้รับผิดชอบ --</option>';
  globalPrAgents.forEach(agent => {
    const e = escapeHtml(agent);
    select.insertAdjacentHTML('beforeend', `<option value="${e}">${e}</option>`);
  });
}

export function addPRStaffAssignee() {
  const select = document.getElementById('prStaffAssigneeSelect');
  const name = select.value;
  if (name && !currentPrAssignees.includes(name)) {
    currentPrAssignees.push(name);
    select.value = '';
    renderPRStaffAssignees();
  }
}

export function removePRStaffAssignee(name) {
  currentPrAssignees = currentPrAssignees.filter(n => n !== name);
  renderPRStaffAssignees();
}

function renderPRStaffAssignees() {
  const list = document.getElementById('prStaffAssigneesList');
  list.innerHTML = '';
  currentPrAssignees.forEach(name => {
    // Escape twice: for the visible text AND for the onclick arg. Names
    // come from the editable agent roster, so a malicious dev could put
    // an apostrophe in to break out of the string — that's a low-risk
    // self-XSS at best, but the defense is one extra escape.
    const eHtml = escapeHtml(name);
    const eAttr = name.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    list.insertAdjacentHTML('beforeend', `
      <span class="badge rounded-pill bg-light text-dark border px-3 py-2 d-flex align-items-center shadow-sm">
        ${eHtml}
        <i class="bi bi-x-circle-fill ms-2 text-danger" style="cursor:pointer; font-size: 1.1rem;" onclick="removePRStaffAssignee('${eAttr}')"></i>
      </span>
    `);
  });
}
