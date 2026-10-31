// ==============================================
// VS TRACKING — User ticket tracking & history
// ==============================================

import { formatThaiDate, renderTimeline, escHtml, stripHtmlToText, remarkVis } from './utils.js';
import { dbRest } from './db.js';
import { getUser as authGetUser } from './auth.js';
import { vsResolution } from './vs-resolution.js';

let currentActiveTicketId = null;
let canUserReply = false;
let loggedInUserTickets = [];

// Submitter-safe column allow-list for the LEGACY direct vs_tickets read.
// Deliberately EXCLUDES `duplicate_of` (leaks the canonical id → another
// student's ticket) and any staff-only field; includes `is_duplicate`
// (non-identifying flag, 0074) so the UI can show the linked-issue banner
// without the id.
//
// Only the pre-0021 guest fallback still uses this. The owner history read
// moved to get_my_vs_tickets() in 0096 — a column allow-list cannot sanitize
// `remarks`, whose 0071 `internal: true` entries embed the canonical ticket's
// id in their TEXT ('รวมเป็นเรื่องซ้ำของ VS-…'). RLS lets an owner select
// their own row, so that id was on the wire for anyone who opened DevTools,
// and get_vs_ticket_by_id() is granted to anon — one paste away from another
// student's confidential complaint. Filtering it in rowToTicket() was
// cosmetic. See mistakes.md, "Sanitizing ONE read path … leaves parallel read
// paths leaking" — same bug 0074 fixed for the COLUMN and missed for the TEXT.
const SUBMITTER_COLS =
  'id,timestamp,created_at,problem,target_dept,status,remarks,resolution,resolution_note,is_duplicate';

// --------------------------------------------------
// Submitter-facing phase model
//
// The 9 internal staff statuses (see vs-staff.js KANBAN_COLUMNS) stay the
// source of truth — the staff board is unchanged. For the STUDENT tracking
// view we collapse those 9 into 4 human phases so a submitter sees a clear
// progress story instead of internal routing jargon. The exact status is
// still shown as a caption, so nothing is hidden.
//
//   0 ส่งเรื่อง   — รอ SE รับเรื่อง (+ any unknown/legacy early status)
//   1 รับเรื่อง   — SE รับเรื่องแล้ว, รออุปนายก*, อุปนายกรับเรื่องแล้ว,
//                   ปฏิเสธ (ส่งคืน SE)  ← a re-consideration bounce, not terminal
//   2 ดำเนินการ  — กำลังดำเนินการ, กำลังติดต่อคณะ
//   3 เสร็จสิ้น   — เสร็จสิ้น
// --------------------------------------------------

export const VS_PHASES = [
  { key: 'submitted', label: 'ส่งเรื่อง',  desc: 'ส่งเรื่องแล้ว รอเจ้าหน้าที่รับเรื่อง',   badge: 'bg-warning text-dark' },
  { key: 'reviewing', label: 'รับเรื่อง',  desc: 'เจ้าหน้าที่กำลังพิจารณาเรื่องของคุณ',    badge: 'bg-info text-dark' },
  { key: 'working',   label: 'ดำเนินการ', desc: 'กำลังดำเนินการแก้ไขปัญหาของคุณ',        badge: 'bg-primary' },
  { key: 'done',      label: 'เสร็จสิ้น',  desc: 'ดำเนินการเสร็จสิ้น',                    badge: 'bg-success' },
];

// Order of checks matters — most-advanced phase wins. "เสร็จสิ้น" first so a
// completed ticket never falls into an earlier branch; then the ดำเนินการ
// band; then anything that reached SE/VP; else the initial ส่งเรื่อง phase.
export function vsPhaseIndex(status) {
  const s = status || '';
  if (s.includes('เสร็จสิ้น')) return 3;
  if (s.includes('ดำเนินการ') || s.includes('ติดต่อคณะ')) return 2;
  if (s.includes('SE รับเรื่องแล้ว') || s.includes('อุปนายก') || s.includes('ปฏิเสธ')) return 1;
  return 0;
}

// Build the 4-node progress stepper. A node is "done" when its phase has
// been passed, "active" (pulsing) when it's the current phase, else pending.
// When the ticket is complete (phase 3) the last node reads done, not active.
function renderVsStepper(status) {
  return renderVsStepperByPhase(vsPhaseIndex(status));
}

