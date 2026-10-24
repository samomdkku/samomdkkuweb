// ============================================================
// page.js — /rotation "แลก Rotation". Loaded by DYNAMIC import the first time
// the tab opens (main.js), so the portal's entry bundle does not carry it.
//
// ONE READ: rotation_board() (0250) returns the round, me, every student, the
// open asks and the history. Every write is an RPC that answers {ok, reason};
// after any write — ours or anybody's — the board is read again. "Anybody's"
// arrives through Supabase Realtime on `rotation_events` (a content-free ping),
// with a 60 s re-read while the tab is visible as the fallback, because a
// realtime socket is the part of this page most likely to die quietly
// (backgrounded phone, stale JWT).
//
// WHAT THE PAGE NEVER DOES: decide who may swap. `can_swap` is the server's
// answer (rotation_pair_allowed). See model.js.
//
// LAYOUT, per device (the owner asked whether the timetable would hurt the
// phone/iPad/desktop experience):
//   • phone: one column. "ตารางของฉัน" is a vertical list of six blocks — the
//     48-column grid of the PDF is never drawn; the overview is a 6 × 6 grid of
//     short labels that fits 360 px.
//   • iPad portrait: the same column, wider cards.
//   • ≥ 992 px: two columns — me + asks on the left (sticky), views on the right.
//
// Listeners: ONE delegated click/submit/change handler on #rotRoot, bound once
// (mount guard). Re-renders replace innerHTML only.
// ============================================================

import { db, dbRest, currentAccessToken } from '../db.js';
import { authReady, onAuthChange, getUser } from '../auth.js';
import { escHtml } from '../utils.js';
import { ROTATION_2570 as ROUND } from '../../data/rotation-2570.js';
import { groupTimetable, weekOf, blockIndexOfWeek, thDate, thRange, weeksLabel } from './schedule.js';
import { buildModel, buildFeed, reasonText, fullName, genderTh, agoTh, parseGpa } from './model.js';

const ROUND_ID = ROUND.roundId;
const POLL_MS = 60_000;

const state = {
  mounted: false,
  board: null,
  model: null,
  view: 'mine',
  onlyEligible: false,
  query: '',
  openGroups: new Set(),
  busy: false,
  loading: false,
  reloadAgain: false,
  lastLoadedAt: null,
  live: false,
};

let channel = null;
let pollTimer = null;
let reauthTimer = null;
let debounceTimer = null;

const $ = (id) => document.getElementById(id);

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
}

function isOnPage() {
  return !!$('pills-rotation')?.classList.contains('active');
}

// ── data ─────────────────────────────────────────────────────────────────────

async function rpc(name, body) {
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
    if (!getUser()) { state.board = null; paintGate('signed_out'); return; }
    const prevGroup = state.board?.me?.current_group;
    const board = await rpc('rotation_board', { p_round: ROUND_ID });
    if (!board || board.ok === false) { paintGate('error', board?.detail); return; }
    state.board = board;
    state.lastLoadedAt = new Date();
    if (board.state !== 'ok') { paintGate(board.state); return; }
    state.model = buildModel(board);
    const nowGroup = board.me?.current_group;
    if (prevGroup && nowGroup && prevGroup !== nowGroup) {
      toast(`คุณย้ายไปกลุ่ม ${nowGroup} แล้ว — ตารางของคุณเปลี่ยนตามด้านล่าง`);
    }
    paintAll();
  } finally {
    state.loading = false;
    if (state.reloadAgain) { state.reloadAgain = false; load(); }
  }
}

