// ============================================================
// practice.js — โหมดทดลอง: the /rotation page running against a PRETEND
// cohort in the browser's memory, so anyone (the owner testing, a student
// learning) can be the person who RECEIVES offers — one, several at once, a
// whole-group broadcast, someone else taking it first — without a second
// account and without touching a real group. Owner, 2026-10-24: "how can i
// test to be the person who got an offer … i can't test it on my own".
//
// HOW: page.js sends every RPC through one function; in practice mode that
// function is `rpc()` below instead of PostgREST. The page code that draws,
// confirms and announces is the SAME code that runs for real, so what you
// see here is what a student sees.
//
// ⚠️ THIS FILE RE-STATES THE SERVER'S RULES (0250 rotation_request /
// rotation_accept / rotation_supersede_for, criterion "same gender, different
// group"; 0252 rotation_set_staying and the `staying` checks; 0255 wishes and
// the chain RPCs propose / respond / cancel). It is a PRACTICE COPY — nothing real is decided here; the one home
// of the rules stays rotation_pair_allowed() in Postgres. practice.test.js
// walks the same edge cases as tools/rotation0250-swaps.sql so the two do not
// silently drift (mistakes.md class 6). If you change a rule in SQL, change it
// here and in that test in the same commit.
//
// No real person is in here: the classmates are invented names. Your OWN row
// (name, nickname, contact, GPA) is copied in when you are on the roster.
// ============================================================

const M_FIRST = ['ภูมิ', 'ธนกร', 'กิตติ', 'ณัฐวุฒิ', 'พีรพล', 'ชยพล', 'วรเมธ', 'ศุภกร', 'อนุชา', 'ธีรภัทร', 'ภาคิน', 'ปกรณ์',
  'กฤษดา', 'นนท์', 'ปิยะ', 'วิชัย', 'อดิศร', 'ตะวัน', 'เมธา', 'สรวิศ', 'คณิน', 'ภัทร', 'ชาคร', 'ธาวิน'];
const F_FIRST = ['ณิชา', 'พิมพ์ชนก', 'กัญญาณัฐ', 'ธัญชนก', 'ศิริน', 'อรปรียา', 'เบญญา', 'ชนิดา', 'วริศรา', 'ณัฐธิดา', 'ปภาวี', 'มินตรา',
  'ลลิตา', 'สุธิดา', 'อัญชลี', 'กานต์', 'พลอย', 'รินรดา', 'ศศิ', 'ญาดา', 'ปาริชาติ', 'ธารา', 'นภัส', 'แพรวา'];
const LAST = ['ใจดี', 'รักเรียน', 'มีสุข', 'แสงทอง', 'ศรีสุข', 'บุญมา', 'ทองดี', 'สายใจ', 'พูลผล', 'มั่นคง', 'วงศ์ดี', 'สุขใจ'];
const M_NICK = ['บอม', 'เอก', 'ต้น', 'ปอนด์', 'เจ', 'ภู', 'กาย', 'บีม', 'ไผ่', 'โอ๊ต', 'เก่ง', 'นิว', 'ฟ้า', 'ตูน', 'ปั้น', 'แม็ก', 'กอล์ฟ', 'อาร์ม', 'บาส', 'เปา', 'ซัน', 'ไอซ์', 'ท็อป', 'เต้'];
const F_NICK = ['มิว', 'แพร', 'ใบเตย', 'ฝน', 'น้ำ', 'ปราง', 'เฟิร์น', 'ขิม', 'จูน', 'มายด์', 'ออม', 'พิม', 'ข้าว', 'แป้ง', 'ฟ้าใส', 'นุ่น', 'ปุยฝ้าย', 'เอม', 'ใบบัว', 'มะปราง', 'ผึ้ง', 'ครีม', 'กิ๊ฟ', 'ต้นข้าว'];

export const PRACTICE_ROUND_ID = 'practice';

/**
 * @param {object} o
 * @param {string[]} o.groups      e.g. ['A','B','C','D','E','F']
 * @param {object|null} o.realMe   the board's `me`, when the viewer is on the roster
 * @param {'M'|'F'} [o.gender]     play as (defaults to realMe's)
 * @param {string} [o.group]       start in (defaults to realMe's)
 * @param {number} [o.perGroup]    pretend classmates per group (default 8: 4 M + 4 F)
 * @param {() => number} [o.clock] ms clock (tests pass a fake one)
 * @param {boolean} [o.anonymize]  force 100% pretend persona for recordings/screenshots
 * @param {string} [o.gpaRule]     gpa rule to simulate (default 'band_or_close')
 */
