// ==============================================
// gaps.test.js — the ข้อมูลไม่ครบ panel's arithmetic.
//
// This is a PURE function on purpose, so the part worth defending can be tested
// without a DOM: what counts as a gap, who owns it, and — the one that has
// already gone wrong once — what does NOT count.
// ==============================================
import { describe, it, expect } from 'vitest';
import { computeGaps, TONE } from './gaps.js';

// MD49 = 2564 (COHORT_EPOCH 2515). Written through the cohort_year the app
// actually stores rather than a label, because that is what the rows carry.
const YEAR = { MD49: 2564, MD50: 2565, MD51: 2566 };
const student = (sai, cohort, extra = {}) => ({
  id: `s${sai}${cohort}`, kkumail: `x${sai}.${cohort}@kkumail.com`,
  student_id: `${cohort - 1900}30700${sai}-1`,
  first_name_th: 'ก', last_name_th: 'ข', nickname: 'ค',
  major: 'MD', sai_code: String(sai).padStart(3, '0'), cohort_year: cohort,
  ...extra,
});
const heldRow = (sai, extra = {}) => ({
  id: `h${sai}`, sai: String(sai).padStart(3, '0'),
  student_id: '653070001-1', first_name_th: 'ง', last_name_th: 'จ',
  cohort_year: YEAR.MD50, reason: 'no_kkumail', resolved_at: null, ...extra,
});
const byKey = (g) => Object.fromEntries(g.groups.map((x) => [x.key, x]));

// A cohort with สาย 1..n and no holes — the healthy shape every assertion below
// is measured against.
const full = (n, cohort) => Array.from({ length: n }, (_, i) => student(i + 1, cohort));

describe('what counts as a gap', () => {
  it('a complete roster reports nothing at all', () => {
    const g = computeGaps({
      students: full(5, YEAR.MD49),
      houses: Array.from({ length: 10 }, (_, id) => ({ id, name: `บ้าน${id}` })),
      sais: Array.from({ length: 5 }, (_, i) => ({ code: String(i + 1).padStart(3, '0') })),
      advisors: [{ id: 'a1', full_name: 'อ.' }],
    });
    expect(g.groups).toEqual([]);
    expect(g.actionable).toBe(0);
  });

  // ⛔ THE REGRESSION. The first version counted only `students`, so the 165
  // people the file named but could not address read as 165 holes and every
  // รุ่น was flagged — a warning that fires on the healthy case. A held row is a
  // real person on a real สาย; only their address is missing.
  it('a held row OCCUPIES its สาย — it is not a hole', () => {
    const students = full(5, YEAR.MD50).filter((s) => s.sai_code !== '003');
    const withHeld = computeGaps({ students, held: [heldRow(3)] });
    expect(byKey(withHeld).sai_gap).toBeUndefined();

    // CONTROL: the same roster with nobody on 003 DOES report the hole, so the
    // assertion above is not passing on an audit that never fires.
    const without = computeGaps({ students });
    expect(byKey(without).sai_gap.count).toBe(1);
    expect(byKey(without).sai_gap.rows[0].hint).toContain('003');
  });

  it('reads สาย from either spelling — students say sai_code, held rows say sai', () => {
    const students = full(3, YEAR.MD50).filter((s) => s.sai_code !== '002');
    // list_unresolved_rows emits `sai`; students carry `sai_code`. An audit that
    // knew one spelling would read zero of the other and invent a hole.
    expect(byKey(computeGaps({ students, held: [{ ...heldRow(2), sai_code: undefined }] })).sai_gap)
      .toBeUndefined();
  });

  it('two people of the SAME รุ่น on one สาย is reported with both names', () => {
    const students = [...full(3, YEAR.MD49), student(2, YEAR.MD49, { first_name_th: 'ฉ' })];
    const shared = byKey(computeGaps({ students })).sai_shared;
    expect(shared.count).toBe(1);
    expect(shared.rows[0].name).toContain('002');
    expect(shared.rows[0].detail).toBe('2 คน');
    // The SAME สาย in two DIFFERENT รุ่น is normal — สาย are numbered per รุ่น.
    const twoCohorts = computeGaps({
      students: [...full(3, YEAR.MD49), ...full(3, YEAR.MD50)],
    });
    expect(byKey(twoCohorts).sai_shared).toBeUndefined();
  });
});

