// ==============================================
// "บ้านของฉัน" — what a signed-in student sees on the home page.
//
// Mirrors my-seat.js in shape and for the same reason: one SECURITY DEFINER RPC
// that takes NO argument (identity comes from auth.uid()), so this module cannot
// be pointed at anyone else and cannot become a directory lookup. Every field it
// renders is the caller's own, or an อาจารย์ named in their capacity as
// อาจารย์ที่ปรึกษา of a สาย in their house. It lists NO other student.
//
// IT ALSO MIRRORS my-seat.js VISUALLY, ON PURPOSE. Both cards answer "here is
// my record" to the same person on the same screen, so they share the `myseat-*`
// stylesheet rather than growing a second set of nearly-identical rules that
// drift apart. my-house.css adds only what is genuinely house-specific (the
// crest, the house accent colour and the อาจารย์ lists).
//
// WHAT IT HAS TO SURVIVE
//   • No data at all. The ~1,800-row import may land weeks after this ships, so
//     a student who is not in the table yet gets NO card — not an error, not an
//     empty skeleton. That is the overwhelmingly common case at launch.
//   • A house with no name. Until someone names บ้าน 3 it renders as "บ้าน 3".
//     There is no reveal flag: an unnamed house IS the not-yet-revealed state.
//   • Being re-rendered. renderMyHouse() runs on every auth event, and it used
//     to add a DELEGATED listener to `host` each time while the buttons only
//     toggled `d-none` — so after two paints every click toggled twice and the
//     panel stayed shut. Reported as "I need to click many times and sometimes
//     it will appear". Listeners now go on the nodes THIS paint created, which
//     the next `innerHTML =` throws away with them.
//
// รุ่น AND ชั้นปี, and neither is stored as a display value. รุ่น (MD50) is fixed
// at admission and read off the รหัสนักศึกษา; ชั้นปี is COMPUTED from it every
// time it is rendered (0131). What the student may store is `year_offset` — the
// GAP, for ลาพัก / เรียนซ้ำ / จบช้า — which stays correct in every later year
// with no maintenance. A stored ชั้นปี would be right for one August and
// silently wrong every August after, which is why 0123 removed it and 0129
// dropped the column; this is the same conclusion with the durable shape.
//
// NO ยืนยันข้อมูล, still: it collected a timestamp nobody was ever going to act
// on, and 0123 removed it from the RPCs so no caller can put it back.
// ==============================================
import { escHtml } from '../utils.js';
import { convertDriveUrl } from '../uploads.js';
import { registerProfileCache, clearProfileCaches } from '../profile-cache.js';
import {
  fetchMyStudentRecord, saveMyStudentRecord, requestMyChange, fetchMajors,
  claimMySeat, reportNotMyRecord,
} from './api.js';
import {
  houseLabel, normalizeSai, cohortLabel, normalizeStudentId, saiProblem, safeColor,
  studyYear, studyYearLabel, offsetForPickedYear,
} from './fields.js';

// Cached per signed-in uid, so an in-place account switch cannot show the
// previous person's house (the module-scope-cache trap in mistakes.md).
let cacheUid = null;
let cachePromise = null;

registerProfileCache(() => { cacheUid = null; cachePromise = null; });

export function clearMyHouseCache() {
  cacheUid = null;
  cachePromise = null;
}

export function loadMyHouse(uid) {
  if (!uid) return Promise.resolve(null);
  if (cacheUid === uid && cachePromise) return cachePromise;
  cacheUid = uid;
  cachePromise = fetchMyStudentRecord()
    .then((rec) => (rec && rec.kkumail ? rec : null))
    .catch((err) => {
      // Not in the table yet is the normal case before the import — never noisy.
      console.warn('my-house: lookup failed:', err);
      return null;
    });
  return cachePromise;
}

// ── the record, as label → value ───────────────────────────────────────────
//
// The same "ชื่อ … รหัสนักศึกษา …" list ตำแหน่งของฉันในทีม SAMO uses, because a
// person reading two cards about themselves should not have to learn two
// layouts. `self` marks what the student may change here.
//
// WHAT IS NOT `self`, AND WHY IT IS EXACTLY TWO THINGS.
//   • รุ่น is DERIVED from the รหัสนักศึกษา above it — editing it separately would
//     be editing a calculation.
//   • สายรหัส is the university's own advisor assignment, and it decides the
//     house. It is the one field with an incentive to abuse, so nobody edits
//     their own: แจ้งข้อมูลไม่ถูกต้อง files a request and an admin approves.
//     Enforced in `update_my_student_record` (0125), not just hidden here.
//
// A re-import will NOT overwrite what the student edited — `students.self_edited`
// plus a trigger on the table guarantee that (0125), which is what makes
// offering these fields safe in the first place.
export const HOUSE_DETAIL_FIELDS = [
  { key: 'full_name', label: 'ชื่อ-สกุล', wide: true, self: true },
  { key: 'nickname', label: 'ชื่อเล่น', self: true },
  { key: 'student_id', label: 'รหัสนักศึกษา', self: true },
  { key: 'cohort', label: 'รุ่น', value: (r) => cohortLabel(r) },
  // ชั้นปี is DERIVED from the รหัส above plus `year_offset`, never stored as a
  // number (0131) — a stored ชั้นปี is right for one August and silently wrong
  // every August after. `self` because ลาพัก / เรียนซ้ำ is the person's own fact
  // and only they know it; what the chooser saves is the GAP, not the year.
  { key: 'study_year', label: 'ชั้นปี', value: (r) => studyYearLabel(r), self: true },
  { key: 'major', label: 'สาขา', self: true },
  { key: 'sai', label: 'สายรหัส' },
  { key: 'house', label: 'บ้าน', value: (r) => (r.house_id === null || r.house_id === undefined
    ? '' : houseLabel(r.house_id, r.house_name)) },
  { key: 'kkumail', label: 'KKU Mail', wide: true },
];

/**
 * What a student can ASK an admin to change — exactly one thing.
 *
 * `request_my_change`'s server-side allow-list is wider (six fields, migration
 * 0116) and stays that way; this is the UI's subset. Since 0125 a student edits
 * their own ชื่อ · นามสกุล · ชื่อเล่น · รหัสนักศึกษา · สาขา directly, and รุ่น is
 * derived from the รหัส they just edited — so offering those as REQUESTS too
 * would route work to an admin that the person could have finished themselves.
 * สายรหัส is the only field left that they may not touch.
 */
