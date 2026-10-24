// ============================================================
// model.js — turn rotation_board() (0250) into what the page draws. Pure: no
// DOM, no network — tested in model.test.js.
//
// ⛔ ELIGIBILITY IS THE SERVER'S. `student.can_swap` comes from
// rotation_pair_allowed() (the one home of the criteria); this file never
// re-derives "same gender" or a GPA band. If it did, the page and the database
// would disagree the day the GPA rule is switched on (mistakes.md class 6).
// ============================================================

/** Thai for every `reason` the RPCs return. Unknown → a generic line. */
export const REASON_TH = {
  closed: 'ตอนนี้ยังไม่เปิดให้แลก หรือปิดรับแล้ว',
  not_eligible: 'แลกกับคนนี้ไม่ได้ตามเกณฑ์',
  duplicate: 'คุณส่งคำขอนี้ไปแล้ว',
  same_group: 'นี่คือกลุ่มของคุณอยู่แล้ว',
  no_such_group: 'ไม่พบกลุ่มนี้',
  no_such_student: 'ไม่พบนักศึกษาคนนี้',
  no_such_request: 'ไม่พบคำขอนี้แล้ว',
  nobody_eligible: 'กลุ่มนี้ไม่มีใครที่แลกกับคุณได้ตามเกณฑ์',
  too_many: 'คุณมีคำขอที่รอตอบมากเกินไป ยกเลิกบางคำขอก่อน',
  taken: 'มีคนตอบรับคำขอนี้ไปก่อนแล้ว',
  not_pending: 'คำขอนี้ปิดไปแล้ว',
  not_yours: 'คำขอนี้ไม่ได้ส่งถึงคุณ',
  own_request: 'นี่เป็นคำขอของคุณเอง',
  stale: 'มีคนย้ายกลุ่มไปก่อนแล้ว คำขอนี้จึงใช้ไม่ได้',
  too_long: 'ยาวเกินไป (ไม่เกิน 200 ตัวอักษร)',
  staying: 'คนนี้เลือกอยู่กลุ่มเดิม ไม่รับคำขอแลกแล้ว',
  you_staying: 'คุณเลือก "อยู่กลุ่มนี้" ไว้ ปิดตัวเลือกนั้นก่อนถึงจะแลกได้',
};

export function reasonText(reason) {
  return REASON_TH[reason] || 'ทำรายการไม่สำเร็จ ลองใหม่อีกครั้ง';
}

export function fullName(s) {
  return s ? `${s.first_name} ${s.last_name}` : '';
}

/** "ชื่อ นามสกุล (ชื่อเล่น)" — the nickname comes from public.people (0251). */
export function displayName(s) {
  if (!s) return '';
  return s.nickname ? `${fullName(s)} (${s.nickname})` : fullName(s);
}

/** Does a search box query match this person (name, nickname, รหัส)? */
export function matchesQuery(s, q) {
  const t = String(q || '').trim().toLowerCase();
  if (!t) return true;
  return fullName(s).toLowerCase().includes(t)
    || String(s.nickname || '').toLowerCase().includes(t)
    || String(s.student_id || '').includes(t);
}

export function genderTh(g) {
  return g === 'M' ? 'ชาย' : g === 'F' ? 'หญิง' : '';
}

/**
 * @param {object} board  the rotation_board() payload with state 'ok'
 */
export function buildModel(board) {
  const me = board.me || null;
  const students = board.students || [];
  const byId = new Map(students.map((s) => [s.id, s]));
  const groups = board.round?.groups || [];
  const pending = (board.requests || []).filter((q) => q.status === 'pending');

  const groupList = groups.map((g) => {
    const members = students.filter((s) => s.current_group === g);
    return {
      group: g,
      members,
      male: members.filter((s) => s.gender === 'M').length,
      female: members.filter((s) => s.gender === 'F').length,
      eligible: members.filter((s) => s.can_swap).length,
      isMine: !!me && me.current_group === g,
    };
  });

  // Asks that I could answer: named to me, or a broadcast to my group from
  // someone the server says I may swap with. None while I chose to stay (0252):
  // named ones were closed by the server; a broadcast I could not accept anyway.
  const incoming = !me || me.staying ? [] : pending.filter((q) => q.requester_id !== me.id && (
    q.target_id === me.id
    || (q.target_id === null && q.to_group === me.current_group && byId.get(q.requester_id)?.can_swap)
  ));
  const outgoing = !me ? [] : pending.filter((q) => q.requester_id === me.id);

  /** My pending ask TO this person (direct), and theirs to me. */
  const askedByMe = new Map();
  const askedMe = new Map();
  if (me) {
    for (const q of pending) {
      if (q.requester_id === me.id && q.target_id) askedByMe.set(q.target_id, q);
      if (q.target_id === me.id) askedMe.set(q.requester_id, q);
    }
  }
  /** My pending broadcast per group. */
  const myBroadcast = new Map(outgoing.filter((q) => !q.target_id).map((q) => [q.to_group, q]));

  /** Everyone's open asks, per person — so a row can say "ขอแลกกับ … อยู่". */
  const openAsksBy = new Map();
  for (const q of pending) {
    if (!openAsksBy.has(q.requester_id)) openAsksBy.set(q.requester_id, []);
    openAsksBy.get(q.requester_id).push(q);
  }

  return { me, students, byId, groups, groupList, incoming, outgoing, askedByMe, askedMe, myBroadcast, openAsksBy };
}