// Same stepper, driven by an explicit 0..3 phase index. Used by the public
// board (get_public_vs_board returns a phase, never the raw status).
export function renderVsStepperByPhase(idx) {
  const isComplete = idx === 3;
  return `<div class="vs-stepper" role="list">` + VS_PHASES.map((p, i) => {
    let cls = 'vs-step';
    let inner = String(i + 1);
    if (i < idx || (i === idx && isComplete)) { cls += ' is-done'; inner = '<i class="bi bi-check-lg"></i>'; }
    else if (i === idx) { cls += ' is-active'; }
    return `<div class="${cls}" role="listitem">
        <span class="vs-step-dot">${inner}</span>
        <span class="vs-step-label">${escHtml(p.label)}</span>
      </div>`;
  }).join('') + `</div>`;
}

// Map a vs_tickets DB row to the legacy shape rendererers expect.
function rowToTicket(r) {
  return {
    id: r.id,
    date: r.timestamp || r.created_at,
    problem: r.problem,
    dept: r.target_dept,
    status: r.status,
    // Both submitter read paths now strip staff-only entries SERVER-side
    // (get_my_vs_tickets + get_vs_ticket_by_id, 0096) — this filter is
    // defence-in-depth for the pre-0021 direct-read fallback below, and it
    // matches the server's ladder: anything at 'staff' never reaches here.
    // Entries carrying from_thread came from a sibling ticket in the same
    // duplicate group; renderTimeline labels them.
    remarks: Array.isArray(r.remarks) ? r.remarks.filter((e) => remarkVis(e) !== 'staff') : [],
    // Resolution reason on close (0073) — submitter-facing outcome. Present on
    // both the guest by-id lookup (returns the whole row) and the owner read.
    resolution: r.resolution || null,
    resolutionNote: r.resolution_note || null,
    // Linked-duplicate flag (0074) — non-identifying; the canonical id is never
    // exposed. Drives the "handled together with an earlier report" banner. The
    // guest RPC returns is_duplicate while nulling duplicate_of; the owner read
    // selects is_duplicate and omits duplicate_of entirely.
    isDuplicate: !!r.is_duplicate,
    isOwner: false, // overridden by callers when appropriate
  };
}

// --------------------------------------------------
// Track by Ticket ID (Guest)
// --------------------------------------------------

/** @param {string} [idOverride] Look up this id instead of reading the input.
 *  Used by the hash router to restore `#track/VS-XXXX` on reload. */
export async function trackWithTicketId(idOverride) {
  const tId = (typeof idOverride === 'string' && idOverride)
    ? idOverride.trim()
    : document.getElementById('trackTicketId').value.trim();
  const alertBox = document.getElementById('trackAlert');
  const btn = document.getElementById('btnTrackGuest');
  if (!tId) { alertBox.classList.remove('d-none'); alertBox.innerText = 'กรุณากรอก Ticket ID'; return; }

  btn.disabled = true; btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>กำลังค้นหา...'; alertBox.classList.add('d-none');
  try {
    // Use the security-definer RPC (migration 0021) so the lookup
    // works whether the caller is signed in or not. Direct table
    // reads via RLS would deny anonymous users — staff-only.
    // Pre-0021 fallback: try the direct read via dbRest if the RPC
    // 404s, so the site still works on databases without the migration.
    let { data, error } = await dbRest('/rpc/get_vs_ticket_by_id', {
      method: 'POST',
      body: { p_id: tId },
    });
    if (error && error.status === 404) {
      if (!window.__samoWarnedGuestRpcVs) {
        window.__samoWarnedGuestRpcVs = true;
        console.warn('[vs-tracking] get_vs_ticket_by_id RPC missing — apply migration 0021_guest_ticket_lookup_rpcs.sql for guest lookup. Falling back to direct read.');
      }
      // Fallback also uses the submitter-safe column list — never duplicate_of.
      const tIdEsc = encodeURIComponent(tId);
      ({ data, error } = await dbRest(`/vs_tickets?select=${SUBMITTER_COLS}&id=eq.${tIdEsc}&deleted_at=is.null&limit=1`));
    }
    if (error) throw new Error(error.message || 'ค้นหาล้มเหลว');
    const row = Array.isArray(data) && data.length > 0 ? data[0] : null;
    if (row) {
      currentActiveTicketId = row.id;
      canUserReply = false;
      renderUserDashboard(rowToTicket(row));
      document.getElementById('vsLoginBox').classList.add('d-none');
      document.getElementById('vsDashboardBox').classList.remove('d-none');
      // Arrived by ticket-ID lookup → back goes to the search screen.
      setDashBack('กลับหน้าค้นหาสถานะ', logoutTrack);
      vsRoute(`track/${row.id}`);
    } else {
      alertBox.classList.remove('d-none');
      alertBox.innerText = 'ไม่พบ Ticket นี้ในระบบ';
    }
  } catch (e) {
    alertBox.classList.remove('d-none');
    alertBox.innerText = e.message || 'เกิดข้อผิดพลาดในการเชื่อมต่อเครือข่าย';
  }
  finally { btn.disabled = false; btn.innerHTML = 'ค้นหาสถานะ'; }
}

