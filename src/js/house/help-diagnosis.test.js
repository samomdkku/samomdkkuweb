import { describe, it, expect } from 'vitest';
import {
  claimPrecheck, diagnoseHelpRequest, coveredCohortLabels, houseCoversCohort, outsideCohortNote,
} from './help-diagnosis.js';

// 2026-10-13 is academic year 2569: MD49 (entered 2564) is in ปี 6.
const NOW = new Date('2026-10-13T12:00:00+07:00');
// Synthetic ids with a correct check digit (weights 10..2, (10 - sum%10)%10).
const ok = (body) => {
  let s = 0;
  for (let i = 0; i < 9; i += 1) s += Number(body[i]) * (10 - i);
  return `${body}-${(10 - (s % 10)) % 10}`;
};
const MD48 = ok('630000001');
const MD54 = ok('690000001');
const bad = (id) => id.slice(0, -1) + String((Number(id.slice(-1)) + 1) % 10);

describe('which รุ่น ระบบบ้าน covers', () => {
  it('is the six รุ่น studying this academic year', () => {
    expect(coveredCohortLabels(NOW)).toEqual(['MD49', 'MD50', 'MD51', 'MD52', 'MD53', 'MD54']);
    expect(houseCoversCohort(2563, NOW)).toBe(false);
  });
});

describe('claimPrecheck — the student is told only what the NUMBER says', () => {
  it('lets a well-formed, in-range รหัส through to the server', () => {
    expect(claimPrecheck(MD54, NOW)).toBe(null);
  });
  it('catches a mistyped digit before anything is recorded', () => {
    expect(claimPrecheck(bad(MD54), NOW)).toMatch(/พิมพ์ผิด/);
  });
  it('no longer turns a รุ่น outside the system away (0268)', () => {
    // Owner, 2026-10-31: they fill everything in for an admin to check.
    expect(claimPrecheck(MD48)).toBeNull();
  });
});

describe('outsideCohortNote — what an out-of-range รุ่น is told (0268)', () => {
  it('names the รุ่น, says the สาย cannot be checked, and says CONTACT first', () => {
    const t = outsideCohortNote(MD48, NOW);
    expect(t).toMatch(/MD48/);
    expect(t).toMatch(/ตรวจสอบไม่ได้/);
    // Owner's correction: contact through VitalSound or the usual channel —
    // not "send the data now".
    expect(t).toMatch(/ติดต่อ/);
    expect(t).toMatch(/VitalSound/);
    expect(t).toMatch(/ช่องทาง/);
  });
  it('is silent for a covered รุ่น and for a malformed รหัส', () => {
    expect(outsideCohortNote(MD54, NOW)).toBeNull();
    expect(outsideCohortNote('12', NOW)).toBeNull();
  });
});

describe('diagnoseHelpRequest', () => {
  const req = (sid, extra = {}) => ({ kind: 'no_record', typed_student_id: sid, candidates: [], ...extra });

  it('a near miss defers to the candidate list', () => {
    expect(diagnoseHelpRequest(req(MD54, { candidates: [{}] }), {}, NOW).code).toBe('near_miss');
  });
  it('an out-of-range รุ่น can be closed, with the reason prefilled', () => {
    const d = diagnoseHelpRequest(req(MD48), {}, NOW);
    expect(d.code).toBe('outside');
    expect(d.close).toMatch(/MD48/);
  });
  it('…but once they SENT details it is not prefilled to close (0268)', () => {
    // Closing would throw away what they handed over; the admin checks the
    // สาย with the class head instead.
    const d = diagnoseHelpRequest(req(MD48, { details_at: '2026-10-31' }), {}, NOW);
    expect(d.code).toBe('outside');
    expect(d.close).toBe(null);
    expect(d.text).toMatch(/หัวหน้าชั้นปี/);
  });
  it('an absent รหัส with details points at the class head\'s sheet, not ฝ่ายข้อมูล', () => {
    expect(diagnoseHelpRequest(req(MD54, { details_at: 'x' }), {}, NOW).text).toMatch(/sheet/);
    expect(diagnoseHelpRequest(req(MD54), {}, NOW).text).toMatch(/ฝ่ายข้อมูล/);
  });
  it('a typo is a typo, and is not closed for them', () => {
    const d = diagnoseHelpRequest(req(bad(MD54)), {}, NOW);
    expect(d.code).toBe('typo');
    expect(d.close).toBe(null);
  });
  it('a รหัส a student already holds is a conflict, not an absence', () => {
    const d = diagnoseHelpRequest(req(MD54), { students: [{ student_id: MD54, first_name_th: 'ก' }] }, NOW);
    expect(d.code).toBe('taken');
  });
  it('a valid in-range รหัส nobody has is ABSENT from the file — ฝ่ายข้อมูล', () => {
    const d = diagnoseHelpRequest(req(MD54), { students: [] }, NOW);
    expect(d.code).toBe('absent');
    expect(d.text).toMatch(/ฝ่ายข้อมูล/);
  });
});
