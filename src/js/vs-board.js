// vs-board.js — VitalSound PUBLIC "Problem" board (Phase 2b UI).
//
// The public face of the help desk: a browsable board of the canonical
// Problems SE has published, with a 👥 "เจอเหมือนกัน" (me-too) counter and a
// pseudonymous public discussion thread. Everything here reads ONLY the curated
// projection returned by the SECURITY DEFINER RPCs in migration 0072 — never a
// raw ticket. Untrusted text (public_title, public_note, comment bodies, aliases)
// is always escHtml'd on render: the RPCs return attacker-influenceable columns
// (see mistakes.md "anon-INSERTable table's text columns are attacker-controlled").
//
// Auth: browsing is anonymous; me-too + commenting require a signed-in (kkumail)
// user — the RPCs fail closed, and the UI prompts the sign-in modal.

import { dbRest } from './db.js';
import { escHtml } from './utils.js';
import { getUser as authGetUser } from './auth.js';
import { VS_PHASES, renderVsStepperByPhase } from './vs-tracking.js';

// ---- module state ----
let categoriesLoaded = false; // categories fetched once (retried on failure)
let categories = [];         // non-confidential, board-eligible categories
let currentSort = 'hot';
let currentCategory = null;  // null = ทั้งหมด
let searchTimer = null;
let currentQuery = '';
let openProblemId = null;

const PHASE_BADGE = ['bg-warning text-dark', 'bg-info text-dark', 'bg-primary', 'bg-success'];

// --------------------------------------------------
// Init — wire the lazy-load trigger fired by toggleVitalSoundMode().
// --------------------------------------------------
export function initVsBoard() {
  if (!document.getElementById('vsBoardSection')) return;
  // Categories load once (retried on failure); the board list is reloaded on
  // EVERY show so me-too / comment counts stay fresh and a transient first-load
  // failure can't leave the board permanently empty.
  const prime = () => {
    (categoriesLoaded ? Promise.resolve() : loadCategories()).then(loadBoard);
  };
  // Mode-radio switched to board (fired by toggleVitalSoundMode).
  window.addEventListener('vs-board-shown', prime);
  // Navigating INTO the VitalSound tab (board is the default-visible mode) —
  // any tab trigger for #pills-vitalsound (navbar or offcanvas) fires this.
  document.addEventListener('shown.bs.tab', (e) => {
    if (e.target?.getAttribute('data-bs-target') === '#pills-vitalsound'
        && document.getElementById('vsModeBoard')?.checked) prime();
  });
  // Already the active pane on load (deep link) → prime now.
  const pane = document.getElementById('pills-vitalsound');
  if (pane && pane.classList.contains('active')) prime();
}

// --------------------------------------------------
// Categories → filter chips (loaded once; retried until it succeeds)
// --------------------------------------------------
async function loadCategories() {
  const { data, error } = await dbRest(
    '/vs_categories?select=id,label,icon,is_confidential,public_eligible&is_active=eq.true&order=sort_order.asc'
  );
  if (error || !Array.isArray(data)) { categories = []; return; }  // leave categoriesLoaded=false → retry next show
  // Only categories that can actually appear on the public board.
  categories = data.filter((c) => !c.is_confidential && c.public_eligible);
  categoriesLoaded = true;
  renderCategoryChips();
}

function renderCategoryChips() {
  const wrap = document.getElementById('vsBoardCats');
  if (!wrap) return;
  const chip = (id, label, icon) => {
    const active = currentCategory === id ? ' is-active' : '';
    const ic = icon ? `<i class="bi ${escHtml(icon)} me-1"></i>` : '';
    return `<button type="button" class="vs-cat-chip${active}" onclick="vsBoardCat(${id === null ? 'null' : `'${escHtml(id)}'`})">${ic}${escHtml(label)}</button>`;
  };
  wrap.innerHTML = chip(null, 'ทั้งหมด', 'bi-collection')
    + categories.map((c) => chip(c.id, c.label, c.icon)).join('');
}

