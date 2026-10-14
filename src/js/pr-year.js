// ==============================================
// PR YEAR — pure helpers for the PR Staff Dashboard's year picker, past-year
// lock, and CSV export. No DOM, no fetch — the DOM wiring lives in
// pr-staff.js, same split as projects/fiscal-year.js.
//
// The picker itself (fetching the list, building <option>s) is
// src/js/samo-year.js, shared by every system (class 6: one picker, not a
// copy per dashboard). This file only has what is specific to PR: deciding
// whether the SELECTED year makes the dashboard read-only, and building the
// export.
// ==============================================

import { csvGuard } from './utils.js';
import { ALL_YEARS } from './samo-year.js';

// Re-exported for every existing caller/test that imports ALL_YEARS from
// here — the sentinel's one real home is now samo-year.js (vs-year.js reuses
// it the same way), but PR's own import path must not break.
export { ALL_YEARS };

/**
 * Does the selected year make the dashboard a PAST-YEAR, read-only-by-default
 * view? Per docs/YEAR-ROLLOVER.md § PR: "Past years are READ-ONLY by default
 * in the UI only" — "ทุกปี" and the CURRENT year are both live-editing views;
 * only a SPECIFIC year older than current locks editing (with an explicit
 * override). `currentYear` may be null (years not loaded yet) — treat that as
 * "cannot tell, do not lock", same fail-open-to-the-OLD-behaviour rule
 * isValidDefaultFY uses for an unreadable preference.
 *
 * @param {number|string} selected  the <select>'s current value
 * @param {number|null} currentYear  from currentSamoYear() (samo-year.js)
 */
export function isPastYearView(selected, currentYear) {
  if (selected === ALL_YEARS || selected == null || selected === '') return false;
  if (currentYear == null) return false;
  const y = Number(selected);
  return Number.isFinite(y) && y < Number(currentYear);
}

/**
 * Does THIS TICKET belong to a closed year? This is what actually gates the
 * modal's save/delete — NEVER the filter's selected value. Browsing "ทุกปี"
 * (or the current year) still has to lock an individual past-year ticket a
 * search or a dept filter surfaced; gating on the <select> instead let every
 * past-year ticket be edited freely the moment the filter was not pinned to
 * that one specific year — the exact accidental-edit this feature exists to
 * prevent, bypassed by the view most likely to be open (ทุกปี has no "closed
 * year" banner of its own, so nothing would even have hinted it was unlocked).
 *
 * @param {number|string|null|undefined} ticketYear  a ticket's samoYearBe
 * @param {number|null} currentYear  from currentSamoYear() (samo-year.js)
 */
export function isPastYearTicket(ticketYear, currentYear) {
  if (ticketYear == null || currentYear == null) return false;
  const y = Number(ticketYear);
  return Number.isFinite(y) && y < Number(currentYear);
}

/** Does a ticket belong to the year the dashboard is currently filtered to?
 *  `null`/`undefined` ticket year (a row the backfill could not resolve —
 *  should not happen for any pre-0220 row, see the migration) is treated as
 *  "always visible" rather than silently dropped from every filter. */
export function ticketMatchesYearFilter(ticketYear, selected) {
  if (selected === ALL_YEARS) return true;
  if (ticketYear == null) return true;
  return Number(ticketYear) === Number(selected);
}

// ---------- CSV export ----------

const PR_CSV_HEADERS = [
  'ticket_id', 'samo_year_be', 'submitted_at', 'department', 'content_name',
  'job_type', 'platforms', 'other_platforms', 'other_platform_reason',
  'posting_channel', 'publish_date', 'deadline_status', 'rush_reason',
  'project_account', 'copost_with', 'submitter', 'status', 'assignees',
  'attachment_count', 'brief', 'caption',
];

/** One CSV cell, RFC4180-quoted, formula-safe (csvGuard, utils.js). Mirrors
 *  shop/data.js's csvCell — same rule, one copy per module is the accepted
 *  shape here (team/io.js and house/io.js each have their own too), since the
 *  shared RULE is csvGuard, not the quoting mechanics around it. */
function cell(v) {
  if (v == null) return '""';
  const s = csvGuard(Array.isArray(v) ? v.join('; ') : String(v));
  return `"${s.replace(/"/g, '""')}"`;
}

/**
 * Build a CSV of PR tickets — one row per ticket (PR has no line items).
 * Takes the pr-staff.js ticket view-model (rowToTicket's output, extended
 * with samoYearBe/timestampIso/attachmentCount), already filtered to
 * whatever the dashboard is showing (dept/search/year) — exports what is on
 * screen, same contract as the shop admin's CSV export.
 *
 * Excel-compatible: UTF-8 BOM + CRLF + RFC4180 quoting (same shape as
 * shop/admin.js's ordersToCsv).
 */
export function buildPrTicketsCsv(tickets) {
  const rows = (tickets || []).map((t) => [
    t.id, t.samoYearBe ?? '', t.timestampIso || t.date, t.dept, t.contentName,
    t.jobType, t.platforms, t.otherPlatforms, t.otherPlatformReason,
    t.postingChannel, t.publishDateIso || t.publishDate, t.deadline, t.rushReason,
    t.projectAccount, t.copostWith, t.submitter, t.status, t.assignees,
    t.attachmentCount ?? 0, t.brief, t.caption,
  ].map(cell).join(','));
  return '﻿' + [PR_CSV_HEADERS.join(','), ...rows].join('\r\n');
}

/** Filename for a PR export — names the year scope so two downloads never
 *  look identical in a Downloads folder. */
export function prCsvFilename(selected, stamp) {
  const scope = selected === ALL_YEARS ? 'all-years' : `ปี-${selected}`;
  return `samo-pr-tickets-${scope}-${stamp}.csv`;
}
