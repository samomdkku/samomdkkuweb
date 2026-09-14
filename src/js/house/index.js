// ==============================================
// ระบบบ้าน (House) — admin workspace.
//
// Six panes behind one lazy load: ภาพรวม · นักศึกษา · สายรหัส · อาจารย์ ·
// คำขอแก้ไข · นำเข้าข้อมูล. Schema + rationale: migrations 0116–0118 and
// docs/HOUSE-SYSTEM.md.
//
// TWO THINGS THIS MODULE NEVER DOES
//   1. It never computes a house. `sais.house_id` is a GENERATED column and the
//      house rule lives in SQL; the import preview borrows houseOf() from
//      ./fields.js purely to show a number before anything is written.
//   2. It never writes a student-owned column through the import path. The
//      allow-list is IMPORT_OWNED_COLUMNS in ./io.js and a test pins it.
//
// IT ALSO HAS TO WORK WITH NO DATA AT ALL. The data from the Data Analytics
// dept may arrive weeks after this ships, so every pane renders an honest empty
// state rather than a spinner or a broken table.
// ==============================================
import { escHtml } from '../utils.js';
import { getUser } from '../auth.js';
// An app-owned confirm. `window.confirm` cannot be trusted here: once Chrome's
// "Prevent this page from creating additional dialogs" is ticked it returns
// false forever with no UI, which is how ทีม SAMO's delete button and this
// pane's ปฏิเสธ both came to "do nothing at all".
import { askDelete, askConfirm } from '../confirm-modal.js';
import { uploadTeamPhoto, convertDriveUrl } from '../uploads.js';
// The same server-side reference count the ทีม SAMO editor uses. A crest is a
// Drive file like any other: replacing one must not leave the old one shared
// "anyone with the link" forever.
import { deleteTeamPhotoIfUnused, photoToRetire } from '../team/api.js';
import {
  fetchHouses, updateHouse, fetchSais,
  fetchAdvisors, createAdvisor, updateAdvisor, deleteAdvisor, setAdvisorSais,
  addSaiAdvisor, removeSaiAdvisor,
  fetchStudents, createStudent, updateStudent, deleteStudent, upsertStudents,
  createImportBatch, finishImportBatch, fetchRequests, decideRequest,
  markMissing, ensureSais, fetchMajors, recordUnresolved,
  fetchUnresolved, promoteUnresolved, dismissUnresolved,
  fetchHelpRequests, resolveHelpRequest,
  fetchAcademicYearStatus, saveAcademicYear, primeAcademicYear, fetchDeleteImpact,
  fetchIdentityCheckSummary, fetchIdentityCheckList, searchPeople,
} from './api.js';
import {
  parseStudentsCsv, diffAgainstExisting, toUpsertRow, toUnresolvedRow, saiCodesToSeed,
  buildStudentsCsv,
  buildPreviewRows, PREVIEW_COLUMNS, PREVIEW_COLUMN_LABEL,
  CSV_COLUMN_LABEL,
} from './io.js';
import {
  normalizeSai, houseOf, houseLabel, normalizeStudentId, HOUSE_COUNT,
  cohortLabel, saiProblem, safeColor,
  studyYear, studyYearLabel, offsetForPickedYear,
} from './fields.js';

const $ = (id) => document.getElementById(id);
const modalInstance = (id) => {
  const el = $(id);
  return el && window.bootstrap ? window.bootstrap.Modal.getOrCreateInstance(el) : null;
};

// ---- module state ----
let initialized = false;
let loading = null;
let mode = 'overview';
// No `settings` state any more: ระบบบ้าน has no switches left. The two it had
// (ปีการศึกษา, สายรหัสแก้เองได้, เห็นรายชื่อเพื่อนร่วมบ้าน) each belonged to a
// feature that was removed outright in 0123–0125, and a stored setting nothing
// reads is a control that lies.
let houses = [];
let sais = [];
let students = [];
let advisors = [];
let requests = [];
let majors = [];            // team_majors — the ONE สาขา vocabulary
// Rows the newest import NAMED and could not address (0188). Loaded with
// everything else so the sub-nav badge is right on first paint — a count that
// appears only after someone opens the pane is a count nobody sees.
let held = [];
let heldQuery = '';
let heldShowDone = false;
// The other direction: people with no seat. Loaded beside `held` because the
// admin's job is matching the two, and a count that only appears once somebody
// opens the pane is a count nobody sees.
let helpReqs = [];
let pendingImport = null;   // parsed + diffed, awaiting confirmation

function setStatus(msg, isError = false) {
  const el = $('houseStatus');
  if (!el) return;
  el.textContent = msg || '';
  el.classList.toggle('text-danger', !!isError);
  el.classList.toggle('text-muted', !isError);
}

const saiHouse = (code) => {
  const row = sais.find((s) => s.code === code);
  // Prefer the DB's generated column; fall back to the local rule only when the
  // สาย is not in the seeded list (which should not happen, but a null here
  // would render "undefined" on a card).
  return row ? row.house_id : houseOf(code);
};

const houseById = (id) => houses.find((h) => h.id === id) || null;
const houseName = (id) => houseLabel(id, houseById(id)?.name);

// ============================================================
// LOAD
// ============================================================
export function enterHouseWorkspace() {
  if (!initialized) {
    initialized = true;
    wire();
  }
  if (!loading) reload();
}

async function reload() {
  setStatus('กำลังโหลด…');
  loading = (async () => {
    try {
      [houses, sais, students, advisors, requests, majors, held] = await Promise.all([
        fetchHouses(), fetchSais(),
        fetchStudents(), fetchAdvisors(), fetchRequests(), fetchMajors(),
        fetchUnresolved(true),
      ]);
      helpReqs = await fetchHelpRequests(true);
      setStatus('');
      render();
    } catch (e) {
      setStatus(e?.message || 'โหลดข้อมูลไม่สำเร็จ', true);
    } finally {
      loading = null;
    }
  })();
  return loading;
}

// ============================================================
// RENDER
// ============================================================
function render() {
  document.querySelectorAll('[data-house-mode]').forEach((b) => {
    b.classList.toggle('active', b.dataset.houseMode === mode);
  });
  document.querySelectorAll('[data-house-pane]').forEach((p) => {
    p.classList.toggle('d-none', p.dataset.housePane !== mode);
  });

  const openReqs = requests.filter((r) => r.status === 'pending').length;
  const badge = $('houseReqBadge');
  if (badge) {
    badge.textContent = String(openReqs);
    badge.classList.toggle('d-none', openReqs === 0);
  }

  const openHeld = held.filter((h) => !h.resolved_at).length;
  const heldBadge = $('houseHeldBadge');
  if (heldBadge) {
    heldBadge.textContent = String(openHeld);
    heldBadge.classList.toggle('d-none', openHeld === 0);
  }
  // A SEPARATE badge, not added into the one above. A held row is waiting on
  // ฝ่ายข้อมูล; a help request is a real person who tried and is stuck, and
  // folding 3 of those into "168" is how the 3 never get looked at.
  const openHelp = helpReqs.filter((h) => !h.resolved_at).length;
  const helpBadge = $('houseHelpBadge');
  if (helpBadge) {
    helpBadge.textContent = String(openHelp);
    helpBadge.classList.toggle('d-none', openHelp === 0);
  }

  if (mode === 'overview') renderOverview();
  else if (mode === 'students') renderStudents();
  else if (mode === 'sais') renderSais();
  else if (mode === 'advisors') renderAdvisors();
  else if (mode === 'requests') renderRequests();
  else if (mode === 'held') { renderHeld(); renderHelp(); }
}

// ---------- คนที่ยืนยันตัวตนไม่ผ่าน ----------
//
// Each row already carries its own candidates, computed server-side by
// `list_house_help_requests` — the held rows that agree with the person on
// EITHER their รหัส or their ชื่อ. A row agreeing on both would have been
// claimed, so every candidate shown is a near miss, which is exactly the shape
// of a typo in the handover file. Making an admin find that by eye across 165
// rows would be a worklist in name only.
function renderHelp() {
  const tbody = $('houseHelpRows');
  if (!tbody) return;
  const rows = helpReqs.filter((h) => heldShowDone || !h.resolved_at);

  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="text-muted small py-3">'
      + 'ยังไม่มีใครยืนยันตัวตนไม่ผ่าน</td></tr>';
  } else {
    tbody.innerHTML = rows.map((h) => {
      const done = !!h.resolved_at;
      const typed = h.kind === 'not_me'
        ? `<span class="text-danger">บอกว่าการ์ดนี้ไม่ใช่ของเขา</span>${
          h.showing ? `<br /><span class="small text-muted">การ์ดแสดง: ${
            escHtml(h.showing.name || '')} ${escHtml(h.showing.student_id || '')}</span>` : ''}${
          h.note ? `<br /><span class="small">“${escHtml(h.note)}”</span>` : ''}`
        : `${escHtml(h.typed_first_name || '')} · ${escHtml(h.typed_student_id || '')}${
          h.attempts > 1 ? ` <span class="text-muted small">(ลอง ${h.attempts} ครั้ง)</span>` : ''}`;
      const cands = (h.candidates || []).length
        ? h.candidates.map((c) => `<div class="small">${escHtml(c.name || '')}
            · ${escHtml(c.student_id || '—')} · สาย ${escHtml(c.sai || '—')}
            <span class="text-muted">(${escHtml(c.matched)})</span></div>`).join('')
        : '<span class="text-muted small">ไม่มีใครใกล้เคียงในรายการค้าง</span>';
      return `<tr data-help-id="${escHtml(h.id)}"${done ? ' class="table-light text-muted"' : ''}>
        <td class="small">${escHtml(h.kkumail)}</td>
        <td class="small">${typed}</td>
        <td>${cands}</td>
        <td class="small">${done ? 'จัดการแล้ว' : `${h.waiting_days} วัน`}</td>
        <td class="text-end">${done ? '' : `
          <div class="input-group input-group-sm held-actions">
            <input type="text" class="form-control" data-help-note
                   placeholder="บันทึกว่าทำอะไรไป" autocomplete="off" />
            <button type="button" class="btn btn-outline-secondary" data-help-act="resolve">ปิด</button>
          </div>`}</td>
      </tr>`;
    }).join('');
  }

  const open = helpReqs.filter((h) => !h.resolved_at);
  $('houseHelpCount').textContent = open.length
    ? `มี ${open.length} คนที่ติดอยู่ — ถ้าเจอว่าเป็นใครในรายการค้างข้างบน `
      + 'ให้กรอกอีเมลของเขาในแถวนั้น แล้วรายการนี้จะปิดเอง'
    : 'ไม่มีใครติดอยู่';
}

