// team-vocab.js — the display vocabulary for ทีม SAMO grants.
//
// These four lists were previously literals inside src/js/team/index.js, which
// is an ADMIN-only module. The public site now has to name the same things (the
// "ตำแหน่งของฉัน" card tells a signed-in member what they hold), and copying the
// labels across the two entry points is the "two implementations of one rule
// drift" bug from mistakes.md waiting to happen — a permission key renamed in
// the admin catalogue would silently render as a raw key on the public card.
//
// So: ONE source, imported by both. Values are contracts with the database and
// must not be edited casually:
//   • PERM_CATALOG keys      → team_nodes/team_members.permissions[] and every
//                              current_user_has_permission('…') branch in RLS.
//   • VS_DEPTS values        → vs_tickets.target_dept, matched by string.
//   • PROJECT_SEATS values   → team_*.project_seat (migration 0086).
// Labels are display-only and safe to reword.

import { DEPT_OPTIONS } from '../data/depts.js';

export const PERM_CATALOG = [
  { key: 'pr',        label: 'PR', icon: 'bi-megaphone' },
  { key: 'vs',        label: 'VitalSound', icon: 'bi-soundwave' },
  { key: 'samoshop',  label: 'SAMO Shop', icon: 'bi-bag' },
  { key: 'projects',  label: 'หนังสือโครงการ', icon: 'bi-file-earmark-text' },
  { key: 'creator',   label: 'เขียนประกาศ', icon: 'bi-newspaper' },
  // `implicit` = the server grants this to every person in the tree, so the
  // checkbox cannot turn it off. See IMPLICIT_PERMS below.
  { key: 'team',      label: 'ทีม SAMO (ดู)', implicit: true, icon: 'bi-people',
    hint: 'ทุกคนที่มีอีเมลอยู่ในผังทีมได้สิทธิ์นี้อัตโนมัติ — ปิดไม่ได้' },
  { key: 'team_edit', label: 'ทีม SAMO (แก้ไข)', icon: 'bi-people-fill',
    hint: 'แก้ไขโครงสร้าง สมาชิก และสิทธิ์ของทุกคน' },
  { key: 'passport',  label: 'SAMO Passport', icon: 'bi-airplane' },
  // Migration 0116. ONE rung on purpose — there is no house_edit yet. The
  // obvious second audience (an อาจารย์ seeing only their own สาย) is a SCOPE,
  // not a rung, and อาจารย์ have no login today.
  { key: 'house',     label: 'ระบบบ้าน', icon: 'bi-house-heart',
    hint: 'จัดการบ้าน สายรหัส อาจารย์ที่ปรึกษา และข้อมูลนักศึกษาทั้งคณะ' },
  // Migration 0154. ONE rung, like `house`: everyone who holds it can see the
  // whole board and book on it. There is deliberately no view-only rung — a
  // shared calendar you may read but never claim a slot on is a notice board,
  // and that is not what anyone asked for.
  { key: 'claude',    label: 'จองโควตา Claude', icon: 'bi-stars',
    hint: 'จองช่วงเวลาใช้งาน Claude ของสโม และดูว่าใครจองอะไรไว้บ้าง' },
  // Migration 0208. ONE rung: see the bot's health AND switch it — a panel you
  // may read but never act on would only tell you something is wrong.
  { key: 'discord_bot', label: 'บอท Discord', icon: 'bi-discord',
    hint: 'ดูสถานะและเปิด/ปิดบอทที่จัด role และชื่อใน Discord ให้ตรงกับทีม SAMO' },
  // Migration 0177. THE BLANKET RUNG: every ฝ่าย page. Most holders should get
  // a SCOPE instead (DEPT_PAGES below) — one ฝ่าย, their own. The two are
  // mutually exclusive by construction, see the ⛔ on DEPT_PAGES.
  { key: 'dept_pages', label: 'หน้าฝ่าย (ทุกฝ่าย)', icon: 'bi-pencil-square',
    hint: 'แก้เนื้อหาหน้าฝ่ายได้ทุกฝ่าย — ถ้าต้องการให้แก้ได้ฝ่ายเดียว เลือกฝ่ายด้านล่างแทน' },
  { key: 'master',    label: 'ทุกระบบ (Master)', icon: 'bi-shield-lock-fill',
    hint: 'เข้าถึงทุกระบบทั้งหมด รวมถึงการจัดการสิทธิ์ของทุกคน',
    danger: true },
];
/**
 * Lookup maps with NO PROTOTYPE.
 *
 * These are keyed by values that come out of the database — `permissions` is an
 * admin-writable `text[]`, `vs_dept` and `project_seat` are plain columns — and
 * a plain object answers `constructor`, `toString`, `valueOf` and `__proto__`
 * with an inherited FUNCTION instead of missing. That is not a hypothetical
 * shape: every reader here is written as `MAP[key] || key`, so an inherited
 * member is truthy and wins the `||`. A permission key of `constructor` rendered
 * a chip labelled `function Object() { [native code] }`, and `PERM_ICON` fed the
 * same string straight into a `class` attribute unescaped.
 *
 * `Object.create(null)` makes every one of those a clean miss, so the `|| key`
 * fallback does what it reads like. Nothing in this repo asks these maps for a
 * prototype method (checked), and spread / JSON.stringify / for-in are all
 * unaffected.
 */
