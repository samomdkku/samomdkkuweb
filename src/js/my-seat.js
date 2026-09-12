// my-seat.js — the "ข้อมูลของฉัน" card.
//
// ONE CARD PER PERSON. It renders the shared identity once, then a ทีม SAMO
// section, then leaves a SLOT that my-house.js paints ระบบบ้าน into. It used to
// be one of two sibling cards that each repeated ชื่อ, ชื่อเล่น, รหัสนักศึกษา,
// ชั้นปี and สาขา, with two edit forms writing two tables — reported as "it look
// worse, i thought it would be like one card". A person is one entity; their
// memberships are sections about them.
//
// ⚠️ THIS CARD OWNS A SLOT ANOTHER MODULE PAINTS INTO. Every re-render wipes it
// (a save does exactly that), so renderMySeat calls `opts.afterRender` and the
// home page uses it to put the house section back. Removing that hook makes
// ระบบบ้าน vanish the first time somebody edits their name — the "shared
// render() repaints a pane another module owns" entry in mistakes.md.
//
// THE PROBLEM. A ทีม SAMO grant is invisible to the person holding it. Someone
// whose kkumail sits in the org tree signs in and the app quietly changes shape
// — a section appears in /admin/, a form starts saving — with nothing naming
// their ตำแหน่ง or listing what they may now do. Until now the only way to
// answer "what am I, and what can I do?" was to ask a developer with SQL access.
//
// One source: public.get_my_team_seat() (migrations 0109, extended in 0110). It
// takes no argument — identity comes from auth.uid() — so this module cannot be
// pointed at anyone else, and there is nothing here that could turn into a
// roster lookup. Every field it returns is the CALLER'S OWN.
//
// TWO SURFACES, ONE FETCH:
//   • the home page, under the greeting — the answer to "what am I" belongs
//     where the app already says hello, and this is the only place a member who
//     never opens /admin/ will see it;
//   • the โปรไฟล์ modal — the canonical "about my account" surface, where
//     someone goes when they specifically want to check.
// Both render from the same cached payload, so opening the modal after the home
// card has loaded costs nothing.
//
// WHAT 0110 ADDED. The card now shows the WHOLE record — portrait, ชื่อเล่น,
// รหัสนักศึกษา, ชั้นปี, สาขา, kkumail — and, when something about that record is
// wrong or missing, says so and offers the fix inline. The rules behind
// "something is wrong" are NOT restated here: they come from ./team/identity.js,
// the same module the admin ตรวจสอบข้อมูล pane uses, because this repo has been
// bitten by one rule with two implementations. `sid_clash` is the one finding
// that cannot be computed here (it needs other people's rows, which this
// payload deliberately does not contain) — and it is also the one a person
// cannot fix alone, so its absence costs nothing.
import { dbRest } from './db.js';
import { escHtml } from './utils.js';
import { registerProfileCache, clearProfileCaches } from './profile-cache.js';
import {
  portraitSrc, portraitSrcSet, focusToObjectPosition, uploadTeamPhoto,
} from './uploads.js';
import { cropImage } from './image-crop.js';
import { findIssues, idsOf, KIND_LABEL } from './team/identity.js';
// The SAME cleanup the admin editor uses — a server-side reference count across
// every table that holds a photo_url, then a trash only on a definite zero.
// Importing it (rather than writing a second one here) is the point: two
// implementations of "is this portrait still in use" is how the admin path got
// it right and this one silently did not.
import { deleteTeamPhotoIfUnused, photoToRetire } from './team/api.js';
// The same รหัสนักศึกษา / ชั้นปี / สาขา rules the admin form and the CSV importer
// use. A person fixing their own row is a THIRD writer to these columns, and it
// must not be the one that reintroduces `md` beside `MD`.
import {
  normalizeIdentityFields, SID_HINT, SID_PLACEHOLDER, majorKey,
} from './team/fields.js';
// ชั้นปี IS NOT A FIELD ON THIS CARD ANY MORE (0145) — it is computed, from the
// รหัสนักศึกษา above it plus the ปีการศึกษา the payload carries. It used to be
// `team_members.year`, a stored number nothing ever bumped, and the owner found
// all three of its failure modes in one sitting: an edit that silently reverted,
// a corrected รหัส that moved the รุ่น but not the ปี, and one person reading
// ปี 5 / จบแล้ว / ปี 5 on three screens. See src/js/study-year.js.
import {
  studyYear, studyYearLabel, offsetForPickedYear, setAcademicYear, yearBasis,
} from './study-year.js';
import {
  PERM_LABEL, VS_DEPT_LABEL, PROJECT_SEAT_LABEL, ADMIN_FEATURES,
} from './team-vocab.js';

// Cached per signed-in user. Keyed by uid so an account switch cannot show the
// previous person's ตำแหน่ง — the account switcher swaps the session in place
// (see the module-scope-cache entry in the mistakes log), and a plain boolean
// "already fetched" flag would survive that swap.
let cacheUid = null;
let cachePromise = null;

registerProfileCache(() => { cacheUid = null; cachePromise = null; });

export function clearMySeatCache() {
  cacheUid = null;
  cachePromise = null;
}

/** Resolves to the seat payload, or null if the caller has no posting / is
 *  signed out / the lookup failed. Callers treat all three the same: no card. */
export function loadMySeat(uid) {
  if (!uid) return Promise.resolve(null);
  if (cacheUid === uid && cachePromise) return cachePromise;
  cacheUid = uid;
  cachePromise = dbRest('/rpc/get_my_team_seat', { method: 'POST', body: {} })
    .then(({ data, error }) => {
      if (error) throw new Error(error.message || `HTTP ${error.status}`);
      // A person with no ตำแหน่ง gets the empty envelope, not an error — that is
      // the overwhelmingly common case (every ordinary student login), so it
      // must be silent rather than logged as a failure.
      if (!data || !Array.isArray(data.postings) || !data.postings.length) return null;
      // The ปีการศึกษา every ชั้นปี on this card is computed against (0141),
      // primed from the SAME payload rather than a second racing fetch — a card
      // that painted against the clock fallback and then never repainted is how
      // a derived value acquires its own staleness bug.
      setAcademicYear(data.academic_year);
      // Stamped here, not at the call site, so BOTH surfaces (home card and the
      // profile modal, which calls loadMySeat directly) can refetch and repaint
      // after a self-edit without each having to remember to pass it.
      data.__uid = uid;
      return data;
    })
    .catch((err) => {
      console.warn('my-seat: lookup failed:', err);
      return null;
    });
  return cachePromise;
}

const chips = (keys) => (keys || [])
  .map((k) => `<span class="myseat-chip">${escHtml(PERM_LABEL[k] || k)}</span>`)
  .join('');