// ---------- ยังนำเข้าไม่ได้ ----------
//
// SORTED SO THE ADMIN'S OWN WORK IS AT THE TOP, which is what `claimable` is
// for. A row WITH a รหัสนักศึกษา can be closed by the student it names, from the
// home page, without anyone here doing anything — so it is not a task. A row
// without one can be closed by nobody but an admin, and there is no queue it
// will ever drain into. Ordering by that difference is the difference between a
// list of 165 and a worklist of 13.
// BOTH ACTIONS COLLECT THEIR TEXT IN AN ORDINARY INPUT, never `prompt()`.
// Chrome's "Prevent this page from creating additional dialogs" makes every
// later prompt() return null instantly with no UI, for the life of the page —
// which is what made the ปฏิเสธ button on คำขอแก้ไข look dead, and the handler
// there read that null as "cancelled" and returned silently. See onDecide's
// header. A dismissal also REQUIRES its reason (the RPC raises without one), and
// a mandatory value collected through a dialog the browser may refuse to show is
// a dead end with no message.
function renderHeld() {
  const tbody = $('houseHeldRows');
  if (!tbody) return;
  const q = heldQuery.trim().toLowerCase();
  const rows = held
    .filter((h) => heldShowDone || !h.resolved_at)
    .filter((h) => !q || [h.first_name_th, h.last_name_th, h.nickname, h.student_id, h.sai]
      .some((v) => String(v || '').toLowerCase().includes(q)));

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-muted small py-3">${
      held.length ? 'ไม่พบรายการที่ตรงกับที่ค้นหา' : 'ไม่มีรายการค้าง — ไฟล์ล่าสุดมี kkumail ครบทุกคน'}</td></tr>`;
  } else {
    tbody.innerHTML = rows.map((h) => {
      const name = [h.first_name_th, h.last_name_th].filter(Boolean).join(' ')
        || '<span class="text-muted">(ไม่มีชื่อในไฟล์)</span>';
      const done = !!h.resolved_at;
      return `<tr data-held-id="${escHtml(h.id)}"${done ? ' class="table-light text-muted"' : ''}>
        <td>${name}${h.nickname ? ` <span class="text-muted small">(${escHtml(h.nickname)})</span>` : ''}</td>
        <td>${h.student_id ? escHtml(h.student_id) : '<span class="text-danger small">ไม่มี</span>'}</td>
        <td>${h.sai ? `${escHtml(h.sai)} · บ้าน ${h.house ?? '—'}` : '—'}</td>
        <td>${h.cohort_year ? escHtml(cohortLabel({ cohort_year: h.cohort_year })) : '—'}</td>
        <td class="small">${escHtml(HELD_REASON[h.reason] || h.reason)}</td>
        <td class="small">${done ? escHtml(HELD_DONE[h.resolved_how] || 'จัดการแล้ว') : `${h.held_days} วัน`}</td>
        <td class="text-end">${done ? '' : `
          <div class="held-actions">
            <div class="input-group input-group-sm">
              <input type="email" class="form-control" data-held-mail
                     placeholder="kkumail ของคนนี้" autocomplete="off" />
              <button type="button" class="btn btn-outline-primary" data-held-act="promote">เพิ่ม</button>
            </div>
            <div class="input-group input-group-sm">
              <input type="text" class="form-control" data-held-note
                     placeholder="เหตุผลที่ปิด เช่น ลาออก" autocomplete="off" />
              <button type="button" class="btn btn-outline-secondary" data-held-act="dismiss">ปิด</button>
            </div>
          </div>`}</td>
      </tr>`;
    }).join('');
  }

  const open = held.filter((h) => !h.resolved_at);
  const adminOnly = open.filter((h) => !h.claimable).length;
  $('houseHeldCount').textContent = open.length
    ? `ค้างอยู่ ${open.length} คน — ${adminOnly} คนไม่มีรหัสนักศึกษา จึงยืนยันตัวตนเองไม่ได้ `
      + `อีก ${open.length - adminOnly} คนยืนยันเองได้เมื่อเข้าสู่ระบบด้วย kkumail`
    : 'ไม่มีรายการค้าง';
}

/** The stored `reason` values, said in the words an admin would use. Kept
 *  beside the renderer rather than in the database, because the enum is the
 *  FACT and this is a label — and a label that lived in a check constraint
 *  could not be reworded without a migration. */
const HELD_REASON = {
  no_kkumail: 'ไฟล์ไม่มี kkumail',
  no_kkumail_no_student_id: 'ไม่มีทั้ง kkumail และรหัสนักศึกษา',
  duplicate_kkumail: 'kkumail ซ้ำกับคนอื่นในไฟล์',
  empty_row: 'แถวว่าง — มีแต่สายรหัส',
};
const HELD_DONE = {
  self_claim: 'เจ้าตัวยืนยันเอง',
  admin: 'แอดมินกรอกอีเมลให้',
  import: 'ไฟล์รอบถัดไปมีชื่อแล้ว',
  dismissed: 'ปิดรายการ',
};

// ---------- ภาพรวม ----------
function renderOverview() {
  $('houseEmptyNote')?.classList.toggle('d-none', students.length > 0);

  const withSai = students.filter((s) => s.sai_code).length;
  const noSai = students.length - withSai;
  const stats = [
    ['นักศึกษาทั้งหมด', students.length, 'bi-people'],
    ['มีสายรหัสแล้ว', withSai, 'bi-signpost-split'],
    ['ยังไม่มีสายรหัส', noSai, noSai ? 'bi-exclamation-triangle text-warning' : 'bi-check2'],
    ['อาจารย์ที่ปรึกษา', advisors.length, 'bi-person-badge'],
  ];
  const wrap = $('houseStats');
  if (wrap) {
    wrap.innerHTML = stats.map(([label, value, icon]) => `
      <div class="col-6 col-md">
        <div class="card h-100"><div class="card-body py-2 px-3">
          <div class="small text-muted"><i class="bi ${icon}"></i> ${escHtml(label)}</div>
          <div class="fs-4 fw-semibold">${value.toLocaleString('th-TH')}</div>
        </div></div>
      </div>`).join('');
  }

  renderCheckStatus();

  const counts = new Map();
  for (const s of students) {
    const h = saiHouse(s.sai_code);
    if (h === null || h === undefined) continue;
    counts.set(h, (counts.get(h) || 0) + 1);
  }

  const cards = $('houseCards');
  if (!cards) return;
  cards.innerHTML = houses.map((h) => {
    const named = !!String(h.name || '').trim();
    const icon = h.icon_url
      ? `<img src="${escHtml(convertDriveUrl(h.icon_url, 200))}" alt=""
             style="width:48px;height:48px;object-fit:cover;border-radius:12px" />`
      : `<div class="d-flex align-items-center justify-content-center fw-bold"
              style="width:48px;height:48px;border-radius:12px;background:${safeColor(h.color, '#e9ecef')};color:#fff">
           ${h.id}
         </div>`;
    return `
      <div class="col-6 col-md-4 col-lg-3">
        <div class="card h-100 house-card" role="button" data-house-edit="${h.id}">
          <div class="card-body d-flex gap-2 align-items-center">
            ${icon}
            <div class="flex-grow-1 min-w-0">
              <div class="fw-semibold text-truncate">${escHtml(houseLabel(h.id, h.name))}</div>
              <div class="small text-muted">${(counts.get(h.id) || 0).toLocaleString('th-TH')} คน</div>
              ${named ? '' : '<div class="small text-warning">ยังไม่ตั้งชื่อ</div>'}
            </div>
            <i class="bi bi-pencil text-muted"></i>
          </div>
        </div>
      </div>`;
  }).join('');
}

// ---------- นักศึกษา ----------
// รุ่น (MD50), never ชั้นปี. The rule lives in ./fields.js and takes no clock —
// see cohortLabel() there for why ชั้นปี was dropped from ระบบบ้าน entirely.
const cohortOf = (s) => cohortLabel(s);

/**
 * The five filters, and why สายรหัส is one of them.
 *
 * REPORTED: "when type number สาย it also shows the รหัสนักศึกษา that has that
 * number". One free-text box searched every column at once, so `17` matched
 * สาย 017 and รหัสนักศึกษา 6530701712 and any kkumail containing 17 — a number
 * means a different thing in each column, and a single box cannot know which
 * one you meant. So the columns where a number is a WHOLE identity get their
 * own box, and the free-text box no longer looks at สายรหัส at all.
 *
 * The three combobox filters match as a SUBSTRING, not an exact value: they are
 * `<input list>` rather than `<select>` because there are ~300 สาย and รุ่น has
 * no upper bound, and a typed prefix is the only reason to type at all — "MD5"
 * has to mean MD50–MD59 or the box is just a select with extra steps.
 */
function readFilters() {
  return {
    q: ($('houseSearch')?.value || '').trim().toLowerCase(),
    house: $('houseFilterHouse')?.value || '',
    cohort: ($('houseFilterYear')?.value || '').trim().toLowerCase(),
    major: ($('houseFilterMajor')?.value || '').trim().toLowerCase(),
    sai: ($('houseFilterSai')?.value || '').trim(),
  };
}

const anyFilterSet = (f) => !!(f.q || f.house !== '' || f.cohort || f.major || f.sai);

function filteredStudents() {
  const f = readFilters();
  return students.filter((s) => {
    if (f.house !== '' && String(saiHouse(s.sai_code)) !== f.house) return false;
    if (f.cohort && !String(cohortOf(s) || '').toLowerCase().includes(f.cohort)) return false;
    if (f.major && !String(s.major || '').toLowerCase().includes(f.major)) return false;
    // Digits only, so a stray space or a pasted "สาย 017" still lands.
    if (f.sai) {
      const want = f.sai.replace(/\D/g, '');
      if (want && !String(s.sai_code || '').includes(want)) return false;
    }
    if (!f.q) return true;
    // NOTE: sai_code is deliberately absent — it has its own box above.
    return [s.full_name, s.nickname, s.student_id, s.kkumail]
      .some((v) => String(v || '').toLowerCase().includes(f.q));
  });
}

/** Repaint a บ้าน `<select>`, preserving the current choice. Rebuilt on every
 *  render rather than filled once: the ten ids are fixed by the rule but their
 *  names are editable, and a chooser that caches a name is showing the answer to
 *  a question somebody has since changed. */
function fillHouseSelect(el, allLabel) {
  if (!el) return;
  const keep = el.value;
  const html = `<option value="">${escHtml(allLabel)}</option>`
    + Array.from({ length: HOUSE_COUNT },
      (_, i) => `<option value="${i}">${escHtml(houseName(i))}</option>`).join('');
  if (el.innerHTML !== html) {
    el.innerHTML = html;
    el.value = keep;
  }
}

/** Fill a `<datalist>` from the values actually present. Rewritten on every
 *  render rather than filled once: a new สาย or a new รุ่น arrives with an
 *  import, and a list built on first paint would never mention it. */
function fillDatalist(id, values) {
  const el = $(id);
  if (!el) return;
  const html = values.map((v) => `<option value="${escHtml(v)}"></option>`).join('');
  if (el.innerHTML !== html) el.innerHTML = html;
}

function renderStudents() {
  // บ้าน stays a `<select>`: exactly ten, fixed by the rule, and every one of
  // them is worth showing at once. REBUILT each render, not filled once — the
  // ten ids are fixed but their NAMES are not, so a house renamed in ภาพรวม
  // left this list showing "บ้าน 3" until a full page reload.
  fillHouseSelect($('houseFilterHouse'), 'ทุกบ้าน');
  fillDatalist('houseYearList',
    [...new Set(students.map(cohortOf).filter(Boolean))].sort().reverse());
  fillDatalist('houseMajorList',
    [...new Set(students.map((s) => s.major).filter(Boolean))].sort());
  fillDatalist('houseSaiList', sais.map((s) => s.code));

  const rows = filteredStudents();
  $('houseClearFilters')?.classList.toggle('d-none', !anyFilterSet(readFilters()));
  const body = $('houseStudentRows');
  if (body) {
    body.innerHTML = rows.length ? rows.slice(0, 500).map((s) => {
      const h = saiHouse(s.sai_code);
      return `
        <tr data-student="${escHtml(s.id)}" role="button">
          <td>${s.full_name ? escHtml(s.full_name)
    : '<span class="text-muted fst-italic">ยังไม่มีชื่อ</span>'}</td>
          <td>${escHtml(s.nickname || '')}</td>
          <td class="text-nowrap">${escHtml(s.student_id || '')}</td>
          <td class="small">${escHtml(s.kkumail || '')}</td>
          <td>${escHtml(s.major || '')}</td>
          <td>${escHtml(cohortOf(s) || '—')}</td>
          <td>${escHtml(studyYearLabel(s) || '—')}${
  s.year_offset ? ' <i class="bi bi-pencil-fill text-muted small"' 
    + ' title="ปรับชั้นปีไว้เอง (ลาพัก/เรียนซ้ำ)"></i>' : ''}</td>
          <td>${escHtml(s.sai_code || '—')}</td>
          <td>${h === null || h === undefined ? '—' : escHtml(houseName(h))}</td>
          <td class="text-end"><i class="bi bi-pencil text-muted"></i></td>
        </tr>`;
    }).join('') : `
      <tr><td colspan="9" class="text-center text-muted py-4">
        ${students.length ? 'ไม่พบนักศึกษาที่ตรงกับตัวกรอง'
    : 'ยังไม่มีข้อมูลนักศึกษา — นำเข้าไฟล์จากแท็บ “นำเข้าข้อมูล”'}
      </td></tr>`;
  }
  const count = $('houseStudentCount');
  if (count) {
    count.textContent = rows.length
      ? `แสดง ${Math.min(rows.length, 500).toLocaleString('th-TH')} จาก ${rows.length.toLocaleString('th-TH')} คน`
      : '';
  }
}

// ---------- สายรหัส ----------
/** อาจารย์ per สาย, built once per render from the advisor rows we already have.
 *  The link table is loaded nested under `advisors`, so this is the ONE place
 *  that inverts it — every สาย-side reader uses this map rather than re-walking
 *  `sai_advisors` and drifting from it. */
function advisorsBySai() {
  const m = new Map();
  for (const a of advisors) {
    for (const link of a.sai_advisors || []) {
      if (!m.has(link.sai_code)) m.set(link.sai_code, []);
      m.get(link.sai_code).push(a);
    }
  }
  for (const list of m.values()) {
    list.sort((x, y) => String(x.full_name || '').localeCompare(String(y.full_name || ''), 'th'));
  }
  return m;
}

function renderSais() {
  const wrap = $('houseSaiGroups');
  if (!wrap) return;

  fillHouseSelect($('houseSaiFilterHouse'), 'ทุกบ้าน');

  const advBySai = advisorsBySai();
  const memberCount = new Map();
  for (const s of students) {
    if (!s.sai_code) continue;
    memberCount.set(s.sai_code, (memberCount.get(s.sai_code) || 0) + 1);
  }

  if (!sais.length) {
    wrap.innerHTML = '<div class="text-muted text-center py-4">'
      + 'ยังไม่มีสายรหัสในระบบ — สายรหัสจะถูกสร้างอัตโนมัติเมื่อนำเข้าข้อมูลนักศึกษา'
      + '</div>';
    return;
  }

  // Search matches the สาย code OR an อาจารย์ name, because "which สาย does
  // อ.สมชาย have" is the same question asked from the other end.
  const q = ($('houseSaiSearch')?.value || '').trim().toLowerCase();
  const fh = $('houseSaiFilterHouse')?.value || '';
  const onlyEmpty = !!$('houseSaiOnlyEmpty')?.checked;
  const visible = sais.filter((s) => {
    const adv = advBySai.get(s.code) || [];
    if (fh !== '' && String(s.house_id) !== fh) return false;
    if (onlyEmpty && adv.length) return false;
    if (!q) return true;
    return s.code.includes(q)
      || adv.some((a) => String(a.full_name || '').toLowerCase().includes(q));
  });

  if (!visible.length) {
    wrap.innerHTML = '<div class="text-muted text-center py-4">ไม่พบสายที่ตรงกับตัวกรอง</div>';
    return;
  }

  const byHouse = new Map();
  for (const s of visible) {
    if (!byHouse.has(s.house_id)) byHouse.set(s.house_id, []);
    byHouse.get(s.house_id).push(s);
  }

  wrap.innerHTML = [...byHouse.entries()].sort((a, b) => a[0] - b[0]).map(([hid, list]) => `
    <div class="mb-3">
      <h6 class="small text-uppercase text-muted">${escHtml(houseName(hid))} · ${list.length} สาย</h6>
      <div class="row g-2">
        ${list.map((s) => {
    const adv = advBySai.get(s.code) || [];
    return `
          <div class="col-6 col-md-3 col-lg-2">
            <div class="border rounded p-2 h-100 house-sai-card" data-sai="${escHtml(s.code)}" role="button"
                 title="กดเพื่อจัดการอาจารย์ของสาย ${escHtml(s.code)}">
              <div class="fw-semibold">สาย ${escHtml(s.code)}</div>
              <div class="small text-muted">${(memberCount.get(s.code) || 0)} คน</div>
              <div class="small ${adv.length ? '' : 'text-warning'}">
                ${adv.length ? escHtml(adv.map((a) => a.full_name).join(', ')) : 'ยังไม่มีอาจารย์'}
              </div>
            </div>
          </div>`;
  }).join('')}
      </div>
    </div>`).join('');
}

// ---------- สาย modal: อาจารย์ of ONE สาย ----------
/**
 * Repaint the modal body from module state.
 *
 * Called on open and after every add/remove — the modal does NOT close on save,
 * because assigning three อาจารย์ to a สาย would otherwise be three round trips
 * through a card grid (the "modal that closes on save" entry in mistakes.md).
 */
function paintSaiModal(code) {
  const sai = sais.find((s) => s.code === code);
  // The modal markup lives in tab-house.html; bail rather than throw if either
  // it or the สาย has gone (a reload can drop a สาย whose last student moved).
  if (!sai || !$('hxTitle') || !$('hxAdvisors') || !$('hxPick')) return;
  const assigned = advisorsBySai().get(code) || [];
  const members = students.filter((s) => s.sai_code === code).length;

  $('hxTitle').textContent = `สายรหัส ${code}`;
  $('hxMeta').innerHTML = `${escHtml(houseName(sai.house_id))} · ${members} คน`
    + ' · <span class="text-muted">บ้านคำนวณจากเลขหลักสุดท้าย แก้ด้วยมือไม่ได้</span>';

  $('hxAdvisors').innerHTML = assigned.length ? assigned.map((a) => `
    <div class="d-flex align-items-center gap-2 border rounded px-2 py-1 mb-1">
      <div class="flex-grow-1 small min-w-0">
        <span class="fw-semibold">${escHtml(a.full_name)}</span>
        ${a.dept ? `<span class="text-muted"> · ${escHtml(a.dept)}</span>` : ''}
        ${a.email ? `<div class="text-muted text-truncate">${escHtml(a.email)}</div>` : ''}
      </div>
      <button type="button" class="btn btn-sm btn-outline-danger py-0 px-2"
              data-sai-remove="${escHtml(a.id)}" title="นำออกจากสายนี้">
        <i class="bi bi-x-lg"></i>
      </button>
    </div>`).join('')
    : '<div class="small text-warning">ยังไม่มีอาจารย์ที่ปรึกษาของสายนี้</div>';

  paintSaiPickList(code);
  // The ภาควิชา already in use, so the new-advisor form can offer them rather
  // than collecting a fourth spelling of "ภาควิชาอายุรศาสตร์".
  fillDatalist('houseDeptList',
    [...new Set(advisors.map((a) => a.dept).filter(Boolean))].sort());
}

/**
 * The searchable "add an อาจารย์ who already exists" list.
 *
 * REPORTED: "เพิ่มอาจารย์ที่มีอยู่แล้ว should can type to search". It was a
 * `<select>` of every อาจารย์ — fine at two, a scroll at three hundred, which is
 * the size this list is heading for once the faculty's real advisor roster
 * lands.
 *
 * A search box over a result list rather than an `<input list>` datalist,
 * because a datalist's value is its LABEL and the thing we need is an id: two
 * อาจารย์ with the same name would silently resolve to whichever matched first.
 * Here each row carries its own id and adds on click, which also removes the
 * separate confirm button — picking and confirming were two actions for one
 * intention.
 *
 * Already-assigned อาจารย์ are excluded, so the list only ever offers something
 * that would actually change.
 */
function paintSaiPickList(code) {
  const box = $('hxPickList');
  if (!box) return;
  const assigned = advisorsBySai().get(code) || [];
  const taken = new Set(assigned.map((a) => a.id));
  const q = ($('hxPick')?.value || '').trim().toLowerCase();
  const pool = advisors.filter((a) => !taken.has(a.id));
  const hits = pool.filter((a) => !q
    || [a.full_name, a.email, a.dept].some((v) => String(v || '').toLowerCase().includes(q)));

  if (!pool.length) {
    box.innerHTML = '<div class="house-picklist-empty">'
      + (advisors.length ? 'อาจารย์ทุกท่านอยู่ในสายนี้แล้ว' : 'ยังไม่มีรายชื่ออาจารย์ในระบบ')
      + ' — เพิ่มอาจารย์ใหม่ได้ด้านล่าง</div>';
    return;
  }
  if (!hits.length) {
    box.innerHTML = `<div class="house-picklist-empty">ไม่พบอาจารย์ที่ตรงกับ “${escHtml(q)}”`
      + ' — เพิ่มอาจารย์ใหม่ได้ด้านล่าง</div>';
    return;
  }
  // Capped at 8. The box scrolls, but a search that returns everything is a
  // search that has not narrowed anything — the count says to keep typing.
  box.innerHTML = hits.slice(0, 8).map((a) => `
    <button type="button" class="house-pickrow" role="option" data-pick-advisor="${escHtml(a.id)}">
      <span class="house-pickrow-main">
        <span class="fw-semibold">${escHtml(a.full_name)}</span>
        ${a.dept ? `<span class="text-muted"> · ${escHtml(a.dept)}</span>` : ''}
        ${a.email ? `<span class="house-pickrow-mail">${escHtml(a.email)}</span>` : ''}
      </span>
      <i class="bi bi-plus-lg" aria-hidden="true"></i>
    </button>`).join('')
    + (hits.length > 8
      ? `<div class="house-picklist-empty">อีก ${hits.length - 8} ท่าน — พิมพ์เพิ่มเพื่อกรองให้แคบลง</div>`
      : '');
}

/**
 * Create an อาจารย์ and attach them to THIS สาย, without leaving the modal.
 *
 * REPORTED: "after click สาย… and wanting to add new อาจารย์, i have to
 * เพิ่มอาจารย์ใหม่ได้ที่แท็บ อาจารย์ — it is tiresome". It was: four navigations
 * (leave the สาย, switch tab, fill a form, come back, find the สาย again) for
 * one intention, and the สาย you were standing in was lost on the way.
 *
 * Two writes, in an order that cannot leave a mess: the advisor is created
 * first and the link second, so a failure at step two leaves a real อาจารย์ who
 * is simply not attached yet — visible in the picker directly above, one click
 * from being attached. The other order is not expressible (a link needs an id).
 *
 * The form stays OPEN and CLEARED on success, because "add three อาจารย์ to
 * this สาย" is the actual task and closing after each one makes it three trips.
 */
async function onSaiCreateAdvisor(e) {
  e.preventDefault();
  const code = $('hxCode').value;
  const status = $('hxNewStatus');
  const first = $('hxNewFirst').value.trim();
  const setStat = (msg, bad = false) => {
    if (!status) return;
    status.textContent = msg || '';
    status.className = `small ${bad ? 'text-danger' : 'text-success'}`;
  };
  if (!code || !first) { $('hxNewFirst').focus(); return; }
  const btn = $('hxNewForm').querySelector('[type="submit"]');
  if (btn) btn.disabled = true;
  setStat('กำลังบันทึก…');
  try {
    const row = await createAdvisor({
      first_name_th: first,
      last_name_th: $('hxNewLast').value.trim() || null,
      email: $('hxNewEmail').value.trim().toLowerCase() || null,
      dept: $('hxNewDept').value.trim() || null,
    });
    const assigned = advisorsBySai().get(code) || [];
    await addSaiAdvisor(code, row.id, assigned.length);
    await refreshAdvisors();
    paintSaiModal(code);
    $('hxNewForm').reset();
    $('hxNewFirst').focus();
    setStat(`เพิ่ม ${row.full_name || first} เข้าสาย ${code} แล้ว`);
  } catch (err) {
    // The SECOND advisor writer. `advisors_email_key` fires here just as it
    // does in the full modal, and this one reports inline rather than by alert.
    setStat(duplicateMessage(err, {
      email: $('hxNewEmail').value.trim().toLowerCase(),
    }) || err?.message || 'เพิ่มอาจารย์ไม่สำเร็จ', true);
  } finally {
    if (btn) btn.disabled = false;
  }
}

function toggleSaiNewAdvisor(show) {
  const form = $('hxNewForm');
  const btn = $('hxNewToggle');
  if (!form) return;
  const open = show === undefined ? form.classList.contains('d-none') : show;
  form.classList.toggle('d-none', !open);
  btn?.setAttribute('aria-expanded', String(open));
  if (open) $('hxNewFirst')?.focus();
  else { form.reset(); if ($('hxNewStatus')) $('hxNewStatus').textContent = ''; }
}

/** Only the advisor rows changed, so only they are refetched. `reload()` here
 *  meant six queries — including all ~1,800 students — for every single
 *  add/remove click, and assigning four อาจารย์ to one สาย is four of them. */
async function refreshAdvisors() {
  advisors = await fetchAdvisors();
  render();
}

function openSaiModal(code) {
  $('hxCode').value = code;
  // Same reason as the new-advisor form below: the search box is a reused DOM
  // node, and last สาย's query filtering this สาย's list is state outliving the
  // record it described.
  if ($('hxPick')) $('hxPick').value = '';
  // Collapsed and empty on every open. The form is a REUSED DOM node, so
  // whatever the last สาย left in it would otherwise be sitting in the boxes of
  // this one — the "state parked on a reused element outlives the record it
  // describes" entry, which here would mean creating a duplicate อาจารย์.
  toggleSaiNewAdvisor(false);
  paintSaiModal(code);
  modalInstance('houseSaiModal')?.show();
}

async function onSaiAddAdvisor(advisorId, row) {
  const code = $('hxCode').value;
  if (!code || !advisorId) return;
  if (row) row.disabled = true;
  try {
    const assigned = advisorsBySai().get(code) || [];
    await addSaiAdvisor(code, advisorId, assigned.length);
    await refreshAdvisors();
    // The search text is deliberately CLEARED: the row just added is gone from
    // the list (it is assigned now), and leaving a query that matches nothing
    // reads as "the search broke".
    if ($('hxPick')) $('hxPick').value = '';
    paintSaiModal(code);
  } catch (err) {
    setStatus(err?.message || 'เพิ่มอาจารย์ไม่สำเร็จ', true);
    if (row) row.disabled = false;
  }
}

async function onSaiRemoveAdvisor(advisorId) {
  const code = $('hxCode').value;
  if (!code || !advisorId) return;
  try {
    await removeSaiAdvisor(code, advisorId);
    await refreshAdvisors();
    paintSaiModal(code);
  } catch (err) {
    setStatus(err?.message || 'นำอาจารย์ออกไม่สำเร็จ', true);
  }
}

// ---------- อาจารย์ ----------
function renderAdvisors() {
  fillDatalist('houseDeptList',
    [...new Set(advisors.map((a) => a.dept).filter(Boolean))].sort());
  const q = ($('houseAdvisorSearch')?.value || '').trim().toLowerCase();
  const rows = advisors.filter((a) => !q
    || [a.full_name, a.email, a.dept].some((v) => String(v || '').toLowerCase().includes(q)));
  const body = $('houseAdvisorRows');
  if (!body) return;
  body.innerHTML = rows.length ? rows.map((a) => `
    <tr data-advisor="${escHtml(a.id)}" role="button">
      <td>${escHtml(a.full_name)}</td>
      <td class="small">${a.email ? escHtml(a.email)
    : '<span class="text-muted fst-italic">ยังไม่มีอีเมล</span>'}</td>
      <td class="small">${a.dept ? escHtml(a.dept)
    : '<span class="text-muted fst-italic">ยังไม่ระบุ</span>'}</td>
      <td class="small">${escHtml((a.sai_advisors || []).map((l) => l.sai_code).sort().join(', ') || '—')}</td>
      <td class="text-end"><i class="bi bi-pencil text-muted"></i></td>
    </tr>`).join('')
    : `<tr><td colspan="5" class="text-center text-muted py-4">
         ยังไม่มีรายชื่ออาจารย์ — กด “เพิ่มอาจารย์” หรือรอไฟล์จากฝ่ายข้อมูล</td></tr>`;
}

// ---------- คำขอแก้ไข ----------
const FIELD_LABEL = {
  sai_code: 'สายรหัส', student_id: 'รหัสนักศึกษา', kkumail: 'kkumail',
  first_name_th: 'ชื่อจริง', last_name_th: 'นามสกุล', major: 'สาขา',
  cohort_year: 'ปีที่เข้า',
};

/** Which slice of the queue is on screen: 'pending' | 'done' | 'all'.
 *  Module state, not read off a class in the DOM — a filter whose value is
 *  computed from its own markup is the shape that made บ้านของฉัน's panel open
 *  on odd-numbered clicks only. */
let reqStatus = 'pending';

const thaiDateTime = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('th-TH', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
};

function filteredRequests() {
  const q = ($('houseReqSearch')?.value || '').trim().toLowerCase();
  return requests.filter((r) => {
    if (reqStatus === 'pending' && r.status !== 'pending') return false;
    if (reqStatus === 'done' && r.status === 'pending') return false;
    if (!q) return true;
    const s = r.students || {};
    // Everything a person would plausibly search this queue by, INCLUDING what
    // an admin typed back — "what did we tell that student in March" is the
    // question a queue with no search cannot answer at all.
    return [s.full_name, s.kkumail, s.sai_code, r.current_value, r.requested_value,
      r.applied_value, r.reason, r.decision_note, FIELD_LABEL[r.field] || r.field]
      .some((v) => String(v || '').toLowerCase().includes(q));
  });
}

/**
 * One request card.
 *
 * THE PENDING CARD IS A FORM, not a pair of verdict buttons. REPORTED: "the
 * admin should be able to input สายรหัส, not just accept / not accept" — a
 * student who knows their สาย is wrong does not necessarily know what the right
 * one is, and forcing the admin to either accept a guess or reject and wait for
 * a better guess is a round trip for something the admin can see. The value box
 * is pre-filled with what was asked, so accepting as-asked is still one click.
 *
 * THE DONE CARD SHOWS THE ANSWER, both halves: the verdict, what was actually
 * saved when it differs from what was asked (`applied_value`, added in 0128),
 * and the note the admin typed. The same three now reach the student on their
 * own card — before 0128 the note went into a column with no read path back to
 * the person who had asked.
 */
function requestCard(r) {
  const s = r.students || {};
  const isSai = r.field === 'sai_code';
  const pending = r.status === 'pending';
  const newHouse = isSai ? houseOf(String(r.requested_value || '')) : null;
  const label = FIELD_LABEL[r.field] || r.field;
  return `
    <div class="card mb-2"><div class="card-body py-2">
      <div class="d-flex flex-wrap gap-3 align-items-start">
        <div class="flex-grow-1 min-w-0">
          <div class="fw-semibold">${escHtml(s.full_name || '(ไม่ทราบชื่อ)')}
            <span class="small text-muted">${escHtml(s.kkumail || '')}</span></div>
          <div class="small">
            ขอแก้ <strong>${escHtml(label)}</strong>
            จาก <code>${escHtml(r.current_value || '—')}</code>
            เป็น <code>${escHtml(r.requested_value || '—')}</code>
            ${isSai && newHouse !== null
    ? `<span class="badge bg-warning text-dark">ย้ายไป ${escHtml(houseName(newHouse))}</span>` : ''}
          </div>
          ${r.reason ? `<div class="small text-muted">เหตุผล: ${escHtml(r.reason)}</div>` : ''}
          <div class="small text-muted">ส่งเมื่อ ${escHtml(thaiDateTime(r.created_at))}</div>
          ${!pending && r.applied_value && r.applied_value !== r.requested_value
    ? `<div class="small text-primary">บันทึกจริงเป็น <code>${escHtml(r.applied_value)}</code>
         (ต่างจากที่ขอมา)</div>` : ''}
          ${!pending && r.decision_note
    ? `<div class="small">ข้อความถึงนักศึกษา: <em>${escHtml(r.decision_note)}</em></div>` : ''}
          ${!pending && r.decided_at
    ? `<div class="small text-muted">ดำเนินการเมื่อ ${escHtml(thaiDateTime(r.decided_at))}</div>` : ''}
        </div>
        ${pending ? `
          <div class="d-flex flex-column gap-1" style="min-width:17rem">
            <label class="form-label small mb-0" for="hqv-${escHtml(r.id)}">
              ค่าที่จะบันทึก (แก้ได้)
            </label>
            <input type="text" class="form-control form-control-sm" id="hqv-${escHtml(r.id)}"
                   data-req-value="${escHtml(r.id)}"
                   value="${escHtml(r.requested_value || '')}"
                   ${isSai ? 'inputmode="numeric" placeholder="017"' : ''} />
            ${isSai ? `<div class="form-text mt-0" data-req-house="${escHtml(r.id)}"></div>` : ''}
            <input type="text" class="form-control form-control-sm"
                   data-req-note="${escHtml(r.id)}"
                   placeholder="ข้อความถึงนักศึกษา (ไม่บังคับ)" />
            <div class="d-flex gap-1">
              <button class="btn btn-sm btn-success" data-req-approve="${escHtml(r.id)}">อนุมัติ</button>
              <button class="btn btn-sm btn-outline-danger" data-req-reject="${escHtml(r.id)}">ปฏิเสธ</button>
            </div>
          </div>`
    : `<span class="badge ${r.status === 'approved' ? 'bg-success' : 'bg-secondary'}">
           ${r.status === 'approved' ? 'อนุมัติแล้ว' : 'ปฏิเสธแล้ว'}</span>`}
      </div>
    </div></div>`;
}

/** The บ้าน a typed สายรหัส would land in, under the box it is typed in.
 *  Same job as hsHouseHint in the student modal: an approval that moves someone
 *  between houses should say so before it happens, not after. */
function paintRequestHouseHint(id) {
  const input = document.querySelector(`[data-req-value="${CSS.escape(id)}"]`);
  const hint = document.querySelector(`[data-req-house="${CSS.escape(id)}"]`);
  if (!input || !hint) return;
  const n = normalizeSai(input.value);
  if (!input.value.trim()) { hint.textContent = ' '; hint.className = 'form-text mt-0'; return; }
  if (!n.ok) {
    hint.className = 'form-text mt-0 text-danger';
    hint.textContent = saiProblem(input.value) || 'สายรหัสไม่ถูกต้อง';
    return;
  }
  hint.className = 'form-text mt-0';
  hint.textContent = `สาย ${n.value} → ${houseName(houseOf(n.value))}`;
}

function renderRequests() {
  const wrap = $('houseRequestRows');
  if (!wrap) return;

  document.querySelectorAll('[data-req-status]').forEach((b) => {
    b.classList.toggle('active', b.dataset.reqStatus === reqStatus);
  });
  const openCount = requests.filter((r) => r.status === 'pending').length;
  const openBadge = $('houseReqOpenCount');
  if (openBadge) {
    openBadge.textContent = String(openCount);
    openBadge.classList.toggle('d-none', openCount === 0);
  }

  if (!requests.length) {
    wrap.innerHTML = '<div class="text-muted text-center py-4">ยังไม่มีคำขอแก้ไข</div>';
    return;
  }
  const rows = filteredRequests();
  if (!rows.length) {
    wrap.innerHTML = `<div class="text-muted text-center py-4">${
      reqStatus === 'pending' ? 'ไม่มีคำขอที่รอดำเนินการ' : 'ไม่พบคำขอที่ตรงกับที่ค้นหา'}</div>`;
    return;
  }
  wrap.innerHTML = `<div class="small text-muted mb-2">${rows.length.toLocaleString('th-TH')} รายการ</div>`
    + rows.map(requestCard).join('');
  rows.filter((r) => r.status === 'pending' && r.field === 'sai_code')
    .forEach((r) => paintRequestHouseHint(r.id));
}

// ============================================================
// IMPORT
// ============================================================
function renderImportPreview(result, diff) {
  const wrap = $('housePreview');
  if (!wrap) return;

  if (result.fatal) {
    wrap.innerHTML = `
      <div class="alert alert-danger">
        <h6 class="alert-heading">นำเข้าไม่ได้</h6>
        <p class="mb-0">${escHtml(result.fatal)}</p>
      </div>`;
    pendingImport = null;
    return;
  }

  // FILE-level findings (the สาย padding notice, unrecognised columns) are shown
  // ABOVE the fold, not inside the collapsed list: they describe the file as a
  // whole, and "we padded 412 สาย for you" is the one thing the person confirming
  // this import must read before clicking. Per-row problems stay collapsed —
  // there can be hundreds.
  const fileLevel = result.problems.filter((p) => p.line === 1);
  const perRow = result.problems.filter((p) => p.line !== 1);
  const skips = perRow.filter((p) => p.level === 'skip');
  const warns = perRow.filter((p) => p.level === 'warn');
  const infos = perRow.filter((p) => p.level === 'info');
  const houseCounts = new Map();
  for (const r of result.rows) {
    if (r._house === null) continue;
    houseCounts.set(r._house, (houseCounts.get(r._house) || 0) + 1);
  }

  wrap.innerHTML = `
    <div class="alert alert-secondary">
      <div class="row text-center g-2">
        <div class="col"><div class="fs-4 fw-semibold text-success">${diff.insert}</div><div class="small">จะเพิ่มใหม่</div></div>
        <div class="col"><div class="fs-4 fw-semibold text-primary">${diff.update}</div><div class="small">จะแก้ไข</div></div>
        <div class="col"><div class="fs-4 fw-semibold text-muted">${diff.same}</div><div class="small">ไม่เปลี่ยน</div></div>
        <div class="col"><div class="fs-4 fw-semibold text-warning">${skips.length}</div><div class="small">ข้าม</div></div>
      </div>
    </div>

    ${result.missingColumns.length ? `
      <div class="alert alert-warning py-2 small">
        <strong>ไฟล์นี้ไม่มีคอลัมน์:</strong>
        ${escHtml(result.missingColumns.map((c) => CSV_COLUMN_LABEL[c] || c).join(' · '))}
        <br />นำเข้าได้ — ช่องที่ขาดจะ<strong>ไม่ถูกแตะต้อง</strong>
        ของเดิมในระบบยังอยู่ครบ
        ${result.missingColumns.includes('sai_code')
    ? '<br />(ไฟล์นี้ไม่มีสายรหัส จึงไม่มีการย้ายบ้านใครทั้งสิ้น)' : ''}
      </div>` : ''}

    ${fileLevel.map((p) => `
      <div class="alert ${p.level === 'warn' ? 'alert-warning' : 'alert-info'} py-2 small">
        ${escHtml(p.message)}
      </div>`).join('')}

    ${diff.missing.length ? `
      <div class="alert alert-warning py-2 small">
        มี ${diff.missing.length} คนอยู่ในระบบแต่ไม่มีในไฟล์นี้ —
        <strong>ระบบจะไม่ลบให้</strong> และจะทำเครื่องหมายไว้ว่าไม่พบในไฟล์ล่าสุด
      </div>` : ''}

    ${diff.kept ? `
      <div class="alert alert-info py-2 small">
        มี ${diff.kept} คนที่แก้ข้อมูลของตัวเองไว้ และไฟล์นี้บอกไม่ตรงกัน —
        <strong>ระบบจะเก็บของเจ้าตัวไว้ ไม่ทับ</strong>
        แล้วขึ้นถามเจ้าตัวในหน้าแรกว่าอันไหนถูก
        ดูได้ในตารางด้านล่าง (ปุ่ม “เจ้าตัวแก้เอง”)
        <br>ถ้าตัวเลขนี้สูงผิดปกติ ให้สงสัยไฟล์ก่อน — คนจำนวนมากไม่ได้พิมพ์ชื่อตัวเองผิดพร้อมกัน
      </div>` : ''}

    <div class="mb-3">
      <h6 class="small text-uppercase text-muted">จำนวนคนที่จะเข้าแต่ละบ้าน</h6>
      <div class="d-flex flex-wrap gap-2">
        ${Array.from({ length: HOUSE_COUNT }, (_, i) => `
          <span class="badge bg-light text-dark border">
            ${escHtml(houseName(i))}: ${houseCounts.get(i) || 0}
          </span>`).join('')}
      </div>
    </div>

    ${perRow.length ? `
      <details class="mb-3">
        <summary class="small">ปัญหาที่พบทั้งหมด ${perRow.length} รายการ (เรียงตามความร้ายแรง)</summary>
        <ul class="small mt-2 mb-0">
          ${[...skips, ...warns, ...infos].slice(0, 100).map((p) => `
            <li class="${p.level === 'skip' ? 'text-danger'
    : p.level === 'warn' ? 'text-warning-emphasis' : 'text-muted'}">
              ${escHtml(p.message)}</li>`).join('')}
        </ul>
        ${perRow.length > 100 ? `<div class="small text-muted mt-1">
          (แสดง 100 รายการแรกจาก ${perRow.length})</div>` : ''}
      </details>` : ''}

    <h6 class="small text-uppercase text-muted mb-1">ข้อมูลที่จะนำเข้า — ทีละแถว</h6>
    <div class="d-flex flex-wrap gap-2 align-items-center mb-2">
      <div class="btn-group btn-group-sm" role="group" aria-label="กรองแถว" id="housePreviewNav">
        <button type="button" class="btn btn-outline-secondary active" data-prev-filter="all">ทั้งหมด</button>
        <button type="button" class="btn btn-outline-secondary" data-prev-filter="insert">เพิ่มใหม่</button>
        <button type="button" class="btn btn-outline-secondary" data-prev-filter="update">จะแก้ไข</button>
        <button type="button" class="btn btn-outline-secondary" data-prev-filter="kept">เจ้าตัวแก้เอง</button>
        <button type="button" class="btn btn-outline-secondary" data-prev-filter="problem">ต้องดู</button>
      </div>
      <input type="search" class="form-control form-control-sm" id="housePreviewSearch"
             style="max-width:18rem" placeholder="ค้นหาในไฟล์นี้"
             aria-label="ค้นหาแถวในไฟล์" />
      <span class="small text-muted" id="housePreviewCount"></span>
    </div>
    <div id="housePreviewTable"></div>

    <button type="button" class="btn btn-primary mt-3" id="houseImportConfirm"
      ${result.rows.length ? '' : 'disabled'}>
      ยืนยันนำเข้า ${result.rows.length.toLocaleString('th-TH')} รายการ
    </button>`;

  previewRows = buildPreviewRows(result, diff);
  previewFilter = 'all';
  renderPreviewTable();
  $('housePreviewSearch')?.addEventListener('input', renderPreviewTable);
  $('housePreviewNav')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-prev-filter]');
    if (!btn) return;
    previewFilter = btn.dataset.prevFilter;
    renderPreviewTable();
  });
  $('houseImportConfirm')?.addEventListener('click', runImport);
}

// Which slice of the check list is showing, and what is typed in its search.
// Module scope so a repaint (a filter click, a year bump) does not lose them.
let checkFilter = 'unchecked';
let checkQuery = '';
let checkTimer = null;
let checkToken = 0;

/**
 * WHO has checked, one row per person.
 *
 * REPORTED: "if you want to show how much people has ยืนยัน, admin should also
 * see who has ยืนยัน and who is still left not ยืนยัน, like each person" — and
 * then, decisively: "i only see 3 test data people in ระบบบ้าน". Both are the
 * same mistake of mine: the COUNT read `people` and the per-row filter read
 * `students`, so the screen showed hundreds beside three.
 *
 * This reads the registry, which is where `identity_confirmed_at` lives and
 * where every ทีม SAMO member already has a row — so the week of checking can
 * be run and chased NOW, before the faculty file exists.
 */
async function renderCheckList() {
  const host = $('houseCheckList');
  if (!host) return;
  const token = ++checkToken;
  try {
    const res = await fetchIdentityCheckList({
      status: checkFilter, q: checkQuery.trim(), limit: 200,
    });
    if (token !== checkToken) return;
    const rows = Array.isArray(res.rows) ? res.rows : [];
    const total = Number(res.total || 0);
    const count = $('houseCheckCount');
    if (count) {
      count.textContent = total
        ? `แสดง ${Math.min(rows.length, total).toLocaleString('th-TH')} จาก ${total.toLocaleString('th-TH')} คน`
        : 'ไม่มีใครในกลุ่มนี้';
    }
    if (!rows.length) { host.innerHTML = ''; return; }
    host.innerHTML = `
      <div class="table-responsive border rounded" style="max-height:22rem;overflow:auto">
        <table class="table table-sm table-hover mb-0" style="font-size:.85rem">
          <thead class="table-light" style="position:sticky;top:0;z-index:1">
            <tr>
              <th>ชื่อ</th><th>ชื่อเล่น</th><th>รหัสนักศึกษา</th>
              <th>KKU Mail</th><th>ตำแหน่งในทีม SAMO</th><th>สถานะ</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map((r) => `
              <tr>
                <td>${escHtml(r.full_name
                  || [r.first_name_th, r.last_name_th].filter(Boolean).join(' ')
                  || '(ไม่มีชื่อ)')}</td>
                <td>${escHtml(r.nickname || '—')}</td>
                <td>${escHtml(r.student_id || '—')}</td>
                <td class="text-break">${escHtml(r.kkumail || '—')}</td>
                <td>${escHtml(r.team_nodes || (r.in_house ? 'ระบบบ้าน' : '—'))}</td>
                <td>${Number(r.open_conflicts) > 0
                  ? '<span class="badge bg-warning-subtle text-warning-emphasis border">ข้อมูลไม่ตรงกับไฟล์</span>'
                  : r.checked
                    ? `<span class="badge bg-success-subtle text-success-emphasis border">ตรวจแล้ว${
                      r.identity_confirmed_at ? '' : ' (แก้ข้อมูลเอง)'}</span>`
                    : '<span class="badge bg-light text-dark border">ยังไม่ได้ตรวจ</span>'}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
  } catch (err) {
    if (token !== checkToken) return;
    host.innerHTML = `<p class="small text-danger mb-0">${escHtml(err?.message || 'โหลดรายชื่อไม่สำเร็จ')}</p>`;
  }
}

/**
 * สถานะการตรวจสอบข้อมูล + ปีการศึกษา.
 *
 * REPORTED: "why would you let people ยืนยันข้อมูล, what will it be use for, if
 * it's useful then show who already ยืนยัน or who's left, or else not need
 * people to ยืนยัน". The objection was correct as shipped: 0138 collected
 * `identity_confirmed_at` and put it nowhere, and a signal nobody can read is a
 * button that wastes the reader's time. The point of collecting it is the week
 * the owner described — letting people check their own data and then knowing
 * who is LEFT — so this is the screen that makes it worth asking for.
 *
 * Counts, never names. `identity_check_summary()` returns numbers because a
 * list of 1,800 students is a roster projection, and publishing one of those by
 * accident already has its own entry. WHO is answered by the นักศึกษา list's
 * "ยังไม่ได้ตรวจ" filter, which is per-row and already gated.
 *
 * ปีการศึกษา sits here rather than in a settings pane because the two facts are
 * read together: "everyone has checked their data" and "the year they checked it
 * against" are the same question a week before an event.
 */
async function renderCheckStatus() {
  const host = $('houseCheckStatus');
  if (!host) return;
  let sum = null;
  let ay = null;
  try {
    [sum, ay] = await Promise.all([
      fetchIdentityCheckSummary().catch(() => null),
      fetchAcademicYearStatus().catch(() => null),
    ]);
  } catch { /* a status strip must never take the page down with it */ }
  if (!sum && !ay) { host.innerHTML = ''; return; }

  const people = Number(sum?.people || 0);
  // CHECKED, not `confirmed`: somebody who corrected their own สาขา has plainly
  // looked at their record, and counting only button presses would chase people
  // who have already done the thing being asked of them.
  const checked = Number(sum?.checked || 0);
  const confirmed = Number(sum?.confirmed || 0);
  const open = Number(sum?.open_conflicts || 0);
  const left = Number(sum?.unchecked ?? Math.max(people - checked, 0));
  const pct = people ? Math.round((checked / people) * 100) : 0;

  const year = Number(ay?.academic_year || 0);
  const behind = Number(ay?.behind || 0);

  host.innerHTML = `
    <div class="card">
      <div class="card-body py-3">
        <div class="d-flex flex-wrap align-items-center gap-3 mb-2">
          <h6 class="mb-0">การตรวจสอบข้อมูลของนักศึกษา</h6>
          <span class="small text-muted">
            ยืนยันแล้ว ${confirmed.toLocaleString('th-TH')} จาก ${people.toLocaleString('th-TH')} คน (${pct}%)
          </span>
        </div>
        <div class="progress mb-3" style="height:.5rem" role="progressbar"
             aria-label="สัดส่วนผู้ที่ยืนยันข้อมูลแล้ว" aria-valuenow="${pct}"
             aria-valuemin="0" aria-valuemax="100">
          <div class="progress-bar bg-success" style="width:${pct}%"></div>
        </div>
        <div class="d-flex flex-wrap gap-2 mb-2">
          <button type="button" class="btn btn-sm btn-outline-secondary" data-check-filter="checked">
            ตรวจแล้ว ${checked.toLocaleString('th-TH')}
          </button>
          <button type="button" class="btn btn-sm btn-outline-secondary" data-check-filter="unchecked">
            ยังไม่ได้ตรวจ ${left.toLocaleString('th-TH')}
          </button>
          ${open ? `<button type="button" class="btn btn-sm btn-outline-warning" data-check-filter="conflict">
            ข้อมูลไม่ตรงกับไฟล์ ${open.toLocaleString('th-TH')}</button>` : ''}
          <button type="button" class="btn btn-sm btn-outline-secondary" data-check-filter="all">
            ทั้งหมด ${people.toLocaleString('th-TH')}
          </button>
        </div>
        <p class="small text-muted mb-2">
          “ตรวจแล้ว” นับทั้งคนที่กดยืนยัน (${confirmed.toLocaleString('th-TH')} คน)
          และคนที่แก้ข้อมูลของตัวเอง — ทั้งสองอย่างแปลว่าเขาเปิดดูแล้ว
          รายชื่อนี้รวม<strong>ทุกคนที่ระบบรู้จัก</strong> ทั้งสมาชิกทีม SAMO
          และนักศึกษาที่นำเข้ามาแล้ว ไม่ใช่เฉพาะคนที่มีสายรหัส
        </p>
        <div class="d-flex flex-wrap gap-2 align-items-center mb-2">
          <input type="search" class="form-control form-control-sm" id="houseCheckSearch"
                 style="max-width:16rem" placeholder="ค้นหาชื่อ / ชื่อเล่น / รหัส / อีเมล"
                 aria-label="ค้นหาในรายชื่อการตรวจสอบข้อมูล" />
          <span class="small text-muted" id="houseCheckCount"></span>
        </div>
        <div id="houseCheckList"></div>

        <hr class="my-3" />
        <div class="d-flex flex-wrap align-items-center gap-2">
          <span class="small text-muted">ปีการศึกษาที่ใช้คำนวณชั้นปี</span>
          <strong>${year ? year.toLocaleString('th-TH') : '—'}</strong>
          <button type="button" class="btn btn-sm btn-outline-secondary" id="houseYearBump"
            ${year ? '' : 'disabled'}>เลื่อนเป็น ${year ? (year + 1).toLocaleString('th-TH') : ''}</button>
          ${behind ? `<span class="badge bg-warning-subtle text-warning-emphasis border">
            ถึงกำหนดเลื่อนแล้ว (ปฏิทินอยู่ที่ ${Number(ay.clock_year).toLocaleString('th-TH')})</span>` : ''}
        </div>
        <p class="small text-muted mb-0 mt-1">
          ระบบ<strong>ไม่เลื่อนชั้นปีให้เอง</strong> — กดปุ่มนี้ปีละครั้งเมื่อขึ้นปีการศึกษาใหม่
          แล้วทุกคนจะเลื่อนพร้อมกัน ใครที่ลาพักหรือเรียนซ้ำและเคยเลือกชั้นปีที่ถูกไว้แล้ว
          ระบบจำส่วนต่างไว้ให้ ไม่ต้องไล่แก้รายคน
        </p>
      </div>
    </div>`;

  host.querySelectorAll('[data-check-filter]').forEach((b) => {
    b.classList.toggle('active', b.dataset.checkFilter === checkFilter);
    b.addEventListener('click', () => {
      checkFilter = b.dataset.checkFilter;
      renderCheckStatus();
    });
  });
  const searchBox = $('houseCheckSearch');
  if (searchBox) {
    searchBox.value = checkQuery;
    searchBox.addEventListener('input', () => {
      checkQuery = searchBox.value;
      clearTimeout(checkTimer);
      // Debounced and token-guarded: a 2-character query is slower than the
      // 5-character one typed after it, and the stale reply would repaint the
      // list under the person's cursor.
      checkTimer = setTimeout(renderCheckList, 250);
    });
  }
  renderCheckList();

  $('houseYearBump')?.addEventListener('click', async () => {
    const btn = $('houseYearBump');
    // The RPC takes the TARGET year, not "+1", so a double click is idempotent
    // rather than advancing 1,800 people twice (0141 §4).
    const ok = await askConfirm({
      title: `เลื่อนปีการศึกษาเป็น ${year + 1}?`,
      body: 'ชั้นปีของนักศึกษาทุกคนจะเลื่อนขึ้น 1 ปีพร้อมกัน '
        + 'คนที่เคยเลือกชั้นปีเองไว้จะเลื่อนตามส่วนต่างที่บันทึกไว้ '
        + 'ถ้ากดผิด กดกลับเป็นปีเดิมได้',
      yes: 'เลื่อนเลย',
      danger: false,
    });
    if (!ok) return;
    if (btn) btn.disabled = true;
    try {
      await saveAcademicYear(year + 1);
      await primeAcademicYear();
      renderCheckStatus();
      render();
    } catch (err) {
      alert(err?.message || 'เปลี่ยนปีการศึกษาไม่สำเร็จ');
      if (btn) btn.disabled = false;
    }
  });
}

// ---------- the per-row preview ----------
let previewRows = [];
let previewFilter = 'all';

const VERDICT = {
  insert: { label: 'เพิ่มใหม่', cls: 'text-success' },
  update: { label: 'จะแก้ไข', cls: 'text-primary' },
  same: { label: 'ไม่เปลี่ยน', cls: 'text-muted' },
  skip: { label: 'ข้าม', cls: 'text-danger fw-semibold' },
};

const worstLevel = (problems) => (problems.some((p) => p.level === 'skip') ? 'skip'
  : problems.some((p) => p.level === 'warn') ? 'warn'
    : problems.length ? 'info' : null);

/**
 * The file, one row per line, scrollable.
 *
 * CAPPED AT 300 RENDERED ROWS, but the CAP MOVES WITH THE FILTER — "ต้องดู"
 * shows every flagged row even in a 1,800-line file, because that is the subset
 * a person is actually here to read. An uncapped table of 1,800 rows × 8 cells
 * is 14,000 DOM nodes built synchronously while someone waits to click a button.
 */
function renderPreviewTable() {
  const wrap = $('housePreviewTable');
  if (!wrap) return;
  const q = ($('housePreviewSearch')?.value || '').trim().toLowerCase();
  const rows = previewRows.filter((r) => {
    if (previewFilter === 'problem' && !r._problems.length && r._verdict !== 'skip') return false;
    if (previewFilter === 'insert' && r._verdict !== 'insert') return false;
    if (previewFilter === 'update' && r._verdict !== 'update') return false;
    if (previewFilter === 'kept' && !(r._kept || []).length) return false;
    if (!q) return true;
    return PREVIEW_COLUMNS.some((c) => String(r[c] || '').toLowerCase().includes(q))
      || r._problems.some((p) => String(p.message).toLowerCase().includes(q));
  });

  const count = $('housePreviewCount');
  if (count) {
    count.textContent = rows.length
      ? `แสดง ${Math.min(rows.length, 300).toLocaleString('th-TH')} จาก ${rows.length.toLocaleString('th-TH')} แถว`
      : 'ไม่มีแถวที่ตรงกับตัวกรอง';
  }

  const cell = (r, c) => {
    const v = r[c] ?? '';
    // ของเดิม → ของใหม่, on the columns this import will actually change. The
    // counter said "จะแก้ไข N" and left the human to trust it.
    if (r._verdict === 'update' && r._changed?.includes(c)) {
      const was = r._before?.[c] ?? '';
      return `<span class="text-decoration-line-through text-muted">${escHtml(was || '—')}</span>
              <i class="bi bi-arrow-right small text-muted"></i>
              <span class="text-primary fw-semibold">${escHtml(v || '—')}</span>`;
    }
    // A column the STUDENT has taken over (0125/0138). The file says something
    // different and the table will refuse to write it, so the arrow points the
    // OTHER WAY: what stays is what the person typed, and the file's value is
    // the one being set aside. Drawing it like an ordinary change would promise
    // a write that is about to be declined.
    if (r._kept?.includes(c)) {
      const mine = r._keptBefore?.[c] ?? '';
      return `<span class="fw-semibold">${escHtml(mine || '—')}</span>
              <span class="text-muted small d-block">ไฟล์ว่า ${escHtml(v || '—')} — เจ้าตัวแก้เอง จะถามเจ้าตัว</span>`;
    }
    return v === '' || v === null ? '<span class="text-muted">—</span>' : escHtml(v);
  };

  wrap.innerHTML = `
    <div class="table-responsive border rounded" style="max-height:26rem;overflow:auto">
      <table class="table table-sm table-hover mb-0 house-preview-table" style="font-size:.82rem">
        <thead class="table-light" style="position:sticky;top:0;z-index:1">
          <tr>
            <th style="width:3.5rem">บรรทัด</th>
            <th style="width:5.5rem">ผล</th>
            ${PREVIEW_COLUMNS.map((c) => `<th>${escHtml(PREVIEW_COLUMN_LABEL[c] || c)}</th>`).join('')}
            <th style="width:4.5rem">บ้าน</th>
          </tr>
        </thead>
        <tbody>
          ${rows.length ? rows.slice(0, 300).map((r) => {
    const v = VERDICT[r._verdict] || VERDICT.same;
    const lvl = r._verdict === 'skip' ? 'skip' : worstLevel(r._problems);
    const rowCls = lvl === 'skip' ? 'table-danger' : lvl === 'warn' ? 'table-warning' : '';
    const house = r._house === null || r._house === undefined ? '' : houseName(r._house);
    return `
            <tr class="${rowCls}">
              <td class="text-muted">${r._line}</td>
              <td class="${v.cls}">${escHtml(v.label)}</td>
              ${PREVIEW_COLUMNS.map((c) => `<td>${cell(r, c)}</td>`).join('')}
              <td>${house ? escHtml(house) : '<span class="text-muted">—</span>'}</td>
            </tr>
            ${r._verdict === 'skip' || r._problems.length ? `
            <tr class="${rowCls}">
              <td></td>
              <td colspan="${PREVIEW_COLUMNS.length + 2}" class="pt-0 small">
                ${r._verdict === 'skip'
    ? `<div class="text-danger"><i class="bi bi-x-octagon"></i>
                     ไม่นำเข้าแถวนี้ — ${escHtml(r._skip || 'ข้อมูลไม่ครบ')}</div>` : ''}
                ${r._problems.map((p) => `<div class="${
  p.level === 'skip' ? 'text-danger' : p.level === 'warn' ? 'text-warning-emphasis' : 'text-muted'
}"><i class="bi bi-exclamation-triangle"></i> ${escHtml(
  // The "บรรทัด N: " prefix is redundant here — the row IS line N.
  String(p.message).replace(/^บรรทัด \d+:\s*/, ''),
)}</div>`).join('')}
              </td>
            </tr>` : ''}`;
  }).join('') : `
            <tr><td colspan="${PREVIEW_COLUMNS.length + 3}" class="text-center text-muted py-3">
              ไม่มีแถวที่ตรงกับตัวกรอง</td></tr>`}
        </tbody>
      </table>
    </div>
    ${rows.length > 300 ? `<div class="small text-muted mt-1">
      แสดง 300 แถวแรก — ใช้ช่องค้นหาหรือปุ่ม “ต้องดู” เพื่อดูแถวที่เหลือ</div>` : ''}`;
}

async function onCsvPicked(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    // The MANAGED vocabulary (team_majors), never "whatever is already in the
    // table" and never a hardcoded fallback. Deriving the known list from the
    // existing rows made it self-ratifying: one bad import taught the next one
    // that `md` was a real สาขา, and the hardcoded ['MD','MDI','RT'] was a second
    // copy of a list an admin can edit.
    const result = parseStudentsCsv(text, majors.map((m) => m.code));
    const diff = diffAgainstExisting(
      result.rows, students, result.presentColumns, result.skipped);
    pendingImport = { result, diff, fileName: file.name };
    renderImportPreview(result, diff);
  } catch (err) {
    setStatus(err?.message || 'อ่านไฟล์ไม่สำเร็จ', true);
  }
}

async function runImport() {
  if (!pendingImport) return;
  const { result, diff, fileName } = pendingImport;
  const btn = $('houseImportConfirm');
  if (btn) { btn.disabled = true; btn.textContent = 'กำลังนำเข้า…'; }
  try {
    // Counts are stamped AFTER the write (finishImportBatch below), not here:
    // the row must exist first because students carry last_import_batch, but a
    // row created with the planned counts would claim a successful import of N
    // people even if the run died on chunk 3.
    const batch = await createImportBatch({
      file_name: fileName,
      uploaded_by: getUser()?.id || null,
      row_count: result.rows.length,
      problem_count: result.problems.length,
    });
    // The lines this file NAMED and could not address, built BEFORE the สาย are
    // seeded because their สาย have to be seeded too — see below.
    const heldRows = (result.skipped || []).map(toUnresolvedRow);

    // สาย FIRST. students.sai_code is a foreign key and สาย are not seeded —
    // the range runs as high as the largest year's headcount, so the set comes
    // from the file. Without this every student on a สาย we have not seen
    // before fails with a 23503 partway through the import.
    //
    // ⚠️ BOTH LISTS, and the second one is not optional.
    // `student_import_unresolved.sai_code` has the same foreign key, so a สาย
    // whose ONLY member in this file has no kkumail is never seeded — and
    // `record_unresolved_rows` then dies with 23503 at the very END of the
    // import, after every student row is already written. The 2026-09-14 file
    // does not trigger it, purely because รุ่น 49 happens to cover สาย 001–287
    // with no gaps; one cohort where a สาย's single member is missing an
    // address is all it takes.
    if (btn) btn.textContent = 'กำลังสร้างสายรหัส…';
    await ensureSais(saiCodesToSeed(result.rows, heldRows));

    // Chunked: 1,800 rows in one POST is a large body and an all-or-nothing
    // failure. 200 at a time keeps each request small and makes a partial
    // failure legible ("stopped at chunk 4") instead of silent.
    // Scoped to the columns the FILE carried: a column the file did not have
    // must not be written, or an import would clear it for everyone in the file.
    const rows = result.rows.map((r) => toUpsertRow(r, batch?.id, result.presentColumns));
    const CHUNK = 200;
    for (let i = 0; i < rows.length; i += CHUNK) {
      await upsertStudents(rows.slice(i, i + CHUNK));
      if (btn) btn.textContent = `กำลังนำเข้า… ${Math.min(i + CHUNK, rows.length)}/${rows.length}`;
    }
    // Rows already in the database that this file does not mention. The preview
    // promises they are flagged rather than deleted — before this, it said so
    // and then did nothing, which is worse than not offering the guarantee.
    const missingIds = diff.missing.map((m) => m.id).filter(Boolean);
    if (missingIds.length) {
      if (btn) btn.textContent = 'กำลังทำเครื่องหมายรายการที่ไม่อยู่ในไฟล์…';
      await markMissing(missingIds);
    }
    // The lines this file NAMED and could not address. Written on EVERY import,
    // including one that skipped nothing — the held list describes the newest
    // file, so a run that resolves everybody clears it by saying so (0188).
    // NOT named `held`: that is the module-level list this pane renders from,
    // and a local of the same name inside this function shadows it for the whole
    // body — which works today only because nothing else in here reads it.
    if (btn) btn.textContent = 'กำลังบันทึกรายชื่อที่ยังนำเข้าไม่ได้…';
    const heldResult = await recordUnresolved(batch?.id, heldRows);

    await finishImportBatch(batch?.id, {
      inserted_count: diff.insert,
      updated_count: diff.update,
      unchanged_count: diff.same,
    });
    pendingImport = null;
    $('houseCsvFile').value = '';
    $('housePreview').innerHTML = `<div class="alert alert-success">นำเข้าเรียบร้อยแล้ว`
      + `${heldResult?.held ? ` — และพัก ${heldResult.held} คนที่ไฟล์ไม่มี kkumail ไว้ที่ “รายชื่อที่ยังนำเข้าไม่ได้”` : ''}`
      + '</div>';
    await reload();
  } catch (err) {
    if (btn) { btn.disabled = false; btn.textContent = 'ลองอีกครั้ง'; }
    setStatus(err?.message || 'นำเข้าไม่สำเร็จ', true);
  }
}

// ============================================================
// EDITORS
// ============================================================
// ── "this person already exists" ───────────────────────────────────────────
//
// REPORTED: "what if i add student data in ระบบบ้าน that already exist in
// teamsamo, it shows {"code":"23505", … "students_kkumail_key"}. what if the
// data isn't the same, or some field left blank, etc."
//
// THE DIAGNOSIS. A unique index is the correct BACKSTOP and a terrible first
// line of defence. By the time `students_kkumail_key` fires the admin has filled
// in a whole form, and what comes back is an index name — it does not say who
// the address belongs to, whether they are already in a บ้าน, or what to do
// next. The admin's only move is to guess.
//
// THE THREE ANSWERS, because "already exists" is three different situations
// wanting three different next actions:
//
//   1. ALREADY A นักศึกษา — they have a house placement. There is nothing to
//      create; the right action is to OPEN the row they already have. The save
//      is blocked, and the banner names their สาย and บ้าน so the admin can see
//      whether they were even looking at the right person.
//   2. IN THE REGISTRY, NOT IN ระบบบ้าน — a ทีม SAMO member being given a house
//      placement for the first time. This is a legitimate create, and the
//      registry already knows their ชื่อ, รหัส, สาขา. Offer to fill the blanks
//      from it, and where the admin typed something DIFFERENT, show both and let
//      them choose — never overwrite silently in either direction.
//   3. NOBODY — an ordinary new row. No banner.
//
// WHY THE LOOKUP IS AN RPC AND NOT A SCAN OF `students`. This pane holds the
// students array already, so checking it locally is tempting and wrong: RLS
// returns ZERO ROWS rather than an error, so a local scan answers "no such
// person" for precisely the rows the caller cannot see. That is a fail-open, and
// it is the shape behind three bugs in this repo. `search_people` is SECURITY
// DEFINER (0137) and already granted to `house`.
//
// EXACT MATCH ONLY. The banner acts on a row whose kkumail EQUALS what was
// typed — never on a substring hit. "An ILIKE lookup makes the id a PATTERN, not
// a capability": search_people is a search, and treating its best guess as an
// identity would let a half-typed address claim a stranger's record.

let personMatchToken = 0;      // bumped per open + per keystroke; see below
let personMatch = null;        // the exact-kkumail hit, or null

/** The `students` row for a registry person, when this admin can see it. */
function houseRowForPerson(p) {
  const mail = String(p?.kkumail || '').trim().toLowerCase();
  if (!mail) return null;
  return students.find((s) => String(s.kkumail || '').trim().toLowerCase() === mail) || null;
}

/** The fields the registry can fill in, and what each is called to a human. */
const PERSON_FILL_FIELDS = [
  ['first_name_th', 'ชื่อจริง', 'hsFirst'],
  ['last_name_th', 'นามสกุล', 'hsLast'],
  ['nickname', 'ชื่อเล่น', 'hsNick'],
  ['student_id', 'รหัสนักศึกษา', 'hsSid'],
  ['major', 'สาขา', 'hsMajor'],
];

function paintPersonMatch() {
  const box = $('hsPersonMatch');
  if (!box) return;
  const p = personMatch;
  if (!p) { box.className = 'person-match d-none'; box.innerHTML = ''; return; }

  const who = escHtml(p.full_name || p.first_name_th || '(ไม่มีชื่อ)');
  const where = p.team_nodes ? `<span class="person-match-where">ทีม SAMO: ${escHtml(p.team_nodes)}</span>` : '';

  // 1 — already placed. Nothing to create.
  if (p.in_house) {
    const row = houseRowForPerson(p);
    box.className = 'person-match is-block';
    box.innerHTML = `
      <div class="person-match-head"><i class="bi bi-exclamation-octagon-fill" aria-hidden="true"></i>
        <strong>อีเมลนี้มีนักศึกษาอยู่แล้ว</strong></div>
      <p class="person-match-body">${who}${
  row ? ` — สาย ${escHtml(row.sai_code || '—')} · ${escHtml(houseName(houseOf(row.sai_code)))}` : ''}
        ${row ? '' : '<br />แถวนี้ไม่อยู่ในรายการที่คุณเห็น — ติดต่อผู้ดูแลระบบ'}</p>
      ${where}
      ${row ? `<button type="button" class="btn btn-sm btn-outline-primary"
        data-house-act="open-existing" data-id="${escHtml(row.id)}">เปิดข้อมูลคนนี้</button>` : ''}`;
    return;
  }

  // 2 — known person, new house placement. Offer what the registry holds, and
  // name every field where it DISAGREES with what is already typed.
  const differs = PERSON_FILL_FIELDS
    .filter(([key, , el]) => {
      const typed = String($(el)?.value || '').trim();
      const known = String(p[key] || '').trim();
      return typed && known && typed !== known;
    })
    .map(([key, label]) => `${label}: <code>${escHtml(String(p[key]))}</code>`);

  box.className = 'person-match is-known';
  box.innerHTML = `
    <div class="person-match-head"><i class="bi bi-person-check-fill" aria-hidden="true"></i>
      <strong>พบคนนี้ในระบบแล้ว</strong></div>
    <p class="person-match-body">${who}${p.student_id ? ` · ${escHtml(p.student_id)}` : ''}
      — ยังไม่มีข้อมูลในระบบบ้าน บันทึกได้เลย ระบบจะผูกให้เป็นคนเดียวกันเอง</p>
    ${where}
    ${differs.length
    ? `<p class="person-match-diff"><i class="bi bi-info-circle" aria-hidden="true"></i>
         ข้อมูลในระบบต่างจากที่กรอก — ${differs.join(' · ')}</p>` : ''}
    <button type="button" class="btn btn-sm btn-outline-secondary"
      data-house-act="use-person">ใช้ข้อมูลจากระบบ</button>`;
}

/**
 * Look the typed address up, debounced.
 *
 * The token is bumped on every call, so a slow reply for a half-typed address
 * cannot land after a faster one for the finished address — the modal element is
 * reused for every row, and state left on it outliving the record it describes is
 * a bug this codebase has shipped more than once.
 */
function lookupPerson() {
  const mail = String($('hsMail')?.value || '').trim().toLowerCase();
  const token = ++personMatchToken;
  // Editing an EXISTING row: the address is expected to match that very row, and
  // "อีเมลนี้มีนักศึกษาอยู่แล้ว" pointed at itself would be nonsense.
  const editingId = $('hsId')?.value || '';
  if (!mail.includes('@') || mail.length < 4) {
    personMatch = null; paintPersonMatch(); return;
  }
  searchPeople(mail, 5)
    .then((hits) => {
      if (token !== personMatchToken) return;                 // a later keystroke won
      const exact = (hits || []).find(
        (h) => String(h.kkumail || '').trim().toLowerCase() === mail,
      ) || null;
      const own = exact && editingId && houseRowForPerson(exact)?.id === editingId;
      personMatch = own ? null : exact;
      paintPersonMatch();
    })
    .catch((err) => {
      // A failed lookup must NOT block the save. The unique index is still the
      // guarantee; this banner is the courtesy, and a courtesy that turns into a
      // wall when the network hiccups is worse than no courtesy.
      console.warn('house: person lookup failed:', err);
      if (token === personMatchToken) { personMatch = null; paintPersonMatch(); }
    });
}

/** Fill the EMPTY boxes from the registry. Never overwrites what is typed —
 *  the diff line above says what disagrees, and choosing between two spellings
 *  of a real person's name is a decision, not a merge. */
function usePersonData() {
  const p = personMatch;
  if (!p) return;
  for (const [key, , el] of PERSON_FILL_FIELDS) {
    const node = $(el);
    const known = String(p[key] || '').trim();
    if (!node || !known || String(node.value || '').trim()) continue;
    node.value = known;
  }
  updateCohortHint();
  paintYearChooser(null);
  paintPersonMatch();
}

function openStudentModal(id) {
  const s = id ? students.find((x) => x.id === id) : null;
  $('hsId').value = s?.id || '';
  $('hsFirst').value = s?.first_name_th || '';
  $('hsLast').value = s?.last_name_th || '';
  $('hsNick').value = s?.nickname_self || s?.nickname_imported || '';
  $('hsSid').value = s?.student_id || '';
  $('hsMail').value = s?.kkumail || '';
  // Chooser, not free text — the same three codes ทีม SAMO manages. An off-list
  // value already stored is kept as its own option so saving an unrelated field
  // cannot silently rewrite it.
  const cur = s?.major || '';
  const known = majors.some((m) => m.code === cur);
  $('hsMajor').innerHTML = '<option value="">— ไม่ระบุ —</option>'
    + majors.map((m) => `<option value="${escHtml(m.code)}"${m.code === cur ? ' selected' : ''}>${
  escHtml(m.label ? `${m.code} — ${m.label}` : m.code)}</option>`).join('')
    + (cur && !known ? `<option value="${escHtml(cur)}" selected>${escHtml(cur)} (ไม่อยู่ในรายการ)</option>` : '');
  $('hsSai').value = s?.sai_code || '';

  $('hsDelete').classList.toggle('d-none', !s);
  updateHouseHint();
  updateCohortHint();
  paintYearChooser(s);
  // RESET the banner on every open, and bump the token with it. One modal
  // element serves every row; a match left over from the previous person would
  // otherwise sit there claiming this address belongs to somebody else.
  personMatchToken += 1;
  personMatch = null;
  paintPersonMatch();
  // …then look up immediately for an EDIT too. It is how a row whose kkumail was
  // typed wrong, and therefore never linked to the registry, becomes visible.
  if (s?.kkumail) lookupPerson();
  modalInstance('houseStudentModal')?.show();
}

/**
 * The ชั้นปี chooser — shows years, saves the DIFFERENCE.
 *
 * Same rule and same wording as the student's own card: the admin picks "ปี 4",
 * the app stores `picked − computed`, and the row stays right in every later
 * August with nobody editing it. A stored ชั้นปี (`year_override`, dropped in
 * 0129) is right once and wrong thereafter.
 *
 * Repainted whenever the รหัสนักศึกษา changes, because the รหัส IS the base —
 * leaving a stale "ตามที่ระบบคำนวณ (ปี 5)" next to a รหัส that now computes to
 * ปี 2 would make the admin store a −3 they never intended.
 */
function paintYearChooser(s) {
  const sel = $('hsYear');
  const hint = $('hsYearHint');
  if (!sel) return;
  // The รหัส as it stands IN THE FORM, not as stored: the same save may be
  // changing it, and 0128 re-derives cohort_year from the new value.
  const typed = ($('hsSid')?.value || '').trim();
  const basis = { student_id: typed };
  const computed = studyYear({ ...basis, year_offset: 0 });
  if (computed === null) {
    sel.innerHTML = '<option value="">— ไม่มีรหัสนักศึกษา —</option>';
    sel.disabled = true;
    if (hint) { hint.className = 'form-text'; hint.textContent = 'ใส่รหัสนักศึกษาแล้วระบบจะคำนวณชั้นปีให้'; }
    return;
  }
  sel.disabled = false;
  // The offset only carries over while the รหัส is unchanged — a different
  // person's รหัส makes the stored gap meaningless.
  const off = typed === (s?.student_id || '') ? (s?.year_offset ?? null) : null;
  const current = studyYear({ ...basis, year_offset: off });
  sel.innerHTML = `<option value=""${off ? '' : ' selected'}>ตามที่ระบบคำนวณ (ปี ${computed})</option>`
    + [1, 2, 3, 4, 5, 6].map((y) => `<option value="${y}"${
      y === current ? ' selected' : ''}>ปี ${y}</option>`).join('');
  if (hint) {
    hint.className = 'form-text';
    hint.textContent = off
      ? 'ปรับไว้เอง — ระบบจะเลื่อนชั้นปีให้ตามส่วนต่างนี้ทุกปี'
      : 'เลื่อนให้อัตโนมัติทุกสิงหาคม เลือกเองเฉพาะกรณีลาพัก/เรียนซ้ำ';
  }
}

/**
 * รุ่น, as the รหัสนักศึกษา is typed.
 *
 * REPORTED: "when i change student id to 59xxxxxxxx or 64xxxxxxxx it doesn't
 * change the รุ่น". The real fault was in the database — `students_fill_cohort`
 * filled `cohort_year` only while it was null, so a corrected รหัส was outvoted
 * by the รุ่น of the previous one forever (fixed in 0128, proven by
 * tools/house0128-cohort.mjs). This hint is the other half: the รุ่น is derived
 * from a box two rows up, and showing it where it is derived is what makes a
 * wrong one visible BEFORE saving rather than after.
 */
function updateCohortHint() {
  const hint = $('hsCohortHint');
  if (!hint) return;
  const raw = ($('hsSid')?.value || '').trim();
  if (!raw) { hint.textContent = ' '; hint.className = 'form-text'; return; }
  const label = cohortLabel({ student_id: raw });
  if (label) {
    hint.className = 'form-text';
    hint.textContent = `รุ่น ${label} (คำนวณจากสองหลักแรก)`;
  } else {
    hint.className = 'form-text text-warning';
    hint.textContent = 'อ่านรุ่นจากรหัสนี้ไม่ได้ — จะไม่มีรุ่นแสดง';
  }
}

function updateHouseHint() {
  const hint = $('hsHouseHint');
  if (!hint) return;
  const n = normalizeSai($('hsSai')?.value);
  if (!n.value) { hint.textContent = ' '; return; }
  if (!n.ok) { hint.textContent = 'สายรหัสไม่ถูกต้อง'; hint.className = 'form-text text-danger'; return; }
  const h = houseOf(n.value);
  hint.className = 'form-text';
  hint.textContent = `สาย ${n.value} → ${houseName(h)}`;
}

async function onStudentSubmit(e) {
  e.preventDefault();
  const id = $('hsId').value;
  const sai = normalizeSai($('hsSai').value);
  if (!sai.ok) { alert(saiProblem($('hsSai').value) || 'สายรหัสไม่ถูกต้อง'); return; }
  const sid = normalizeStudentId($('hsSid').value);
  const payload = {
    // Nullable since 0126 — an imported row may legitimately have no name yet.
    first_name_th: $('hsFirst').value.trim() || null,
    last_name_th: $('hsLast').value.trim() || null,
    student_id: sid.value,
    kkumail: $('hsMail').value.trim().toLowerCase(),
    major: $('hsMajor').value.trim() || null,
    sai_code: sai.value,
  };
  // An admin editing the row by hand is writing the person's REAL nickname, so
  // it goes to the imported slot (the student's own nickname_self still wins if
  // they ever set one — that precedence is the whole point of the pair).
  payload.nickname_imported = $('hsNick').value.trim() || null;
  // ชั้นปี → the GAP, measured against the รหัส being SAVED (0131). Sending a
  // year here instead would put a second implementation of the derivation on
  // the server and rot the row every August.
  const picked = $('hsYear')?.value;
  payload.year_offset = picked
    ? offsetForPickedYear({ student_id: sid.value }, picked)
    : null;
  // THE PRE-CHECK. Refuse a create onto an address that already has a house
  // placement, in words that name the person rather than an index. It is a
  // courtesy, not the guarantee — see the catch below.
  if (!id && personMatch?.in_house) {
    const row = houseRowForPerson(personMatch);
    alert(`อีเมล ${payload.kkumail} เป็นของ ${personMatch.full_name || 'นักศึกษาคนหนึ่ง'} ซึ่งมีข้อมูลในระบบบ้านอยู่แล้ว`
      + (row ? ` (สาย ${row.sai_code || '—'})` : '')
      + '\n\nถ้าต้องการแก้ไขข้อมูลของคนนี้ ให้กด “เปิดข้อมูลคนนี้” ในกล่องด้านบน '
      + 'ถ้าเป็นคนละคน กรุณาตรวจสอบอีเมลอีกครั้ง');
    $('hsMail')?.focus();
    return;
  }
  try {
    if (id) await updateStudent(id, payload);
    else await createStudent(payload);
    modalInstance('houseStudentModal')?.hide();
    await reload();
  } catch (err) { alert(duplicateMessage(err, payload) || err?.message || 'บันทึกไม่สำเร็จ'); }
}

// duplicateMessage moved to ../duplicate-message.js — three OTHER write paths
// (เพิ่มอาจารย์ twice, เพิ่มสาขา) were still alerting the raw 23505 this was
// written to replace, and a translator that only one caller can reach is the
// "fix on one path" shape. Re-exported so house/duplicate-message.test.js and
// every existing importer keep working unchanged.
// Imported AND re-exported: a bare `export { x } from` does not bind the name
// in this module's scope, and two call sites below use it.
import { duplicateMessage } from '../duplicate-message.js';

export { duplicateMessage };


/**
 * Say which of the TWO deletes this is.
 *
 * Deleting a นักศึกษา does one of two very different things and the dialog used
 * to say the same sentence for both:
 *
 *   • the person also holds a ทีม SAMO ตำแหน่ง → only the house placement goes.
 *     Their name, รหัส, รูป, ตำแหน่ง and สิทธิ์ are untouched, because
 *     team_members.person_id is ON DELETE SET NULL and the registry row is only
 *     pruned when NO placement of any kind is left.
 *   • house-only, never signed in, never confirmed → their public.people row is
 *     pruned too and the person is gone from the system entirely. After the
 *     1,800-row import that is nearly everyone.
 *
 * The คำขอแก้ไข count is named because those CASCADE — the student's questions
 * and the admin's answers go with the row, and that is not obvious from "ลบ".
 */
export function deleteWarningFor(impact) {
  const base = 'ข้อมูลบ้าน สายรหัส และสิ่งที่นักศึกษาคนนี้กรอกเองจะหายไปทั้งหมด';
  // No answer from the server: keep the old, cautious wording rather than
  // guessing. A wrong reassurance is worse than a vague one.
  if (!impact) return base;

  const bits = [base];
  const reqs = Number(impact.pending_requests) || 0;
  if (reqs) bits.push(`รวมถึงคำขอแก้ไข ${reqs} รายการ และคำตอบของผู้ดูแล`);

  if (Number(impact.team_postings) > 0) {
    bits.push(impact.team_nodes
      ? `ยังอยู่ในทีม SAMO (${impact.team_nodes}) — ตำแหน่ง ชื่อ และรูปในทีม SAMO จะไม่ถูกลบ`
      : 'ยังอยู่ในทีม SAMO — ตำแหน่ง ชื่อ และรูปในทีม SAMO จะไม่ถูกลบ');
  } else if (impact.person_will_be_pruned) {
    bits.push('คนนี้ไม่ได้อยู่ในทีม SAMO และยังไม่เคยเข้าสู่ระบบ '
      + 'ข้อมูลตัวตนจะถูกลบออกจากระบบทั้งหมด กู้คืนไม่ได้');
  } else if (impact.signed_in || impact.identity_confirmed) {
    bits.push('คนนี้เคยเข้าสู่ระบบแล้ว ข้อมูลตัวตนจะยังอยู่ '
      + 'แต่จะไม่มีข้อมูลบ้านอีกต่อไป');
  }
  return bits.join(' · ');
}

async function onStudentDelete() {
  const id = $('hsId').value;
  const s = students.find((x) => x.id === id);
  if (!s) return;
  // Asked BEFORE the dialog so the sentence is right the first time. Awaiting a
  // lookup here is safe: askDelete is app-drawn, so a slow reply delays the
  // dialog rather than losing it the way a suppressed native confirm would.
  const impact = await fetchDeleteImpact(id);
  if (!await askDelete(s.full_name || s.kkumail, deleteWarningFor(impact))) return;
  try {
    await deleteStudent(id);
    modalInstance('houseStudentModal')?.hide();
    await reload();
  } catch (err) { alert(err?.message || 'ลบไม่สำเร็จ'); }
}

// ---------- house editor ----------
let houseIconUrl = null;
// A picked-but-not-yet-uploaded crest: { file, previewUrl }. Upload on SAVE.
let housePendingIcon = null;
function openHouseModal(id) {
  const h = houseById(id);
  if (!h) return;
  $('heId').value = String(h.id);
  $('heTitle').textContent = `แก้ไข${houseLabel(h.id, h.name)}`;
  $('heName').value = h.name || '';
  $('heSlogan').value = h.slogan || '';
  $('heColor').value = h.color || '#105922';
  houseIconUrl = h.icon_url || null;
  clearHousePendingIcon();     // a pick left over from the previous house
  paintHouseIcon();
  $('heIconFile').value = '';
  modalInstance('houseEditModal')?.show();
}

function paintHouseIcon() {
  const img = $('heIconPreview');
  const clear = $('heIconClear');
  if (!img) return;
  // A framed-but-unsent pick wins over the stored crest — it is what บันทึก is
  // about to upload, so it is what the admin must be looking at.
  if (housePendingIcon || houseIconUrl) {
    img.src = housePendingIcon
      ? housePendingIcon.previewUrl
      : convertDriveUrl(houseIconUrl, 200);
    img.classList.remove('d-none');
    clear?.classList.remove('d-none');
  } else {
    img.classList.add('d-none');
    clear?.classList.add('d-none');
  }
}

/**
 * Frame the crest. NOTHING IS UPLOADED HERE.
 *
 * This used to POST on the pick, which is the pattern this repo banned after it
 * left orphan portraits in Drive: every intermediate choice became a real file,
 * and picking twice — or picking once and then closing the editor — left files
 * nothing would ever reference and no cleanup could reach (the row never pointed
 * at them, so a reference count cannot tell them from a live photo).
 *
 * The bytes now leave in onHouseSubmit, next to the write that will point at
 * them.
 */
function onHouseIconPicked(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  if (housePendingIcon?.previewUrl) URL.revokeObjectURL(housePendingIcon.previewUrl);
  housePendingIcon = { file, previewUrl: URL.createObjectURL(file) };
  paintHouseIcon();
  setStatus('');
}

/** Drop a framed-but-unsent pick and free its object URL. */
function clearHousePendingIcon() {
  if (housePendingIcon?.previewUrl) URL.revokeObjectURL(housePendingIcon.previewUrl);
  housePendingIcon = null;
}

async function onHouseSubmit(e) {
  e.preventDefault();
  const id = Number($('heId').value);
  // The file the row is about to stop pointing at, captured before the upload.
  const prevIcon = String(houseById(id)?.icon_url || '').trim();
  try {
    if (housePendingIcon) {
      setStatus('กำลังอัปโหลดโลโก้…');
      // Filed under the existing Team tree so this needs NO Apps Script change
      // and no new OAuth scope — `uploadTeamFile` only requires the path to
      // start with "Team". A dedicated House folder would have meant a GAS
      // redeploy.
      const { url } = await uploadTeamPhoto(housePendingIcon.file, {
        year: '_House', dept: 'icons', order: id, name: `house-${id}`,
      });
      houseIconUrl = url;
      clearHousePendingIcon();
    }
    await updateHouse(id, {
      name: $('heName').value.trim() || null,
      slogan: $('heSlogan').value.trim() || null,
      color: $('heColor').value || null,
      icon_url: houseIconUrl,
    });
    setStatus('');
    modalInstance('houseEditModal')?.hide();
    // AFTER the write — the count is only the truth once the row has been
    // repointed. Replacing or clearing a crest used to leave the old file in
    // Drive forever, the same gap the ข้อมูลของฉัน card had.
    const retire = photoToRetire(prevIcon, { icon_url: houseIconUrl }, 'icon_url');
    if (retire) deleteTeamPhotoIfUnused(retire);
    await reload();
  } catch (err) {
    setStatus('');
    alert(err?.message || 'บันทึกไม่สำเร็จ');
  }
}

// ---------- advisor editor ----------
function openAdvisorModal(id) {
  const a = id ? advisors.find((x) => x.id === id) : null;
  $('haId').value = a?.id || '';
  $('haFirst').value = a?.first_name_th || '';
  $('haLast').value = a?.last_name_th || '';
  $('haEmail').value = a?.email || '';
  $('haDept').value = a?.dept || '';
  $('haSais').value = (a?.sai_advisors || []).map((l) => l.sai_code).sort().join(', ');
  $('haDelete').classList.toggle('d-none', !a);
  modalInstance('houseAdvisorModal')?.show();
}

async function onAdvisorSubmit(e) {
  e.preventDefault();
  const id = $('haId').value;
  const codes = [];
  for (const part of $('haSais').value.split(/[,\s]+/).filter(Boolean)) {
    const n = normalizeSai(part);
    if (!n.ok || !n.value) { alert(`สายรหัส “${part}”: ${saiProblem(part) || 'ไม่ถูกต้อง'}`); return; }
    if (!sais.some((s) => s.code === n.value)) { alert(`ไม่พบสาย ${n.value} ในระบบ`); return; }
    if (!codes.includes(n.value)) codes.push(n.value);
  }
  const payload = {
    first_name_th: $('haFirst').value.trim(),
    last_name_th: $('haLast').value.trim() || null,
    email: $('haEmail').value.trim().toLowerCase() || null,
    dept: $('haDept').value.trim() || null,
  };
  try {
    const row = id ? await updateAdvisor(id, payload) : await createAdvisor(payload);
    await setAdvisorSais(row.id, codes);
    modalInstance('houseAdvisorModal')?.hide();
    await reload();
  } catch (err) {
    alert(duplicateMessage(err, payload) || err?.message || 'บันทึกไม่สำเร็จ');
  }
}

async function onAdvisorDelete() {
  const id = $('haId').value;
  const a = advisors.find((x) => x.id === id);
  if (!a) return;
  if (!await askDelete(a.full_name, 'อาจารย์ท่านนี้จะถูกนำออกจากทุกสายที่ดูแลอยู่')) return;
  try {
    await deleteAdvisor(id);
    modalInstance('houseAdvisorModal')?.hide();
    await reload();
  } catch (err) { alert(err?.message || 'ลบไม่สำเร็จ'); }
}

// ---------- requests ----------
/**
 * Approve or reject one คำขอแก้ไข.
 *
 * REPORTED: "ปฏิเสธ doesn't work, อนุมัติ works." It didn't, and it had TWO
 * silent ways not to — the same pair that made the ทีม SAMO delete button look
 * dead. The reason was collected with `prompt()`, and then:
 *   • Chrome's "Prevent this page from creating additional dialogs" makes every
 *     later prompt() return null instantly, with no UI, for the life of the
 *     page — and the handler read null as "cancelled" and returned; and
 *   • pressing OK on an EMPTY box gives '', which `|| null` turned into null
 *     too, so an admin who had no particular reason also got nothing, and
 *     nobody had been told a reason was mandatory.
 * อนุมัติ worked because it never opened a dialog.
 *
 * The reason is now an ordinary input in the card: always visible, genuinely
 * optional, and impossible for the browser to suppress.
 */
async function onDecide(id, approve) {
  const r = requests.find((x) => x.id === id);
  if (!r) { setStatus('ไม่พบคำขอนี้แล้ว — กำลังโหลดใหม่', true); reload(); return; }
  const note = document.querySelector(`[data-req-note="${CSS.escape(id)}"]`)?.value.trim() || null;
  // What the admin will actually save. The box is pre-filled with what the
  // student asked for, so the common case is unchanged — but an admin who knows
  // the correct สาย no longer has to reject a nearly-right request and wait for
  // the student to file a better one. Falls back to requested_value if the box
  // is missing, so this cannot become a way to approve a blank.
  const typed = document.querySelector(`[data-req-value="${CSS.escape(id)}"]`)?.value;
  const chosen = (typed === undefined || typed === null ? r.requested_value : typed);
  try {
    if (approve) {
      // Apply the change first; only mark it approved if the write landed. The
      // other order would leave a request stamped "approved" whose edit never
      // happened, which is worse than a request that has to be redone.
      const patch = {};
      let applied = String(chosen ?? '').trim() || null;
      if (r.field === 'cohort_year') patch[r.field] = Number(applied) || null;
      else patch[r.field] = applied;
      if (r.field === 'sai_code') {
        // Only the SHAPE is checked here. Whether a `sais` row exists is not our
        // business: 0122 put "create the สาย on demand" on the students table as
        // a trigger, so any valid 001–999 code lands. Refusing an unseen code
        // here was a per-caller rule contradicting the table's own — the exact
        // shape 0122 exists to stop — and it dead-ended the admin with
        // "แก้ไขไม่ได้" and no way forward.
        const n = normalizeSai(applied);
        if (!n.ok || !n.value) {
          alert(`สายรหัส “${applied ?? ''}”: ${saiProblem(applied) || 'ไม่ถูกต้อง'}`);
          return;
        }
        patch.sai_code = n.value;
        applied = n.value;
      }
      await updateStudent(r.student_ref, patch);
      // Recorded ONLY when it differs from what was asked. A row that says
      // "approved" while the card shows a different สาย is a request whose
      // answer is a lie by omission; a row that repeats the requested value
      // back is noise.
      await decideRequest(id, 'approved', note, getUser()?.id,
        applied !== (r.requested_value || null) ? applied : null);
    } else {
      await decideRequest(id, 'rejected', note, getUser()?.id, null);
    }
    await reload();
  } catch (err) { alert(err?.message || 'ดำเนินการไม่สำเร็จ'); }
}

// ============================================================
// EXPORT
// ============================================================
function exportCsv() {
  if (!students.length) { alert('ยังไม่มีข้อมูลให้ส่งออก'); return; }
  const csv = buildStudentsCsv(students);
  // BOM: Excel opens a UTF-8 CSV as mojibake without it, and this file is full
  // of Thai names.
  const blob = new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `samo-house-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Close one held row — either by giving it the address it was missing, or by
 * saying it is not a student we will ever have.
 *
 * THE WHOLE POINT OF `reload()` AT THE END, rather than patching `held` in
 * place. A promote writes a `students` row, so the students list, the per-house
 * counts and the overview are all stale the moment it succeeds — and the
 * cheapest wrong version of this function is the one that updates the row it can
 * see and leaves four other panes disagreeing with the database.
 */
async function onHeldAction(id, act, tr) {
  const row = held.find((h) => h.id === id);
  if (!row) { setStatus('ไม่พบรายการนี้แล้ว — กำลังโหลดใหม่', true); reload(); return; }
  const who = [row.first_name_th, row.last_name_th].filter(Boolean).join(' ') || 'รายการนี้';

  try {
    if (act === 'promote') {
      const mail = (tr.querySelector('[data-held-mail]')?.value || '').trim().toLowerCase();
      if (!mail) { setStatus('กรอก kkumail ของคนนี้ก่อน', true); return; }
      // Warned, NOT refused. The spec asks for @kkumail.com and an address at
      // any other domain will never match a login — but an admin filling this in
      // by hand may be recording the only address anyone has, and refusing it
      // would leave the row held for ever with no way to say so.
      const offDomain = !/@kkumail\.com$/.test(mail);
      const ok = await askConfirm({
        title: `เพิ่ม ${who} เข้าระบบบ้าน?`,
        body: `จะสร้างข้อมูลนักศึกษาด้วยอีเมล ${mail}`
          + (row.sai ? ` · สาย ${row.sai} · บ้าน ${row.house ?? '—'}` : ' · ยังไม่มีสายรหัส')
          + (offDomain ? '\n\nอีเมลนี้ไม่ใช่ @kkumail.com — เจ้าตัวจะเข้าสู่ระบบแล้วไม่เห็นข้อมูลตัวเอง' : ''),
        yes: 'เพิ่ม',
        danger: offDomain,
      });
      if (!ok) return;
      await promoteUnresolved(id, mail);
      setStatus(`เพิ่ม ${who} แล้ว`);
    } else if (act === 'dismiss') {
      const note = (tr.querySelector('[data-held-note]')?.value || '').trim();
      // Said HERE as well as in the RPC, because the RPC's raise arrives as a
      // red banner after a round trip and this one arrives beside the empty box.
      if (!note) { setStatus('กรอกเหตุผลที่ปิดรายการนี้ก่อน', true); return; }
      const ok = await askConfirm({
        title: `ปิดรายการของ ${who}?`,
        body: 'จะไม่สร้างข้อมูลนักศึกษาให้ และรายการจะหายไปจากรายการค้าง '
          + 'ถ้าไฟล์รอบหน้ามีชื่อคนนี้พร้อม kkumail ระบบจะนำเข้าให้ตามปกติ',
        yes: 'ปิดรายการ',
      });
      if (!ok) return;
      await dismissUnresolved(id, note);
      setStatus(`ปิดรายการของ ${who} แล้ว`);
    }
    await reload();
  } catch (err) {
    setStatus(err?.message || 'ทำรายการไม่สำเร็จ', true);
  }
}

// ============================================================
// WIRING
// ============================================================
function wire() {
  document.querySelectorAll('[data-house-mode]').forEach((btn) => {
    btn.addEventListener('click', () => { mode = btn.dataset.houseMode; render(); });
  });
  $('houseReload')?.addEventListener('click', () => reload());
  $('houseExportCsv')?.addEventListener('click', exportCsv);

  // `input` on all of them, not `change`: the three combobox filters are text
  // boxes, and `change` on a text box fires on BLUR — so a typed filter would
  // do nothing until you clicked somewhere else.
  ['houseSearch', 'houseFilterYear', 'houseFilterMajor', 'houseFilterSai'].forEach((id) => {
    $(id)?.addEventListener('input', renderStudents);
  });
  $('houseFilterHouse')?.addEventListener('change', renderStudents);
  $('houseClearFilters')?.addEventListener('click', () => {
    ['houseSearch', 'houseFilterHouse', 'houseFilterYear', 'houseFilterMajor', 'houseFilterSai']
      .forEach((id) => { const el = $(id); if (el) el.value = ''; });
    renderStudents();
  });
  $('houseAddStudent')?.addEventListener('click', () => openStudentModal(null));
  $('houseStudentRows')?.addEventListener('click', (e) => {
    const tr = e.target.closest('[data-student]');
    if (tr) openStudentModal(tr.dataset.student);
  });
  $('houseStudentForm')?.addEventListener('submit', onStudentSubmit);
  $('hsDelete')?.addEventListener('click', onStudentDelete);
  $('hsSai')?.addEventListener('input', updateHouseHint);
  $('hsSid')?.addEventListener('input', () => {
    updateCohortHint();
    // The รหัส is the base the offset is measured from, so the chooser has to
    // follow it — a stale "ตามที่ระบบคำนวณ (ปี 5)" beside a รหัส that now says
    // ปี 2 would store a −3 nobody chose.
    paintYearChooser(students.find((x) => x.id === $('hsId').value) || null);
  });

  // ── "this person already exists" ────────────────────────────────────────
  // Debounced on `input`, and immediate on `change` (blur / paste / autofill),
  // because the address is usually pasted whole and waiting 400 ms after a paste
  // reads as the banner not working. Wired ONCE here, on elements the modal
  // markup owns for the life of the page — not per open, which is how a
  // delegated listener re-attached on every render ends up firing N times.
  let mailTimer = null;
  $('hsMail')?.addEventListener('input', () => {
    clearTimeout(mailTimer);
    mailTimer = setTimeout(lookupPerson, 400);
  });
  $('hsMail')?.addEventListener('change', () => {
    clearTimeout(mailTimer);
    lookupPerson();
  });
  // The diff line compares the registry against what is TYPED, so it has to be
  // repainted when the typing changes — otherwise it keeps reporting a
  // disagreement the admin has just resolved.
  ['hsFirst', 'hsLast', 'hsNick', 'hsSid', 'hsMajor'].forEach((el) => {
    $(el)?.addEventListener('change', paintPersonMatch);
  });
  $('hsPersonMatch')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-house-act]');
    if (!btn) return;
    if (btn.dataset.houseAct === 'use-person') usePersonData();
    // Switch the modal to the row that already exists. Re-opening rather than
    // navigating keeps one code path for "show me this นักศึกษา".
    if (btn.dataset.houseAct === 'open-existing') openStudentModal(btn.dataset.id);
  });

  $('houseCards')?.addEventListener('click', (e) => {
    const card = e.target.closest('[data-house-edit]');
    if (card) openHouseModal(Number(card.dataset.houseEdit));
  });
  $('houseEditForm')?.addEventListener('submit', onHouseSubmit);
  $('heIconFile')?.addEventListener('change', onHouseIconPicked);
  $('heIconClear')?.addEventListener('click', () => {
    clearHousePendingIcon(); houseIconUrl = null; paintHouseIcon();
  });
  $('heReset')?.addEventListener('click', () => {
    $('heName').value = ''; $('heSlogan').value = '';
    clearHousePendingIcon(); houseIconUrl = null; paintHouseIcon();
  });

  // สายรหัส pane — filters, and the สาย-first อาจารย์ modal.
  // ── ยังนำเข้าไม่ได้
  $('houseHeldSearch')?.addEventListener('input', (e) => {
    heldQuery = e.target.value; renderHeld();
  });
  $('houseHeldShowDone')?.addEventListener('change', (e) => {
    heldShowDone = e.target.checked; renderHeld();
  });
  // Delegated from the TBODY, which this module owns and never replaces — only
  // its innerHTML changes — so exactly one listener exists for the life of the
  // page. Attaching per row instead would add a listener per render, which is
  // the "fires once, then twice, then three times" bug wireCard documents.
  $('houseHelpRows')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-help-act]');
    if (!btn) return;
    const tr = btn.closest('[data-help-id]');
    const note = tr?.querySelector('[data-help-note]')?.value.trim();
    if (!note) { setStatus('บันทึกสั้น ๆ ก่อนว่าทำอะไรไป', true); return; }
    try {
      await resolveHelpRequest(tr.dataset.helpId, note);
      setStatus('ปิดรายการแล้ว');
      await reload();
    } catch (err) { setStatus(err?.message || 'ปิดรายการไม่สำเร็จ', true); }
  });

  $('houseHeldRows')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-held-act]');
    if (!btn) return;
    const tr = btn.closest('[data-held-id]');
    if (tr) onHeldAction(tr.dataset.heldId, btn.dataset.heldAct, tr);
  });

  $('houseSaiSearch')?.addEventListener('input', renderSais);
  $('houseSaiFilterHouse')?.addEventListener('change', renderSais);
  $('houseSaiOnlyEmpty')?.addEventListener('change', renderSais);
  $('houseSaiGroups')?.addEventListener('click', (e) => {
    const card = e.target.closest('[data-sai]');
    if (card) openSaiModal(card.dataset.sai);
  });
  // Type-to-search repaints only the RESULT LIST, never the whole modal — a
  // full repaint would replace the input the admin is typing in.
  $('hxPick')?.addEventListener('input', () => paintSaiPickList($('hxCode').value));
  $('hxPickList')?.addEventListener('click', (e) => {
    const row = e.target.closest('[data-pick-advisor]');
    if (row) onSaiAddAdvisor(row.dataset.pickAdvisor, row);
  });
  $('hxAdvisors')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-sai-remove]');
    if (btn) onSaiRemoveAdvisor(btn.dataset.saiRemove);
  });
  $('hxNewToggle')?.addEventListener('click', () => toggleSaiNewAdvisor());
  $('hxNewCancel')?.addEventListener('click', () => toggleSaiNewAdvisor(false));
  $('hxNewForm')?.addEventListener('submit', onSaiCreateAdvisor);

  $('houseAdvisorSearch')?.addEventListener('input', renderAdvisors);
  $('houseAddAdvisor')?.addEventListener('click', () => openAdvisorModal(null));
  $('houseAdvisorRows')?.addEventListener('click', (e) => {
    const tr = e.target.closest('[data-advisor]');
    if (tr) openAdvisorModal(tr.dataset.advisor);
  });
  $('houseAdvisorForm')?.addEventListener('submit', onAdvisorSubmit);
  $('haDelete')?.addEventListener('click', onAdvisorDelete);

  $('houseRequestRows')?.addEventListener('click', (e) => {
    const ok = e.target.closest('[data-req-approve]');
    const no = e.target.closest('[data-req-reject]');
    if (ok) onDecide(ok.dataset.reqApprove, true);
    else if (no) onDecide(no.dataset.reqReject, false);
  });
  // Delegated, because the value boxes are recreated on every renderRequests().
  // The hint must not repaint the whole pane — that would destroy the box the
  // admin is typing in ("a shared render() that repaints a pane another module
  // owns", in miniature).
  $('houseRequestRows')?.addEventListener('input', (e) => {
    const box = e.target.closest('[data-req-value]');
    if (box) paintRequestHouseHint(box.dataset.reqValue);
  });
  $('houseReqSearch')?.addEventListener('input', renderRequests);
  $('houseReqStatusNav')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-req-status]');
    if (!btn) return;
    reqStatus = btn.dataset.reqStatus;
    renderRequests();
  });

  $('houseCsvFile')?.addEventListener('change', onCsvPicked);

}