const byKey = (pairs) => Object.assign(Object.create(null), Object.fromEntries(pairs));

export const PERM_ICON = byKey(PERM_CATALOG.map((p) => [p.key, p.icon || '']));
export const PERM_LABEL = byKey(PERM_CATALOG.map((p) => [p.key, p.label]));

// ทีม SAMO is the one capability with two rungs (migration 0110). They are NOT
// independent: `team_edit` is strictly stronger and every read policy accepts
// either, so storing both on one row would be redundant — and worse, it would
// make them LOOK independent, which is how someone ends up unticking the one
// that was actually load-bearing (the 0083 "scope beside an unconditional
// permission" trap). `readPermInputs` drops `team` when `team_edit` is set.
export const TEAM_VIEW = 'team';
export const TEAM_EDIT = 'team_edit';

/**
 * Permissions the SERVER hands out on its own, which no form may claim to set.
 *
 * `team` is the only one: since 0110 `effective_team_permissions_for_email()`
 * appends it for anybody with a posting in the tree, so an admin who unticked
 * the box saved an array without it and the resolver put it straight back. The
 * control looked like a decision and was not one — the shape this repo calls
 * "a class in the markup with no rule behind it", except here the rule exists
 * and simply overrules the UI.
 *
 * Why LOCKED-AND-TICKED rather than removed from the grid: the grid is also how
 * an admin READS what somebody holds. Dropping the row would make ทีม SAMO (ดู)
 * invisible and leave the reader unsure whether view access exists at all.
 * Shown, ticked, disabled, with the reason in the hint.
 *
 * And there is no revoke case to design for: "this person should not see the
 * roster" means they are not on the team, and the fix is to remove their
 * posting — not to leave them in the tree with a box unticked. If a real
 * need for a posting-without-visibility ever appears it is a new column on the
 * row (a hidden/observer flag), not a permission the resolver already grants.
 */
export const IMPLICIT_PERMS = PERM_CATALOG.filter((p) => p.implicit).map((p) => p.key);

/**
 * The one grant that answers YES to every permission question (migration 0111).
 *
 * Mirrored from SQL: `current_user_has_permission()` returns true for ANY key
 * when the caller holds this one. The mirror is the risk — a rule implemented
 * on both sides of the wire drifts — so `userCanAccess()` in auth.js is the
 * ONLY JS reader, and `team-vocab.test.js` pins the two together.
 *
 * It is a permission, NOT a role: it never satisfies `current_user_is_staff()`,
 * so a master still cannot promote themselves to `role='dev'` or write
 * `users.permissions`. That boundary is what keeps a tree grant revocable.
 */
export const MASTER = 'master';

/** Does this permission set allow WRITING the ทีม SAMO tree? Single predicate so
 *  the admin UI, the card and any future caller cannot drift on the answer. */
export function canEditTeam(perms = [], role = '') {
  return role === 'vp_admin' || role === 'dev'
    || (perms || []).includes(TEAM_EDIT) || (perms || []).includes(MASTER);
}