// --------------------------------------------------
// Login to View History
// --------------------------------------------------

export async function loginToViewHistory() {
  const alertBox = document.getElementById('trackAlert');
  const btn = document.getElementById('btnTrackLogin');
  const authUser = authGetUser();

  if (!authUser) {
    alertBox.classList.remove('d-none');
    alertBox.innerText = 'กรุณาเข้าสู่ระบบก่อน';
    return;
  }

  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>กำลังโหลด...'; }
  alertBox.classList.add('d-none');

  try {
    // get_my_vs_tickets (0096) — a SECURITY DEFINER read that resolves "which
    // tickets are mine" from auth.uid() server-side (never a client-supplied
    // label) and returns the submitter-safe projection: no `duplicate_of`, no
    // internal tags, no staff-only remarks, PLUS any thread-scoped progress
    // notes shared across this ticket's duplicate group.
    const { data, error } = await dbRest('/rpc/get_my_vs_tickets', {
      method: 'POST', body: {},
    });
    if (error) throw new Error(error.message || 'โหลดประวัติล้มเหลว');
    // The RPC returns a jsonb array; dbRest hands it back as-is.
    loggedInUserTickets = (Array.isArray(data) ? data : []).map(rowToTicket);
    renderUserHistoryList();
    document.getElementById('vsLoginBox').classList.add('d-none');
    document.getElementById('vsDashboardBox').classList.add('d-none');
    document.getElementById('vsUserHistoryBox').classList.remove('d-none');
  } catch (e) {
    alertBox.classList.remove('d-none');
    alertBox.innerText = e.message || 'เกิดข้อผิดพลาดในการเชื่อมต่อเครือข่าย';
  }
  finally { if (btn) { btn.disabled = false; btn.innerHTML = 'เข้าสู่ระบบ'; } }
}

// --------------------------------------------------
// Render User History List
// --------------------------------------------------

function renderUserHistoryList() {
  const listContainer = document.getElementById('userHistoryList');
  listContainer.innerHTML = '';
  if (loggedInUserTickets.length === 0) { listContainer.innerHTML = '<div class="col-12 text-center text-muted mt-4">คุณยังไม่มีประวัติการแจ้งปัญหาในระบบ</div>'; return; }

  loggedInUserTickets.forEach((t) => {
    // Colour by submitter-facing phase (badge text still shows the exact
    // status). Keeps the history list consistent with the detail view.
    const phase = VS_PHASES[vsPhaseIndex(t.status)];
    const badgeColor = phase.badge;
    const strippedProblem = stripHtmlToText(t.problem, 120);

    // Escape every user-text field. strippedProblem is post-stripped
    // HTML so it's plain text already, but we escape again for safety
    // (the strip regex doesn't catch every payload).
    listContainer.insertAdjacentHTML('beforeend', `
      <div class="col-md-6">
        <div class="card shadow-sm border-0 h-100" style="cursor: pointer;" onclick="openTicketDetail('${escHtml(t.id)}')">
          <div class="card-body">
            <div class="d-flex justify-content-between mb-2"><span class="fw-bold text-pink-custom">${escHtml(t.id)}</span><span class="badge ${badgeColor}">${escHtml(t.status)}</span></div>
            <p class="small text-muted mb-1"><i class="bi bi-clock"></i> ${escHtml(t.date)}</p>
            <p class="card-text small text-truncate">${escHtml(strippedProblem)}</p>
          </div>
        </div>
      </div>
    `);
  });
}

// --------------------------------------------------
// Open Individual Ticket Detail
// --------------------------------------------------

/** @returns {boolean} whether the ticket was found in the loaded history —
 *  the hash router uses this to decide whether to fall back to the by-id
 *  guest lookup. */