describe('the cross-รุ่น signal', () => {
  // One รุ่น missing a สาย is ordinary. The same สาย missing from several at
  // once is the shape of a column that moved — and บ้าน is its last digit.
  const threeCohortsMissing2 = {
    students: [YEAR.MD49, YEAR.MD50, YEAR.MD51]
      .flatMap((c) => full(4, c).filter((s) => s.sai_code !== '002')),
  };

  it('fires when one สาย is missing from more than one รุ่น', () => {
    const across = byKey(computeGaps(threeCohortsMissing2)).sai_across;
    expect(across.count).toBe(1);
    expect(across.rows[0].name).toBe('สาย 002');
    expect(across.rows[0].detail).toContain('MD49');
    expect(across.rows[0].detail).toContain('MD51');
  });

  it('does NOT fire when only one รุ่น is missing it', () => {
    const one = computeGaps({
      students: [...full(4, YEAR.MD49).filter((s) => s.sai_code !== '002'), ...full(4, YEAR.MD50)],
    });
    expect(byKey(one).sai_across).toBeUndefined();
  });

  // Each unplaced held row can account for AT MOST ONE รุ่น, because a person is
  // in one รุ่น. The arithmetic is the whole point: three รุ่น missing 002 with
  // one such row leaves two genuinely unaccounted for.
  it('a held row with no รุ่น can explain only one of them', () => {
    const withOne = computeGaps({
      ...threeCohortsMissing2,
      held: [heldRow(2, { cohort_year: null, student_id: null })],
    });
    const row = byKey(withOne).sai_across.rows[0];
    expect(row.hint).toContain('1 คน');
    expect(row.hint).toContain('2 รุ่น');

    // Three such rows account for all three, and the group falls silent.
    const withThree = computeGaps({
      ...threeCohortsMissing2,
      held: [1, 2, 3].map((i) => heldRow(2, { id: `u${i}`, cohort_year: null, student_id: null })),
    });
    expect(byKey(withThree).sai_across).toBeUndefined();
  });
});

describe('who owns each group', () => {
  it('a held row without a รหัส is an ADMIN job; with one it is the person’s', () => {
    const g = byKey(computeGaps({
      held: [
        heldRow(1, { id: 'a', student_id: null, reason: 'no_kkumail_no_student_id' }),
        heldRow(2, { id: 'b' }),
      ],
    }));
    expect(g.held_admin.tone).toBe(TONE.act);
    expect(g.held_admin.count).toBe(1);
    expect(g.held_self.tone).toBe(TONE.tell);
    expect(g.held_self.count).toBe(1);
  });

  // ⛔ THE BADGE. Counting the people who can fix themselves makes it read
  // 150-something for weeks, and the one person who looks at it stops looking.
  it('the badge counts ONLY what an admin must do', () => {
    const g = computeGaps({
      held: [
        heldRow(1, { id: 'a', student_id: null }),        // act  → counts
        ...Array.from({ length: 150 }, (_, i) => heldRow(i + 2, { id: `s${i}` })), // tell
      ],
      requests: [{ id: 'r', status: 'pending' }],          // act  → counts
      helpReqs: [{ id: 'h', resolved_at: null }],          // act  → counts
      conflicts: 2,                                        // act  → counts
      houses: [{ id: 1, name: null }],                     // setup
    });
    expect(g.actionable).toBe(5);
    expect(g.groups.find((x) => x.key === 'held_self').count).toBe(150);
  });

  it('a resolved held row and a decided request are not gaps', () => {
    const g = computeGaps({
      students: full(2, YEAR.MD49),
      held: [heldRow(1, { resolved_at: '2026-09-14T00:00:00Z', student_id: null })],
      helpReqs: [{ id: 'h', resolved_at: '2026-09-14T00:00:00Z' }],
      requests: [{ id: 'r', status: 'approved' }],
      houses: Array.from({ length: 10 }, (_, id) => ({ id, name: `บ้าน${id}` })),
      sais: [{ code: '001' }, { code: '002' }],
      advisors: [{ id: 'a', full_name: 'อ.' }],
    });
    expect(g.groups).toEqual([]);
  });

  // ⚠️ Before the first import everything is "unset" and none of it is wrong.
  // A panel that opens with nine unnamed houses and no advisors on a system
  // nobody has used yet is a warning on the healthy case.
  it('says nothing at all about a system with no data in it', () => {
    expect(computeGaps({ houses: Array.from({ length: 10 }, (_, id) => ({ id, name: null })) }))
      .toEqual({ groups: [], actionable: 0 });
    expect(computeGaps({})).toEqual({ groups: [], actionable: 0 });
    // CONTROL: one student is enough to make the same unset houses worth saying.
    expect(computeGaps({
      students: [student(1, YEAR.MD49)],
      houses: Array.from({ length: 10 }, (_, id) => ({ id, name: null })),
    }).groups.some((g) => g.key === 'houses_unnamed')).toBe(true);
  });

  it('a group that counts สาย or บ้าน does not say “คน”', () => {
    const g = computeGaps({
      students: [
        ...full(3, YEAR.MD49),
        student(2, YEAR.MD49, { id: 'dup', first_name_th: 'ฉ' }),
      ],
      houses: [{ id: 1, name: null }],
      sais: [{ code: '001' }, { code: '002' }, { code: '003' }, { code: '099' }],
      advisors: [{ id: 'a', full_name: 'อ.' }],
    });
    const u = Object.fromEntries(g.groups.map((x) => [x.key, x.unit]));
    expect(u.sai_shared).toBe('สาย');
    expect(u.houses_unnamed).toBe('บ้าน');
    expect(u.sai_empty).toBe('สาย');
  });

  it('every group says who it belongs to and why, in Thai', () => {
    const g = computeGaps({
      students: [student(1, YEAR.MD49, { sai_code: null, nickname: null })],
      held: [heldRow(9, { student_id: null })],
      houses: [{ id: 1, name: null }],
      advisors: [],
      conflicts: 1,
    });
    for (const grp of g.groups) {
      expect(Object.values(TONE)).toContain(grp.tone);
      // ⛔ EVERY GROUP STATES ITS OWN UNIT. The pane renders `count + unit`, and
      // the first version defaulted to "คน" — so "2 คน" sat under a heading
      // about สายรหัส (it counts สาย) and "9 คน" under one about บ้าน. A label
      // makes a claim about every case it covers.
      expect(grp).toHaveProperty('unit');
      expect(grp.title.length).toBeGreaterThan(3);
      // A row an admin cannot interpret is a row they will not act on.
      expect(grp.why.length).toBeGreaterThan(20);
      expect(grp.count).toBeGreaterThan(0);
    }
  });
});


