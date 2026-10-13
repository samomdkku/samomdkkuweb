// ==============================================
// SAMO YEAR — the ONE year-picker and year-reader every system reuses.
//
// The registry is public.team_terms (0104/0219) — a term of OFFICE, not a
// calendar. Do NOT build a second year dropdown per system (PR/VS/Shop/
// หนังสือโครงการ): that is the "hand-written list beside a shared constant"
// class 6 already logs. Every dashboard imports fetchSamoYears() +
// samoYearPicker() from here, same as every ปีงบ reader goes through
// projects/fiscal-year.js.
//
// MIN/MAX_SAMO_YEAR mirror team_terms_year_range (0104) and start_team_term's
// own bad-year guard (0219) — THREE homes of one number now; see
// samo-year.test.js's differential test, the 0217 follow-up.test.js pattern.
// ==============================================

import { dbRest } from './db.js';
import { escHtml } from './utils.js';

export const MIN_SAMO_YEAR = 2500;
export const MAX_SAMO_YEAR = 2700;

/** Is `y` a year the registry would accept? */
export function isValidSamoYear(y) {
  const n = Number(y);
  return Number.isInteger(n) && n >= MIN_SAMO_YEAR && n <= MAX_SAMO_YEAR;
}

/** Every year a picker should offer — published years + the current one,
 *  exactly what get_public_team_years() (0104) already publishes. The SAME
 *  list ทีม SAMO's own public page and every other system's dashboard reads,
 *  so "2569" never means two different things in two tabs. */
export async function fetchSamoYears() {
  const { data, error } = await dbRest('/rpc/get_public_team_years', { method: 'POST', body: {} });
  if (error) throw new Error(error.message || 'โหลดรายการปีไม่สำเร็จ');
  return Array.isArray(data) ? data : [];
}

/** The JS twin of current_samo_year() (0219): given the list fetchSamoYears()
 *  returns (or any array of {year, is_current}), which one is current.
 *  Returns null, never throws, when nothing is marked current — the same
 *  "an unresolvable reference answers null, not a guess" rule the SQL
 *  function's own `limit 1` over zero rows already follows. */
export function currentSamoYear(years) {
  if (!Array.isArray(years)) return null;
  const hit = years.find((y) => y?.is_current);
  return hit ? Number(hit.year) : null;
}

/**
 * The `<option>` markup for every SAMO year, newest first — pure string
 * building, no DOM, so it is unit-testable in plain node (this repo's tests
 * run without jsdom; `projects/fiscal-year.js` keeps the same split between
 * pure option-building and the DOM wiring that uses it).
 *
 * @param {Array<{year:number,label?:string,is_current?:boolean}>} years
 * @param {number|string|null} current the value that should come out selected
 * @returns {string}
 */
export function samoYearOptionsHtml(years, current) {
  const sorted = [...(years || [])].sort((a, b) => Number(b.year) - Number(a.year));
  const sel = current != null ? String(current) : null;
  return sorted.map((t) => {
    const label = t.label ? `${t.year} — ${escHtml(t.label)}` : String(t.year);
    const selected = sel !== null && String(t.year) === sel ? ' selected' : '';
    return `<option value="${t.year}"${selected}>${label}${t.is_current ? ' (ปีปัจจุบัน)' : ''}</option>`;
  }).join('');
}

/**
 * Populate an EXISTING `<select>` with every SAMO year and wire its change
 * event — the one DOM touch every PR/VS/Shop/หนังสือโครงการ admin screen
 * calls instead of hand-rolling its own (class 6: "a hand-written list
 * beside a shared constant"). Mirrors how `renderFiscalYearOptions()`
 * (projects/inbox.js) already populates `#projectsFiscalYear` — the single
 * difference is this is now a shared function instead of five copies.
 *
 * @param {HTMLSelectElement|null} selectEl
 * @param {Array<{year:number,label?:string,is_current?:boolean}>} years
 * @param {number|string|null} current
 * @param {(year:number)=>void} onChange fired with a NUMBER on every change
 */
export function wireSamoYearPicker(selectEl, years, current, onChange) {
  if (!selectEl) return;
  selectEl.innerHTML = samoYearOptionsHtml(years, current);
  if (current != null) selectEl.value = String(current);
  selectEl.addEventListener('change', () => {
    const y = Number(selectEl.value);
    if (Number.isFinite(y)) onChange?.(y);
  });
}