// VitalSound departments (vs_tickets.target_dept). Binding a node — or a
// single person (0083) — to one of these (`vs_dept`) scopes VS access to that
// dept. The binding IS the VS grant's scope: a row carries EITHER the full
// `vs` permission (all depts) OR a vs_dept (that dept only), never both —
// `vs` is an unconditional true branch in every VS policy and would swallow
// the narrower dept check. See migration 0083.
// Values MUST match the VS dept strings exactly; labels are the short display
// names (same set as the VS staff dept dropdown).
export const VS_DEPTS = [
  { value: 'นายกสโม',                                 label: 'นายกสโม' },
  { value: 'SE',                                       label: 'SE (Student Engagement)' },
  { value: 'อุปนายกฝ่ายบริหารองค์กร',                  label: 'บริหารองค์กร' },
  { value: 'อุปนายกฝ่ายดิจิทัลและสื่อสารองค์กร',       label: 'ดิจิทัลและสื่อสาร' },
  { value: 'อุปนายกฝ่ายกิจการภายใน',                   label: 'กิจการภายใน' },
  { value: 'อุปนายกฝ่ายกิจการภายนอก',                  label: 'กิจการภายนอก' },
  { value: 'อุปนายกฝ่ายกิจการมหาวิทยาลัย',             label: 'กิจการมหาวิทยาลัย' },
  { value: 'อุปนายกฝ่ายวิชาการ',                       label: 'วิชาการ' },
  { value: 'อุปนายกฝ่ายยุทธศาสตร์และพัฒนาองค์กร',      label: 'ยุทธศาสตร์' },
  { value: 'อุปนายกฝ่ายคุณภาพชีวิตและสิ่งแวดล้อม',     label: 'คุณภาพชีวิต' },
  { value: 'อุปนายกฝ่ายเวชนิทัศน์',                    label: 'เวชนิทัศน์' },
  { value: 'อุปนายกฝ่ายรังสีเทคนิค',                   label: 'รังสีเทคนิค' },
];
export const VS_DEPT_LABEL = byKey(VS_DEPTS.map((d) => [d.value, d.label]));

// หนังสือโครงการ seats (team_nodes/team_members.project_seat, migration 0086).
// Projects is NOT one capability — it is three workflows keyed off the seat,
// so a `projects` grant without one leaves the person with no controls.
export const PROJECT_SEATS = [
  { value: 'vpa',   label: 'ผู้ส่งหนังสือ (SAMO)' },
  { value: 'staff', label: 'เจ้าหน้าที่คณะ' },
  { value: 'prof',  label: 'อาจารย์ (ลงนาม)' },
];
export const PROJECT_SEAT_LABEL = byKey(PROJECT_SEATS.map((s) => [s.value, s.label]));

// Which grants actually open the admin app (/admin/). Mirrors the coarse
// "can this account use the app at all" gate in admin-main.js canUseAdmin() —
// they import the same array, because a list that drifted would either bounce a
// legitimate grantee at the door or send a passport-only member to a page that
// bounces them. `passport` is deliberately absent: SAMO Passport is a separate
// app at /passport/, so a passport-only grant is not admin access.
// `team` alone is enough to open /admin/ — it is the VIEW rung, and since 0110
// every person with a posting in the tree holds it implicitly, which is the
// whole point: they can open ทีม SAMO and look. `team_edit` is listed too so a
// hypothetical editor who somehow lacks the view rung is not locked out; the
// list is OR-ed, so naming both costs nothing and cannot fail closed.
export const ADMIN_FEATURES = ['pr', 'vs', 'samoshop', 'projects', 'creator', 'team', 'team_edit', 'house', 'claude', 'discord_bot', 'dept_pages'];

// ---------------------------------------------------------------------------
// หน้าฝ่าย — the per-ฝ่าย page-editing scope (migration 0177).
//
// The values are DEPT_DEFS keys, from their one home in src/data/depts.js, so
// the picker cannot offer a ฝ่าย the site has no page for. Derived, never
// retyped: a hand-written copy here is the same fact in two files.
//
// ⛔ THE SCOPE AND THE BLANKET KEY ARE EXCLUSIVE, AND THAT IS NOT A UI
// PREFERENCE. `current_user_dept_page_scope()` returns NULL — meaning EVERY
// ฝ่าย — the moment `dept_pages` is held, so a row carrying both the key and a
// ฝ่าย grants everything and the ฝ่าย reads as a decision that was never made.
// This is 0083 exactly: a narrowing scope beside an unconditional permission is
// dead on arrival, because permissive policies are OR'd and the broad grant
// wins. `readPermInputs()` drops `dept_pages` when a ฝ่าย is chosen, and
// team-vocab.test.js pins that.
// ---------------------------------------------------------------------------
export const DEPT_PAGES = DEPT_OPTIONS;
export const DEPT_PAGE_LABEL = byKey(DEPT_PAGES.map((d) => [d.value, d.label]));

/** The permission key that means "every ฝ่าย page". Named so the exclusivity
 *  rule has one spelling instead of a literal in each caller. */
export const DEPT_PAGES_ALL = 'dept_pages';
