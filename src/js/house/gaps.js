// ==============================================
// HOUSE GAPS — everything that is missing, mismatched or looks wrong, in one
// place, sorted by WHO CAN FIX IT.
//
// REQUESTED: "can you also list show who got some information missing or
// mismatch or error or wrong -> i want you to make ui for me to can see on the
// admin tab web ระบบบ้าน".
//
// WHY THE GROUPS ARE BY OWNER AND NOT BY SEVERITY. After the first real import
// the honest answer was "165 people are incomplete", and that number is useless:
// 152 of them can fix themselves by signing in, 26 are missing only a ชื่อเล่น
// nobody needs, and 13 are a real worklist that nobody but an admin can touch.
// Sorted by severity they interleave, and the 13 are buried. Sorted by owner the
// screen answers the only question an admin actually has — *what do I have to
// do today* — and everything else is visibly somebody else's.
//
// PURE. No DOM, no network, no clock beyond what it is handed. The admin pane
// already loads every one of these lists to render its other tabs, and
// `tools/house-gaps.mjs` fetches the same rows over SQL — so this function is
// the ONE definition of "incomplete", used by both. A screen and a report that
// each decide separately what counts as a gap is the drift this repo pays for
// most, and the two would disagree the first time either was edited.
// ==============================================
import { cohortLabel, houseOf } from './fields.js';

/** What an admin can do about a group — this is what the pane sorts and colours on. */
export const TONE = {
  act: 'act',      // nobody else can close it
  tell: 'tell',    // the person can, once they know
  watch: 'watch',  // probably a bad file, not a bad person
  setup: 'setup',  // the system itself is unfinished
};

// `students` calls it `sai_code`; a held row comes back from list_unresolved_rows
// as `sai`. One accessor, so an audit cannot silently read zero of one of them.
const saiOf = (r) => r.sai_code || r.sai || '';
const name = (r) => [r.first_name_th, r.last_name_th].filter(Boolean).join(' ').trim();
const label = (r) => cohortLabel(r) || '—';

/**
 * @param {object} d everything the pane has already loaded
 * @param {object[]} d.students   rows from fetchStudents()
 * @param {object[]} d.held       rows from fetchUnresolved()
 * @param {object[]} d.helpReqs   rows from fetchHelpRequests()
 * @param {object[]} d.requests   rows from fetchRequests()
 * @param {object[]} d.houses     rows from fetchHouses()
 * @param {object[]} d.sais       rows from fetchSais()
 * @param {object[]} d.advisors   rows from fetchAdvisors()
 * @param {number}   d.conflicts  open identity conflicts (a COUNT — the rows
 *                                live behind the ตรวจสอบข้อมูล filter, which is
 *                                already the screen for them)
 * @returns {{groups: object[], actionable: number}}
 */
