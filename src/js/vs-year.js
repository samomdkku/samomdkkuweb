// ==============================================
// VS YEAR — pure helpers for the VS staff dashboard's year facet. No DOM, no
// fetch — the DOM wiring lives in vs-staff.js, same split as pr-year.js/
// projects/fiscal-year.js. The picker itself (fetching the list, building
// <option>s) is src/js/samo-year.js, shared by every system (class 6: one
// picker, not a copy per dashboard).
//
// NO PAST-YEAR EDIT LOCK HERE, UNLIKE pr-year.js's isPastYearView/
// isPastYearTicket. docs/YEAR-ROLLOVER.md § VitalSound never asks for one —
// a duplicate filed this year can merge into a canonical ticket filed LAST
// year (edge case 14) and staff routinely need to write that canonical row
// regardless of which SAMO year it happens to carry. The year column stays
// "a filter, never an access boundary" all the way into the UI here, not
// just in RLS.
// ==============================================

import { ALL_YEARS } from './samo-year.js';

export { ALL_YEARS };

/** The terminal status string (vs-staff.js's KANBAN_COLUMNS 'done' column).
 *  ONE home — vs-staff.js imports this rather than defining its own copy, so
 *  "is this ticket closed" means the same thing everywhere it is asked. See
 *  vsTicketMatchesYearFilter's header for why this must be STATUS, never
 *  `resolution is not null`. */
export const DONE_STATUS = 'เสร็จสิ้น';

/**
 * Does THIS TICKET show under the selected year facet?
 *
 * "Open tickets carry over" (docs/YEAR-ROLLOVER.md § VitalSound, this
 * migration's own header): a ticket that is not CURRENTLY closed is ALWAYS
 * shown, regardless of which year the facet is pinned to. Only a closed
 * ticket is subject to the year filter at all — that is the pile PR's
 * 290-ticket complaint was about, and the only pile this facet exists to
 * declutter.
 *
 * WHY THIS CHECKS `status`, NOT `resolution is not null` (the first version
 * of this function did, and it was wrong — found by tracing
 * submitStaffAction in vs-staff.js, not reported). `resolution` is set once,
 * when a ticket FIRST closes (0073), and NOTHING in this codebase clears it
 * if a staffer later reopens the ticket by picking a different status —
 * neither submitStaffAction's own PATCH (it only ever WRITES `resolution`,
 * inside `if (willWriteResolution)`, never nulls it) nor the 0074 cascade
 * trigger (which clears `resolution_note` on a mirrored duplicate but never
 * `resolution` itself). So a REOPENED ticket keeps a stale non-null
 * `resolution` forever — checking that column would hide an actively
 * reopened past-year ticket from the default "current year" view, the exact
 * opposite of "carries over". `status` is the live signal; it is what
 * vs-staff.js's own `isDone` check already uses for the identical question.
 *
 * An unresolved samoYearBe (null — should not happen for any row after
 * 0221's backfill, but the same "fails open to visible" rule 0220's
 * ticketMatchesYearFilter already uses) is also always shown.
 *
 * @param {number|string|null|undefined} samoYearBe
 * @param {string|null|undefined} status  vs_tickets.status
 * @param {number|string} selected  the facet's current value (a year, or ALL_YEARS)
 */
export function vsTicketMatchesYearFilter(samoYearBe, status, selected) {
  if (selected === ALL_YEARS) return true;
  if (status !== DONE_STATUS) return true; // not currently closed — always carries over
  if (samoYearBe == null) return true;
  return Number(samoYearBe) === Number(selected);
}
