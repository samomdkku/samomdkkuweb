// ============================================================
// page.js — /rotation "แลก Rotation". Loaded by DYNAMIC import the first time
// the tab opens (main.js), so the portal's entry bundle does not carry it.
//
// ONE READ: rotation_board() (0250/0251) returns the round, me, every student,
// the open asks and the history. Every write is an RPC that answers
// {ok, reason}; after any write — ours or anybody's — the board is read again.
// "Anybody's" arrives through Supabase Realtime on `rotation_events` (a
// content-free ping), with a 60 s re-read while the tab is visible as the
// fallback, because a realtime socket is the part of this page most likely to
// die quietly (backgrounded phone, stale JWT).
//
// WHAT CHANGED BETWEEN TWO READS is computed by model.js diffBoards(): the
// people who moved flash in the lists, a new swap pair is announced, and a new
// offer to you raises the banner at the top (owner, 2026-10-24: "make people
// easier to visualize who แลก with who, who just moved").
//
// PRACTICE MODE (practice.js): the same page, every RPC answered by a pretend
// cohort in memory — so the owner, or any student, can be the one who RECEIVES
// offers. `rpc()` below is the only switch; nothing else knows.
//
// แลกต่อเนื่อง (0255, docs/ROTATION-CHAINS.md): E → A → B as ONE act of three
// people. The route finder (หาคนแลก › อยากไปกลุ่มไหน) counts people from the
// server's `can_swap` — which IS the per-leg rule (each taker vs the starter) —
// and students' public wishes; whether *I* may fill a leg is the server's
// `can_take`. A yes is a commitment; the server moves all three on the last one.
//
// WHAT THE PAGE NEVER DOES: decide who may swap (`can_swap` is the server's,
// rotation_pair_allowed), or show anyone's GPA but your own — except to an
// account the server names `gpa_viewer` (0254: a hand-kept list, not admins,
// not master), which is the only board that carries `gpa` on students.
//
// LAYOUT, per device:
//   • phone: one column — offers banner, me, my asks, the guide, then views.
//     The PDF's 48-column grid is never drawn; the overview is a 6 × 6 grid.
//   • ≥ 992 px: banner across the top, then me + my asks + guide | views.
//     The left column scrolls WITH the page, never inside itself: an inner
//     scroll on iPad hid "คำขอของคุณ" below a fold nobody knew was there
//     (owner's screenshot, 2026-10-24). The admin panel sits LAST, folded.
//
// Listeners: ONE delegated click/submit/change/input handler on #rotRoot,
// bound once (mount guard). Re-renders replace innerHTML only.
// ============================================================

import { db, dbRest, currentAccessToken } from '../db.js';
import { authReady, onAuthChange, getUser } from '../auth.js';
import { escHtml, copyText } from '../utils.js';
import { ROTATION_2570 as ROUND } from '../../data/rotation-2570.js';
import { groupTimetable, weekOf, blockIndexOfWeek, thDate, thRange, weeksLabel } from './schedule.js';
import {
  buildModel, buildFeed, reasonText, fullName, displayName, matchesQuery, genderTh, agoTh, parseGpa,
  swapPairs, lastMoves, diffBoards, isRecent, criteriaTh, ruleNeedsGpa,
  chainPeople, chainOffers, myChains, chainYeses, routesTo, chainCycles,
  formatMissingGpaCopyText,
} from './model.js';
import { createPractice } from './practice.js';

const ROUND_ID = ROUND.roundId;
const POLL_MS = 60_000;
const FLASH_MS = 6000;
const GUIDE_KEY = 'rot-guide-hidden-v1';
const DISMISSED_KEY = `rot-dismissed-offers-${ROUND_ID}`;

const state = {
  mounted: false,
  board: null,
  model: null,
  moves: new Map(),       // student id → last move (model.js lastMoves)
  view: 'mine',
  feedFilter: 'all',
  onlyEligible: false,
  onlyMissingGpa: false,
  query: '',
  openGroups: new Set(),
  busy: false,
  loading: false,
  reloadAgain: false,
  quietNext: false,       // the next read announces nothing (a scene / our own write already did)
  lastLoadedAt: null,
  live: false,
  flash: new Set(),       // student ids that just moved
  flashPairs: new Set(),  // request ids of swaps that just happened
  practice: null,         // createPractice() instance while in โหมดทดลอง
  realMe: null,           // the last real `me`, copied into practice
  guideHidden: readGuideHidden(),
  adminOpen: false,
  routeTarget: null,      // หาคนแลก › "อยากไปกลุ่มไหน"
};

let channel = null;
let pollTimer = null;
let reauthTimer = null;
let debounceTimer = null;
let flashTimer = null;

const $ = (id) => document.getElementById(id);

function readGuideHidden() {
  try { return localStorage.getItem(GUIDE_KEY) === '1'; } catch (_) { return false; }
}
function writeGuideHidden(v) {
  try { if (v) localStorage.setItem(GUIDE_KEY, '1'); else localStorage.removeItem(GUIDE_KEY); } catch (_) {}
}

function readDismissedOffers() {
  try { return new Set(JSON.parse(localStorage.getItem(DISMISSED_KEY) || '[]')); } catch (_) { return new Set(); }
}
function addDismissedOffer(id) {
  try {
    const s = readDismissedOffers();
    s.add(id);
    localStorage.setItem(DISMISSED_KEY, JSON.stringify([...s]));
  } catch (_) {}
}
function clearDismissedOffers() {
  try { localStorage.removeItem(DISMISSED_KEY); } catch (_) {}
}

// ── entry ────────────────────────────────────────────────────────────────────

export async function enterRotation() {
  if (!state.mounted) {
    state.mounted = true;
    const root = $('rotRoot');
    root.addEventListener('click', onClick);
    root.addEventListener('submit', onSubmit);
    root.addEventListener('input', onInput);
    root.addEventListener('change', onChange);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && isOnPage()) load();
    });
    onAuthChange(() => { if (isOnPage()) load(); });
  }
  paintGate('loading');
  await authReady;
  await load();
  startLive();
  // A shareable test link: /rotation?practice
  try {
    if (!state.practice && new URLSearchParams(location.search).has('practice')) startPractice();
  } catch (_) {}
}

function isOnPage() {
  return !!$('pills-rotation')?.classList.contains('active');
}

// ── data ─────────────────────────────────────────────────────────────────────

async function rpc(name, body) {
  if (state.practice) return state.practice.rpc(name, body);
  const { data, error } = await dbRest(`/rpc/${name}`, { method: 'POST', body });
  if (error) {
    const msg = String(error.message || '');
    if (/ROTATION_NOT_IN_ROSTER/.test(msg)) return { ok: false, reason: 'not_in_roster_raise' };
    if (/ROTATION_ADMIN_ONLY/.test(msg)) return { ok: false, reason: 'admin_only' };
    return { ok: false, reason: 'network', detail: msg };
  }
  return data;
}

async function load() {
  // Coalesce: a ping during a read schedules exactly one more read.
  if (state.loading) { state.reloadAgain = true; return; }
  state.loading = true;
  try {
    if (!state.practice && !getUser()) { state.board = null; paintGate('signed_out'); return; }
    const prev = state.board;
    const board = await rpc('rotation_board', { p_round: ROUND_ID });
    if (!board || board.ok === false) {
      if (!prev) { paintGate('error', board?.detail); }
      else {
        // Keep existing board rendered if a background update blips; retry shortly.
        setTimeout(() => { if (isOnPage()) load(); }, 2000 + Math.floor(Math.random() * 2000));
      }
      return;
    }
    state.board = board;
    state.lastLoadedAt = new Date();
    if (board.state !== 'ok') { paintGate(board.state); return; }
    if (!state.practice) state.realMe = board.me || null;
    state.model = buildModel(board);
    state.moves = lastMoves(board);
    // A board from the OTHER mode is not "what changed".
    const sameMode = !!prev?.practice === !!board.practice;
    announce(sameMode ? diffBoards(prev, board) : null, prev);
    paintAll();
  } finally {
    state.loading = false;
    if (state.reloadAgain) { state.reloadAgain = false; load(); }
  }
}

/** Flash who moved, and say what happened — unless we just said it ourselves. */
function announce(d, prev) {
  const quiet = state.quietNext;
  state.quietNext = false;
  if (!d) return;
  if (d.moved.length || d.swaps.length) {
    d.moved.forEach((id) => state.flash.add(id));
    d.swaps.forEach((p) => state.flashPairs.add(p.id));
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => { state.flash.clear(); state.flashPairs.clear(); }, FLASH_MS);
  }
  if (quiet) return;
  const me = state.board.me;
  const prevGroup = prev?.me?.current_group;
  if (me && prevGroup && prevGroup !== me.current_group) {
    toast(`คุณย้ายไปกลุ่ม ${me.current_group} แล้ว — ตารางของคุณเปลี่ยนตามด้านล่าง`);
    return;
  }
  if (d.newChainOffers.length) {
    toast('มีคนชวนคุณแลกต่อเนื่อง — ดูด้านบนสุด');
    return;
  }
  const othersChains = d.chainsDone.filter((c) => !c.people.some((p) => p.id === me?.id));
  if (othersChains.length) toast(`มีแลกต่อเนื่องสำเร็จ ${othersChains.length} รายการ (3 คนย้ายพร้อมกัน) — ดูที่ ความเคลื่อนไหว`);
  if (d.newIncoming.length) {
    toast(d.newIncoming.length === 1 ? 'มีคำขอแลกใหม่ถึงคุณ — ดูด้านบนสุด' : `มีคำขอแลกใหม่ถึงคุณ ${d.newIncoming.length} รายการ — ดูด้านบนสุด`);
    return;
  }
  const others = d.swaps.filter((p) => p.aId !== me?.id && p.bId !== me?.id);
  if (others.length === 1) {
    const p = others[0];
    const by = state.model.byId;
    toast(`${shortName(by.get(p.aId))} ⇄ ${shortName(by.get(p.bId))} แลกกลุ่มกันแล้ว (${p.aFrom} ⇄ ${p.bFrom})`);
  } else if (others.length > 1) {
    toast(`มีการแลกกลุ่มใหม่ ${others.length} คู่ — ดูที่ ความเคลื่อนไหว`);
  }
}