/**
 * The public feed: open + accepted asks, and admin moves, newest first.
 * Each item: { at, kind: 'ask'|'swap'|'admin'|'mine-closed', ... }.
 */
export function buildFeed(board) {
  const items = [];
  const meId = board.me?.id;
  for (const q of board.requests || []) {
    if (q.status === 'pending') items.push({ at: q.created_at, kind: 'ask', q });
    else if (q.status === 'accepted') items.push({ at: q.resolved_at || q.created_at, kind: 'swap', q });
    else if (meId && (q.requester_id === meId || q.target_id === meId)) {
      items.push({ at: q.resolved_at || q.created_at, kind: 'mine-closed', q });
    }
  }
  for (const m of board.moves || []) {
    if (m.kind === 'admin') items.push({ at: m.at, kind: 'admin', m });
  }
  return items.sort((a, b) => String(b.at).localeCompare(String(a.at)));
}

/** "เมื่อสักครู่" / "5 นาทีที่แล้ว" / "3 ชม.ที่แล้ว" / a date. */
export function agoTh(iso, now = Date.now()) {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return 'เมื่อสักครู่';
  if (s < 3600) return `${Math.floor(s / 60)} นาทีที่แล้ว`;
  if (s < 86400) return `${Math.floor(s / 3600)} ชม.ที่แล้ว`;
  const d = new Date(t);
  return `${d.getDate()}/${d.getMonth() + 1} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** The swap criteria in words, per rotation_rounds.gpa_rule (0250/0253). The
 *  RULE lives in rotation_pair_allowed(); this is only how the page says it. */
export const GPA_BANDS_TH = '2.55–2.99 / 3.00–3.49 / 3.50–4.00';
export function criteriaTh(rule) {
  if (rule === 'band_or_close') return `เพศเดียวกัน และ GPA ช่วงเดียวกัน (${GPA_BANDS_TH}) หรือห่างกันไม่เกิน 0.20`;
  if (rule === 'same_band') return `เพศเดียวกัน และ GPA ช่วงเดียวกัน (${GPA_BANDS_TH})`;
  return 'เพศเดียวกัน';
}
/** Does this rule need both people's GPA? */
export const ruleNeedsGpa = (rule) => rule === 'band_or_close' || rule === 'same_band';

/** Parse a GPA typed by a person: "3.5", "3,50", " 3.25 " → number; else null.
 *  Returns { value, error }. Empty → { value: null } (clears it). */
export function parseGpa(raw) {
  const s = String(raw ?? '').trim().replace(',', '.');
  if (s === '') return { value: null, error: null };
  if (!/^\d(\.\d{1,2})?$/.test(s)) return { value: null, error: 'พิมพ์ GPA เป็นตัวเลข เช่น 3.25' };
  const v = Number(s);
  if (v < 0 || v > 4) return { value: null, error: 'GPA ต้องอยู่ระหว่าง 0.00 ถึง 4.00' };
  return { value: v, error: null };
}

/** Every completed swap as a PAIR, newest first: A went aFrom → aTo, B the
 *  other way. Read from accepted requests, which every viewer can see. */
export function swapPairs(board) {
  return (board?.requests || [])
    .filter((q) => q.status === 'accepted' && q.accepted_by)
    .map((q) => ({
      id: q.id, at: q.resolved_at || q.created_at,
      aId: q.requester_id, aFrom: q.from_group, aTo: q.to_group,
      bId: q.accepted_by, bFrom: q.to_group, bTo: q.from_group,
    }))
    .sort((x, y) => String(y.at).localeCompare(String(x.at)));
}

/** student id → their MOST RECENT move: { from, to, at, kind, partnerId }. */
export function lastMoves(board) {
  const reqs = new Map((board?.requests || []).map((q) => [q.id, q]));
  const out = new Map();
  for (const m of board?.moves || []) {
    const prev = out.get(m.student_id);
    if (prev && String(prev.at) >= String(m.at)) continue;
    const q = m.request_id ? reqs.get(m.request_id) : null;
    const partnerId = q ? (q.requester_id === m.student_id ? q.accepted_by : q.requester_id) : null;
    out.set(m.student_id, { from: m.from_group, to: m.to_group, at: m.at, kind: m.kind, partnerId });
  }
  return out;
}

/** A move this recent is drawn as "just moved". */
export const RECENT_MS = 24 * 3600 * 1000;
export function isRecent(iso, now = Date.now()) {
  const t = new Date(iso).getTime();
  return Number.isFinite(t) && now - t < RECENT_MS;
}

/** What changed between two reads of the board — what the page flashes and
 *  announces when a realtime ping (or the poll) brings a new board. */
export function diffBoards(prev, next) {
  const none = { moved: [], swaps: [], newIncoming: [] };
  if (prev?.state !== 'ok' || next?.state !== 'ok') return none;
  const before = new Map((prev.students || []).map((s) => [s.id, s.current_group]));
  const moved = (next.students || [])
    .filter((s) => before.has(s.id) && before.get(s.id) !== s.current_group)
    .map((s) => s.id);
  const seen = new Set((prev.requests || []).filter((q) => q.status === 'accepted').map((q) => q.id));
  const swaps = swapPairs(next).filter((p) => !seen.has(p.id));
  const inc0 = new Set(buildModel(prev).incoming.map((q) => q.id));
  const newIncoming = buildModel(next).incoming.filter((q) => !inc0.has(q.id));
  return { moved, swaps, newIncoming };
}