export const REQUESTABLE_FIELDS = [
  { field: 'sai_code', label: 'สายรหัส' },
];

/**
 * Which detail rows this card is responsible for.
 *
 * REPORTED: "ตำแหน่งของฉันในทีม SAMO and บ้านของฉัน show similar information two
 * times". They did — ชื่อ-สกุล, ชื่อเล่น, รหัสนักศึกษา, ชั้นปี and สาขา appeared on
 * both cards, to the same person, on the same screen, with two separate edit
 * forms writing two different tables. That is the duplication 0132 removed from
 * the DATABASE; this removes it from the screen.
 *
 * When the person also holds a ทีม SAMO posting, the card above already shows
 * their identity, so this one shows only what is genuinely house-specific:
 * รุ่น (the cohort the สาย and บ้าน hang off), สายรหัส and บ้าน. Identity edits
 * happen once, up there, and reach both systems through update_my_identity.
 *
 * When they do NOT hold a posting — the common case for a student — this card
 * is the only one on screen and carries everything.
 */
const HOUSE_ONLY_KEYS = new Set(['cohort', 'sai', 'house']);

function detailsHtml(rec, opts = {}) {
  const fields = opts.identityShownAbove
    ? HOUSE_DETAIL_FIELDS.filter((f) => HOUSE_ONLY_KEYS.has(f.key))
    : HOUSE_DETAIL_FIELDS;
  const rows = fields.map((f) => {
    const v = String((f.value ? f.value(rec) : rec[f.key]) ?? '').trim();
    return `<div class="myseat-detail${v ? '' : ' is-empty'}${f.wide ? ' is-wide' : ''}">
      <dt>${escHtml(f.label)}</dt>
      <dd>${v ? escHtml(v) : '<span class="myseat-missing">ยังไม่มีข้อมูล</span>'}</dd>
    </div>`;
  }).join('');
  return `<dl class="myseat-details">${rows}</dl>`;
}

function crestHtml(rec) {
  if (rec.house_id === null || rec.house_id === undefined) {
    return '<div class="myhouse-crest myhouse-crest--none" aria-hidden="true"><i class="bi bi-question-lg"></i></div>';
  }
  if (rec.house_icon) {
    return `<img class="myhouse-crest" src="${escHtml(convertDriveUrl(rec.house_icon, 200))}"
                 alt="" loading="lazy" />`;
  }
  return `<div class="myhouse-crest myhouse-crest--plain" aria-hidden="true">${rec.house_id}</div>`;
}

/**
 * One อาจารย์ line. `tag` carries their สาย when the list spans several.
 *
 * NAME, then ภาควิชา and สาย as quiet tags, then the address on its own line as
 * a real `mailto:` link. The address is the point of the list: a student who
 * needs to reach their อาจารย์ที่ปรึกษา was previously shown a name and left to
 * find the rest themselves. No คำนำหน้า field any more (0128) — a title that
 * belongs to the person is inside `name`.
 */
function advisorLi(a, tag) {
  const email = String(a.email || '').trim();
  return `<li>
      <i class="bi bi-person-badge" aria-hidden="true"></i>
      <span>${escHtml(a.name || '')}${
  tag ? `<em>${escHtml(tag)}</em>` : ''}${
  a.dept ? `<em>${escHtml(a.dept)}</em>` : ''}${
  email ? `<a class="myhouse-advisor-mail" href="mailto:${escHtml(email)}">${escHtml(email)}</a>` : ''}</span>
    </li>`;
}

// ── what happened to the คำขอ I filed ──────────────────────────────────────
const REQUEST_FIELD_LABEL = {
  sai_code: 'สายรหัส', student_id: 'รหัสนักศึกษา', kkumail: 'kkumail',
  first_name_th: 'ชื่อจริง', last_name_th: 'นามสกุล', major: 'สาขา',
  cohort_year: 'ปีที่เข้า',
};

const REQUEST_STATUS = {
  pending: { label: 'กำลังรอผู้ดูแลตรวจสอบ', cls: 'is-pending', icon: 'bi-hourglass-split' },
  approved: { label: 'อนุมัติแล้ว', cls: 'is-approved', icon: 'bi-check2-circle' },
  rejected: { label: 'ไม่อนุมัติ', cls: 'is-rejected', icon: 'bi-x-circle' },
};

function requestDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? ''
    : d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * The status of the caller's own คำขอแก้ไข.
 *
 * REPORTED: "the reason admin type doesn't get shown for the user, also the
 * status that admin reject or accept doesn't get shown to the user". It didn't,
 * and there was no way it could: `student_change_requests` is admin-only under
 * RLS and nothing published it back. The admin was typing into a box with no
 * reader — the worst kind of broken, because it looks like it works from the
 * only side anyone was checking.
 *
 * `my_requests` now travels inside `get_my_student_record()` (0128), which is
 * already the caller's own record and resolves the student from auth.uid(), so
 * this needed no new policy and no new address to probe.
 *
 * `applied_value` is shown ONLY when it differs from what was asked. An admin
 * may approve a สายรหัส request with a corrected value, and "อนุมัติแล้ว" next
 * to a card showing a third สาย is the confusing case this exists to prevent.
 */
/**
 * A collapsed section: a label that is also the toggle, and a count.
 *
 * ⚠️ `<details>`, NOT A BUTTON AND A CLASS. This exact card already shipped the
 * bug that hand-rolling it produces: a delegated listener re-attached to the
 * surviving host on every render, whose handler `toggle`d `d-none`, so the panel
 * opened only on odd-numbered paints — reported as "แก้ไขข้อมูล ของระบบบ้าน —
 * ต้องกดหลายครั้งถึงจะขึ้น". `<details>` has no listener to duplicate, no state
 * for a re-render to desynchronise, keyboard and screen-reader behaviour for
 * free, and it still works if the JS that would have wired it never ran.
 *
 * @param {boolean} open  whether it starts expanded
 */