// --------------------------------------------------
// Board list
// --------------------------------------------------
async function loadBoard() {
  const list = document.getElementById('vsBoardList');
  const empty = document.getElementById('vsBoardEmpty');
  if (!list) return;
  list.innerHTML = spinner();
  empty.classList.add('d-none');

  const { data, error } = await dbRest('/rpc/get_public_vs_board', {
    method: 'POST',
    body: { p_category: currentCategory, p_sort: currentSort, p_limit: 60 },
  });
  if (error) { list.innerHTML = errorNote('โหลดกระดานปัญหาไม่สำเร็จ'); return; }
  renderBoardList(Array.isArray(data) ? data : [], { showcase: true });
}

/** Render the board. With `showcase: true` (normal browse), RESOLVED problems
 *  move out of the grid into a horizontal "ผลงานที่แก้ไขสำเร็จ" strip — the
 *  showcase the user asked for: while completion counts are low, celebrate
 *  individual wins. Search results keep everything in the grid (a match must
 *  never be hidden inside the strip) and the strip is hidden. */
function renderBoardList(rows, { showcase = false } = {}) {
  const list = document.getElementById('vsBoardList');
  const empty = document.getElementById('vsBoardEmpty');
  const strip = document.getElementById('vsShowcaseStrip');
  if (!list) return;

  let gridRows = rows;
  if (showcase && strip) {
    const done = rows.filter((r) => (Number(r.phase) || 0) === 3);
    gridRows = rows.filter((r) => (Number(r.phase) || 0) !== 3);
    renderShowcase(done);
  } else if (strip) {
    strip.classList.add('d-none');
    strip.innerHTML = '';
  }

  if (!gridRows.length) {
    list.innerHTML = '';
    document.getElementById('vsBoardEmptyMsg').textContent =
      currentQuery ? 'ไม่พบปัญหาที่ตรงกับคำค้นหา'
        : (showcase && rows.length ? 'ไม่มีปัญหาที่กำลังดำเนินการอยู่ในขณะนี้'
          : 'ยังไม่มีปัญหาที่เปิดเผยในขณะนี้');
    empty.classList.remove('d-none');
    return;
  }
  empty.classList.add('d-none');
  list.innerHTML = gridRows.map(cardHtml).join('');
}

/** Horizontal, swipe-able strip of resolved problems ("ชูผลงานรายชิ้น").
 *  Auto-populated: SE publish + resolve = showcased; nothing extra to post. */
function renderShowcase(done) {
  const strip = document.getElementById('vsShowcaseStrip');
  if (!strip) return;
  if (!done.length) { strip.classList.add('d-none'); strip.innerHTML = ''; return; }
  strip.classList.remove('d-none');
  strip.innerHTML = `
    <div class="vs-showcase-head">
      <i class="bi bi-patch-check-fill"></i>
      <span>ผลงานที่แก้ไขสำเร็จ</span>
      <span class="vs-showcase-count">${done.length}</span>
    </div>
    <div class="vs-showcase-row">
      ${done.map((r) => {
        const id = escHtml(r.canonical_id);
        const affected = Number(r.affected) || 1;
        const note = r.public_note
          ? `<div class="vs-showcase-note">${escHtml(r.public_note)}</div>` : '';
        return `<div class="vs-showcase-card" role="button" tabindex="0"
            onclick="vsBoardOpen('${id}')"
            onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();vsBoardOpen('${id}');}">
            <div class="vs-showcase-badge"><i class="bi bi-check-circle-fill"></i> แก้ไขแล้ว</div>
            <div class="vs-showcase-title">${escHtml(r.public_title || '(ไม่มีหัวข้อ)')}</div>
            ${note}
            <div class="vs-showcase-foot"><i class="bi bi-people-fill me-1"></i>${affected} คนได้รับผล</div>
          </div>`;
      }).join('')}
    </div>`;
}