function startLive() {
  if (!channel) {
    try { db.realtime.setAuth(currentAccessToken()); } catch (_) {}
    channel = db.channel(`rotation-${ROUND_ID}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'rotation_events', filter: `round_id=eq.${ROUND_ID}` },
        () => {
          clearTimeout(debounceTimer);
          debounceTimer = setTimeout(() => { if (isOnPage()) load(); }, 250);
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
    if (document.visibilityState === 'visible' && isOnPage()) load();
  }, POLL_MS);
}

// ── gate ─────────────────────────────────────────────────────────────────────

function paintGate(kind, detail) {
  const gate = $('rotGate');
  const main = $('rotMain');
  const show = kind !== 'ok';
  main.hidden = show;
  gate.hidden = !show;
  paintStatus();
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
      </div>`,
    not_in_roster: `<div class="rot-gate-card">
        <i class="bi bi-person-x rot-gate-icon" aria-hidden="true"></i>
        <h2>ไม่พบชื่อคุณในตาราง Rotation ปี 6</h2>
        <p>หน้านี้สำหรับนักศึกษาแพทย์ชั้นปีที่ 6 ปีการศึกษา 2570 ที่อยู่ในตารางของคณะ</p>
        ${user?.email ? `<p class="rot-muted">ตอนนี้เข้าสู่ระบบด้วย <strong>${escHtml(user.email)}</strong> — ถ้าคุณอยู่ในตาราง ให้ออกจากระบบแล้วเข้าใหม่ด้วย kkumail ของคุณเอง</p>` : ''}
        <p class="rot-muted">ยังไม่เจอ แจ้งได้ที่ <a href="/vssound">VitalSound</a></p>
      </div>`,
    not_published: `<div class="rot-gate-card">
        <i class="bi bi-hourglass-split rot-gate-icon" aria-hidden="true"></i>
        <h2>ยังไม่เปิดให้ใช้</h2>
        <p>สโมสรจะประกาศเมื่อเปิดให้ดูกลุ่มและแลก Rotation</p>
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
    <span class="rot-live-dot ${state.live ? 'is-live' : ''}" title="${state.live ? 'อัปเดตสดอยู่' : 'อัปเดตทุก 1 นาที'}">
      <span aria-hidden="true"></span>${state.live ? 'อัปเดตสด' : 'อัปเดตทุก 1 นาที'}
    </span>`;
}

// ── paint ────────────────────────────────────────────────────────────────────

function paintAll() {
  paintGate('ok');
  paintAdmin();
  paintMe();
  paintInbox();
  paintViews();
}

function groupChip(g, extra = '') {
  return `<span class="rot-group-chip ${extra}">${escHtml(g)}</span>`;
}

function unitChip(unitKey, { long = false } = {}) {
  const u = ROUND.units[unitKey];
  return `<span class="rot-unit" style="--unit:${u.tone}">${escHtml(long ? u.name : u.short)}</span>`;
}

function paintMe() {
  const el = $('rotMe');
  const me = state.board.me;
  const r = state.board.round;
  if (!me) {
    el.innerHTML = `<p class="rot-muted mb-0">คุณเข้าในฐานะผู้ดูแล — ไม่ได้อยู่ในตารางนี้</p>`;
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
      <div class="rot-me-group" aria-label="กลุ่มของฉัน">
        <span class="rot-me-group-label">กลุ่ม</span>
        <span class="rot-me-group-letter">${escHtml(me.current_group)}</span>
      </div>
      <div class="rot-me-who">
        <p class="rot-me-name">${escHtml(me.prefix)}${escHtml(fullName(me))}</p>
        <p class="rot-me-meta">${escHtml(me.student_id)} · ${genderTh(me.gender)}${moved ? ` · <span class="rot-moved">ย้ายจากกลุ่ม ${escHtml(me.original_group)}</span>` : ''}</p>
        <p class="rot-me-when">${when}</p>
      </div>
    </div>
    <form class="rot-gpa" data-rot-form="gpa" novalidate>
      <label for="rotGpaInput" class="rot-gpa-label">GPA</label>
      <input id="rotGpaInput" name="gpa" class="form-control form-control-sm rot-gpa-input" inputmode="decimal"
             autocomplete="off" placeholder="เช่น 3.25" value="${escHtml(gpaVal)}" aria-describedby="rotGpaHelp">
      <button type="submit" class="btn btn-sm btn-outline-secondary">บันทึก</button>
      <p id="rotGpaHelp" class="rot-gpa-help">
        ${r.gpa_rule === 'same_band'
          ? 'ใช้เทียบเกณฑ์ GPA (ช่วงเดียวกัน) · '
          : 'ยังไม่ใช้เป็นเกณฑ์ตอนนี้ เก็บไว้เทียบภายหลัง · '}
        เห็นเฉพาะคุณและผู้ดูแล
      </p>
      <p class="rot-gpa-error" data-rot-gpa-error hidden></p>
    </form>`;
}

function personLine(s, { withGroup = true } = {}) {
  if (!s) return '<span class="rot-muted">(ไม่พบ)</span>';
  return `<span><strong>${escHtml(fullName(s))}</strong>${withGroup ? ` ${groupChip(s.current_group, 'is-sm')}` : ''}</span>`;
}

function paintInbox() {
  const el = $('rotInbox');
  const m = state.model;
  const live = state.board.round.swaps_live;
  if (!m.me) { el.innerHTML = ''; return; }
  const parts = [];
  if (m.incoming.length) {
    parts.push(`<h2 class="rot-section-title">คำขอถึงคุณ <span class="rot-count">${m.incoming.length}</span></h2>`);
    parts.push('<ul class="rot-list">' + m.incoming.map((q) => {
      const who = m.byId.get(q.requester_id);
      const broadcast = !q.target_id;
      return `<li class="rot-ask is-incoming">
        <div class="rot-ask-text">
          ${personLine(who)}
          <span class="rot-muted">${broadcast ? `ขอแลกกับใครก็ได้ในกลุ่ม ${escHtml(q.to_group)}` : 'ขอแลกกับคุณ'} · ${agoTh(q.created_at)}</span>
          <span class="rot-ask-result">ถ้าตอบรับ คุณจะย้ายไปกลุ่ม ${escHtml(q.from_group)}</span>
        </div>
        <div class="rot-ask-actions">
          ${live ? `<button type="button" class="btn btn-sm btn-custom" data-rot-act="accept" data-id="${q.id}">ดูและตอบรับ</button>` : ''}
          ${live && !broadcast ? `<button type="button" class="btn btn-sm btn-link rot-quiet" data-rot-act="decline" data-id="${q.id}">ไม่รับ</button>` : ''}
        </div>
      </li>`;
    }).join('') + '</ul>');
  }
  if (m.outgoing.length) {
    parts.push(`<h2 class="rot-section-title">คำขอของคุณ <span class="rot-count">${m.outgoing.length}</span></h2>`);
    parts.push('<ul class="rot-list">' + m.outgoing.map((q) => {
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
    }).join('') + '</ul>');
  }
  if (!parts.length) {
    parts.push(`<p class="rot-empty">${live
      ? 'ยังไม่มีคำขอ — ไปที่ <button type="button" class="btn btn-link p-0 align-baseline" data-rot-view="groups">ทุกกลุ่ม</button> เพื่อดูว่าแลกกับใครได้'
      : 'ยังไม่มีคำขอ'}</p>`);
  }
  el.innerHTML = parts.join('');
}

function paintViews() {
  document.querySelectorAll('#rotRoot [data-rot-view]').forEach((b) => {
    if (b.classList.contains('rot-seg-btn')) b.setAttribute('aria-selected', String(b.dataset.rotView === state.view));
  });
  document.querySelectorAll('#rotRoot [data-rot-pane]').forEach((p) => { p.hidden = p.dataset.rotPane !== state.view; });
  if (state.view === 'mine') paintMine();
  if (state.view === 'groups') paintGroups();
  if (state.view === 'feed') paintFeed();
}

function timetableHtml(group, { compareTo = null } = {}) {
  const tt = groupTimetable(ROUND, group);
  const now = weekOf(ROUND);
  return '<ol class="rot-timeline">' + tt.map((b, i) => {
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
      ${compareTo ? `<p class="rot-block-was">เดิม: ${unitChip(groupTimetable(ROUND, compareTo)[i].unitKey)}</p>` : ''}
    </li>`;
  }).join('') + '</ol>';
}

function paintMine() {
  const el = $('rotViewMine');
  const me = state.board.me;
  const group = me?.current_group || state.board.round.groups[0];
  el.innerHTML = `
    <div class="rot-view-head">
      <h2 class="rot-section-title">${me ? 'ตารางของฉัน' : 'ตาราง'} · กลุ่ม ${escHtml(group)}</h2>
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
      ${ROUND.blocks.map((b) => `<span role="columnheader" class="rot-matrix-h">${b.label.replace('Block ', 'B')}<small>${thDate(groupTimetable(ROUND, 'A')[ROUND.blocks.indexOf(b)].start)}</small></span>`).join('')}
    </div>
    ${Object.keys(ROUND.groups).map((g) => `
      <button type="button" class="rot-matrix-row ${me?.current_group === g ? 'is-mine' : ''}" role="row" data-rot-act="jump-group" data-group="${g}"
              aria-label="กลุ่ม ${g}${me?.current_group === g ? ' (กลุ่มของคุณ)' : ''} ${counts.get(g)?.members.length || 0} คน">
        <span role="rowheader" class="rot-matrix-g">${g}</span>
        ${ROUND.groups[g].map(([u]) => `<span role="cell" class="rot-matrix-c" style="--unit:${ROUND.units[u].tone}">${escHtml(ROUND.units[u].short)}</span>`).join('')}
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
  if (live && me && !isMe) {
    if (theirs) action = `<button type="button" class="btn btn-sm btn-custom" data-rot-act="accept" data-id="${theirs.id}">ตอบรับ</button>`;
    else if (mine) action = `<button type="button" class="btn btn-sm btn-outline-secondary" data-rot-act="cancel" data-id="${mine.id}">ส่งแล้ว · ยกเลิก</button>`;
    else if (s.can_swap) action = `<button type="button" class="btn btn-sm btn-outline-success" data-rot-act="ask" data-id="${s.id}">ขอแลก</button>`;
  }
  const askLine = asks.length
    ? `<span class="rot-member-asks">${asks.map((q) => q.target_id
        ? `ขอแลกกับ ${escHtml(fullName(m.byId.get(q.target_id)))}`
        : `ขอแลกกับใครก็ได้ในกลุ่ม ${escHtml(q.to_group)}`).join(' · ')}</span>`
    : '';
  const admin = state.board.is_admin;
  return `<li class="rot-member ${s.can_swap ? 'is-eligible' : ''} ${isMe ? 'is-me' : ''}">
    <span class="rot-gender is-${s.gender === 'M' ? 'm' : 'f'}" title="${genderTh(s.gender)}" aria-label="${genderTh(s.gender)}"></span>
    <div class="rot-member-text">
      <span class="rot-member-name">${escHtml(fullName(s))}${isMe ? ' <span class="rot-tag">คุณ</span>' : ''}${theirs ? ' <span class="rot-tag is-accent">ขอแลกกับคุณ</span>' : ''}</span>
      <span class="rot-member-meta">${escHtml(s.student_id)}${s.original_group !== s.current_group ? ` · เดิมกลุ่ม ${escHtml(s.original_group)}` : ''}${s.signed_in ? '' : ' · ยังไม่เคยเข้าเว็บ'}${admin ? ` · GPA ${s.gpa ?? '—'}` : ''}</span>
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

function paintGroups() {
  const el = $('rotViewGroups');
  const m = state.model;
  const me = m.me;
  const live = state.board.round.swaps_live;
  const q = state.query.trim().toLowerCase();
  const match = (s) => !q || fullName(s).toLowerCase().includes(q) || s.student_id.includes(q);
  const groupsHtml = m.groupList.map((g) => {
    let members = g.members.filter(match);
    if (state.onlyEligible) members = members.filter((s) => s.can_swap || (me && s.id === me.id));
    if (q && !members.length) return '';
    const open = state.openGroups.has(g.group) || !!q;
    const plan = ROUND.groups[g.group].map(([u]) => ROUND.units[u].short).join(' → ');
    const myBc = m.myBroadcast.get(g.group);
    let bcAction = '';
    if (live && me && !g.isMine) {
      if (myBc) bcAction = `<button type="button" class="btn btn-sm btn-outline-secondary" data-rot-act="cancel" data-id="${myBc.id}">ส่งถึงทั้งกลุ่มแล้ว · ยกเลิก</button>`;
      else if (g.eligible) bcAction = `<button type="button" class="btn btn-sm btn-outline-success" data-rot-act="ask-group" data-group="${g.group}">ขอแลกกับทุกคนที่แลกได้ (${g.eligible})</button>`;
    }
    return `<details class="rot-group ${g.isMine ? 'is-mine' : ''}" data-group="${g.group}" ${open ? 'open' : ''}>
      <summary>
        ${groupChip(g.group)}
        <span class="rot-group-sum">
          <span class="rot-group-title">กลุ่ม ${g.group}${g.isMine ? ' · กลุ่มของคุณ' : ''}</span>
          <span class="rot-group-plan">${escHtml(plan)}</span>
          <span class="rot-group-counts">${g.members.length} คน · ชาย ${g.male} หญิง ${g.female}${me && !g.isMine ? ` · <strong>แลกกับคุณได้ ${g.eligible}</strong>` : ''}</span>
        </span>
        <i class="bi bi-chevron-down rot-group-caret" aria-hidden="true"></i>
      </summary>
      ${bcAction ? `<div class="rot-group-bc">${bcAction}<p class="rot-muted">คนแรกที่ตอบรับจะได้แลกกับคุณ แล้วคำขออื่นของคุณจะปิดเอง</p></div>` : ''}
      <ul class="rot-members">${members.map(memberRow).join('') || '<li class="rot-empty">ไม่มีคนที่ตรงกับตัวกรอง</li>'}</ul>
    </details>`;
  }).join('');

  el.innerHTML = `
    <div class="rot-view-head">
      <h2 class="rot-section-title">ภาพรวมทุกกลุ่ม</h2>
      <p class="rot-muted">แตะกลุ่มเพื่อดูรายชื่อ · เกณฑ์ตอนนี้: เพศเดียวกัน${state.board.round.gpa_rule === 'same_band' ? ' และ GPA ช่วงเดียวกัน' : ''}</p>
    </div>
    ${matrixHtml()}
    <div class="rot-filter">
      <input type="search" class="form-control form-control-sm" placeholder="ค้นหาชื่อ หรือรหัสนักศึกษา"
             value="${escHtml(state.query)}" data-rot-input="query" aria-label="ค้นหาชื่อ หรือรหัสนักศึกษา">
      ${me ? `<label class="rot-switch"><input type="checkbox" data-rot-input="only" ${state.onlyEligible ? 'checked' : ''}> เฉพาะคนที่แลกกับฉันได้</label>` : ''}
    </div>
    <div class="rot-groups">${groupsHtml || '<p class="rot-empty">ไม่พบชื่อที่ค้นหา</p>'}</div>`;
}

function paintFeed() {
  const el = $('rotViewFeed');
  const m = state.model;
  const items = buildFeed(state.board);
  const name = (id) => escHtml(fullName(m.byId.get(id)) || '(ไม่พบ)');
  const closedTh = { declined: 'ไม่ตอบรับ', cancelled: 'ยกเลิกแล้ว', superseded: 'ปิดเอง เพราะมีการแลกอื่นก่อน' };
  const rows = items.map((it) => {
    if (it.kind === 'ask') {
      const q = it.q;
      return `<li class="rot-feed-item"><i class="bi bi-arrow-left-right" aria-hidden="true"></i><div>
        <strong>${name(q.requester_id)}</strong> ${groupChip(q.from_group, 'is-sm')}
        ${q.target_id ? `ขอแลกกับ <strong>${name(q.target_id)}</strong> ${groupChip(q.to_group, 'is-sm')}` : `ขอแลกกับใครก็ได้ในกลุ่ม ${groupChip(q.to_group, 'is-sm')}`}
        <span class="rot-muted">${agoTh(it.at)}</span></div></li>`;
    }
    if (it.kind === 'swap') {
      const q = it.q;
      return `<li class="rot-feed-item is-swap"><i class="bi bi-check2-circle" aria-hidden="true"></i><div>
        <strong>${name(q.requester_id)}</strong> แลกกับ <strong>${name(q.accepted_by)}</strong> แล้ว:
        ${name(q.requester_id)} ไปกลุ่ม ${groupChip(q.to_group, 'is-sm')} · ${name(q.accepted_by)} ไปกลุ่ม ${groupChip(q.from_group, 'is-sm')}
        <span class="rot-muted">${agoTh(it.at)}</span></div></li>`;
    }
    if (it.kind === 'admin') {
      const mv = it.m;
      return `<li class="rot-feed-item"><i class="bi bi-shield-check" aria-hidden="true"></i><div>
        ผู้ดูแลย้าย <strong>${name(mv.student_id)}</strong> จากกลุ่ม ${groupChip(mv.from_group, 'is-sm')} ไป ${groupChip(mv.to_group, 'is-sm')}
        <span class="rot-muted">${agoTh(it.at)}</span></div></li>`;
    }
    const q = it.q;
    const mineAsk = q.requester_id === m.me?.id;
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
    <ul class="rot-feed">${rows.join('') || '<li class="rot-empty">ยังไม่มีความเคลื่อนไหว</li>'}</ul>`;
}

function paintAdmin() {
  const el = $('rotAdmin');
  if (!state.board.is_admin) { el.hidden = true; el.innerHTML = ''; return; }
  const r = state.board.round;
  const close = r.swaps_close_at ? toLocalInput(new Date(r.swaps_close_at)) : '';
  const nGpa = state.board.students.filter((s) => s.gpa !== null && s.gpa !== undefined).length;
  el.hidden = false;
  el.innerHTML = `
    <h2 class="rot-section-title"><i class="bi bi-shield-lock me-1" aria-hidden="true"></i>ผู้ดูแล</h2>
    <form data-rot-form="admin" class="rot-admin-form">
      <label class="rot-switch"><input type="checkbox" name="published" ${r.published ? 'checked' : ''}> นักศึกษาเห็นหน้านี้</label>
      <label class="rot-switch"><input type="checkbox" name="swaps_open" ${r.swaps_open ? 'checked' : ''}> เปิดให้แลก</label>
      <label class="rot-admin-field">ปิดรับอัตโนมัติ (เว้นว่าง = ไม่ปิดเอง)
        <input type="datetime-local" name="close_at" class="form-control form-control-sm" value="${close}"></label>
      <label class="rot-admin-field">เกณฑ์ GPA
        <select name="gpa_rule" class="form-select form-select-sm">
          <option value="off" ${r.gpa_rule === 'off' ? 'selected' : ''}>ไม่ใช้ (เก็บข้อมูลอย่างเดียว)</option>
          <option value="same_band" ${r.gpa_rule === 'same_band' ? 'selected' : ''}>ต้องอยู่ช่วงเดียวกัน (2.55–2.99 / 3.00–3.49 / 3.50–4.00)</option>
        </select></label>
      <button type="submit" class="btn btn-sm btn-custom">บันทึก</button>
      <p class="rot-muted mb-0">${state.board.students.length} คนในตาราง · กรอก GPA แล้ว ${nGpa} คน · ช่องเลือกกลุ่มข้างชื่อในแท็บ "ทุกกลุ่ม" = ย้ายเองโดยผู้ดูแล</p>
    </form>`;
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
    <thead><tr><th scope="col">Block</th><th scope="col">ตอนนี้ (${escHtml(fromGroup)})</th><th scope="col">หลังแลก (${escHtml(toGroup)})</th></tr></thead>
    <tbody>${a.map((x, i) => `<tr>
      <th scope="row">${x.block.label.replace('Block ', '')}<small>${thDate(x.start)}</small></th>
      <td>${unitChip(x.unitKey)}</td><td>${unitChip(b[i].unitKey)}</td></tr>`).join('')}</tbody>
  </table>`;
}

function askSheet({ title, lead, fromGroup, toGroup, yes }) {
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
            ${compareHtml(fromGroup, toGroup)}
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">ยกเลิก</button>
            <button type="button" class="btn btn-custom" data-rot-sheet-yes>${yes}</button>
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
    await load();
  }
}

async function onClick(e) {
  const viewBtn = e.target.closest('[data-rot-view]');
  if (viewBtn) {
    state.view = viewBtn.dataset.rotView;
    paintViews();
    if (!viewBtn.classList.contains('rot-seg-btn')) $('rotViewGroups')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
  const b = e.target.closest('[data-rot-act]');
  if (!b) return;
  const m = state.model;
  const me = m?.me;
  const kind = b.dataset.rotAct;

  if (kind === 'reload') { paintGate('loading'); load(); return; }

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
    const yes = await askSheet({
      title: `ขอแลกกับ ${escHtml(fullName(t))}?`,
      lead: `คุณอยู่กลุ่ม <strong>${escHtml(me.current_group)}</strong> · ${escHtml(fullName(t))} อยู่กลุ่ม <strong>${escHtml(t.current_group)}</strong><br>
             <strong>ถ้าเขาตอบรับ ระบบจะสลับกลุ่มให้ทันที</strong> ไม่ต้องยืนยันซ้ำ · ยกเลิกคำขอได้ตลอดจนกว่าจะมีคนตอบรับ · ทุกคนในปี 6 เห็นคำขอนี้`,
      fromGroup: me.current_group, toGroup: t.current_group, yes: 'ส่งคำขอ',
    });
    if (!yes) return;
    const res = await act(b, () => rpc('rotation_request', { p_round: ROUND_ID, p_target: t.id, p_to_group: null }));
    if (res?.ok) toast(`ส่งคำขอถึง ${fullName(t)} แล้ว`);
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
    if (res?.ok) toast(`ส่งคำขอถึงกลุ่ม ${g} แล้ว`);
    return;
  }

  if (kind === 'accept') {
    const q = (state.board.requests || []).find((x) => x.id === b.dataset.id);
    if (!q || !me) return;
    const who = m.byId.get(q.requester_id);
    const yes = await askSheet({
      title: `แลกกับ ${escHtml(fullName(who))}?`,
      lead: `คุณจะย้ายจากกลุ่ม <strong>${escHtml(me.current_group)}</strong> ไปกลุ่ม <strong>${escHtml(q.from_group)}</strong>
             และ ${escHtml(fullName(who))} จะมากลุ่ม ${escHtml(me.current_group)} <strong>ทันที</strong><br>
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
  }
}