export function openTicketDetail(ticketId) {
  const ticket = loggedInUserTickets.find((t) => t.id === ticketId);
  if (!ticket) return false;
  currentActiveTicketId = ticket.id; canUserReply = true;
  renderUserDashboard(ticket);
  document.getElementById('vsUserHistoryBox').classList.add('d-none');
  document.getElementById('vsDashboardBox').classList.remove('d-none');
  // Arrived from the history list → back returns there, not to the search.
  setDashBack('กลับหน้าประวัติ', () => {
    document.getElementById('vsDashboardBox').classList.add('d-none');
    document.getElementById('vsUserHistoryBox').classList.remove('d-none');
    vsRoute('track');
  });
  // Reloading is how people check for progress — put the ticket in the URL so
  // the reload lands back on it instead of on กระดานปัญหา.
  vsRoute(`track/${ticket.id}`);
  return true;
}

/** Write VS sub-state to the URL. Routed through window so this module stays
 *  importable by vs-route.js without a cycle; a no-op if routing isn't wired. */
function vsRoute(sub) {
  if (typeof window.vsSetRoute === 'function') window.vsSetRoute(sub);
}

/** The ticket the dashboard is currently showing, or null. Read by vs-route
 *  when it re-syncs the URL after the tab is re-entered (the path router
 *  clears the hash on any tab switch, so the hash has to be rebuilt from the
 *  live view or the URL and the screen disagree). */
export function currentTrackedTicketId() {
  const box = document.getElementById('vsDashboardBox');
  if (!box || box.classList.contains('d-none')) return null;
  return currentActiveTicketId;
}

/** Point the detail view's top-left back link at wherever the user came from.
 *  The markup is `<i class="bi bi-arrow-left"></i><span id="…Label">` — write
 *  the SPAN, never the button's innerText, or the arrow icon is destroyed. */
function setDashBack(label, handler) {
  const btn = document.getElementById('btnBackToHistory');
  if (!btn) return;
  const span = document.getElementById('btnBackToHistoryLabel');
  if (span) span.textContent = label; else btn.textContent = label;
  btn.onclick = handler;
}

// --------------------------------------------------
// Render User Dashboard
// --------------------------------------------------

function renderUserDashboard(ticket) {
  document.getElementById('dashTicketId').innerText = `Ticket #${ticket.id}`;

  // Friendly phase (derived from the exact status) drives the headline badge
  // and the stepper; the exact 9-status value is still shown as a caption.
  const idx = vsPhaseIndex(ticket.status);
  const phase = VS_PHASES[idx];
  const statusBadge = document.getElementById('dashStatusBadge');
  statusBadge.className = `badge fs-6 rounded-pill px-3 py-2 shadow-sm ${phase.badge}`;
  statusBadge.innerText = phase.label;

  // Board banner. Two cases, both answered by get_vs_linked_context:
  //   * DUPLICATE (0074/0075) — merged into an earlier report. Show a baseline
  //     immediately, then upgrade with server context (a public board link, or
  //     "private links exist + count"). The other ticket is never revealed.
  //   * CANONICAL on the board (0099) — THIS report is the public problem.
  //     Nothing to show until the fetch resolves (a submitter has no way to
  //     know locally whether SE published them), so the banner stays hidden
  //     and enhanceBoardBanner reveals it.
  const linkedEl = document.getElementById('dashLinkedBanner');
  if (linkedEl) {
    if (ticket.isDuplicate) {
      const msg = idx === 3
        ? 'เรื่องของคุณได้รับการดำเนินการร่วมกับเรื่องที่เกี่ยวข้อง'
        : 'เรื่องของคุณกำลังดำเนินการร่วมกับเรื่องที่เกี่ยวข้อง — ความคืบหน้าด้านล่างจะอัปเดตตามเรื่องหลัก';
      linkedEl.className = 'vs-linked-banner mb-3';
      linkedEl.innerHTML = `<i class="bi bi-diagram-2 me-2"></i><span>${escHtml(msg)}</span>`;
    } else {
      linkedEl.className = 'd-none';
      linkedEl.innerHTML = '';
    }
    enhanceBoardBanner(ticket, idx);
  }

  const stepperEl = document.getElementById('dashStepper');
  if (stepperEl) {
    stepperEl.innerHTML =
      renderVsStepper(ticket.status)
      + `<div class="vs-phase-desc">${escHtml(phase.desc)}</div>`
      + `<div class="vs-phase-exact">สถานะโดยละเอียด: ${escHtml(ticket.status)}</div>`;
  }

  // Resolution outcome card — only when the ticket is done AND a reason was
  // recorded by staff (0073). Older done tickets with no resolution just show
  // the stepper's generic "เสร็จสิ้น", so nothing regresses.
  const resEl = document.getElementById('dashResolution');
  if (resEl) {
    const meta = idx === 3 ? vsResolution(ticket.resolution) : null;
    if (meta) {
      resEl.className = `vs-resolution-card ${meta.key === 'wont_do' ? 'is-negative' : ''}`;
      resEl.innerHTML =
        `<div class="vs-resolution-head"><i class="bi ${meta.icon}"></i> ผลการดำเนินการ</div>`
        + `<div class="vs-resolution-label">${escHtml(meta.student)}</div>`
        + (ticket.resolutionNote
          ? `<div class="vs-resolution-note">${escHtml(ticket.resolutionNote)}</div>` : '');
    } else {
      resEl.className = 'd-none';
      resEl.innerHTML = '';
    }
  }

  const formattedDate = formatThaiDate(ticket.date);
  const deptNote = ticket.status.includes('รออุปนายก') ? `${ticket.dept} (รอพิจารณา)` : ticket.dept;
  document.getElementById('dashTicketDate').innerText = `วันที่แจ้ง: ${formattedDate} | ฝ่ายปัจจุบัน: ${deptNote}`;
  document.getElementById('dashTicketProblem').innerHTML = ticket.problem;

  renderTimeline('dashTimeline', ticket.remarks, formattedDate);
  const remarkBox = document.getElementById('userRemarkBox');
  if (canUserReply) remarkBox.classList.remove('d-none'); else remarkBox.classList.add('d-none');
}

