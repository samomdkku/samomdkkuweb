// ==============================================
// study-year.test.js — the ชั้นปี rule, and the RATCHET that keeps it one rule.
//
// WHY A RATCHET AND NOT JUST UNIT TESTS. This repo's standing lesson is that
// "when a hazard has been paid for twice, the third fix is a TEST" — writing a
// hazard down does not make anyone check it. ชั้นปี was paid for twice:
//
//   0123/0129 removed a stored ชั้นปี from ระบบบ้าน (`students.year_override`),
//   and `house/fields.js` wrote down, in a comment, that `team_members.year` was
//   the same column wearing different clothes and that "every August all 399
//   quietly become last year's answer".
//
// The comment was correct and completely ineffective. One August later the owner
// reported the exact predicted failure — nine members a year behind, an edit box
// that reverted, and one person reading ปี 5 / จบแล้ว / ปี 5 on three screens.
//
// So §3 below is not a unit test. It reads the SOURCE of every module and fails
// the build if a stored ชั้นปี comes back: a `year:` key in a write payload, a
// `.year` read rendered as a ชั้นปี, or a second implementation of the
// arithmetic. A comment cannot do that; this can.
// ==============================================
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  setAcademicYear, academicYear, cohortFromStudentId, cohortLabel,
  studyYear, studyYearLabel, offsetForPickedYear, yearBasis,
  COHORT_EPOCH, ACADEMIC_YEAR_ROLLOVER_MONTH,
} from './study-year.js';

const SRC = new URL('.', import.meta.url).pathname;

// ── §1 the arithmetic ───────────────────────────────────────────────────────

describe('the ชั้นปี rule', () => {
  beforeEach(() => setAcademicYear(2569));

  it('is ปีการศึกษา − ปีที่เข้า + 1', () => {
    expect(studyYear({ cohort_year: 2565 })).toBe(5);
    expect(studyYear({ cohort_year: 2569 })).toBe(1);
  });

  it('reads ปีที่เข้า off the รหัสนักศึกษา when there is no stored cohort', () => {
    expect(studyYear({ student_id: '653070149-5' })).toBe(5);
    expect(cohortFromStudentId('653070149-5')).toBe(2565);
  });

  // THE REPORTED CASE, kept as the literal number the owner typed.
  it('603070316-0 in 2569 is จบแล้ว, on every surface', () => {
    expect(cohortFromStudentId('603070316-0')).toBe(2560);
    expect(studyYear({ student_id: '603070316-0' })).toBe(10);
    expect(studyYearLabel({ student_id: '603070316-0' })).toBe('จบแล้ว');
  });

  it('ANSWERS THE OWNER\'S QUESTION: correcting the รหัส DOES move the ชั้นปี', () => {
    const before = { student_id: '653070149-5', year_offset: null };
    const after = { ...before, student_id: '603070316-0' };
    expect(studyYearLabel(before)).toBe('ปี 5');
    expect(studyYearLabel(after)).toBe('จบแล้ว');
  });

  it('…but a ลาพัก OFFSET survives that correction unchanged', () => {
    // The offset is a DIFFERENCE, so it means the same thing against either
    // base: "one year behind my รุ่น". That is the whole reason 0131 chose it
    // over an absolute year, and it is what makes "changing the รหัส must not
    // change the ชั้นปี" a reasonable instinct that is already satisfied.
    const off = -1;
    expect(studyYear({ student_id: '653070149-5', year_offset: off })).toBe(4);
    expect(studyYear({ student_id: '663070014-9', year_offset: off })).toBe(3);
  });

  it('has no ชั้นปี for a row with no รหัส — a shared account, an อาจารย์', () => {
    expect(studyYear({})).toBeNull();
    expect(studyYearLabel({ student_id: null })).toBeNull();
    expect(studyYearLabel({ student_id: '' })).toBeNull();
  });

  it('refuses an out-of-window รหัส rather than inventing a plausible ปี 1', () => {
    // 0118: 2500+99 was inside the original bound, so a malformed รหัส produced
    // a confident "ปี 1".
    expect(cohortFromStudentId('993070316-0')).toBeNull();
    expect(studyYearLabel({ student_id: '993070316-0' })).toBeNull();
  });

  it('says จบแล้ว above ปี 6 instead of clamping', () => {
    expect(studyYearLabel({ cohort_year: 2563 })).toBe('จบแล้ว');
    expect(studyYearLabel({ cohort_year: 2564 })).toBe('ปี 6');
  });

  it('renders no ชั้นปี below ปี 1 (a รหัส from the future)', () => {
    expect(studyYearLabel({ cohort_year: 2570 })).toBeNull();
  });

  it('stores the GAP, and stores null for "exactly as computed"', () => {
    const rec = { student_id: '653070149-5' };          // computes to 5
    expect(offsetForPickedYear(rec, 5)).toBeNull();     // never 0 — see 0131
    expect(offsetForPickedYear(rec, 4)).toBe(-1);
    expect(offsetForPickedYear(rec, 6)).toBe(1);
  });

  it('measures the gap against the รหัส BEING SAVED, not the one on screen', () => {
    // Someone who fixes a mistyped รหัส and picks a ชั้นปี in the same save has
    // moved the base. Measuring against the old base would store a difference
    // that means something else the moment the row lands.
    const typed = { student_id: '603070316-0' };        // computes to 10
    expect(offsetForPickedYear(typed, 6)).toBe(-4);
  });

  it('DROPS a stored ปีที่เข้า once the รหัส it came from is edited', () => {
    // 0128 wearing a client-side costume. studyYear reads
    // `cohort_year || cohortFromStudentId(sid)` — the stored cohort WINS — so a
    // form that spreads the row and overwrites only student_id keeps showing the
    // OLD ชั้นปี while the รหัส is being corrected, and an offset saved in that
    // state is measured against a base that no longer exists.
    const stored = { student_id: '653070149-5', cohort_year: 2565, year_offset: -1 };
    expect(studyYear(stored)).toBe(4);                                  // 5 − 1
    // Spreading is the WRONG thing, and this pins that it is wrong:
    expect(studyYear({ ...stored, student_id: '603070316-0' })).toBe(4);
    // yearBasis is the right thing:
    expect(studyYear(yearBasis(stored, '603070316-0'))).toBe(9);        // 10 − 1
  });

  it('KEEPS the stored ปีที่เข้า while the รหัส is unchanged', () => {
    // Load-bearing: 0145's backfill converted a stored ชั้นปี into a ปีที่เข้า for
    // the 13 members who have no รหัส at all. Dropping it unconditionally would
    // blank exactly those people's ชั้นปี.
    const noSid = { student_id: null, cohort_year: 2565 };
    expect(studyYear(yearBasis(noSid, ''))).toBe(5);
    expect(studyYear(yearBasis(noSid, null))).toBe(5);
  });

  it('carries the OFFSET across a รหัส correction, because it is a difference', () => {
    const stored = { student_id: '653070149-5', cohort_year: 2565, year_offset: -2 };
    expect(yearBasis(stored, '663070014-9').year_offset).toBe(-2);
    expect(yearBasis(stored, '663070014-9').cohort_year).toBeUndefined();
  });

  it('turns ปีที่เข้า into a รุ่น, and needs no clock to do it', () => {
    expect(cohortLabel({ cohort_year: 2565 })).toBe('MD50');
    expect(cohortLabel({ student_id: '643070012-1' })).toBe('MD49');
    expect(2565 - COHORT_EPOCH).toBe(50);
  });
});