function disclosure(label, count, bodyHtml, open = false) {
  return `<details class="myhouse-fold myseat-block"${open ? ' open' : ''}>
    <summary class="myseat-label myhouse-fold-summary">
      <i class="bi bi-chevron-right myhouse-fold-caret" aria-hidden="true"></i>
      <span>${escHtml(label)}</span>
      ${count ? `<span class="myhouse-fold-count">${escHtml(String(count))}</span>` : ''}
    </summary>
    <div class="myhouse-fold-body">${bodyHtml}</div>
  </details>`;
}

function requestHtml(r) {
  const st = REQUEST_STATUS[r.status] || REQUEST_STATUS.pending;
  const label = REQUEST_FIELD_LABEL[r.field] || r.field;
  const changed = r.status === 'approved' && r.applied_value
    && r.applied_value !== r.requested_value;
  return `<li class="${st.cls}">
      <div class="myhouse-request-head">
        <i class="bi ${st.icon}" aria-hidden="true"></i>
        <strong>${escHtml(st.label)}</strong>
        <span class="myhouse-request-when">${escHtml(requestDate(r.created_at))}</span>
      </div>
      <div class="myhouse-request-body">
        ขอแก้ <strong>${escHtml(label)}</strong>
        เป็น <code>${escHtml(r.requested_value || '—')}</code>
        ${changed
    ? `<br />ผู้ดูแลบันทึกให้เป็น <code>${escHtml(r.applied_value)}</code> แทน`
    : ''}
        ${r.decision_note
    ? `<br /><span class="myhouse-request-note">ข้อความจากผู้ดูแล: ${escHtml(r.decision_note)}</span>`
    : ''}
        ${r.status === 'rejected' && !r.decision_note
    ? '<br /><span class="myhouse-request-note">ผู้ดูแลไม่ได้ระบุเหตุผล — สอบถามได้ที่ SAMO</span>'
    : ''}
      </div>
    </li>`;
}

/**
 * OPEN QUESTIONS ON TOP, ANSWERED ONES FOLDED AWAY.
 *
 * Reported: "คำขอแก้ไขของฉัน shows many on main web, it took space, i think it
 * should be collapsable, or like show the recent one and history".
 *
 * The two halves are not the same thing and must not be collapsed the same way:
 *
 *   • A PENDING request is an open loop. The student filed it and is waiting;
 *     hiding it behind a click is hiding the one line that answers "did my
 *     report go through". Those stay expanded, always, however many there are —
 *     and in practice there is almost never more than one, because there is
 *     exactly one requestable field (สายรหัส).
 *   • A DECIDED request is a receipt. It matters once, on the day it is
 *     answered, and after that it is history the card should not be spending a
 *     screenful on. Those fold, newest first, with the count on the summary so
 *     the student can see there IS a history without opening it.
 *
 * The most recent decision is shown OUTSIDE the fold when there is no pending
 * request, because "อนุมัติแล้ว" arriving is itself news — folding it would mean
 * the answer to the student's question appeared with no visible change at all.
 */