function cardHtml(r) {
  const phase = Number(r.phase) || 0;
  const badge = PHASE_BADGE[phase] || PHASE_BADGE[0];
  const phaseLabel = VS_PHASES[phase]?.label || '';
  const cat = r.cat_label
    ? `<span class="vs-cat-chip vs-cat-chip-sm"><i class="bi ${escHtml(r.cat_icon || 'bi-tag')} me-1"></i>${escHtml(r.cat_label)}</span>`
    : '';
  const affected = Number(r.affected) || 1;
  const comments = r.comment_count != null ? Number(r.comment_count) : null;
  // 0096 — staff progress notes marked สาธารณะ. A separate signal from the
  // comment count: comments are the crowd, updates are the team.
  const updates = Number(r.update_count) || 0;
  const following = r.following === true;
  const id = escHtml(r.canonical_id);
  return `<div class="col-12 col-md-6">
    <div class="vs-board-card" onclick="vsBoardOpen('${id}')">
      <div class="vs-board-card-top">
        ${cat}
        <span class="badge ${badge} rounded-pill vs-phase-pill">${escHtml(phaseLabel)}</span>
      </div>
      <div class="vs-board-title">${escHtml(r.public_title || '(ไม่มีหัวข้อ)')}</div>
      <div class="vs-board-card-foot">
        <button type="button" class="vs-metoo-btn${following ? ' is-on' : ''}"
          onclick="event.stopPropagation();vsBoardMeToo('${id}',this)">
          <i class="bi ${following ? 'bi-people-fill' : 'bi-people'}"></i>
          <span class="vs-metoo-count">${affected}</span> เจอเหมือนกัน
        </button>
        ${updates ? `<span class="vs-board-updates" title="ความคืบหน้าจากทีมงาน"><i class="bi bi-broadcast-pin me-1"></i>${updates}</span>` : ''}
        ${comments != null ? `<span class="vs-board-comments"><i class="bi bi-chat-dots me-1"></i>${comments}</span>` : ''}
      </div>
    </div>
  </div>`;
}

// --------------------------------------------------
// Controls (wired to window.* in main.js)
// --------------------------------------------------
export function vsBoardSetSort(sort) {
  currentSort = sort;
  currentQuery = ''; const s = document.getElementById('vsBoardSearch'); if (s) s.value = '';
  loadBoard();
}
export function vsBoardCat(id) {
  currentCategory = id;
  renderCategoryChips();
  if (currentQuery) runSearch(); else loadBoard();
}
export function vsBoardSearch(v) {
  currentQuery = (v || '').trim();
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { currentQuery ? runSearch() : loadBoard(); }, 260);
}

async function runSearch() {
  const list = document.getElementById('vsBoardList');
  if (!list) return;
  list.innerHTML = spinner();
  const { data, error } = await dbRest('/rpc/search_public_vs', {
    method: 'POST',
    body: { p_query: currentQuery, p_limit: 30 },
  });
  if (error) { list.innerHTML = errorNote('ค้นหาไม่สำเร็จ'); return; }
  let rows = Array.isArray(data) ? data : [];
  if (currentCategory) rows = rows.filter((r) => r.category === currentCategory);
  renderBoardList(rows);
}

// --------------------------------------------------
// Problem detail
// --------------------------------------------------
// Bumped on every open. The id alone cannot tell two loads of the SAME problem
// apart — re-opening after a comment re-fetches it — so a slow first response
// could paint the thread without the new comment over the fresh one.
let openSeq = 0;

