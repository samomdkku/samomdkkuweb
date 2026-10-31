// ==============================================
// YEAR BAR — which ปี SAMO the ทีม SAMO pane is showing (0271).
//
// Owner, 2026-10-31, pointing at ระบบบ้าน's MD49 … MD54 chips: "shouldn't the
// ui ux to adjust team and permission for each year of teamsamo be like this —
// it's redundant to have it inside". The old ทีมแต่ละปี tab listed every year
// with an editor nested inside one of them; the year is now picked ONCE, here,
// and the rest of the pane is that year:
//
//   current year → the live tree: จัดการทีม · จัดการสิทธิ์ · ตรวจสอบข้อมูล
//   a year ahead → the SAME editor on its prepared draft (team_draft_*), the
//                  permissions included — prepared, applied on switch day
//                  (owner's choice), grants nothing before then
//   a past year  → its archive list (terms.js) — history, grants nothing
//
// This module owns the year list and the year-level actions (show/hide on
// เกี่ยวกับเรา, delete, publish the current one, start preparing a year). What
// the editor does with a year is index.js's business, told through onView.
// ==============================================

import { escHtml } from '../utils.js';
import { askConfirm } from '../confirm-modal.js';
import { publishTermAsking } from './term-dialogs.js';
import {
  fetchTerms, createTerm, deleteTerm, fetchTermStatus,
  setTermShown, startTeamDraft, fetchDraftSummary,
} from './api.js';

const $ = (id) => document.getElementById(id);

let bar = null;       // the chips
let head = null;      // the strip under them: what this year is + its actions
let pane = null;      // the "not prepared yet" panel of a year ahead
let canEdit = () => false;
let onView = () => {};
let onCurrentYear = () => {};

let terms = [];               // team_terms rows, ascending
let summaries = new Map();    // future year -> team_draft_summary()
let staleCurrent = false;     // the current year's published snapshot is behind
let selected = null;          // the year on screen
let adding = false;           // the + chip's inline form is open
let busy = Promise.resolve();

const current = () => terms.find((t) => t.is_current) || null;

/** What kind of year `t` is, for the editor. */
export function viewOf(t) {
  const cur = current();
  if (!t) return { kind: 'none', termYear: null };
  if (t.is_current || !cur) return { kind: 'current', termYear: t.year };
  if (t.year > cur.year) {
    return { kind: summaries.get(t.year)?.prepared ? 'draft' : 'unprepared', termYear: t.year };
  }
  return { kind: 'archive', termYear: t.year };
}

function status(msg, kind = '') {
  const el = $('teamYearStatus');
  if (!el) return;
  el.textContent = msg || '';
  el.className = `team-year-status${kind ? ` is-${kind}` : ''}`;
}

function guard(fn, okMsg) {
  busy = busy.then(async () => {
    try {
      await fn();
      if (okMsg) status(okMsg, 'ok');
    } catch (err) {
      status(err?.message || 'ทำรายการไม่สำเร็จ', 'error');
    }
  });
  return busy;
}

// ── data ────────────────────────────────────────────────────────────────────

async function load() {
  terms = (await fetchTerms()).slice().sort((a, b) => a.year - b.year);
  const cur = current();
  onCurrentYear(cur?.year || null);
  const ahead = terms.filter((t) => cur && t.year > cur.year);
  const [sums, st] = await Promise.all([
    Promise.all(ahead.map((t) => fetchDraftSummary(t.year).catch(() => ({ prepared: false })))),
    canEdit() ? fetchTermStatus().catch(() => null) : null,
  ]);
  summaries = new Map(ahead.map((t, i) => [t.year, sums[i] || { prepared: false }]));
  staleCurrent = !!(st?.terms || []).find((x) => cur && x.year === cur.year)?.stale;
  if (!terms.some((t) => t.year === selected)) selected = cur?.year ?? terms[terms.length - 1]?.year ?? null;
}

// ── rendering ───────────────────────────────────────────────────────────────

function chip(t) {
  const on = t.year === selected;
  const v = viewOf(t);
  const sub = v.kind === 'current' ? 'ปัจจุบัน'
    : v.kind === 'draft' ? 'เตรียมไว้'
      : v.kind === 'unprepared' ? 'ยังไม่เตรียม' : '';
  return `<button type="button" class="btn btn-sm team-year-chip ${on ? 'btn-success' : 'btn-outline-secondary'}${v.kind === 'unprepared' ? ' is-unprepared' : ''}"
      data-team-year="${t.year}" aria-pressed="${on}">
      <span class="team-year-num">${t.year}</span>${sub ? `<span class="team-year-sub">${sub}</span>` : ''}
    </button>`;
}