/**
 * Permission key → the admin section it opens (`SECTION_META` in admin-main.js).
 *
 * They are NOT the same strings and that is the trap: the SAMO Shop permission
 * is `samoshop` while its section is `shop`, so linking `/admin/#${perm}` would
 * have produced a dead hash that silently falls back to ภาพรวม — the exact
 * "button implies a destination it does not reach" problem this map exists to
 * fix. `my-seat.test.js` pins every value against SECTION_META.
 */
export const PERM_SECTION = {
  pr: 'pr', vs: 'vs', samoshop: 'shop', projects: 'projects',
  creator: 'creator', team: 'team', team_edit: 'team',
  house: 'house',
};

/** Where — if anywhere — this person's grants actually let them go.
 *  `passport` does NOT open /admin/ (admin-main.js canUseAdmin gates on
 *  ADMIN_FEATURES, which excludes it), so linking a passport-only member there
 *  would hand them a door that bounces them. SAMO Passport is its own app. */
function ctaFor(seat) {
  const perms = seat.permissions || [];
  // ⚠️ A SCOPED grant carries NO capability key. `readPermInputs` drops `vs`
  // when a แผนก is chosen and `passport` when a ฝ่าย is chosen (0083,
  // scoped-is-not-full), so for those two the SCOPE *is* the grant. Reading
  // only `permissions` therefore answered "you have nothing" to the majority of
  // the people who hold them — measured 2026-08-30: 42 with a passport scope
  // and no `passport` key, 3 with a VS แผนก and no `vs` key. They were shown no
  // way in to a system they had been granted.
  //
  // `projects` is deliberately NOT in this list: a seat does not drop the key,
  // it accompanies it (measured: 0 people hold a seat without `projects`).
  // Adding it anyway would be harmless and is left out on purpose so this list
  // stays a statement about which keys get DROPPED.
  const reach = new Set(perms);
  if ((seat.vs_depts || []).length) reach.add('vs');
  // Land on the section this CARD is about, not the admin landing page. The
  // card's whole subject is ทีม SAMO, so "เปิดหน้าจัดการ" dropping the reader on
  // ภาพรวม made them navigate again to get where the button implied they were
  // going. `#team` is read by showAdminSide() in admin-main.js, which routes on
  // the first hash segment.
  if (perms.includes('team') || perms.includes('team_edit')) {
    return { href: '/admin/#team', label: 'เปิดหน้าทีม SAMO' };
  }
  // No ทีม SAMO rung but some other admin grant: if it is the ONLY one they
  // hold, go straight there rather than making them pick from a menu of one.
  const mine = ADMIN_FEATURES.filter((f) => reach.has(f));
  const section = mine.length === 1 ? PERM_SECTION[mine[0]] : null;
  if (section) return { href: `/admin/#${section}`, label: 'เปิดหน้าจัดการ' };
  if (mine.length) return { href: '/admin/', label: 'เปิดหน้าจัดการ' };
  if (perms.includes('passport') || (seat.passport_scopes || []).length) {
    return { href: '/passport/', label: 'เปิด SAMO Passport' };
  }
  return null;
}

/** The scope lines. Only rendered when a scope actually narrows something —
 *  "VitalSound: ทุกฝ่าย" is noise next to the VitalSound chip that already says
 *  it, whereas "VitalSound: เฉพาะฝ่ายวิชาการ" is the single most surprising
 *  fact about the grant and has to be said out loud. */
function scopeRows(seat) {
  const rows = [];
  const perms = seat.permissions || [];
  // ⚠️ A SCOPE UNDER MASTER UNDERSTATES IT. `master` IS the widest value of both
  // the VitalSound แผนก and the SAMO Passport ฝ่าย, so printing a narrower one
  // tells a master holder their access is limited when it is not. Measured
  // 2026-08-30: both master holders in the tree resolve to a vs_dept AND a
  // passport scope inherited from an ancestor node, so both were being shown
  // "VitalSound: เฉพาะ อุปนายกฝ่ายบริหารองค์กร" while reading every department.
  //
  // This is the same rule `permChipsHtml` already applies in the admin tree —
  // the SECOND READER of one fact, missed the first time round.
  //
  // The หนังสือโครงการ seat is deliberately NOT gated on this: a seat is an
  // IDENTITY (ผู้ส่ง / เจ้าหน้าที่ / อาจารย์), not a scope, there is no "all
  // three" desk, and master keeps whichever desk was stored.
  const hasMaster = perms.includes('master');

  const vs = seat.vs_depts || [];
  // `vs` (all depts) and a vs_dept are mutually exclusive by design (0083); if
  // both somehow appear, the broad one is what RLS will honour, so say that.
  if (!hasMaster && vs.length && !perms.includes('vs')) {
    rows.push(['VitalSound', `เฉพาะ ${vs.map((d) => VS_DEPT_LABEL[d] || d).join(' · ')}`]);
  }

  const seats = seat.project_seats || [];
  if (seats.length) {
    rows.push(['หนังสือโครงการ', seats.map((s) => PROJECT_SEAT_LABEL[s] || s).join(' · ')]);
  }

  const pass = seat.passport_scopes || [];
  if (!hasMaster && pass.length && !perms.includes('passport')) {
    rows.push(['SAMO Passport', `เฉพาะบางหน่วยงาน (${pass.length})`]);
  }
  return rows;
}

// ── the person's own record ────────────────────────────────────────────────

/** The identity fields, read off the FIRST posting. A person with two postings
 *  whose rows disagree gets a `drift` finding below saying exactly that, so
 *  picking one here is safe: the card never silently hides the disagreement. */
export const DETAIL_FIELDS = [
  // ชื่อ and นามสกุล are TWO fields since 0135, and that is a correctness fix,
  // not a layout one. This card used to offer one ชื่อ-สกุล box and then split
  // its value on whitespace on the way to ระบบบ้าน — so a person whose record
  // correctly read first="สมชาย ใจดี" last="ดีมาก" had it rewritten to
  // first="สมชาย" last="ใจดี ดีมาก" the first time they saved anything at all,
  // with `self_edited` then claiming they had chosen it. It is the same guess
  // the CSV importer refuses a whole file for making.
  { key: 'first_name_th', label: 'ชื่อ', editable: true },
  { key: 'last_name_th', label: 'นามสกุล', editable: true },
  { key: 'nickname', label: 'ชื่อเล่น', editable: true },
  { key: 'student_id', label: 'รหัสนักศึกษา', editable: true, hint: SID_HINT },
  // ชั้นปี — DERIVED, never read off a column (0145). `value` makes it a
  // calculation on the way to the screen, and `control: 'study_year'` makes the
  // edit box save the GAP (ลาพัก / เรียนซ้ำ) instead of the year, so it stays
  // right in 2570 without anyone touching it. Reported as "when i change ชั้นปี
  // in the main web, nothing happens" — it did nothing because the value it
  // wrote was mirrored back over from the registry a moment later.
  {
    key: 'study_year',
    label: 'ชั้นปี',
    editable: true,
    control: 'study_year',
    value: (p) => studyYearLabel(p) || '',
  },
  // A chooser for the same reason the admin form has one: md / MD / M.D. are
  // one answer spelled three ways, and the difference shows up as a
  // ตรวจสอบข้อมูล finding on the person who typed the second spelling.
  { key: 'major', label: 'สาขา', editable: true, control: 'major' },
  // `wide` puts a field on its own row. KKU Mail is ~3x the length of the
  // others, so sharing a row with them squeezed it into a quarter of the card
  // and it wrapped MID-ADDRESS ("somebody.ex@kkuma / il.com").
  { key: 'kkumail', label: 'KKU Mail', editable: false, wide: true },
];

