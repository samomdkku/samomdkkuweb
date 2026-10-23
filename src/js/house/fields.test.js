import { describe, it, expect } from 'vitest';
import {
  normalizeSai, houseOf, houseLabel, auditSaiWidths, cleanCell, cleanSpace,
  normalizeKkumail, joinName, blankish, SAI_RE, HOUSE_COUNT,
  cohortLabel, cohortFromStudentId, saiProblem, safeColor,
  academicYear, studyYear, studyYearLabel, offsetForPickedYear,
} from './fields.js';

describe('normalizeSai — three digits, zero-padded', () => {
  it('pads short values, which is the whole point', () => {
    expect(normalizeSai('1').value).toBe('001');
    expect(normalizeSai('17').value).toBe('017');
    expect(normalizeSai('017').value).toBe('017');
    expect(normalizeSai('100').value).toBe('100');
  });

  it('reports WHETHER it had to pad, so the importer can spot Excel damage', () => {
    expect(normalizeSai('017').padded).toBe(false);
    expect(normalizeSai('17').padded).toBe(true);
    expect(normalizeSai('1').padded).toBe(true);
  });

  it('accepts Thai numerals and surrounding space', () => {
    expect(normalizeSai(' ๐๑๗ ').value).toBe('017');
  });

  it('REFUSES 4+ digits rather than guessing which end to cut', () => {
    const r = normalizeSai('1234');
    expect(r.ok).toBe(false);
    // The raw value is kept, never silently blanked.
    expect(r.value).toBe('1234');
  });

  it('treats empty as empty, not as zero', () => {
    expect(normalizeSai('').value).toBeNull();
    expect(normalizeSai(null).value).toBeNull();
    expect(normalizeSai('  ').ok).toBe(true);
  });

  it('every normalised value matches the canonical shape', () => {
    for (const raw of ['1', '17', '100', '007', '๙']) {
      expect(SAI_RE.test(normalizeSai(raw).value)).toBe(true);
    }
  });
});

describe('houseOf — the last digit, and nothing else', () => {
  it('maps the documented examples', () => {
    expect(houseOf('001')).toBe(1);
    expect(houseOf('010')).toBe(0);
    expect(houseOf('100')).toBe(0);
    expect(houseOf('017')).toBe(7);
    expect(houseOf('099')).toBe(9);
  });

  it('refuses a non-canonical code rather than guessing', () => {
    expect(houseOf('1')).toBeNull();
    expect(houseOf('17')).toBeNull();
    expect(houseOf('')).toBeNull();
    expect(houseOf(null)).toBeNull();
    expect(houseOf('abc')).toBeNull();
  });

  // สาย are NOT a fixed range: any value 001–999 is legal. How high they go is
  // just how many students a year has, and that moves. 0116 wrongly seeded
  // exactly 001–100 and the sai_code foreign key would have rejected every
  // student on a higher สาย (0121).
  //
  // So the property to hold is not "exactly ten each", which is only true when
  // the maximum happens to be a multiple of ten. It is that the houses stay
  // BALANCED at any realistic size.
  it.each([100, 287, 300, 320, 450, 999])(
    'splits สาย 001..%i across all 10 houses, within one สาย of even',
    (max) => {
      const buckets = new Map();
      for (let n = 1; n <= max; n += 1) {
        const h = houseOf(String(n).padStart(3, '0'));
        expect(h).not.toBeNull();
        buckets.set(h, (buckets.get(h) || 0) + 1);
      }
      expect(buckets.size).toBe(HOUSE_COUNT);
      const counts = [...buckets.values()];
      // A spread of at most 1 is the best any last-digit split can do.
      expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
      expect(counts.reduce((a, b) => a + b, 0)).toBe(max);
    },
  );

  it('handles สาย above 100, which the first seed made impossible', () => {
    expect(houseOf('101')).toBe(1);
    expect(houseOf('204')).toBe(4);
    expect(houseOf('287')).toBe(7);
    expect(houseOf('999')).toBe(9);
  });

  it('puts 100 with 010..090, not in a house of its own', () => {
    expect(houseOf('100')).toBe(houseOf('010'));
  });
});

