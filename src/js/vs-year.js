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

/**
 * Does THIS TICKET show under the selected year facet?
 *
 * "Open tickets carry over" (docs/YEAR-ROLLOVER.md § VitalSound, this
 * migration's own header): a ticket nobody has closed yet (`resolution` is
 * still null — set only when staff resolve it, 0073) is ALWAYS shown,
 * regardless of which year the facet is pinned to. Only a CLOSED ticket is
 * subject to the year filter at all — that is the pile PR's 290-ticket
 * complaint was about, and the only pile this facet exists to declutter.
 * An unresolved samoYearBe (null — should not happen for any row after
 * 0221's backfill, but the same "fails open to visible" rule 0220's
 * ticketMatchesYearFilter already uses) is also always shown.
 *
 * @param {number|string|null|undefined} samoYearBe
 * @param {string|null|undefined} resolution  vs_tickets.resolution — null
 *   until staff close the ticket
 * @param {number|string} selected  the facet's current value (a year, or ALL_YEARS)
 */
export function vsTicketMatchesYearFilter(samoYearBe, resolution, selected) {
  if (selected === ALL_YEARS) return true;
  if (resolution == null) return true; // still open — always carries over
  if (samoYearBe == null) return true;
  return Number(samoYearBe) === Number(selected);
}