/**
 * What is wrong with THIS person's record, in the words the admin pane uses.
 *
 * Pure and exported for the tests. Two sources:
 *  • the shared rule engine (findIssues) over the caller's own postings — this
 *    is what catches an invalid kkumail and two postings that disagree;
 *  • a plain "this field is empty" pass, which is not a `findIssues` kind but
 *    is what a member can actually act on, and is the common case.
 */
export function ownIssues(seat) {
  if (!seat) return [];
  const postings = seat.postings || [];
  if (!postings.length) return [];

  const out = [];
  const nodeName = (id) => (postings.find((p) => p.node_id === id) || {}).node || '';
  const { issues } = findIssues(
    postings.map((p) => ({
      id: p.member_id,
      node_id: p.node_id,
      full_name: p.full_name,
      nickname: p.nickname,
      major: p.major,
      photo_url: p.photo_url,
      student_id: p.student_id,
      kkumail: p.kkumail,
    })),
    nodeName,
  );
  for (const is of issues) {
    // Only findings that actually name one of this person's rows. Belt and
    // braces — every row fed in is theirs — but it keeps the guarantee local
    // rather than resting on the payload's contents.
    const mine = idsOf(is).filter((id) => postings.some((p) => p.member_id === id));
    if (!mine.length) continue;
    out.push({
      kind: is.kind,
      label: KIND_LABEL[is.kind] || is.kind,
      detail: is.kind === 'drift'
        ? `${is.fieldLabel}: ${(is.values || []).map((v) => v.value).join(' / ')}`
        : is.kind === 'sid_drift'
          ? (is.values || []).join(' / ')
          : is.value || '',
    });
  }

  // Missing fields. Reported once per field even across several postings —
  // "กรอกชั้นปี" twice is noise, and fixing it once fixes the person.
  const first = postings[0];

  // รหัสนักศึกษา shared with someone else. This is the ONE finding the rule
  // engine cannot reach from here: a clash is a fact about TWO people, and this
  // payload carries only one. The server counts the others (migration 0112) —
  // a count, never a name — and the wording matches the admin pane's, so the
  // person and the admin are talking about the same thing.
  if (Number(seat.student_id_shared_with) > 0) {
    out.push({
      kind: 'sid_clash',
      label: KIND_LABEL.sid_clash,
      // Names WHO to tell. "ผู้ดูแลทีม SAMO" is not a person anybody can find —
      // the people who can actually fix another person's row are the ฝ่าย's
      // อุปนายก and whoever holds ทีม SAMO (แก้ไข).
      detail: `${String(first.student_id ?? '').trim()} — มีอีก ${seat.student_id_shared_with} คนใช้รหัสนี้ `
        + 'ตรวจสอบว่ารหัสของคุณถูกต้อง หากถูกต้องแล้วให้แจ้งอุปนายกฝ่ายของท่าน '
        + 'หรือผู้ที่มีสิทธิ์แก้ไขทีม SAMO',
    });
  }

  // NOTE the `displayFields` call: for a posting that has only a combined name,
  // ชื่อ and นามสกุล are not "ยังไม่ได้กรอก" — they are a shape this app has not
  // asked that person for yet, and 399 members acquired their name before the
  // split existed. Nagging all of them for a field they cannot see would make
  // the findings list useless for the things it is actually for.
  // DERIVED FIELDS ARE NEVER "ยังไม่ได้กรอก". Reading ชั้นปี off
  // `first.study_year` — a column that does not exist — would report all 400
  // members as missing it; and even done correctly, "กรอกชั้นปี" is an
  // instruction nobody can follow, because the only way to fill it is the
  // รหัสนักศึกษา that is already on this list one line above. Ask for the
  // INGREDIENT, never for the calculation.
  const missing = displayFields(first)
    .filter((f) => !f.value && !fieldValue(f, first))
    .map((f) => f.label);
  if (missing.length) {
    out.push({ kind: 'missing', label: 'ข้อมูลยังไม่ครบ', detail: missing.join(' · ') });
  }
  if (!String(first.photo_url ?? '').trim()) {
    out.push({ kind: 'missing_photo', label: 'ยังไม่มีรูป', detail: '' });
  }
  return out;
}

function portraitHtml(p, size = 96) {
  const url = p.photo_url;
  const name = p.full_name || '';
  if (!url) {
    const initials = name.trim().split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('');
    return `<div class="myseat-photo myseat-photo--empty" aria-hidden="true">${escHtml(initials || '?')}</div>`;
  }
  // portraitSrc(), never convertDriveUrl(url, size) — the latter returns an
  // already-lh3 URL unchanged, so its size argument is a no-op for every URL
  // this app stores (logged in the mistakes log).
  return `<img class="myseat-photo" src="${escHtml(portraitSrc(url, size, p.photo_focus || 'center'))}"
    srcset="${escHtml(portraitSrcSet(url, [size, size * 2], p.photo_focus || 'center'))}"
    sizes="${size}px" alt="${escHtml(name)}" loading="lazy"
    style="object-position:${escHtml(focusToObjectPosition(p.photo_focus))}" />`;
}

/**
 * One posting, as ONE breadcrumb that ends at the ตำแหน่ง.
 *
 * Reported: "หัวหน้าฝ่าย IT / ฝ่ายดิจิทัลและสื่อสารองค์กร ฝ่าย IT — it should show
 * until the role like ฝ่ายดิจิทัลและสื่อสารองค์กร > ฝ่าย IT > หัวหน้าฝ่าย IT".
 * It used to print the ตำแหน่ง on one line and its ANCESTORS on another, so the
 * person's own ตำแหน่ง appeared first and then again by implication at the end of
 * a trail that stopped one level short of it. `team_node_path()` returns
 * ancestors only (root first, excluding the node), so the node name is appended
 * here — as the last, emphasised crumb, which is the one the reader is looking
 * for.
 */