export async function vsBoardOpen(id) {
  openProblemId = id;
  const seq = ++openSeq;
  // Put the open problem in the URL so a reload (the natural way to check for
  // progress) comes back to it instead of the board list — see vs-route.js.
  if (typeof window.vsSetRoute === 'function') window.vsSetRoute(`problem/${id}`);
  const listView = document.getElementById('vsBoardListView');
  const detail = document.getElementById('vsProblemDetail');
  const body = document.getElementById('vsProblemBody');
  listView.classList.add('d-none');
  detail.classList.remove('d-none');
  body.innerHTML = spinner();
  const { data, error } = await dbRest('/rpc/get_public_vs_problem', {
    method: 'POST', body: { p_id: id },
  });
  // Guard against a stale response: the user tapped another card (or went
  // back to the list) before this fetch resolved — openProblemId has moved
  // on, so this slow response must not paint over whatever is on screen now.
  // Same shape as enhanceBoardBanner's guard in vs-tracking.js.
  if (id !== openProblemId || seq !== openSeq) return;
  if (error || !data) { body.innerHTML = errorNote('ไม่พบเรื่องนี้ หรือถูกปิดการเปิดเผยแล้ว'); return; }
  renderProblemDetail(data);
}

/** Switch the VS tab into board mode and open a specific public problem.
 *  Used by the submitter tracking view (0075) when their duplicate links to a
 *  PUBLIC canonical — a safe deep-link (the canonical is world-public). */
