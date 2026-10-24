// ============================================================
// schedule.js — a group's timetable as dates, from a round's data file
// (src/data/rotation-2570.js). Pure: no DOM, no network — tested in
// schedule.test.js.
//
// Weeks are Monday–Friday. A course boundary can fall mid-week (OB-GYN Theory
// is 2.5 weeks); such a date is marked `approx`, because the PDF gives the
// split in weeks and never says which day it lands on.
// ============================================================

const DAY = 86400000;

function isoToUtc(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

/** Monday of week n (1-based) as a UTC Date. */
export function weekMonday(round, n) {
  return new Date(isoToUtc(round.firstMonday) + (n - 1) * 7 * DAY);
}

/** Friday of week n. */
export function weekFriday(round, n) {
  return new Date(weekMonday(round, n).getTime() + 4 * DAY);
}

/**
 * A point `w` weeks after the start of week 1 (w may be fractional) → the
 * teaching day it falls on. Whole weeks land on a Monday; .5 lands on the
 * Wednesday/Thursday boundary, reported as the Wednesday + approx.
 */
function dayAt(round, w, { end = false } = {}) {
  const whole = Math.floor(w);
  const frac = w - whole;
  if (frac === 0) {
    return end
      ? { date: weekFriday(round, whole), approx: false }      // ends the Friday of the week before
      : { date: weekMonday(round, whole + 1), approx: false };
  }
  const days = Math.round(frac * 5);                           // 0.5 → 3 (Thu start) / Wed end
  return end
    ? { date: new Date(weekMonday(round, whole + 1).getTime() + (days - 1) * DAY), approx: true }
    : { date: new Date(weekMonday(round, whole + 1).getTime() + days * DAY), approx: true };
}

/**
 * The full timetable of one group.
 * @returns {Array<{block, unitKey, unit, start, end, courses: Array<{code, kind, weeks, section, startWeek, endWeek, start, end, approx}>}>}
 */
export function groupTimetable(round, group) {
  const plan = round.groups[group];
  if (!plan) return [];
  return plan.map(([unitKey, sections], i) => {
    const block = round.blocks[i];
    const unit = round.units[unitKey];
    let offset = block.startWeek - 1;                          // weeks elapsed before this course
    const courses = unit.courses.map((c, ci) => {
      const from = dayAt(round, offset);
      const to = dayAt(round, offset + c.weeks, { end: true });
      const row = {
        code: c.code, kind: c.kind, weeks: c.weeks,
        section: sections[ci] ?? null,
        startWeek: offset + 1, endWeek: offset + c.weeks,
        start: from.date, end: to.date, approx: from.approx || to.approx,
      };
      offset += c.weeks;
      return row;
    });
    return {
      block, unitKey, unit,
      start: weekMonday(round, block.startWeek),
      end: weekFriday(round, block.startWeek + block.weeks - 1),
      courses,
    };
  });
}

/** Which week (1..weeks) `now` is in, 0 before week 1, weeks+1 after the last. */
export function weekOf(round, now = new Date()) {
  const t = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const start = isoToUtc(round.firstMonday);
  if (t < start) return 0;
  const n = Math.floor((t - start) / (7 * DAY)) + 1;
  return n > round.weeks ? round.weeks + 1 : n;
}

/** Index of the block containing week n, or -1. */
export function blockIndexOfWeek(round, n) {
  return round.blocks.findIndex((b) => n >= b.startWeek && n < b.startWeek + b.weeks);
}

const TH_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

/** "26 เม.ย." — or "26 เม.ย. 70" with the พ.ศ. year. Uses UTC parts: these
 *  dates are calendar days, not instants. */
export function thDate(d, { withYear = false } = {}) {
  const s = `${d.getUTCDate()} ${TH_MONTHS[d.getUTCMonth()]}`;
  return withYear ? `${s} ${String(d.getUTCFullYear() + 543).slice(-2)}` : s;
}

/** "26 เม.ย. – 18 มิ.ย." (year on both ends only if they differ). */
export function thRange(a, b) {
  const crossYear = a.getUTCFullYear() !== b.getUTCFullYear();
  return `${thDate(a, { withYear: crossYear })} – ${thDate(b, { withYear: crossYear })}`;
}

/** "2½" for 2.5, "8" for 8. */
export function weeksLabel(w) {
  const whole = Math.floor(w);
  return w - whole === 0.5 ? `${whole || ''}½` : String(w);
}