function postingHtml(p) {
  const path = Array.isArray(p.path) ? p.path : [];
  const sep = ' <i class="bi bi-chevron-right" aria-hidden="true"></i> ';
  const crumbs = [
    ...path.map((seg) => `<span class="myseat-crumb">${escHtml(seg)}</span>`),
    `<span class="myseat-crumb is-self">${
      p.is_board ? '<i class="bi bi-award-fill myseat-board" aria-hidden="true"></i> ' : ''
    }${escHtml(p.node || '')}</span>`,
  ];
  return `
    <li class="myseat-posting">
      <span class="myseat-posting-path">${crumbs.join(sep)}</span>
    </li>`;
}

/**
 * The fields to DISPLAY for this person — which is not quite the list to EDIT.
 *
 * A posting created before 0135 has only a combined `full_name`, and showing it
 * against two empty ชื่อ / นามสกุล rows would report "ยังไม่ได้กรอก" directly
 * underneath a header printing the person's name. So the read view shows the
 * shape the row actually has: the split where there is one, the combined name
 * where that is all there is. The EDIT form always offers the two boxes —
 * that is how a row acquires the split, and the only way it ever should.
 */
export function displayFields(p) {
  const hasSplit = !!(String(p?.first_name_th ?? '').trim() || String(p?.last_name_th ?? '').trim());
  if (hasSplit || !String(p?.full_name ?? '').trim()) return DETAIL_FIELDS;
  return [
    { key: 'full_name', label: 'ชื่อ-สกุล', wide: true },
    ...DETAIL_FIELDS.filter((f) => f.key !== 'first_name_th' && f.key !== 'last_name_th'),
  ];
}

/** What this field READS as, for one posting. A field with a `value` function is
 *  a calculation (ชั้นปี), not a column — the read view, the "ยังไม่ได้กรอก"
 *  pass and the tests all have to go through here or they disagree about
 *  whether a derived field is filled in. */
export function fieldValue(f, p) {
  return String((f.value ? f.value(p) : p?.[f.key]) ?? '').trim();
}

function detailsHtml(p) {
  const rows = displayFields(p).map((f) => {
    const v = fieldValue(f, p);
    return `<div class="myseat-detail${v ? '' : ' is-empty'}${f.wide ? ' is-wide' : ''}">
      <dt>${escHtml(f.label)}</dt>
      <dd>${v ? escHtml(v) : '<span class="myseat-missing">ยังไม่ได้กรอก</span>'}</dd>
    </div>`;
  }).join('');
  return `<dl class="myseat-details">${rows}</dl>`;
}

/** The findings block. Its wording depends on whether the person may fix it —
 *  telling someone "แก้ไขได้เลย" when every write will 42501 is worse than
 *  saying nothing, and telling an admin to "ติดต่อฝ่าย IT" about their own
 *  record is absurd. */
function issuesHtml(issues, canFix) {
  if (!issues.length) return '';
  const items = issues.map((i) => `
    <li class="myseat-issue">
      <i class="bi bi-exclamation-triangle-fill" aria-hidden="true"></i>
      <span><strong>${escHtml(i.label)}</strong>${i.detail ? ` — ${escHtml(i.detail)}` : ''}</span>
    </li>`).join('');
  return `
    <div class="myseat-block myseat-issues">
      <span class="myseat-label">ข้อมูลที่ควรแก้</span>
      <ul class="myseat-issue-list">${items}</ul>
      ${canFix ? '' : '<p class="myseat-issue-hint">แจ้งอุปนายกฝ่ายของท่าน หรือผู้ที่มีสิทธิ์แก้ไขทีม SAMO เพื่อแก้ไขข้อมูลนี้</p>'}
    </div>`;
}

/**
 * The สาขา vocabulary (migration 0113), for the chooser.
 *
 * Module-scope and fetched once. It is three rows of non-confidential codes, so
 * a failed fetch is not fatal: the chooser then offers only what the person
 * already has, which is still better than a free-text box that lets them invent
 * a fourth spelling of MD.
 */
let majorOptions = null;
async function loadMajorOptions() {
  if (majorOptions) return majorOptions;
  try {
    const { data, error } = await dbRest('/team_majors?select=code,label&order=position.asc,code.asc');
    if (error) throw new Error(error.message);
    majorOptions = Array.isArray(data) ? data : [];
  } catch (err) {
    console.warn('my-seat: majors lookup failed:', err);
    majorOptions = [];
  }
  return majorOptions;
}

/** `<option>`s for a chooser, keeping an off-list stored value as its own option
 *  — a select that silently drops what the row holds would REWRITE that value on
 *  the next save of an unrelated field. */
function optionsHtml(values, current, labelOf = (v) => v) {
  const cur = String(current ?? '').trim();
  const known = values.some((v) => majorKey(v) === majorKey(cur));
  return `<option value="">— ไม่ระบุ —</option>`
    + values.map((v) => `<option value="${escHtml(v)}"${
      majorKey(v) === majorKey(cur) ? ' selected' : ''}>${escHtml(labelOf(v))}</option>`).join('')
    + (cur && !known
      ? `<option value="${escHtml(cur)}" selected>${escHtml(cur)} (ไม่อยู่ในรายการ)</option>` : '');
}

/**
 * The ชั้นปี chooser — shows YEARS, saves the GAP.
 *
 * ⚠️ THIS IS THE SAME CONTROL ระบบบ้าน HAS, ON PURPOSE, AND IT IS NOW THE ONLY
 * ONE. It is a copy of `studyYearFieldHtml` in `house/my-house.js` because the
 * two cards do not share a template — but they share the RULE, through
 * `study-year.js`, and `study-year.test.js` pins that both forms write an offset
 * and neither writes a year. The wording is deliberately identical: a person who
 * holds a ทีม SAMO posting sees this card, a person who does not sees the house
 * one, and they must not learn two explanations of the same box.
 *
 * WHAT IT WRITES, AND WHY THAT IS THE FIX. It used to be a plain `<select
 * name="year">` writing `team_members.year`. Two things were wrong with that,
 * and the owner hit both: the value was mirrored straight back over from the
 * registry a moment later ("nothing happens"), and even when it stuck it was an
 * ABSOLUTE year that nothing would ever bump — right for one August and silently
 * wrong every August after. What is stored now is `picked − computed`, so a
 * ลาพัก student sets it once and is still right in 2575.
 *
 * NO รหัสนักศึกษา, NO CHOOSER. There is nothing to count from, so the box is
 * disabled and names the field to fill in instead. Offering an absolute year for
 * these rows is exactly the column 0129 removed.
 */