// Fill the board banner from SAFE server-computed context
// (get_vs_linked_context, 0075 + 0099). Three outcomes:
//   * self_public — THIS report is the public problem (canonical, published).
//   * linked + public — a duplicate whose canonical is on the board: a
//     follow-link to it. The canonical's id/title are already world-public.
//   * linked + private — a duplicate whose canonical is confidential: the
//     count only, never the id or title.
// Fire-and-forget; guards against a stale response after the user navigates
// to another ticket.
async function enhanceBoardBanner(ticket, idx) {
  const el = document.getElementById('dashLinkedBanner');
  if (!el) return;
  let ctx = null;
  try {
    const { data } = await dbRest('/rpc/get_vs_linked_context', {
      method: 'POST', body: { p_id: ticket.id },
    });
    ctx = data && typeof data === 'object' ? data : null;
  } catch { return; }
  if (ticket.id !== currentActiveTicketId) return;  // navigated away
  if (!ctx) return;
  const cnt = Number(ctx.related_count) || 0;

  // 0099 — the submitter's OWN report was published to กระดานปัญหา. Until now
  // only duplicates got a board link; the person whose report actually BECAME
  // the public problem had no way to know, or to follow the discussion on it.
  if (ctx.self_public && ctx.public_id) {
    const scale = cnt > 1 ? ` · มี ${cnt} เรื่องที่เกี่ยวข้อง` : '';
    el.className = 'vs-linked-banner is-public mb-3';
    el.innerHTML =
      `<div class="vs-linked-main"><i class="bi bi-megaphone-fill"></i>`
      + `<span>เรื่องของคุณถูกเผยแพร่บนกระดานปัญหาแล้ว: `
      + `<strong>${escHtml(ctx.public_title || '')}</strong>${escHtml(scale)}</span></div>`
      + `<button type="button" class="btn btn-sm vs-linked-cta" onclick="vsOpenBoardProblem('${escHtml(ctx.public_id)}')">`
      + `<i class="bi bi-arrow-up-right-circle me-1"></i>ดูบนกระดานปัญหา</button>`;
    return;
  }

  if (!ctx.linked) return;

  if (ctx.public && ctx.public_id) {
    const scale = cnt > 1 ? ` · มี ${cnt} เรื่องที่เกี่ยวข้อง` : '';
    el.className = 'vs-linked-banner is-public mb-3';
    el.innerHTML =
      `<div class="vs-linked-main"><i class="bi bi-megaphone-fill"></i>`
      + `<span>เรื่องของคุณตรงกับปัญหาสาธารณะ: <strong>${escHtml(ctx.public_title || '')}</strong>${escHtml(scale)}</span></div>`
      + `<button type="button" class="btn btn-sm vs-linked-cta" onclick="vsOpenBoardProblem('${escHtml(ctx.public_id)}')">`
      + `<i class="bi bi-arrow-up-right-circle me-1"></i>ติดตามบนกระดานปัญหา</button>`;
  } else {
    const base = idx === 3
      ? 'เรื่องของคุณได้รับการดำเนินการร่วมกับเรื่องที่เกี่ยวข้อง'
      : 'เรื่องของคุณกำลังดำเนินการร่วมกับเรื่องที่เกี่ยวข้อง';
    const scale = cnt > 1 ? ` (รวม ${cnt} เรื่อง)` : '';
    el.className = 'vs-linked-banner mb-3';
    el.innerHTML =
      `<i class="bi bi-shield-lock me-2"></i>`
      + `<span>${escHtml(base + scale)} — รายละเอียดของผู้แจ้งรายอื่นถูกเก็บเป็นความลับ</span>`;
  }
}