export async function openBoardProblem(id) {
  const boardRadio = document.getElementById('vsModeBoard');
  if (boardRadio) boardRadio.checked = true;
  // Mirror toggleVitalSoundMode's section swap (avoid a cross-module import).
  document.getElementById('vsBoardSection')?.classList.remove('d-none');
  document.getElementById('vsReportSection')?.classList.add('d-none');
  document.getElementById('vsTrackSection')?.classList.add('d-none');
  window.dispatchEvent(new CustomEvent('vs-board-shown'));
  await vsBoardOpen(id);
  document.getElementById('vsBoardSection')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/** The problem the detail view is currently showing, or null. See
 *  currentTrackedTicketId() in vs-tracking.js for why vs-route needs this. */
export function currentBoardProblemId() {
  const el = document.getElementById('vsProblemDetail');
  if (!el || el.classList.contains('d-none')) return null;
  return openProblemId;
}

export function vsBoardBack() {
  openProblemId = null;
  if (typeof window.vsSetRoute === 'function') window.vsSetRoute('');
  document.getElementById('vsProblemDetail').classList.add('d-none');
  document.getElementById('vsBoardListView').classList.remove('d-none');
  // refresh counts that may have changed; keep the user's search context
  if (currentQuery) runSearch(); else loadBoard();
}

function renderProblemDetail(p) {
  const body = document.getElementById('vsProblemBody');
  const phase = Number(p.phase) || 0;
  const cat = categories.find((c) => c.id === p.category);
  const affected = Number(p.affected) || 1;
  const following = p.following === true;
  const signedIn = !!authGetUser();
  const comments = Array.isArray(p.comments) ? p.comments : [];
  const id = escHtml(p.canonical_id);

  const note = p.public_note
    ? `<div class="vs-problem-note"><i class="bi bi-megaphone-fill me-1"></i>${escHtml(p.public_note)}</div>` : '';

  // ONE composer (the me-too "note box" and the thread composer were the same
  // thing — merged). Prominent position right under the me-too button, like
  // the note box was. Includes the staff-only visibility option (0078).
  const composer = signedIn
    ? `<div class="vs-comment-composer vs-composer-box">
         <label class="small fw-bold mb-1" for="vsCommentInput">
           <i class="bi bi-chat-left-dots me-1"></i>ร่วมแสดงความคิดเห็น
           <span class="text-muted fw-normal">(ไม่แสดงชื่อจริง)</span>
         </label>
         <textarea id="vsCommentInput" class="form-control form-control-sm" rows="2" maxlength="2000"
           placeholder="เล่ารายละเอียดที่คุณเจอ หรือแสดงความคิดเห็น..."></textarea>
         <div class="d-flex flex-wrap align-items-center gap-2 mt-2">
           <button type="button" class="btn btn-submit btn-sm" onclick="vsPostComment('${id}')">
             <i class="bi bi-send me-1"></i>ส่งความคิดเห็น</button>
           <div class="form-check mb-0 ms-auto">
             <input class="form-check-input" type="checkbox" id="vsCommentStaffOnly">
             <label class="form-check-label small text-muted" for="vsCommentStaffOnly">
               <i class="bi bi-lock-fill"></i> ส่งถึงเจ้าหน้าที่เท่านั้น</label>
           </div>
         </div>
       </div>`
    : `<div class="vs-comment-signin alert alert-light border small mb-0">
         <i class="bi bi-lock me-1"></i>เข้าสู่ระบบด้วย KKU Mail เพื่อร่วมแสดงความคิดเห็น
         <button type="button" class="btn btn-outline-secondary btn-sm ms-2"
           data-bs-toggle="modal" data-bs-target="#signinModal">เข้าสู่ระบบ</button>
       </div>`;

  body.innerHTML = `
    <div class="vs-problem-head">
      ${cat ? `<span class="vs-cat-chip vs-cat-chip-sm"><i class="bi ${escHtml(cat.icon || 'bi-tag')} me-1"></i>${escHtml(cat.label)}</span>` : ''}
      <h4 class="vs-problem-title mt-2">${escHtml(p.public_title || '(ไม่มีหัวข้อ)')}</h4>
    </div>
    <div class="vs-stepper-wrap my-4">${renderVsStepperByPhase(phase)}</div>
    ${note}
    <div class="vs-problem-actions">
      <button type="button" class="vs-metoo-btn vs-metoo-btn-lg${following ? ' is-on' : ''}"
        onclick="vsBoardMeToo('${id}',this)">
        <i class="bi ${following ? 'bi-people-fill' : 'bi-people'}"></i>
        <span class="vs-metoo-count">${affected}</span> คนเจอปัญหานี้เหมือนกัน
      </button>
    </div>
    ${updatesHtml(p)}
    <div class="mt-3">${composer}</div>
    <hr class="my-4">
    <h6 class="fw-bold mb-3"><i class="bi bi-chat-dots me-2"></i>ความคิดเห็น
      <span class="text-muted fw-normal">(${comments.length})</span></h6>
    <div class="vs-comment-list mb-3">
      ${comments.length ? comments.map(commentHtml).join('') : '<p class="text-muted small">ยังไม่มีความคิดเห็น เป็นคนแรกที่ร่วมพูดคุย</p>'}
    </div>`;
}

/** ความคืบหน้าจากทีมงาน — the staff progress stream (0096), DELIBERATELY a
 *  separate block from the comment thread below it. Comments are the crowd
 *  talking; this is the team reporting what has actually been done, so it sits
 *  above the composer and reads as a log rather than a conversation.
 *
 *  Source: `updates` from get_public_vs_problem — the 'public'-rung remarks
 *  across the whole duplicate group. Only staff can produce them (a submitter
 *  write above 'ticket' is rejected by vs_tickets_self_update_guard), but the
 *  strings are still hand-typed staff input → escHtml everything. */
function updatesHtml(p) {
  const ups = Array.isArray(p.updates) ? p.updates : [];
  if (!ups.length) return '';
  return `<div class="vs-updates mt-4">
    <div class="vs-updates-head">
      <i class="bi bi-broadcast-pin"></i>
      <span>ความคืบหน้าจากทีมงาน</span>
      <span class="vs-updates-count">${ups.length}</span>
    </div>
    <ol class="vs-updates-list">
      ${ups.map((u) => `<li class="vs-update">
        <div class="vs-update-meta">
          <span class="vs-update-by"><i class="bi bi-patch-check-fill me-1"></i>${escHtml(u.by || 'ทีมงาน')}</span>
          ${u.time ? `<span class="vs-update-time">${escHtml(u.time)}</span>` : ''}
        </div>
        <div class="vs-update-body">${escHtml(u.text || '')}</div>
      </li>`).join('')}
    </ol>
  </div>`;
}

function commentHtml(c) {
  const staff = c.is_staff === true;
  const alias = staff
    ? `<span class="vs-comment-alias is-staff"><i class="bi bi-patch-check-fill me-1"></i>${escHtml(c.alias || 'เจ้าหน้าที่')}</span>`
    : `<span class="vs-comment-alias">${escHtml(c.alias || 'นศ.')}</span>`;
  // Staff-only comments (0078) — the server only sends these to staff or the
  // author; the badge tells them why others can't see it.
  const privBadge = c.staff_only === true
    ? '<span class="vs-comment-priv"><i class="bi bi-lock-fill me-1"></i>เฉพาะเจ้าหน้าที่</span>' : '';
  return `<div class="vs-comment${staff ? ' is-staff' : ''}${c.staff_only ? ' is-private' : ''}">
    <div class="vs-comment-meta">${alias} ${privBadge}</div>
    <div class="vs-comment-body">${escHtml(c.body || '')}</div>
  </div>`;
}

// --------------------------------------------------
// Actions — me-too + comment (require sign-in; RPCs fail closed)
// --------------------------------------------------
export async function vsBoardMeToo(id, btn) {
  if (!authGetUser()) { promptSignin(); return; }
  const on = btn.classList.contains('is-on');
  btn.disabled = true;
  const { data, error } = await dbRest(`/rpc/${on ? 'vs_remove_me_too' : 'vs_add_me_too'}`, {
    method: 'POST', body: { p_canonical: id },
  });
  btn.disabled = false;
  if (error) { return; }
  const count = Array.isArray(data) ? data[0] : data; // scalar RPC → number
  btn.classList.toggle('is-on', !on);
  const icon = btn.querySelector('i');
  if (icon) icon.className = `bi ${!on ? 'bi-people-fill' : 'bi-people'}`;
  const c = btn.querySelector('.vs-metoo-count');
  if (c && count != null) c.textContent = Number(count);
  // Detail view: after turning me-too ON, guide into the ONE composer —
  // focus it with a contextual placeholder ("เล่ารายละเอียดเสริม"). No
  // separate note box; the composer IS the note mechanism.
  if (btn.classList.contains('vs-metoo-btn-lg') && !on) {
    const input = document.getElementById('vsCommentInput');
    if (input) {
      input.placeholder = 'มีรายละเอียดเสริมมั้ย? เช่น จุดที่พบ ช่วงเวลา หรืออาการที่เจอ… (ไม่บังคับ)';
      input.focus({ preventScroll: false });
      input.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }
}

export async function vsPostComment(id) {
  if (!authGetUser()) { promptSignin(); return; }
  const input = document.getElementById('vsCommentInput');
  const body = (input?.value || '').trim();
  if (!body) return;
  const btn = document.querySelector('.vs-comment-composer .btn-submit');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span>'; }
  const staffOnly = document.getElementById('vsCommentStaffOnly')?.checked === true;
  const { error } = await dbRest('/rpc/vs_post_public_comment', {
    method: 'POST', body: { p_canonical: id, p_body: body, p_staff_only: staffOnly },
  });
  if (error) {
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="bi bi-send me-1"></i>ส่งความคิดเห็น'; }
    const m = pgMsg(error);
    alert(/บ่อยเกินไป|ความยาว/.test(m) ? m : 'ส่งความคิดเห็นไม่สำเร็จ');
    return;
  }
  vsBoardOpen(id); // reload the thread
}

// dbRest sets error.message to the raw PostgREST body (often a JSON string);
// pull the human `message` field out for user-facing alerts (see mistakes.md).
function pgMsg(error) {
  const raw = error?.message || '';
  try { return JSON.parse(raw)?.message || raw; } catch { return raw; }
}

function promptSignin() {
  const el = document.getElementById('signinModal');
  if (el && window.bootstrap?.Modal) window.bootstrap.Modal.getOrCreateInstance(el).show();
}

// ---- tiny view helpers ----
function spinner() {
  return '<div class="col-12 text-center text-muted py-5"><span class="spinner-border spinner-border-sm me-2"></span>กำลังโหลด...</div>';
}
function errorNote(msg) {
  return `<div class="col-12 text-center text-danger py-4"><i class="bi bi-exclamation-triangle me-1"></i>${escHtml(msg)}</div>`;
}