function requestsHtml(rec) {
  const list = rec.my_requests || [];
  if (!list.length) return '';
  const byNewest = [...list].sort(
    (a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')),
  );
  const pending = byNewest.filter((r) => r.status === 'pending');
  const decided = byNewest.filter((r) => r.status !== 'pending');
  // No open loop? The newest answer is the news; the rest is history.
  const shown = pending.length ? pending : decided.slice(0, 1);
  const folded = decided.filter((r) => !shown.includes(r));

  return `<div class="myseat-block">
    <span class="myseat-label">คำขอแก้ไขของฉัน</span>
    <ul class="myhouse-requests">${shown.map(requestHtml).join('')}</ul>
    ${folded.length
    ? disclosure('คำขอก่อนหน้านี้', folded.length,
      `<ul class="myhouse-requests">${folded.map(requestHtml).join('')}</ul>`)
    : ''}
  </div>`;
}


/**
 * Two lists: the student's OWN สาย, then everyone else's in the same house.
 *
 * This is what replaced เพื่อนร่วมบ้าน. A roster of ~180 classmates' names was
 * both the least useful thing on the card and the only thing on it that
 * published other people — whereas "who are the อาจารย์ in my house" is the
 * question a student actually arrives with, and อาจารย์ are staff, listed in
 * their capacity as อาจารย์ที่ปรึกษา.
 *
 * The house-wide list comes from `house_advisors` (one row per distinct อาจารย์
 * per สาย, built by the RPC), with the student's own สาย filtered out so nobody
 * is named twice on one card.
 */
function advisorsHtml(rec) {
  const own = rec.advisors || [];
  const house = (rec.house_advisors || []).filter((a) => a.sai !== rec.sai);

  const ownBlock = `<div class="myseat-block">
    <span class="myseat-label">อาจารย์ที่ปรึกษาสายของฉัน${rec.sai ? ` (สาย ${escHtml(rec.sai)})` : ''}</span>
    ${own.length
    ? `<ul class="myhouse-advisors">${own.map((a) => advisorLi(a, null)).join('')}</ul>`
    : '<p class="myhouse-empty">ยังไม่มีข้อมูลอาจารย์ที่ปรึกษาของสายนี้</p>'}
  </div>`;

  if (!house.length) return ownBlock;

  // FOLDED, and the two lists are folded differently ON PURPOSE.
  //
  // "อาจารย์ที่ปรึกษาสายของฉัน" is the question a student actually arrives with,
  // and it is one or two people — it stays open. "อาจารย์ในบ้านเดียวกัน" is
  // ~18 people the student is not looking for today; open, it is the longest
  // thing on the card by a wide margin and it pushes everything the student came
  // for off the screen. Folded, the count is still on the summary, so it says
  // "there are 18 of them" without spending 18 rows saying it.
  return `${ownBlock}
    ${disclosure('อาจารย์ในบ้านเดียวกัน', `${house.length} ท่าน`,
    `<ul class="myhouse-advisors">${house
      .map((a) => advisorLi(a, a.sai ? `สาย ${a.sai}` : null)).join('')}</ul>`)}`;
}

/**
 * The self-edit form.
 *
 * ชื่อ · นามสกุล · ชื่อเล่น · รหัสนักศึกษา · สาขา — the five things a person can
 * see are wrong about themselves and fix without asking anyone. สาขา is a
 * CHOOSER filled from the managed vocabulary, never a text box: free text is
 * what produced `MD`, `md` and `M.D.` for one answer, and the server refuses
 * anything off the list anyway (0125), so a text box would only produce errors.
 *
 * สายรหัส is shown READ-ONLY with the route out. It is the only field here that
 * cannot be self-edited, and saying so next to it — rather than omitting it —
 * is what stops "mine is wrong" from being a dead end.
 *
 * THE สาขา CHOOSER IS RENDERED WITH THE CURRENT VALUE ALREADY SELECTED, and
 * refilled with the full list once it loads. It must NOT open as a bare
 * `<option value="">` placeholder: the form is submittable the instant it
 * appears, so a submit during that fetch would send `major: ""`, which the RPC
 * writes as NULL — and `self_edited` then makes the loss permanent against every
 * future import. my-seat.js's chooser was already built this way (it passes the
 * stored value to optionsHtml, which keeps an off-list value as its own option);
 * this one had drifted from it.
 */
function editFormHtml(rec) {
  return `
    <form class="myseat-edit" data-house-form="edit" hidden>
      <p class="myseat-edit-intro">
        แก้ข้อมูลของตัวเองได้ที่นี่ ระบบจะจำไว้ว่าช่องไหนคุณแก้เอง
        และการนำเข้าข้อมูลรอบถัดไปจะไม่ทับของคุณ
      </p>
      <div class="myseat-fields">
        <label class="myseat-field">
          <span>ชื่อ</span>
          <input type="text" name="first_name_th" value="${escHtml(rec.first_name || '')}" />
        </label>
        <label class="myseat-field">
          <span>นามสกุล</span>
          <input type="text" name="last_name_th" value="${escHtml(rec.last_name || '')}" />
        </label>
        <label class="myseat-field">
          <span>ชื่อเล่น</span>
          <input type="text" name="nickname" value="${escHtml(rec.nickname_self || rec.nickname || '')}" />
        </label>
        <label class="myseat-field">
          <span>รหัสนักศึกษา</span>
          <input type="text" name="student_id" inputmode="numeric"
                 value="${escHtml(rec.student_id || '')}" placeholder="659999999-9" />
          <em class="myseat-field-hint">10 หลัก มีขีดก่อนหลักสุดท้าย — รุ่นคำนวณจากเลขนี้</em>
        </label>
        <label class="myseat-field">
          <span>สาขา</span>
          <select name="major" data-house-majors>${majorOptionsHtml(rec.major)}</select>
        </label>
        ${studyYearFieldHtml(rec)}
        <label class="myseat-field myseat-field--locked is-wide">
          <span>สายรหัส</span>
          <input type="text" value="${escHtml(rec.sai || '')}" readonly />
          <em class="myseat-field-hint">
            แก้เองไม่ได้ — เป็นสายที่มหาวิทยาลัยกำหนด และเป็นตัวตัดสินบ้าน
            ถ้าไม่ถูกต้องให้ใช้ปุ่ม “แจ้งข้อมูลไม่ถูกต้อง”
          </em>
        </label>
      </div>
      <div class="myseat-edit-actions">
        <button type="submit" class="myseat-save">บันทึก</button>
        <button type="button" class="myseat-cancel" data-house-act="cancel-edit">ยกเลิก</button>
        <span class="myseat-edit-status" data-house-status role="status"></span>
      </div>
    </form>`;
}

/**
 * The ชั้นปี chooser — shows years, saves the GAP.
 *
 * The person picks "ปี 4" like any other form. What is written is
 * `year_offset = picked − computed`, so a ลาพัก student sets it once and is
 * still right in 2570 and 2575 — where a stored `year = 4` would be right for
 * one August and quietly wrong every August after. That is the same fill-once
 * failure 0128 fixed on `cohort_year` and 0129 dropped from `year_override`;
 * the difference here is that the UI does not expose it, so nobody has to
 * understand an offset to use the box.
 *
 * The FIRST option is "ตามที่ระบบคำนวณ", and it stores null rather than 0 —
 * "no adjustment" and "an adjustment of nothing" are the same to a reader, and
 * only the first leaves `self_edited` honest.
 *
 * NO ปีที่เข้า, NO CHOOSER. There is nothing to count from, so the box is
 * disabled and says which field to fill in instead — a chooser that silently
 * writes an absolute year for these rows is exactly the column 0129 removed.
 */
function studyYearFieldHtml(rec) {
  const computed = studyYear({ ...rec, year_offset: 0 });
  if (computed === null) {
    return `
      <label class="myseat-field myseat-field--locked">
        <span>ชั้นปี</span>
        <input type="text" value="—" readonly />
        <em class="myseat-field-hint">กรอกรหัสนักศึกษาก่อน ระบบจะคำนวณชั้นปีให้เอง</em>
      </label>`;
  }
  const current = studyYear(rec);
  const opts = [1, 2, 3, 4, 5, 6].map((y) => `<option value="${y}"${
    y === current ? ' selected' : ''}>ปี ${y}</option>`).join('');
  return `
    <label class="myseat-field">
      <span>ชั้นปี</span>
      <select name="study_year">
        <option value=""${rec.year_offset ? '' : ' selected'}>ตามที่ระบบคำนวณ (ปี ${computed})</option>
        ${opts}
      </select>
      <em class="myseat-field-hint">
        ปกติไม่ต้องแก้ — ระบบเลื่อนชั้นปีให้เองทุกปีจากรหัสนักศึกษา
        เลือกเองเฉพาะกรณีลาพัก เรียนซ้ำ หรือจบช้า แล้วระบบจะจำส่วนต่างไว้ให้ตลอด
      </em>
    </label>`;
}

/**
 * The สาขา chooser's options, fetched once and only when someone opens the form.
 *
 * An off-list value already stored is kept as its own option — a select that
 * silently drops what the row holds would REWRITE it on the next save of an
 * unrelated field. (The server would then refuse it, which is a confusing way to
 * discover your own data was about to be changed.)
 */
let majorOptions = null;
async function loadMajorOptions() {
  if (majorOptions) return majorOptions;
  try {
    majorOptions = await fetchMajors();
  } catch (err) {
    console.warn('my-house: majors lookup failed:', err);
    majorOptions = [];
  }
  return majorOptions;
}

function majorOptionsHtml(current) {
  const cur = String(current ?? '').trim();
  const list = majorOptions || [];
  const known = list.some((m) => m.code === cur);
  return '<option value="">— ไม่ระบุ —</option>'
    + list.map((m) => `<option value="${escHtml(m.code)}"${m.code === cur ? ' selected' : ''}>${
  escHtml(m.label ? `${m.code} — ${m.label}` : m.code)}</option>`).join('')
    + (cur && !known
      ? `<option value="${escHtml(cur)}" selected>${escHtml(cur)} (ไม่อยู่ในรายการ)</option>` : '');
}

/**
 * แจ้งข้อมูลไม่ถูกต้อง, as a form rather than two `prompt()`s.
 *
 * The prompts it replaces were the shape that made the ทีม SAMO delete button
 * look dead: Chrome's "Prevent this page from creating additional dialogs" makes
 * `prompt()` return null with no error and no trace, so the report silently did
 * nothing. A form in the card cannot be suppressed and shows its own result.
 */
function reportFormHtml(rec) {
  return `
    <form class="myseat-edit" data-house-form="report" hidden>
      <p class="myseat-edit-intro">
        สายรหัสมาจากระบบอาจารย์ที่ปรึกษาของมหาวิทยาลัย และเป็นตัวกำหนดบ้าน
        จึงแก้เองไม่ได้ — กรอกสายที่ถูกต้องไว้ ผู้ดูแลจะตรวจสอบแล้วแก้ให้
        ระบบจะยังไม่เปลี่ยนอะไรจนกว่าจะได้รับการอนุมัติ
      </p>
      <div class="myseat-fields">
        <label class="myseat-field myseat-field--locked">
          <span>สายรหัสตอนนี้</span>
          <input type="text" value="${escHtml(rec.sai || '—')}" readonly />
        </label>
        <label class="myseat-field">
          <span>สายรหัสที่ถูกต้อง</span>
          <input type="text" name="requested" inputmode="numeric" placeholder="017" />
          <em class="myseat-field-hint">3 หลัก เช่น 001 017 100</em>
        </label>
      </div>
      <label class="myseat-field is-wide myhouse-reason">
        <span>เหตุผล (ไม่บังคับ)</span>
        <textarea name="reason" rows="2" placeholder="เช่น ย้ายสายตั้งแต่ปีที่แล้ว"></textarea>
      </label>
      <input type="hidden" name="field" value="${escHtml(REQUESTABLE_FIELDS[0].field)}" />
      <div class="myseat-edit-actions">
        <button type="submit" class="myseat-save">ส่งคำขอ</button>
        <button type="button" class="myseat-cancel" data-house-act="cancel-report">ยกเลิก</button>
        <span class="myseat-edit-status" data-house-report-status role="status"></span>
      </div>
    </form>
    <form class="myseat-edit" data-house-form="notme" hidden>
      <p class="myhouse-empty">ถ้าชื่อหรือรหัสในการ์ดนี้เป็นของคนอื่น แปลว่าอีเมลของคุณถูกกรอกผิด
        ในไฟล์ที่คณะส่งมา ระบบจะแจ้งผู้ดูแลให้ตรวจสอบ
        <strong>อย่าแก้ข้อมูลในการ์ดนี้เอง</strong> เพราะจะทับข้อมูลของเจ้าของตัวจริง</p>
      <label class="myseat-edit-field">
        <span>บอกเพิ่มได้ถ้าอยากบอก (ไม่บังคับ)</span>
        <input type="text" name="note" autocomplete="off"
               placeholder="เช่น ชื่อในการ์ดนี้ไม่ใช่ชื่อฉัน" />
      </label>
      <div class="myseat-edit-actions">
        <button type="submit" class="myseat-save">แจ้งผู้ดูแล</button>
        <button type="button" class="myseat-cancel" data-house-act="cancel-notme">ยกเลิก</button>
        <span class="myseat-edit-status" data-house-notme-status role="status"></span>
      </div>
    </form>`;
}

/**
 * The card a signed-in person sees when ระบบบ้าน has nothing for them.
 *
 * WHY THIS EXISTS. `fetchMyStudentRecord()` matches `users.email` against
 * `students.kkumail`, so an account signed in with a GMAIL address can never
 * match — and the card simply did not render. No message, no hint, nothing to
 * click: the whole feature was invisible and the reason was invisible with it.
 * Someone in that state has no way to discover that the ACCOUNT is the problem,
 * and the sign-in modal used to steer people towards exactly that state by
 * putting username/password first.
 *
 * TWO DIFFERENT EMPTY STATES, because they need different actions. A non-kkumail
 * account has to sign in again with the right one; a kkumail account that is
 * simply not in the table yet just has to wait for (or ask about) the import.
 * Saying "ask an admin" to the first group would send them to a human who cannot
 * help, and telling the second to switch accounts would send them in a circle.
 */
function emptyHouseHtml(account) {
  const mail = String(account || '').trim();
  const isKku = /@kkumail\.com$/i.test(mail) || /@kku\.ac\.th$/i.test(mail);
  return `
    <div class="myseat-card myhouse-card">
      <div class="myseat-head">
        <span class="myseat-eyebrow"><i class="bi bi-house-heart-fill" aria-hidden="true"></i> บ้านของฉัน</span>
      </div>
      ${isKku ? `
        <p class="myhouse-empty">ยังไม่มีข้อมูลของคุณในระบบบ้าน</p>
        <p class="myhouse-empty">ถ้าคุณเป็นนักศึกษาแพทย์ มข. กรอกรหัสนักศึกษากับชื่อจริงของคุณ
          ระบบจะจับคู่กับรายชื่อที่คณะส่งมาให้เอง</p>
        <form class="myseat-edit myhouse-claim" data-house-form="claim">
          <label class="myseat-edit-field">
            <span>รหัสนักศึกษา</span>
            <input type="text" name="student_id" inputmode="numeric" autocomplete="off"
                   placeholder="659999999-9" required />
          </label>
          <label class="myseat-edit-field">
            <span>ชื่อจริง (ไม่ต้องใส่นามสกุล)</span>
            <input type="text" name="first_name" autocomplete="off" required />
          </label>
          <div class="myseat-edit-actions">
            <button type="submit" class="myseat-save">ยืนยันตัวตน</button>
            <span class="myseat-edit-status" data-house-claim-status role="status"></span>
          </div>
        </form>
        <p class="myhouse-empty myhouse-empty--quiet">ถ้ากรอกถูกแล้วยังไม่พบ
          ระบบจะแจ้งผู้ดูแลระบบบ้านให้เองทันที พร้อมกับสิ่งที่คุณกรอกไว้
          ไม่ต้องไปแจ้งซ้ำที่อื่น</p>`
    : `
        <p class="myhouse-empty">ระบบบ้านใช้บัญชี <strong>kkumail</strong> ในการจับคู่ข้อมูลนักศึกษา
          ตอนนี้คุณเข้าสู่ระบบด้วย${mail
    ? ` <strong>${escHtml(mail)}</strong>`
    : 'ชื่อผู้ใช้และรหัสผ่าน ซึ่งไม่ได้ผูกกับ kkumail'}
          จึงยังไม่เห็นสายรหัส บ้าน และอาจารย์ที่ปรึกษาของตัวเอง</p>
        <p class="myhouse-empty">ออกจากระบบแล้วเข้าสู่ระบบใหม่ด้วย Google
          โดยเลือกบัญชี <strong>@kkumail.com</strong> ของคุณ แล้วข้อมูลจะขึ้นเองอัตโนมัติ</p>`}
    </div>`;
}

/**
 * Wire the "ยืนยันตัวตน" form on the empty card.
 *
 * SEPARATE FROM wireCard BECAUSE THE EMPTY BRANCH RETURNS BEFORE IT. That early
 * return is why the form needs its own call rather than a condition inside
 * wireCard — and, like wireCard, every listener here is attached to a node THIS
 * paint created, so the next render drops it. Delegating from `host`, which
 * survives every paint, is what once added one listener per render and made a
 * button fire twice, then three times (the bug wireCard's header describes).
 *
 * A MISS IS NOT AN ERROR. `claim_my_student_seat` answers `{ok:false, message}`
 * when the two facts do not match a held row, and deliberately says the same
 * thing whether the รหัส is unknown or the ชื่อ is wrong — so this renders the
 * server's sentence as-is rather than composing its own. Two authors of one
 * message is how an alert ends up contradicting the fixed instruction beside it
 * (docs/mistakes/integrations.md); the server is the author here.
 */
function wireClaim(host, opts = {}) {
  if (typeof host.querySelector !== 'function') return;
  const form = host.querySelector('[data-house-form="claim"]');
  if (!form) return;
  const status = form.querySelector('[data-house-claim-status]');
  const btn = form.querySelector('.myseat-save');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const sid = form.querySelector('[name="student_id"]').value.trim();
    const first = form.querySelector('[name="first_name"]').value.trim();
    if (!sid || !first) {
      if (status) status.textContent = 'กรอกทั้งรหัสนักศึกษาและชื่อจริง';
      return;
    }
    // Checked HERE as well as on the server, because the server's message for a
    // malformed รหัส is the same neutral "ไม่พบรายชื่อ" as a genuine miss — it
    // has to be, or the form becomes a way to test one guess at a time. That
    // silence is right for the server and useless to someone who simply mistyped.
    const norm = normalizeStudentId(sid);
    if (!norm.ok) {
      if (status) status.textContent = 'รหัสนักศึกษาต้องเป็นตัวเลข 10 หลัก เช่น 659999999-9';
      return;
    }
    if (btn) { btn.disabled = true; btn.textContent = 'กำลังตรวจสอบ…'; }
    if (status) status.textContent = '';
    try {
      const res = await claimMySeat(norm.value, first);
      if (!res?.ok) {
        if (status) status.textContent = res?.message || 'ไม่พบรายชื่อที่ตรงกัน';
        if (btn) { btn.disabled = false; btn.textContent = 'ยืนยันตัวตน'; }
        return;
      }
      // The cache holds the "you are nobody" answer this card was painted from.
      // Repainting without clearing it would show the empty card again on top of
      // a record that now exists — the stale-instrument shape.
      clearMyHouseCache();
      if (status) status.textContent = 'พบข้อมูลของคุณแล้ว กำลังโหลด…';
      await showMyHouse(host, opts.uid, opts);
    } catch (err) {
      if (status) status.textContent = err?.message || 'ยืนยันตัวตนไม่สำเร็จ';
      if (btn) { btn.disabled = false; btn.textContent = 'ยืนยันตัวตน'; }
    }
  });
}