// ============================================================
// EVERY PERSON-COUNT SAYS WHAT IT IS OUT OF (2026-09-15).
//
// REPORTED: "isn't people who doesn't have student id and doesn't have kkumail
// already included in รายชื่อที่ยังนำเข้าไม่ได้, making it appear in ข้อมูลไม่ครบ
// misleading". It was. The 13 and the 152 are one population split by owner, and
// neither is inside นักศึกษาทั้งหมด — but every group printed a bare number, so
// there was nothing on screen to read that from.
// ============================================================
describe('every person-group states its denominator', () => {
  const REAL = {
    students: Array.from({ length: 1611 }, (_, i) => ({
      id: `s${i}`, first_name_th: 'ก', last_name_th: 'ข', student_id: `67307${i}`,
      sai_code: String((i % 250) + 1).padStart(3, '0'), nickname_imported: 'เอ',
    })),
    held: Array.from({ length: 165 }, (_, i) => ({
      id: `h${i}`, first_name_th: i < 2 ? '' : 'ค', last_name_th: 'ง',
      student_id: i < 13 ? '' : `67307h${i}`, sai: '099', resolved_at: null,
    })),
  };

  it('⛔ names the population behind every count of people', () => {
    const { groups } = computeGaps(REAL);
    const people = groups.filter((g) => g.unit === 'คน' && g.count > 0
      && ['held_admin', 'held_self', 'no_sai', 'no_name', 'no_sid', 'no_nick', 'gone'].includes(g.key));
    expect(people.length, 'no person-groups produced — the fixture stopped exercising this')
      .toBeGreaterThan(0);
    const bare = people.filter((g) => !g.scope).map((g) => g.key);
    expect(bare, [
      `these groups print a count of people with no stated denominator: ${bare.join(', ')}`,
      'A bare number invites the reading that it is a separate population. It is',
      'what made "ข้อมูลไม่ครบ 13" look like 13 people who were NOT already among',
      'the 165 ยังนำเข้าไม่ได้. Give it a `scope`.',
    ].join('\n')).toEqual([]);
  });

  it('the two held groups say they come from the SAME held population', () => {
    const { groups } = computeGaps(REAL);
    const admin = groups.find((g) => g.key === 'held_admin');
    const self = groups.find((g) => g.key === 'held_self');
    expect(admin.count + self.count, 'held_admin + held_self must BE the held total')
      .toBe(REAL.held.length);
    expect(admin.scope).toBe(self.scope);
    expect(admin.scope).toContain(String(REAL.held.length));
  });

  it('a student-group does NOT claim the held denominator', () => {
    const { groups } = computeGaps(REAL);
    const nick = groups.find((g) => g.key === 'no_nick');
    if (nick?.scope) {
      expect(nick.scope, 'a count over students must not name the held total')
        .not.toBe(groups.find((g) => g.key === 'held_admin').scope);
    }
  });
});
