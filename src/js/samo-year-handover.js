// ==============================================
// ปี SAMO handover — the PURE half of the ปี admin page (samo-year-admin.js).
// No DOM, no fetch, so it is node-testable (samo-year-handover.test.js) —
// the same split pr-year.js / projects/fiscal-year.js keep.
// ==============================================

import { isValidSamoYear } from './samo-year.js';

/**
 * Where the ปี SAMO handover stands.
 *
 * @param {Array<{year:number,is_current?:boolean,published_at?:string|null}>} terms
 * @param {Map<number,boolean>} staleByYear  team_term_status(): live tree moved after publish
 * @returns {{ current: object|null, next: number|null, others: object[],
 *             published: boolean, editing: boolean }}
 *   `next`    — the year step 3 offers: the nearest registered year above the
 *               current one, else current + 1 (start_team_term creates it).
 *   `editing` — the live tree changed since the current year was published,
 *               i.e. step 2 has begun. Only meaningful once published.
 */
export function handoverState(terms, staleByYear = new Map()) {
  const list = Array.isArray(terms) ? terms : [];
  const current = list.find((t) => t?.is_current) || null;
  const cy = current ? Number(current.year) : null;
  const above = list.map((t) => Number(t.year)).filter((y) => cy != null && y > cy).sort((a, b) => a - b);
  let next = null;
  if (cy != null) next = above.length ? above[0] : cy + 1;
  if (next != null && !isValidSamoYear(next)) next = null;
  const published = !!current?.published_at;
  return {
    current,
    next,
    others: list.filter((t) => !t?.is_current).sort((a, b) => Number(b.year) - Number(a.year)),
    published,
    editing: published && !!staleByYear.get(Number(current?.year)),
  };
}

/** Step 3's target, validated: a real year, strictly AFTER the current one.
 *  Going back is a different act (ปีอื่น ๆ), so it is refused here. */
export function startTargetError(target, currentYear) {
  const n = Number(target);
  if (!isValidSamoYear(n)) return 'ปี SAMO ต้องเป็นปี พ.ศ. 4 หลัก (2500–2700)';
  if (currentYear != null && n <= Number(currentYear)) return `ปีใหม่ต้องมากกว่าปี SAMO ${currentYear}`;
  return '';
}

/** The name a new Passport วาระ is offered: the CURRENT วาระ's name with its
 *  two-digit year swapped ("MDKKU SAMO'69" → "MDKKU SAMO'70"), so the house
 *  style ฝ่าย กิจกรรม chose carries forward; a fixed pattern otherwise. */
export function nextPassportName(currentName, year) {
  const yy = String(Number(year) % 100).padStart(2, '0');
  const m = /^(.*['’])(\d{2})\s*$/.exec(String(currentName || ''));
  return m ? `${m[1]}${yy}` : `MDKKU SAMO'${yy}`;
}

/** Does Passport's open วาระ already belong to ปี SAMO `year`? Then a start
 *  leaves it alone (start_samo_year reports `already`). */
export function passportAlreadyOn(passportYear, year) {
  return passportYear?.team_term_year != null && Number(passportYear.team_term_year) === Number(year);
}