function addChip() {
  if (!canEdit()) return '';
  if (!adding) {
    return `<button type="button" class="btn btn-sm btn-outline-secondary team-year-add" data-team-year-add
      aria-label="เพิ่มปี"><i class="bi bi-plus-lg"></i></button>`;
  }
  const next = (terms[terms.length - 1]?.year || (current()?.year ?? 2569)) + 1;
  return `<form class="team-year-addform" data-team-year-addform>
      <input type="number" class="form-control form-control-sm" name="year" value="${next}" min="2500" max="2700"
        aria-label="ปี SAMO ที่จะเพิ่ม" />
      <button type="submit" class="btn btn-sm btn-primary">เพิ่มปี</button>
      <button type="button" class="btn btn-sm btn-link" data-team-year-addcancel>ยกเลิก</button>
    </form>`;
}

function shownToggle(t) {
  const shown = !!t.published_at;
  return `<button type="button" class="btn btn-sm ${shown ? 'btn-outline-secondary' : 'btn-outline-primary'}"
      data-team-year-shown="${t.year}" data-shown="${shown ? '0' : '1'}">
      <i class="bi ${shown ? 'bi-eye-slash' : 'bi-eye'}"></i> ${shown ? 'ซ่อนจากหน้าเกี่ยวกับเรา' : 'แสดงบนหน้าเกี่ยวกับเรา'}
    </button>`;
}

function deleteBtn(t) {
  return `<button type="button" class="btn btn-sm btn-outline-danger" data-team-year-delete="${t.year}"
      aria-label="ลบปี ${t.year}"><i class="bi bi-trash"></i></button>`;
}

/** "+3 คน · −2 คน · 5 คนเปลี่ยนตำแหน่งหรือสิทธิ์" — what pressing the switch
 *  will do, against the tree as it is NOW. */
export function summaryLine(s) {
  if (!s?.prepared) return '';
  const parts = [];
  if (s.members_added) parts.push(`เพิ่ม ${s.members_added} คน`);
  if (s.members_removed) parts.push(`ออก ${s.members_removed} คน`);
  if (s.members_changed) parts.push(`${s.members_changed} คนเปลี่ยนตำแหน่งหรือสิทธิ์`);
  if (s.nodes_added) parts.push(`ตำแหน่งใหม่ ${s.nodes_added}`);
  if (s.nodes_removed) parts.push(`ปิด ${s.nodes_removed} ตำแหน่ง`);
  if (s.nodes_changed) parts.push(`แก้ ${s.nodes_changed} ตำแหน่ง`);
  return parts.length ? `เทียบกับทีมตอนนี้: ${parts.join(' · ')}` : 'เหมือนทีมตอนนี้ทุกอย่าง';
}

function headHtml(t) {
  if (!t) return '';
  const v = viewOf(t);
  const write = canEdit();
  if (v.kind === 'current') {
    const pub = !!t.published_at;
    return `
      <div class="team-year-info">
        <strong>ทีมปี ${t.year}</strong>
        <span class="team-year-what">ปีปัจจุบัน — ผังนี้ให้สิทธิ์จริงตอนนี้</span>
        ${pub ? `<span class="team-year-pill${staleCurrent ? ' is-stale' : ''}">${staleCurrent
          ? 'หน้าเกี่ยวกับเราแสดงภาพนิ่งเก่า — กดเผยแพร่ซ้ำ'
          : 'หน้าเกี่ยวกับเราแสดงภาพนิ่งที่เผยแพร่ไว้'}</span>` : ''}
      </div>
      ${write ? `<div class="team-year-actions">
        ${pub ? `<button type="button" class="btn btn-sm btn-outline-secondary" data-team-year-publish="${t.year}">
          <i class="bi bi-camera"></i> เผยแพร่ซ้ำ</button>` : ''}
        <button type="button" class="btn btn-sm btn-link" data-team-year-goto>เปลี่ยนปีที่หน้า ปี SAMO</button>
      </div>` : ''}`;
  }
  if (v.kind === 'draft' || v.kind === 'unprepared') {
    return `
      <div class="team-year-info">
        <strong>ทีมปี ${t.year}</strong>
        <span class="team-year-what">ยังไม่ถึงปี — ผังและสิทธิ์ที่จัดไว้จะใช้จริงเมื่อเริ่มปี SAMO ${t.year}</span>
        ${v.kind === 'draft' ? `<span class="team-year-summary">${escHtml(summaryLine(summaries.get(t.year)))}</span>` : ''}
        ${t.published_at ? '<span class="team-year-pill is-on"><i class="bi bi-eye"></i> แสดงบนหน้าเกี่ยวกับเราแล้ว</span>' : ''}
      </div>
      ${write ? `<div class="team-year-actions">
        ${v.kind === 'draft' ? shownToggle(t) : ''}${deleteBtn(t)}
      </div>` : ''}`;
  }
  return `
    <div class="team-year-info">
      <strong>ทีมปี ${t.year}</strong>
      <span class="team-year-what">ปีที่ผ่านมา — รายชื่อสำหรับแสดงผล ไม่ให้สิทธิ์ใคร</span>
      ${t.published_at ? '<span class="team-year-pill is-on"><i class="bi bi-eye"></i> แสดงบนหน้าเกี่ยวกับเรา</span>' : ''}
    </div>
    ${write ? `<div class="team-year-actions">${shownToggle(t)}${deleteBtn(t)}</div>` : ''}`;
}

