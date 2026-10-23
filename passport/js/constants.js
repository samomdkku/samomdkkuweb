// js/constants.js — the ฝ่าย / ฝ่ายย่อย NAMES, as maps the pages read by id.
//
// ⛔ EMPTY ON PURPOSE. Since 0247 (2026-10-23) the list is managed by Passport's
// admins (จัดการรายชื่อฝ่าย, picked from ทีม SAMO) and lives in the database;
// js/depts.js loadDepartments() fills these maps IN PLACE from
// list_passport_departments() before a page renders. They used to be typed here,
// in four <select>s in html/admin.html and in admin-page.js's SUB_DEPT_OPTIONS
// — four copies that already disagreed, and a code change + deploy to add a
// ฝ่าย. Do not put names back here: an id with no name renders "ฝ่าย #N",
// which is visible, where a stale copy would be wrong and look right.
// passport-depts.test.js holds this file to it.

/** id → name, every ฝ่าย (hidden ones too — old activities still need a label). */
export const DEPARTMENTS = {};

/** id → name, every ฝ่ายย่อย. */
export const SUBDEPARTMENTS = {};

/** ฝ่ายย่อย id → its ฝ่าย id. admin-scope.js resolves a ฝ่ายย่อย grant with it. */
export const SUBDEPT_PARENT = {};