// --------------------------------------------------
// Submit User Remark
// --------------------------------------------------

export async function submitUserRemark() {
  const text = document.getElementById('userRemarkInput').value.trim();
  if (!text) return;
  const btn = document.querySelector('#userRemarkBox .btn-outline-danger');
  const alertBox = document.getElementById('userRemarkAlert');
  const ogText = btn.innerHTML;
  btn.innerHTML = 'กำลังส่ง...'; btn.disabled = true;
  alertBox?.classList.add('d-none');

  try {
    // vs_add_submitter_remark (0096). The old path was read-modify-write from
    // the browser — select the RAW remarks array (staff-only entries and all,
    // the leak fixed above), push, PATCH the whole thing back. Two replies in
    // flight also silently clobbered each other. The RPC appends server-side,
    // stamps the author + `vis: 'ticket'` itself, and verifies ownership.
    const { error } = await dbRest('/rpc/vs_add_submitter_remark', {
      method: 'POST',
      body: { p_id: currentActiveTicketId, p_text: text },
    });
    if (error) {
      const raw = error.message || '';
      let msg = 'ไม่พบ ticket หรือคุณไม่มีสิทธิ์ตอบกลับ';
      try { msg = JSON.parse(raw)?.message || msg; } catch { /* keep the default */ }
      throw new Error(msg);
    }
    document.getElementById('userRemarkInput').value = '';
    loginToViewHistory();
  } catch (e) {
    // Was a native alert() — silent after a few dialogs (Chrome's "prevent
    // additional dialogs" checkbox), and the typed reply would look like it
    // vanished with no explanation. An inline box next to the textarea is
    // always visible and never goes mute.
    if (alertBox) {
      alertBox.textContent = 'ส่งข้อความไม่สำเร็จ: ' + (e.message || e);
      alertBox.classList.remove('d-none');
    }
  }
  finally { btn.innerHTML = ogText; btn.disabled = false; }
}

// --------------------------------------------------
// Back to the ติดตามสถานะ entry screen
//
// Despite the name this never signs anyone out — it just returns to the box
// holding both "โหลดประวัติของฉัน" and the ticket-ID search. It is now the
// back target for BOTH sub-views (history list and ticket detail), so it has
// to leave a clean slate.
//
// It used to clear #trackUsername / #trackPassword, which no longer exist —
// the signed-in/signed-out split replaced them with #trackTicketIdAuth and
// #trackTicketId. getElementById returned null and the function threw
// mid-way, so the view switched but the stale #trackAlert error stayed on
// screen and an uncaught TypeError hit the console every time. Every lookup
// here is optional-chained so a future markup change degrades instead of
// half-running.
// --------------------------------------------------

export function logoutTrack() {
  currentActiveTicketId = null; canUserReply = false; loggedInUserTickets = [];
  document.getElementById('vsDashboardBox')?.classList.add('d-none');
  document.getElementById('vsUserHistoryBox')?.classList.add('d-none');
  document.getElementById('vsLoginBox')?.classList.remove('d-none');
  const guestId = document.getElementById('trackTicketId');
  if (guestId) guestId.value = '';
  const authId = document.getElementById('trackTicketIdAuth');
  if (authId) authId.value = '';
  document.getElementById('trackAlert')?.classList.add('d-none');
  vsRoute('track');   // stay in ติดตามสถานะ, drop the ticket from the URL
}