function unpreparedHtml(t) {
  if (!canEdit()) {
    return `<div class="team-year-empty"><p>ยังไม่ได้เตรียมทีมปี ${t.year}</p></div>`;
  }
  return `
    <div class="team-year-empty">
      <h6>เตรียมทีมปี ${t.year}</h6>
      <p>จัดฝ่าย ตำแหน่ง คน และสิทธิ์ของปีหน้าไว้ก่อนได้เลย —
        ยังไม่มีผลกับใครจนถึงวันเริ่มปี SAMO ${t.year} แล้วจึงใช้แทนผังตอนนี้ในครั้งเดียว</p>
      <div class="team-year-start">
        <button type="button" class="btn btn-primary" data-team-year-start="live">
          <i class="bi bi-files"></i> คัดลอกจากทีมตอนนี้</button>
        <button type="button" class="btn btn-outline-secondary" data-team-year-start="empty">เริ่มจากว่าง</button>
      </div>
      <p class="team-year-hint">ส่วนใหญ่ทีมปีหน้าคือทีมปีนี้ที่เปลี่ยนบางคน — คัดลอกแล้วแก้เร็วกว่า</p>
    </div>`;
}

function paint() {
  if (!bar) return;
  bar.innerHTML = `<div class="team-year-chips" role="group" aria-label="เลือกปี">${terms.map(chip).join('')}${addChip()}</div>`;
  const t = terms.find((x) => x.year === selected) || null;
  if (head) head.innerHTML = `${headHtml(t)}<div class="team-year-status" id="teamYearStatus" role="status"></div>`;
  const v = viewOf(t);
  if (pane) {
    pane.classList.toggle('d-none', v.kind !== 'unprepared');
    pane.innerHTML = v.kind === 'unprepared' ? unpreparedHtml(t) : '';
  }
}

function announce() {
  const t = terms.find((x) => x.year === selected) || null;
  const v = viewOf(t);
  onView({
    ...v,
    // A past year's archive editor offers the other years with a list to copy from.
    years: terms.filter((x) => x.year !== selected).map((x) => x.year),
  });
}

// ── actions ─────────────────────────────────────────────────────────────────

async function refresh({ keepStatus = false } = {}) {
  await load();
  paint();
  if (!keepStatus) status('');
  announce();
}

function select(year) {
  if (year === selected) return;
  selected = year;
  adding = false;
  paint();
  announce();
}

async function addYear(year) {
  if (terms.some((t) => t.year === year)) { select(year); return; }
  await guard(async () => {
    await createTerm(year);
    selected = year;
    adding = false;
    await refresh({ keepStatus: true });
  }, `เพิ่มปี ${year} แล้ว`);
}

async function startDraft(from) {
  const year = selected;
  await guard(async () => {
    status(from === 'live' ? 'กำลังคัดลอกทีมตอนนี้…' : 'กำลังเริ่ม…');
    const res = await startTeamDraft(year, from);
    await refresh({ keepStatus: true });
    status(from === 'live'
      ? `คัดลอก ${res?.nodes ?? 0} ตำแหน่ง · ${res?.members ?? 0} คน มาที่ปี ${year} แล้ว — แก้ได้เลย`
      : `เริ่มทีมปี ${year} จากว่างแล้ว — กด “เพิ่มฝ่าย”`, 'ok');
  });
}

async function setShown(year, shown) {
  if (!shown && !await askConfirm({
    title: `ซ่อนทีมปี ${year} จากหน้าเกี่ยวกับเรา?`,
    body: 'รายชื่อยังเก็บไว้ครบ กดแสดงอีกครั้งเมื่อไหร่ก็ได้',
    yes: 'ซ่อน',
    danger: false,
  })) return;
  await guard(async () => {
    await setTermShown(year, shown);
    await refresh({ keepStatus: true });
  }, shown ? `ทีมปี ${year} แสดงบนหน้าเกี่ยวกับเราแล้ว` : `ซ่อนทีมปี ${year} แล้ว`);
}