async function onSubmit(e) {
  const form = e.target.closest('[data-rot-form]');
  if (!form) return;
  e.preventDefault();
  const btn = form.querySelector('[type="submit"]');
  if (form.dataset.rotForm === 'gpa') {
    const err = form.querySelector('[data-rot-gpa-error]');
    const { value, error } = parseGpa(form.elements.gpa.value);
    err.hidden = !error;
    err.textContent = error || '';
    if (error) return;
    const res = await act(btn, () => rpc('rotation_set_gpa', { p_round: ROUND_ID, p_gpa: value }));
    if (res?.ok) toast(value === null ? 'ลบ GPA แล้ว' : `บันทึก GPA ${value.toFixed(2)} แล้ว`);
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
  if (t.dataset.rotMove) {
    const s = state.model.byId.get(t.dataset.rotMove);
    const res = await act(null, () => rpc('rotation_admin_move', { p_student: t.dataset.rotMove, p_group: t.value }));
    if (res?.ok) toast(`ย้าย ${fullName(s)} ไปกลุ่ม ${t.value} แล้ว`);
  }
  // <details> open state survives a re-render.
}

document.addEventListener('toggle', (e) => {
  const d = e.target;
  if (d?.tagName === 'DETAILS' && d.classList.contains('rot-group')) {
    if (d.open) state.openGroups.add(d.dataset.group); else state.openGroups.delete(d.dataset.group);
  }
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