function studyYearFieldHtml(p) {
  const computed = studyYear({ ...p, year_offset: 0 });
  if (computed === null) {
    return `
      <label class="myseat-field myseat-field--locked" data-myseat-year>
        <span>ชั้นปี</span>
        <input type="text" value="—" readonly />
        <em class="myseat-field-hint">กรอกรหัสนักศึกษาก่อน ระบบจะคำนวณชั้นปีให้เอง</em>
      </label>`;
  }
  const current = studyYear(p);
  const opts = [1, 2, 3, 4, 5, 6].map((y) => `<option value="${y}"${
    y === current ? ' selected' : ''}>ปี ${y}</option>`).join('');
  return `
    <label class="myseat-field" data-myseat-year>
      <span>ชั้นปี</span>
      <select name="study_year">
        <option value=""${p.year_offset ? '' : ' selected'}>ตามที่ระบบคำนวณ (ปี ${computed})</option>
        ${opts}
      </select>
      <em class="myseat-field-hint">
        ปกติไม่ต้องแก้ — ระบบเลื่อนชั้นปีให้เองทุกปีจากรหัสนักศึกษา
        เลือกเองเฉพาะกรณีลาพัก เรียนซ้ำ หรือจบช้า แล้วระบบจะจำส่วนต่างไว้ให้ตลอด
      </em>
    </label>`;
}

/**
 * The inline self-edit form. Only the columns migration 0110 lets a member
 * write — kkumail is shown read-only because it is the identity every resolver
 * keys on, and changing it would move the row out of the caller's own SELECT
 * policy (an un-PATCHable UPDATE, logged in the mistakes log).
 *
 * The photo is part of it (the ยังไม่มีรูป finding used to point at an admin the
 * person then had to go and find), and it follows the same rule as the admin
 * form: NOTHING is uploaded until บันทึก. Uploading on pick is what left orphan
 * files in Drive.
 */
function editFormHtml(p) {
  const majors = (majorOptions || []).map((m) => m.code);
  const majorLabel = (code) => {
    const hit = (majorOptions || []).find((m) => m.code === code);
    return hit?.label ? `${code} — ${hit.label}` : code;
  };
  const field = (f) => {
    if (f.control === 'study_year') return studyYearFieldHtml(p);
    const val = String(p[f.key] ?? '');
    const inner = f.control === 'major'
      ? `<select name="major">${optionsHtml(majors, val, majorLabel)}</select>`
      : `<input type="text" name="${escHtml(f.key)}" value="${escHtml(val)}"${
        f.key === 'student_id' ? ` inputmode="numeric" placeholder="${SID_PLACEHOLDER}"` : ''} />`;
    return `
    <label class="myseat-field${f.wide ? ' is-wide' : ''}">
      <span>${escHtml(f.label)}</span>
      ${inner}
      ${f.hint ? `<em class="myseat-field-hint">${escHtml(f.hint)}</em>` : ''}
    </label>`;
  };
  return `
    <form class="myseat-edit" data-myseat-form hidden>
      <p class="myseat-edit-intro">แก้ไขข้อมูลส่วนตัวของคุณได้ที่นี่ ส่วนตำแหน่งและสิทธิ์ อุปนายกฝ่ายหรือผู้ที่มีสิทธิ์แก้ไขทีม SAMO เป็นผู้กำหนด</p>

      <div class="myseat-photo-edit">
        <div class="myseat-photo-frame" data-myseat-photo>${portraitHtml(p, 96)}</div>
        <div class="myseat-photo-actions">
          <label class="myseat-photo-btn">
            <input type="file" accept="image/*" data-myseat-photo-file hidden />
            <i class="bi bi-camera" aria-hidden="true"></i>
            ${p.photo_url ? 'เปลี่ยนรูป' : 'เพิ่มรูป'}
          </label>
          <button type="button" class="myseat-photo-remove${p.photo_url ? '' : ' is-hidden'}"
            data-myseat-photo-remove>นำรูปออก</button>
          <em class="myseat-photo-note" data-myseat-photo-note>รูปนี้แสดงบนหน้าโครงสร้างองค์กรที่เปิดให้บุคคลทั่วไปดูได้</em>
        </div>
      </div>

      <div class="myseat-fields">
        ${DETAIL_FIELDS.filter((f) => f.editable).map(field).join('')}
      </div>
      ${(!String(p.first_name_th ?? '').trim() && !String(p.last_name_th ?? '').trim()
        && String(p.full_name ?? '').trim())
        ? `<p class="myseat-field-hint myseat-name-legacy">ชื่อในระบบตอนนี้:
             <strong>${escHtml(String(p.full_name).trim())}</strong> —
             ระบบไม่แยกชื่อกับนามสกุลให้เอง เพราะนามสกุลไทยมีเว้นวรรคได้
             (เช่น “ณ อยุธยา”) ถ้าเดาอาจได้ชื่อผิด
             กรอกแยกช่องด้านบนได้เลย หรือปล่อยว่างไว้เพื่อใช้ชื่อเดิม</p>`
        : ''}
      <label class="myseat-field myseat-field--locked is-wide">
        <span>KKU Mail</span>
        <input type="text" value="${escHtml(String(p.kkumail ?? ''))}" readonly />
        <em class="myseat-field-hint">เปลี่ยนไม่ได้ — เป็นอีเมลที่ใช้จับคู่ตำแหน่งของคุณ</em>
      </label>
      <div class="myseat-edit-actions">
        <button type="submit" class="myseat-save">บันทึก</button>
        <button type="button" class="myseat-cancel" data-myseat-cancel>ยกเลิก</button>
        <span class="myseat-edit-status" data-myseat-status role="status"></span>
      </div>
    </form>`;
}

/**
 * Paint the card into `host`.
 * @param {HTMLElement|null} host
 * @param {object|null} seat  payload from loadMySeat(), or null
 * @param {{ compact?: boolean }} [opts] compact drops the eyebrow — the
 *        profile modal already has a "ตำแหน่งในทีม SAMO" heading above it, and
 *        saying it twice reads as a rendering bug. (This stopped being wired
 *        up when the duplicated name was removed; re-pointed at the eyebrow
 *        rather than deleted, because the modal genuinely needs the difference.)
 */