function startLive() {
  if (!channel) {
    try { db.realtime.setAuth(currentAccessToken()); } catch (_) {}
    channel = db.channel(`rotation-${ROUND_ID}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'rotation_events', filter: `round_id=eq.${ROUND_ID}` },
        () => {
          if (state.practice) return;
          clearTimeout(debounceTimer);
          debounceTimer = setTimeout(() => { if (isOnPage()) load(); }, 150 + Math.floor(Math.random() * 250));
        })
      .subscribe((status) => {
        state.live = status === 'SUBSCRIBED';
        paintStatus();
      });
    // Our db client does not auto-refresh the socket's JWT (team/realtime.js
    // says why); re-push it so RLS-gated pings keep arriving after an hour.
    reauthTimer = setInterval(() => {
      try { db.realtime.setAuth(currentAccessToken()); } catch (_) {}
    }, 20 * 60 * 1000);
  }
  clearInterval(pollTimer);
  pollTimer = setInterval(() => {
    if (!state.practice && document.visibilityState === 'visible' && isOnPage()) load();
  }, POLL_MS);
}

// ── practice mode ────────────────────────────────────────────────────────────

function startPractice({ gender, group } = {}) {
  state.practice = createPractice({
    groups: Object.keys(ROUND.groups), realMe: state.realMe, gender, group,
  });
  state.board = null;
  state.view = 'mine';
  state.query = '';
  state.onlyEligible = false;
  state.openGroups.clear();
  state.flash.clear();
  state.flashPairs.clear();
  load();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function stopPractice() {
  state.practice = null;
  state.board = null;
  state.view = 'mine';
  paintGate('loading');
  load();
}

const SCENES = [
  ['one_asks_me', 'bi-person', 'มีคนขอแลกกับฉัน'],
  ['many_ask_me', 'bi-people', 'หลายคนขอแลกพร้อมกัน'],
  ['broadcast_to_my_group', 'bi-megaphone', 'มีคนขอแลกกับทั้งกลุ่มฉัน'],
  ['someone_beats_me', 'bi-lightning', 'เพื่อนในกลุ่มตอบรับตัดหน้าฉัน'],
  ['they_accept_mine', 'bi-check2-circle', 'มีคนตอบรับคำขอของฉัน'],
  ['others_swap', 'bi-arrow-left-right', 'เพื่อนคนอื่นแลกกัน'],
  ['chain_needs_me', 'bi-diagram-3', 'มีคนเริ่มแลกต่อเนื่องผ่านกลุ่มฉัน'],
  ['chain_others_yes', 'bi-check2-all', 'คนอื่นในแลกต่อเนื่องตอบรับครบ'],
];

function paintPractice() {
  const el = $('rotPractice');
  const btn = $('rotPracticeBtn');
  if (btn) btn.hidden = !!state.practice;
  if (!el) return;
  if (!state.practice || state.board?.state !== 'ok') { el.hidden = true; el.innerHTML = ''; return; }
  const me = state.board.me;
  el.hidden = false;
  el.innerHTML = `
    <div class="rot-practice-head">
      <div>
        <p class="rot-practice-title"><i class="bi bi-controller me-1" aria-hidden="true"></i>โหมดทดลอง</p>
        <p class="rot-practice-sub">รายชื่อเพื่อนและคำขอทั้งหมดเป็นข้อมูลสมมติ ไม่มีผลกับกลุ่มจริง ไม่มีใครเห็น</p>
      </div>
      <button type="button" class="btn btn-sm btn-light rot-practice-exit" data-rot-act="practice-stop">ออกจากโหมดทดลอง</button>
    </div>
    <p class="rot-practice-label">กดเพื่อจำลองว่าเกิดอะไรขึ้นเมื่อ…</p>
    <div class="rot-practice-scenes">
      ${SCENES.map(([k, icon, label]) => `<button type="button" class="rot-scene" data-rot-act="scene" data-scene="${k}">
        <i class="bi ${icon}" aria-hidden="true"></i><span>${label}</span></button>`).join('')}
    </div>
    <form class="rot-practice-as" data-rot-form="practice-as">
      <span>เล่นเป็น</span>
      <select name="gender" class="form-select form-select-sm" aria-label="เพศ">
        <option value="M" ${me.gender === 'M' ? 'selected' : ''}>ชาย</option>
        <option value="F" ${me.gender === 'F' ? 'selected' : ''}>หญิง</option>
      </select>
      <select name="group" class="form-select form-select-sm" aria-label="กลุ่มเริ่มต้น">
        ${Object.keys(ROUND.groups).map((g) => `<option value="${g}" ${g === me.original_group ? 'selected' : ''}>กลุ่ม ${g}</option>`).join('')}
      </select>
      <button type="submit" class="btn btn-sm btn-light">เริ่มใหม่</button>
    </form>`;
}

// ── gate ─────────────────────────────────────────────────────────────────────

const PRACTICE_CTA = `<button type="button" class="btn btn-outline-secondary btn-sm mt-1" data-rot-act="practice-start">
  <i class="bi bi-controller me-1" aria-hidden="true"></i>ลองใช้แบบจำลองก่อน</button>`;

function paintGate(kind, detail) {
  const gate = $('rotGate');
  const main = $('rotMain');
  const show = kind !== 'ok';
  main.hidden = show;
  gate.hidden = !show;
  paintStatus();
  paintPractice();
  if (!show) { gate.innerHTML = ''; return; }
  const user = getUser();
  const blocks = {
    loading: `<div class="rot-gate-card"><span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>กำลังโหลด…</div>`,
    signed_out: `<div class="rot-gate-card">
        <i class="bi bi-person-lock rot-gate-icon" aria-hidden="true"></i>
        <h2>เข้าสู่ระบบด้วย kkumail ของคุณ</h2>
        <p>หน้านี้แสดงกลุ่ม Rotation ของคุณ และให้แลกกลุ่มกับเพื่อนได้</p>
        <button type="button" class="btn btn-custom" data-bs-toggle="modal" data-bs-target="#signinModal">
          <i class="bi bi-box-arrow-in-right me-1" aria-hidden="true"></i>เข้าสู่ระบบ</button>
        <p class="rot-muted mt-3 mb-0">อยากดูก่อนว่าใช้ยังไง</p>${PRACTICE_CTA}
      </div>`,
    not_in_roster: `<div class="rot-gate-card">
        <i class="bi bi-person-x rot-gate-icon" aria-hidden="true"></i>
        <h2>ไม่พบชื่อคุณในตาราง Rotation ปี 6</h2>
        <p>หน้านี้สำหรับนักศึกษาแพทย์ชั้นปีที่ 6 ปีการศึกษา 2570 ที่อยู่ในตารางของคณะ</p>
        ${user?.email ? `<p class="rot-muted">ตอนนี้เข้าสู่ระบบด้วย <strong>${escHtml(user.email)}</strong> — ถ้าคุณอยู่ในตาราง ให้ออกจากระบบแล้วเข้าใหม่ด้วย kkumail ของคุณเอง</p>` : ''}
        <p class="rot-muted">ยังไม่เจอ แจ้งได้ที่ <a href="/vssound">VitalSound</a></p>
        ${PRACTICE_CTA}
      </div>`,
    not_published: `<div class="rot-gate-card">
        <i class="bi bi-hourglass-split rot-gate-icon" aria-hidden="true"></i>
        <h2>ยังไม่เปิดให้ใช้</h2>
        <p>สโมสรจะประกาศเมื่อเปิดให้ดูกลุ่มและแลก Rotation</p>
        <p class="rot-muted mb-0">ระหว่างนี้ลองดูได้ว่าใช้ยังไง</p>${PRACTICE_CTA}
      </div>`,
    no_round: `<div class="rot-gate-card"><h2>ยังไม่มีตาราง Rotation ในระบบ</h2></div>`,
    error: `<div class="rot-gate-card">
        <i class="bi bi-wifi-off rot-gate-icon" aria-hidden="true"></i>
        <h2>โหลดข้อมูลไม่สำเร็จ</h2>
        <p class="rot-muted">${escHtml(detail || 'ลองใหม่อีกครั้ง')}</p>
        <button type="button" class="btn btn-outline-secondary btn-sm" data-rot-act="reload">ลองใหม่</button>
      </div>`,
  };
  gate.innerHTML = blocks[kind] || blocks.error;
}

function paintStatus() {
  const el = $('rotStatus');
  if (!el) return;
  const r = state.board?.state === 'ok' ? state.board.round : null;
  if (!r) { el.innerHTML = ''; return; }
  if (state.practice) {
    el.innerHTML = `<span class="rot-pill is-practice"><i class="bi bi-controller" aria-hidden="true"></i>โหมดทดลอง — ข้อมูลสมมติ</span>`;
    return;
  }
  const open = r.swaps_live;
  const close = r.swaps_close_at ? new Date(r.swaps_close_at) : null;
  const closeTxt = close
    ? ` · ปิด ${close.getDate()}/${close.getMonth() + 1} ${String(close.getHours()).padStart(2, '0')}:${String(close.getMinutes()).padStart(2, '0')} น.`
    : '';
  el.innerHTML = `
    <span class="rot-pill ${open ? 'is-open' : 'is-closed'}">
      <i class="bi ${open ? 'bi-arrow-left-right' : 'bi-lock'}" aria-hidden="true"></i>
      ${open ? `เปิดให้แลกอยู่${escHtml(closeTxt)}` : 'ยังไม่เปิดให้แลก — ดูได้อย่างเดียว'}
    </span>
    <span class="rot-live-dot ${state.live ? 'is-live' : ''}">
      <span aria-hidden="true"></span>${state.live ? 'อัปเดตสด' : 'อัปเดตทุก 1 นาที'}
    </span>`;
}

// ── small pieces ─────────────────────────────────────────────────────────────

function shortName(s) {
  if (!s) return '(ไม่พบ)';
  return s.nickname ? `${s.first_name} (${s.nickname})` : s.first_name;
}

function groupChip(g, extra = '') {
  return `<span class="rot-group-chip ${extra}" data-g="${escHtml(g)}">${escHtml(g)}</span>`;
}

function unitChip(unitKey, { long = false } = {}) {
  const u = ROUND.units[unitKey];
  return `<span class="rot-unit" style="--unit:${u.tone}">${escHtml(long ? u.name : u.short)}</span>`;
}

/** A group's six units as chips — "what my year looks like in group X". */
function planChips(g) {
  return `<span class="rot-plan">${ROUND.groups[g].map(([u]) => unitChip(u)).join('')}</span>`;
}

function contactLine(s) {
  return s?.contact
    ? `<span class="rot-contact"><i class="bi bi-chat-dots" aria-hidden="true"></i>${escHtml(s.contact)}</span>`
    : '';
}

function moveArrow(from, to) {
  return `${groupChip(from, 'is-sm')}<i class="bi bi-arrow-right rot-arrow" aria-hidden="true"></i>${groupChip(to, 'is-sm')}`;
}

/** One completed swap, drawn as the two people crossing over. */
function pairCard(p, { compact = false } = {}) {
  const by = state.model.byId;
  const meId = state.board.me?.id;
  const side = (s, from, to) => `<div class="rot-pair-side ${s && s.id === meId ? 'is-me' : ''}">
      <span class="rot-pair-name">${escHtml(shortName(s))}${s && s.id === meId ? ' <span class="rot-tag">คุณ</span>' : ''}</span>
      <span class="rot-pair-move">${moveArrow(from, to)}</span>
    </div>`;
  return `<div class="rot-pair ${compact ? 'is-compact' : ''} ${state.flashPairs.has(p.id) ? 'is-flash' : ''}">
    ${side(by.get(p.aId), p.aFrom, p.aTo)}
    <i class="bi bi-arrow-left-right rot-pair-icon" aria-label="แลกกับ"></i>
    ${side(by.get(p.bId), p.bFrom, p.bTo)}
    <span class="rot-pair-time">${agoTh(p.at)}</span>
  </div>`;
}

/** One completed แลกต่อเนื่อง: three people, each into the seat of the next. */
function chainCard(cy, { compact = false } = {}) {
  const by = state.model.byId;
  const meId = state.board.me?.id;
  const flash = cy.people.some((p) => state.flash.has(p.id));
  return `<div class="rot-pair is-chain ${compact ? 'is-compact' : ''} ${flash ? 'is-flash' : ''}">
    <span class="rot-chain-label"><i class="bi bi-arrow-repeat" aria-hidden="true"></i> แลกต่อเนื่อง 3 คน</span>
    ${cy.people.map((p) => {
      const s = by.get(p.id);
      return `<div class="rot-pair-side ${p.id === meId ? 'is-me' : ''}">
        <span class="rot-pair-name">${escHtml(shortName(s))}${p.id === meId ? ' <span class="rot-tag">คุณ</span>' : ''}</span>
        <span class="rot-pair-move">${moveArrow(p.from, p.to)}</span>
      </div>`;
    }).join('')}
    <span class="rot-pair-time">${agoTh(cy.at)}</span>
  </div>`;
}

/** The three moves of a chain in one line: "ก E→B · ข A→E · (ใครก็ได้) B→A". */
function chainLine(c) {
  const by = state.model.byId;
  const meId = state.board.me?.id;
  return chainPeople(c).map((p) => {
    const who = p.id === meId ? 'คุณ'
      : p.leg?.can_take ? '<strong>คุณ</strong> (ถ้าตอบรับ)'
      : p.id ? escHtml(shortName(by.get(p.id))) : `ใครก็ได้ในกลุ่ม ${escHtml(p.from)}`;
    return `<span class="rot-chain-step">${who} ${moveArrow(p.from, p.to)}</span>`;
  }).join('<span class="rot-chain-sep" aria-hidden="true">·</span>');
}

// ── paint ────────────────────────────────────────────────────────────────────

function paintAll() {
  paintGate('ok');
  paintAdmin();
  paintAlert();
  paintMe();
  paintGuide();
  paintInbox();
  paintViews();
}

function paintMe() {
  const el = $('rotMe');
  const me = state.board.me;
  const r = state.board.round;
  if (!me) {
    el.innerHTML = `<p class="rot-muted mb-0">คุณเข้าในฐานะผู้ดูแล — ไม่ได้อยู่ในตารางนี้ · กด <strong>ลองใช้แบบจำลอง</strong> ด้านบนเพื่อดูหน้านี้แบบที่นักศึกษาเห็น</p>`;
    return;
  }
  const moved = me.original_group !== me.current_group;
  const now = weekOf(ROUND);
  const bi = blockIndexOfWeek(ROUND, now);
  const tt = groupTimetable(ROUND, me.current_group);
  let when;
  if (now === 0) when = `เริ่ม ${thDate(tt[0].start, { withYear: true })} · ${tt[0].block.label}: ${escHtml(tt[0].unit.name)}`;
  else if (bi >= 0) when = `ตอนนี้ ${tt[bi].block.label}: ${escHtml(tt[bi].unit.name)}`;
  else when = 'ครบทุก Block แล้ว';
  const gpaVal = me.gpa === null || me.gpa === undefined ? '' : Number(me.gpa).toFixed(2);
  el.innerHTML = `
    <div class="rot-me-top">
      <div class="rot-me-group ${state.flash.has(me.id) ? 'is-flash' : ''}" data-g="${escHtml(me.current_group)}" aria-label="กลุ่มของฉัน">
        <span class="rot-me-group-label">กลุ่ม</span>
        <span class="rot-me-group-letter">${escHtml(me.current_group)}</span>
      </div>
      <div class="rot-me-who">
        <p class="rot-me-name">${escHtml(me.prefix)}${escHtml(fullName(me))}${me.staying ? ' <span class="rot-tag is-stay"><i class="bi bi-pin-angle-fill" aria-hidden="true"></i> อยู่กลุ่มนี้</span>' : ''}</p>
        <p class="rot-me-nick">${me.nickname ? `ชื่อเล่น <strong>${escHtml(me.nickname)}</strong>` : 'ยังไม่มีชื่อเล่น'}${state.practice ? '' : ' · <a href="/me">แก้ที่ ข้อมูลของฉัน</a>'}</p>
        <p class="rot-me-meta">${escHtml(me.student_id)} · ${genderTh(me.gender)}${moved ? ` · <span class="rot-moved">ย้ายจากกลุ่ม ${escHtml(me.original_group)}</span>` : ''}</p>
        <p class="rot-me-when">${when}</p>
      </div>
    </div>
    <div class="rot-stay ${me.staying ? 'is-on' : ''}">
      <label class="rot-stay-label form-switch">
        <input class="form-check-input" type="checkbox" role="switch" data-rot-input="stay" ${me.staying ? 'checked' : ''}>
        <span>ฉันอยากอยู่กลุ่มนี้ ไม่รับคำขอแลก</span>
      </label>
      <p class="rot-field-help mb-0">${me.staying
        ? 'เปิดอยู่ — ไม่มีใครส่งคำขอถึงคุณได้ และเพื่อนเห็นว่าคุณอยู่กลุ่มนี้ · ปิดได้ทุกเมื่อ'
        : 'เปิดแล้วจะไม่มีใครส่งคำขอถึงคุณได้ คำขอที่ค้างอยู่จะปิด · ปิดได้ทุกเมื่อ'}</p>
    </div>
    ${me.staying ? '' : `<div class="rot-wishes">
      <span class="rot-field-label">อยากไปกลุ่ม</span>
      <div class="rot-chips" role="group" aria-label="กลุ่มที่อยากไป">
        ${r.groups.filter((g) => g !== me.current_group).map((g) => {
          const k = (me.wishes || []).indexOf(g);
          return `<button type="button" class="rot-chip rot-wish" data-g="${g}" data-rot-act="wish" data-group="${g}" aria-pressed="${k >= 0}">${k >= 0 ? `<span class="rot-wish-n">${k + 1}</span>` : ''}${g}</button>`;
        }).join('')}
      </div>
      <span class="rot-field-help"><i class="bi bi-people" aria-hidden="true"></i> เพื่อนเห็น · ช่วยให้คนที่อยากมากลุ่มคุณหาคุณเจอ และใช้หาเส้นทางแลกต่อเนื่อง · เลือกได้หลายกลุ่ม ตามลำดับที่กด</span>
    </div>`}
    <form class="rot-profile" data-rot-form="profile" novalidate>
      <label class="rot-field">
        <span class="rot-field-label">ช่องทางติดต่อ</span>
        <input name="contact" class="form-control form-control-sm" maxlength="200" autocomplete="off"
               placeholder="เช่น LINE: abc123 · IG: @abc · 08x-xxx-xxxx" value="${escHtml(me.contact || '')}">
        <span class="rot-field-help"><i class="bi bi-people" aria-hidden="true"></i> เพื่อนปี 6 ที่เปิดหน้านี้เห็น ใช้คุยกันก่อนแลก</span>
      </label>
      <label class="rot-field">
        <span class="rot-field-label">GPA</span>
        <input name="gpa" class="form-control form-control-sm rot-gpa-input" inputmode="decimal" autocomplete="off"
               placeholder="เช่น 3.25" value="${escHtml(gpaVal)}">
        <span class="rot-field-help"><i class="bi bi-lock" aria-hidden="true"></i> ไม่มีใครเห็นนอกจากคุณ ·
          ${ruleNeedsGpa(r.gpa_rule) ? `ใช้เทียบเกณฑ์: ${escHtml(criteriaTh(r.gpa_rule))}` : 'ยังไม่ใช้เป็นเกณฑ์ เก็บไว้เทียบภายหลัง'}</span>
        ${ruleNeedsGpa(r.gpa_rule) && (me.gpa === null || me.gpa === undefined)
          ? '<span class="rot-field-warn"><i class="bi bi-exclamation-circle" aria-hidden="true"></i> ยังไม่ได้กรอก — ต้องกรอก GPA ก่อน ถึงจะแลกกับใครได้</span>' : ''}
      </label>
      <p class="rot-field-error" data-rot-profile-error hidden></p>
      <button type="submit" class="btn btn-sm btn-outline-secondary rot-profile-save">บันทึก</button>
    </form>`;
}

/** "Where do I start?" — four steps, each ticked from the board itself. */
function paintGuide() {
  const el = $('rotGuide');
  const gb = $('rotGuideBtn');
  const me = state.board.me;
  if (!me) { el.hidden = true; el.innerHTML = ''; if (gb) gb.hidden = true; return; }
  if (gb) gb.hidden = !state.guideHidden;
  if (state.guideHidden) { el.hidden = true; el.innerHTML = ''; return; }
  const m = state.model;
  const live = state.board.round.swaps_live;
  const filled = me.gpa !== null && me.gpa !== undefined && !!me.contact;
  const asked = m.outgoing.length > 0 || myChains(state.board).started.length > 0;
  const swapped = swapPairs(state.board).some((p) => p.aId === me.id || p.bId === me.id)
    || chainCycles(state.board).some((c) => c.people.some((p) => p.id === me.id));
  const step = (done, n, title, body) => `<li class="rot-step ${done ? 'is-done' : ''}">
      <span class="rot-step-n" aria-hidden="true">${done ? '<i class="bi bi-check-lg"></i>' : n}</span>
      <div><p class="rot-step-title">${title}${done ? '<span class="visually-hidden"> (ทำแล้ว)</span>' : ''}</p><p class="rot-step-body">${body}</p></div>
    </li>`;
  el.hidden = false;
  el.innerHTML = `
    <div class="rot-guide-head">
      <h2 class="rot-section-title mb-0">แลกยังไง</h2>
      <button type="button" class="btn btn-link btn-sm rot-quiet p-0" data-rot-act="guide-hide">ซ่อน</button>
    </div>
    <ol class="rot-steps">
      ${step(true, 1, 'ดูว่าตัวเองอยู่กลุ่มไหน', 'ชื่อ เพศ กลุ่ม อยู่ด้านบน · ตารางทั้งปีอยู่ที่ <button type="button" class="btn btn-link p-0 align-baseline" data-rot-view="mine">ตารางของฉัน</button> · ข้อมูลผิด แจ้ง <a href="/vssound">VitalSound</a>')}
      ${step(filled, 2, 'กรอกช่องทางติดต่อ และ GPA', ruleNeedsGpa(state.board.round.gpa_rule)
        ? 'ต้องมี GPA ถึงจะแลกได้ (ใช้เทียบเกณฑ์) · ไม่มีใครเห็นตัวเลขของคุณ · ช่องทางติดต่อให้เพื่อนทักคุณได้'
        : 'ให้เพื่อนทักคุณได้ · GPA ไม่มีใครเห็น')}
      ${me.staying
        ? step(true, 3, 'คุณเลือกอยู่กลุ่มนี้', 'ไม่ต้องทำอะไรต่อ · เปลี่ยนใจเมื่อไหร่ ปิดสวิตช์ <strong>ฉันอยากอยู่กลุ่มนี้</strong> ในการ์ดของคุณ')
        : `${step(asked || swapped, 3, 'หาคนที่แลกกับคุณได้ แล้วกด ขอแลก', live
          ? `<button type="button" class="btn btn-sm btn-outline-success mt-1" data-rot-act="find-mates"><i class="bi bi-search me-1" aria-hidden="true"></i>หาคนที่แลกกับฉันได้</button><br>ไม่มีใครในกลุ่มที่อยากไปแลกตรงๆ? ใช้ <strong>อยากไปกลุ่มไหน</strong> ในแท็บ หาคนแลก — ระบบหา <strong>แลกต่อเนื่อง</strong> ผ่านอีกกลุ่มให้ · ไม่อยากแลก? เปิด <strong>ฉันอยากอยู่กลุ่มนี้</strong>`
          : 'รอสโมสรเปิดให้แลก ระหว่างนี้ดูรายชื่อได้ที่ <button type="button" class="btn btn-link p-0 align-baseline" data-rot-view="groups">หาคนแลก</button>')}
      ${step(swapped, 4, 'รออีกฝ่ายกดตอบรับ', 'พอเขาตอบรับ ระบบสลับกลุ่มให้ทันที ทุกคนเห็นพร้อมกัน · ถ้ามีคนขอแลกกับคุณ จะขึ้นที่ด้านบนสุด')}`}
    </ol>
    ${state.practice ? '' : `<p class="rot-muted mb-0">ไม่แน่ใจ? <button type="button" class="btn btn-link p-0 align-baseline" data-rot-act="practice-start">ลองใช้แบบจำลอง</button> — ลองรับคำขอจากเพื่อนสมมติได้ ไม่มีผลจริง</p>`}`;
}

/** Offers TO me — the one thing that needs an answer, so it sits above everything. */
function paintAlert() {
  const el = $('rotAlert');
  const m = state.model;
  const live = state.board.round.swaps_live;
  const dismissed = readDismissedOffers();
  const allChainOff = m.me ? chainOffers(state.board) : [];
  const chainOff = allChainOff.filter(({ chain: c }) => !dismissed.has(c.id));
  const allIncoming = m.incoming || [];
  const list = allIncoming.filter((q) => !dismissed.has(q.id)).sort((a, b) => (a.target_id ? 0 : 1) - (b.target_id ? 0 : 1)
    || String(b.created_at).localeCompare(String(a.created_at)));
  const n = list.length + chainOff.length;
  const hiddenCount = (allIncoming.length - list.length) + (allChainOff.length - chainOff.length);

  if (!m.me || (!n && !hiddenCount)) { el.hidden = true; el.innerHTML = ''; return; }
  el.hidden = false;

  if (n === 0 && hiddenCount > 0) {
    el.innerHTML = `
      <div class="rot-alert-head">
        <i class="bi bi-bell-slash rot-alert-icon" aria-hidden="true"></i>
        <div>
          <h2 class="rot-alert-title">ซ่อนคำขอแลกไว้ ${hiddenCount} รายการ</h2>
          <p class="rot-alert-sub mb-0"><button type="button" class="btn btn-link btn-sm p-0 align-baseline" data-rot-act="restore-dismissed">เลิกซ่อนคำขอทั้งหมด</button></p>
        </div>
      </div>`;
    return;
  }

  el.innerHTML = `
    <div class="rot-alert-head">
      <i class="bi bi-bell-fill rot-alert-icon" aria-hidden="true"></i>
      <div>
        <h2 class="rot-alert-title">${n === 1 ? 'มีคนขอแลกกับคุณ' : `มี ${n} คำขอแลกถึงคุณ`}</h2>
        <p class="rot-alert-sub">${n > 1 ? 'ย้ายได้ครั้งเดียว — พอแลกแล้ว คำขออื่นจะปิดเอง · ' : ''}เทียบตารางก่อนตอบรับได้</p>
      </div>
    </div>
    <ul class="rot-offers">${list.map((q) => {
      const who = m.byId.get(q.requester_id);
      const broadcast = !q.target_id;
      return `<li class="rot-offer">
        <div class="rot-offer-who">
          ${groupChip(q.from_group)}
          <div class="rot-offer-text">
            <span class="rot-offer-name">${escHtml(displayName(who))}</span>
            <span class="rot-muted">${broadcast ? `ขอแลกกับใครก็ได้ในกลุ่ม ${escHtml(q.to_group)}` : 'ขอแลกกับคุณ'} · ${agoTh(q.created_at)}</span>
            ${contactLine(who)}
          </div>
        </div>
        <div class="rot-offer-result">
          <span class="rot-offer-if">ถ้าตอบรับ คุณย้าย ${moveArrow(m.me.current_group, q.from_group)}</span>
          <span class="rot-offer-plan-label">ตารางทั้งปีของกลุ่ม ${escHtml(q.from_group)}</span>
          ${planChips(q.from_group)}
        </div>
        <div class="rot-offer-actions">
          ${live ? `<button type="button" class="btn btn-sm btn-custom" data-rot-act="accept" data-id="${q.id}">ดูและตอบรับ</button>` : '<span class="rot-muted">ยังไม่เปิดให้แลก</span>'}
          ${live && !broadcast ? `<button type="button" class="btn btn-sm btn-link rot-quiet" data-rot-act="decline" data-id="${q.id}">ไม่รับ</button>` : ''}
          ${broadcast ? `<button type="button" class="btn btn-sm btn-link rot-quiet" data-rot-act="dismiss-offer" data-id="${q.id}">ไม่สนใจ</button>` : ''}
        </div>
      </li>`;
    }).join('')}${chainOff.map(({ chain: c, leg }) => {
      const st = m.byId.get(c.starter_id);
      const k = chainYeses(c);
      return `<li class="rot-offer is-chain">
        <div class="rot-offer-who">
          <span class="rot-chain-badge" aria-hidden="true"><i class="bi bi-arrow-repeat"></i></span>
          <div class="rot-offer-text">
            <span class="rot-offer-name">แลกต่อเนื่อง 3 คน · เริ่มโดย ${escHtml(displayName(st))}</span>
            <span class="rot-muted">${leg.target_id ? 'ชวนคุณโดยตรง' : `ชวนใครก็ได้ในกลุ่ม ${escHtml(leg.from_group)}`} · ตอบรับแล้ว ${k}/2 · ${agoTh(c.created_at)}</span>
            ${contactLine(st)}
            <span class="rot-chain-line">${chainLine(c)}</span>
          </div>
        </div>
        <div class="rot-offer-result">
          <span class="rot-offer-if">ถ้าครบ คุณย้าย ${moveArrow(leg.from_group, leg.to_group)}</span>
          <span class="rot-offer-plan-label">ตารางทั้งปีของกลุ่ม ${escHtml(leg.to_group)}</span>
          ${planChips(leg.to_group)}
        </div>
        <div class="rot-offer-actions">
          ${live ? `<button type="button" class="btn btn-sm btn-custom" data-rot-act="chain-yes" data-id="${c.id}">ดูและตอบรับ</button>` : '<span class="rot-muted">ยังไม่เปิดให้แลก</span>'}
          ${live && leg.target_id ? `<button type="button" class="btn btn-sm btn-link rot-quiet" data-rot-act="chain-no" data-id="${c.id}">ไม่รับ</button>` : ''}
          ${!leg.target_id ? `<button type="button" class="btn btn-sm btn-link rot-quiet" data-rot-act="dismiss-chain" data-id="${c.id}">ไม่สนใจ</button>` : ''}
        </div>
      </li>`;
    }).join('')}</ul>
    ${hiddenCount > 0 ? `<div class="rot-alert-footer text-end mt-2"><button type="button" class="btn btn-link btn-sm rot-quiet p-0" data-rot-act="restore-dismissed"><i class="bi bi-eye me-1" aria-hidden="true"></i>เลิกซ่อนคำขอที่กดไม่สนใจ (${hiddenCount})</button></div>` : ''}`;
}

function personLine(s) {
  if (!s) return '<span class="rot-muted">(ไม่พบ)</span>';
  return `<strong>${escHtml(displayName(s))}</strong> ${groupChip(s.current_group, 'is-sm')}`;
}

/** My own open asks. */
function paintInbox() {
  const el = $('rotInbox');
  const m = state.model;
  const ch = myChains(state.board);
  const total = (m.outgoing?.length || 0) + ch.started.length + ch.committed.length;
  if (!m.me || !total) { el.innerHTML = ''; return; }
  const live = state.board?.round?.swaps_live;
  const legState = (c, l) => {
    if (!l.taker_id) {
      return l.target_id ? `รอ ${escHtml(shortName(m.byId.get(l.target_id)))}` : 'รอใครสักคน';
    }
    const taker = m.byId.get(l.taker_id);
    const kickBtn = (!l.target_id && c.starter_id === m.me?.id && live)
      ? ` <button type="button" class="btn btn-sm btn-link text-danger p-0 ms-1 align-baseline rot-quiet" data-rot-act="chain-kick" data-id="${c.id}" data-seq="${l.seq}" data-name="${escHtml(displayName(taker))}">ปฏิเสธคนนี้</button>`
      : '';
    return `${escHtml(shortName(taker))} ตอบรับแล้ว${kickBtn}`;
  };
  const chainsHtml = [
    ...ch.started.map((c) => `<li class="rot-ask is-chain">
      <div class="rot-ask-text">
        <span><i class="bi bi-arrow-repeat" aria-hidden="true"></i> แลกต่อเนื่อง: คุณ ${moveArrow(c.from_group, c.to_group)} ผ่านกลุ่ม ${groupChip(c.via_group, 'is-sm')}</span>
        <span class="rot-chain-legs">${c.legs.map((l) => `<span>${moveArrow(l.from_group, l.to_group)} ${legState(c, l)}</span>`).join('')}</span>
        <span class="rot-muted">ตอบรับแล้ว ${chainYeses(c)}/2 · ยังไม่มีใครย้ายจนกว่าจะครบ · ${agoTh(c.created_at)}</span>
      </div>
      <div class="rot-ask-actions"><button type="button" class="btn btn-sm btn-link rot-quiet" data-rot-act="chain-cancel" data-id="${c.id}">ยกเลิก</button></div>
    </li>`),
    ...ch.committed.map((c) => {
      const mine = c.legs.find((l) => l.taker_id === m.me.id);
      return `<li class="rot-ask is-chain">
      <div class="rot-ask-text">
        <span><i class="bi bi-arrow-repeat" aria-hidden="true"></i> คุณตอบรับแลกต่อเนื่องของ ${personLine(m.byId.get(c.starter_id))} แล้ว</span>
        <span class="rot-muted">ถ้าครบ คุณย้าย ${moveArrow(mine.from_group, mine.to_group)} · รออีก ${2 - chainYeses(c)} คน</span>
      </div>
      <div class="rot-ask-actions"><button type="button" class="btn btn-sm btn-link rot-quiet" data-rot-act="chain-no" data-id="${c.id}">ถอนตัว</button></div>
    </li>`;
    }),
  ].join('');
  el.innerHTML = `<h2 class="rot-section-title">คำขอของคุณที่รอตอบ <span class="rot-count is-quiet">${total}</span></h2>
    <p class="rot-muted mb-2">ถ้ามีคนตอบรับคำขอใดก่อน คุณจะย้ายทันที แล้วคำขอที่เหลือจะปิดเอง</p>
    <ul class="rot-list">${m.outgoing.map((q) => {
      const who = q.target_id ? m.byId.get(q.target_id) : null;
      return `<li class="rot-ask">
        <div class="rot-ask-text">
          <span>${who ? `ถึง ${personLine(who)}` : `ถึงทุกคนที่แลกได้ในกลุ่ม ${groupChip(q.to_group, 'is-sm')}`}</span>
          <span class="rot-muted">รอตอบ · ${agoTh(q.created_at)}</span>
        </div>
        <div class="rot-ask-actions">
          <button type="button" class="btn btn-sm btn-link rot-quiet" data-rot-act="cancel" data-id="${q.id}">ยกเลิก</button>
        </div>
      </li>`;
    }).join('')}${chainsHtml}</ul>`;
}

function paintViews() {
  document.querySelectorAll('#rotRoot .rot-seg-btn[data-rot-view]').forEach((b) => {
    b.setAttribute('aria-selected', String(b.dataset.rotView === state.view));
  });
  document.querySelectorAll('#rotRoot [data-rot-pane]').forEach((p) => { p.hidden = p.dataset.rotPane !== state.view; });
  if (state.view === 'mine') paintMine();
  if (state.view === 'groups') paintGroups();
  if (state.view === 'feed') paintFeed();
}

function timetableHtml(group) {
  const tt = groupTimetable(ROUND, group);
  const now = weekOf(ROUND);
  return '<ol class="rot-timeline">' + tt.map((b) => {
    const isNow = now >= b.block.startWeek && now < b.block.startWeek + b.block.weeks;
    const isPast = now >= b.block.startWeek + b.block.weeks;
    return `<li class="rot-block ${isNow ? 'is-now' : ''} ${isPast ? 'is-past' : ''}" style="--unit:${b.unit.tone}">
      <div class="rot-block-head">
        <span class="rot-block-label">${b.block.label}<span class="rot-block-term"> · ${b.block.term}</span></span>
        <span class="rot-block-dates">${thRange(b.start, b.end)}${isNow ? ' · <strong>ตอนนี้</strong>' : ''}</span>
      </div>
      <p class="rot-block-unit">${escHtml(b.unit.name)}</p>
      <ul class="rot-courses">
        ${b.courses.map((c) => `<li>
          <span class="rot-course-kind">${escHtml(c.kind)}</span>
          <span class="rot-course-code">${c.code ? escHtml(c.code) : ''}</span>
          <span class="rot-course-weeks">${weeksLabel(c.weeks)} สัปดาห์ · ${c.approx ? '≈ ' : ''}${thRange(c.start, c.end)}</span>
          ${c.section ? `<span class="rot-course-sec">Sec.0${c.section}</span>` : ''}
        </li>`).join('')}
      </ul>
    </li>`;
  }).join('') + '</ol>';
}

function paintMine() {
  const el = $('rotViewMine');
  const me = state.board.me;
  const group = me?.current_group || state.board.round.groups[0];
  el.innerHTML = `
    <div class="rot-view-head">
      <h2 class="rot-section-title">${me ? 'ตารางของฉัน' : 'ตาราง'} · กลุ่ม ${groupChip(group, 'is-sm')}</h2>
      <p class="rot-muted">${escHtml(ROUND.hospital)} · 48 สัปดาห์ จันทร์–ศุกร์</p>
    </div>
    ${timetableHtml(group)}
    <p class="rot-footnote">≈ = วันแบ่งครึ่งสัปดาห์ ตารางคณะระบุเป็นจำนวนสัปดาห์ ไม่ได้ระบุวัน · ที่มา: ${escHtml(ROUND.source)}</p>`;
}

/** The 6 × 6 overview: rows = groups, columns = blocks. Fits 360 px. */
function matrixHtml() {
  const me = state.board.me;
  const counts = new Map(state.model.groupList.map((g) => [g.group, g]));
  return `<div class="rot-matrix" role="table" aria-label="ภาพรวมทุกกลุ่ม">
    <div class="rot-matrix-row is-head" role="row">
      <span role="columnheader" class="rot-matrix-g"></span>
      ${ROUND.blocks.map((b, i) => `<span role="columnheader" class="rot-matrix-h">${b.label.replace('Block ', 'B')}<small>${thDate(groupTimetable(ROUND, 'A')[i].start)}</small></span>`).join('')}
    </div>
    ${Object.keys(ROUND.groups).map((g) => `
      <button type="button" class="rot-matrix-row ${me?.current_group === g ? 'is-mine' : ''}" role="row" data-rot-act="jump-group" data-group="${g}"
              aria-label="กลุ่ม ${g}${me?.current_group === g ? ' (กลุ่มของคุณ)' : ''} ${counts.get(g)?.members.length || 0} คน">
        <span role="rowheader" class="rot-matrix-g" data-g="${g}">${g}</span>
        ${ROUND.groups[g].map(([u]) => `<span role="cell" class="rot-matrix-c ${ROUND.units[u].short.length > 6 ? 'is-long' : ''}" style="--unit:${ROUND.units[u].tone}">${escHtml(ROUND.units[u].short)}</span>`).join('')}
      </button>`).join('')}
  </div>`;
}

function memberRow(s) {
  const m = state.model;
  const me = m.me;
  const live = state.board.round.swaps_live;
  const isMe = me && s.id === me.id;
  const mine = m.askedByMe.get(s.id);
  const theirs = m.askedMe.get(s.id);
  const asks = (m.openAsksBy.get(s.id) || []);
  let action = '';
  if (live && me && !me.staying && !isMe) {
    if (theirs) action = `<button type="button" class="btn btn-sm btn-custom" data-rot-act="accept" data-id="${theirs.id}">ตอบรับ</button>`;
    else if (mine) action = `<button type="button" class="btn btn-sm btn-outline-secondary" data-rot-act="cancel" data-id="${mine.id}">ส่งแล้ว · ยกเลิก</button>`;
    else if (s.can_swap) action = `<button type="button" class="btn btn-sm btn-outline-success" data-rot-act="ask" data-id="${s.id}">ขอแลก</button>`;
  }
  const mv = state.moves.get(s.id);
  const recent = !!mv && isRecent(mv.at);
  const movedAway = s.original_group !== s.current_group;
  let moveLine = '';
  if (mv && movedAway) {
    const partner = mv.partnerId ? m.byId.get(mv.partnerId) : null;
    moveLine = `<span class="rot-member-move">${recent ? '<span class="rot-tag is-new">เพิ่งย้าย</span> ' : ''}ย้ายมาจาก ${groupChip(mv.from, 'is-sm')}${partner ? ` · แลกกับ ${escHtml(shortName(partner))}` : mv.kind === 'admin' ? ' · ผู้ดูแลย้าย' : mv.kind === 'chain' ? ' · แลกต่อเนื่อง 3 คน' : ''} <span class="rot-muted">${agoTh(mv.at)}</span></span>`;
  } else if (movedAway) {
    moveLine = `<span class="rot-member-move">เดิมกลุ่ม ${groupChip(s.original_group, 'is-sm')}</span>`;
  }
  const askLine = asks.length
    ? `<span class="rot-member-asks">${asks.map((q) => q.target_id
        ? `ขอแลกกับ ${escHtml(shortName(m.byId.get(q.target_id)))}`
        : `ขอแลกกับใครก็ได้ในกลุ่ม ${escHtml(q.to_group)}`).join(' · ')}</span>`
    : '';
  const wishes = s.wishes || [];
  const wantsMine = !!me && !isMe && wishes.includes(me.current_group);
  const wishLine = wishes.length && !isMe
    ? `<span class="rot-member-wish">อยากไปกลุ่ม ${wishes.map((g) => groupChip(g, 'is-sm')).join('')}</span>` : '';
  const admin = state.board.is_admin && !state.practice;
  const needsGpa = ruleNeedsGpa(state.board.round.gpa_rule);
  const gpaTag = needsGpa && !s.has_gpa ? ' · <span class="rot-tag is-warn">ยังไม่กรอก GPA</span>' : '';
  return `<li class="rot-member ${s.can_swap ? 'is-eligible' : ''} ${isMe ? 'is-me' : ''} ${state.flash.has(s.id) ? 'is-flash' : ''} ${recent ? 'is-recent' : ''}">
    <span class="rot-gender is-${s.gender === 'M' ? 'm' : 'f'}" title="${genderTh(s.gender)}" aria-label="${genderTh(s.gender)}"></span>
    <div class="rot-member-text">
      <span class="rot-member-name">${escHtml(displayName(s))}${isMe ? ' <span class="rot-tag">คุณ</span>' : ''}${s.staying ? ' <span class="rot-tag is-stay"><i class="bi bi-pin-angle-fill" aria-hidden="true"></i> อยู่กลุ่มนี้</span>' : ''}${theirs ? ' <span class="rot-tag is-accent">ขอแลกกับคุณ</span>' : ''}${wantsMine ? ' <span class="rot-tag is-wish">อยากมากลุ่มคุณ</span>' : ''}</span>
      <span class="rot-member-meta">${escHtml(s.student_id)}${s.signed_in ? '' : ' · ยังไม่เคยเข้าเว็บ'}${gpaTag}${showGpa() ? ` · <span class="rot-gpa-private" title="เห็นเฉพาะบัญชีที่กำหนด">GPA ${s.gpa === null || s.gpa === undefined ? '—' : escHtml(Number(s.gpa).toFixed(2))}</span>` : ''}</span>
      ${moveLine}
      ${wishLine}
      ${contactLine(s)}
      ${askLine}
    </div>
    <div class="rot-member-action">
      ${action}
      ${admin ? `<select class="form-select form-select-sm rot-admin-move" data-rot-move="${s.id}" aria-label="ย้ายกลุ่ม (ผู้ดูแล)">
          ${state.board.round.groups.map((g) => `<option value="${g}" ${g === s.current_group ? 'selected' : ''}>${g}</option>`).join('')}
        </select>` : ''}
    </div>
  </li>`;
}

/** Only a board the SERVER marked gpa_viewer carries other people's GPA. */
function showGpa() {
  return !state.practice && state.board?.gpa_viewer === true;
}

function recentStrip() {
  const all = [...swapPairs(state.board).map((p) => ({ at: p.at, html: (o) => pairCard(p, o) })),
               ...chainCycles(state.board).map((c) => ({ at: c.at, html: (o) => chainCard(c, o) }))]
    .sort((a, b) => String(b.at).localeCompare(String(a.at)));
  if (!all.length) return '';
  return `<section class="rot-recent" aria-label="แลกล่าสุด">
    <div class="rot-recent-head">
      <h3 class="rot-subtitle">แลกล่าสุด</h3>
      <button type="button" class="btn btn-link btn-sm p-0" data-rot-act="feed-swaps">ดูทั้งหมด ${all.length} รายการ</button>
    </div>
    <div class="rot-pairs">${all.slice(0, 3).map((x) => x.html({ compact: true })).join('')}</div>
  </section>`;
}

function paintGroups() {
  const el = $('rotViewGroups');
  const m = state.model;
  const me = m.me;
  const live = state.board.round.swaps_live;
  const q = state.query;
  const needsGpa = ruleNeedsGpa(state.board.round.gpa_rule);
  const missingGpa = (state.board.students || []).filter((s) => !s.has_gpa);
  const groupsHtml = m.groupList.map((g) => {
    let members = g.members.filter((s) => matchesQuery(s, q));
    if (state.onlyEligible) members = members.filter((s) => s.can_swap || (me && s.id === me.id));
    if (state.onlyMissingGpa) members = members.filter((s) => !s.has_gpa);
    if (q.trim() && !members.length) return '';
    if (state.onlyEligible && me && !g.isMine && !g.eligible) return '';
    if (state.onlyMissingGpa && !members.length) return '';
    const open = state.openGroups.has(g.group) || !!q.trim() || state.onlyEligible || state.onlyMissingGpa;
    const myBc = m.myBroadcast.get(g.group);
    const justMoved = g.members.some((s) => state.flash.has(s.id));
    let bcAction = '';
    if (live && me && !me.staying && !g.isMine) {
      if (myBc) bcAction = `<button type="button" class="btn btn-sm btn-outline-secondary" data-rot-act="cancel" data-id="${myBc.id}">ส่งถึงทั้งกลุ่มแล้ว · ยกเลิก</button>`;
      else if (g.eligible) bcAction = `<button type="button" class="btn btn-sm btn-outline-success" data-rot-act="ask-group" data-group="${g.group}">ขอแลกกับทุกคนที่แลกได้ (${g.eligible})</button>`;
    }
    return `<details class="rot-group ${g.isMine ? 'is-mine' : ''} ${justMoved ? 'is-flash' : ''}" data-group="${g.group}" ${open ? 'open' : ''}>
      <summary>
        ${groupChip(g.group)}
        <span class="rot-group-sum">
          <span class="rot-group-title">กลุ่ม ${g.group}${g.isMine ? ' · กลุ่มของคุณ' : ''}</span>
          ${planChips(g.group)}
          <span class="rot-group-counts">${g.members.length} คน · ชาย ${g.male} หญิง ${g.female}${g.members.some((s) => s.staying) ? ` · อยู่กลุ่มนี้ ${g.members.filter((s) => s.staying).length}` : ''}${me && !g.isMine ? ` · <strong class="${g.eligible ? 'rot-ok' : ''}">แลกกับคุณได้ ${g.eligible}</strong>` : ''}</span>
        </span>
        <i class="bi bi-chevron-down rot-group-caret" aria-hidden="true"></i>
      </summary>
      ${bcAction ? `<div class="rot-group-bc">${bcAction}<p class="rot-muted">คนแรกที่ตอบรับจะได้แลกกับคุณ แล้วคำขออื่นของคุณจะปิดเอง</p></div>` : ''}
      <ul class="rot-members">${members.map(memberRow).join('') || '<li class="rot-empty">ไม่มีคนที่ตรงกับตัวกรอง</li>'}</ul>
    </details>`;
  }).join('');

  el.innerHTML = `
    <div class="rot-view-head">
      <h2 class="rot-section-title">หาคนแลก</h2>
      <p class="rot-muted">${me ? 'ปุ่ม <strong>ขอแลก</strong> สีเขียวขึ้นเฉพาะคนที่แลกกับคุณได้ · ' : ''}เกณฑ์ตอนนี้: ${escHtml(criteriaTh(state.board.round.gpa_rule))} · แตะแถวในตารางเพื่อไปที่กลุ่มนั้น</p>
    </div>
    ${me && !me.staying && needsGpa && (me.gpa === null || me.gpa === undefined)
      ? '<p class="rot-note is-warn"><i class="bi bi-exclamation-circle" aria-hidden="true"></i> กรอก GPA ในการ์ดของคุณก่อน — เกณฑ์ใช้ GPA เทียบ ตอนนี้จึงยังไม่มีใครที่แลกกับคุณได้</p>' : ''}
    ${needsGpa && missingGpa.length ? `
      <div class="rot-unswappable-banner">
        <div class="rot-unswappable-text">
          <strong><i class="bi bi-exclamation-triangle-fill text-warning me-1"></i>เพื่อนยังไม่กรอก GPA ${missingGpa.length} คน</strong>
          <span>เกณฑ์คณะใช้ GPA เทียบช่วง จึงยังแลกกับเพื่อนเหล่านี้ไม่ได้จนกว่าเพื่อนจะเข้ามากรอก</span>
        </div>
        <div class="rot-unswappable-actions">
          <button type="button" class="btn btn-sm btn-outline-secondary" data-rot-act="view-unswappable">ดูรายชื่อ (${missingGpa.length})</button>
          <button type="button" class="btn btn-sm btn-custom" data-rot-act="copy-missing-gpa"><i class="bi bi-clipboard me-1"></i>คัดลอกส่ง LINE</button>
        </div>
      </div>` : ''}
    ${showGpa() ? '<p class="rot-note is-private"><i class="bi bi-eye" aria-hidden="true"></i> คุณเห็น GPA ของทุกคน — มีเฉพาะบัญชีที่กำหนดไว้เท่านั้น ผู้ดูแลคนอื่นและ master ไม่เห็น อย่าแคปหน้าจอนี้ส่งต่อ</p>' : ''}
    ${me?.staying ? '<p class="rot-note"><i class="bi bi-pin-angle-fill" aria-hidden="true"></i> คุณเลือกอยู่กลุ่มนี้ไว้ จึงส่งหรือรับคำขอไม่ได้ · ปิดสวิตช์ในการ์ดของคุณถ้าเปลี่ยนใจ</p>' : ''}
    ${routeFinder()}
    ${recentStrip()}
    ${matrixHtml()}
    <div class="rot-filter">
      <input type="search" class="form-control form-control-sm" placeholder="ค้นหาชื่อ ชื่อเล่น หรือรหัสนักศึกษา"
             value="${escHtml(state.query)}" data-rot-input="query" aria-label="ค้นหาชื่อ ชื่อเล่น หรือรหัสนักศึกษา">
      ${me ? `<label class="rot-switch"><input type="checkbox" data-rot-input="only" ${state.onlyEligible ? 'checked' : ''}> เฉพาะคนที่แลกกับฉันได้</label>` : ''}
      ${needsGpa && missingGpa.length ? `<label class="rot-switch"><input type="checkbox" data-rot-input="only-missing-gpa" ${state.onlyMissingGpa ? 'checked' : ''}> เฉพาะคนที่ยังไม่กรอก GPA (${missingGpa.length})</label>` : ''}
    </div>
    <div class="rot-groups">${groupsHtml || '<p class="rot-empty">ไม่พบชื่อที่ค้นหา</p>'}</div>`;
}

/** "อยากไปกลุ่มไหน": the direct swap, then every route through one middle group. */
function routeFinder() {
  const m = state.model;
  const me = m.me;
  if (!me || me.staying) return '';
  const live = state.board.round.swaps_live;
  const T = state.routeTarget && state.routeTarget !== me.current_group ? state.routeTarget : null;
  const r = T ? routesTo(m, T) : null;
  const started = myChains(state.board).started;
  const chips = m.groups.filter((g) => g !== me.current_group).map((g) =>
    `<button type="button" class="rot-chip" data-g="${g}" data-rot-act="route" data-group="${g}" aria-pressed="${g === T}">${g}</button>`).join('');
  let body = '<p class="rot-muted mb-0">เลือกกลุ่มที่อยากไป — ระบบบอกว่าแลกตรงได้กี่คน และถ้าไม่มี มีทางแลกต่อเนื่องผ่านกลุ่มไหนบ้าง</p>';
  if (r) {
    const routes = r.routes.filter((x) => x.possible);
    body = `
      <div class="rot-route-direct">
        <p class="mb-1"><strong>แลกตรง</strong> ${moveArrow(r.from, r.to)} · ในกลุ่ม ${escHtml(T)} แลกกับคุณได้ <strong>${r.direct.n}</strong> คน${r.direct.wish ? ` · <span class="rot-ok">${r.direct.wish} คนอยากมากลุ่มคุณ</span>` : ''}</p>
        ${r.direct.n ? `<button type="button" class="btn btn-sm btn-outline-success" data-rot-act="jump-group" data-group="${T}">ดูรายชื่อกลุ่ม ${escHtml(T)}</button>` : ''}
      </div>
      <div class="rot-route-chain">
        <p class="mb-1"><strong>แลกต่อเนื่อง 3 คน</strong> — คุณไปกลุ่ม ${escHtml(T)}, คนจากกลุ่มกลางมาแทนที่คุณ, คนจากกลุ่ม ${escHtml(T)} ไปแทนที่เขา · <strong>ย้ายพร้อมกันทั้ง 3 คน หรือไม่มีใครย้ายเลย</strong></p>
        ${routes.length ? `<ul class="rot-routes">${routes.map((x) => {
          const mine = started.find((c) => c.via_group === x.via && c.to_group === T);
          return `<li class="rot-route-item ${x.happy ? 'is-happy' : ''}">
            <div class="rot-route-steps">
              <span>คุณ ${moveArrow(r.from, T)}</span>
              <span>คนกลุ่ม ${escHtml(x.via)} ${moveArrow(x.via, r.from)} <span class="rot-muted">${x.n1} คน${x.w1 ? ` · ${x.w1} อยากมา` : ''}</span></span>
              <span>คนกลุ่ม ${escHtml(T)} ${moveArrow(T, x.via)} <span class="rot-muted">${x.n2} คน${x.w2 ? ` · ${x.w2} อยากไป` : ''}</span></span>
              ${x.happy ? '<span class="rot-tag is-wish">ทุกคนได้กลุ่มที่อยากไป</span>' : ''}
            </div>
            ${live ? (mine
              ? `<button type="button" class="btn btn-sm btn-outline-secondary" data-rot-act="chain-cancel" data-id="${mine.id}">ส่งแล้ว ${chainYeses(mine)}/2 · ยกเลิก</button>`
              : `<button type="button" class="btn btn-sm btn-outline-success" data-rot-act="chain-ask" data-via="${x.via}" data-to="${T}">ชวนแลกต่อเนื่องผ่าน ${escHtml(x.via)}</button>`) : ''}
          </li>`;
        }).join('')}</ul>` : '<p class="rot-muted mb-0">ยังไม่มีเส้นทางผ่านกลุ่มอื่นที่มีคนแลกกับคุณได้ทั้งสองทอด</p>'}
      </div>`;
  }
  return `<section class="rot-route" aria-label="อยากไปกลุ่มไหน">
    <h3 class="rot-subtitle">อยากไปกลุ่มไหน</h3>
    <div class="rot-chips" role="group" aria-label="กลุ่มที่อยากไป">${chips}</div>
    ${body}
  </section>`;
}

const FEED_FILTERS = [['all', 'ทั้งหมด'], ['swaps', 'แลกสำเร็จ'], ['asks', 'กำลังขอแลก'], ['mine', 'เกี่ยวกับฉัน']];

function paintFeed() {
  const el = $('rotViewFeed');
  const m = state.model;
  const me = m.me;
  const name = (id) => escHtml(shortName(m.byId.get(id)));
  const closedTh = { declined: 'ไม่ตอบรับ', cancelled: 'ยกเลิกแล้ว', superseded: 'ปิดเอง เพราะมีการแลกอื่นก่อน' };
  const f = me ? state.feedFilter : (state.feedFilter === 'mine' ? 'all' : state.feedFilter);
  const pairById = new Map(swapPairs(state.board).map((p) => [p.id, p]));
  const involvesMe = (it) => {
    if (!me) return false;
    if (it.c) return chainPeople(it.c).some((p) => p.id === me.id) || (it.c.legs || []).some((l) => l.can_take);
    if (it.m) return it.m.student_id === me.id;
    const q = it.q;
    return [q.requester_id, q.target_id, q.accepted_by].includes(me.id)
      || (it.kind === 'ask' && !q.target_id && q.to_group === me.current_group);
  };
  const items = buildFeed(state.board).filter((it) => f === 'all'
    || (f === 'swaps' && (it.kind === 'swap' || it.kind === 'admin' || it.kind === 'chain-done'))
    || (f === 'asks' && (it.kind === 'ask' || it.kind === 'chain-open'))
    || (f === 'mine' && involvesMe(it)));
  const rows = items.map((it) => {
    if (it.kind === 'swap') {
      const p = pairById.get(it.q.id);
      return p ? `<li class="rot-feed-item is-swap">${pairCard(p)}</li>` : '';
    }
    if (it.kind === 'ask') {
      const q = it.q;
      return `<li class="rot-feed-item"><i class="bi bi-hourglass-split" aria-hidden="true"></i><div>
        <strong>${name(q.requester_id)}</strong> ${groupChip(q.from_group, 'is-sm')}
        ${q.target_id ? `ขอแลกกับ <strong>${name(q.target_id)}</strong> ${groupChip(q.to_group, 'is-sm')}` : `ขอแลกกับใครก็ได้ในกลุ่ม ${groupChip(q.to_group, 'is-sm')}`}
        <span class="rot-muted">รอตอบ · ${agoTh(it.at)}</span></div></li>`;
    }
    if (it.kind === 'chain-done') {
      const cy = chainCycles({ chains: [it.c] })[0];
      return `<li class="rot-feed-item is-swap">${chainCard(cy)}</li>`;
    }
    if (it.kind === 'chain-open') {
      return `<li class="rot-feed-item"><i class="bi bi-arrow-repeat" aria-hidden="true"></i><div>
        <strong>${name(it.c.starter_id)}</strong> ชวนแลกต่อเนื่อง ${moveArrow(it.c.from_group, it.c.to_group)} ผ่านกลุ่ม ${groupChip(it.c.via_group, 'is-sm')}
        <span class="rot-muted">ตอบรับแล้ว ${chainYeses(it.c)}/2 · ${agoTh(it.at)}</span></div></li>`;
    }
    if (it.kind === 'chain-closed') {
      const why = { cancelled: 'ยกเลิกแล้ว', expired: 'หมดเวลา', failed: it.c.fail_reason === 'declined' ? 'มีคนไม่ตอบรับ' : it.c.fail_reason === 'moved' ? 'มีคนย้ายกลุ่มไปก่อน' : 'ข้อมูลเปลี่ยนระหว่างรอ ไม่มีใครย้าย' };
      return `<li class="rot-feed-item is-private"><i class="bi bi-eye-slash" aria-hidden="true"></i><div>
        แลกต่อเนื่องของ <strong>${it.c.starter_id === me?.id ? 'คุณ' : name(it.c.starter_id)}</strong> ${moveArrow(it.c.from_group, it.c.to_group)} — ${why[it.c.status] || it.c.status}
        <span class="rot-muted">${agoTh(it.at)} · เห็นเฉพาะคนที่เกี่ยวข้อง</span></div></li>`;
    }
    if (it.kind === 'admin') {
      const mv = it.m;
      return `<li class="rot-feed-item"><i class="bi bi-shield-check" aria-hidden="true"></i><div>
        ผู้ดูแลย้าย <strong>${name(mv.student_id)}</strong> ${moveArrow(mv.from_group, mv.to_group)}
        <span class="rot-muted">${agoTh(it.at)}</span></div></li>`;
    }
    const q = it.q;
    const mineAsk = q.requester_id === me?.id;
    return `<li class="rot-feed-item is-private"><i class="bi bi-eye-slash" aria-hidden="true"></i><div>
      ${mineAsk ? `คำขอของคุณถึง ${q.target_id ? `<strong>${name(q.target_id)}</strong>` : `กลุ่ม ${groupChip(q.to_group, 'is-sm')}`}` : `คำขอจาก <strong>${name(q.requester_id)}</strong>`}
      — ${closedTh[q.status] || q.status}
      <span class="rot-muted">${agoTh(it.at)} · เห็นเฉพาะคุณ</span></div></li>`;
  });
  el.innerHTML = `
    <div class="rot-view-head">
      <h2 class="rot-section-title">ความเคลื่อนไหว</h2>
      <p class="rot-muted">ทุกคนในปี 6 เห็นคำขอที่รอตอบและการแลกที่สำเร็จ · การปฏิเสธหรือยกเลิกเห็นเฉพาะคนที่เกี่ยวข้อง</p>
    </div>
    <div class="rot-chips" role="group" aria-label="กรอง">
      ${FEED_FILTERS.filter(([k]) => k !== 'mine' || me).map(([k, label]) => `<button type="button" class="rot-chip" data-rot-act="feed-filter" data-f="${k}" aria-pressed="${f === k}">${label}</button>`).join('')}
    </div>
    <ul class="rot-feed">${rows.join('') || '<li class="rot-empty">ยังไม่มีความเคลื่อนไหว</li>'}</ul>`;
}

function paintAdmin() {
  const el = $('rotAdmin');
  if (!state.board.is_admin || state.practice) { el.hidden = true; el.innerHTML = ''; return; }
  const r = state.board.round;
  const close = r.swaps_close_at ? toLocalInput(new Date(r.swaps_close_at)) : '';
  el.hidden = false;
  el.innerHTML = `<details class="rot-admin-box" ${state.adminOpen ? 'open' : ''}>
    <summary>
      <span class="rot-section-title mb-0"><i class="bi bi-shield-lock me-1" aria-hidden="true"></i>ผู้ดูแล</span>
      <span class="rot-muted">${r.published ? 'นักศึกษาเห็น' : 'ซ่อนจากนักศึกษา'} · ${r.swaps_open ? 'เปิดให้แลก' : 'ปิดการแลก'}</span>
      <i class="bi bi-chevron-down rot-group-caret" aria-hidden="true"></i>
    </summary>
    <form data-rot-form="admin" class="rot-admin-form">
      <label class="rot-switch"><input type="checkbox" name="published" ${r.published ? 'checked' : ''}> นักศึกษาเห็นหน้านี้</label>
      <label class="rot-switch"><input type="checkbox" name="swaps_open" ${r.swaps_open ? 'checked' : ''}> เปิดให้แลก</label>
      <label class="rot-admin-field">ปิดรับอัตโนมัติ (เว้นว่าง = ไม่ปิดเอง)
        <input type="datetime-local" name="close_at" class="form-control form-control-sm" value="${close}"></label>
      <label class="rot-admin-field">เกณฑ์ GPA
        <select name="gpa_rule" class="form-select form-select-sm">
          <option value="off" ${r.gpa_rule === 'off' ? 'selected' : ''}>ไม่ใช้ (เก็บข้อมูลอย่างเดียว)</option>
          <option value="band_or_close" ${r.gpa_rule === 'band_or_close' ? 'selected' : ''}>ช่วงเดียวกัน หรือห่างกันไม่เกิน 0.20 (เกณฑ์คณะ)</option>
          <option value="same_band" ${r.gpa_rule === 'same_band' ? 'selected' : ''}>ต้องอยู่ช่วงเดียวกันเท่านั้น (2.55–2.99 / 3.00–3.49 / 3.50–4.00)</option>
        </select></label>
      <button type="submit" class="btn btn-sm btn-custom">บันทึก</button>
      <p class="rot-muted mb-0">${state.board.students.length} คนในตาราง · กรอก GPA แล้ว ${Number(r.gpa_filled ?? 0)} คน (${showGpa() ? 'คุณเห็นตัวเลข — บัญชีที่กำหนดเท่านั้น' : 'ผู้ดูแลไม่เห็นตัวเลขของใคร'}) · อยู่กลุ่มเดิม ${state.board.students.filter((s) => s.staying).length} คน · ช่องเลือกกลุ่มข้างชื่อในแท็บ "หาคนแลก" = ย้ายเองโดยผู้ดูแล</p>
    </form>
  </details>`;
}

function toLocalInput(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

// ── the confirm sheet (compare schedules before committing) ─────────────────

function compareHtml(fromGroup, toGroup) {
  const a = groupTimetable(ROUND, fromGroup);
  const b = groupTimetable(ROUND, toGroup);
  return `<table class="rot-compare">
    <thead><tr><th scope="col">Block</th><th scope="col">ตอนนี้ ${groupChip(fromGroup, 'is-sm')}</th><th scope="col">หลังแลก ${groupChip(toGroup, 'is-sm')}</th></tr></thead>
    <tbody>${a.map((x, i) => `<tr>
      <th scope="row">${x.block.label.replace('Block ', '')}<small>${thDate(x.start)}</small></th>
      <td>${unitChip(x.unitKey)}</td><td>${unitChip(b[i].unitKey)}</td></tr>`).join('')}</tbody>
  </table>`;
}

function askSheet({ title, lead, fromGroup, toGroup, yes, extra = '', danger = false }) {
  return new Promise((resolve) => {
    let el = document.getElementById('rotSheet');
    if (!el) {
      el = document.createElement('div');
      el.id = 'rotSheet';
      el.className = 'modal fade rot-sheet';
      el.tabIndex = -1;
      el.setAttribute('aria-hidden', 'true');
      el.setAttribute('aria-labelledby', 'rotSheetTitle');
      document.body.appendChild(el);
    }
    el.innerHTML = `
      <div class="modal-dialog modal-dialog-centered modal-dialog-scrollable">
        <div class="modal-content">
          <div class="modal-header">
            <h2 class="modal-title fs-6" id="rotSheetTitle">${title}</h2>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="ปิด"></button>
          </div>
          <div class="modal-body">
            <p class="rot-sheet-lead">${lead}</p>
            ${extra}
            ${fromGroup && toGroup ? compareHtml(fromGroup, toGroup) : ''}
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">ยกเลิก</button>
            <button type="button" class="${danger ? 'btn btn-danger' : 'btn btn-custom'}" data-rot-sheet-yes>${yes}</button>
          </div>
        </div>
      </div>`;
    const modal = window.bootstrap.Modal.getOrCreateInstance(el);
    let answer = false;
    el.querySelector('[data-rot-sheet-yes]').addEventListener('click', () => { answer = true; modal.hide(); }, { once: true });
    el.addEventListener('hidden.bs.modal', () => resolve(answer), { once: true });
    modal.show();
  });
}

function showUnswappableModal(missing, groups) {
  let el = document.getElementById('rotUnswappableModal');
  if (!el) {
    el = document.createElement('div');
    el.id = 'rotUnswappableModal';
    el.className = 'modal fade rot-sheet';
    el.tabIndex = -1;
    el.setAttribute('aria-hidden', 'true');
    document.body.appendChild(el);
  }
  const byGroup = new Map(groups.map((g) => [g, []]));
  for (const s of missing) {
    if (byGroup.has(s.current_group)) byGroup.get(s.current_group).push(s);
  }
  const groupsHtml = groups.map((g) => {
    const list = byGroup.get(g) || [];
    if (!list.length) return '';
    return `<div class="rot-unswappable-sec">
      <div class="rot-unswappable-head">${groupChip(g, 'is-sm')} <strong>กลุ่ม ${g}</strong> <span class="rot-muted">(${list.length} คน)</span></div>
      <ul class="rot-unswappable-list">
        ${list.map((s) => `<li>
          <span class="rot-unswappable-name">${escHtml(displayName(s))}</span>
          <span class="rot-muted">${escHtml(s.student_id)}${s.signed_in ? '' : ' · <span class="rot-tag">ยังไม่เคยเข้าเว็บ</span>'}</span>
        </li>`).join('')}
      </ul>
    </div>`;
  }).join('');

  el.innerHTML = `
    <div class="modal-dialog modal-dialog-centered modal-dialog-scrollable">
      <div class="modal-content">
        <div class="modal-header">
          <h2 class="modal-title fs-6">เพื่อนที่ยังไม่กรอก GPA (${missing.length} คน)</h2>
          <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="ปิด"></button>
        </div>
        <div class="modal-body">
          <p class="rot-muted mb-3">เกณฑ์รอบนี้ใช้ GPA เทียบช่วง จึงยังแลกกับเพื่อนเหล่านี้ไม่ได้จนกว่าเพื่อนจะเข้ามากรอก</p>
          <div class="d-grid mb-3">
            <button type="button" class="btn btn-sm btn-outline-success" data-rot-act="copy-missing-gpa">
              <i class="bi bi-clipboard me-1"></i>คัดลอกรายชื่อสำหรับส่งกลุ่ม LINE
            </button>
          </div>
          <div class="rot-unswappable-body">${groupsHtml}</div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">ปิด</button>
        </div>
      </div>
    </div>`;
  const modal = window.bootstrap.Modal.getOrCreateInstance(el);
  modal.show();
}

// ── actions ──────────────────────────────────────────────────────────────────


async function act(button, fn) {
  if (state.busy) return;
  state.busy = true;
  const label = button?.innerHTML;
  if (button) { button.disabled = true; button.innerHTML = '<span class="spinner-border spinner-border-sm" aria-hidden="true"></span>'; }
  try {
    const res = await fn();
    if (res && res.ok === false) toast(reasonText(res.reason), 'error');
    return res;
  } finally {
    state.busy = false;
    if (button && button.isConnected) { button.disabled = false; button.innerHTML = label; }
    state.quietNext = true;   // our own toast says what happened
    await load();
  }
}

function scrollToViews() {
  document.querySelector('#rotRoot .rot-seg')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function onClick(e) {
  const viewBtn = e.target.closest('[data-rot-view]');
  if (viewBtn) {
    state.view = viewBtn.dataset.rotView;
    paintViews();
    if (!viewBtn.classList.contains('rot-seg-btn')) scrollToViews();
    return;
  }
  const b = e.target.closest('[data-rot-act]');
  if (!b) return;
  const m = state.model;
  const me = m?.me;
  const kind = b.dataset.rotAct;

  if (kind === 'reload') { paintGate('loading'); load(); return; }
  if (kind === 'practice-start') { startPractice(); return; }
  if (kind === 'practice-stop') { stopPractice(); return; }
  if (kind === 'scene') {
    if (!state.practice) return;
    const scene = b.dataset.scene;
    const r = state.practice.scene(scene);
    toast(r.text, r.ok ? 'ok' : 'error');
    if (!r.ok) return;
    if (scene === 'others_swap' && state.view === 'mine') state.view = 'groups';
    state.quietNext = true;   // the scene's own sentence is the announcement
    await load();
    if (/ask_me|broadcast/.test(scene)) $('rotAlert')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
  if (kind === 'guide-hide') { state.guideHidden = true; writeGuideHidden(true); paintGuide(); return; }
  if (kind === 'guide-show') {
    state.guideHidden = false; writeGuideHidden(false); paintGuide();
    $('rotGuide')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
  if (kind === 'find-mates') { state.view = 'groups'; state.onlyEligible = true; paintViews(); scrollToViews(); return; }
  if (kind === 'feed-swaps') { state.view = 'feed'; state.feedFilter = 'swaps'; paintViews(); return; }
  if (kind === 'feed-filter') { state.feedFilter = b.dataset.f; paintFeed(); return; }
  if (kind === 'route') {
    state.routeTarget = state.routeTarget === b.dataset.group ? null : b.dataset.group;
    paintGroups();
    document.querySelector('#rotViewGroups .rot-route')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    return;
  }
  if (kind === 'wish') {
    if (!me) return;
    const g = b.dataset.group;
    const now = me.wishes || [];
    const next = now.includes(g) ? now.filter((x) => x !== g) : [...now, g];
    const res = await act(b, () => rpc('rotation_set_wishes', { p_round: ROUND_ID, p_groups: next }));
    if (res?.ok) toast(next.length ? `บันทึกแล้ว — อยากไปกลุ่ม ${next.join(', ')}` : 'ล้างกลุ่มที่อยากไปแล้ว');
    return;
  }
  if (kind === 'chain-ask') {
    if (!me) return;
    const via = b.dataset.via; const to = b.dataset.to;
    const yes = await askSheet({
      title: `ชวนแลกต่อเนื่อง: คุณไปกลุ่ม ${escHtml(to)} ผ่านกลุ่ม ${escHtml(via)}?`,
      lead: `<strong>คุณ</strong> ${escHtml(me.current_group)} → ${escHtml(to)} · <strong>ใครก็ได้ในกลุ่ม ${escHtml(via)}</strong> ที่แลกกับคุณได้ → ${escHtml(me.current_group)} · <strong>ใครก็ได้ในกลุ่ม ${escHtml(to)}</strong> ที่แลกกับคุณได้ → ${escHtml(via)}<br>
             <strong>ยังไม่มีใครย้ายจนกว่าทั้งสองกลุ่มจะมีคนตอบรับ</strong> แล้วทั้ง 3 คนย้ายพร้อมกันทันที · ถ้ามีคนย้ายไปก่อน ระบบหาคนใหม่ให้ หรือยกเลิกเอง · หมดเวลาใน 48 ชั่วโมง · ทุกคนในปี 6 เห็นคำชวนนี้`,
      fromGroup: me.current_group, toGroup: to, yes: 'ส่งคำชวน',
    });
    if (!yes) return;
    const res = await act(b, () => rpc('rotation_chain_propose', { p_round: ROUND_ID, p_via: via, p_to: to, p_via_target: null, p_to_target: null }));
    if (res?.ok) toast(`ส่งคำชวนแลกต่อเนื่องแล้ว — รอคนในกลุ่ม ${via} และ ${to} ตอบรับ`);
    return;
  }
  if (kind === 'chain-yes') {
    const c = (state.board.chains || []).find((x) => x.id === b.dataset.id);
    const leg = c?.legs?.find((l) => l.can_take);
    if (!c || !leg || !me) return;
    const last = chainYeses(c) === 1;
    const yes = await askSheet({
      title: `แลกต่อเนื่องกับ ${escHtml(displayName(m.byId.get(c.starter_id)))}?`,
      lead: `<span class="rot-chain-line">${chainLine(c)}</span><br>
             ${last
               ? '<strong>คุณเป็นคนสุดท้าย — ตอบรับแล้วทั้ง 3 คนย้ายทันที</strong>'
               : '<strong>การตอบรับคือการยืนยันไว้ก่อน</strong> — ยังไม่มีใครย้ายจนกว่าอีกคนจะตอบรับครบ แล้วทั้ง 3 คนย้ายพร้อมกัน · ถอนตัวได้จนกว่าจะครบ'}
             · คำขออื่นที่เกี่ยวกับทั้ง 3 คนจะปิดเองเมื่อย้ายแล้ว`,
      fromGroup: leg.from_group, toGroup: leg.to_group, yes: last ? 'ตอบรับและย้ายเลย' : 'ยืนยันไว้ก่อน',
    });
    if (!yes) return;
    const res = await act(b, () => rpc('rotation_chain_respond', { p_chain: c.id, p_yes: true }));
    if (res?.ok) toast(res.done ? `แลกต่อเนื่องสำเร็จ — ทั้ง 3 คนย้ายแล้ว ตอนนี้คุณอยู่กลุ่ม ${res.my_group}` : 'ยืนยันแล้ว — รออีกคนตอบรับ แล้วทั้ง 3 คนย้ายพร้อมกัน');
    return;
  }
  if (kind === 'chain-no') {
    const res = await act(b, () => rpc('rotation_chain_respond', { p_chain: b.dataset.id, p_yes: false }));
    if (res?.ok) toast('เรียบร้อย — ไม่มีใครย้าย');
    return;
  }
  if (kind === 'chain-cancel') {
    const res = await act(b, () => rpc('rotation_chain_cancel', { p_chain: b.dataset.id }));
    if (res?.ok) toast('ยกเลิกแลกต่อเนื่องแล้ว');
    return;
  }
  if (kind === 'chain-kick') {
    const chainId = b.dataset.id;
    const seq = parseInt(b.dataset.seq, 10);
    const who = b.dataset.name || 'คนนี้';
    const yes = await askSheet({
      title: `ปฏิเสธ ${who} ออกจากแลกต่อเนื่อง?`,
      lead: `คุณกำลังปฏิเสธ <strong>${escHtml(who)}</strong> ออกจากคำชวนแลกต่อเนื่องนี้<br>
             คำชวนของคุณจะยังเปิดอยู่ และที่นั่งในกลุ่มนี้จะเปิดให้คนอื่นเข้ามาร่วมแลกแทน`,
      yes: 'ปฏิเสธคนนี้',
      danger: true,
    });
    if (!yes) return;
    const res = await act(b, () => rpc('rotation_chain_kick', { p_chain: chainId, p_seq: seq }));
    if (res?.ok) toast(`ปฏิเสธ ${who} แล้ว — เปิดรับคนใหม่ในกลุ่มนี้แล้ว`);
    return;
  }

  if (kind === 'jump-group') {
    const g = b.dataset.group;
    state.openGroups.add(g);
    paintGroups();
    document.querySelector(`#rotViewGroups details[data-group="${g}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }

  if (kind === 'ask') {
    const t = m.byId.get(b.dataset.id);
    if (!t || !me) return;
    const others = m.outgoing.length;
    const yes = await askSheet({
      title: `ขอแลกกับ ${escHtml(displayName(t))}?`,
      lead: `คุณอยู่กลุ่ม <strong>${escHtml(me.current_group)}</strong> · ${escHtml(shortName(t))} อยู่กลุ่ม <strong>${escHtml(t.current_group)}</strong><br>
             <strong>ถ้าเขาตอบรับ ระบบจะสลับกลุ่มให้ทันที</strong> ไม่ต้องยืนยันซ้ำ${others ? ` และคำขออื่นของคุณ (${others}) จะปิดเอง` : ''} · ยกเลิกได้ตลอดจนกว่าจะมีคนตอบรับ · ทุกคนในปี 6 เห็นคำขอนี้`,
      extra: t.contact ? `<p class="rot-sheet-contact">${contactLine(t)} <span class="rot-muted">ทักไปคุยก่อนก็ได้</span></p>` : '',
      fromGroup: me.current_group, toGroup: t.current_group, yes: 'ส่งคำขอ',
    });
    if (!yes) return;
    const res = await act(b, () => rpc('rotation_request', { p_round: ROUND_ID, p_target: t.id, p_to_group: null }));
    if (res?.ok) toast(`ส่งคำขอถึง ${shortName(t)} แล้ว — รอเขาตอบรับ`);
    return;
  }

  if (kind === 'ask-group') {
    const g = b.dataset.group;
    const n = m.groupList.find((x) => x.group === g)?.eligible || 0;
    const yes = await askSheet({
      title: `ขอแลกกับทุกคนที่แลกได้ในกลุ่ม ${escHtml(g)}?`,
      lead: `คำขอจะไปถึง <strong>${n} คน</strong> ในกลุ่ม ${escHtml(g)} ที่แลกกับคุณได้ตามเกณฑ์<br>
             <strong>คนแรกที่ตอบรับจะได้แลกกับคุณทันที</strong> แล้วคำขออื่นทั้งหมดของคุณจะปิดเอง · ยกเลิกได้ตลอดจนกว่าจะมีคนตอบรับ`,
      fromGroup: me.current_group, toGroup: g, yes: `ส่งถึง ${n} คน`,
    });
    if (!yes) return;
    const res = await act(b, () => rpc('rotation_request', { p_round: ROUND_ID, p_target: null, p_to_group: g }));
    if (res?.ok) toast(`ส่งคำขอถึงกลุ่ม ${g} แล้ว — คนแรกที่ตอบรับได้แลก`);
    return;
  }

  if (kind === 'accept') {
    const q = (state.board.requests || []).find((x) => x.id === b.dataset.id);
    if (!q || !me) return;
    const who = m.byId.get(q.requester_id);
    const yes = await askSheet({
      title: `แลกกับ ${escHtml(displayName(who))}?`,
      lead: `คุณจะย้ายจากกลุ่ม <strong>${escHtml(me.current_group)}</strong> ไปกลุ่ม <strong>${escHtml(q.from_group)}</strong>
             และ ${escHtml(shortName(who))} จะมากลุ่ม ${escHtml(me.current_group)} <strong>ทันที</strong><br>
             คำขออื่นที่เกี่ยวกับคุณทั้งสองคนจะปิดเอง`,
      fromGroup: me.current_group, toGroup: q.from_group, yes: 'ตอบรับและแลกเลย',
    });
    if (!yes) return;
    const res = await act(b, () => rpc('rotation_accept', { p_request: q.id }));
    if (res?.ok) toast(`แลกสำเร็จ — ตอนนี้คุณอยู่กลุ่ม ${res.my_group}`);
    return;
  }

  if (kind === 'cancel' || kind === 'decline') {
    const res = await act(b, () => rpc('rotation_respond_no', { p_request: b.dataset.id }));
    if (res?.ok) toast(kind === 'cancel' ? 'ยกเลิกคำขอแล้ว' : 'ไม่รับคำขอนี้แล้ว');
    return;
  }

  if (kind === 'dismiss-offer' || kind === 'dismiss-chain') {
    addDismissedOffer(b.dataset.id);
    toast('ซ่อนคำขอนี้แล้ว (คนอื่นในกลุ่มยังตอบรับได้ตามปกติ)');
    paintAlert();
    return;
  }
  if (kind === 'restore-dismissed') {
    clearDismissedOffers();
    toast('แสดงคำขอทั้งหมดแล้ว');
    paintAlert();
    return;
  }
  if (kind === 'view-unswappable') {
    const missing = (state.board.students || []).filter((s) => !s.has_gpa);
    showUnswappableModal(missing, state.board.round.groups);
    return;
  }
  if (kind === 'copy-missing-gpa') {
    const missing = (state.board.students || []).filter((s) => !s.has_gpa);
    const text = formatMissingGpaCopyText(missing, state.board.round.groups);
    await copyText(text);
    toast(`คัดลอกรายชื่อเพื่อนที่ยังไม่กรอก GPA (${missing.length} คน) แล้ว`);
    return;
  }
}

async function onSubmit(e) {
  const form = e.target.closest('[data-rot-form]');
  if (!form) return;
  e.preventDefault();
  const btn = form.querySelector('[type="submit"]');
  if (form.dataset.rotForm === 'profile') {
    const me = state.board.me;
    const err = form.querySelector('[data-rot-profile-error]');
    const { value, error } = parseGpa(form.elements.gpa.value);
    const contact = form.elements.contact.value.replace(/\s+/g, ' ').trim();
    err.hidden = !error;
    err.textContent = error || '';
    if (error) return;
    const had = me.gpa === null || me.gpa === undefined ? null : Number(me.gpa);
    const gpaChanged = had !== value;
    const contactChanged = contact !== (me.contact || '');
    if (!gpaChanged && !contactChanged) { toast('ไม่มีอะไรเปลี่ยน'); return; }
    const res = await act(btn, async () => {
      if (contactChanged) {
        const r = await rpc('rotation_set_contact', { p_round: ROUND_ID, p_contact: contact || null });
        if (r?.ok === false) return r;
      }
      if (gpaChanged) return rpc('rotation_set_gpa', { p_round: ROUND_ID, p_gpa: value });
      return { ok: true };
    });
    if (res?.ok) toast('บันทึกแล้ว');
  }
  if (form.dataset.rotForm === 'practice-as') {
    startPractice({ gender: form.elements.gender.value, group: form.elements.group.value });
    toast('เริ่มโหมดทดลองใหม่แล้ว');
  }
  if (form.dataset.rotForm === 'admin') {
    const f = form.elements;
    const close = f.close_at.value ? new Date(f.close_at.value).toISOString() : null;
    const res = await act(btn, () => rpc('rotation_admin_update_round', {
      p_round: ROUND_ID, p_published: f.published.checked, p_swaps_open: f.swaps_open.checked,
      p_swaps_close_at: close, p_gpa_rule: f.gpa_rule.value,
    }));
    if (res?.ok) toast('บันทึกการตั้งค่าแล้ว');
  }
}

function onInput(e) {
  const t = e.target;
  if (t.dataset.rotInput === 'query') {
    state.query = t.value;
    const pos = t.selectionStart;
    paintGroups();
    const again = document.querySelector('#rotViewGroups [data-rot-input="query"]');
    if (again) { again.focus(); try { again.setSelectionRange(pos, pos); } catch (_) {} }
  }
}

async function onChange(e) {
  const t = e.target;
  if (t.dataset.rotInput === 'only') { state.onlyEligible = t.checked; paintGroups(); return; }
  if (t.dataset.rotInput === 'only-missing-gpa') { state.onlyMissingGpa = t.checked; paintGroups(); return; }
  if (t.dataset.rotInput === 'stay') { await setStaying(t); return; }
  if (t.dataset.rotMove) {
    const s = state.model.byId.get(t.dataset.rotMove);
    const res = await act(null, () => rpc('rotation_admin_move', { p_student: t.dataset.rotMove, p_group: t.value }));
    if (res?.ok) toast(`ย้าย ${fullName(s)} ไปกลุ่ม ${t.value} แล้ว`);
  }
}

/** The "ฉันอยากอยู่กลุ่มนี้" switch. Turning it ON closes open asks, so say so first. */
async function setStaying(input) {
  const m = state.model;
  const on = input.checked;
  const ch = myChains(state.board);
  const open = (m.incoming.filter((q) => q.target_id).length) + m.outgoing.length + ch.started.length + ch.committed.length;
  if (on && open) {
    const yes = await askSheet({
      title: 'อยู่กลุ่มนี้ ไม่รับคำขอแลก?',
      lead: `คำขอที่ค้างอยู่ <strong>${open} รายการ</strong> จะปิดทันที — ที่ส่งถึงคุณจะเป็น "ไม่ตอบรับ" ที่คุณส่งไปจะถูกยกเลิก<br>
             หลังจากนี้ไม่มีใครส่งคำขอถึงคุณได้ จนกว่าคุณจะปิดสวิตช์นี้`,
      yes: 'อยู่กลุ่มนี้',
    });
    if (!yes) { input.checked = false; return; }
  }
  const res = await act(null, () => rpc('rotation_set_staying', { p_round: ROUND_ID, p_staying: on }));
  if (res?.ok) toast(on ? `คุณเลือกอยู่กลุ่ม ${state.board.me?.current_group || ''} แล้ว — ไม่มีใครส่งคำขอถึงคุณได้` : 'ปิดแล้ว — แลกได้ตามปกติ');
}

// <details> open state survives a re-render.
document.addEventListener('toggle', (e) => {
  const d = e.target;
  if (d?.tagName === 'DETAILS' && d.classList.contains('rot-group')) {
    if (d.open) state.openGroups.add(d.dataset.group); else state.openGroups.delete(d.dataset.group);
  }
  if (d?.tagName === 'DETAILS' && d.classList.contains('rot-admin-box')) state.adminOpen = d.open;
}, true);

let toastTimer = null;
function toast(text, tone = 'ok') {
  const el = $('rotToast');
  if (!el) return;
  el.textContent = text;
  el.dataset.tone = tone;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 4500);
}