export function renderMyHouse(host, rec, opts = {}) {
  if (!host) return;
  if (!rec) {
    // Signed OUT (main.js paints this explicitly on the logged-out branch) —
    // stay hidden. There is no question to answer for someone who has not said
    // who they are yet.
    //
    // The flag is `signedIn`, NOT a truthy `account`: auth.js stores '' as the
    // email of a username/password account (the synthetic address is hidden on
    // purpose), so keying off the address alone would leave exactly those users
    // with a blank card again — the bug this branch exists to fix, reintroduced
    // for the group most likely to hit it.
    if (!opts.signedIn) { host.hidden = true; host.innerHTML = ''; return; }
    host.hidden = false;
    host.innerHTML = emptyHouseHtml(opts.account);
    wireClaim(host, opts);
    return;
  }
  host.hidden = false;
  // Set when the person also holds a ทีม SAMO posting, i.e. the card above is
  // already showing their identity. This card then carries only what is
  // house-specific, and the identity edit lives in exactly one place.
  const paired = !!opts.identityShownAbove || opts.mode === 'section';

  const named = houseLabel(rec.house_id, rec.house_name);
  const hasHouse = rec.house_id !== null && rec.house_id !== undefined;
  const who = [rec.full_name, rec.nickname ? `(${rec.nickname})` : ''].filter(Boolean).join(' ');

  // SECTION MODE: this card is being painted INSIDE the ข้อมูลของฉัน card, so it
  // drops its own shell, eyebrow and person-header — the card above already
  // named the person, and repeating the frame is what made two cards read as a
  // rendering bug. It keeps the crest, because the crest is the house.
  const section = opts.mode === 'section';
  const shellOpen = section
    ? `<section class="myprofile-section myhouse-section"${
      safeColor(rec.house_color) ? ` style="--house-accent:${safeColor(rec.house_color)}"` : ''}>
      <h3 class="myprofile-section-title">
        <i class="bi bi-house-heart-fill" aria-hidden="true"></i> ระบบบ้าน
      </h3>`
    : `<div class="myseat-card myhouse-card"${
      safeColor(rec.house_color) ? ` style="--house-accent:${safeColor(rec.house_color)}"` : ''}>
      <div class="myseat-head">
        <span class="myseat-eyebrow"><i class="bi bi-house-heart-fill" aria-hidden="true"></i> บ้านของฉัน</span>
      </div>`;
  const shellClose = section ? '</section>' : '</div>';

  host.innerHTML = `
    ${shellOpen}
      <div class="myseat-person myhouse-person">
        ${crestHtml(rec)}
        <div class="myseat-person-body">
          <p class="myseat-name">${escHtml(hasHouse ? named : 'ยังไม่ได้กำหนดสายรหัส')}</p>
          <p class="myhouse-sub">${escHtml(hasHouse
    ? [section ? '' : who, rec.sai ? `สายรหัส ${rec.sai}` : ''].filter(Boolean).join(' · ')
    : 'เมื่อมีสายรหัสแล้ว ระบบจะจัดบ้านให้อัตโนมัติจากเลขหลักสุดท้าย')}</p>
          ${hasHouse && rec.house_slogan
    ? `<p class="myhouse-slogan">${escHtml(rec.house_slogan)}</p>` : ''}
        </div>
      </div>

      ${detailsHtml(rec, { identityShownAbove: paired })}

      <div class="myhouse-actions">
        ${paired ? '' : `<button type="button" class="myseat-fix myseat-fix--quiet" data-house-act="edit">
          <i class="bi bi-pencil" aria-hidden="true"></i> แก้ไขข้อมูล
        </button>`}
        <button type="button" class="myseat-fix myseat-fix--quiet" data-house-act="report">
          <i class="bi bi-flag" aria-hidden="true"></i> แจ้งสายรหัสไม่ถูกต้อง
        </button>
        <button type="button" class="myseat-fix myseat-fix--quiet" data-house-act="notme">
          <i class="bi bi-person-x" aria-hidden="true"></i> ไม่ใช่ข้อมูลของฉัน
        </button>
      </div>

      ${paired ? '' : editFormHtml(rec)}
      ${reportFormHtml(rec)}

      ${requestsHtml(rec)}
      ${advisorsHtml(rec)}

      <!-- WHERE TO REPORT A BROKEN WEBSITE, for the ~1,800 students who are NOT
           in ทีม SAMO. This card is their "my data" screen, so it is where they
           are standing when something looks wrong.
           ⚠️ VitalSound ONLY — no Discord. The SAMO Discord is reachable by
           ทีม SAMO members, and naming a channel this reader cannot open would
           send them somewhere they get stuck.
           Skipped when paired: the card is then a SECTION inside ข้อมูลของฉัน,
           (no backticks in here — an HTML comment inside a template literal is
           still JS string content, and one backtick ends the string)
           which already ends with the same line (with Discord, correctly, since
           that reader does hold a posting). -->
      ${paired ? '' : `<p class="myseat-help myseat-help--report">
        <i class="bi bi-bug" aria-hidden="true"></i>
        หากมีปัญหาอื่น ๆ เว็บมีปัญหา หรือพบบัค แจ้งได้ที่แท็บ
        <a href="/vssound">แจ้งปัญหา (VitalSound)</a>
      </p>`}
    ${shellClose}`;

  wireCard(host, rec, opts);
}