// ── §2 the ปีการศึกษา source ────────────────────────────────────────────────

describe('ปีการศึกษา', () => {
  it('prefers the admin-set value over the clock (0141)', () => {
    setAcademicYear(2570);
    expect(academicYear(new Date('2026-08-10'))).toBe(2570);
  });

  it('falls back to the clock, rolling over in สิงหาคม', () => {
    // A failed fetch must degrade to the pre-0141 behaviour, not to a blank
    // ชั้นปี on every card. Re-priming is impossible once set, so this asserts
    // the rollover month rather than resetting module state.
    expect(ACADEMIC_YEAR_ROLLOVER_MONTH).toBe(8);
  });

  it('ignores a value that is not a ปี พ.ศ.', () => {
    setAcademicYear(2569);
    setAcademicYear('not a year');
    setAcademicYear(0);
    expect(academicYear()).toBe(2569);
  });
});

// ── §3 THE RATCHET ──────────────────────────────────────────────────────────

function jsFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) { jsFiles(full, out); continue; }
    if (name.endsWith('.js') && !name.endsWith('.test.js')) out.push(full);
  }
  return out;
}

const FILES = jsFiles(SRC).map((f) => ({
  path: relative(SRC, f),
  text: readFileSync(f, 'utf8'),
}));

describe('RATCHET — ชั้นปี stays derived', () => {
  it('finds the modules it is supposed to be scanning', () => {
    // "A sweep returning NOTHING is not evidence of nothing." Prove the scan can
    // see the files before trusting what it does not find in them.
    const paths = FILES.map((f) => f.path);
    expect(paths).toContain('study-year.js');
    expect(paths).toContain('my-seat.js');
    expect(paths).toContain(join('team', 'index.js'));
    expect(paths).toContain(join('house', 'my-house.js'));
    expect(FILES.length).toBeGreaterThan(40);
  });

  /**
   * The `year` keys that are NOT a ชั้นปี, each with the reason it is not.
   *
   * SHRINK-ONLY. Adding a line here is adding a stored ชั้นปี back, so a new
   * entry needs a reason that is genuinely one of these three: a Drive folder
   * name, a ปีการศึกษา / term year, or a date-format option. If the reason is
   * "it is a member's ชั้นปี", the answer is `studyYearLabel`, not this list.
   */
  const NOT_A_STUDY_YEAR = [
    "year: '_House'",              // Drive folder for house crests
    'year: seat.term_year',        // Drive folder — ปีการศึกษา of the posting
    'year: currentTermYear',       // ditto, admin side
    'year: openYear',              // the ARCHIVE term being edited
    "year: '2-digit'",             // Intl.DateTimeFormat
    "year: 'numeric'",             // Intl.DateTimeFormat
    "year: ['year',",              // CSV header alias table
    "formData.get('vsYear')",      // VitalSound's own ปีการศึกษา field
  ];

  it('no module sends a `year:` key in a write payload', () => {
    // `team_members.year` is dead (0145). A payload key named `year` is either
    // that column coming back, or — worse — a NEW stored ชั้นปี on some other
    // table. `term_year`, `cohort_year`, `year_offset` and `academic_year` are
    // different facts and are deliberately not matched.
    const offenders = [];
    for (const f of FILES) {
      f.text.split('\n').forEach((line, i) => {
        const t = line.trim();
        if (/^(\/\/|\*|\/\*)/.test(t)) return;                   // prose, not code
        if (!/(^|[{,\s])year:\s/.test(line)) return;
        if (NOT_A_STUDY_YEAR.some((ok) => line.includes(ok))) return;
        offenders.push(`${f.path}:${i + 1}  ${t}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  it('the ชั้นปี arithmetic has exactly ONE implementation', () => {
    // The shape to catch is a second `academicYear() - cohort + 1`, anywhere.
    // study-year.js is the one place allowed to spell it.
    const offenders = FILES
      .filter((f) => f.path !== 'study-year.js')
      .filter((f) => /-\s*(Number\()?\s*(c|cohort|cohort_year)\b[^\n]*\+\s*1/.test(f.text))
      .map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  /**
   * Files allowed to interpolate `ปี ${…}`, and why.
   *
   * Also shrink-only. Everywhere else, a ชั้นปี on screen must come from
   * `studyYearLabel()` — a literal `ปี ${m.year}` is exactly how a stored value
   * gets rendered as if it were current.
   */
  const MAY_WRITE_A_YEAR_LABEL = new Map([
    ['study-year.js', 'builds the label — this is the one implementation'],
    ['my-seat.js', 'the ชั้นปี CHOOSER\'s option labels (a pick, not a reading)'],
    [join('house', 'my-house.js'), 'the same chooser on the house card'],
    [join('house', 'index.js'), 'the same chooser in the ระบบบ้าน admin editor'],
    [join('team', 'terms.js'), 'ปีการศึกษา of an ARCHIVED term, not anyone\'s ชั้นปี'],
    // vs_tickets.year is typed by the REPORTER at submit time and never
    // re-derived, and a VS reporter may be anonymous, so there is no
    // รหัสนักศึกษา for studyYearLabel() to compute from. It renders with the
    // qualifier '(ตอนที่แจ้ง)', which vs-requester.test.js asserts — so this
    // exemption cannot quietly decay into a bare year read as current.
    ['vs-requester.js', 'a ชั้นปี the reporter STATED, labelled as a snapshot'],
  ]);

  it('every ชั้นปี on screen comes from studyYearLabel()', () => {
    const offenders = [];
    for (const f of FILES) {
      if (MAY_WRITE_A_YEAR_LABEL.has(f.path)) continue;
      f.text.split('\n').forEach((line, i) => {
        if (/ปี \$\{/.test(line)) offenders.push(`${f.path}:${i + 1}  ${line.trim()}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  it('CONTROL — the payload scan does catch a `year:` key', () => {
    // Every deny needs an allow over the same rows: a regex that matches nothing
    // scores a broken pattern as a clean codebase.
    const line = '      year: fields.year,';
    expect(/(^|[{,\s])year:\s/.test(line)) .toBe(true);
    expect(/(^|[{,\s])year:\s/.test('  cohort_year: 2565,')).toBe(false);
    expect(/(^|[{,\s])year:\s/.test('  year_offset: -1,')).toBe(false);
    expect(/(^|[{,\s])year:\s/.test('  term_year: 2569,')).toBe(false);
  });
});