describe('auditSaiWidths — the leading-zero disaster is only visible file-wide', () => {
  it('accepts a file where every สาย is three digits', () => {
    const a = auditSaiWidths(['001', '017', '100', '099']);
    expect(a.consistent).toBe(true);
    expect(a.looksLikeStrippedZeros).toBe(false);
  });

  it('accepts a consistently 2-digit file (a different but valid convention)', () => {
    const a = auditSaiWidths(['01', '17', '99']);
    expect(a.consistent).toBe(true);
  });

  it('CATCHES the Excel mix, which no single row reveals', () => {
    // '1' here was '001' before a spreadsheet touched it. On its own it looks
    // like a perfectly ordinary สาย.
    const a = auditSaiWidths(['1', '17', '100', '003']);
    expect(a.consistent).toBe(false);
    expect(a.looksLikeStrippedZeros).toBe(true);
    expect(a.widths).toEqual([
      { width: 1, count: 1 }, { width: 2, count: 1 }, { width: 3, count: 2 },
    ]);
  });

  it('counts blanks separately instead of calling them a width', () => {
    const a = auditSaiWidths(['001', '', '  ', '017']);
    expect(a.blank).toBe(2);
    expect(a.consistent).toBe(true);
  });
});

describe('cleanCell / blankish — "-" must never become a nickname', () => {
  it('turns the placeholder spellings into null', () => {
    for (const v of ['-', '–', 'N/A', 'na', 'ไม่มี', 'ยังไม่ทราบ', 'null', '']) {
      expect(cleanCell(v)).toBeNull();
    }
    expect(blankish('-')).toBe(true);
  });

  it('keeps real content', () => {
    expect(cleanCell(' โอ๊ต ')).toBe('โอ๊ต');
  });

  it('strips the invisible spaces that arrive from Word/web copy-paste', () => {
    expect(cleanSpace('มานี ใจดี')).toBe('มานี ใจดี');
    expect(cleanSpace('ก​ข')).toBe('ก ข');
    expect(cleanSpace('  a   b  ')).toBe('a b');
  });
});

describe('normalizeKkumail', () => {
  it('lowercases and trims', () => {
    expect(normalizeKkumail('  Manee.J@KKUmail.com ').value)
      .toBe('manee.j@kkumail.com');
  });
  it('rejects a value that is not an address — this key is the login match', () => {
    expect(normalizeKkumail('manee.j').ok).toBe(false);
    expect(normalizeKkumail('-').ok).toBe(false);
    expect(normalizeKkumail('').ok).toBe(false);
  });
});

describe('joinName', () => {
  it('joins the two columns the spec asks for', () => {
    expect(joinName('มานี', 'ใจดี')).toBe('มานี ใจดี');
  });
  it('keeps a multi-word surname whole', () => {
    expect(joinName('สุดา', 'ณ ลำปาง')).toBe('สุดา ณ ลำปาง');
  });
  it('survives a missing half', () => {
    expect(joinName('มานี', '')).toBe('มานี');
  });
});

describe('houseLabel — a house with no name yet is not an error', () => {
  it('falls back to the number, which IS the pre-จับฉลาก state', () => {
    expect(houseLabel(3, null)).toBe('บ้าน 3');
    expect(houseLabel(0, '   ')).toBe('บ้าน 0');
  });
  it('uses the name once there is one', () => {
    expect(houseLabel(3, 'กัลปพฤกษ์')).toBe('กัลปพฤกษ์');
  });
});

// These cases are the SAME ones tools/house0116-authz.sql asserts against the
// live database (สาย 017 → house 7, รหัส 65…, academic year 2569 → ปี 5). The
// SQL is the authority; this pins the JS mirror to it so the two cannot drift
// silently between deploys.
describe('cohortFromStudentId — mirrors SQL cohort_from_student_id', () => {
  it('reads ปีที่เข้า from the first two digits', () => {
    expect(cohortFromStudentId('659999999-9')).toBe(2565);
    expect(cohortFromStudentId('6599999999')).toBe(2565);
    expect(cohortFromStudentId('689999996-6')).toBe(2568);
  });

  it('FAILS CLOSED outside 2540–2580 — the 0118 fix', () => {
    // 2500+99 = 2599 was inside the original bound, so a malformed id produced
    // a confident "ปี 1" after the clamp. It must be null.
    expect(cohortFromStudentId('993070001-4')).toBeNull();
    expect(cohortFromStudentId('103070001-4')).toBeNull();
  });

  it('returns null rather than guessing on junk', () => {
    expect(cohortFromStudentId('abc')).toBeNull();
    expect(cohortFromStudentId('')).toBeNull();
    expect(cohortFromStudentId(null)).toBeNull();
  });
});