export function renderMySeat(host, seat, opts = {}) {
  if (!host) return;
  if (!seat) { host.hidden = true; host.innerHTML = ''; return; }

  const perms = seat.permissions || [];
  const rows = scopeRows(seat);
  const cta = ctaFor(seat);
  const postings = seat.postings || [];
  const me = postings[0] || {};
  // The person's name, said ONCE. It used to appear twice — in the header and
  // again beside the portrait — which read as a rendering bug on the home card.
  // คำนำหน้า used to lead this line; migration 0113 dropped the column.
  const who = [seat.name, seat.nickname ? `(${seat.nickname})` : '']
    .filter(Boolean).join(' ');
  const issues = ownIssues(seat);

  host.hidden = false;
  host.innerHTML = `
    <div class="myseat-card">
      ${opts.compact ? '' : `
      <div class="myseat-head">
        <span class="myseat-eyebrow"><i class="bi bi-person-vcard-fill" aria-hidden="true"></i> ข้อมูลของฉัน</span>
      </div>`}

      <div class="myseat-person">
        ${portraitHtml(me)}
        <div class="myseat-person-body">
          ${who ? `<p class="myseat-name">${escHtml(who)}</p>` : ''}
          <ul class="myseat-postings">${postings.map(postingHtml).join('')}</ul>
        </div>
      </div>

      ${detailsHtml(me)}
      ${me.member_id ? `
        <button type="button" class="myseat-fix myseat-fix--quiet" data-myseat-edit>
          <i class="bi bi-pencil" aria-hidden="true"></i> แก้ไขข้อมูลของฉัน
        </button>` : ''}
      ${editFormHtml(me)}
      ${issuesHtml(issues, !!me.member_id)}

      <!-- ONE CARD, SECTIONS INSIDE IT. Reported: two sibling cards "look
           worse ... i thought it would be like one card". They did — two
           eyebrows, two portraits, two identity blocks and a note pointing up
           at a card already scrolled past. A person is ONE thing; ทีม SAMO and
           ระบบบ้าน are facts ABOUT them, so they are sections under one heading
           rather than cards competing with it. -->
      <section class="myprofile-section">
        <h3 class="myprofile-section-title">
          <i class="bi bi-diagram-3-fill" aria-hidden="true"></i> ทีม SAMO
        </h3>

        ${perms.length ? `
          <div class="myseat-block">
            <span class="myseat-label">สิทธิ์ที่ได้รับ</span>
            <div class="myseat-chips">${chips(perms)}</div>
          </div>` : `
          <p class="myseat-none">ตำแหน่งนี้ยังไม่ได้รับสิทธิ์ใช้งานระบบใด</p>`}

        <!-- WHO TO ASK, SAID ALWAYS. This used to appear only when the person
             had NO permissions at all — but "I have the wrong ตำแหน่ง" and "I
             can see a system I should not" are just as common as "I have
             nothing", and those people were shown no route at all. The card is
             the one place in the app that tells someone what they are, so it is
             the place they will be standing when they notice it is wrong. -->
        <p class="myseat-help">
          <i class="bi bi-info-circle" aria-hidden="true"></i>
          ถ้าสิทธิ์ที่ได้รับ หรือตำแหน่งที่ได้รับไม่ถูกต้อง
          กรุณาติดต่ออุปนายกฝ่ายของท่าน หรือผู้ที่มีสิทธิ์แก้ไขทีม SAMO
          — ดูได้ว่าใครมีสิทธิ์อะไรในองค์กรที่หน้า
          <a href="/admin/#team">ทีม SAMO (Admin)</a>
        </p>

        ${rows.length ? `
          <div class="myseat-block">
            <span class="myseat-label">ขอบเขต</span>
            <dl class="myseat-scopes">${rows.map(([k, v]) => `
              <div><dt>${escHtml(k)}</dt><dd>${escHtml(v)}</dd></div>`).join('')}</dl>
          </div>` : ''}

        ${cta ? `
          <a class="myseat-cta" href="${cta.href}">
            ${escHtml(cta.label)} <i class="bi bi-arrow-right" aria-hidden="true"></i>
          </a>` : ''}
      </section>

      <!-- ระบบบ้าน paints itself in here (my-house.js, section mode). Empty for
           anyone with no house record, and the :empty rule hides it, so this
           costs nothing for the people it does not apply to. -->
      <div class="myprofile-slot" data-profile-slot="house"></div>

      <!-- เชื่อมบัญชี Discord paints itself in here (discord-link.js), on the
           same terms: empty — and therefore hidden — for anyone not in ทีม SAMO
           and whenever the server has no OAuth config. Both emptinesses are
           deliberate; a button that can only fail is worse than no button. -->
      <div class="myprofile-slot" data-profile-slot="discord"></div>

      <!-- LAST LINE OF THE CARD, deliberately. Everything above answers "what
           am I"; this answers "what if the answer is broken". Points at the two
           channels that already exist rather than inventing a third. -->
      <p class="myseat-help myseat-help--report">
        <i class="bi bi-bug" aria-hidden="true"></i>
        หากมีปัญหาอื่น ๆ เว็บมีปัญหา หรือพบบัค แจ้งได้ที่แท็บ
        <a href="/vssound">แจ้งปัญหา (VitalSound)</a>
        หรือพิมพ์ใน Discord ช่อง <strong>#report-ปัญหาเว็บสโม</strong>
      </p>
    </div>`;

  wireSelfEdit(host, seat);
  // This render just replaced the ระบบบ้าน slot's contents along with everything
  // else — "a shared render() that repaints a pane another module owns" is an
  // entry in mistakes.md, and a save on this card would otherwise make the house
  // section silently vanish. The owner of that pane is invited to repaint it.
  if (typeof opts.afterRender === 'function') opts.afterRender(host);
}

/** The self-edit round trip. Writes ONLY the columns migration 0110 allows; the
 *  server guard (team_members_self_update_guard) is the real boundary and
 *  refuses anything else, so this list is a UI convenience, not the security. */