export function computeGaps(d = {}) {
  const students = d.students || [];
  const held = (d.held || []).filter((h) => !h.resolved_at);
  const helpReqs = (d.helpReqs || []).filter((h) => !h.resolved_at);
  const pending = (d.requests || []).filter((r) => r.status === 'pending');
  const houses = d.houses || [];
  const sais = d.sais || [];
  const advisors = d.advisors || [];
  const conflicts = Number(d.conflicts || 0);

  // A held row can only ever be self-claimed with BOTH a รหัสนักศึกษา and a ชื่อ
  // — that is the pair `claim_my_student_seat` matches on. Missing either makes
  // it an admin's, permanently, which is why the split is here and not cosmetic.
  const heldAdmin = held.filter((h) => !h.student_id || !h.first_name_th);
  const heldSelf = held.filter((h) => h.student_id && h.first_name_th);

  const noSai = students.filter((s) => !s.sai_code);
  const noName = students.filter((s) => !s.first_name_th || !s.last_name_th);
  const noSid = students.filter((s) => !s.student_id);
  const noNick = students.filter((s) => !(s.nickname || s.nickname_self || s.nickname_imported));
  const gone = students.filter((s) => s.missing_since);

  // ── the สายรหัส audit, per รุ่น ───────────────────────────────────────────
  //
  // THE ONE CHECK THAT CANNOT BE SEEN ONE ROW AT A TIME, and the reason this
  // whole panel is worth having. บ้าน is the LAST DIGIT of สายรหัส, so a สาย
  // that is wrong by one puts a real student in a different บ้าน and every
  // screen downstream agrees with it. A รุ่น numbers its สาย 1..N, one each; a
  // gap or a repeat means somebody's column moved, and it is invisible until
  // you count the whole รุ่น at once.
  // ⚠️ A HELD ROW OCCUPIES ITS สาย. The first version of this audit counted only
  // `students`, so the 165 people the file named but could not address read as
  // 165 holes and EVERY รุ่น was flagged — a warning that fires on the healthy
  // case, which is worse than no warning. They are real people on real สาย; the
  // only thing missing is their address.
  //
  // The 13 with no รหัสนักศึกษา have no รุ่น to place them in (cohort_year is
  // derived from the รหัส, and 0188 deliberately refuses to read it off the
  // file's block heading). They are counted OUT and reported as a caveat rather
  // than guessed at, because a guess here invents a gap or hides one.
  const occupants = [...students, ...held];
  const unplaced = held.filter((h) => !cohortLabel(h) && saiOf(h)).length;
  const byCohort = new Map();
  for (const s of occupants) {
    if (!saiOf(s)) continue;
    const key = label(s);
    if (key === '—') continue;
    if (!byCohort.has(key)) byCohort.set(key, []);
    byCohort.get(key).push(s);
  }
  const saiShared = [];
  const saiGaps = [];
  const missingAcross = new Map();
  for (const [cohort, rows] of [...byCohort.entries()].sort()) {
    const seen = new Map();
    for (const s of rows) {
      const n = Number(saiOf(s));
      if (!Number.isFinite(n) || n <= 0) continue;
      if (!seen.has(n)) seen.set(n, []);
      seen.get(n).push(s);
    }
    for (const [n, people] of [...seen.entries()].sort((a, b) => a[0] - b[0])) {
      if (people.length > 1) {
        saiShared.push({
          cohort,
          sai: String(n).padStart(3, '0'),
          who: people.map(name).filter(Boolean).join(' · '),
          count: people.length,
        });
      }
    }
    const max = Math.max(...seen.keys());
    const missing = [];
    for (let n = 1; n <= max; n += 1) if (!seen.has(n)) missing.push(String(n).padStart(3, '0'));
    if (missing.length) saiGaps.push({ cohort, missing, max, size: rows.length, unplaced });
    missing.forEach((m) => {
      if (!missingAcross.has(m)) missingAcross.set(m, []);
      missingAcross.get(m).push(cohort);
    });
  }

  // ── THE SHARPEST SIGNAL, and the reason the per-รุ่น list above can stay
  // noisy without costing anything.
  //
  // One รุ่น missing a สาย is ordinary: somebody left, or their row is held with
  // no รุ่น on it. The SAME สาย missing from several รุ่น at once is not — สาย
  // are numbered per รุ่น, so three รุ่น independently skipping 141 is either a
  // coincidence or one column that moved. Each unplaced held row can account
  // for AT MOST ONE of them, because a person is in one รุ่น.
  //
  // This states the arithmetic and stops: it does not say which รุ่น is wrong,
  // because the file is the only source for that and it is what has to be
  // checked. บ้าน is the last digit of สาย, so if a column did move, everyone
  // after the move is in the wrong บ้าน.
  const heldSaiCount = new Map();
  for (const h of held) {
    if (cohortLabel(h) || !saiOf(h)) continue;
    const k = String(Number(saiOf(h))).padStart(3, '0');
    heldSaiCount.set(k, (heldSaiCount.get(k) || 0) + 1);
  }
  const acrossCohorts = [...missingAcross.entries()]
    .map(([sai, cohorts]) => ({
      sai,
      cohorts,
      couldExplain: heldSaiCount.get(sai) || 0,
      unexplained: cohorts.length - (heldSaiCount.get(sai) || 0),
    }))
    .filter((r) => r.cohorts.length > 1 && r.unexplained > 0)
    .sort((a, b) => b.unexplained - a.unexplained);

  // A สาย nobody is on AND no held row names. Held rows count: their สาย was
  // seeded for them and deleting it would break the next import with a 23503.
  const saiEmpty = sais.filter((s) => !students.some((t) => saiOf(t) === s.code)
    && !held.some((h) => saiOf(h) === s.code));

  // ⚠️ AN EMPTY SYSTEM IS NOT A BROKEN ONE. Before the first import there are no
  // students, no advisors and ten unnamed houses — and a panel that answers
  // "what is wrong" with all of that on day one is a warning on the healthy
  // case, which this repo has paid for before. Say nothing until there is
  // something to be incomplete ABOUT; the ภาพรวม tab already explains an empty
  // system in its own words.
  if (!students.length && !held.length) return { groups: [], actionable: 0 };

  const groups = [
    {
      unit: 'คน',
      key: 'held_admin',
      tone: TONE.act,
      title: 'ไม่มีรหัสนักศึกษาในไฟล์',
      why: 'ยืนยันตัวตนเองไม่ได้ เพราะไม่มีอะไรให้จับคู่ ต้องมีคนที่รู้จักเขาเติมอีเมลให้ หรือส่งกลับไปถามฝ่ายข้อมูล',
      goto: 'held',
      count: heldAdmin.length,
      rows: heldAdmin.map((h) => ({
        name: name(h) || '(ไม่มีชื่อในไฟล์)',
        detail: `สาย ${h.sai || '—'}`,
        hint: h.file_note || (h.reason === 'empty_row' ? 'แถวว่าง มีแต่สายรหัส' : ''),
      })),
    },
    {
      unit: 'คน',
      key: 'help',
      tone: TONE.act,
      title: 'แจ้งว่าเข้าระบบแล้วไม่เจอตัวเอง',
      why: 'คนจริงที่ลองแล้วติด — ไม่ใช่แถวที่รอไฟล์ ระบบเก็บสิ่งที่เขากรอกไว้ให้แล้ว',
      goto: 'held',
      count: helpReqs.length,
      rows: [],
    },
    {
      unit: 'คำขอ',
      key: 'requests',
      tone: TONE.act,
      title: 'คำขอแก้ข้อมูลที่ยังไม่ตัดสิน',
      why: 'เจ้าตัวแจ้งว่าข้อมูลผิด และรออนุมัติอยู่',
      goto: 'requests',
      count: pending.length,
      rows: [],
    },
    {
      unit: 'คน',
      key: 'conflicts',
      tone: TONE.act,
      title: 'ชื่อในระบบไม่ตรงกับไฟล์',
      why: 'ระบบเก็บชื่อเดิมไว้ ไม่ทับด้วยไฟล์ — เจ้าตัวเลือกเองได้เมื่อเข้าสู่ระบบ หรือแอดมินเลือกให้',
      goto: 'overview',
      count: conflicts,
      rows: [],
    },
    {
      unit: 'สาย',
      key: 'sai_shared',
      tone: TONE.watch,
      title: 'สายรหัสที่มีคนรุ่นเดียวกันมากกว่าหนึ่งคน',
      // ⛔ The wording matters: this is a statement about the FILE, not about
      // the students. Telling an admin that two people "are wrong" invites a
      // per-person fix, and the fix is a corrected file — one คน cannot be
      // moved to the right สาย without knowing what the right สาย is.
      why: 'ปกติหนึ่งรุ่นมีสายละหนึ่งคน ถ้าซ้ำแปลว่าเลขสายในไฟล์อาจเลื่อน — และบ้านคิดจากหลักสุดท้ายของสาย '
        + 'แก้ที่ไฟล์แล้วนำเข้าใหม่ อย่าแก้ทีละคน (นับรวมคนที่ยังนำเข้าไม่ได้ด้วย เพราะเขาก็ถือสายอยู่)',
      goto: null,
      count: saiShared.length,
      rows: saiShared.map((r) => ({
        name: `${r.cohort} · สาย ${r.sai}`,
        detail: `${r.count} คน`,
        hint: r.who,
      })),
    },
    {
      unit: 'เลข',
      key: 'sai_across',
      tone: TONE.watch,
      title: 'เลขสายเดียวกันหายไปจากหลายรุ่นพร้อมกัน',
      why: 'สายรหัสนับแยกกันในแต่ละรุ่น เลขเดียวกันหายพร้อมกันหลายรุ่นจึงไม่ใช่เรื่องบังเอิญ '
        + 'มักแปลว่าคอลัมน์สายในไฟล์เลื่อนไปหนึ่งช่อง — และบ้านคิดจากหลักสุดท้ายของสาย '
        + 'ถ้าเลื่อนจริง คนตั้งแต่จุดนั้นไปจะอยู่ผิดบ้านทั้งแถบ ขอให้ฝ่ายข้อมูลยืนยันก่อน',
      goto: null,
      count: acrossCohorts.length,
      rows: acrossCohorts.map((r) => ({
        name: `สาย ${r.sai}`,
        detail: `หายจาก ${r.cohorts.join(', ')}`,
        hint: r.couldExplain
          ? `มีรายชื่อค้างที่ถือสายนี้ ${r.couldExplain} คน จึงอธิบายได้อย่างมาก ${r.couldExplain} รุ่น `
            + `เหลืออีก ${r.unexplained} รุ่นที่ไม่มีใครถือเลขนี้เลย`
          : `ไม่มีใครถือเลขนี้เลยสักคน ทั้งที่ควรมีรุ่นละหนึ่งคน`,
      })),
    },
    {
      unit: 'รุ่น',
      key: 'sai_gap',
      tone: TONE.watch,
      title: 'รุ่นที่เลขสายขาดหายไป',
      why: 'แต่ละรุ่นควรมีสาย 1 ถึง N ครบทุกเลข ถ้าขาดแปลว่าไฟล์อาจตกไปหนึ่งแถว หรือเลขสายเลื่อน',
      goto: null,
      count: saiGaps.length,
      rows: saiGaps.map((r) => ({
        name: r.cohort,
        detail: `${r.size} คน · สายสูงสุด ${r.max}`,
        hint: `ไม่มีสาย ${r.missing.slice(0, 12).join(', ')}${r.missing.length > 12 ? ` และอีก ${r.missing.length - 12} เลข` : ''}`
          + (r.unplaced ? ` · มีรายชื่อค้างอีก ${r.unplaced} คนที่ไฟล์ไม่ได้บอกรุ่น อาจเป็นเจ้าของเลขที่ขาดไป` : ''),
      })),
    },
    {
      unit: 'คน',
      key: 'no_sai',
      tone: TONE.watch,
      title: 'นักศึกษาที่ไม่มีสายรหัส',
      why: 'ไม่มีสายแปลว่าไม่มีบ้าน คนกลุ่มนี้เข้าระบบแล้วจะไม่เห็นบ้านของตัวเอง',
      goto: 'students',
      count: noSai.length,
      rows: noSai.map((s) => ({ name: name(s) || s.kkumail, detail: label(s), hint: s.kkumail })),
    },
    {
      unit: 'คน',
      key: 'no_name',
      tone: TONE.watch,
      title: 'นักศึกษาที่ไม่มีชื่อหรือนามสกุล',
      why: 'ไฟล์ไม่ได้ส่งชื่อมา เจ้าตัวกรอกเองได้ แต่ถ้ามีหลายคนแปลว่าไฟล์ขาดทั้งคอลัมน์',
      goto: 'students',
      count: noName.length,
      rows: noName.map((s) => ({ name: name(s) || '(ไม่มีชื่อ)', detail: label(s), hint: s.kkumail })),
    },
    {
      unit: 'คน',
      key: 'gone',
      tone: TONE.watch,
      title: 'อยู่ในระบบ แต่ไม่อยู่ในไฟล์ล่าสุด',
      why: 'ระบบไม่เคยลบใครทิ้ง แค่ทำเครื่องหมายไว้ — อาจลาออก ซ้ำชั้น หรือไฟล์รอบนี้ตกหล่น',
      goto: 'students',
      count: gone.length,
      rows: gone.map((s) => ({ name: name(s) || s.kkumail, detail: label(s), hint: s.kkumail })),
    },
    {
      unit: 'คน',
      key: 'held_self',
      tone: TONE.tell,
      title: 'ยังนำเข้าไม่ได้ แต่ยืนยันตัวตนเองได้',
      why: 'ไฟล์มีรหัสนักศึกษาและชื่อ ขาดแค่ kkumail — เข้าสู่ระบบแล้วกรอกรหัสกับชื่อที่หน้าแรกได้เลย บอกเขาครั้งเดียวพอ',
      goto: 'held',
      count: heldSelf.length,
      rows: [],
    },
    {
      unit: 'คน',
      key: 'no_sid',
      tone: TONE.tell,
      title: 'นักศึกษาที่ไม่มีรหัสนักศึกษา',
      why: 'เจ้าตัวกรอกเองได้ที่หน้าข้อมูลของฉัน — รุ่นจะคำนวณให้เองเมื่อกรอกแล้ว',
      goto: 'students',
      count: noSid.length,
      rows: noSid.map((s) => ({ name: name(s) || s.kkumail, detail: label(s), hint: s.kkumail })),
    },
    {
      unit: 'คน',
      key: 'no_nick',
      tone: TONE.tell,
      title: 'ไม่มีชื่อเล่น',
      why: 'ไม่ต้องทำอะไร เจ้าตัวกรอกเองได้ และถ้าเขาอยู่ในทีม SAMO ระบบเติมให้จากที่นั่นแล้ว',
      goto: 'students',
      count: noNick.length,
      rows: [],
    },
    {
      unit: 'บ้าน',
      key: 'houses_unnamed',
      tone: TONE.setup,
      title: 'บ้านที่ยังไม่ได้ตั้งชื่อ',
      why: 'นักศึกษาจะเห็นคำว่า “บ้าน 3” แทนชื่อจริงของบ้าน',
      goto: 'overview',
      count: houses.filter((h) => !String(h.name ?? '').trim()).length,
      rows: [],
    },
    {
      unit: '',
      key: 'no_advisors',
      tone: TONE.setup,
      title: 'ยังไม่มีอาจารย์ที่ปรึกษาในระบบ',
      why: 'นักศึกษาจะไม่เห็นอาจารย์ที่ปรึกษาของสายตัวเองเลย',
      goto: 'advisors',
      count: advisors.length === 0 && students.length ? 1 : 0,
      rows: [],
    },
    {
      unit: 'สาย',
      key: 'sai_empty',
      tone: TONE.setup,
      title: 'สายรหัสที่ไม่มีใครอยู่',
      why: 'ไม่เสียหาย แต่ถ้าไม่ได้ตั้งใจ แปลว่ามีสายที่สร้างไว้เกิน',
      goto: 'sais',
      count: saiEmpty.length,
      rows: saiEmpty.map((s) => ({ name: `สาย ${s.code}`, detail: `บ้าน ${houseOf(s.code) ?? '—'}`, hint: '' })),
    },
  ].filter((g) => g.count > 0);

  return {
    groups,
    // The badge number. ⛔ ONLY the `act` groups — a badge that counts the 152
    // people who can fix themselves is a badge that reads 150-something for
    // weeks and teaches the one person who looks at it to stop looking.
    actionable: groups.filter((g) => g.tone === TONE.act)
      .reduce((n, g) => n + g.count, 0),
  };
}
