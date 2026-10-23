// js/depts.js — Passport's ฝ่าย list, from the database (0247).
//
// ONE loader for every page. It fills the maps in constants.js in place (so
// their importers keep reading DEPARTMENTS[id]) and keeps the ordered rows for
// the pickers. A hidden ฝ่าย (active = false) keeps its NAME everywhere — old
// activities and scans still carry its id — but is not offered for new work.
import { supabase } from './app.js';
import { DEPARTMENTS, SUBDEPARTMENTS, SUBDEPT_PARENT } from './constants.js';

let deptRows = [];
let subRows = [];
let pending = null;

/** Replace the catalog with `data` ({departments, sub_departments}). */
export function applyCatalog(data) {
    deptRows = Array.isArray(data?.departments) ? data.departments : [];
    subRows = Array.isArray(data?.sub_departments) ? data.sub_departments : [];
    for (const m of [DEPARTMENTS, SUBDEPARTMENTS, SUBDEPT_PARENT]) {
        for (const k of Object.keys(m)) delete m[k];
    }
    deptRows.forEach((d) => { DEPARTMENTS[d.id] = d.name; });
    subRows.forEach((s) => { SUBDEPARTMENTS[s.id] = s.name; SUBDEPT_PARENT[s.id] = s.department_id; });
}

/** Load once per page (force to re-read after an edit). Never throws: a page
 *  without names still works and shows "ฝ่าย #N". */
export function loadDepartments(client = supabase, { force = false } = {}) {
    if (pending && !force) return pending;
    pending = (async () => {
        try {
            const { data, error } = await client.schema('public').rpc('list_passport_departments');
            if (error) throw error;
            applyCatalog(data);
        } catch (e) {
            console.warn('[depts] could not load the ฝ่าย list:', e?.message || e);
        }
        return { departments: deptRows, sub_departments: subRows };
    })();
    return pending;
}

/** ฝ่าย for a picker, in the admins' order. `keep` = an id that must stay
 *  offered even if hidden (the value an activity already has). */
export function deptChoices({ includeHidden = false, keep = null } = {}) {
    return deptRows.filter((d) => includeHidden || d.active !== false || String(d.id) === String(keep));
}

/** ฝ่ายย่อย of one ฝ่าย, same rules. */
export function subChoices(deptId, { includeHidden = false, keep = null } = {}) {
    return subRows.filter((s) => String(s.department_id) === String(deptId)
        && (includeHidden || s.active !== false || String(s.id) === String(keep)));
}

export const deptName = (id) => (id == null ? '' : DEPARTMENTS[id] || `ฝ่าย #${id}`);
export const subName = (id) => (id == null ? '' : SUBDEPARTMENTS[id] || `ฝ่ายย่อย #${id}`);