// ── behaviour ──────────────────────────────────────────────────────────────

/**
 * Wire the nodes THIS paint created.
 *
 * Every listener below is attached to an element inside `host.innerHTML`, so the
 * next render drops it along with the node. The previous version delegated from
 * `host` itself — which survives every render — and added one more listener per
 * paint, so a `classList.toggle()` in the handler ran once, then twice, then
 * three times, and the panel opened only on odd-numbered paints. That is the
 * "click many times and sometimes it will appear" bug.
 */
function wireCard(host, rec, opts = {}) {
  // renderMyHouse's contract is "anything with .innerHTML and .hidden" — the
  // unit tests assert the MARKUP against a plain object with no DOM at all.
  if (typeof host.querySelector !== 'function') return;

  // Section mode renders `<section class="myhouse-section">`, not `.myhouse-card`
  // — asking for the card alone left `card` null there, so the แจ้งสายรหัสไม่ถูกต้อง
  // button never got its `is-open` state while its form was showing.
  const card = host.querySelector('.myhouse-card, .myhouse-section');
  const editForm = host.querySelector('[data-house-form="edit"]');
  const reportForm = host.querySelector('[data-house-form="report"]');
  const notmeForm = host.querySelector('[data-house-form="notme"]');

  // ONE state, set explicitly. Never `toggle()` on a shared container: a panel
  // whose visibility is computed from its own current class cannot be reasoned
  // about once anything else touches it.
  let open = null;                       // 'edit' | 'report' | null
  const setOpen = (which) => {
    open = which;
    if (editForm) editForm.hidden = open !== 'edit';
    if (reportForm) reportForm.hidden = open !== 'report';
    if (notmeForm) notmeForm.hidden = open !== 'notme';
    card?.querySelectorAll('[data-house-act]').forEach((b) => {
      b.classList.toggle('is-open', b.dataset.houseAct === open);
    });
    // Filled when the form is actually opened, not on every card paint: the
    // card renders for every signed-in student on the home page, and only the
    // few who edit need the list.
    if (open === 'edit') {
      const sel = editForm?.querySelector('[data-house-majors]');
      if (sel) loadMajorOptions().then(() => { sel.innerHTML = majorOptionsHtml(rec.major); });
    }
  };
  const toggle = (which) => setOpen(open === which ? null : which);

  host.querySelector('[data-house-act="edit"]')?.addEventListener('click', () => toggle('edit'));
  host.querySelector('[data-house-act="report"]')?.addEventListener('click', () => toggle('report'));
  host.querySelector('[data-house-act="cancel-edit"]')?.addEventListener('click', () => setOpen(null));
  host.querySelector('[data-house-act="cancel-report"]')?.addEventListener('click', () => setOpen(null));
  host.querySelector('[data-house-act="notme"]')?.addEventListener('click', () => toggle('notme'));
  host.querySelector('[data-house-act="cancel-notme"]')?.addEventListener('click', () => setOpen(null));

  // ── ไม่ใช่ข้อมูลของฉัน
  //
  // It FILES A SENTENCE AND CHANGES NOTHING, deliberately. Someone looking at a
  // stranger's record must not be able to act on it — the rightful owner of that
  // address may still turn out to be the person in the card, and an edit here
  // would overwrite a real student's data on the word of whoever the wrong
  // address happened to send.
  notmeForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const status = notmeForm.querySelector('[data-house-notme-status]');
    const btn = notmeForm.querySelector('.myseat-save');
    if (btn) { btn.disabled = true; btn.textContent = 'กำลังส่ง…'; }
    try {
      await reportNotMyRecord(notmeForm.querySelector('[name="note"]').value.trim());
      if (status) status.textContent = 'แจ้งแล้ว ผู้ดูแลจะติดต่อกลับ';
      if (btn) btn.textContent = 'แจ้งแล้ว';
    } catch (err) {
      if (status) status.textContent = err?.message || 'ส่งไม่สำเร็จ';
      if (btn) { btn.disabled = false; btn.textContent = 'แจ้งผู้ดูแล'; }
    }
  });

  // ── บันทึก
  editForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const status = editForm.querySelector('[data-house-status]');
    const btn = editForm.querySelector('.myseat-save');
    const val = (name) => editForm.querySelector(`[name="${name}"]`).value.trim();

    // Mirrors the server rule (0126): a row may legitimately have NO name — the
    // import file need not carry one — so an empty box is only refused when it
    // would ERASE a name that exists. Blocking it outright would stop a student
    // imported without a name from saving just their ชื่อเล่น.
    const first = val('first_name_th');
    if (!first && rec.first_name) {
      if (status) { status.textContent = 'กรุณากรอกชื่อ'; status.classList.add('is-error'); }
      editForm.querySelector('[name="first_name_th"]').focus();
      return;
    }
    // Canonicalise through the SAME rule the importer and the admin form use.
    // A รหัส typed as 10 bare digits is correct and gets its dash here rather
    // than being refused by the server for a formatting reason.
    const sid = normalizeStudentId(val('student_id'));
    if (!sid.ok && sid.value) {
      if (status) {
        status.textContent = 'รหัสนักศึกษาต้องเป็น 10 หลัก เช่น 659999999-9';
        status.classList.add('is-error');
      }
      editForm.querySelector('[name="student_id"]').focus();
      return;
    }

    const patch = {
      first_name_th: first,
      last_name_th: val('last_name_th'),
      nickname_self: val('nickname'),
      student_id: sid.value || '',
      major: val('major'),
    };
    // ชั้นปี → the GAP. Computed against the รหัส IN THE FORM, not the stored
    // one: the same submit may be changing the รหัส, and the database re-derives
    // `cohort_year` from the new value (0128) — so measuring the gap against the
    // old cohort would store an offset that is wrong the instant it lands.
    const yearSel = editForm.querySelector('[name="study_year"]');
    if (yearSel) {
      const basis = sid.value && sid.value !== rec.student_id
        ? { student_id: sid.value }          // cohort_year deliberately absent
        : rec;
      patch.year_offset = yearSel.value
        ? String(offsetForPickedYear(basis, yearSel.value) ?? '')
        : '';
    }
    if (status) { status.textContent = 'กำลังบันทึก…'; status.classList.remove('is-error'); }
    if (btn) btn.disabled = true;
    try {
      const updated = await saveMyStudentRecord(patch);
      // BOTH caches — the ทีม SAMO rows above this section show the same
      // ชื่อ / ชื่อเล่น / รหัส and are painted from a different cache.
      clearProfileCaches();
      renderMyHouse(host, updated, opts);
    } catch (err) {
      if (status) {
        status.textContent = err?.message || 'บันทึกไม่สำเร็จ';
        status.classList.add('is-error');
      }
      if (btn) btn.disabled = false;
    }
  });

  // ── แจ้งข้อมูลไม่ถูกต้อง
  reportForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const status = reportForm.querySelector('[data-house-report-status]');
    const btn = reportForm.querySelector('.myseat-save');
    const field = reportForm.querySelector('[name="field"]').value;
    const requestedEl = reportForm.querySelector('[name="requested"]');
    let requested = requestedEl.value.trim();
    if (!requested) {
      if (status) { status.textContent = 'กรอกค่าที่ถูกต้องด้วย'; status.classList.add('is-error'); }
      requestedEl.focus();
      return;
    }
    if (field === 'sai_code') {
      const n = normalizeSai(requested);
      if (!n.ok || !n.value) {
        if (status) {
          status.textContent = saiProblem(requested) || 'สายรหัสไม่ถูกต้อง';
          status.classList.add('is-error');
        }
        requestedEl.focus();
        return;
      }
      requested = n.value;
    }
    if (status) { status.textContent = 'กำลังส่ง…'; status.classList.remove('is-error'); }
    if (btn) btn.disabled = true;
    try {
      await requestMyChange(field, requested, reportForm.querySelector('[name="reason"]').value.trim());
      // Repaint from the server rather than printing "ส่งคำขอแล้ว" into the
      // form. The card now has a คำขอแก้ไขของฉัน list, and the request showing
      // up in it — with its status, and later with the admin's answer — is a
      // better confirmation than a sentence, because it is the same place the
      // person will come back to look.
      clearProfileCaches();
      const fresh = await fetchMyStudentRecord().catch(() => null);
      if (fresh && fresh.kkumail) { renderMyHouse(host, fresh, opts); return; }
      reportForm.innerHTML = '<p class="myhouse-sent">'
        + '<i class="bi bi-check2-circle" aria-hidden="true"></i> '
        + 'ส่งคำขอแล้ว ผู้ดูแลจะตรวจสอบและแก้ไขให้</p>';
    } catch (err) {
      if (status) {
        status.textContent = err?.message || 'ส่งคำขอไม่สำเร็จ';
        status.classList.add('is-error');
      }
      if (btn) btn.disabled = false;
    }
  });
}

/** Load + paint. Best-effort: a student who is not in the table simply has no
 *  card, which is the normal state until the import lands. */
export async function showMyHouse(host, uid, opts = {}) {
  if (!host) return;
  const rec = await loadMyHouse(uid);
  // `uid` travels IN the opts from here on. The empty card's claim form has to
  // re-show this same card after a successful claim, and it only has `opts` —
  // reading the uid from a module variable instead is the account-switch trap
  // this file already carries a cache guard for.
  renderMyHouse(host, rec, { ...opts, uid });
}