function wireSelfEdit(host, seat) {
  // renderMySeat's contract is "anything with .innerHTML and .hidden" — the
  // unit tests assert the MARKUP against a plain object, with no DOM at all.
  // Behaviour wiring is therefore opt-in on a real element rather than assumed.
  if (typeof host.querySelector !== 'function') return;
  const form = host.querySelector('[data-myseat-form]');
  const details = host.querySelector('.myseat-details');
  if (!form) return;
  const status = form.querySelector('[data-myseat-status]');
  const show = (on) => {
    form.hidden = !on;
    if (details) details.hidden = on;
    host.querySelectorAll('[data-myseat-edit]').forEach((b) => { b.hidden = on; });
  };

  // ── the ชั้นปี chooser follows the รหัส, live ─────────────────────────────
  //
  // The รหัสนักศึกษา IS the base the offset is measured from, so a chooser that
  // does not move while the รหัส is being corrected shows the OLD computation
  // ("ตามที่ระบบคำนวณ (ปี 5)") beside a รหัส that now says ปี 10 — and picking
  // from it stores a difference against a base that no longer exists. The other
  // two forms that carry this control (ระบบบ้าน admin, ทีม SAMO admin) already
  // repaint; this one is the third writer, and "a fix on ONE path is not a fix".
  const me0 = (seat.postings || [])[0] || {};
  const repaintYear = () => {
    // `[data-myseat-year]`, not `.myseat-field--locked` — the no-รหัส branch of
    // studyYearFieldHtml renders as a LOCKED field, and so does the KKU Mail
    // box, so a class-based lookup would swap the address for a year chooser.
    const slot = form.querySelector('[data-myseat-year]');
    const sidBox = form.querySelector('[name="student_id"]');
    if (!slot || !sidBox) return;
    const next = document.createElement('div');
    next.innerHTML = studyYearFieldHtml(yearBasis(me0, sidBox.value));
    const fresh = next.firstElementChild;
    if (fresh) slot.replaceWith(fresh);
  };
  form.querySelector('[name="student_id"]')?.addEventListener('change', repaintYear);

  host.querySelectorAll('[data-myseat-edit]').forEach((b) => b.addEventListener('click', () => {
    show(true);
    // Fill the สาขา chooser the first time the form is actually opened, not on
    // every card paint: the list is only needed by someone editing, and the card
    // renders for every signed-in member on the home page.
    loadMajorOptions().then(() => {
      const sel = form.querySelector('[name="major"]');
      if (!sel) return;
      const cur = sel.value;
      sel.innerHTML = optionsHtml(
        (majorOptions || []).map((m) => m.code), cur,
        (code) => {
          const hit = (majorOptions || []).find((m) => m.code === code);
          return hit?.label ? `${code} — ${hit.label}` : code;
        },
      );
    });
  }));
  form.querySelector('[data-myseat-cancel]')?.addEventListener('click', () => show(false));

  // ── the photo. Framed here, uploaded on บันทึก (see the admin form's
  // memberPhotoPending for the bug that rule exists to prevent: an upload on
  // PICK leaves a file in Drive that nothing will ever reference).
  const me = (seat.postings || [])[0] || {};
  let pendingPhoto = null;       // { file, previewUrl }
  let removePhoto = false;
  const frame = form.querySelector('[data-myseat-photo]');
  const note = form.querySelector('[data-myseat-photo-note]');
  const removeBtn = form.querySelector('[data-myseat-photo-remove]');
  const dropPending = () => {
    if (pendingPhoto?.previewUrl) URL.revokeObjectURL(pendingPhoto.previewUrl);
    pendingPhoto = null;
  };

  form.querySelector('[data-myseat-photo-file]')?.addEventListener('change', async (ev) => {
    const picked = ev.target.files?.[0];
    ev.target.value = '';               // re-picking the same file must re-fire
    if (!picked) return;
    let file;
    try {
      file = await cropImage(picked, {
        title: 'ปรับกรอบรูปของฉัน',
        hint: 'กรอบนี้คือสิ่งที่แสดงบนหน้าโครงสร้างองค์กร — ลากให้ใบหน้าอยู่กลางกรอบ',
      });
    } catch (err) {
      if (note) note.textContent = `เปิดรูปไม่สำเร็จ: ${err?.message || err}`;
      return;
    }
    if (!file) return;
    dropPending();
    removePhoto = false;
    pendingPhoto = { file, previewUrl: URL.createObjectURL(file) };
    if (frame) frame.innerHTML = `<img class="myseat-photo" src="${escHtml(pendingPhoto.previewUrl)}" alt="" />`;
    if (removeBtn) removeBtn.classList.remove('is-hidden');
    if (note) note.textContent = 'รูปใหม่ยังไม่ถูกบันทึก — กดบันทึกเพื่ออัปโหลด';
  });

  removeBtn?.addEventListener('click', () => {
    dropPending();
    removePhoto = true;
    if (frame) frame.innerHTML = portraitHtml({ full_name: me.full_name }, 96);
    removeBtn.classList.add('is-hidden');
    if (note) note.textContent = 'จะนำรูปออกเมื่อกดบันทึก';
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const memberId = me.member_id;
    if (!memberId) return;

    // Canonicalise through the shared rules, and refuse a รหัสนักศึกษา that was
    // CHANGED into something unreadable. Unchanged legacy values pass: a person
    // whose stored รหัส is already malformed must still be able to fix their
    // ชื่อเล่น (and the ตรวจสอบข้อมูล list right below the form is what tells them
    // the รหัส itself needs attention).
    const raw = {};
    for (const f of DETAIL_FIELDS.filter((x) => x.editable && x.control !== 'study_year')) {
      const el = form.querySelector(`[name="${f.key}"]`);
      if (el) raw[f.key] = el.value.trim();
    }
    const fields = normalizeIdentityFields(raw, (majorOptions || []).map((m) => m.code));
    const sidProblem = fields.problemFor('student_id');
    if (sidProblem && String(me.student_id ?? '') !== String(raw.student_id ?? '')) {
      if (status) status.textContent = sidProblem.message;
      form.querySelector('[name="student_id"]')?.focus();
      return;
    }

    // THE NAME, as two fields (0135). Three cases, and the third is the one the
    // old single-box version got wrong:
    //  • both filled → the split is what gets written, everywhere;
    //  • both empty  → the row keeps whatever name it has. A pre-0135 posting
    //    carries only a combined `full_name` and nothing here may cut it up, so
    //    a person editing their ชื่อเล่น must not be forced to invent a boundary;
    //  • one filled  → refused, because half a split written over a whole name
    //    leaves someone with no surname and no trace of how.
    const firstName = raw.first_name_th || '';
    const lastName = raw.last_name_th || '';
    const hadName = !!String(me.full_name ?? '').trim();
    if (firstName && !lastName) {
      if (status) status.textContent = 'กรุณากรอกนามสกุล';
      form.querySelector('[name="last_name_th"]')?.focus();
      return;
    }
    if (lastName && !firstName) {
      if (status) status.textContent = 'กรุณากรอกชื่อ';
      form.querySelector('[name="first_name_th"]')?.focus();
      return;
    }
    if (!firstName && !lastName && !hadName) {
      if (status) status.textContent = 'กรุณากรอกชื่อและนามสกุล';
      form.querySelector('[name="first_name_th"]')?.focus();
      return;
    }

    // ชั้นปี → the GAP, measured against the รหัสนักศึกษา BEING SAVED, not the one
    // on screen when the form opened. Someone who fixes a mistyped รหัส in the
    // same save has just moved the base the offset is relative to, and measuring
    // against the old one would store a difference that means something else the
    // moment the row lands.
    const yearSel = form.querySelector('[name="study_year"]');
    const pickedYear = yearSel ? yearSel.value.trim() : '';
    const yearOffset = pickedYear
      ? offsetForPickedYear({ ...yearBasis(me, fields.student_id), year_offset: 0 }, pickedYear)
      : null;

    const body = {
      nickname: raw.nickname || null,
      student_id: fields.student_id,
      major: fields.major,
    };
    if (firstName || lastName) {
      body.first_name_th = firstName || null;
      body.last_name_th = lastName || null;
      // Sent so the on-screen row updates without a refetch. The DB derives the
      // same string from the same two parts (team_members_sync_full_name), so
      // these cannot disagree — it is a join, not a second rule.
      body.full_name = `${firstName} ${lastName}`.trim();
    }

    const btn = form.querySelector('.myseat-save');
    if (btn) { btn.disabled = true; btn.textContent = 'กำลังบันทึก…'; }
    if (status) status.textContent = '';
    // Snapshot BEFORE the upload can overwrite body.photo_url — this is the file
    // the row is about to stop pointing at.
    const prevPhoto = String(me.photo_url || '').trim();
    try {
      if (pendingPhoto) {
        if (btn) btn.textContent = 'กำลังอัปโหลดรูป…';
        // Filed under Team/<ปีการศึกษา>/<ฝ่าย>/ exactly as the admin upload is —
        // term_year comes from the payload (0113) and the ฝ่าย is the ROOT of this
        // person's path, so one human's portraits stay in one folder whichever
        // surface uploaded them.
        const res = await uploadTeamPhoto(pendingPhoto.file, {
          year: seat.term_year || 'unsorted',
          dept: (Array.isArray(me.path) && me.path[0]) || me.node || 'ทั่วไป',
          // The person's OWN position, so the Drive folder sorts the way the
          // ตำแหน่ง list does. This was a hardcoded 0, which is why every
          // portrait uploaded from this card — the one ordinary members use —
          // landed as "00-…" and the numeric prefix stopped meaning anything.
          order: me.position ?? 0,
          // SAME FALLBACK CHAIN AS THE ADMIN EDITOR. `body.full_name` is only
          // assigned when at least one name box is non-empty, so a legacy
          // combined-name row (pre-0135, both boxes blank) passed `undefined`
          // here and every such upload was filed as "00-member.jpg" — which is
          // the reported symptom. uploadPendingPhoto() in team/index.js already
          // falls back to the row's stored full_name; this writer did not, the
          // same "implemented on the writers you happened to be looking at"
          // shape as the portrait cleanup that skipped this very file.
          name: body.full_name
            || String(me.full_name || '').trim()
            || String(me.nickname || '').trim()
            || 'member',
        });
        body.photo_url = res.url;
        // The framed file IS 3:4, so the stored crop anchor must go back to
        // centre — leaving a legacy 'top' would re-crop the new photo.
        body.photo_focus = 'center';
      } else if (removePhoto) {
        body.photo_url = null;
      }
      // A person with TWO postings has two rows to keep in step — writing only
      // the first would CREATE the `drift` finding this card exists to clear.
      // This is also what makes the admin ทีม SAMO pane show what the person
      // typed: every row carrying their kkumail is the same edit.
      const ids = (seat.postings || []).map((p) => p.member_id).filter(Boolean);
      const { data, error } = await dbRest(
        `/team_members?id=in.(${ids.join(',')})`,
        { method: 'PATCH', body, prefer: 'return=representation' },
      );
      // dbRest returns { data: [] } on an RLS-blocked write rather than an
      // error — the silent-success trap. A zero-length result IS the failure.
      if (error) throw new Error(error.message || `HTTP ${error.status}`);
      if (!Array.isArray(data) || !data.length) throw new Error('ไม่มีสิทธิ์แก้ไขข้อมูลนี้');

      // …and the SAME edit into ระบบบ้าน, for a person who is in both (0132).
      // This is the second half of "one account": the seat card is where the
      // identity is edited, so its save has to reach the other placement or the
      // two say different things about one human until an admin notices.
      //
      // Best-effort and deliberately AFTER the write above: a student who has
      // no ระบบบ้าน record — every shared department account — gets a no-op, and
      // a failure here must not report the ทีม SAMO save (which landed) as
      // failed. `update_my_identity` resolves the caller from auth.uid() and is
      // a no-op when there is no students row.
      try {
        await dbRest('/rpc/update_my_identity', {
          method: 'POST',
          body: {
            p_patch: {
              // Only what ระบบบ้าน also holds — and the NAME travels as the two
              // parts the person typed. It used to be reconstructed here by
              // splitting `full_name` on whitespace, which rewrote the ชื่อ /
              // นามสกุล of anyone whose real name did not have exactly one
              // space in it (0135). Nothing splits a name any more; a person
              // who has not supplied a split simply does not send one, and the
              // keys are absent rather than empty so the RPC leaves the stored
              // pair alone (an absent key means "keep", 0126).
              nickname_self: body.nickname ?? '',
              student_id: body.student_id ?? '',
              major: body.major ?? '',
              // ชั้นปี, as the GAP (0131/0145). It goes ONLY here, never in the
              // team_members PATCH above: `year_offset` is a registry column
              // mirrored down onto the posting, so a direct PATCH would be
              // undone by person_mirror_down on the very next write — which is
              // precisely the revert that made the old ชั้นปี box appear dead.
              // Empty string means "ตามที่ระบบคำนวณ" and the RPC stores null.
              year_offset: yearOffset === null ? '' : String(yearOffset),
              ...(body.first_name_th
                ? { first_name_th: body.first_name_th, last_name_th: body.last_name_th }
                : {}),
            },
          },
        });
      } catch (syncErr) {
        console.warn('my-seat: ระบบบ้าน sync skipped:', syncErr);
      }
      // THE PREVIOUS PORTRAIT, now that the row points somewhere else.
      //
      // REPORTED: "when i เปลี่ยนรูป it changes the picture but the old picture
      // of me is still in the drive". It was: this card uploaded and repointed
      // the row and then walked away, so every เปลี่ยนรูป and every นำรูปออก left
      // its file in Drive, shared "anyone with the link", forever. The admin
      // editor has cleaned up since 0143 — this surface, which is the one every
      // ordinary member uses, never did. One rule, two writers, and only one of
      // them knew about it.
      //
      // AFTER the write, never on the pick or the นำรูปออก click: the count is
      // only the truth once the row has already been repointed, and deleting
      // earlier would destroy a photo the database still uses if the person
      // then cancels. deleteTeamPhotoIfUnused counts across all five tables
      // server-side and keeps the file on any answer that is not a definite
      // zero, so a person with two postings sharing one portrait is safe.
      const retire = photoToRetire(prevPhoto, body);
      if (retire) deleteTeamPhotoIfUnused(retire);
      dropPending();
      // BOTH caches. The house section repaints from its OWN cache through
      // opts.afterRender, so clearing only this one showed the new รหัสนักศึกษา
      // beside the รุ่น derived from the old one until a page refresh.
      clearProfileCaches();
      const fresh = await loadMySeat(seat.__uid);
      renderMySeat(host, fresh || seat, seat.__opts || {});
    } catch (err) {
      if (status) status.textContent = `บันทึกไม่สำเร็จ: ${err.message || err}`;
      if (btn) { btn.disabled = false; btn.textContent = 'บันทึก'; }
    }
  });
}

/** Convenience for the two call sites: fetch (cached) then paint. */
export async function showMySeat(host, uid, opts) {
  if (!host) return;
  if (!uid) { renderMySeat(host, null); return; }
  const seat = await loadMySeat(uid);
  if (seat) seat.__opts = opts || {};
  renderMySeat(host, seat, opts);
}
