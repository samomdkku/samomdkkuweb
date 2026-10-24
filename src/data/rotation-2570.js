// ============================================================
// rotation-2570.js — the TIMETABLE of แลก Rotation's first round, transcribed
// from the faculty's PDF "ตาราง Rotation ปี 6 Block 1 ปีการศึกษา 2570
// (แจ้งนศ. 24-10-69)". No people in this file — the roster is in the database
// (tools/rotation-import.mjs), because the repo is public.
//
// HOW THE PDF IS BUILT, and therefore this file:
//   • 48 teaching weeks, Monday 26 เม.ย. 2570 → Friday 24 มี.ค. 2571.
//   • six 8-week BLOCKS (Block 1, 2/1, 2/2 = ภาคต้น · 3/1, 3/2, 4 = ภาคปลาย).
//   • six UNITS, each exactly one block long (the credits in brackets ARE the
//     weeks: "Theory(2)" = 2 weeks).
//   • six GROUPS A–F. Every group takes every unit once; group B is group A
//     shifted one block, C two, and so on. Only the Sec.01 / Sec.02 per course
//     differs in a way that is not a rotation — so it is written out per group.
//
// A swap changes which GROUP a student is in; it never changes this file.
// A new round (next year) = a new file like this one + a row in
// rotation_rounds + an import. tests: src/js/rotation/schedule.test.js checks
// every group covers every unit once and every unit fills its block exactly.
// ============================================================

export const ROTATION_2570 = {
  roundId: 'y6-2570',
  title: 'Rotation ปี 6 ปีการศึกษา 2570',
  hospital: 'โรงพยาบาลศรีนครินทร์',
  source: 'ตาราง Rotation ปี 6 Block 1 ปีการศึกษา 2570 (แจ้งนศ. 24-10-69)',
  // ISO date of the Monday of week 1 (26 เม.ย. 2570 = 2027-04-26).
  firstMonday: '2027-04-26',
  weeks: 48,

  blocks: [
    { key: 'b1',  label: 'Block 1',   term: 'ภาคต้น',  startWeek: 1,  weeks: 8 },
    { key: 'b21', label: 'Block 2/1', term: 'ภาคต้น',  startWeek: 9,  weeks: 8 },
    { key: 'b22', label: 'Block 2/2', term: 'ภาคต้น',  startWeek: 17, weeks: 8 },
    { key: 'b31', label: 'Block 3/1', term: 'ภาคปลาย', startWeek: 25, weeks: 8 },
    { key: 'b32', label: 'Block 3/2', term: 'ภาคปลาย', startWeek: 33, weeks: 8 },
    { key: 'b4',  label: 'Block 4',   term: 'ภาคปลาย', startWeek: 41, weeks: 8 },
  ],

  // `tone` is the PDF's own colour for the unit, softened for text on top.
  // `courses` run in order; `weeks` may be fractional (OB-GYN is 2.5 + 3.5).
  units: {
    surg: {
      name: 'Surgery III', short: 'Surg', tone: '#a9c8ea',
      courses: [
        { code: 'MD 756 107', kind: 'Theory',      weeks: 2 },
        { code: 'MD 756 108', kind: 'Competency',  weeks: 2 },
        { code: 'MD 756 109', kind: 'Practice',    weeks: 4 },
      ],
    },
    comp: {
      name: 'สมรรถนะ', short: 'สมรรถนะ', tone: '#f3c4f3',
      courses: [
        { code: null, kind: 'สมรรถนะ (8)', weeks: 8 },
      ],
    },
    med: {
      name: 'Medicine III', short: 'Med', tone: '#f6bf99',
      courses: [
        { code: 'MD 796 107', kind: 'Theory',      weeks: 2 },
        { code: 'MD 796 108', kind: 'Competency',  weeks: 2 },
        { code: 'MD 796 109', kind: 'Practice',    weeks: 4 },
      ],
    },
    peds: {
      name: 'Pediatrics II', short: 'Ped', tone: '#b9d9a2',
      courses: [
        { code: 'MD 686 103', kind: 'Theory',        weeks: 2 },
        { code: 'MD 686 104', kind: 'Practice',      weeks: 4 },
        { code: 'MD 536 125', kind: 'Ambulatory II', weeks: 2 },
      ],
    },
    ob: {
      name: 'Obstetrics and Gynecology II', short: 'OB-GYN', tone: '#fbdc85',
      courses: [
        { code: 'MD 766 103', kind: 'Theory',       weeks: 2.5 },
        { code: 'MD 766 104', kind: 'Practice',     weeks: 3.5 },
        { code: null,         kind: 'สมรรถนะ (2)',  weeks: 2 },
      ],
    },
    ortho: {
      name: 'Orthopedics II', short: 'Ortho', tone: '#f7a9cf',
      courses: [
        { code: 'MD 786 103', kind: 'Theory',   weeks: 1 },
        { code: 'MD 786 104', kind: 'Practice', weeks: 3 },
        { code: 'MD 606 102', kind: 'EM II',    weeks: 4 },
      ],
    },
  },

  // Per group: the unit in each block (in block order), with the section of
  // each of that unit's courses, in course order — read off the PDF band.
  groups: {
    A: [['surg', [1, 1, 1]], ['comp', [2]], ['med', [2, 2, 2]], ['peds', [1, 1, 1]], ['ob', [2, 2, 2]], ['ortho', [1, 1, 1]]],
    B: [['comp', [2]], ['med', [1, 1, 1]], ['peds', [2, 2, 2]], ['ob', [1, 1, 2]], ['ortho', [2, 2, 2]], ['surg', [1, 1, 1]]],
    C: [['med', [1, 1, 1]], ['peds', [1, 1, 1]], ['ob', [2, 2, 2]], ['ortho', [1, 1, 1]], ['surg', [2, 2, 2]], ['comp', [2]]],
    D: [['peds', [1, 1, 1]], ['ob', [1, 1, 2]], ['ortho', [2, 2, 2]], ['surg', [1, 1, 1]], ['comp', [2]], ['med', [1, 1, 1]]],
    E: [['ob', [1, 1, 2]], ['ortho', [1, 1, 1]], ['surg', [2, 2, 2]], ['comp', [2]], ['med', [2, 2, 2]], ['peds', [1, 1, 1]]],
    F: [['ortho', [1, 1, 1]], ['surg', [1, 1, 1]], ['comp', [2]], ['med', [1, 1, 1]], ['peds', [2, 2, 2]], ['ob', [1, 1, 2]]],
  },
};