export function createPractice({ groups, realMe = null, gender, group, perGroup = 8, clock = () => Date.now(), anonymize = false, gpaRule = 'band_or_close' }) {
  let tick = 0;
  const now = () => new Date(clock() + (tick++)).toISOString();   // strictly increasing
  let seq = 0;
  const newId = (p) => `${p}-${++seq}`;

  const meGender = gender || (!anonymize && realMe?.gender) || 'M';
  const meGroup = group && groups.includes(group) ? group : (!anonymize && realMe?.current_group && groups.includes(realMe.current_group) ? realMe.current_group : groups[0]);
  const me = {
    id: 'me',
    student_id: anonymize ? '663040999-9' : (realMe?.student_id || 'ทดลอง-00'),
    prefix: anonymize ? (meGender === 'M' ? 'นาย' : 'นางสาว') : (realMe?.prefix || ''),
    first_name: anonymize ? 'สมมติ' : (realMe?.first_name || 'คุณ'),
    last_name: anonymize ? 'รักเรียน' : (realMe?.last_name || '(ทดลอง)'),
    nickname: anonymize ? 'เดโม' : (realMe?.nickname || null),
    contact: anonymize ? 'LINE: demo_me' : (realMe?.contact || null),
    gender: meGender, original_group: meGroup, current_group: meGroup,
    gpa: anonymize ? 3.45 : (realMe?.gpa ?? 3.45),
    gpa_edit_count: 0,
    signed_in: true, staying: false, wishes: [],
  };

  const students = [me];
  let n = 0;
  const seen = { M: 0, F: 0 };   // per-gender counters: no two pretend people share a name
  for (const g of groups) {
    const gIdx = groups.indexOf(g);
    const count = g === meGroup ? perGroup - 1 : perGroup;   // you are the last seat of yours
    for (let i = 0; i < count; i++) {
      const isM = i % 2 === 0;
      n++;
      const k = n - 1;
      const j = seen[isM ? 'M' : 'F']++;
      const genderSeat = Math.floor(i / 2);
      let gpa = 3.40;
      if (genderSeat === 0) gpa = 3.40;
      else if (genderSeat === 1) gpa = 3.35;
      else if (genderSeat === 2) gpa = 3.48;
      else if (genderSeat === 3) {
        if (gIdx === 1 || gIdx === 4) gpa = 3.70;
        else if (gIdx === 2) gpa = 2.70;
        else gpa = null;
      }

      students.push({
        id: `s${n}`, student_id: `ทดลอง-${String(n).padStart(2, '0')}`, prefix: isM ? 'นาย' : 'นางสาว',
        first_name: (isM ? M_FIRST : F_FIRST)[j % 24], last_name: LAST[(j * 5) % LAST.length],
        nickname: (isM ? M_NICK : F_NICK)[j % 24], contact: k % 3 === 0 ? null : `LINE: demo${String(n).padStart(2, '0')}`,
        gender: isM ? 'M' : 'F', original_group: g, current_group: g, gpa, signed_in: k % 4 !== 3,
        staying: i === 2,   // one person per group chose to stay, so the page shows what that looks like
        // a wish or two, so the route finder has something to find
        wishes: [groups[(groups.indexOf(g) + 1 + (k % (groups.length - 1))) % groups.length]],
      });
    }
  }

  const requests = [];
  const moves = [];
  const chains = [];
  const round = {
    id: PRACTICE_ROUND_ID, title: 'โหมดทดลอง', groups: [...groups], published: true, swaps_open: true,
    swaps_close_at: null, gpa_rule: gpaRule, swaps_live: true, max_pending: 15,
  };

  const byId = (id) => students.find((s) => s.id === id) || null;

  function gpaBand(g) {
    if (g === null || g === undefined) return null;
    const num = Number(g);
    if (isNaN(num)) return null;
    if (num >= 3.50) return '3.50-4.00';
    if (num >= 3.00) return '3.00-3.49';
    if (num >= 2.55) return '2.55-2.99';
    return null;
  }

  const pairAllowed = (a, b) => {
    if (!a || !b || a.id === b.id || a.current_group === b.current_group || a.gender !== b.gender) return false;
    if (round.gpa_rule === 'off') return true;
    if (round.gpa_rule === 'same_band') {
      const ba = gpaBand(a.gpa);
      const bb = gpaBand(b.gpa);
      return ba !== null && ba === bb;
    }
    if (round.gpa_rule === 'band_or_close') {
      if (a.gpa === null || a.gpa === undefined || b.gpa === null || b.gpa === undefined) return false;
      const ba = gpaBand(a.gpa);
      const bb = gpaBand(b.gpa);
      return (ba !== null && ba === bb) || Math.abs(Number(a.gpa) - Number(b.gpa)) <= 0.20001;
    }
    return true;
  };

  const offCriteriaReason = (a, b) => {
    if (!a || !b || a.id === b.id || a.current_group === b.current_group || a.gender !== b.gender) return null;
    if (pairAllowed(a, b)) return null;
    if (a.gpa === null || a.gpa === undefined || b.gpa === null || b.gpa === undefined) return 'missing_gpa';
    if (Math.abs(Number(a.gpa) - Number(b.gpa)) <= 0.30001) return 'diff_02_03';
    return 'diff_over_03';
  };

  /** …and "may ASK them now": they have not chosen to stay (0252). */
  const askable = (a, b) => pairAllowed(a, b) && !b.staying;
  const pendingOf = (id) => requests.filter((q) => q.status === 'pending' && q.requester_id === id);

  function supersedeFor(ids) {
    // 0255: chains whose starter or named person moved fail; an "anyone" leg re-opens;
    // a wish that came true is spent.
    for (const c of chains) {
      if (c.status !== 'pending') continue;
      if (ids.includes(c.starter_id) || c.legs.some((l) => l.target_id && ids.includes(l.target_id))) {
        c.status = 'failed'; c.fail_reason = 'moved'; c.resolved_at = now();
      } else {
        for (const l of c.legs) if (!l.target_id && ids.includes(l.taker_id)) { l.taker_id = null; l.committed_at = null; }
      }
    }
    for (const id of ids) { const s = byId(id); if (s) s.wishes = (s.wishes || []).filter((g) => g !== s.current_group); }
    let k = 0;
    for (const q of requests) {
      if (q.status === 'pending' && (ids.includes(q.requester_id) || ids.includes(q.target_id))) {
        q.status = 'superseded'; q.resolved_at = now(); k++;
      }
    }
    return k;
  }

  // ── the RPCs, as ANY actor (you, or a pretend classmate) ─────────────────
  function request(actorId, targetId, toGroup, offCriteria = false) {
    const a = byId(actorId);
    if (a.staying) return { ok: false, reason: 'you_staying' };
    let to = toGroup;
    let reason = null;

    if (offCriteria) {
      if (!targetId) return { ok: false, reason: 'cannot_broadcast_off_criteria' };
      if (requests.some((q) => q.status === 'pending' && q.requester_id === a.id && q.off_criteria)) {
        return { ok: false, reason: 'too_many_off_criteria' };
      }
      const t = byId(targetId);
      if (!t) return { ok: false, reason: 'no_such_student' };
      to = t.current_group;
      if (t.staying) return { ok: false, reason: 'staying' };
      reason = offCriteriaReason(a, t);
      if (!reason) return { ok: false, reason: 'not_eligible' };
      if (requests.some((q) => q.status === 'pending' && q.requester_id === a.id && q.target_id === t.id)) {
        return { ok: false, reason: 'duplicate' };
      }
    } else {
      if (targetId) {
        const t = byId(targetId);
        if (!t) return { ok: false, reason: 'no_such_student' };
        to = t.current_group;
        if (t.staying) return { ok: false, reason: 'staying' };
        if (!pairAllowed(a, t)) return { ok: false, reason: 'not_eligible' };
        if (requests.some((q) => q.status === 'pending' && q.requester_id === a.id && q.target_id === t.id)) return { ok: false, reason: 'duplicate' };
      } else {
        if (!to || !groups.includes(to)) return { ok: false, reason: 'no_such_group' };
        if (to === a.current_group) return { ok: false, reason: 'same_group' };
        if (!students.some((s) => s.current_group === to && askable(a, s))) return { ok: false, reason: 'nobody_eligible' };
        if (requests.some((q) => q.status === 'pending' && q.requester_id === a.id && !q.target_id && q.to_group === to)) return { ok: false, reason: 'duplicate' };
      }
    }

    if (pendingOf(a.id).length >= round.max_pending) return { ok: false, reason: 'too_many' };
    const q = {
      id: newId('q'), requester_id: a.id, target_id: targetId || null, from_group: a.current_group, to_group: to,
      status: 'pending', accepted_by: null, created_at: now(), resolved_at: null,
      off_criteria: !!offCriteria, off_criteria_reason: reason,
    };
    requests.push(q);
    return { ok: true, id: q.id };
  }

  function accept(actorId, reqId) {
    const q = requests.find((x) => x.id === reqId);
    if (!q) return { ok: false, reason: 'no_such_request' };
    if (q.status === 'accepted') return { ok: false, reason: 'taken' };
    if (q.status !== 'pending') return { ok: false, reason: 'not_pending' };
    if (q.requester_id === actorId) return { ok: false, reason: 'own_request' };
    if (q.target_id && q.target_id !== actorId) return { ok: false, reason: 'not_yours' };
    const mine = byId(actorId);
    const req = byId(q.requester_id);
    if (mine.staying) return { ok: false, reason: 'you_staying' };
    if (req.staying) return { ok: false, reason: 'staying' };
    if (req.current_group !== q.from_group || mine.current_group !== q.to_group) {
      if (q.target_id || req.current_group !== q.from_group) { q.status = 'superseded'; q.resolved_at = now(); }
      return { ok: false, reason: 'stale' };
    }
    if (q.off_criteria) {
      const reason = offCriteriaReason(req, mine);
      if (!reason) return { ok: false, reason: 'not_eligible' };
    } else {
      if (!pairAllowed(req, mine)) return { ok: false, reason: 'not_eligible' };
    }
    req.current_group = q.to_group;
    mine.current_group = q.from_group;
    q.status = 'accepted'; q.accepted_by = mine.id; q.resolved_at = now();
    const at = q.resolved_at;
    const kind = q.off_criteria ? 'off_criteria' : 'swap';
    moves.push({ student_id: req.id, from_group: q.from_group, to_group: q.to_group, request_id: q.id, kind, off_criteria_reason: q.off_criteria_reason, at });
    moves.push({ student_id: mine.id, from_group: q.to_group, to_group: q.from_group, request_id: q.id, kind, off_criteria_reason: q.off_criteria_reason, at });
    const closed = supersedeFor([req.id, mine.id]);
    return { ok: true, requester_group: q.to_group, my_group: q.from_group, closed_other_requests: closed };
  }

  function respondNo(actorId, reqId) {
    const q = requests.find((x) => x.id === reqId);
    if (!q) return { ok: false, reason: 'no_such_request' };
    if (q.status !== 'pending') return { ok: false, reason: 'not_pending' };
    if (q.requester_id === actorId) q.status = 'cancelled';
    else if (q.target_id === actorId) q.status = 'declined';
    else return { ok: false, reason: 'not_yours' };
    q.resolved_at = now();
    return { ok: true };
  }

  function setStaying(actorId, on) {
    const a = byId(actorId);
    a.staying = !!on;
    let declined = 0; let cancelled = 0;
    if (on) {
      for (const q of requests) {
        if (q.status !== 'pending') continue;
        if (q.target_id === a.id) { q.status = 'declined'; q.resolved_at = now(); declined++; }
        else if (q.requester_id === a.id) { q.status = 'cancelled'; q.resolved_at = now(); cancelled++; }
      }
      // 0255's set_staying: my chains cancelled, chains naming me refused, my yeses withdrawn
      for (const c of chains) {
        if (c.status !== 'pending') continue;
        if (c.starter_id === a.id) { c.status = 'cancelled'; c.resolved_at = now(); continue; }
        if (c.legs.some((l) => l.target_id === a.id)) { c.status = 'failed'; c.fail_reason = 'declined'; c.resolved_at = now(); continue; }
        for (const l of c.legs) if (l.taker_id === a.id) { l.taker_id = null; l.committed_at = null; }
      }
    }
    return { ok: true, staying: !!on, declined, cancelled };
  }

  // ── แลกต่อเนื่อง (0255): the practice copy of the chain RPCs ────────────
  const live = (c) => c.status === 'pending' && c.expires_at > now();
  function chainPropose(actorId, via, to, viaTarget = null, toTarget = null) {
    const a = byId(actorId);
    if (a.staying) return { ok: false, reason: 'you_staying' };
    if (!via || !to || via === to || via === a.current_group || to === a.current_group
        || !groups.includes(via) || !groups.includes(to)) return { ok: false, reason: 'bad_group' };
    for (const [g, t] of [[via, viaTarget], [to, toTarget]]) {
      if (t) {
        const s = byId(t);
        if (!s || s.current_group !== g) return { ok: false, reason: 'stale' };
        if (s.staying) return { ok: false, reason: 'staying' };
        if (!pairAllowed(a, s)) return { ok: false, reason: 'not_eligible' };
      } else if (!students.some((s) => s.current_group === g && askable(a, s))) {
        return { ok: false, reason: 'nobody_eligible' };
      }
    }
    if (chains.filter((c) => c.starter_id === actorId && live(c)).length >= 3) return { ok: false, reason: 'too_many_chains' };
    if (chains.some((c) => c.starter_id === actorId && live(c) && c.via_group === via && c.to_group === to
        && (c.legs[0].target_id || null) === viaTarget && (c.legs[1].target_id || null) === toTarget)) {
      return { ok: false, reason: 'duplicate' };
    }
    const c = {
      id: newId('c'), starter_id: actorId, from_group: a.current_group, via_group: via, to_group: to,
      status: 'pending', fail_reason: null, created_at: now(), resolved_at: null,
      expires_at: new Date(clock() + 48 * 3600 * 1000).toISOString(),
      legs: [{ seq: 1, from_group: via, to_group: a.current_group, target_id: viaTarget, taker_id: null, committed_at: null },
             { seq: 2, from_group: to, to_group: via, target_id: toTarget, taker_id: null, committed_at: null }],
    };
    chains.push(c);
    return { ok: true, chain_id: c.id };
  }
  function chainRespond(actorId, chainId, yes) {
    const c = chains.find((x) => x.id === chainId);
    if (!c) return { ok: false, reason: 'no_such_request' };
    if (c.status !== 'pending') return { ok: false, reason: 'not_pending' };
    if (c.expires_at <= now()) { c.status = 'expired'; c.resolved_at = now(); return { ok: false, reason: 'expired' }; }
    if (actorId === c.starter_id) return { ok: false, reason: 'own_request' };
    const a = byId(actorId);
    if (!yes) {
      if (c.legs.some((l) => l.target_id === actorId)) { c.status = 'failed'; c.fail_reason = 'declined'; c.resolved_at = now(); }
      else if (c.legs.some((l) => l.taker_id === actorId)) c.legs.forEach((l) => { if (l.taker_id === actorId) { l.taker_id = null; l.committed_at = null; } });
      else return { ok: false, reason: 'not_yours' };
      return { ok: true };
    }
    if (a.staying) return { ok: false, reason: 'you_staying' };
    if (c.legs.some((l) => l.taker_id === actorId)) return { ok: false, reason: 'duplicate' };
    const l = c.legs.find((x) => x.from_group === a.current_group);
    if (!l) return { ok: false, reason: 'not_yours' };
    if (l.taker_id) return { ok: false, reason: 'taken' };
    if (l.target_id && l.target_id !== actorId) return { ok: false, reason: 'not_yours' };
    const st = byId(c.starter_id);
    if (st.staying) return { ok: false, reason: 'staying' };
    if (!pairAllowed(st, a)) return { ok: false, reason: 'not_eligible' };
    l.taker_id = actorId; l.committed_at = now();
    if (c.legs.some((x) => !x.taker_id)) return { ok: true, done: false };
    const t1 = byId(c.legs[0].taker_id); const t2 = byId(c.legs[1].taker_id);
    if (st.current_group !== c.from_group || t1.current_group !== c.via_group || t2.current_group !== c.to_group
        || st.staying || t1.staying || t2.staying || !pairAllowed(st, t1) || !pairAllowed(st, t2)) {
      c.status = 'failed'; c.fail_reason = 'changed'; c.resolved_at = now();
      return { ok: false, reason: 'chain_failed' };
    }
    const at = now();
    st.current_group = c.to_group; t1.current_group = c.from_group; t2.current_group = c.via_group;
    c.status = 'done'; c.resolved_at = at;
    moves.push({ student_id: st.id, from_group: c.from_group, to_group: c.to_group, request_id: null, chain_id: c.id, kind: 'chain', at });
    moves.push({ student_id: t1.id, from_group: c.via_group, to_group: c.from_group, request_id: null, chain_id: c.id, kind: 'chain', at });
    moves.push({ student_id: t2.id, from_group: c.to_group, to_group: c.via_group, request_id: null, chain_id: c.id, kind: 'chain', at });
    supersedeFor([st.id, t1.id, t2.id]);
    return { ok: true, done: true, my_group: l.to_group };
  }
  function chainCancel(actorId, chainId) {
    const c = chains.find((x) => x.id === chainId);
    if (!c) return { ok: false, reason: 'no_such_request' };
    if (c.starter_id !== actorId) return { ok: false, reason: 'not_yours' };
    if (c.status !== 'pending') return { ok: false, reason: 'not_pending' };
    c.status = 'cancelled'; c.resolved_at = now();
    return { ok: true };
  }
  function chainKick(actorId, chainId, seq) {
    const c = chains.find((x) => x.id === chainId);
    if (!c) return { ok: false, reason: 'no_such_request' };
    if (c.starter_id !== actorId) return { ok: false, reason: 'not_yours' };
    if (c.status !== 'pending') return { ok: false, reason: 'not_pending' };
    const leg = c.legs.find((l) => l.seq === seq);
    if (!leg) return { ok: false, reason: 'no_such_leg' };
    if (leg.target_id) return { ok: false, reason: 'not_open_leg' };
    if (!leg.taker_id) return { ok: false, reason: 'no_taker' };
    leg.taker_id = null;
    leg.committed_at = null;
    return { ok: true };
  }
  /** The board's `can_take`, as rotation_board() computes it. */
  const canTake = (c, l) => live(c) && !l.taker_id && me.current_group === l.from_group
    && (!l.target_id || l.target_id === me.id) && me.id !== c.starter_id && !me.staying
    && !c.legs.some((x) => x.taker_id === me.id) && pairAllowed(byId(c.starter_id), me);
  const involved = (c) => c.starter_id === me.id || c.legs.some((l) => l.taker_id === me.id || l.target_id === me.id);

  function board() {
    const pub = (s) => {
      const { gpa, ...rest } = s;   // nobody's GPA but your own (0251)
      const offReason = !s.staying && s.id !== me.id ? offCriteriaReason(me, s) : null;
      return {
        ...rest,
        can_swap: s.id !== me.id && askable(me, s),
        can_off_criteria_swap: s.id !== me.id && !s.staying && !!offReason,
        off_criteria_reason: offReason,
        has_gpa: s.gpa !== null && s.gpa !== undefined,
        wishes: s.staying ? [] : (s.wishes || []).filter((g) => g !== s.current_group),
      };
    };
    return {
      state: 'ok', is_admin: false, practice: true,
      round: { ...round },
      me: {
        ...me,
        gpa_band: gpaBand(me.gpa),
        gpa_edit_count: me.gpa_edit_count || 0,
        wishes: me.staying ? [] : me.wishes.filter((g) => g !== me.current_group),
      },
      students: students.map(pub).sort((a, b) => a.current_group.localeCompare(b.current_group) || a.student_id.localeCompare(b.student_id)),
      requests: requests
        .filter((q) => q.status === 'pending' || q.status === 'accepted' || [q.requester_id, q.target_id, q.accepted_by].includes(me.id))
        .map((q) => ({
          ...q,
          off_criteria: !!q.off_criteria,
          off_criteria_reason: q.off_criteria_reason || null,
        }))
        .sort((a, b) => b.created_at.localeCompare(a.created_at)),
      moves: moves.map((m) => ({
        chain_id: null,
        ...m,
        off_criteria_reason: m.off_criteria_reason || null,
      })).sort((a, b) => b.at.localeCompare(a.at)),
      chains: chains
        .filter((c) => (c.status === 'done' || live(c)) || involved(c))
        .map((c) => ({ ...c, status: c.status === 'pending' && !live(c) ? 'expired' : c.status,
                       fail_reason: involved(c) ? c.fail_reason : null,
                       legs: c.legs.map((l) => ({ ...l, can_take: canTake(c, l) })) }))
        .sort((a, b) => b.created_at.localeCompare(a.created_at)),
    };
  }

  /** Same contract as page.js's PostgREST rpc(): resolves to the RPC's JSON. */
  async function rpc(name, body = {}) {
    const out = (() => {
      switch (name) {
        case 'rotation_board': return board();
        case 'rotation_request': return request(me.id, body.p_target, body.p_to_group, body.p_off_criteria);
        case 'rotation_accept': return accept(me.id, body.p_request);
        case 'rotation_respond_no': return respondNo(me.id, body.p_request);
        case 'rotation_set_staying': return setStaying(me.id, body.p_staying);
        case 'rotation_set_gpa':
          me.gpa = body.p_gpa;
          me.gpa_edit_count = (me.gpa_edit_count || 0) + 1;
          return { ok: true, gpa: body.p_gpa };
        case 'rotation_set_contact': {
          const c = String(body.p_contact || '').replace(/\s+/g, ' ').trim() || null;
          if (c && c.length > 200) return { ok: false, reason: 'too_long' };
          me.contact = c; return { ok: true, contact: c };
        }
        case 'rotation_set_wishes': {
          const list = body.p_groups || [];
          if (list.length > 5 || new Set(list).size !== list.length
              || list.some((g) => !groups.includes(g) || g === me.current_group)) return { ok: false, reason: 'bad_group' };
          me.wishes = [...list]; return { ok: true, wishes: list };
        }
        case 'rotation_chain_propose': return chainPropose(me.id, body.p_via, body.p_to, body.p_via_target || null, body.p_to_target || null);
        case 'rotation_chain_respond': return chainRespond(me.id, body.p_chain, body.p_yes);
        case 'rotation_chain_cancel': return chainCancel(me.id, body.p_chain);
        case 'rotation_chain_kick': return chainKick(me.id, body.p_chain, body.p_seq);
        default: return { ok: false, reason: 'practice_only' };
      }
    })();
    return JSON.parse(JSON.stringify(out));
  }

  // ── the scenes: what a pretend classmate does when you press a button ────
  const myMates = () => students.filter((s) => s.id !== me.id && askable(s, me) && !s.staying);
  const askedMeAlready = (s) => requests.some((q) => q.status === 'pending' && q.requester_id === s.id && q.target_id === me.id);
  const pick = (list, k) => {
    // Spread across groups so "several offers" shows several destinations.
    const out = []; const seen = new Set();
    for (const s of list) { if (out.length >= k) break; if (!seen.has(s.current_group)) { out.push(s); seen.add(s.current_group); } }
    for (const s of list) { if (out.length >= k) break; if (!out.includes(s)) out.push(s); }
    return out;
  };

  const STAYING_TEXT = 'คุณเลือก "อยู่กลุ่มนี้" ไว้ — ไม่มีใครส่งคำขอถึงคุณได้ ปิดตัวเลือกนั้นในการ์ดของคุณก่อน';
  const SCENES = {
    /** One classmate asks you by name. */
    one_asks_me() {
      if (me.staying) return { ok: false, text: STAYING_TEXT };
      const s = pick(myMates().filter((x) => !askedMeAlready(x)), 1)[0];
      if (!s) return { ok: false, text: 'ไม่มีเพื่อนสมมติที่แลกกับคุณได้เหลือแล้ว ลองกด เริ่มใหม่' };
      request(s.id, me.id, null);
      return { ok: true, text: `${s.first_name} (${s.nickname}) กลุ่ม ${s.current_group} ส่งคำขอแลกถึงคุณ` };
    },
    /** An off-criteria classmate asks you. */
    one_asks_me_off_criteria() {
      if (me.staying) return { ok: false, text: STAYING_TEXT };
      const s = students.find((x) => x.id !== me.id && x.gender === me.gender && x.current_group !== me.current_group && !x.staying && offCriteriaReason(x, me) && !askedMeAlready(x));
      if (!s) return { ok: false, text: 'ไม่มีเพื่อนสมมติที่ส่งคำขอผิดเกณฑ์ถึงคุณได้เหลือแล้ว' };
      const reason = offCriteriaReason(s, me);
      request(s.id, me.id, null, true);
      let desc = 'ผิดเกณฑ์';
      if (reason === 'diff_02_03') desc = 'เกรดห่าง 0.2–0.3';
      else if (reason === 'missing_gpa') desc = 'เช็กเกรดนอกรอบ';
      else if (reason === 'diff_over_03') desc = 'เกรดห่าง >0.3';
      return { ok: true, text: `${s.first_name} (${s.nickname}) กลุ่ม ${s.current_group} ส่งคำขอแลก (${desc}) ถึงคุณ` };
    },
    /** Three classmates, three groups, all ask you at once. */
    many_ask_me() {
      if (me.staying) return { ok: false, text: STAYING_TEXT };
      const list = pick(myMates().filter((x) => !askedMeAlready(x)), 3);
      if (!list.length) return { ok: false, text: 'ไม่มีเพื่อนสมมติที่แลกกับคุณได้เหลือแล้ว ลองกด เริ่มใหม่' };
      for (const s of list) request(s.id, me.id, null);
      return { ok: true, text: `${list.length} คนส่งคำขอถึงคุณพร้อมกัน (กลุ่ม ${list.map((s) => s.current_group).join(', ')})` };
    },
    /** Someone asks "anyone in your group" — you and your groupmates of the same gender all see it. */
    broadcast_to_my_group() {
      if (me.staying) return { ok: false, text: STAYING_TEXT };
      const s = myMates().find((x) => !requests.some((q) => q.status === 'pending' && q.requester_id === x.id && !q.target_id && q.to_group === me.current_group));
      if (!s) return { ok: false, text: 'ไม่มีเพื่อนสมมติที่แลกกับคุณได้เหลือแล้ว ลองกด เริ่มใหม่' };
      request(s.id, null, me.current_group);
      return { ok: true, text: `${s.first_name} (${s.nickname}) กลุ่ม ${s.current_group} ขอแลกกับใครก็ได้ในกลุ่ม ${me.current_group}` };
    },
    /** A groupmate of yours accepts an open broadcast to your group before you do. */
    someone_beats_me() {
      const q = requests.find((x) => x.status === 'pending' && !x.target_id && x.to_group === me.current_group);
      if (!q) return { ok: false, text: 'ยังไม่มีคำขอถึงทั้งกลุ่มของคุณ — กด "มีคนขอแลกกับทั้งกลุ่มฉัน" ก่อน' };
      const req = byId(q.requester_id);
      const rival = students.find((s) => s.id !== me.id && s.current_group === me.current_group && askable(req, s));
      if (!rival) return { ok: false, text: 'ในกลุ่มคุณไม่มีใครตัดหน้าได้' };
      accept(rival.id, q.id);
      return { ok: true, text: `${rival.first_name} (${rival.nickname}) ในกลุ่มคุณตอบรับไปก่อน — คำขอนั้นจึงหายไปจากรายการของคุณ` };
    },
    /** The person you asked (or someone in the group you broadcast to) says yes. */
    they_accept_mine() {
      const q = requests.filter((x) => x.status === 'pending' && x.requester_id === me.id)
        .sort((a, b) => a.created_at.localeCompare(b.created_at))[0];
      if (!q) return { ok: false, text: 'คุณยังไม่มีคำขอที่รอตอบ — ไปที่ "หาคนแลก" แล้วกด ขอแลก กับใครสักคนก่อน' };
      const who = q.target_id ? byId(q.target_id)
        : students.find((s) => s.current_group === q.to_group && askable(me, s));
      if (!who) return { ok: false, text: 'ไม่มีใครตอบรับได้' };
      const r = accept(who.id, q.id);
      if (!r.ok) return { ok: false, text: 'ตอบรับไม่ได้: ' + r.reason };
      return { ok: true, text: `${who.first_name} (${who.nickname}) ตอบรับแล้ว — คุณย้ายไปกลุ่ม ${me.current_group}` };
    },
    /** A classmate starts a แลกต่อเนื่อง that needs someone from YOUR group. */
    chain_needs_me() {
      if (me.staying) return { ok: false, text: STAYING_TEXT };
      for (const st of students.filter((s) => s.id !== me.id && !s.staying && pairAllowed(s, me))) {
        const to = groups.find((g) => g !== st.current_group && g !== me.current_group
          && students.some((x) => x.id !== me.id && x.current_group === g && askable(st, x)));
        if (!to) continue;
        const r = chainPropose(st.id, me.current_group, to);
        if (!r.ok) continue;
        return { ok: true, text: `${st.first_name} (${st.nickname}) กลุ่ม ${st.current_group} อยากไปกลุ่ม ${to} ผ่านกลุ่มคุณ — ถ้าคุณตอบรับ คุณได้ไปกลุ่ม ${st.current_group}` };
      }
      return { ok: false, text: 'ไม่มีเพื่อนสมมติที่เริ่มแลกต่อเนื่องผ่านกลุ่มคุณได้ ลองกด เริ่มใหม่' };
    },
    /** Everyone else in your open chain(s) says yes — watch three people move at once. */
    chain_others_yes() {
      const open = chains.filter((c) => live(c) && involved(c));
      if (!open.length) return { ok: false, text: 'ยังไม่มีแลกต่อเนื่องที่เกี่ยวกับคุณ — ไปที่ "หาคนแลก" › อยากไปกลุ่มไหน แล้วเริ่มสักเส้นทาง หรือกด "มีคนเริ่มแลกต่อเนื่องผ่านกลุ่มฉัน"' };
      let moved = 0; let waiting = 0;
      for (const c of open) {
        const st = byId(c.starter_id);
        for (const l of c.legs.filter((x) => !x.taker_id)) {
          if (l.from_group === me.current_group && c.starter_id !== me.id) { waiting++; continue; }   // that leg is yours to answer
          const who = students.find((s) => s.id !== me.id && s.id !== c.starter_id && s.current_group === l.from_group
            && (!l.target_id || l.target_id === s.id) && !s.staying && pairAllowed(st, s) && !c.legs.some((x) => x.taker_id === s.id));
          if (who) { const r = chainRespond(who.id, c.id, true); if (r.done) moved++; }
        }
      }
      if (moved) return { ok: true, text: `ทุกคนตอบรับครบ — ย้ายพร้อมกันทั้ง 3 คนแล้ว${me.current_group ? ` · ตอนนี้คุณอยู่กลุ่ม ${me.current_group}` : ''}` };
      if (waiting) return { ok: true, text: 'เพื่อนอีกคนตอบรับแล้ว — เหลือคุณคนเดียว กดตอบรับที่ด้านบนสุดเพื่อให้ทั้ง 3 คนย้ายพร้อมกัน' };
      return { ok: false, text: 'ไม่มีใครตอบรับได้' };
    },
    /** Two other classmates swap — watch the lists change. */
    others_swap() {
      const others = students.filter((s) => s.id !== me.id);
      for (const a of others.filter((x) => !x.staying)) {
        const b = others.find((x) => askable(a, x));
        if (!b) continue;
        const r = request(a.id, b.id, null);
        if (!r.ok) continue;
        accept(b.id, r.id);
        return { ok: true, text: `${a.first_name} (${a.nickname}) กับ ${b.first_name} (${b.nickname}) แลกกันแล้ว: ${b.current_group} ⇄ ${a.current_group}` };
      }
      return { ok: false, text: 'ไม่มีคู่ให้แลก' };
    },
    /** Two classmates swap off-criteria. */
    others_swap_off_criteria() {
      const others = students.filter((s) => s.id !== me.id);
      for (const a of others.filter((x) => !x.staying)) {
        const b = others.find((x) => !x.staying && x.gender === a.gender && x.current_group !== a.current_group && offCriteriaReason(a, x) === 'diff_02_03');
        if (!b) continue;
        const r = request(a.id, b.id, null, true);
        if (!r.ok) continue;
        accept(b.id, r.id);
        return { ok: true, text: `${a.first_name} กับ ${b.first_name} แลกผิดเกณฑ์ (0.2–0.3) สำเร็จแล้ว: ${b.current_group} ⇄ ${a.current_group}` };
      }
      return { ok: false, text: 'ไม่มีคู่ให้แลกผิดเกณฑ์' };
    },
  };

  return {
    rpc,
    scene(name) { return SCENES[name] ? SCENES[name]() : { ok: false, text: 'ไม่รู้จักฉากนี้' }; },
    scenes: Object.keys(SCENES),
    // for tests
    _state: () => ({ me, students, requests, moves, chains }),
    _as: { request, accept, respondNo, setStaying, chainPropose, chainRespond, chainCancel },
  };
}