describe('cohortLabel — รุ่น, the only cohort vocabulary ระบบบ้าน has', () => {
  it('names the รุ่น from the stored ปีที่เข้า', () => {
    expect(cohortLabel({ cohort_year: 2565 })).toBe('MD50');
    expect(cohortLabel({ cohort_year: 2564 })).toBe('MD49');
  });

  it('falls back to รหัสนักศึกษา when no ปีที่เข้า is stored', () => {
    expect(cohortLabel({ student_id: '659999999-9' })).toBe('MD50');
  });

  it('needs NO clock — the same record reads the same forever', () => {
    // The whole point of replacing ชั้นปี. There is no academic-year argument
    // to pass, so there is nothing to forget to move in August.
    expect(cohortLabel.length).toBeLessThanOrEqual(1);
  });

  it('IGNORES year_override — ชั้นปี is not a thing here any more', () => {
    expect(cohortLabel({ cohort_year: 2565, year_override: 3 })).toBe('MD50');
  });

  it('returns null — not a guess — when there is nothing to derive from', () => {
    expect(cohortLabel({})).toBeNull();
    expect(cohortLabel()).toBeNull();
    // Outside cohortFromStudentId's 2540–2580 window: no รุ่น beats a wrong one.
    expect(cohortLabel({ student_id: '993070001-4' })).toBeNull();
  });
});

describe('000 is not a สายรหัส — it is a blank cell a spreadsheet filled in', () => {
  it('refuses every all-zero spelling', () => {
    for (const raw of ['0', '00', '000', '๐']) {
      const n = normalizeSai(raw);
      expect(n.ok).toBe(false);
      expect(n.value).toBe(raw);      // kept verbatim so the warning can quote it
    }
  });

  it('still accepts every สาย that ends in 0 — บ้าน 0 is unaffected', () => {
    for (const [raw, want] of [['10', '010'], ['20', '020'], ['100', '100'], ['990', '990']]) {
      const n = normalizeSai(raw);
      expect(n.ok).toBe(true);
      expect(n.value).toBe(want);
      expect(houseOf(n.value)).toBe(0);
    }
  });
});

describe('saiProblem — the message a person can act on', () => {
  it('names the blank-cell-filled-with-zero case specifically', () => {
    expect(saiProblem('0')).toMatch(/000 ไม่มีอยู่จริง/);
    expect(saiProblem('000')).toMatch(/โปรแกรมตาราง/);
  });
  it('distinguishes too-long from unreadable', () => {
    expect(saiProblem('1234')).toMatch(/ยาวเกิน 3 หลัก/);
    expect(saiProblem('abc')).toMatch(/1–3 หลัก/);
  });
  it('says nothing about a สาย that is fine', () => {
    expect(saiProblem('7')).toBeNull();
    expect(saiProblem('017')).toBeNull();
    expect(saiProblem('')).toBeNull();
  });
});

describe('safeColor — houses.color lands in a style attribute', () => {
  it('passes a hex colour through', () => {
    expect(safeColor('#105922')).toBe('#105922');
    expect(safeColor('#FFF')).toBe('#FFF');
  });
  it('refuses anything that could carry a second declaration', () => {
    // escHtml stops the ATTRIBUTE being broken out of; it does not stop
    // `#fff;background:url(...)` from being valid CSS inside it.
    expect(safeColor('#fff;background:url(x)')).toBeNull();
    expect(safeColor('red')).toBeNull();
    expect(safeColor('')).toBeNull();
    expect(safeColor(null, '#e9ecef')).toBe('#e9ecef');
  });
});

