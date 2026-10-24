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
// group"; 0252 rotation_set_staying and the `staying` checks). It is a PRACTICE COPY — nothing real is decided here; the one home
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
 */
export function createPractice({ groups, realMe = null, gender, group, perGroup = 8, clock = () => Date.now() }) {
  let tick = 0;
  const now = () => new Date(clock() + (tick++)).toISOString();   // strictly increasing
  let seq = 0;
  const newId = (p) => `${p}-${++seq}`;

  const meGender = gender || realMe?.gender || 'M';
  const meGroup = group && groups.includes(group) ? group : (realMe?.current_group && groups.includes(realMe.current_group) ? realMe.current_group : groups[0]);
  const me = {
    id: 'me', student_id: realMe?.student_id || 'ทดลอง-00', prefix: realMe?.prefix || '',
    first_name: realMe?.first_name || 'คุณ', last_name: realMe?.last_name || '(ทดลอง)',
    nickname: realMe?.nickname || null, contact: realMe?.contact || null,
    gender: meGender, original_group: meGroup, current_group: meGroup,
    gpa: realMe?.gpa ?? null, signed_in: true, staying: false,
  };

  const students = [me];
  let n = 0;
  const seen = { M: 0, F: 0 };   // per-gender counters: no two pretend people share a name
  for (const g of groups) {
    const count = g === meGroup ? perGroup - 1 : perGroup;   // you are the last seat of yours
    for (let i = 0; i < count; i++) {
      const isM = i % 2 === 0;
      n++;
      const k = n - 1;
      const j = seen[isM ? 'M' : 'F']++;
      students.push({
        id: `s${n}`, student_id: `ทดลอง-${String(n).padStart(2, '0')}`, prefix: isM ? 'นาย' : 'นางสาว',
        first_name: (isM ? M_FIRST : F_FIRST)[j % 24], last_name: LAST[(j * 5) % LAST.length],
        nickname: (isM ? M_NICK : F_NICK)[j % 24], contact: k % 3 === 0 ? null : `LINE: demo${String(n).padStart(2, '0')}`,
        gender: isM ? 'M' : 'F', original_group: g, current_group: g, gpa: null, signed_in: k % 4 !== 3,
        staying: i === 2,   // one person per group chose to stay, so the page shows what that looks like
      });
    }
  }

  const requests = [];
  const moves = [];
  const round = {
    id: PRACTICE_ROUND_ID, title: 'โหมดทดลอง', groups: [...groups], published: true, swaps_open: true,
    swaps_close_at: null, gpa_rule: 'off', swaps_live: true, max_pending: 15,
  };

  const byId = (id) => students.find((s) => s.id === id) || null;
  /** The practice copy of rotation_pair_allowed (gpa_rule is always 'off' here). */
  const pairAllowed = (a, b) => !!a && !!b && a.id !== b.id && a.current_group !== b.current_group && a.gender === b.gender;
  /** …and "may ASK them now": they have not chosen to stay (0252). */
  const askable = (a, b) => pairAllowed(a, b) && !b.staying;
  const pendingOf = (id) => requests.filter((q) => q.status === 'pending' && q.requester_id === id);

  function supersedeFor(ids) {
    let k = 0;
    for (const q of requests) {
      if (q.status === 'pending' && (ids.includes(q.requester_id) || ids.includes(q.target_id))) {
        q.status = 'superseded'; q.resolved_at = now(); k++;
      }
    }
    return k;
  }

  // ── the RPCs, as ANY actor (you, or a pretend classmate) ─────────────────
  function request(actorId, targetId, toGroup) {
    const a = byId(actorId);
    if (a.staying) return { ok: false, reason: 'you_staying' };
    let to = toGroup;
    if (targetId) {
      const t = byId(targetId);
      if (!t) return { ok: false, reason: 'no_such_student' };
      to = t.current_group;
      if (!pairAllowed(a, t)) return { ok: false, reason: 'not_eligible' };
      if (t.staying) return { ok: false, reason: 'staying' };
      if (requests.some((q) => q.status === 'pending' && q.requester_id === a.id && q.target_id === t.id)) return { ok: false, reason: 'duplicate' };
    } else {
      if (!to || !groups.includes(to)) return { ok: false, reason: 'no_such_group' };
      if (to === a.current_group) return { ok: false, reason: 'same_group' };
      if (!students.some((s) => s.current_group === to && askable(a, s))) return { ok: false, reason: 'nobody_eligible' };
      if (requests.some((q) => q.status === 'pending' && q.requester_id === a.id && !q.target_id && q.to_group === to)) return { ok: false, reason: 'duplicate' };
    }
    if (pendingOf(a.id).length >= round.max_pending) return { ok: false, reason: 'too_many' };
    const q = {
      id: newId('q'), requester_id: a.id, target_id: targetId || null, from_group: a.current_group, to_group: to,
      status: 'pending', accepted_by: null, created_at: now(), resolved_at: null,
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
    if (!pairAllowed(req, mine)) return { ok: false, reason: 'not_eligible' };
    req.current_group = q.to_group;
    mine.current_group = q.from_group;
    q.status = 'accepted'; q.accepted_by = mine.id; q.resolved_at = now();
    const at = q.resolved_at;
    moves.push({ student_id: req.id, from_group: q.from_group, to_group: q.to_group, request_id: q.id, kind: 'swap', at });
    moves.push({ student_id: mine.id, from_group: q.to_group, to_group: q.from_group, request_id: q.id, kind: 'swap', at });
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
    }
    return { ok: true, staying: !!on, declined, cancelled };
  }

  function board() {
    const pub = (s) => {
      const { gpa, ...rest } = s;   // nobody's GPA but your own (0251)
      return { ...rest, can_swap: s.id !== me.id && askable(me, s) };
    };
    return {
      state: 'ok', is_admin: false, practice: true,
      round: { ...round },
      me: { ...me, gpa_band: null },
      students: students.map(pub).sort((a, b) => a.current_group.localeCompare(b.current_group) || a.student_id.localeCompare(b.student_id)),
      requests: requests
        .filter((q) => q.status === 'pending' || q.status === 'accepted' || [q.requester_id, q.target_id, q.accepted_by].includes(me.id))
        .map((q) => ({ ...q }))
        .sort((a, b) => b.created_at.localeCompare(a.created_at)),
      moves: moves.map((m) => ({ ...m })).sort((a, b) => b.at.localeCompare(a.at)),
    };
  }

  /** Same contract as page.js's PostgREST rpc(): resolves to the RPC's JSON. */
  async function rpc(name, body = {}) {
    const out = (() => {
      switch (name) {
        case 'rotation_board': return board();
        case 'rotation_request': return request(me.id, body.p_target, body.p_to_group);
        case 'rotation_accept': return accept(me.id, body.p_request);
        case 'rotation_respond_no': return respondNo(me.id, body.p_request);
        case 'rotation_set_staying': return setStaying(me.id, body.p_staying);
        case 'rotation_set_gpa': me.gpa = body.p_gpa; return { ok: true, gpa: body.p_gpa };
        case 'rotation_set_contact': {
          const c = String(body.p_contact || '').replace(/\s+/g, ' ').trim() || null;
          if (c && c.length > 200) return { ok: false, reason: 'too_long' };
          me.contact = c; return { ok: true, contact: c };
        }
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
  };

  return {
    rpc,
    scene(name) { return SCENES[name] ? SCENES[name]() : { ok: false, text: 'ไม่รู้จักฉากนี้' }; },
    scenes: Object.keys(SCENES),
    // for tests
    _state: () => ({ me, students, requests, moves }),
    _as: { request, accept, respondNo, setStaying },
  };
}