async function removeYear(year) {
  const t = terms.find((x) => x.year === year);
  const v = viewOf(t);
  const s = summaries.get(year);
  if (!await askConfirm({
    title: `ลบปี ${year}?`,
    body: v.kind === 'draft'
      ? `ทีมที่เตรียมไว้ (${s?.members ?? 0} คน) จะหายไปด้วย กู้คืนไม่ได้ — ทีมตอนนี้ไม่ได้รับผลกระทบ`
      : 'รายชื่อและรูปที่เก็บไว้ของปีนี้จะหายไปด้วย กู้คืนไม่ได้ — ทีมตอนนี้ไม่ได้รับผลกระทบ',
    yes: 'ลบ',
  })) return;
  await guard(async () => {
    await deleteTerm(year);
    selected = current()?.year ?? null;
    await refresh({ keepStatus: true });
  }, `ลบปี ${year} แล้ว`);
}

async function republish(year) {
  await guard(async () => {
    status('กำลังบันทึกภาพนิ่งของผัง…');
    const res = await publishTermAsking(year, true);
    if (!res) { status(''); return; }
    await refresh({ keepStatus: true });
    status(`เผยแพร่ปี ${year} แล้ว — ${res?.nodes ?? 0} ตำแหน่ง · ${res?.members ?? 0} คน`, 'ok');
  });
}

// ── wiring ──────────────────────────────────────────────────────────────────

export function initYearBar({ barEl, headEl, paneEl, canEdit: ce, onView: ov, onCurrentYear: oc }) {
  bar = barEl; head = headEl; pane = paneEl;
  canEdit = ce || canEdit;
  onView = ov || onView;
  onCurrentYear = oc || onCurrentYear;
  const root = [bar, head, pane].filter(Boolean);

  for (const el of root) {
    el.addEventListener('click', (e) => {
      const t = e.target;
      const y = t.closest?.('[data-team-year]');
      if (y) return void select(Number(y.dataset.teamYear));
      if (t.closest?.('[data-team-year-add]')) {
        adding = true; paint();
        bar.querySelector('[data-team-year-addform] input')?.focus();
        return;
      }
      if (t.closest?.('[data-team-year-addcancel]')) { adding = false; paint(); return; }
      const st = t.closest?.('[data-team-year-start]');
      if (st) return void startDraft(st.dataset.teamYearStart);
      const sh = t.closest?.('[data-team-year-shown]');
      if (sh) return void setShown(Number(sh.dataset.teamYearShown), sh.dataset.shown === '1');
      const del = t.closest?.('[data-team-year-delete]');
      if (del) return void removeYear(Number(del.dataset.teamYearDelete));
      const pub = t.closest?.('[data-team-year-publish]');
      if (pub) return void republish(Number(pub.dataset.teamYearPublish));
      if (t.closest?.('[data-team-year-goto]')) return void window.openAdminSection?.('years');
    });
  }
  bar?.addEventListener('submit', (e) => {
    const f = e.target.closest?.('[data-team-year-addform]');
    if (!f) return;
    e.preventDefault();
    const y = Number(f.elements.year?.value);
    if (!Number.isInteger(y) || y < 2500 || y > 2700) { status('ปี SAMO ไม่ถูกต้อง', 'error'); return; }
    void addYear(y);
  });
  bar?.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && adding) { adding = false; paint(); }
  });
}

/** Load (or re-load) the years. The selection survives a reload when the year
 *  still exists; otherwise it falls back to the current year. `want` selects a
 *  year — added first when it is a year ahead nobody has created yet. */
export function enterYearBar(want = null) {
  return guard(async () => {
    if (want != null && canEdit()) {
      const y = Number(want);
      const rows = await fetchTerms();
      const known = rows.some((t) => t.year === y);
      const cur = rows.find((t) => t.is_current)?.year;
      if (!known && Number.isInteger(y) && cur && y > cur) await createTerm(y);
    }
    if (want != null) selected = Number(want);
    await refresh();
  });
}

/** After an edit to a prepared year, the summary line in the head is stale. */
export function refreshYearSummary() {
  const year = selected;
  const t = terms.find((x) => x.year === year);
  if (viewOf(t).kind !== 'draft') return;
  fetchDraftSummary(year).then((s) => {
    summaries.set(year, s);
    if (selected === year) {
      const el = head?.querySelector('.team-year-summary');
      if (el) el.textContent = summaryLine(s);
    }
  }).catch(() => {});
}

/** For callers outside the pane that only need the year (the ปี SAMO page). */
export function selectedYear() { return selected; }