describe('ชั้นปี — a DIFFERENCE is stored, the year is derived', () => {
  // ASKED FOR: persist both รุ่น and ปี. The answer is to persist รุ่น and the
  // GAP, because a stored ชั้นปี is right for one August and silently wrong
  // every August after — the same fill-once failure 0128 fixed on cohort_year
  // and 0129 dropped from year_override.
  const AUG_2026 = new Date('2026-08-15T00:00:00Z');   // ปีการศึกษา 2569
  const JUN_2026 = new Date('2026-06-15T00:00:00Z');   // still 2568
  const AUG_2027 = new Date('2027-08-15T00:00:00Z');   // 2570

  it('the clock FALLBACK rolls the ปีการศึกษา over in กรกฎาคม, not in January', () => {
    // 0244 moved the default cutoff to 1 ก.ค. (the instant June ends). The real
    // answer comes from the database; this is only what a failed fetch shows.
    expect(academicYear(AUG_2026)).toBe(2569);
    expect(academicYear(JUN_2026)).toBe(2568);
    expect(academicYear(new Date('2026-06-30T12:00:00Z'))).toBe(2568);
    expect(academicYear(new Date('2026-07-01T12:00:00Z'))).toBe(2569);
  });

  it('counts a normal student from their ปีที่เข้า', () => {
    // MD50 entered 2565 → ปี 5 in 2569.
    expect(studyYearLabel({ cohort_year: 2565 }, AUG_2026)).toBe('ปี 5');
    expect(studyYearLabel({ student_id: '659999999-9' }, AUG_2026)).toBe('ปี 5');
  });

  it('advances everyone by one the next August, with nothing stored changing', () => {
    // THE POINT. Same row, no write, correct answer a year later.
    const rec = { cohort_year: 2565 };
    expect(studyYearLabel(rec, AUG_2026)).toBe('ปี 5');
    expect(studyYearLabel(rec, AUG_2027)).toBe('ปี 6');
  });

  it('keeps a ลาพัก student correct in EVERY later year — the whole reason for an offset', () => {
    // A stored `year = 4` would be right in 2569 and wrong in 2570. The offset
    // is right in both, forever, with no maintenance.
    const rec = { cohort_year: 2565, year_offset: -1 };
    expect(studyYearLabel(rec, AUG_2026)).toBe('ปี 4');
    expect(studyYearLabel(rec, AUG_2027)).toBe('ปี 5');
  });

  it('is not bounded — two years behind, or ahead, both work', () => {
    expect(studyYearLabel({ cohort_year: 2565, year_offset: -2 }, AUG_2026)).toBe('ปี 3');
    expect(studyYearLabel({ cohort_year: 2565, year_offset: -4 }, AUG_2026)).toBe('ปี 1');
    expect(studyYearLabel({ cohort_year: 2565, year_offset: 1 }, AUG_2026)).toBe('ปี 6');
  });

  it('says จบแล้ว past ปี 6 instead of inventing a ปี 7', () => {
    // A graduation signal out of the arithmetic — no `status` column to keep
    // current (0120 dropped that one for the same reason).
    expect(studyYearLabel({ cohort_year: 2563 }, AUG_2026)).toBe('จบแล้ว');
    expect(studyYearLabel({ cohort_year: 2565, year_offset: 3 }, AUG_2026)).toBe('จบแล้ว');
  });

  it('has NO ชั้นปี for someone with no ปีที่เข้า — never a guess', () => {
    // A shared department account, or a member whose รหัส has not been filled
    // in. The honest answer is nothing; the tempting one is "ปี 1".
    expect(studyYearLabel({}, AUG_2026)).toBeNull();
    expect(studyYearLabel({ student_id: 'not-a-รหัส' }, AUG_2026)).toBeNull();
    expect(studyYear({}, AUG_2026)).toBeNull();
  });

  it('turns a PICKED year into the gap, and an unchanged pick into null', () => {
    const rec = { cohort_year: 2565 };                 // computes to ปี 5
    expect(offsetForPickedYear(rec, 5, AUG_2026)).toBeNull();   // no adjustment
    expect(offsetForPickedYear(rec, 4, AUG_2026)).toBe(-1);
    expect(offsetForPickedYear(rec, 2, AUG_2026)).toBe(-3);
    expect(offsetForPickedYear(rec, 6, AUG_2026)).toBe(1);
  });

  it('computes the gap against the UNADJUSTED year, so re-picking is stable', () => {
    // The trap: computing the offset from the already-offset value would make
    // every save compound the previous one — pick ปี 4 twice and land on ปี 3.
    const rec = { cohort_year: 2565, year_offset: -1 };  // shows ปี 4
    expect(offsetForPickedYear(rec, 4, AUG_2026)).toBe(-1);     // unchanged
    expect(offsetForPickedYear(rec, 5, AUG_2026)).toBeNull();   // back to normal
  });

  it('cannot produce an offset for a row with no ปีที่เข้า', () => {
    expect(offsetForPickedYear({}, 4, AUG_2026)).toBeNull();
  });
});
